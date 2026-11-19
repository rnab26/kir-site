# Physical model of a product for the "full plate" render (shared by process-images.ps1 and render-packs.ps1).
# synth: slats = one synthesised column per slat (the photo is exactly one slat wide)
#        cols  = striped panel (acoustic slats on felt): gap-to-gap columns synthesised along the length
#        2d    = free texture synthesis (marble, stone, concrete, plaster, wood panels)
#        tile  = legacy tiling (geometric patterns: 3D panels, bricks, blocks)
# sample: real width in cm covered by the sample photo (panels: assumed 40 cm, the user's samples are close-ups).
# Keep this file ASCII-only.
$PlateGeo = [string][char]0x05DC + [char]0x05D1 + [char]0x05E0 + [char]0x05D9 + [char]0x05DD + '|' + [char]0x05D1 + [char]0x05DC + [char]0x05D5 + [char]0x05E7 + [char]0x05D9 + [char]0x05DD   # bricks | blocks
$PlateWood = [string][char]0x05E2 + [char]0x05E5   # wood (grain has a direction: no 180-degree turns)
# Number of flutes from the reference: "20025" / "160-15" = width in mm + flute radius in mm (035 20025 = 4 flutes of 5 cm,
# checked against the photos showing a whole slat: 16015 -> 5, 17020 -> 4). 0 = unknown (the photo decides).
function SlatFlutes($p, $w) {
  if ([string]$p.sku -match '(\d{3})[-.]?(\d{2})\s*$') {
    $mm = [double]$matches[1]; $r = [double]$matches[2]
    if ($r -ge 5 -and [Math]::Abs($mm - $w * 10) -le $w * 1.5) { return [int][Math]::Round($mm / (2 * $r)) }
  }
  return 0
}
function PlateModel($p) {
  $w = $null; $l = $null
  if ($p.s -match '^(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)$') { $w = [double]$matches[1]; $l = [double]$matches[2] * 100; if ($l -gt 1000) { $l = $l / 100 } }
  elseif ($p.s -match '^(\d+(?:\.\d+)?)$') { $w = [double]$matches[1] }
  $c = [string]$p.c
  if ($c -eq 'outdoor' -and $w -and $w -ge 40) { $c = 'panel' }
  switch ($c) {
    # slats are sold one by one: show two loose slats at true proportions (never a big plate)
    'slat'    { if (-not $w) { $w = 20 }; if (-not $l) { $l = 290 }; return @{ kind = 'slats'; w = $w; h = $l; furniture = $true; flutes = (SlatFlutes $p $w) } }
    'outdoor' { if (-not $w) { $w = 15 }; if (-not $l) { $l = 290 }; return @{ kind = 'slats'; w = $w; h = $l; furniture = $false; flutes = 0 } }
    'flex'    { if (-not $w) { $w = 120 }; if (-not $l) { $l = 290 }; return @{ kind = 'plate'; w = $w; h = $l; tile = $w / 3; tileH = $l; slats = 1; mirror = $false; synth = 'cols'; sample = 40 } }
    'panel'   { if (-not $w) { $w = 122 }; if (-not $l) { $l = 280 }; return @{ kind = 'plate'; w = $w; h = $l; tile = $w; tileH = 0; slats = 1; mirror = $false; synth = $(if ($p.he -match $PlateWood) { '2dn' } else { '2d' }); sample = 80 } }
    'stone'   { if (-not $w) { $w = 60 }; if (-not $l) { $l = 120 }; $s = if ($p.he -match $PlateGeo) { 'tile' } else { '2d' }; return @{ kind = 'plate'; w = $w; h = $l; tile = $w; tileH = 0; slats = 1; mirror = $false; synth = $s; sample = 110 } }
    'deco'    { if (-not $w) { $w = 80 }; if (-not $l) { $l = 50 }; return @{ kind = 'plate'; w = $w; h = $l; tile = $w; tileH = 0; slats = 1; mirror = $false; synth = 'tile'; sample = $w } }
    default   { return @{ kind = 'photo'; w = 1; h = 1; tile = 1; tileH = 0; slats = 1; mirror = $false; synth = 'tile'; sample = 1 } }
  }
}
# Renders and saves the product images for one product from its processed photo:
#   slats  -> pack/<id>.jpg (two loose slats at true proportions), thumb from it,
#             face/<id>.jpg (one straight slat, exact width x full length, ~6 px/cm) for the 3D studio
#   plate  -> pack/<id>.jpg (whole plate at true scale), thumb from the plate,
#             face/<id>.jpg (flat plate face, long side 1300 px, ~4.6 px/cm) for the 3D studio
# $outDir: review folder (files named <id>-pack.jpg / <id>-face.jpg) instead of the site folders.
# $face: also write face/<id>.jpg; $faceOnly: write only face/<id>.jpg (pack/ and thumb/ untouched).
function SavePlateImages($tex, $p, [string]$imgDir, [string]$outDir = '', [bool]$face = $true, [bool]$faceOnly = $false) {
  $m = PlateModel $p; $id = $p.img; $gloss = ($p.f -eq 'g'); $seed = PlateSeed $id
  $packPath = if ($outDir) { Join-Path $outDir "$id-pack.jpg" } else { Join-Path $imgDir "pack/$id.jpg" }
  $facePath = if ($outDir) { Join-Path $outDir "$id-face.jpg" } else { New-Item -ItemType Directory -Force (Join-Path $imgDir 'face') | Out-Null; Join-Path $imgDir "face/$id.jpg" }
  if ($m.kind -eq 'slats') {
    $stretch = if ($p.he -match $PlateWood) { 3.6 } else { 1.4 }
    if ($face -or $faceOnly) { [Kit]::SlatFaceTexture($tex, $m.w, $m.h, 6.0, $seed, $stretch, $m.flutes).SaveJpg($facePath, 88) }
    if ($faceOnly) { return $true }
    $pack = [Kit]::RenderSlats($tex, $m.w, $m.h, $gloss, $seed, $stretch, $m.flutes)
    $pack.SaveJpg($packPath, 88)
    if (-not $outDir) { $pack.Resize(520, 650).SaveJpg((Join-Path $imgDir "thumb/$id.jpg"), 84) }
  } elseif ($m.kind -eq 'photo') {
    # product shots (mirrors, moldings...): framed photo, no face texture
    if ($faceOnly) { return $false }
    $pack = [Kit]::RenderPack($tex, 'photo', 1, 1, 1, 0, 1, $false, $gloss)
    $pack.SaveJpg($packPath, 88)
    if (-not $outDir) { $pack.Resize(520, 650).SaveJpg((Join-Path $imgDir "thumb/$id.jpg"), 84) }
  } else {
    $f = [Kit]::PlateFace($tex, $m.w, $m.h, $m.tile, $m.tileH, $m.slats, $m.mirror, $m.synth, $m.sample, $seed)
    if ($face -or $faceOnly) { $f.SaveJpg($facePath, 88) }
    if ($faceOnly) { return $true }
    $pack = [Kit]::RenderPack($tex, $m.kind, $m.w, $m.h, $m.tile, $m.tileH, $m.slats, $m.mirror, $gloss, $m.synth, $m.sample, $seed, $f)
    $pack.SaveJpg($packPath, 88)
    if (-not $outDir) { $pack.Resize(520, 650).SaveJpg((Join-Path $imgDir "thumb/$id.jpg"), 84) }
  }
  return $true
}
function PlateSeed([string]$id) { $h = 17; foreach ($ch in $id.ToCharArray()) { $h = ($h * 31 + [int]$ch) % 2147483629 }; [int]$h }
