// The night yard: a small 3D renderer on canvas 2D (lines, translucent faces, light cones, bloom).
// One scene, one camera path. The page feeds it a progress value 0..1.

export const STOPS = ['Sources', 'Gate', 'Scout', 'Tracer', 'Linker', 'Auditor', 'Judge'];
export const GZ = STOPS.map((_, i) => 90 + i * 56);            // gantry positions along the main line
const START = -80, FORK = 470, END = 650, DEPOT_END = 600;
const MAIN_LEN = FORK - START, BRANCH_LEN = 200;

const WHITE = '237,235,230', ORANGE = '237,235,230', GREEN = '46,211,160', RED = '255,77,94', GREY = '128,132,140', HOT = '255,255,255';
const VCOL = { long: GREEN, short: RED, depot: GREY };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mix = (a, b, k) => a + (b - a) * k;
const mix3 = (a, b, k) => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const ease = k => { k = clamp(k); return k * k * k * (k * (k * 6 - 15) + 10); };
const rnd = (a, b = 0) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

// long climbs the viaduct, short drops into the cutting, depot runs straight on
export function branch(kind, u) {
  u = clamp(u);
  const s = u * u * (3 - 2 * u), z = FORK + (END - FORK) * u;
  if (kind === 'long') return [46 * s, 20 * s, z];
  if (kind === 'short') return [-46 * s, -11 * s, z];
  return [0, 0, FORK + (DEPOT_END - FORK) * u];
}
function route(kind, s) {
  if (s <= MAIN_LEN) return [0, 0, START + s];
  return branch(kind, (s - MAIN_LEN) / BRANCH_LEN);
}
// progress value that parks the camera just before gantry i (used by the ticket page)
export const progressAtStop = i => 0.10 + (GZ[clamp(i, 0, 6)] - 40 - 28) / 412 * 0.48;

// the camera rides beside the main line (trains pass under it), climbs over the fork, then looks straight down
function keysFor(portrait) {
  const up = portrait ? [0, 0, 1] : [1, 0, 0], h = portrait ? 760 : 520;
  return [
    { p: 0.00, pos: [3.6, 2.2, -50], tgt: [0, 3.2, 40], up: [0, 1, 0], fog: [26, 300] },
    { p: 0.10, pos: [2.7, 5.0, 28], tgt: [-0.8, 4.5, 110], up: [0, 1, 0], fog: [26, 300] },
    { p: 0.58, pos: [2.7, 5.2, 440], tgt: [0, 3.2, 525], up: [0, 1, 0], fog: [26, 320] },
    { p: 0.70, pos: [0, 70, 392], tgt: [0, 0, 552], up: [0, 1, 0], fog: [70, 560] },
    { p: 0.84, pos: [0, h, 296], tgt: [0, 0, 296.01], up, fog: [h - 80, h * 3] },
    { p: 1.00, pos: [0, h * 0.9, 300], tgt: [0, 0, 300.01], up, fog: [h - 120, h * 3] }
  ];
}
let KEYS = keysFor(false);

const SIDINGS = [[-7, -80, 520], [7, -80, 300], [-14, -40, 470], [14, 60, 440], [-21, 40, 380], [21, -80, 250], [-28, 120, 470], [28, 180, 420], [-35, 200, 360]];
const PARKED = [[-7, 60, 6], [7, 150, 4], [-14, 250, 7], [14, 330, 5], [21, 40, 6], [-21, 180, 4], [-28, 300, 6], [28, 260, 3]];
// until the live feed names them, trains run unlabelled and take no branch
const DEFAULT_TOKENS = [['', null], ['', null], ['', null], ['', null], ['', null], ['', null]];
const FACES = [[2, 3, 7, 6, 0.2], [0, 2, 6, 4, 0.1], [1, 3, 7, 5, 0.1], [4, 5, 7, 6, 0.34], [0, 1, 3, 2, 0.08]];
const EDGES = [[0, 1], [2, 3], [0, 2], [1, 3], [4, 5], [6, 7], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

export function createYard(canvas, opts = {}) {
  // a page that hides the yard gets a yard that does nothing: same calls, no drawing, no frames spent
  if (!canvas || getComputedStyle(canvas).display === 'none') return new Proxy({}, { get: () => () => {} });
  const ctx = canvas.getContext('2d');
  const fx = document.createElement('canvas'), fxc = fx.getContext('2d');
  let W = 0, H = 0, F = 1, Fe = 1, D = 1;
  const cam = { pos: [0, 3, -40], tgt: [0, 3, 60], up: [0, 1, 0], fog: [26, 300] };
  let R, U, Fw, pT = 0, pS = 0, lastZ = 0, velS = 0, mx = 0, my = 0, mxS = 0, myS = 0, slow = 0, bloom = true, listeners = [],
    tokens = DEFAULT_TOKENS.map(t => ({ sym: t[0], to: t[1] }));
  const stars = Array.from({ length: 340 }, (_, i) => { const a = rnd(i, 1) * Math.PI * 2, y = 0.03 + rnd(i, 2) * 0.9, r = Math.sqrt(1 - y * y); return [Math.cos(a) * r, y, Math.sin(a) * r, 0.25 + rnd(i, 3) * 0.75]; });
  const dust = Array.from({ length: 170 }, (_, i) => [(rnd(i, 4) - 0.5) * 70, 0.3 + rnd(i, 5) * 13, rnd(i, 6) * 130, rnd(i, 7)]);
  const far = Array.from({ length: 46 }, (_, i) => [(rnd(i, 8) - 0.5) * 520, 1 + rnd(i, 9) * 9, 700 + rnd(i, 10) * 500, rnd(i, 11)]);
  // a city on the horizon: scenery only, it carries no data
  const city = Array.from({ length: 74 }, (_, i) => ({ x: (rnd(i, 12) - 0.5) * 1700, w: 16 + rnd(i, 13) * 44, h: 18 + Math.pow(rnd(i, 14), 2.2) * 190, z: 980 + rnd(i, 15) * 520, s: i })).sort((a, b) => b.z - a.z);

  // the pointer exists inside the yard: a marker on the ground under it, and a shockwave where it clicks
  let ptr = null, shocks = [], clock = 0, tracked = null, slotN = 0, introK = 0, introS = 0;
  const trk = new Map();
  addEventListener('pointermove', e => { mx = e.clientX / innerWidth * 2 - 1; my = e.clientY / innerHeight * 2 - 1; ptr = [e.clientX, e.clientY]; }, { passive: true });
  addEventListener('pointerdown', e => {
    ptr = [e.clientX, e.clientY];
    const g = ground(); if (!g) return;
    shocks.push({ p: g.p, k: g.k, t: clock }); if (shocks.length > 6) shocks.shift();
    for (const fn of hits) fn(g);
  }, { passive: true });
  const hits = [];
  // where the ray through the pointer meets the ground; k scales the marker with distance
  function ground() {
    if (!ptr || !R) return null;
    const dx = (ptr[0] - W / 2) / Fe, dy = -(ptr[1] - H / 2) / Fe, d = add(add(mul(R, dx), mul(U, dy)), Fw);
    if (d[1] > -0.004) return null;
    const s = -cam.pos[1] / d[1]; if (s > 1400) return null;
    return { p: add(cam.pos, mul(d, s)), k: Math.max(1, s / 34) };
  }
  function resize() {
    D = Math.min(window.devicePixelRatio || 1, 1.5);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * D); canvas.height = Math.round(H * D);
    fx.width = Math.round(canvas.width / 3); fx.height = Math.round(canvas.height / 3);
    F = Math.max(H, W * 0.62) * 0.92;
    KEYS = keysFor(W < H * 0.8);
  }
  const toCam = p => { const d = sub(p, cam.pos); return [dot(d, R), dot(d, U), dot(d, Fw)]; };
  const fogAt = z => clamp(1 - (z - cam.fog[0]) / (cam.fog[1] - cam.fog[0]));
  const sx = c => W / 2 + c[0] / c[2] * Fe, sy = c => H / 2 - c[1] / c[2] * Fe;

  // ---- batched lines and depth-sorted faces ----
  let buckets = new Map(), fills = [];
  function seg(a, b, color, w, alpha = 1, fog = true) {
    let ca = toCam(a), cb = toCam(b);
    const N = 0.4;
    if (ca[2] < N && cb[2] < N) return;
    if (ca[2] < N) ca = mix3(cb, ca, (cb[2] - N) / (cb[2] - ca[2]));
    else if (cb[2] < N) cb = mix3(ca, cb, (ca[2] - N) / (ca[2] - cb[2]));
    const al = alpha * (fog ? fogAt((ca[2] + cb[2]) / 2) : 1);
    if (al < 0.02) return;
    const x1 = sx(ca), y1 = sy(ca), x2 = sx(cb), y2 = sy(cb);
    if ((x1 < -200 && x2 < -200) || (x1 > W + 200 && x2 > W + 200) || (y1 < -200 && y2 < -200) || (y1 > H + 200 && y2 > H + 200)) return;
    const key = color + '|' + w + '|' + Math.min(10, Math.ceil(al * 10));
    let arr = buckets.get(key); if (!arr) buckets.set(key, arr = []);
    arr.push(x1, y1, x2, y2);
  }
  function glow(a, b, color, w, alpha = 1, fog = true) { seg(a, b, color, w, alpha, fog); seg(a, b, color, w * 5, alpha * 0.16, fog); }
  function flush() {
    ctx.lineCap = 'round';
    for (const [key, arr] of buckets) {
      const [color, w, al] = key.split('|');
      ctx.strokeStyle = `rgba(${color},${al / 10})`; ctx.lineWidth = Number(w);
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 4) { ctx.moveTo(arr[i], arr[i + 1]); ctx.lineTo(arr[i + 2], arr[i + 3]); }
      ctx.stroke();
    }
    buckets = new Map();
  }
  // a translucent face; `fade` makes it a gradient from the first point to the centre of the rest (light cones)
  function poly(pts, color, alpha, fade = false, fog = true) {
    const cs = pts.map(toCam); let d = 0;
    for (const c of cs) { if (c[2] < 0.5) return; d += c[2]; }
    d /= cs.length;
    const al = alpha * (fog ? fogAt(d) : 1); if (al < 0.012) return;
    fills.push({ d, xy: cs.map(c => [sx(c), sy(c)]), color, al, fade });
  }
  function flushFills() {
    fills.sort((a, b) => b.d - a.d);
    for (const f of fills) {
      if (f.fade) {
        const o = f.xy[0], ex = (f.xy[1][0] + f.xy[2][0]) / 2, ey = (f.xy[1][1] + f.xy[2][1]) / 2, g = ctx.createLinearGradient(o[0], o[1], ex, ey);
        g.addColorStop(0, `rgba(${f.color},${f.al})`); g.addColorStop(1, `rgba(${f.color},0)`); ctx.fillStyle = g;
      } else ctx.fillStyle = `rgba(${f.color},${f.al})`;
      ctx.beginPath(); ctx.moveTo(f.xy[0][0], f.xy[0][1]);
      for (let i = 1; i < f.xy.length; i++) ctx.lineTo(f.xy[i][0], f.xy[i][1]);
      ctx.closePath(); ctx.fill();
    }
    fills = [];
  }
  function project(p) { const c = toCam(p); return { x: sx(c), y: sy(c), z: c[2], ok: c[2] > 0.4 }; }
  function lamp(p, radius, color, alpha = 1, mirror = false) {
    const s = project(p); if (!s.ok) return;
    const al = alpha * fogAt(s.z); if (al < 0.03) return;
    const r = clamp(Fe * radius / s.z, 1.2, 9);
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 6);
    g.addColorStop(0, `rgba(${color},${0.6 * al})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, r * 6, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(${color},${al})`; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 7); ctx.fill();
    if (mirror) {   // the wet ground gives a little of it back
      const m = project([p[0], -p[1], p[2]]); if (!m.ok) return;
      const g2 = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, r * 9);
      g2.addColorStop(0, `rgba(${color},${0.22 * al})`); g2.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g2; ctx.save(); ctx.translate(m.x, m.y); ctx.scale(1, 2.6); ctx.beginPath(); ctx.arc(0, 0, r * 9, 0, 7); ctx.fill(); ctx.restore();
    }
  }
  function text(p, str, size, color, alpha = 1, px = 0, weight = 800) {
    if (!str) return;
    const s = project(p); if (!s.ok) return;
    const fs = px || Math.min(96, Fe * size / s.z), al = alpha * (px ? 1 : fogAt(s.z));
    if (fs < 6 || al < 0.04) return;
    ctx.font = `${weight} ${fs.toFixed(1)}px "Big Shoulders Display", "Barlow", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${color},${al})`;
    ctx.fillText(str, s.x, s.y);
  }
  // a train car: faces, edges, a lit strip down each side
  function car(front, back, color, alpha, lead) {
    const d = norm(sub(front, back)), side = mul(norm(cross(d, [0, 1, 0])), 1.15), up = [0, 2.7, 0], lift = [0, 0.45, 0], c = [];
    for (const e of [back, front]) for (const v of [0, 1]) for (const h of [-1, 1]) c.push(add(add(add(e, lift), mul(side, h)), mul(up, v)));
    for (const f of FACES) poly([c[f[0]], c[f[1]], c[f[2]], c[f[3]]], color, f[4] * alpha * (lead ? 1.5 : 1));
    for (const [i, j] of EDGES) (lead ? glow : seg)(c[i], c[j], color, lead ? 1.5 : 1.1, alpha);
    glow(mix3(c[0], c[2], 0.66), mix3(c[4], c[6], 0.66), lead ? HOT : color, 1.4, alpha * 0.9);
    glow(mix3(c[1], c[3], 0.66), mix3(c[5], c[7], 0.66), lead ? HOT : color, 1.4, alpha * 0.9);
    if (lead) {   // headlight cone
      const o = add(front, [0, 1.7, 0]), tip = add(o, mul(d, 34));
      poly([o, add(add(tip, mul(side, 6)), [0, -1.6, 0]), add(add(tip, mul(side, -6)), [0, -1.6, 0])], HOT, 0.42 * alpha, true);
    }
  }
  function ring(c, r, u, v, color, w, alpha, dash, phase) {
    const n = 64;
    for (let k = 0; k < n; k++) {
      if (dash && ((k + phase) % dash) >= dash / 2) continue;
      const a = k / n * Math.PI * 2, b = (k + 1) / n * Math.PI * 2;
      glow(add(c, add(mul(u, Math.cos(a) * r), mul(v, Math.sin(a) * r))), add(c, add(mul(u, Math.cos(b) * r), mul(v, Math.sin(b) * r))), color, w, alpha);
    }
  }

  function camAt(p, t) {
    mxS += (mx - mxS) * 0.06; myS += (my - myS) * 0.06;
    if (opts.pose) {   // a fixed vantage point (the board): it drifts a little and leans with the pointer
      const P = W < H * 0.8 && opts.pose.tall ? opts.pose.tall : opts.pose;
      cam.pos = [P.pos[0] + Math.sin(t * 0.07) * 7 + mxS * 16, P.pos[1] - myS * 9, P.pos[2] + Math.cos(t * 0.05) * 9];
      cam.tgt = P.tgt.slice(); cam.up = [0, 1, 0]; cam.fog = P.fog;
      Fw = norm(sub(cam.tgt, cam.pos)); R = norm(cross(Fw, cam.up)); U = cross(R, Fw);
      return;
    }
    let i = 0; while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
    const a = KEYS[i], b = KEYS[i + 1], raw = clamp((p - a.p) / (b.p - a.p)), k = i === 1 ? raw : ease(raw);
    cam.pos = mix3(a.pos, b.pos, k); cam.tgt = mix3(a.tgt, b.tgt, k); cam.up = norm(mix3(a.up, b.up, k));
    cam.fog = [mix(a.fog[0], b.fog[0], k), mix(a.fog[1], b.fog[1], k)];
    // the entrance: the camera hangs back above the approach and circles a little; released, it drops onto the rails
    introS += (introK - introS) * 0.034;
    if (introS > 0.002) { const k = introS; cam.pos = [cam.pos[0] + (18 + Math.sin(t * 0.13) * 26) * k, cam.pos[1] + 62 * k, cam.pos[2] - 215 * k]; cam.tgt = [cam.tgt[0], cam.tgt[1] - 8 * k, cam.tgt[2] + 130 * k]; cam.fog = [cam.fog[0] + 150 * k, cam.fog[1] + 620 * k]; }
    const low = clamp(1 - cam.pos[1] / 30), high = clamp((cam.pos[1] - 60) / 300) * (1 - introS);
    cam.pos[0] += Math.sin(cam.pos[2] * 0.021) * 0.5 * low + Math.sin(t * 0.31) * 0.35 * low - mxS * 1.5 * low;
    cam.pos[1] += Math.sin(cam.pos[2] * 0.034) * 0.22 * low + Math.sin(t * 0.47) * 0.12 * low - myS * 0.7 * low;
    // the pointer looks around; over the map it tilts the whole yard
    cam.tgt[0] -= mxS * 10 * low; cam.tgt[1] -= myS * 5 * low;
    cam.pos[0] -= myS * 110 * high; cam.pos[2] -= mxS * 80 * high;
    if (low > 0.5) { const r = Math.sin(cam.pos[2] * 0.02) * 0.018 - mxS * 0.03; cam.up = [Math.sin(r), Math.cos(r), 0]; }
    Fw = norm(sub(cam.tgt, cam.pos)); R = norm(cross(Fw, cam.up)); U = cross(R, Fw);
  }

  function draw(t, dt) {
    pS += (pT - pS) * (opts.snap ? 1 : 0.075);
    const p = opts.ambient ? 0.045 + 0.035 * Math.sin(t * 0.08) : pS;
    camAt(p, t);
    const cz = cam.pos[2], high = clamp((cam.pos[1] - 40) / 220), low = 1 - clamp((cam.pos[1] - 6) / 50);
    const vel = clamp(Math.abs(cz - lastZ), 0, 9); lastZ = cz;
    velS += (clamp(vel / 5) - velS) * 0.12;
    Fe = F * (1 - 0.17 * velS * low);                      // the lens widens with speed
    ctx.setTransform(D, 0, 0, D, 0, 0);
    ctx.fillStyle = '#060708'; ctx.fillRect(0, 0, W, H);

    // horizon glow, stars, the city
    const hz = project(add(cam.pos, [0, 0, 6000]));
    if (hz.ok) {
      const g = ctx.createRadialGradient(hz.x, hz.y, 0, hz.x, hz.y, H * 0.8);
      g.addColorStop(0, 'rgba(237,235,230,.2)'); g.addColorStop(0.35, 'rgba(237,235,230,.06)'); g.addColorStop(1, 'rgba(237,235,230,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    for (const s of stars) {
      const c = [dot(s, R), dot(s, U), dot(s, Fw)]; if (c[2] < 0.05) continue;
      ctx.fillStyle = `rgba(${WHITE},${(0.18 + 0.4 * s[3] * (0.6 + 0.4 * Math.sin(t * (0.6 + s[3]) + s[3] * 40))) * (1 - high)})`;
      ctx.fillRect(sx(c), sy(c), s[3] > 0.8 ? 1.6 : 1, s[3] > 0.8 ? 1.6 : 1);
    }
    if (high < 0.9) for (const b of city) {
      const dz = b.z - cz; if (dz < 200) continue;
      const l = project([b.x - b.w / 2, 0, b.z]), r = project([b.x + b.w / 2, b.h, b.z]); if (!l.ok || !r.ok) continue;
      const a = clamp(1 - cam.pos[1] / 40) * clamp((1500 - dz) / 700 + 0.25), x = Math.min(l.x, r.x), w = Math.abs(r.x - l.x), hh = l.y - r.y;
      if (a < 0.02 || x > W || x + w < 0 || hh < 2) continue;
      // near-black silhouettes against the glow: only the roof line and the windows carry light
      const g = ctx.createLinearGradient(0, r.y, 0, l.y); g.addColorStop(0, `rgba(7,8,10,${0.97 * a})`); g.addColorStop(1, `rgba(12,12,13,${0.97 * a})`);
      ctx.fillStyle = g; ctx.fillRect(x, r.y, w, hh);
      ctx.fillStyle = `rgba(${ORANGE},${0.3 * a})`; ctx.fillRect(x, r.y, w, 1);
      for (let k = 0; k < 7; k++) {
        const on = rnd(b.s, 20 + k) > 0.35 && Math.sin(t * 0.3 + rnd(b.s, 40 + k) * 50) > -0.75; if (!on) continue;
        ctx.fillStyle = `rgba(${rnd(b.s, 30 + k) > 0.6 ? ORANGE : HOT},${0.55 * a})`;
        ctx.fillRect(x + rnd(b.s, 50 + k) * (w - 3), r.y + 3 + rnd(b.s, 60 + k) * (hh - 6), 1.6, 1.6);
      }
      if (b.h > 120) { const tip = project([b.x, b.h + 2, b.z]); ctx.fillStyle = `rgba(${RED},${a * (0.5 + 0.5 * Math.sin(t * 2 + b.s))})`; ctx.fillRect(tip.x - 1, tip.y - 1, 2.2, 2.2); }
    }
    for (const f of far) lamp(f, 0.5, f[3] > 0.6 ? ORANGE : f[3] > 0.3 ? RED : GREEN, (0.35 + 0.3 * Math.sin(t * 1.3 + f[3] * 30)) * (1 - high));

    const zmin = high > 0.2 ? START : cz - 12, zmax = high > 0.2 ? END + 20 : cz + cam.fog[1];
    // where every token train is right now (the gantries react to them)
    const marks = [], flat = !!opts.pose;
    // tracked trains (the board): each one sits where its real scan is, and glides when that changes
    if (tracked) {
      const done = { long: 0, short: 0, depot: 0 };
      for (const it of tracked) {
        const dead = it.state === 'dead', wait = it.state === 'wait';
        // waiting trains stand on the sidings; when their turn comes they are shunted onto the main line
        let m = trk.get(it.id); if (!m) trk.set(it.id, m = { s: GZ[0] - START - 30, on: wait ? 0 : 1, slot: slotN++ % 18 });
        const want = wait ? m.s : it.state === 'run' || dead ? GZ[clamp(it.stop, 0, 6)] - START - 3 : MAIN_LEN + (it.to === 'depot' ? 0.6 : 0.94) * BRANCH_LEN - 12 * done[it.to]++;
        m.s += (want - m.s) * 0.05; m.on += ((wait ? 0 : 1) - m.on) * 0.05;
        const park = [[-7, 7, -14, 14, -21, 21][m.slot % 6], 0, 100 + Math.floor(m.slot / 6) * 90 + (m.slot % 6) * 8];
        const rp = route(it.state === 'done' ? it.to : null, m.s), p = mix3(park, rp, ease(m.on)), judged = it.state === 'done' && m.s > GZ[6] - START + 4;
        marks.push({ tk: { sym: it.sym, to: it.state === 'done' ? it.to : null }, s: m.s, col: dead ? GREY : judged ? VCOL[it.to] : WHITE, fade: dead ? 0.45 : wait ? 0.7 : 1, p, off: m.on < 0.985 ? p : null, one: true, sel: it.sel, live: it.state === 'run' });
      }
    }
    else tokens.forEach((tk, n) => {
      const period = 52, s = (((t * 17 + n * (MAIN_LEN + BRANCH_LEN + 160) / tokens.length) % (period * 17)) + period * 17) % (period * 17);
      const maxS = tk.to ? MAIN_LEN + BRANCH_LEN : GZ[6] - START + 20;   // no verdict: it leaves the picture at the judge
      if (s > maxS) return;
      const judged = tk.to && s > GZ[6] - START + 6;
      marks.push({ tk, s, col: judged ? VCOL[tk.to] : tk.grad ? HOT : WHITE, fade: clamp((maxS - s) / 14) * clamp(s / 10), p: route(tk.to, s), grad: !!tk.grad });
    });

    // main line: two glowing rails with light running down them
    for (let z = Math.max(START, Math.floor(zmin / 14) * 14); z < Math.min(FORK, zmax); z += 14) for (const g of [-0.72, 0.72]) glow([g, 0, Math.max(z, START)], [g, 0, Math.min(z + 14, FORK)], ORANGE, 1.7, 1);
    for (let k = 0; k < 9; k++) {
      const z = START + ((t * 95 + k * MAIN_LEN / 9) % MAIN_LEN); if (z < zmin || z > zmax) continue;
      for (const g of [-0.72, 0.72]) glow([g, 0.02, z], [g, 0.02, Math.min(FORK, z + 11)], HOT, 2.4, 1);
    }
    // sidings: dashed rails, each with a slow runner
    SIDINGS.forEach((s, n) => {
      for (let z = Math.max(s[1], Math.floor(zmin / 14) * 14); z < Math.min(s[2], zmax); z += 14) for (const g of [-0.72, 0.72]) seg([s[0] + g, 0, Math.max(z, s[1])], [s[0] + g, 0, Math.min(z + 9, s[2])], WHITE, 1, 0.5);
      const len = s[2] - s[1], z = s[1] + ((t * (22 + n * 5) + n * 97) % len);
      if (z > zmin && z < zmax) for (const g of [-0.72, 0.72]) glow([s[0] + g, 0.02, z], [s[0] + g, 0.02, Math.min(s[2], z + 7)], WHITE, 1.8, 0.95);
    });
    if (low > 0.02) {
      for (const x of [0, ...SIDINGS.map(s => s[0])]) {
        const tr = x === 0 ? [START, FORK] : SIDINGS.find(s => s[0] === x).slice(1);
        for (let z = Math.max(tr[0], Math.ceil((cz - 6) / 3) * 3); z < Math.min(tr[1], cz + 120); z += 3) seg([x - 1.15, 0, z], [x + 1.15, 0, z], x === 0 ? ORANGE : WHITE, 1, (x === 0 ? 0.34 : 0.26) * low);
      }
      // overhead line: masts, arms, wire, and a spark travelling along it
      for (let z = Math.ceil((cz - 20) / 28) * 28; z < Math.min(FORK, cz + cam.fog[1]); z += 28) {
        if (z < START) continue;
        const mxp = (z / 28) % 2 ? 4.4 : -4.4;
        seg([mxp, 0, z], [mxp, 7.6, z], WHITE, 1.2, 0.55 * low); seg([mxp * 0.86, 0, z], [mxp, 7.6, z], WHITE, 1, 0.25 * low);
        seg([mxp, 7.6, z], [0, 7.0, z], WHITE, 1, 0.5 * low); seg([mxp, 6.4, z], [mxp * 0.45, 7.3, z], WHITE, 1, 0.3 * low);
        for (let k = 0; k < 4; k++) seg([0, 7.0, z + k * 7], [0, 7.0, Math.min(FORK, z + k * 7 + 4.5)], WHITE, 1, 0.3 * low);
      }
      for (let k = 0; k < 3; k++) { const z = START + ((t * 150 + k * 190) % MAIN_LEN); if (z > zmin && z < zmax) glow([0, 7.0, z], [0, 7.0, z + 5], HOT, 2, low); }
    }

    // gantries: frame, sign plate, platform, and a scan curtain that flares when a train passes through
    GZ.forEach((z, i) => {
      if (z < zmin - 4 || z > zmax) return;
      const passed = cz > z - 14, col = passed ? ORANGE : WHITE, al = 0.85;
      const hit = marks.reduce((m, k) => Math.max(m, k.p[0] === 0 ? clamp(1 - Math.abs(k.p[2] - 14 - z) / 18) * k.fade : 0), 0);
      for (const x of [-11, 11]) { seg([x, 0, z], [x, 9.6, z], WHITE, 1.4, al); seg([x * 0.93, 0, z], [x * 0.93, 9.6, z], WHITE, 1, al * 0.5); for (let k = 0; k < 5; k++) seg([x, k * 1.9, z], [x * 0.93, k * 1.9 + 0.95, z], WHITE, 1, al * 0.4); }
      glow([-11, 9.6, z], [11, 9.6, z], col, 1.4, al); seg([-11, 7.7, z], [11, 7.7, z], WHITE, 1.2, al);
      for (let k = 0; k < 11; k++) seg([-11 + k * 2, k % 2 ? 9.6 : 7.7, z], [-9 + k * 2, k % 2 ? 7.7 : 9.6, z], WHITE, 1, al * 0.35);
      poly([[-5.6, 7.9, z - 0.1], [5.6, 7.9, z - 0.1], [5.6, 9.4, z - 0.1], [-5.6, 9.4, z - 0.1]], passed ? '40,40,42' : '12,13,16', 0.92);
      for (const [a, b] of [[[-5.6, 7.9], [5.6, 7.9]], [[5.6, 7.9], [5.6, 9.4]], [[5.6, 9.4], [-5.6, 9.4]], [[-5.6, 9.4], [-5.6, 7.9]]]) glow([a[0], a[1], z - 0.1], [b[0], b[1], z - 0.1], col, 1.3, 1);
      // the curtain thins out as the camera reaches it, so riding through it never veils the screen
      const near = high > 0.2 ? 1 : clamp((z - cz - 8) / 26);
      poly([[-3.4, 0, z], [3.4, 0, z], [3.4, 7.6, z], [-3.4, 7.6, z]], passed ? ORANGE : WHITE, (0.03 + 0.26 * hit) * near);
      const yy = 3.8 + 3.5 * Math.sin(t * 2.2 + i * 1.3);
      glow([-3.4, yy, z], [3.4, yy, z], hit > 0.05 ? HOT : col, 1.4, (0.35 + 0.65 * hit) * near);
      poly([[-3.2, 0.05, z - 14], [-7.5, 0.05, z - 14], [-7.5, 0.05, z + 14], [-3.2, 0.05, z + 14]], WHITE, 0.055);
      for (let k = -14; k < 14; k += 4) seg([-3.2, 0.06, z + k], [-3.2, 0.06, z + k + 2.4], ORANGE, 1.6, 0.9);
      seg([-7.5, 0.05, z - 14], [-7.5, 0.05, z + 14], WHITE, 1, 0.35); seg([-3.2, 0.05, z - 14], [-7.5, 0.05, z - 14], WHITE, 1, 0.35); seg([-3.2, 0.05, z + 14], [-7.5, 0.05, z + 14], WHITE, 1, 0.35);
    });
    // the judge: three rings turning around the last gantry
    if (GZ[6] > zmin - 30 && GZ[6] < zmax + 30) {
      const c = [0, 5.4, GZ[6]], a = t * 0.5, b = t * 0.36, vis = 1 - 0.35 * high;
      ring(c, 14, [Math.cos(a), 0, Math.sin(a)], [0, 1, 0], ORANGE, 1.5, 0.9 * vis, 0, 0);
      ring(c, 17, [1, 0, 0], [0, Math.cos(b), Math.sin(b)], WHITE, 1.2, 0.6 * vis, 0, 0);
      ring(c, 20.5, [1, 0, 0], [0, 1, 0], ORANGE, 1.3, 0.75 * vis, 8, Math.floor(t * 9));
    }
    glow([0, 0, FORK], [0, 170, FORK], ORANGE, 1.6, 0.5 * (1 - high), false);

    // branches, with light running out along each one
    for (const kind of ['long', 'short', 'depot']) {
      const col = VCOL[kind], n = kind === 'depot' ? 10 : 40, run = ((t * 0.42 + (kind === 'short' ? 0.4 : 0)) % 1) * n;
      for (let k = 0; k < n; k++) {
        const a = branch(kind, k / n), b = branch(kind, (k + 1) / n);
        if (a[2] > zmax) break;
        const hot = Math.abs(k - run) < 1.5;
        for (const g of [-0.72, 0.72]) glow([a[0] + g, a[1], a[2]], [b[0] + g, b[1], b[2]], hot ? HOT : col, hot ? 2.4 : 1.7, 1);
        if (k % 2 === 0) seg([a[0] - 1.15, a[1], a[2]], [a[0] + 1.15, a[1], a[2]], col, 1, 0.4);
        if (kind === 'long' && k % 3 === 0 && a[1] > 0.6) { seg([a[0] - 1.6, a[1], a[2]], [a[0] - 2.2, 0, a[2]], col, 1, 0.42); seg([a[0] + 1.6, a[1], a[2]], [a[0] + 2.2, 0, a[2]], col, 1, 0.42); seg([a[0] - 1.6, a[1], a[2]], [a[0] + 1.6, a[1], a[2]], col, 1, 0.4); seg([a[0] - 1.9, a[1] / 2, a[2]], [a[0] + 1.9, a[1] / 2, a[2]], col, 1, 0.25); }
        if (kind === 'short' && k % 2 === 0 && a[1] < -0.4) { for (const g of [-3.4, 3.4]) { seg([a[0] + g, 0, a[2]], [a[0] + g * 0.6, a[1], a[2]], col, 1, 0.38); seg([a[0] + g, 0, a[2]], [a[0] + g, 0, a[2] + 2.6], col, 1, 0.3); } }
      }
      const e = branch(kind, 1), pulse = 0.55 + 0.45 * Math.sin(t * 3 + e[0]);
      poly([[e[0] - 5, e[1], e[2]], [e[0] + 5, e[1], e[2]], [e[0] + 5, e[1] + 9, e[2]], [e[0] - 5, e[1] + 9, e[2]]], col, 0.1 + 0.1 * pulse);
      for (const [a, b] of [[[-5, 0], [-5, 9]], [[-5, 9], [5, 9]], [[5, 9], [5, 0]], [[-5, 0], [5, 0]]]) glow([e[0] + a[0], e[1] + a[1], e[2]], [e[0] + b[0], e[1] + b[1], e[2]], col, 1.5, 1);
      for (const [a, b] of [[[-3.4, 1.4], [-3.4, 7.6]], [[-3.4, 7.6], [3.4, 7.6]], [[3.4, 7.6], [3.4, 1.4]]]) seg([e[0] + a[0], e[1] + a[1], e[2]], [e[0] + b[0], e[1] + b[1], e[2]], col, 1, 0.5);
    }
    for (let z = 560; z <= DEPOT_END; z += 13) { seg([-4.5, 0, z], [-4.5, 6, z], GREY, 1, 0.7); seg([4.5, 0, z], [4.5, 6, z], GREY, 1, 0.7); seg([-4.5, 6, z], [0, 8, z], GREY, 1, 0.7); seg([4.5, 6, z], [0, 8, z], GREY, 1, 0.7); seg([-4.5, 3, z], [4.5, 6, z], GREY, 1, 0.25); }

    // parked rakes on the sidings, then the token trains
    // on the board every train is a real token, so the scenery rakes stay out of it
    if (!tracked) for (const [x, z0, cars] of PARKED) for (let c = 0; c < cars; c++) {
      const zb = z0 + c * 10.4; if (zb > zmax || zb + 10 < zmin) continue;
      car([x, 0, zb + 9.6], [x, 0, zb], WHITE, 0.3, false);
    }
    for (const m of marks) for (let c = 0; c < (m.one ? 1 : 3); c++) {
      const f = m.off ? add(m.off, [0, 0, 4.5]) : route(m.tk.to, m.s - c * 9.8), b = m.off ? add(m.off, [0, 0, -4.5]) : route(m.tk.to, m.s - c * 9.8 - 9);
      if (f[2] < zmin - 12 || f[2] > zmax + 10) continue;
      car(f, b, m.col, (c === 0 ? 1 : 0.7) * m.fade, c === 0 && (!m.one || m.live || m.sel));
      if (m.sel) glow(add(f, [0, 3.4, -4]), add(f, [0, 30, -4]), HOT, 1.6, 0.9, false);
    }
    // the pointer's marker on the ground: rings, a crosshair along the rails, a pin of light
    clock = t;
    const g = ground();
    if (g) {
      // kept small on purpose: one ring lying on the ground
      ring([g.p[0], 0.06, g.p[2]], 0.9 * g.k, [1, 0, 0], [0, 0, 1], ORANGE, 1.2, 0.7, 0, 0);
    }
    shocks = shocks.filter(s => t - s.t < 0.6);
    for (const s of shocks) {     // a click: one ripple that spreads a little and is gone
      const a = (t - s.t) / 0.6, e = 1 - Math.pow(1 - a, 3);
      ring([s.p[0], 0.08, s.p[2]], (0.9 + 2.2 * e) * s.k, [1, 0, 0], [0, 0, 1], HOT, 1.4, 1 - a, 0, 0);
    }
    flushFills(); flush();

    // text and lamps sit on top of the geometry
    GZ.forEach((z, i) => {
      if (z < zmin - 4 || z > zmax) return;
      const passed = cz > z - 14;
      if (flat) text([0, 12.4, z], `0${i + 1} ${STOPS[i].toUpperCase()}`, 0, WHITE, 0.95, 13, 900);
      else text([0, 8.65, z - 0.1], `0${i + 1}  ${STOPS[i].toUpperCase()}`, 1.05, passed ? HOT : WHITE, 1 - high);
      lamp([-9.2, 8.65, z - 0.1], 0.3, passed ? GREEN : RED, (0.8 + 0.2 * Math.sin(t * 4 + i)) * (1 - high), true);
      lamp([9.2, 8.65, z - 0.1], 0.3, passed ? GREEN : RED, (0.8 + 0.2 * Math.sin(t * 4 + i + 2)) * (1 - high), true);
      if (high > 0.25 && !flat) { const s = project([0, 0, z]); ctx.strokeStyle = `rgba(${WHITE},${high})`; ctx.lineWidth = 1.5; ctx.fillStyle = '#060708'; ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, 7); ctx.fill(); ctx.stroke(); text([-16, 0, z], STOPS[i].toUpperCase(), 0, WHITE, high * 0.9, 13, 800); }
    });
    for (const [kind, label] of [['long', 'LONG DESK'], ['short', 'SHORT DESK'], ['depot', 'DEPOT']]) {
      const e = branch(kind, 1);
      if (flat) text([e[0], e[1] + 13, e[2]], label, 0, VCOL[kind], 1, 14, 900); else text([e[0], e[1] + 10.6, e[2]], label, 1.5, VCOL[kind], 1 - high);
      lamp([e[0], e[1] + 4.5, e[2]], 0.5, VCOL[kind], 0.7 + 0.3 * Math.sin(t * 3 + e[0]), true);
      if (high > 0.25 && !flat) text([e[0] + (kind === 'long' ? 16 : kind === 'short' ? -16 : 0), 0, e[2] + (kind === 'depot' ? 34 : 0)], label, 0, VCOL[kind], high, 14, 900);
    }
    for (const m of marks) {
      if (m.p[2] < zmin - 10 || m.p[2] > zmax + 10) continue;
      lamp([m.p[0], m.p[1] + 1.7, m.p[2]], 0.36, m.col === WHITE ? HOT : m.col, m.fade, true);
      if (flat) text([m.p[0], m.p[1] + (m.sel ? 33 : 6.2), m.p[2] - 4], m.tk.sym, 0, m.sel ? HOT : m.col, m.sel ? 1 : m.fade, m.sel ? 20 : 11, 900);
      else text([m.p[0], m.p[1] + 4.6, m.p[2] - 2], m.tk.sym, 1.25, m.col, m.fade * (1 - high));
      // a token fresh off the Pons curve: a beacon over the train and a tag under its name
      if (m.grad && !flat) { lamp([m.p[0], m.p[1] + 3.4, m.p[2]], 0.75, HOT, m.fade * (0.75 + 0.25 * Math.sin(t * 5 + m.s)), true); text([m.p[0], m.p[1] + 6.4, m.p[2] - 2], 'GRADUATED', 0.55, GREEN, m.fade * (1 - high)); }
      if (high > 0.25 && !flat) text([m.p[0] + 11, m.p[1], m.p[2]], m.tk.sym, 0, m.col, m.fade * high, 12, 800);
    }
    // dust; it stretches into streaks when the camera is moving fast
    if (low > 0.02) {
      for (const d of dust) {
        const z = cz + (((d[2] - cz) % 130) + 130) % 130, x = d[0] + Math.sin(t * 0.2 + d[3] * 9) * 2;
        if (vel > 0.3) { seg([x, d[1], z], [x, d[1], z + vel * 3.2], d[3] > 0.7 ? ORANGE : WHITE, 1, 0.55 * low * (0.4 + 0.6 * d[3])); continue; }
        const c = toCam([x, d[1], z]); if (c[2] < 1) continue;
        ctx.fillStyle = `rgba(${WHITE},${fogAt(c[2]) * 0.5 * low * (0.4 + 0.6 * d[3])})`;
        const r = clamp(Fe * 0.05 / c[2], 0.5, 2.4);
        ctx.fillRect(sx(c), sy(c), r, r);
      }
      flush();
    }
    // bloom: a blurred copy of the frame added back on top; dropped if the machine cannot keep up
    slow += ((dt > 0.045 ? 1 : 0) - slow) * 0.03; if (slow > 0.6) bloom = false;
    if (bloom) {
      // multiplying the copy by itself twice keeps only the bright parts, so the blacks stay black
      fxc.globalCompositeOperation = 'source-over'; fxc.clearRect(0, 0, fx.width, fx.height); fxc.drawImage(canvas, 0, 0, fx.width, fx.height);
      fxc.globalCompositeOperation = 'multiply'; fxc.drawImage(fx, 0, 0); fxc.drawImage(fx, 0, 0);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'lighter';
      ctx.filter = 'blur(4px)'; ctx.globalAlpha = 0.8; ctx.drawImage(fx, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'blur(18px)'; ctx.globalAlpha = 0.7; ctx.drawImage(fx, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    // which stop the camera is at, for the page
    let stop = -1; GZ.forEach((z, i) => { if (cz > z - 44) stop = i; });
    const state = { p, camZ: cz, height: cam.pos[1], stop: cz > GZ[6] + 16 ? 7 : stop, high, speed: velS };
    for (const fn of listeners) fn(state, t);
  }

  let raf = 0, t0 = performance.now(), last = t0;
  function loop(now) { const dt = (now - last) / 1000; last = now; draw((now - t0) / 1000, dt); raf = requestAnimationFrame(loop); }
  resize(); addEventListener('resize', resize);
  if (document.fonts && document.fonts.load) document.fonts.load('800 20px "Big Shoulders Display"');
  raf = requestAnimationFrame(loop);

  return {
    setProgress(p) { pT = clamp(p); },
    setTokens(list) { if (list && list.length) tokens = list.slice(0, 9); },
    // [{ id, sym, state: 'wait' | 'run' | 'done' | 'dead', stop, to, sel }]: trains placed by real scan progress
    setTracked(list) { tracked = list; for (const k of trk.keys()) if (!list.some(i => i.id === k)) trk.delete(k); },
    onFrame(fn) { listeners.push(fn); },
    onHit(fn) { hits.push(fn); },
    // 1 holds the camera back above the approach, 0 lets it down onto the rails
    setIntro(k, now) { introK = k; if (now) introS = k; },
    project,
    stop() { cancelAnimationFrame(raf); }
  };
}
