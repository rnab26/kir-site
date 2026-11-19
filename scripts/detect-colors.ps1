# Colour of every product, read from its real photo (src/assets/img/tex/<id>.jpg) instead of guessed from its name.
# Writes data/colors.json { "list": [["<image id>", "grey"], ...] }. build.ps1 uses it for the colour filters (names only add "gold").
# Run again after new photos: powershell -ExecutionPolicy Bypass -File scripts/detect-colors.ps1
# Keep this file ASCII-only.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Collections.Generic;
public static class ProdColor {
  static double Lin(double c) { c /= 255.0; return c <= 0.04045 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4); }
  static double F(double t) { return t > 0.008856 ? Math.Pow(t, 1.0 / 3) : 7.787 * t + 16.0 / 116; }
  // median L, a, b of the product: the centre of a full-bleed photo, or every non-background pixel of a cut-out on white
  public static double[] Lab(string path) {
    using (var src = new Bitmap(path)) using (var bmp = new Bitmap(64, 64)) {
      using (var g = Graphics.FromImage(bmp)) { g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic; g.DrawImage(src, new Rectangle(0, 0, 64, 64)); }
      var P = new double[64 * 64 * 3];
      for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++) { var t = Px(bmp.GetPixel(x, y)); int o = (y * 64 + x) * 3; P[o] = t[0]; P[o + 1] = t[1]; P[o + 2] = t[2]; }
      var bl = new List<double>(); var bc = new List<double>();
      for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++) if (x < 3 || y < 3 || x > 60 || y > 60) { int o = (y * 64 + x) * 3; bl.Add(P[o]); bc.Add(Math.Sqrt(P[o + 1] * P[o + 1] + P[o + 2] * P[o + 2])); }
      bl.Sort(); bc.Sort();
      bool cutout = bl[bl.Count / 2] > 86 && bc[bc.Count / 2] < 7;
      var L = new List<double>(); var A = new List<double>(); var B = new List<double>();
      for (int pass = 0; pass < 2 && L.Count < 200; pass++) {
        L.Clear(); A.Clear(); B.Clear();
        for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++) {
          int o = (y * 64 + x) * 3; double C = Math.Sqrt(P[o + 1] * P[o + 1] + P[o + 2] * P[o + 2]);
          bool keep = cutout && pass == 0 ? !(P[o] > 84 && C < 8) : (x >= 13 && x < 51 && y >= 13 && y < 51);
          if (keep) { L.Add(P[o]); A.Add(P[o + 1]); B.Add(P[o + 2]); }
        }
      }
      L.Sort(); A.Sort(); B.Sort();
      return new double[] { L[L.Count / 2], A[A.Count / 2], B[B.Count / 2] };
    }
  }
  static double[] Px(Color c) {
    double r = Lin(c.R), gg = Lin(c.G), b = Lin(c.B);
    double X = (0.4124 * r + 0.3576 * gg + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * gg + 0.0722 * b, Z = (0.0193 * r + 0.1192 * gg + 0.9505 * b) / 1.08883;
    double fx = F(X), fy = F(Y), fz = F(Z);
    return new double[] { 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz) };
  }
}
'@
function Classify([double]$L, [double]$a, [double]$b) {
  $C = [math]::Sqrt($a * $a + $b * $b); $h = [math]::Atan2($b, $a) * 180 / [math]::PI
  if ($L -ge 80 -and $C -lt 14) { return 'white' }
  if ($L -lt 28 -or ($L -lt 36 -and $C -lt 8)) { return 'black' }
  if ($C -lt 9) { return 'grey' }
  if ($h -ge 25 -and $h -le 110) {
    if ($C -lt 16 -and $L -lt 68) { return 'taupe' }
    if ($L -ge 66) { return 'beige' }
    return 'brown'
  }
  if ($h -ge -10 -and $h -lt 25) { if ($L -ge 66) { return 'beige' } else { return 'brown' } }
  if ($C -lt 18) { return 'grey' }
  return ''
}
$out = New-Object System.Collections.ArrayList   # pairs [id, colour]: image ids differ only by case sometimes, JSON objects would clash in PowerShell
$files = Get-ChildItem (Join-Path $Root 'src/assets/img/tex') -Filter '*.jpg' | Sort-Object Name
foreach ($f in $files) {
  $lab = [ProdColor]::Lab($f.FullName)
  [void]$out.Add(@($f.BaseName, (Classify $lab[0] $lab[1] $lab[2])))
}
$json = ConvertTo-Json -InputObject @{ list = $out } -Depth 4 -Compress
[IO.File]::WriteAllText((Join-Path $Root 'data/colors.json'), $json, (New-Object Text.UTF8Encoding($false)))
$counts = @{}; foreach ($v in ($out | ForEach-Object { $_[1] })) { $counts[$v] = 1 + [int]$counts[$v] }
'colours: ' + (($counts.GetEnumerator() | Sort-Object Name | ForEach-Object { $_.Name + '=' + $_.Value }) -join ', ')
