window.boot?.(0.45, 'Laying the rails');
// The Yard, the rails: the main line and its siding, the lever frame and the Signal Box, platforms, crossings,
// tunnels at both ends so a train that leaves the yard goes somewhere, and the trains themselves.
import { THREE, scene, M, BOX, box, glow, label, canvasTex, additive, solid, floor, smooth, setSeed, rnd, pick, TOUCH, haloTex } from './core.js';
import { STREETS } from './city.js';

export const END = 660;   // tunnel mouths at z = ±END
// the game line: main line on x = 0, a siding that leaves it at the junction (z = 0)
export const SID = { x: -8, len: 26, stop: 52 };
export function along(route, s) {
  if (route !== 'siding' || s <= 0) return { x: 0, z: s, yaw: 0 };
  const k = Math.min(1, s / SID.len), x = SID.x * smooth(k), dx = s < SID.len ? SID.x * 6 * k * (1 - k) / SID.len : 0;
  return { x, z: s, yaw: Math.atan2(dx, 1) };
}
export const AMB = [{ x: -24, dir: 1 }, { x: -31, dir: -1 }, { x: 22, dir: -1, stop: -115 }, { x: 29, dir: 1, stop: 150 }, { x: -17, dir: 0 }];

// ---------- ballast, rails, sleepers ----------
const gravel = canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#2a2a2e'; x.fillRect(0, 0, w, h); for (let i = 0; i < 5200; i++) { const v = 30 + Math.random() * 50 | 0; x.fillStyle = `rgb(${v},${v - 2},${v - 5})`; x.beginPath(); x.arc(Math.random() * w, Math.random() * h, 0.8 + Math.random() * 1.8, 0, 7); x.fill(); } }, [30, 340]);
{ const b = new THREE.Mesh(new THREE.PlaneGeometry(80, 2 * END + 120), M(0xffffff, { map: gravel, roughness: 0.95 })); b.rotation.x = -Math.PI / 2; b.position.set(0, 0.012, 0); b.receiveShadow = true; scene.add(b); }
const railM = [], sleepM = [], tmp = new THREE.Object3D();
function track(pts) {
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz), nx = Math.cos(yaw), nz = -Math.sin(yaw);
    for (const o of [-0.72, 0.72]) { tmp.position.set((a.x + b.x) / 2 + nx * o, 0.22, (a.z + b.z) / 2 + nz * o); tmp.rotation.set(0, yaw, 0); tmp.scale.set(0.09, 0.15, L + 0.03); tmp.updateMatrix(); railM.push(tmp.matrix.clone()); }
    for (let s = carry; s < L; s += 0.75) { const k = s / L; tmp.position.set(a.x + dx * k, 0.08, a.z + dz * k); tmp.rotation.set(0, yaw + (Math.random() - 0.5) * 0.04, 0); tmp.scale.set(2.5, 0.13, 0.24); tmp.updateMatrix(); sleepM.push(tmp.matrix.clone()); carry = s + 0.75 - L; }
  }
}
const straight = (x) => { for (let z = -END - 60; z < END + 60; z += 120) track([{ x, z }, { x, z: z + 120 }]); };
straight(0);
{ const p = []; for (let s = 0; s <= 62; s += 1.5) p.push(along('siding', s)); track(p); }
for (const t of AMB) straight(t.x);
{
  const rails = new THREE.InstancedMesh(BOX, M(0xb8bcc4, { metalness: 0.95, roughness: 0.22 }), railM.length); railM.forEach((m, i) => rails.setMatrixAt(i, m)); rails.receiveShadow = true; scene.add(rails);
  const sleepers = new THREE.InstancedMesh(BOX, M(0x3a3029, { roughness: 1 }), sleepM.length); sleepM.forEach((m, i) => sleepers.setMatrixAt(i, m)); sleepers.receiveShadow = true; scene.add(sleepers);
}
// buffer stop at the end of the siding
export const bufLamp = glow(0xff3b4e, 4);
box(3.2, 1.3, 0.9, M(0x5a2228, { roughness: 0.5 }), SID.x, 0.65, 63, scene, true); box(0.5, 0.5, 0.2, bufLamp, SID.x, 1.6, 62.5); solid(SID.x, 63, 3.2, 0.9, 1.3);

// ---------- tunnels: the line runs into the hills at both ends ----------
for (const s of [-1, 1]) {
  const z = s * END, hill = M(0x2a2f2a, { roughness: 1, flatShading: true });
  box(560, 46, 140, hill, 0, 23, z + s * 70, scene, true);
  box(76, 14, 2, M(0x4a4640, { roughness: 0.9 }), 0, 7, z - s * 1, scene, true);
  for (const x of [-31, -24, -17, 0, 22, 29]) box(5, 7.5, 2.2, M(0x020203, { roughness: 1 }), x, 3.75, z - s * 1.2);
  const sg = label(s < 0 ? 'SOUTH TUNNEL' : 'NORTH TUNNEL', { size: 46, bg: null, color: '#c9c7c2', scale: 0.03, bright: 0.5 }); sg.position.set(0, 12, z - s * 3); scene.add(sg);
  solid(0, z + s * 2, 120, 4, 14);
}

// ---------- the yard fence, with gaps where the streets meet it and at the station ----------
{
  const fenceM = M(0x3a3e45, { metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.45 }), post = M(0x2a2d32);
  for (const x of [-40, 40]) {
    const gaps = STREETS.map(z => [z - 5, z + 5]); if (x > 0) gaps.push([126, 174]); gaps.push([-35, -25]);   // the Junction crossing
    gaps.sort((a, b) => a[0] - b[0]); let z0 = -END + 4;
    for (const [g0, g1] of [...gaps, [END, END]]) { const z1 = Math.min(END - 4, g0); if (z1 > z0) { solid(x, (z0 + z1) / 2, 0.4, z1 - z0, 2.4); box(0.06, 2.4, z1 - z0, fenceM, x, 1.2, (z0 + z1) / 2); for (let z = z0; z <= z1; z += 4) box(0.12, 2.6, 0.12, post, x, 1.3, z); } z0 = Math.max(z0, g1); }
  }
}

// ---------- level crossings: lights, a bell, barriers that come down for every train ----------
// Junction Crossing, right by the spawn, takes people from one plaza to the other across the whole yard.
export const CROSSINGS = [];
for (const z of [-180, -30, 180]) {
  const foot = false, X = { z, lights: [], arms: [], down: 0, busy: false };   // all three carry traffic
  box(80, 0.06, foot ? 6 : 9, M(foot ? 0x4a4a4e : 0x2a2b2e, { roughness: 0.6 }), 0, 0.2, z, scene, true);
  if (foot) for (let k = -36; k <= 36; k += 2.4) box(1.2, 0.02, 5.6, M(0xc9c7c2, { roughness: 0.6 }), k, 0.24, z);
  for (const x of [-38.5, 38.5]) for (const side of [-1, 1]) {
    const pz = z + side * (foot ? 3.6 : 5.2), px = x + (x > 0 ? 0.9 : -0.9);
    box(0.2, 3.2, 0.2, M(0x2a2d32), px, 1.6, pz);
    for (const o of [-0.28, 0.28]) { const l = box(0.38, 0.38, 0.12, glow(0xff3b4e, 0.15), px + o, 2.9, pz); X.lights.push(l.material); box(0.5, 0.08, 0.3, M(0x101114), px + o, 3.13, pz); }
    const cr = box(1.3, 0.22, 0.06, M(0xedebe6), px, 2.35, pz); cr.rotation.z = 0.6; const cr2 = box(1.3, 0.22, 0.06, M(0xedebe6), px, 2.35, pz); cr2.rotation.z = -0.6;
    // the barrier: it pivots at its post and swings down across the path
    if (side < 0) {
      const g = new THREE.Group(); g.position.set(x, 1.05, pz); scene.add(g); box(0.5, 0.6, 0.5, M(0x23262b), x, 0.5, pz, scene, true);
      const len = foot ? 7 : 10.2; for (let k = 0; k < 7; k++) box(0.14, 0.14, len / 7, M(k % 2 ? 0xa3262f : 0xedebe6, { roughness: 0.5 }), 0, 0, (k + 0.5) * len / 7, g);
      box(0.18, 0.18, 0.18, glow(0xff3b4e, 3), 0, 0.12, len - 0.2, g); g.rotation.x = -Math.PI / 2 * 0.96; X.arms.push({ g, x, z0: pz, len });
    }
  }
  if (z === -30) { box(140, 0.05, 9, M(0x1f2024, { roughness: 0.55 }), 0, 0.17, z, scene, true); for (let k = -66; k <= 66; k += 6) if (Math.abs(k) > 41) box(2.6, 0.02, 0.18, glow(0xd9cfa0, 0.35), k, 0.21, z); const s = label(['JUNCTION CROSSING', 'WAIT WHEN THE LIGHTS SHOW'], { size: 34, accent: '#ff4d5e', scale: 0.012 }); for (const x of [-46, 46]) { const c = s.clone(); c.position.set(x, 3.6, z); scene.add(c); } }
  CROSSINGS.push(X);
}
export const crossLights = CROSSINGS.flatMap(c => c.lights);
// ---------- platforms: Central Station on the east side, the Graduation Platform on the west ----------
{
  box(8, 1, 52, M(0x6a6a6c, { roughness: 0.7 }), 35, 0.5, 150, scene, true); box(0.4, 1.02, 52, M(0xe6b450), 31.3, 0.51, 150);
  for (let z = 128; z <= 172; z += 11) { box(0.3, 5, 0.3, M(0x2a2d32), 37, 3.5, z); }
  box(6, 0.3, 52, M(0x23262b), 36, 6, 150, scene, true);
  for (let z = 128; z <= 172; z += 11) box(1.6, 0.12, 0.4, glow(0xfff1d8, 3, true), 36, 5.8, z);
  const s = label(['CENTRAL STATION', 'PLATFORM 1'], { size: 44, accent: '#edebe6', scale: 0.016 }); s.position.set(36, 8, 150); scene.add(s);
  floor(35, 150, 8, 52, 1);
}
// ---------- Junction Station: an island platform by the Signal Box, between the main line and track 22 ----------
export const JUNCTION = { x: 11, z: -70, w: 15.2, l: 56 };
export const STAFF = [];        // station staff, all in the same uniform: { x, z, y, yaw, a, ts } or { pace: [[x, z], [x, z]], y }
export const PASSENGERS = [];   // people waiting for a train: { x, z, y, yaw, a, ts } or { pace, y }
{
  const J = JUNCTION, W = J.w, L = J.l, y = 1, x0 = J.x - W / 2, x1 = J.x + W / 2, z0 = J.z - L / 2, z1 = J.z + L / 2;
  box(W, 1, L, M(0x6a6a6c, { roughness: 0.7 }), J.x, 0.5, J.z, scene, true); floor(J.x, J.z, W, L, y);
  for (const ex of [x0 + 0.2, x1 - 0.2]) box(0.4, 1.02, L, M(0xe6b450, { roughness: 0.5 }), ex, 0.51, J.z);
  for (const ex of [x0 + 1.1, x1 - 1.1]) box(0.5, 0.02, L, M(0xc9c7c2, { roughness: 0.6 }), ex, 1.01, J.z);
  // the canopy on one row of columns, lit underneath after dark
  const steel = M(0x2a2d32, { metalness: 0.6, roughness: 0.45 });
  for (let z = z0 + 5; z <= z1 - 5; z += 8) { box(0.4, 5, 0.4, steel, J.x, y + 2.5, z, scene, true); solid(J.x, z, 0.5, 0.5, 6); box(W - 3, 0.12, 0.5, glow(0xfff1d8, 2.6, true), J.x, y + 4.75, z + 4); }
  box(W - 1, 0.35, L - 6, M(0x1c1f24, { metalness: 0.4, roughness: 0.5 }), J.x, y + 5.1, J.z, scene, true);
  box(W - 0.6, 0.2, 0.3, M(0x2ed3a0, { emissive: 0x0b5a42, emissiveIntensity: 0.8 }), J.x, y + 4.95, z0 + 3);
  // the name, the platforms, the board
  const name = label(['JUNCTION STATION'], { size: 64, accent: '#2ed3a0', scale: 0.016 }); name.position.set(J.x, y + 7.4, z1 - 4); scene.add(name);
  for (const [sx, t] of [[-1, 'PLATFORM 1 · MAIN LINE'], [1, 'PLATFORM 2 · TRACK 22']]) for (const z of [J.z - 14, J.z + 10]) { const s = label(t, { size: 30, bg: 'rgba(14,40,60,.92)', color: '#edebe6', scale: 0.011 }); s.position.set(J.x + sx * (W / 2 - 2.4), y + 4.1, z); scene.add(s); }
  const t = canvasTex(1024, 352, () => {}); const bm = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 1.1, map: t, side: THREE.DoubleSide });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.4), bm); board.position.set(J.x, y + 3.6, z1 - 9); scene.add(board); box(7.3, 2.7, 0.2, M(0x0e0f11), J.x, y + 3.6, z1 - 9.15); box(0.15, 1.8, 0.15, steel, J.x - 2, y + 5.1, z1 - 9.1); box(0.15, 1.8, 0.15, steel, J.x + 2, y + 5.1, z1 - 9.1);
  JUNCTION.screen = t;
  // a kiosk, vending machines, a clock, benches
  box(3.2, 2.6, 2.6, M(0x23272d, { roughness: 0.5 }), J.x, y + 1.3, J.z + 16, scene, true); box(3.22, 0.9, 1.6, glow(0xffe2b0, 1.2, true), J.x, y + 1.7, J.z + 16); box(3.6, 0.2, 3, M(0x2ed3a0, { roughness: 0.5 }), J.x, y + 2.7, J.z + 16); solid(J.x, J.z + 16, 3.2, 2.6, 4);
  const kl = label('TICKETS · COFFEE', { size: 28, accent: '#2ed3a0', scale: 0.01 }); kl.position.set(J.x, y + 3.4, J.z + 16); scene.add(kl);
  for (const [vz, c] of [[J.z - 22, 0xa3262f], [J.z - 20.6, 0x2e5a8a]]) { box(1.1, 2, 0.9, M(c, { roughness: 0.4 }), x1 - 2, y + 1, vz, scene, true); box(0.06, 1.2, 0.7, glow(0xedebe6, 1.4, true), x1 - 2.57, y + 1.2, vz); solid(x1 - 2, vz, 1.1, 0.9, 3); }
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.2, 24), M(0xedebe6, { emissive: 0x3a3a38, roughness: 0.4 })); clock.rotation.x = Math.PI / 2; clock.position.set(J.x, y + 4.2, J.z - 3.6); scene.add(clock);
  for (let i = 0; i < 6; i++) { const bz = z0 + 9 + i * 8; box(2.4, 0.45, 0.7, M(0x6a5038, { roughness: 0.7 }), J.x - 2.2, y + 0.45, bz, scene, true); box(2.4, 0.45, 0.7, M(0x6a5038, { roughness: 0.7 }), J.x + 2.2, y + 0.45, bz, scene, true); solid(J.x - 2.2, bz, 2.4, 0.7, 1.6); solid(J.x + 2.2, bz, 2.4, 0.7, 1.6);
    PASSENGERS.push({ x: J.x - 2.2 - 0.6, z: bz, y, yaw: -Math.PI / 2, a: 'sit' }, { x: J.x + 2.2 + 0.6, z: bz, y, yaw: Math.PI / 2, a: 'sit' }); if (i % 2) PASSENGERS.push({ x: J.x - 2.2 + 0.6, z: bz, y, yaw: -Math.PI / 2, a: 'sit' }); }
  // the people: a crowd for platform 2 that gets on and off the 22, people wandering platform 1, talkers, a queue
  setSeed(303);
  for (let i = 0; i < 24; i++) PASSENGERS.push({ board: 'junction', x: 15.6 + rnd() * 1.2, z: z0 + 4 + rnd() * (L - 8), y });
  for (let i = 0; i < 14; i++) PASSENGERS.push({ wander: [x0 + 1.4, J.x - 3.6, z0 + 3, z1 - 3], y });
  for (let i = 0; i < 5; i++) { const z = z0 + 6 + i * 10; PASSENGERS.push({ x: J.x - 4.6, z, y, yaw: Math.PI / 2, a: 'emote-yes', ts: 0.45 }, { x: J.x - 3.4, z: z + 0.2, y, yaw: -Math.PI / 2, a: 'idle' }); }
  for (let i = 0; i < 5; i++) PASSENGERS.push({ route: [[J.x - 0.4 + i * 0.3, J.z + 13.2 - i * 0.9, 'idle', 3 + i], [x1 - 2.4, J.z - 21.3, 'interact-right', 3], [J.x + 3.6, J.z - 30 + i * 9, 'idle', 6], [J.x - 3.4, J.z - 10 + i * 5, 'emote-yes', 4]], y });
  // the staff, all in one uniform, all at work: two guards walking the edges, a cleaner, the ticket inspector, the kiosk, the machines
  STAFF.push({ route: [[x1 - 1.4, z0 + 6, 'idle', 6], [x1 - 1.4, J.z, 'idle', 5], [x1 - 1.4, z1 - 8, 'idle', 6]], y, guard: 'junction' });
  STAFF.push({ route: [[x0 + 1.4, z1 - 6, 'idle', 5], [x0 + 1.4, J.z - 6, 'idle', 6], [x0 + 1.4, z0 + 6, 'idle', 5]], y });
  STAFF.push({ route: [[J.x - 1.5, z0 + 8, 'pick-up', 2.2], [J.x + 1.6, z0 + 18, 'pick-up', 2.2], [J.x - 1.4, J.z, 'pick-up', 2.2], [J.x + 1.5, J.z + 10, 'pick-up', 2.2], [J.x - 1.5, z1 - 6, 'pick-up', 2.2]], y });
  STAFF.push({ route: [[15.4, z0 + 10, 'interact-right', 2.4], [15.6, J.z - 12, 'interact-right', 2.4], [6.6, J.z - 2, 'interact-right', 2.4], [15.2, J.z + 8, 'interact-right', 2.4], [6.4, z1 - 10, 'interact-right', 2.4]], y });
  STAFF.push({ route: [[J.x - 1, J.z + 18.2, 'interact-right', 4], [J.x + 1, J.z + 18.2, 'interact-right', 3.5]], y }, { route: [[J.x + 1.2, J.z + 18.2, 'interact-right', 3], [J.x - 1.2, J.z + 18.2, 'interact-right', 4.5]], y });
  STAFF.push({ route: [[x1 - 3.2, J.z - 22, 'interact-right', 5], [J.x + 2.5, J.z - 6, 'idle', 3], [x1 - 3.2, J.z - 20.6, 'interact-right', 4]], y });
  // Central Station: the same, smaller
  for (let i = 0; i < 16; i++) PASSENGERS.push({ board: 'central', x: 32.8 + rnd() * 1.1, z: 128 + rnd() * 44, y: 1 });
  for (let i = 0; i < 8; i++) PASSENGERS.push({ wander: [34.4, 38.6, 128, 172], y: 1 });
  STAFF.push({ route: [[32.6, 130, 'idle', 6], [32.6, 150, 'idle', 5], [32.6, 168, 'idle', 6]], y: 1, guard: 'central' });
  STAFF.push({ route: [[36, 132, 'pick-up', 2.2], [37.5, 146, 'pick-up', 2.2], [36.2, 160, 'pick-up', 2.2], [37.8, 170, 'pick-up', 2.2]], y: 1 });
  STAFF.push({ route: [[33.6, 134, 'interact-right', 2.4], [33.8, 150, 'interact-right', 2.4], [33.5, 164, 'interact-right', 2.4]], y: 1 });}
export const GRAD = { x: -36, z: -90 };
{
  box(5.5, 1, 40, M(0x6a6a6c, { roughness: 0.7 }), -35.5, 0.5, -90, scene, true); box(0.4, 1.02, 40, M(0x2ed3a0, { emissive: 0x0b5a42, emissiveIntensity: 0.6 }), -32.9, 0.51, -90);
  box(5, 0.3, 40, M(0x23262b), -36, 5.4, -90, scene, true); for (let z = -108; z <= -72; z += 9) box(0.3, 4.4, 0.3, M(0x2a2d32), -37.6, 3.2, z);
  box(5, 0.12, 40, glow(0x2ed3a0, 1.6, true), -36, 5.2, -90);
  const s = label(['GRADUATION PLATFORM', 'FRESH OFF PONS'], { size: 44, accent: '#2ed3a0', scale: 0.016 }); s.position.set(-36, 7.5, -90); scene.add(s);
  floor(-35.5, -90, 5.5, 40, 1);
}

// ---------- the junction: signal gantry and lever frame ----------
export const sig = { ride: glow(0x2ed3a0, 0.1), stop: glow(0xff3b4e, 5), sid: glow(0xffb340, 0.1) };
export const halos = [];
{
  const steel = M(0x30343a, { metalness: 0.6, roughness: 0.5 });
  box(0.3, 7, 0.3, steel, 2.4, 3.5, -6, scene, true); box(1, 2.6, 0.7, M(0x101114), 2.4, 6.4, -6, scene, true); box(1.3, 0.12, 0.9, steel, 2.4, 7.75, -6);
  [[sig.ride, 7.2, 0x2ed3a0], [sig.sid, 6.4, 0xffb340], [sig.stop, 5.6, 0xff3b4e]].forEach(([mat, y, c]) => {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), mat); l.position.set(2.4, y, -6.37); scene.add(l);
    box(0.7, 0.08, 0.4, M(0x101114), 2.4, y + 0.36, -6.45);
    const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); h.scale.set(2.2, 2.2, 1); h.position.set(2.4, y, -6.6); h.userData.mat = mat; scene.add(h); halos.push(h);
  });
  solid(2.4, -6, 0.6, 0.6, 7);
}
export const levers = {};
function lever(x, name, color) {
  const g = new THREE.Group(); g.position.set(x, 0, -14); scene.add(g);
  box(1.3, 0.55, 1.5, M(0x22262b, { metalness: 0.5, roughness: 0.5 }), 0, 0.28, 0, g, true);
  box(1.4, 0.08, 1.6, glow(color, 0.6), 0, 0.58, 0, g);
  const arm = new THREE.Group(); arm.position.set(0, 0.6, 0); g.add(arm);
  box(0.12, 1.7, 0.12, M(0xd0d2d6, { metalness: 0.9, roughness: 0.25 }), 0, 0.85, 0, arm, true);
  box(0.3, 0.3, 0.3, glow(color, 3), 0, 1.75, 0, arm); arm.rotation.x = 0.55;
  const s = label(name, { size: 46, accent: '#' + color.toString(16).padStart(6, '0'), scale: 0.011 }); s.position.set(0, 3, 0); g.add(s);
  solid(x, -14, 1.3, 1.5, 1.2);
  levers[name] = { g, arm, pos: new THREE.Vector3(x, 0, -14), target: 0.55 };
}
lever(3.4, 'RIDE', 0x2ed3a0); lever(6.4, 'SIDING', 0xffb340);
{ const s = label(['LEVER FRAME'], { size: 30, bg: null, color: '#9a9da3', font: 'M', weight: 700, scale: 0.012 }); s.position.set(4.9, 4.2, -14); scene.add(s); }

// ---------- the Signal Box ----------
export const SB = new THREE.Vector3(13, 0, -10), SB_DOOR = new THREE.Vector3(9.4, 0, -10);
{
  const brick = canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#2b1f1c'; x.fillRect(0, 0, w, h); for (let r = 0; r < 16; r++) for (let q = -1; q < 9; q++) { const v = 34 + Math.random() * 18 | 0; x.fillStyle = `rgb(${v + 10},${v - 6},${v - 10})`; x.fillRect(q * 32 + (r % 2) * 16 + 1, r * 16 + 1, 30, 14); } }, [3, 2]);
  box(6, 3.4, 7, M(0xffffff, { map: brick, roughness: 0.9 }), SB.x, 1.7, SB.z, scene, true);
  box(7.4, 3.2, 8.2, M(0x15171a), SB.x, 5, SB.z, scene, true);
  box(7.5, 1.8, 8.3, glow(0xffa64a, 1.1), SB.x, 5.1, SB.z);
  for (let k = -3.6; k <= 3.6; k += 1.2) box(0.16, 1.9, 8.45, M(0x0e0f11), SB.x + k, 5.1, SB.z);
  for (let k = -4.1; k <= 4.1; k += 1.2) box(7.65, 1.9, 0.16, M(0x0e0f11), SB.x, 5.1, SB.z + k);
  box(7.7, 0.25, 8.5, M(0x0e0f11), SB.x, 4.15, SB.z);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.6, 1.8, 4, 1), M(0x1c1e22, { roughness: 0.6 })); roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 1.1); roof.position.set(SB.x, 7.4, SB.z); roof.castShadow = true; scene.add(roof);
  box(0.2, 2.4, 1.6, glow(0x2ed3a0, 1.2), SB.x - 3.02, 1.2, SB.z);
  box(0.9, 0.12, 2, M(0x15171a), SB.x - 3.4, 2.6, SB.z);
  for (let i = 0; i < 6; i++) box(1.4, 0.12, 0.35, M(0x2a2d32), SB.x + 3.7, 0.3 + i * 0.55, SB.z - 2.5 + i * 0.45, scene, true);
  const lamp = new THREE.PointLight(0xffa64a, 40, 30, 2); lamp.position.set(SB.x - 5, 5, SB.z); scene.add(lamp);
  const s = label('SIGNAL BOX', { size: 70, accent: '#2ed3a0', scale: 0.013 }); s.position.set(SB.x, 9.6, SB.z); scene.add(s);
  solid(SB.x, SB.z, 6.2, 7.2, 8);
}

// ---------- floodlight masts over the yard ----------
export const floodLights = [];
{
  const coneM = additive(0xfff1d6, 0.018);
  for (const [x, z] of [[-12, 30], [11, 80], [-12, -110], [-12, 230], [11, -230], [11, 330], [-12, -360], [-12, 450], [11, -480]]) {
    const steel = M(0x2a2d32, { metalness: 0.6, roughness: 0.5 });
    box(0.5, 20, 0.5, steel, x, 10, z, scene, true); box(4, 1.4, 0.6, M(0x15171a), x, 20, z); box(3.6, 1.1, 0.1, glow(0xfff4dc, 4, true), x, 20, z + Math.sign(-x) * 0.35);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(12, 20, 32, 1, true), coneM); cone.position.set(x - Math.sign(x) * 4, 10, z); cone.rotation.z = -Math.sign(x) * 0.35; scene.add(cone); cone.userData.night = true;
    solid(x, z, 0.8, 0.8, 20);
    if (Math.abs(z) < 120) { const L = new THREE.PointLight(0xfff0d8, 700, 90, 1.7); L.position.set(x - Math.sign(x) * 3, 18, z); L.userData.night = true; scene.add(L); floodLights.push(L); }
  }
}

// ---------- trains ----------
export const CAR = 10;
const carShape = new THREE.Shape(); { const w = 1.5, h = 3.2, r = 0.75; carShape.moveTo(-w, 0); carShape.lineTo(w, 0); carShape.lineTo(w, h - r); carShape.quadraticCurveTo(w, h, w - r, h); carShape.lineTo(-w + r, h); carShape.quadraticCurveTo(-w, h, -w, h - r); carShape.closePath(); }
const CAR_G = new THREE.ExtrudeGeometry(carShape, { depth: 8.8, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.06, bevelSegments: 2, curveSegments: 8 }); CAR_G.translate(0, 0, -4.4);
const locoShape = new THREE.Shape([[-4.5, 0], [4.5, 0], [4.5, 1.5], [3.4, 3.35], [-4.5, 3.35]].map(([z, y]) => new THREE.Vector2(-z, y)));
const LOCO_G = new THREE.ExtrudeGeometry(locoShape, { depth: 3, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2 }); LOCO_G.rotateY(Math.PI / 2); LOCO_G.translate(-1.5, 0, 0);
const WHEEL = new THREE.CylinderGeometry(0.44, 0.44, 0.16, 16); WHEEL.rotateZ(Math.PI / 2);
const winTex = canvasTex(512, 64, (x, w, h) => { x.fillStyle = '#0b0c0e'; x.fillRect(0, 0, w, h); for (let i = 0; i < 8; i++) { const lit = Math.random() < 0.85; x.fillStyle = lit ? '#ffd9a0' : '#1a1c20'; x.fillRect(14 + i * 62, 10, 50, 44); if (lit) { x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(14 + i * 62, 36, 50, 18); } } });
const WIN_M = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.85, map: winTex });
const DARK = M(0x0c0d0f, { roughness: 0.6, metalness: 0.4 }), GLASS = new THREE.MeshStandardMaterial({ color: 0x0a0f14, roughness: 0.08, metalness: 0.9, emissive: 0x16303a, emissiveIntensity: 0.6 });
const HEAD = glow(0xffffff, 9);
export function makeTrain(n, { body = 0x1c1f24, stripe = 0x2ed3a0, title = null, freight = false } = {}) {
  const g = new THREE.Group(), cars = [], wheels = [];
  const bodyM = M(body, { metalness: 0.55, roughness: 0.38 }), stripeM = glow(stripe, 2.2);
  for (let i = 0; i < n; i++) {
    const c = new THREE.Group(); g.add(c);
    const lift = new THREE.Group(); lift.position.y = 0.95; c.add(lift);
    if (i === 0) {
      const m = new THREE.Mesh(LOCO_G, bodyM); m.castShadow = true; lift.add(m);
      const ws = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2.1), GLASS); ws.position.set(0, 2.45, 4.0); ws.rotation.x = -0.6; lift.add(ws);
      box(3.12, 0.22, 9.1, stripeM, 0, 0.75, 0, lift); box(3.12, 0.22, 1.2, stripeM, 0, 1.25, 4.05, lift);
      for (const o of [-0.95, 0.95]) box(0.5, 0.3, 0.1, HEAD, o, 0.95, 4.6, lift);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, 22, 24, 1, true), additive(0xfff4dc, 0.06)); cone.rotation.x = -Math.PI / 2; cone.position.set(0, 0.9, 15.5); lift.add(cone);
      box(1.6, 0.35, 1.2, DARK, 0, 3.5, -1.5, lift);
    } else if (freight) {
      box(2.9, 0.35, 9, DARK, 0, 0.2, 0, lift, true);
      const cc = [0x7a3b2a, 0x1f5c58, 0x5a5f66, 0x8a6a2a][(i + n * 7) % 4], ct = M(cc, { roughness: 0.7, metalness: 0.3 });
      box(2.8, 2.7, 8.4, ct, 0, 1.75, 0, lift, true);
      for (let r = -3.8; r <= 3.8; r += 0.6) box(2.86, 2.5, 0.08, M(cc, { roughness: 0.8 }), 0, 1.75, r, lift);
    } else {
      const m = new THREE.Mesh(CAR_G, bodyM); m.castShadow = true; lift.add(m);
      for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 0.95), WIN_M); p.position.set(s * 1.57, 2.15, 0); p.rotation.y = s * Math.PI / 2; lift.add(p); }
      box(3.1, 0.18, 8.9, stripeM, 0, 0.75, 0, lift);
    }
    for (const bz of [-3, 3]) { box(2.2, 0.4, 2.4, DARK, 0, 0.62, bz, c); for (const wx of [-0.72, 0.72]) for (const wz of [-0.75, 0.75]) { const w = new THREE.Mesh(WHEEL, DARK); w.position.set(wx, 0.46, bz + wz); c.add(w); wheels.push(w); } }
    cars.push(c);
  }
  if (title) { const s = label(title, { size: 80, accent: '#' + stripe.toString(16).padStart(6, '0'), scale: 0.022 }); s.position.set(0, 6.6, 0); cars[0].add(s); }
  scene.add(g); return { g, cars, wheels, stripeM };
}
export const spinWheels = (t, v, dt) => { for (const w of t.wheels) w.rotation.x += v * dt / 0.44; };
// trains that just run the other tracks; one calls at Central Station
export const ambient = AMB.filter(t => t.dir).map((t, i) => { setSeed(5 + i * 13); const tr = makeTrain(5 + Math.floor(rnd() * 5), { stripe: [0x2ed3a0, 0xffb340, 0x6f7278, 0xa9d6ff][i % 4], freight: i % 2 === 1 }); Object.assign(tr, { x: t.x, dir: t.dir, s: -500 + rnd() * 1000, top: 16 + rnd() * 8, v: 18, stop: t.stop ?? null, wait: 0, len: 0 }); tr.len = tr.cars.length * CAR; return tr; });
{ const p = makeTrain(6, { stripe: 0x3a3d42, freight: true }); p.cars.forEach((c, i) => c.position.set(-17, 0, 30 + i * CAR)); p.cars.forEach(c => solid(-17, c.position.z, 3, 9, 4)); }
// the two platforms where a train calls, and what happens there: approach, arrival, departure
export const PLATFORMS = [
  { id: 'junction', name: 'Junction Station', no: 2, track: 22, edge: 17.4, door: 19.7, z0: -96, z1: -44, y: 1, to: 'South Tunnel', via: 'the Graduation Platform', ride: 'central', dwell: false, train: null },
  { id: 'central', name: 'Central Station', no: 1, track: 29, edge: 32.2, door: 30.9, z0: 126, z1: 174, y: 1, to: 'North Tunnel', via: 'Liquidity Lake', ride: 'junction', dwell: false, train: null },
];
export const RAIL_EVENTS = [];export function runAmbient(dt) {
  for (const a of ambient) {
    // the station train brakes for the platform, waits, and pulls out again
    if (a.stop != null) {
      const ahead = a.dir * (a.stop + 20 - a.s);
      const pf = a.pf || (a.pf = PLATFORMS.find(p => p.track === a.x)); pf.train = a;
      if (a.wait > 0) { const w0 = a.wait; a.wait -= dt; a.v = 0; if (w0 > 3 && a.wait <= 3) RAIL_EVENTS.push({ kind: 'closing', pf }); if (a.wait <= 0) { a.done = true; pf.dwell = false; RAIL_EVENTS.push({ kind: 'depart', pf }); } }
      else if (!a.done && ahead > 0 && ahead < 120) { a.v = Math.min(a.top, Math.sqrt(ahead * 2.4)); if (ahead < 0.6) { a.wait = 16; pf.dwell = true; RAIL_EVENTS.push({ kind: 'arrive', pf }); } }
      else if (!a.done && ahead > 120 && ahead < 380 && !a.told) { a.told = true; RAIL_EVENTS.push({ kind: 'approach', pf }); }
      else a.v = Math.min(a.top, a.v + 3 * dt);
    }
    if (a.broken) a.v = Math.max(0, a.v - 6 * dt);   // a failure: it rolls to a stop and waits for someone to fix it
    else if (a.stop == null && a.v < a.top) a.v = Math.min(a.top, a.v + 2.5 * dt);
    a.s += a.dir * a.v * dt;
    if (a.s > END + 80 + a.len) { a.s = -END - 60; a.done = false; a.told = false; } if (a.s < -END - 80 - a.len) { a.s = END + 60; a.done = false; a.told = false; }
    a.cars.forEach((c, i) => { c.position.set(a.x, 0, a.s - a.dir * i * CAR); c.rotation.y = a.dir > 0 ? 0 : Math.PI; });
    spinWheels(a, a.v, dt);
  }
}
