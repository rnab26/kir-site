#requires -Version 5.1
<#
  Static site generator for the KIR wall-covering catalog.
  Reads data/*.json, writes the full bilingual (he/fr) site into _site/.
  Usage:  powershell -ExecutionPolicy Bypass -File build.ps1 [-SiteUrl https://example.com]
  Works on Windows PowerShell 5.1 and PowerShell 7 (GitHub Actions). Keep this file ASCII-only:
  every human-readable text lives in data/content.json (UTF-8).
#>
param([string]$SiteUrl = $env:SITE_URL, [string]$OutDir = '')
$ErrorActionPreference = 'Stop'
$Inv = [Globalization.CultureInfo]::InvariantCulture
[Threading.Thread]::CurrentThread.CurrentCulture = $Inv
$Root = $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $Root '_site' }
$Utf8 = New-Object Text.UTF8Encoding($false)
$SHEKEL = [string][char]0x20AA
$TIMES = [string][char]0x00D7

function Read-Json([string]$rel) { Get-Content -Raw -Encoding UTF8 -Path (Join-Path $Root $rel) | ConvertFrom-Json }
# Logo HI (I = map of Israel) and the yod of the Hebrew name drawn as the map: templates/logo-*.svg, made by
# Hipouy/logo/hi-carte/exports_web.py. Ink follows currentColor, gold comes from the CSS variable --logo-gold.
function Read-Svg([string]$rel, [string]$cls) { ((Get-Content -Raw -Encoding UTF8 -Path (Join-Path $Root $rel)).Trim() -replace ' xmlns="http://www.w3.org/2000/svg"', '') -replace '^<svg ', ('<svg class="' + $cls + '" aria-hidden="true" focusable="false" ') }
$LogoMark = Read-Svg 'templates/logo-mark.svg' 'logo-mark'
$LogoYod = Read-Svg 'templates/logo-yod.svg' 'logo-yod'
$IsraelHe = [string][char]0x05D9 + [char]0x05E9 + [char]0x05E8 + [char]0x05D0 + [char]0x05DC
function Enc([object]$s) { if ($null -eq $s) { return '' }; [System.Net.WebUtility]::HtmlEncode([string]$s) }
function P($obj, [string]$name) { if ($null -eq $obj) { return $null }; $x = $obj.PSObject.Properties[$name]; if ($x) { $x.Value } else { $null } }
function Write-Out([string]$rel, [string]$text) {
  if ($rel.Length -gt 180) { throw ("Bad output path: " + $rel.Substring(0, 300)) }
  $f = Join-Path $OutDir $rel; $d = Split-Path -Parent $f
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
  [IO.File]::WriteAllText($f, $text, $Utf8)
}
function Fill([string]$tpl, [hashtable]$vars) { foreach ($k in $vars.Keys) { $tpl = $tpl.Replace('{' + $k + '}', [string]$vars[$k]) }; $tpl }
function To-Json($o) { ((ConvertTo-Json -InputObject $o -Depth 12 -Compress) -replace '</', '<\/') }
function Num([double]$v) { $v.ToString('0.##', $Inv) }

# ---------- data ----------
$Site = Read-Json 'data/site.json'
$Content = Read-Json 'data/content.json'
$Content | Add-Member -NotePropertyName en -NotePropertyValue (Read-Json 'data/content-en.json') -Force
$Shop = Read-Json 'data/content-shop.json'
$HeEn = Read-Json 'data/he-en.json'
$Tax = Read-Json 'data/taxonomy.json'
$Raw = @(Read-Json 'data/products.json' | ForEach-Object { $_ })  # PS 5.1 emits JSON arrays as one object: unroll
$Dims = Read-Json 'data/images.json'
$TexDims = if (Test-Path (Join-Path $Root 'data/tex-dims.json')) { Read-Json 'data/tex-dims.json' } else { $null }
if ($SiteUrl) { $Site.baseUrl = $SiteUrl }
$Base = ([string]$Site.baseUrl).TrimEnd('/')
$BasePath = ([Uri]($Base + '/')).AbsolutePath.TrimEnd('/')
$Brand = [string]$Site.brand
$BrandFull = [string]$Site.brandFull
$Today = (Get-Date).ToString('yyyy-MM-dd')
$Ver = (Get-Date).ToString('yyyyMMddHHmm')
$Langs = @('he', 'en', 'fr')
$Wa = ([string]$Site.whatsapp) -replace '[^0-9]', ''

# ---------- English product names (rule-based from Hebrew, see data/he-en.json) ----------
$script:EnDict = @($HeEn.entries | ForEach-Object { , @([string]$_[0], [string]$_[1], [string]$_[2], @(([string]$_[0]) -split ' ')) } | Sort-Object { - $_[3].Count }, { - ([string]$_[0]).Length })
function EnSeg([string]$seg) {
  $w = @($seg.Trim() -split '\s+' | Where-Object { $_ })
  $A = @(); $N = @(); $Pp = @(); $i = 0
  while ($i -lt $w.Count) {
    $hit = $null
    foreach ($e in $script:EnDict) {
      $ew = $e[3]; $k = $ew.Count
      if ($i + $k -gt $w.Count) { continue }
      $ok = $true; for ($j = 0; $j -lt $k; $j++) { if ($w[$i + $j] -ne $ew[$j]) { $ok = $false; break } }
      if ($ok) { $hit = $e; break }
    }
    if ($hit) { if ($hit[1]) { if ($hit[2] -eq 'N') { $N += $hit[1] } elseif ($hit[2] -eq 'A') { $A += $hit[1] } else { $Pp += $hit[1] } }; $i += $hit[3].Count }
    elseif ($w[$i] -cmatch '^[A-Z][A-Za-z]*$') { $A += $w[$i]; $i++ }
    else { $Pp += $w[$i]; $i++ }
  }
  ((@($A) + @($N) + @($Pp)) -join ' ').Trim()
}
function EnName([string]$he) {
  $W = [string][char]0x05E2 + [char]0x05DD
  $parts = @(); foreach ($seg in ($he -split ',')) {
    $s = $seg.Trim(); if (-not $s) { continue }
    $ix = (' ' + $s + ' ').IndexOf(' ' + $W + ' ')
    if ($ix -ge 0) { $parts += ((EnSeg $s.Substring(0, $ix)) + ' with ' + (EnSeg $s.Substring($ix + $W.Length))).Trim() } else { $parts += (EnSeg $s) }
  }
  $r = ($parts -join ', ') -replace '\s{2,}', ' '
  $r = $r -replace '\b(grey|beige|brown|taupe|white|black|cream|bronze|red|greyish|blue-grey|grey-beige|beige-grey|white-grey|grey-taupe|sand-beige)\s+(very light|light|dark)\b', '$2 $1'
  $r = $r -replace '\b(brown|beige|grey)\s+(greyish|reddish|bluish)\b', '$2 $1'
  if ($r.Length) { $r.Substring(0, 1).ToUpper() + $r.Substring(1) } else { $r }
}
function Cap([string]$s) { if ($s.Length) { $s.Substring(0, 1).ToUpper() + $s.Substring(1) } else { $s } }

# ---------- products ----------
$seen = @{}
$PhotoColor = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)   # image ids are case-sensitive
$pcFile = Join-Path $Root 'data/colors.json'
if (Test-Path $pcFile) { foreach ($pair in (Read-Json 'data/colors.json').list) { if ($pair[0]) { $PhotoColor[[string]$pair[0]] = [string]$pair[1] } } }
$Items = New-Object System.Collections.ArrayList
$i = 0
foreach ($p in $Raw) {
  $i++
  if ($p.PSObject.Properties['hide'] -and $p.hide) { continue }
  $skuRaw = ([string]$p.sku).Trim()
  $ref = if ($skuRaw) { $skuRaw } else { 'KIR-' + $i.ToString('000') }
  $core = ($ref.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
  if (-not $core) { $core = 'ref-' + $i }
  $slug = (P $Tax.catPrefix $p.c) + '-' + $core
  if ($seen.ContainsKey($slug)) { $n = 2; while ($seen.ContainsKey("$slug-$n")) { $n++ }; $slug = "$slug-$n" }
  $seen[$slug] = $true
  $he = [string]$p.he
  $looks = @(); foreach ($k in $Tax.lookOrder) { if ($he -match (P $Tax.looks $k)) { $looks += $k } }
  # colour: read from the product photo (data/colors.json, scripts/detect-colors.ps1); the name only confirms white / black
  # (white products look grey in photos) and adds gold. No colour filter for mirrors and adhesives.
  $named = @(); foreach ($k in $Tax.colorOrder) { if ($he -match (P $Tax.colors $k)) { $named += $k } }
  $seen2 = ''; [void]$PhotoColor.TryGetValue([string]$p.img, [ref]$seen2)
  $colors = @()
  if ($p.c -notin @('mirror', 'adhesive')) {
    if ($seen2) {
      $c1 = $seen2
      if ($named -contains 'white' -and $c1 -in @('grey', 'beige', 'taupe')) { $c1 = 'white' }
      elseif ($named -contains 'black' -and $c1 -in @('grey', 'taupe', 'brown')) { $c1 = 'black' }
      $colors += $c1
    } else { $colors = @($named | Where-Object { $_ -ne 'gold' }) }
    if ($named -contains 'gold' -and $colors -notcontains 'gold') { $colors += 'gold' }
  }
  $mat = ''
  foreach ($m in @('SPC', 'PVC', 'WPC')) { if (($he + ' ' + $skuRaw) -match $m) { $mat = $m; break } }
  $w = $null; $l = $null; $s = [string]$p.s
  if ($s -match '^(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)$') { $w = [double]::Parse($matches[1], $Inv); $l = [double]::Parse($matches[2], $Inv) }
  elseif ($s -match '^\d+(?:\.\d+)?$') { $w = [double]::Parse($s, $Inv) }
  $ppm2 = $null
  if ($w -and $l -and $l -lt 10 -and $null -ne $p.p -and ($p.c -eq 'slat' -or $p.c -eq 'panel' -or $p.c -eq 'flex' -or $p.c -eq 'stone')) { $ppm2 = [math]::Round($p.p / ($w / 100 * $l)) }
  $d = P $Dims $p.img
  $fl = ($p.c -eq 'slat' -or $p.c -eq 'flex') -and ($he -match ([string][char]0x05DE + [char]0x05D7 + [char]0x05D5 + [char]0x05E8 + [char]0x05E5 + '|' + [char]0x05E1 + [char]0x05E8 + [char]0x05D2 + [char]0x05DC + [char]0x05D9 + [char]0x05DD))
  [void]$Items.Add([pscustomobject]@{
    idx = $i; slug = $slug; ref = $ref; hasSku = [bool]$skuRaw; c = [string]$p.c; he = $he; fr = [string]$p.fr; en = $(if ($p.PSObject.Properties['en'] -and $p.en) { [string]$p.en } else { EnName $he })
    s = $s; f = [string]$p.f; p = $p.p; oos = [bool]$p.oos; img = [string]$p.img
    iw = $(if ($d) { $d.w } else { 400 }); ih = $(if ($d) { $d.h } else { 500 })
    looks = $looks; colors = $colors; mat = $mat; w = $w; l = $l; ppm2 = $ppm2; fl = [bool]$fl
  })
}
$ById = @{}; $BySlug = @{}; foreach ($it in $Items) { $ById[$it.img] = $it; $BySlug[$it.slug] = $it }
$CatOrder = @($Tax.catOrder | Where-Object { $c = $_; @($Items | Where-Object { $_.c -eq $c }).Count -gt 0 })
# Sections (universes): groups of categories shown as the main navigation
$Sections = @(); $SecOf = @{}
foreach ($sx in $Tax.sections) {
  $cs = @($sx.cats | Where-Object { $CatOrder -contains $_ }); if (-not $cs.Count) { continue }
  $al = @(P $sx 'also' | Where-Object { $_ -and $CatOrder -contains [string]$_.cat })   # extra products from another category (matched on the Hebrew name)
  $so = [pscustomobject]@{ key = [string]$sx.key; cats = $cs; also = $al; slug = [string](P $sx 'slug'); cover = [string](P $sx 'cover'); txt = $sx }
  $Sections += $so; foreach ($c in $cs) { $SecOf[$c] = $so }
}
foreach ($c in $CatOrder) { if (-not $SecOf.ContainsKey($c)) { throw "Category '$c' belongs to no section (data/taxonomy.json > sections)" } }
$LookOrder = @($Tax.lookOrder)

# ---------- families: variants of one model (same color code / pattern) share one page ----------
function FamKey($it) {
  $ov = P $Tax.familyOverride $it.img
  if ($ov) { return [string]$ov }
  $sku = if ($it.hasSku) { [string]$it.ref } else { '' }
  if ($it.c -eq 'slat' -or $it.c -eq 'flex' -or $it.c -eq 'outdoor') { if ($sku) { return $it.c + ':' + ((($sku -split ' ')[0]) -replace '^(?i)no\.', '').ToUpperInvariant() } }
  elseif ($it.c -eq 'deco') { $parts = @($sku -split ' '); if ($parts.Count -gt 1) { return 'deco:' + $parts[1] } }
  elseif ($it.c -in @('cornice', 'column', 'ornament', 'deck')) { return $it.c + ':all' }
  elseif ($it.c -eq 'skirting') { return 'skirting:' + ($it.colors -join '-') }
  elseif ($it.c -eq 'molding') { if ($sku) { return 'molding:profile' } else { return 'molding:panel' } }
  elseif ($it.c -eq 'mirror') { return 'mirror:' + $it.he }
  return 'item:' + $it.slug
}
function BaseName([string]$s, [string]$rx) { $b = ($s -split ',')[0]; (($b -replace $rx, '') -replace '\s{2,}', ' ').Trim() }
$famMap = [ordered]@{}
foreach ($it in $Items) { $k = FamKey $it; $it | Add-Member -NotePropertyName fam -NotePropertyValue $k; if (-not $famMap.Contains($k)) { $famMap[$k] = New-Object System.Collections.ArrayList }; [void]$famMap[$k].Add($it) }
$DOT = [string][char]0x00B7
$Fams = New-Object System.Collections.ArrayList; $famSlugs = @{}; $FamBySlug = @{}; $FamOf = @{}
foreach ($k in $famMap.Keys) {
  $vs = @($famMap[$k]); $n = $vs.Count
  $rep = $vs | Where-Object { $null -ne $_.p -and -not $_.oos } | Select-Object -First 1; if (-not $rep) { $rep = $vs[0] }
  $code = ''; if ($k -match '^[a-z]+:(.+)$') { $code = $matches[1] }
  if ($n -eq 1) { $slug = $rep.slug; $he = $rep.he; $fr = $rep.fr; $en = $rep.en; $ref = $rep.ref }
  else {
    $nm = P $Tax.familyNames $k
    if ($nm) { $he = [string]$nm.he; $fr = [string]$nm.fr; $en = [string]$nm.en }
    else {
      $ascii = ($code -and $code -notmatch '[^\x00-\x7F]')
      $he = (BaseName $rep.he $Tax.nameStrip.he) + $(if ($ascii) { ' ' + $DOT + ' ' + (P (P $Content 'he').ui 'series') + ' ' + $code } else { '' })
      $fr = (BaseName $rep.fr $Tax.nameStrip.fr) + $(if ($ascii) { ' ' + $DOT + ' ' + (P (P $Content 'fr').ui 'series') + ' ' + $code } else { '' })
      $en = (Cap (BaseName $rep.en $Tax.nameStrip.en)) + $(if ($ascii) { ' ' + $DOT + ' ' + (P (P $Content 'en').ui 'series') + ' ' + $code } else { '' })
    }
    $core = ($code.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-'); if (-not $core -or $core -eq 'all') { $core = 'collection' }
    $slug = (P $Tax.catPrefix $rep.c) + '-' + $core + '-series'
    $ref = if ($code -and $code -notmatch '[^\x00-\x7F]' -and $code -ne 'all') { $code } else { $rep.ref }
  }
  if ($famSlugs.ContainsKey($slug)) { $slug = $slug + '-' + $rep.idx }
  $famSlugs[$slug] = $true
  $looks = @(); foreach ($lk in $LookOrder) { foreach ($v in $vs) { if ($v.looks -contains $lk) { $looks += $lk; break } } }
  $colors = @(); foreach ($ck in $Tax.colorOrder) { foreach ($v in $vs) { if ($v.colors -contains $ck) { $colors += $ck; break } } }
  $prices = @($vs | Where-Object { $null -ne $_.p } | ForEach-Object { [double]$_.p })
  $pmin = if ($prices.Count) { ($prices | Measure-Object -Minimum).Minimum } else { $null }
  $fm = [pscustomobject]@{
    key = $k; slug = $slug; ref = $ref; hasSku = $rep.hasSku; c = $rep.c; he = $he; fr = $fr; en = $en; s = $(if ($n -eq 1) { $rep.s } else { '' })
    p = $pmin; oos = (@($vs | Where-Object { -not $_.oos }).Count -eq 0); img = $rep.img; idx = $vs[0].idx; looks = $looks; colors = $colors
    n = $n; vars = $vs; rep = $rep
  }
  [void]$Fams.Add($fm); $FamBySlug[$slug] = $fm
  foreach ($v in $vs) { $FamOf[$v.slug] = $fm }
}

# ---------- url helpers ----------
function Rel($L, [string]$path) { [string]$L.prefix + $path }
function Href($L, [string]$path) { $BasePath + '/' + (Rel $L $path) }
function Abs($L, [string]$path) { $Base + '/' + (Rel $L $path) }
function AssetUrl([string]$p) { $BasePath + '/assets/' + $p }
$script:ExistCache = @{}
function HasImg([string]$kind, [string]$id) { $k = "$kind/$id"; if (-not $script:ExistCache.ContainsKey($k)) { $script:ExistCache[$k] = Test-Path (Join-Path $Root "src/assets/img/$kind/$id.jpg") }; $script:ExistCache[$k] }
function ImgUrl([string]$id) { if (HasImg 'thumb' $id) { $BasePath + '/assets/img/thumb/' + $id + '.jpg' } else { $BasePath + '/assets/img/products/' + $id + '.jpg' } }
function PackUrl([string]$id) { if (HasImg 'pack' $id) { $BasePath + '/assets/img/pack/' + $id + '.jpg' } else { ImgUrl $id } }
function TexUrl([string]$id) { if (HasImg 'tex' $id) { $BasePath + '/assets/img/tex/' + $id + '.jpg' } else { $BasePath + '/assets/img/products/' + $id + '.jpg' } }
function ImgAbs([string]$id) { $Base + (PackUrl $id).Substring($BasePath.Length) }
function TexDim([string]$id) { $d = P $TexDims $id; if ($d) { @([int]$d.w, [int]$d.h) } else { @(400, 500) } }
$PlateCats = @('slat', 'panel', 'flex', 'deco', 'stone', 'outdoor')
function T($L, [string]$k) { $v = P $L.ui $k; if ($null -eq $v) { $v = P (P (P $Shop $L.lang) 'ui') $k }; [string]$v }
function Other([string]$lang) { if ($lang -eq 'he') { 'fr' } else { 'he' } }
function Lc([string]$lang) { P $Content $lang }
function CatOf($L, [string]$c) { P $L.categories $c }
function LookOf($L, [string]$k) { P $L.looks $k }
function SecTxt($L, $sec, [string]$k) { [string](P (P $sec.txt $L.lang) $k) }
function SecMulti($sec) { @($sec.cats).Count -gt 1 }
function SecPath($L, $sec) { if (SecMulti $sec) { 's/' + $sec.slug + '/' } else { 'c/' + (P (CatOf $L $sec.cats[0]) 'slug') + '/' } }
function SecAlso($sec, $fm) {
  foreach ($a in @($sec.also)) { $vs = if ($fm.vars) { @($fm.vars) } else { @($fm) }; if ($fm.c -eq $a.cat -and @($vs | Where-Object { [string]$_.he -match [string]$a.match }).Count) { return $a } }
  $null
}
function SecFams($sec) { @($Fams | Where-Object { ($sec.cats -contains $_.c) -or (SecAlso $sec $_) }) }
function SecKeys($fm) { $k = @($SecOf[$fm.c].key); foreach ($sec in $Sections) { if ($sec -ne $SecOf[$fm.c] -and (SecAlso $sec $fm)) { $k += $sec.key } }; $k -join ' ' }
function SecPills($L, $except) {
  $h = ''
  foreach ($sec in $Sections) { if ($sec -ne $except) { $h += '<a class="pill" href="' + (Href $L (SecPath $L $sec)) + '">' + (Enc (SecTxt $L $sec 'name')) + '</a>' } }
  $h
}
function NameOf($L, $it) { [string]$it.($L.lang) }

function SizeText($L, [string]$s) {
  if (-not $s) { return '' }
  $cm = T $L 'cm'; $m = T $L 'm'
  if ($s -match '^(\d+(?:\.\d+)?)/(\d+\.\d+)$') {
    $a = $matches[1]; $b = $matches[2]
    if ($L.lang -eq 'fr') { $a = $a.Replace('.', ','); $b = $b.Replace('.', ',') }
    return "$a $cm $TIMES $b $m"
  }
  if ($s -match '^\d+(?:\.\d+)?$') { $a = $s; if ($L.lang -eq 'fr') { $a = $a.Replace('.', ',') }; return "$a $cm" }
  if ($L.lang -eq 'fr') { return $s.Replace([string][char]0x05DE + [char]0x05F4 + [char]0x05DC, 'ml') }
  return $s
}
function PriceText($L, $it) { if ($null -ne $it.p) { "$($it.p) $SHEKEL" } else { T $L 'onRequest' } }
function PriceHtml($L, $it) {
  if ($null -ne $it.p) { '<span class="price"><bdi>' + $it.p + '&nbsp;&#8362;</bdi><small>' + (Enc (T $L 'priceVat')) + '</small></span>' }
  else { '<span class="price price-req">' + (Enc (T $L 'onRequest')) + '</span>' }
}
function FinishText($L, [string]$f) { if ($f -eq 'm') { T $L 'matte' } elseif ($f -eq 'g') { T $L 'gloss' } else { '' } }

$script:CardCache = @{}
function Card($L, $it, [string]$headTag = 'h3') {
  $ck = $L.lang + '|' + $it.slug + '|' + $headTag
  if ($script:CardCache.ContainsKey($ck)) { return $script:CardCache[$ck] }
  $script:CardCache[$ck] = CardBuild $L $it $headTag
  return $script:CardCache[$ck]
}
function CardBuild($L, $it, [string]$headTag) {
  $name = NameOf $L $it
  $url = Href $L ('p/' + $it.slug + '/')
  $multi = ($it.n -gt 1)
  $words = @($it.he, $it.fr, $it.ref, (P (CatOf $L $it.c) 'name'))
  if ($it.vars) { foreach ($v in $it.vars) { $words += $v.he; $words += $v.fr; $words += $v.ref } }
  $q = ($words -join ' ').ToLowerInvariant()
  $sz = SizeText $L $it.s
  $badge = if ($it.oos) { '<span class="badge">' + (Enc (T $L 'preorder')) + '</span>' } elseif ($multi) { '<span class="badge badge-light">' + $it.n + ' ' + (Enc (T $L 'models')) + '</span>' } else { '' }
  $pp = if ($null -ne $it.p) { [string]$it.p } else { '' }
  $meta = '<span class="sku">' + (Enc $it.ref) + '</span>'
  if ($multi) { $meta = ''; $ws = @(); foreach ($v in $it.vars) { if ($v.w -and $ws -notcontains $v.w) { $ws += $v.w } }; if ($ws.Count) { $meta += '<span>' + (($ws | Sort-Object | ForEach-Object { Num $_ }) -join ' / ') + ' ' + (Enc (T $L 'cm')) + '</span>' } }
  elseif ($sz) { $meta += '<span>' + (Enc $sz) + '</span>' }
  $price = PriceHtml $L $it
  if ($multi -and $null -ne $it.p) { $price = '<span class="price"><small class="from">' + (Enc (T $L 'from')) + '</small><bdi>' + (Num $it.p) + '&nbsp;&#8362;</bdi></span>' }
  $btn = if ($multi) { '<a class="add" href="' + $url + '" aria-label="' + (Enc ((T $L 'choose') + ': ' + $name)) + '">' + $Icons.arrow + '</a>' } else { '<button class="add" type="button" data-add="' + $it.slug + '" aria-label="' + (Enc ((T $L 'add') + ': ' + $name)) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>' }
  $imgs = if ($it.vars) { (@($it.vars | ForEach-Object { $_.img }) -join ' ') } else { $it.img }
  # per variant colour and slug, so a colour filter can show the matching variant on the card
  $vcs = if ($it.vars) { (@($it.vars | ForEach-Object { ($_.colors -join ',') }) -join '|') } else { ($it.colors -join ',') }
  $vsl = if ($it.vars) { (@($it.vars | ForEach-Object { $_.slug }) -join ' ') } else { '' }
  return '<article class="card" data-k="' + $(if ($it.n -gt 1) { $it.n } else { 1 }) + '" data-imgs="' + $imgs + '" data-s="' + (SecKeys $it) + '" data-c="' + $it.c + '" data-looks="' + ($it.looks -join ' ') + '" data-colors="' + ($it.colors -join ' ') + '" data-vc="' + $vcs + '" data-vs="' + $vsl + '" data-p="' + $pp + '" data-i="' + $it.idx + '" data-q="' + (Enc $q) + '">' +
    '<a class="card-media" href="' + $url + '" tabindex="-1" aria-hidden="true"><img src="' + (ImgUrl $it.img) + '" alt="" width="520" height="650" loading="lazy" decoding="async">' + $badge + '</a>' +
    '<div class="card-body"><' + $headTag + ' class="card-title"><a href="' + $url + '">' + (Enc $name) + '</a></' + $headTag + '>' +
    '<p class="card-meta">' + $meta + '</p>' +
    '<div class="card-foot">' + $price + $btn + '</div></div></article>'
}
function Grid($L, $list, [string]$headTag = 'h3') {
  $sb = New-Object Text.StringBuilder
  [void]$sb.Append('<div class="grid" data-grid>')
  foreach ($it in $list) { [void]$sb.Append((Card $L $it $headTag)) }
  [void]$sb.Append('</div>')
  $sb.ToString()
}

function CrumbLd($L, $list) {
  $arr = New-Object System.Collections.ArrayList; $pos = 1
  foreach ($c in $list) { [void]$arr.Add([ordered]@{ '@type' = 'ListItem'; position = $pos; name = [string]$c[0]; item = (Abs $L ([string]$c[1])) }); $pos++ }
  [ordered]@{ '@context' = 'https://schema.org'; '@type' = 'BreadcrumbList'; itemListElement = @($arr) }
}
function CrumbHtml($L, $list) {
  $sb = '<nav class="crumbs wrap" aria-label="' + (Enc (T $L 'breadcrumb')) + '"><ol>'
  $n = @($list).Count; $k = 0
  foreach ($c in $list) {
    $k++
    if ($k -lt $n) { $sb += '<li><a href="' + (Href $L ([string]$c[1])) + '">' + (Enc $c[0]) + '</a></li>' }
    else { $sb += '<li aria-current="page">' + (Enc $c[0]) + '</li>' }
  }
  $sb + '</ol></nav>'
}
function ItemListLd($L, $list) {
  $arr = New-Object System.Collections.ArrayList; $pos = 1
  foreach ($it in $list) { [void]$arr.Add([ordered]@{ '@type' = 'ListItem'; position = $pos; url = (Abs $L ('p/' + $it.slug + '/')); name = (NameOf $L $it) }); $pos++ }
  [ordered]@{ '@context' = 'https://schema.org'; '@type' = 'ItemList'; numberOfItems = @($list).Count; itemListElement = @($arr) }
}
function BrandOf($L) { $b = [string](P $Site.brandByLang $L.lang); if ($b) { $b } else { $Brand } }
function SiteBy([string]$key, $L) { [string](P (P $Site $key) $L.lang) }
function MapUrl { 'https://www.google.com/maps/search/?api=1&query=' + [Uri]::EscapeDataString([string]$Site.mapQuery) }
function WazeUrl { 'https://waze.com/ul?q=' + [Uri]::EscapeDataString([string]$Site.mapQuery) + '&navigate=yes' }
function MapEmbed { 'https://maps.google.com/maps?q=' + [Uri]::EscapeDataString([string]$Site.mapQuery) + '&z=16&output=embed' }
function WaLink([string]$text) { if (-not $Wa) { return '' }; 'https://wa.me/' + $Wa + $(if ($text) { '?text=' + [Uri]::EscapeDataString($text) } else { '' }) }
function OrgLd($L) {
  $o = [ordered]@{ '@context' = 'https://schema.org'; '@type' = 'HomeAndConstructionBusiness'; '@id' = ($Base + '/#org'); name = (BrandOf $L); alternateName = @([string]$Site.brandHe, [string]$Site.brand); url = ($Base + '/'); logo = ($Base + '/assets/img/logo.png'); image = ($Base + '/assets/img/og.jpg'); description = (Fill ([string]$L.metaDescHome) @{ brand = (BrandOf $L) }) }
  if ($Site.phone) { $o.telephone = [string]$Site.phone }
  $same = @(); foreach ($k in @('instagram', 'facebook')) { $v = [string](P $Site $k); if ($v) { $same += $v } }
  if ($Wa) { $same += ('https://wa.me/' + $Wa) }
  if ($same.Count) { $o.sameAs = $same }
  $o.contactPoint = [ordered]@{ '@type' = 'ContactPoint'; contactType = 'customer service'; telephone = [string]$Site.phone; availableLanguage = @('Hebrew', 'English', 'French') }
  if ($Site.address) {
    $o.address = [ordered]@{ '@type' = 'PostalAddress'; streetAddress = [string]$Site.address; addressLocality = [string]$Site.city; addressCountry = 'IL' }
    $o.hasMap = (MapUrl)
  }
  if ($Site.openingHoursSpec) {
    $spec = @(); foreach ($h in $Site.openingHoursSpec) { $spec += [ordered]@{ '@type' = 'OpeningHoursSpecification'; dayOfWeek = @($h.days); opens = [string]$h.opens; closes = [string]$h.closes } }
    $o.openingHoursSpecification = $spec
  }
  $o.currenciesAccepted = 'ILS'
  $o.areaServed = [ordered]@{ '@type' = 'Country'; name = 'Israel' }
  $o
}
function FaqLd($L) {
  $arr = New-Object System.Collections.ArrayList
  foreach ($f in $L.faq) { [void]$arr.Add([ordered]@{ '@type' = 'Question'; name = [string]$f[0]; acceptedAnswer = [ordered]@{ '@type' = 'Answer'; text = [string]$f[1] } }) }
  [ordered]@{ '@context' = 'https://schema.org'; '@type' = 'FAQPage'; mainEntity = @($arr) }
}

# ---------- shared blocks ----------
$Icons = @{
  list = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h15M6 12h15M6 17h15M2.5 7h.01M2.5 12h.01M2.5 17h.01"/></svg>'
  cart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>'
  wa = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.2-4.3A8.5 8.5 0 1 1 20.5 12Z"/><path d="M9 8.5c.3 2.6 2.4 5.2 5.5 6.3l1.3-1.3-2-1-1 .8c-1-.4-2-1.4-2.4-2.4l.8-1-1-2-1.2.6Z"/></svg>'
  arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  pin = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>'
  clock = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  phone = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3h2.8l1.4 4.2-2 1.4a12 12 0 0 0 6.6 6.6l1.4-2 4.2 1.4v2.8a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.2 2 2 0 0 1 6.6 3Z"/></svg>'
  a11y = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4.5" r="1.8"/><path d="M5 8.5l7 1.5 7-1.5M12 10v4.5M12 14.5 9 21M12 14.5l3 6.5"/></svg>'
  share = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>'
}
$LangLabel = @{ he = [string][char]0x05E2 + [char]0x05D1; en = 'EN'; fr = 'FR' }
$LangName = @{ he = [string][char]0x05E2 + [char]0x05D1 + [char]0x05E8 + [char]0x05D9 + [char]0x05EA; en = 'English'; fr = 'Fran' + [char]0x00E7 + 'ais' }

function BrandNameHtml($L) {
  $n = Enc (BrandOf $L); $i = $n.IndexOf($IsraelHe)
  if ($i -lt 0) { return $n }
  '<span>' + $n.Substring(0, $i).Trim() + '</span><span class="logo-isr">' + $LogoYod + $IsraelHe.Substring(1) + '</span>' + $n.Substring($i + $IsraelHe.Length)
}
function LogoHtml($L, [string]$cls = 'logo') {
  '<a class="' + $cls + '" href="' + (Href $L '') + '" aria-label="' + (Enc (BrandOf $L)) + '">' + $LogoMark + '<span class="logo-text"><span class="logo-name">' + (BrandNameHtml $L) + '</span><small>' + (Enc (SiteBy 'tagByLang' $L)) + '</small></span></a>'
}
function LangSwitch($L, [string]$path) {
  $s = '<div class="langs" role="group" aria-label="Language">'
  foreach ($lg in $Langs) {
    $X = Lc $lg
    $cur = if ($lg -eq $L.lang) { ' aria-current="true"' } else { '' }
    $s += '<a href="' + (Href $X $path) + '" hreflang="' + $lg + '" lang="' + $lg + '" title="' + (Enc $LangName[$lg]) + '"' + $cur + ' data-lang="' + $lg + '">' + (Enc $LangLabel[$lg]) + '</a>'
  }
  $s + '</div>'
}
function HeaderHtml($L, [string]$path) {
  $nav = ''
  foreach ($k in @(@('catalog', 'catalog/'), @('looks', 'looks/'), @('studio', 'experience/'), @('guide', 'guide/'), @('contact', 'contact/'))) {
    $cur = if ($path -eq $k[1]) { ' aria-current="page"' } else { '' }
    $a = '<a href="' + (Href $L $k[1]) + '"' + $cur + '>' + (Enc (P $L.nav $k[0])) + '</a>'
    if ($k[0] -eq 'catalog') {
      $drop = ''
      foreach ($sec in $Sections) { $sp = SecPath $L $sec; $dc = if ($path -eq $sp) { ' aria-current="page"' } else { '' }; $drop += '<a href="' + (Href $L $sp) + '"' + $dc + '>' + (Enc (SecTxt $L $sec 'name')) + '</a>' }
      $drop += '<a class="drop-all" href="' + (Href $L 'catalog/') + '">' + (Enc (T $L 'allProducts')) + '</a>'
      $a = '<div class="nav-item has-drop">' + $a + '<button type="button" class="drop-btn" aria-expanded="false" aria-label="' + (Enc (T $L 'catalogMenu')) + '" data-drop><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div class="drop">' + $drop + '</div></div>'
    }
    $nav += $a
  }
  '<header class="site-header" data-header><div class="wrap header-inner">' + (LogoHtml $L) +
  '<nav class="nav" id="site-nav" aria-label="' + (Enc (T $L 'menu')) + '">' + $nav + '</nav>' +
  '<div class="header-actions">' + (LangSwitch $L $path) +
  '<a class="list-btn" href="' + (Href $L 'cart/') + '" aria-label="' + (Enc (T $L 'cart')) + '">' + $Icons.cart + '<span class="count" data-count hidden>0</span></a>' +
  '<button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav" data-menu><span class="sr">' + (Enc (T $L 'menu')) + '</span><i></i><i></i></button></div>' +
  '</div></header>'
}

$script:FooterCache = @{}
function FooterHtml($L, [string]$path) {
  if (-not $script:FooterCache.ContainsKey($L.lang)) { $script:FooterCache[$L.lang] = FooterBuild $L '@@ALT@@' }
  $h = $script:FooterCache[$L.lang]
  foreach ($lg in $Langs) { $h = $h.Replace((Href (Lc $lg) '@@ALT@@'), (Href (Lc $lg) $path)) }
  $h
}
function FooterBuild($L, [string]$path) {
  $cats = ''; foreach ($sec in $Sections) { $cats += '<li><a href="' + (Href $L (SecPath $L $sec)) + '">' + (Enc (SecTxt $L $sec 'name')) + '</a></li>' }
  $cats += '<li><a href="' + (Href $L 'catalog/') + '">' + (Enc (T $L 'allProducts')) + '</a></li>'
  $looks = ''; foreach ($k in $LookOrder) { $looks += '<li><a href="' + (Href $L ('look/' + (P (LookOf $L $k) 'slug') + '/')) + '">' + (Enc (P (LookOf $L $k) 'name')) + '</a></li>' }
  $contact = ''
  if ($Wa) { $contact += '<li><a href="' + (WaLink (T $L 'waHello')) + '" rel="noopener" target="_blank">' + $Icons.wa + 'WhatsApp</a></li>' }
  if ($Site.phone) { $contact += '<li><a href="tel:' + (Enc $Site.phone) + '">' + $Icons.phone + '<bdi>' + (Enc $Site.phoneDisplay) + '</bdi></a></li>' }
  if ($Site.address) { $contact += '<li><a href="' + (MapUrl) + '" rel="noopener" target="_blank">' + $Icons.pin + (Enc (SiteBy 'addressByLang' $L)) + '</a></li>' }
  if ($Site.hoursByLang) { $contact += '<li class="hours">' + $Icons.clock + (Enc (SiteBy 'hoursByLang' $L)) + '</li>' }
  if ($Site.email) { $contact += '<li><a href="mailto:' + (Enc $Site.email) + '">' + (Enc $Site.email) + '</a></li>' }
  if ($Site.instagram) { $contact += '<li><a href="' + (Enc $Site.instagram) + '" rel="noopener">Instagram</a></li>' }
  if ($Site.facebook) { $contact += '<li><a href="' + (Enc $Site.facebook) + '" rel="noopener">Facebook</a></li>' }
  $legal = ''
  foreach ($k in @('terms', 'privacy', 'shipping', 'accessibility')) { $legal += '<li><a href="' + (Href $L ($k + '/')) + '">' + (Enc (T $L $k)) + '</a></li>' }
  $legal += '<li><a href="' + (Href $L 'orders/') + '">' + (Enc (T $L 'orders')) + '</a></li>'
  '<footer class="site-footer"><div class="footer-flutes" aria-hidden="true"></div><div class="wrap footer-grid">' +
  '<div class="footer-brand">' + (LogoHtml $L 'logo logo-light') + '<p>' + (Enc $L.footer) + '</p>' + (LangSwitch $L $path) + '</div>' +
  '<div><h2>' + (Enc (P $L.nav 'catalog')) + '</h2><ul>' + $cats + '</ul></div>' +
  '<div><h2>' + (Enc (P $L.nav 'looks')) + '</h2><ul>' + $looks + '</ul><h2>' + (Enc (T $L 'legal')) + '</h2><ul>' + $legal + '</ul></div>' +
  '<div><h2>' + (Enc (P $L.nav 'contact')) + '</h2><ul class="contact-list">' + $contact + '</ul></div>' +
  '</div><div class="wrap footer-bottom"><span>&copy; ' + (Get-Date).Year + ' ' + (Enc (BrandOf $L)) + '</span><span>' + (Enc (T $L 'priceNote')) + '</span></div></footer>'
}

function Widgets($L) {
  $wa = if ($Wa) { '<a class="wa-float" href="' + (WaLink (T $L 'waHello')) + '" target="_blank" rel="noopener" data-wa-float aria-label="' + (Enc (T $L 'chatWa')) + '">' + $Icons.wa + '<span>' + (Enc (T $L 'chatWa')) + '</span></a>' } else { '' }
  $a11y = '<button type="button" class="a11y-btn" data-a11y-toggle aria-expanded="false" aria-controls="a11y-panel" aria-label="' + (Enc (T $L 'a11y')) + '">' + $Icons.a11y + '</button>' +
    '<div class="a11y-panel" id="a11y-panel" role="dialog" aria-label="' + (Enc (T $L 'a11y')) + '" hidden><p class="a11y-title">' + (Enc (T $L 'a11y')) + '</p>' +
    '<button type="button" data-a11y="bigger">A+ ' + (Enc (T $L 'a11yBigger')) + '</button><button type="button" data-a11y="smaller">A- ' + (Enc (T $L 'a11ySmaller')) + '</button>' +
    '<button type="button" data-a11y="contrast" aria-pressed="false">' + (Enc (T $L 'a11yContrast')) + '</button><button type="button" data-a11y="links" aria-pressed="false">' + (Enc (T $L 'a11yLinks')) + '</button>' +
    '<button type="button" data-a11y="motion" aria-pressed="false">' + (Enc (T $L 'a11yMotion')) + '</button><button type="button" data-a11y="reset">' + (Enc (T $L 'a11yReset')) + '</button>' +
    '<a href="' + (Href $L 'accessibility/') + '">' + (Enc (T $L 'a11yStatement')) + '</a></div>'
  $wa + $a11y
}

function Page($L, [hashtable]$pg) {
  $path = [string]$pg.path
  $title = [string]$pg.title; $desc = [string]$pg.desc
  $canon = Abs $L $path
  $og = if ($pg.og) { [string]$pg.og } else { $Base + '/assets/img/og.jpg' }
  $ld = ''
  if ($pg.ld) { foreach ($x in @($pg.ld)) { if ($x) { $ld += '<script type="application/ld+json">' + (To-Json $x) + '</script>' } } }
  $robots = if ($pg.noindex) { '<meta name="robots" content="noindex,follow">' } else { '<meta name="robots" content="index,follow,max-image-preview:large">' }
  $verif = if ($Site.googleSiteVerification) { '<meta name="google-site-verification" content="' + (Enc $Site.googleSiteVerification) + '">' } else { '' }
  $t = [ordered]@{}
  foreach ($k in @('add', 'added', 'onRequest', 'priceVat', 'qty', 'remove', 'sendWa', 'copy', 'copied', 'listIntro', 'listEmpty', 'estTotal', 'noContact', 'results', 'cm', 'm', 'sku', 'viewAll', 'preorder', 'size')) { $t[$k] = T $L $k }
  foreach ($k in @('units', 'tooTall', 'noPrice', 'waste')) { $t[$k] = [string](P $L.calc $k) }
  $shopUi = P (P $Shop $L.lang) 'ui'
  foreach ($pp in $shopUi.PSObject.Properties) { $t[$pp.Name] = [string]$pp.Value }
  $cfg = [ordered]@{
    lang = $L.lang; base = $BasePath; prefix = [string]$L.prefix; wa = $Wa; brand = (BrandOf $L); v = $Ver; phone = [string]$Site.phoneDisplay
    data = (AssetUrl ('data/products.json?v=' + $Ver)); live = [string]$Site.sheetCsvUrl
    langs = @($Langs); t = $t
  }
  $sb = New-Object Text.StringBuilder
  [void]$sb.Append('<!doctype html><html lang="' + $L.lang + '" dir="' + $L.dir + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">')
  [void]$sb.Append('<title>' + (Enc $title) + '</title><meta name="description" content="' + (Enc $desc) + '">' + $robots + $verif)
  [void]$sb.Append('<link rel="canonical" href="' + $canon + '">')
  if (-not $pg.noalt) {
    foreach ($lg in $Langs) { [void]$sb.Append('<link rel="alternate" hreflang="' + $lg + '" href="' + (Abs (Lc $lg) $path) + '">') }
    [void]$sb.Append('<link rel="alternate" hreflang="x-default" href="' + (Abs (Lc 'he') $path) + '">')
  }
  [void]$sb.Append('<meta property="og:type" content="' + $(if ($pg.ogType) { $pg.ogType } else { 'website' }) + '"><meta property="og:site_name" content="' + (Enc (BrandOf $L)) + '"><meta property="og:title" content="' + (Enc $title) + '"><meta property="og:description" content="' + (Enc $desc) + '"><meta property="og:url" content="' + $canon + '"><meta property="og:image" content="' + $og + '"><meta property="og:locale" content="' + $L.locale + '">')
  foreach ($lg in $Langs) { if ($lg -ne $L.lang) { [void]$sb.Append('<meta property="og:locale:alternate" content="' + (Lc $lg).locale + '">') } }
  [void]$sb.Append('<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#1b1916"><link rel="icon" href="' + $BasePath + '/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="' + (AssetUrl 'img/logo.png') + '"><meta name="apple-mobile-web-app-title" content="' + (Enc (BrandOf $L)) + '"><meta name="mobile-web-app-capable" content="yes"><link rel="manifest" href="' + $BasePath + '/manifest.webmanifest">')
  [void]$sb.Append('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="preconnect" href="https://docs.google.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;600;700&family=Frank+Ruhl+Libre:wght@400;500;700&family=Bellefair&display=swap">')
  [void]$sb.Append('<link rel="stylesheet" href="' + (AssetUrl ('css/style.css?v=' + $Ver)) + '">' + $ld + '<script>try{var a=JSON.parse(localStorage.getItem("kir-a11y")||"{}");var d=document.documentElement;if(a.fs)d.style.fontSize=a.fs+"%";if(a.contrast)d.classList.add("a11y-contrast");if(a.links)d.classList.add("a11y-links");if(a.motion)d.classList.add("a11y-motion");}catch(e){}</script></head>')
  [void]$sb.Append('<body class="' + [string]$pg.cls + '"><a class="skip" href="#main">' + (Enc (T $L 'skip')) + '</a>')
  [void]$sb.Append((HeaderHtml $L $path))
  [void]$sb.Append('<main id="main">' + [string]$pg.body + '</main>')
  [void]$sb.Append((FooterHtml $L $path))
  [void]$sb.Append((Widgets $L) + '<div class="toast" role="status" aria-live="polite" data-toast></div>')
  [void]$sb.Append('<script>window.KIR=' + (To-Json $cfg) + ';</script><script src="' + (AssetUrl ('js/app.js?v=' + $Ver)) + '" defer></script></body></html>')
  Write-Out ((Rel $L $path) + 'index.html') $sb.ToString()
}

function SectionHead([string]$title, [string]$lead, [string]$kicker = '', [string]$tag = 'h2') {
  $k = if ($kicker) { '<p class="kicker">' + (Enc $kicker) + '</p>' } else { '' }
  $ld = if ($lead) { '<p class="lead">' + (Enc $lead) + '</p>' } else { '' }
  '<div class="section-head reveal">' + $k + '<' + $tag + '>' + (Enc $title) + '</' + $tag + '>' + $ld + '</div>'
}

. (Join-Path $Root 'scripts/experience.ps1')
function StudioHtml($L, $first, [string]$tag = 'h2') { ExpTeaser $L $first $tag }   # the old 2D room is replaced by the wall studio teaser
function CalcHtml($L, $sel, [string]$tag = 'h2') {
  $C = $L.calc
  if (-not $script:CalcCache.ContainsKey($L.lang)) {
    $sb = New-Object Text.StringBuilder
    foreach ($c in @('slat', 'flex', 'panel', 'stone')) {
      $grp = @($Items | Where-Object { $_.c -eq $c -and $_.w -and $_.l -and $_.l -lt 10 })
      if (-not $grp.Count) { continue }
      [void]$sb.Append('<optgroup label="' + (Enc (P (CatOf $L $c) 'name')) + '">')
      foreach ($it in $grp) {
        $pp = if ($null -ne $it.p) { [string]$it.p } else { '' }
        [void]$sb.Append('<option value="' + $it.slug + '" data-w="' + (Num $it.w) + '" data-l="' + (Num $it.l) + '" data-p="' + $pp + '">' + (Enc ((NameOf $L $it) + ' - ' + $it.ref + ' (' + (SizeText $L $it.s) + ')')) + '</option>')
      }
      [void]$sb.Append('</optgroup>')
    }
    $script:CalcCache[$L.lang] = $sb.ToString()
  }
  $opts = $script:CalcCache[$L.lang]
  if ($sel) { $opts = $opts.Replace('<option value="' + $sel.slug + '" ', '<option selected value="' + $sel.slug + '" ') }
  '<section class="calc" id="calc"><div class="wrap calc-grid">' +
  '<div class="reveal"><p class="kicker">' + (Enc (P $L.nav 'calc')) + '</p><' + $tag + '>' + (Enc $C.title) + '</' + $tag + '><p class="lead">' + (Enc $C.lead) + '</p></div>' +
  '<form class="calc-card reveal" data-calc onsubmit="return false">' +
  '<label><span>' + (Enc $C.wallW) + '</span><input type="number" inputmode="numeric" min="10" max="5000" value="400" data-ww></label>' +
  '<label><span>' + (Enc $C.wallH) + '</span><input type="number" inputmode="numeric" min="10" max="1000" value="270" data-wh></label>' +
  '<label class="full"><span>' + (Enc $C.model) + '</span><select data-model>' + $opts + '</select></label>' +
  '<button type="button" class="btn btn-dark full" data-calc-add hidden data-tpl="' + (Enc (T $L 'calcAdd')) + '"></button><output class="calc-out full" data-out aria-live="polite"><span class="k">' + (Enc $C.result) + '</span><strong data-n>-</strong><span data-unit>' + (Enc $C.units) + '</span><span class="k">' + (Enc $C.cost) + '</span><strong data-cost>-</strong><small data-note>' + (Enc $C.waste) + '</small></output>' +
  '</form></div></section>'
}

function FaqHtml($L) {
  $f = ''
  foreach ($q in $L.faq) { $f += '<details class="faq-item"><summary>' + (Enc $q[0]) + '</summary><p>' + (Enc $q[1]) + '</p></details>' }
  '<section class="faq"><div class="wrap narrow">' + (SectionHead $L.faqTitle '') + $f + '</div></section>'
}

function LookTiles($L, [string]$tag = 'h3') {
  $t = ''
  foreach ($k in $LookOrder) {
    $lk = LookOf $L $k
    $cnt = @($Fams | Where-Object { $_.looks -contains $k }).Count
    $t += '<a class="mat reveal" href="' + (Href $L ('look/' + $lk.slug + '/')) + '" style="--img:url(' + (TexUrl (P $Tax.lookCover $k)) + ')"><span class="mat-tex" aria-hidden="true"></span><span class="mat-sheen" aria-hidden="true"></span><span class="mat-body"><' + $tag + '>' + (Enc $lk.name) + '</' + $tag + '><span>' + (CountTxt $L $cnt) + '</span></span></a>'
  }
  '<div class="mats" data-tilt>' + $t + '</div>'
}

function SectionTiles($L, [string]$tag = 'h3') {
  $t = ''
  foreach ($sec in $Sections) {
    $fl = SecFams $sec
    $cov = if ($sec.cover -and $ById[$sec.cover]) { $sec.cover } else { $fl[0].img }
    $t += '<a class="uni reveal" href="' + (Href $L (SecPath $L $sec)) + '"><span class="uni-img"><img src="' + (ImgUrl $cov) + '" alt="" width="520" height="650" loading="lazy" decoding="async"></span><span class="uni-body"><' + $tag + '>' + (Enc (SecTxt $L $sec 'name')) + '</' + $tag + '><small>' + (Enc (SecTxt $L $sec 'short')) + '</small><em>' + (CountTxt $L (ProdCount $fl)) + $Icons.arrow + '</em></span></a>'
  }
  '<div class="unis">' + $t + '</div>'
}

function CatTiles($L) {
  $t = ''
  foreach ($c in $CatOrder) {
    $cat = CatOf $L $c
    $list = @($Items | Where-Object { $_.c -eq $c })
    $cover = $list[0]
    $t += '<a class="cat reveal" href="' + (Href $L ('c/' + $cat.slug + '/')) + '"><img src="' + (ImgUrl $cover.img) + '" alt="" width="520" height="650" loading="lazy"><span><strong>' + (Enc $cat.name) + '</strong><em>' + $list.Count + '</em></span></a>'
  }
  '<div class="cats">' + $t + '</div>'
}

function FilterBar($L, [string[]]$cats, $secs = $null, $labels = $null) {
  $chip = { param($group, $val, $label) '<button type="button" class="chip" data-f="' + $group + '" data-v="' + $val + '" aria-pressed="false">' + (Enc $label) + '</button>' }
  $c = ''; $clbl = T $L 'category'
  if ($secs) { $clbl = T $L 'sectionLbl'; foreach ($sec in $secs) { $c += & $chip 's' $sec.key (SecTxt $L $sec 'name') } }
  elseif ($cats.Count -gt 1) { foreach ($k in $cats) { $lb = if ($labels -and $labels[$k]) { $labels[$k] } else { P (CatOf $L $k) 'name' }; $c += & $chip 'c' $k $lb } }
  $lk = ''; foreach ($k in $LookOrder) { if ($k -ne 'black' -and $k -ne 'white') { $lk += & $chip 'look' $k (P (LookOf $L $k) 'name') } }
  $co = ''; foreach ($k in $Tax.colorOrder) { $co += '<button type="button" class="chip chip-color" data-f="color" data-v="' + $k + '" aria-pressed="false"><i class="dot dot-' + $k + '" aria-hidden="true"></i>' + (Enc (P $L.colors $k)) + '</button>' }
  $rows = ''
  if ($c) { $rows += '<div class="frow"><span class="flabel">' + (Enc $clbl) + '</span><div class="chips">' + $c + '</div></div>' }
  $rows += '<div class="frow"><span class="flabel">' + (Enc (T $L 'look')) + '</span><div class="chips">' + $lk + '</div></div>'
  $rows += '<div class="frow"><span class="flabel">' + (Enc (T $L 'color')) + '</span><div class="chips">' + $co + '</div></div>'
  '<div class="filters wrap" data-filters><div class="ftop"><label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" placeholder="' + (Enc (T $L 'search')) + '" aria-label="' + (Enc (T $L 'search')) + '" data-q></label>' +
  '<label class="sort"><span class="sr">' + (Enc (T $L 'sort')) + '</span><select data-sort><option value="">' + (Enc (T $L 'sortDefault')) + '</option><option value="asc">' + (Enc (T $L 'sortPriceAsc')) + '</option><option value="desc">' + (Enc (T $L 'sortPriceDesc')) + '</option></select></label></div>' + $rows +
  '<div class="fstat"><span><strong data-n></strong> ' + (Enc (T $L 'results')) + '</span><button type="button" class="link" data-clear hidden>' + (Enc (T $L 'clear')) + '</button></div><p class="empty" data-empty hidden>' + (Enc (T $L 'noResults')) + '</p></div>'
}

function CountTxt($L, [int]$n) { if ($n -eq 1) { '1 ' + (Enc (T $L 'productOne')) } else { [string]$n + ' ' + (Enc (T $L 'products')) } }
function ProdCount($list) { @($list).Count }   # what the visitor sees: one card per product (its variants are inside)
function Band([string]$kicker, [string]$title, [string]$lead, [int]$count = -1, $L = $null, [int]$series = -1) {
  $c = if ($count -ge 0) { '<span class="band-count">' + (CountTxt $L $count) + $(if ($series -gt 1 -and $series -lt $count) { ' &middot; ' + $series + ' ' + (Enc (T $L 'seriesPl')) } else { '' }) + '</span>' } else { '' }
  '<section class="band"><div class="band-flutes" aria-hidden="true"></div><div class="wrap"><p class="kicker">' + (Enc $kicker) + '</p><h1>' + (Enc $title) + '</h1>' + $(if ($lead) { '<p class="lead">' + (Enc $lead) + '</p>' } else { '' }) + $c + '</div></section>'
}

function ContactCards($L) {
  $c = ''
  if ($Wa) { $c += '<a class="contact-card" href="' + (WaLink (T $L 'waHello')) + '" target="_blank" rel="noopener">' + $Icons.wa + '<strong>WhatsApp</strong><bdi>' + (Enc $Site.phoneDisplay) + '</bdi><span class="cc-cta">' + (Enc (T $L 'chatWa')) + '</span></a>' }
  if ($Site.phone) { $c += '<a class="contact-card" href="tel:' + (Enc $Site.phone) + '">' + $Icons.phone + '<strong>' + (Enc (T $L 'phone')) + '</strong><bdi>' + (Enc $Site.phoneDisplay) + '</bdi></a>' }
  if ($Site.address) { $c += '<a class="contact-card" href="' + (MapUrl) + '" target="_blank" rel="noopener">' + $Icons.pin + '<strong>' + (Enc (T $L 'address')) + '</strong><span>' + (Enc (SiteBy 'addressByLang' $L)) + '</span></a>' }
  if ($Site.hoursByLang) { $c += '<div class="contact-card">' + $Icons.clock + '<strong>' + (Enc (T $L 'hours')) + '</strong><span>' + (Enc (SiteBy 'hoursByLang' $L)) + '</span></div>' }
  if ($Site.email) { $c += '<a class="contact-card" href="mailto:' + (Enc $Site.email) + '"><strong>Email</strong><span>' + (Enc $Site.email) + '</span></a>' }
  '<section class="contact"><div class="wrap contact-grid">' + $c + '</div></section>'
}
function VisitHtml($L, [bool]$withMap) {
  if (-not $Site.address) { return '' }
  $map = if ($withMap) { '<div class="map-wrap"><iframe title="' + (Enc ((T $L 'address') + ': ' + (SiteBy 'addressByLang' $L))) + '" src="' + (MapEmbed) + '" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></div>' } else { '' }
  '<section class="visit"><div class="wrap visit-grid"><div class="visit-copy reveal"><p class="kicker">' + (Enc (T $L 'visit')) + '</p><h2>' + (Enc (BrandOf $L)) + '</h2>' +
  '<p class="visit-line">' + $Icons.pin + '<span>' + (Enc (SiteBy 'addressByLang' $L)) + '</span></p><p class="visit-line">' + $Icons.clock + '<span>' + (Enc (SiteBy 'hoursByLang' $L)) + '</span></p>' +
  '<p class="visit-line">' + $Icons.phone + '<a href="tel:' + (Enc $Site.phone) + '"><bdi>' + (Enc $Site.phoneDisplay) + '</bdi></a></p>' +
  '<div class="ctas"><a class="btn btn-dark" href="' + (MapUrl) + '" target="_blank" rel="noopener">' + (Enc (T $L 'openMaps')) + '</a><a class="btn" href="' + (WazeUrl) + '" target="_blank" rel="noopener">' + (Enc (T $L 'openWaze')) + '</a>' +
  $(if ($Wa) { '<a class="btn btn-wa" href="' + (WaLink (T $L 'waHello')) + '" target="_blank" rel="noopener">' + $Icons.wa + 'WhatsApp</a>' } else { '' }) + '</div></div>' + $map + '</div></section>'
}
function CheckoutForm($L) {
  function Fld([string]$name, [string]$label, [string]$type, [bool]$req, [string]$extra = '') {
    '<label class="fld"><span>' + (Enc $label) + $(if ($req) { ' <b aria-hidden="true">*</b>' } else { '' }) + '</span><input name="' + $name + '" type="' + $type + '"' + $(if ($req) { ' required aria-required="true"' } else { '' }) + $extra + '><small class="err" data-err="' + $name + '"></small></label>'
  }
  '<section class="checkout-sec"><div class="wrap checkout-grid"><form class="checkout-form" data-checkout novalidate>' +
  '<fieldset><legend>' + (Enc (T $L 'fName')) + ' / ' + (Enc (T $L 'phone')) + '</legend>' +
  (Fld 'name' (T $L 'fName') 'text' $true ' autocomplete="name"') + (Fld 'phone' (T $L 'fPhone') 'tel' $true ' autocomplete="tel" inputmode="tel" dir="ltr"') + (Fld 'email' (T $L 'fEmail') 'email' $false ' autocomplete="email" dir="ltr"') + '</fieldset>' +
  '<fieldset><legend>' + (Enc (T $L 'fDelivery')) + '</legend><label class="opt"><input type="radio" name="delivery" value="pickup" checked> ' + (Enc (T $L 'pickup')) + '</label><label class="opt"><input type="radio" name="delivery" value="delivery"> ' + (Enc (T $L 'delivery')) + '</label>' +
  (Fld 'city' (T $L 'fCity') 'text' $true ' autocomplete="address-level2"') + '<div data-addr hidden>' + (Fld 'address' (T $L 'fAddress') 'text' $false ' autocomplete="street-address"') + '</div></fieldset>' +
  '<fieldset><legend>' + (Enc (T $L 'fContact')) + '</legend><label class="opt"><input type="radio" name="contact" value="wa" checked> ' + (Enc (T $L 'byWa')) + '</label><label class="opt"><input type="radio" name="contact" value="phone"> ' + (Enc (T $L 'byPhone')) + '</label>' +
  '<label class="fld"><span>' + (Enc (T $L 'fNotes')) + '</span><textarea name="notes" rows="3"></textarea></label></fieldset>' +
  '<label class="consent"><input type="checkbox" name="consent" required aria-required="true"> <span>' + (Enc (T $L 'fConsent')) + ' (<a href="' + (Href $L 'terms/') + '" target="_blank">' + (Enc (T $L 'terms')) + '</a>, <a href="' + (Href $L 'privacy/') + '" target="_blank">' + (Enc (T $L 'privacy')) + '</a>)</span><small class="err" data-err="consent"></small></label>' +
  '<button class="btn btn-wa btn-big" type="submit">' + $Icons.wa + (Enc (T $L 'placeOrder')) + '</button><p class="note">' + (Enc (T $L 'secure')) + '</p>' +
  '</form><aside class="cart-summary" data-checkout-summary aria-live="polite"></aside></div>' +
  '<div class="wrap narrow"><div class="pay-info"><h2>' + (Enc (T $L 'payInfo')) + '</h2><p>' + (Enc (T $L 'payText')) + '</p></div></div></section>'
}

function VariantGallery($L, $it, [bool]$sel) {
  $name = NameOf $L $it
  $hid = if ($sel) { '' } else { ' hidden' }
  $ld = if ($sel) { 'eager' } else { 'lazy' }
  $td = TexDim $it.img
  $photo = '<figure class="g-view" data-view="photo"' + $(if ($it.c -in $PlateCats) { ' hidden' } else { '' }) + '><div class="zoom" data-zoom style="--img:url(' + (TexUrl $it.img) + ')"><img src="' + (TexUrl $it.img) + '" alt="' + (Enc $name) + '" width="' + $td[0] + '" height="' + $td[1] + '" loading="' + $ld + '"></div></figure>'
  if ($it.c -notin $PlateCats) { return '<div class="gallery" data-vg="' + $it.slug + '"' + $hid + '><div class="g-stage">' + $photo + '</div></div>' }
  $slats = ($it.c -eq 'slat')
  $vk = if ($slats) { 'viewSlats' } else { 'viewPlate' }
  '<div class="gallery" data-vg="' + $it.slug + '"' + $hid + '><div class="g-stage">' +
  '<figure class="g-view" data-view="plate"><div class="tilt" data-tilt3d><img src="' + (PackUrl $it.img) + '" alt="' + (Enc ($name + ' - ' + (T $L $vk))) + '" width="1000" height="1250" loading="' + $ld + '"' + $(if ($sel) { ' fetchpriority="high"' } else { '' }) + '></div></figure>' + $photo +
  # second view: the product laid in a real room (src/assets/img/room/<id>.jpg, rendered from the wall studio); no text tabs
  $(if (HasImg 'room' $it.img) { '<figure class="g-view g-room" data-view="room" hidden><img src="' + $BasePath + '/assets/img/room/' + $it.img + '.jpg" alt="' + (Enc ($name + ' - ' + (T $L 'inRoom'))) + '" width="1500" height="1000" loading="lazy"></figure>' } else { '' }) +
  '</div>' + $(if (HasImg 'room' $it.img) { '<div class="g-tabs g-thumbs" role="tablist"><button type="button" role="tab" aria-selected="true" data-show="plate" aria-label="' + (Enc (T $L $vk)) + '"><img src="' + (ImgUrl $it.img) + '" alt="" width="44" height="55" loading="lazy"></button>' +
  '<button type="button" role="tab" aria-selected="false" data-show="room" aria-label="' + (Enc (T $L 'inRoom')) + '"><img src="' + $BasePath + '/assets/img/room/' + $it.img + '.jpg" alt="" width="66" height="44" loading="lazy"></button></div>' } else { '' }) +
  $(if ($slats) { '' } else { '<p class="g-note">' + (Enc (T $L 'plateNote')) + '</p>' }) + '</div>'
}
function VariantBlock($L, $it, $cat, [bool]$sel) {
  $name = NameOf $L $it
  $sz = SizeText $L $it.s
  $specs = '<div><dt>' + (Enc $(if ($it.hasSku) { T $L 'sku' } else { T $L 'ref' })) + '</dt><dd><bdi>' + (Enc $it.ref) + '</bdi></dd></div>'
  if ($sz) { $specs += '<div><dt>' + (Enc (T $L 'size')) + '</dt><dd><bdi>' + (Enc $sz) + '</bdi></dd></div>' }
  $fin = FinishText $L $it.f; if ($fin) { $specs += '<div><dt>' + (Enc (T $L 'finish')) + '</dt><dd>' + (Enc $fin) + '</dd></div>' }
  if ($it.mat) { $specs += '<div><dt>Material</dt><dd>' + $it.mat + '</dd></div>' }
  $specs += '<div><dt>' + (Enc (T $L 'category')) + '</dt><dd><a href="' + (Href $L ('c/' + $cat.slug + '/')) + '">' + (Enc $cat.name) + '</a></dd></div>'
  if ($it.looks.Count) {
    $lks = @(); foreach ($k in $it.looks) { $lks += '<a href="' + (Href $L ('look/' + (P (LookOf $L $k) 'slug') + '/')) + '">' + (Enc (P (LookOf $L $k) 'name')) + '</a>' }
    $specs += '<div><dt>' + (Enc (T $L 'look')) + '</dt><dd>' + ($lks -join ', ') + '</dd></div>'
  }
  $avail = if ($it.oos) { '<span class="avail off">' + (Enc (T $L 'preorder')) + '</span>' } else { '' }
  $m2 = if ($it.ppm2) { '<p class="ppm2">&asymp; <bdi>' + $it.ppm2 + '&nbsp;&#8362;</bdi> ' + (Enc (T $L 'perM2')) + '</p>' } else { '' }
  $fm = $FamOf[$it.slug]
  $url = (Abs $L ('p/' + $fm.slug + '/')) + $(if ($fm.n -gt 1) { '?v=' + $it.slug } else { '' })
  $waText = (T $L 'listIntro') + ' ' + $name + ' (' + $it.ref + ') ' + $url
  $ask = if ($Wa) { '<a class="btn btn-ghost-dark" href="https://wa.me/' + $Wa + '?text=' + [Uri]::EscapeDataString($waText) + '" rel="noopener">' + $Icons.wa + (Enc (T $L 'ask')) + '</a>' } else { '' }
  $wall = if (ExpHasFace $it) { '<a class="btn btn-ghost-dark" href="' + (ExpHref $L $it.img) + '">' + (Enc (T $L 'seeOnWall')) + '</a>' } else { '' }
  '<div class="vblock" data-img="' + $it.img + '" data-vb="' + $it.slug + '"' + $(if ($sel) { '' } else { ' hidden' }) + '>' + $avail +
  '<div class="pd-price">' + (PriceHtml $L $it) + $m2 + '</div><dl class="specs">' + $specs + '</dl>' +
  '<div class="pd-actions"><label class="qty-pick"><span class="sr">' + (Enc (T $L 'qty')) + '</span><button type="button" data-step="-1" aria-label="-">-</button><input type="number" min="1" max="999" value="1" inputmode="numeric" data-qty-in><button type="button" data-step="1" aria-label="+">+</button></label><button type="button" class="btn btn-dark" data-add="' + $it.slug + '" data-cart-add data-label>' + (Enc (T $L 'add')) + '</button>' + $ask + $wall + '</div></div>'
}

# ---------- build ----------
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $Root 'src/*') $OutDir

$script:CalcCache = @{}
$sitemap = New-Object System.Collections.ArrayList
function AddUrl([string]$path, [string]$prio = '0.6') { [void]$sitemap.Add(@($path, $prio)) }

foreach ($lang in $Langs) {
  $L = Lc $lang
  $catIndex = @{}; $famIndex = @{}; foreach ($c in $CatOrder) { $catIndex[$c] = @($Items | Where-Object { $_.c -eq $c }); $famIndex[$c] = @($Fams | Where-Object { $_.c -eq $c }) }

  # Home
  $feat = @(); foreach ($id in $Tax.featured) { if ($ById[$id]) { $fm0 = $FamOf[$ById[$id].slug]; if ($feat -notcontains $fm0) { $feat += $fm0 } } }
  $stats = ''
  foreach ($s in $L.stats) { $stats += '<li><strong>' + (Enc (Fill ([string]$s[0]) @{ count = $Fams.Count; cats = $Sections.Count })) + '</strong><span>' + (Enc $s[1]) + '</span></li>' }
  $steps = ''; $n = 0
  foreach ($s in $L.steps.items) { $n++; $steps += '<li class="reveal"><span class="num">0' + $n + '</span><h3>' + (Enc $s[0]) + '</h3><p>' + (Enc $s[1]) + '</p></li>' }
  # Hero: a real room dressed while scrolling (src/assets/js/home-hero.js, settings in data/experience.json > home)
  $hc = $ExpCfg.home
  $reel = [ordered]@{ plate = [ordered]@{ w = [double]$hc.plate.w; h = [double]$hc.plate.h }; faces = @($hc.faces | ForEach-Object { [ordered]@{ id = [string]$_.id; img = (AssetUrl ('img/' + [string]$_.img)); w = [double]$_.w; h = [double]$_.h } }); scenes = @($hc.scenes | ForEach-Object { [ordered]@{ base = (AssetUrl ('img/home/scenes/' + [string]$_.id + '/')); faces = @($_.faces) } }) }
  $reelJson = (To-Json $reel).Replace("'", '&#39;')
  $logoName = [string]$hc.logo
  $letters = ''; $li = 0; foreach ($ch in $logoName.ToCharArray()) { if ($ch -eq ' ') { $letters += '<i class="sp"></i>' } else { $letters += '<b style="--i:' + $li + '">' + (Enc ([string]$ch)) + '</b>' }; $li++ }
  $letters = '<span class="rl-word" style="--n:' + $li + '">' + $letters + '</span>'
  $hero = '<section class="hero hero-reel" data-hero data-reel=''' + $reelJson + ''' style="--photo:url(' + (AssetUrl ('img/home/scenes/' + [string]$hc.scenes[0].id + '/photo.jpg')) + ')"><div class="reel-stage"><canvas class="reel-canvas" aria-hidden="true"></canvas><div class="reel-scrim" aria-hidden="true"></div>' +
    '<div class="wrap hero-content"><p class="kicker">' + (Enc $L.hero.kicker) + '</p><h1>' + (Enc $L.hero.h1) + '<span class="h1-tag">' + (Enc $L.tagline) + '</span></h1><p class="lead">' + (Enc $L.hero.lead) + '</p>' +
    '<div class="ctas"><a class="btn btn-light" href="' + (Href $L 'catalog/') + '">' + (Enc $L.hero.cta) + $Icons.arrow + '</a><a class="btn btn-ghost" href="#studio">' + (Enc $L.hero.cta2) + '</a></div><ul class="stats">' + $stats + '</ul></div>' +
    '<div class="reel-logo"><div class="rl-3d" aria-hidden="true"><span class="rl-name" dir="rtl" lang="he">' + $letters + '</span></div><p class="rl-tag">' + (Enc $L.tagline) + '</p>' +
    '<div class="ctas"><a class="btn btn-light" href="' + (Href $L 'catalog/') + '">' + (Enc $L.hero.cta) + $Icons.arrow + '</a><a class="btn btn-ghost" href="' + (Href $L 'experience/') + '">' + (Enc $L.hero.cta2) + '</a></div></div>' +
    '<div class="scroll-cue" aria-hidden="true"></div></div>' +
    '<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.min.js" } }</script><script type="module" src="' + (AssetUrl ('js/home-hero.js?v=' + $Ver)) + '"></script></section>'
  $body = $hero +
    '<section class="universes" id="universes"><div class="wrap">' + (SectionHead (T $L 'sectionsTitle') (T $L 'sectionsLead') (P $L.nav 'catalog')) + (SectionTiles $L) + '</div></section>' +
    '<section class="materials"><div class="wrap">' + (SectionHead $L.materialsTitle $L.materialsLead (P $L.nav 'looks')) + (LookTiles $L) + '</div></section>' +
    (StudioHtml $L $null) +
    '<section class="featured"><div class="wrap">' + (SectionHead $L.featured '' (P $L.nav 'catalog')) + (Grid $L $feat) + '<p class="center"><a class="btn" href="' + (Href $L 'catalog/') + '">' + (Enc (T $L 'viewAll')) + ' (' + $Fams.Count + ')' + $Icons.arrow + '</a></p></div></section>' +
    '<section class="steps"><div class="wrap">' + (SectionHead $L.steps.title '') + '<ol class="steps-list">' + $steps + '</ol></div></section>' +
    (VisitHtml $L $false) +
    (FaqHtml $L)
  $web = [ordered]@{ '@context' = 'https://schema.org'; '@type' = 'WebSite'; '@id' = ($Base + '/#web'); name = $BrandFull; url = ($Base + '/'); inLanguage = @('he', 'fr'); publisher = @{ '@id' = ($Base + '/#org') } }
  Page $L @{ path = ''; title = (Fill $L.metaTitleHome @{ brand = (BrandOf $L) }); desc = $L.metaDescHome; body = $body; cls = 'home'; ld = @((OrgLd $L), $web, (FaqLd $L)) }
  if ($lang -eq 'he') { AddUrl '' '1.0' }

  # Catalog
  $body = (Band (P $L.nav 'catalog') $L.catalogTitle $L.catalogDesc $Fams.Count $L $Fams.Count) + (FilterBar $L $CatOrder $Sections) + '<section class="listing"><div class="wrap">' + (Grid $L $Fams 'h2') + '</div></section>'
  $crumb = @(@((T $L 'home'), ''), @($L.catalogTitle, 'catalog/'))
  Page $L @{ path = 'catalog/'; title = ($L.catalogTitle + ' | ' + (BrandOf $L)); desc = $L.catalogDesc; body = (CrumbHtml $L $crumb) + $body; cls = 'catalog'; ld = @((CrumbLd $L $crumb), (ItemListLd $L $Items)) }
  if ($lang -eq 'he') { AddUrl 'catalog/' '0.9' }

  # Sections (universes) with several categories: one page each
  foreach ($sec in $Sections) {
    if (-not (SecMulti $sec)) { continue }
    $list = SecFams $sec; $path = SecPath $L $sec; $sname = SecTxt $L $sec 'name'
    $crumb = @(@((T $L 'home'), ''), @($sname, $path))
    $sub = ''; foreach ($c in $sec.cats) { $cc = CatOf $L $c; $sub += '<a class="pill" href="' + (Href $L ('c/' + $cc.slug + '/')) + '">' + (Enc $cc.name) + ' <small>' + (ProdCount $famIndex[$c]) + '</small></a>' }
    $fcats = @($sec.cats); $flbl = @{}
    foreach ($a in @($sec.also)) {
      $an = [string](P $a $L.lang); $fcats += [string]$a.cat; $flbl[[string]$a.cat] = $an
      $sub += '<a class="pill" href="' + (Href $L $path) + '?c=' + $a.cat + '">' + (Enc $an) + ' <small>' + (ProdCount @($Fams | Where-Object { $_.c -eq $a.cat -and (SecAlso $sec $_) })) + '</small></a>'
    }
    $cc0 = @($sec.cats | Where-Object { $_ -in @('slat', 'panel', 'flex') }) | Select-Object -First 1
    $extra = if ($cc0) { CalcHtml $L ($catIndex[$cc0] | Where-Object { $_.w -and $_.l } | Select-Object -First 1) } else { '' }
    $body = (CrumbHtml $L $crumb) + (Band (P $L.nav 'catalog') (SecTxt $L $sec 'title') (SecTxt $L $sec 'intro') (ProdCount $list) $L @($list).Count) +
      (FilterBar $L $fcats $null $flbl) +
      '<section class="listing"><div class="wrap">' + (Grid $L $list 'h2') + '</div></section>' + $extra +
      '<section class="more"><div class="wrap"><h2 class="more-title">' + (Enc (T $L 'inSection')) + '</h2><div class="pills">' + $sub + '</div><h2 class="more-title">' + (Enc (T $L 'otherSections')) + '</h2><div class="pills">' + (SecPills $L $sec) + '</div></div></section>'
    Page $L @{ path = $path; title = ((SecTxt $L $sec 'title') + ' | ' + (BrandOf $L)); desc = (SecTxt $L $sec 'intro'); body = $body; cls = 'category section-page'; og = (ImgAbs $list[0].img); ld = @((CrumbLd $L $crumb), (ItemListLd $L $list)) }
    if ($lang -eq 'he') { AddUrl $path '0.85' }
  }

  # Categories
  foreach ($c in $CatOrder) {
    $cat = CatOf $L $c; $list = $famIndex[$c]; $sec = $SecOf[$c]; $multiSec = SecMulti $sec
    $crumb = @(, @((T $L 'home'), ''))
    if ($multiSec) { $crumb += , @((SecTxt $L $sec 'name'), (SecPath $L $sec)) }
    $crumb += , @($cat.name, ('c/' + $cat.slug + '/'))
    $sib = ''
    if ($multiSec) { foreach ($k in $sec.cats) { if ($k -ne $c) { $sib += '<a class="pill" href="' + (Href $L ('c/' + (P (CatOf $L $k) 'slug') + '/')) + '">' + (Enc (P (CatOf $L $k) 'name')) + '</a>' } } }
    $more = ''
    if ($sib) { $more += '<h2 class="more-title">' + (Enc (T $L 'inSection')) + ' &middot; <a href="' + (Href $L (SecPath $L $sec)) + '">' + (Enc (SecTxt $L $sec 'name')) + '</a></h2><div class="pills">' + $sib + '</div>' }
    $more += '<h2 class="more-title">' + (Enc (T $L 'otherSections')) + '</h2><div class="pills">' + (SecPills $L $sec) + '</div>'
    $extra = ''
    if ($c -eq 'slat' -or $c -eq 'panel' -or $c -eq 'flex') { $extra = (CalcHtml $L ($catIndex[$c] | Where-Object { $_.w -and $_.l } | Select-Object -First 1)) }
    $kick = if ($multiSec) { SecTxt $L $sec 'name' } else { P $L.nav 'catalog' }
    $body = (CrumbHtml $L $crumb) + (Band $kick $cat.title $cat.intro (ProdCount $list) $L @($list).Count) + (FilterBar $L @($c)) + '<section class="listing"><div class="wrap">' + (Grid $L $list 'h2') + '</div></section>' + $extra + '<section class="more"><div class="wrap">' + $more + '</div></section>'
    $desc = $cat.intro
    Page $L @{ path = ('c/' + $cat.slug + '/'); title = ($cat.title + ' | ' + (BrandOf $L)); desc = $desc; body = $body; cls = 'category'; og = (ImgAbs $list[0].img); ld = @((CrumbLd $L $crumb), (ItemListLd $L $list)) }
    if ($lang -eq 'he') { AddUrl ('c/' + $cat.slug + '/') '0.8' }
  }

  # Looks index + looks
  $crumb = @(@((T $L 'home'), ''), @($L.looksTitle, 'looks/'))
  $body = (CrumbHtml $L $crumb) + (Band (P $L.nav 'looks') $L.looksTitle $L.materialsLead -1 $L) + '<section class="materials"><div class="wrap">' + (LookTiles $L 'h2') + '</div></section>' + (StudioHtml $L $null)
  Page $L @{ path = 'looks/'; title = ($L.looksTitle + ' | ' + (BrandOf $L)); desc = $L.materialsLead; body = $body; cls = 'looks'; ld = @((CrumbLd $L $crumb)) }
  if ($lang -eq 'he') { AddUrl 'looks/' '0.7' }
  foreach ($k in $LookOrder) {
    $lk = LookOf $L $k
    $list = @($Fams | Where-Object { $_.looks -contains $k })
    if (-not $list.Count) { continue }
    $cats = @($CatOrder | Where-Object { $cc = $_; @($list | Where-Object { $_.c -eq $cc }).Count -gt 0 })
    $others = ''; foreach ($j in $LookOrder) { if ($j -ne $k) { $others += '<a class="pill" href="' + (Href $L ('look/' + (P (LookOf $L $j) 'slug') + '/')) + '">' + (Enc (P (LookOf $L $j) 'name')) + '</a>' } }
    $crumb = @(@((T $L 'home'), ''), @($L.looksTitle, 'looks/'), @($lk.name, ('look/' + $lk.slug + '/')))
    $first = $ById[(P $Tax.lookCover $k)]
    $body = (CrumbHtml $L $crumb) + (Band (P $L.nav 'looks') $lk.title $lk.intro (ProdCount $list) $L @($list).Count) + (FilterBar $L $cats) + '<section class="listing"><div class="wrap">' + (Grid $L $list 'h2') + '</div></section>' + (StudioHtml $L $first) + '<section class="more"><div class="wrap"><div class="pills">' + $others + '</div></div></section>'
    Page $L @{ path = ('look/' + $lk.slug + '/'); title = ($lk.title + ' | ' + (BrandOf $L)); desc = $lk.intro; body = $body; cls = 'look'; og = (ImgAbs $first.img); ld = @((CrumbLd $L $crumb), (ItemListLd $L $list)) }
    if ($lang -eq 'he') { AddUrl ('look/' + $lk.slug + '/') '0.8' }
  }

  # Product pages: one per family, variants switchable on the page
  foreach ($fm in $Fams) {
    $cat = CatOf $L $fm.c
    $name = NameOf $L $fm
    $multi = $fm.n -gt 1
    $psec = $SecOf[$fm.c]
    $crumb = @(, @((T $L 'home'), ''))
    if (SecMulti $psec) { $crumb += , @((SecTxt $L $psec 'name'), (SecPath $L $psec)) }
    $crumb += , @($cat.name, ('c/' + $cat.slug + '/'))
    $crumb += , @($name, ('p/' + $fm.slug + '/'))
    $gal = ''; $blk = ''; $opts = ''
    foreach ($v in $fm.vars) {
      $sel = ($v.slug -eq $fm.rep.slug)
      $gal += VariantGallery $L $v $sel
      $blk += VariantBlock $L $v $cat $sel
      if ($multi) {
        $opts += '<button type="button" class="vopt" role="radio" aria-checked="' + $(if ($sel) { 'true' } else { 'false' }) + '" data-v="' + $v.slug + '" data-img="' + $v.img + '"><img src="' + (ImgUrl $v.img) + '" alt="" width="52" height="65" loading="lazy"><span class="vtxt"><strong>' + (Enc (NameOf $L $v)) + '</strong><small><bdi>' + (Enc $v.ref) + '</bdi>' + $(if ($v.s) { ' ' + $DOT + ' <bdi>' + (Enc (SizeText $L $v.s)) + '</bdi>' } else { '' }) + '</small></span>' + (PriceHtml $L $v) + '</button>'
      }
    }
    $vpick = if ($multi) { '<div class="variants"><p class="label" id="vl">' + (Enc (T $L 'variants')) + ' (' + $fm.n + ')</p><div class="vlist" role="radiogroup" aria-labelledby="vl" data-variants>' + $opts + '</div></div>' } else { '' }
    $pd = '<section class="product wrap" data-product><div class="pd-media">' + $gal + '</div>' +
      '<div class="pd-info"><p class="kicker"><a href="' + (Href $L ('c/' + $cat.slug + '/')) + '">' + (Enc $cat.name) + '</a></p><h1>' + (Enc $name) + '</h1>' + $vpick + $blk +
      '<p class="note">' + (Enc (T $L 'priceNote')) + '</p><button type="button" class="share-btn" data-share>' + $Icons.share + (Enc (T $L 'share')) + '</button></div>' +
      '<div class="buybar" data-buybar hidden><div class="bb-info"><strong>' + (Enc $name) + '</strong><span data-bb-price></span></div><button type="button" class="btn btn-dark" data-bb-add>' + (Enc (T $L 'add')) + '</button></div></section>'
    $rel = New-Object System.Collections.ArrayList
    foreach ($o in $famIndex[$fm.c]) {
      if ($rel.Count -ge 8) { break }; if ($o.slug -eq $fm.slug) { continue }
      $share = ($fm.looks.Count -eq 0); foreach ($k in $o.looks) { if ($fm.looks -contains $k) { $share = $true; break } }
      if ($share) { [void]$rel.Add($o) }
    }
    if ($rel.Count -lt 4) { $rel = New-Object System.Collections.ArrayList; foreach ($o in $famIndex[$fm.c]) { if ($rel.Count -ge 8) { break }; if ($o.slug -ne $fm.slug) { [void]$rel.Add($o) } } }
    $relHtml = if ($rel.Count) { '<section class="related"><div class="wrap">' + (SectionHead (T $L 'related') '') + (Grid $L $rel) + '</div></section>' } else { '' }
    $calcIt = $fm.vars | Where-Object { $_.w -and $_.l -and $_.l -lt 10 } | Select-Object -First 1
    $calc = if ($calcIt -and $fm.c -in @('slat', 'panel', 'flex', 'stone')) { CalcHtml $L $calcIt } else { '' }
    $studio = if ($fm.c -in $PlateCats) { StudioHtml $L $fm.rep } else { '' }
    $body = (CrumbHtml $L $crumb) + $pd + $studio + $calc + $relHtml
    $rp = $fm.rep
    if ($multi) {
      $pricePart = if ($null -ne $fm.p) { (T $L 'from') + (Num $fm.p) + ' ' + $SHEKEL + ' ' + (T $L 'priceVat') + '.' } else { (T $L 'onRequest') + '.' }
      $desc = Fill $L.productDesc @{ name = ($name + ' (' + $fm.n + ' ' + (T $L 'models') + ')'); size = ''; price = $pricePart }
      $title = $name + ' | ' + (BrandOf $L)
    } else {
      $sz = SizeText $L $rp.s
      $sizePart = if ($sz) { (T $L 'size') + ': ' + $sz + '. ' } else { '' }
      $pricePart = if ($null -ne $rp.p) { (PriceText $L $rp) + ' ' + (T $L 'priceVat') + '.' } else { (T $L 'onRequest') + '.' }
      $desc = Fill $L.productDesc @{ name = $name; size = $sizePart; price = $pricePart }
      $title = Fill $L.productTitle @{ name = $name; sku = $rp.ref; brand = (BrandOf $L) }
    }
    $ld = @((CrumbLd $L $crumb))
    $offers = New-Object System.Collections.ArrayList
    foreach ($v in $fm.vars) {
      if ($null -eq $v.p) { continue }
      $vp = [ordered]@{ '@type' = 'Product'; name = (NameOf $L $v); sku = $v.ref; image = @((ImgAbs $v.img)); category = $cat.name; url = (Abs $L ('p/' + $fm.slug + '/')) + $(if ($multi) { '?v=' + $v.slug } else { '' }) }
      if ($v.slug -like 'adhesive-homey*') { $vp.brand = [ordered]@{ '@type' = 'Brand'; name = 'HOMEY' } }
      if ($v.w -and $v.l -and $v.l -lt 10) { $vp.width = [ordered]@{ '@type' = 'QuantitativeValue'; value = $v.w; unitCode = 'CMT' }; $vp.depth = [ordered]@{ '@type' = 'QuantitativeValue'; value = $v.l; unitCode = 'MTR' } }
      $vp.offers = [ordered]@{ '@type' = 'Offer'; price = [string]$v.p; priceCurrency = 'ILS'; availability = $(if ($v.oos) { 'https://schema.org/PreOrder' } else { 'https://schema.org/InStock' }); itemCondition = 'https://schema.org/NewCondition'; url = $vp.url; seller = @{ '@id' = ($Base + '/#org') } }
      [void]$offers.Add($vp)
    }
    if ($offers.Count -eq 1 -and -not $multi) { $o1 = $offers[0]; $o1['@context'] = 'https://schema.org'; $o1.description = $desc; $ld += $o1 }
    elseif ($offers.Count -ge 1) { $ld += [ordered]@{ '@context' = 'https://schema.org'; '@type' = 'ProductGroup'; name = $name; productGroupID = $fm.ref; description = $desc; url = (Abs $L ('p/' + $fm.slug + '/')); variesBy = @('https://schema.org/size', 'https://schema.org/pattern'); hasVariant = @($offers) } }
    Page $L @{ path = ('p/' + $fm.slug + '/'); title = $title; desc = $desc; body = $body; cls = 'product-page'; og = (ImgAbs $fm.img); ogType = 'product'; ld = $ld }
    if ($lang -eq 'he') { AddUrl ('p/' + $fm.slug + '/') '0.6' }
  }
  # Studio + calculator page
  $crumb = @(@((T $L 'home'), ''), @((P $L.studio 'title'), 'studio/'))
  $body = (CrumbHtml $L $crumb) + (Band (P $L.nav 'studio') (P $L.studio 'title') (P $L.studio 'lead') -1 $L) + (StudioHtml $L $null 'h2') + (CalcHtml $L $null)
  Page $L @{ path = 'studio/'; title = ((P $L.studio 'title') + ' - ' + (P $L.calc 'title') + ' | ' + (BrandOf $L)); desc = ((P $L.studio 'lead') + ' ' + (P $L.calc 'lead')); body = $body; cls = 'studio-page'; ld = @((CrumbLd $L $crumb)) }
  if ($lang -eq 'he') { AddUrl 'studio/' '0.7' }
  # Wall studio (live 3D slat + products laid on a real room photo)
  ExperiencePage $L
  if ($lang -eq 'he') { AddUrl 'experience/' '0.8' }

  # Guide
  $g = ''; $toc = ''; $n = 0
  foreach ($sec in $L.guide) { $n++; $toc += '<li><a href="#g' + $n + '">' + (Enc $sec[0]) + '</a></li>'; $g += '<section class="g-sec reveal" id="g' + $n + '"><h2>' + (Enc $sec[0]) + '</h2>' + [string]$sec[1] + '</section>' }
  $crumb = @(@((T $L 'home'), ''), @($L.guideTitle, 'guide/'))
  $article = [ordered]@{ '@context' = 'https://schema.org'; '@type' = 'Article'; headline = $L.guideTitle; description = $L.guideDesc; inLanguage = $L.lang; datePublished = $Today; dateModified = $Today; author = @{ '@id' = ($Base + '/#org') }; publisher = @{ '@id' = ($Base + '/#org') }; mainEntityOfPage = (Abs $L 'guide/') }
  $body = (CrumbHtml $L $crumb) + (Band (P $L.nav 'guide') $L.guideTitle $L.guideDesc -1 $L) + '<div class="wrap guide"><nav class="toc" aria-label="TOC"><ol>' + $toc + '</ol></nav><article class="prose">' + $g + '</article></div>' + (CalcHtml $L $null) + (FaqHtml $L)
  Page $L @{ path = 'guide/'; title = ($L.guideTitle + ' | ' + (BrandOf $L)); desc = $L.guideDesc; body = $body; cls = 'guide-page'; ogType = 'article'; ld = @((CrumbLd $L $crumb), $article, (FaqLd $L)) }
  if ($lang -eq 'he') { AddUrl 'guide/' '0.7' }

  # Contact + showroom map
  $body = (CrumbHtml $L @(@((T $L 'home'), ''), @($L.contactTitle, 'contact/'))) + (Band (P $L.nav 'contact') $L.contactTitle $L.contactDesc -1 $L) + (ContactCards $L) + (VisitHtml $L $true) + (FaqHtml $L)
  $crumb = @(@((T $L 'home'), ''), @($L.contactTitle, 'contact/'))
  Page $L @{ path = 'contact/'; title = ($L.contactTitle + ' | ' + (BrandOf $L)); desc = $L.contactDesc; body = $body; cls = 'contact-page'; ld = @((CrumbLd $L $crumb), (OrgLd $L)) }
  if ($lang -eq 'he') { AddUrl 'contact/' '0.7' }

  # Shop pages (not indexed)
  $SP = P (P $Shop $lang) 'pages'
  $body = (Band (T $L 'cart') $SP.cartTitle $SP.cartDesc -1 $L) + '<section class="cart-sec"><div class="wrap cart-grid"><div class="cart-items" data-cart><noscript><p>JavaScript</p></noscript></div><aside class="cart-summary" data-cart-summary aria-live="polite"></aside></div></section>'
  Page $L @{ path = 'cart/'; title = ($SP.cartTitle + ' | ' + (BrandOf $L)); desc = $SP.cartDesc; body = $body; cls = 'cart-page'; noindex = $true }
  $body = (Band (T $L 'checkout') $SP.checkoutTitle $SP.checkoutDesc -1 $L) + (CheckoutForm $L)
  Page $L @{ path = 'checkout/'; title = ($SP.checkoutTitle + ' | ' + (BrandOf $L)); desc = $SP.checkoutDesc; body = $body; cls = 'checkout-page'; noindex = $true }
  $body = '<section class="order-sec"><div class="wrap narrow" data-order><noscript><p>JavaScript</p></noscript></div></section>'
  Page $L @{ path = 'order/'; title = ($SP.orderTitle + ' | ' + (BrandOf $L)); desc = $SP.orderTitle; body = $body; cls = 'order-page'; noindex = $true }
  $body = (Band (T $L 'orders') $SP.ordersTitle $SP.ordersDesc -1 $L) + '<section class="orders-sec"><div class="wrap narrow" data-orders></div></section>'
  Page $L @{ path = 'orders/'; title = ($SP.ordersTitle + ' | ' + (BrandOf $L)); desc = $SP.ordersDesc; body = $body; cls = 'orders-page'; noindex = $true }
  # former quote-list address -> cart
  $redir = '<!doctype html><html lang="' + $L.lang + '"><head><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="canonical" href="' + (Abs $L 'cart/') + '"><meta http-equiv="refresh" content="0; url=' + (Href $L 'cart/') + '"></head><body><a href="' + (Href $L 'cart/') + '">' + (Enc (T $L 'cart')) + '</a></body></html>'
  Write-Out ((Rel $L 'list/') + 'index.html') $redir

  # Legal pages
  foreach ($lk in @('terms', 'privacy', 'shipping', 'accessibility')) {
    $pgD = P $SP $lk
    $html = Fill ([string]$pgD[1]) @{ brand = (BrandOf $L); phone = [string]$Site.phoneDisplay; address = (SiteBy 'addressByLang' $L); shipping = (Href $L 'shipping/'); date = $Today }
    $crumb = @(@((T $L 'home'), ''), @([string]$pgD[0], ($lk + '/')))
    $body = (CrumbHtml $L $crumb) + (Band (T $L 'legal') ([string]$pgD[0]) '' -1 $L) + '<section class="legal"><div class="wrap narrow prose">' + $html + '</div></section>'
    Page $L @{ path = ($lk + '/'); title = ([string]$pgD[0] + ' | ' + (BrandOf $L)); desc = ([string]$pgD[0] + ' - ' + (BrandOf $L)); body = $body; cls = 'legal-page'; ld = @((CrumbLd $L $crumb)) }
    if ($lang -eq 'he') { AddUrl ($lk + '/') '0.3' }
  }
}

# 404 (root, trilingual)
$he = Lc 'he'; $fr = Lc 'fr'; $en = Lc 'en'
$nfParts = ''
foreach ($X in @($he, $en, $fr)) { $nfParts += '<div lang="' + $X.lang + '" dir="' + $X.dir + '" class="nf-lang"><h2>' + (Enc $X.notFound) + '</h2><p class="lead">' + (Enc $X.notFoundLead) + '</p><p><a class="btn btn-light" href="' + (Href $X 'catalog/') + '">' + (Enc (P $X.nav 'catalog')) + '</a></p></div>' }
$nf = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>404 | ' + (Enc $Site.brandHe) + '</title><meta name="robots" content="noindex"><link rel="icon" href="' + $BasePath + '/favicon.svg"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;600;700&family=Frank+Ruhl+Libre:wght@400;500;700&family=Bellefair&display=swap"><link rel="stylesheet" href="' + (AssetUrl ('css/style.css?v=' + $Ver)) + '"></head><body class="nf"><main class="nf-main band"><div class="band-flutes" aria-hidden="true"></div><div class="wrap"><a class="nf-logo" href="' + $BasePath + '/">' + (Enc $Site.brandHe) + ' &middot; ' + (Enc $Site.brand) + '</a><p class="kicker">404</p>' + $nfParts + '</div></main></body></html>'
Write-Out '404.html' $nf

# Client data (public fields only)
$pub = New-Object System.Collections.ArrayList
foreach ($it in $Items) {
  [void]$pub.Add([ordered]@{ id = $it.slug; f = $FamOf[$it.slug].slug; r = $it.ref; c = $it.c; he = $it.he; fr = $it.fr; en = $it.en; s = $it.s; w = $it.w; l = $it.l; p = $it.p; img = $it.img; oos = $it.oos; fl = $it.fl })
}
Write-Out 'assets/data/products.json' (ConvertTo-Json -InputObject @($pub) -Depth 5 -Compress)

# Sitemap with hreflang alternates
$sb = New-Object Text.StringBuilder
[void]$sb.Append('<?xml version="1.0" encoding="UTF-8"?>' + "`n" + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' + "`n")
foreach ($u in $sitemap) {
  $path = $u[0]; $prio = $u[1]
  $img = ''
  if ($path -like 'p/*') { $sl = $path.Substring(2).TrimEnd('/'); $it = $FamBySlug[$sl]; if ($it) { $img = '<image:image><image:loc>' + (ImgAbs $it.img) + '</image:loc></image:image>' } }
  $alts = ''; foreach ($lg in $Langs) { $alts += '<xhtml:link rel="alternate" hreflang="' + $lg + '" href="' + (Abs (Lc $lg) $path) + '"/>' }
  $alts += '<xhtml:link rel="alternate" hreflang="x-default" href="' + (Abs $he $path) + '"/>'
  foreach ($lang in $Langs) {
    $L = Lc $lang
    [void]$sb.Append('<url><loc>' + (Abs $L $path) + '</loc><lastmod>' + $Today + '</lastmod><priority>' + $prio + '</priority>' + $alts + $img + '</url>' + "`n")
  }
}
[void]$sb.Append('</urlset>')
Write-Out 'sitemap.xml' $sb.ToString()


# robots.txt (AI crawlers explicitly allowed)
$robots = "User-agent: *`nAllow: /`nDisallow: $BasePath/list/`nDisallow: $BasePath/fr/list/`n`n"
foreach ($bot in @('GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bingbot')) { $robots += "User-agent: $bot`nAllow: /`n`n" }
$robots += "Sitemap: $Base/sitemap.xml`n"
Write-Out 'robots.txt' $robots

# llms.txt
$llm = "# $BrandFull`n`n> " + $he.metaDescHome + "`n> " + $fr.metaDescHome + "`n`n"
$llm += "Languages: Hebrew (default, $Base/), English ($Base/en/) and French ($Base/fr/). Prices are in ILS and include Israeli VAT. Products without a listed price are quoted on request.`n`n"
$llm += "## Catalog`n`n- [Full catalog (he)]($Base/catalog/): " + $Items.Count + " products`n- [Catalogue complet (fr)]($Base/fr/catalog/)`n"
foreach ($sec in $Sections) {
  $llm += "`n### " + (SecTxt $he $sec 'name') + " / " + (SecTxt $en $sec 'name') + "`n`n"
  if (SecMulti $sec) { $llm += "- [" + (SecTxt $en $sec 'title') + "]($Base/" + (SecPath $he $sec) + "): " + (ProdCount (SecFams $sec)) + " products. " + (SecTxt $en $sec 'intro') + "`n" }
  foreach ($c in $sec.cats) { $ch = CatOf $he $c; $cf = CatOf $fr $c; $llm += "- [" + $ch.name + " / " + $cf.name + "]($Base/c/" + $ch.slug + "/): " + @($Items | Where-Object { $_.c -eq $c }).Count + " products. " + $cf.intro + "`n" }
}
$llm += "`n## Looks`n`n"
foreach ($k in $LookOrder) { $lh = LookOf $he $k; $lf = LookOf $fr $k; $llm += "- [" + $lh.name + " / " + $lf.name + "]($Base/look/" + $lh.slug + "/)`n" }
$llm += "`n## Guides`n`n- [" + $he.guideTitle + "]($Base/guide/)`n- [" + $fr.guideTitle + "]($Base/fr/guide/)`n- [Studio & quantity calculator]($Base/studio/)`n`n## Contact`n`n"
if ($Wa) { $llm += "- WhatsApp: +$Wa`n" }
if ($Site.phone) { $llm += "- Phone: " + $Site.phone + "`n" }
if ($Site.email) { $llm += "- Email: " + $Site.email + "`n" }
if ($Site.address) { $llm += "- Showroom: " + (SiteBy 'addressByLang' $en) + ", Israel`n- Opening hours: " + (SiteBy 'hoursByLang' $en) + "`n- Map: " + (MapUrl) + "`n" }
$llm += "- [Contact page]($Base/contact/)`n`n## Machine-readable data`n`n- [Products JSON]($Base/assets/data/products.json) (fields: id, r=reference, c=category, he/fr=name, s=size width-cm/length-m, p=price ILS incl. VAT or null)`n- [Sitemap]($Base/sitemap.xml)`n"
Write-Out 'llms.txt' $llm

# Google Merchant Center feed (products with a price only)
$sb = New-Object Text.StringBuilder
[void]$sb.Append('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>' + (Enc $BrandFull) + '</title><link>' + $Base + '/</link><description>' + (Enc $he.metaDescHome) + '</description>' + "`n")
foreach ($it in ($Items | Where-Object { $null -ne $_.p })) {
  $cat = CatOf $he $it.c
  [void]$sb.Append('<item><g:id>' + (Enc $it.slug) + '</g:id><g:title>' + (Enc ($it.he + ' ' + $it.ref)) + '</g:title><g:description>' + (Enc ($it.he + '. ' + (SizeText $he $it.s))) + '</g:description><g:link>' + (Abs $he ('p/' + $FamOf[$it.slug].slug + '/')) + $(if ($FamOf[$it.slug].n -gt 1) { '?v=' + $it.slug } else { '' }) + '</g:link><g:image_link>' + (ImgAbs $it.img) + '</g:image_link><g:availability>' + $(if ($it.oos) { 'preorder' } else { 'in_stock' }) + '</g:availability><g:price>' + $it.p + '.00 ILS</g:price><g:condition>new</g:condition><g:identifier_exists>no</g:identifier_exists><g:product_type>' + (Enc $cat.name) + '</g:product_type><g:mpn>' + (Enc $it.ref) + '</g:mpn></item>' + "`n")
}
[void]$sb.Append('</channel></rss>')
Write-Out 'merchant-feed.xml' $sb.ToString()

# Web manifest
$man = [ordered]@{ name = $BrandFull; short_name = $Brand; start_url = ($BasePath + '/'); display = 'standalone'; background_color = '#f3eee6'; theme_color = '#1b1916'; lang = 'he'; dir = 'rtl'; icons = @([ordered]@{ src = ($BasePath + '/favicon.svg'); sizes = 'any'; type = 'image/svg+xml' }, [ordered]@{ src = ($BasePath + '/assets/img/logo.png'); sizes = '512x512'; type = 'image/png' }) }
Write-Out 'manifest.webmanifest' (ConvertTo-Json -InputObject $man -Depth 5)

# Custom domain support
$host0 = ([Uri]$Base).Host
if ($host0 -and $host0 -notlike '*.github.io' -and $host0 -ne 'example.com') { Write-Out 'CNAME' $host0 }
Write-Out '.nojekyll' ''

$pages = @(Get-ChildItem -Recurse -Filter index.html $OutDir).Count
Write-Host ("Built {0} pages, {1} products, base {2}" -f $pages, $Items.Count, $Base)
if (-not $Wa -and -not $Site.phone -and -not $Site.email) { Write-Warning 'No contact details in data/site.json (whatsapp/phone/email): the quote list cannot be sent yet.' }
