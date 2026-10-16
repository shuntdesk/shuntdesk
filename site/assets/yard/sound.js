// The Yard, sound: everything synthesised with Web Audio, no files.
// A music bed (a slow lo-fi loop: electric piano chords, a round bass, soft drums), the world under it
// (the city's hum, rain, a crowd's murmur, a train's rumble and its wheels over the joints, brakes, a car going by,
// crickets after dark, a station chime) and one-shots for what you do.
let ctx = null, out = null, music = null, world = null, sfxBus = null, wet = null, noise = null, pink = null, on = true;
const L = {};
try { on = localStorage.getItem('shunt.yard.sound') !== 'off'; } catch (e) {}
export const soundOn = () => on;
export function setSound(v) { on = v; try { localStorage.setItem('shunt.yard.sound', v ? 'on' : 'off'); } catch (e) {} if (out) out.gain.setTargetAtTime(v ? 0.8 : 0, ctx.currentTime, 0.2); }
const hz = m => 440 * Math.pow(2, (m - 69) / 12);
const now = () => ctx.currentTime;

function buffers() {
  const n = ctx.sampleRate * 3, w = ctx.createBuffer(1, n, ctx.sampleRate), p = ctx.createBuffer(1, n, ctx.sampleRate), a = w.getChannelData(0), b = p.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
  for (let i = 0; i < n; i++) { const x = Math.random() * 2 - 1; a[i] = x; b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852; b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898; b[i] = (b0 + b1 + b2 + b3 + b4 + b5 + x * 0.5362) * 0.11; }
  noise = w; pink = p;
}
function src(buf) { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2.5); return s; }
function filt(type, f, q = 0.7) { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; }
function gain(v = 0) { const g = ctx.createGain(); g.gain.value = v; return g; }
function chain(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }
function lfo(rate, depth, target, type = 'sine') { const o = ctx.createOscillator(), g = gain(depth); o.type = type; o.frequency.value = rate; chain(o, g, target); o.start(); return o; }
const set = (g, v, t = 0.5) => g && g.gain.setTargetAtTime(v, now(), t);

export function startAudio() {
  if (ctx) { ctx.resume?.(); return; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  buffers();
  // a gentle compressor, then a hard limiter so nothing that stacks up can clip and crackle
  out = gain(on ? 0.8 : 0); const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
  const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1; chain(out, comp, lim, ctx.destination);
  music = gain(0.0); world = gain(0.9); sfxBus = gain(0.85); music.connect(out); world.connect(out); sfxBus.connect(out);
  // a soft room: decaying noise, darkened
  const ir = ctx.createBuffer(2, ctx.sampleRate * 2.4, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0; for (let i = 0; i < d.length; i++) { lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4; d[i] = lp * Math.pow(1 - i / d.length, 2.6); } }
  const conv = ctx.createConvolver(); conv.buffer = ir; wet = gain(0.32); chain(wet, conv, filt('lowpass', 5200), out);

  // the city: a low wash, and a mid band that swells as traffic comes and goes
  L.cityLow = chain(src(pink), filt('lowpass', 220), gain(0)); L.cityLow.connect(world);
  const mid = chain(src(pink), filt('bandpass', 650, 0.6), gain(0)); mid.connect(world); L.cityMid = mid; lfo(0.07, 0.012, mid.gain);
  // rain: pink noise in two bands
  L.rain = chain(src(pink), filt('highpass', 900), filt('lowpass', 7000), gain(0)); L.rain.connect(world);
  L.rainLow = chain(src(pink), filt('lowpass', 400), gain(0)); L.rainLow.connect(world);
  // a crowd: noise in the voice band, chopped by uneven tremolo so it reads as many people talking
  const crowd = chain(src(noise), filt('bandpass', 480, 1.4), filt('peaking', 1200), gain(0)); const amp = gain(1); crowd.connect(amp); amp.connect(world); L.crowd = crowd;
  lfo(3.1, 0.35, amp.gain); lfo(5.3, 0.25, amp.gain); lfo(0.4, 0.2, amp.gain);
  // a train close by: two rumbles and a low tone
  L.rumble = chain(src(pink), filt('lowpass', 95, 1.2), gain(0)); L.rumble.connect(world);
  L.rumble2 = chain(src(noise), filt('bandpass', 260, 0.8), gain(0)); L.rumble2.connect(world);
  { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 41; L.hum = chain(o, gain(0)); L.hum.connect(world); o.start(); lfo(0.6, 3, o.frequency); }
  // brakes: a thin squeal
  { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2650; lfo(5.5, 30, o.frequency); const g = gain(0); chain(o, filt('bandpass', 2650, 6), g); g.connect(world); const r = gain(0.4); g.connect(r); r.connect(wet); o.start(); L.brake = g; }
  // a car going by: engine and tyres
  { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 48; L.engOsc = o; L.engine = chain(o, filt('lowpass', 240), gain(0)); L.engine.connect(world); o.start(); L.tyres = chain(src(pink), filt('bandpass', 900, 0.5), gain(0)); L.tyres.connect(world); }
  L.t = { clack: 0, crick: 0, horn: 8, chime: 20, beat: 0, step16: 0, next: now() + 0.1, chord: 0 };
  startMusic();
}

// ---------- the music: a slow lo-fi loop, scheduled ahead on the audio clock ----------
const BPM = 76, S16 = 60 / BPM / 4;
const PROG = [[57, 60, 64, 67, 71], [50, 53, 57, 60, 64], [55, 59, 62, 65, 69], [48, 52, 55, 59, 62]];   // Am9, Dm9, G9, Cmaj9
const BASS = [45, 38, 43, 36];
let mTimer = 0;
function startMusic() {
  const look = () => { if (!ctx) return; while (L.t.next < now() + 0.15) { beat(L.t.step16, L.t.next); L.t.next += S16 * (L.t.step16 % 2 ? 0.88 : 1.12); L.t.step16 = (L.t.step16 + 1) % 128; } };
  mTimer = setInterval(look, 30);
}
function ep(m, t, v = 0.05, d = 2.2) {
  // an electric piano: FM with a quickly fading bell, through a warm filter
  const c = ctx.createOscillator(), mo = ctx.createOscillator(), mg = gain(hz(m) * 2.2), g = gain(0), f = filt('lowpass', 2400);
  c.frequency.value = hz(m); mo.frequency.value = hz(m) * 1.002; c.type = 'sine'; mo.type = 'sine';
  chain(mo, mg, c.frequency); chain(c, f, g, music); const r = gain(0.5); g.connect(r); r.connect(wet);
  mg.gain.setValueAtTime(hz(m) * 2.2, t); mg.gain.exponentialRampToValueAtTime(hz(m) * 0.08, t + 0.6);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  c.start(t); mo.start(t); c.stop(t + d + 0.1); mo.stop(t + d + 0.1);
}
function beat(i, t) {
  const bar = Math.floor(i / 16), ch = PROG[bar % 4], s = i % 16;
  // chords on the one and the and-of-two, a little spread like a hand
  if (s === 0 || s === 6) ch.forEach((m, k) => ep(m + 12 * (k > 2 ? 0 : 0), t + k * 0.012, s ? 0.028 : 0.04, s ? 1.4 : 2.6));
  if (s === 10 && bar % 2) ep(ch[4] + 12, t, 0.022, 1.1);
  if (s === 14 && bar % 4 === 3) ep(ch[3] + 12, t, 0.02, 0.9);
  // round bass
  if (s === 0 || s === 7 || (s === 10 && bar % 2)) { const o = ctx.createOscillator(), g = gain(0); o.type = 'triangle'; o.frequency.value = hz(BASS[bar % 4] + (s === 7 ? 7 : 0)); chain(o, filt('lowpass', 420), g, music); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7); o.start(t); o.stop(t + 0.75); }
  // soft kick, a brushed snare, a closed hat
  if (s === 0 || s === 9) { const o = ctx.createOscillator(), g = gain(0); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); chain(o, g, music); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.start(t); o.stop(t + 0.32); }
  if (s === 4 || s === 12) { const n = ctx.createBufferSource(); n.buffer = noise; const g = gain(0); chain(n, filt('bandpass', 1900, 0.8), g, music); const r = gain(0.6); g.connect(r); r.connect(wet); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); n.start(t, Math.random()); n.stop(t + 0.25); }
  if (s % 2 === 0) { const n = ctx.createBufferSource(); n.buffer = noise; const g = gain(0); chain(n, filt('highpass', 7500), g, music); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(s % 4 ? 0.004 : 0.007, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); n.start(t, Math.random()); n.stop(t + 0.06); }
}

// ---------- what the world sounds like this frame ----------
export function tickAudio(dt, s) {
  if (!ctx || !on) return;
  const inside = s.inside ? 0.35 : 1;
  set(music, s.title ? 0.55 : (0.26 + 0.12 * s.night) * (s.duck ? 0.4 : 1), 1.2);
  set(L.cityLow, (0.05 + 0.08 * s.city) * inside); set(L.cityMid, (0.012 + 0.035 * s.city) * inside);
  set(L.rain, 0.12 * s.rain * (s.inside ? 0.25 : 1)); set(L.rainLow, 0.08 * s.rain * inside);
  set(L.crowd, 0.05 * Math.min(1, s.crowd) * (s.inside ? 1.3 : 1), 0.6);
  const tr = Math.max(0, 1 - s.trainD / 80), v = Math.min(1, s.trainV / 14);
  set(L.rumble, 0.55 * tr * tr * v, 0.12); set(L.rumble2, 0.12 * tr * v, 0.12); set(L.hum, 0.08 * tr * v, 0.2);
  set(L.brake, s.braking ? 0.02 * Math.max(0, 1 - s.brakeD / 60) : 0, 0.15);
  // wheels over the rail joints: da-dum, twice a car
  if (tr > 0.04 && s.trainV > 1) { L.t.clack -= dt; if (L.t.clack <= 0) { L.t.clack = 10 / s.trainV / 2; const k = tr * Math.min(1, s.trainV / 10); thump(0.22 * k, 0); thump(0.16 * k, 0.11 + 0.6 / s.trainV); } }
  const cr = Math.max(0, 1 - s.carD / 28); set(L.engine, 0.035 * cr * cr, 0.2); set(L.tyres, 0.04 * cr * Math.min(1, s.carV / 10), 0.2); L.engOsc.frequency.setTargetAtTime(38 + s.carV * 4.5, now(), 0.3);
  // now and then a horn somewhere far off downtown
  if (s.city > 0.6 && !s.inside) { L.t.horn -= dt; if (L.t.horn <= 0) { L.t.horn = 12 + Math.random() * 25; farHorn(); } }
  if (s.night > 0.6 && s.green) { L.t.crick -= dt; if (L.t.crick <= 0) { L.t.crick = 0.25 + Math.random() * 1.1; chirp(); } }
  if (s.bellD < 60) { L.t.bell = (L.t.bell || 0) - dt; if (L.t.bell <= 0) { L.t.bell = 0.55; bell(Math.max(0, 1 - s.bellD / 60)); } }
  if (s.stationD < 45) { L.t.chime -= dt; if (L.t.chime <= 0) { L.t.chime = 35 + Math.random() * 25; chime(Math.max(0.3, 1 - s.stationD / 45)); } }
}

// ---------- one-shots ----------
function env(g, a, peak, d, t) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function nz({ f = 1000, type = 'bandpass', q = 0.8, peak = 0.2, a = 0.002, d = 0.1, room = 0.15, at = 0, buf = noise, bus = sfxBus } = {}) {
  if (!ctx || !on) return; const t = now() + at, n = ctx.createBufferSource(); n.buffer = buf; const g = gain(0); chain(n, filt(type, f, q), g, bus); if (room) { const r = gain(room); g.connect(r); r.connect(wet); }
  env(g, a, peak, d, t); n.start(t, Math.random() * 2); n.stop(t + a + d + 0.05);
}
function tn({ f = 440, f2 = null, type = 'sine', peak = 0.1, a = 0.005, d = 0.3, room = 0.25, at = 0, det = 0, lp = 0, bus = sfxBus } = {}) {
  if (!ctx || !on) return; const t = now() + at, o = ctx.createOscillator(), g = gain(0); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = det; if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  if (lp) chain(o, filt('lowpass', lp), g, bus); else chain(o, g, bus); if (room) { const r = gain(room); g.connect(r); r.connect(wet); }
  env(g, a, peak, d, t); o.start(t); o.stop(t + a + d + 0.05);
}
function thump(k, at) { nz({ f: 150, type: 'lowpass', q: 1.5, peak: k, d: 0.07, room: 0.05, at, buf: pink, bus: world }); nz({ f: 2300, q: 5, peak: k * 0.18, d: 0.03, room: 0.1, at, bus: world }); }
function chirp() { const f = 4300 + Math.random() * 700; for (let i = 0; i < 3; i++) tn({ f, peak: 0.008, a: 0.002, d: 0.025, room: 0.5, at: i * 0.055, bus: world }); }
function bell(k) { tn({ f: 1046, peak: 0.035 * k, d: 0.45, room: 0.3, bus: world }); tn({ f: 2093, peak: 0.012 * k, d: 0.25, room: 0.3, bus: world }); }
function farHorn() { const f = 330 + Math.random() * 80; tn({ f, type: 'square', peak: 0.006, a: 0.02, d: 0.25, lp: 900, room: 0.9, bus: world }); if (Math.random() < 0.5) tn({ f, type: 'square', peak: 0.006, a: 0.02, d: 0.18, lp: 900, room: 0.9, at: 0.35, bus: world }); }
function chime(k) { [76, 72, 67, 72].forEach((m, i) => tn({ f: hz(m), type: 'sine', peak: 0.045 * k, a: 0.01, d: 1.4, room: 0.8, at: i * 0.42, bus: world })); }
export const sfx = {
  step: (run, inside) => { nz({ f: (run ? 240 : 190) + Math.random() * 60, type: 'lowpass', q: 1.2, peak: run ? 0.11 : 0.07, d: run ? 0.06 : 0.05, room: inside ? 0.35 : 0.04, buf: pink }); nz({ f: 3200 + Math.random() * 800, q: 2, peak: run ? 0.012 : 0.007, d: 0.02, room: 0 }); },
  land: () => nz({ f: 160, type: 'lowpass', q: 1.2, peak: 0.25, d: 0.14, room: 0.1, buf: pink }),
  lever: () => { nz({ f: 120, type: 'lowpass', q: 2, peak: 0.35, d: 0.22, room: 0.25, buf: pink }); nz({ f: 2600, q: 6, peak: 0.08, d: 0.06, room: 0.3, at: 0.14 }); tn({ f: 70, f2: 48, type: 'sine', peak: 0.12, d: 0.2, room: 0, at: 0.14 }); },
  horn: (k = 1) => { // a two-tone air horn, the second note held
    [[349, 0], [440, 0]].forEach(([f], i) => { tn({ f, type: 'sawtooth', peak: 0.03 * k, a: 0.08, d: 0.7, lp: 1500, room: 0.7, det: 4 }); tn({ f, type: 'square', peak: 0.012 * k, a: 0.08, d: 0.7, lp: 1100, room: 0.7, det: -5 }); tn({ f, type: 'sawtooth', peak: 0.03 * k, a: 0.08, d: 1.3, lp: 1500, room: 0.7, at: 0.95, det: 4 }); });
  },
  good: () => [72, 76, 79, 84].forEach((m, i) => tn({ f: hz(m), type: 'triangle', peak: 0.06, d: 0.6, room: 0.5, at: i * 0.07 })),
  bad: () => { tn({ f: hz(52), type: 'triangle', peak: 0.08, d: 0.5, room: 0.3 }); tn({ f: hz(51), type: 'triangle', peak: 0.06, d: 0.7, room: 0.3, at: 0.18 }); },
  crash: () => { nz({ f: 120, type: 'lowpass', q: 1, peak: 0.6, a: 0.005, d: 1.6, room: 0.5, buf: pink }); nz({ f: 1800, q: 0.6, peak: 0.12, d: 1.1, room: 0.6 }); for (let i = 0; i < 6; i++) nz({ f: 3000 + Math.random() * 3000, q: 8, peak: 0.04, d: 0.08, room: 0.4, at: 0.1 + Math.random() * 0.9 }); },
  mission: () => { [67, 71, 74, 79].forEach((m, i) => tn({ f: hz(m), type: 'triangle', peak: 0.055, d: 0.9, room: 0.6, at: i * 0.09 })); tn({ f: hz(43), type: 'sine', peak: 0.1, d: 1.4, room: 0.2 }); },
  ui: () => tn({ f: 1320, type: 'sine', peak: 0.025, d: 0.05, room: 0.1 }),
  swing: () => nz({ f: 700, q: 0.7, peak: 0.08, a: 0.03, d: 0.12, room: 0.1, buf: pink }),
  hit: () => { nz({ f: 180, type: 'lowpass', q: 1.5, peak: 0.4, d: 0.12, room: 0.2, buf: pink }); nz({ f: 1300, q: 1, peak: 0.06, d: 0.05, room: 0.2 }); },
  hurt: () => { nz({ f: 150, type: 'lowpass', peak: 0.35, d: 0.2, room: 0.2, buf: pink }); tn({ f: 180, f2: 110, type: 'triangle', peak: 0.06, d: 0.25, room: 0.2 }); },
  groan: (k = 1) => { if (!ctx || !on) return; const t = now(), o = ctx.createOscillator(), f = filt('bandpass', 420, 5), g = gain(0); o.type = 'sawtooth'; o.frequency.setValueAtTime(80 + Math.random() * 25, t); o.frequency.linearRampToValueAtTime(58, t + 1.1); f.frequency.setValueAtTime(520, t); f.frequency.linearRampToValueAtTime(300, t + 1.1); chain(o, f, g, world); const r = gain(0.5); g.connect(r); r.connect(wet); env(g, 0.2, 0.06 * k, 1, t); o.start(t); o.stop(t + 1.3); },
  door: () => nz({ f: 380, type: 'lowpass', peak: 0.12, d: 0.25, room: 0.6, buf: pink }),
  coffee: () => { tn({ f: 1568, peak: 0.035, d: 0.3, room: 0.4 }); nz({ f: 2600, q: 0.5, peak: 0.03, a: 0.12, d: 0.7, room: 0.2 }); },
  coin: () => { tn({ f: 1568, type: 'square', peak: 0.025, d: 0.06, lp: 4000, room: 0.2 }); tn({ f: 2093, type: 'square', peak: 0.025, d: 0.18, lp: 4000, room: 0.3, at: 0.07 }); },
  cheer: (k = 1) => { for (let i = 0; i < 3; i++) nz({ f: 900 + i * 400, q: 0.5, peak: 0.05 * k, a: 0.3, d: 1.6 + i * 0.3, room: 0.6, at: i * 0.1, bus: world }); },
  thunder: () => { nz({ f: 90, type: 'lowpass', q: 0.8, peak: 0.6, a: 0.05, d: 3.2, room: 0.7, buf: pink, bus: world }); nz({ f: 400, type: 'lowpass', q: 0.6, peak: 0.25, a: 0.01, d: 0.8, room: 0.6, buf: pink, bus: world }); },
  purr: () => { for (let i = 0; i < 8; i++) nz({ f: 140, type: 'lowpass', q: 2, peak: 0.08, a: 0.04, d: 0.08, room: 0.1, at: i * 0.09, buf: pink }); },  shot: (big) => { nz({ f: big ? 600 : 1400, q: 0.6, peak: big ? 0.5 : 0.35, a: 0.001, d: big ? 0.35 : 0.18, room: 0.5 }); nz({ f: 90, type: 'lowpass', peak: big ? 0.6 : 0.35, a: 0.001, d: 0.25, room: 0.3, buf: pink }); },
  pa: () => { [76, 72, 67, 72].forEach((m, i) => { tn({ f: hz(m), type: 'sine', peak: 0.07, a: 0.01, d: 1.5, room: 0.9, at: i * 0.42 }); tn({ f: hz(m + 12), type: 'sine', peak: 0.012, a: 0.01, d: 0.8, room: 0.9, at: i * 0.42 }); }); },
  whistle: (k = 1) => { for (const [at, d] of [[0, 0.18], [0.26, 0.5]]) { if (!ctx || !on) return; const t = now() + at, o = ctx.createOscillator(), g = gain(0); o.type = 'sine'; o.frequency.setValueAtTime(3150, t); lfo(38, 140, o.frequency); chain(o, g, sfxBus); const r = gain(0.5); g.connect(r); r.connect(wet); env(g, 0.01, 0.05 * k, d, t); o.start(t); o.stop(t + d + 0.05); } },
  flutter: () => { for (let i = 0; i < 10; i++) nz({ f: 700 + Math.random() * 500, q: 1.2, peak: 0.05, a: 0.004, d: 0.04, room: 0.2, at: i * 0.045 + Math.random() * 0.02, buf: pink }); },
  doors: () => { nz({ f: 900, q: 0.8, peak: 0.05, a: 0.3, d: 0.6, room: 0.3, buf: pink }); tn({ f: 880, type: 'square', peak: 0.012, d: 0.12, lp: 2000, room: 0.3 }); tn({ f: 880, type: 'square', peak: 0.012, d: 0.12, lp: 2000, room: 0.3, at: 0.25 }); tn({ f: 880, type: 'square', peak: 0.012, d: 0.12, lp: 2000, room: 0.3, at: 0.5 }); },  wheel: () => [60, 64, 67, 72, 76].forEach((m, i) => tn({ f: hz(m + 12), type: 'sine', peak: 0.035, d: 1.1, room: 0.8, at: i * 0.13 })),
};
