# Rebuilds product imagery from the annotated source photos.
#  1. finds every red frame in tools-ext/src-photos/*.jpg
#  2. matches each product (its old 400x500 thumbnail) to the right frame
#  3. extracts the frame interior straightened at native resolution, removes the number label, fixes light
#  4. (optional) AI upscaling with Real-ESRGAN for small crops  -> run scripts/ai-upscale.ps1, then re-run this
#  5. renders: src/assets/img/tex/<id>.jpg (real photo), pack/<id>.jpg (virtual plate 1000x1250), thumb/<id>.jpg
# Usage: powershell -ExecutionPolicy Bypass -File scripts/process-images.ps1 [-Only <imgId>]
param([string]$Only = '')
$ErrorActionPreference = 'Stop'
[Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::InvariantCulture
$root = Split-Path -Parent $PSScriptRoot
$ext = Join-Path (Split-Path -Parent $root) 'tools-ext'
$srcDir = Join-Path $ext 'src-photos'
$work = Join-Path $ext 'work'
$aiDir = Join-Path $work 'ai'
$rawDir = Join-Path $work 'raw'
$img = Join-Path $root 'src/assets/img'
foreach ($d in @($work, $aiDir, $rawDir, (Join-Path $img 'tex'), (Join-Path $img 'pack'), (Join-Path $img 'thumb'))) { New-Item -ItemType Directory -Force $d | Out-Null }
Add-Type -Path (Join-Path $PSScriptRoot 'ImageKit.cs') -ReferencedAssemblies System.Drawing

$Prods = @(Get-Content -Raw -Encoding UTF8 (Join-Path $root 'data/products.json') | ConvertFrom-Json | ForEach-Object { $_ })
$srcmap = @(Get-Content -Raw -Encoding UTF8 (Join-Path $root 'data/srcmap.json') | ConvertFrom-Json | ForEach-Object { $_ })
if ($srcmap.Count -ne $Prods.Count) { throw "srcmap ($($srcmap.Count)) and products ($($Prods.Count)) differ" }
$dark = [string][char]0x05E9 + [char]0x05D7 + [char]0x05D5 + [char]0x05E8 + '|' + [char]0x05DB + [char]0x05D4 + [char]0x05D4   # black | dark
$white = [string][char]0x05DC + [char]0x05D1 + [char]0x05DF + '(?!' + [char]0x05D9 + [char]0x05DD + ')|' + [char]0x05DC + [char]0x05D1 + [char]0x05E0 + [char]0x05D4   # white (not bricks)
$light = [string][char]0x05D1 + [char]0x05D4 + [char]0x05D9 + [char]0x05E8 + '|' + [char]0x05D1 + [char]0x05D6 + [char]0x05F3 + '|' + [char]0x05E7 + [char]0x05E8 + [char]0x05DD   # light | beige | cream

# ---- frames of every photo ----
Write-Host 'Detecting frames...'
$frames = New-Object System.Collections.ArrayList
$gains = @{}
foreach ($f in (Get-ChildItem $srcDir -Filter *.jpg)) {
  $name = $f.BaseName
  $im = [KImg]::Load($f.FullName)
  $gains[$name] = [Kit]::PhotoBalance($im)
  $k = 0
  foreach ($fr in [Kit]::FindFrames($im)) {
    $inner = [Kit]::ExtractInterior($im, $fr)
    if ($null -eq $inner) { continue }
    $fr.Photo = $name; $fr.Index = $k++; $fr.Desc = [Kit]::Descriptor($inner)
    [void]$frames.Add($fr)
  }
}
Write-Host ("{0} frames in {1} photos" -f $frames.Count, $gains.Count)

# ---- match products to frames ----
$pairs = New-Object System.Collections.ArrayList
for ($i = 0; $i -lt $Prods.Count; $i++) {
  $thumb = Join-Path $img ('products/' + $Prods[$i].img + '.jpg')
  $d = [Kit]::Descriptor([KImg]::Load($thumb))
  for ($j = 0; $j -lt $frames.Count; $j++) {
    if ($frames[$j].Photo -ne $srcmap[$i]) { continue }  # only frames of the product's own photo
    $s = [Kit]::Score($d, $frames[$j].Desc)
    if ($s -gt 0.40) { [void]$pairs.Add([pscustomobject]@{ i = $i; j = $j; s = $s }) }
  }
}
$assign = @{}; $usedF = @{}
foreach ($pr in ($pairs | Sort-Object s -Descending)) {
  if ($assign.ContainsKey($pr.i) -or $usedF.ContainsKey($pr.j)) { continue }
  $assign[$pr.i] = $pr; $usedF[$pr.j] = $true
}
Write-Host ("matched {0} / {1}" -f $assign.Count, $Prods.Count)

# ---- physical model per category ----
function Model($p) {
  $w = $null; $l = $null
  if ($p.s -match '^(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)$') { $w = [double]$matches[1]; $l = [double]$matches[2] * 100; if ($l -gt 1000) { $l = $l / 100 } }
  switch ($p.c) {
    'slat'    { if (-not $w) { $w = 20 }; if (-not $l) { $l = 290 }; $n = [Math]::Max(3, [Math]::Min(7, [Math]::Round(100 / $w))); return @{ kind = 'plate'; w = $w * $n; h = $l; tile = $w; tileH = $l; slats = $n; mirror = $false } }
    'flex'    { if (-not $w) { $w = 120 }; if (-not $l) { $l = 290 }; return @{ kind = 'plate'; w = $w; h = $l; tile = $w / 3; tileH = $l; slats = 1; mirror = $false } }
    'panel'   { if (-not $w) { $w = 122 }; if (-not $l) { $l = 280 }; return @{ kind = 'plate'; w = $w; h = $l; tile = $w; tileH = 0; slats = 1; mirror = $false } }
    'stone'   { if (-not $w) { $w = 60 }; if (-not $l) { $l = 120 }; return @{ kind = 'plate'; w = $w; h = $l; tile = $w; tileH = 0; slats = 1; mirror = $false } }
    'deco'    { if (-not $w) { $w = 80 }; if (-not $l) { $l = 50 }; return @{ kind = 'plate'; w = $w; h = $l; tile = $w; tileH = 0; slats = 1; mirror = $false } }
    'outdoor' { if (-not $w) { $w = 15 }; if (-not $l) { $l = 290 }; return @{ kind = 'plate'; w = $w * 6; h = $l; tile = $w; tileH = $l; slats = 6; mirror = $false } }
    default   { return @{ kind = 'photo'; w = 1; h = 1; tile = 1; tileH = 0; slats = 1; mirror = $false } }
  }
}

# ---- extract, enhance, render ----
$report = New-Object System.Collections.ArrayList
$byPhoto = @{}
for ($i = 0; $i -lt $Prods.Count; $i++) { if ($Only -and $Prods[$i].img -ne $Only) { continue }; $ph = if ($assign.ContainsKey($i)) { $frames[$assign[$i].j].Photo } else { '_none' }; if (-not $byPhoto.ContainsKey($ph)) { $byPhoto[$ph] = @() }; $byPhoto[$ph] += $i }
foreach ($ph in $byPhoto.Keys) {
  $src = if ($ph -ne '_none') { [KImg]::Load((Join-Path $srcDir "$ph.jpg")) } else { $null }
  foreach ($i in $byPhoto[$ph]) {
    $p = $Prods[$i]; $id = $p.img
    $isDark = ($p.he -match $dark)
    $ai = Join-Path $aiDir "$id.jpg"
    $raw = $null; $note = ''
    if ($assign.ContainsKey($i)) {
      $fr = $frames[$assign[$i].j]
      $raw = [Kit]::RemoveLabel([Kit]::ExtractInterior($src, $fr))
      $g = $gains[$ph]; $note = "frame $($fr.Photo)#$($fr.Index) score $([Math]::Round($assign[$i].s, 2))"
      $ar = $raw.W / [double]$raw.H
      if ($ar -lt 0.12 -or $ar -gt 8 -or [Kit]::RedFraction($raw) -gt 0.003) { $raw = [KImg]::Load((Join-Path $img "products/$id.jpg")); $g = [double[]]@(1, 1, 1); $note = "rejected crop ($note): old thumbnail" }
    } else {
      $raw = [KImg]::Load((Join-Path $img "products/$id.jpg")); $g = [double[]]@(1, 1, 1); $note = 'no frame: old thumbnail'
    }
    $raw.SaveJpg((Join-Path $rawDir "$id.jpg"), 95)
    $native = [Math]::Max($raw.W, $raw.H)
    $tex = $raw
    if (Test-Path $ai) { $tex = [KImg]::Load($ai); $note += ' +AI' }
    $tone = if ($isDark) { -1 } elseif ($p.he -match $white) { 2 } elseif ($p.he -match $light) { 1 } else { 0 }
    [Kit]::Enhance($tex, $g, $tone)
    # texture output: long side 1600 max; upscale small ones up to 2x
    $long = [Math]::Max($tex.W, $tex.H)
    $target = [Math]::Min(1600, [Math]::Max($long, [Math]::Min(1400, $long * 2)))
    if ($target -ne $long) { $sc = $target / $long; $tex = $tex.Resize([int]($tex.W * $sc), [int]($tex.H * $sc)) }
    [Kit]::Sharpen($tex, $(if ($native -lt 700 -and -not (Test-Path $ai)) { 0.8 } else { 0.45 }))
    $tex.SaveJpg((Join-Path $img "tex/$id.jpg"), 88)
    $m = Model $p
    $pack = [Kit]::RenderPack($tex, $m.kind, $m.w, $m.h, $m.tile, $m.tileH, $m.slats, $m.mirror, ($p.f -eq 'g'))
    $pack.SaveJpg((Join-Path $img "pack/$id.jpg"), 88)
    $pack.Resize(520, 650).SaveJpg((Join-Path $img "thumb/$id.jpg"), 84)
    [void]$report.Add([ordered]@{ img = $id; sku = $p.sku; native = "$($raw.W)x$($raw.H)"; tex = "$($tex.W)x$($tex.H)"; needAI = ($native -lt 700); note = $note })
  }
}
$json = ConvertTo-Json -InputObject @($report) -Depth 4
[IO.File]::WriteAllText((Join-Path $root 'data/image-report.json'), $json, (New-Object Text.UTF8Encoding($false)))
# image dimensions used by the site (tex sizes)
$dims = [ordered]@{}
foreach ($r in $report) { $wh = $r.tex -split 'x'; $dims[$r.img] = @{ w = [int]$wh[0]; h = [int]$wh[1] } }
if (-not $Only) { [IO.File]::WriteAllText((Join-Path $root 'data/tex-dims.json'), (ConvertTo-Json -InputObject $dims -Depth 3), (New-Object Text.UTF8Encoding($false))) }
Write-Host ("done: {0} products, {1} need AI (native < 700px), {2} without frame" -f $report.Count, @($report | Where-Object { $_.needAI }).Count, @($report | Where-Object { $_.note -like 'no frame*' }).Count)
