// Wall studio, "my photo": wall detection from one photo, fully in the browser (loaded only when a visitor imports a photo).
// 1. SegFormer (ADE20K) says which pixels are wall / floor / ceiling (furniture, windows, doors are excluded).
// 2. Depth Anything gives relative inverse depth; a flat surface is a plane in (x, y, inverse depth), whatever the
//    unknown scale and shift, so walls are split by fitting planes (RANSAC) to the wall pixels.
// 3. Plane intersections give the room corners (wall/wall), the floor line (wall/floor) and the ceiling line;
//    each wall becomes a quad (homography) + a soft mask refined on the photo edges + a smooth light map.
const TF = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const SEG = 'Xenova/segformer-b0-finetuned-ade-512-512', DEPTH = 'onnx-community/depth-anything-v2-small';
const C_WALL = 0, C_FLOOR = 3, C_CEIL = 5, C_RUG = 28;
let lib = null, seg = null, depth = null;

export async function loadModels(onProgress = () => {}, opt = {}) {
  if (!lib) lib = await import(TF);
  const { AutoProcessor, AutoModel, pipeline, env } = lib;
  env.allowLocalModels = false;
  const files = {};
  const cb = (p) => {
    if (p.status === 'progress' && p.total) { files[p.file] = [p.loaded, p.total]; let a = 0, b = 0; for (const k in files) { a += files[k][0]; b += files[k][1]; } onProgress('download', a / b); }
  };
  const device = opt.device || 'wasm', gpu = device === 'webgpu';
  if (!seg) seg = { proc: await AutoProcessor.from_pretrained(opt.seg || SEG), model: await AutoModel.from_pretrained(opt.seg || SEG, { dtype: gpu ? (opt.segGpu || 'fp16') : 'q8', device, progress_callback: cb }) };
  if (!depth) depth = await pipeline('depth-estimation', DEPTH, { dtype: gpu ? (opt.depthGpu || 'q4f16') : 'q8', device, progress_callback: cb });
  if (opt.depthSize) depth.processor.image_processor.size = { width: opt.depthSize, height: opt.depthSize };
}

// ---------------------------------------------------------------- small helpers
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function boxBlur(src, w, h, r, out) {   // separable box blur, clamped edges
  const tmp = new Float32Array(w * h); out = out || new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0; const o = y * w;
    for (let x = -r; x <= r; x++) acc += src[o + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) { tmp[o + x] = acc / (2 * r + 1); acc += src[o + clamp(x + r + 1, 0, w - 1)] - src[o + clamp(x - r, 0, w - 1)]; }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = acc / (2 * r + 1); acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x]; }
  }
  return out;
}
function guided(I, p, w, h, r, eps) {   // guided filter (He et al.): p smoothed but following the edges of I
  const mI = boxBlur(I, w, h, r), mp = boxBlur(p, w, h, r), Ip = new Float32Array(w * h), II = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mIp = boxBlur(Ip, w, h, r), mII = boxBlur(II, w, h, r), a = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const v = mII[i] - mI[i] * mI[i]; a[i] = (mIp[i] - mI[i] * mp[i]) / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
  const ma = boxBlur(a, w, h, r), mb = boxBlur(b, w, h, r), q = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}
function fitPlane(pts, idx) {   // least squares d = a x + b y + c over pts[idx]
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0, sxd = 0, syd = 0, sd = 0;
  for (const i of idx) { const x = pts.x[i], y = pts.y[i], d = pts.d[i]; sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y; n++; sxd += x * d; syd += y * d; sd += d; }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], v = [sxd, syd, sd];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M); if (Math.abs(D) < 1e-12) return null;
  const col = (k) => M.map((r, i) => r.map((x, j) => (j === k ? v[i] : x)));
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
}
function ransacPlanes(pts, cand, tau, maxPlanes, minFrac, rnd) {
  let rest = cand.slice(); const planes = [], total = cand.length;
  for (let p = 0; p < maxPlanes && rest.length > total * minFrac; p++) {
    let best = null, bestN = 0;
    for (let it = 0; it < 500; it++) {
      const i0 = rest[(rnd() * rest.length) | 0], i1 = rest[(rnd() * rest.length) | 0], i2 = rest[(rnd() * rest.length) | 0];
      const pl = fitPlane(pts, [i0, i1, i2]); if (!pl) continue;
      let n = 0;
      for (let k = 0; k < rest.length; k += 3) { const i = rest[k]; if (Math.abs(pl[0] * pts.x[i] + pl[1] * pts.y[i] + pl[2] - pts.d[i]) < tau) n++; }
      if (n > bestN) { bestN = n; best = pl; }
    }
    if (!best) break;
    let inl = rest.filter((i) => Math.abs(best[0] * pts.x[i] + best[1] * pts.y[i] + best[2] - pts.d[i]) < tau);
    for (let k = 0; k < 2; k++) { const r = fitPlane(pts, inl); if (!r) break; best = r; inl = rest.filter((i) => Math.abs(best[0] * pts.x[i] + best[1] * pts.y[i] + best[2] - pts.d[i]) < tau); }
    if (inl.length < total * minFrac) break;
    planes.push(best);
    const s = new Set(inl); rest = rest.filter((i) => !s.has(i));
  }
  return planes;
}
const lineOf = (P, Q) => [P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]];   // A x + B y + C = 0 where planes are equal (x = X/W, y = Y/W)
function meet(L1, L2) { const d = L1[0] * L2[1] - L1[1] * L2[0]; if (Math.abs(d) < 1e-12) return null; return [(L1[1] * L2[2] - L1[2] * L2[1]) / d, (L1[2] * L2[0] - L1[0] * L2[2]) / d]; }
const yAt = (L, x) => -(L[0] * x + L[2]) / L[1];
function lineThrough(p, q) { return [p[1] - q[1], q[0] - p[0], p[0] * q[1] - q[0] * p[1]]; }
function fitLine(xs, ys) {   // y = m x + k, robust (2 passes trimming the worst third)
  let idx = xs.map((_, i) => i), m = 0, k = 0;
  for (let pass = 0; pass < 3; pass++) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = idx.length; if (n < 4) return null;
    for (const i of idx) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    const den = n * sxx - sx * sx; if (Math.abs(den) < 1e-12) return null;
    m = (n * sxy - sx * sy) / den; k = (sy - m * sx) / n;
    const res = idx.map((i) => [Math.abs(ys[i] - (m * xs[i] + k)), i]).sort((a, b) => a[0] - b[0]);
    idx = res.slice(0, Math.max(4, Math.ceil(res.length * 0.7))).map((r) => r[1]);
  }
  return [m, -1, k];   // as A x + B y + C = 0
}

// ---------------------------------------------------------------- main
export async function analyze(source, onProgress = () => {}, opt = {}) {
  const { RawImage } = lib;
  const W0 = source.naturalWidth || source.width, H0 = source.naturalHeight || source.height;
  const big = document.createElement('canvas'), sc = Math.min(1, 1024 / Math.max(W0, H0));
  big.width = Math.round(W0 * sc); big.height = Math.round(H0 * sc);
  big.getContext('2d').drawImage(source, 0, 0, big.width, big.height);
  const raw = RawImage.fromCanvas(big);
  const T = opt.times || {}; let tt = performance.now();
  onProgress('seg', 0);
  const inp = await seg.proc(raw), out = await seg.model(inp), lg = out.logits, [, NC, LH, LW] = lg.dims, L = lg.data;
  T.seg = performance.now() - tt; tt = performance.now();
  onProgress('depth', 0);
  const ds = opt.depthIn || 518, dsc = Math.min(1, ds / Math.max(big.width, big.height)), dcv = document.createElement('canvas');
  dcv.width = Math.round(big.width * dsc); dcv.height = Math.round(big.height * dsc); dcv.getContext('2d').drawImage(big, 0, 0, dcv.width, dcv.height);
  const dep = await depth(RawImage.fromCanvas(dcv)), pd = dep.predicted_depth, [DH, DW] = pd.dims.slice(-2), D = pd.data;
  T.depth = performance.now() - tt; T.dsize = DW + 'x' + DH; tt = performance.now();
  onProgress('walls', 0);
  // analysis grid
  const AW = 256, AH = Math.round(256 * big.height / big.width), N = AW * AH;
  const cls = new Uint8Array(N), pwall = new Float32Array(N), disp = new Float32Array(N);
  const tmp = new Float32Array(NC);
  for (let gy = 0; gy < AH; gy++) for (let gx = 0; gx < AW; gx++) {
    const fx = (gx + 0.5) / AW * LW - 0.5, fy = (gy + 0.5) / AH * LH - 0.5, x0 = clamp(Math.floor(fx), 0, LW - 1), y0 = clamp(Math.floor(fy), 0, LH - 1);
    const x1 = Math.min(LW - 1, x0 + 1), y1 = Math.min(LH - 1, y0 + 1), tx = clamp(fx - x0, 0, 1), ty = clamp(fy - y0, 0, 1);
    let mx = -1e9, mi = 0;
    for (let c = 0; c < NC; c++) {
      const o = c * LH * LW, v = (L[o + y0 * LW + x0] * (1 - tx) + L[o + y0 * LW + x1] * tx) * (1 - ty) + (L[o + y1 * LW + x0] * (1 - tx) + L[o + y1 * LW + x1] * tx) * ty;
      tmp[c] = v; if (v > mx) { mx = v; mi = c; }
    }
    let s = 0; for (let c = 0; c < NC; c++) s += Math.exp(tmp[c] - mx);
    const i = gy * AW + gx; cls[i] = mi; pwall[i] = Math.exp(tmp[C_WALL] - mx) / s;
    const dx = (gx + 0.5) / AW * DW - 0.5, dy = (gy + 0.5) / AH * DH - 0.5, u0 = clamp(Math.floor(dx), 0, DW - 1), v0 = clamp(Math.floor(dy), 0, DH - 1);
    const u1 = Math.min(DW - 1, u0 + 1), v1 = Math.min(DH - 1, v0 + 1), su = clamp(dx - u0, 0, 1), sv = clamp(dy - v0, 0, 1);
    disp[i] = (D[v0 * DW + u0] * (1 - su) + D[v0 * DW + u1] * su) * (1 - sv) + (D[v1 * DW + u0] * (1 - su) + D[v1 * DW + u1] * su) * sv;
  }
  let dmin = Infinity, dmax = -Infinity; for (let i = 0; i < N; i++) { dmin = Math.min(dmin, disp[i]); dmax = Math.max(dmax, disp[i]); }
  for (let i = 0; i < N; i++) disp[i] = (disp[i] - dmin) / (dmax - dmin || 1);
  const pts = { x: new Float32Array(N), y: new Float32Array(N), d: disp };
  for (let i = 0; i < N; i++) { pts.x[i] = (i % AW + 0.5) / AW; pts.y[i] = (Math.floor(i / AW) + 0.5) / AW; }
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tau = opt.tau || 0.012;
  // wall planes: walls follow each other from left to right and meet on near-vertical corners, so the wall pixels are cut
  // into column bands by dynamic programming (one plane per band); the band count is the smallest that explains the depth.
  const isWall = (i) => cls[i] === C_WALL && pwall[i] > 0.35;
  const use = new Uint8Array(N); for (let i = 0; i < N; i++) use[i] = isWall(i) && pwall[i] > 0.5 ? 1 : 0;
  const MINW = Math.max(6, Math.round(AW * 0.05)), hMid = (AH / 2) / AW;
  const solve3 = (a, b, c, d, e, f, g, h, k, v0, v1, v2) => {   // [[a b c][d e f][g h k]] p = v
    const D0 = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g); if (Math.abs(D0) < 1e-14) return null;
    return [(v0 * (e * k - f * h) - b * (v1 * k - f * v2) + c * (v1 * h - e * v2)) / D0, (a * (v1 * k - f * v2) - v0 * (d * k - f * g) + c * (d * v2 - v1 * g)) / D0, (a * (e * v2 - v1 * h) - b * (d * v2 - v1 * g) + v0 * (d * h - e * g)) / D0];
  };
  function bandsFit(maxK) {
    const KM = 10, col = new Float64Array((AW + 1) * KM);
    for (let x = 0; x < AW; x++) {
      const o = (x + 1) * KM, pr = x * KM; for (let k = 0; k < KM; k++) col[o + k] = col[pr + k];
      for (let y = 0; y < AH; y++) { const i = y * AW + x; if (!use[i]) continue; const X = pts.x[i], Y = pts.y[i], Dd = disp[i]; col[o] += 1; col[o + 1] += X; col[o + 2] += Y; col[o + 3] += Dd; col[o + 4] += X * X; col[o + 5] += X * Y; col[o + 6] += Y * Y; col[o + 7] += X * Dd; col[o + 8] += Y * Dd; col[o + 9] += Dd * Dd; }
    }
    const fit = (a, b) => {
      const A = a * KM, B = b * KM, m = (k) => col[B + k] - col[A + k], n = m(0);
      if (n < 30) return { p: null, sse: 0, n };
      const v0 = m(7), v1 = m(8), v2 = m(3);
      const p = solve3(m(4), m(5), m(1), m(5), m(6), m(2), m(1), m(2), n, v0, v1, v2);
      if (!p) { const c = v2 / n; return { p: [0, 0, c], sse: Math.max(0, m(9) - c * v2), n }; }
      return { p, sse: Math.max(0, m(9) - (p[0] * v0 + p[1] * v1 + p[2] * v2)), n };
    };
    const best = [null], arg = [null];
    for (let k = 1; k <= maxK; k++) {
      best[k] = new Float64Array(AW + 1).fill(Infinity); arg[k] = new Int32Array(AW + 1);
      for (let j = k * MINW; j <= AW; j++) {
        if (k === 1) { best[1][j] = fit(0, j).sse; continue; }
        for (let i = (k - 1) * MINW; i <= j - MINW; i++) { const v = best[k - 1][i] + fit(i, j).sse; if (v < best[k][j]) { best[k][j] = v; arg[k][j] = i; } }
      }
    }
    let K = 1;
    for (let k = 2; k <= maxK; k++) { if (best[k][AW] < best[k - 1][AW] * (opt.split || 0.42)) K = k; else break; }
    const cuts = [AW]; for (let k = K, j = AW; k > 1; k--) { j = arg[k][j]; cuts.unshift(j); } cuts.unshift(0);
    const planes = []; for (let k = 0; k < K; k++) planes.push(fit(cuts[k], cuts[k + 1]).p || [0, 0, 0.5]);
    return { K, cuts, planes, fit, sse: best.slice(1).map((b) => b[AW]) };
  }
  let B = bandsFit(4);
  {   // second round without the depth outliers (windows, reflections confuse the depth model)
    const res = [];
    for (let i = 0; i < N; i++) if (use[i]) { const x = i % AW; let k = 0; while (k < B.K - 1 && x >= B.cuts[k + 1]) k++; const p = B.planes[k]; res.push(Math.abs(p[0] * pts.x[i] + p[1] * pts.y[i] + p[2] - disp[i])); }
    const sorted = res.slice().sort((a, b) => a - b), mad = sorted[(sorted.length / 2) | 0] || 0, lim = Math.max(0.006, mad * 3.5);
    let r = 0; for (let i = 0; i < N; i++) if (use[i]) { if (res[r] > lim) use[i] = 0; r++; }
    B = bandsFit(4);
  }
  let planes = B.planes;
  // corners: where neighbouring planes meet (exact under the depth model's affine ambiguity). A real room corner is close
  // to vertical; a slanted meeting line means the split is a depth artefact, so weak splits are merged back.
  const VT = 0.25;   // max |B/A| of a corner line (about 14 degrees from vertical)
  for (let again = true; again && B.K > 1;) {
    again = false;
    for (let k = 0; k < B.K - 1; k++) {
      const L = lineOf(planes[k], planes[k + 1]), cut = B.cuts[k + 1] / AW;
      const xm = Math.abs(L[0]) > 1e-9 ? -(L[1] * hMid + L[2]) / L[0] : Infinity;
      const ok = Math.abs(L[1]) < Math.abs(L[0]) * VT && Math.abs(xm - cut) < 0.1;
      if (ok) continue;
      const a = B.fit(B.cuts[k], B.cuts[k + 1]), b = B.fit(B.cuts[k + 1], B.cuts[k + 2]), m = B.fit(B.cuts[k], B.cuts[k + 2]);
      if (m.sse < (a.sse + b.sse) * 3) { B.cuts.splice(k + 1, 1); B.K--; planes.splice(k, 2, m.p || planes[k]); again = true; break; }
    }
  }
  const corners = [];
  for (let k = 0; k < B.K - 1; k++) {
    const L = lineOf(planes[k], planes[k + 1]), cut = B.cuts[k + 1] / AW;
    const xm = Math.abs(L[0]) > 1e-9 ? -(L[1] * hMid + L[2]) / L[0] : Infinity;
    const Lc = Math.abs(xm - cut) < 0.1 && Math.abs(L[1]) < Math.abs(L[0]) * VT ? L : [1, 0, -cut];
    const s = Math.sign(Lc[0] * (cut - 0.04) + Lc[1] * hMid + Lc[2]) || -1;   // sign on the left side
    corners.push({ L: Lc, s });
  }
  const lab = new Int8Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (!isWall(i)) continue;
    const x = pts.x[i], y = pts.y[i]; let k = 0;
    while (k < corners.length && Math.sign(corners[k].L[0] * x + corners[k].L[1] * y + corners[k].L[2]) !== corners[k].s) k++;
    lab[i] = k;
  }
  // final walls, ordered left to right
  let walls = [];
  for (let p = 0; p < planes.length; p++) {
    let n = 0, sx = 0, sy = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < N; i++) if (lab[i] === p) { const x = i % AW, y = (i / AW) | 0; n++; sx += x; sy += y; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    walls.push({ p, plane: planes[p], n, cx: n ? sx / n / AW : 0, cy: n ? sy / n / AW : 0, minX: minX / AW, maxX: (maxX + 1) / AW, minY: minY / AW, maxY: (maxY + 1) / AW, left: p > 0 ? corners[p - 1].L : null, right: p < corners.length ? corners[p].L : null });
  }
  walls = walls.filter((w) => w.n > N * 0.02);
  // floor and ceiling planes
  const fIdx = [], cIdx = [];
  for (let i = 0; i < N; i++) { if (cls[i] === C_FLOOR || cls[i] === C_RUG) fIdx.push(i); else if (cls[i] === C_CEIL) cIdx.push(i); }
  const floorP = fIdx.length > N * 0.03 ? ransacPlanes(pts, fIdx, tau * 1.5, 1, 0.3, rnd)[0] : null;
  const ceilP = cIdx.length > N * 0.02 ? ransacPlanes(pts, cIdx, tau * 1.5, 1, 0.3, rnd)[0] : null;
  // boundary samples of each wall touching floor / ceiling (fallback when a plane is missing)
  const hImg = AH / AW;
  for (const w of walls) {
    const fx = [], fy = [], cx = [], cy = [], colX = [], colT = [], colB = [];
    for (let x = 0; x < AW; x++) {
      let top = -1, bot = -1;
      for (let y = 0; y < AH; y++) if (lab[y * AW + x] === w.p) { if (top < 0) top = y; bot = y; }
      if (bot >= 0) { colX.push((x + 0.5) / AW); colT.push(top / AW); colB.push((bot + 1) / AW); }
      if (bot >= 0) {
        for (let k = 1; k <= 3 && bot + k < AH; k++) { const c = cls[(bot + k) * AW + x]; if (c === C_FLOOR || c === C_RUG) { fx.push((x + 0.5) / AW); fy.push((bot + 1) / AW); break; } }
        for (let k = 1; k <= 3 && top - k >= 0; k++) { if (cls[(top - k) * AW + x] === C_CEIL) { cx.push((x + 0.5) / AW); cy.push(top / AW); break; } }
      }
    }
    w.floor = floorP ? lineOf(w.plane, floorP) : null;
    w.ceil = ceilP ? lineOf(w.plane, ceilP) : null;
    // sanity: the plane line must pass near the observed boundary, else use the boundary itself
    const near = (Lr, xs, ys) => { if (!Lr || Math.abs(Lr[1]) < 1e-9 || xs.length < 6) return !!Lr && xs.length < 6; let e = 0; for (let i = 0; i < xs.length; i++) e += Math.abs(yAt(Lr, xs[i]) - ys[i]); return e / xs.length < 0.03; };
    const below = (Lr) => { if (!Lr || Math.abs(Lr[1]) < 1e-9) return false; let bad = 0; for (let i = 0; i < colX.length; i++) if (yAt(Lr, colX[i]) < colB[i] - 0.012) bad++; return bad <= colX.length * 0.1; };
    const above = (Lr) => { if (!Lr || Math.abs(Lr[1]) < 1e-9) return false; let bad = 0; for (let i = 0; i < colX.length; i++) if (yAt(Lr, colX[i]) > colT[i] + 0.012) bad++; return bad <= colX.length * 0.1; };
    if (w.floor && !below(w.floor)) w.floor = null;
    if (w.ceil && !above(w.ceil)) w.ceil = null;
    if (!near(w.floor, fx, fy)) w.floor = fx.length >= 8 ? fitLine(fx, fy) : null;
    if (!near(w.ceil, cx, cy)) w.ceil = cx.length >= 8 ? fitLine(cx, cy) : null;
    w.fN = fx.length; w.cN = cx.length; w.colX = colX; w.colT = colT; w.colB = colB;
  }
  // corners between neighbours
  // (corners already set from the bands)
  // horizon and camera-height ratio from walls that show both floor and ceiling
  const vps = [];
  for (const w of walls) if (w.floor && w.ceil) { const v = meet(w.floor, w.ceil); if (v && Math.abs(v[0] - 0.5) < 6) vps.push(v); }
  const yh = vps.length ? vps.reduce((s, v) => s + v[1], 0) / vps.length : hImg / 2;
  let rho = 0.54;
  { const rs = []; for (const w of walls) if (w.floor && w.ceil) { const x = w.cx, yf = yAt(w.floor, x), yc = yAt(w.ceil, x); if (yf > yc) rs.push(clamp((yf - yh) / (yf - yc), 0.3, 0.8)); } if (rs.length) rho = rs.reduce((a, b) => a + b, 0) / rs.length; }
  // focal length from two orthogonal walls (their horizontal vanishing points), else a phone-like guess
  let f = 0.72 * Math.max(1, hImg);
  const hv = walls.filter((w) => w.floor).map((w) => { const hor = [0, 1, -yh]; return meet(w.floor, hor); });
  for (let k = 0; k < hv.length - 1; k++) { const a = hv[k], b = hv[k + 1]; if (!a || !b) continue; const v = -((a[0] - 0.5) * (b[0] - 0.5) + (a[1] - hImg / 2) * (b[1] - hImg / 2)); if (v > 0) { const ff = Math.sqrt(v); if (ff > 0.35 && ff < 1.6) { f = ff; break; } } }
  // build the quads (in x = X/W, y = Y/W units, then photo px)
  const vert = (x) => [1, 0, -x];
  const out2 = [];
  for (const w of walls) {
    let floor = w.floor, ceil = w.ceil;
    if (!floor && !ceil) { floor = [0, 1, -(w.maxY)]; }
    if (!floor) { // from the ceiling line and the horizon
      floor = lineThrough([0, yh + (yh - yAt(ceil, 0)) * rho / (1 - rho)], [1, yh + (yh - yAt(ceil, 1)) * rho / (1 - rho)]);
    }
    if (!ceil) ceil = lineThrough([0, yh - (yAt(floor, 0) - yh) * (1 - rho) / rho], [1, yh - (yAt(floor, 1) - yh) * (1 - rho) / rho]);
    // a guessed line may not cut through the visible wall: the ceiling stays above it, the floor below it
    const push = (Lr, up) => { if (Math.abs(Lr[1]) < 1e-9 || !w.colX) return Lr; let m = 0; for (let i = 0; i < w.colX.length; i++) { const y = yAt(Lr, w.colX[i]); m = Math.max(m, up ? y - w.colT[i] : w.colB[i] - y); } return m > 0 ? [Lr[0], Lr[1], Lr[2] + (up ? 1 : -1) * (m + 0.01) * Lr[1]] : Lr; };
    if (!w.ceil) ceil = push(ceil, true);
    if (!w.floor) floor = push(floor, false);
    // side edges: the corner with the neighbour, else a line parallel to the nearest corner through the wall's extent
    const ref = w.left || w.right;
    const side = (x, yRef) => { if (!ref || Math.abs(ref[0]) < 1e-9 || Math.abs(ref[1]) > Math.abs(ref[0]) * VT) return vert(x); return [ref[0], ref[1], -(ref[0] * x + ref[1] * yRef)]; };
    const ymid = (w.minY + w.maxY) / 2;
    const left = w.left || side(w.minX, ymid), right = w.right || side(w.maxX, ymid);
    const q = [meet(floor, left), meet(floor, right), meet(ceil, right), meet(ceil, left)];
    if (q.some((p) => !p || !isFinite(p[0]) || !isFinite(p[1]))) continue;
    out2.push({ plane: w.plane, label: w.p, q: q.map((p) => [p[0] * big.width / sc, p[1] * big.width / sc]), qn: q, floorFrom: w.floor ? (floorP ? 'plane/edge' : 'edge') : 'guess', ceilFrom: w.ceil ? 'seen' : 'guess', n: w.n });
  }
  // aspect ratio of each wall from its quad and f (Zhang's rectangle test), real height assumed
  const HM = opt.height || 2.6, fp = f * W0, cxp = W0 / 2, cyp = H0 / 2;
  for (const w of out2) {
    const H = homography(w.q), h1 = [H[0], H[3], H[6]], h2 = [H[1], H[4], H[7]];
    const kin = (h) => [(h[0] - cxp * h[2]) / fp, (h[1] - cyp * h[2]) / fp, h[2]];
    const n1 = Math.hypot(...kin(h1)), n2 = Math.hypot(...kin(h2));
    w.h = HM; w.w = clamp(HM * n1 / n2, 0.3, 12);
  }
  for (let k = out2.length - 1; k >= 0; k--) if (out2[k].w < 0.6 && (out2[k].floorFrom === 'guess' || out2[k].n < N * 0.04)) out2.splice(k, 1);   // slivers at the edge of the photo
  T.walls = performance.now() - tt; tt = performance.now();
  onProgress('mask', 0);
  // masks at up to 1024 px, refined on the photo edges; light map at the analysis grid
  const MW = big.width, MH = big.height, g = big.getContext('2d').getImageData(0, 0, MW, MH).data;
  const lum = new Float32Array(MW * MH); for (let i = 0; i < MW * MH; i++) lum[i] = (0.299 * g[i * 4] + 0.587 * g[i * 4 + 1] + 0.114 * g[i * 4 + 2]) / 255;
  const mask = new Uint8Array(MW * MH * 4);
  out2.forEach((w, k) => {
    const p = new Float32Array(MW * MH);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { const gx = Math.min(AW - 1, (x / MW * AW) | 0), gy = Math.min(AH - 1, (y / MH * AH) | 0); p[y * MW + x] = lab[gy * AW + gx] === w.label ? 1 : 0; }
    const q = guided(lum, boxBlur(p, MW, MH, 2), MW, MH, Math.max(4, Math.round(MW / 128)), 2e-3);
    for (let i = 0; i < MW * MH; i++) mask[i * 4 + k] = clamp(Math.round((q[i] - 0.15) / 0.7 * 255), 0, 255);
  });
  // light: normalised convolution of the wall colour (linear) inside all walls, so objects and outlets vanish
  const lin = (c) => Math.pow(c / 255, 2.2), R = Math.max(3, Math.round(AW * 0.045));
  const chans = [new Float32Array(N), new Float32Array(N), new Float32Array(N)], wgt = new Float32Array(N);
  const small = document.createElement('canvas'); small.width = AW; small.height = AH; small.getContext('2d').drawImage(big, 0, 0, AW, AH);
  const sd = small.getContext('2d').getImageData(0, 0, AW, AH).data;
  for (let i = 0; i < N; i++) if (lab[i] >= 0) { wgt[i] = 1; for (let c = 0; c < 3; c++) chans[c][i] = lin(sd[i * 4 + c]); }
  let bw = wgt; const bc = chans.map((c) => c);
  for (let pass = 0; pass < 3; pass++) { bw = boxBlur(bw, AW, AH, R); for (let c = 0; c < 3; c++) bc[c] = boxBlur(bc[c], AW, AH, R); }
  let mr = 0, mg = 0, mb = 0, mn = 0;
  for (let i = 0; i < N; i++) if (lab[i] >= 0) { mr += chans[0][i]; mg += chans[1][i]; mb += chans[2][i]; mn++; }
  mr /= mn || 1; mg /= mn || 1; mb /= mn || 1;
  const light = new Uint8Array(N * 4), enc = (v) => clamp(Math.round(Math.pow(Math.max(0, v), 1 / 2.2) * 255), 0, 255);
  for (let i = 0; i < N; i++) {
    const ww = bw[i]; const r = ww > 0.02 ? bc[0][i] / ww : mr, gg = ww > 0.02 ? bc[1][i] / ww : mg, b = ww > 0.02 ? bc[2][i] / ww : mb;
    light[i * 4] = enc(r); light[i * 4 + 1] = enc(gg); light[i * 4 + 2] = enc(b); light[i * 4 + 3] = 255;
  }
  T.mask = performance.now() - tt;
  return { W: W0, H: H0, MW, MH, mask, AW, AH, light, ref: [mr / 0.85, mg / 0.85, mb / 0.85], walls: out2, f, fpx: fp, yh, rho, debug: { cls, pwall, disp, lab, planes, floorP, ceilP, AW, AH, sse: B.sse, cuts: B.cuts } };
}

export function homography(q) {   // unit square -> quad, row-major 3x3
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, d, e, g = 0, h = 0;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x3 - x0; d = y1 - y0; e = y3 - y0; }
  else { const den = dx1 * dy2 - dx2 * dy1; g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; }
  return [a, b, x0, d, e, y0, g, h, 1];
}
