using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

// Prepares a room photo for wall compositing: wall coverage mask (R back, G left, B right, objects in front cut out)
// and a "clean wall" image (the wall's light with the objects removed) used as the shading of the slats.
public static class RoomPrep
{
    // camera model (pixels of the original photo, metres)
    public static double CX = 1196, CY = 693, F = 1100, ZB = 4.003, XL = -2.140, XR = 2.125, CAMH = 1.063, TOPY = 1.637, ZR_END = 2.432, LEFT_CUT_X = 318;

    static byte[] Read(Bitmap b, out int w, out int h, out int stride)
    {
        w = b.Width; h = b.Height;
        BitmapData d = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        stride = d.Stride; byte[] a = new byte[stride * h]; Marshal.Copy(d.Scan0, a, 0, a.Length); b.UnlockBits(d); return a;
    }
    static void Write(byte[] a, int w, int h, int stride, string path, bool png)
    {
        using (Bitmap b = new Bitmap(w, h, PixelFormat.Format24bppRgb))
        {
            BitmapData d = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
            Marshal.Copy(a, 0, d.Scan0, a.Length); b.UnlockBits(d);
            if (png) b.Save(path, ImageFormat.Png);
            else
            {
                ImageCodecInfo jpg = null; foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") jpg = c;
                EncoderParameters ep = new EncoderParameters(1); ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 90L);
                b.Save(path, jpg, ep);
            }
        }
    }
    // which wall a ray hits: 1 back, 2 left, 3 right, 0 none (floor, ceiling, opening)
    public static int WallAt(double x, double y)
    {
        double dx = (x - CX) / F, dy = (CY - y) / F;
        double X = dx * ZB, Y = dy * ZB;
        if (X >= XL && X <= XR) return (Y >= -CAMH && Y <= TOPY) ? 1 : 0;
        if (dx < 0) { double t = XL / dx; double Yl = dy * t; return (t <= ZB && Yl >= -CAMH && Yl <= TOPY) ? 2 : 0; }
        if (dx > 0) { double t = XR / dx; double Yr = dy * t; return (t <= ZB && t >= ZR_END && Yr >= -CAMH && Yr <= TOPY) ? 3 : 0; }
        return 0;
    }
    static bool InPoly(double x, double y, double[] p)
    {
        bool c = false; int n = p.Length / 2;
        for (int i = 0, j = n - 1; i < n; j = i++)
        {
            double xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
            if (((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
        }
        return c;
    }
    static double DistSeg(double x, double y, double ax, double ay, double bx, double by)
    {
        double vx = bx - ax, vy = by - ay, t = ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy); t = Math.Max(0, Math.Min(1, t));
        double qx = ax + t * vx - x, qy = ay + t * vy - y; return Math.Sqrt(qx * qx + qy * qy);
    }
    // objects in front of the walls (grow = extra margin in px)
    public static List<double[]> Polys = new List<double[]>();
    public static List<double[]> Circles = new List<double[]>();   // x, y, r
    public static List<double[]> Segs = new List<double[]>();      // ax, ay, bx, by, halfwidth
    public static List<double[]> Rects = new List<double[]>();     // x0, y0, x1, y1
    public static bool Occluded(double x, double y, int wall, double grow)
    {
        if (wall == 2 && x >= LEFT_CUT_X - grow) return true;   // curtains and window on the left wall
        foreach (double[] r in Rects) if (x >= r[0] - grow && x <= r[2] + grow && y >= r[1] - grow && y <= r[3] + grow) return true;
        foreach (double[] c in Circles) { double ddx = x - c[0], ddy = y - c[1]; if (ddx * ddx + ddy * ddy <= (c[2] + grow) * (c[2] + grow)) return true; }
        foreach (double[] s in Segs) if (DistSeg(x, y, s[0], s[1], s[2], s[3]) <= s[4] + grow) return true;
        foreach (double[] p in Polys)
        {
            if (InPoly(x, y, p)) return true;
            if (grow > 0) { int n = p.Length / 2; for (int i = 0, j = n - 1; i < n; j = i++) if (DistSeg(x, y, p[2 * j], p[2 * j + 1], p[2 * i], p[2 * i + 1]) <= grow) return true; }
        }
        return false;
    }
    static void BoxBlur(float[] a, int w, int h, int r)
    {
        float[] t = new float[a.Length];
        for (int y = 0; y < h; y++)
        {
            double s = 0; int o = y * w;
            for (int x = -r; x <= r; x++) s += a[o + Math.Max(0, Math.Min(w - 1, x))];
            for (int x = 0; x < w; x++) { t[o + x] = (float)(s / (2 * r + 1)); s += a[o + Math.Min(w - 1, x + r + 1)] - a[o + Math.Max(0, x - r)]; }
        }
        for (int x = 0; x < w; x++)
        {
            double s = 0;
            for (int y = -r; y <= r; y++) s += t[Math.Max(0, Math.Min(h - 1, y)) * w + x];
            for (int y = 0; y < h; y++) { a[y * w + x] = (float)(s / (2 * r + 1)); s += t[Math.Min(h - 1, y + r + 1) * w + x] - t[Math.Max(0, y - r) * w + x]; }
        }
    }
    static void Gauss(float[] a, int w, int h, int r) { int b = Math.Max(1, r / 2); BoxBlur(a, w, h, b); BoxBlur(a, w, h, b); BoxBlur(a, w, h, b); }

    public static string Run(string photo, string maskOut, string cleanOut)
    {
        int w, h, st; byte[] px; using (Bitmap b = new Bitmap(photo)) px = Read(b, out w, out h, out st);
        byte[] mask = new byte[st * h];
        int[] wallOf = new int[w * h]; bool[] valid = new bool[w * h];
        const int SS = 4;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int[] cov = new int[4];
                for (int sy = 0; sy < SS; sy++) for (int sx = 0; sx < SS; sx++)
                {
                    double xx = x + (sx + 0.5) / SS, yy = y + (sy + 0.5) / SS; int wl = WallAt(xx, yy);
                    if (wl > 0 && !Occluded(xx, yy, wl, 0)) cov[wl]++;
                }
                int wc = WallAt(x + 0.5, y + 0.5); wallOf[y * w + x] = wc;
                valid[y * w + x] = wc > 0 && !Occluded(x + 0.5, y + 0.5, wc, 4);
                int i = y * st + x * 3;   // BGR: B = right, G = left, R = back
                mask[i + 2] = (byte)(cov[1] * 255 / (SS * SS)); mask[i + 1] = (byte)(cov[2] * 255 / (SS * SS)); mask[i] = (byte)(cov[3] * 255 / (SS * SS));
            }
        Write(mask, w, h, st, maskOut, true);

        // clean wall: normalised convolution per wall, growing radius to fill what the objects hide
        byte[] clean = (byte[])px.Clone();
        int[] radii = { 6, 18, 48, 120, 300, 900 };
        List<double> lum = new List<double>(); double[] sumC = new double[3]; int nC = 0;
        for (int wl = 1; wl <= 3; wl++)
        {
            float[][] est = new float[3][]; float[] conf = new float[w * h]; for (int c = 0; c < 3; c++) est[c] = new float[w * h];
            bool[] done = new bool[w * h];
            foreach (int r in radii)
            {
                float[] m = new float[w * h]; float[][] cm = new float[3][]; for (int c = 0; c < 3; c++) cm[c] = new float[w * h];
                for (int i = 0; i < w * h; i++) if (valid[i] && wallOf[i] == wl) { m[i] = 1; int p = (i / w) * st + (i % w) * 3; for (int c = 0; c < 3; c++) cm[c][i] = px[p + c]; }
                Gauss(m, w, h, r); for (int c = 0; c < 3; c++) Gauss(cm[c], w, h, r);
                for (int i = 0; i < w * h; i++)
                {
                    if (wallOf[i] != wl || done[i]) continue;
                    if (m[i] > (r >= 900 ? 1e-6f : 0.35f)) { for (int c = 0; c < 3; c++) est[c][i] = cm[c][i] / m[i]; done[i] = true; }
                }
            }
            for (int i = 0; i < w * h; i++)
            {
                if (wallOf[i] != wl) continue; int p = (i / w) * st + (i % w) * 3;
                for (int c = 0; c < 3; c++) clean[p + c] = (byte)Math.Max(0, Math.Min(255, est[c][i]));
                if (wl == 1 && valid[i]) { lum.Add(0.114 * px[p] + 0.587 * px[p + 1] + 0.299 * px[p + 2]); for (int c = 0; c < 3; c++) sumC[c] += px[p + c]; nC++; }
            }
        }
        Write(clean, w, h, st, cleanOut, false);
        lum.Sort();
        return string.Format(System.Globalization.CultureInfo.InvariantCulture, "{{\"w\":{0},\"h\":{1},\"medianLum\":{2:0.0},\"p90Lum\":{3:0.0},\"meanRGB\":[{4:0.0},{5:0.0},{6:0.0}]}}",
            w, h, lum[lum.Count / 2], lum[(int)(lum.Count * 0.9)], sumC[2] / nC, sumC[1] / nC, sumC[0] / nC);
    }
}
