using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
// Offline version of the page's wall shader: lays every piece of a product on the room photo (for stills and Reel frames).
public static class RoomShot
{
    const double CX = 1196, CY = 693, F = 1100, ZB = 4.003, XL = -2.14, XR = 2.125, CAMH = 1.063, TOPV = 2.70;
    static byte[] Read(string p, out int w, out int h, out int st)
    {
        using (Bitmap b0 = new Bitmap(p)) using (Bitmap b = b0.Clone(new Rectangle(0, 0, b0.Width, b0.Height), PixelFormat.Format24bppRgb))
        {
            w = b.Width; h = b.Height; BitmapData d = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            st = d.Stride; byte[] a = new byte[st * h]; Marshal.Copy(d.Scan0, a, 0, a.Length); b.UnlockBits(d); return a;
        }
    }
    static double Lin(double c) { c /= 255.0; return c <= 0.04045 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4); }
    static double Srgb(double c) { c = Math.Max(0, c); double v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.Pow(c, 1 / 2.4) - 0.055; return Math.Max(0, Math.Min(255, v * 255)); }
    static double Hash(double n) { double x = Math.Sin(n * 12.9898 + 4.1) * 43758.5453; return x - Math.Floor(x); }
    // count: pieces laid (back wall first, then right, then left); -1 = all. walls: 1 = back only, 3 = all three.
    public static void Render(string dir, string facePath, double wcm, double hcm, double count, int walls, string outPath, int outW)
    {
        int w, h, st, mw, mh, ms, cw, ch, cs, fw, fh, fs;
        byte[] photo = Read(System.IO.Path.Combine(dir, "room.jpg"), out w, out h, out st), mask = Read(System.IO.Path.Combine(dir, "room-mask.png"), out mw, out mh, out ms), clean = Read(System.IO.Path.Combine(dir, "room-clean.jpg"), out cw, out ch, out cs), face = Read(facePath, out fw, out fh, out fs);
        double[] reff = { Lin(161.7) / 0.8, Lin(170.4) / 0.8, Lin(180.3) / 0.8 };   // B, G, R
        double SW = wcm / 100.0, SL = hcm / 100.0; int R = (int)Math.Ceiling(TOPV / SL - 1e-6);
        int NB = (int)Math.Ceiling((XR - XL) / SW - 1e-6), NR = walls == 3 ? (int)Math.Ceiling((ZB - 2.432) / SW - 1e-6) : 0;
        if (count < 0) count = 1e9;
        byte[] o = (byte[])photo.Clone();
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int i = y * st + x * 3; double cb = mask[y * ms + x * 3] / 255.0, cg = mask[y * ms + x * 3 + 1] / 255.0, cr = mask[y * ms + x * 3 + 2] / 255.0;
                double cov = Math.Max(cr, Math.Max(cg, cb)); if (cov < 0.002) continue;
                int wall = (cr >= cg && cr >= cb) ? 1 : (cg >= cb ? 2 : 3);
                if (walls == 1 && wall != 1) continue;
                double dx = (x + 0.5 - CX) / F, dy = (CY - y - 0.5) / F, u, v;
                if (wall == 1) { u = dx * ZB - XL; v = dy * ZB + CAMH; }
                else if (wall == 2) { double t = XL / dx; u = ZB - t; v = dy * t + CAMH; }
                else { double t = XR / dx; u = ZB - t; v = dy * t + CAMH; }
                int k = (int)Math.Floor(u / SW), row = Math.Max(0, Math.Min(R - 1, (int)Math.Floor(v / SL)));
                double g = (wall == 1 ? k : (wall == 3 ? NB + k : NB + NR + k)) * R + row;
                if (g + 1 > count) continue;
                double s = u / SW - k, tt = (v - row * SL) / SL;
                if (Hash(g + 3.7) > 0.5) tt = 0.98 - tt;
                if (R == 1) tt += (Hash(g * 1.7 + 1.1) - 0.5) * 0.05;
                s = Math.Max(0.004, Math.Min(0.996, s)); tt = Math.Max(0.002, Math.Min(0.998, tt));
                double fx = s * (fw - 1), fy = (1 - tt) * (fh - 1); int x0 = (int)fx, y0 = (int)fy, x1 = Math.Min(fw - 1, x0 + 1), y1 = Math.Min(fh - 1, y0 + 1); double ax = fx - x0, ay = fy - y0;
                for (int c = 0; c < 3; c++)
                {
                    double f00 = face[y0 * fs + x0 * 3 + c], f10 = face[y0 * fs + x1 * 3 + c], f01 = face[y1 * fs + x0 * 3 + c], f11 = face[y1 * fs + x1 * 3 + c];
                    double fv = (f00 * (1 - ax) + f10 * ax) * (1 - ay) + (f01 * (1 - ax) + f11 * ax) * ay;
                    double lit = Lin(fv) * Lin(clean[y * cs + x * 3 + c]) / reff[c];
                    double pv = Lin(photo[i + c]);
                    o[i + c] = (byte)Srgb(pv + (lit - pv) * cov);
                }
            }
        using (Bitmap b = new Bitmap(w, h, PixelFormat.Format24bppRgb))
        {
            BitmapData d = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb); Marshal.Copy(o, 0, d.Scan0, o.Length); b.UnlockBits(d);
            int oh = (int)Math.Round((double)h * outW / w);
            using (Bitmap r = new Bitmap(outW, oh)) using (Graphics gr = Graphics.FromImage(r))
            {
                gr.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic; gr.DrawImage(b, 0, 0, outW, oh);
                ImageCodecInfo jpg = null; foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") jpg = c;
                EncoderParameters ep = new EncoderParameters(1); ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 84L);
                r.Save(outPath, jpg, ep);
            }
        }
    }
}
