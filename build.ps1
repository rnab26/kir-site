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
$Tax = Read-Json 'data/taxonomy.json'
$Raw = @(Read-Json 'data/products.json' | ForEach-Object { $_ })  # PS 5.1 emits JSON arrays as one object: unroll
$Dims = Read-Json 'data/images.json'
if ($SiteUrl) { $Site.baseUrl = $SiteUrl }
$Base = ([string]$Site.baseUrl).TrimEnd('/')
$BasePath = ([Uri]($Base + '/')).AbsolutePath.TrimEnd('/')
$Brand = [string]$Site.brand
$BrandFull = [string]$Site.brandFull
$Today = (Get-Date).ToString('yyyy-MM-dd')
$Ver = (Get-Date).ToString('yyyyMMddHHmm')
$Langs = @('he', 'fr')
$Wa = ([string]$Site.whatsapp) -replace '[^0-9]', ''

# ---------- products ----------
$seen = @{}
$Items = New-Object System.Collections.ArrayList
$i = 0
foreach ($p in $Raw) {
  $i++
  $skuRaw = ([string]$p.sku).Trim()
  $ref = if ($skuRaw) { $skuRaw } else { 'KIR-' + $i.ToString('000') }
  $core = ($ref.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
  if (-not $core) { $core = 'ref-' + $i }
  $slug = (P $Tax.catPrefix $p.c) + '-' + $core
  if ($seen.ContainsKey($slug)) { $n = 2; while ($seen.ContainsKey("$slug-$n")) { $n++ }; $slug = "$slug-$n" }
  $seen[$slug] = $true
  $he = [string]$p.he
  $looks = @(); foreach ($k in $Tax.lookOrder) { if ($he -match (P $Tax.looks $k)) { $looks += $k } }
  $colors = @(); foreach ($k in $Tax.colorOrder) { if ($he -match (P $Tax.colors $k)) { $colors += $k } }
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
    idx = $i; slug = $slug; ref = $ref; hasSku = [bool]$skuRaw; c = [string]$p.c; he = $he; fr = [string]$p.fr
    s = $s; f = [string]$p.f; p = $p.p; oos = [bool]$p.oos; img = [string]$p.img
    iw = $(if ($d) { $d.w } else { 400 }); ih = $(if ($d) { $d.h } else { 500 })
    looks = $looks; colors = $colors; mat = $mat; w = $w; l = $l; ppm2 = $ppm2; fl = [bool]$fl
  })
}
$ById = @{}; $BySlug = @{}; foreach ($it in $Items) { $ById[$it.img] = $it; $BySlug[$it.slug] = $it }
$CatOrder = @($Tax.catOrder | Where-Object { $c = $_; @($Items | Where-Object { $_.c -eq $c }).Count -gt 0 })
$LookOrder = @($Tax.lookOrder)

# ---------- url helpers ----------
function Rel($L, [string]$path) { [string]$L.prefix + $path }
function Href($L, [string]$path) { $BasePath + '/' + (Rel $L $path) }
function Abs($L, [string]$path) { $Base + '/' + (Rel $L $path) }
function AssetUrl([string]$p) { $BasePath + '/assets/' + $p }
function ImgUrl([string]$id) { $BasePath + '/assets/img/products/' + $id + '.jpg' }
function ImgAbs([string]$id) { $Base + '/assets/img/products/' + $id + '.jpg' }
function T($L, [string]$k) { [string](P $L.ui $k) }
function Other([string]$lang) { if ($lang -eq 'he') { 'fr' } else { 'he' } }
function Lc([string]$lang) { P $Content $lang }
function CatOf($L, [string]$c) { P $L.categories $c }
function LookOf($L, [string]$k) { P $L.looks $k }
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
  $q = ($it.he + ' ' + $it.fr + ' ' + $it.ref + ' ' + (P (CatOf $L $it.c) 'name')).ToLowerInvariant()
  $sz = SizeText $L $it.s
  $badge = if ($it.oos) { '<span class="badge">' + (Enc (T $L 'preorder')) + '</span>' } else { '' }
  $pp = if ($null -ne $it.p) { [string]$it.p } else { '' }
  $meta = '<span class="sku">' + (Enc $it.ref) + '</span>'
  if ($sz) { $meta += '<span>' + (Enc $sz) + '</span>' }
  return '<article class="card" data-c="' + $it.c + '" data-looks="' + ($it.looks -join ' ') + '" data-colors="' + ($it.colors -join ' ') + '" data-p="' + $pp + '" data-i="' + $it.idx + '" data-q="' + (Enc $q) + '">' +
    '<a class="card-media" href="' + $url + '" tabindex="-1" aria-hidden="true"><img src="' + (ImgUrl $it.img) + '" alt="" width="' + $it.iw + '" height="' + $it.ih + '" loading="lazy" decoding="async">' + $badge + '</a>' +
    '<div class="card-body"><' + $headTag + ' class="card-title"><a href="' + $url + '">' + (Enc $name) + '</a></' + $headTag + '>' +
    '<p class="card-meta">' + $meta + '</p>' +
    '<div class="card-foot">' + (PriceHtml $L $it) +
    '<button class="add" type="button" data-add="' + $it.slug + '" aria-label="' + (Enc ((T $L 'add') + ': ' + $name)) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div></div></article>'
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
function OrgLd($L) {
  $o = [ordered]@{ '@context' = 'https://schema.org'; '@type' = 'Organization'; '@id' = ($Base + '/#org'); name = $BrandFull; alternateName = @($Brand, [string]$Site.brandHe); url = ($Base + '/'); logo = ($Base + '/assets/img/logo.png'); description = (Fill ([string]$L.metaDescHome) @{ brand = $Brand }) }
  $same = @(); foreach ($k in @('instagram', 'facebook')) { $v = [string](P $Site $k); if ($v) { $same += $v } }
  if ($same.Count) { $o.sameAs = $same }
  if ($Site.phone -or $Site.email) {
    $cp = [ordered]@{ '@type' = 'ContactPoint'; contactType = 'customer service'; availableLanguage = @('Hebrew', 'French') }
    if ($Site.phone) { $cp.telephone = [string]$Site.phone }
    if ($Site.email) { $cp.email = [string]$Site.email }
    $o.contactPoint = $cp
  }
  if ($Site.address -and $Site.city) {
    $o['@type'] = 'HomeAndConstructionBusiness'
    $o.address = [ordered]@{ '@type' = 'PostalAddress'; streetAddress = [string]$Site.address; addressLocality = [string]$Site.city; addressCountry = 'IL' }
    if ($Site.phone) { $o.telephone = [string]$Site.phone }
    if ($Site.openingHours) { $o.openingHours = [string]$Site.openingHours }
  }
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
  wa = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.2-4.3A8.5 8.5 0 1 1 20.5 12Z"/><path d="M9 8.5c.3 2.6 2.4 5.2 5.5 6.3l1.3-1.3-2-1-1 .8c-1-.4-2-1.4-2.4-2.4l.8-1-1-2-1.2.6Z"/></svg>'
  arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
}

function HeaderHtml($L, [string]$path) {
  $o = Lc (Other $L.lang)
  $nav = ''
  foreach ($k in @(@('catalog', 'catalog/'), @('looks', 'looks/'), @('studio', 'studio/'), @('guide', 'guide/'), @('contact', 'contact/'))) {
    $cur = if ($path -eq $k[1]) { ' aria-current="page"' } else { '' }
    $nav += '<a href="' + (Href $L $k[1]) + '"' + $cur + '>' + (Enc (P $L.nav $k[0])) + '</a>'
  }
  '<header class="site-header" data-header><div class="wrap header-inner">' +
  '<a class="logo" href="' + (Href $L '') + '" aria-label="' + (Enc $BrandFull) + '"><span class="logo-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="logo-text">' + (Enc $Brand) + '<small>Wall Studio</small></span></a>' +
  '<nav class="nav" id="site-nav" aria-label="' + (Enc (T $L 'menu')) + '">' + $nav + '</nav>' +
  '<div class="header-actions"><a class="lang" href="' + (Href $o $path) + '" hreflang="' + $o.lang + '" lang="' + $o.lang + '">' + (Enc (T $L 'lang')) + '</a>' +
  '<a class="list-btn" href="' + (Href $L 'list/') + '" aria-label="' + (Enc (P $L.nav 'list')) + '">' + $Icons.list + '<span class="count" data-count hidden>0</span></a>' +
  '<button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav" data-menu><span class="sr">' + (Enc (T $L 'menu')) + '</span><i></i><i></i></button></div>' +
  '</div></header>'
}

$script:FooterCache = @{}
function FooterHtml($L, [string]$path) {
  $o = Lc (Other $L.lang)
  if (-not $script:FooterCache.ContainsKey($L.lang)) { $script:FooterCache[$L.lang] = FooterBuild $L '@@ALT@@' }
  return $script:FooterCache[$L.lang].Replace((Href $o '@@ALT@@'), (Href $o $path))
}
function FooterBuild($L, [string]$path) {
  $o = Lc (Other $L.lang)
  $cats = ''; foreach ($c in $CatOrder) { $cats += '<li><a href="' + (Href $L ('c/' + (P (CatOf $L $c) 'slug') + '/')) + '">' + (Enc (P (CatOf $L $c) 'name')) + '</a></li>' }
  $looks = ''; foreach ($k in $LookOrder) { $looks += '<li><a href="' + (Href $L ('look/' + (P (LookOf $L $k) 'slug') + '/')) + '">' + (Enc (P (LookOf $L $k) 'name')) + '</a></li>' }
  $contact = ''
  if ($Wa) { $contact += '<li><a href="https://wa.me/' + $Wa + '" rel="noopener">WhatsApp</a></li>' }
  if ($Site.phone) { $contact += '<li><a href="tel:' + (Enc $Site.phone) + '"><bdi>' + (Enc $Site.phone) + '</bdi></a></li>' }
  if ($Site.email) { $contact += '<li><a href="mailto:' + (Enc $Site.email) + '">' + (Enc $Site.email) + '</a></li>' }
  if ($Site.instagram) { $contact += '<li><a href="' + (Enc $Site.instagram) + '" rel="noopener">Instagram</a></li>' }
  if ($Site.facebook) { $contact += '<li><a href="' + (Enc $Site.facebook) + '" rel="noopener">Facebook</a></li>' }
  $contact += '<li><a href="' + (Href $L 'contact/') + '">' + (Enc (P $L.nav 'contact')) + '</a></li>'
  $contact += '<li><a href="' + (Href $o $path) + '" lang="' + $o.lang + '" hreflang="' + $o.lang + '">' + (Enc (T $L 'lang')) + '</a></li>'
  '<footer class="site-footer"><div class="footer-flutes" aria-hidden="true"></div><div class="wrap footer-grid">' +
  '<div class="footer-brand"><a class="logo logo-light" href="' + (Href $L '') + '"><span class="logo-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="logo-text">' + (Enc $Brand) + '<small>Wall Studio</small></span></a><p>' + (Enc $L.footer) + '</p></div>' +
  '<div><h2>' + (Enc (P $L.nav 'catalog')) + '</h2><ul>' + $cats + '</ul></div>' +
  '<div><h2>' + (Enc (P $L.nav 'looks')) + '</h2><ul>' + $looks + '</ul><h2>' + (Enc (P $L.nav 'guide')) + '</h2><ul><li><a href="' + (Href $L 'guide/') + '">' + (Enc $L.guideTitle) + '</a></li><li><a href="' + (Href $L 'studio/') + '">' + (Enc (P $L.studio 'title')) + '</a></li></ul></div>' +
  '<div><h2>' + (Enc (P $L.nav 'contact')) + '</h2><ul>' + $contact + '</ul></div>' +
  '</div><div class="wrap footer-bottom"><span>&copy; ' + (Get-Date).Year + ' ' + (Enc $BrandFull) + '</span><span>' + (Enc (T $L 'priceNote')) + '</span></div></footer>'
}

function Page($L, [hashtable]$pg) {
  $path = [string]$pg.path
  $o = Lc (Other $L.lang)
  $title = [string]$pg.title; $desc = [string]$pg.desc
  $canon = Abs $L $path
  $og = if ($pg.og) { [string]$pg.og } else { $Base + '/assets/img/og.jpg' }
  $ld = ''
  if ($pg.ld) { foreach ($x in @($pg.ld)) { if ($x) { $ld += '<script type="application/ld+json">' + (To-Json $x) + '</script>' } } }
  $robots = if ($pg.noindex) { '<meta name="robots" content="noindex,follow">' } else { '<meta name="robots" content="index,follow,max-image-preview:large">' }
  $verif = if ($Site.googleSiteVerification) { '<meta name="google-site-verification" content="' + (Enc $Site.googleSiteVerification) + '">' } else { '' }
  $cfg = [ordered]@{
    lang = $L.lang; base = $BasePath; prefix = [string]$L.prefix; wa = $Wa; brand = $Brand; v = $Ver
    data = (AssetUrl ('data/products.json?v=' + $Ver))
    t = [ordered]@{ add = (T $L 'add'); added = (T $L 'added'); onRequest = (T $L 'onRequest'); priceVat = (T $L 'priceVat'); qty = (T $L 'qty'); remove = (T $L 'remove'); sendWa = (T $L 'sendWa'); copy = (T $L 'copy'); copied = (T $L 'copied'); listIntro = (T $L 'listIntro'); listEmpty = (T $L 'listEmpty'); estTotal = (T $L 'estTotal'); noContact = (T $L 'noContact'); results = (T $L 'results'); cm = (T $L 'cm'); m = (T $L 'm'); sku = (T $L 'sku'); viewAll = (T $L 'viewAll'); units = (P $L.calc 'units'); tooTall = (P $L.calc 'tooTall'); noPrice = (P $L.calc 'noPrice'); waste = (P $L.calc 'waste'); preorder = (T $L 'preorder') }
  }
  $sb = New-Object Text.StringBuilder
  [void]$sb.Append('<!doctype html><html lang="' + $L.lang + '" dir="' + $L.dir + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">')
  [void]$sb.Append('<title>' + (Enc $title) + '</title><meta name="description" content="' + (Enc $desc) + '">' + $robots + $verif)
  [void]$sb.Append('<link rel="canonical" href="' + $canon + '">')
  if (-not $pg.noalt) {
    [void]$sb.Append('<link rel="alternate" hreflang="he" href="' + (Abs (Lc 'he') $path) + '"><link rel="alternate" hreflang="fr" href="' + (Abs (Lc 'fr') $path) + '"><link rel="alternate" hreflang="x-default" href="' + (Abs (Lc 'he') $path) + '">')
  }
  [void]$sb.Append('<meta property="og:type" content="' + $(if ($pg.ogType) { $pg.ogType } else { 'website' }) + '"><meta property="og:site_name" content="' + (Enc $BrandFull) + '"><meta property="og:title" content="' + (Enc $title) + '"><meta property="og:description" content="' + (Enc $desc) + '"><meta property="og:url" content="' + $canon + '"><meta property="og:image" content="' + $og + '"><meta property="og:locale" content="' + $L.locale + '"><meta property="og:locale:alternate" content="' + $o.locale + '"><meta name="twitter:card" content="summary_large_image">')
  [void]$sb.Append('<meta name="theme-color" content="#1b1916"><link rel="icon" href="' + $BasePath + '/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="' + (AssetUrl 'img/logo.png') + '"><link rel="manifest" href="' + $BasePath + '/manifest.webmanifest">')
  [void]$sb.Append('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;600;700&family=Frank+Ruhl+Libre:wght@400;500;700&display=swap">')
  [void]$sb.Append('<link rel="stylesheet" href="' + (AssetUrl ('css/style.css?v=' + $Ver)) + '">' + $ld + '</head>')
  [void]$sb.Append('<body class="' + [string]$pg.cls + '"><a class="skip" href="#main">' + (Enc (T $L 'skip')) + '</a>')
  [void]$sb.Append((HeaderHtml $L $path))
  [void]$sb.Append('<main id="main">' + [string]$pg.body + '</main>')
  [void]$sb.Append((FooterHtml $L $path))
  [void]$sb.Append('<div class="toast" role="status" aria-live="polite" data-toast></div>')
  [void]$sb.Append('<script>window.KIR=' + (To-Json $cfg) + ';</script><script src="' + (AssetUrl ('js/app.js?v=' + $Ver)) + '" defer></script></body></html>')
  Write-Out ((Rel $L $path) + 'index.html') $sb.ToString()
}

function SectionHead([string]$title, [string]$lead, [string]$kicker = '', [string]$tag = 'h2') {
  $k = if ($kicker) { '<p class="kicker">' + (Enc $kicker) + '</p>' } else { '' }
  $ld = if ($lead) { '<p class="lead">' + (Enc $lead) + '</p>' } else { '' }
  '<div class="section-head reveal">' + $k + '<' + $tag + '>' + (Enc $title) + '</' + $tag + '>' + $ld + '</div>'
}

function StudioHtml($L, $first, [string]$tag = 'h2') {
  $S = $L.studio
  $ids = New-Object System.Collections.ArrayList
  if ($first) { [void]$ids.Add($first.img) }
  foreach ($id in $Tax.studioSwatches) { if (-not $ids.Contains($id)) { [void]$ids.Add($id) } }
  $sw = ''; $k = 0
  foreach ($id in $ids) {
    $it = $ById[$id]; if (-not $it) { continue }
    $sel = if ($k -eq 0) { 'true' } else { 'false' }
    $sw += '<button type="button" class="swatch" role="radio" aria-checked="' + $sel + '" data-tex="' + (ImgUrl $it.img) + '" data-flute="' + $(if ($it.fl) { '1' } else { '0' }) + '" title="' + (Enc (NameOf $L $it)) + '"><img src="' + (ImgUrl $it.img) + '" alt="' + (Enc (NameOf $L $it)) + '" width="56" height="70" loading="lazy"></button>'
    $k++
  }
  $f0 = $ById[$ids[0]]
  '<section class="studio" id="studio"><div class="wrap studio-grid">' +
  '<div class="studio-copy reveal"><p class="kicker">' + (Enc (P $L.nav 'studio')) + '</p><' + $tag + '>' + (Enc $S.title) + '</' + $tag + '><p class="lead">' + (Enc $S.lead) + '</p>' +
  '<p class="label" id="sw-label">' + (Enc $S.pick) + '</p><div class="swatches" role="radiogroup" aria-labelledby="sw-label" data-swatches>' + $sw + '</div>' +
  '<div class="studio-controls"><div class="seg" role="group"><button type="button" aria-pressed="true" data-mode="back">' + (Enc $S.wallBack) + '</button><button type="button" aria-pressed="false" data-mode="all">' + (Enc $S.wallAll) + '</button></div>' +
  '<div class="seg" role="group"><button type="button" aria-pressed="true" data-light="day">' + (Enc $S.day) + '</button><button type="button" aria-pressed="false" data-light="evening">' + (Enc $S.evening) + '</button></div>' +
  '<label class="check"><input type="checkbox" data-flutes' + $(if ($f0.fl) { ' checked' } else { '' }) + '> ' + (Enc $S.flutes) + '</label></div>' +
  '<p class="note">' + (Enc (T $L 'illustration')) + '</p></div>' +
  '<div class="room reveal" data-room data-mode="back" data-light="day" data-flute="' + $(if ($f0.fl) { '1' } else { '0' }) + '" style="--tex:url(' + (ImgUrl $f0.img) + ')" aria-hidden="true"><div class="stage"><div class="scene">' +
  '<div class="w back"><span class="glow"></span></div><div class="w left"><span class="window"></span></div><div class="w right"></div><div class="floor"></div><div class="ceil"><span class="strip"></span></div>' +
  '<div class="prop sofa"><i class="sb"></i><i class="seat"></i><i class="arm a1"></i><i class="arm a2"></i><i class="cushion"></i></div><div class="prop table"><i></i></div><div class="prop lamp"><i class="shade"></i><i class="pole"></i></div><div class="prop plant"><i class="pot"></i><i class="leaf l1"></i><i class="leaf l2"></i><i class="leaf l3"></i></div>' +
  '</div></div><div class="light-sweep"></div></div>' +
  '</div></section>'
}

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
  '<output class="calc-out full" data-out aria-live="polite"><span class="k">' + (Enc $C.result) + '</span><strong data-n>-</strong><span data-unit>' + (Enc $C.units) + '</span><span class="k">' + (Enc $C.cost) + '</span><strong data-cost>-</strong><small data-note>' + (Enc $C.waste) + '</small></output>' +
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
    $cnt = @($Items | Where-Object { $_.looks -contains $k }).Count
    $t += '<a class="mat reveal" href="' + (Href $L ('look/' + $lk.slug + '/')) + '" style="--img:url(' + (ImgUrl (P $Tax.lookCover $k)) + ')"><span class="mat-tex" aria-hidden="true"></span><span class="mat-sheen" aria-hidden="true"></span><span class="mat-body"><' + $tag + '>' + (Enc $lk.name) + '</' + $tag + '><span>' + $cnt + ' ' + (Enc (T $L 'products')) + '</span></span></a>'
  }
  '<div class="mats" data-tilt>' + $t + '</div>'
}

function CatTiles($L) {
  $t = ''
  foreach ($c in $CatOrder) {
    $cat = CatOf $L $c
    $list = @($Items | Where-Object { $_.c -eq $c })
    $cover = $list[0]
    $t += '<a class="cat reveal" href="' + (Href $L ('c/' + $cat.slug + '/')) + '"><img src="' + (ImgUrl $cover.img) + '" alt="" width="' + $cover.iw + '" height="' + $cover.ih + '" loading="lazy"><span><strong>' + (Enc $cat.name) + '</strong><em>' + $list.Count + '</em></span></a>'
  }
  '<div class="cats">' + $t + '</div>'
}

function FilterBar($L, [string[]]$cats) {
  $chip = { param($group, $val, $label) '<button type="button" class="chip" data-f="' + $group + '" data-v="' + $val + '" aria-pressed="false">' + (Enc $label) + '</button>' }
  $c = ''; if ($cats.Count -gt 1) { foreach ($k in $cats) { $c += & $chip 'c' $k (P (CatOf $L $k) 'name') } }
  $lk = ''; foreach ($k in $LookOrder) { if ($k -ne 'black' -and $k -ne 'white') { $lk += & $chip 'look' $k (P (LookOf $L $k) 'name') } }
  $co = ''; foreach ($k in $Tax.colorOrder) { $co += '<button type="button" class="chip chip-color" data-f="color" data-v="' + $k + '" aria-pressed="false"><i class="dot dot-' + $k + '" aria-hidden="true"></i>' + (Enc (P $L.colors $k)) + '</button>' }
  $rows = ''
  if ($c) { $rows += '<div class="frow"><span class="flabel">' + (Enc (T $L 'category')) + '</span><div class="chips">' + $c + '</div></div>' }
  $rows += '<div class="frow"><span class="flabel">' + (Enc (T $L 'look')) + '</span><div class="chips">' + $lk + '</div></div>'
  $rows += '<div class="frow"><span class="flabel">' + (Enc (T $L 'color')) + '</span><div class="chips">' + $co + '</div></div>'
  '<div class="filters wrap" data-filters><div class="ftop"><label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" placeholder="' + (Enc (T $L 'search')) + '" aria-label="' + (Enc (T $L 'search')) + '" data-q></label>' +
  '<label class="sort"><span class="sr">' + (Enc (T $L 'sort')) + '</span><select data-sort><option value="">' + (Enc (T $L 'sortDefault')) + '</option><option value="asc">' + (Enc (T $L 'sortPriceAsc')) + '</option><option value="desc">' + (Enc (T $L 'sortPriceDesc')) + '</option></select></label></div>' + $rows +
  '<div class="fstat"><span><strong data-n></strong> ' + (Enc (T $L 'results')) + '</span><button type="button" class="link" data-clear hidden>' + (Enc (T $L 'clear')) + '</button></div><p class="empty" data-empty hidden>' + (Enc (T $L 'noResults')) + '</p></div>'
}

function Band([string]$kicker, [string]$title, [string]$lead, [int]$count = -1, $L = $null) {
  $c = if ($count -ge 0) { '<span class="band-count">' + $count + ' ' + (Enc (T $L 'products')) + '</span>' } else { '' }
  '<section class="band"><div class="band-flutes" aria-hidden="true"></div><div class="wrap"><p class="kicker">' + (Enc $kicker) + '</p><h1>' + (Enc $title) + '</h1>' + $(if ($lead) { '<p class="lead">' + (Enc $lead) + '</p>' } else { '' }) + $c + '</div></section>'
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
  $catIndex = @{}; foreach ($c in $CatOrder) { $catIndex[$c] = @($Items | Where-Object { $_.c -eq $c }) }

  # Home
  $feat = @(); foreach ($id in $Tax.featured) { if ($ById[$id]) { $feat += $ById[$id] } }
  $stats = ''
  foreach ($s in $L.stats) { $stats += '<li><strong>' + (Enc (Fill ([string]$s[0]) @{ count = $Items.Count; cats = $CatOrder.Count })) + '</strong><span>' + (Enc $s[1]) + '</span></li>' }
  $steps = ''; $n = 0
  foreach ($s in $L.steps.items) { $n++; $steps += '<li class="reveal"><span class="num">0' + $n + '</span><h3>' + (Enc $s[0]) + '</h3><p>' + (Enc $s[1]) + '</p></li>' }
  $hero = '<section class="hero" data-hero style="--tex:url(' + (ImgUrl $Tax.lookCover.travertine) + ')"><div class="hero-wall" aria-hidden="true"><div class="hw-tex"></div><div class="hw-flutes"></div><div class="hw-light"></div><div class="hw-vignette"></div></div>' +
    '<div class="hero-tiles" aria-hidden="true"><span style="--img:url(' + (ImgUrl $Tax.lookCover.marble) + ')"></span><span style="--img:url(' + (ImgUrl $Tax.lookCover.wood) + ')"></span><span style="--img:url(' + (ImgUrl $Tax.lookCover.black) + ')"></span></div>' +
    '<div class="wrap hero-content"><p class="kicker">' + (Enc $L.hero.kicker) + '</p><h1>' + (Enc $L.hero.h1) + '<span class="h1-tag">' + (Enc $L.tagline) + '</span></h1><p class="lead">' + (Enc $L.hero.lead) + '</p>' +
    '<div class="ctas"><a class="btn btn-light" href="' + (Href $L 'catalog/') + '">' + (Enc $L.hero.cta) + $Icons.arrow + '</a><a class="btn btn-ghost" href="#studio">' + (Enc $L.hero.cta2) + '</a></div><ul class="stats">' + $stats + '</ul></div><div class="scroll-cue" aria-hidden="true"></div></section>'
  $body = $hero +
    '<section class="materials"><div class="wrap">' + (SectionHead $L.materialsTitle $L.materialsLead (P $L.nav 'looks')) + (LookTiles $L) + '</div></section>' +
    (StudioHtml $L $null) +
    '<section class="featured"><div class="wrap">' + (SectionHead $L.featured '' (P $L.nav 'catalog')) + (Grid $L $feat) + '<p class="center"><a class="btn" href="' + (Href $L 'catalog/') + '">' + (Enc (T $L 'viewAll')) + ' (' + $Items.Count + ')' + $Icons.arrow + '</a></p></div></section>' +
    '<section class="categories"><div class="wrap">' + (SectionHead $L.catalogTitle '' (P $L.nav 'catalog')) + (CatTiles $L) + '</div></section>' +
    '<section class="steps"><div class="wrap">' + (SectionHead $L.steps.title '') + '<ol class="steps-list">' + $steps + '</ol></div></section>' +
    (FaqHtml $L)
  $web = [ordered]@{ '@context' = 'https://schema.org'; '@type' = 'WebSite'; '@id' = ($Base + '/#web'); name = $BrandFull; url = ($Base + '/'); inLanguage = @('he', 'fr'); publisher = @{ '@id' = ($Base + '/#org') } }
  Page $L @{ path = ''; title = (Fill $L.metaTitleHome @{ brand = $Brand }); desc = $L.metaDescHome; body = $body; cls = 'home'; ld = @((OrgLd $L), $web, (FaqLd $L)) }
  if ($lang -eq 'he') { AddUrl '' '1.0' }

  # Catalog
  $body = (Band (P $L.nav 'catalog') $L.catalogTitle $L.catalogDesc $Items.Count $L) + (FilterBar $L $CatOrder) + '<section class="listing"><div class="wrap">' + (Grid $L $Items 'h2') + '</div></section>'
  $crumb = @(@((T $L 'home'), ''), @($L.catalogTitle, 'catalog/'))
  Page $L @{ path = 'catalog/'; title = ($L.catalogTitle + ' | ' + $Brand); desc = $L.catalogDesc; body = (CrumbHtml $L $crumb) + $body; cls = 'catalog'; ld = @((CrumbLd $L $crumb), (ItemListLd $L $Items)) }
  if ($lang -eq 'he') { AddUrl 'catalog/' '0.9' }

  # Categories
  foreach ($c in $CatOrder) {
    $cat = CatOf $L $c; $list = $catIndex[$c]
    $others = ''; foreach ($k in $CatOrder) { if ($k -ne $c) { $others += '<a class="pill" href="' + (Href $L ('c/' + (P (CatOf $L $k) 'slug') + '/')) + '">' + (Enc (P (CatOf $L $k) 'name')) + '</a>' } }
    $crumb = @(@((T $L 'home'), ''), @($L.catalogTitle, 'catalog/'), @($cat.name, ('c/' + $cat.slug + '/')))
    $extra = ''
    if ($c -eq 'slat' -or $c -eq 'panel' -or $c -eq 'flex') { $extra = (CalcHtml $L ($list | Where-Object { $_.w -and $_.l } | Select-Object -First 1)) }
    $body = (CrumbHtml $L $crumb) + (Band (P $L.nav 'catalog') $cat.title $cat.intro $list.Count $L) + (FilterBar $L @($c)) + '<section class="listing"><div class="wrap">' + (Grid $L $list 'h2') + '</div></section>' + $extra + '<section class="more"><div class="wrap"><div class="pills">' + $others + '</div></div></section>'
    $desc = $cat.intro
    Page $L @{ path = ('c/' + $cat.slug + '/'); title = ($cat.title + ' | ' + $Brand); desc = $desc; body = $body; cls = 'category'; og = (ImgAbs $list[0].img); ld = @((CrumbLd $L $crumb), (ItemListLd $L $list)) }
    if ($lang -eq 'he') { AddUrl ('c/' + $cat.slug + '/') '0.8' }
  }

  # Looks index + looks
  $crumb = @(@((T $L 'home'), ''), @($L.looksTitle, 'looks/'))
  $body = (CrumbHtml $L $crumb) + (Band (P $L.nav 'looks') $L.looksTitle $L.materialsLead -1 $L) + '<section class="materials"><div class="wrap">' + (LookTiles $L 'h2') + '</div></section>' + (StudioHtml $L $null)
  Page $L @{ path = 'looks/'; title = ($L.looksTitle + ' | ' + $Brand); desc = $L.materialsLead; body = $body; cls = 'looks'; ld = @((CrumbLd $L $crumb)) }
  if ($lang -eq 'he') { AddUrl 'looks/' '0.7' }
  foreach ($k in $LookOrder) {
    $lk = LookOf $L $k
    $list = @($Items | Where-Object { $_.looks -contains $k })
    if (-not $list.Count) { continue }
    $cats = @($CatOrder | Where-Object { $cc = $_; @($list | Where-Object { $_.c -eq $cc }).Count -gt 0 })
    $others = ''; foreach ($j in $LookOrder) { if ($j -ne $k) { $others += '<a class="pill" href="' + (Href $L ('look/' + (P (LookOf $L $j) 'slug') + '/')) + '">' + (Enc (P (LookOf $L $j) 'name')) + '</a>' } }
    $crumb = @(@((T $L 'home'), ''), @($L.looksTitle, 'looks/'), @($lk.name, ('look/' + $lk.slug + '/')))
    $first = $ById[(P $Tax.lookCover $k)]
    $body = (CrumbHtml $L $crumb) + (Band (P $L.nav 'looks') $lk.title $lk.intro $list.Count $L) + (FilterBar $L $cats) + '<section class="listing"><div class="wrap">' + (Grid $L $list 'h2') + '</div></section>' + (StudioHtml $L $first) + '<section class="more"><div class="wrap"><div class="pills">' + $others + '</div></div></section>'
    Page $L @{ path = ('look/' + $lk.slug + '/'); title = ($lk.title + ' | ' + $Brand); desc = $lk.intro; body = $body; cls = 'look'; og = (ImgAbs $first.img); ld = @((CrumbLd $L $crumb), (ItemListLd $L $list)) }
    if ($lang -eq 'he') { AddUrl ('look/' + $lk.slug + '/') '0.8' }
  }

  # Products
  foreach ($it in $Items) {
    $cat = CatOf $L $it.c
    $name = NameOf $L $it
    $sz = SizeText $L $it.s
    $crumb = @(@((T $L 'home'), ''), @($cat.name, ('c/' + $cat.slug + '/')), @($name, ('p/' + $it.slug + '/')))
    $specs = ''
    $specs += '<div><dt>' + (Enc $(if ($it.hasSku) { T $L 'sku' } else { T $L 'ref' })) + '</dt><dd><bdi>' + (Enc $it.ref) + '</bdi></dd></div>'
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
    $waText = (T $L 'listIntro') + ' ' + $name + ' (' + $it.ref + ') ' + (Abs $L ('p/' + $it.slug + '/'))
    $ask = if ($Wa) { '<a class="btn btn-ghost-dark" href="https://wa.me/' + $Wa + '?text=' + [Uri]::EscapeDataString($waText) + '" rel="noopener">' + $Icons.wa + (Enc (T $L 'ask')) + '</a>' } else { '' }
    $rel = New-Object System.Collections.ArrayList
    foreach ($o in $catIndex[$it.c]) {
      if ($rel.Count -ge 8) { break }
      if ($o.slug -eq $it.slug) { continue }
      $share = ($it.looks.Count -eq 0)
      foreach ($k in $o.looks) { if ($it.looks -contains $k) { $share = $true; break } }
      if ($share) { [void]$rel.Add($o) }
    }
    if ($rel.Count -lt 4) { $rel = New-Object System.Collections.ArrayList; foreach ($o in $catIndex[$it.c]) { if ($rel.Count -ge 8) { break }; if ($o.slug -ne $it.slug) { [void]$rel.Add($o) } } }
    $pd = '<section class="product wrap"><div class="pd-media reveal"><div class="zoom" data-zoom style="--img:url(' + (ImgUrl $it.img) + ')"><img src="' + (ImgUrl $it.img) + '" alt="' + (Enc $name) + '" width="' + $it.iw + '" height="' + $it.ih + '" fetchpriority="high"></div></div>' +
      '<div class="pd-info"><p class="kicker"><a href="' + (Href $L ('c/' + $cat.slug + '/')) + '">' + (Enc $cat.name) + '</a></p><h1>' + (Enc $name) + '</h1>' + $avail +
      '<div class="pd-price">' + (PriceHtml $L $it) + $m2 + '</div><dl class="specs">' + $specs + '</dl>' +
      '<div class="pd-actions"><button type="button" class="btn btn-dark" data-add="' + $it.slug + '" data-label>' + (Enc (T $L 'add')) + '</button>' + $ask + '<a class="btn btn-ghost-dark" href="#studio">' + (Enc (T $L 'seeOnWall')) + '</a></div>' +
      '<p class="note">' + (Enc (T $L 'priceNote')) + ' ' + (Enc (T $L 'illustration')) + '</p></div></section>'
    $calc = if ($it.w -and $it.l -and $it.l -lt 10 -and ($it.c -eq 'slat' -or $it.c -eq 'panel' -or $it.c -eq 'flex' -or $it.c -eq 'stone')) { CalcHtml $L $it } else { '' }
    $relHtml = if ($rel.Count) { '<section class="related"><div class="wrap">' + (SectionHead (T $L 'related') '') + (Grid $L $rel) + '</div></section>' } else { '' }
    $studio = if ($it.c -in @('slat', 'panel', 'flex', 'deco', 'stone', 'outdoor')) { StudioHtml $L $it } else { '' }
    $body = (CrumbHtml $L $crumb) + $pd + $studio + $calc + $relHtml
    $sizePart = if ($sz) { (T $L 'size') + ': ' + $sz + '. ' } else { '' }
    $pricePart = if ($null -ne $it.p) { (PriceText $L $it) + ' ' + (T $L 'priceVat') + '.' } else { (T $L 'onRequest') + '.' }
    $desc = Fill $L.productDesc @{ name = $name; size = $sizePart; price = $pricePart }
    $title = Fill $L.productTitle @{ name = $name; sku = $it.ref; brand = $Brand }
    $ld = @((CrumbLd $L $crumb))
    if ($null -ne $it.p) {
      $prod = [ordered]@{ '@context' = 'https://schema.org'; '@type' = 'Product'; name = $name; sku = $it.ref; image = @((ImgAbs $it.img)); description = $desc; category = $cat.name; url = (Abs $L ('p/' + $it.slug + '/')) }
      if ($it.slug -like 'adhesive-homey*') { $prod.brand = [ordered]@{ '@type' = 'Brand'; name = 'HOMEY' } }
      $prod.offers = [ordered]@{ '@type' = 'Offer'; price = [string]$it.p; priceCurrency = 'ILS'; availability = $(if ($it.oos) { 'https://schema.org/PreOrder' } else { 'https://schema.org/InStock' }); itemCondition = 'https://schema.org/NewCondition'; url = (Abs $L ('p/' + $it.slug + '/')); seller = @{ '@id' = ($Base + '/#org') } }
      if ($it.w -and $it.l -and $it.l -lt 10) { $prod.width = [ordered]@{ '@type' = 'QuantitativeValue'; value = $it.w; unitCode = 'CMT' }; $prod.depth = [ordered]@{ '@type' = 'QuantitativeValue'; value = $it.l; unitCode = 'MTR' } }
      $ld += $prod
    }
    Page $L @{ path = ('p/' + $it.slug + '/'); title = $title; desc = $desc; body = $body; cls = 'product-page'; og = (ImgAbs $it.img); ogType = 'product'; ld = $ld }
    if ($lang -eq 'he') { AddUrl ('p/' + $it.slug + '/') '0.6' }
  }

  # Studio + calculator page
  $crumb = @(@((T $L 'home'), ''), @((P $L.studio 'title'), 'studio/'))
  $body = (CrumbHtml $L $crumb) + (Band (P $L.nav 'studio') (P $L.studio 'title') (P $L.studio 'lead') -1 $L) + (StudioHtml $L $null 'h2') + (CalcHtml $L $null)
  Page $L @{ path = 'studio/'; title = ((P $L.studio 'title') + ' - ' + (P $L.calc 'title') + ' | ' + $Brand); desc = ((P $L.studio 'lead') + ' ' + (P $L.calc 'lead')); body = $body; cls = 'studio-page'; ld = @((CrumbLd $L $crumb)) }
  if ($lang -eq 'he') { AddUrl 'studio/' '0.7' }

  # Guide
  $g = ''; $toc = ''; $n = 0
  foreach ($sec in $L.guide) { $n++; $toc += '<li><a href="#g' + $n + '">' + (Enc $sec[0]) + '</a></li>'; $g += '<section class="g-sec reveal" id="g' + $n + '"><h2>' + (Enc $sec[0]) + '</h2>' + [string]$sec[1] + '</section>' }
  $crumb = @(@((T $L 'home'), ''), @($L.guideTitle, 'guide/'))
  $article = [ordered]@{ '@context' = 'https://schema.org'; '@type' = 'Article'; headline = $L.guideTitle; description = $L.guideDesc; inLanguage = $L.lang; datePublished = $Today; dateModified = $Today; author = @{ '@id' = ($Base + '/#org') }; publisher = @{ '@id' = ($Base + '/#org') }; mainEntityOfPage = (Abs $L 'guide/') }
  $body = (CrumbHtml $L $crumb) + (Band (P $L.nav 'guide') $L.guideTitle $L.guideDesc -1 $L) + '<div class="wrap guide"><nav class="toc" aria-label="TOC"><ol>' + $toc + '</ol></nav><article class="prose">' + $g + '</article></div>' + (CalcHtml $L $null) + (FaqHtml $L)
  Page $L @{ path = 'guide/'; title = ($L.guideTitle + ' | ' + $Brand); desc = $L.guideDesc; body = $body; cls = 'guide-page'; ogType = 'article'; ld = @((CrumbLd $L $crumb), $article, (FaqLd $L)) }
  if ($lang -eq 'he') { AddUrl 'guide/' '0.7' }

  # Contact
  $lines = ''
  if ($Wa) { $lines += '<a class="contact-card" href="https://wa.me/' + $Wa + '" rel="noopener">' + $Icons.wa + '<strong>WhatsApp</strong><bdi>+' + $Wa + '</bdi></a>' }
  if ($Site.phone) { $lines += '<a class="contact-card" href="tel:' + (Enc $Site.phone) + '"><strong>Tel</strong><bdi>' + (Enc $Site.phone) + '</bdi></a>' }
  if ($Site.email) { $lines += '<a class="contact-card" href="mailto:' + (Enc $Site.email) + '"><strong>Email</strong><span>' + (Enc $Site.email) + '</span></a>' }
  if ($Site.address) { $lines += '<div class="contact-card"><strong>' + (Enc $Site.city) + '</strong><span>' + (Enc $Site.address) + '</span>' + $(if ($Site.openingHours) { '<small>' + (Enc $Site.openingHours) + '</small>' } else { '' }) + '</div>' }
  if (-not $lines) { $lines = '<p class="pending">' + (Enc $L.contactPending) + '</p>' }
  $crumb = @(@((T $L 'home'), ''), @($L.contactTitle, 'contact/'))
  $body = (CrumbHtml $L $crumb) + (Band (P $L.nav 'contact') $L.contactTitle $L.contactDesc -1 $L) + '<section class="contact"><div class="wrap contact-grid">' + $lines + '</div></section>' + (FaqHtml $L)
  Page $L @{ path = 'contact/'; title = ($L.contactTitle + ' | ' + $Brand); desc = $L.contactDesc; body = $body; cls = 'contact-page'; ld = @((CrumbLd $L $crumb), (OrgLd $L)) }
  if ($lang -eq 'he') { AddUrl 'contact/' '0.6' }

  # Quote list (not indexed)
  $body = (Band (P $L.nav 'list') (T $L 'listTitle') $L.listDesc -1 $L) + '<section class="quote"><div class="wrap narrow"><div data-list><noscript><p>JavaScript</p></noscript></div></div></section>'
  Page $L @{ path = 'list/'; title = ((T $L 'listTitle') + ' | ' + $Brand); desc = $L.listDesc; body = $body; cls = 'list-page'; noindex = $true }
}

# 404 (root, bilingual)
$he = Lc 'he'; $fr = Lc 'fr'
$nf = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>404 | ' + (Enc $Brand) + '</title><meta name="robots" content="noindex"><link rel="icon" href="' + $BasePath + '/favicon.svg"><link rel="stylesheet" href="' + (AssetUrl ('css/style.css?v=' + $Ver)) + '"></head><body class="nf"><main class="nf-main"><div class="band-flutes" aria-hidden="true"></div><div class="wrap"><p class="kicker">404</p><h1>' + (Enc $he.notFound) + '</h1><p class="lead">' + (Enc $he.notFoundLead) + '</p><p><a class="btn btn-light" href="' + (Href $he 'catalog/') + '">' + (Enc (P $he.nav 'catalog')) + '</a></p><hr><div lang="fr" dir="ltr"><h2>' + (Enc $fr.notFound) + '</h2><p class="lead">' + (Enc $fr.notFoundLead) + '</p><p><a class="btn btn-light" href="' + (Href $fr 'catalog/') + '">' + (Enc (P $fr.nav 'catalog')) + '</a></p></div></div></main></body></html>'
Write-Out '404.html' $nf

# Client data (public fields only)
$pub = New-Object System.Collections.ArrayList
foreach ($it in $Items) {
  [void]$pub.Add([ordered]@{ id = $it.slug; r = $it.ref; c = $it.c; he = $it.he; fr = $it.fr; s = $it.s; w = $it.w; l = $it.l; p = $it.p; img = $it.img; oos = $it.oos; fl = $it.fl })
}
Write-Out 'assets/data/products.json' (ConvertTo-Json -InputObject @($pub) -Depth 5 -Compress)

# Sitemap with hreflang alternates
$sb = New-Object Text.StringBuilder
[void]$sb.Append('<?xml version="1.0" encoding="UTF-8"?>' + "`n" + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' + "`n")
foreach ($u in $sitemap) {
  $path = $u[0]; $prio = $u[1]
  $img = ''
  if ($path -like 'p/*') { $sl = $path.Substring(2).TrimEnd('/'); $it = $BySlug[$sl]; if ($it) { $img = '<image:image><image:loc>' + (ImgAbs $it.img) + '</image:loc></image:image>' } }
  foreach ($lang in $Langs) {
    $L = Lc $lang
    [void]$sb.Append('<url><loc>' + (Abs $L $path) + '</loc><lastmod>' + $Today + '</lastmod><priority>' + $prio + '</priority>')
    [void]$sb.Append('<xhtml:link rel="alternate" hreflang="he" href="' + (Abs $he $path) + '"/><xhtml:link rel="alternate" hreflang="fr" href="' + (Abs $fr $path) + '"/><xhtml:link rel="alternate" hreflang="x-default" href="' + (Abs $he $path) + '"/>' + $img + '</url>' + "`n")
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
$llm += "Languages: Hebrew (default, $Base/) and French ($Base/fr/). Prices are in ILS and include Israeli VAT. Products without a listed price are quoted on request.`n`n"
$llm += "## Catalog`n`n- [Full catalog (he)]($Base/catalog/): " + $Items.Count + " products`n- [Catalogue complet (fr)]($Base/fr/catalog/)`n"
foreach ($c in $CatOrder) { $ch = CatOf $he $c; $cf = CatOf $fr $c; $llm += "- [" + $ch.name + " / " + $cf.name + "]($Base/c/" + $ch.slug + "/): " + @($Items | Where-Object { $_.c -eq $c }).Count + " products. " + $cf.intro + "`n" }
$llm += "`n## Looks`n`n"
foreach ($k in $LookOrder) { $lh = LookOf $he $k; $lf = LookOf $fr $k; $llm += "- [" + $lh.name + " / " + $lf.name + "]($Base/look/" + $lh.slug + "/)`n" }
$llm += "`n## Guides`n`n- [" + $he.guideTitle + "]($Base/guide/)`n- [" + $fr.guideTitle + "]($Base/fr/guide/)`n- [Studio & quantity calculator]($Base/studio/)`n`n## Contact`n`n"
if ($Wa) { $llm += "- WhatsApp: +$Wa`n" }
if ($Site.phone) { $llm += "- Phone: " + $Site.phone + "`n" }
if ($Site.email) { $llm += "- Email: " + $Site.email + "`n" }
if ($Site.city) { $llm += "- Location: " + $Site.city + ", Israel`n" }
$llm += "- [Contact page]($Base/contact/)`n`n## Machine-readable data`n`n- [Products JSON]($Base/assets/data/products.json) (fields: id, r=reference, c=category, he/fr=name, s=size width-cm/length-m, p=price ILS incl. VAT or null)`n- [Sitemap]($Base/sitemap.xml)`n"
Write-Out 'llms.txt' $llm

# Google Merchant Center feed (products with a price only)
$sb = New-Object Text.StringBuilder
[void]$sb.Append('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>' + (Enc $BrandFull) + '</title><link>' + $Base + '/</link><description>' + (Enc $he.metaDescHome) + '</description>' + "`n")
foreach ($it in ($Items | Where-Object { $null -ne $_.p })) {
  $cat = CatOf $he $it.c
  [void]$sb.Append('<item><g:id>' + (Enc $it.slug) + '</g:id><g:title>' + (Enc ($it.he + ' ' + $it.ref)) + '</g:title><g:description>' + (Enc ($it.he + '. ' + (SizeText $he $it.s))) + '</g:description><g:link>' + (Abs $he ('p/' + $it.slug + '/')) + '</g:link><g:image_link>' + (ImgAbs $it.img) + '</g:image_link><g:availability>' + $(if ($it.oos) { 'preorder' } else { 'in_stock' }) + '</g:availability><g:price>' + $it.p + '.00 ILS</g:price><g:condition>new</g:condition><g:identifier_exists>no</g:identifier_exists><g:product_type>' + (Enc $cat.name) + '</g:product_type><g:mpn>' + (Enc $it.ref) + '</g:mpn></item>' + "`n")
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
