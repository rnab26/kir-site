# Minimal static server for local preview of _site/ (no Python/Node needed).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/serve.ps1 [-Port 8765]
param([int]$Port = 8765)
$root = Join-Path (Split-Path -Parent $PSScriptRoot) '_site'
$types = @{ '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'; '.jpg' = 'image/jpeg'; '.png' = 'image/png'; '.xml' = 'application/xml; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'; '.webmanifest' = 'application/manifest+json' }
$l = New-Object Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Serving $root on http://localhost:$Port/"
while ($l.IsListening) {
  $ctx = $l.GetContext()
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    $file = Join-Path $root $path
    if ((Test-Path $file -PathType Container)) { $file = Join-Path $file 'index.html' }
    $status = 200
    if (-not (Test-Path $file -PathType Leaf)) { $file = Join-Path $root '404.html'; $status = 404 }
    $bytes = [IO.File]::ReadAllBytes($file)
    $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
    $ctx.Response.StatusCode = $status
    $ctx.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch { $ctx.Response.StatusCode = 500 } finally { $ctx.Response.OutputStream.Close() }
}
