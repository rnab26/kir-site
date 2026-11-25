#requires -Version 5.1
<#
  Layout check of the built site in EVERY language and on phone + desktop screens (headless Chrome, no install).
  Raphael (25/11/2026): "fais attention quand on fait des modifications qu'il n'y ait pas de superposition avec les
  traductions comme en francais". A longer translation must never slide text under the fixed header, past the
  screen edge, or make header items overlap. Run it after every visual change, before pushing.
  Usage:
    powershell -ExecutionPolicy Bypass -File build.ps1 -SiteUrl http://localhost:8765
    powershell -ExecutionPolicy Bypass -File scripts/serve.ps1          (in another terminal)
    powershell -ExecutionPolicy Bypass -File scripts/check-layout.ps1 [-Base http://localhost:8765] [-Quick]
  Reports each problem (page, language, screen) and saves a screenshot of every page with a problem in _check/.
  Exit code 1 when a problem is found. Keep this file ASCII-only.
#>
param([string]$Base = 'http://localhost:8765', [switch]$Quick, [int]$Wait = 4)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root '_check'; if (-not (Test-Path $outDir)) { New-Item -ItemType Directory $outDir | Out-Null }

$prod = Get-ChildItem (Join-Path $root '_site/p') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
$pages = @('', 'catalog/', 'contact/', 'experience/', 'cart/')
if ($prod) { $pages += ('p/' + $prod.Name + '/') }
$langs = @(@{ code = 'he'; prefix = '' }, @{ code = 'en'; prefix = 'en/' }, @{ code = 'fr'; prefix = 'fr/' })
# short phone = what is left of a phone screen under the browser bars; the case Raphael reported
$screens = @(@{ name = 'phone-short'; w = 384; h = 700; mobile = $true }, @{ name = 'phone-narrow'; w = 360; h = 640; mobile = $true }, @{ name = 'phone'; w = 390; h = 844; mobile = $true }, @{ name = 'desktop'; w = 1366; h = 768; mobile = $false })
if ($Quick) { $screens = @($screens[0], $screens[1]) }

$check = @'
(function () {
  var out = [], W = innerWidth, H = innerHeight;
  var op = function (e) { var o = 1; for (var n = e; n && n.nodeType === 1; n = n.parentElement) { var cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return o; };
  if (document.documentElement.scrollWidth > W + 1) out.push('page wider than the screen: ' + document.documentElement.scrollWidth + 'px > ' + W + 'px');
  var heads = Array.prototype.slice.call(document.querySelectorAll('.site-header, header.top, .top')).filter(function (h) {
    var p = getComputedStyle(h).position; var r = h.getBoundingClientRect(); return (p === 'fixed' || p === 'sticky') && r.height > 0 && r.top < 5; });
  var hr = heads.map(function (h) { return h.getBoundingClientRect(); });
  var clipped = function (e) { for (var n = e.parentElement; n && n !== document.body; n = n.parentElement) { var ox = getComputedStyle(n).overflowX; if (ox !== 'visible') return true; } return false; };
  Array.prototype.forEach.call(document.querySelectorAll('body *'), function (e) {
    if (heads.some(function (h) { return h.contains(e); })) return;
    if (!Array.prototype.some.call(e.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); })) return;
    var r = e.getBoundingClientRect(); if (!r.width || !r.height || r.bottom <= 0 || r.top >= H) return;
    if (op(e) < 0.05) return;
    var txt = e.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
    hr.forEach(function (h) { if (r.top < h.bottom - 2 && r.bottom > h.top + 2 && r.left < h.right && r.right > h.left) out.push('text under the header: <' + e.tagName.toLowerCase() + '> "' + txt + '"'); });
    if ((r.right > W + 1 || r.left < -1) && !clipped(e)) out.push('text past the screen edge: "' + txt + '"');
  });
  var items = Array.prototype.slice.call(document.querySelectorAll('.site-header .logo, .site-header .langs, .site-header .list-btn, .site-header .nav > a, .site-header .nav > div, .site-header button, .top .brand, .top .tools'))
    .filter(function (e) { return op(e) > 0.05 && e.getBoundingClientRect().width; });
  for (var i = 0; i < items.length; i++) for (var j = i + 1; j < items.length; j++) {
    if (items[i].contains(items[j]) || items[j].contains(items[i])) continue;
    var a = items[i].getBoundingClientRect(), b = items[j].getBoundingClientRect();
    if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) out.push('header items overlap: ' + items[i].className + ' / ' + items[j].className);
  }
  items.forEach(function (e) { var r = e.getBoundingClientRect(); if (r.right > W + 1 || r.left < -1) out.push('header item past the screen edge: ' + (e.className || e.tagName)); });
  return out.filter(function (x, k) { return out.indexOf(x) === k; });
})()
'@

$port = Get-Random -Minimum 9400 -Maximum 9800
$prof = Join-Path $env:TEMP ('kir-check-' + $port)
$chrome = @('C:\Program Files\Google\Chrome\Application\chrome.exe', 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe', "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Google Chrome not found' }
$p = Start-Process -FilePath $chrome -ArgumentList @('--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', "--remote-debugging-port=$port", "--user-data-dir=$prof", 'about:blank') -PassThru
$problems = 0
try {
  $list = $null
  for ($i = 0; $i -lt 40 -and -not $list; $i++) { Start-Sleep -Milliseconds 250; try { $list = Invoke-RestMethod "http://127.0.0.1:$port/json/list" } catch { } }
  $target = @($list | Where-Object { $_.type -eq 'page' })[0]
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
  $script:id = 0
  function Send($method, $params) {
    $script:id++
    $bytes = [Text.Encoding]::UTF8.GetBytes((@{ id = $script:id; method = $method; params = $params } | ConvertTo-Json -Depth 8 -Compress))
    $ws.SendAsync((New-Object ArraySegment[byte] -ArgumentList (, $bytes)), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()
    while ($true) {
      $ms = New-Object IO.MemoryStream; $buf = New-Object byte[] 65536
      do { $seg = New-Object ArraySegment[byte] -ArgumentList (, $buf); $r = $ws.ReceiveAsync($seg, [Threading.CancellationToken]::None); $r.Wait(); $ms.Write($buf, 0, $r.Result.Count) } while (-not $r.Result.EndOfMessage)
      $obj = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
      if ($obj.id -eq $script:id) { return $obj }
    }
  }
  [void](Send 'Page.enable' @{})
  # the "see the site in French?" suggestion bar would hide part of the page: dismiss it for the check
  [void](Send 'Page.addScriptToEvaluateOnNewDocument' @{ source = "try{localStorage.setItem('kir-lang-asked','1')}catch(e){}" })
  foreach ($sc in $screens) {
    [void](Send 'Emulation.setDeviceMetricsOverride' @{ width = $sc.w; height = $sc.h; deviceScaleFactor = 1; mobile = [bool]$sc.mobile })
    foreach ($lg in $langs) {
      foreach ($pg in $pages) {
        $url = $Base.TrimEnd('/') + '/' + $lg.prefix + $pg
        [void](Send 'Page.navigate' @{ url = $url })
        Start-Sleep -Seconds $Wait
        # each page as it opens, then (home) once more at the end of the scroll animation, where the logo and name stand
        foreach ($state in @('', ' (end of the animation)')) {
          if ($state) {
            $rs = Send 'Runtime.evaluate' @{ expression = "(function(){var s=document.querySelector('[data-reel]');if(!s)return 'none';scrollTo(0,s.offsetTop+s.offsetHeight-innerHeight);return s.classList.contains('reel-on')?'on':'off'})()"; returnByValue = $true }
            $st = [string]$rs.result.result.value
            if ($st -eq 'none') { continue }
            if ($st -ne 'on') { $problems++; Write-Output ('PROBLEM  ' + $sc.name + '  ' + $lg.code + '  /' + $lg.prefix + $pg + '   the 3D animation did not start (WebGL / script error)'); continue }
            Start-Sleep -Seconds 3
          }
          $res = Send 'Runtime.evaluate' @{ expression = $check; returnByValue = $true }
          $issues = @($res.result.result.value)
          if ($issues.Count -and $issues[0]) {
            $problems += $issues.Count
            $name = ($sc.name + '-' + $lg.code + '-' + ($pg -replace '[^a-z0-9]+', '_')).TrimEnd('_') + ($(if ($state) { '-end' } else { '' })) + '.png'
            $shot = Send 'Page.captureScreenshot' @{ format = 'png' }
            [IO.File]::WriteAllBytes((Join-Path $outDir $name), [Convert]::FromBase64String($shot.result.data))
            Write-Output ('PROBLEM  ' + $sc.name + '  ' + $lg.code + '  /' + $lg.prefix + $pg + $state + '   (screenshot _check/' + $name + ')')
            foreach ($x in $issues) { Write-Output ('   - ' + $x) }
          } else { Write-Output ('ok       ' + $sc.name + '  ' + $lg.code + '  /' + $lg.prefix + $pg + $state) }
        }
      }
    }
  }
} finally {
  try { Stop-Process -Id $p.Id -Force } catch { }
  Get-CimInstance Win32_Process -Filter "name='chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$prof*" } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch { } }
}
if ($problems) { Write-Output ("$problems problem(s) found"); exit 1 } else { Write-Output 'No layout problem found'; exit 0 }
