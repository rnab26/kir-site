param(
  [string]$Site = 'http://localhost:8792/kir-site',   # a local build of the site (scripts/serve.ps1 or any static server)
  [string]$Room = 'r23',                              # prepared room used for every product (src/assets/exp/rooms/<id>)
  [string[]]$Only = @(),                              # image ids to render (default: every product of the wall studio)
  [int]$W = 1200, [int]$H = 800,
  [switch]$Force                                      # render again even when the image exists
)
# "In a room" image of every wall product: the wall studio lays the product on every wall of a real room photo
# (the scroll story at its end) and the WebGL canvas is saved to src/assets/img/room/<image id>.jpg.
# The product page then shows it as its second view. Headless Chrome, one session for all products.
# Keep this file ASCII-only.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $Root 'src/assets/img/room'; if (-not (Test-Path $outDir)) { New-Item -ItemType Directory $outDir | Out-Null }
# product ids: the wall studio config of the built page
$html = (Invoke-WebRequest -UseBasicParsing "$Site/fr/experience/").Content
$ids = [regex]::Matches($html, '\{"id":"([A-Za-z0-9_-]+)","n":') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
if ($Only.Count) { $ids = $ids | Where-Object { $Only -contains $_ } }
'products: ' + @($ids).Count
$port = Get-Random -Minimum 9400 -Maximum 9800
$prof = Join-Path $env:TEMP ('room-shots-' + $port)
$p = Start-Process -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList @('--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', "--remote-debugging-port=$port", "--user-data-dir=$prof", "--window-size=$W,$H", 'about:blank') -PassThru
try {
  $list = $null
  for ($i = 0; $i -lt 40 -and -not $list; $i++) { Start-Sleep -Milliseconds 250; try { $list = Invoke-RestMethod "http://127.0.0.1:$port/json/list" } catch { } }
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $ws.ConnectAsync([Uri](@($list | Where-Object { $_.type -eq 'page' })[0].webSocketDebuggerUrl), [Threading.CancellationToken]::None).Wait()
  $script:id = 0
  function Send($method, $params) {
    $script:id++
    $bytes = [Text.Encoding]::UTF8.GetBytes((@{ id = $script:id; method = $method; params = $params } | ConvertTo-Json -Depth 8 -Compress))
    $ws.SendAsync((New-Object ArraySegment[byte] -ArgumentList (, $bytes)), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()
    $want = $script:id
    while ($true) {
      $ms = New-Object IO.MemoryStream; $buf = New-Object byte[] 65536
      do { $seg = New-Object ArraySegment[byte] -ArgumentList (, $buf); $r = $ws.ReceiveAsync($seg, [Threading.CancellationToken]::None); $r.Wait(); $ms.Write($buf, 0, $r.Result.Count) } while (-not $r.Result.EndOfMessage)
      $obj = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
      if ($obj.id -eq $want) { return $obj }
    }
  }
  function Eval([string]$js) { (Send 'Runtime.evaluate' @{ expression = $js; awaitPromise = $true; returnByValue = $true }).result.result.value }
  [void](Send 'Emulation.setDeviceMetricsOverride' @{ width = $W; height = $H; deviceScaleFactor = 1; mobile = $false })
  $n = 0
  foreach ($img in $ids) {
    $file = Join-Path $outDir ($img + '.jpg')
    if ((Test-Path $file) -and -not $Force) { continue }
    [void](Send 'Page.navigate' @{ url = "$Site/fr/experience/?m=$img&room=$Room&at=1" })
    # wait until the page is loaded and every piece is laid (the counter stops moving)
    $last = ''; $same = 0
    for ($t = 0; $t -lt 90 -and $same -lt 3; $t++) {
      Start-Sleep -Milliseconds 700
      $v = Eval "(document.getElementById('loading') && document.getElementById('loading').classList.contains('done') ? document.getElementById('nSlats').textContent : '')"
      if ($v -and $v -ne '0' -and $v -eq $last) { $same++ } else { $same = 0 }; $last = $v
    }
    Start-Sleep -Milliseconds 1500
    $data = Eval "new Promise(res => requestAnimationFrame(() => res(document.getElementById('gl').toDataURL('image/jpeg', 0.84))))"
    if ($data) { [IO.File]::WriteAllBytes($file, [Convert]::FromBase64String($data.Substring($data.IndexOf(',') + 1))); $n++; "$n  $img  ($last)" }
  }
  "done: $n images in src/assets/img/room"
} finally {
  try { Stop-Process -Id $p.Id -Force } catch { }
  Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -like "*$prof*" } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch { } }
}
