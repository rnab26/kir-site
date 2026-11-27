# Wall studio ("experience"): live 3D slat + products laid on a real room photo.
# Dot-sourced by build.ps1 after its helpers. Template: templates/experience.html, strings: data/content-exp.json,
# assets: src/assets/exp/ (room photo, wall mask, clean wall light, 3D albedos, stills), script: src/assets/js/experience.js.
# Keep this file ASCII-only.
$ExpTxt = Read-Json 'data/content-exp.json'
if (-not $FaceDims) { $FaceDims = Read-Json 'data/face-dims.json' }   # true-scale faces (wcm x hcm) made by scripts/render-packs.ps1
$ExpTpl = [IO.File]::ReadAllText((Join-Path $Root 'templates/experience.html'), [Text.Encoding]::UTF8)
$ExpStory = '167taG-eCAzs7iVtevdNEv8-igUc9lnU4'   # slat 035 20025, light oak: the slat of the 3D story
# the four slats with the same 20025 profile (their 3D look): id, swatch colour, label key, albedo file ('' = plain colour)
$ExpQuick = @(
  @('167taG-eCAzs7iVtevdNEv8-igUc9lnU4', '#cfb38b', 'q035', 'albedo-035-hd.jpg'),
  @('1epSj9dgoV8vVvdXR-KXYniyzgUE0Cl_n', '#8b5d3d', 'q108', 'albedo-108.jpg'),
  @('1njVWGQBUTAHAKbMFNgzGSbCVi2D33Kh6', '#2b2a27', 'q027', 'albedo-027.jpg'),
  @('1ap4OJMSWn5NE-S8yQKpcQ_etHyNk7KC3', '#e7e3db', 'q153', '')
)
$ExpPlain = @{ '1ap4OJMSWn5NE-S8yQKpcQ_etHyNk7KC3' = '#e4e0d8' }
$ExpCats = @('slat', 'panel', 'flex', 'stone', 'deco')
# data/experience.json: the model laid in the room at load (by its reference, e.g. "035 20025" or just "108"),
# the room of the scroll story and the rooms offered in the editor (real rooms in src/assets/exp/rooms/<id>/)
$ExpCfg = Read-Json 'data/experience.json'
$ExpRooms = @($ExpCfg.rooms | Where-Object { Test-Path (Join-Path $Root ('src/assets/exp/rooms/' + $_ + '/room.json')) })
$ExpRoom = [string]$ExpCfg.storyRoom
if (-not ($ExpRooms -contains $ExpRoom)) { throw "data/experience.json: storyRoom '$ExpRoom' has no prepared room in src/assets/exp/rooms" }

function ExpX($L) { P $ExpTxt $L.lang }
function ExpHasFace($it) { ($it.c -in $ExpCats) -and (P $FaceDims $it.img) -and (HasImg 'face' $it.img) }
function ExpByRef([string]$ref) {   # exact reference first, then "108" -> "108 20025", then any reference containing it
  $ref = $ref.Trim(); if (-not $ref) { return $null }
  $c = @($Items | Where-Object { ExpHasFace $_ })
  foreach ($t in @({ param($r) $r -eq $ref }, { param($r) $r.StartsWith($ref + ' ') }, { param($r) $r.Contains($ref) })) {
    $hit = $c | Where-Object { & $t ([string]$_.ref) } | Select-Object -First 1
    if ($hit) { return $hit }
  }
  $null
}
$ExpStart = ExpByRef ([string]$ExpCfg.storyModel)
if (-not $ExpStart) { Write-Warning "data/experience.json: storyModel '$($ExpCfg.storyModel)' not found, using 035"; $ExpStart = $ById[$ExpStory] }
if ($ExpQuick | Where-Object { $_[0] -eq $ExpStart.img }) { $ExpStory = $ExpStart.img }   # one of the four 3D slats: the 3D story shows it too
function ExpHref($L, [string]$img) { (Href $L 'experience/') + $(if ($img) { '?m=' + $img + '#room' } else { '' }) }
function ExpItems($L) {
  $seen = @{}; $out = New-Object System.Collections.ArrayList
  foreach ($c in $ExpCats) {
    foreach ($it in @($Items | Where-Object { $_.c -eq $c })) {
      if ($seen.ContainsKey($it.img) -or -not (ExpHasFace $it)) { continue }
      $seen[$it.img] = 1
      $fd = P $FaceDims $it.img; $fm = $FamOf[$it.slug]
      $u = (Href $L ('p/' + $fm.slug + '/')) + $(if ($fm.n -gt 1) { '?v=' + $it.slug } else { '' })
      [void]$out.Add([ordered]@{ id = $it.img; n = (NameOf $L $it); r = [string]$it.ref; p = $it.p; w = [double]$fd.wcm; h = [double]$fd.hcm; k = [string]$fd.kind; c = $c; u = $u; th = (ImgUrl $it.img) })
    }
  }
  , $out
}

function ExperiencePage($L) {
  $x = ExpX $L; $path = [string]$x.path
  $items = ExpItems $L
  $story = $ById[$ExpStory]
  $title = [string]$x.title + ' | ' + (BrandOf $L)
  $og = $Base + '/assets/exp/after-035.jpg'
  $head = '<title>' + (Enc $title) + '</title><meta name="description" content="' + (Enc $x.desc) + '"><meta name="robots" content="index,follow,max-image-preview:large">'
  $head += '<link rel="canonical" href="' + (Abs $L $path) + '">'
  foreach ($lg in $Langs) { $head += '<link rel="alternate" hreflang="' + $lg + '" href="' + (Abs (Lc $lg) $path) + '">' }
  $head += '<link rel="alternate" hreflang="x-default" href="' + (Abs (Lc 'he') $path) + '">'
  $head += '<meta property="og:type" content="website"><meta property="og:site_name" content="' + (Enc (BrandOf $L)) + '"><meta property="og:title" content="' + (Enc $title) + '"><meta property="og:description" content="' + (Enc $x.desc) + '"><meta property="og:url" content="' + (Abs $L $path) + '"><meta property="og:image" content="' + $og + '"><meta property="og:locale" content="' + $L.locale + '">'
  $head += '<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#100e0b"><link rel="icon" href="' + $BasePath + '/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="' + (AssetUrl 'img/logo.png') + '">'
  $t = [ordered]@{}
  foreach ($k in @('soundOn', 'soundOff', 'units', 'unitsSlat', 'priceSlat', 'priceUnit', 'onRequest', 'msg', 'error', 'c290', 'c20', 'c4', 'cHollow', 'cRound', 'allModels')) { $t[$k] = [string](P $x $k) }
  foreach ($pp in $x.PSObject.Properties) { if ($pp.Name -match '^(ed|wall)[A-Z]') { $t[$pp.Name] = [string]$pp.Value } }   # wall-by-wall editor strings
  $quick = @(); $alb = [ordered]@{}
  foreach ($q in $ExpQuick) { $quick += [ordered]@{ id = $q[0]; c = $q[1]; n = [string](P $x $q[2]) }; $alb[$q[0]] = $(if ($q[3]) { $q[3] } else { $null }) }
  $cats = @(); foreach ($c in $ExpCats) { if (@($items | Where-Object { $_.c -eq $c }).Count) { $cats += [ordered]@{ c = $c; n = [string](P (CatOf $L $c) 'name') } } }
  $rooms = $ExpRooms
  # features shown on the public site (data/experience.json > features); the others only in demo mode (?demo=1).
  # Demo floors: same shape as a future Sheet floor product (plank width/length in cm, texture covering tw x th cm)
  $feat = [ordered]@{}; if ($ExpCfg.features) { foreach ($pp in $ExpCfg.features.PSObject.Properties) { $feat[$pp.Name] = [bool]$pp.Value } }
  $floors = @(); foreach ($f in @($ExpCfg.floors)) { if ($f) { $floors += [ordered]@{ id = [string]$f.id; n = [string](P $f.n $L.lang); r = [string]$f.r; c = [string]$f.c; pw = [double]$f.pw; pl = [double]$f.pl; stag = [double]$f.stag; tex = [string]$f.tex; tw = [double]$f.tw; th = [double]$f.th; p = $f.p } } }
  $dz = $ExpCfg.design; $theme = $(if ($dz -and $dz.theme) { [string]$dz.theme } else { 'dark' }); $anim = $(if ($dz -and $dz.anim) { [string]$dz.anim } else { 'lift' }); $speed = $(if ($dz -and $dz.speed) { [double]$dz.speed } else { 1 })
  $cfg = [ordered]@{ design = [ordered]@{ theme = $theme; anim = $anim; speed = $speed }; waste = $(if ($null -ne $ExpCfg.waste) { [double]$ExpCfg.waste } else { 5 }); detectOpt = $ExpCfg.detect; rooms = $rooms; features = $feat; floors = $floors; storyRoom = $ExpRoom; start = $ExpStart.img; detect = (AssetUrl ('js/experience-detect.js?v=' + $Ver)); lang = $L.lang; rtl = ($L.dir -eq 'rtl'); assets = (AssetUrl 'exp/'); img = (AssetUrl 'img/'); wa = $Wa; story = $ExpStory; quick = $quick; alb = $alb; plain = $ExpPlain; cats = $cats; items = $items; t = $t }
  $html = $ExpTpl
  $vars = @{ waze = (WazeUrl); theme = $theme; speed = ([string]$speed).Replace(',', '.'); roomPhoto = (AssetUrl ('exp/rooms/' + $ExpRoom + '/photo.jpg')); lang = $L.lang; dir = $L.dir; head = $head; assets = (AssetUrl 'exp/'); home = (Href $L ''); brand = (Enc (BrandOf $L)); logoMark = $LogoMark; waNum = $Wa; phone = (Enc ([string]$Site.phoneDisplay)); js = (AssetUrl ('js/experience.js?v=' + $Ver)); p035 = $(if ($story -and $null -ne $story.p) { [string]$story.p } else { '44' }); config = ((To-Json $cfg) -replace '</', '<\/') }
  foreach ($k in $vars.Keys) { $html = $html.Replace('{{' + $k + '}}', [string]$vars[$k]) }
  foreach ($pp in $x.PSObject.Properties) { $html = $html.Replace('{{' + $pp.Name + '}}', [string]$pp.Value) }
  Write-Out ((Rel $L $path) + 'index.html') $html
}

# Teaser shown where the old 2D studio was: before/after on the real room photo + link to the wall studio.
function ExpTeaser($L, $first, [string]$tag = 'h2') {
  $x = ExpX $L
  $img = if ($first -and (ExpHasFace $first)) { $first.img } else { '' }
  '<section class="exp-teaser" id="studio"><div class="wrap exp-grid">' +
  '<div class="exp-copy reveal"><p class="kicker">' + (Enc $x.teaserKicker) + '</p><' + $tag + '>' + (Enc $x.teaserTitle) + '</' + $tag + '><p class="lead">' + (Enc $x.teaserLead) + '</p>' +
  '<p class="exp-actions"><a class="btn btn-dark" href="' + (ExpHref $L $img) + '">' + (Enc $x.teaserBtn) + $Icons.arrow + '</a> <a class="btn btn-ghost-dark" href="' + (Href $L 'experience/') + '#photo">' + (Enc $x.edTry) + '</a></p></div>' +
  '<figure class="ba reveal" dir="ltr" data-ba style="--p:55%"><img src="' + (AssetUrl 'exp/before.jpg') + '" alt="" width="1600" height="889" loading="lazy">' +
  '<img class="ba-after" src="' + (AssetUrl 'exp/after-035.jpg') + '" alt="' + (Enc $x.teaserTitle) + '" width="1600" height="889" loading="lazy">' +
  '<span class="ba-line" aria-hidden="true"></span><span class="ba-tag ba-b">' + (Enc $x.teaserBefore) + '</span><span class="ba-tag ba-a">' + (Enc $x.teaserAfter) + '</span>' +
  '<input type="range" min="0" max="100" value="55" aria-label="' + (Enc ($x.teaserBefore + ' / ' + $x.teaserAfter)) + '" data-ba-range></figure>' +
  '</div></section>'
}
