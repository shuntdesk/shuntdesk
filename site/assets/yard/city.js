// The Yard, the city: two districts on either side of the rail yard. Westbank is the old quarter, all walkers;
// Eastgate is downtown, with traffic. Streets on a grid, lit blocks drawn by one instanced shader, named places,
// and four buildings you can walk into.
import { THREE, scene, M, BOX, box, glow, board, label, canvasTex, additive, solid, setSeed, rnd, pick, WIN, nightMats, TOUCH, haloTex } from './core.js';

export const ROAD = 10, SIDE = 3.5;
export const STREETS = [-300, -240, -180, -120, -60, 0, 60, 120, 180, 240, 300];
export const DISTRICTS = {
  west: { name: 'Westbank', aves: [-290, -235, -180, -125, -70], cars: true },
  east: { name: 'Eastgate', aves: [70, 125, 180, 235, 290, 345, 400], cars: true },
};
export const PLACES = [];   // { id, name, x, z, at (where you act), r, color, note }
export const MAP = { blocks: [], roads: [], parks: [], water: [] };
export const interiors = [];   // { x0, x1, z0, z1, hide: [objects] }
export const carRoutes = [];
export const screens = {};

// the blocks of a district: x and z bounds, and the lot inside the sidewalk
function blocksOf(D) {
  const out = [];
  for (let i = 0; i < D.aves.length - 1; i++) { out.push([]); for (let j = 0; j < STREETS.length - 1; j++) { const x0 = D.aves[i] + ROAD / 2, x1 = D.aves[i + 1] - ROAD / 2, z0 = STREETS[j] + ROAD / 2, z1 = STREETS[j + 1] - ROAD / 2; out[i].push({ i, j, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, lot: { x0: x0 + SIDE, x1: x1 - SIDE, z0: z0 + SIDE, z1: z1 - SIDE }, used: false }); } }
  return out;
}
for (const k in DISTRICTS) DISTRICTS[k].blocks = blocksOf(DISTRICTS[k]);
export const districtAt = (x, z) => Math.abs(x) <= 40 ? (Math.abs(z) > 620 ? 'The Tunnels' : 'The Yard') : Math.abs(z) > 306 ? 'Outskirts' : x < 0 ? 'Westbank' : 'Eastgate';

// ---------- ground ----------
const asphalt = canvasTex(512, 512, (x, w, h) => { x.fillStyle = '#1d1e22'; x.fillRect(0, 0, w, h); for (let i = 0; i < 9000; i++) { const v = 22 + Math.random() * 26 | 0; x.fillStyle = `rgb(${v},${v},${v + 3})`; x.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } }, [220, 220]);
const concrete = canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#5a5a5c'; x.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { const v = 80 + Math.random() * 30 | 0; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2); } x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 2; for (let k = 0; k <= 256; k += 64) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k, 256); x.stroke(); x.beginPath(); x.moveTo(0, k); x.lineTo(256, k); x.stroke(); } }, [1, 1]);
const grassT = canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#25331f'; x.fillRect(0, 0, w, h); for (let i = 0; i < 6000; i++) { x.fillStyle = `hsl(${85 + Math.random() * 30},${25 + Math.random() * 20}%,${12 + Math.random() * 12}%)`; x.fillRect(Math.random() * w, Math.random() * h, 1.5, 3); } }, [120, 120]);
{
  const g = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), M(0xffffff, { map: grassT, roughness: 1 })); g.rotation.x = -Math.PI / 2; g.position.y = -0.02; g.receiveShadow = true; scene.add(g);
  const a = new THREE.Mesh(new THREE.PlaneGeometry(760, 640), M(0xffffff, { map: asphalt, roughness: 0.45, metalness: 0.12 })); a.rotation.x = -Math.PI / 2; a.position.set(55, 0, 0); a.receiveShadow = true; scene.add(a);
}

// ---------- blocks: sidewalk slabs, lane marks, crosswalks ----------
const slabM = M(0xffffff, { map: concrete, roughness: 0.7 }), curbM = M(0x8a8a8c, { roughness: 0.6 });
const slabs = [], marks = [], zebra = [];
for (const k in DISTRICTS) {
  const D = DISTRICTS[k];
  for (const col of D.blocks) for (const b of col) { slabs.push(b); MAP.blocks.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 }); }
  for (const x of D.aves) { MAP.roads.push({ x0: x - ROAD / 2, x1: x + ROAD / 2, z0: -305, z1: 305 }); for (let z = -300; z < 300; z += 6) marks.push([x, z + 1.5, 0.18, 2.6]); }
  for (const z of STREETS) { MAP.roads.push({ x0: D.aves[0] - ROAD / 2, x1: D.aves[D.aves.length - 1] + ROAD / 2, z0: z - ROAD / 2, z1: z + ROAD / 2 }); for (let x = D.aves[0]; x < D.aves[D.aves.length - 1]; x += 6) marks.push([x + 1.5, z, 2.6, 0.18]); }
  if (D.cars) for (const x of D.aves) for (const z of STREETS) for (let s = -3.5; s <= 3.5; s += 1.4) { zebra.push([x + s, z - ROAD / 2 - 1.6, 0.7, 2.6]); zebra.push([x - ROAD / 2 - 1.6, z + s, 2.6, 0.7]); }
}
function instBoxes(list, mat, y, h) { const im = new THREE.InstancedMesh(BOX, mat, list.length), o = new THREE.Object3D(); list.forEach((r, i) => { o.position.set(r[0], y, r[1]); o.scale.set(r[2], h, r[3]); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); im.receiveShadow = true; scene.add(im); return im; }
{
  const im = new THREE.InstancedMesh(BOX, slabM, slabs.length), cm = new THREE.InstancedMesh(BOX, curbM, slabs.length), o = new THREE.Object3D();
  slabs.forEach((b, i) => { o.position.set(b.cx, 0.07, b.cz); o.scale.set(b.x1 - b.x0, 0.14, b.z1 - b.z0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); o.position.y = 0.06; o.scale.set(b.x1 - b.x0 + 0.5, 0.12, b.z1 - b.z0 + 0.5); o.updateMatrix(); cm.setMatrixAt(i, o.matrix); });
  im.receiveShadow = true; cm.receiveShadow = true; scene.add(cm, im);
  instBoxes(marks, glow(0xd9cfa0, 0.35), 0.015, 0.02); instBoxes(zebra, M(0xc9c7c2, { roughness: 0.6 }), 0.015, 0.02);
}
// plazas between the yard fence and the first avenue on each side
for (const [x0, x1] of [[-65, -40.5], [40.5, 65]]) { box(x1 - x0, 0.14, 610, slabM, (x0 + x1) / 2, 0.07, 0); MAP.parks.push({ x0, x1, z0: -305, z1: 305, kind: 'plaza' }); }

// ---------- the buildings: one instanced mesh, windows drawn by the shader ----------
const bMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.08 });
bMat.onBeforeCompile = sh => {
  sh.uniforms.uNight = WIN.uNight;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying float vSeed;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      mat4 imx = modelMatrix * instanceMatrix; vWP = (imx * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(imx) * objectNormal);
      vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uNight; varying vec3 vWP; varying vec3 vWN; varying float vSeed;
      float hh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      float isWall = step(abs(vWN.y), 0.5);
      vec2 fu = vec2(dot(vWP.xz, vec2(-vWN.z, vWN.x)), vWP.y);
      vec2 cellS = vec2(2.6 + vSeed * 1.6, 3.4); vec2 gw = fu / cellS; vec2 fw = fract(gw); vec2 wid = floor(gw);
      float shop = step(vWP.y, 3.6);
      float win = isWall * step(0.16, fw.x) * step(fw.x, 0.84) * mix(step(0.26, fw.y) * step(fw.y, 0.8), step(0.12, fw.y) * step(fw.y, 0.9), shop) * step(0.5, vWP.y);
      float rr = hh(vec3(wid, vSeed * 91.0 + dot(vWN, vec3(1., 2., 3.))));
      vec3 glass = mix(vec3(0.16, 0.2, 0.26), vec3(0.03, 0.035, 0.045), uNight);
      diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
      diffuseColor.rgb *= 1.0 - 0.2 * isWall * step(fract(vWP.y / 3.4), 0.07) * (1.0 - win);
      diffuseColor.rgb *= mix(0.32, 1.0, isWall);`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.12, win);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float lit = win * step(rr, 0.1 + 0.42 * uNight + shop * 0.3) * (0.15 + 0.85 * uNight);
      vec3 wc = mix(vec3(1.0, 0.7, 0.4), vec3(0.72, 0.84, 1.0), step(0.72, hh(vec3(wid.yx, vSeed * 13.0))));
      wc = mix(wc, vec3(0.2, 1.0, 0.75), step(0.985, hh(vec3(wid, vSeed * 7.0))));
      totalEmissiveRadiance += wc * lit * (0.55 + 0.9 * hh(vec3(wid * 1.7, vSeed))) * 1.5;`);
};
const PAL = { west: [0x6b4a3c, 0x7a5a48, 0x5e5650, 0x8a7a64, 0x4f4a48, 0x6a3a30, 0x9a8a74], east: [0x3a4250, 0x525a66, 0x2c3440, 0x6a707a, 0x8a8e94, 0x404a5a, 0x5a6270, 0x232a34] };
export const towers = [], neon = []; const props = [], antennas = [], gables = [];
function fillLot(b, kind) {
  const L = b.lot, W = L.x1 - L.x0, Dp = L.z1 - L.z0, nx = rnd() < 0.5 ? 1 : 2, nz = rnd() < 0.55 ? 1 : 2;
  for (let a = 0; a < nx; a++) for (let c = 0; c < nz; c++) {
    const w = W / nx - 2.5, d = Dp / nz - 2.5, x = L.x0 + (a + 0.5) * W / nx, z = L.z0 + (c + 0.5) * Dp / nz;
    const center = 1 - Math.min(1, Math.hypot(x - 200, z) / 260);
    const h = kind === 'east' ? 16 + Math.pow(rnd(), 1.5) * (40 + 90 * center) : 7 + Math.pow(rnd(), 1.4) * 22;
    towers.push({ x, z, w, d, h, c: pick(PAL[kind]) });
    solid(x, z, w, d, h);
    if (kind === 'west' && h < 18 && rnd() < 0.65) { gables.push({ x, z, w, d, h }); continue; }   // old houses keep pitched roofs
    // a setback on tall towers, things on the roofs
    if (h > 50 && rnd() < 0.6) { const h2 = 8 + rnd() * 20; towers.push({ x, z, w: w * 0.62, d: d * 0.62, h: h2, y: h, c: pick(PAL[kind]) }); if (rnd() < 0.6) antennas.push([x, h + h2, z]); }
    else if (rnd() < 0.3) antennas.push([x, h, z]);
    for (let i = 0; i < 3; i++) if (rnd() < 0.7) props.push([x + (rnd() - 0.5) * w * 0.6, h + 0.8, z + (rnd() - 0.5) * d * 0.6, 1.2 + rnd() * 2.2, 1 + rnd() * 1.4]);
    // a shop sign on the street side
    if (rnd() < (kind === 'east' ? 0.55 : 0.35)) { const side = pick([0, 1, 2, 3]); neon.push({ x, z, w, d, side }); }
  }
}

// ---------- named places ----------
const P = (o) => { PLACES.push(o); return o; };
const blk = (k, i, j) => { const b = DISTRICTS[k].blocks[i][j]; b.used = true; return b; };
// a building you can walk into: four walls with a door gap, a floor, a roof that lifts when you are inside
export function room({ x, z, w, d, h = 6.5, door = 'w', color = 0x3a3e46, sign, signColor = '#2ed3a0', upper = 0, light = 0xffd6a0, openSide = null }) {
  const hide = [], wallM = M(color, { roughness: 0.75 }), t = 0.4, gap = 3.4;
  box(w, 0.16, d, M(0x6a5e52, { roughness: 0.6 }), x, 0.08, z, scene, true);   // floor
  const walls = { n: [x, z - d / 2, w, true], s: [x, z + d / 2, w, true], w: [x - w / 2, z, d, false], e: [x + w / 2, z, d, false] };
  for (const [k, [cx, cz, len, alongX]] of Object.entries(walls)) {
    const segs = k === openSide ? [] : k === door ? [[-len / 2, -gap / 2], [gap / 2, len / 2]] : [[-len / 2, len / 2]];
    for (const [a, b2] of segs) { const L = b2 - a, mid = (a + b2) / 2, px = alongX ? cx + mid : cx, pz = alongX ? cz : cz + mid; box(alongX ? L : t, h, alongX ? t : L, wallM, px, h / 2, pz, scene, true); solid(px, pz, alongX ? L : t, alongX ? t : L, h); }
    if (k === door) { box(alongX ? gap : t, h - 3.2, alongX ? t : gap, wallM, cx, 3.2 + (h - 3.2) / 2, cz, scene, true); }
  }
  const roof = box(w + 0.6, 0.4, d + 0.6, M(0x1a1c20, { roughness: 0.7 }), x, h + 0.2, z, scene, true); hide.push(roof);
  if (upper) { const u = box(w, upper, d, M(color, { roughness: 0.8 }), x, h + 0.4 + upper / 2, z, scene, true); hide.push(u); }
  const L = new THREE.PointLight(light, 60, Math.max(w, d) * 1.4, 1.6); L.position.set(x, h - 0.8, z); scene.add(L);
  for (let k = -1; k <= 1; k += 2) box(w * 0.3, 0.08, 0.5, glow(0xfff1d8, 2.2), x + k * w * 0.22, h - 0.15, z);
  // the sign over the door, and the door's own light
  const dv = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[door], dx = x + dv[0] * (w / 2 + 0.25), dz = z + dv[1] * (d / 2 + 0.25);
  if (sign) { const s = board(sign, signColor, Math.min(12, (dv[0] ? d : w) * 0.7)); s.position.set(dx + dv[0] * 0.05, h + 0.2 + (upper ? 1.2 : 1.6), dz + dv[1] * 0.05); s.rotation.y = Math.atan2(dv[0], dv[1]); scene.add(s); if (upper) s.position.y = h - 1.2, s.position.x += dv[0] * 0.3, s.position.z += dv[1] * 0.3; }
  box(dv[0] ? 0.3 : 3.6, 0.15, dv[0] ? 3.6 : 0.3, glow(0xfff1d8, 2.5, true), dx + dv[0] * 0.2, 3.35, dz + dv[1] * 0.2);
  interiors.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, hide });
  return { door: new THREE.Vector3(dx + dv[0] * 1.6, 0, dz + dv[1] * 1.6), x, z, w, d, h };
}
// a screen whose picture is redrawn from live data
export function screen(name, w, h, x, y, z, rotY) {
  const t = canvasTex(1024, Math.round(1024 * h / w), () => {}); const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 1.1, map: t });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.position.set(x, y, z); p.rotation.y = rotY; scene.add(p);
  box(w + 0.3, h + 0.3, 0.15, M(0x0e0f11), x - Math.sin(rotY) * 0.09, y, z - Math.cos(rotY) * 0.09).rotation.y = rotY;
  screens[name] = t;
}
export function drawScreen(name, title, rows, accent = '#2ed3a0') {
  const t = screens[name]; if (!t) return; const c = t.userData.canvas, x = c.getContext('2d'), W = c.width, H = c.height;
  x.fillStyle = '#07090a'; x.fillRect(0, 0, W, H); x.fillStyle = accent; x.fillRect(0, 0, W, 8);
  x.font = '900 64px D'; x.fillStyle = '#edebe6'; x.textBaseline = 'top'; x.fillText(title, 40, 34);
  x.font = '700 30px M'; rows.slice(0, Math.floor((H - 140) / 46)).forEach((r, i) => { const y = 130 + i * 46; x.fillStyle = 'rgba(237,235,230,.06)'; if (i % 2) x.fillRect(30, y - 6, W - 60, 44); x.fillStyle = '#c9c7c2'; x.fillText(r[0], 44, y); if (r[1]) { x.fillStyle = r[2] || accent; x.textAlign = 'right'; x.fillText(r[1], W - 44, y); x.textAlign = 'left'; } });
  t.needsUpdate = true;
}
const furn = M(0x2a2421, { roughness: 0.7 }), furnL = M(0x8a6a4a, { roughness: 0.6 }), metal = M(0xb0b4ba, { metalness: 0.8, roughness: 0.3 }), red = M(0xa3262f, { roughness: 0.5 });
export const SPOTS = { sit: [], stand: [], work: [] };   // where the townsfolk spend their time
{
  // Night Line Diner, Eastgate
  const b = blk('east', 2, 4), r = room({ x: b.lot.x0 + 14, z: b.cz, w: 24, d: 18, door: 'w', color: 0x2a3a3c, sign: 'NIGHT LINE DINER', signColor: '#ff4d8a', upper: 9, light: 0xffc890 });
  box(12, 1.1, 1.2, red, r.x + 4, 0.55, r.z - 3, scene, true); box(12.2, 0.12, 1.5, metal, r.x + 4, 1.16, r.z - 3); solid(r.x + 4, r.z - 3, 12, 1.2, 1.2);
  for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.12, 14), red); s.position.set(r.x - 1 + i * 2, 0.8, r.z - 1.6); scene.add(s); box(0.1, 0.7, 0.1, metal, r.x - 1 + i * 2, 0.4, r.z - 1.6); }
  box(10, 2.2, 0.4, M(0x3a2a24), r.x + 4, 1.6, r.z - 8.6);   // back bar
  for (let i = 0; i < 3; i++) { box(2.6, 0.8, 1.6, red, r.x - 8.6, 0.4, r.z + 2 + i * 2.8, scene, true); box(1.4, 0.08, 1.4, metal, r.x - 7.1, 0.9, r.z + 2 + i * 2.8); solid(r.x - 8.6, r.z + 2 + i * 2.8, 2.6, 1.6, 1); SPOTS.sit.push({ x: r.x - 8.3, z: r.z + 2 + i * 2.8, yaw: Math.PI / 2, place: 'diner' }); }
  const menu = board('COFFEE · PIE · NOODLES', '#ffb340', 7); menu.position.set(r.x + 4, 4.4, r.z - 8.38); scene.add(menu);
  SPOTS.work.push({ x: r.x + 4, z: r.z - 5.5, yaw: 0, place: 'diner' });
  P({ id: 'diner', name: 'Night Line Diner', x: r.x, z: r.z, door: r.door, at: new THREE.Vector3(r.x + 4, 0, r.z - 1.2), r: 2.4, color: '#ff4d8a', note: 'Open all night. A coffee puts you back on your feet.' });
}
{
  // Crew Desk HQ, Eastgate: the crew's paper desk, live on the wall
  const b = blk('east', 1, 5), r = room({ x: b.lot.x0 + 13, z: b.cz, w: 22, d: 20, door: 'w', color: 0x1f2a30, sign: 'CREW DESK', signColor: '#2ed3a0', upper: 26, light: 0xd8f0ff });
  screen('crew', 10, 4.4, r.x + 10.75, 3.4, r.z, -Math.PI / 2);
  for (let i = 0; i < 3; i++) for (let k = -1; k <= 1; k += 2) { const dx = r.x - 3 + i * 4, dz = r.z + k * 4; box(2.6, 0.8, 1.4, furn, dx, 0.4, dz, scene, true); box(1, 0.6, 0.06, glow(0x2ed3a0, 1.2), dx, 1.15, dz - k * 0.3); solid(dx, dz, 2.6, 1.4, 1); SPOTS.work.push({ x: dx, z: dz + k * 1.2, yaw: k > 0 ? Math.PI : 0, place: 'crew' }); }
  P({ id: 'crew', name: 'Crew Desk HQ', x: r.x, z: r.z, door: r.door, at: new THREE.Vector3(r.x + 8.5, 0, r.z), r: 2.8, color: '#2ed3a0', note: 'The crew\'s public paper desk, live on the wall.' });
}
{
  // Deployer Office, Eastgate: the records of who launched what
  const b = blk('east', 1, 2), r = room({ x: b.lot.x0 + 12, z: b.cz, w: 20, d: 16, door: 'w', color: 0x3a3430, sign: 'DEPLOYER OFFICE', signColor: '#edebe6', upper: 14, light: 0xffe2b0 });
  for (let i = 0; i < 6; i++) { box(1.4, 2.2, 0.9, M(0x4a4e54, { metalness: 0.5, roughness: 0.4 }), r.x - 6 + i * 2.2, 1.1, r.z - 7.2, scene, true); } solid(r.x - 0.5, r.z - 7.2, 13.4, 0.9, 2.2);
  box(3, 0.8, 1.4, furnL, r.x + 3, 0.4, r.z + 2, scene, true); solid(r.x + 3, r.z + 2, 3, 1.4, 1);
  screen('deployer', 5, 2.6, r.x + 9.75, 2.6, r.z + 2, -Math.PI / 2);
  SPOTS.work.push({ x: r.x + 3, z: r.z + 3.3, yaw: Math.PI, place: 'deployer' });
  P({ id: 'deployer', name: 'Deployer Office', x: r.x, z: r.z, door: r.door, at: new THREE.Vector3(r.x + 7.5, 0, r.z + 2), r: 2.6, color: '#edebe6', note: 'Every wallet that launched on Pons, on file.' });
}
{
  // Central Station, on the plaza beside the yard: the departures board shows the latest calls
  const r = room({ x: 53, z: 150, w: 22, d: 48, h: 9, door: 'e', color: 0x2e3238, sign: 'CENTRAL STATION', signColor: '#edebe6', light: 0xfff0d8, openSide: 'w' });
  screen('station', 14, 4.2, 42.4, 5.4, 150, Math.PI / 2);
  for (let i = 0; i < 4; i++) { box(5, 0.5, 1, furnL, 54, 0.45, 132 + i * 11, scene, true); solid(54, 132 + i * 11, 5, 1, 0.8); SPOTS.sit.push({ x: 54, z: 132.9 + i * 11, yaw: Math.PI, place: 'station' }); }
  box(1.2, 1.2, 6, M(0x23262b), 61.5, 0.6, 172, scene, true); solid(61.5, 172, 1.2, 6, 1.2); SPOTS.work.push({ x: 62.8, z: 172, yaw: -Math.PI / 2, place: 'station' });
  for (let i = 0; i < 5; i++) SPOTS.stand.push({ x: 46 + (i % 2) * 3, z: 135 + i * 7, place: 'station' });
  P({ id: 'station', name: 'Central Station', x: 53, z: 150, door: r.door, at: new THREE.Vector3(45, 0, 150), r: 4.5, color: '#edebe6', note: 'The departures board: the latest calls Shuntdesk filed.' });
}
{
  // the Crash Site, Westbank: where the wrecks end up, and where the RISKY come from after dark
  const b = blk('west', 3, 6), g = new THREE.Group(); g.position.set(b.cx, 0, b.cz); scene.add(g);
  box(b.lot.x1 - b.lot.x0, 0.2, b.lot.z1 - b.lot.z0, M(0x2a2420, { roughness: 1 }), 0, 0.1, 0, g);
  [[-6, 1.4, -4, 0.2, 0.5, 0.45, 0x3a2224], [5, 1.3, 6, -0.1, -0.3, -0.7, 0x22252a], [-2, 1, 10, 0.3, 1.2, 0.2, 0x5a3a24], [8, 1.2, -9, 0, 0.9, 1.4, 0x2a3a3c]].forEach(([x, y, z, a, bb, c, col]) => { const w = box(3.2, 3.4, 9, M(col, { roughness: 0.6 }), x, y, z, g, true); w.rotation.set(a, bb, c); solid(b.cx + x, b.cz + z, 6, 6, 3); });
  for (let i = -2; i <= 2; i++) box(1.6, 0.9, 0.2, M(i % 2 ? 0xe6b450 : 0x1a1a1a), b.lot.x1 - b.cx - 0.5, 0.6, i * 2, g, true).rotation.y = Math.PI / 2;
  const f = new THREE.PointLight(0xff4d2a, 50, 30, 1.8); f.position.set(0, 3, 0); g.add(f); g.userData.fire = f;
  const s = label(['CRASH SITE', 'RUG REPLAY'], { size: 52, accent: '#ff4d5e', scale: 0.014 }); s.position.set(0, 7, 0); g.add(s);
  P({ id: 'crash', name: 'Crash Site', x: b.cx, z: b.cz, at: new THREE.Vector3(b.lot.x1 + 1, 0, b.cz), r: 4, color: '#ff4d5e', note: 'Wrecks of rugged tokens. After dark, the RISKY come out of here.', fire: f });
}
{
  // the Radio Tower, Westbank
  const b = blk('west', 2, 8);
  for (let i = 0; i < 10; i++) box(2 - i * 0.15, 4, 2 - i * 0.15, M(0x3a3e45, { metalness: 0.6 }), b.cx, 2 + i * 4, b.cz, scene, true);
  const tip = box(0.9, 0.9, 0.9, glow(0xff3b4e, 6), b.cx, 42, b.cz); tip.userData.blink = true; PLACES.blink = [tip.material];
  box(6, 3, 5, M(0x2a2d32), b.cx + 5, 1.5, b.cz + 4, scene, true); solid(b.cx, b.cz, 2.4, 2.4, 40); solid(b.cx + 5, b.cz + 4, 6, 5, 3);
  const s = label(['RADIO TOWER', '@SHUNTDESK_BOT'], { size: 48, accent: '#a9d6ff', scale: 0.014 }); s.position.set(b.cx, 9, b.cz + 8); scene.add(s);
  P({ id: 'radio', name: 'Radio Tower', x: b.cx, z: b.cz, at: new THREE.Vector3(b.cx + 5, 0, b.cz + 7.5), r: 3, color: '#a9d6ff', note: 'The bot\'s line: t.me/shuntdesk_bot' });
}
{
  // Curve Market, Westbank: stalls under strings of lights
  const b = blk('west', 2, 4), cols = [0xa3262f, 0x2e7d6a, 0xe6b450, 0x3a5a9a];
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) { const x = b.lot.x0 + 6 + i * 9, z = b.lot.z0 + 8 + k * 14; box(4, 1, 2, furnL, x, 0.5, z, scene, true); const roof = box(4.6, 0.15, 3, M(pick(cols), { roughness: 0.6 }), x, 2.6, z, scene, true); roof.rotation.x = 0.15; for (const o of [-2, 2]) box(0.12, 2.6, 0.12, M(0x2a2421), x + o, 1.3, z - 1.3); solid(x, z, 4, 2, 1); SPOTS.work.push({ x, z: z + 1.6, yaw: Math.PI, place: 'market' }); }
  for (let k = 0; k < 3; k++) for (let i = 0; i < 18; i++) box(0.18, 0.18, 0.18, glow(pick([0xffb340, 0xff4d8a, 0x2ed3a0, 0xfff1d8]), 2.4, true), b.lot.x0 + 3 + i * 2, 3.4 + Math.sin(i * 0.7) * 0.2, b.lot.z0 + 15 + k * 14);
  const s = label('CURVE MARKET', { size: 60, accent: '#ffb340', scale: 0.014 }); s.position.set(b.cx, 6.5, b.lot.z1); scene.add(s);
  MAP.parks.push({ x0: b.lot.x0, x1: b.lot.x1, z0: b.lot.z0, z1: b.lot.z1, kind: 'market' });
  P({ id: 'market', name: 'Curve Market', x: b.cx, z: b.cz, at: new THREE.Vector3(b.cx, 0, b.lot.z1 + 1), r: 5, color: '#ffb340', note: 'Stalls, lights, people. Westbank after work.' });
}
// parks: trees, benches, a fountain in Signal Square
const trees = [];

// ---------- north of Eastgate: Liquidity Lake and The Wheel ----------
export const LAKE = { x: 300, z: 420, rx: 78, rz: 38 };
export const inLake = (x, z, pad = 0) => ((x - LAKE.x) / (LAKE.rx + pad)) ** 2 + ((z - LAKE.z) / (LAKE.rz + pad)) ** 2 < 1;
export const WHEEL = { x: 160, z: 410, r: 22, g: null, cars: [], spin: 0 };
export const STADIUM = { x: 200, z: -405 };
{
  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: 0x14303a, roughness: 0.06, metalness: 0.7, emissive: 0x061418 }));
  water.rotation.x = -Math.PI / 2; water.scale.set(LAKE.rx, LAKE.rz, 1); water.position.set(LAKE.x, 0.06, LAKE.z); scene.add(water);
  const shore = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.08, 64), M(0x8a7a64, { roughness: 1 })); shore.rotation.x = -Math.PI / 2; shore.scale.set(LAKE.rx, LAKE.rz, 1); shore.position.set(LAKE.x, 0.07, LAKE.z); scene.add(shore);
  // the walk around the lake, with lamps
  for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2, x = LAKE.x + Math.cos(a) * (LAKE.rx + 7), z = LAKE.z + Math.sin(a) * (LAKE.rz + 7); box(0.16, 4, 0.16, M(0x2a2d32), x, 2, z); box(0.5, 0.3, 0.5, glow(0xffd9a0, 4, true), x, 4.1, z); }
  for (let k = -4; k <= 4; k++) { const f = k / 4.6, hw = LAKE.rx * Math.sqrt(1 - f * f) * 0.97; solid(LAKE.x, LAKE.z + f * LAKE.rz, hw * 2, LAKE.rz / 4.6 * 1.05, 0.3); }   // the water: you walk round it, not across
  const jetty = box(4, 0.3, 24, M(0x6a5038, { roughness: 0.8 }), LAKE.x - 20, 0.35, LAKE.z - LAKE.rz + 6, scene, true);
  const s = label(['LIQUIDITY LAKE'], { size: 56, accent: '#a9d6ff', scale: 0.016 }); s.position.set(LAKE.x, 6, LAKE.z - LAKE.rz - 9); scene.add(s);
  P({ id: 'lake', name: 'Liquidity Lake', x: LAKE.x, z: LAKE.z - LAKE.rz - 8, at: new THREE.Vector3(LAKE.x, 0, LAKE.z - LAKE.rz - 8), r: 7, color: '#a9d6ff', note: 'Deep water north of Eastgate. Quiet, mostly.' });
  MAP.parks.push({ x0: LAKE.x - LAKE.rx, x1: LAKE.x + LAKE.rx, z0: LAKE.z - LAKE.rz, z1: LAKE.z + LAKE.rz, kind: 'water' });

  // The Wheel: it turns all day, lit after dark, and it takes passengers
  const W = WHEEL, base = new THREE.Group(); base.position.set(W.x, 0, W.z); scene.add(base);
  const steel = M(0xd8d4cc, { metalness: 0.7, roughness: 0.35 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = box(0.7, W.r + 6, 0.7, steel, sx * 7, (W.r + 4) / 2, sz * 2.2, base, true); leg.rotation.z = -sx * 0.32; }
  box(0.8, 0.8, 6, steel, 0, W.r + 4, 0, base);
  const rot = new THREE.Group(); rot.position.set(0, W.r + 4, 0); base.add(rot); W.g = rot;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(W.r, 0.35, 8, 64), steel); rot.add(rim); const rim2 = rim.clone(); rim2.position.z = 1.6; rot.add(rim2); rim.position.z = -1.6;
  const bulbs = glow(0xffcf8f, 3, true), pinkB = glow(0xff4d8a, 3, true), greenB = glow(0x2ed3a0, 3, true);
  for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; box(0.35, 0.35, 0.35, [bulbs, pinkB, greenB][i % 3], Math.cos(a) * W.r, Math.sin(a) * W.r, 1.9, rot); box(0.35, 0.35, 0.35, [bulbs, pinkB, greenB][(i + 1) % 3], Math.cos(a) * W.r, Math.sin(a) * W.r, -1.9, rot); }
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, sp = box(W.r, 0.2, 0.2, steel, Math.cos(a) * W.r / 2, Math.sin(a) * W.r / 2, 0, rot); sp.rotation.z = a; }
  const cabM = [0xa3262f, 0x2e5a8a, 0xe6b450, 0x2e7d6a].map(c => M(c, { roughness: 0.5, metalness: 0.3 }));
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, cab = new THREE.Group(); cab.position.set(Math.cos(a) * W.r, Math.sin(a) * W.r, 0); rot.add(cab); box(2.4, 2, 2.6, cabM[i % 4], 0, -1.6, 0, cab, true); box(2.6, 0.2, 2.8, M(0x1a1c20), 0, -0.5, 0, cab); box(2.2, 0.15, 2.4, glow(0xfff1d8, 1.4, true), 0, -0.65, 0, cab); W.cars.push(cab); }
  box(10, 0.4, 7, M(0x3a3e45), 0, 0.2, 0, base, true); solid(W.x, W.z, 16, 6, 6);
  const ws = label(['THE WHEEL', 'RIDES ALL NIGHT'], { size: 50, accent: '#ff4d8a', scale: 0.015 }); ws.position.set(0, 4.5, 5); base.add(ws);
  P({ id: 'wheel', name: 'The Wheel', x: W.x, z: W.z, at: new THREE.Vector3(W.x, 0, W.z + 5.5), r: 3.5, color: '#ff4d8a', note: 'Ride it and see the whole city.' });
}
export function wheelTick(dt) { WHEEL.spin += dt * 0.07; WHEEL.g.rotation.z = WHEEL.spin; for (const c of WHEEL.cars) c.rotation.z = -WHEEL.spin; }

// ---------- bus stops: a ride across town ----------
export const STOPS = [];
for (const [id, name, x, z, rot] of [['stop-station', 'Station Plaza', 66, 104, 0], ['stop-square', 'Signal Square', 241.5, 14, 0], ['stop-lake', 'Liquidity Lake', 215, 340, 0], ['stop-market', 'Curve Market', -131.5, -16, 0], ['stop-crash', 'Crash Site', -76.5, 62, 0], ['stop-stadium', 'Curve Stadium', 168, -332, 0], ['stop-court', 'Westbank Court', -239.5, -76, 0]]) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  box(0.12, 2.8, 0.12, M(0x2a2d32), -1.4, 1.4, 0, g); box(0.12, 2.8, 0.12, M(0x2a2d32), 1.4, 1.4, 0, g); box(3.2, 0.12, 1.6, M(0x23262b), 0, 2.85, -0.3, g, true);
  box(3, 1.6, 0.06, new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.5 }), 0, 1.6, -1, g); box(2.6, 0.4, 0.5, M(0x6a5038), 0, 0.5, -0.7, g);
  box(0.5, 0.5, 0.06, glow(0x2ed3a0, 2.4, true), 1.8, 3.2, 0, g); box(0.08, 3.4, 0.08, M(0x2a2d32), 1.8, 1.7, 0, g);
  const s = label(['BUS · ' + name.toUpperCase()], { size: 34, accent: '#2ed3a0', scale: 0.012 }); s.position.set(0, 3.8, 0); g.add(s);
  solid(x, z - 0.7, 3.2, 0.8, 2.8);
  STOPS.push({ id, name, x, z, at: new THREE.Vector3(x, 0, z + 1.2) });
}
function park(b, name, color) {
  MAP.parks.push({ x0: b.lot.x0, x1: b.lot.x1, z0: b.lot.z0, z1: b.lot.z1, kind: 'park' });
  box(b.lot.x1 - b.lot.x0, 0.2, b.lot.z1 - b.lot.z0, M(0xffffff, { map: grassT, roughness: 1 }), b.cx, 0.15, b.cz);
  for (let i = 0; i < 14; i++) { const x = b.lot.x0 + 3 + rnd() * (b.lot.x1 - b.lot.x0 - 6), z = b.lot.z0 + 3 + rnd() * (b.lot.z1 - b.lot.z0 - 6); if (Math.hypot(x - b.cx, z - b.cz) < 7) continue; trees.push([x, z, 0.8 + rnd() * 0.6]); solid(x, z, 0.8, 0.8, 4); }
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, x = b.cx + Math.cos(a) * 9, z = b.cz + Math.sin(a) * 9; const bn = box(3, 0.45, 0.8, furnL, x, 0.45, z, scene, true); bn.rotation.y = -a + Math.PI / 2; SPOTS.sit.push({ x: x - Math.cos(a) * 0.3, z: z - Math.sin(a) * 0.3, yaw: -a - Math.PI / 2, place: name }); }
  const s = label(name.toUpperCase(), { size: 56, accent: color, scale: 0.014 }); s.position.set(b.cx, 5.5, b.lot.z1); scene.add(s);
  return b;
}
{
  setSeed(41);
  const sq = park(blk('east', 3, 5), 'Signal Square', '#2ed3a0');
  const f = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.4, 0.8, 32), M(0x8a8a8c, { roughness: 0.5 })); f.position.set(sq.cx, 0.4, sq.cz); f.castShadow = f.receiveShadow = true; scene.add(f); solid(sq.cx, sq.cz, 7, 7, 1);
  const wtr = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.1, 32), M(0x1a3a44, { roughness: 0.05, metalness: 0.6, emissive: 0x0a2a30 })); wtr.position.set(sq.cx, 0.78, sq.cz); scene.add(wtr);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 3, 12), M(0x9a9a9c)); col.position.set(sq.cx, 1.5, sq.cz); scene.add(col);
  P({ id: 'square', name: 'Signal Square', x: sq.cx, z: sq.cz, at: new THREE.Vector3(sq.cx, 0, sq.cz + 6), r: 5, color: '#2ed3a0', note: 'Eastgate\'s square. Somewhere to sit.' });
  const op = park(blk('west', 1, 5), 'Old Quarter Park', '#9fd48a');
  P({ id: 'park', name: 'Old Quarter Park', x: op.cx, z: op.cz, at: new THREE.Vector3(op.cx, 0, op.cz + 6), r: 6, color: '#9fd48a', note: 'Trees and benches in Westbank.' });
  // trees along the two plazas by the yard
  for (const x of [-52, 52]) for (let z = -290; z <= 290; z += 16) if (!(x > 0 && z > 120 && z < 180) && Math.abs(z + 30) > 7) { trees.push([x, z, 0.9]); solid(x, z, 0.8, 0.8, 4); }
  for (let i = 0; i < 220; i++) { const x = -340 + rnd() * 800, z = (rnd() < 0.5 ? -1 : 1) * (320 + rnd() * 160); if (Math.abs(x) < 50 || inLake(x, z, 14) || Math.hypot(x - WHEEL.x, z - WHEEL.z) < 30 || Math.hypot((x - STADIUM.x) / 1.3, z - STADIUM.z) < 70) continue; trees.push([x, z, 1 + rnd()]); if (Math.abs(z) < 470) solid(x, z, 0.8, 0.8, 4); }
}

// ---------- street life: avenue trees, parked cars, benches, food trucks, a court, a building site, a stadium ----------
export const ACTORS = [];
export const FOODTRUCKS = [];   // where to buy a meal: { x, z, name }   // townsfolk doing one thing on a loop: { x, z, y, yaw, a, ts }
export const PACERS = [];   // townsfolk walking back and forth: { a: [x, z], b: [x, z] }
export const CRANE = { jib: null };
// a group built in place, then handed to the scene piece by piece so the static merge can take it
const bake = g => { scene.add(g); g.updateMatrixWorld(true); [...g.children].forEach(c => scene.attach(c)); scene.remove(g); };
{
  setSeed(57);
  const nearStreet = (z, pad = 10) => STREETS.some(s => Math.abs(z - s) < pad);
  // trees on the Eastgate avenues, out of the way of the lamps
  for (const x of DISTRICTS.east.aves) for (let z = -284; z <= 284; z += 17) if (!nearStreet(z, 11)) for (const sx of [-1, 1]) { const tx = x + sx * (ROAD / 2 + 2.4); if (tx > 60 && tx < 68 && z > 120 && z < 180) continue; trees.push([tx, z, 0.62 + rnd() * 0.15]); solid(tx, z, 0.6, 0.6, 4); }

  // parked cars along the curbs: static, so they merge into a handful of draw calls
  const carCols = [0xa3262f, 0x2e5a8a, 0xd8d4cc, 0x1c1e22, 0xe6b450, 0x2e7d6a, 0x6a6e76, 0x7a3b5a, 0xc96a2a, 0xedebe6].map(c => M(c, { metalness: 0.6, roughness: 0.32 }));
  const pGlass = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.1, metalness: 0.8 }), pTyre = M(0x111214, { roughness: 0.9 }), WH = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 7); WH.rotateZ(Math.PI / 2);
  const park1 = (x, z, yaw) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw; const body = pick(carCols), van = rnd() < 0.18, L = van ? 5.2 : 4.3, H = van ? 1.7 : 1.05;
    box(1.95, H, L, body, 0, 0.45 + H / 2, 0, g); if (!van) { box(1.75, 0.72, L * 0.5, pGlass, 0, 0.45 + H + 0.36, -0.25, g); box(1.8, 0.08, L * 0.52, body, 0, 0.45 + H + 0.75, -0.25, g); } else box(1.97, 0.6, 1.2, pGlass, 0, 0.45 + H - 0.45, L / 2 - 0.8, g);
    for (const wx of [-0.9, 0.9]) for (const wz of [-L * 0.32, L * 0.32]) { const w = new THREE.Mesh(WH, pTyre); w.position.set(wx, 0.36, wz); g.add(w); }
    bake(g); const s = Math.abs(Math.sin(yaw)) > 0.5; solid(x, z, s ? L : 2, s ? 2 : L, 1.6);
  };
  for (const k in DISTRICTS) {
    const D = DISTRICTS[k], A = D.aves;
    for (const z of STREETS) for (let i = 0; i < A.length - 1; i++) for (let x = A[i] + 10; x < A[i + 1] - 10; x += 6.2) for (const sd of [-1, 1]) if (rnd() < (k === 'east' ? 0.3 : 0.22)) park1(x, z + sd * 4.5, Math.PI / 2);
    for (const x of A) for (let j = 0; j < STREETS.length - 1; j++) for (let z = STREETS[j] + 10; z < STREETS[j + 1] - 10; z += 6.2) for (const sd of [-1, 1]) if (rnd() < (k === 'east' ? 0.26 : 0.18)) park1(x + sd * 4.5, z, 0);
  }

  // benches, bins and hydrants at the corners
  const benches = [], bins = [], hydrants = [];
  for (const k in DISTRICTS) for (const col of DISTRICTS[k].blocks) for (const b of col) {
    if (rnd() < 0.6) { benches.push([b.x0 + 1, b.cz, Math.PI / 2]); ACTORS.push({ x: b.x0 + 1.25, z: b.cz, yaw: Math.PI / 2, a: 'sit', chance: 0.18 }); }
    if (rnd() < 0.6) benches.push([b.cx, b.z1 - 1, 0]);
    bins.push([b.x0 + 1, b.z0 + 4]); bins.push([b.x1 - 1, b.z1 - 4]);
    if (rnd() < 0.5) hydrants.push([b.x1 - 1, b.z0 + 7]);
  }
  const inst = (geo, mat, list, f) => { const im = new THREE.InstancedMesh(geo, mat, list.length), o = new THREE.Object3D(); list.forEach((v, i) => { f(o, v); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); scene.add(im); return im; };
  const benchG = new THREE.BoxGeometry(2.4, 0.12, 0.7); benchG.translate(0, 0.48, 0);
  inst(benchG, M(0x6a5038, { roughness: 0.7 }), benches, (o, [x, z, r]) => { o.position.set(x, 0, z); o.rotation.set(0, r, 0); });
  const backG = new THREE.BoxGeometry(2.4, 0.5, 0.08); backG.translate(0, 0.85, -0.3);
  inst(backG, M(0x6a5038, { roughness: 0.7 }), benches, (o, [x, z, r]) => { o.position.set(x, 0, z); o.rotation.set(0, r, 0); });
  inst(new THREE.CylinderGeometry(0.3, 0.26, 0.9, 10).translate(0, 0.45, 0), M(0x2e4a3a, { roughness: 0.6 }), bins, (o, [x, z]) => { o.position.set(x, 0, z); o.rotation.set(0, 0, 0); });
  inst(new THREE.CylinderGeometry(0.14, 0.18, 0.7, 8).translate(0, 0.35, 0), M(0xa3262f, { roughness: 0.5 }), hydrants, (o, [x, z]) => { o.position.set(x, 0, z); });
  for (const [x, z, r] of benches) solid(x, z, Math.abs(Math.sin(r)) > 0.5 ? 0.7 : 2.4, Math.abs(Math.sin(r)) > 0.5 ? 2.4 : 0.7, 1);

  // food trucks on the plazas by the yard, with a queue, a few tables, and lights strung over them
  const truckCols = [0xe6b450, 0x2e7d6a, 0xa3262f, 0x2e5a8a, 0xc58bff], foods = ['NOODLES', 'TACOS', 'COFFEE', 'DUMPLINGS', 'KEBAB', 'ICE CREAM', 'BURGERS'];
  [[58, -232], [58, -112], [58, 14], [58, 232], [-58, -172], [-58, -42], [-58, 92], [-58, 212]].forEach(([x, z], n) => {
    const side = x > 0 ? -1 : 1, g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;   // the hatch faces the plaza
    const col = M(truckCols[n % truckCols.length], { roughness: 0.4, metalness: 0.3 });
    box(2.6, 2.6, 6, col, 0, 1.75, 0, g, true); box(2.4, 1.6, 1.6, col, 0, 1.25, 3.7, g, true); box(2.3, 0.7, 0.06, pGlass, 0, 1.8, 4.52, g);
    box(0.06, 1.1, 3.6, glow(0xffe2b0, 1.4, true), 1.32, 2.2, -0.4, g); box(1.2, 0.08, 4, M(0xedebe6, { roughness: 0.6 }), 1.9, 3.15, -0.4, g).rotation.z = -0.25; box(0.6, 0.08, 3.6, M(0x8a8a8c), 1.6, 1.4, -0.4, g);
    for (const wz of [-2, 2.8]) for (const wx of [-1.2, 1.2]) { const w = new THREE.Mesh(WH, pTyre); w.position.set(wx, 0.4, wz); g.add(w); }
    bake(g); solid(x, z, 2.8, 8, 3);
    const sign = board(foods[n % foods.length], pick(['#ffb340', '#ff4d8a', '#2ed3a0', '#a9d6ff']), 4); sign.position.set(x + side * 1.36, 3.5, z - 0.4); sign.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2; scene.add(sign);
    ACTORS.push({ x: x + side * 0.4, z: z - 0.4, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2, a: 'interact-right', ts: 0.6 });
    FOODTRUCKS.push({ x: x + side * 2.4, z: z - 0.4, name: foods[n % foods.length] });
    for (let q = 0; q < 3; q++) ACTORS.push({ x: x + side * (2.6 + q * 1.1), z: z - 0.8 + (q % 2) * 0.7, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, a: 'idle', chance: 0.55 });
    for (let t = 0; t < 3; t++) { const tx = x + side * 8, tz = z - 6 + t * 6; const top = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 14), M(0xedebe6, { roughness: 0.5 })); top.position.set(tx, 0.78, tz); scene.add(top); box(0.08, 0.76, 0.08, M(0x2a2d32), tx, 0.38, tz); solid(tx, tz, 1.2, 1.2, 0.8);
      ACTORS.push({ x: tx - 0.9, z: tz, yaw: Math.PI / 2, a: 'sit', chance: 0.4 }); ACTORS.push({ x: tx + 0.9, z: tz, yaw: -Math.PI / 2, a: 'sit', chance: 0.25 }); }
    for (let i = 0; i < 12; i++) box(0.16, 0.16, 0.16, glow(pick([0xffb340, 0xff4d8a, 0x2ed3a0, 0xfff1d8]), 2.4, true), x + side * (1.6 + i * 0.6), 3.8 - Math.sin(i / 11 * Math.PI) * 0.5, z - 3);
  });

  // Signal Square: a busker and the people who stopped to listen
  const sq = PLACES.find(p => p.id === 'square');
  ACTORS.push({ x: sq.x, z: sq.z + 7, yaw: Math.PI, a: 'interact-right', ts: 1.4, always: true });
  box(0.6, 0.9, 0.5, M(0x15171a), sq.x + 1.2, 0.45, sq.z + 7.4); box(0.6, 0.9, 0.5, M(0x15171a), sq.x - 1.2, 0.45, sq.z + 7.4);
  const live = label(['LIVE ON THE SQUARE'], { size: 34, accent: '#ff4d8a', scale: 0.012 }); live.position.set(sq.x, 3.2, sq.z + 8); scene.add(live);
  for (let i = 0; i < 9; i++) { const a = -0.9 + i * 0.22, r = 4 + (i % 3) * 0.9; ACTORS.push({ x: sq.x + Math.sin(a) * r, z: sq.z + 7 - Math.cos(a) * r, yaw: Math.atan2(-Math.sin(a), Math.cos(a)), a: i % 3 ? 'emote-yes' : 'idle', ts: 0.45 + (i % 4) * 0.1, always: true }); }

  // Westbank Court: a game that never ends
  { const b = blk('west', 0, 3), L = b.lot;
    box(L.x1 - L.x0, 0.16, L.z1 - L.z0, M(0x2a4a5a, { roughness: 0.7 }), b.cx, 0.12, b.cz, scene, true);
    const line = M(0xedebe6, { roughness: 0.6 }); box(28, 0.02, 0.15, line, b.cx, 0.21, b.cz - 7.5); box(28, 0.02, 0.15, line, b.cx, 0.21, b.cz + 7.5); box(0.15, 0.02, 15, line, b.cx - 14, 0.21, b.cz); box(0.15, 0.02, 15, line, b.cx + 14, 0.21, b.cz); box(0.15, 0.02, 15, line, b.cx, 0.21, b.cz);
    for (const s of [-1, 1]) { box(0.2, 3.4, 0.2, M(0x2a2d32), b.cx + s * 13.4, 1.7, b.cz); box(0.08, 1.1, 1.8, M(0xedebe6), b.cx + s * 13.2, 3.4, b.cz); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 6, 16), M(0xff6a2a)); ring.rotation.x = Math.PI / 2; ring.position.set(b.cx + s * 12.8, 3.05, b.cz); scene.add(ring); solid(b.cx + s * 13.4, b.cz, 0.4, 0.4, 3.4); }
    for (let i = 0; i < 6; i++) ACTORS.push({ x: b.cx - 8 + (i % 3) * 7 + (i > 2 ? 2 : 0), z: b.cz - 3 + (i > 2 ? 5 : 0), yaw: i > 2 ? Math.PI : 0, a: i % 2 ? 'jump' : 'sprint', ts: 0.55 + i * 0.05, always: true });
    for (let i = 0; i < 4; i++) { box(2.4, 0.45, 0.7, M(0x6a5038), b.cx - 9 + i * 6, 0.45, L.z1 - 1.5); ACTORS.push({ x: b.cx - 9 + i * 6, z: L.z1 - 1.4, yaw: Math.PI, a: 'sit' }); }
    for (let i = 0; i < 4; i++) box(0.12, 8, 0.12, M(0x2a2d32), i < 2 ? L.x0 + 1 : L.x1 - 1, 4, i % 2 ? L.z0 + 1 : L.z1 - 1);
    const s = label('WESTBANK COURT', { size: 50, accent: '#a9d6ff', scale: 0.014 }); s.position.set(b.cx, 5.5, L.z0 - 0.5); scene.add(s);
    P({ id: 'court', name: 'Westbank Court', x: b.cx, z: b.cz, at: new THREE.Vector3(b.cx, 0, L.z0 - 1), r: 6, color: '#a9d6ff', note: 'Pick-up games until the lights go off.' });
    MAP.parks.push({ x0: L.x0, x1: L.x1, z0: L.z0, z1: L.z1, kind: 'court' }); }

  // the building site in Eastgate: a crane over a frame going up
  { const b = blk('east', 4, 3), L = b.lot, orange = M(0xff6a2a, { roughness: 0.6 }), conc = M(0x8a8a8c, { roughness: 0.9 }), yel = M(0xe6b450, { metalness: 0.4, roughness: 0.5 });
    for (let x = L.x0; x <= L.x1; x += 2) { box(1.8, 1.1, 0.08, x % 4 ? orange : M(0xedebe6), x, 0.55, L.z0); box(1.8, 1.1, 0.08, x % 4 ? orange : M(0xedebe6), x, 0.55, L.z1); }
    solid(b.cx, L.z0, L.x1 - L.x0, 0.3, 1.2); solid(b.cx, L.z1, L.x1 - L.x0, 0.3, 1.2);
    box(26, 0.6, 22, conc, b.cx, 0.3, b.cz, scene, true);
    for (let fl = 0; fl < 4; fl++) { for (let i = -2; i <= 2; i++) for (let k = -2; k <= 2; k += 2) box(0.6, 3.6, 0.6, conc, b.cx + i * 5.5, 0.6 + fl * 3.8 + 1.8, b.cz + k * 4.5, scene, true); if (fl < 3) box(24, 0.35, 20, conc, b.cx, 0.6 + (fl + 1) * 3.8, b.cz, scene, true); }
    solid(b.cx, b.cz, 26, 22, 16);
    const tx = L.x1 - 4, tz = L.z1 - 4; for (let i = 0; i < 14; i++) box(1.6, 4, 1.6, yel, tx, 2 + i * 4, tz, scene, true); solid(tx, tz, 1.8, 1.8, 56);
    const jib = new THREE.Group(); jib.position.set(tx, 57, tz); scene.add(jib); box(36, 1.2, 1.2, yel, -12, 0, 0, jib, true); box(8, 2.5, 2.5, conc, 9, -0.6, 0, jib); box(2.4, 2.4, 2.4, M(0x15171a), 0, 2, 0, jib); const tip = box(0.6, 0.6, 0.6, glow(0xff3b4e, 6), -30, 1, 0, jib); PLACES.blink = [...(PLACES.blink || []), tip.material];
    const cable = box(0.06, 22, 0.06, M(0x2a2d32), -22, -11, 0, jib); box(3, 1.2, 1.2, conc, -22, -22.5, 0, jib); CRANE.jib = jib;
    for (let i = 0; i < 8; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 10), orange); c.position.set(L.x0 + 2 + i * 1.4, 0.4, L.z0 - 1.6); scene.add(c); }
    for (let i = 0; i < 5; i++) ACTORS.push({ x: b.cx - 10 + i * 5, z: L.z0 + 3 + (i % 2) * 2, yaw: i * 1.3, a: i % 2 ? 'pick-up' : 'interact-right', ts: 0.6, always: true });
    const s = label(['BUILDING SITE', 'SOMETHING NEW GOING UP'], { size: 44, accent: '#ff6a2a', scale: 0.014 }); s.position.set(b.cx, 6, L.z0 - 1); scene.add(s);
    P({ id: 'site', name: 'Building Site', x: b.cx, z: b.cz, at: new THREE.Vector3(b.cx, 0, L.z0 - 2), r: 6, color: '#ff6a2a', note: 'Something new is going up in Eastgate.' }); }

  // Curve Stadium, south of Eastgate: stands full of people, lights you can see across town
  { const S = STADIUM, stand = [0x2e5a8a, 0x2ed3a0, 0x3a3e45], crowd = [], seg = 28;
    const pitch = new THREE.Mesh(new THREE.CircleGeometry(1, 48), M(0x2f5a2a, { roughness: 1 })); pitch.rotation.x = -Math.PI / 2; pitch.scale.set(44, 28, 1); pitch.position.set(S.x, 0.05, S.z); scene.add(pitch);
    box(60, 0.02, 0.3, M(0xedebe6), S.x, 0.07, S.z); box(0.3, 0.02, 34, M(0xedebe6), S.x, 0.07, S.z);
    for (let i = 0; i < seg; i++) {
      const a = i / seg * Math.PI * 2, x = S.x + Math.cos(a) * 58, z = S.z + Math.sin(a) * 40, len = 2 * Math.PI * 49 / seg + 1.5;
      for (let r = 0; r < 4; r++) { const st = box(len, 1.6, 3, M(stand[(i + r) % 3], { roughness: 0.7 }), S.x + Math.cos(a) * (50 + r * 3.2), 0.8 + r * 1.6, S.z + Math.sin(a) * (33 + r * 2.4), scene, true); st.rotation.y = -a + Math.PI / 2; for (let c = 0; c < 6; c++) if (rnd() < 0.7) crowd.push([S.x + Math.cos(a) * (50 + r * 3.2) + Math.sin(a) * (c - 2.5) * len / 6, 1.6 + r * 1.6 + 0.45, S.z + Math.sin(a) * (33 + r * 2.4) - Math.cos(a) * (c - 2.5) * len / 6]); }
      box(len, 2, 1, M(0x23262b), x, 7.6, z, scene, true).rotation.y = -a + Math.PI / 2; solid(x, z, 8, 8, 8);
    }
    const ci = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.9, 0.4), M(0xffffff, { roughness: 0.8 }), crowd.length), o = new THREE.Object3D(), cc = new THREE.Color();
    crowd.forEach(([x, y, z], i) => { o.position.set(x, y, z); o.rotation.set(0, i, 0); o.updateMatrix(); ci.setMatrixAt(i, o.matrix); ci.setColorAt(i, cc.setHSL(rnd(), 0.5, 0.35 + rnd() * 0.3)); }); scene.add(ci); CRANE.crowd = ci;
    for (const [dx, dz] of [[-62, -44], [62, -44], [-62, 44], [62, 44]]) { box(1, 34, 1, M(0x3a3e45), S.x + dx, 17, S.z + dz, scene, true); box(7, 3, 0.6, glow(0xfff4dc, 5, true), S.x + dx * 0.97, 34, S.z + dz * 0.97); solid(S.x + dx, S.z + dz, 1.4, 1.4, 34); }
    const s = label(['CURVE STADIUM'], { size: 70, accent: '#2ed3a0', scale: 0.02 }); s.position.set(S.x, 14, S.z + 46); scene.add(s);
    // the car park on its north side
    for (let r = 0; r < 3; r++) for (let c = 0; c < 14; c++) if (rnd() < 0.75) park1(S.x - 52 + c * 7.5, S.z + 54 + r * 7, 0);
    box(110, 0.03, 24, M(0x1d1e22, { roughness: 0.5 }), S.x, 0.02, S.z + 61);
    P({ id: 'stadium', name: 'Curve Stadium', x: S.x, z: S.z, at: new THREE.Vector3(S.x, 0, S.z + 44), r: 7, color: '#2ed3a0', note: 'Match night, most nights.' });
    MAP.parks.push({ x0: S.x - 60, x1: S.x + 60, z0: S.z - 42, z1: S.z + 42, kind: 'park' }); }

  // the yard's own crew walking the lines, and people waiting on the platforms
  for (const [x, z0, z1] of [[-4, -120, -40], [11, 20, 110], [-20, -220, -130], [15, -300, -200], [-12, 150, 260], [5, 300, 420]]) PACERS.push({ a: [x, z0], b: [x, z1] });
  for (let i = 0; i < 7; i++) ACTORS.push({ x: 34 + (i % 2) * 2.5, z: 128 + i * 6.5, y: 1, yaw: -Math.PI / 2, a: 'idle', chance: 0.85 });
  for (let i = 0; i < 4; i++) ACTORS.push({ x: -35 + (i % 2) * 1.5, z: -104 + i * 8, y: 1, yaw: Math.PI / 2, a: 'idle', chance: 0.8 });
}
{
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.26, 2.4, 6), M(0x3a2a20), trees.length), crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 0), M(0x2f4a2a, { roughness: 0.9, flatShading: true }), trees.length), o = new THREE.Object3D();
  trees.forEach(([x, z, s], i) => { o.position.set(x, 1.2 * s, z); o.scale.setScalar(s); o.rotation.set(0, i, 0); o.updateMatrix(); trunk.setMatrixAt(i, o.matrix); o.position.y = 3.2 * s; o.scale.set(s * (1 + (i % 3) * 0.15), s * 1.3, s); o.updateMatrix(); crown.setMatrixAt(i, o.matrix); crown.setColorAt(i, new THREE.Color().setHSL(0.25 + (i % 7) * 0.012, 0.35, 0.18 + (i % 5) * 0.025)); });
  scene.add(trunk, crown);
}

// ---------- fill every other lot ----------
setSeed(99);
for (const k in DISTRICTS) for (const col of DISTRICTS[k].blocks) for (const b of col) if (!b.used) fillLot(b, k);
{
  const im = new THREE.InstancedMesh(BOX, bMat, towers.length), o = new THREE.Object3D(), c = new THREE.Color();
  towers.forEach((t, i) => { o.position.set(t.x, (t.y || 0) + t.h / 2, t.z); o.scale.set(t.w, t.h, t.d); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, c.setHex(t.c)); });
  scene.add(im);   // the towers neither cast nor take shadows: too much screen for too little
  const pm = new THREE.InstancedMesh(BOX, M(0x2a2d32, { metalness: 0.4, roughness: 0.6 }), props.length); props.forEach((p, i) => { o.position.set(p[0], p[1], p[2]); o.scale.set(p[3], p[4], p[3] * 0.8); o.updateMatrix(); pm.setMatrixAt(i, o.matrix); }); pm.castShadow = true; scene.add(pm);
  const am = new THREE.InstancedMesh(BOX, M(0x3a3e45), antennas.length), al = new THREE.InstancedMesh(BOX, glow(0xff3b4e, 5), antennas.length);
  antennas.forEach((a, i) => { o.position.set(a[0], a[1] + 3, a[2]); o.scale.set(0.2, 6, 0.2); o.updateMatrix(); am.setMatrixAt(i, o.matrix); o.position.y = a[1] + 6.2; o.scale.setScalar(0.55); o.updateMatrix(); al.setMatrixAt(i, o.matrix); }); scene.add(am, al); PLACES.antennas = al.material;
  // pitched roofs on the old houses of Westbank
  const roofG = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]), { depth: 1, bevelEnabled: false }); roofG.translate(0, 0, -0.5);
  const rm = new THREE.InstancedMesh(roofG, M(0xffffff, { roughness: 0.8, flatShading: true }), gables.length), rc = [0x7a3a2a, 0x4a3a34, 0x5a2a24, 0x3a3e45, 0x6a4a3a];
  gables.forEach((t, i) => { const along = t.d >= t.w; o.position.set(t.x, t.h, t.z); o.rotation.set(0, along ? 0 : Math.PI / 2, 0); o.scale.set((along ? t.w : t.d) + 0.6, Math.min(t.w, t.d) * 0.38, (along ? t.d : t.w) + 0.6); o.updateMatrix(); rm.setMatrixAt(i, o.matrix); rm.setColorAt(i, c.setHex(rc[i % rc.length])); });
  o.rotation.set(0, 0, 0); scene.add(rm);
  // billboards on the towers that face the yard
  const ads = ['SEVEN CHECKS. ONE SCORE.', 'EVERY TOKEN RIDES THE LINE', 'KEEP THE LINE CLEAN', 'READ IT. THEN RIDE IT.'];
  towers.filter(t => !t.y && t.x > 60 && t.x < 160 && t.h > 40).slice(0, 4).forEach((t, i) => {
    const tex = canvasTex(1024, 320, (x, w, h) => { x.fillStyle = '#060708'; x.fillRect(0, 0, w, h); x.fillStyle = '#2ed3a0'; x.fillRect(0, 0, 14, h); x.font = '900 96px D'; x.fillStyle = '#edebe6'; x.textBaseline = 'middle'; const words = ads[i].split(' '), half = Math.ceil(words.length / 2); x.fillText(words.slice(0, half).join(' '), 50, 105); x.fillStyle = '#2ed3a0'; x.fillText(words.slice(half).join(' '), 50, 215); x.font = '700 26px M'; x.fillStyle = '#9a9da3'; x.fillText('SHUNTDESK', w - 230, h - 34); });
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.9, color: 0x000000 }); nightMats.push({ mat: m, k: 0.9, day: 0.55 });
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(18, 5.6), m); bb.position.set(t.x - t.w / 2 + 1, t.h + 4.5, t.z); bb.rotation.y = -Math.PI / 2; scene.add(bb);
    box(0.4, 6.2, 18.6, M(0x15171a), t.x - t.w / 2 + 1.25, t.h + 4.5, t.z); for (const dz of [-7, 7]) box(0.3, 2, 0.3, M(0x2a2d32), t.x - t.w / 2 + 1.3, t.h + 1, t.z + dz);
  });
  for (const n of neon) { const s = board(n.text = pick(['24H', 'NOODLES', 'HOTEL', 'ARCADE', 'BOOKS', 'KARAOKE', 'LAUNDRY', 'RAMEN', 'PIZZA', 'CINEMA', 'TAILOR', 'PHARMACY', 'GYM', 'FLOWERS', 'RECORDS', 'BAKERY']), pick(['#ff4d8a', '#2ed3a0', '#ffb340', '#a9d6ff', '#ff4d5e', '#c58bff']), Math.min(7, (n.side % 2 ? n.d : n.w) * 0.6)); const off = [[0, -n.d / 2 - 0.06, Math.PI], [n.w / 2 + 0.06, 0, Math.PI / 2], [0, n.d / 2 + 0.06, 0], [-n.w / 2 - 0.06, 0, -Math.PI / 2]][n.side]; s.position.set(n.x + off[0], 4.4, n.z + off[1]); s.rotation.y = off[2]; scene.add(s); }
}

// ---------- street lamps, with pools of light after dark ----------
export const poolMat = new THREE.MeshBasicMaterial({ map: haloTex, color: 0xffb060, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending });   // a soft pool, bright under the lamp
{
  const pts = [];
  for (const k in DISTRICTS) { const D = DISTRICTS[k]; for (const x of D.aves) for (let z = -295; z <= 295; z += 26) { pts.push([x - ROAD / 2 - 1.2, z, 1]); pts.push([x + ROAD / 2 + 1.2, z + 13, -1]); } }
  for (const x of [-44, 44]) for (let z = -300; z <= 300; z += 22) pts.push([x, z, x > 0 ? -1 : 1]);
  const pole = new THREE.InstancedMesh(BOX, M(0x2a2d32, { metalness: 0.5, roughness: 0.5 }), pts.length * 2), head = new THREE.InstancedMesh(BOX, glow(0xffcf8f, 5, true), pts.length), pool = new THREE.InstancedMesh(new THREE.CircleGeometry(5, 20), poolMat, pts.length), o = new THREE.Object3D();
  pts.forEach(([x, z, s], i) => { o.rotation.set(0, 0, 0); o.position.set(x, 3.25, z); o.scale.set(0.18, 6.5, 0.18); o.updateMatrix(); pole.setMatrixAt(i * 2, o.matrix); o.position.set(x + s * 0.7, 6.5, z); o.scale.set(1.6, 0.12, 0.14); o.updateMatrix(); pole.setMatrixAt(i * 2 + 1, o.matrix); o.position.set(x + s * 1.3, 6.4, z); o.scale.set(0.9, 0.2, 0.45); o.updateMatrix(); head.setMatrixAt(i, o.matrix); o.position.set(x + s * 1.3, 0.16, z); o.rotation.set(-Math.PI / 2, 0, 0); o.scale.setScalar(1); o.updateMatrix(); pool.setMatrixAt(i, o.matrix); solid(x, z, 0.3, 0.3, 6); });
  scene.add(pole, head, pool);
}

// ---------- traffic: cars, taxis, vans, trucks and buses loop around blocks on the right-hand lane ----------
{
  setSeed(17);
  const add = (D, n, slow, kinds) => {
    for (let c = 0; c < n; c++) {
      const kind = kinds[c % kinds.length], long = kind === 'bus';
      const i0 = Math.floor(rnd() * (D.aves.length - 1)), i1 = Math.min(D.aves.length - 1, i0 + (long ? 2 : 1) + Math.floor(rnd() * 3)), j0 = Math.floor(rnd() * (STREETS.length - 1)), j1 = Math.min(STREETS.length - 1, j0 + (long ? 3 : 1) + Math.floor(rnd() * 4));
      if (i1 === i0 || j1 === j0) continue;
      const cw = rnd() < 0.5, o = cw ? -2.5 : 2.5, x0 = D.aves[i0] - o, x1 = D.aves[i1] + o, z0 = STREETS[j0] - o, z1 = STREETS[j1] + o;
      // clockwise as seen from above (x right, z down) keeps the lane on the inside
      const pts = cw ? [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] : [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
      carRoutes.push({ pts, s: rnd() * 400, v: (long ? 7 : 9 + rnd() * 6) * (slow ? 0.75 : 1), kind });
    }
  };
  add(DISTRICTS.east, TOUCH ? 18 : 46, false, ['car', 'taxi', 'car', 'van', 'car', 'taxi', 'truck', 'car', 'bus', 'car']);
  add(DISTRICTS.west, TOUCH ? 6 : 16, true, ['car', 'van', 'car', 'truck', 'car', 'bus']);
}