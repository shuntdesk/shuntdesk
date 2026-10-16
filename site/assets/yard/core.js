// The Yard, core: renderer and post, small builders, the collision grid, and the clock that turns day into night.
import * as THREE from 'three';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';
export { THREE };
// signs are drawn into canvases as the city is built, so the fonts have to be in first
await Promise.all(['900 60px D', '700 20px M', '500 16px B'].map(f => document.fonts.load(f))).catch(() => {});

export const $ = id => document.getElementById(id);
window.boot?.(0.3, 'Building the city');
export const TOUCH = matchMedia('(pointer: coarse)').matches;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k, smooth = k => (k = clamp(k, 0, 1), k * k * (3 - 2 * k));
export const damp = (dt, r) => 1 - Math.exp(-dt * r);
let seed = 7; export const setSeed = s => { seed = s; }; export const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
export const pick = a => a[Math.floor(rnd() * a.length)];

// ---------- renderer ----------
export const R = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false, powerPreference: 'high-performance' });
R.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.1 : 1.4));
R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.1;
R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFShadowMap;
export const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x0c0d12, 0.006);
export const cam = new THREE.PerspectiveCamera(58, 1, 0.1, 2400);
export const composer = new EffectComposer(R);
composer.addPass(new RenderPass(scene, cam));
export const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.5, 0.74); composer.addPass(bloom);
composer.addPass(new OutputPass());
export function resize() { const w = innerWidth, h = innerHeight; R.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w * 0.5, h * 0.5); cam.aspect = w / h; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ---------- builders ----------
export const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...o });
export const BOX = new THREE.BoxGeometry(1, 1, 1);
// lights that only matter after dark scale with the street lamps: { mat, k }
export const nightMats = [];
export function glow(color, k = 1, night = false) { const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: k, roughness: 1 }); if (night) nightMats.push({ mat: m, k, day: 0.08 }); return m; }
export function box(w, h, d, mat, x, y, z, parent = scene, shadow = false) { const m = new THREE.Mesh(BOX, mat); m.scale.set(w, h, d); m.position.set(x, y, z); if (shadow) { m.castShadow = true; m.receiveShadow = true; } parent.add(m); return m; }
export function canvasTex(w, h, draw, repeat) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); } t.userData.canvas = c; return t; }
export const additive = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true });
export const haloTex = canvasTex(128, 128, x => { const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(0.25, 'rgba(255,255,255,.25)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); });
// a text sign that always faces the camera
export function label(lines, { size = 64, color = '#edebe6', bg = 'rgba(6,7,8,.86)', accent = null, scale = 0.012, font = 'D', weight = 900, bright = 0.62 } = {}) {
  lines = [].concat(lines);
  const pad = Math.round(size * 0.4), probe = document.createElement('canvas').getContext('2d'), f = `${weight} ${size}px ${font}`; probe.font = f;
  const w = Math.ceil(Math.max(...lines.map(l => probe.measureText(l).width))) + pad * 2 + (accent ? 10 : 0), h = Math.ceil(lines.length * size * 1.08 + pad * 1.6);
  const t = canvasTex(w, h, x => { x.font = f; x.textBaseline = 'middle'; if (bg) { x.fillStyle = bg; x.beginPath(); x.moveTo(14, 0); x.lineTo(w, 0); x.lineTo(w, h - 14); x.lineTo(w - 14, h); x.lineTo(0, h); x.lineTo(0, 14); x.fill(); } if (accent) { x.fillStyle = accent; x.fillRect(0, 14, 10, h - 28); } x.fillStyle = color; lines.forEach((l, i) => x.fillText(l, pad + (accent ? 10 : 0), pad * 0.8 + size * 0.56 + i * size * 1.08)); });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); s.material.color.setScalar(bright);
  s.scale.set(w * scale, h * scale, 1); return s;
}
// a painted board on a wall (not facing the camera)
export function board(text, color, w = 8) {
  const t = canvasTex(512, 128, (x, cw, ch) => { x.fillStyle = '#050506'; x.fillRect(0, 0, cw, ch); x.font = '900 86px D'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.shadowColor = color; x.shadowBlur = 18; x.fillStyle = color; x.fillText(text, cw / 2, ch / 2 + 4); x.shadowBlur = 0; x.globalAlpha = 0.55; x.fillStyle = '#fff'; x.fillText(text, cw / 2, ch / 2 + 4); });
  const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.3, color: 0x000000 }); nightMats.push({ mat: m, k: 1.3, day: 0.35 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.25), m); mesh.scale.set(w, w, 1); return mesh;
}

// ---------- collision: boxes on the ground plane, kept in a grid ----------
const CELL = 16, grid = new Map(); let stamp = 0;
export const colliders = [];
export function solid(x, z, w, d, h = 12) {
  const b = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h, q: 0 }; colliders.push(b);
  for (let i = Math.floor(b.x0 / CELL); i <= Math.floor(b.x1 / CELL); i++) for (let j = Math.floor(b.z0 / CELL); j <= Math.floor(b.z1 / CELL); j++) { const k = i + ',' + j; let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(b); }
  return b;
}
export function near(x, z, r = 2) {
  stamp++; const out = [];
  for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) { const a = grid.get(i + ',' + j); if (a) for (const b of a) if (b.q !== stamp) { b.q = stamp; out.push(b); } }
  return out;
}
// raised floors you can step onto: platforms. A step up of a metre or so is taken in stride.
export const floors = [];
export const floor = (x, z, w, d, y) => floors.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y });
export const floorAt = (x, z) => { let y = 0; for (const f of floors) if (x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1 && f.y > y) y = f.y; return y; };
export const blocked = (x, z, r = 0.5) => near(x, z, r + 1).some(b => x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r);

// ---------- the clock: sky, sun and moon, fog, lamps ----------
export const TIME = { h: 16, rate: 1 / 40 };   // hours per real second: a day is 16 minutes
export const ENV = { night: 0, street: 0, rain: 0, rainTarget: 0, weatherT: 2.5, raining: false };   // starts dry
export const WIN = { uNight: { value: 0 } };   // shared with the building shader
const U = { uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3() }, uNight: WIN.uNight, uSunK: { value: 1 } };
export const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: U,
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `varying vec3 vP; uniform vec3 uZen, uHor, uGlow, uSun; uniform float uNight, uSunK;
    float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
    void main(){
      float y = vP.y, a = atan(vP.z, vP.x);
      vec3 c = mix(uHor, uZen, smoothstep(-.02, .55, y));
      c += uGlow * exp(-max(y, 0.) * 7.) * (.5 + .5 * max(dot(normalize(vP.xz), normalize(uSun.xz)), 0.));
      float s = max(dot(vP, normalize(uSun)), 0.);
      c += vec3(1., .85, .6) * (pow(s, 900.) * 40. + pow(s, 12.) * .25) * uSunK;
      float col = floor(a * 140.), hgt = .01 + .07 * pow(h1(col), 2.2) * (.4 + .6 * h1(floor(a * 18.)));
      if (y < hgt) {
        c = mix(uHor * .55, vec3(.016, .017, .022), uNight);
        float wx = fract(a * 560.), wy = fract(y * 260.), id = floor(a * 560.) + floor(y * 260.) * 917.;
        if (wx > .25 && wx < .75 && wy > .3 && wy < .7 && h1(id) > .72) c += mix(vec3(.55, .38, .2), vec3(.4, .5, .6), h1(id + 3.)) * .55 * uNight;
      }
      gl_FragColor = vec4(c, 1.);
    }` }));
scene.add(sky);
const starsM = new THREE.PointsMaterial({ color: 0xc9d4e6, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false });
{ const n = 2000, p = new Float32Array(n * 3); setSeed(3); for (let i = 0; i < n; i++) { const u = rnd() * Math.PI * 2, v = 0.08 + rnd() * 0.9, r = 1600; p[i * 3] = Math.cos(u) * Math.sqrt(1 - v * v) * r; p[i * 3 + 1] = v * r; p[i * 3 + 2] = Math.sin(u) * Math.sqrt(1 - v * v) * r; } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); sky.add(new THREE.Points(g, starsM)); }
const moonS = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(256, 256, x => { const g = x.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, '#fffbef'); g.addColorStop(0.2, '#f4ecd8'); g.addColorStop(0.24, 'rgba(240,230,210,.35)'); g.addColorStop(1, 'rgba(240,230,210,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); }), fog: false, depthWrite: false, transparent: true }));
moonS.scale.set(300, 300, 1); sky.add(moonS);
export const hemi = new THREE.HemisphereLight(0x8a96a6, 0x1c1610, 0.9); scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xffffff, 1); sun.castShadow = true;
sun.shadow.mapSize.set(TOUCH ? 1024 : 1536, TOUCH ? 1024 : 1536); Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 260 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
// hour, zenith, horizon, horizon glow, sun light, fill light, fog colour, fog density, exposure, night, bloom
const KF = [
  [0, 0x020308, 0x0b0b10, 0x1a0f08, 0, 0.55, 0x0b0c10, 0.0085, 1.3, 1, 0.75],
  [4.8, 0x030410, 0x0e0e14, 0x1a0f08, 0, 0.55, 0x0c0d12, 0.0085, 1.3, 1, 0.75],
  [6, 0x24304e, 0x9a6650, 0x7a3818, 0.7, 0.85, 0x5a4a48, 0.006, 1.12, 0.55, 0.5],
  [7.5, 0x3f6ea8, 0xc8bcae, 0x402010, 1.7, 1.15, 0x9aa2ac, 0.0034, 1.0, 0, 0.28],
  [12, 0x3d78c4, 0xbfd0e0, 0x000000, 2.5, 1.35, 0xaab8c6, 0.0026, 0.95, 0, 0.22],
  [16, 0x4a7ab8, 0xd0c4b0, 0x201008, 2.1, 1.25, 0xa8acb0, 0.003, 0.98, 0, 0.28],
  [18, 0x2a3a66, 0xd88a50, 0x8a3a10, 1.1, 0.95, 0x7a5a4a, 0.0042, 1.05, 0.3, 0.5],
  [19.4, 0x0c1230, 0x3a2a38, 0x3a1a0c, 0.15, 0.65, 0x1c1a22, 0.0068, 1.2, 0.85, 0.7],
  [21, 0x020308, 0x0b0b10, 0x1a0f08, 0, 0.55, 0x0b0c10, 0.0085, 1.3, 1, 0.75],
  [24, 0x020308, 0x0b0b10, 0x1a0f08, 0, 0.55, 0x0b0c10, 0.0085, 1.3, 1, 0.75],
].map(k => [k[0], new THREE.Color(k[1]), new THREE.Color(k[2]), new THREE.Color(k[3]), k[4], k[5], new THREE.Color(k[6]), k[7], k[8], k[9], k[10]]);
const cA = new THREE.Color(), cB = new THREE.Color(), dayHemi = new THREE.Color(0xbcd4ff), nightHemi = new THREE.Color(0x6f7f99), dayGround = new THREE.Color(0x6a5a46), nightGround = new THREE.Color(0x1c1610);
export const PHASES = [[5, 'NIGHT'], [7.5, 'DAWN'], [11, 'MORNING'], [14.5, 'MIDDAY'], [17.5, 'AFTERNOON'], [19.5, 'EVENING'], [24, 'NIGHT']];
export const phaseName = h => PHASES.find(p => h < p[0])[1];
export function tickTime(dt, focus) {
  TIME.h = (TIME.h + dt * TIME.rate) % 24; const h = TIME.h;
  let i = 0; while (KF[i + 1][0] <= h) i++; const a = KF[i], b = KF[i + 1], k = smooth((h - a[0]) / (b[0] - a[0]));
  U.uZen.value.copy(a[1]).lerp(b[1], k); U.uHor.value.copy(a[2]).lerp(b[2], k); U.uGlow.value.copy(a[3]).lerp(b[3], k);
  const sunI = lerp(a[4], b[4], k), fill = lerp(a[5], b[5], k), night = lerp(a[9], b[9], k);
  scene.fog.color.copy(a[6]).lerp(b[6], k); scene.fog.density = lerp(a[7], b[7], k) * (1 + ENV.rain * 0.5);
  R.toneMappingExposure = lerp(a[8], b[8], k); bloom.strength = lerp(a[10], b[10], k);
  ENV.night = night; ENV.street = smooth((night - 0.15) / 0.5); WIN.uNight.value = night;
  // the sun crosses from east to west between six and six; the moon takes the other half
  const ang = (h - 6) / 12 * Math.PI, sd = new THREE.Vector3(-Math.cos(ang), Math.sin(ang), -0.35).normalize();
  U.uSun.value.copy(sd); U.uSunK.value = smooth(sd.y * 6 + 0.3);
  const up = sd.y > -0.05, dir = up ? sd : sd.clone().negate();
  sun.intensity = up ? sunI : 0.45 * night; sun.color.setRGB(1, lerp(0.62, 0.96, smooth(sd.y * 3)), lerp(0.38, 0.9, smooth(sd.y * 3)));
  if (!up) sun.color.setRGB(0.72, 0.8, 0.95);
  sun.position.set(focus.x + dir.x * 120, Math.max(20, dir.y * 120), focus.z + dir.z * 120); sun.target.position.set(focus.x, 0, focus.z);
  hemi.intensity = fill; hemi.color.copy(nightHemi).lerp(dayHemi, 1 - night); hemi.groundColor.copy(nightGround).lerp(dayGround, 1 - night);
  starsM.opacity = 0.85 * night; moonS.material.opacity = smooth(night * 1.4 - 0.2); moonS.material.color.setRGB(2.2, 2.1, 1.9);
  const md = sd.clone().negate(); moonS.position.set(md.x * 1500, Math.max(150, md.y * 1500), md.z * 1500);
  for (const n of nightMats) n.mat.emissiveIntensity = n.k * lerp(n.day, 1, ENV.street);
  // weather: every few hours the rain changes its mind
  // weather: long dry spells, now and then a shower that passes (in game hours: a shower lasts one to two minutes)
  ENV.weatherT -= dt * TIME.rate;
  if (ENV.weatherT <= 0) { ENV.raining = !ENV.raining && Math.random() < 0.6; ENV.rainTarget = ENV.raining ? 0.35 + Math.random() * 0.6 : 0; ENV.weatherT = ENV.raining ? 0.6 + Math.random() * 0.9 : 3 + Math.random() * 4; }
  ENV.rain = lerp(ENV.rain, ENV.rainTarget, damp(dt, 0.4)); if (ENV.rain < 0.01 && !ENV.rainTarget) ENV.rain = 0;
}
export const clock = () => { const h = Math.floor(TIME.h), m = Math.floor((TIME.h - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

// once the city and the yard are built: everything that never moves, merged by material into a few draw calls
export function mergeStatic(keep = new Set()) {
  const groups = new Map();
  for (const o of [...scene.children]) {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || keep.has(o) || Array.isArray(o.material)) continue;
    const g = o.geometry, key = [o.material.uuid, g.index ? 1 : 0, o.castShadow, o.receiveShadow, Object.keys(g.attributes).sort().join()].join('|');
    let e = groups.get(key); if (!e) groups.set(key, e = { mat: o.material, objs: [], cast: o.castShadow, recv: o.receiveShadow }); e.objs.push(o);
  }
  let merged = 0;
  for (const e of groups.values()) {
    if (e.objs.length < 2) continue;
    const geos = e.objs.map(o => { o.updateMatrixWorld(); return o.geometry.clone().applyMatrix4(o.matrixWorld); });
    const g = mergeGeometries(geos); if (!g) continue;
    for (const o of e.objs) scene.remove(o);
    const m = new THREE.Mesh(g, e.mat); m.castShadow = false; m.receiveShadow = e.recv || e.cast; m.frustumCulled = false; scene.add(m);   // a city-sized caster would cost the whole shadow pass merged += e.objs.length;
  }
  return merged;
}