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

// ---------------------------------------------------------------- the room: measured walls of a real photo
const ROOM = { W: 2400, H: 1333, CX: 1196, CY: 693, F: 1100, ZB: 4.003, XL: -2.14, XR: 2.125, CAMH: 1.063, TOP: 2.70, ZR: 2.432, CURTAIN_X: 318 };
const WALL_B = ROOM.XR - ROOM.XL, WALL_R = ROOM.ZB - ROOM.ZR, ZLEFT = ROOM.F * -ROOM.XL / ROOM.CX, WALL_L = ROOM.ZB - ZLEFT;
const HIDDEN_L = ROOM.ZB - ROOM.F * -ROOM.XL / (ROOM.CX - ROOM.CURTAIN_X);
const lay = { SW: 0.2, SL: 2.9, R: 1, NB: 22, NR: 8, NL: 11, total: 41, walls: 3, cum: [0], weights: [] };
function layout(it, walls) {
  const SW = it.w / 100, SLn = it.h / 100, R = Math.max(1, Math.ceil(ROOM.TOP / SLn - 1e-6));
  const NB = Math.ceil(WALL_B / SW - 1e-6), NR = Math.ceil(WALL_R / SW - 1e-6), NL = Math.ceil(WALL_L / SW - 1e-6), hid = Math.floor(HIDDEN_L / SW);
  const cols = walls === 3 ? NB + NR + NL : NB, weights = [];
  for (let col = 0; col < cols; col++) { const left = col >= NB + NR, k = col - NB - NR; for (let r = 0; r < R; r++) weights.push(left && k < hid ? 0.12 : 1); }
  const cum = [0]; for (const w of weights) cum.push(cum[cum.length - 1] + w);
  Object.assign(lay, { SW, SL: SLn, R, NB, NR: walls === 3 ? NR : 0, NL, total: cols * R, walls, cum, weights });
}
const countAt = (p) => {
  const x = p * lay.cum[lay.total]; let g = 0;
  while (g < lay.total && lay.cum[g + 1] < x) g++;
  return g >= lay.total ? lay.total : g + (x - lay.cum[g]) / lay.weights[g];
};
const AREA = { 1: WALL_B * ROOM.TOP, 3: (WALL_B + WALL_R + WALL_L) * ROOM.TOP };
function pieceImageX(g) {
  const col = Math.floor(g / lay.R); let X, Z;
  if (col < lay.NB) { X = ROOM.XL + (col + 0.5) * lay.SW; Z = ROOM.ZB; }
  else if (col < lay.NB + lay.NR) { X = ROOM.XR; Z = ROOM.ZB - (col - lay.NB + 0.5) * lay.SW; }
  else { X = ROOM.XL; Z = ROOM.ZB - (col - lay.NB - lay.NR + 0.5) * lay.SW; }
  return (ROOM.CX + ROOM.F * X / Z) / ROOM.W;
}

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const RoomShader = {
  uniforms: {
    tDiffuse: { value: null }, uPhoto: { value: null }, uMask: { value: null }, uClean: { value: null }, uFace: { value: null },
    uMix: { value: 0 }, uCount: { value: 0 }, uWin: { value: new THREE.Vector4(0, 0, 1, 1) }, uRef: { value: new THREE.Vector3(1, 1, 1) },
    uSW: { value: 0.2 }, uSL: { value: 2.9 }, uR: { value: 1 }, uNB: { value: 22 }, uNR: { value: 8 }, uTotal: { value: 41 }, uWalls: { value: 3 }
  },
  vertexShader: VS,
  fragmentShader: `
    uniform sampler2D tDiffuse, uPhoto, uMask, uClean, uFace;
    uniform float uMix, uCount, uSW, uSL, uR, uNB, uNR, uTotal, uWalls;
    uniform vec4 uWin; uniform vec3 uRef;
    varying vec2 vUv;
    const float CX = ${ROOM.CX.toFixed(1)}, CY = ${ROOM.CY.toFixed(1)}, F = ${ROOM.F.toFixed(1)}, ZB = ${ROOM.ZB}, XL = ${ROOM.XL}, XR = ${ROOM.XR}, CAMH = ${ROOM.CAMH}, TOPV = ${ROOM.TOP.toFixed(2)};
    const vec2 IMG = vec2(${ROOM.W.toFixed(1)}, ${ROOM.H.toFixed(1)});
    float hash(float n){ return fract(sin(n * 12.9898 + 4.1) * 43758.5453); }
    vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    vec2 wallUV(vec2 P, int w, float off){
      vec3 d = vec3((P.x - CX) / F, (CY - P.y) / F, 1.0);
      if (w == 1) { float z = ZB - off; return vec2(d.x * z - XL, d.y * z + CAMH); }
      if (w == 2) { float t = (XL + off) / d.x; return vec2(ZB - t, d.y * t + CAMH); }
      float t = (XR - off) / d.x; return vec2(ZB - t, d.y * t + CAMH);
    }
    vec3 pieceTex(float g, float s, float t){
      if (hash(g + 3.7) > 0.5) t = 0.98 - t;
      if (uR < 1.5) t += (hash(g * 1.7 + 1.1) - 0.5) * 0.05;
      return texture2D(uFace, vec2(clamp(s, 0.004, 0.996), clamp(t, 0.002, 0.998))).rgb;
    }
    float colIndex(int w, float k){ return w == 1 ? k : (w == 3 ? uNB + k : uNB + uNR + k); }
    void colWall(float col, out int w, out float k){
      if (col < uNB) { w = 1; k = col; } else if (col < uNB + uNR) { w = 3; k = col - uNB; } else { w = 2; k = col - uNB - uNR; }
    }
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 puv = uWin.xy + vUv * uWin.zw;
      vec2 P = vec2(puv.x * IMG.x, (1.0 - puv.y) * IMG.y);
      vec3 photo = texture2D(uPhoto, puv).rgb;
      vec3 m = texture2D(uMask, puv).rgb;
      vec3 shade = texture2D(uClean, puv).rgb / uRef;
      vec3 col = photo;
      float cov = max(m.r, max(m.g, m.b));
      if (cov > 0.002) {
        int w = (m.r >= m.g && m.r >= m.b) ? 1 : (m.g >= m.b ? 2 : 3);
        bool on = uWalls > 2.0 || w == 1;
        vec2 uv = wallUV(P, w, 0.0);
        float k = floor(uv.x / uSW), s = fract(uv.x / uSW);
        float row = clamp(floor(uv.y / uSL), 0.0, uR - 1.0);
        float g = colIndex(w, k) * uR + row;
        float placed = on ? step(g + 1.0, uCount) : 0.0;
        vec3 wall = mix(photo, pieceTex(g, s, (uv.y - row * uSL) / uSL) * shade, placed);
        float prev = on ? step(g, uCount) * (1.0 - placed) * step(0.5, k) * step(row, 0.5) : 0.0;
        wall *= 1.0 - prev * 0.3 * (1.0 - smoothstep(0.0, 0.07 * 0.2 / uSW, s));
        // the piece being laid: lifted off the wall and sliding down into place, with its shadow
        float gc = floor(uCount), tc = uCount - gc;
        if (tc > 0.0 && gc < uTotal) {
          float colc = floor(gc / uR), rowc = gc - colc * uR;
          int wc; float kc; colWall(colc, wc, kc);
          float e = pow(1.0 - tc, 2.2);
          float lift = 0.28 * e, dv = 0.85 * e, a = smoothstep(0.0, 0.12, tc);
          float x0 = kc * uSW, x1 = x0 + uSW, y0 = rowc * uSL + dv, y1 = y0 + uSL;
          if (wc == w) {
            vec2 sh = vec2(wc == 1 ? 0.55 : (wc == 3 ? -0.5 : 0.5), -0.8) * (lift + 0.012);
            vec2 su = uv - sh; float b = 0.012 + lift * 0.22;
            float inS = (smoothstep(x0 - b, x0 + b, su.x) - smoothstep(x1 - b, x1 + b, su.x)) * (smoothstep(y0 - b, y0 + b, su.y) - smoothstep(y1 - b, y1 + b, su.y));
            wall *= 1.0 - inS * a * (0.5 - 0.25 * e);
          }
          vec2 ul = wallUV(P, wc, lift + 0.02);
          float aa = 0.003;
          float inX = smoothstep(x0 - aa, x0 + aa, ul.x) * (1.0 - smoothstep(x1 - aa, x1 + aa, ul.x));
          float inY = smoothstep(y0 - aa, y0 + aa, ul.y) * (1.0 - smoothstep(y1 - aa, y1 + aa, ul.y));
          vec3 lc = pieceTex(gc, (ul.x - x0) / uSW, (ul.y - y0) / uSL) * shade * (1.0 + 0.18 * e);
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
let cur = BYID[params.get('m')] || BYID[E.story];
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
  layout(cur, walls);
  RU.uSW.value = lay.SW; RU.uSL.value = lay.SL; RU.uR.value = lay.R; RU.uNB.value = lay.NB; RU.uNR.value = lay.NR; RU.uTotal.value = lay.total; RU.uWalls.value = walls;
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
  if (params.get('m') !== it.id && (params.has('m') || it.id !== E.story) && history.replaceState) { params.set('m', it.id); history.replaceState(null, '', location.pathname + '?' + params.toString() + location.hash); }
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
function homInv(q) {   // unit square (s along the wall, t up) -> quad; returns the inverse (photo px -> s, t)
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c = x0, d, e, f = y0, g = 0, h = 0;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x3 - x0; d = y1 - y0; e = y3 - y0; }
  else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3;
  }
  return new THREE.Matrix3().set(a, b, c, d, e, f, g, h, 1).invert();
}
function maskData(img, n) {   // small copy of the wall mask: tap lookup + one label anchor per wall
  const w = 480, h = Math.max(1, Math.round(480 * img.height / img.width)), cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, r = 5, anchors = [];
  for (let i = 0; i < n; i++) {
    const S = new Float32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += d[(y * w + x) * 4 + i] > 127 ? 1 : 0; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; } }
    const full = (2 * r + 1) ** 2 * 0.97, pts = []; let sx = 0, sy = 0;
    for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) {
      const s = S[(y + r + 1) * (w + 1) + x + r + 1] - S[(y - r) * (w + 1) + x + r + 1] - S[(y + r + 1) * (w + 1) + x - r] + S[(y - r) * (w + 1) + x - r];
      if (s >= full) { pts.push(x, y); sx += x; sy += y; }
    }
    if (!pts.length) { anchors.push(null); continue; }
    const cx = sx / (pts.length / 2), cy = sy / (pts.length / 2) * 0.85; let bi = 0, bd = Infinity;
    for (let j = 0; j < pts.length; j += 2) { const dd = (pts[j] - cx) ** 2 + (pts[j + 1] - cy) ** 2; if (dd < bd) { bd = dd; bi = j; } }
    anchors.push([(pts[bi] + 0.5) / w, (pts[bi + 1] + 0.5) / h]);
  }
  return { w, h, d, anchors };
}
function makeRoom(o) {
  const mk = maskData(o.mask.image, o.walls.length);
  o.walls.forEach((wl, i) => { wl.Hinv = homInv(wl.q); wl.item = wl.item || null; wl.anchor = mk.anchors[i] ? [mk.anchors[i][0] * o.W, mk.anchors[i][1] * o.H] : null; if (wl.ord == null) wl.ord = i; });
  o.mk = mk;
  return o;
}
function defaultRoom() {
  const { XL, XR, ZB, ZR, TOP } = ROOM, pr = (X, Y, Z) => [ROOM.CX + ROOM.F * X / Z, ROOM.CY - ROOM.F * (Y - ROOM.CAMH) / Z];
  return makeRoom({
    photo: RU.uPhoto.value, mask: RU.uMask.value, clean: RU.uClean.value, ref: RU.uRef.value.clone(), W: ROOM.W, H: ROOM.H,
    walls: [   // mask channels: R back, G left, B right; ord = laying order of the story (back, right, left), so the pieces match it
      { name: T.wallBack, ord: 0, w: WALL_B, h: TOP, q: [pr(XL, 0, ZB), pr(XR, 0, ZB), pr(XR, TOP, ZB), pr(XL, TOP, ZB)] },
      { name: T.wallLeft, ord: 2, w: WALL_L, h: TOP, q: [pr(XL, 0, ZB), pr(XL, 0, ZLEFT), pr(XL, TOP, ZLEFT), pr(XL, TOP, ZB)] },
      { name: T.wallRight, ord: 1, w: WALL_R, h: TOP, q: [pr(XR, 0, ZB), pr(XR, 0, ZR), pr(XR, TOP, ZR), pr(XR, TOP, ZB)] }
    ]
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

const ED = { open: false, room: null, def: null, sel: new Set(), applied: false, dirty: false, c: [0, 0], sc: 1, win: new THREE.Vector4(), goal: new THREE.Vector4(), scan: 2, recent: [], dragging: false, boot: false };
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
  hint.textContent = ED.sel.size ? fill(T.edPick, { w: [...ED.sel].sort().map((i) => r.walls[i].name).join(', ') }) : T.edHint;
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
  const sc = Math.max(sw / r.W, sh / r.H), hw = sw / 2 / sc, hh = sh / 2 / sc;
  ED.c[0] = r.W > 2 * hw ? clamp(ED.c[0], hw, r.W - hw) : r.W / 2;
  ED.c[1] = r.H > 2 * hh ? clamp(ED.c[1], hh, r.H - hh) : r.H / 2;
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
  if (ED.room === ED.def && !ED.dirty) ED.def.walls.forEach((wl, i) => { wl.item = walls === 3 || i === 0 ? cur : null; });
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
  ED.open = false; edEl.hidden = true; editPass.enabled = false; document.documentElement.classList.remove('ed-on');
  if (!sheet.hidden) closeSheet();
  if (location.hash === '#walls' && history.replaceState) history.replaceState(null, '', location.pathname + location.search + '#room');
  if (ED.boot) { ED.boot = false; measure(); scrollTo(0, roomTop + roomLen * 0.97); }
}
addEventListener('popstate', () => { if (ED.open) edClose(true); });
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-ed-open]')) { edOpen(); return; }
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
edStage.addEventListener('pointerup', (e) => { if (drag && !drag.moved) { const [px, py] = toPhoto(e.clientX, e.clientY); edSelect(wallAt(px, py)); } drag = null; ED.dragging = false; });
edStage.addEventListener('pointercancel', () => { drag = null; ED.dragging = false; });
function edFrame(dt, time) {
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
    const vis = X > 8 && X < innerWidth - 8 && Y > 64 && Y < lim - 24 && ED.scan > (X / innerWidth) * 1.1;
    const bw = b.offsetWidth, bx = clamp(X - bw / 2, 8, innerWidth - bw - 8);
    b.style.transform = `translate(${bx.toFixed(1)}px, ${(Y - b.offsetHeight / 2).toFixed(1)}px)`;
    b.style.opacity = vis ? '1' : '0'; b.style.pointerEvents = vis ? 'auto' : 'none';
  }
}

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
  roomPass.enabled = mix > 0.001;
  renderPass.enabled = bloom.enabled = outPass.enabled = mix < 0.999;
  const asp = innerWidth / innerHeight, pa = ROOM.W / ROOM.H, zoom = 1 + 0.1 * (1 - mix);
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
    $('#nArea').textContent = fmt(Math.min(AREA[walls], placed * lay.SW * Math.min(lay.SL, ROOM.TOP)), 1);
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
  const [photo, mask, clean, alb] = await Promise.all([load(E.assets + 'room.jpg'), load(E.assets + 'room-mask.png', false), load(E.assets + 'room-clean.jpg'), albedoOf(threeId)]);
  for (const t of [photo, mask, clean]) { t.anisotropy = 1; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  RU.uPhoto.value = photo; RU.uMask.value = mask; RU.uClean.value = clean;
  const lin = (c) => Math.pow(c / 255, 2.2);
  RU.uRef.value.set(lin(180.3), lin(170.4), lin(161.7)).multiplyScalar(1 / 0.8);   // the wall paint under full light
  faceMat.map = alb; faceMat.color.set(E.plain[threeId] || 0xffffff); faceMat.needsUpdate = true;
  storyLook(threeId);
  await choose(cur);
  try { await renderer.compileAsync(scene, camera); } catch (e) { /* compile on the first frame */ }
  ED.def = defaultRoom();
  canvas.classList.add('on'); $('#loading').classList.add('done');
  measure();
  requestAnimationFrame(frame);
  if (location.hash === '#room') requestAnimationFrame(() => { measure(); scrollTo(0, roomTop + roomLen * 0.08); });
  if (location.hash === '#walls') { ED.boot = true; edOpen(false); }
  (window.requestIdleCallback || setTimeout)(() => E.quick.forEach((m) => { faceOf(m.id).catch(() => {}); albedoOf(m.id).catch(() => {}); }));
}
boot().catch((e) => { $('#loading').textContent = T.error; console.error(e); });
