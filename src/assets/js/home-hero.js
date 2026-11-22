// Home page: a real room photo dressed while you scroll. Our travertine plates (KIR-090) come and stick to the big wall one by
// one, then our oak slats (035) are laid on the side wall, with the photo's own light; furniture stays in front (wall masks).
// Settings come from the section's data-reel attribute (build.ps1, data/experience.json > home).
import * as THREE from 'three';

const sec = document.querySelector('[data-reel]');
if (sec) start(sec).catch((e) => { console.warn('home reel off', e); sec.classList.add('reel-off'); });

async function start(sec) {
  const C = JSON.parse(sec.dataset.reel), canvas = sec.querySelector('canvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3), smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  const loader = new THREE.TextureLoader();
  const load = (u, srgb = true) => new Promise((res, rej) => loader.load(u, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; res(t); }, undefined, rej));
  const base = C.assets + 'rooms/' + C.room + '/';
  const [meta, photo, mask, light, f0, f1] = await Promise.all([fetch(base + 'room.json').then((r) => r.json()), load(base + 'photo.jpg'), load(base + 'mask.png', false), load(base + 'light.png'), load(C.faces[0].img), load(C.faces[1].img)]);
  // a tiny blurred copy of the photo: the soft glow beside it (downscaled in steps so it averages instead of streaking)
  let src = photo.image; for (const w of [256, 64, 20]) { const c = document.createElement('canvas'); c.width = w; c.height = Math.max(2, Math.round(w * meta.H / meta.W)); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height); src = c; }
  const amb = new THREE.CanvasTexture(src); amb.colorSpace = THREE.SRGBColorSpace; amb.generateMipmaps = false; amb.minFilter = amb.magFilter = THREE.LinearFilter;
  for (const f of [f0, f1]) { f.generateMipmaps = true; f.minFilter = THREE.LinearMipmapLinearFilter; f.anisotropy = 4; f.needsUpdate = true; }

  // photo px -> wall metres (inverse of the unit square -> quad homography)
  const hom = (q) => {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q, dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    let a, b, d, e, g = 0, h = 0;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x3 - x0; d = y1 - y0; e = y3 - y0; }
    else { const den = dx1 * dy2 - dx2 * dy1; g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; }
    return [a, b, x0, d, e, y0, g, h, 1];
  };
  const inv = (m) => { const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g, det = a * A + b * B + c * Cc; return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, Cc / det, -(a * h - b * g) / det, (a * e - b * d) / det]; };
  const mat = (m) => new THREE.Matrix3().set(...m);
  const walls = meta.walls.slice(0, 2).map((w, i) => {
    const f = C.faces[i], pw = f.w / 100, ph = f.h / 100;
    return { H: mat(inv(hom(w.q))), sz: new THREE.Vector2(w.w, w.h), pc: new THREE.Vector3(pw, ph, Math.max(1, Math.ceil(w.h / ph - 1e-6))), n: Math.ceil(w.w / pw - 1e-6) * Math.max(1, Math.ceil(w.h / ph - 1e-6)) };
  });

  const U = {
    uPhoto: { value: photo }, uAmb: { value: amb }, uMask: { value: mask }, uLight: { value: light }, uF0: { value: f0 }, uF1: { value: f1 },
    uRef: { value: new THREE.Vector3(...meta.ref) }, uImg: { value: new THREE.Vector2(meta.W, meta.H) }, uWin: { value: new THREE.Vector4(0, 0, 1, 1) },
    uH0: { value: walls[0].H }, uH1: { value: walls[1] ? walls[1].H : walls[0].H }, uSz0: { value: walls[0].sz }, uSz1: { value: walls[1] ? walls[1].sz : walls[0].sz },
    uPc0: { value: walls[0].pc }, uPc1: { value: walls[1] ? walls[1].pc : walls[0].pc }, uCnt: { value: new THREE.Vector2(0, 0) }, uN: { value: walls.length },
    uBg: { value: new THREE.Color(C.bg || '#161411') }, uGlow: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }
  };
  const material = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D uPhoto, uAmb, uMask, uLight, uF0, uF1; uniform vec3 uRef, uBg; uniform vec2 uImg, uSz0, uSz1, uCnt, uRes; uniform vec4 uWin;
      uniform mat3 uH0, uH1; uniform vec3 uPc0, uPc1; uniform float uN, uGlow, uTime; varying vec2 vUv;
      float hash(float n){ return fract(sin(n * 12.9898 + 4.1) * 43758.5453); }
      vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      vec3 face(float w, vec2 st){ st = clamp(st, vec2(0.003), vec2(0.997)); return w < 0.5 ? texture2D(uF0, st).rgb : texture2D(uF1, st).rgb; }
      // one wall: pieces already placed, and the piece arriving (bigger, as if held in front of the wall, then pressed on it)
      vec3 dress(float w, vec3 photo, vec3 shade, vec2 uv, vec3 pc, float cnt){
        float k = floor(uv.x / pc.x), row = clamp(floor(uv.y / pc.y), 0.0, pc.z - 1.0), g = k * pc.z + row;
        vec2 st = vec2(fract(uv.x / pc.x), (uv.y - row * pc.y) / pc.y);
        vec3 col = mix(photo, face(w, st) * shade, step(g + 1.0, cnt));
        float gc = floor(cnt), e = cnt - gc;
        if (e > 0.0005) {
          float kc = floor(gc / pc.z), rc = gc - kc * pc.z;
          vec2 lo = vec2(kc * pc.x, rc * pc.y), hi = lo + pc.xy, ce = (lo + hi) * 0.5;
          float ee = 1.0 - pow(1.0 - e, 3.0), sc = mix(1.09, 1.0, ee), a = smoothstep(0.0, 0.22, e);
          // its shadow on the wall: offset and soft while it is held away, tight once it touches
          vec2 so = vec2(0.06, -0.10) * (1.0 - ee); float b = 0.006 + 0.07 * (1.0 - ee);
          vec2 su = ce + (uv - so - ce) / sc;
          float sh = (smoothstep(lo.x - b, lo.x + b, su.x) - smoothstep(hi.x - b, hi.x + b, su.x)) * (smoothstep(lo.y - b, lo.y + b, su.y) - smoothstep(hi.y - b, hi.y + b, su.y));
          col *= 1.0 - sh * a * mix(0.42, 0.18, ee);
          vec2 ul = ce + (uv - ce) / sc; float aa = 0.004;
          float inP = smoothstep(lo.x - aa, lo.x + aa, ul.x) * (1.0 - smoothstep(hi.x - aa, hi.x + aa, ul.x)) * smoothstep(lo.y - aa, lo.y + aa, ul.y) * (1.0 - smoothstep(hi.y - aa, hi.y + aa, ul.y));
          vec3 pcol = face(w, (ul - lo) / pc.xy) * shade * (1.0 + 0.16 * (1.0 - ee));
          col = mix(col, pcol, inP * a);
        }
        return col;
      }
      void main(){
        vec2 puv = uWin.xy + vUv * uWin.zw;
        vec3 col;
        if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) {
          vec2 cp = clamp(puv, 0.04, 0.96); vec3 a = texture2D(uAmb, cp).rgb;
          float dd = length((puv - cp) * vec2(uImg.x / uImg.y, 1.0));
          col = mix(uBg, mix(uBg, a, 0.5), exp(-dd * 2.5));
        } else {
          vec2 P = vec2(puv.x * uImg.x, (1.0 - puv.y) * uImg.y);
          vec3 photo = texture2D(uPhoto, puv).rgb; col = photo;
          vec4 m = texture2D(uMask, puv); float c0 = m.r, c1 = m.g * step(1.5, uN);
          vec3 shade = texture2D(uLight, puv).rgb / uRef;
          if (c0 > 0.002 && c0 >= c1) { vec3 q = uH0 * vec3(P, 1.0); col = mix(photo, dress(0.0, photo, shade, q.xy / q.z * uSz0, uPc0, uCnt.x), c0); }
          else if (c1 > 0.002) { vec3 q = uH1 * vec3(P, 1.0); col = mix(photo, dress(1.0, photo, shade, q.xy / q.z * uSz1, uPc1, uCnt.y), c1); }
          // warm late light once the wall is dressed
          col *= mix(vec3(1.0), vec3(1.05, 0.99, 0.92), uGlow);
        }
        vec2 q = vUv - 0.5; col *= mix(0.78, 1.0, smoothstep(0.85, 0.25, length(q * vec2(1.0, 1.25))));
        vec3 o = toSRGB(col) + (fract(sin(dot(floor(vUv * uRes) + fract(uTime * 7.1) * 91.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.025;
        gl_FragColor = vec4(o, 1.0);
      }`
  });
  const scene = new THREE.Scene(), cam = new THREE.Camera();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  // timeline (share of the section's scroll): empty room, plates one by one, slats one by one, logo
  const T = Object.assign({ plates: [0.10, 0.50], slats: [0.52, 0.80], logo: [0.80, 0.95] }, C.timeline || {});
  let goal = 0, cur = reduced ? 1 : 0, last = -1, visible = true;
  const progress = () => { const r = sec.getBoundingClientRect(), h = sec.offsetHeight - innerHeight; return h > 0 ? clamp(-r.top / h) : 0; };
  const size = () => { renderer.setSize(sec.clientWidth, innerHeight, false); U.uRes.value.set(canvas.width, canvas.height); last = -1; };
  addEventListener('resize', size); size();
  new IntersectionObserver((en) => { visible = en[0].isIntersecting; }).observe(sec);
  const t0 = performance.now(); let tp = t0;
  function frame() {
    requestAnimationFrame(frame);
    if (!visible) return;
    const now = performance.now(), dt = Math.min(0.1, (now - tp) / 1000); tp = now;
    goal = reduced ? 1 : progress();
    cur = lerp(cur, goal, 1 - Math.exp(-dt * 7)); if (Math.abs(cur - goal) < 0.0005) cur = goal;
    const p = cur;
    sec.style.setProperty('--p', p.toFixed(4));
    sec.style.setProperty('--logo', smooth(T.logo[0], T.logo[1], p).toFixed(4));
    sec.style.setProperty('--intro', (1 - smooth(0.02, T.plates[0] + 0.04, p)).toFixed(4));
    const c0 = walls[0].n * clamp((p - T.plates[0]) / (T.plates[1] - T.plates[0]));
    const c1 = walls[1] ? walls[1].n * clamp((p - T.slats[0]) / (T.slats[1] - T.slats[0])) : 0;
    U.uCnt.value.set(c0, c1);
    U.uGlow.value = smooth(T.slats[1] - 0.05, T.logo[1], p);
    // framing: wide view, at least 86 % of the photo width and 94 % of its height stay in view, with a slow pull back
    const W = canvas.width, H = canvas.height, asp = W / H, pa = meta.W / meta.H, zoom = 1.06 - 0.06 * smooth(0, 0.9, p);
    let ww = 1, wh = 1; if (asp < pa) ww = asp / pa; else wh = pa / asp;
    if (ww < 0.86) { wh = 0.86 / ww; ww = 0.86; }
    if (wh < 0.94) { ww *= 0.94 / wh; wh = 0.94; }   // wide screens: most of the photo height too (soft glow at the sides)
    ww /= zoom; wh /= zoom;
    const focus = lerp(0.42, 0.62, smooth(T.plates[1] - 0.05, T.slats[1], p));
    const x = clamp(focus - ww / 2, Math.min(0, 1 - ww), Math.max(0, 1 - ww)), y = wh <= 1 ? 0.5 - wh / 2 : 0.5 - wh * 0.6;
    U.uWin.value.set(ww >= 1 ? 0.5 - ww / 2 : x, y, ww, wh);
    U.uTime.value = (performance.now() - t0) / 1000;
    renderer.render(scene, cam);
  }
  sec.classList.add('reel-on');
  frame();
}
