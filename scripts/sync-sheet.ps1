# Syncs data/products.json with the public tab of the Google Sheet (published as CSV).
# - new rows -> new products (category from the sheet, French auto-translated, flagged frAuto)
# - changed cells (price, size, stock note, description...) -> applied; untouched cells keep site edits
# - rows removed from the sheet -> removed from the site
# - downloads the sheet photo of new products (public IMAGE links)
# Usage: pwsh scripts/sync-sheet.ps1 [-CsvUrl <published csv url>] [-CsvPath file.csv]
# Keep this file ASCII-only (Hebrew text lives in data/*.json).
param([string]$CsvUrl = $env:SHEET_CSV_URL, [string]$CsvPath = '', [string]$Root = '')
$ErrorActionPreference = 'Stop'
$Inv = [Globalization.CultureInfo]::InvariantCulture
[Threading.Thread]::CurrentThread.CurrentCulture = $Inv
$root = if ($Root) { $Root } else { Split-Path -Parent $PSScriptRoot }
$utf8 = New-Object Text.UTF8Encoding($false)
function ReadJsonFile([string]$rel) { Get-Content -Raw -Encoding UTF8 (Join-Path $root $rel) | ConvertFrom-Json }
function P($o, [string]$n) { if ($null -eq $o) { return $null }; $x = $o.PSObject.Properties[$n]; if ($x) { $x.Value } else { $null } }
function J($s) { '"' + ([string]$s).Replace('\', '\\').Replace('"', '\"').Replace("`r", '').Replace("`n", ' ').Replace("`t", ' ') + '"' }
function HebStr([int[]]$codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$OOS = HebStr 0x05D0, 0x05D6, 0x05DC                         # out of stock
$MATTE = HebStr 0x05DE, 0x05D8
$GLOSS = HebStr 0x05DE, 0x05D1, 0x05E8, 0x05D9, 0x05E7
$FLEX = HebStr 0x05D2, 0x05DE, 0x05D9, 0x05E9                # flexible
$DECO = HebStr 0x05D1, 0x05D3, 0x05D5, 0x05D2, 0x05DE, 0x05EA # "in a pattern of"
$HEB = '[' + [char]0x05D0 + '-' + [char]0x05EA + ']'
if (-not $CsvUrl -and -not $CsvPath) { $site0 = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'data/site.json') | ConvertFrom-Json; $CsvUrl = [string]$site0.sheetCsvUrl }

# ---- read the sheet ----
if ($CsvPath) { $text = [IO.File]::ReadAllText($CsvPath, [Text.Encoding]::UTF8) }
elseif ($CsvUrl) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $resp = Invoke-WebRequest -UseBasicParsing -Uri $CsvUrl -TimeoutSec 120
  $text = [Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
} else { throw 'No CSV source: set SHEET_CSV_URL (published CSV of the sheet tab) or pass -CsvPath.' }
$rows = @($text | ConvertFrom-Csv | Where-Object { $_.img -and $_.img.Trim() })
if ($rows.Count -lt 10) { throw "Sheet returned only $($rows.Count) rows: refusing to sync (safety)." }

$tax = ReadJsonFile 'data/taxonomy.json'
$tr = ReadJsonFile 'data/he-fr.json'
$prods = @(ReadJsonFile 'data/products.json' | ForEach-Object { $_ })
$byImg = @{}; foreach ($p in $prods) { $byImg[[string]$p.img] = $p }
$snapFile = Join-Path $root 'data/sheet-snapshot.json'
$snap = if (Test-Path $snapFile) { ReadJsonFile 'data/sheet-snapshot.json' } else { $null }
$first = ($null -eq $snap)

function NormSku([string]$s) { $s = $s.Trim(); if ($s -match '\?' -or $s -match $HEB) { '' } else { $s } }
function NormSize([string]$s) {
  $s = $s.Trim()
  if ($s -match '^(\d+(?:\.\d+)?)/(\d{3})$') { return $matches[1] + '/' + ([double]$matches[2] / 100).ToString('0.00', $Inv) }
  if ($s -match ',') { return '' }
  $s
}
function NormFinish([string]$s) { $s = $s.Trim(); if ($s -eq $MATTE) { 'm' } elseif ($s -eq $GLOSS) { 'g' } else { '' } }
function NormPrice([string]$s) { $s = ($s -replace '[^0-9.]', ''); if (-not $s) { return $null }; $v = [double]::Parse($s, $Inv); if ($v -le 0) { return $null }; if ($v -eq [Math]::Floor($v)) { [int]$v } else { $v } }
function StockOos($sig) { if ($sig.stock -eq 'FALSE') { return $true }; if ($sig.stock -eq 'TRUE') { return $false }; return ($sig.notes -match $OOS) }
function CatOf([string]$cat, [string]$desc) {
  $c =[string](P $tax.sheetCats $cat.Trim()); if (-not $c) { $c = 'panel' }
  if ($c -eq 'panel' -and $desc -match $FLEX) { $c = 'flex' }
  elseif ($c -eq 'panel' -and $desc -match $DECO) { $c = 'deco' }
  $c
}
function Translate([string]$he) {
  $s = ' ' + $he + ' '
  foreach ($pr in $tr.pairs) { $s = [regex]::Replace($s, '(?<!' + $HEB + ')' + [regex]::Escape([string]$pr[0]) + '(?!' + $HEB + ')', [string]$pr[1]) }
  $s = ($s -replace '\s+', ' ').Trim()
  if ($s.Length) { $s = $s.Substring(0, 1).ToUpper() + $s.Substring(1) }
  $s
}

$out = New-Object System.Collections.ArrayList; $srcmap = New-Object System.Collections.ArrayList
$newSnap = [ordered]@{}; $added = 0; $updated = 0
# optional column 'sup' = neutral supplier code (S1, S2...); the sheet is the source of truth when the column exists
$hasSup = [bool]($rows[0].PSObject.Properties['sup'])
foreach ($r in $rows) {
  $id = $r.img.Trim()
  $sig = [ordered]@{ sku = [string]$r.sku; cat = [string]$r.cat; desc = [string]$r.desc; size = [string]$r.size; finish = [string]$r.finish; price = [string]$r.price; notes = [string]$r.notes; stock = [string]$r.stock; hide = [string]$r.hide }
  $newSnap[$id] = $sig
  $old = $byImg[$id]
  if ($old) {
    $o = [ordered]@{ sku = $old.sku; c = $old.c; he = $old.he; fr = $old.fr; s = $old.s; f = $old.f; p = $old.p; oos = [bool]$old.oos; img = $id; hide = [bool](P $old 'hide') }
    if (P $old 'frAuto') { $o.frAuto = $true }
    if (P $old 'en') { $o.en = [string](P $old 'en') }
    $prev = if ($first) { $null } else { P $snap $id }
    $changed = $false
    function FieldChanged([string]$k) { if ($first) { return ($k -ne 'desc' -and $k -ne 'cat') }; return ($null -eq $prev -or [string](P $prev $k) -ne [string]$sig[$k]) }
    if (FieldChanged 'sku') { $v = NormSku $sig.sku; if ($v -ne $o.sku) { $o.sku = $v; $changed = $true } }
    if (FieldChanged 'size') { $v = NormSize $sig.size; if ($v -ne $o.s) { $o.s = $v; $changed = $true } }
    if (FieldChanged 'finish') { $v = NormFinish $sig.finish; if ($v -ne $o.f) { $o.f = $v; $changed = $true } }
    if (FieldChanged 'price') { $v = NormPrice $sig.price; if ([string]$v -ne [string]$o.p) { $o.p = $v; $changed = $true } }
    if ((FieldChanged 'notes') -or (FieldChanged 'stock')) { $v = StockOos $sig; if ($v -ne $o.oos) { $o.oos = $v; $changed = $true } }
    if (FieldChanged 'hide') { $v = ($sig.hide -eq 'TRUE'); if ($v -ne $o.hide) { $o.hide = $v; $changed = $true } }
    if (FieldChanged 'cat') { $v = CatOf $sig.cat $sig.desc; if ($v -ne $o.c) { $o.c = $v; $changed = $true } }
    if (FieldChanged 'desc') { if ($sig.desc.Trim() -ne $o.he) { $o.he = $sig.desc.Trim(); $o.fr = Translate $o.he; $o.frAuto = $true; $changed = $true } }
    $sv = if ($hasSup) { ([string]$r.sup).Trim().ToUpper() } else { [string](P $old 'sup') }
    if ($sv) { $o.sup = $sv }
    if ([string]$sv -ne [string](P $old 'sup')) { $changed = $true }
    if ($changed) { $updated++ }
    [void]$out.Add($o)
  } else {
    $he = $sig.desc.Trim()
    $no = [ordered]@{ sku = (NormSku $sig.sku); c = (CatOf $sig.cat $he); he = $he; fr = (Translate $he); s = (NormSize $sig.size); f = (NormFinish $sig.finish); p = (NormPrice $sig.price); oos = (StockOos $sig); img = $id; frAuto = $true; hide = ($sig.hide -eq 'TRUE') }
    if ($hasSup -and ([string]$r.sup).Trim()) { $no.sup = ([string]$r.sup).Trim().ToUpper() }
    [void]$out.Add($no)
    $added++
  }
  [void]$srcmap.Add([string]$r.src)
}
$removed = @($prods | Where-Object { -not $newSnap.Contains([string]$_.img) }).Count

# ---- write ----
$lines = foreach ($o in $out) {
  $pv = if ($null -eq $o.p) { 'null' } else { ([double]$o.p).ToString('0.##', $Inv) }
  $l = '{"sku":' + (J $o.sku) + ',"c":' + (J $o.c) + ',"he":' + (J $o.he) + ',"fr":' + (J $o.fr) + ',"s":' + (J $o.s) + ',"f":' + (J $o.f) + ',"p":' + $pv + ',"oos":' + ([string]$o.oos).ToLower() + ',"img":' + (J $o.img)
  if ($o.Contains('frAuto') -and $o.frAuto) { $l += ',"frAuto":true' }
  if ($o.Contains('hide') -and $o.hide) { $l += ',"hide":true' }
  if ($o.Contains('en') -and $o.en) { $l += ',"en":' + (J $o.en) }
  if ($o.Contains('sup') -and $o.sup) { $l += ',"sup":' + (J $o.sup) }
  $l + '}'
}
$newText = "[`n" + ($lines -join ",`n") + "`n]`n"
$prodFile = Join-Path $root 'data/products.json'
$oldText = [IO.File]::ReadAllText($prodFile, [Text.Encoding]::UTF8)
$changedAny = ($newText -ne $oldText)
if ($changedAny) { [IO.File]::WriteAllText($prodFile, $newText, $utf8) }
[IO.File]::WriteAllText($snapFile, (ConvertTo-Json -InputObject $newSnap -Depth 4), $utf8)
[IO.File]::WriteAllText((Join-Path $root 'data/srcmap.json'), (ConvertTo-Json -InputObject @($srcmap) -Compress), $utf8)

# ---- photos of new products ----
$imgDir = Join-Path $root 'src/assets/img/products'; $got = 0
foreach ($o in $out) {
  $f = Join-Path $imgDir ($o.img + '.jpg')
  if (Test-Path $f) { continue }
  try { Invoke-WebRequest -UseBasicParsing -Uri ('https://lh3.googleusercontent.com/d/' + $o.img + '=w1200') -OutFile $f -TimeoutSec 60; $got++ } catch { Write-Warning "photo not reachable (share it publicly): $($o.img)" }
}
if ($got) { $changedAny = $true }

Write-Host ("sync: {0} rows, {1} new, {2} updated, {3} removed, {4} new photos{5}" -f $out.Count, $added, $updated, $removed, $got, $(if ($first) { ' (first run: snapshot created)' } else { '' }))
if ($env:GITHUB_OUTPUT) { Add-Content -Path $env:GITHUB_OUTPUT -Value ("changed=" + ([string]$changedAny).ToLower()) }
