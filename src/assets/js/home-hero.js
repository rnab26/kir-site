// Home page: a walk through real rooms while you scroll. In each room the walls start bare (their own smoothed light) and the
// plates come and stick one by one (lifted in front of the wall with their shadow, then pressed on it), the camera following
// the plate being laid; a wall can also get one of our products (the 035 oak slats on the side wall of the bathroom).
// Furniture stays in front (wall masks). Rooms and settings: data/experience.json > home (build.ps1 writes data-reel).
import * as THREE from 'three';

const sec = document.querySelector('[data-reel]');
if (sec) start(sec).catch((e) => { console.warn('home reel off', e); sec.classList.add('reel-off'); });

async function start(sec) {
  const C = JSON.parse(sec.dataset.reel), canvas = sec.querySelector('canvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  const loader = new THREE.TextureLoader();
  const load = (u, srgb = true) => new Promise((res, rej) => loader.load(u, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; res(t); }, undefined, rej));

  const hom = (q) => {   // unit square -> quad
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q, dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    let a, b, d, e, g = 0, h = 0;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x3 - x0; d = y1 - y0; e = y3 - y0; }
    else { const den = dx1 * dy2 - dx2 * dy1; g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; }
    return [a, b, x0, d, e, y0, g, h, 1];
  };
  const inv = (m) => { const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g, det = a * A + b * B + c * Cc; return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, Cc / det, -(a * h - b * g) / det, (a * e - b * d) / det]; };
  const apply = (m, u, v) => { const z = m[6] * u + m[7] * v + m[8]; return [(m[0] * u + m[1] * v + m[2]) / z, (m[3] * u + m[4] * v + m[5]) / z]; };

  const faceTex = {};
  for (const f of C.faces || []) { const t = await load(f.img); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4; t.needsUpdate = true; faceTex[f.id] = { t, w: f.w / 100, h: f.h / 100 }; }
  const PW = (C.plate && C.plate.w ? C.plate.w : 122) / 100, PH = (C.plate && C.plate.h ? C.plate.h : 280) / 100;
  // the rooms: photo, wall masks (R G B), the walls' smoothed light (= the bare wall), quads
  const scenes = await Promise.all(C.scenes.map(async (s) => {
    const base = s.base;
    const [meta, photo, mask, light] = await Promise.all([fetch(base + 'room.json').then((r) => r.json()), load(base + 'photo.jpg'), load(base + 'mask.png', false), load(base + 'light.png')]);
    let n0 = 0;
    const walls = meta.walls.slice(0, 3).map((w, i) => {
      const fc = s.faces && s.faces[i] ? faceTex[s.faces[i]] : null, pw = fc ? fc.w : PW, ph = fc ? fc.h : PH;
      const rows = Math.max(1, Math.ceil(w.h / ph - 1e-6)), cols = Math.max(1, Math.ceil(w.w / pw - 1e-6)), M = hom(w.q);
      const o = { M, H: inv(M), sz: [w.w, w.h], pc: [pw, ph, rows, cols], n: cols * rows, start: n0, face: fc };
      n0 += o.n; return o;
    });
    return { meta, photo, mask, light, walls, total: n0 };
  }));

  const m3 = () => new THREE.Matrix3();
  const U = {
    uPhoto: { value: null }, uMask: { value: null }, uLight: { value: null }, uFace: { value: null },
    uRef: { value: new THREE.Vector3(1, 1, 1) }, uImg: { value: new THREE.Vector2(1, 1) }, uWin: { value: new THREE.Vector4(0, 0, 1, 1) }, uN: { value: 1 },
    uH: { value: [m3(), m3(), m3()] }, uM: { value: [m3(), m3(), m3()] }, uSz: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
    uPc: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, uCnt: { value: new THREE.Vector3() }, uMode: { value: new THREE.Vector3() },
    uFade: { value: 0 }, uGlow: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uBg: { value: new THREE.Color('#141210') }
  };
  const material = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D uPhoto, uMask, uLight, uFace; uniform vec3 uRef, uBg, uCnt, uMode; uniform vec2 uImg, uRes; uniform vec4 uWin;
      uniform mat3 uH[3], uM[3]; uniform vec2 uSz[3]; uniform vec4 uPc[3]; uniform float uN, uFade, uGlow, uTime; varying vec2 vUv;
      vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      vec2 toPuv(vec2 P){ return vec2(P.x / uImg.x, 1.0 - P.y / uImg.y); }
      // what a piece shows at wall point u (metres): the room's own finish (the photo, mapped back through the wall) or a product
      vec3 piece(int w, vec2 u, vec2 st, vec3 shade, float mode){
        if (mode > 0.5) return texture2D(uFace, clamp(st, vec2(0.003), vec2(0.997))).rgb * shade;
        mat3 M = w == 0 ? uM[0] : (w == 1 ? uM[1] : uM[2]); vec2 sz = w == 0 ? uSz[0] : (w == 1 ? uSz[1] : uSz[2]);
        vec3 p = M * vec3(u / sz, 1.0); return texture2D(uPhoto, clamp(toPuv(p.xy / p.z), vec2(0.0), vec2(1.0))).rgb;
      }
      vec3 dress(int w, vec3 photo, vec3 bare, vec3 shade, vec2 uv, vec4 pc, float cnt, float mode){
        float k = clamp(floor(uv.x / pc.x), 0.0, pc.w - 1.0), row = clamp(floor(uv.y / pc.y), 0.0, pc.z - 1.0), g = k * pc.z + row;
        vec2 st = vec2(uv.x / pc.x - k, (uv.y - row * pc.y) / pc.y);
        vec3 col = mix(bare, mode > 0.5 ? piece(w, uv, st, shade, mode) : photo, step(g + 1.0, cnt));
        float gc = floor(cnt), e = cnt - gc;
        if (e > 0.0005 && gc < pc.z * pc.w) {
          float kc = floor(gc / pc.z), rc = gc - kc * pc.z;
          vec2 lo = vec2(kc * pc.x, rc * pc.y), hi = lo + pc.xy, ce = (lo + hi) * 0.5;
          float ee = 1.0 - pow(1.0 - e, 3.0), sc = mix(1.14, 1.0, ee), a = smoothstep(0.0, 0.2, e);
          vec2 so = vec2(0.08, -0.14) * (1.0 - ee); float b = 0.006 + 0.09 * (1.0 - ee);
          vec2 su = ce + (uv - so - ce) / sc;
          float sh = (smoothstep(lo.x - b, lo.x + b, su.x) - smoothstep(hi.x - b, hi.x + b, su.x)) * (smoothstep(lo.y - b, lo.y + b, su.y) - smoothstep(hi.y - b, hi.y + b, su.y));
          col *= 1.0 - sh * a * mix(0.5, 0.2, ee);
          vec2 ul = ce + (uv - ce) / sc; float aa = 0.004;
          float inP = smoothstep(lo.x - aa, lo.x + aa, ul.x) * (1.0 - smoothstep(hi.x - aa, hi.x + aa, ul.x)) * smoothstep(lo.y - aa, lo.y + aa, ul.y) * (1.0 - smoothstep(hi.y - aa, hi.y + aa, ul.y));
          vec3 pcol = piece(w, ul, (ul - lo) / pc.xy, shade, mode) * (1.0 + 0.14 * (1.0 - ee));
          // a thin bright edge while it is held: the plate's thickness catching the light
          float edge = inP * (1.0 - smoothstep(0.0, 0.012, min(min(ul.x - lo.x, hi.x - ul.x), min(ul.y - lo.y, hi.y - ul.y)))) * (1.0 - ee);
          col = mix(col, pcol + edge * 0.25, inP * a);
        }
        return col;
      }
      void main(){
        vec2 puv = uWin.xy + vUv * uWin.zw;
        vec2 P = vec2(puv.x * uImg.x, (1.0 - puv.y) * uImg.y);
        vec3 photo = texture2D(uPhoto, puv).rgb, col = photo;
        vec4 m = texture2D(uMask, puv); float c0 = m.r, c1 = m.g * step(1.5, uN), c2 = m.b * step(2.5, uN);
        vec3 lt = texture2D(uLight, puv).rgb, shade = lt / uRef;
        vec3 bare = lt * 1.02;   // the bare wall: the room's own light on a plain plastered wall
        float best = max(c0, max(c1, c2));
        if (best > 0.002) {
          int w = c0 >= best ? 0 : (c1 >= best ? 1 : 2);
          mat3 H = w == 0 ? uH[0] : (w == 1 ? uH[1] : uH[2]); vec2 sz = w == 0 ? uSz[0] : (w == 1 ? uSz[1] : uSz[2]);
          vec4 pc = w == 0 ? uPc[0] : (w == 1 ? uPc[1] : uPc[2]); float cnt = w == 0 ? uCnt.x : (w == 1 ? uCnt.y : uCnt.z), mode = w == 0 ? uMode.x : (w == 1 ? uMode.y : uMode.z);
          vec3 q = H * vec3(P, 1.0);
          col = mix(photo, dress(w, photo, bare, shade, q.xy / q.z * sz, pc, cnt, mode), best);
        }
        col *= mix(vec3(1.0), vec3(1.05, 1.0, 0.93), uGlow);
        vec2 q = vUv - 0.5; col *= mix(0.74, 1.0, smoothstep(0.9, 0.25, length(q * vec2(1.0, 1.2))));
        col = mix(col, uBg, uFade);
        vec3 o = toSRGB(col) + (fract(sin(dot(floor(vUv * uRes) + fract(uTime * 7.1) * 91.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.02;
        gl_FragColor = vec4(o, 1.0);
      }`
  });
  const scene3 = new THREE.Scene(), cam = new THREE.Camera();
  scene3.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  let cur = -1;
  function use(i) {
    if (i === cur) return; cur = i;
    const s = scenes[i];
    U.uPhoto.value = s.photo; U.uMask.value = s.mask; U.uLight.value = s.light; U.uRef.value.set(...s.meta.ref); U.uImg.value.set(s.meta.W, s.meta.H); U.uN.value = s.walls.length;
    s.walls.forEach((w, k) => { U.uH.value[k].set(...w.H); U.uM.value[k].set(...w.M); U.uSz.value[k].set(...w.sz); U.uPc.value[k].set(...w.pc); });
    const fw = s.walls.find((w) => w.face); U.uFace.value = fw ? fw.face.t : s.photo;
    U.uMode.value.set(...[0, 1, 2].map((k) => (s.walls[k] && s.walls[k].face ? 1 : 0)));
  }

  // timeline: the rooms share the scroll up to the name; inside a room: a moment bare, the pieces, a moment dressed
  const LOGO = C.logoAt || [0.84, 0.97], SPAN = LOGO[0] / scenes.length;
  let goal = 0, pcur = reduced ? 1 : 0, visible = true, fx = 0.5, fy = 0.5;
  const progress = () => { const r = sec.getBoundingClientRect(), h = sec.offsetHeight - innerHeight; return h > 0 ? clamp(-r.top / h) : 0; };
  const size = () => { renderer.setSize(sec.clientWidth, innerHeight, false); U.uRes.value.set(canvas.width, canvas.height); };
  addEventListener('resize', size); size();
  new IntersectionObserver((en) => { visible = en[0].isIntersecting; }).observe(sec);
  const t0 = performance.now(); let tp = t0;
  function frame() {
    requestAnimationFrame(frame);
    if (!visible) return;
    const now = performance.now(), dt = Math.min(0.1, (now - tp) / 1000); tp = now;
    goal = reduced ? 1 : progress();
    pcur = lerp(pcur, goal, 1 - Math.exp(-dt * 6)); if (Math.abs(pcur - goal) < 0.0004) pcur = goal;
    const p = pcur;
    sec.style.setProperty('--logo', smooth(LOGO[0], LOGO[1], p).toFixed(4));
    sec.style.setProperty('--intro', (1 - smooth(0.0, SPAN * 0.18, p)).toFixed(4));
    const si = Math.min(scenes.length - 1, Math.floor(p / SPAN)), lp = clamp((p - si * SPAN) / SPAN);
    use(si);
    const s = scenes[si], laid = s.total * clamp((lp - 0.14) / 0.72);
    const cnt = s.walls.map((w) => clamp(laid - w.start, 0, w.n));
    U.uCnt.value.set(cnt[0] || 0, cnt[1] || 0, cnt[2] || 0);
    // a short dip to dark between rooms (none before the first or after the last)
    U.uFade.value = (si > 0 ? 1 - smooth(0, 0.07, lp) : 0) + (si < scenes.length - 1 ? smooth(0.93, 1, lp) : 0);
    U.uGlow.value = si === scenes.length - 1 ? smooth(0.86, 1, lp) : 0;
    // camera: fills the screen, starts close and travels with the piece being laid, then pulls back on the dressed room
    let tx = 0.5, ty = 0.5;
    const gi = Math.min(s.total - 1, Math.floor(laid)), wl = s.walls.find((w) => gi >= w.start && gi < w.start + w.n);
    if (wl) { const g = gi - wl.start, k = Math.floor(g / wl.pc[2]), r = g - k * wl.pc[2]; const [x, y] = apply(wl.M, clamp((k + 0.5) * wl.pc[0] / wl.sz[0]), clamp((r + 0.5) * wl.pc[1] / wl.sz[1])); tx = x / s.meta.W; ty = 1 - y / s.meta.H; }
    const back = smooth(0.8, 1, lp);
    tx = lerp(tx, 0.5, back); ty = lerp(lerp(ty, 0.5, 0.6), 0.5, back);
    if (lp < 0.02) { fx = tx; fy = ty; } else { fx = lerp(fx, tx, 1 - Math.exp(-dt * 2.2)); fy = lerp(fy, ty, 1 - Math.exp(-dt * 2.2)); }
    const W = canvas.width, H = canvas.height, asp = W / H, pa = s.meta.W / s.meta.H;
    const zoom = lerp(1.32, 1.0, smooth(0.0, 1.0, lp) * 0.6 + back * 0.4);
    let ww = 1, wh = 1; if (asp < pa) ww = asp / pa; else wh = pa / asp;
    ww /= zoom; wh /= zoom;
    U.uWin.value.set(clamp(fx - ww / 2, 0, 1 - ww), clamp(fy - wh / 2, 0, 1 - wh), ww, wh);
    U.uTime.value = (now - t0) / 1000;
    renderer.render(scene3, cam);
  }
  sec.classList.add('reel-on');
  frame();
}
