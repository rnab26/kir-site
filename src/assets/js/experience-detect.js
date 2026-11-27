// Wall studio, "my photo": wall detection from one photo, fully in the browser (loaded only when a visitor imports a photo).
// 1. SegFormer (ADE20K) says which pixels are wall / floor / ceiling (furniture, windows, doors are excluded).
// 2. Depth Anything gives relative inverse depth; a flat surface is a plane in (x, y, inverse depth), whatever the
//    unknown scale and shift, so walls are split by fitting planes (RANSAC) to the wall pixels.
// 3. Plane intersections give the room corners (wall/wall), the floor line (wall/floor) and the ceiling line;
//    each wall becomes a quad (homography) + a soft mask refined on the photo edges + a smooth light map.
const TF = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const SEG = 'Xenova/segformer-b0-finetuned-ade-512-512', DEPTH = 'onnx-community/depth-anything-v2-small';
const SAM = 'Xenova/slimsam-77-uniform';   // Segment Anything (light): crisp outlines of the objects in front of the walls
const C_WALL = 0, C_FLOOR = 3, C_CEIL = 5, C_RUG = 28, C_SKY = 2;
let lib = null, seg = null, depth = null, sam = null;

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
  if (opt.sam !== false && !sam) {
    try { sam = { proc: await AutoProcessor.from_pretrained(opt.sam || SAM), model: await lib.SamModel.from_pretrained(opt.sam || SAM, { dtype: 'q8', device, progress_callback: cb }) }; }
    catch (e) { sam = null; console.warn('SAM unavailable', e); }   // the walls still work, with the softer outlines
  }
}

// ---------------------------------------------------------------- vertical vanishing point
// Near-vertical edges of the photo (door and window frames, corners, furniture) all point to one vanishing point; walls are
// built with their sides through it, so the slats stand exactly like the real verticals of the photo, whatever the camera tilt.
// Structure tensor orientations + iteratively reweighted least squares. Homogeneous, in x = X/W, y = Y/W units.
function smallestEig3(M) {   // eigenvector of the smallest eigenvalue of a symmetric 3x3 (Jacobi)
  const a = M.map((r) => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  let m = 0; for (let i = 1; i < 3; i++) if (a[i][i] < a[m][m]) m = i;
  return [v[0][m], v[1][m], v[2][m]];
}
function verticalVP(cv) {
  const W = 480, H = Math.max(8, Math.round(480 * cv.height / cv.width)), hImg = H / W;
  const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(cv, 0, 0, W, H);
  const d = c.getContext('2d').getImageData(0, 0, W, H).data, G = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) G[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const xx = new Float32Array(W * H), xy = new Float32Array(W * H), yy = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, gx = (G[i - W + 1] + 2 * G[i + 1] + G[i + W + 1]) - (G[i - W - 1] + 2 * G[i - 1] + G[i + W - 1]), gy = (G[i + W - 1] + 2 * G[i + W] + G[i + W + 1]) - (G[i - W - 1] + 2 * G[i - W] + G[i - W + 1]);
    xx[i] = gx * gx; xy[i] = gx * gy; yy[i] = gy * gy;
  }
  const Jxx = boxBlur(xx, W, H, 2), Jxy = boxBlur(xy, W, H, 2), Jyy = boxBlur(yy, W, H, 2);
  const E = new Float32Array(W * H); for (let i = 0; i < W * H; i++) E[i] = Jxx[i] + Jyy[i];
  const sample = []; for (let i = 0; i < W * H; i += 13) sample.push(E[i]); sample.sort((a, b) => a - b);
  const thr = sample[(sample.length * 0.8) | 0] || 1;
  const L = [];
  for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
    const i = y * W + x, e = E[i]; if (e < thr) continue;
    const coh = Math.sqrt((Jxx[i] - Jyy[i]) ** 2 + 4 * Jxy[i] ** 2) / (e + 1e-9); if (coh < 0.75) continue;
    const phi = 0.5 * Math.atan2(2 * Jxy[i], Jxx[i] - Jyy[i]), dx = -Math.sin(phi), dy = Math.cos(phi);
    if (Math.abs(dx) > 0.34) continue;
    const px = (x + 0.5) / W, py = (y + 0.5) / W;
    L.push([dy, -dx, -(dy * px - dx * py), Math.sqrt(e) * coh, px, py, dx, dy]);
  }
  if (L.length < 300) return [0, 1, 0];
  let v = [0, 1, 0];
  for (let it = 0; it < 8; it++) {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const l of L) {
      let tx, ty; if (Math.abs(v[2]) < 1e-9) { tx = v[0]; ty = v[1]; } else { tx = v[0] / v[2] - l[4]; ty = v[1] / v[2] - l[5]; }
      const tn = Math.hypot(tx, ty) || 1, r = Math.abs(l[6] * ty / tn - l[7] * tx / tn), w = l[3] / (1 + (r / 0.035) ** 2);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += w * l[a] * l[b];
    }
    v = smallestEig3(M);
  }
  // sanity: a vertical vanishing point is far above or below the picture, close to the vertical through its centre
  if (Math.abs(v[2]) > 1e-9) {
    const vx = v[0] / v[2] - 0.5, vy = v[1] / v[2] - hImg / 2;
    if (Math.hypot(vx, vy) < 1.2 || Math.abs(Math.atan2(Math.abs(vx), Math.abs(vy))) > 0.26) return [0, 1, 0];
    if (Math.hypot(vx, vy) > 60) return [0, 1, 0];
  } else if (Math.abs(Math.atan2(Math.abs(v[0]), Math.abs(v[1]))) > 0.26) return [0, 1, 0];
  return v;
}
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------------------------------------------------------------- crisp object outlines (Segment Anything)
// Every patch of non-wall pixels that touches a wall (furniture, lamps, frames, curtains, plants) gets one SAM prompt at its
// most inner point; the best SAM mask that is neither tiny nor mostly wall is cut out of the walls with a 1 px feather.
async function samObjects(raw, lab, cls, AW, AH, MW, MH, opt = {}, objLike = null, frontCut = null) {
  const { Tensor } = lib, N = AW * AH;
  const isObj = (i) => lab[i] < 0 && cls[i] !== C_FLOOR && cls[i] !== C_CEIL && cls[i] !== C_RUG && cls[i] !== C_SKY;
  const comp = new Int32Array(N).fill(-1), kept = [];
  for (let s0 = 0; s0 < N; s0++) {
    if (comp[s0] >= 0 || !isObj(s0)) continue;
    const px = [], st = [s0]; comp[s0] = s0; let touch = 0, bx0 = AW, by0 = AH, bx1 = 0, by1 = 0;
    while (st.length) {
      const j = st.pop(); px.push(j); const x = j % AW, y = (j / AW) | 0;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= AW || yy >= AH) continue;
        const k = yy * AW + xx; if (lab[k] >= 0) touch++; else if (comp[k] < 0 && isObj(k)) { comp[k] = s0; st.push(k); }
      }
    }
    if (px.length < Math.max(10, N * 0.0005) || touch < 6) continue;
    // most inner point: chamfer distance inside the patch
    const set = new Set(px), dist = new Map(); let best = px[0], bd = -1;
    for (const j of px) { const x = j % AW, y = (j / AW) | 0; let m = 99; for (let r = 1; r < 12 && m === 99; r++) { if (!set.has(j - r) || !set.has(j + r) || !set.has(j - r * AW) || !set.has(j + r * AW) || x - r < 0 || x + r >= AW) m = r; } dist.set(j, m); if (m > bd) { bd = m; best = j; } }
    let nf = 0; if (frontCut) for (const j of px) nf += frontCut[j];
    kept.push({ area: px.length, ix: best % AW, iy: (best / AW) | 0, box: [bx0, by0, bx1 + 1, by1 + 1], front: nf > px.length * 0.5 });
  }
  if (!kept.length) return null;
  kept.sort((a, b) => b.area - a.area);
  const inputs = await sam.proc(raw), emb = await sam.model.get_image_embeddings(inputs);
  const rs = inputs.reshaped_input_sizes[0], os = inputs.original_sizes[0], OH = os[0], OW = os[1];
  const obj = new Uint8Array(MW * MH), px2 = (OW * OH) / N;
  for (const c of kept.slice(0, 40)) {
    const x = (c.ix + 0.5) / AW * OW, y = (c.iy + 0.5) / AH * OH;
    // point + box prompt: the box corners are SAM's point labels 2 (top left) and 3 (bottom right); the box keeps the whole object
    const pt = [x * rs[1] / OW, y * rs[0] / OH], lb = [1n];
    // box prompts tested on 8 cluttered rooms (27/11/2026): they made specks on plain walls around frames, so off by default
    const useBox = opt.samBox === true && c.area < N * 0.03;
    if (useBox) {
      const m = 0.04 * Math.max(AW, AH), b = c.box, X = (v) => clamp((v / AW) * OW, 0, OW) * rs[1] / OW, Y = (v) => clamp((v / AH) * OH, 0, OH) * rs[0] / OH;
      pt.push(X(b[0] - m), Y(b[1] - m), X(b[2] + m), Y(b[3] + m)); lb.push(2n, 3n);
    }
    const input_points = new Tensor('float32', new Float32Array(pt), [1, 1, lb.length, 2]);
    const input_labels = new Tensor('int64', new BigInt64Array(lb), [1, 1, lb.length]);
    const out = await sam.model({ ...emb, input_points, input_labels });
    const masks = await sam.proc.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    const m = masks[0], md = m.data, plane = OW * OH, ious = out.iou_scores.data;
    let pick = -1, ps = -1; const inBox = [0, 0, 0], lookObj = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      let area = 0, onWall = 0;
      for (let i = k * plane, e = (k + 1) * plane, q = 0; i < e; i += 3, q += 3) {
        if (!md[i]) continue; area += 3;
        const gx = Math.min(AW - 1, ((q % OW) / OW * AW) | 0), gy = Math.min(AH - 1, (((q / OW) | 0) / OH * AH) | 0);
        if (lab[gy * AW + gx] >= 0) onWall += 3;
        if (objLike) lookObj[k] += objLike[q];
        if (useBox && gx >= c.box[0] - 0.06 * AW && gx < c.box[2] + 0.06 * AW && gy >= c.box[1] - 0.06 * AW && gy < c.box[3] + 0.06 * AW) inBox[k] += 3;
      }
      const ca = c.area * px2;
      if (area < ca * 0.3 || area > ca * 8 || onWall > area * 0.55) continue;
      if (useBox && inBox[k] < area * 0.85) continue;   // a box prompt must give an object inside its box, never the wall around it
      if (c.front && objLike && lookObj[k] / (area / 3) < 0.15) continue;   // a depth-cut patch must hold something that does not look like the wall
      if (ious[k] > ps) { ps = ious[k]; pick = k; }
    }
    if (pick < 0) continue;
    for (let i = 0, o = pick * plane; i < plane; i++) if (md[o + i]) obj[i] = 1;
  }
  return obj;
}

// ---------------------------------------------------------------- rectangles on the wall (windows, doors, frames, screens)
// Their hole becomes the exact rectangle in perspective (through the wall homography), each side moved onto the outermost strong
// photo edge nearby (the frame), and the rounded margin the segmentation leaves around them is wall again.
const RECT = new Set([8, 14, 22, 27, 58, 63, 89, 100, 130, 141, 143, 144]);   // windowpane, door, painting, mirror, screen door, blind, tv, poster, screens, board
const SEEN = new Set([1, 2, 4, 6, 9, 11, 16, 20, 25, 29, 32, 48, 68, 72, 84, 87]);   // what shows through a window: sky, trees, houses, street...
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
function snapRects(mask, base, out2, lab, cls, lum, AW, AH, MW, MH, W0, gIdx) {
  const N = AW * AH, ms = MW / W0, comp = new Int32Array(N).fill(-1);
  const isR = (i) => lab[i] < 0 && (RECT.has(cls[i]) || SEEN.has(cls[i]));
  const Hs = out2.map((w) => { const H = homography(w.q.map(([x, y]) => [x * ms, y * ms])); return { H, Hi: inv3(H) }; });
  const toP = (H, u, v) => { const z = H[6] * u + H[7] * v + H[8]; return [(H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z]; };
  const lumAt = ([X, Y]) => { const x = clamp(X - 0.5, 0, MW - 1.001), y = clamp(Y - 0.5, 0, MH - 1.001), x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0, i = y0 * MW + x0; return (lum[i] * (1 - tx) + lum[i + 1] * tx) * (1 - ty) + (lum[i + MW] * (1 - tx) + lum[i + MW + 1] * tx) * ty; };
  let done = 0;
  for (let s0 = 0; s0 < N && done < 16; s0++) {
    if (comp[s0] >= 0 || !isR(s0)) continue;
    const px = [], st = [s0], touch = out2.map(() => 0); comp[s0] = s0; let nR = 0;
    while (st.length) {
      const j = st.pop(); px.push(j); if (RECT.has(cls[j])) nR++;
      const x = j % AW, y = (j / AW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= AW || yy >= AH) continue;
        const kk = yy * AW + xx;
        if (lab[kk] >= 0) { const wi = out2.findIndex((w) => w.label === lab[kk]); if (wi >= 0) touch[wi]++; } else if (comp[kk] < 0 && isR(kk)) { comp[kk] = s0; st.push(kk); }
      }
    }
    if (px.length < N * 0.002 || nR < px.length * 0.15) continue;
    let k = 0; for (let i = 1; i < touch.length; i++) if (touch[i] > touch[k]) k = i;
    if (touch[k] < 12 || !Hs[k].Hi) continue;
    const { H, Hi } = Hs[k], us = [], vs = [];
    for (const j of px) { const X = (j % AW + 0.5) / AW * MW, Y = (((j / AW) | 0) + 0.5) / AH * MH, z = Hi[6] * X + Hi[7] * Y + Hi[8]; us.push((Hi[0] * X + Hi[1] * Y + Hi[2]) / z); vs.push((Hi[3] * X + Hi[4] * Y + Hi[5]) / z); }
    us.sort((a, b) => a - b); vs.sort((a, b) => a - b);
    const pc = (a, t) => a[Math.round(t * (a.length - 1))];
    const u0 = pc(us, 0.02), u1 = pc(us, 0.98), v0 = pc(vs, 0.02), v1 = pc(vs, 0.98), du = u1 - u0, dv = v1 - v0;
    if (du < 0.02 || dv < 0.02 || u0 < -0.05 || u1 > 1.05 || v0 < -0.05 || v1 > 1.05) continue;
    // a rectangle: nearly all of it is off the wall, and most of it is this patch
    let nS = 0, off = 0, mine = 0;
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) {
      const [X, Y] = toP(H, u0 + (a + 0.5) / 16 * du, v0 + (b + 0.5) / 16 * dv); if (!(X >= 0 && Y >= 0 && X < MW && Y < MH)) continue;
      const gi = gIdx[(Y | 0) * MW + (X | 0)]; nS++; if (lab[gi] < 0) off++; if (comp[gi] === s0) mine++;
    }
    if (nS < 64 || off / nS < 0.9 || mine / nS < 0.6) continue;
    // sides onto the outermost strong edge within 15 % of the size (the outside of the frame)
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, Pc = toP(H, cu, cv), Pu = toP(H, cu + 0.01, cv), Pv = toP(H, cu, cv + 0.01);
    const pxU = Math.hypot(Pu[0] - Pc[0], Pu[1] - Pc[1]) / 0.01, pxV = Math.hypot(Pv[0] - Pc[0], Pv[1] - Pc[1]) / 0.01;
    if (!(pxU > 0 && pxV > 0)) continue;
    const eu = 1.5 / pxU, ev = 1.5 / pxV;
    const side = (t0, span, vert, outward) => {
      const S = [], ts = [];
      for (let s = -15; s <= 15; s++) {
        const t = t0 + s / 100 * span; let sc = 0;
        for (let j = 0; j < 24; j++) {
          const a = (vert ? v0 + (0.15 + 0.7 * j / 23) * dv : u0 + (0.15 + 0.7 * j / 23) * du);
          sc += vert ? Math.abs(lumAt(toP(H, t + eu, a)) - lumAt(toP(H, t - eu, a))) : Math.abs(lumAt(toP(H, a, t + ev)) - lumAt(toP(H, a, t - ev)));
        }
        S.push(sc / 24); ts.push(t);
      }
      const mx = Math.max(...S); if (mx < 0.04) return t0;
      let best = -1; for (let s = 0; s < S.length; s++) if (S[s] >= mx * 0.6) { if (best < 0 || (outward < 0 ? ts[s] < ts[best] : ts[s] > ts[best])) best = s; }
      return ts[best];
    };
    const uL = side(u0, du, true, -1), uR = side(u1, du, true, 1), vB = side(v0, dv, false, -1), vT = side(v1, dv, false, 1);
    if (uR - uL < du * 0.5 || vT - vB < dv * 0.5) continue;
    const band = Math.max(4, 0.1 * Math.min((uR - uL) * pxU, (vT - vB) * pxV));
    const cs = [toP(H, uL, vB), toP(H, uR, vB), toP(H, uR, vT), toP(H, uL, vT)];
    const bx0 = Math.max(0, Math.floor(Math.min(...cs.map((c) => c[0])) - band - 2)), bx1 = Math.min(MW - 1, Math.ceil(Math.max(...cs.map((c) => c[0])) + band + 2));
    const by0 = Math.max(0, Math.floor(Math.min(...cs.map((c) => c[1])) - band - 2)), by1 = Math.min(MH - 1, Math.ceil(Math.max(...cs.map((c) => c[1])) + band + 2));
    const lw = out2[k].label;
    // stray bits of the patch outside the rectangle are wall again too: scan the patch's own box as well
    let gx0 = AW, gx1 = 0, gy0 = AH, gy1 = 0; for (const j of px) { const gx = j % AW, gy = (j / AW) | 0; gx0 = Math.min(gx0, gx); gx1 = Math.max(gx1, gx); gy0 = Math.min(gy0, gy); gy1 = Math.max(gy1, gy); }
    const near = (gi) => { const gx = gi % AW, gy = (gi / AW) | 0; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const xx = gx + a, yy = gy + b; if (xx >= 0 && yy >= 0 && xx < AW && yy < AH && comp[yy * AW + xx] === s0) return true; } return false; };
    const X0 = Math.min(bx0, Math.floor(gx0 / AW * MW) - 2), X1 = Math.max(bx1, Math.ceil((gx1 + 1) / AW * MW) + 2), Y0 = Math.min(by0, Math.floor(gy0 / AH * MH) - 2), Y1 = Math.max(by1, Math.ceil((gy1 + 1) / AH * MH) + 2);
    for (let y = Math.max(0, Y0); y <= Math.min(MH - 1, Y1); y++) for (let x = Math.max(0, X0); x <= Math.min(MW - 1, X1); x++) {
      const X = x + 0.5, Y = y + 0.5, z = Hi[6] * X + Hi[7] * Y + Hi[8], u = (Hi[0] * X + Hi[1] * Y + Hi[2]) / z, v = (Hi[3] * X + Hi[4] * Y + Hi[5]) / z;
      const d = Math.min(Math.min(u - uL, uR - u) * pxU, Math.min(v - vB, vT - v) * pxV), cin = clamp(d + 0.5, 0, 1), i = y * MW + x, gi = gIdx[i];
      const m0 = mask[i * 4 + k], b = 255 * base[k][i]; let m = m0 * (1 - cin);
      // the wall comes up to the frame: the patch outside the rectangle, and the soft rim of wall along the patch's old edge
      // (not the edge of anything else, a curtain or a lamp next to the window keeps its cut-out)
      if (d < 0 && (comp[gi] === s0 || (d > -band && lab[gi] === lw && near(gi)))) m = Math.max(m, b * (1 - cin));
      mask[i * 4 + k] = Math.round(m);
    }
    done++;
  }
  return done;
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
  const big = document.createElement('canvas'), sc = Math.min(1, (opt.maskMax || 1024) / Math.max(W0, H0));
  big.width = Math.round(W0 * sc); big.height = Math.round(H0 * sc);
  big.getContext('2d').drawImage(source, 0, 0, big.width, big.height);
  const raw = RawImage.fromCanvas(big);
  const T = opt.times || {}; let tt = performance.now();
  onProgress('seg', 0);
  const inp = await seg.proc(raw), out = await seg.model(inp), lg = out.logits, [, NC, LH, LW] = lg.dims, L = lg.data;
  if (opt.segFlip) {   // test-time flip: the mirrored photo's scores, mirrored back and averaged, steady the object outlines
    const fc = document.createElement('canvas'); fc.width = big.width; fc.height = big.height;
    const fx = fc.getContext('2d'); fx.translate(fc.width, 0); fx.scale(-1, 1); fx.drawImage(big, 0, 0);
    const o2 = await seg.model(await seg.proc(RawImage.fromCanvas(fc))), L2 = o2.logits.data;
    for (let c = 0; c < NC; c++) { const o = c * LH * LW; for (let y = 0; y < LH; y++) { const r = o + y * LW; for (let x = 0; x < LW; x++) L[r + x] = (L[r + x] + L2[r + LW - 1 - x]) / 2; } }
  }
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
  // in front of the wall: what the segmentation took for wall but stands clearly closer than the wall plane (a sofa back, a
  // lamp shade, a plant or a chair against a pale wall) leaves the wall, so the mask and the object outlines (SAM) cut it out.
  // Inverse depth grows towards the camera; the threshold follows how flat this photo's walls really are (median residual).
  const frontCut = new Uint8Array(N);
  if (opt.front !== false) {
    const res = new Float32Array(N), abs = [];
    for (let i = 0; i < N; i++) if (lab[i] >= 0) { const p = planes[lab[i]]; res[i] = disp[i] - (p[0] * pts.x[i] + p[1] * pts.y[i] + p[2]); abs.push(Math.abs(res[i])); }
    abs.sort((a, b) => a - b);
    const mad = abs[(abs.length / 2) | 0] || 0, lim = Math.max(opt.frontMin || 0.03, mad * (opt.frontK || 6));
    // the residual is averaged over wall cells first (normalised box blur): depth noise around an edge (an open door, a plant)
    // must not become a lattice of tiny cut-outs; a real object in front gives a broad, smooth bump
    const wv = new Float32Array(N), rv = new Float32Array(N);
    for (let i = 0; i < N; i++) if (lab[i] >= 0) { wv[i] = 1; rv[i] = res[i]; }
    const wb = boxBlur(wv, AW, AH, 2), rb = boxBlur(rv, AW, AH, 2);
    // only where the segmentation hesitated: a plain wall beside an open door is sure to be wall (depth bleeds there)
    const fr = new Uint8Array(N); for (let i = 0; i < N; i++) if (lab[i] >= 0 && pwall[i] < (opt.frontP || 0.9) && wb[i] > 0.3 && rb[i] / wb[i] > lim && res[i] > lim * 0.6) fr[i] = 1;
    // opening (erode then dilate, 1 cell) drops depth speckle; only solid patches count
    const er = new Uint8Array(N), op = new Uint8Array(N);
    for (let y = 1; y < AH - 1; y++) for (let x = 1; x < AW - 1; x++) { const i = y * AW + x; er[i] = fr[i] & fr[i - 1] & fr[i + 1] & fr[i - AW] & fr[i + AW]; }
    for (let y = 1; y < AH - 1; y++) for (let x = 1; x < AW - 1; x++) { const i = y * AW + x; op[i] = (er[i] | er[i - 1] | er[i + 1] | er[i - AW] | er[i + AW]) & fr[i]; }
    const seen = new Uint8Array(N), minA = Math.max(12, N * 0.0015); let cut = 0;
    for (let s = 0; s < N; s++) {
      if (!op[s] || seen[s]) continue;
      const st = [s], px = []; seen[s] = 1;
      while (st.length) { const j = st.pop(); px.push(j); const x = j % AW; for (const k of [j - 1, j + 1, j - AW, j + AW]) { if (k < 0 || k >= N || seen[k] || !op[k] || (k === j - 1 && x === 0) || (k === j + 1 && x === AW - 1)) continue; seen[k] = 1; st.push(k); } }
      if (px.length < minA) continue;
      let x0 = AW, x1 = 0, y0 = AH, y1 = 0;
      for (const j of px) { const x = j % AW, y = (j / AW) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (px.length < (x1 - x0 + 1) * (y1 - y0 + 1) * 0.35) continue;   // a sparse lattice is noise, an object is solid
      for (const j of px) { lab[j] = -1; frontCut[j] = 1; cut++; }
    }
    T.front = cut; T.frontLim = Math.round(lim * 1000) / 1000;
  }
  // specks: a few cells the segmentation hesitated on (a soft shadow, a reflection) inside one wall are wall again, otherwise
  // the cut-out becomes a lattice of little holes. Real objects are bigger than this and stay cut out.
  if (opt.fillHoles !== false) {
    const seen = new Uint8Array(N), maxA = opt.holeMax || 12; let filled = 0;
    for (let s = 0; s < N; s++) {
      if (lab[s] >= 0 || seen[s]) continue;
      const st = [s], px = []; seen[s] = 1; let nb = -2, border = false;
      while (st.length) {
        const j = st.pop(); px.push(j); const x = j % AW, y = (j / AW) | 0;
        if (x === 0 || y === 0 || x === AW - 1 || y === AH - 1) border = true;
        for (const k of [j - 1, j + 1, j - AW, j + AW]) {
          if (k < 0 || k >= N || (k === j - 1 && x === 0) || (k === j + 1 && x === AW - 1)) continue;
          if (lab[k] >= 0) { if (nb === -2) nb = lab[k]; else if (nb !== lab[k]) nb = -1; continue; }
          if (!seen[k]) { seen[k] = 1; st.push(k); }
        }
      }
      if (px.length > maxA || border || nb < 0 || px.some((j) => cls[j] === C_FLOOR || cls[j] === C_CEIL || cls[j] === C_RUG)) continue;
      for (const j of px) lab[j] = nb; filled += px.length;
    }
    for (let pass = 0; pass < 2; pass++) {
      const add = [];
      for (let y = 1; y < AH - 1; y++) for (let x = 1; x < AW - 1; x++) {
        const i = y * AW + x; if (lab[i] >= 0 || cls[i] === C_FLOOR || cls[i] === C_CEIL || cls[i] === C_RUG) continue;
        const cnt = {}; let best = -1, bn = 0;
        for (const k of [i - AW - 1, i - AW, i - AW + 1, i - 1, i + 1, i + AW - 1, i + AW, i + AW + 1]) { const l = lab[k]; if (l < 0) continue; cnt[l] = (cnt[l] || 0) + 1; if (cnt[l] > bn) { bn = cnt[l]; best = l; } }
        if (bn >= 7) add.push(i, best);
      }
      for (let a = 0; a < add.length; a += 2) lab[add[a]] = add[a + 1];
      filled += add.length / 2;
    }
    T.holes = filled;
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
    w.fN = fx.length; w.cN = cx.length; w.colX = colX; w.colT = colT; w.colB = colB; w.fS = [fx, fy]; w.cS = [cx, cy];
    // a line seen only over a small piece of the wall extrapolates badly (a corner of ceiling): it must cover a third of the wall
    const span = (xs) => (xs.length ? (Math.max(...xs) - Math.min(...xs)) / Math.max(0.02, w.maxX - w.minX) : 0);
    if (w.ceil && span(cx) < 0.33) w.ceil = null;
    if (w.floor && span(fx) < 0.33 && !floorP) w.floor = null;
    // floor and ceiling lines of one wall meet on the horizon, between them: if they cross elsewhere the ceiling line is wrong
    if (w.floor && w.ceil) {
      const xm = (w.minX + w.maxX) / 2, yf = yAt(w.floor, xm), yc = yAt(w.ceil, xm), vp = meet(w.floor, w.ceil);
      if (yf <= yc || (vp && Math.abs(vp[0] - xm) < 3 && (vp[1] < yc || vp[1] > yf))) w.ceil = null;
    }
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
  const VVP = opt.vertical === false ? [0, 1, 0] : verticalVP(big);
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
    // sides through the photo's vertical vanishing point: the slats follow the real verticals of the picture
    // (a corner shared by two walls gets one line, cached on the corner, so both walls meet exactly)
    const ymidV = (w.minY + w.maxY) / 2, xAt = (Lr, y) => -(Lr[1] * y + Lr[2]) / Lr[0];
    const viaVP = (Lr, dflt) => {
      if (Lr && Math.abs(Lr[0]) > 1e-12) { if (!Lr.vv) Lr.vv = cross3([xAt(Lr, ymidV), ymidV, 1], VVP); return Lr.vv; }
      return cross3([dflt, ymidV, 1], VVP);
    };
    w.cornL = !!w.left; w.cornR = !!w.right;
    w.left = viaVP(w.left, w.minX); w.right = viaVP(w.right, w.maxX);
    const ref = w.left || w.right;
    const side = (x, yRef) => { if (!ref || Math.abs(ref[0]) < 1e-9 || Math.abs(ref[1]) > Math.abs(ref[0]) * VT) return vert(x); return [ref[0], ref[1], -(ref[0] * x + ref[1] * yRef)]; };
    const ymid = (w.minY + w.maxY) / 2;
    const left = w.left || side(w.minX, ymid), right = w.right || side(w.maxX, ymid);
    const q = [meet(floor, left), meet(floor, right), meet(ceil, right), meet(ceil, left)];
    if (q.some((p) => !p || !isFinite(p[0]) || !isFinite(p[1]))) continue;
    out2.push({ plane: w.plane, label: w.p, q: q.map((p) => [p[0] * big.width / sc, p[1] * big.width / sc]), qn: q, floorFrom: w.floor ? (floorP ? 'plane/edge' : 'edge') : 'guess', ceilFrom: w.ceil ? 'seen' : 'guess', n: w.n,
      fL: w.floor || null, cL: w.ceil || null, fS: w.fS, cS: w.cS, cornL: w.cornL, cornR: w.cornR, minX: w.minX, maxX: w.maxX });
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
  // light first: normalised convolution of the wall colour (linear) inside all walls, so objects and outlets vanish
  const MW = big.width, MH = big.height, g = big.getContext('2d').getImageData(0, 0, MW, MH).data;
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
  const LT = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  const light = new Uint8Array(N * 4), enc = (v) => clamp(Math.round(Math.pow(Math.max(0, v), 1 / 2.2) * 255), 0, 255);
  for (let i = 0; i < N; i++) {
    const ww = bw[i]; LT[0][i] = ww > 0.02 ? bc[0][i] / ww : mr; LT[1][i] = ww > 0.02 ? bc[1][i] / ww : mg; LT[2][i] = ww > 0.02 ? bc[2][i] / ww : mb;
    light[i * 4] = enc(LT[0][i]); light[i * 4 + 1] = enc(LT[1][i]); light[i * 4 + 2] = enc(LT[2][i]); light[i * 4 + 3] = 255;
  }
  // masks at full resolution, refined on the photo edges (guided filter). Thin things in front of a wall (stems, lamp poles,
  // stands) slip through the coarse segmentation, so on a plain wall a pixel must also look like the wall: close to its smooth light.
  const LUT = new Float32Array(256); for (let v = 0; v < 256; v++) LUT[v] = lin(v);
  const lum = new Float32Array(MW * MH), obj = new Float32Array(MW * MH);
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = y * MW + x, r = LUT[g[i * 4]], gg = LUT[g[i * 4 + 1]], b = LUT[g[i * 4 + 2]];
    lum[i] = (0.299 * g[i * 4] + 0.587 * g[i * 4 + 1] + 0.114 * g[i * 4 + 2]) / 255;
    const fx = clamp((x + 0.5) / MW * AW - 0.5, 0, AW - 1), fy = clamp((y + 0.5) / MH * AH - 0.5, 0, AH - 1), x0 = fx | 0, y0 = fy | 0, x1 = Math.min(AW - 1, x0 + 1), y1 = Math.min(AH - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    const at = (c) => (LT[c][y0 * AW + x0] * (1 - tx) + LT[c][y0 * AW + x1] * tx) * (1 - ty) + (LT[c][y1 * AW + x0] * (1 - tx) + LT[c][y1 * AW + x1] * tx) * ty;
    const er = at(0), eg = at(1), eb = at(2), lp = 0.2126 * r + 0.7152 * gg + 0.0722 * b + 0.004, le = 0.2126 * er + 0.7152 * eg + 0.0722 * eb + 0.004;
    const ratio = lp / le, chroma = Math.abs(r / lp - er / le) + Math.abs(gg / lp - eg / le) + Math.abs(b / lp - eb / le);
    // only really dark or differently coloured pixels are objects: a shadow on the wall is darker but keeps the wall colour
    obj[i] = Math.max(sm(0.3, 0.16, ratio), sm(2.2, 2.8, ratio), sm(0.2, 0.36, chroma));
  }
  const objS = boxBlur(obj, MW, MH, 1);
  const mask = new Uint8Array(MW * MH * 4), base = [], ms = MW / W0;
  const gIdx = new Int32Array(MW * MH);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) gIdx[y * MW + x] = Math.min(AH - 1, (y / MH * AH) | 0) * AW + Math.min(AW - 1, (x / MW * AW) | 0);
  const CEILS = new Set([C_CEIL]), FLOORS = new Set([C_FLOOR, C_RUG]);
  out2.forEach((w, k) => {
    // straight edges: a seen ceiling / floor line that matches the segmentation boundary and the corners with the neighbours cut
    // the wall exactly (anti-aliased); what the segmentation gave to the ceiling, the floor or the next wall just inside is wall
    const Q = w.q.map(([x, y]) => [x * ms, y * ms]), ccx = (Q[0][0] + Q[1][0] + Q[2][0] + Q[3][0]) / 4, ccy = (Q[0][1] + Q[1][1] + Q[2][1] + Q[3][1]) / 4;
    const E = [];
    const add = (a, b, fill, m) => { let L = lineThrough(a, b); const n = Math.hypot(L[0], L[1]); if (n < 1e-9) return; L = L.map((v) => v / n); if (L[0] * ccx + L[1] * ccy + L[2] < 0) L = L.map((v) => -v); E.push({ L, fill, m }); };
    const fits = (L, S) => { if (!L || !S || S[0].length < 8 || Math.abs(L[1]) < 1e-9) return false; const e = S[0].map((x, i) => Math.abs(yAt(L, x) - S[1][i])).sort((a, b) => a - b); return e[(e.length / 2) | 0] < 0.006; };
    if (opt.straight !== false) {
      if (fits(w.cL, w.cS)) add(Q[3], Q[2], CEILS, MW * 0.03);
      if (fits(w.fL, w.fS)) add(Q[0], Q[1], FLOORS, MW * 0.03);
      if (w.cornL) add(Q[0], Q[3], null, MW * 0.05);
      if (w.cornR) add(Q[1], Q[2], null, MW * 0.05);
    }
    const x0 = w.cornL ? -1e9 : w.minX * MW - 2, x1 = w.cornR ? 1e9 : w.maxX * MW + 2;
    const p = new Float32Array(MW * MH), C = new Float32Array(MW * MH);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      // the label grid is read bilinearly: a slanted edge (white curtain on a white wall, where the photo gives the guided
      // filter nothing to follow) comes out as a smooth line, not as stair steps of grid cells
      const fx = clamp((x + 0.5) / MW * AW - 0.5, 0, AW - 1.001), fy = clamp((y + 0.5) / MH * AH - 0.5, 0, AH - 1.001), ax = fx | 0, ay = fy | 0, tx = fx - ax, ty = fy - ay, a0 = ay * AW + ax;
      const bl = ((lab[a0] === w.label) * (1 - tx) + (lab[a0 + 1] === w.label) * tx) * (1 - ty) + ((lab[a0 + AW] === w.label) * (1 - tx) + (lab[a0 + AW + 1] === w.label) * tx) * ty;
      const i = y * MW + x, gi = gIdx[i], l = lab[gi]; let v = bl, c = 1;
      for (const e of E) {
        const d = e.L[0] * (x + 0.5) + e.L[1] * (y + 0.5) + e.L[2];
        c *= d <= -0.5 ? 0 : d >= 0.5 ? 1 : d + 0.5;
        if (v < 1 && d > -6 && d < e.m && (e.fill ? x >= x0 && x <= x1 && e.fill.has(cls[gi]) : l >= 0)) v = 1;
      }
      p[i] = v; C[i] = c;
    }
    const q = guided(lum, boxBlur(p, MW, MH, 1), MW, MH, Math.max(3, Math.round(MW / 256)), 1e-3);   // small radius: crisp cut-outs
    // a plain wall (most of its pixels look like its light) gets the object test; a textured one (wallpaper, brick) does not
    let n = 0, o = 0; for (let i = 0; i < MW * MH; i += 7) if (p[i] > 0.5) { n++; if (obj[i] > 0.5) o++; }
    const useObj = n > 0 && o / n < 0.12, B = new Float32Array(MW * MH);
    for (let i = 0; i < MW * MH; i++) { B[i] = C[i] * (useObj ? sm(0.65, 0.35, objS[i]) : 1); mask[i * 4 + k] = Math.round(sm(0.3, 0.62, q[i]) * B[i] * 255); }   // steep but anti-aliased edge
    base.push(B);
  });
  if (sam && opt.sam !== false) {   // crisp outlines: what Segment Anything calls an object is cut out of every wall
    onProgress('cut', 0);
    try {
      const objM = await samObjects(raw, lab, cls, AW, AH, MW, MH, opt, obj, frontCut);
      if (objM) {
        const fo = new Float32Array(MW * MH); for (let i = 0; i < fo.length; i++) fo[i] = objM[i];
        const ff = boxBlur(fo, MW, MH, 1);
        // safety: object outlines never eat most of a wall (a mask that took the wall for an object is ignored on that wall)
        const before = new Float64Array(4), after = new Float64Array(4);
        for (let i = 0; i < MW * MH; i += 2) for (let k = 0; k < out2.length; k++) { const m = mask[i * 4 + k]; before[k] += m; after[k] += m * (1 - ff[i]); }
        const ok = [0, 1, 2, 3].map((k) => after[k] >= before[k] * 0.6);
        for (let i = 0; i < MW * MH; i++) { const keep = 1 - ff[i]; if (keep < 0.999) for (let k = 0; k < out2.length; k++) if (ok[k]) mask[i * 4 + k] = Math.round(mask[i * 4 + k] * keep); }
        T.samKept = ok.slice(0, out2.length).map(Number).join('');
      }
    } catch (e) { console.warn('SAM step skipped', e); }
    T.sam = performance.now() - tt;
  }
  if (opt.rects !== false) { try { T.rects = snapRects(mask, base, out2, lab, cls, lum, AW, AH, MW, MH, W0, gIdx); } catch (e) { console.warn('rectangle step skipped', e); } }
  T.mask = performance.now() - tt; tt = performance.now();
  // opt.room = {fpx, walls: [{q, w}]} (a prepared room.json): the floor follows that stored geometry instead of this run's walls
  let fFp = fp, fWalls = out2, fYh = yh;
  if (opt.room) {
    fFp = opt.room.fpx; fWalls = opt.room.walls.map((w) => ({ q: w.q, w: w.w, floorFrom: 'room' }));
    const ys = []; for (const w of opt.room.walls) { const v = meet(lineThrough(w.q[0], w.q[1]), lineThrough(w.q[3], w.q[2])); if (v && isFinite(v[1]) && Math.abs(v[0] - W0 / 2) < W0 * 8) ys.push(v[1]); }
    ys.sort((a, b) => a - b); if (ys.length) fYh = ys[(ys.length / 2) | 0] / W0;
  }
  const fl = opt.floor === false ? null : floorOf({ cls, N, AW, AH, W0, H0, MW, MH, fp: fFp, cxp, cyp, yh: fYh, rho, HM, walls: fWalls, sd, g, lum, lin, LUT, sm });
  T.floor = performance.now() - tt;
  return { W: W0, H: H0, MW, MH, mask, AW, AH, light, ref: [mr / 0.85, mg / 0.85, mb / 0.85], walls: out2, f, fpx: fp, yh, rho,
    floor: fl && fl.floor, floorMask: fl && fl.mask, floorLight: fl && fl.light, floorRef: fl && fl.ref,
    debug: { cls, pwall, disp, lab, planes, floorP, ceilP, AW, AH, sse: B.sse, cuts: B.cuts } };
}

// ---------------------------------------------------------------- floor: a homography photo px -> metres on the floor, a soft mask, a light map
// Camera: focal fp, principal point at the centre, no roll, horizon y = yh. The floor normal is then K^T l (l = horizon line),
// so every floor pixel has a position on the floor plane (camera height 1, rescaled with the measured wall widths).
// The first floor direction follows the main wall's floor line, so planks run square to the room.
// A rug stays in front of the new floor (only ADE20K "floor" is replaced).
function floorOf(c) {
  const { cls, N, AW, AH, W0, MW, MH, fp, cxp, cyp, yh, rho, HM, walls, sd, g, lum, lin, LUT, sm } = c;
  // floor pixels; small islands of "floor" inside a rug are segmentation slips (shaggy rugs), they stay rug
  const fF = new Uint8Array(N); for (let i = 0; i < N; i++) fF[i] = cls[i] === C_FLOOR ? 1 : 0;
  {
    const seen = new Int32Array(N).fill(-1), stack = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (!fF[s0] || seen[s0] >= 0) continue;
      const comp = []; let rug = 0, edge = 0; stack.push(s0); seen[s0] = s0;
      while (stack.length) {
        const i = stack.pop(), x = i % AW, y = (i / AW) | 0; comp.push(i);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= AW || Y >= AH) continue;
          const j = Y * AW + X;
          if (fF[j]) { if (seen[j] < 0) { seen[j] = s0; stack.push(j); } } else { edge++; if (cls[j] === C_RUG) rug++; }
        }
      }
      if (comp.length < N * 0.03 && edge && rug / edge > 0.5) for (const i of comp) fF[i] = 0;
    }
    // along a rug, a "floor" pixel whose colour is closer to the rug than to the floor joins the rug (grown a few steps)
    const mean = (pick) => { const m = [0, 0, 0]; let n = 0; for (let i = 0; i < N; i++) if (pick(i)) { for (let k = 0; k < 3; k++) m[k] += sd[i * 4 + k]; n++; } return n > 30 ? m.map((v) => v / n) : null; };
    const mF = mean((i) => fF[i] === 1), mR = mean((i) => cls[i] === C_RUG);
    if (mF && mR) {
      const isR = new Uint8Array(N); for (let i = 0; i < N; i++) isR[i] = cls[i] === C_RUG ? 1 : 0;
      const d2 = (i, m) => (sd[i * 4] - m[0]) ** 2 + (sd[i * 4 + 1] - m[1]) ** 2 + (sd[i * 4 + 2] - m[2]) ** 2;
      const d2s = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      for (let step = 0; step < 6; step++) {
        const add = [];
        for (let i = 0; i < N; i++) {
          if (!fF[i]) continue;
          const x = i % AW, y = (i / AW) | 0;
          if (!((x > 0 && isR[i - 1]) || (x < AW - 1 && isR[i + 1]) || (y > 0 && isR[i - AW]) || (y < AH - 1 && isR[i + AW]))) continue;
          if (d2(i, mR) * 1.5 < d2(i, mF)) add.push(i);
        }
        if (!add.length) break;
        for (const i of add) { fF[i] = 0; isR[i] = 1; }
      }
      // and anywhere, a "floor" pixel clearly closer to the rug colour (rug parts the segmentation missed)
      const far = d2s(mR, mF);
      if (far > 900) for (let i = 0; i < N; i++) if (fF[i] && d2(i, mR) * 3 < d2(i, mF)) fF[i] = 0;
    }
  }
  const isF = (i) => fF[i] === 1;
  let nF = 0; for (let i = 0; i < N; i++) if (isF(i)) nF++;
  if (nF < N * 0.02) return null;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const yhp = yh * W0, n = norm([0, fp, cyp - yhp]);   // camera axes: x right, y down, z forward; n points down to the floor
  const ray = (px, py) => [(px - cxp) / fp, (py - cyp) / fp, 1];
  const onFloor = (px, py) => { const r = ray(px, py), k = dot(n, r); return k > 1e-4 ? [r[0] / k, r[1] / k, r[2] / k] : null; };   // n.X = 1
  // main wall: the one with a measured floor line closest to the middle of the photo
  let main = null, bd = Infinity;
  for (const w of walls) { if (w.floorFrom === 'guess') continue; const d = Math.abs((w.q[0][0] + w.q[1][0]) / 2 / W0 - 0.5); if (d < bd) { bd = d; main = w; } }
  let e1 = null;
  if (main) { const A = onFloor(...main.q[0]), B = onFloor(...main.q[1]); if (A && B) e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]; }
  if (!e1) e1 = [1, 0, 0];
  e1 = norm([e1[0] - n[0] * dot(n, e1), e1[1] - n[1] * dot(n, e1), e1[2] - n[2] * dot(n, e1)]);
  if (e1[0] < 0) e1 = e1.map((v) => -v);
  let e2 = norm(cross(n, e1)); if (e2[2] < 0) e2 = e2.map((v) => -v);   // away from the camera
  const O = n;   // the floor point under the camera
  const uvOf = (X) => { const d = [X[0] - O[0], X[1] - O[1], X[2] - O[2]]; return [dot(d, e1), dot(d, e2)]; };
  // scale: the floor line of every measured wall must be as long as the wall is wide
  const ks = [];
  for (const w of walls) {
    if (w.floorFrom === 'guess') continue;
    const A = onFloor(...w.q[0]), B = onFloor(...w.q[1]); if (!A || !B) continue;
    const a = uvOf(A), b = uvOf(B), D = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (D > 1e-6) ks.push(w.w / D);
  }
  ks.sort((a, b) => a - b);
  const s = ks.length ? ks[(ks.length / 2) | 0] : rho * HM;   // metres per unit = camera height in metres
  // extent of the visible floor (robust percentiles), in metres
  const us = [], vs = [];
  for (let i = 0; i < N; i++) {
    if (!isF(i)) continue;
    const X = onFloor((i % AW + 0.5) / AW * W0, (Math.floor(i / AW) + 0.5) / AW * W0); if (!X) continue;
    const uv = uvOf(X); us.push(uv[0] * s); vs.push(uv[1] * s);
  }
  if (us.length < 50) return null;
  us.sort((a, b) => a - b); vs.sort((a, b) => a - b);
  const pc = (a, p) => a[clamp(Math.round(p * (a.length - 1)), 0, a.length - 1)];
  const u0 = pc(us, 0.01), u1 = pc(us, 0.99), v1 = Math.min(pc(vs, 0.99), 25);
  let v0 = pc(vs, 0.01);
  const zAt = (U, V) => n[2] + (U * e1[2] + V * e2[2]) / s;   // camera depth of a floor point: the quad corners stay in front
  if (e2[2] > 1e-6) for (const U of [u0, u1]) v0 = Math.max(v0, (0.05 - n[2] - U * e1[2] / s) * s / e2[2]);
  if (!(v1 > v0 + 0.3) || !(u1 > u0 + 0.3) || zAt(u0, v1) <= 0 || zAt(u1, v1) <= 0) return null;
  const K = (v) => [fp * v[0] + cxp * v[2], fp * v[1] + cyp * v[2], v[2]];
  const toPx = (U, V) => { const P = K([O[0] + (U * e1[0] + V * e2[0]) / s, O[1] + (U * e1[1] + V * e2[1]) / s, O[2] + (U * e1[2] + V * e2[2]) / s]); return [P[0] / P[2], P[1] / P[2]]; };
  const q = [toPx(u0, v0), toPx(u1, v0), toPx(u1, v1), toPx(u0, v1)];
  if (q.some((p) => !isFinite(p[0]) || !isFinite(p[1]))) return null;
  // light: normalised convolution of the floor colour (the old floor's pattern vanishes), times a finer layer for soft shadows
  // (under a sofa, around legs) and reflections, as a ratio clamped so that the old pattern does not come back
  const blur3 = (src, r) => { let o = src; for (let k = 0; k < 3; k++) o = boxBlur(o, AW, AH, r); return o; };
  const fw = new Float32Array(N), ch = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < N; i++) if (isF(i)) { fw[i] = 1; for (let k = 0; k < 3; k++) ch[k][i] = lin(sd[i * 4 + k]); mr += ch[0][i]; mg += ch[1][i]; mb += ch[2][i]; }
  mr /= nF; mg /= nF; mb /= nF;
  const R = Math.max(3, Math.round(AW * 0.05)), r = Math.max(3, Math.round(AW * 0.035));
  const bW = blur3(fw, R), bC = ch.map((x) => blur3(x, R)), sW = blur3(fw, r), sC = ch.map((x) => blur3(x, r));
  const FL = [new Float32Array(N), new Float32Array(N), new Float32Array(N)], light = new Uint8Array(N * 4);
  const enc = (v) => clamp(Math.round(Math.pow(Math.max(0, v), 1 / 2.2) * 255), 0, 255);
  for (let i = 0; i < N; i++) {
    const big = bW[i] > 0.02 ? [bC[0][i] / bW[i], bC[1][i] / bW[i], bC[2][i] / bW[i]] : [mr, mg, mb];
    const fine = sW[i] > 0.08 ? [sC[0][i] / sW[i], sC[1][i] / sW[i], sC[2][i] / sW[i]] : big;
    const lb = 0.2126 * big[0] + 0.7152 * big[1] + 0.0722 * big[2] + 1e-4, lf = 0.2126 * fine[0] + 0.7152 * fine[1] + 0.0722 * fine[2] + 1e-4;
    const k = clamp(lf / lb, 0.65, 1.3);
    for (let j = 0; j < 3; j++) { FL[j][i] = big[j] * k; light[i * 4 + j] = enc(FL[j][i]); }
    light[i * 4 + 3] = 255;
  }
  // mask at full resolution: the coarse floor class refined on the photo edges; below the horizon only; on a plain floor,
  // a pixel must also look like the floor light (thin chair and table legs stay in front)
  const p = new Float32Array(MW * MH), obj = new Float32Array(MW * MH);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = y * MW + x, gx = Math.min(AW - 1, (x / MW * AW) | 0), gy = Math.min(AH - 1, (y / MH * AH) | 0);
    p[i] = isF(gy * AW + gx) ? 1 : 0;
    const fx = clamp((x + 0.5) / MW * AW - 0.5, 0, AW - 1), fy = clamp((y + 0.5) / MH * AH - 0.5, 0, AH - 1), x0 = fx | 0, y0 = fy | 0, x1 = Math.min(AW - 1, x0 + 1), y1 = Math.min(AH - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    const at = (k) => (FL[k][y0 * AW + x0] * (1 - tx) + FL[k][y0 * AW + x1] * tx) * (1 - ty) + (FL[k][y1 * AW + x0] * (1 - tx) + FL[k][y1 * AW + x1] * tx) * ty;
    const rr = LUT[g[i * 4]], gg = LUT[g[i * 4 + 1]], bb = LUT[g[i * 4 + 2]], er = at(0), eg = at(1), eb = at(2);
    const lp = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb + 0.004, le = 0.2126 * er + 0.7152 * eg + 0.0722 * eb + 0.004;
    const ratio = lp / le, chroma = Math.abs(rr / lp - er / le) + Math.abs(gg / lp - eg / le) + Math.abs(bb / lp - eb / le);
    obj[i] = Math.max(sm(0.45, 0.25, ratio), sm(2.2, 2.9, ratio), sm(0.16, 0.34, chroma));
  }
  const qf = guided(lum, boxBlur(p, MW, MH, 1), MW, MH, Math.max(4, Math.round(MW / 128)), 2e-3), objS = boxBlur(obj, MW, MH, 1);
  // deep inside the floor the mask is solid: dark marks of the old floor must not dip it (the guided filter only shapes the edges)
  const pB = boxBlur(p, MW, MH, Math.max(3, Math.round(MW / 90)));
  for (let i = 0; i < MW * MH; i++) { const deep = sm(0.9, 0.995, pB[i]); qf[i] = Math.max(qf[i], 1.2 * deep); objS[i] *= 1 - deep; }
  let cnt = 0, o = 0; for (let i = 0; i < MW * MH; i += 7) if (p[i] > 0.5) { cnt++; if (obj[i] > 0.5) o++; }
  const useObj = cnt > 0 && o / cnt < 0.12, yLim = yhp * MW / W0;
  const mask = new Uint8Array(MW * MH * 4);
  for (let y = 0; y < MH; y++) {
    const hz = clamp((y - yLim) / (MH * 0.01), 0, 1);
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x, v = clamp(Math.round((qf[i] - 0.06) / 0.5 * (useObj ? 1 - objS[i] : 1) * hz * 255), 0, 255);
      mask[i * 4] = mask[i * 4 + 1] = mask[i * 4 + 2] = v; mask[i * 4 + 3] = 255;
    }
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  return { floor: { q: q.map((pt) => [Math.round(pt[0] * 10) / 10, Math.round(pt[1] * 10) / 10]), w: r2(u1 - u0), d: r2(v1 - v0), from: ks.length ? 'walls' : 'guess' }, mask, light, ref: [mr / 0.85, mg / 0.85, mb / 0.85] };
}

export function homography(q) {   // unit square -> quad, row-major 3x3
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, d, e, g = 0, h = 0;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x3 - x0; d = y1 - y0; e = y3 - y0; }
  else { const den = dx1 * dy2 - dx2 * dy1; g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; }
  return [a, b, x0, d, e, y0, g, h, 1];
}
