# Télécharge les photos produits (Google Drive, liens publics des formules IMAGE du catalogue)
# et enregistre leurs dimensions dans data/images.json.
# Usage : powershell -ExecutionPolicy Bypass -File scripts/fetch-images.ps1 [-Force]
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$products = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'data/products.json') | ConvertFrom-Json
$outDir = Join-Path $root 'src/assets/img/products'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Add-Type -AssemblyName System.Drawing
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$dims = [ordered]@{}
$failed = @()
foreach ($p in $products) {
  $id = $p.img
  if (-not $id -or $dims.Contains($id)) { continue }
  $file = Join-Path $outDir "$id.jpg"
  if ($Force -or -not (Test-Path $file)) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "https://lh3.googleusercontent.com/d/$id=w1200" -OutFile $file -TimeoutSec 60
    } catch {
      $failed += "$($p.sku) | $id | $($_.Exception.Message)"
      if (Test-Path $file) { Remove-Item $file -Force }
      continue
    }
  }
  try {
    $img = [System.Drawing.Image]::FromFile($file)
    $dims[$id] = @{ w = $img.Width; h = $img.Height }
    $img.Dispose()
  } catch {
    $failed += "$($p.sku) | $id | fichier image invalide"
    Remove-Item $file -Force
  }
}
$json = $dims | ConvertTo-Json -Depth 3
[IO.File]::WriteAllText((Join-Path $root 'data/images.json'), $json, (New-Object Text.UTF8Encoding($false)))
"OK: $($dims.Count) images"
if ($failed.Count) { "ECHECS ($($failed.Count)):"; $failed }
