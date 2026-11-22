# Builds the travertine plate face used by the home page animation (KIR-090, our real product photo),
# at the plate's real proportions (122 x 280 cm): the photo is tiled with mirrored copies, so no seam shows.
param([string]$Src = 'src\assets\img\tex\18V6ZjPCYtQFs_xGwFp9Pj2jXDPOvACY2.jpg', [string]$Out = 'src\assets\img\home\plate-kir090.jpg', [int]$W = 700)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$im = [System.Drawing.Image]::FromFile((Join-Path $root $Src))
$H = [int][math]::Round($W * 280 / 122)
$th = [int][math]::Round($im.Height * $W / $im.Width)
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'
$y = 0; $flip = $false
while ($y -lt $H) {
  if ($flip) { $g.DrawImage($im, (New-Object System.Drawing.Rectangle 0, ($y + $th), $W, (-$th))) } else { $g.DrawImage($im, (New-Object System.Drawing.Rectangle 0, $y, $W, $th)) }
  $y += $th; $flip = -not $flip
}
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1; $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 86L
$bmp.Save((Join-Path $root $Out), $enc, $ep); $g.Dispose(); $bmp.Dispose(); $im.Dispose()
'plate ' + $W + 'x' + $H
