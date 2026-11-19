// ImageKit: red-frame detection, perspective extraction, enhancement and virtual-plate rendering.
// C# 5 compatible (compiled by Windows PowerShell 5.1 Add-Type). No external dependencies.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class KImg
{
    public int W, H; public byte[] D; // packed BGR
    public KImg(int w, int h) { W = w; H = h; D = new byte[w * h * 3]; }

    public static KImg Load(string path)
    {
        using (Bitmap b0 = new Bitmap(path))
        using (Bitmap b = new Bitmap(b0.Width, b0.Height, PixelFormat.Format24bppRgb))
        {
            using (Graphics g = Graphics.FromImage(b)) { g.DrawImage(b0, 0, 0, b0.Width, b0.Height); }
            return FromBitmap(b);
        }
    }
    public static KImg FromBitmap(Bitmap b)
    {
        KImg im = new KImg(b.Width, b.Height);
        BitmapData bd = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        for (int y = 0; y < b.Height; y++) Marshal.Copy(new IntPtr(bd.Scan0.ToInt64() + (long)y * bd.Stride), im.D, y * b.Width * 3, b.Width * 3);
        b.UnlockBits(bd);
        return im;
    }
    public Bitmap ToBitmap()
    {
        Bitmap b = new Bitmap(W, H, PixelFormat.Format24bppRgb);
        BitmapData bd = b.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
        for (int y = 0; y < H; y++) Marshal.Copy(D, y * W * 3, new IntPtr(bd.Scan0.ToInt64() + (long)y * bd.Stride), W * 3);
        b.UnlockBits(bd);
        return b;
    }
    public void SaveJpg(string path, long q) { using (Bitmap b = ToBitmap()) KIO.SaveJpg(b, path, q); }

    public void Sample(double x, double y, out double bl, out double gr, out double rd)
    {
        if (x < 0) x = 0; if (y < 0) y = 0; if (x > W - 1.001) x = W - 1.001; if (y > H - 1.001) y = H - 1.001;
        int x0 = (int)x, y0 = (int)y; double fx = x - x0, fy = y - y0;
        int i00 = (y0 * W + x0) * 3, i10 = i00 + 3, i01 = i00 + W * 3, i11 = i01 + 3;
        double w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        bl = D[i00] * w00 + D[i10] * w10 + D[i01] * w01 + D[i11] * w11;
        gr = D[i00 + 1] * w00 + D[i10 + 1] * w10 + D[i01 + 1] * w01 + D[i11 + 1] * w11;
        rd = D[i00 + 2] * w00 + D[i10 + 2] * w10 + D[i01 + 2] * w01 + D[i11 + 2] * w11;
    }
    public KImg Crop(int x, int y, int w, int h)
    {
        if (x < 0) { w += x; x = 0; } if (y < 0) { h += y; y = 0; }
        if (x + w > W) w = W - x; if (y + h > H) h = H - y;
        if (w < 1) w = 1; if (h < 1) h = 1;
        KImg o = new KImg(w, h);
        for (int r = 0; r < h; r++) Buffer.BlockCopy(D, ((y + r) * W + x) * 3, o.D, r * w * 3, w * 3);
        return o;
    }
    public KImg Resize(int w, int h)
    {
        using (Bitmap s = ToBitmap())
        using (Bitmap d = new Bitmap(w, h, PixelFormat.Format24bppRgb))
        {
            using (Graphics g = Graphics.FromImage(d))
            using (ImageAttributes ia = new ImageAttributes())
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.PixelOffsetMode = PixelOffsetMode.HighQuality; g.SmoothingMode = SmoothingMode.HighQuality;
                ia.SetWrapMode(WrapMode.TileFlipXY);
                g.DrawImage(s, new Rectangle(0, 0, w, h), 0, 0, W, H, GraphicsUnit.Pixel, ia);
            }
            return FromBitmap(d);
        }
    }
    public bool IsRed(int i) { int b = D[i], g = D[i + 1], r = D[i + 2]; return r > 150 && r - g > 85 && r - b > 85 && g < 125 && b < 125; }
}

public class KFrame
{
    public int MinX = int.MaxValue, MinY = int.MaxValue, MaxX = -1, MaxY = -1, Count;
    public double[] Q = new double[8]; // TL, TR, BR, BL (x,y)
    public int Thick = 6;
    public string Photo; public int Index;
    public double[] Desc;
}

public static class KIO
{
    public static void SaveJpg(Bitmap b, string path, long q)
    {
        ImageCodecInfo enc = null;
        foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") enc = c;
        EncoderParameters ep = new EncoderParameters(1);
        ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, q);
        b.Save(path, enc, ep);
    }
}

public static class Kit
{
    // ---------- frames ----------
    public static List<KFrame> FindFrames(KImg im)
    {
        int W = im.W, H = im.H; bool[] m = new bool[W * H];
        for (int p = 0, i = 0; p < W * H; p++, i += 3) m[p] = im.IsRed(i);
        bool[] seen = new bool[W * H]; int[] q = new int[W * H];
        List<KFrame> res = new List<KFrame>();
        for (int s = 0; s < W * H; s++)
        {
            if (!m[s] || seen[s]) continue;
            KFrame f = new KFrame(); int head = 0, tail = 0; q[tail++] = s; seen[s] = true;
            double sTL = double.MaxValue, sBR = double.MinValue, dTR = double.MinValue, dBL = double.MaxValue;
            while (head < tail)
            {
                int p = q[head++]; int x = p % W, y = p / W; f.Count++;
                if (x < f.MinX) f.MinX = x; if (x > f.MaxX) f.MaxX = x; if (y < f.MinY) f.MinY = y; if (y > f.MaxY) f.MaxY = y;
                double a = x + y, d = x - y;
                if (a < sTL) { sTL = a; f.Q[0] = x; f.Q[1] = y; }
                if (d > dTR) { dTR = d; f.Q[2] = x; f.Q[3] = y; }
                if (a > sBR) { sBR = a; f.Q[4] = x; f.Q[5] = y; }
                if (d < dBL) { dBL = d; f.Q[6] = x; f.Q[7] = y; }
                for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++)
                {
                    int nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                    int np = ny * W + nx; if (m[np] && !seen[np]) { seen[np] = true; q[tail++] = np; }
                }
            }
            int bw = f.MaxX - f.MinX, bh = f.MaxY - f.MinY;
            if (bw < W * 0.035 || bh < H * 0.025 || f.Count < 300) continue;
            // a frame is mostly hollow: red pixels cover little of its box
            if (f.Count > 0.45 * (double)(bw + 1) * (bh + 1)) continue;
            // thickness: run length on bottom and right edges at mid points
            int t1 = 0, t2 = 0, mx = (f.MinX + f.MaxX) / 2, my = (f.MinY + f.MaxY) / 2;
            for (int y = f.MaxY; y > f.MinY && t1 < 60; y--) { if (m[y * W + mx]) t1++; else if (t1 > 0) break; }
            for (int x = f.MaxX; x > f.MinX && t2 < 60; x--) { if (m[my * W + x]) t2++; else if (t2 > 0) break; }
            f.Thick = Math.Max(3, Math.Max(t1, t2));
            res.Add(f);
        }
        return res;
    }

    // ---------- homography ----------
    // maps unit square (0,0),(1,0),(1,1),(0,1) to quad q (TL,TR,BR,BL)
    public static double[] SquareToQuad(double[] q)
    {
        double x0 = q[0], y0 = q[1], x1 = q[2], y1 = q[3], x2 = q[4], y2 = q[5], x3 = q[6], y3 = q[7];
        double dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
        double a, b, c, d, e, f, g, h;
        if (Math.Abs(dx3) < 1e-9 && Math.Abs(dy3) < 1e-9)
        { a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0; g = 0; h = 0; }
        else
        {
            double den = dx1 * dy2 - dx2 * dy1;
            g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den;
            a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
        }
        return new double[] { a, b, c, d, e, f, g, h };
    }
    public static void Map(double[] m, double u, double v, out double x, out double y)
    {
        double w = m[6] * u + m[7] * v + 1; x = (m[0] * u + m[1] * v + m[2]) / w; y = (m[3] * u + m[4] * v + m[5]) / w;
    }
    public static double[] Invert(double[] m)
    {
        double a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7];
        double A = e - f * h, B = c * h - b, C = b * f - c * e, D = f * g - d, E = a - c * g, F = c * d - a * f, G = d * h - e * g, Hh = b * g - a * h, I = a * e - b * d;
        return new double[] { A / I, B / I, C / I, D / I, E / I, F / I, G / I, Hh / I };
    }

    public static KImg WarpQuad(KImg src, double[] q, int w, int h)
    {
        double[] m = SquareToQuad(q); KImg o = new KImg(w, h);
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
        {
            double sx, sy; Map(m, (x + 0.5) / w, (y + 0.5) / h, out sx, out sy);
            double b, g, r; src.Sample(sx - 0.5, sy - 0.5, out b, out g, out r);
            int i = (y * w + x) * 3; o.D[i] = (byte)b; o.D[i + 1] = (byte)g; o.D[i + 2] = (byte)r;
        }
        return o;
    }

    public static double Dist(double ax, double ay, double bx, double by) { return Math.Sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)); }

    // Extract the frame interior, straightened, at native resolution; returns null if degenerate.
    public static KImg ExtractInterior(KImg src, KFrame f)
    {
        double[] Q = f.Q;
        int w = (int)Math.Round((Dist(Q[0], Q[1], Q[2], Q[3]) + Dist(Q[6], Q[7], Q[4], Q[5])) / 2);
        int h = (int)Math.Round((Dist(Q[0], Q[1], Q[6], Q[7]) + Dist(Q[2], Q[3], Q[4], Q[5])) / 2);
        if (w < 24 || h < 24) return null;
        KImg full = WarpQuad(src, Q, w, h);
        int m = f.Thick + 3;
        if (w - 2 * m < 16 || h - 2 * m < 16) return null;
        return full.Crop(m, m, w - 2 * m, h - 2 * m);
    }

    // Remove the numbered label (red box in the top-left corner) by cutting the smaller band; trim residual red at borders.
    public static KImg RemoveLabel(KImg im)
    {
        int W = im.W, H = im.H, lx = -1, ly = -1;
        int sw = (int)(W * 0.6), sh = (int)(H * 0.6);
        for (int y = 0; y < sh; y++) for (int x = 0; x < sw; x++)
        {
            int i = (y * W + x) * 3;
            if (im.IsRed(i)) { if (x > lx) lx = x; if (y > ly) ly = y; }
        }
        KImg o = im;
        if (lx >= 0 && ly >= 0)
        {
            double keepTop = (double)W * (H - ly - 4), keepLeft = (double)(W - lx - 4) * H;
            if (keepTop >= keepLeft) o = im.Crop(0, ly + 4, W, H - ly - 4); else o = im.Crop(lx + 4, 0, W - lx - 4, H);
        }
        // trim borders that still contain red
        for (int pass = 0; pass < 4; pass++)
        {
            int t = 0, b = 0, l = 0, r = 0;
            while (t < o.H / 4 && RowRed(o, t) > 0.01) t++;
            while (b < o.H / 4 && RowRed(o, o.H - 1 - b) > 0.01) b++;
            while (l < o.W / 4 && ColRed(o, l) > 0.01) l++;
            while (r < o.W / 4 && ColRed(o, o.W - 1 - r) > 0.01) r++;
            if (t + b + l + r == 0) break;
            o = o.Crop(l, t, o.W - l - r, o.H - t - b);
        }
        return o;
    }
    static double RowRed(KImg im, int y) { int n = 0; for (int x = 0; x < im.W; x++) if (im.IsRed((y * im.W + x) * 3)) n++; return (double)n / im.W; }
    static double ColRed(KImg im, int x) { int n = 0; for (int y = 0; y < im.H; y++) if (im.IsRed((y * im.W + x) * 3)) n++; return (double)n / im.H; }

    // ---------- matching ----------
    public static double[] Descriptor(KImg im)
    {
        const int DW = 12, DH = 15; double[] v = new double[DW * DH * 3 + 3];
        for (int y = 0; y < DH; y++) for (int x = 0; x < DW; x++)
        {
            int x0 = x * im.W / DW, x1 = Math.Max(x0 + 1, (x + 1) * im.W / DW), y0 = y * im.H / DH, y1 = Math.Max(y0 + 1, (y + 1) * im.H / DH);
            double sb = 0, sg = 0, sr = 0; int n = 0;
            for (int yy = y0; yy < y1; yy += 2) for (int xx = x0; xx < x1; xx += 2) { int i = (yy * im.W + xx) * 3; sb += im.D[i]; sg += im.D[i + 1]; sr += im.D[i + 2]; n++; }
            int k = (y * DW + x) * 3; v[k] = sb / n; v[k + 1] = sg / n; v[k + 2] = sr / n;
        }
        double mb = 0, mg = 0, mr = 0; int c = DW * DH;
        for (int k = 0; k < c; k++) { mb += v[k * 3]; mg += v[k * 3 + 1]; mr += v[k * 3 + 2]; }
        v[c * 3] = mb / c; v[c * 3 + 1] = mg / c; v[c * 3 + 2] = mr / c;
        return v;
    }
    public static double Score(double[] a, double[] b)
    {
        int n = a.Length - 3; double ma = 0, mb = 0;
        for (int i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
        ma /= n; mb /= n; double sab = 0, saa = 0, sbb = 0;
        for (int i = 0; i < n; i++) { double x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
        double ncc = sab / Math.Sqrt(saa * sbb + 1e-9);
        double cd = 0; for (int k = 0; k < 3; k++) { double d = a[n + k] - b[n + k]; cd += d * d; }
        cd = Math.Sqrt(cd);
        return 0.55 * ncc + 0.45 * Math.Max(0, 1 - cd / 90.0);
    }

    // ---------- enhancement ----------
    // White balance from near-neutral bright pixels (white labels, paper, walls) of the whole photo.
    public static double[] PhotoBalance(KImg im)
    {
        double sb = 0, sg = 0, sr = 0; long n = 0;
        for (int i = 0; i < im.D.Length; i += 3 * 5)
        {
            int b = im.D[i], g = im.D[i + 1], r = im.D[i + 2]; int mx = Math.Max(r, Math.Max(g, b)), mn = Math.Min(r, Math.Min(g, b));
            if (mx < 175 || mx > 252 || mx - mn > 28) continue;
            sb += b; sg += g; sr += r; n++;
        }
        double s = 0.7, lo = 0.88, hi = 1.14;
        if (n < 300)
        {
            sb = sg = sr = 0; n = 0; s = 0.3; lo = 0.94; hi = 1.06;
            for (int i = 0; i < im.D.Length; i += 3 * 7) { int b = im.D[i], g = im.D[i + 1], r = im.D[i + 2]; int mx = Math.Max(r, Math.Max(g, b)); if (mx < 25 || mx > 245) continue; sb += b; sg += g; sr += r; n++; }
            if (n < 100) return new double[] { 1, 1, 1 };
        }
        sb /= n; sg /= n; sr /= n; double m = (sb + sg + sr) / 3;
        double[] gn = { 1 + s * (m / sb - 1), 1 + s * (m / sg - 1), 1 + s * (m / sr - 1) };
        for (int k = 0; k < 3; k++) gn[k] = Math.Max(lo, Math.Min(hi, gn[k]));
        return gn;
    }
    public static double RedFraction(KImg im)
    {
        int n = 0; for (int i = 0; i < im.D.Length; i += 3) if (im.IsRed(i)) n++;
        return (double)n / (im.W * im.H);
    }
    // tone: -1 dark product, 0 mid, 1 light, 2 white -> target mean brightness after correction
    public static void Enhance(KImg im, double[] gain, int tone)
    {
        bool dark = tone < 0;
        double target = tone == 2 ? 196 : tone == 1 ? 168 : 138;
        int[] hist = new int[256]; int N = im.W * im.H;
        for (int i = 0; i < im.D.Length; i += 3)
        {
            double b = im.D[i] * gain[0], g = im.D[i + 1] * gain[1], r = im.D[i + 2] * gain[2];
            int L = (int)Math.Min(255, 0.114 * b + 0.587 * g + 0.299 * r); hist[L]++;
        }
        int lo = 0, hi = 255, acc = 0;
        for (int v = 0; v < 256; v++) { acc += hist[v]; if (acc > N * 0.004) { lo = v; break; } }
        acc = 0; for (int v = 255; v >= 0; v--) { acc += hist[v]; if (acc > N * 0.004) { hi = v; break; } }
        double tlo = lo * 0.45, thi = Math.Min(250, hi + (255 - hi) * 0.65);
        double scale = (thi - tlo) / Math.Max(10, hi - lo); if (scale > 1.6) scale = 1.6;
        double mean = 0; for (int v = 0; v < 256; v++) mean += v * (double)hist[v]; mean /= N;
        double mid = (mean - lo) * scale + tlo;
        double gamma = 1.0;
        if (!dark && mid < target) gamma = Math.Max(0.58, Math.Log(target / 255.0) / Math.Log(Math.Max(0.05, mid / 255.0)));
        if (dark) gamma = 0.95;
        byte[] lut = new byte[256 * 3];
        for (int c = 0; c < 3; c++) for (int v = 0; v < 256; v++)
        {
            double x = v * gain[c]; x = (x - lo) * scale + tlo; x = Math.Max(0, Math.Min(255, x));
            x = 255 * Math.Pow(x / 255.0, gamma);
            lut[c * 256 + v] = (byte)Math.Max(0, Math.Min(255, Math.Round(x)));
        }
        for (int i = 0; i < im.D.Length; i += 3) { im.D[i] = lut[im.D[i]]; im.D[i + 1] = lut[256 + im.D[i + 1]]; im.D[i + 2] = lut[512 + im.D[i + 2]]; }
    }
    public static void Sharpen(KImg im, double amount)
    {
        // unsharp mask with 3x3 gaussian
        int W = im.W, H = im.H; byte[] s = (byte[])im.D.Clone();
        for (int y = 1; y < H - 1; y++) for (int x = 1; x < W - 1; x++) for (int c = 0; c < 3; c++)
        {
            int i = (y * W + x) * 3 + c;
            double blur = (4 * s[i] + 2 * (s[i - 3] + s[i + 3] + s[i - W * 3] + s[i + W * 3]) + s[i - 3 - W * 3] + s[i + 3 - W * 3] + s[i - 3 + W * 3] + s[i + 3 + W * 3]) / 16.0;
            double v = s[i] + amount * (s[i] - blur);
            im.D[i] = (byte)Math.Max(0, Math.Min(255, v));
        }
    }

    // ---------- rendering ----------
    static void BoxBlur(float[] a, int W, int H, int r)
    {
        float[] t = new float[a.Length];
        for (int y = 0; y < H; y++) { double s = 0; for (int x = -r; x <= r; x++) s += a[y * W + Math.Max(0, Math.Min(W - 1, x))]; for (int x = 0; x < W; x++) { t[y * W + x] = (float)(s / (2 * r + 1)); s += a[y * W + Math.Min(W - 1, x + r + 1)] - a[y * W + Math.Max(0, x - r)]; } }
        for (int x = 0; x < W; x++) { double s = 0; for (int y = -r; y <= r; y++) s += t[Math.Max(0, Math.Min(H - 1, y)) * W + x]; for (int y = 0; y < H; y++) { a[y * W + x] = (float)(s / (2 * r + 1)); s += t[Math.Min(H - 1, y + r + 1) * W + x] - t[Math.Max(0, y - r) * W + x]; } }
    }
    static bool InQuad(double[] q, double x, double y)
    {
        bool inside = false;
        for (int i = 0, j = 3; i < 4; j = i++)
        {
            double xi = q[i * 2], yi = q[i * 2 + 1], xj = q[j * 2], yj = q[j * 2 + 1];
            if (((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
        }
        return inside;
    }
    static void Background(KImg c)
    {
        int W = c.W, H = c.H; int floorY = (int)(H * 0.84);
        for (int y = 0; y < H; y++) for (int x = 0; x < W; x++)
        {
            double dx = (x - W * 0.42) / W, dy = (y - H * 0.38) / H; double rad = Math.Sqrt(dx * dx + dy * dy);
            double v = 1 - 0.10 * rad; double r = 246 * v, g = 241 * v, b = 234 * v;
            if (y > floorY) { double t = Math.Min(1, (y - floorY) / (H * 0.16)); r -= 14 * t + 4; g -= 15 * t + 4; b -= 17 * t + 5; }
            int i = (y * W + x) * 3; c.D[i] = (byte)b; c.D[i + 1] = (byte)g; c.D[i + 2] = (byte)r;
        }
    }
    static void Shade(KImg c, float[] mask, double alpha, int br, int bg, int bb)
    {
        for (int p = 0, i = 0; p < mask.Length; p++, i += 3)
        {
            double a = mask[p] * alpha; if (a <= 0.001) continue;
            c.D[i] = (byte)(c.D[i] * (1 - a) + bb * a); c.D[i + 1] = (byte)(c.D[i + 1] * (1 - a) + bg * a); c.D[i + 2] = (byte)(c.D[i + 2] * (1 - a) + br * a);
        }
    }
    static void FillQuadMask(float[] m, int W, int H, double[] q)
    {
        double minx = Math.Min(Math.Min(q[0], q[2]), Math.Min(q[4], q[6])), maxx = Math.Max(Math.Max(q[0], q[2]), Math.Max(q[4], q[6]));
        double miny = Math.Min(Math.Min(q[1], q[3]), Math.Min(q[5], q[7])), maxy = Math.Max(Math.Max(q[1], q[3]), Math.Max(q[5], q[7]));
        for (int y = Math.Max(0, (int)miny); y < Math.Min(H, (int)maxy + 1); y++) for (int x = Math.Max(0, (int)minx); x < Math.Min(W, (int)maxx + 1); x++) if (InQuad(q, x + 0.5, y + 0.5)) m[y * W + x] = 1;
    }

    // Build the flat plate surface (front face) by tiling the texture at an assumed physical scale.
    // tileHcm <= 0: keep the photo's aspect (mirrored vertical repeats); > 0: stretch each tile to that height.
    static KImg PlateSurface(KImg tex, double wcm, double hcm, double tileWcm, double tileHcm, int slats, bool mirrorX, int maxPx)
    {
        double ppc = maxPx / Math.Max(wcm, hcm);
        int pw = Math.Max(8, (int)(wcm * ppc)), ph = Math.Max(8, (int)(hcm * ppc));
        KImg p = new KImg(pw, ph);
        double tw = tileWcm * ppc, th = tileHcm > 0 ? tileHcm * ppc + 0.5 : tw * tex.H / tex.W;
        for (int y = 0; y < ph; y++)
        {
            double v = y / th; int iv = (int)Math.Floor(v); double fv = v - iv; if ((iv & 1) == 1) fv = 1 - fv;
            for (int x = 0; x < pw; x++)
            {
                double u = x / tw; int iu = (int)Math.Floor(u); double fu = u - iu; if (mirrorX && (iu & 1) == 1) fu = 1 - fu;
                double b, g, r; tex.Sample(fu * (tex.W - 1), fv * (tex.H - 1), out b, out g, out r);
                int i = (y * pw + x) * 3; p.D[i] = (byte)b; p.D[i + 1] = (byte)g; p.D[i + 2] = (byte)r;
            }
        }
        if (slats > 1)
        {
            for (int k = 1; k < slats; k++)
            {
                int gx = (int)(pw * (double)k / slats);
                for (int y = 0; y < ph; y++)
                {
                    for (int d = -2; d <= 2; d++)
                    {
                        int x = gx + d; if (x < 0 || x >= pw) continue; int i = (y * pw + x) * 3;
                        double f = d <= 0 ? 0.45 + 0.12 * (d + 2) : 1.10;
                        for (int c2 = 0; c2 < 3; c2++) p.D[i + c2] = (byte)Math.Min(255, p.D[i + c2] * f);
                    }
                }
            }
        }
        return p;
    }

    // kind: plate | photo. Returns a 1000x1250 product shot.
    public static KImg RenderPack(KImg tex, string kind, double wcm, double hcm, double tileWcm, double tileHcm, int slats, bool mirrorX, bool gloss)
    {
        int W = 1000, H = 1250; KImg c = new KImg(W, H); Background(c);
        if (kind == "photo")
        {
            double s = Math.Min(760.0 / tex.W, 900.0 / tex.H); int w = (int)(tex.W * s), h = (int)(tex.H * s);
            int x0 = (W - w) / 2, y0 = (int)(H * 0.45 - h / 2.0);
            float[] sh = new float[W * H]; FillQuadMask(sh, W, H, new double[] { x0 + 18, y0 + 34, x0 + w + 18, y0 + 34, x0 + w + 18, y0 + h + 34, x0 + 18, y0 + h + 34 });
            BoxBlur(sh, W, H, 22); BoxBlur(sh, W, H, 22); Shade(c, sh, 0.30, 60, 48, 38);
            KImg rs = tex.Resize(w, h);
            for (int y = 0; y < h; y++) Buffer.BlockCopy(rs.D, y * w * 3, c.D, ((y0 + y) * W + x0) * 3, w * 3);
            return c;
        }
        double aspect = wcm / hcm; bool land = aspect > 1.05;
        double Hs, Ws;
        if (!land) { Hs = 1000; Ws = Hs * aspect; if (Ws > 470) { Ws = 470; Hs = Ws / aspect; } }
        else { Ws = 820; Hs = Ws / aspect; if (Hs > 560) { Hs = 560; Ws = Hs * aspect; } }
        double appW = Ws * 0.90, far = 0.93;
        double x0p = land ? 70 : 110, yBottom = land ? 120 + Hs : 1085;
        double yTop = yBottom - Hs;
        double inset = Hs * (1 - far) / 2;
        double[] q = { x0p, yTop, x0p + appW, yTop + inset, x0p + appW, yBottom - inset, x0p, yBottom };
        // shadow cast to the right
        float[] sm = new float[W * H];
        double sk = land ? 60 : 140;
        FillQuadMask(sm, W, H, new double[] { q[0] + sk, q[1] + 30, q[2] + sk * 0.9, q[3] + 30, q[4] + 6, q[5] + 4, q[6] + 6, q[7] + 4 });
        BoxBlur(sm, W, H, 28); BoxBlur(sm, W, H, 28); Shade(c, sm, 0.26, 70, 56, 44);
        float[] cm = new float[W * H];
        FillQuadMask(cm, W, H, new double[] { q[6] - 10, q[7] - 6, q[4] + 16, q[5] - 6, q[4] + 22, q[5] + 10, q[6] - 14, q[7] + 12 });
        BoxBlur(cm, W, H, 9); Shade(c, cm, 0.42, 50, 40, 32);
        // edge thickness (right side)
        int ew = land ? 9 : 11;
        double[] edge = { q[2], q[3], q[2] + ew, q[3] + 2, q[4] + ew, q[5] - 2, q[4], q[5] };
        double eb = 0, eg = 0, er = 0; for (int i = 0; i < tex.D.Length; i += 3 * 11) { eb += tex.D[i]; eg += tex.D[i + 1]; er += tex.D[i + 2]; }
        double en = tex.D.Length / (3.0 * 11); eb = eb / en * 0.62; eg = eg / en * 0.62; er = er / en * 0.62;
        float[] em = new float[W * H]; FillQuadMask(em, W, H, edge);
        for (int p = 0, i = 0; p < em.Length; p++, i += 3) if (em[p] > 0) { c.D[i] = (byte)eb; c.D[i + 1] = (byte)eg; c.D[i + 2] = (byte)er; }
        // plate face
        KImg face = PlateSurface(tex, wcm, hcm, tileWcm, tileHcm, slats, mirrorX, 1300);
        double[] inv = Invert(SquareToQuad(q));
        int bx0 = (int)Math.Floor(q[0]) - 2, bx1 = (int)Math.Ceiling(q[2]) + 2, by0 = (int)Math.Floor(q[1]) - 2, by1 = (int)Math.Ceiling(q[7]) + 2;
        double pxU = 1.0 / appW, pxV = 1.0 / Hs;
        for (int y = Math.Max(0, by0); y < Math.Min(H, by1); y++) for (int x = Math.Max(0, bx0); x < Math.Min(W, bx1); x++)
        {
            double u, v; Map(inv, x + 0.5, y + 0.5, out u, out v);
            double au = Math.Min(u, 1 - u) / pxU, av = Math.Min(v, 1 - v) / pxV; double a = Math.Max(0, Math.Min(1, Math.Min(au, av) + 0.5));
            if (a <= 0) continue;
            double b, g, r; face.Sample(Math.Max(0, Math.Min(1, u)) * (face.W - 1), Math.Max(0, Math.Min(1, v)) * (face.H - 1), out b, out g, out r);
            double light = 1.05 - 0.12 * u - 0.04 * v;
            double band = Math.Exp(-Math.Pow((u * 0.8 + v * 0.45 - 0.42) / 0.10, 2));
            double spec = (gloss ? 0.20 : 0.05) * band * 255;
            b = b * light + spec; g = g * light + spec; r = r * light + spec;
            if (u < 0.004 || v < 0.002) { b += 28; g += 28; r += 28; } // bevel highlight
            int i = (y * W + x) * 3;
            c.D[i] = (byte)Math.Min(255, c.D[i] * (1 - a) + b * a); c.D[i + 1] = (byte)Math.Min(255, c.D[i + 1] * (1 - a) + g * a); c.D[i + 2] = (byte)Math.Min(255, c.D[i + 2] * (1 - a) + r * a);
        }
        // detail loupe (real photo)
        double lcx = land ? 760 : 770, lcy = land ? 930 : 860, lr = land ? 190 : 175;
        float[] lm = new float[W * H];
        for (int y = (int)(lcy - lr - 40); y < lcy + lr + 60; y++) for (int x = (int)(lcx - lr - 40); x < lcx + lr + 50; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue; double d = Dist(x, y, lcx + 8, lcy + 18); if (d < lr) lm[y * W + x] = 1; }
        BoxBlur(lm, W, H, 16); Shade(c, lm, 0.30, 50, 40, 30);
        double sc = Math.Max(2 * lr / tex.W, 2 * lr / tex.H) * 1.0;
        for (int y = (int)(lcy - lr - 12); y < lcy + lr + 12; y++) for (int x = (int)(lcx - lr - 12); x < lcx + lr + 12; x++)
        {
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            double d = Dist(x + 0.5, y + 0.5, lcx, lcy); int i = (y * W + x) * 3;
            if (d <= lr)
            {
                double b, g, r; tex.Sample(tex.W / 2.0 + (x - lcx) / sc, tex.H / 2.0 + (y - lcy) / sc, out b, out g, out r);
                double a = Math.Min(1, lr - d);
                c.D[i] = (byte)(c.D[i] * (1 - a) + b * a); c.D[i + 1] = (byte)(c.D[i + 1] * (1 - a) + g * a); c.D[i + 2] = (byte)(c.D[i + 2] * (1 - a) + r * a);
            }
            if (d > lr - 2 && d < lr + 9) { double a = Math.Min(1, Math.Min(d - (lr - 2), lr + 9 - d)); c.D[i] = (byte)(c.D[i] * (1 - a) + 252 * a); c.D[i + 1] = (byte)(c.D[i + 1] * (1 - a) + 252 * a); c.D[i + 2] = (byte)(c.D[i + 2] * (1 - a) + 252 * a); }
        }
        return c;
    }
}
