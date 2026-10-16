// The Yard, the people: the shunter, the townsfolk who walk the blocks or sit in the diner, the RISKY who come
// out after dark, and the cars of Eastgate. Characters are Kenney's Mini Characters (CC0 1.0, kenney.nl).
import { THREE, scene, M, box, glow, label, additive, rnd, setSeed, pick, TOUCH, clamp, lerp, damp, nightMats, haloTex } from './core.js';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { clone as skClone } from '../vendor/jsm/utils/SkeletonUtils.js';
import { DISTRICTS, SPOTS, carRoutes, LAKE, WHEEL as BIGWHEEL, ACTORS, PACERS } from './city.js';
import { STAFF, PASSENGERS, PLATFORMS, CROSSINGS } from './rail.js';

export const NAMES = ['female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f', 'male-a', 'male-b', 'male-c', 'male-d', 'male-f'];
export const HERO = 'male-e';
const T = {}, loader = new GLTFLoader();
async function load(n) {
  const g = await loader.loadAsync(`/assets/vendor/models/people/${n}.glb`);
  g.scene.updateMatrixWorld(true);
  const h = new THREE.Box3().setFromObject(g.scene, true).getSize(new THREE.Vector3()).y;
  g.scene.traverse(o => { if (o.isMesh && o.material && !o.material.userData.done) { o.material.userData.done = true; o.material.roughness = 0.75; o.material.metalness = 0; o.material.color.setScalar(0.82); } });
  T[n] = { scene: g.scene, clips: g.animations, h };
}
export const loadHero = () => load(HERO);
export const loadTown = () => Promise.all(NAMES.map(load));

export function makePerson(name, { height = 1.7, tint = null, shadow = false } = {}) {
  const t = T[name]; const root = skClone(t.scene); root.scale.setScalar(height / t.h);
  root.traverse(o => { if (!o.isMesh) return; o.castShadow = shadow; if (tint) { o.material = o.material.clone(); o.material.color.copy(tint); o.material.emissive = new THREE.Color(0x0a1a08); } });
  const g = new THREE.Group(); g.add(root); scene.add(g);
  const mixer = new THREE.AnimationMixer(root), acts = {};
  for (const c of t.clips) acts[c.name] = mixer.clipAction(c);
  const p = { g, root, mixer, acts, cur: null, model: name };
  p.play = (n, fade = 0.25, ts = 1) => { const a = acts[n]; if (!a) return; a.timeScale = ts; if (p.cur === a) return; a.reset().setEffectiveWeight(1).fadeIn(fade).play(); if (p.cur) p.cur.fadeOut(fade); p.cur = a; };
  p.once = (n, fade = 0.15, ts = 1) => { const a = acts[n]; if (!a) return; a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = ts; a.reset().setEffectiveWeight(1).fadeIn(fade).play(); if (p.cur && p.cur !== a) p.cur.fadeOut(fade); p.cur = a; };
  return p;
}

// ---------- the townsfolk ----------
export const folk = [];
const RING = [0, 1, 3, 2];
const corner = (b, c) => new THREE.Vector3(c & 1 ? b.x1 - 1.6 : b.x0 + 1.6, 0, c & 2 ? b.z1 - 1.6 : b.z0 + 1.6);
function nextCorner(f) {
  const D = DISTRICTS[f.d], b = D.blocks[f.i][f.j];
  // now and then, cross the road to the next block
  if (rnd() < 0.3) {
    const c = f.c, flipX = rnd() < 0.5, ni = flipX ? f.i + (c & 1 ? 1 : -1) : f.i, nj = flipX ? f.j : f.j + (c & 2 ? 1 : -1);
    if (D.blocks[ni] && D.blocks[ni][nj]) { f.i = ni; f.j = nj; f.c = flipX ? c ^ 1 : c ^ 2; f.to = corner(D.blocks[ni][nj], f.c); return; }
  }
  const k = RING.indexOf(f.c); f.c = RING[(k + f.dir + 4) % 4]; f.to = corner(b, f.c);
}
export function spawnTown() {
  setSeed(77);
  const walkers = TOUCH ? 30 : 72;
  for (let n = 0; n < walkers; n++) {
    const d = rnd() < 0.5 ? 'west' : 'east', D = DISTRICTS[d], i = Math.floor(rnd() * D.blocks.length), j = Math.floor(rnd() * D.blocks[0].length), c = RING[Math.floor(rnd() * 4)];
    const p = makePerson(pick(NAMES), { height: 1.55 + rnd() * 0.3 }), b = D.blocks[i][j], at = corner(b, c);
    const f = { p, kind: 'walk', d, i, j, c, dir: rnd() < 0.5 ? 1 : -1, v: 1.15 + rnd() * 0.5, pos: at.clone(), yaw: 0, to: null };
    nextCorner(f); folk.push(f); p.play('walk', 0, f.v / 1.4);
  }
  // joggers round Liquidity Lake
  for (let n = 0; n < (TOUCH ? 3 : 8); n++) { const p = makePerson(pick(NAMES), { height: 1.6 + rnd() * 0.25 }); const f = { p, kind: 'jog', a: rnd() * Math.PI * 2, w: (rnd() < 0.5 ? 1 : -1) * (0.035 + rnd() * 0.02), pos: new THREE.Vector3(), yaw: 0 }; p.play('sprint', 0, 0.6); folk.push(f); }
  // townsfolk at one thing on a loop: food-truck queues, the busker's crowd, the court, the building site, platforms
  for (const s of ACTORS) { if (!s.always && rnd() > (s.chance ?? 1) * (TOUCH ? 0.55 : 1)) continue; const p = makePerson(pick(NAMES), { height: 1.55 + rnd() * 0.3 }); const f = { p, kind: 'stay', pos: new THREE.Vector3(s.x, s.y || 0, s.z), yaw: s.yaw ?? rnd() * 6, act: s.a }; p.play(s.a, 0, s.ts || 1); p.mixer.setTime(rnd() * 3); folk.push(f); }
  // the stations: staff all in the same uniform, and the people waiting for a train
  for (const [list, uniform] of [[STAFF, true], [PASSENGERS, false]]) for (const s of list) {
    if (!uniform && TOUCH && rnd() < 0.45) continue;
    const p = makePerson(uniform ? 'male-c' : NAMES.filter(n => n !== 'male-c')[Math.floor(Math.random() * (NAMES.length - 1))], { height: 1.58 + Math.random() * 0.28 });
    const y = s.y || 0;
    if (s.route) { const f = { p, kind: 'route', route: s.route, ri: Math.floor(rnd() * s.route.length), state: 'walk', t: 0, v: 1.1 + rnd() * 0.3, guard: s.guard, pos: new THREE.Vector3(s.route[0][0], y, s.route[0][1]), yaw: 0 }; f.pos.set(s.route[f.ri][0], y, s.route[f.ri][1]); f.state = 'do'; f.t = rnd() * 3; p.play(s.route[f.ri][2], 0); folk.push(f); continue; }
    if (s.wander) { const f = { p, kind: 'wander', rect: s.wander, state: 'do', t: rnd() * 4, v: 1 + rnd() * 0.35, to: new THREE.Vector3(), pos: new THREE.Vector3(lerp(s.wander[0], s.wander[1], rnd()), y, lerp(s.wander[2], s.wander[3], rnd())), yaw: rnd() * 6 }; p.play('idle', 0); folk.push(f); continue; }
    if (s.board) { const pf = PLATFORMS.find(q => q.id === s.board), f = { p, kind: 'board', pf, state: rnd() < 0.3 ? 'gone' : 'wait', t: 0, v: 1.2 + rnd() * 0.3, home: new THREE.Vector3(s.x, y, s.z), to: new THREE.Vector3(), pos: new THREE.Vector3(s.x, y, s.z), yaw: pf.door > pf.edge ? Math.PI / 2 : -Math.PI / 2 }; p.play('idle', 0); p.mixer.setTime(rnd() * 3); folk.push(f); continue; }
    if (s.pace) { const f = { p, kind: 'pace', a: s.pace[0], b: s.pace[1], k: rnd(), dir: rnd() < 0.5 ? 1 : -1, v: 1 + rnd() * 0.4, y: s.y || 0, pos: new THREE.Vector3(s.pace[0][0], s.y || 0, s.pace[0][1]), yaw: 0 }; p.play('walk', 0, 0.75); folk.push(f); }
    else { const f = { p, kind: 'stay', pos: new THREE.Vector3(s.x, s.y || 0, s.z), yaw: s.yaw ?? rnd() * 6, act: s.a }; p.play(s.a, 0, s.ts || 1); p.mixer.setTime(rnd() * 3); folk.push(f); }
  }
  // the yard crew, walking the lines in hi-vis
  for (const pc of PACERS) { const p = makePerson('male-e', { height: 1.65 + rnd() * 0.1 }); const f = { p, kind: 'pace', a: pc.a, b: pc.b, k: rnd(), dir: 1, v: 1.2, pos: new THREE.Vector3(pc.a[0], 0, pc.a[1]), yaw: 0 }; p.play('walk', 0, 0.85); folk.push(f); }
  // a queue for The Wheel
  for (let n = 0; n < 4; n++) SPOTS.stand.push({ x: BIGWHEEL.x - 3 + n * 1.3, z: BIGWHEEL.z + 7.5 + (n % 2) * 0.6, yaw: Math.PI, place: 'wheel' });
  // people with somewhere to be: seats, counters, desks, the station concourse
  const spots = [...SPOTS.sit.map(s => ({ ...s, a: 'sit' })), ...SPOTS.work.map(s => ({ ...s, a: 'interact-right' })), ...SPOTS.stand.map(s => ({ ...s, a: 'idle' }))];
  for (const s of spots) { if (TOUCH && rnd() < 0.4) continue; const p = makePerson(pick(NAMES), { height: 1.55 + rnd() * 0.3 }); const f = { p, kind: 'stay', pos: new THREE.Vector3(s.x, 0, s.z), yaw: s.yaw ?? rnd() * 6, act: s.a }; p.play(s.a, 0, s.a === 'interact-right' ? 0.5 : 1); p.mixer.setTime(rnd() * 3); folk.push(f); }
}
const tv = new THREE.Vector3();
// walkers who drift far from the shunter come back on a block near them, so the streets stay full where you are
function recycle(f, hero) {
  const d = hero.x < -40 ? 'west' : hero.x > 40 ? 'east' : (Math.random() < 0.5 ? 'west' : 'east'), D = DISTRICTS[d];
  for (let n = 0; n < 8; n++) {
    const i = Math.floor(Math.random() * D.blocks.length), j = Math.floor(Math.random() * D.blocks[0].length), b = D.blocks[i][j], dd = Math.hypot(b.cx - hero.x, b.cz - hero.z);
    if (dd < 35 || dd > 130) continue;
    f.d = d; f.i = i; f.j = j; f.c = RING[Math.floor(Math.random() * 4)]; f.pos.copy(corner(b, f.c)); nextCorner(f); return;
  }
}
const JCROSS = CROSSINGS.find(c => c.z === -30);
// walk toward a point on the ground (at the walker's own height); true on arrival
function walkTo(f, x, z, dt) {
  const dx = x - f.pos.x, dz = z - f.pos.z, L = Math.hypot(dx, dz);
  if (L < 0.25) return true;
  if (f.p.cur !== f.p.acts.walk) f.p.play('walk', 0.2, f.v / 1.4);
  const k = Math.min(L, f.v * dt) / L; f.pos.x += dx * k; f.pos.z += dz * k;
  let d = Math.atan2(dx, dz) - f.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); f.yaw += d * damp(dt, 9);
  return false;
}
// what happens on a platform when a train arrives or leaves: people get off, people get on, the guard waves it out
export function stationEvent(kind, pf) {
  const t = pf.train; if (!t) return;
  const a = t.dir > 0 ? t.s - t.len : t.s, b = t.dir > 0 ? t.s : t.s + t.len, lo = Math.max(pf.z0 + 1, a + 2), hi = Math.min(pf.z1 - 1, b - 2);
  for (const f of folk) {
    if (f.kind === 'board' && f.pf === pf) {
      if (kind === 'arrive' && f.state === 'gone' && hi > lo) { f.state = 'alight'; f.t = Math.random() * 4; f.pos.set(pf.door, f.home.y, lo + Math.random() * (hi - lo)); f.to.set(lerp(f.home.x, pf.edge + (pf.door > pf.edge ? -3.5 : 3.5), Math.random() * 0.6), 0, lerp(pf.z0 + 3, pf.z1 - 3, Math.random())); }
      else if (kind === 'arrive' && f.state === 'wait' && Math.random() < 0.55 && f.pos.z > lo && f.pos.z < hi) { f.state = 'boarding'; f.t = 4 + Math.random() * 7; }
      else if (kind === 'depart' && f.state === 'boarding') { f.state = 'wait'; f.p.play('idle', 0.3); }
    }
    if (f.kind === 'route' && f.guard === pf.id && kind === 'closing') { f.state = 'do'; f.t = 3.5; f.yaw = pf.door > pf.edge ? Math.PI / 2 : -Math.PI / 2; f.p.play('emote-yes', 0.2, 1.2); }
  }
}

// ---------- pigeons: on the platforms and in the square, and they do not like being run at ----------
export const pigeons = [];
export function spawnPigeons(spots) {
  const body = M(0x6f7278, { roughness: 0.8 }), neck = M(0x4a6a6a, { roughness: 0.6, metalness: 0.3 }), wingM = M(0x5a5d62, { roughness: 0.8 });
  for (const [x, y, z, n] of spots) for (let i = 0; i < n; i++) {
    const g = new THREE.Group(); scene.add(g);
    box(0.2, 0.18, 0.34, body, 0, 0.16, 0, g); const head = box(0.12, 0.12, 0.13, neck, 0, 0.3, 0.17, g); box(0.04, 0.03, 0.06, M(0xc9a060), 0, 0.29, 0.25, g);
    const wl = new THREE.Group(), wr = new THREE.Group(); wl.position.set(-0.1, 0.22, 0); wr.position.set(0.1, 0.22, 0); g.add(wl, wr); box(0.34, 0.03, 0.22, wingM, -0.17, 0, 0, wl); box(0.34, 0.03, 0.22, wingM, 0.17, 0, 0, wr);
    const home = new THREE.Vector3(x + (Math.random() - 0.5) * 6, y, z + (Math.random() - 0.5) * 6);
    pigeons.push({ g, head, wl, wr, home, pos: home.clone(), vel: new THREE.Vector3(), state: 'peck', t: Math.random() * 5, yaw: Math.random() * 6 });
  }
}
export function runPigeons(dt, hero, speed, onFlush) {
  let flushed = false;
  for (const b of pigeons) {
    const d = Math.hypot(hero.x - b.pos.x, hero.z - b.pos.z);
    if (b.state === 'peck') {
      b.t -= dt; b.head.position.y = 0.3 - Math.max(0, Math.sin(b.t * 9)) * 0.12; b.head.position.z = 0.17 + Math.max(0, Math.sin(b.t * 9)) * 0.06;
      if (b.t < 0) { b.t = 1 + Math.random() * 4; b.yaw += (Math.random() - 0.5) * 2; b.pos.x += Math.sin(b.yaw) * 0.25; b.pos.z += Math.cos(b.yaw) * 0.25; }
      if (d < (speed > 4 ? 5 : 1.8)) { b.state = 'fly'; b.t = 7; const ax = b.pos.x - hero.x, az = b.pos.z - hero.z, l = Math.hypot(ax, az) || 1; b.vel.set(ax / l * (4 + Math.random() * 3), 4 + Math.random() * 3, az / l * (4 + Math.random() * 3)); b.yaw = Math.atan2(b.vel.x, b.vel.z); flushed = true; }
    } else if (b.state === 'fly') {
      b.t -= dt; b.vel.y += dt * 0.6; b.pos.addScaledVector(b.vel, dt); const fl = Math.sin(performance.now() / 45 + b.home.x) * 0.9; b.wl.rotation.z = fl; b.wr.rotation.z = -fl;
      if (b.t < 0) { b.state = 'away'; b.t = 20 + Math.random() * 20; b.g.visible = false; }
    } else if ((b.t -= dt) < 0 && Math.hypot(hero.x - b.home.x, hero.z - b.home.z) > 25) { b.state = 'peck'; b.pos.copy(b.home); b.g.visible = true; b.wl.rotation.z = b.wr.rotation.z = 0; b.t = 2; }
    b.g.position.copy(b.pos); b.g.rotation.y = b.yaw;
  }
  if (flushed && onFlush) onFlush();
}
let recycled = 0;
export function runTown(dt, camPos, hero) {
  recycled = 0;
  for (const f of folk) {
    if (f.kind === 'walk' && recycled < 3 && f.pos.distanceToSquared(camPos) > 175 * 175) { recycle(f, hero); recycled++; }
    const far = f.pos.distanceToSquared(camPos); f.p.g.visible = far < (f.kind === 'stay' ? 85 : 130) ** 2;
    if (f.talk) { f.yaw = Math.atan2(hero.x - f.pos.x, hero.z - f.pos.z); }
    else if (f.kind === 'route') {
      const st = f.route[f.ri];
      if (f.state === 'walk') { if (walkTo(f, st[0], st[1], dt)) { f.state = 'do'; f.t = st[3] * (0.8 + Math.random() * 0.4); f.p.play(st[2], 0.25, st[2] === 'interact-right' ? 0.7 : 1); } }
      else if ((f.t -= dt) <= 0) { f.ri = (f.ri + 1) % f.route.length; f.state = 'walk'; }
    }
    else if (f.kind === 'wander') {
      if (f.state === 'walk') { if (walkTo(f, f.to.x, f.to.z, dt)) { f.state = 'do'; f.t = 2 + Math.random() * 6; f.p.play(pick(['idle', 'idle', 'emote-yes', 'interact-right']), 0.3, 0.6); } }
      else if ((f.t -= dt) <= 0) { const r = f.rect; f.to.set(lerp(r[0], r[1], Math.random()), 0, lerp(r[2], r[3], Math.random())); f.state = 'walk'; }
    }
    else if (f.kind === 'board') {
      const pf = f.pf;
      if (f.state === 'boarding' && (f.t -= dt) <= 0) { if (walkTo(f, pf.door, f.pos.z, dt)) f.state = 'gone'; }
      else if (f.state === 'alight') { if ((f.t -= dt) <= 0) { f.p.g.visible = true; if (walkTo(f, f.to.x, f.to.z, dt)) { f.state = 'wait'; f.yaw = pf.door > pf.edge ? Math.PI / 2 : -Math.PI / 2; f.p.play(Math.random() < 0.25 ? 'emote-yes' : 'idle', 0.3, 0.5); } } }
    }
    else if (f.kind === 'cross') {
      const X = JCROSS, inward = f.dir > 0 ? f.pos.x < 0 : f.pos.x > 0, atGate = Math.abs(f.pos.x) > 40.2 && Math.abs(f.pos.x) < 42.5;
      if (f.state === 'rest') { if ((f.t -= dt) <= 0) { f.state = 'walk'; f.p.play('walk', 0.2, 0.8); } }
      else if (X && X.busy && inward && atGate) { if (f.state !== 'held') { f.state = 'held'; f.p.play('idle', 0.3); f.yaw = f.dir > 0 ? Math.PI / 2 : -Math.PI / 2; } }
      else { if (f.state === 'held') f.state = 'walk'; const tx = f.dir * 54; if (walkTo(f, tx, f.lane, dt)) { f.dir *= -1; f.state = 'rest'; f.t = 2 + Math.random() * 8; f.p.play('idle', 0.3); } }
    }
    else if (f.kind === 'pace') { const L = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]); f.k += f.dir * f.v * dt / L; if (f.k > 1 || f.k < 0) { f.dir *= -1; f.k = clamp(f.k, 0, 1); } f.pos.set(lerp(f.a[0], f.b[0], f.k), f.y || 0, lerp(f.a[1], f.b[1], f.k)); f.yaw = Math.atan2((f.b[0] - f.a[0]) * f.dir, (f.b[1] - f.a[1]) * f.dir); }
    else if (f.kind === 'jog') { f.a += f.w * dt * 3; const rx = LAKE.rx + 9, rz = LAKE.rz + 9, nx = LAKE.x + Math.cos(f.a) * rx, nz = LAKE.z + Math.sin(f.a) * rz; f.yaw = Math.atan2(nx - f.pos.x, nz - f.pos.z) || f.yaw; f.pos.set(nx, 0, nz); }
    else if (f.kind === 'walk') {
      tv.subVectors(f.to, f.pos); tv.y = 0; const L = tv.length();
      // step aside for the shunter
      const hx = hero.x - f.pos.x, hz = hero.z - f.pos.z, hd = Math.hypot(hx, hz);
      if (L < 0.3) nextCorner(f);
      else { tv.multiplyScalar(1 / L); if (hd < 1.2) { f.pos.x -= hx / hd * dt * 1.5; f.pos.z -= hz / hd * dt * 1.5; } f.pos.addScaledVector(tv, Math.min(L, f.v * dt)); const want = Math.atan2(tv.x, tv.z); let d = want - f.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); f.yaw += d * damp(dt, 8); }
    }
    if (f.kind === 'board' && (f.state === 'gone' || (f.state === 'alight' && f.t > 0))) f.p.g.visible = false;
    f.p.g.position.copy(f.pos); f.p.g.rotation.y = f.yaw;
    // near: every frame; middle distance: a few times a second; far: not at all
    f.skip = (f.skip || 0) + dt;
    if (far < 30 * 30) { f.p.mixer.update(f.skip); f.skip = 0; } else if (far < 90 * 90 && f.skip > (far < 55 * 55 ? 0.05 : 0.15)) { f.p.mixer.update(f.skip); f.skip = 0; }
  }
}

// ---------- the RISKY: they come out of the Crash Site after dark ----------
export const zombies = [];
const zTint = [new THREE.Color(0.55, 0.78, 0.5), new THREE.Color(0.6, 0.7, 0.62), new THREE.Color(0.5, 0.72, 0.58)];
export function spawnZombie(x, z, kind = 'RISKY') {
  const boss = kind === 'RUG PULL', big = kind === 'RUG' || boss, p = makePerson(pick(NAMES), { height: boss ? 3.9 : big ? 2.1 : 1.6 + rnd() * 0.2, tint: pick(zTint) });
  const tag = label(kind, { size: 44, accent: big ? '#ff4d5e' : '#9fd48a', scale: 0.012, color: big ? '#ff8a94' : '#c9e8b8' }); tag.position.y = boss ? 4.6 : big ? 2.6 : 2.15; if (boss) tag.scale.multiplyScalar(1.8); p.g.add(tag);
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: big ? 0xff3b4e : 0x6aff8a, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending })); aura.scale.set(2.4, 2.4, 1); aura.position.y = 1; p.g.add(aura);
  const zz = { p, pos: new THREE.Vector3(x, 0, z), yaw: rnd() * 6, hp: boss ? 22 : big ? 4 : 2, boss, state: 'walk', v: boss ? 1.7 : big ? 1.3 : 1.55 + rnd() * 0.4, cool: 0, t: 0, kind, wander: new THREE.Vector3(x, 0, z), flash: 0, tag };
  p.play('walk', 0, 0.6); zombies.push(zz); return zz;
}
export function hitZombie(zz, from) {
  if (zz.state === 'dead') return false;
  zz.hp--; zz.flash = 0.25; const dx = zz.pos.x - from.x, dz = zz.pos.z - from.z, d = Math.hypot(dx, dz) || 1; zz.pos.x += dx / d * 1.2; zz.pos.z += dz / d * 1.2;
  if (zz.hp <= 0) { zz.state = 'dead'; zz.t = 0; zz.p.once('die', 0.1); zz.tag.visible = false; return true; }
  zz.cool = Math.max(zz.cool, 0.6); return false;
}
// returns the damage done to the shunter this frame
export function runZombies(dt, hero, alive) {
  let dmg = 0;
  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i]; z.t += dt; z.cool -= dt;
    if (z.state === 'dead') { if (z.t > 2.4) { z.p.g.position.y -= dt * 1.2; } if (z.t > 4) { scene.remove(z.p.g); zombies.splice(i, 1); } z.p.mixer.update(dt); continue; }
    if (!alive) { hitZombie(z, z.pos); z.hp = 0; z.state = 'dead'; continue; }
    const dx = hero.x - z.pos.x, dz = hero.z - z.pos.z, d = Math.hypot(dx, dz);
    if (d < 34) {
      if (d < (z.boss ? 2.2 : 1.15)) { if (z.cool <= 0) { z.cool = z.boss ? 1.8 : 1.5; z.p.once('attack-melee-right', 0.1, z.boss ? 0.8 : 1.2); dmg += z.boss ? 35 : z.kind === 'RUG' ? 25 : 15; } }
      else if (z.cool < 0.6) { z.p.play('walk', 0.2, 0.7); z.pos.x += dx / d * z.v * dt; z.pos.z += dz / d * z.v * dt; }
      z.yaw = Math.atan2(dx, dz);
    } else {
      // shamble about until something comes near
      const wx = z.wander.x - z.pos.x, wz = z.wander.z - z.pos.z, wd = Math.hypot(wx, wz);
      if (wd < 1) z.wander.set(z.pos.x + (Math.random() - 0.5) * 30, 0, z.pos.z + (Math.random() - 0.5) * 30);
      else { z.pos.x += wx / wd * 0.7 * dt; z.pos.z += wz / wd * 0.7 * dt; z.yaw = Math.atan2(wx, wz); }
      z.p.play('walk', 0.3, 0.45);
    }
    z.flash = Math.max(0, z.flash - dt);
    z.p.g.position.copy(z.pos); z.p.g.rotation.y = z.yaw; z.p.root.position.x = z.flash ? (Math.random() - 0.5) * 0.15 : 0;
    z.p.mixer.update(dt);
  }
  return dmg;
}

// ---------- cars ----------
export const cars = [];
const WHEEL = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14); WHEEL.rotateZ(Math.PI / 2);
const CAR_COLS = [0xa3262f, 0x2e5a8a, 0xd8d4cc, 0x1c1e22, 0xe6b450, 0x2e7d6a, 0x6a6e76, 0x7a3b5a, 0xc96a2a];
const glass = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.1, metalness: 0.8 }), tyre = M(0x111214, { roughness: 0.9 });
const headM = glow(0xfff4dc, 6, true), tailM = glow(0xff2a3a, 3.5, true);
const busM = M(0x2ed3a0, { metalness: 0.4, roughness: 0.4 }), busWin = glow(0xffe2b0, 1.1, true), taxiM = M(0xe6b450, { metalness: 0.5, roughness: 0.35 }), taxiSign = glow(0xfff1d8, 2.4, true);
export function makeCar(col, kind = 'car') {
  const g = new THREE.Group(), body = M(col, { metalness: 0.6, roughness: 0.3 }), wheels = [];
  const dims = { car: [4.3, 1.05], taxi: [4.4, 1.05], van: [5.2, 1.75], truck: [7.6, 2.6], bus: [11, 2.7] }[kind] || [4.3, 1.05], L = dims[0], H = dims[1];
  if (kind === 'bus') {
    box(2.5, H, L, busM, 0, 0.55 + H / 2, 0, g); box(2.54, 0.9, L - 1.4, busWin, 0, 0.55 + H * 0.68, -0.3, g); box(2.4, 1.1, 0.1, glass, 0, 0.55 + H * 0.62, L / 2 + 0.02, g); box(2.56, 0.18, L + 0.02, M(0x15171a), 0, 0.62, 0, g);
    const sign = label('LINE 1 · STATION', { size: 30, scale: 0.008, bg: 'rgba(6,7,8,.9)', color: '#ffb340' }); sign.position.set(0, 0.55 + H + 0.35, L / 2 - 0.3); g.add(sign);
  } else if (kind === 'truck') {
    box(2.3, 1.9, 2.2, body, 0, 0.5 + 0.95, L / 2 - 1.1, g); box(2.24, 0.8, 0.08, glass, 0, 1.9, L / 2 + 0.01, g);
    box(2.45, H, L - 2.6, M(pick([0xd8d4cc, 0x8a8e94, 0x7a3b2a, 0x2e5a8a]), { roughness: 0.6 }), 0, 0.55 + H / 2, -1.2, g);
  } else {
    const bm = kind === 'taxi' ? taxiM : body;
    box(1.95, H, L, bm, 0, 0.45 + H / 2, 0, g);
    if (kind !== 'van') { box(1.75, 0.75, L * 0.5, glass, 0, 0.45 + H + 0.37, -0.25, g); box(1.8, 0.08, L * 0.52, bm, 0, 0.45 + H + 0.78, -0.25, g); }
    else box(1.97, 0.6, 1.2, glass, 0, 0.45 + H - 0.45, L / 2 - 0.8, g);
    if (kind === 'taxi') box(0.9, 0.28, 0.4, taxiSign, 0, 0.45 + H + 0.98, -0.25, g);
  }
  const wr = kind === 'bus' || kind === 'truck' ? 0.5 : 0.36, axles = kind === 'bus' ? [-L * 0.34, L * 0.32] : kind === 'truck' ? [-L * 0.35, -L * 0.18, L * 0.34] : [-L * 0.32, L * 0.32];
  for (const x of [kind === 'bus' || kind === 'truck' ? -1.1 : -0.9, kind === 'bus' || kind === 'truck' ? 1.1 : 0.9]) for (const z of axles) { const w = new THREE.Mesh(WHEEL, tyre); w.scale.setScalar(wr / 0.36); w.position.set(x, wr, z); g.add(w); wheels.push(w); }
  const lw = kind === 'bus' || kind === 'truck' ? 0.85 : 0.65;
  for (const x of [-lw, lw]) { box(0.4, 0.18, 0.08, headM, x, 0.85, L / 2 + 0.03, g); box(0.42, 0.16, 0.08, tailM, x, 0.95, -L / 2 - 0.03, g); }
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 10, 18, 1, true), additive(0xfff4dc, 0.05)); cone.rotation.x = -Math.PI / 2; cone.position.set(0, 0.8, L / 2 + 5); g.add(cone);
  scene.add(g); return { g, wheels, L, cone, wr, kind };
}export function spawnCars() {
  setSeed(23);
  for (const r of carRoutes) addCar(r, pick(CAR_COLS));
  // traffic across the yard at Junction Crossing: Westbank to Eastgate and back, waiting for the barriers
  const east = [[-72.5, -120], [-72.5, -28], [72.5, -28], [72.5, 40]], west = [[67.5, 40], [67.5, -32], [-67.5, -32], [-67.5, -120]];
  for (let n = 0; n < (TOUCH ? 6 : 12); n++) { const r = { pts: n % 2 ? east : west, open: true, s: (n >> 1) * 37, v: 10 + rnd() * 3, kind: ['car', 'taxi', 'car', 'van', 'car', 'truck', 'car', 'bus'][n % 8] }; addCar(r, pick(CAR_COLS)).xing = true; }
}
function addCar(r, col) {
  const per = [], pts = r.pts, n = r.open ? pts.length - 1 : pts.length; let tot = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); per.push(l); tot += l; }
  const c = makeCar(col, r.kind); Object.assign(c, { r, per, tot, s: r.s % tot, v: r.v, top: r.v, pos: new THREE.Vector3(), yaw: 0 }); cars.push(c); return c;
}
const fwd = new THREE.Vector3();
export function runCars(dt, hero, night) {
  const X = CROSSINGS.find(c => c.z === -30);
  for (const c of cars) {
    // brake for the shunter, for the barriers, and for the car ahead at the crossing
    let want = c.top; fwd.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    const hx = hero.x - c.pos.x, hz = hero.z - c.pos.z, ahead = hx * fwd.x + hz * fwd.z, side = Math.abs(hx * fwd.z - hz * fwd.x);
    if (ahead > 0 && ahead < c.L / 2 + 7 && side < 1.9) want = 0;
    if (c.xing) {
      const onRoad = Math.abs(c.pos.z + 30) < 4 && Math.abs(fwd.x) > 0.7, gap = fwd.x > 0 ? -44.5 - c.pos.x : c.pos.x - 44.5;
      if (X && (X.busy || X.down > 0.05) && onRoad && gap > -c.L / 2 && gap < 22) want = gap < c.L / 2 + 1 ? 0 : Math.min(want, (gap - c.L / 2) * 0.8);
      for (const o of cars) { if (o === c || !o.xing) continue; const ox = o.pos.x - c.pos.x, oz = o.pos.z - c.pos.z, oa = ox * fwd.x + oz * fwd.z; if (oa > 0 && oa < (c.L + o.L) / 2 + 3 && Math.abs(ox * fwd.z - oz * fwd.x) < 1.6) want = Math.min(want, o.v * 0.9, Math.max(0, oa - (c.L + o.L) / 2 - 1)); }
    }
    c.v = lerp(c.v, want, damp(dt, want < c.v ? 5 : 1.2)); c.s = c.s + c.v * dt; if (c.s >= c.tot) c.s = c.r.open ? 0 : c.s % c.tot;
    let s = c.s, i = 0; while (i < c.per.length - 1 && s > c.per[i]) { s -= c.per[i]; i++; }
    const pts = c.r.pts, a = pts[i], b = pts[(i + 1) % pts.length], k = Math.min(1, s / c.per[i]);
    const yawT = Math.atan2(b[0] - a[0], b[1] - a[1]); let d = yawT - c.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); c.yaw += c.r.open && c.s < 1 ? d : d * damp(dt, 6);
    c.pos.set(a[0] + (b[0] - a[0]) * k, 0, a[1] + (b[1] - a[1]) * k); c.g.position.copy(c.pos); c.g.rotation.y = c.yaw;
    for (const w of c.wheels) w.rotation.x += c.v * dt / c.wr;
    c.cone.visible = night > 0.4;
  }
}
