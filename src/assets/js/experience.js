// Wall studio: a slat built from its real profile in live 3D, then the chosen product laid piece by piece
// on the three walls of a real room photo (measured walls, the photo's own light, objects kept in front).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const E = window.EXP, T = E.t;
const $ = (s) => document.querySelector(s);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = () => innerWidth < 760;
const SIDE = E.rtl ? 1 : -1;   // the object sits opposite the text
const fmt = (n, d = 0) => Number(n).toLocaleString(E.lang === 'he' ? 'he-IL' : E.lang, { minimumFractionDigits: d, maximumFractionDigits: d });
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : ''));
const ITEMS = E.items, BYID = {}; for (const it of ITEMS) BYID[it.id] = it;

// ---------------------------------------------------------------- renderer + post chain (scene, MSAA HDR, bloom, ACES, room composite, grain)
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let maxDpr = mobile() ? 1.75 : 2;
renderer.setPixelRatio(Math.min(devicePixelRatio, maxDpr));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.01, 80);
// backdrop gradient; lifted (warmer, lighter) behind a dark slat so the black one never melts into the page
const bgCanvas = document.createElement('canvas'); bgCanvas.width = 64; bgCanvas.height = 512;
function paintBg(lift) {
  const g = bgCanvas.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
  const stops = lift ? ['#4a4136', '#2c261f', '#141210'] : ['#1d1913', '#15120e', '#0c0a08'];
  gr.addColorStop(0, stops[0]); gr.addColorStop(0.55, stops[1]); gr.addColorStop(1, stops[2]);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 512);
  if (scene.background) scene.background.needsUpdate = true;
}
paintBg(false);
scene.background = new THREE.CanvasTexture(bgCanvas); scene.background.colorSpace = THREE.SRGBColorSpace;
// a small photo studio baked into the environment: one off-axis softbox, two strips, a warm bounce
{
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(30, 16, 30), new THREE.MeshBasicMaterial({ color: 0x14110d, side: THREE.BackSide })));
  const panel = (w, h, k, p, col = 0xfff2df) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...p); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(7, 4.5, 5.5, [-7, 6, 6]); panel(0.9, 9, 3.2, [8, 1, 3]); panel(0.9, 9, 1.6, [-6, 1, -7], 0xe9eefc); panel(12, 2, 1.0, [0, -6, 7], 0xffd2a3);
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(s, 0.035).texture; pm.dispose();
  scene.environmentIntensity = 0.9;
}
const key = new THREE.DirectionalLight(0xfff0dc, 2.7);
key.position.set(-3.6 * SIDE, 3.0, 1.7);
key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 2.2, bottom: -2.2, near: 0.5, far: 14 });
key.shadow.bias = -0.0003; key.shadow.normalBias = 0.012; key.shadow.camera.updateProjectionMatrix();
scene.add(key);
const rim = new THREE.DirectionalLight(0xd6e2ff, 0.85); rim.position.set(3.2 * SIDE, 2.0, -2.6); scene.add(rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.42 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -1.451; floor.receiveShadow = true; scene.add(floor);

// ---------------------------------------------------------------- the slat, from its real profile (metres): 200 mm wide, 4 rounded ribs, hollow core
const SL = { W: 0.2, L: 2.9, base: 0.012, sag: 0.012, ribs: 4, wall: 0.0026 };
function slatGeometry() {
  const { W, L, base, sag, ribs } = SL, half = W / 2, rw = W / ribs;
  const R = ((rw / 2) ** 2 + sag ** 2) / (2 * sag), cy = base + sag - R, a0 = Math.atan2(base - cy, rw / 2);
  const pos = [], nor = [], uv = [], idx = [], groups = [];
  let start = 0;
  const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
  const vert = (x, y, z, nx, ny, nz, u, v) => { pos.push(x, y, z); nor.push(nx, ny, nz); uv.push(u, v); return pos.length / 3 - 1; };
  const y0 = -L / 2, y1 = L / 2, N = 30, front = [];
  for (let r = 0; r < ribs; r++) {
    const xc = -half + rw * (r + 0.5);
    for (let i = 0; i <= N; i++) {
      const a = Math.PI - a0 - (Math.PI - 2 * a0) * (i / N), x = xc + R * Math.cos(a), z = cy + R * Math.sin(a), u = (x + half) / W;
      const lo = vert(x, y0, z, Math.cos(a), 0, Math.sin(a), u, 0), hi = vert(x, y1, z, Math.cos(a), 0, Math.sin(a), u, 1);
      if (i > 0) quad(lo - 2, lo, hi, hi - 2);
      front.push([x, z]);
    }
  }
  for (const s of [-1, 1]) {
    const x = s * half, u = s < 0 ? 0.002 : 0.998;
    const a = vert(x, y0, 0, s, 0, 0, u, 0), b = vert(x, y0, base, s, 0, 0, u, 0), c = vert(x, y1, base, s, 0, 0, u, 1), d = vert(x, y1, 0, s, 0, 0, u, 1);
    if (s > 0) quad(a, d, c, b); else quad(a, b, c, d);
  }
  groups.push([start, idx.length - start, 0]); start = idx.length;
  { const a = vert(-half, y0, 0, 0, 0, -1, 0, 0), b = vert(half, y0, 0, 0, 0, -1, 1, 0), c = vert(half, y1, 0, 0, 0, -1, 1, 1), d = vert(-half, y1, 0, 0, 0, -1, 0, 1); quad(a, d, c, b); }
  const shape = new THREE.Shape();
  shape.moveTo(-half, 0); shape.lineTo(half, 0); shape.lineTo(half, base);
  for (let i = front.length - 1; i >= 0; i--) shape.lineTo(front[i][0], front[i][1]);
  shape.lineTo(-half, base); shape.closePath();
  const holes = [];
  for (let r = 0; r < ribs; r++) {
    const xc = -half + rw * (r + 0.5), hw = rw / 2 - 0.006, ri = R - SL.wall, zb = SL.wall;
    const pts = [[xc - hw, zb], [xc + hw, zb]], zs = cy + Math.sqrt(Math.max(0, ri * ri - hw * hw)), as = Math.atan2(zs - cy, hw);
    for (let i = 0; i <= 18; i++) { const a = as + (Math.PI - 2 * as) * (i / 18); pts.push([xc + ri * Math.cos(a), cy + ri * Math.sin(a)]); }
    const h = new THREE.Path(); h.moveTo(pts[0][0], pts[0][1]);
    for (let i = pts.length - 1; i >= 1; i--) h.lineTo(pts[i][0], pts[i][1]);
    h.closePath(); shape.holes.push(h); holes.push(pts);
  }
  const cap = new THREE.ShapeGeometry(shape, 1), cp = cap.attributes.position, ci = cap.index;
  for (const [y, ny] of [[y1, 1], [y0, -1]]) {
    const off = pos.length / 3;
    for (let i = 0; i < cp.count; i++) vert(cp.getX(i), y, cp.getY(i), 0, ny, 0, 0, 0);
    for (let i = 0; i < ci.count; i += 3) { const a = ci.getX(i) + off, b = ci.getX(i + 1) + off, c = ci.getX(i + 2) + off; if (ny > 0) idx.push(a, c, b); else idx.push(a, b, c); }
  }
  groups.push([start, idx.length - start, 1]); start = idx.length;
  for (const pts of holes) {
    const n = pts.length;
    for (const [ya, yb] of [[y1 - 0.06, y1], [y0, y0 + 0.06]]) {
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        quad(vert(p[0], ya, p[1], 0, 0, 1, 0, 0), vert(q[0], ya, q[1], 0, 0, 1, 0, 0), vert(q[0], yb, q[1], 0, 0, 1, 0, 0), vert(p[0], yb, p[1], 0, 0, 1, 0, 0));
      }
    }
  }
  groups.push([start, idx.length - start, 2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); for (const [s, c, m] of groups) g.addGroup(s, c, m);
  g.computeBoundingSphere(); return g;
}
const geo = slatGeometry();
const faceMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.52, clearcoat: 0.22, clearcoatRoughness: 0.38 });
const coreMat = new THREE.MeshStandardMaterial({ color: 0xc4b9a8, roughness: 0.86 });
const holeMat = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 1, side: THREE.DoubleSide });
const slats = [];
for (let i = -3; i <= 3; i++) {
  const m = new THREE.Mesh(geo, [faceMat, coreMat, holeMat]);
  m.castShadow = m.receiveShadow = true; m.position.x = i * 0.2002; m.visible = i === 0;
  scene.add(m); slats.push({ i, m, locked: true });
}
const hero = slats[3].m;

// ---------------------------------------------------------------- textures
const loader = new THREE.TextureLoader(), maxAniso = renderer.capabilities.getMaxAnisotropy();
const load = (url, srgb = true) => new Promise((res, rej) => loader.load(url, (t) => {
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, maxAniso); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; res(t);
}, undefined, rej));
const albedoCache = {}, faceCache = {}, faceTex = {};
function albedoOf(id) {
  if (!(id in albedoCache)) {
    const f = E.alb[id];
    albedoCache[id] = f ? load(E.assets + f).then((t) => { t.flipY = false; return t; }) : Promise.resolve(null);
  }
  return albedoCache[id];
}
function faceOf(id) { if (!faceCache[id]) faceCache[id] = load(E.img + 'face/' + id + '.jpg').then((t) => (faceTex[id] = t)); return faceCache[id]; }

// ---------------------------------------------------------------- the room of the scroll story: a real photo prepared like the editor's rooms
// (walls as quads = homographies, one mask channel per wall, light map). Pieces go up wall after wall, each one lifted off the wall
// (its plane moved towards the camera, from the wall pose) and slid down into place with its shadow.
let SR = null;   // the story room (data/experience.json > storyRoom), loaded at boot
const lay = { SW: 0.2, SL: 2.9, R: 1, total: 1, walls: 3, cum: [0, 1], weights: [1], per: [], area: 1 };
function wallPose(r, wl) {   // camera-space pose of a wall from its quad and the focal length
  const M = homFwd(wl.q), f = r.fpx, cx = r.W / 2, cy = r.H / 2;
  const kin = (x, y, z) => new THREE.Vector3((x - cx * z) / f, (y - cy * z) / f, z);
  const a1 = kin(M[0], M[3], M[6]), a2 = kin(M[1], M[4], M[7]), a3 = kin(M[2], M[5], M[8]);
  const lam = a2.length() / wl.h, n = new THREE.Vector3().crossVectors(a1, a2).normalize();
  if (n.dot(a3) > 0) n.negate();   // towards the camera
  return { a1, a2, a3, lam, n, f, cx, cy };
}
const liftM = new THREE.Matrix3();
function liftedInv(p, d) {   // photo px -> (s, t) on the wall plane moved d metres towards the camera
  const c = p.a3.clone().addScaledVector(p.n, p.lam * d), K = (v) => [p.f * v.x + p.cx * v.z, p.f * v.y + p.cy * v.z, v.z];
  const A = K(p.a1), B = K(p.a2), C = K(c);
  return liftM.set(A[0], B[0], C[0], A[1], B[1], C[1], A[2], B[2], C[2]).invert();
}
function quadPoint(wl, s, t) { const M = wl.M, z = M[6] * s + M[7] * t + M[8]; return [(M[0] * s + M[1] * t + M[2]) / z, (M[3] * s + M[4] * t + M[5]) / z]; }
function pieceVisible(r, wi, s0, ds, t0, dt) {   // share of a piece that is visible in the photo (hidden pieces go by faster)
  const wl = r.walls[wi], mk = r.mk; let v = 0;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 5; b++) {
    const [x, y] = quadPoint(wl, s0 + (a - 1) * ds * 0.3, clamp(t0 + (b - 2) * dt * 0.2, 0.01, 0.99));
    const ix = Math.floor(x / r.W * mk.w), iy = Math.floor(y / r.H * mk.h);
    if (ix >= 0 && iy >= 0 && ix < mk.w && iy < mk.h && mk.d[(iy * mk.w + ix) * 4 + wi] > 127) v++;
  }
  return v / 15;
}
function layout(it, walls) {
  const r = SR, SW = it.w / 100, SLn = it.h / 100, R = Math.max(1, Math.ceil(r.walls[0].h / SLn - 1e-6)), per = [], weights = [];
  let off = 0, area = 0;
  for (const wi of r.order) {
    const wl = r.walls[wi], on = walls === 3 || wi === r.order[0], cols = on ? Math.ceil(wl.w / SW - 1e-6) : 0;
    per[wi] = { off, cols };
    for (let k = 0; k < cols; k++) for (let row = 0; row < R; row++) weights.push(0.12 + 0.88 * pieceVisible(r, wi, (k + 0.5) * SW / wl.w, SW / wl.w, (row + 0.5) * SLn / wl.h, SLn / wl.h));
    off += cols; if (on) area += wl.w * wl.h;
  }
  const cum = [0]; for (const w of weights) cum.push(cum[cum.length - 1] + w);
  Object.assign(lay, { SW, SL: SLn, R, total: off * R, walls, cum, weights, per, area });
}
const countAt = (p) => {
  const x = p * lay.cum[lay.total]; let g = 0;
  while (g < lay.total && lay.cum[g + 1] < x) g++;
  return g >= lay.total ? lay.total : g + (x - lay.cum[g]) / lay.weights[g];
};
function pieceAt(g) {   // global piece index -> wall, column on that wall, row
  const col = Math.floor(g / lay.R), row = g - col * lay.R;
  for (const wi of SR.order) { const p = lay.per[wi]; if (col < p.off + p.cols) return { wi, k: col - p.off, row }; }
  return null;
}
function pieceImageX(g) { const p = pieceAt(g); if (!p) return 0.5; const wl = SR.walls[p.wi]; return quadPoint(wl, (p.k + 0.5) * lay.SW / wl.w, 0.45)[0] / SR.W; }

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const RoomShader = {
  uniforms: {
    tDiffuse: { value: null }, uPhoto: { value: null }, uMask: { value: null }, uClean: { value: null }, uFace: { value: null },
    uMix: { value: 0 }, uCount: { value: 0 }, uN: { value: 1 }, uGc: { value: 0 }, uR: { value: 1 },
    uWin: { value: new THREE.Vector4(0, 0, 1, 1) }, uRef: { value: new THREE.Vector3(1, 1, 1) }, uImg: { value: new THREE.Vector2(1, 1) }, uSzC: { value: new THREE.Vector2(1, 1) },
    uHas: { value: new THREE.Vector4() }, uCols: { value: new THREE.Vector4() }, uPiece: { value: new THREE.Vector4() }, uAnim: { value: new THREE.Vector4() },
    uH: { value: [0, 1, 2, 3].map(() => new THREE.Matrix3()) }, uHL: { value: new THREE.Matrix3() }, uSz: { value: [0, 1, 2, 3].map(() => new THREE.Vector2(1, 1)) }, uPc: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0.2, 2.9, 1, 0)) }
  },
  vertexShader: VS,
  fragmentShader: `
    uniform sampler2D tDiffuse, uPhoto, uMask, uClean, uFace;
    uniform float uMix, uCount, uN, uGc, uR;
    uniform vec4 uWin, uHas, uCols, uPiece, uAnim; uniform vec3 uRef; uniform vec2 uImg, uSzC;
    uniform mat3 uH[4], uHL; uniform vec2 uSz[4]; uniform vec4 uPc[4];
    varying vec2 vUv;
    float hash(float n){ return fract(sin(n * 12.9898 + 4.1) * 43758.5453); }
    vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    vec3 pieceTex(float g, float s, float t){
      if (hash(g + 3.7) > 0.5) t = 0.98 - t;
      if (uR < 1.5) t += (hash(g * 1.7 + 1.1) - 0.5) * 0.05;
      return texture2D(uFace, vec2(clamp(s, 0.004, 0.996), clamp(t, 0.002, 0.998))).rgb;
    }
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 puv = uWin.xy + vUv * uWin.zw;
      vec2 P = vec2(puv.x * uImg.x, (1.0 - puv.y) * uImg.y);
      vec3 photo = texture2D(uPhoto, puv).rgb, col = photo;
      vec4 m = texture2D(uMask, puv) * vec4(1.0, step(1.5, uN), step(2.5, uN), step(3.5, uN));
      float cov = max(max(m.r, m.g), max(m.b, m.a));
      if (cov > 0.002) {
        int w = 0; float best = m.r;
        if (m.g > best) { w = 1; best = m.g; }
        if (m.b > best) { w = 2; best = m.b; }
        if (m.a > best) { w = 3; best = m.a; }
        mat3 H = uH[0]; vec2 sz = uSz[0]; vec4 pc = uPc[0]; float has = uHas.x, cols = uCols.x;
        if (w == 1) { H = uH[1]; sz = uSz[1]; pc = uPc[1]; has = uHas.y; cols = uCols.y; }
        else if (w == 2) { H = uH[2]; sz = uSz[2]; pc = uPc[2]; has = uHas.z; cols = uCols.z; }
        else if (w == 3) { H = uH[3]; sz = uSz[3]; pc = uPc[3]; has = uHas.w; cols = uCols.w; }
        vec3 shade = texture2D(uClean, puv).rgb / uRef;
        vec3 q = H * vec3(P, 1.0); vec2 uv = q.xy / q.z * sz;
        float k = floor(uv.x / pc.x), s = fract(uv.x / pc.x), row = clamp(floor(uv.y / pc.y), 0.0, pc.z - 1.0);
        float g = (pc.w + clamp(k, 0.0, max(cols - 1.0, 0.0))) * pc.z + row;
        float placed = has * step(g + 1.0, uCount);
        vec3 wall = mix(photo, pieceTex(g, s, (uv.y - row * pc.y) / pc.y) * shade, placed);
        // the piece being laid: lifted off its wall, sliding down into place, with its shadow on the wall
        if (uAnim.z > 0.001) {
          float e = uAnim.y, a = uAnim.z, lift = uAnim.w;
          if (abs(float(w) - uAnim.x) < 0.5) {
            vec2 su = uv - vec2(0.5, -0.8) * (lift + 0.012); float b = 0.012 + lift * 0.22;
            float inS = (smoothstep(uPiece.x - b, uPiece.x + b, su.x) - smoothstep(uPiece.y - b, uPiece.y + b, su.x)) * (smoothstep(uPiece.z - b, uPiece.z + b, su.y) - smoothstep(uPiece.w - b, uPiece.w + b, su.y));
            wall *= 1.0 - inS * a * (0.5 - 0.25 * e);
          }
          vec3 ql = uHL * vec3(P, 1.0); vec2 ul = ql.xy / ql.z * uSzC;
          float aa = 0.003;
          float inX = smoothstep(uPiece.x - aa, uPiece.x + aa, ul.x) * (1.0 - smoothstep(uPiece.y - aa, uPiece.y + aa, ul.x));
          float inY = smoothstep(uPiece.z - aa, uPiece.z + aa, ul.y) * (1.0 - smoothstep(uPiece.w - aa, uPiece.w + aa, ul.y));
          vec3 lc = pieceTex(uGc, (ul.x - uPiece.x) / (uPiece.y - uPiece.x), (ul.y - uPiece.z) / (uPiece.w - uPiece.z)) * shade * (1.0 + 0.18 * e);
          wall = mix(wall, lc, inX * inY * a);
        }
        col = mix(photo, wall, cov);
      }
      gl_FragColor = vec4(mix(base.rgb, toSRGB(col), uMix), 1.0);
    }`
};
const GrainShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmt: { value: reduced ? 0.0 : 0.035 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: VS,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uAmt; uniform vec2 uRes; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb += (rnd(floor(vUv * uRes) + fract(uTime * 7.13) * 97.0) - 0.5) * uAmt;
      vec2 q = vUv - 0.5; c.rgb *= mix(0.8, 1.0, smoothstep(0.82, 0.22, length(q * vec2(1.0, 1.2))));
      gl_FragColor = c;
    }`
};
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(scene, camera);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.5, 0.92);
const outPass = new OutputPass(), roomPass = new ShaderPass(RoomShader), grainPass = new ShaderPass(GrainShader);
for (const p of [renderPass, bloom, outPass, roomPass, grainPass]) composer.addPass(p);
const RU = roomPass.uniforms;

// ---------------------------------------------------------------- scroll story: camera cues pinned to sections
const CUES = [
  { at: 0.00, t: [0, 0.12, 0], az: 28, po: 5, fh: 2.45, fw: 1.0, ox: -0.2, oy: 0, ex: 1, show: 0, rz: 0.27 },
  { at: 0.30, t: [0, 0.93, 0.014], az: 34, po: 8, fh: 0.36, fw: 0.46, ox: -0.17, oy: 0, ex: 1, show: 0, rz: 0 },
  { at: 0.55, t: [0, 1.43, 0.012], az: 22, po: 56, fh: 0.26, fw: 0.34, ox: -0.15, oy: 0, ex: 1, show: 0, rz: 0 },
  { at: 0.74, t: [0, 0.2, 0], az: 30, po: 9, fh: 3.7, fw: 2.9, ox: -0.13, oy: 0, ex: 1, show: 1, rz: 0 },
  { at: 1.00, t: [0, 0.0, 0], az: 0, po: 1.5, fh: 3.05, fw: 1.55, ox: 0, oy: 0, ex: 0, show: 1, rz: 0 }
];
const KEYS = ['az', 'po', 'fh', 'fw', 'ox', 'oy', 'ex', 'show', 'rz'];
function shotAt(q) {
  let i = 0; while (i < CUES.length - 2 && q > CUES[i + 1].at) i++;
  const a = CUES[i], b = CUES[i + 1], k = smooth(clamp((q - a.at) / (b.at - a.at)));
  const s = { t: a.t.map((v, j) => lerp(v, b.t[j], k)) };
  for (const key of KEYS) s[key] = lerp(a[key], b[key], k);
  s.ox *= SIDE; s.az *= SIDE; s.rz *= SIDE;
  if (mobile()) { const early = smooth(clamp((0.8 - q) / 0.1)); s.ox = 0; s.oy = lerp(0.04, 0.17, early); s.fh *= lerp(1.12, 1.5, early); s.fw *= 1.1; }
  return s;
}
let anchors = [], roomTop = 0, roomLen = 1;
function measure() {
  const vh = innerHeight; anchors = [];
  for (const el of document.querySelectorAll('[data-q]')) {
    const top = el.getBoundingClientRect().top + scrollY, h = el.offsetHeight;
    if (el.dataset.q2) { anchors.push([top - vh * 0.1, +el.dataset.q]); anchors.push([top + h - vh, +el.dataset.q2]); }
    else anchors.push([el.dataset.q === '0' ? 0 : top + h * 0.5 - vh * 0.5, +el.dataset.q]);
  }
  anchors.sort((a, b) => a[0] - b[0]);
  const room = $('#room'); roomTop = room.getBoundingClientRect().top + scrollY; roomLen = room.offsetHeight - vh;
}
function qAt(y) {
  if (y <= anchors[0][0]) return anchors[0][1];
  for (let i = 0; i < anchors.length - 1; i++) { const [y0, q0] = anchors[i], [y1, q1] = anchors[i + 1]; if (y <= y1) return lerp(q0, q1, clamp((y - y0) / Math.max(1, y1 - y0))); }
  return anchors[anchors.length - 1][1];
}
const state = { ex: 1, show: 0, rz: 0.27 * SIDE, t: new THREE.Vector3(), az: 28 * SIDE, po: 5, fh: 2.45, fw: 1, ox: -0.2 * SIDE, oy: 0, count: 0, pan: 0.5 };
let first = true;
const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
addEventListener('pointermove', (e) => { mouse.tx = e.clientX / innerWidth * 2 - 1; mouse.ty = e.clientY / innerHeight * 2 - 1; }, { passive: true });
function placeCamera(s) {
  const asp = innerWidth / innerHeight, tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const d = Math.max(s.fh / (2 * tanH), s.fw / (2 * tanH * asp));
  const az = THREE.MathUtils.degToRad(s.az + mouse.x * 5), po = THREE.MathUtils.degToRad(s.po - mouse.y * 3);
  camera.position.set(s.t.x + Math.sin(az) * Math.cos(po) * d, s.t.y + Math.sin(po) * d, s.t.z + Math.cos(az) * Math.cos(po) * d);
  camera.lookAt(s.t);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const visH = 2 * d * tanH;
  camera.position.addScaledVector(right, -s.ox * visH * asp).addScaledVector(up, -s.oy * visH);
  camera.updateMatrixWorld();
}

// ---------------------------------------------------------------- sound: synthesised taps, no audio files
let audio = null, soundOn = false;
function tap(gain = 0.5) {
  if (!soundOn || !audio) return;
  const t = audio.currentTime, len = 0.09, buf = audio.createBuffer(1, Math.ceil(audio.sampleRate * len), audio.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
  const src = audio.createBufferSource(); src.buffer = buf;
  const bp = audio.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900 + Math.random() * 500; bp.Q.value = 1.4;
  const g = audio.createGain(); g.gain.value = gain * 0.6;
  const o = audio.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
  const og = audio.createGain(); og.gain.setValueAtTime(gain * 0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  src.connect(bp).connect(g).connect(audio.destination); o.connect(og).connect(audio.destination);
  src.start(t); o.start(t); o.stop(t + 0.12);
}
$('#sound').addEventListener('click', (e) => {
  soundOn = !soundOn;
  if (soundOn && !audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio && audio.state === 'suspended') audio.resume();
  e.currentTarget.setAttribute('aria-pressed', String(soundOn));
  e.currentTarget.textContent = soundOn ? T.soundOn : T.soundOff;
  tap(0.6);
});

// ---------------------------------------------------------------- callouts: 3D points projected to the screen
const CALL = [
  { cue: 0, kind: 'dim', a: [0.16, -1.45, 0], b: [0.16, 1.45, 0], html: T.c290 },
  { cue: 1, kind: 'dim', a: [-0.1, 1.07, 0.03], b: [0.1, 1.07, 0.03], html: T.c20 },
  { cue: 1, kind: 'pt', a: [0.075, 0.86, 0.024], dy: 30, html: T.c4 },
  { cue: 2, kind: 'pt', a: [0.025, 1.45, 0.013], dy: -40, html: T.cHollow },
  { cue: 2, kind: 'pt', a: [-0.075, 1.45, 0.024], dy: 46, html: T.cRound }
];
const svgNS = 'http://www.w3.org/2000/svg';
for (const c of CALL) {
  c.el = document.createElement('div'); c.el.className = 'callout'; c.el.innerHTML = c.html; $('#labels').appendChild(c.el);
  c.g = document.createElementNS(svgNS, 'g'); $('#lines').appendChild(c.g);
  c.line = document.createElementNS(svgNS, 'path'); c.line.setAttribute('fill', 'none'); c.line.setAttribute('stroke', 'rgba(242,234,221,.7)'); c.line.setAttribute('stroke-width', '1'); c.g.appendChild(c.line);
  c.dot = document.createElementNS(svgNS, 'circle'); c.dot.setAttribute('r', '3.5'); c.dot.setAttribute('fill', '#cda56b'); c.g.appendChild(c.dot);
}
const v3 = new THREE.Vector3();
function project(p) { v3.set(p[0], p[1], p[2]).applyMatrix4(hero.matrixWorld).project(camera); return [(v3.x + 1) / 2 * innerWidth, (1 - v3.y) / 2 * innerHeight]; }
function drawCallouts(q, room) {
  for (const c of CALL) {
    const o = smooth(clamp(1 - Math.abs(q - CUES[c.cue].at) / 0.09)) * (room < 0.02 ? 1 : 0);
    c.el.style.opacity = o.toFixed(3); c.g.style.opacity = o.toFixed(3);
    if (o < 0.01) continue;
    const A = project(c.a), r = c.el.getBoundingClientRect();
    if (c.kind === 'dim') {
      const B = project(c.b), dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len * 7, ny = dx / len * 7;
      c.line.setAttribute('d', `M${A[0] + nx} ${A[1] + ny}L${A[0] - nx} ${A[1] - ny}M${A[0]} ${A[1]}L${B[0]} ${B[1]}M${B[0] + nx} ${B[1] + ny}L${B[0] - nx} ${B[1] - ny}`);
      c.dot.setAttribute('r', '0');
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, vertical = Math.abs(dy) > Math.abs(dx);
      const lx = vertical ? (SIDE > 0 ? mx + 14 : mx - 14 - r.width) : mx - r.width / 2;
      c.el.style.transform = `translate(${lx.toFixed(1)}px, ${(vertical ? my - r.height / 2 : my - r.height - 12).toFixed(1)}px)`;
    } else {
      const gap = mobile() ? 70 : 150, ly = A[1] + c.dy;
      const x0 = clamp(SIDE > 0 ? A[0] - gap - r.width : A[0] + gap, 12, innerWidth - r.width - 12);
      c.el.style.transform = `translate(${x0.toFixed(1)}px, ${(ly - r.height / 2).toFixed(1)}px)`;
      const ex = SIDE > 0 ? x0 + r.width : x0;
      c.line.setAttribute('d', `M${ex} ${ly}L${ex + (A[0] - ex) * 0.6} ${ly}L${A[0]} ${A[1]}`);
      c.dot.setAttribute('cx', A[0]); c.dot.setAttribute('cy', A[1]); c.dot.setAttribute('r', '3.5');
    }
  }
}

// ---------------------------------------------------------------- product choice
const params = new URLSearchParams(location.search);
const byRef = (ref) => { ref = (ref || '').trim(); return ref ? ITEMS.find((it) => it.r === ref) || ITEMS.find((it) => it.r.startsWith(ref + ' ')) || ITEMS.find((it) => it.r.includes(ref)) : null; };
let cur = BYID[params.get('m')] || byRef(params.get('ref')) || BYID[E.start] || BYID[E.story];   // ?m=<image id> or ?ref=108, else data/experience.json
let walls = 3;
const swatchHTML = () => E.quick.map((m) => `<button type="button" class="sw" data-id="${m.id}" aria-pressed="${m.id === cur.id}" style="--c:${m.c}"><i></i>${m.n}</button>`).join('');
$('#asmSwatches').innerHTML = swatchHTML();
$('#dots').innerHTML = E.quick.map((m) => `<button type="button" class="dot" data-id="${m.id}" aria-pressed="${m.id === cur.id}" style="--c:${m.c}" title="${m.n}" aria-label="${m.n}"></button>`).join('');
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (b && BYID[b.dataset.id]) { if (ED.open) edApply(BYID[b.dataset.id]); else choose(BYID[b.dataset.id]); if (b.classList.contains('pick')) closeSheet(); }
});
for (const b of document.querySelectorAll('[data-walls]')) b.addEventListener('click', () => {
  walls = +b.dataset.walls;
  for (const x of document.querySelectorAll('[data-walls]')) x.setAttribute('aria-pressed', String(x === b));
  applyLayout();
});
const priceText = (it) => (it.p != null ? fmt(it.p) + ' ₪' : T.onRequest);
function applyLayout() {
  if (!SR) return;
  layout(cur, walls);
  const has = [0, 0, 0, 0], cols = [0, 0, 0, 0];
  SR.walls.forEach((wl, i) => { const p = lay.per[i]; cols[i] = p.cols; has[i] = p.cols > 0 ? 1 : 0; RU.uPc.value[i].set(lay.SW, lay.SL, lay.R, p.off); });
  RU.uHas.value.set(...has); RU.uCols.value.set(...cols); RU.uR.value = lay.R;
  lastCount = -1;
}
let threeId = E.alb[cur.id] !== undefined ? cur.id : E.story;
async function choose(it) {
  cur = it;
  for (const b of document.querySelectorAll('.sw, .dot, .pick')) b.setAttribute('aria-pressed', String(b.dataset.id === it.id));
  $('#curImg').src = it.th; $('#curName').textContent = it.n; $('#curPrice').textContent = priceText(it);
  $('#siteLink').href = it.u;
  applyLayout(); updateLinks();
  const face = await faceOf(it.id);
  if (cur !== it) return;
  RU.uFace.value = face;
  if (E.alb[it.id] !== undefined && threeId !== it.id) {
    threeId = it.id;
    const alb = await albedoOf(it.id);
    if (threeId !== it.id) return;
    faceMat.map = alb; faceMat.color.set(E.plain[it.id] || 0xffffff); faceMat.roughness = E.plain[it.id] ? 0.6 : 0.52; faceMat.needsUpdate = true;
    storyLook(it.id);
  }
  if (params.get('m') !== it.id && (params.has('m') || it.id !== (E.start || E.story)) && history.replaceState) { params.set('m', it.id); history.replaceState(null, '', location.pathname + '?' + params.toString() + location.hash); }
  tap(0.4);
}
// the 3D story follows the slat shown in 3D: its reference, colour and price in the hero, and a brighter studio for a dark slat
const eye = $('#heroEye'), eyeParts = eye ? eye.textContent.split(' · ') : [];
function storyLook(id) {
  const q = E.quick.find((m) => m.id === id), it = BYID[id];
  if (!q) return;
  if (eye && eyeParts.length === 3 && it) eye.textContent = [eyeParts[0], String(it.r).split(' ')[0], q.n].join(' · ');
  if (it && it.p != null) $('#heroPrice').textContent = fmt(it.p) + ' ₪';
  const h = parseInt(q.c.slice(1), 16), lum = (0.299 * (h >> 16) + 0.587 * ((h >> 8) & 255) + 0.114 * (h & 255)) / 255;
  const dark = lum < 0.3;
  paintBg(dark);
  key.intensity = dark ? 3.4 : 2.7; rim.intensity = dark ? 2.6 : 0.85; scene.environmentIntensity = dark ? 1.6 : 0.9;
  faceMat.clearcoat = dark ? 0.45 : 0.22;
}
function updateLinks() {
  const href = 'https://wa.me/' + E.wa + '?text=' + encodeURIComponent(fill(T.msg, { n: cur.n, r: cur.r }));
  $('#waCta').href = href; $('#waTop').href = href;
}
// picker sheet: every wall product that has a true-scale face
const sheet = $('#sheet');
let tab = cur.c;
function renderTabs() {
  const pid = ED.open ? edPressedId() : cur.id;
  $('#tabs').innerHTML = E.cats.map((c) => `<button type="button" data-tab="${c.c}" aria-pressed="${c.c === tab}">${c.n}</button>`).join('');
  $('#grid').innerHTML = ITEMS.filter((it) => it.c === tab).map((it) => `<button type="button" class="pick" data-id="${it.id}" aria-pressed="${it.id === pid}"><img src="${it.th}" alt="" loading="lazy" width="130" height="163"><b>${it.n}</b><small>${priceText(it)}</small></button>`).join('');
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; renderTabs(); } });
let lastFocus = null;
function openSheet() { lastFocus = document.activeElement; tab = (ED.open && edPressedItem() || cur).c; renderTabs(); sheet.hidden = false; $('#sheetClose').focus(); }
function closeSheet() { sheet.hidden = true; if (lastFocus) lastFocus.focus(); }
$('#cur').addEventListener('click', openSheet); $('#moreBtn').addEventListener('click', openSheet);
$('#sheetClose').addEventListener('click', closeSheet);
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (!sheet.hidden) closeSheet(); else if (ED.open) edClose(); });

// ---------------------------------------------------------------- wall by wall: each wall of the photo is a tap target with its own product
// A room = photo + wall mask (one channel per wall, RGBA) + clean wall light + per wall a quad (floor start, floor end, top end, top start)
// in photo pixels and its real size in metres. The quad gives a homography, so any product is tiled at true scale in perspective.
function homFwd(q) {   // unit square (s along the wall, t up) -> quad (floor start, floor end, top end, top start), row-major
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, d, e, g = 0, h = 0;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x3 - x0; d = y1 - y0; e = y3 - y0; }
  else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3;
  }
  return [a, b, x0, d, e, y0, g, h, 1];
}
const homInv = (q) => new THREE.Matrix3().set(...homFwd(q)).invert();   // photo px -> (s, t)
function aspectOf(q, fpx, W, H) {   // width / height of the real rectangle behind a quad, for a camera of focal fpx (Zhang)
  const M = homFwd(q), k = (x, y, z) => Math.hypot((x - W / 2 * z) / fpx, (y - H / 2 * z) / fpx, z);
  return k(M[0], M[3], M[6]) / k(M[1], M[4], M[7]);
}
function maskSmall(src) {   // small top-down RGBA copy of a wall mask (image, or raw {data, width, height})
  const w = 480, h = Math.max(1, Math.round(480 * src.height / src.width));
  let d;
  if (src.data) {
    d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = Math.min(src.width - 1, Math.floor((x + 0.5) / w * src.width)), sy = Math.min(src.height - 1, Math.floor((y + 0.5) / h * src.height)), o = (sy * src.width + sx) * 4, t = (y * w + x) * 4; for (let c = 0; c < 4; c++) d[t + c] = src.data[o + c]; }
  } else {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, w, h); d = g.getImageData(0, 0, w, h).data;
  }
  return { w, h, d };
}
function anchorsOf(mk, n) {   // one label anchor per wall: the inner wall point closest to the (raised) centroid
  const { w, h, d } = mk, r = 5, out = [];
  for (let i = 0; i < n; i++) {
    const S = new Float32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += d[(y * w + x) * 4 + i] > 127 ? 1 : 0; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; } }
    const full = (2 * r + 1) ** 2 * 0.97, pts = []; let sx = 0, sy = 0;
    for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) {
      const s = S[(y + r + 1) * (w + 1) + x + r + 1] - S[(y - r) * (w + 1) + x + r + 1] - S[(y + r + 1) * (w + 1) + x - r] + S[(y - r) * (w + 1) + x - r];
      if (s >= full) { pts.push(x, y); sx += x; sy += y; }
    }
    if (!pts.length) { out.push(null); continue; }
    const cx = sx / (pts.length / 2), cy = sy / (pts.length / 2) * 0.85; let bi = 0, bd = Infinity;
    for (let j = 0; j < pts.length; j += 2) { const dd = (pts[j] - cx) ** 2 + (pts[j + 1] - cy) ** 2; if (dd < bd) { bd = dd; bi = j; } }
    out.push([(pts[bi] + 0.5) / w, (pts[bi + 1] + 0.5) / h]);
  }
  return out;
}
function makeRoom(o) {
  const mk = o.mk || maskSmall(o.mask.image), an = anchorsOf(mk, o.walls.length);
  o.walls.forEach((wl, i) => { wl.Hinv = homInv(wl.q); wl.item = wl.item || null; wl.anchor = an[i] ? [an[i][0] * o.W, an[i][1] * o.H] : null; if (wl.ord == null) wl.ord = i; });
  o.mk = mk;
  return o;
}
const wallNames = (n) => (n === 1 ? [T.wallBack] : n === 2 ? [T.wallLeft, T.wallRight] : n === 3 ? [T.wallLeft, T.wallBack, T.wallRight] : [...Array(n)].map((_, i) => fill(T.wallN, { n: i + 1 })));
// real rooms prepared offline with the same detector (assets/exp/rooms/<id>/): photo.jpg, mask.png (walls in R, G, B), light.png, room.json
async function preparedRoom(id) {
  const base = E.assets + 'rooms/' + id + '/';
  const [meta, photo, mask, clean] = await Promise.all([fetch(base + 'room.json').then((r) => r.json()), load(base + 'photo.jpg'), load(base + 'mask.png', false), load(base + 'light.png')]);
  for (const t of [photo, mask, clean]) { t.anisotropy = 1; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  const names = wallNames(meta.walls.length);
  return makeRoom({ id, photo, mask, clean, ref: new THREE.Vector3(...meta.ref), W: meta.W, H: meta.H, fpx: meta.fpx, walls: meta.walls.map((w, i) => ({ name: names[i], w: w.w, h: w.h, q: w.q })) });
}
// a visitor's photo: analysed in the browser by experience-detect.js
function flipRows(src, w, h) { const out = new Uint8Array(w * h * 4), row = w * 4; for (let y = 0; y < h; y++) out.set(src.subarray((h - 1 - y) * row, (h - y) * row), y * row); return out; }
function dataTex(data, w, h, srgb) {
  const t = new THREE.DataTexture(flipRows(data, w, h), w, h, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}
function photoRoom(img, r) {
  const sc = Math.min(1, 2048 / Math.max(r.W, r.H)), cv = document.createElement('canvas');
  cv.width = Math.round(r.W * sc); cv.height = Math.round(r.H * sc); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  const photo = new THREE.CanvasTexture(cv); photo.colorSpace = THREE.SRGBColorSpace; photo.generateMipmaps = false; photo.minFilter = THREE.LinearFilter;
  const names = wallNames(r.walls.length);
  return makeRoom({
    id: 'mine', photo, mask: dataTex(r.mask, r.MW, r.MH, false), clean: dataTex(r.light, r.AW, r.AH, true), ref: new THREE.Vector3(...r.ref), W: r.W, H: r.H, fpx: r.fpx,
    mk: maskSmall({ data: r.mask, width: r.MW, height: r.MH }), thumb: cv.toDataURL('image/jpeg', 0.6),
    walls: r.walls.map((w, i) => ({ name: names[i], w: w.w, h: w.h, q: w.q }))
  });
}

const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); blank.needsUpdate = true;
const gold = new THREE.Color('#cda56b');
const EditShader = {
  uniforms: {
    uPhoto: { value: null }, uMask: { value: null }, uClean: { value: null },
    uF0: { value: blank }, uF1: { value: blank }, uF2: { value: blank }, uF3: { value: blank },
    uWin: { value: new THREE.Vector4(0, 0, 1, 1) }, uRef: { value: new THREE.Vector3(1, 1, 1) }, uImg: { value: new THREE.Vector2(1, 1) }, uPx: { value: new THREE.Vector2(0.001, 0.001) },
    uH: { value: [0, 1, 2, 3].map(() => new THREE.Matrix3()) }, uSz: { value: [0, 1, 2, 3].map(() => new THREE.Vector2(1, 1)) }, uPc: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0.2, 2.9, 1, 0)) },
    uHas: { value: new THREE.Vector4() }, uSel: { value: new THREE.Vector4() }, uN: { value: 3 }, uTime: { value: 0 }, uScan: { value: -1 }, uFocus: { value: 0 },
    uGold: { value: new THREE.Vector3(gold.r, gold.g, gold.b) }
  },
  vertexShader: VS,
  fragmentShader: `
    uniform sampler2D uPhoto, uMask, uClean, uF0, uF1, uF2, uF3;
    uniform vec4 uWin, uHas, uSel; uniform vec3 uRef, uGold; uniform vec2 uImg, uPx;
    uniform mat3 uH[4]; uniform vec2 uSz[4]; uniform vec4 uPc[4];
    uniform float uN, uTime, uScan, uFocus;
    varying vec2 vUv;
    float hash(float n){ return fract(sin(n * 12.9898 + 4.1) * 43758.5453); }
    vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    vec4 maskAt(vec2 p){ return texture2D(uMask, p) * vec4(1.0, step(1.5, uN), step(2.5, uN), step(3.5, uN)); }
    void main(){
      vec2 puv = uWin.xy + vUv * uWin.zw;
      if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) { gl_FragColor = vec4(0.063, 0.055, 0.043, 1.0); return; }
      vec2 P = vec2(puv.x * uImg.x, (1.0 - puv.y) * uImg.y);
      vec3 photo = texture2D(uPhoto, puv).rgb, col = photo;
      vec4 m = maskAt(puv);
      float cov = max(max(m.r, m.g), max(m.b, m.a));
      int w = 0; float best = m.r;
      if (m.g > best) { w = 1; best = m.g; }
      if (m.b > best) { w = 2; best = m.b; }
      if (m.a > best) { w = 3; best = m.a; }
      mat3 H = uH[0]; vec2 sz = uSz[0]; vec4 pc = uPc[0]; float has = uHas.x;
      if (w == 1) { H = uH[1]; sz = uSz[1]; pc = uPc[1]; has = uHas.y; }
      else if (w == 2) { H = uH[2]; sz = uSz[2]; pc = uPc[2]; has = uHas.z; }
      else if (w == 3) { H = uH[3]; sz = uSz[3]; pc = uPc[3]; has = uHas.w; }
      if (cov > 0.002 && has > 0.5) {
        vec3 q = H * vec3(P, 1.0); vec2 uv = q.xy / q.z * sz;
        float k = floor(uv.x / pc.x), s = fract(uv.x / pc.x);
        float row = clamp(floor(uv.y / pc.y), 0.0, pc.z - 1.0);
        float g = (pc.w + k) * pc.z + row, t = (uv.y - row * pc.y) / pc.y;
        if (hash(g + 3.7) > 0.5) t = 0.98 - t;
        if (pc.z < 1.5) t += (hash(g * 1.7 + 1.1) - 0.5) * 0.05;
        vec2 st = vec2(clamp(s, 0.004, 0.996), clamp(t, 0.002, 0.998));
        vec3 tex;
        if (w == 0) tex = texture2D(uF0, st).rgb; else if (w == 1) tex = texture2D(uF1, st).rgb; else if (w == 2) tex = texture2D(uF2, st).rgb; else tex = texture2D(uF3, st).rgb;
        col = mix(photo, tex * texture2D(uClean, puv).rgb / uRef, cov);
      }
      // focus: what is not selected steps back, the selected walls breathe and get a gold edge traced from the mask
      vec4 ax = maskAt(puv + vec2(uPx.x, 0.0)) - maskAt(puv - vec2(uPx.x, 0.0)), ay = maskAt(puv + vec2(0.0, uPx.y)) - maskAt(puv - vec2(0.0, uPx.y));
      float sc = dot(m, uSel), anySel = step(0.5, dot(uSel, vec4(1.0))) * uFocus;
      col *= mix(1.0, mix(0.58, 1.0, sc), anySel);
      col += uGold * 0.06 * sc * anySel * (0.55 + 0.45 * sin(uTime * 2.8));
      float es = length(vec2(dot(ax, uSel), dot(ay, uSel)));
      col = mix(col, uGold * 1.2, smoothstep(0.15, 0.55, es) * anySel);
      // detection sweep when the editor opens: every wall edge lights up as the line passes
      float band = exp(-pow((puv.x - uScan) * 7.0, 2.0));
      float ea = max(max(length(vec2(ax.r, ay.r)), length(vec2(ax.g, ay.g))), max(length(vec2(ax.b, ay.b)), length(vec2(ax.a, ay.a))));
      col = mix(col, uGold * 1.3, smoothstep(0.15, 0.55, ea) * band);
      col += uGold * 0.16 * cov * band;
      gl_FragColor = vec4(toSRGB(col), 1.0);
    }`
};
const editPass = new ShaderPass(EditShader); editPass.enabled = false;
composer.insertPass(editPass, composer.passes.indexOf(grainPass));
const EU = editPass.uniforms;

const ED = { open: false, room: null, def: null, fix: -1, zoom: 1, zoomGoal: 1, rooms: {}, sel: new Set(), applied: false, dirty: false, c: [0, 0], sc: 1, win: new THREE.Vector4(), goal: new THREE.Vector4(), scan: 2, recent: [], dragging: false, boot: false };
const edEl = $('#ed'), edStage = $('#edStage'), edPinsEl = $('#edPins'), edPanel = $('#edPanel');
const piecesOf = (wl, it) => Math.ceil(wl.w / (it.w / 100) - 1e-6) * Math.max(1, Math.ceil(wl.h / (it.h / 100) - 1e-6));
function edPressedItem() {
  const r = ED.room; if (!r || !ED.sel.size) return null;
  const ids = [...ED.sel].map((i) => (r.walls[i].item ? r.walls[i].item.id : ''));
  return ids.every((x) => x && x === ids[0]) ? BYID[ids[0]] : null;
}
function edPressedId() { const it = edPressedItem(); return it ? it.id : ''; }
function edUniforms() {
  const r = ED.room, order = r.walls.map((_, i) => i).sort((a, b) => r.walls[a].ord - r.walls[b].ord), offs = [];
  let off = 0;
  for (const i of order) { offs[i] = off; const it = r.walls[i].item; if (it) off += Math.ceil(r.walls[i].w / (it.w / 100) - 1e-6); }
  const has = [0, 0, 0, 0], sel = [0, 0, 0, 0];
  r.walls.forEach((wl, i) => {
    const it = wl.item, SW = it ? it.w / 100 : 1, SLn = it ? it.h / 100 : 1;
    EU.uH.value[i].copy(wl.Hinv); EU.uSz.value[i].set(wl.w, wl.h);
    EU.uPc.value[i].set(SW, SLn, Math.max(1, Math.ceil(wl.h / SLn - 1e-6)), offs[i]);
    const tx = it && faceTex[it.id];
    EU['uF' + i].value = tx || blank; has[i] = tx ? 1 : 0; sel[i] = ED.sel.has(i) ? 1 : 0;
  });
  EU.uHas.value.set(...has); EU.uSel.value.set(...sel); EU.uN.value = r.walls.length;
  EU.uPhoto.value = r.photo; EU.uMask.value = r.mask; EU.uClean.value = r.clean; EU.uRef.value.copy(r.ref); EU.uImg.value.set(r.W, r.H);
}
const thumb = (it) => (it ? ` style="--c:url('${it.th}')"` : '');
function edUI() {
  const r = ED.room, all = ED.sel.size === r.walls.length;
  edPinsEl.innerHTML = r.walls.map((wl, i) => (wl.anchor ? `<button type="button" class="pin${ED.touched ? '' : ' ping'}" data-wall="${i}" aria-pressed="${ED.sel.has(i)}"><i${thumb(wl.item)}>${wl.item ? '' : '+'}</i>${wl.name}</button>` : '')).join('');
  $('#edWalls').innerHTML = `<button type="button" class="chip plain" data-wall="all" aria-pressed="${all}">${T.edAll}</button>` +
    r.walls.map((wl, i) => `<button type="button" class="chip" data-wall="${i}" aria-pressed="${ED.sel.has(i)}"><i${thumb(wl.item)}>${wl.item ? '' : '+'}</i>${wl.name}</button>`).join('');
  const pid = edPressedId(), quick = E.quick.map((q) => BYID[q.id]).filter(Boolean), list = [...quick, ...ED.recent.filter((it) => !quick.includes(it))];
  $('#edMats').innerHTML = list.map((it) => {
    const q = E.quick.find((x) => x.id === it.id);
    return `<button type="button" class="sw" data-id="${it.id}" aria-pressed="${it.id === pid}"><i style="${q ? '--c:' + q.c : `background:url('${it.th}') center/cover`}"></i>${q ? q.n : it.n.split(',')[0]}</button>`;
  }).join('') + `<button type="button" class="chip plain" data-ed-more>${T.allModels}</button><button type="button" class="chip plain" data-ed-none aria-pressed="${ED.sel.size > 0 && [...ED.sel].every((i) => !r.walls[i].item)}">${T.edNone}</button>`;
  const hint = $('#edHint');
  const one = ED.sel.size === 1 ? r.walls[[...ED.sel][0]] : null, dims = one ? ' · ' + fill(T.edDims, { w: fmt(one.w, 1), h: fmt(one.h, 2) }) : '';
  hint.textContent = ED.fix >= 0 ? T.edFixHint + dims : ED.sel.size ? fill(T.edPick, { w: [...ED.sel].sort().map((i) => r.walls[i].name).join(', ') }) + dims : T.edHint;
  $('#edFixBtn').hidden = !one || ED.fix >= 0;
  $('#edFixBar').hidden = ED.fix < 0;
  edPanel.classList.toggle('fixing', ED.fix >= 0);
  $('#edH').textContent = fmt(r.walls[0].h, 2) + ' ' + (T.edDims.split('{h}')[1] || 'm').trim();
  hint.classList.toggle('wait', ED.sel.size > 0 && !ED.applied);
  // total, size and the WhatsApp message with one line per wall
  let total = 0, pieces = 0, area = 0, req = false, slatsOnly = true;
  const lines = [];
  for (const wl of r.walls) {
    const it = wl.item; if (!it) continue;
    const n = piecesOf(wl, it), u = it.k === 'slats' ? T.unitsSlat : T.units;
    pieces += n; area += wl.w * wl.h; if (it.k !== 'slats') slatsOnly = false;
    if (it.p != null) total += n * it.p; else req = true;
    lines.push(fill(T.edLine, { w: wl.name, n: it.n, r: it.r, q: fmt(n), u }));
  }
  $('#edTotal').textContent = lines.length ? (total ? fmt(total) + ' ₪' : T.onRequest) : '–';
  $('#edMeta').textContent = lines.length ? fill(T.edMeta, { q: fmt(pieces), u: slatsOnly ? T.unitsSlat : T.units, a: fmt(area, 1) }) + (req && total ? ' ' + T.edReq : '') : '';
  const msg = [T.edMsg, ...lines, total ? fill(T.edMsgTotal, { t: fmt(total) + ' ₪' }) : ''].filter(Boolean).join('\n');
  $('#edWa').href = 'https://wa.me/' + E.wa + '?text=' + encodeURIComponent(msg);
}
let toastT = 0;
function toast(s) { const el = $('#edToast'); el.textContent = s; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 1800); }
// view: the photo covers the stage (the screen above the panel on a phone, beside it on a wide screen); drag pans it
function edView() {
  const W = innerWidth, H = innerHeight, r = ED.room, p = edPanel.getBoundingClientRect();
  let sx0 = 0, sw = W, sh = H;
  if (W >= 900) { if (p.left > W / 2) sw = p.left - 12; else { sx0 = p.right + 12; sw = W - sx0; } }
  else sh = Math.max(120, p.top);
  const cover = Math.max(sw / r.W, sh / r.H), sc = cover * ED.zoom, hw = sw / 2 / sc, hh = sh / 2 / sc;
  ED.cover = cover;
  if (ED.fix < 0) {
    ED.c[0] = r.W > 2 * hw ? clamp(ED.c[0], hw, r.W - hw) : r.W / 2;
    ED.c[1] = r.H > 2 * hh ? clamp(ED.c[1], hh, r.H - hh) : r.H / 2;
  }
  const scx = sx0 + sw / 2, scy = sh / 2;
  ED.sc = sc; ED.stage = { sx0, sw, sh };
  ED.goal.set((ED.c[0] - scx / sc) / r.W, 1 - (ED.c[1] + (H - scy) / sc) / r.H, W / (sc * r.W), H / (sc * r.H));
}
function toPhoto(X, Y) { const r = ED.room, w = ED.win; return [(w.x + X / innerWidth * w.z) * r.W, (1 - (w.y + (1 - Y / innerHeight) * w.w)) * r.H]; }
function toScreen(px, py) { const r = ED.room, w = ED.win; return [(px / r.W - w.x) / w.z * innerWidth, (1 - (1 - py / r.H - w.y) / w.w) * innerHeight]; }
function wallAt(px, py) {
  const r = ED.room, mk = r.mk, x = Math.floor(px / r.W * mk.w);
  if (x < 0 || x >= mk.w) return -1;
  // a tap on furniture standing against a wall picks that wall: look straight up for the first wall pixel
  for (let y = Math.floor(py / r.H * mk.h), stop = y - mk.h * 0.35; y >= 0 && y >= stop; y--) {
    if (y >= mk.h) continue;
    let best = -1, bv = 110;
    for (let i = 0; i < r.walls.length; i++) { const v = mk.d[(y * mk.w + x) * 4 + i]; if (v > bv) { bv = v; best = i; } }
    if (best >= 0) return best;
  }
  return -1;
}
function edFocusWall(i) {
  const a = ED.room.walls[i].anchor; if (!a) return;
  const [X] = toScreen(a[0], a[1]), s = ED.stage;
  if (X < s.sx0 + 60 || X > s.sx0 + s.sw - 60) ED.c[0] = a[0];
}
function edSelect(i) {
  const r = ED.room;
  if (i === 'all') { ED.sel = ED.sel.size === r.walls.length ? new Set() : new Set(r.walls.map((_, k) => k)); ED.applied = false; }
  else if (i < 0) ED.sel.clear();
  else if (ED.applied) { ED.sel = new Set([i]); ED.applied = false; }
  else if (ED.sel.has(i)) ED.sel.delete(i);
  else ED.sel.add(i);
  ED.touched = true; tap(0.3);
  edUniforms(); edUI();
  if (typeof i === 'number' && i >= 0 && ED.sel.has(i)) edFocusWall(i);
}
async function edApply(it) {
  const r = ED.room; let targets = [...ED.sel];
  if (!targets.length) { targets = r.walls.map((_, i) => i); toast(T.edAllApplied); }
  for (const i of targets) r.walls[i].item = it;
  if (it && !E.quick.some((q) => q.id === it.id)) ED.recent = [it, ...ED.recent.filter((x) => x.id !== it.id)].slice(0, 4);
  ED.applied = true; ED.dirty = true; ED.touched = true; tap(0.45);
  edUniforms(); edUI();
  if (it && !faceTex[it.id]) { try { await faceOf(it.id); } catch (e) { /* keep the photo */ } if (ED.open) edUniforms(); }
}
function edOpen(push = true) {
  if (ED.open || !ED.def) return;
  if (!ED.room) ED.room = ED.def;
  if (ED.room === ED.def && !ED.dirty) ED.def.walls.forEach((wl, i) => { wl.item = walls === 3 || i === ED.def.order[0] ? cur : null; });
  for (const wl of ED.room.walls) if (wl.item) faceOf(wl.item.id).then(() => ED.open && edUniforms()).catch(() => {});
  const fromStory = roomPass.enabled && RU.uMix.value > 0.5;
  ED.open = true; edEl.hidden = false; document.documentElement.classList.add('ed-on');
  ED.sel = new Set(); ED.applied = false; ED.t0 = clock.elapsedTime;
  if (!ED.c[0]) ED.c = [ED.room.W / 2, ED.room.H / 2];
  edUniforms(); edUI(); edView();
  ED.win.copy(fromStory ? RU.uWin.value : ED.goal);
  renderPass.enabled = bloom.enabled = outPass.enabled = roomPass.enabled = false; editPass.enabled = true;
  if (push && history.pushState) history.pushState({ ed: 1 }, '', location.pathname + location.search + '#walls');
  $('#edBack').focus({ preventScroll: true });
}
function edClose(fromPop) {
  if (!ED.open) return;
  if (!fromPop && history.state && history.state.ed) { history.back(); return; }
  if (ED.fix >= 0) fixEnd();
  roomsOpen(false); busy(null);
  ED.open = false; edEl.hidden = true; editPass.enabled = false; document.documentElement.classList.remove('ed-on');
  if (!sheet.hidden) closeSheet();
  if (location.hash === '#walls' && history.replaceState) history.replaceState(null, '', location.pathname + location.search + '#room');
  if (ED.boot) { ED.boot = false; measure(); scrollTo(0, roomTop + roomLen * 0.97); }
}
addEventListener('popstate', () => { if (ED.open) edClose(true); });
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-ed-open]')) { edOpen(); return; }
  if (e.target.closest('[data-ed-photo]')) { if (!ED.def) return; edOpen(); document.getElementById('edFile').click(); return; }   // straight to the photo picker (same tap)
  if (!ED.open) return;
  const w = e.target.closest('[data-wall]');
  if (w) { edSelect(w.dataset.wall === 'all' ? 'all' : +w.dataset.wall); return; }
  if (e.target.closest('[data-ed-none]')) { edApply(null); return; }
  if (e.target.closest('[data-ed-more]')) openSheet();
});
$('#edBack').addEventListener('click', () => edClose());
let drag = null;
edStage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, c: [...ED.c], moved: false }; try { edStage.setPointerCapture(e.pointerId); } catch (er) { /* fine */ } });
edStage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) > 8) drag.moved = true;
  if (drag.moved) { ED.c = [drag.c[0] - dx / ED.sc, drag.c[1] - dy / ED.sc]; ED.dragging = true; }
});
edStage.addEventListener('pointerup', (e) => { if (drag && !drag.moved && ED.fix < 0) { const [px, py] = toPhoto(e.clientX, e.clientY); edSelect(wallAt(px, py)); } drag = null; ED.dragging = false; });
edStage.addEventListener('pointercancel', () => { drag = null; ED.dragging = false; });
function edFrame(dt, time) {
  ED.zoom = lerp(ED.zoom, ED.zoomGoal, 1 - Math.exp(-dt * 8));
  edView();
  ED.win.lerp(ED.goal, ED.dragging ? 1 : 1 - Math.exp(-dt * 7));
  EU.uWin.value.copy(ED.win);
  EU.uPx.value.set(ED.win.z / innerWidth * 1.6, ED.win.w / innerHeight * 1.6);
  EU.uTime.value = time;
  ED.scan = reduced ? 2 : Math.min(2, (time - ED.t0) * 0.95 - 0.3);
  EU.uScan.value = ED.scan;
  EU.uFocus.value = lerp(EU.uFocus.value, ED.sel.size ? 1 : 0, 1 - Math.exp(-dt * 9));
  const lim = innerWidth >= 900 ? innerHeight : ED.stage.sh;
  for (const b of edPinsEl.children) {
    const wl = ED.room.walls[+b.dataset.wall], [X, Y] = toScreen(wl.anchor[0], wl.anchor[1]);
    const vis = ED.fix < 0 && X > 8 && X < innerWidth - 8 && Y > 64 && Y < lim - 24 && ED.scan > (X / innerWidth) * 1.1;
    const bw = b.offsetWidth, bx = clamp(X - bw / 2, 8, innerWidth - bw - 8);
    b.style.transform = `translate(${bx.toFixed(1)}px, ${(Y - b.offsetHeight / 2).toFixed(1)}px)`;
    b.style.opacity = vis ? '1' : '0'; b.style.pointerEvents = vis ? 'auto' : 'none';
  }
  if (ED.fix >= 0) fixFrame();
}

// rooms: the studio photo, real rooms prepared offline, and the visitor's own photo (analysed on the device)
function roomTiles() {
  const tile = (id, img, label, extra = '') => `<button type="button" class="room${extra}" data-room="${id}" aria-pressed="${ED.room && ED.room.id === id}">${img}<span>${label}</span></button>`;
  let h = tile('upload', '<i>+</i>', ED.rooms.mine ? '+' : T.edUpload, ' up');   // the visitor's photo first: it is the point
  if (ED.rooms.mine) h += tile('mine', `<img src="${ED.rooms.mine.thumb}" alt="">`, T.edUpload);
  (E.rooms || []).forEach((id, i) => { h += tile(id, `<img src="${E.assets}rooms/${id}/thumb.jpg" alt="" loading="lazy">`, fill(T.edRoomN, { n: i + 1 })); });
  $('#edRoomList').innerHTML = h;
}
function roomsOpen(on) { $('#edRooms').hidden = !on; $('#edRoomsBtn').setAttribute('aria-expanded', String(on)); if (on) roomTiles(); }
$('#edRoomsBtn').addEventListener('click', () => roomsOpen($('#edRooms').hidden));
function edSetRoom(room) {
  if (ED.fix >= 0) fixEnd();
  ED.room = room; ED.sel = new Set(); ED.applied = false; ED.t0 = clock.elapsedTime; ED.c = [room.W / 2, room.H / 2];
  if (!room.inited) { room.inited = true; if (room !== ED.def) room.walls.forEach((wl) => { wl.item = cur; }); }
  for (const wl of room.walls) if (wl.item) faceOf(wl.item.id).then(() => ED.open && edUniforms()).catch(() => {});
  edUniforms(); edUI(); roomsOpen(false);
}
$('#edRoomList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-room]'); if (!b) return;
  const id = b.dataset.room;
  if (id === 'upload') { $('#edFile').click(); return; }
  if (ED.def && id === ED.def.id) { edSetRoom(ED.def); return; }
  if (id === 'mine') { edSetRoom(ED.rooms.mine); return; }
  try { if (!ED.rooms[id]) ED.rooms[id] = await preparedRoom(id); edSetRoom(ED.rooms[id]); } catch (er) { toast(T.error); }
});
const busy = (txt, p) => { $('#edBusy').hidden = txt == null; if (txt != null) { $('#edBusyT').textContent = txt; $('#edBusyBar').style.transform = `scaleX(${p || 0})`; } };
let detector = null;
$('#edFile').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0]; e.target.value = '';
  if (!file) return;
  roomsOpen(false);
  busy(fill(T.edLoadAI, { p: 0 }), 0.02);
  try {
    const img = new Image(); img.src = URL.createObjectURL(file); await img.decode();
    if (!detector) detector = await import(E.detect);
    const device = 'wasm';   // CPU everywhere: 31 MB once, same result on every phone (WebGPU builds were heavier or less stable)
    const prog = (k, p) => { if (k === 'download') busy(fill(T.edLoadAI, { p: Math.round(p * 100) }), 0.05 + p * 0.6); };
    await detector.loadModels(prog, { device });
    busy(T.edAnalyze, 0.7);
    const steps = { seg: 0.75, depth: 0.82, walls: 0.92, mask: 0.96 };
    const r = await detector.analyze(img, (k) => busy(T.edAnalyze, steps[k] || 0.8));
    if (!r.walls.length) { busy(T.edNoWall, 1); setTimeout(() => busy(null), 3600); return; }
    ED.rooms.mine = photoRoom(img, r);
    busy(null); edSetRoom(ED.rooms.mine); tap(0.5);
  } catch (er) { console.error(er); busy(T.edFail, 1); setTimeout(() => busy(null), 3600); }
});

// adjust corners: four handles on the selected wall's quad, the height of the walls with - / +
const fixEl = $('#edFix'), fixPoly = $('#edFixPoly'), handles = [];
for (let k = 0; k < 4; k++) {
  const h = document.createElement('button'); h.type = 'button'; h.className = 'hdl'; h.setAttribute('aria-label', T.edFix + ' ' + (k + 1));
  fixEl.appendChild(h); handles.push(h);
  let start = null;
  h.addEventListener('pointerdown', (e) => { e.stopPropagation(); const wl = ED.room.walls[ED.fix]; start = { x: e.clientX, y: e.clientY, p: [...wl.q[k]] }; try { h.setPointerCapture(e.pointerId); } catch (er) { /* fine */ } });
  h.addEventListener('pointermove', (e) => {
    if (!start) return;
    const r = ED.room, wl = r.walls[ED.fix];
    wl.q[k] = [start.p[0] + (e.clientX - start.x) / ED.sc, start.p[1] + (e.clientY - start.y) / ED.sc];
    wl.Hinv = homInv(wl.q);
    if (r.fpx) wl.w = clamp(wl.h * aspectOf(wl.q, r.fpx, r.W, r.H), 0.3, 15);
    edUniforms();
  });
  const end = () => { if (start) { start = null; edUI(); } };
  h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
}
function fixFrame() {
  const wl = ED.room.walls[ED.fix], W = innerWidth, H = innerHeight, pts = [];
  wl.q.forEach((p, k) => {
    const [X, Y] = toScreen(p[0], p[1]), cx = clamp(X, 16, W - 16), cy = clamp(Y, 70, H - 16);
    handles[k].style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`; handles[k].classList.toggle('off', cx !== X || cy !== Y);
    pts.push(X.toFixed(1) + ',' + Y.toFixed(1));
  });
  fixPoly.setAttribute('points', pts.join(' '));
}
function fixStart() {
  const i = [...ED.sel][0]; if (i == null) return;
  const r = ED.room, wl = r.walls[i];
  ED.fix = i; fixEl.hidden = false;
  // zoom out so the whole quad (or most of it) is on screen
  const xs = wl.q.map((p) => clamp(p[0], -r.W * 0.4, r.W * 1.4)), ys = wl.q.map((p) => clamp(p[1], -r.H * 0.4, r.H * 1.4));
  const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys), s = ED.stage || { sw: innerWidth, sh: innerHeight };
  const fit = Math.min((s.sw - 90) / bw, (s.sh - 140) / bh);
  ED.zoomGoal = clamp(fit / (ED.cover || 1), 0.3, 1);
  ED.c = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2];
  edUI();
}
function fixEnd() { ED.fix = -1; fixEl.hidden = true; ED.zoomGoal = 1; if (ED.room) edUI(); }
$('#edFixBtn').addEventListener('click', fixStart);
$('#edDone').addEventListener('click', fixEnd);
for (const b of document.querySelectorAll('[data-h]')) b.addEventListener('click', () => {
  for (const wl of ED.room.walls) { const a = wl.w / wl.h; wl.h = clamp(Math.round((wl.h + 0.05 * +b.dataset.h) * 100) / 100, 2.2, 4.5); wl.w = a * wl.h; }
  edUniforms(); edUI();
});

// ---------------------------------------------------------------- frame loop: one clock, eased toward the scroll target
const clock = new THREE.Clock();
let fpsT = 0, fpsN = 0, lastCount = -1;
const tgt = new THREE.Vector3();
function frame() {
  const dt = Math.min(0.05, clock.getDelta()), time = clock.elapsedTime, y = scrollY;
  if (ED.open) { edFrame(dt, time); grainPass.uniforms.uTime.value = time; composer.render(dt); requestAnimationFrame(frame); return; }
  const q = qAt(y), target = shotAt(q), k = reduced || first ? 1 : 1 - Math.exp(-dt * 6);
  first = false;
  state.t.lerp(tgt.set(...target.t), k);
  for (const key of KEYS) state[key] = lerp(state[key], target[key], k);
  mouse.x = lerp(mouse.x, reduced ? 0 : mouse.tx, 1 - Math.exp(-dt * 3)); mouse.y = lerp(mouse.y, reduced ? 0 : mouse.ty, 1 - Math.exp(-dt * 3));
  placeCamera(state);
  const a = 1 - state.ex;
  for (const s of slats) {
    if (s.i === 0) continue;
    const o = (Math.abs(s.i) - 1) / 2, t = easeOut(clamp((a - o * 0.42) / 0.58)), e = 1 - t, sg = Math.sign(s.i);
    s.m.visible = state.show > 0.02;
    s.m.position.set(s.i * 0.2002 + sg * (0.55 + Math.abs(s.i) * 0.5) * e, (Math.abs(s.i) % 2 ? 0.35 : -0.25) * e, 0.15 * e * Math.abs(s.i));
    s.m.rotation.set(0, -sg * 0.85 * e, sg * 0.06 * e);
    if (t > 0.985 && !s.locked) { s.locked = true; tap(0.5); }
    if (t < 0.9) s.locked = false;
  }
  hero.rotation.set(0, state.show < 0.5 && !reduced ? Math.sin(time * 0.35) * 0.04 : 0, state.rz);
  hero.position.y = Math.abs(state.rz) * 0.35; hero.updateMatrixWorld();

  // room
  const r = clamp((y - roomTop) / roomLen), mix = smooth(clamp(r / 0.07));
  const goal = r <= 0.07 ? 0 : countAt(clamp((r - 0.07) / 0.86));
  state.count = reduced ? goal : lerp(state.count, goal, 1 - Math.exp(-dt * 8));
  if (Math.abs(state.count - goal) < 0.002) state.count = goal;
  RU.uMix.value = mix; RU.uCount.value = state.count;
  const gc = Math.floor(state.count), tc = state.count - gc, pcur = tc > 0.0001 && gc < lay.total ? pieceAt(gc) : null;
  if (pcur) {
    const e = Math.pow(1 - tc, 2.2), lift = 0.28 * e, dv = 0.85 * e, wl = SR.walls[pcur.wi], x0 = pcur.k * lay.SW, y0 = pcur.row * lay.SL + dv;
    RU.uPiece.value.set(x0, x0 + lay.SW, y0, y0 + lay.SL); RU.uAnim.value.set(pcur.wi, e, smooth(clamp(tc / 0.12)), lift); RU.uGc.value = gc;
    RU.uHL.value.copy(liftedInv(wl.pose, lift + 0.02)); RU.uSzC.value.set(wl.w, wl.h);
  } else RU.uAnim.value.z = 0;
  roomPass.enabled = mix > 0.001;
  renderPass.enabled = bloom.enabled = outPass.enabled = mix < 0.999;
  const asp = innerWidth / innerHeight, pa = SR.W / SR.H, zoom = 1 + 0.1 * (1 - mix);
  let ww = 1, wh = 1; if (asp < pa) ww = asp / pa; else wh = pa / asp;
  ww /= zoom; wh /= zoom;
  const want = asp < 1.2 && state.count < lay.total - 0.01 ? pieceImageX(Math.min(lay.total - 1, Math.floor(state.count))) : 0.5;
  state.pan = lerp(state.pan, want, 1 - Math.exp(-dt * 2.2));
  RU.uWin.value.set(clamp(state.pan, ww / 2, 1 - ww / 2) - ww / 2, 0.5 - wh / 2, ww, wh);
  const placed = Math.floor(state.count + 1e-4);
  if (placed !== lastCount) {
    if (placed > lastCount && lastCount >= 0 && mix > 0.5) tap(0.35);
    lastCount = placed;
    $('#nSlats').textContent = fmt(placed);
    $('#nUnits').textContent = cur.k === 'slats' ? T.unitsSlat : T.units;
    $('#nArea').textContent = fmt(Math.min(lay.area, placed * lay.SW * Math.min(lay.SL, SR.walls[0].h)), 1);
    $('#priceFact').hidden = cur.p == null;
    if (cur.p != null) { $('#nPrice').textContent = fmt(placed * cur.p) + ' ₪'; $('#nPriceL').textContent = fill(cur.k === 'slats' ? T.priceSlat : T.priceUnit, { p: fmt(cur.p) }); }
    $('#meterFill').style.transform = `scaleX(${placed / lay.total})`;
  }
  $('#dock').classList.toggle('on', mix > 0.5 && r < 0.995);
  $('#barFill').style.transform = `scaleX(${clamp(y / (document.documentElement.scrollHeight - innerHeight))})`;
  drawCallouts(q, mix);
  grainPass.uniforms.uTime.value = time;
  composer.render(dt);
  fpsT += dt; fpsN++;
  if (fpsT > 2) {
    const fps = fpsN / fpsT; fpsT = 0; fpsN = 0;
    if (fps < 40 && renderer.getPixelRatio() > 1) { maxDpr = Math.max(1, renderer.getPixelRatio() - 0.25); resize(); }
    else if (fps < 34) bloom.strength = 0;
  }
  requestAnimationFrame(frame);
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxDpr));
  renderer.setSize(w, h, false); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  grainPass.uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  $('#lines').setAttribute('viewBox', `0 0 ${w} ${h}`);
  measure();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- boot: load, compile every shader behind the loader, then fade in
async function boot() {
  resize();
  const [sr, alb] = await Promise.all([preparedRoom(E.storyRoom), albedoOf(threeId)]);
  // laying order: the wall facing the camera (closest to the middle of the photo) first, then the others
  const mid = (i) => Math.abs((sr.walls[i].anchor || [1e9])[0] - sr.W / 2);
  sr.order = sr.walls.map((_, i) => i).sort((a, b) => mid(a) - mid(b));
  sr.walls.forEach((wl, i) => { wl.M = homFwd(wl.q); wl.pose = wallPose(sr, wl); wl.ord = sr.order.indexOf(i); RU.uH.value[i].copy(wl.Hinv); RU.uSz.value[i].set(wl.w, wl.h); });
  RU.uPhoto.value = sr.photo; RU.uMask.value = sr.mask; RU.uClean.value = sr.clean; RU.uRef.value.copy(sr.ref); RU.uImg.value.set(sr.W, sr.H); RU.uN.value = sr.walls.length;
  SR = sr; ED.def = sr; ED.rooms[sr.id] = sr;
  faceMat.map = alb; faceMat.color.set(E.plain[threeId] || 0xffffff); faceMat.needsUpdate = true;
  storyLook(threeId);
  await choose(cur);
  try { await renderer.compileAsync(scene, camera); } catch (e) { /* compile on the first frame */ }
  canvas.classList.add('on'); $('#loading').classList.add('done');
  measure();
  requestAnimationFrame(frame);
  if (location.hash === '#room') requestAnimationFrame(() => { measure(); scrollTo(0, roomTop + roomLen * 0.08); });
  if (location.hash === '#walls' || location.hash === '#photo') { ED.boot = true; edOpen(false); if (location.hash === '#photo') roomsOpen(true); }
  (window.requestIdleCallback || setTimeout)(() => E.quick.forEach((m) => { faceOf(m.id).catch(() => {}); albedoOf(m.id).catch(() => {}); }));
}
boot().catch((e) => { $('#loading').textContent = T.error; console.error(e); });
