# Contact sheet of rendered plates for visual review: contact-sheet.ps1 -Dir <folder with *-pack.jpg> -Out <file.jpg> [-Cats slat,panel]
param([string]$Dir, [string]$Out, [string[]]$Cats = @(), [int]$Cols = 8)
$ErrorActionPreference = 'Stop'
$Cats = @($Cats | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$Prods = @(Get-Content -Raw -Encoding UTF8 (Join-Path $root 'data/products.json') | ConvertFrom-Json | ForEach-Object { $_ })
$files = @(); foreach ($p in $Prods) { if ($Cats.Count -and $Cats -notcontains $p.c) { continue }; $f = Join-Path $Dir ($p.img + '-pack.jpg'); if (Test-Path $f) { $files += $f } }
$tw = 200; $th = 250; $rows = [Math]::Ceiling($files.Count / $Cols)
$bmp = New-Object Drawing.Bitmap ($tw * $Cols), ($th * $rows); $g = [Drawing.Graphics]::FromImage($bmp); $g.Clear([Drawing.Color]::White); $g.InterpolationMode = 'HighQualityBicubic'
for ($i = 0; $i -lt $files.Count; $i++) { $im = [Drawing.Image]::FromFile($files[$i]); $g.DrawImage($im, ($i % $Cols) * $tw, [Math]::Floor($i / $Cols) * $th, $tw, $th); $im.Dispose() }
$g.Dispose(); $bmp.Save($Out, [Drawing.Imaging.ImageFormat]::Jpeg); $bmp.Dispose(); "$($files.Count) plates -> $Out"
