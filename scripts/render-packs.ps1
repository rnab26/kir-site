# Re-renders the "full plate" images (pack/ + thumb/) from the processed photos in tex/, without re-extracting.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/render-packs.ps1 [-Only id1,id2] [-OutDir path] [-Cats slat,panel]
param([string[]]$Only = @(), [string]$OutDir = '', [string[]]$Cats = @())
$ErrorActionPreference = 'Stop'
$Only = @($Only | ForEach-Object { $_ -split ',' } | Where-Object { $_ }); $Cats = @($Cats | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
[Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::InvariantCulture
$root = Split-Path -Parent $PSScriptRoot
$img = Join-Path $root 'src/assets/img'
Add-Type -Path (Join-Path $PSScriptRoot 'ImageKit.cs') -ReferencedAssemblies System.Drawing
. (Join-Path $PSScriptRoot 'plate-model.ps1')
$packDir = if ($OutDir) { $OutDir } else { Join-Path $img 'pack' }
$thumbDir = if ($OutDir) { $OutDir } else { Join-Path $img 'thumb' }
New-Item -ItemType Directory -Force $packDir, $thumbDir | Out-Null
$Prods = @(Get-Content -Raw -Encoding UTF8 (Join-Path $root 'data/products.json') | ConvertFrom-Json | ForEach-Object { $_ })
$n = 0; $sw = [Diagnostics.Stopwatch]::StartNew()
foreach ($p in $Prods) {
  if ($Only.Count -and $Only -notcontains $p.img) { continue }
  if ($Cats.Count -and $Cats -notcontains $p.c) { continue }
  $texPath = Join-Path $img "tex/$($p.img).jpg"
  if (-not (Test-Path $texPath)) { continue }
  $m = PlateModel $p
  if ($m.kind -ne 'plate') { continue }
  $tex = [KImg]::Load($texPath)
  $pack = [Kit]::RenderPack($tex, $m.kind, $m.w, $m.h, $m.tile, $m.tileH, $m.slats, $m.mirror, ($p.f -eq 'g'), $m.synth, $m.sample, (PlateSeed $p.img))
  $suffix = if ($OutDir) { '-pack' } else { '' }
  $pack.SaveJpg((Join-Path $packDir "$($p.img)$suffix.jpg"), 88)
  if (-not $OutDir) { $pack.Resize(520, 650).SaveJpg((Join-Path $thumbDir "$($p.img).jpg"), 84) }
  $n++
}
"rendered $n plates in $([Math]::Round($sw.Elapsed.TotalSeconds)) s"
