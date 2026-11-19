# Re-renders the product images (pack/, thumb/, face/) from the processed photos in tex/, without re-extracting.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/render-packs.ps1 [-Only id1,id2] [-OutDir review-folder] [-Cats slat,panel] [-FaceOnly | -NoFace]
#   -FaceOnly: only face/<id>.jpg (3D studio textures), pack/ and thumb/ untouched; -NoFace: skip face/.
param([string[]]$Only = @(), [string]$OutDir = '', [string[]]$Cats = @(), [switch]$FaceOnly, [switch]$NoFace)
$ErrorActionPreference = 'Stop'
$Only = @($Only | ForEach-Object { $_ -split ',' } | Where-Object { $_ }); $Cats = @($Cats | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
[Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::InvariantCulture
$root = Split-Path -Parent $PSScriptRoot
$img = Join-Path $root 'src/assets/img'
Add-Type -Path (Join-Path $PSScriptRoot 'ImageKit.cs') -ReferencedAssemblies System.Drawing
. (Join-Path $PSScriptRoot 'plate-model.ps1')
if ($OutDir) { New-Item -ItemType Directory -Force $OutDir | Out-Null }
$Prods = @(Get-Content -Raw -Encoding UTF8 (Join-Path $root 'data/products.json') | ConvertFrom-Json | ForEach-Object { $_ })
$n = 0; $sw = [Diagnostics.Stopwatch]::StartNew()
foreach ($p in $Prods) {
  if ($Only.Count -and $Only -notcontains $p.img) { continue }
  if ($Cats.Count -and $Cats -notcontains $p.c) { continue }
  $texPath = Join-Path $img "tex/$($p.img).jpg"
  if (-not (Test-Path $texPath)) { continue }
  if ((PlateModel $p).kind -eq 'photo') { continue }   # product shots (mirrors, moldings...) are left as they are
  [void](SavePlateImages ([KImg]::Load($texPath)) $p $img $OutDir (-not $NoFace) ([bool]$FaceOnly))
  $n++
}
"rendered $n products in $([Math]::Round($sw.Elapsed.TotalSeconds)) s"
# manifest of the 3D studio textures: real size in cm of each face/<id>.jpg (px/cm = width px / wcm)
if (-not $OutDir) {
  $faceDir = Join-Path $img 'face'; $man = [ordered]@{}
  foreach ($p in $Prods) {
    $fp = Join-Path $faceDir "$($p.img).jpg"; if (-not (Test-Path $fp) -or $man.Contains($p.img)) { continue }
    $m = PlateModel $p; $bm = [Drawing.Image]::FromFile($fp)
    $man[$p.img] = [ordered]@{ w = $bm.Width; h = $bm.Height; wcm = [double]$m.w; hcm = [double]$m.h; kind = $m.kind }; $bm.Dispose()
  }
  [IO.File]::WriteAllText((Join-Path $root 'data/face-dims.json'), (ConvertTo-Json -InputObject $man -Depth 3), (New-Object Text.UTF8Encoding($false)))
  "face manifest: $($man.Count) textures -> data/face-dims.json"
}
