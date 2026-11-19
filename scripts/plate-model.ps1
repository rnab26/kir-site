# Physical model of a product for the "full plate" render (shared by process-images.ps1 and render-packs.ps1).
# synth: slats = one synthesised column per slat (the photo is exactly one slat wide)
#        cols  = striped panel (acoustic slats on felt): gap-to-gap columns synthesised along the length
#        2d    = free texture synthesis (marble, stone, concrete, plaster, wood panels)
#        tile  = legacy tiling (geometric patterns: 3D panels, bricks, blocks)
# sample: real width in cm covered by the sample photo (panels: assumed 40 cm, the user's samples are close-ups).
# Keep this file ASCII-only.
$PlateGeo = [string][char]0x05DC + [char]0x05D1 + [char]0x05E0 + [char]0x05D9 + [char]0x05DD + '|' + [char]0x05D1 + [char]0x05DC + [char]0x05D5 + [char]0x05E7 + [char]0x05D9 + [char]0x05DD   # bricks | blocks
$PlateWood = [string][char]0x05E2 + [char]0x05E5   # wood (grain has a direction: no 180-degree turns)
function PlateModel($p) {
  $w = $null; $l = $null
  if ($p.s -match '^(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)$') { $w = [double]$matches[1]; $l = [double]$matches[2] * 100; if ($l -gt 1000) { $l = $l / 100 } }
  $c = [string]$p.c
  if ($c -eq 'outdoor' -and $w -and $w -ge 40) { $c = 'panel' }
  switch ($c) {
    'slat'    { if (-not $w) { $w = 20 }; if (-not $l) { $l = 290 }; $n = [Math]::Max(3, [Math]::Min(7, [Math]::Round(100 / $w))); return @{ kind = 'plate'; w = $w * $n; h = $l; tile = $w; tileH = $l; slats = $n; mirror = $false; synth = 'slats'; sample = $w } }
    'outdoor' { if (-not $w) { $w = 15 }; if (-not $l) { $l = 290 }; return @{ kind = 'plate'; w = $w * 6; h = $l; tile = $w; tileH = $l; slats = 6; mirror = $false; synth = 'slats'; sample = $w } }
    'flex'    { if (-not $w) { $w = 120 }; if (-not $l) { $l = 290 }; return @{ kind = 'plate'; w = $w; h = $l; tile = $w / 3; tileH = $l; slats = 1; mirror = $false; synth = 'cols'; sample = 40 } }
    'panel'   { if (-not $w) { $w = 122 }; if (-not $l) { $l = 280 }; return @{ kind = 'plate'; w = $w; h = $l; tile = $w; tileH = 0; slats = 1; mirror = $false; synth = $(if ($p.he -match $PlateWood) { '2dn' } else { '2d' }); sample = 80 } }
    'stone'   { if (-not $w) { $w = 60 }; if (-not $l) { $l = 120 }; $s = if ($p.he -match $PlateGeo) { 'tile' } else { '2d' }; return @{ kind = 'plate'; w = $w; h = $l; tile = $w; tileH = 0; slats = 1; mirror = $false; synth = $s; sample = 110 } }
    'deco'    { if (-not $w) { $w = 80 }; if (-not $l) { $l = 50 }; return @{ kind = 'plate'; w = $w; h = $l; tile = $w; tileH = 0; slats = 1; mirror = $false; synth = 'tile'; sample = $w } }
    default   { return @{ kind = 'photo'; w = 1; h = 1; tile = 1; tileH = 0; slats = 1; mirror = $false; synth = 'tile'; sample = 1 } }
  }
}
function PlateSeed([string]$id) { $h = 17; foreach ($ch in $id.ToCharArray()) { $h = ($h * 31 + [int]$ch) % 2147483629 }; [int]$h }
