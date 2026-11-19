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

    // ---------- texture synthesis (image quilting, Efros & Freeman 2001) ----------
    // Removes a linear lighting gradient (photo falloff) so patches from different places match.
    public static void FlattenLight(KImg im, bool fitX, bool fitY)
    {
        int W = im.W, H = im.H; double sx = 0, sy = 0, sl = 0, sxx = 0, syy = 0, sxl = 0, syl = 0, n = 0;
        for (int y = 0; y < H; y += 2) for (int x = 0; x < W; x += 2)
        {
            int i = (y * W + x) * 3; double l = 0.114 * im.D[i] + 0.587 * im.D[i + 1] + 0.299 * im.D[i + 2];
            double u = x - W / 2.0, v = y - H / 2.0; sx += u; sy += v; sl += l; sxx += u * u; syy += v * v; sxl += u * l; syl += v * l; n++;
        }
        double mean = sl / n, bx = fitX && sxx > 0 ? (sxl - sx * mean) / (sxx - sx * sx / n) : 0, by = fitY && syy > 0 ? (syl - sy * mean) / (syy - sy * sy / n) : 0;
        if (mean < 1) return;
        for (int y = 0; y < H; y++) for (int x = 0; x < W; x++)
        {
            double fit = mean + bx * (x - W / 2.0) + by * (y - H / 2.0); double g = Math.Max(0.8, Math.Min(1.25, mean / Math.Max(1, fit)));
            int i = (y * W + x) * 3; for (int c = 0; c < 3; c++) im.D[i + c] = (byte)Math.Min(255, im.D[i + c] * g);
        }
    }
    // Evens out uneven lighting over the sample (large-scale luminance), keeps colour and detail.
    public static void FlattenLowFreq(KImg im, int radius)
    {
        int W = im.W, H = im.H, n = W * H; if (radius < 2) return;
        float[] L = new float[n]; double mean = 0;
        for (int p2 = 0, i = 0; p2 < n; p2++, i += 3) { L[p2] = (float)(0.114 * im.D[i] + 0.587 * im.D[i + 1] + 0.299 * im.D[i + 2]); mean += L[p2]; }
        mean /= n; if (mean < 4) return;
        float[] Bl = (float[])L.Clone(); BoxBlur(Bl, W, H, radius); BoxBlur(Bl, W, H, radius);
        for (int p2 = 0, i = 0; p2 < n; p2++, i += 3) { double g = Math.Max(0.85, Math.Min(1.18, mean / Math.Max(1, Bl[p2]))); for (int c = 0; c < 3; c++) im.D[i + c] = (byte)Math.Min(255, im.D[i + c] * g); }
    }
    // >1: structure runs vertically (streaks), <1: horizontally.
    public static double Anisotropy(KImg im)
    {
        double gx = 0, gy = 0;
        for (int y = 1; y < im.H; y += 2) for (int x = 1; x < im.W; x += 2)
        {
            int i = (y * im.W + x) * 3, l = i - 3, u = i - im.W * 3;
            double c0 = im.D[i] + im.D[i + 1] + im.D[i + 2];
            gx += Math.Abs(c0 - im.D[l] - im.D[l + 1] - im.D[l + 2]); gy += Math.Abs(c0 - im.D[u] - im.D[u + 1] - im.D[u + 2]);
        }
        return gx / Math.Max(1, gy);
    }
    static int Px(KImg s, int sx, int sy, int bw, int bh, int f, int x, int y)
    {
        int xx = (f & 1) == 1 ? sx + bw - 1 - x : sx + x, yy = (f & 2) == 2 ? sy + bh - 1 - y : sy + y;
        return (yy * s.W + xx) * 3;
    }
    // Synthesises an outW x outH texture that continues the sample: blocks of the real photo, chosen to match
    // their neighbours, joined along minimum-error seams. vertOnly: blocks span the full width (slats, grooves stay aligned).
    public static KImg Quilt(KImg src, int outW, int outH, int B, int ov, bool vertOnly, bool flips, int seed)
    { return Quilt(src, outW, outH, B, B, ov, vertOnly, flips, seed); }
    // Bw x Bh blocks: elongated blocks follow streaky materials (fewer seams across the streaks).
    public static KImg Quilt(KImg src, int outW, int outH, int Bw, int Bh, int ov, bool vertOnly, bool flips, int seed)
    { return Quilt(src, outW, outH, Bw, Bh, ov, vertOnly, flips, seed, false); }
    // allowCont: the sample may continue into itself (fewer seams; used for straight stripes that must stay aligned)
    public static KImg Quilt(KImg src, int outW, int outH, int Bw, int Bh, int ov, bool vertOnly, bool flips, int seed, bool allowCont)
    {
        Random rnd = new Random(seed);
        int sw = src.W, sh = src.H;
        if (vertOnly) { if (outW != sw) src = src.Resize(outW, Math.Max(2, (int)Math.Round(sh * (double)outW / sw))); sw = src.W; sh = src.H; }
        Bw = vertOnly ? outW : Math.Max(8, Math.Min(Bw, sw - 2)); Bh = Math.Max(8, Math.Min(Bh, sh - 2)); ov = Math.Max(2, Math.Min(ov, Math.Min(Bw, Bh) / 3));
        float[] o = new float[outW * outH * 3];
        int stepX = Bw - ov, stepY = Bh - ov, cols = vertOnly ? 1 : Math.Max(1, (int)Math.Ceiling((outW - ov) / (double)stepX)), rows = Math.Max(1, (int)Math.Ceiling((outH - ov) / (double)stepY));
        int[] lastSx = new int[cols], lastSy = new int[cols]; for (int k = 0; k < cols; k++) { lastSx[k] = -9999; lastSy[k] = -9999; }
        int[,] usedX = new int[rows, cols], usedY = new int[rows, cols];
        for (int r0 = 0; r0 < rows; r0++) for (int q0 = 0; q0 < cols; q0++) { usedX[r0, q0] = -99999; usedY[r0, q0] = -99999; }
        int K = vertOnly ? 260 : 360;
        double[] errs = new double[K], pens = new double[K]; int[] cx = new int[K], cy = new int[K], cf = new int[K];
        const int GN = 12; double[] G = new double[GN * GN];   // how often each part of the sample was used
        for (int r = 0; r < rows; r++)
        {
            int by = r * stepY, bh = Math.Min(Bh, outH - by); if (bh <= 0) break;
            int leftSx = -9999, leftSy = -9999;
            for (int q = 0; q < cols; q++)
            {
                int bx = vertOnly ? 0 : q * stepX, bw = vertOnly ? outW : Math.Min(Bw, outW - bx); if (bw <= 0) break;
                bool hasL = bx > 0, hasT = by > 0;
                // candidate search
                double minE = double.MaxValue; int nc = 0;
                double rxN = Math.Min(Bw * 0.6, (sw - bw) / 3.0), ryN = Math.Min(Bh * 0.6, (sh - bh) / 3.0);
                for (int pass = 0; pass < 2 && nc == 0; pass++)
                for (int k = 0; k < K; k++)
                {
                    int sx = vertOnly ? 0 : rnd.Next(0, sw - bw + 1), sy = rnd.Next(0, sh - bh + 1);
                    int f = flips ? (vertOnly ? rnd.Next(2) * 2 : rnd.Next(2) * 3) : 0;   // 2d: 180 degree turn only (no mirror)
                    // force a new placement instead of copying the sample's own continuation
                    if (!allowCont && pass == 0 && hasT && f == 0 && Math.Abs(sx - lastSx[q]) < Bw / 3 && Math.Abs(sy - (lastSy[q] + stepY)) < Bh / 3) continue;
                    if (!allowCont && pass == 0 && hasL && f == 0 && Math.Abs(sy - leftSy) < Bh / 3 && Math.Abs(sx - (leftSx + stepX)) < Bw / 3) continue;
                    bool near = false;
                    if (pass == 0 && !allowCont) for (int dr = -2; dr <= 0 && !near; dr++) for (int dq = -2; dq <= 2 && !near; dq++)
                    {
                        if (dr == 0 && dq >= 0) continue; int rr = r + dr, qq = q + dq; if (rr < 0 || qq < 0 || qq >= cols) continue;
                        if (Math.Abs(sx - usedX[rr, qq]) < rxN && Math.Abs(sy - usedY[rr, qq]) < ryN) near = true;
                    }
                    if (near) continue;
                    double e = 0;
                    if (hasL) for (int y = 0; y < bh; y += 2) for (int x = 0; x < ov; x += 2) { int oi = ((by + y) * outW + bx + x) * 3, si = Px(src, sx, sy, bw, bh, f, x, y); for (int c = 0; c < 3; c++) { double d = o[oi + c] - src.D[si + c]; e += d * d; } }
                    if (hasT) for (int y = 0; y < ov; y += 2) for (int x = hasL ? ov : 0; x < bw; x += 2) { int oi = ((by + y) * outW + bx + x) * 3, si = Px(src, sx, sy, bw, bh, f, x, y); for (int c = 0; c < 3; c++) { double d = o[oi + c] - src.D[si + c]; e += d * d; } }
                    double pen = 0; int pc = 0;
                    for (int gy = sy * GN / sh; gy <= Math.Min(GN - 1, (sy + bh - 1) * GN / sh); gy++) for (int gx = sx * GN / sw; gx <= Math.Min(GN - 1, (sx + bw - 1) * GN / sw); gx++) { pen += G[gy * GN + gx]; pc++; }
                    errs[nc] = e; pens[nc] = pc > 0 ? pen / pc : 0; cx[nc] = sx; cy[nc] = sy; cf[nc] = f; nc++;
                }
                if (nc == 0) { errs[0] = 0; pens[0] = 0; cx[0] = vertOnly ? 0 : rnd.Next(0, sw - bw + 1); cy[0] = rnd.Next(0, sh - bh + 1); cf[0] = 0; nc = 1; }
                double avgE = 0; for (int k = 0; k < nc; k++) avgE += errs[k]; avgE = avgE / nc + 1;
                double avgP = 0; for (int k = 0; k < nc; k++) avgP += pens[k]; avgP = avgP / nc + 0.5;
                for (int k = 0; k < nc; k++) { errs[k] += 0.6 * avgE * pens[k] / avgP; if (errs[k] < minE) minE = errs[k]; }
                double lim = minE * 1.12 + 1e-6; int pick = -1, seen = 0;
                for (int k = 0; k < nc; k++) if (errs[k] <= lim) { seen++; if (rnd.Next(seen) == 0) pick = k; }
                int psx = cx[pick], psy = cy[pick], pf = cf[pick];
                // tone match: shift the patch towards the colour of what it overlaps (hides brightness jumps between blocks)
                double[] off = new double[3]; int cnt = 0;
                if (hasL || hasT)
                {
                    for (int y = 0; y < bh; y += 2) for (int x = 0; x < bw; x += 2)
                    {
                        if (!((hasL && x < ov) || (hasT && y < ov))) continue;
                        int oi = ((by + y) * outW + bx + x) * 3, si = Px(src, psx, psy, bw, bh, pf, x, y);
                        for (int c = 0; c < 3; c++) off[c] += o[oi + c] - src.D[si + c]; cnt++;
                    }
                    for (int c = 0; c < 3; c++) off[c] = cnt > 0 ? Math.Max(-18, Math.Min(18, off[c] / cnt * 0.85)) : 0;
                }
                // minimum-error seams
                int[] vs = null, hs = null;
                if (hasL)
                {
                    double[] E = new double[bh * ov];
                    for (int y = 0; y < bh; y++) for (int x = 0; x < ov; x++)
                    {
                        int oi = ((by + y) * outW + bx + x) * 3, si = Px(src, psx, psy, bw, bh, pf, x, y); double e = 0; for (int c = 0; c < 3; c++) { double d = o[oi + c] - src.D[si + c]; e += d * d; }
                        if (y > 0) { double m = E[(y - 1) * ov + x]; if (x > 0) m = Math.Min(m, E[(y - 1) * ov + x - 1]); if (x < ov - 1) m = Math.Min(m, E[(y - 1) * ov + x + 1]); e += m; }
                        E[y * ov + x] = e;
                    }
                    vs = new int[bh]; int bxs = 0; for (int x = 1; x < ov; x++) if (E[(bh - 1) * ov + x] < E[(bh - 1) * ov + bxs]) bxs = x; vs[bh - 1] = bxs;
                    for (int y = bh - 2; y >= 0; y--) { int px0 = vs[y + 1], b = px0; for (int d = -1; d <= 1; d++) { int x = px0 + d; if (x >= 0 && x < ov && E[y * ov + x] < E[y * ov + b]) b = x; } vs[y] = b; }
                }
                if (hasT)
                {
                    double[] E = new double[bw * ov];
                    for (int x = 0; x < bw; x++) for (int y = 0; y < ov; y++)
                    {
                        int oi = ((by + y) * outW + bx + x) * 3, si = Px(src, psx, psy, bw, bh, pf, x, y); double e = 0; for (int c = 0; c < 3; c++) { double d = o[oi + c] - src.D[si + c]; e += d * d; }
                        if (x > 0) { double m = E[(x - 1) * ov + y]; if (y > 0) m = Math.Min(m, E[(x - 1) * ov + y - 1]); if (y < ov - 1) m = Math.Min(m, E[(x - 1) * ov + y + 1]); e += m; }
                        E[x * ov + y] = e;
                    }
                    hs = new int[bw]; int bys = 0; for (int y = 1; y < ov; y++) if (E[(bw - 1) * ov + y] < E[(bw - 1) * ov + bys]) bys = y; hs[bw - 1] = bys;
                    for (int x = bw - 2; x >= 0; x--) { int py0 = hs[x + 1], b = py0; for (int d = -1; d <= 1; d++) { int y = py0 + d; if (y >= 0 && y < ov && E[x * ov + y] < E[x * ov + b]) b = y; } hs[x] = b; }
                }
                // paste with a soft edge along the seams
                for (int y = 0; y < bh; y++) for (int x = 0; x < bw; x++)
                {
                    double a = 1;
                    if (vs != null && x < ov) a = Math.Min(a, Math.Max(0, Math.Min(1, (x - vs[y]) / 5.0 + 0.5)));
                    if (hs != null && y < ov) a = Math.Min(a, Math.Max(0, Math.Min(1, (y - hs[x]) / 5.0 + 0.5)));
                    if (a <= 0) continue;
                    int oi = ((by + y) * outW + bx + x) * 3, si = Px(src, psx, psy, bw, bh, pf, x, y);
                    for (int c = 0; c < 3; c++) o[oi + c] = (float)(o[oi + c] * (1 - a) + (src.D[si + c] + off[c]) * a);
                }
                lastSx[q] = psx; lastSy[q] = psy; leftSx = psx; leftSy = psy; usedX[r, q] = psx; usedY[r, q] = psy;
                for (int gy = psy * GN / sh; gy <= Math.Min(GN - 1, (psy + bh - 1) * GN / sh); gy++) for (int gx = psx * GN / sw; gx <= Math.Min(GN - 1, (psx + bw - 1) * GN / sw); gx++) G[gy * GN + gx] += 1;
            }
        }
        KImg res = new KImg(outW, outH); for (int i = 0; i < o.Length; i++) res.D[i] = (byte)Math.Max(0, Math.Min(255, o[i] + 0.5));
        return res;
    }
    // Makes vertical grooves/stripes truly vertical (photos are often slightly tilted): shear by the measured drift.
    public static KImg Deskew(KImg im)
    {
        int W = im.W, H = im.H; if (W < 16 || H < 24) return im;
        int band = Math.Max(4, H / 4); double[] top = new double[W], bot = new double[W];
        for (int x = 0; x < W; x++)
        {
            double a = 0, b = 0;
            for (int y = 0; y < band; y++) { int i = (y * W + x) * 3; a += im.D[i] + im.D[i + 1] + im.D[i + 2]; int j = ((H - 1 - y) * W + x) * 3; b += im.D[j] + im.D[j + 1] + im.D[j + 2]; }
            top[x] = a; bot[x] = b;
        }
        Func<double[], double[]> hp = delegate (double[] v) { double[] r = new double[v.Length]; int k = Math.Max(2, v.Length / 12); for (int x = 0; x < v.Length; x++) { double s2 = 0; int n = 0; for (int d = -k; d <= k; d++) { int xx = x + d; if (xx >= 0 && xx < v.Length) { s2 += v[xx]; n++; } } r[x] = v[x] - s2 / n; } return r; };
        double[] t2 = hp(top), b2 = hp(bot);
        int maxS = Math.Max(1, W / 6), best = 0; double bestC = double.MinValue;
        for (int sft = -maxS; sft <= maxS; sft++)
        {
            double c = 0; int n = 0; for (int x = 0; x < W; x++) { int xx = x + sft; if (xx < 0 || xx >= W) continue; c += t2[x] * b2[xx]; n++; }
            if (n > W / 2) { c /= n; if (c > bestC) { bestC = c; best = sft; } }
        }
        if (best == 0) return im;
        double slope = best / (double)(H - band); int m = (int)Math.Ceiling(Math.Abs(slope) * H / 2.0) + 1;
        if (W - 2 * m < W / 2) return im;
        KImg o = new KImg(W - 2 * m, H);
        for (int y = 0; y < H; y++) for (int x = 0; x < o.W; x++)
        {
            double sx = x + m + slope * (y - H / 2.0); double bl, gr, rd; im.Sample(sx, y, out bl, out gr, out rd);
            int i = (y * o.W + x) * 3; o.D[i] = (byte)bl; o.D[i + 1] = (byte)gr; o.D[i + 2] = (byte)rd;
        }
        return o;
    }
    // Removes near-white margins around a product shot so only the material is used.
    public static KImg TrimWhite(KImg im)
    {
        int W = im.W, H = im.H;
        Func<int, bool, bool> white = delegate (int k, bool col)
        {
            int n = 0, t = 0; int len = col ? H : W;
            for (int j = 0; j < len; j += 3) { int x = col ? k : j, y = col ? j : k; int i = (y * W + x) * 3; t++; if (im.D[i] > 236 && im.D[i + 1] > 236 && im.D[i + 2] > 236) n++; }
            return n >= t * 0.9;
        };
        int x0 = 0, x1 = W - 1, y0 = 0, y1 = H - 1;
        while (x0 < x1 && white(x0, true)) x0++; while (x1 > x0 && white(x1, true)) x1--;
        while (y0 < y1 && white(y0, false)) y0++; while (y1 > y0 && white(y1, false)) y1--;
        int m = 6; x0 = Math.Min(x1, x0 + (x0 > 0 ? m : 0)); x1 = Math.Max(x0, x1 - (x1 < W - 1 ? m : 0)); y0 = Math.Min(y1, y0 + (y0 > 0 ? m : 0)); y1 = Math.Max(y0, y1 - (y1 < H - 1 ? m : 0));
        int w = x1 - x0 + 1, h = y1 - y0 + 1;
        if ((w == W && h == H) || w < W / 5 || h < H / 5) return im;
        return im.Crop(x0, y0, w, h);
    }
    public static KImg Rotate90(KImg im)
    {
        KImg o = new KImg(im.H, im.W);
        for (int y = 0; y < im.H; y++) for (int x = 0; x < im.W; x++) { int si = (y * im.W + x) * 3, di = (x * o.W + (im.H - 1 - y)) * 3; o.D[di] = im.D[si]; o.D[di + 1] = im.D[si + 1]; o.D[di + 2] = im.D[si + 2]; }
        return o;
    }
    // Crops a striped sample (dark gaps between slats) from gap to gap so columns can sit side by side without a seam.
    public static KImg CropToGaps(KImg im)
    {
        int W = im.W, H = im.H; double[] col = new double[W];
        for (int x = 0; x < W; x++) { double s = 0; for (int y = 0; y < H; y += 2) { int i = (y * W + x) * 3; s += 0.114 * im.D[i] + 0.587 * im.D[i + 1] + 0.299 * im.D[i + 2]; } col[x] = s; }
        int a = 0, b = W - 1; for (int x = 0; x < W / 4; x++) if (col[x] < col[a]) a = x; for (int x = W - 1; x > W * 3 / 4; x--) if (col[x] < col[b]) b = x;
        if (b - a < W / 2) return im; return im.Crop(a, 0, b - a, H);
    }
    // Plate face at true scale: the sample covers sampleWcm; the rest is synthesised, not stretched.
    // mode: slats (one quilted column per slat), cols (striped panel: gap-to-gap columns), 2d (free quilting)
    static KImg PlateSynth(KImg tex, string mode, double wcm, double hcm, double sampleWcm, int slats, int maxPx, int seed)
    {
        double ppc = maxPx / Math.Max(wcm, hcm);
        int pw = Math.Max(8, (int)(wcm * ppc)), ph = Math.Max(8, (int)(hcm * ppc));
        KImg p = new KImg(pw, ph);
        KImg s = TrimWhite(tex);
        bool free2d = mode == "2d" || mode == "2dn";
        if (mode == "slats" && Anisotropy(s) < 0.6) s = Rotate90(s);   // boards photographed lying down
        if (free2d && Anisotropy(s) > 2.0) { mode = "lines"; free2d = false; }   // straight vertical relief: keep the lines continuous
        int baseW = s.W;
        if (!free2d) s = Deskew(s);
        if (mode == "cols") s = CropToGaps(s);
        double colWcm = mode == "slats" ? wcm / slats : sampleWcm * s.W / baseW;
        int sw = Math.Max(8, (int)Math.Round((free2d ? sampleWcm : colWcm) * ppc)), sh = Math.Max(8, (int)Math.Round(sw * (double)s.H / s.W));
        s = s.Resize(sw, sh); FlattenLight(s, free2d, true); if (free2d) FlattenLowFreq(s, Math.Max(3, Math.Min(sw, sh) / 4));
        if (free2d)
        {
            double an = Anisotropy(s); int Bw, Bh;
            if (an > 1.45) { Bw = (int)(sw * 0.45); Bh = (int)(sh * 0.88); }
            else if (an < 0.69) { Bw = (int)(sw * 0.88); Bh = (int)(sh * 0.45); }
            else { Bw = Bh = (int)(Math.Min(sw, sh) * 0.55); }
            KImg q = Quilt(s, pw, ph, Bw, Bh, Math.Max(6, Math.Min(Bw, Bh) / 4), false, mode == "2d" && an <= 1.45 && an >= 0.69, seed);
            Buffer.BlockCopy(q.D, 0, p.D, 0, q.D.Length); return p;
        }
        int n = mode == "slats" ? slats : Math.Max(1, (int)Math.Ceiling(pw / (double)sw));
        for (int k = 0; k < n; k++)
        {
            int x0 = mode == "slats" ? (int)(pw * (double)k / n) : k * sw, x1 = mode == "slats" ? (int)(pw * (double)(k + 1) / n) : Math.Min(pw, (k + 1) * sw);
            int cw = x1 - x0; if (cw <= 0) continue;
            int B = (int)(Math.Min(sh, Math.Max(sh * 0.5, 12))); KImg q = Quilt(s, s.W, ph, B, B, Math.Max(4, B / 4), true, false, seed * 31 + k * 7919, mode != "slats");
            for (int y = 0; y < ph; y++) for (int x = 0; x < cw; x++) { int si = (y * q.W + Math.Min(q.W - 1, x)) * 3, di = (y * pw + x0 + x) * 3; p.D[di] = q.D[si]; p.D[di + 1] = q.D[si + 1]; p.D[di + 2] = q.D[si + 2]; }
        }
        if (mode == "slats" && slats > 1)
        {
            for (int k = 1; k < slats; k++)
            {
                int gx = (int)(pw * (double)k / slats);
                for (int y = 0; y < ph; y++) for (int d = -2; d <= 2; d++)
                {
                    int x = gx + d; if (x < 0 || x >= pw) continue; int i = (y * pw + x) * 3;
                    double f = d <= 0 ? 0.45 + 0.12 * (d + 2) : 1.10;
                    for (int c2 = 0; c2 < 3; c2++) p.D[i + c2] = (byte)Math.Min(255, p.D[i + c2] * f);
                }
            }
        }
        return p;
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
    { return RenderPack(tex, kind, wcm, hcm, tileWcm, tileHcm, slats, mirrorX, gloss, "tile", 0, 1); }
    // Flat front face of a plate at true scale (long side 1300 px, ~4.6 px/cm for 280 cm), no decor or perspective.
    // Also exported as src/assets/img/face/<id>.jpg for the 3D studio.
    public static KImg PlateFace(KImg tex, double wcm, double hcm, double tileWcm, double tileHcm, int slats, bool mirrorX, string synth, double sampleWcm, int seed)
    { return synth == "tile" ? PlateSurface(TrimWhite(tex), wcm, hcm, tileWcm, tileHcm, slats, mirrorX, 1300) : PlateSynth(tex, synth, wcm, hcm, sampleWcm, slats, 1300, seed); }
    public static KImg RenderPack(KImg tex, string kind, double wcm, double hcm, double tileWcm, double tileHcm, int slats, bool mirrorX, bool gloss, string synth, double sampleWcm, int seed)
    { return RenderPack(tex, kind, wcm, hcm, tileWcm, tileHcm, slats, mirrorX, gloss, synth, sampleWcm, seed, null); }
    // faceIn: a face already built with PlateFace (same arguments), to avoid synthesising it twice.
    public static KImg RenderPack(KImg tex, string kind, double wcm, double hcm, double tileWcm, double tileHcm, int slats, bool mirrorX, bool gloss, string synth, double sampleWcm, int seed, KImg faceIn)
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
        KImg face = faceIn ?? PlateFace(tex, wcm, hcm, tileWcm, tileHcm, slats, mirrorX, synth, sampleWcm, seed);
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

    // ---------- fluted slats: find the flutes, straighten them, keep exactly the slat ----------
    static double[] BandProfile(KImg s, int y0, int y1)
    {
        int W = s.W; double[] p = new double[W]; y0 = Math.Max(0, y0); y1 = Math.Min(s.H, Math.Max(y0 + 1, y1));
        for (int y = y0; y < y1; y++) for (int x = 0; x < W; x++) { int i = (y * W + x) * 3; p[x] += 0.114 * s.D[i] + 0.587 * s.D[i + 1] + 0.299 * s.D[i + 2]; }
        int r = Math.Max(1, W / 160); double[] q = new double[W];
        for (int x = 0; x < W; x++) { double t = 0; int n = 0; for (int d = -r; d <= r; d++) { int xx = x + d; if (xx >= 0 && xx < W) { t += p[xx]; n++; } } q[x] = t / n / (y1 - y0); }
        return q;
    }
    static double[] HighPass(double[] p, int r)
    {
        double[] o = new double[p.Length];
        for (int x = 0; x < p.Length; x++) { double t = 0; int n = 0; for (int d = -r; d <= r; d++) { int xx = x + d; if (xx >= 0 && xx < p.Length) { t += p[xx]; n++; } } o[x] = p[x] - t / n; }
        return o;
    }
    static double FlutePeriod(double[] p)
    {
        int W = p.Length; double[] h = HighPass(p, Math.Max(3, W / 5)); int best = -1; double bc = 0;
        double e0 = 0; for (int x = 0; x < W; x++) e0 += h[x] * h[x]; if (e0 <= 0) return -1;
        int l0 = Math.Max(4, W / 14), l1 = W / 2; if (l1 <= l0) return -1; double[] cc = new double[l1 + 2];
        for (int lag = l0; lag <= l1; lag++)
        {
            double c = 0; int n = 0; for (int x = 0; x + lag < W; x++) { c += h[x] * h[x + lag]; n++; }
            c = c / n / (e0 / W); cc[lag] = c; if (c > bc) { bc = c; best = lag; }
        }
        if (bc <= 0.35) return -1;
        for (int lag = l0 + 1; lag < best; lag++) if (cc[lag] >= 0.8 * bc && cc[lag] >= cc[lag - 1] && cc[lag] >= cc[lag + 1]) return lag;
        return best;
    }
    static List<int> GrooveMinima(double[] p, double P)
    {
        var g = new List<int>(); int W = p.Length, win = Math.Max(2, (int)(P / 3));
        double mean = 0; foreach (double v in p) mean += v; mean /= W; double sd = 0; foreach (double v in p) sd += (v - mean) * (v - mean); sd = Math.Sqrt(sd / W);
        for (int x = 1; x < W - 1; x++)
        {
            bool isMin = true; for (int d = -win; d <= win && isMin; d++) { int xx = x + d; if (xx >= 0 && xx < W && p[xx] < p[x]) isMin = false; }
            if (!isMin) continue;
            double loc = 0; int n = 0; for (int d = (int)(-P / 2); d <= P / 2; d++) { int xx = x + d; if (xx >= 0 && xx < W) { loc += p[xx]; n++; } } loc /= n;
            if (p[x] < loc - 0.25 * sd && (g.Count == 0 || x - g[g.Count - 1] > P * 0.6)) g.Add(x);
        }
        return g;
    }
    // Straightens a fluted sample: every groove is tracked down the photo and mapped to a vertical line
    // (removes tilt and the perspective that makes flutes converge). Returns null if no flutes are found.
    static KImg StraightenFlutes(KImg s, out double period, out List<double> grooves)
    {
        period = -1; grooves = null; int W = s.W, H = s.H;
        double[] pm = BandProfile(s, (int)(H * 0.3), (int)(H * 0.7)); double P = FlutePeriod(pm); if (P < 0) return null;
        List<int> g0 = GrooveMinima(pm, P); if (g0.Count < 2) return null;
        int nb = 8, ng = g0.Count; double[] a = new double[ng], cs = new double[ng];
        for (int i = 0; i < ng; i++)
        {
            double sy = 0, sx = 0, syy = 0, sxy = 0; int n = 0;
            for (int b = 0; b < nb; b++)
            {
                int y0 = H * b / nb, y1 = H * (b + 1) / nb; double[] bp = BandProfile(s, y0, y1);
                int lo = Math.Max(0, (int)(g0[i] - P / 3)), hi = Math.Min(W - 1, (int)(g0[i] + P / 3)), bx = g0[i];
                for (int x = lo; x <= hi; x++) if (bp[x] < bp[bx]) bx = x;
                double yc = (y0 + y1) / 2.0 - H / 2.0; sy += yc; sx += bx; syy += yc * yc; sxy += yc * bx; n++;
            }
            double slope = (sxy - sy * sx / n) / Math.Max(1e-6, syy - sy * sy / n); if (Math.Abs(slope) > 0.25) slope = 0;
            a[i] = sx / n - slope * sy / n; cs[i] = slope;
        }
        KImg o = new KImg(W, H);
        for (int y = 0; y < H; y++)
        {
            double yc = y - H / 2.0; double[] S = new double[ng]; for (int i = 0; i < ng; i++) S[i] = a[i] + cs[i] * yc;
            for (int x = 0; x < W; x++)
            {
                int i = 0; while (i < ng - 2 && x > a[i + 1]) i++;
                double k = (S[i + 1] - S[i]) / Math.Max(1e-6, a[i + 1] - a[i]); double sx = S[i] + (x - a[i]) * k;
                double bl, gr, rd; s.Sample(Math.Max(0, Math.Min(W - 1, sx)), y, out bl, out gr, out rd);
                int di = (y * W + x) * 3; o.D[di] = (byte)bl; o.D[di + 1] = (byte)gr; o.D[di + 2] = (byte)rd;
            }
        }
        period = P; grooves = new List<double>(a); return o;
    }
    static double[] Resample(double[] p, double x0, double x1, int n)
    {
        double[] r = new double[n]; double m = 0;
        for (int k = 0; k < n; k++) { double x = x0 + (x1 - x0) * (k + 0.5) / n; int xi = Math.Max(0, Math.Min(p.Length - 1, (int)x)); r[k] = p[xi]; m += r[k]; }
        m /= n; double sd = 0; for (int k = 0; k < n; k++) { r[k] -= m; sd += r[k] * r[k]; } sd = Math.Sqrt(sd / n) + 1e-6; for (int k = 0; k < n; k++) r[k] /= sd;
        return r;
    }
    // Keeps exactly the slat: the full flutes between grooves, plus an edge flute only if it really looks like one.
    static KImg CropToSlat(KImg s, double P, List<double> g, out int flutes)
    {
        flutes = 0;
        int W = s.W; double[] p = BandProfile(s, s.H / 5, s.H * 4 / 5); const int N = 48; var gAll = new List<double>(g);
        // flutes between consecutive grooves; drop end segments that do not look like the typical flute
        int i0 = 0, i1 = g.Count - 1;
        double[] mean = new double[N]; int nf = 0;
        for (int i = 0; i + 1 < g.Count; i++) { double w = g[i + 1] - g[i]; if (w < 0.7 * P || w > 1.3 * P) continue; double[] r = Resample(p, g[i], g[i + 1], N); for (int k = 0; k < N; k++) mean[k] += r[k]; nf++; }
        if (nf == 0) return s;
        Diag = "";
        Func<double, double, double> corr = delegate (double x0, double x1) { double[] r = Resample(p, x0, x1, N); double c = 0; for (int k = 0; k < N; k++) c += r[k] * mean[k] / nf; return c / N; };
        while (i1 - i0 > 2 && (g[i0 + 1] - g[i0] < 0.7 * P || g[i0 + 1] - g[i0] > 1.3 * P || corr(g[i0], g[i0 + 1]) < 0.5)) i0++;
        while (i1 - i0 > 2 && (g[i1] - g[i1 - 1] < 0.7 * P || g[i1] - g[i1 - 1] > 1.3 * P || corr(g[i1 - 1], g[i1]) < 0.5)) i1--;
        double left = g[i0], right = g[i1]; int nfl = i1 - i0;
        int keep = i1 - i0; var gk = new List<double>(); for (int i = i0; i <= i1; i++) gk.Add(g[i]); g = gk;
        double Pm = (right - left) / Math.Max(1, g.Count - 1);
        double cl = left - Pm >= -0.08 * Pm ? corr(Math.Max(0, left - Pm), left) : -9, cr = right + Pm <= W + 0.08 * Pm ? corr(right, Math.Min(W, right + Pm)) : -9;
        if (cl > 0.55) { left = Math.Max(0, left - Pm); nfl++; }
        if (cr > 0.55) { right = Math.Min(W, right + Pm); nfl++; }
        Diag = string.Format(System.Globalization.CultureInfo.InvariantCulture, "P={0:0.0} grooves=[{1}] kept {2}..{3} corrL={4:0.00} corrR={5:0.00} -> x {6:0}..{7:0}, {8} flutes", P, string.Join(",", gAll.ConvertAll(v => v.ToString("0"))), i0, i1, cl, cr, left, right, nfl);
        int cx0 = (int)Math.Round(left), cx1 = (int)Math.Round(right); if (cx1 - cx0 < W / 4) return s;
        flutes = nfl;
        return s.Crop(cx0, 0, cx1 - cx0, s.H);
    }
    // Evens the brightness along the length (photo light falloff) without touching the flutes across the width.
    static void FlattenRows(KImg s, int radius)
    {
        int W = s.W, H = s.H; double[] rm = new double[H]; double gm = 0;
        for (int y = 0; y < H; y++) { double t = 0; for (int x = 0; x < W; x++) { int i = (y * W + x) * 3; t += 0.114 * s.D[i] + 0.587 * s.D[i + 1] + 0.299 * s.D[i + 2]; } rm[y] = t / W; gm += rm[y]; }
        gm /= H; double[] sm = new double[H];
        for (int y = 0; y < H; y++) { double t = 0; int n = 0; for (int d = -radius; d <= radius; d++) { int yy = y + d; if (yy >= 0 && yy < H) { t += rm[yy]; n++; } } sm[y] = t / n; }
        for (int y = 0; y < H; y++) { double g = Math.Max(0.85, Math.Min(1.18, gm / Math.Max(1, sm[y]))); for (int x = 0; x < W; x++) { int i = (y * W + x) * 3; for (int c = 0; c < 3; c++) s.D[i + c] = (byte)Math.Min(255, s.D[i + c] * g); } }
    }
    // The slat as it really is: straight, exactly its flutes, even light. Used for the faces, the wall and the loupe.
    public static string Diag = "";
    // wcm > 0: the slat's real width. Fluted slats are rebuilt with round(wcm / 5) flutes (5 cm per flute, as measured on
    // the 20 cm / 4 flute model) by repeating whole flutes of the photo, so a photo showing only part of the slat
    // does not get stretched to the full width.
    static KImg PrepareSlat(KImg tex, double wcm, out int flutes)
    {
        flutes = 0;
        KImg s = TrimWhite(tex);
        if (Anisotropy(s) < 0.6) s = Rotate90(s);
        double P; List<double> g; KImg st = StraightenFlutes(s, out P, out g);
        KImg s0 = s;
        if (st != null) s = CropToSlat(st, P, g, out flutes); else { s = Deskew(s); Diag = "no flutes found"; }
        if (st != null && flutes < 2) { s = Deskew(s0); flutes = 0; Diag += " -> single strip: whole photo kept"; }
        int target = wcm > 0 ? Math.Max(2, (int)Math.Round(wcm / 5.0)) : flutes;
        if (flutes >= 2 && target != flutes)
        {
            int fw = s.W / flutes, nw = fw * target; KImg o = new KImg(nw, s.H);
            for (int y = 0; y < s.H; y++) for (int k = 0; k < target; k++) Buffer.BlockCopy(s.D, (y * s.W + (k % flutes) * fw) * 3, o.D, (y * nw + k * fw) * 3, fw * 3);
            Diag += " -> rebuilt with " + target + " flutes"; s = o; flutes = target;
        }
        FlattenLight(s, false, true); FlattenRows(s, Math.Max(4, s.H / 6));
        return s;
    }

    // ---------- slats: two loose slats at true proportions ----------
    // One slat face at ppc px/cm from the prepared sample (straight, exactly the slat), continued along its length.
    // The grain is stretched lengthwise (stretch) and blocks are large so the joins stay discreet.
    static KImg SlatFace(KImg prep, double wcm, double lcm, double ppc, int seed, double stretch)
    {
        int fw = Math.Max(6, (int)Math.Round(wcm * ppc)), fh = Math.Max(8, (int)Math.Round(lcm * ppc));
        int sh = Math.Max(8, (int)Math.Round(fw * (double)prep.H / prep.W * Math.Max(1, stretch)));
        KImg s = prep.Resize(fw, sh);
        int B = Math.Max(8, (int)(sh * 0.75));
        return Quilt(s, fw, fh, B, B, Math.Max(4, B / 3), true, false, seed, false);
    }
    static void MeanColor(KImg f, out double b, out double g, out double r)
    {
        b = 0; g = 0; r = 0; int n = 0; for (int i = 0; i < f.D.Length; i += 3 * 7) { b += f.D[i]; g += f.D[i + 1]; r += f.D[i + 2]; n++; }
        b /= n; g /= n; r /= n;
    }
    // Draws a straight textured rectangle with soft light, optional gloss and thin edge highlights.
    static void DrawSlatRect(KImg c, KImg face, double x0, double y0, double w, double h, bool gloss)
    {
        int W = c.W, H = c.H;
        for (int y = Math.Max(0, (int)Math.Floor(y0)); y < Math.Min(H, (int)Math.Ceiling(y0 + h)); y++) for (int x = Math.Max(0, (int)Math.Floor(x0)); x < Math.Min(W, (int)Math.Ceiling(x0 + w)); x++)
        {
            double ax = Math.Max(0, Math.Min(1, Math.Min(x + 1 - x0, x0 + w - x))), ay = Math.Max(0, Math.Min(1, Math.Min(y + 1 - y0, y0 + h - y))), a = ax * ay; if (a <= 0) continue;
            double u = (x + 0.5 - x0) / w, v = (y + 0.5 - y0) / h;
            double b, g, r; face.Sample(Math.Max(0, Math.Min(1, u)) * (face.W - 1), Math.Max(0, Math.Min(1, v)) * (face.H - 1), out b, out g, out r);
            double light = 1.04 - 0.04 * u - 0.06 * v;
            double spec = (gloss ? 0.14 : 0.03) * Math.Exp(-Math.Pow((v - 0.30) / 0.22, 2)) * 255;
            b = b * light + spec; g = g * light + spec; r = r * light + spec;
            double ex = (x + 0.5 - x0);
            if (ex < 1.2) { b += 16; g += 16; r += 16; } else if (x0 + w - (x + 0.5) < 1.2) { b *= 0.80; g *= 0.80; r *= 0.80; }
            Blend(c, x, y, a, b, g, r);
        }
    }
    static void Blend(KImg c, int x, int y, double a, double b, double g, double r)
    {
        if (x < 0 || y < 0 || x >= c.W || y >= c.H || a <= 0) return; if (a > 1) a = 1; int i = (y * c.W + x) * 3;
        c.D[i] = (byte)Math.Max(0, Math.Min(255, c.D[i] * (1 - a) + b * a)); c.D[i + 1] = (byte)Math.Max(0, Math.Min(255, c.D[i + 1] * (1 - a) + g * a)); c.D[i + 2] = (byte)Math.Max(0, Math.Min(255, c.D[i + 2] * (1 - a) + r * a));
    }
    // Top end of a standing slat, seen slightly from above (4x4 supersampled).
    // Fluted slats: hollow half-round tubes (one per flute) on a flat base plate, crowns towards the viewer;
    // flat slats: a plain edge of the board thickness.
    static void SlatTop(KImg c, double x0, double w, double yt, int flutes, double ppc, double mb, double mg, double mr)
    {
        bool fl = flutes >= 2 && flutes <= 10; double fwcm = w / ppc / Math.Max(1, flutes);
        double T = fl ? (fwcm / 2 + 0.5) * ppc : 1.2 * ppc, bse = fl ? 0.5 * ppc : T, k = 0.55;
        double rr = T - bse, ri = 0.78;
        double eb = Math.Min(255, mb * 1.06 + 10), eg = Math.Min(255, mg * 1.06 + 10), er = Math.Min(255, mr * 1.06 + 10);
        int ytop = (int)Math.Floor(yt - k * T) - 1, ybot = (int)Math.Ceiling(yt);
        for (int y = ytop; y <= ybot; y++) for (int x = (int)Math.Floor(x0); x <= (int)Math.Ceiling(x0 + w); x++)
        {
            double sb = 0, sg = 0, sr = 0, cov = 0;
            for (int sy = 0; sy < 4; sy++) for (int sx = 0; sx < 4; sx++)
            {
                double px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4; if (px < x0 || px > x0 + w || py > yt) continue;
                double z = T - (yt - py) / k; if (z < 0) continue;   // z: distance from the wall
                double cb, cg, cr;
                if (z <= bse) { cb = eb; cg = eg; cr = er; }
                else
                {
                    double uu = (px - x0) / w * flutes; int j = Math.Min(flutes - 1, (int)uu); double t = (uu - j) * 2 - 1;
                    double zo = bse + rr * Math.Sqrt(Math.Max(0, 1 - t * t)), zi = bse + rr * ri * Math.Sqrt(Math.Max(0, 1 - (t / ri) * (t / ri)));
                    if (z > zo) { cb = mb * 0.72; cg = mg * 0.72; cr = mr * 0.72; }            // side of the flute, seen in the groove
                    else if (Math.Abs(t) < ri && z < zi) { cb = mb * 0.36; cg = mg * 0.36; cr = mr * 0.36; }   // hollow
                    else { cb = eb * (0.94 + 0.06 * Math.Abs(t)); cg = eg * (0.94 + 0.06 * Math.Abs(t)); cr = er * (0.94 + 0.06 * Math.Abs(t)); }
                }
                sb += cb; sg += cg; sr += cr; cov++;
            }
            if (cov > 0) Blend(c, x, y, cov / 16.0, sb / cov, sg / cov, sr / cov);
        }
    }
    static KImg FlipV(KImg im) { KImg o = new KImg(im.W, im.H); for (int y = 0; y < im.H; y++) Buffer.BlockCopy(im.D, y * im.W * 3, o.D, (im.H - 1 - y) * im.W * 3, im.W * 3); return o; }
    // Adds `extra` rows below the photo, taken from another part of the same photo whose top matches the photo's
    // bottom edge best, joined along a minimum-error seam (the photo itself stays untouched).
    static KImg ExtendBelow(KImg im, int extra, int seed)
    {
        if (extra <= 0) return im;
        int W = im.W, H = im.H, ov = Math.Max(4, H / 4), bh = extra + ov; if (bh > H - 2) return im;
        Random rnd = new Random(seed); var cand = new List<KeyValuePair<double, int>>();
        for (int sy = 0; sy <= H - bh; sy += 2)
        {
            double e = 0; for (int y = 0; y < ov; y += 1) for (int x = 0; x < W; x += 2) { int a = ((H - ov + y) * W + x) * 3, b = ((sy + y) * W + x) * 3; for (int c = 0; c < 3; c++) { double d = im.D[a + c] - im.D[b + c]; e += d * d; } }
            if (sy + bh > H - ov) e *= 4;   // right next to the bottom edge: would look like a copy
            cand.Add(new KeyValuePair<double, int>(e, sy));
        }
        cand.Sort((u, v) => u.Key.CompareTo(v.Key)); int psy = cand[0].Value;
        double[] off = new double[3]; for (int y = 0; y < ov; y++) for (int x = 0; x < W; x += 2) { int a = ((H - ov + y) * W + x) * 3, b = ((psy + y) * W + x) * 3; for (int c = 0; c < 3; c++) off[c] += im.D[a + c] - im.D[b + c]; }
        for (int c = 0; c < 3; c++) off[c] = Math.Max(-14, Math.Min(14, off[c] / (ov * ((W + 1) / 2)) * 0.8));
        double[] E = new double[W * ov];
        for (int x = 0; x < W; x++) for (int y = 0; y < ov; y++)
        {
            int a = ((H - ov + y) * W + x) * 3, b = ((psy + y) * W + x) * 3; double e = 0; for (int c = 0; c < 3; c++) { double d = im.D[a + c] - (im.D[b + c] + off[c]); e += d * d; }
            if (x > 0) { double m = E[(x - 1) * ov + y]; if (y > 0) m = Math.Min(m, E[(x - 1) * ov + y - 1]); if (y < ov - 1) m = Math.Min(m, E[(x - 1) * ov + y + 1]); e += m; }
            E[x * ov + y] = e;
        }
        int[] seam = new int[W]; int bs = 0; for (int y = 1; y < ov; y++) if (E[(W - 1) * ov + y] < E[(W - 1) * ov + bs]) bs = y; seam[W - 1] = bs;
        for (int x = W - 2; x >= 0; x--) { int p0 = seam[x + 1], b = p0; for (int d = -1; d <= 1; d++) { int y = p0 + d; if (y >= 0 && y < ov && E[x * ov + y] < E[x * ov + b]) b = y; } seam[x] = b; }
        KImg o = new KImg(W, H + extra); Buffer.BlockCopy(im.D, 0, o.D, 0, im.D.Length);
        for (int y = 0; y < bh; y++) for (int x = 0; x < W; x++)
        {
            double a = y < ov ? Math.Max(0, Math.Min(1, (y - seam[x]) / 10.0 + 0.5)) : 1; if (a <= 0) continue;
            int di = ((H - ov + y) * W + x) * 3, si = ((psy + y) * W + x) * 3;
            for (int c = 0; c < 3; c++) o.D[di + c] = (byte)Math.Max(0, Math.Min(255, o.D[di + c] * (1 - a) + (im.D[si + c] + off[c]) * a));
        }
        return o;
    }
    // Loupe on the real photo: the prepared slat (straight) across the whole circle so every flute shows;
    // continued along its length (from the photo itself) when the photo is shorter than the circle.
    static void DrawSlatLoupe(KImg c, KImg prep, double lcx, double lcy, double lr, int seed)
    {
        int W = c.W, H = c.H;
        int dw = (int)Math.Round(2 * lr * 0.96), dh = Math.Max(8, (int)Math.Round(dw * (double)prep.H / prep.W));
        KImg s = prep.Resize(dw, dh); int need = (int)Math.Ceiling(2 * lr) + 6;
        if (s.H < need) { int ex = need - s.H, eb = ex / 2; s = ExtendBelow(s, eb, seed); s = FlipV(ExtendBelow(FlipV(s), ex - eb, seed + 1)); }
        double sx0 = lcx - s.W / 2.0, sy0 = lcy - s.H / 2.0;
        float[] lm = new float[W * H];
        for (int y = (int)(lcy - lr - 40); y < lcy + lr + 60; y++) for (int x = (int)(lcx - lr - 40); x < lcx + lr + 50; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue; if (Dist(x, y, lcx + 8, lcy + 18) < lr) lm[y * W + x] = 1; }
        BoxBlur(lm, W, H, 16); Shade(c, lm, 0.30, 50, 40, 30);
        for (int y = (int)(lcy - lr - 12); y < lcy + lr + 12; y++) for (int x = (int)(lcx - lr - 12); x < lcx + lr + 12; x++)
        {
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            double d = Dist(x + 0.5, y + 0.5, lcx, lcy);
            if (d <= lr)
            {
                double a = Math.Min(1, lr - d), fx = x + 0.5 - sx0, b, g, r;
                if (fx >= 0 && fx <= s.W) { s.Sample(fx - 0.5, y + 0.5 - sy0 - 0.5, out b, out g, out r); double ea = Math.Min(1, Math.Min(fx, s.W - fx)); if (ea < 1) { b = 236 * (1 - ea) + b * ea; g = 241 * (1 - ea) + g * ea; r = 246 * (1 - ea) + r * ea; } }
                else { double sh = Math.Max(0, 1 - Math.Abs(fx - (fx < 0 ? 0 : s.W)) / 8.0); b = 236 - 26 * sh; g = 241 - 26 * sh; r = 246 - 26 * sh; }
                Blend(c, x, y, a, b, g, r);
            }
            if (d > lr - 2 && d < lr + 9) { double a = Math.Min(1, Math.Min(d - (lr - 2), lr + 9 - d)); Blend(c, x, y, a, 252, 252, 252); }
        }
    }
    static string CmText(double cm) { return (Math.Abs(cm - Math.Round(cm)) < 0.05 ? Math.Round(cm).ToString("0") : cm.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture)) + " cm"; }
    // Two loose slats standing against the wall, all slats drawn at one common scale (290 cm = 1000 px),
    // so a 40 cm slat is visibly twice as wide as a 20 cm one. Dimensions are marked; the loupe shows the real photo.
    public static KImg RenderSlats(KImg tex, double wcm, double lcm, bool gloss, int seed, double stretch)
    {
        int W = 1000, H = 1250; KImg c = new KImg(W, H); Background(c);
        double ppcD = 1000.0 / 290; double Hs = Math.Min(1040, lcm * ppcD), ws = Math.Max(10, wcm * ppcD);
        double gap = Math.Max(30, ws * 0.55), total = 2 * ws + gap, xs = Math.Round(Math.Max(130, 390 - total / 2));
        double yBottom = 1095, yTop = yBottom - Hs;
        int flutes; KImg prep = PrepareSlat(tex, wcm, out flutes);
        double mb, mg, mr; MeanColor(prep, out mb, out mg, out mr);
        for (int k = 0; k < 2; k++)
        {
            KImg face = SlatFace(prep, wcm, lcm, ppcD, seed * 31 + k * 7919, stretch);
            double x0 = Math.Round(xs + k * (ws + gap)), yt = Math.Round(yTop + k * 5), yb = yt + Hs;
            float[] sm = new float[W * H];
            FillQuadMask(sm, W, H, new double[] { x0 + 22, yt + 16, x0 + ws + 30, yt + 16, x0 + ws + 10, yb + 2, x0 + 6, yb + 2 });
            BoxBlur(sm, W, H, 14); BoxBlur(sm, W, H, 14); Shade(c, sm, 0.30, 70, 56, 44);
            float[] cm = new float[W * H]; FillQuadMask(cm, W, H, new double[] { x0 - 6, yb - 4, x0 + ws + 10, yb - 4, x0 + ws + 12, yb + 9, x0 - 8, yb + 10 });
            BoxBlur(cm, W, H, 6); Shade(c, cm, 0.40, 50, 40, 32);
            DrawSlatRect(c, face, x0, yt, ws, Hs, gloss);
            SlatTop(c, x0, ws, yt, flutes, ppcD, mb, mg, mr);
        }
        DrawSlatLoupe(c, prep, 770, 860, 175, seed);
        // dimension marks
        using (Bitmap bmp = c.ToBitmap())
        {
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                Color ink = Color.FromArgb(205, 104, 92, 80);
                using (Pen pen = new Pen(ink, 1.6f)) using (Font f = new Font("Segoe UI", 19f, FontStyle.Regular, GraphicsUnit.Pixel)) using (SolidBrush br = new SolidBrush(ink))
                {
                    float x0 = (float)xs, x1 = (float)(xs + ws), yw = (float)(yTop - 40);
                    g.DrawLine(pen, x0, yw, x1, yw); g.DrawLine(pen, x0, yw - 6, x0, yw + 6); g.DrawLine(pen, x1, yw - 6, x1, yw + 6);
                    string wt = CmText(wcm); SizeF sz = g.MeasureString(wt, f); float tx = (x0 + x1) / 2 - sz.Width / 2; if (tx < 12) tx = 12;
                    g.DrawString(wt, f, br, tx, yw - sz.Height - 4);
                    float xl = (float)(xs - 30), y0 = (float)yTop, y1 = (float)yBottom;
                    g.DrawLine(pen, xl, y0, xl, y1); g.DrawLine(pen, xl - 6, y0, xl + 6, y0); g.DrawLine(pen, xl - 6, y1, xl + 6, y1);
                    string lt = (lcm / 100.0).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) + " m"; SizeF s2 = g.MeasureString(lt, f);
                    g.TranslateTransform(xl - 8, (y0 + y1) / 2 + s2.Width / 2); g.RotateTransform(-90); g.DrawString(lt, f, br, 0, -s2.Height + 2); g.ResetTransform();
                }
            }
            return KImg.FromBitmap(bmp);
        }
    }
    // One straight slat over its whole length (exact width) at ppc px/cm, for the 3D studio (face/<id>.jpg).
    public static KImg SlatFaceTexture(KImg tex, double wcm, double lcm, double ppc, int seed, double stretch)
    { int n; KImg prep = PrepareSlat(tex, wcm, out n); return SlatFace(prep, wcm, lcm, ppc, seed * 31, stretch); }
    // Debug: the prepared slat sample (straight, cropped to its flutes).
    public static KImg PreparedSlat(KImg tex, double wcm) { int n; return PrepareSlat(tex, wcm, out n); }
}
