# AI upscaling (Real-ESRGAN x4plus) of small product crops produced by process-images.ps1.
# Slow on integrated GPUs (~1 min per image): runs in priority order and can be stopped/resumed anytime.
# Afterwards re-run scripts/process-images.ps1 then build.ps1 to use the sharper textures.
param([int]$MaxSide = 700, [int]$Limit = 0)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$ext = Join-Path (Split-Path -Parent $root) 'tools-ext'
$exe = Join-Path $ext 'realesrgan/bin/realesrgan-ncnn-vulkan.exe'
$models = Join-Path $ext 'realesrgan/bin/models'
$raw = Join-Path $ext 'work/raw'; $ai = Join-Path $ext 'work/ai'; $tmp = Join-Path $ext 'work/ai-tmp'
New-Item -ItemType Directory -Force $ai, $tmp | Out-Null
Add-Type -AssemblyName System.Drawing
$P = @(Get-Content -Raw -Encoding UTF8 (Join-Path $root 'data/products.json') | ConvertFrom-Json | ForEach-Object { $_ })
# priority: priced & in stock first, then the rest
$order = @($P | Where-Object { $null -ne $_.p -and -not $_.oos }) + @($P | Where-Object { -not ($null -ne $_.p -and -not $_.oos) })
$done = 0
foreach ($p in $order) {
  $id = $p.img; $in = Join-Path $raw "$id.jpg"; $out = Join-Path $ai "$id.jpg"
  if (-not (Test-Path $in) -or (Test-Path $out)) { continue }
  $im = [Drawing.Image]::FromFile($in); $w = $im.Width; $h = $im.Height; $im.Dispose()
  if ([Math]::Max($w, $h) -ge $MaxSide) { continue }
  $t = Join-Path $tmp "$id.png"
  $pr = Start-Process -FilePath $exe -ArgumentList @('-i', "`"$in`"", '-o', "`"$t`"", '-n', 'realesrgan-x4plus', '-s', '4', '-m', "`"$models`"") -NoNewWindow -Wait -PassThru -RedirectStandardError (Join-Path $tmp 'log.txt')
  if (-not (Test-Path $t)) { Write-Warning "failed: $id"; continue }
  # downscale to long side <= 1600 and store as jpg
  $b0 = [Drawing.Image]::FromFile($t); $s = [Math]::Min(1.0, 1600.0 / [Math]::Max($b0.Width, $b0.Height))
  $nw = [int]($b0.Width * $s); $nh = [int]($b0.Height * $s)
  $b = New-Object Drawing.Bitmap $nw, $nh; $g = [Drawing.Graphics]::FromImage($b); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($b0, 0, 0, $nw, $nh); $g.Dispose(); $b0.Dispose()
  $enc = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ep = New-Object Drawing.Imaging.EncoderParameters 1; $ep.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]94)
  $b.Save($out, $enc, $ep); $b.Dispose(); Remove-Item $t -Force
  $done++; Write-Host ("[{0}] {1} {2}x{3}" -f $done, $p.sku, $w, $h)
  if ($Limit -gt 0 -and $done -ge $Limit) { break }
}
Write-Host "AI upscaled: $done"
