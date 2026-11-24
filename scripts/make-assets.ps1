# Generates src/assets/img/og.jpg (1200x630 share image) with the brand logo.
# logo.png (512x512 app icon) and logo-mark.png (round mark, transparent) are NOT drawn here since 24/11/2026:
# they come from the validated logo, Hipouy/logo/hi-carte/exports (favicon-512.png, marque-pour-fond-sombre-1024.png).
# Windows only (System.Drawing). Re-run when the brand changes. Keep this file ASCII-only.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$img = Join-Path $root 'src/assets/img'
$prod = Join-Path $img 'products'
$tax = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'data/taxonomy.json') | ConvertFrom-Json
$site = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'data/site.json') | ConvertFrom-Json

function Brass([float]$x, [float]$w) { New-Object Drawing.Drawing2D.LinearGradientBrush((New-Object Drawing.PointF($x, 0)), (New-Object Drawing.PointF(($x + $w), 0)), [Drawing.Color]::FromArgb(122, 90, 54), [Drawing.Color]::FromArgb(209, 171, 124)) }
function RoundRect($g, $brush, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, 2 * $r, 2 * $r, 180, 90); $p.AddArc($x + $w - 2 * $r, $y, 2 * $r, 2 * $r, 270, 90)
  $p.AddArc($x + $w - 2 * $r, $y + $h - 2 * $r, 2 * $r, 2 * $r, 0, 90); $p.AddArc($x, $y + $h - 2 * $r, 2 * $r, 2 * $r, 90, 90); $p.CloseFigure()
  $g.FillPath($brush, $p)
}

# OG image: textures as vertical slats + brand
$W = 1200; $H = 630
$bmp = New-Object Drawing.Bitmap $W, $H
$g = [Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.TextRenderingHint = 'AntiAliasGridFit'
$ids = @($tax.studioSwatches)
$sw = [math]::Ceiling($W / $ids.Count)
for ($i = 0; $i -lt $ids.Count; $i++) {
  $f = Join-Path $prod ($ids[$i] + '.jpg')
  if (Test-Path $f) { $t = [Drawing.Image]::FromFile($f); $g.DrawImage($t, (New-Object Drawing.Rectangle(($i * $sw), 0, $sw, $H)), (New-Object Drawing.Rectangle(100, 0, 200, 500)), 'Pixel'); $t.Dispose() }
}
for ($x = 0; $x -lt $W; $x += 40) {
  $br = New-Object Drawing.Drawing2D.LinearGradientBrush((New-Object Drawing.PointF($x, 0)), (New-Object Drawing.PointF(($x + 40), 0)), [Drawing.Color]::FromArgb(90, 0, 0, 0), [Drawing.Color]::FromArgb(10, 255, 255, 255))
  $g.FillRectangle($br, $x, 0, 40, $H)
}
$ov = New-Object Drawing.Drawing2D.LinearGradientBrush((New-Object Drawing.PointF(0, 0)), (New-Object Drawing.PointF(0, $H)), [Drawing.Color]::FromArgb(70, 22, 20, 17), [Drawing.Color]::FromArgb(235, 22, 20, 17))
$g.FillRectangle($ov, 0, 0, $W, $H)
$mk = [Drawing.Image]::FromFile((Join-Path $img 'logo-mark.png')); $g.DrawImage($mk, 62, 352, 116, 116); $mk.Dispose()
$fontBig = New-Object Drawing.Font('Segoe UI', 80, [Drawing.FontStyle]::Bold)
$fontMid = New-Object Drawing.Font('Georgia', 32, [Drawing.FontStyle]::Bold)
$fontSm = New-Object Drawing.Font('Segoe UI', 24, [Drawing.FontStyle]::Regular)
$cream = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(241, 234, 223))
$gold = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(217, 185, 143))
$rtl = New-Object Drawing.StringFormat([Drawing.StringFormatFlags]::DirectionRightToLeft)
$heName = [string]$site.brandHe
$sz = $g.MeasureString($heName, $fontBig, 2000, $rtl)
$g.DrawString($heName, $fontBig, $cream, (New-Object Drawing.RectangleF(186, 334, ($sz.Width + 6), ($sz.Height + 6))), $rtl)
$g.DrawString((([string]$site.brand).ToUpper() + '   ' + [char]0xB7 + '   WALL CLADDING'), $fontMid, $gold, 192, 462)
$g.DrawString(('Wall panels  ' + [char]0xB7 + '  Rev' + [char]0xEA + 'tements muraux  ' + [char]0xB7 + '  Netanya  ' + [char]0xB7 + '  ' + [string]$site.phoneDisplay), $fontSm, $cream, 80, 550)
$g.Dispose()
$enc = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]84)
$bmp.Save((Join-Path $img 'og.jpg'), $enc, $ep); $bmp.Dispose()
'OK og.jpg'
