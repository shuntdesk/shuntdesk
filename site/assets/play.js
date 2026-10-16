// The Yard: a city around a rail yard, and you are the shunter. Shifts at the Signal Box bring in real calls Shuntdesk
// filed as trains: read the manifest, pull RIDE or SIDING before the junction, and the price an hour or a day later
// says who read it right. Around the yard: Westbank and Eastgate, places to walk into whose screens show live
// Shuntdesk data, a day that turns into night, and after dark the RISKY. XP stays in this browser. Nothing to win.
window.showErr = window.showErr || (e => console.error(e));
import { THREE, $, TOUCH, scene, cam, composer, R, bloom, sun, mergeStatic, floorAt, label, box, glow, M, solid, BOX as BOX_G, clamp, lerp, damp, near, TIME, ENV, tickTime, clock, phaseName, sky, additive, haloTex } from './yard/core.js';
import { PLACES, MAP, interiors, drawScreen, districtAt, poolMat, STOPS, WHEEL, wheelTick, CRANE, screens, FOODTRUCKS, DISTRICTS, ROAD, room, screen, towers, neon, STREETS as STREETS_Z } from './yard/city.js';
import { scan, isAddr, pairFor } from './data.js';
import { startAudio, tickAudio, sfx, soundOn, setSound } from './yard/sound.js';
import { along, SID, END, ambient, runAmbient, makeTrain, spinWheels, CAR, levers, sig, halos, SB, SB_DOOR, bufLamp, crossLights, AMB, GRAD, JUNCTION, PLATFORMS, RAIL_EVENTS, CROSSINGS } from './yard/rail.js';
import { loadHero, loadTown, makePerson, HERO, NAMES as NAMES_ALL, makeCar, spawnTown, runTown, stationEvent, spawnPigeons, runPigeons, folk, zombies, spawnZombie, hitZombie, runZombies, cars, spawnCars, runCars } from './yard/people.js';

await Promise.all(['900 60px D', '700 20px M', '500 16px B'].map(f => document.fonts.load(f))).catch(() => {});
if (TOUCH) { document.body.classList.add('touch'); document.querySelector('#obj .cap').textContent = 'Mission · JOBS for the journal'; }
// the city and the yard are built by now: merge what never moves, keep the roofs that lift apart
mergeStatic(new Set(interiors.flatMap(r => r.hide)));
R.shadowMap.autoUpdate = false; let shadowTick = 0;
const money = v => v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : '$' + Math.round(v || 0);
const pct = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(Math.abs(v) < 0.995 ? 1 : 0) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const place = id => PLACES.find(p => p.id === id);
// Junction Station, by the Signal Box: a place like the others, with its own departures board
screens.junction = JUNCTION.screen;
PLACES.push({ id: 'junction', name: 'Junction Station', x: JUNCTION.x, z: JUNCTION.z, at: new THREE.Vector3(JUNCTION.x, 1, JUNCTION.z + JUNCTION.l / 2 - 7), r: 4, color: '#2ed3a0', note: 'The busiest platform in town, right by the Signal Box.' });

// ---------- the shunter ----------
const P = { pos: new THREE.Vector3(6, 0, -24), vy: 0, yaw: 0, ground: true, speed: 0, phase: 0, hp: 100, hurtT: 9, down: 0 };
let hero = null, emote = null;
$('load').textContent = 'Loading the shunter…'; window.boot?.(0.55, 'Loading the shunter');
try { await loadHero(); hero = makePerson(HERO, { height: 1.7, shadow: true }); hero.play('idle', 0); hero.mixer.addEventListener('finished', e => { if (emote && e.action === hero.acts[emote]) { emote = null; hero.play(pickLoco(), 0.3); } }); } catch (e) { console.warn('hero', e); }
const lantern = new THREE.Group(); lantern.position.set(-0.4, 0.62, 0.06); hero?.g.add(lantern);
{ const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffb060, emissiveIntensity: 2.4 })); lantern.add(m); }
const lanternL = new THREE.PointLight(0xffa850, 1.8, 10, 2); lanternL.position.set(-0.2, 0.2, 0.6); lantern.add(lanternL);
const blob = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false })); blob.rotation.x = -Math.PI / 2; scene.add(blob);
const pickLoco = () => !P.ground ? 'jump' : P.speed > 5.2 ? 'sprint' : P.speed > 0.35 ? 'walk' : 'idle';
function doEmote(n, ts = 1) { if (!hero?.acts[n]) return; emote = n; hero.once(n, 0.15, ts); }
// the town loads behind the title
let townReady = false;
window.boot?.(0.75, 'Waking up the town');
loadTown().then(() => { spawnTown(); spawnCars(); spawnPigeons([[11, 1, -66, 8], [11, 1, -86, 6], [262, 0, 30, 12], [58, 0, 0, 6], [-58, 0, -50, 6], [36, 1, 150, 6]]); populateRooms(); townReady = true; $('go').disabled = false; $('go').textContent = 'Enter the yard'; }).catch(e => console.warn('town', e));

// ---------- input ----------
const keys = {}; const look = { yaw: Math.PI, pitch: 0.3, dist: TOUCH ? 8.5 : 7 }; let act = false, jump = false, strike = false, joy = null, runToggle = false;
addEventListener('keydown', e => {
  keys[e.code] = true; if (e.repeat) return;
  if ($('info').classList.contains('on') && (e.code === 'Escape' || e.code === 'KeyE')) { closeInfo(); return; }
  if (e.code === 'KeyE' || e.code === 'Enter') act = true; if (e.code === 'Space') { jump = true; e.preventDefault(); } if (e.code === 'KeyF') strike = true;
  if (e.code === 'KeyJ') toggle('journal'); if (e.code === 'KeyM') toggle('bigmap'); if (e.code === 'Escape') { $('journal').classList.remove('on'); $('bigmap').classList.remove('on'); }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const cv = $('c'); let drag = null;
cv.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.45) { joy = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 }; const j = $('joy'); j.style.display = 'block'; j.style.left = e.clientX - 60 + 'px'; j.style.top = e.clientY - 60 + 'px'; return; }
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  if (joy && e.pointerId === joy.id) { joy.dx = clamp((e.clientX - joy.x) / 50, -1, 1); joy.dy = clamp((e.clientY - joy.y) / 50, -1, 1); $('joy').firstChild.style.transform = `translate(${joy.dx * 35}px,${joy.dy * 35}px)`; return; }
  if (!drag || e.pointerId !== drag.id) return;
  look.yaw -= (e.clientX - drag.x) * 0.006; look.pitch = clamp(look.pitch + (e.clientY - drag.y) * 0.004, -0.05, 1.2); drag.x = e.clientX; drag.y = e.clientY;
});
const up = e => { if (joy && e.pointerId === joy.id) { joy = null; $('joy').style.display = 'none'; $('joy').firstChild.style.transform = ''; } if (drag && e.pointerId === drag.id) drag = null; };
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
cv.addEventListener('wheel', e => { look.dist = clamp(look.dist + e.deltaY * 0.008, 3.2, 18); e.preventDefault(); }, { passive: false });
cv.addEventListener('contextmenu', e => e.preventDefault());
const tap = (id, f) => $(id).addEventListener('pointerdown', e => { f(); e.preventDefault(); e.stopPropagation(); });
tap('b-swap', () => swapWeapon()); tap('b-act', () => { if ($('info').classList.contains('on')) closeInfo(); else act = true; }); tap('b-jump', () => { jump = true; }); tap('b-hit', () => { strike = true; });
tap('b-run', () => { runToggle = !runToggle; $('b-run').classList.toggle('on', runToggle); });
tap('b-journal', () => toggle('journal')); tap('map', () => toggle('bigmap'));
function toggle(id) { const el = $(id); const on = !el.classList.contains('on'); $('journal').classList.remove('on'); $('bigmap').classList.remove('on'); el.classList.toggle('on', on); if (id === 'journal' && on) journalUI(); if (id === 'bigmap' && on) bigMap(); }
$('journal').addEventListener('click', e => { if (e.target.closest('.x')) return toggle('journal'); const li = e.target.closest('[data-m]'); if (li) { save.active = li.dataset.m; keep(); journalUI(); } });
$('bigmap').addEventListener('click', () => toggle('bigmap'));
$('info').addEventListener('click', e => { if (e.target.closest('.x') || e.target === $('info')) closeInfo(); });

// ---------- save ----------
const RANKS = [[0, 'Yard hand'], [400, 'Signalman'], [1200, 'Dispatcher'], [3000, 'Conductor']];
let save = { xp: 0, shifts: 0, right: 0, read: 0, done: [], active: null, kills: 0 };
try { save = { ...save, ...JSON.parse(localStorage.getItem('shunt.yard') || '{}') }; if (!Array.isArray(save.done)) save.done = []; } catch (e) {}
const keep = () => { try { localStorage.setItem('shunt.yard', JSON.stringify(save)); } catch (e) {} };
function rankUI() {
  let i = 0; while (i + 1 < RANKS.length && save.xp >= RANKS[i + 1][0]) i++;
  const next = RANKS[i + 1]; $('rk').textContent = RANKS[i][1]; $('xp').textContent = save.xp + ' XP' + (next ? ` · ${next[1]} at ${next[0]}` : '');
  $('rkbar').style.width = (next ? (save.xp - RANKS[i][0]) / (next[0] - RANKS[i][0]) * 100 : 100) + '%';
  return RANKS[i][1];
}
rankUI();
function addXp(n) { if (!n) return; save.xp += n; keep(); rankUI(); }

// ---------- missions ----------
const at = id => place(id)?.at;
const leverSpot = new THREE.Vector3(4.9, 0, -16);
const MISSIONS = [
  { id: 'duty', title: 'Report for duty', text: 'Walk to the Signal Box in the middle of the yard.', where: () => SB_DOOR, xp: 50, auto: () => dist(SB_DOOR) < 4 },
  { id: 'junction', title: 'Rush hour', text: 'Junction Station is right by the Signal Box. Step up onto the platform and read the departures board.', where: () => at('junction'), xp: 40 },
  { id: 'shift', title: 'First shift', text: 'Start a shift at the Signal Box. Five real calls come down the line: pull RIDE or SIDING before each one reaches the junction.', where: () => G.on ? leverSpot : SB_DOOR, xp: 0 },
  { id: 'board', title: 'Read the departures', text: 'Central Station is on the Eastgate side of the yard. Read the departures board: the latest calls Shuntdesk filed.', where: () => at('station'), xp: 60 },
  { id: 'crew', title: 'Meet the crew', text: 'Crew Desk HQ is in Eastgate. Their paper desk is live on the wall.', where: () => at('crew'), xp: 60 },
  { id: 'coffee', title: 'Coffee at the Night Line', text: 'The Night Line Diner never closes. A coffee puts you back on your feet.', where: () => at('diner'), xp: 40 },
  { id: 'files', title: 'The deployer files', text: 'The Deployer Office keeps the record of fresh Pons graduations. Check the terminal.', where: () => at('deployer'), xp: 60 },
  { id: 'market', title: 'Over to Westbank', text: 'Cross the yard into Westbank, the old quarter, and find Curve Market.', where: () => at('market'), xp: 50, auto: () => dist(at('market')) < 8 },
  { id: 'radio', title: 'The radio tower', text: 'The Radio Tower in Westbank carries the bot\'s line.', where: () => at('radio'), xp: 40 },
  { id: 'watch', title: 'Night watch', text: 'After dark the RISKY walk out of the Crash Site in Westbank. Stop five of them in one night: F to strike (the fist button on a phone).', where: () => at('crash'), xp: 250, auto: () => nightKills >= 5 },
  { id: 'lake', title: 'Up to the lake', text: 'Liquidity Lake is north of Eastgate. Walk up and see it.', where: () => at('lake'), xp: 40, auto: () => dist(at('lake')) < 10 },
  { id: 'wheel', title: 'Ride The Wheel', text: 'The Wheel stands by the lake. Take a ride and look over the whole city.', where: () => at('wheel'), xp: 60 },
  { id: 'ride', title: 'Ride the 22', text: 'When the track 22 train stands at Junction Station, step aboard from platform 2 and ride it to Central Station.', where: () => at('junction'), xp: 60 },
  { id: 'bus', title: 'Catch a bus', text: 'Green signs mark the bus stops. Take one across town.', where: () => nearestStop(), xp: 40 },
  { id: 'court', title: 'Pick-up game', text: 'Westbank Court is at the far end of the old quarter. Go and watch a game.', where: () => at('court'), xp: 40, auto: () => dist(at('court')) < 9 },
  { id: 'stadium', title: 'Match night', text: 'Curve Stadium is south of Eastgate. Its lights show the way after dark.', where: () => at('stadium'), xp: 50, auto: () => dist(at('stadium')) < 12 },
  { id: 'streak', title: 'Three in a row', text: 'Read three trains right in a row in one shift.', where: () => SB_DOOR, xp: 100 },
  { id: 'beat', title: 'Beat the desk', text: 'Finish a shift with more right calls than Shuntdesk made on the same trains.', where: () => SB_DOOR, xp: 150 },
  { id: 'lead', title: 'On the board', text: 'Pick a name (L) and finish a shift: the server scores it and puts you on this week\'s board.', where: () => SB_DOOR, xp: 80 },
  { id: 'rank', title: 'Make Signalman', text: 'Reach 400 XP. Shifts pay the most.', where: () => SB_DOOR, xp: 0, auto: () => save.xp >= 400 },
];
let nightKills = 0;
const dist = v => v ? Math.hypot(v.x - P.pos.x, v.z - P.pos.z) : 1e9;
const isDone = id => save.done.includes(id);
function active() { return MISSIONS.find(m => m.id === save.active && !isDone(m.id)) || MISSIONS.find(m => !isDone(m.id)); }
function complete(id) { if (isDone(id)) return; const m = MISSIONS.find(x => x.id === id); save.done.push(id); if (save.active === id) save.active = null; keep(); addXp(m.xp); sfx.mission(); banner('MISSION COMPLETE', m.title + (m.xp ? ` · +${m.xp} XP` : '')); }
function journalUI() {
  const a = active();
  $('j-list').innerHTML = MISSIONS.map(m => `<li data-m="${m.id}" class="${isDone(m.id) ? 'done' : m === a ? 'cur' : ''}"><i>${isDone(m.id) ? '✓' : m === a ? '▸' : ''}</i><div><b>${m.title}</b><span>${m.text}</span></div><em>${m.xp ? '+' + m.xp + ' XP' : ''}</em></li>`).join('');
  $('j-count').textContent = `${save.done.length} of ${MISSIONS.length} done · pick one to follow it`;
}
let bannerT = 0;
function banner(cap, text) { $('bn-cap').textContent = cap; $('bn-t').textContent = text; const el = $('banner'); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => el.classList.remove('on'), 3600); }

// ---------- the trains on file, and the live data for the screens ----------
const LOCAL = /^(localhost|127\.)/.test(location.hostname), LIVE = 'https://shuntdesk.com';
async function get(path) { const r = await fetch(path, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.json(); }
// a local copy of the site has its own thin record; read the public one when it comes back empty
async function getLive(path, ok) { try { const j = await get(path); if (!LOCAL || ok(j)) return j; } catch (e) {} if (LOCAL) try { return await get(LIVE + path); } catch (e) {} return null; }
let TRAINS = [], loaded = false;
async function loadTrains() {
  const j = await getLive('/api/play', j => (j.trains || []).length > 0); TRAINS = (j?.trains || []).filter(t => t.move24h != null || t.move1h != null);
  loaded = true; $('load').textContent = TRAINS.length ? `${TRAINS.length} real calls on file` : 'No trains on file right now: you can still walk the city';
}
loadTrains();
const DATA = { desk: null, verdicts: null, grads: null, rugs: null };
async function refresh() {
  const [d, v, g, r] = await Promise.all([getLive('/api/v1/desk', j => j.equity != null), getLive('/api/v1/verdicts', j => (j.verdicts || []).length > 0), getLive('/api/v1/graduated', j => (j.tokens || []).length > 0), getLive('/api/rugs', j => (j.rows || []).length > 0)]);
  Object.assign(DATA, { desk: d, verdicts: v, grads: g, rugs: r });
  if (d) drawScreen('crew', `CREW DESK · ${money(d.equity)}`, [[`Started at ${money(d.start)}`, `${d.equity >= d.start ? '+' : ''}${money(d.equity - d.start)}`, d.equity >= d.start ? '#2ed3a0' : '#ff4d5e'], ...d.open.slice(0, 5).map(p => [`${p.symbol} · ${p.side} ${p.leverage}x`, `${p.net >= 0 ? '+' : ''}${p.net}`, p.net >= 0 ? '#2ed3a0' : '#ff4d5e']), ...d.closed.slice(0, 3).map(h => [`closed ${h.symbol} · ${h.why}`, `${h.pnl >= 0 ? '+' : ''}${h.pnl}`, h.pnl >= 0 ? '#2ed3a0' : '#ff4d5e'])]);
  if (v) drawScreen('junction', 'JUNCTION · DEPARTURES', v.verdicts.slice(0, 6).map(x => [`${new Date(x.at).toISOString().slice(11, 16)}  ${x.symbol}`, `${x.verdict} ${x.score}`, x.verdict === 'CLEAN' ? '#2ed3a0' : x.verdict === 'DANGER' ? '#ff4d5e' : '#ffb340']), '#2ed3a0');
  if (v) drawScreen('station', 'DEPARTURES · LATEST CALLS', v.verdicts.slice(0, 9).map(x => [`${new Date(x.at).toISOString().slice(11, 16)}  ${x.symbol}`, `${x.verdict} ${x.score} · ${x.desk === 'depot' ? 'DEPOT' : x.desk.toUpperCase()}`, x.verdict === 'CLEAN' ? '#2ed3a0' : x.verdict === 'DANGER' ? '#ff4d5e' : '#ffb340']), '#ffb340');
  if (g) drawScreen('deployer', 'FRESH OFF PONS', g.tokens.slice(0, 5).map(x => [x.token.slice(0, 10) + '…' + x.token.slice(-4), new Date(x.at).toISOString().slice(11, 16) + ' UTC']), '#edebe6');
}
refresh(); setInterval(refresh, 90000);

// ---------- information panels for the places ----------
function info(title, cap, html, link, linkText) { $('in-cap').textContent = cap; $('in-h').textContent = title; $('in-b').innerHTML = html; const a = $('in-a'); a.hidden = !link; if (link) { a.href = link; a.textContent = linkText; } $('info').classList.add('on'); }
function closeInfo() { $('info').classList.remove('on'); }
const rows = list => `<div class="rows">${list.map(r => `<div><span>${esc(r[0])}</span><b class="${r[2] || ''}">${esc(r[1])}</b></div>`).join('')}</div>`;
const gradRows = g => rows(g.slice(0, 8).map(x => [x.token.slice(0, 12) + '…' + x.token.slice(-4), new Date(x.at).toISOString().slice(11, 16) + ' UTC']));
const PLACE_ACT = {
  junction: { text: 'Read the departures board', go: () => PLACE_ACT.station.go(true) },
  station: { text: 'Read the departures board', go: (j) => { complete(j === true ? 'junction' : 'board'); const v = DATA.verdicts?.verdicts || []; info('Departures', 'Central Station · the latest calls', v.length ? rows(v.slice(0, 10).map(x => [`${new Date(x.at).toISOString().slice(11, 16)} UTC · ${x.symbol}`, `${x.verdict} ${x.score}`, x.verdict === 'CLEAN' ? 'ok' : x.verdict === 'DANGER' ? 'bad' : 'warn'])) : '<p>The board is blank right now.</p>', '/board/', 'THE FULL BOARD →'); } },
  crew: { text: 'Look at the crew\'s desk', go: () => { complete('crew'); const d = DATA.desk; info(d ? money(d.equity) : 'Crew desk', 'Crew Desk HQ · paper USDG, live', d ? rows([['Started at', money(d.start)], ['Open positions', String(d.open.length)], ...d.open.slice(0, 5).map(p => [`${p.symbol} ${p.side} ${p.leverage}x`, `${p.net >= 0 ? '+' : ''}${p.net}`, p.net >= 0 ? 'ok' : 'bad'])]) + (d.closed[0]?.postMortem ? `<p class="pm">${esc(d.closed[0].postMortem)}</p>` : '') : '<p>The wall is not answering right now.</p>', '/desk/', 'OPEN THE DESK →'); } },
  deployer: { text: 'Check the terminal', go: () => { complete('files'); const g = DATA.grads?.tokens || []; info('Fresh off Pons', 'Deployer Office · graduations in the last day', g.length ? gradRows(g) : '<p>No graduation on file in the last day.</p>', '/deployer/', 'DEPLOYER RECORD →'); } },
  diner: { text: () => ENV.night > 0.6 ? 'Order a coffee · or sit out the night' : 'Order a coffee', go: () => { complete('coffee'); P.hp = 100; sfx.coffee(); if (ENV.night > 0.6) { info('Night Line Diner', 'Coffee · on the house', '<p>You are back on your feet. It is a long night out there.</p><p><button class="btn ghost" id="wait">Wait here until morning</button></p>'); $('wait').onclick = () => { TIME.h = 6.6; closeInfo(); banner('MORNING', 'You sat out the night.'); }; } else banner('NIGHT LINE DINER', 'Coffee. You are back on your feet.'); } },
  crash: { text: 'Read the wrecks', go: () => { const r = DATA.rugs?.rows || []; info('Crash Site', 'Calls whose price fell hardest after', r.length ? rows(r.slice(0, 8).map(x => [`${x.symbol} · ${x.verdict} ${x.score}`, `${pct(x.fall)} ${x.after}`, 'bad'])) : '<p>No wreck on file yet.</p>', '/replay/', 'RUG REPLAY →'); } },
  radio: { text: 'Pick up the radio', go: () => { complete('radio'); info('Radio Tower', '@shuntdesk_bot', '<p>Paste a token or ask anything on Telegram, and the bot answers from Shuntdesk\'s own figures.</p>', 'https://t.me/shuntdesk_bot', 'OPEN THE BOT →'); } },
  market: { text: 'Look around Curve Market', go: () => banner('CURVE MARKET', 'Westbank\'s market. Stalls till late.') },
  square: { text: 'Sit by the fountain', go: () => banner('SIGNAL SQUARE', 'Eastgate\'s square.') },
  park: { text: 'Take the air', go: () => banner('OLD QUARTER PARK', 'Trees, benches, quiet.') },
  court: { text: 'Watch the game', go: () => banner('WESTBANK COURT', 'Next game, winners stay on.') },
  site: { text: 'Look through the fence', go: () => banner('BUILDING SITE', 'Something new. Not saying what yet.') },
  stadium: { text: 'Look at the board', go: () => banner('CURVE STADIUM', 'Match night, most nights.') },
};

// ---------- the shift ----------
const STATIONS = ['Sources', 'Gate', 'Scout', 'Tracer', 'Linker', 'Auditor'];
const tone = t => /^(FOUND|PASS|SPREAD|TRACED|NO GROUP|READS CLEAN)$/.test(t) ? 'ok' : /^(NO POOL|TOO THIN|TOP HEAVY|DEPLOYER FLAGGED|DEPLOYER PAID|BUNDLED|TRAP DOOR)$/.test(t) ? 'bad' : /^NOTHING|NO READ/.test(t) ? 'skip' : 'warn';
const moveOf = t => t.move24h != null ? [t.move24h, 'a day later'] : [t.move1h, 'an hour later'];
const FLAT = 0.02, SPEED = 14, SPAWN = -300;
const G = { on: false, list: [], i: 0, results: [], train: null, gotXp: 0, streak: 0, old: [] };
function pickShift() {
  const pool = [...TRAINS].sort(() => Math.random() - 0.5), out = [];
  const fell = pool.find(t => moveOf(t)[0] < -0.1), rose = pool.find(t => moveOf(t)[0] > 0.05);
  for (const t of [fell, rose]) if (t) out.push(t);
  for (const t of pool) { if (out.length >= 5) break; if (!out.includes(t)) out.push(t); }
  return out.sort(() => Math.random() - 0.5);
}
function startShift(list, mode = 'practice', meta = {}) { if (!list && !TRAINS.length) return banner('SIGNAL BOX', 'The dispatcher has no trains on file right now.'); if (DRIVE.on || RUN.on) return banner('THE LINE IS BUSY', 'Wait for the main line to clear.'); G.on = true; G.mode = mode; G.meta = meta; G.list = list || pickShift(); G.i = 0; G.results = []; G.gotXp = 0; G.streak = 0; spawn(); banner(mode === 'daily' ? `DAILY SHIFT #${meta.no}` : mode === 'own' ? 'YOUR TOKEN' : 'SHIFT STARTED', mode === 'own' ? 'Read it, then pull.' : 'Five trains. Read, then pull.'); }
function spawn() {
  // a train that rode the line keeps going into the tunnel; anything else is cleared
  if (G.train) { if (G.train.route === 'main' && !G.train.end?.fell) G.old.push(G.train); else scene.remove(G.train.g); }
  const d = G.list[G.i], tr = makeTrain(4, { title: (d.symbol || d.token.slice(0, 6)).toUpperCase().slice(0, 12), stripe: 0xedebe6, body: 0x23272d });
  Object.assign(tr, { d, s: SPAWN, v: SPEED, route: null, lever: null, end: null, wreck: 0 });
  G.train = tr; setLever(null); manifest(d); setTimeout(() => sfx.horn(clamp(1 - dist(new THREE.Vector3(0, 0, tr.s)) / 400, 0.25, 1)), 400);
}
function setLever(which) {
  if (G.train && which && G.train.lever !== which) { doEmote('interact-right', 1.4); sfx.lever(); }
  if (G.train) G.train.lever = which;
  levers.RIDE.target = which === 'RIDE' ? -0.55 : 0.55; levers.SIDING.target = which === 'SIDING' ? -0.55 : 0.55;
  sig.ride.emissiveIntensity = which === 'RIDE' ? 6 : 0.1; sig.sid.emissiveIntensity = which === 'SIDING' ? 6 : 0.1; sig.stop.emissiveIntensity = which ? 0.1 : 5;
  $('m-lev').textContent = which ? `LEVER: ${which}` : 'LEVER: NOT PULLED'; $('m-lev').className = 'lev ' + (which === 'RIDE' ? 'ok' : which === 'SIDING' ? 'warn' : '');
}
function manifest(d) {
  $('man').classList.add('on'); $('m-n').textContent = `Inbound ${G.i + 1} of ${G.list.length} · manifest`; $('m-sym').textContent = d.symbol || d.token.slice(0, 8);
  const stops = (d.stops || []).filter(t => !/^(CLEAN|RISKY|DANGER) \d+$/.test(t)).slice(0, 6);
  $('m-rows').innerHTML = (stops.length ? stops.map((t, i) => `<div class="row"><span>${STATIONS[i] || 'Stop'}</span><b class="${tone(t)}">${t}</b></div>`).join('') : '<div class="row"><span>Stops</span><b class="skip">not on file</b></div>') + `<div class="row"><span>Pool liquidity</span><b>${d.liq ? money(d.liq) : '—'}</b></div>`;
}
function decide() {
  const tr = G.train, d = tr.d, call = tr.lever;
  if (d.pending) { tr.route = call === 'SIDING' ? 'siding' : 'main'; tr.end = { m: 0, fell: false, rose: false }; lockOwn(d, call); G.results.push({ d, call, right: false, sdRight: false, m: 0, when: '', pts: 0 });
    setTimeout(() => { $('rv-cap').textContent = ` · your token`; $('rv-h').textContent = 'LOCKED IN'; $('rv-h').className = ''; $('rv-p').innerHTML = `You said <b>${call || 'RIDE'}</b>. The seven checks said <b>${d.verdict} ${d.score}</b>. Come back to the Signal Box in an hour for the price.`; $('rv-pts').textContent = ''; const el = $('reveal'); el.classList.remove('on', 'good', 'badc'); void el.offsetWidth; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 6500); setTimeout(next, 5200); }, 1300); return; }
  const [m, when] = moveOf(d), fell = m <= -FLAT, rose = m >= FLAT;
  let right = false, pts = 0, head = '', why = '';
  if (!call) { head = 'NO CALL'; why = 'The lever was never pulled, so it rode the line.'; }
  else if (call === 'RIDE') { right = rose; pts = rose ? 100 : !fell ? 20 : 0; head = rose ? 'GOOD RIDE' : fell ? 'DERAILED' : 'NOTHING MOVED'; why = rose ? 'It rode the line and the price rose.' : fell ? 'You let it ride, and the price fell.' : 'It rode the line; the price barely moved.'; }
  else { right = !rose; pts = fell ? 100 + Math.round(Math.min(1, -m) * 80) : !rose ? 40 : 0; head = fell ? 'SAVED THE LINE' : !rose ? 'SAFE ON THE SIDING' : 'MISSED THE RIDE'; why = fell ? 'You put it on the siding, and the price fell.' : !rose ? 'You held it back; the price barely moved.' : 'You held it back, and the price rose.'; }
  G.streak = right ? G.streak + 1 : 0; if (right && G.streak >= 3) pts = Math.round(pts * 1.5);
  const sdRide = d.verdict === 'CLEAN', sdRight = sdRide ? rose : !rose;
  tr.route = call === 'SIDING' ? 'siding' : 'main'; tr.end = { m, when, right, pts, head, why, fell, rose };
  G.results.push({ d, call, right, sdRight, m, when, pts }); addCard({ symbol: d.symbol, token: d.token, verdict: d.verdict, score: d.score, call, m, right, rare: call === 'SIDING' && m < -0.1 }); G.gotXp += pts; save.read++; if (right) save.right++; addXp(pts); if (right) pay(12, 'shift');
  setTimeout(() => reveal(tr, d, sdRide), 1300);
}
function reveal(tr, d, sdRide) {
  const e = tr.end, cls = e.right ? 'ok' : !e.rose && !e.fell ? '' : 'bad';
  $('rv-cap').textContent = `${d.symbol || 'token'} · ${e.when}`; $('rv-h').textContent = pct(e.m); $('rv-h').className = e.m >= 0 ? 'ok' : 'bad';
  $('rv-p').innerHTML = `<b class="${cls}">${e.head}.</b> ${e.why}<br>Shuntdesk filed <b>${d.verdict} ${d.score}</b>, so the crew ${sdRide ? 'let it ride' : 'kept it off the line'}.`;
  $('rv-pts').textContent = e.pts ? `+${e.pts} XP${G.streak >= 3 && e.right ? ' · streak' : ''}` : '0 XP'; $('rv-pts').className = 'pts ' + (e.pts ? 'ok' : '');
  $('rv-a').href = '/replay/?a=' + d.token;
  const el = $('reveal'); el.classList.remove('on', 'good', 'badc'); void el.offsetWidth; el.classList.add('on', e.right ? 'good' : cls === 'bad' ? 'badc' : 'x');
  clearTimeout(reveal.t); reveal.t = setTimeout(() => el.classList.remove('on'), 6500);
  doEmote(e.right ? 'emote-yes' : 'emote-no'); e.right ? sfx.good() : sfx.bad(); if (G.streak >= 3) complete('streak'); setTimeout(next, 5200);
}
function next() {
  G.i++; if (G.i < G.list.length) return spawn();
  if (G.mode === 'own') { G.on = false; $('man').classList.remove('on'); setLever(null); return; }
  G.on = false; $('man').classList.remove('on'); setLever(null); save.shifts++; keep(); complete('shift');
  const you = G.results.filter(r => r.right).length, sd = G.results.filter(r => r.sdRight).length;
  $('d-h').textContent = you > sd ? 'You beat the desk.' : you === sd ? 'Level with the desk.' : 'The desk read it better.';
  $('d-you').textContent = `${you} / ${G.results.length}`; $('d-sd').textContent = `${sd} / ${G.results.length}`; $('d-xp').textContent = '+' + G.gotXp + ' · ' + rankUI();
  $('d-list').innerHTML = G.results.map(r => `<div><span>${esc(r.d.symbol || r.d.token.slice(0, 8))} · ${r.call || 'no call'}</span><b class="${r.m >= 0 ? 'ok' : 'bad'}">${pct(r.m)} ${r.when === 'a day later' ? '24h' : '1h'}</b></div>`).join('');
  $('done').hidden = false;
  if (you > sd) complete('beat');
  if (G.mode === 'daily') submitDaily(G.results); else submitShift(G.results);
}
$('d-again').onclick = () => { $('done').hidden = true; startShift(); };
$('d-board').onclick = () => { $('done').hidden = true; leaderboard(); };
$('d-walk').onclick = () => { $('done').hidden = true; };
let shake = 0;
const parts = [], sparkM = new THREE.MeshBasicMaterial({ color: 0xffb070 }); sparkM.color.multiplyScalar(4); const SPARK = new THREE.BoxGeometry(0.1, 0.1, 0.1), wv = new THREE.Vector3();
function sparks(c) { c.getWorldPosition(wv); for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(SPARK, sparkM); m.position.set(wv.x + (Math.random() - 0.5) * 3, 0.5, wv.z + 4); scene.add(m); parts.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 9, 3 + Math.random() * 6, Math.random() * 7), life: 0.9 }); } }
const dust = [];
function puff(x, y, z, color = 0x8a8580, grow = 0, life = 0.7, op = 0.3) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color, transparent: true, opacity: op, depthWrite: false })); s.position.set(x, y, z); s.scale.setScalar(0.4); scene.add(s); dust.push({ s, life, max: life, grow, op }); }
function runParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life -= dt; p.v.y -= 15 * dt; p.m.position.addScaledVector(p.v, dt); if (p.life <= 0 || p.m.position.y < 0) { scene.remove(p.m); parts.splice(i, 1); } }
  for (let i = dust.length - 1; i >= 0; i--) { const p = dust[i]; p.life -= dt; const k = 1 - p.life / p.max; p.s.scale.setScalar(p.grow ? 2 + k * p.grow : 0.4 + k * 1.4); p.s.position.y += dt * (p.grow ? 1.5 : 0.3); p.s.material.opacity = p.op * (1 - k); if (p.life <= 0) { scene.remove(p.s); p.s.material.dispose(); dust.splice(i, 1); } }
}
// one game train along its route; returns true once it has gone into the north tunnel
function runTrain(tr, dt) {
  const v0 = tr.v;
  if (!tr.route) { tr.s += tr.v * dt; if (tr.s >= -1 && tr === G.train) decide(); }
  else if (tr.route === 'siding') { const left = SID.stop - tr.s; tr.v = Math.min(tr.v, Math.max(0, Math.sqrt(Math.max(0, left) * 3))); tr.s += tr.v * dt; }
  else if (tr.end.fell) {
    if (tr.s < 22) tr.s += tr.v * dt;
    else { if (!tr.wreck) { shake = Math.hypot(P.pos.x, P.pos.z - 30) < 60 ? 0.5 : 0.15; sfx.crash(); } tr.v = Math.max(0, tr.v - 12 * dt); tr.s += tr.v * dt; tr.wreck = Math.min(1, tr.wreck + dt * 1.6); tr.stripeM.emissive.setHex(0xff3b4e); if (tr.wreck < 1 && Math.random() < 0.6) sparks(tr.cars[0]); if (Math.random() < 0.3) { tr.cars[0].getWorldPosition(wv); puff(wv.x + (Math.random() - 0.5) * 3, 2, wv.z + (Math.random() - 0.5) * 6, 0x4a4a4e, 6, 3, 0.5); } }
  } else { tr.v = Math.min(26, tr.v + 4 * dt); tr.s += tr.v * dt; if (tr.end.rose) tr.stripeM.emissive.setHex(0x2ed3a0); }
  spinWheels(tr, tr.wreck ? 0 : (v0 + tr.v) / 2, dt);
  tr.cars.forEach((c, i) => {
    const s = tr.s - i * CAR, p = along(tr.route || 'main', s), w = tr.wreck * (i % 2 ? -1 : 1) * (0.25 + i * 0.12);
    c.position.set(p.x + tr.wreck * (i % 2 ? 1.6 : -1.2) * Math.min(1, i * 0.6 + 0.4), tr.wreck * 0.3, p.z - tr.wreck * i * 0.8); c.rotation.set(0, p.yaw + w, tr.wreck * (i % 2 ? 0.35 : -0.5));
  });
  return tr.s - tr.cars.length * CAR > END + 40;
}

// ---------- movement and collision ----------
const RAD = 0.4;
function pushOut(b) {
  const p = P.pos, cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1), dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= RAD * RAD) return;
  if (d2 > 1e-6) { const d = Math.sqrt(d2), k = (RAD - d) / d; p.x += dx * k; p.z += dz * k; return; }
  const o = [[b.x0 - RAD - p.x, 0], [b.x1 + RAD - p.x, 0], [0, b.z0 - RAD - p.z], [0, b.z1 + RAD - p.z]].sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
  p.x += o[0][0]; p.z += o[0][1];
}
function dynBoxes() {
  const out = [], all = [...ambient.flatMap(t => t.cars), ...(G.train ? G.train.cars : []), ...G.old.flatMap(t => t.cars)];
  for (const c of all) { c.getWorldPosition(wv); if (Math.abs(wv.x - P.pos.x) > 8 || Math.abs(wv.z - P.pos.z) > 10) continue; const s = Math.abs(Math.sin(c.rotation.y)), co = Math.abs(Math.cos(c.rotation.y)), hw = 1.6 * co + 4.6 * s, hd = 1.6 * s + 4.6 * co; out.push({ x0: wv.x - hw, x1: wv.x + hw, z0: wv.z - hd, z1: wv.z + hd }); }
  for (const X of CROSSINGS) if (X.down > 0.6) for (const a of X.arms) if (Math.abs(a.x - P.pos.x) < 3 && Math.abs(a.z0 - P.pos.z) < a.len + 2) out.push({ x0: a.x - 0.15, x1: a.x + 0.15, z0: a.z0, z1: a.z0 + a.len });
  for (const c of cars) { if (Math.abs(c.pos.x - P.pos.x) > 8 || Math.abs(c.pos.z - P.pos.z) > 8) continue; const s = Math.abs(Math.sin(c.yaw)), co = Math.abs(Math.cos(c.yaw)), hw = 1 * co + c.L / 2 * s, hd = 1 * s + c.L / 2 * co; out.push({ x0: c.pos.x - hw, x1: c.pos.x + hw, z0: c.pos.z - hd, z1: c.pos.z + hd }); }
  return out;
}
function move(dt) {
  if (P.dead) return deadTick(dt);
  hazards(dt);
  let ix = 0, iz = 0;
  if (P.down <= 0 && !TALK.f && !MINI.on) { if (keys.KeyW || keys.ArrowUp) iz += 1; if (keys.KeyS || keys.ArrowDown) iz -= 1; if (keys.KeyA || keys.ArrowLeft) ix -= 1; if (keys.KeyD || keys.ArrowRight) ix += 1; if (joy) { ix += joy.dx; iz -= joy.dy; } }
  const mag = Math.min(1, Math.hypot(ix, iz)), run = keys.ShiftLeft || keys.ShiftRight || runToggle || (joy && Math.hypot(joy.dx, joy.dy) > 0.95);
  P.speed = lerp(P.speed, mag * (run && P.energy > 2 ? runSpeed() : 3.6), damp(dt, 8));
  if (mag > 0.05) {
    if (emote && emote !== 'attack-melee-right' && emote !== 'die') emote = null;
    const fx = -Math.sin(look.yaw), fz = -Math.cos(look.yaw), rx = -fz, rz = fx, dx = (fx * iz + rx * ix) / (mag || 1), dz = (fz * iz + rz * ix) / (mag || 1);
    let d = Math.atan2(dx, dz) - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); P.yaw += d * damp(dt, 11);
    P.pos.x += dx * P.speed * dt; P.pos.z += dz * P.speed * dt;
  }
  if (jump && P.ground && P.down <= 0) { P.vy = 6; P.ground = false; if (hero) { emote = null; hero.once('jump', 0.1, 1.3); } } jump = false;
  const fy = floorAt(P.pos.x, P.pos.z); if (P.pos.y < fy && fy - P.pos.y < 1.25) { P.pos.y = fy; P.vy = Math.max(0, P.vy); }   // step up onto a platform
  P.vy -= 17 * dt; P.pos.y += P.vy * dt; if (P.pos.y <= fy) { if (!P.ground && P.vy < -3) { puff(P.pos.x, fy + 0.15, P.pos.z, 0x8a8580, 0, 0.7, 0.4); sfx.land(); } P.pos.y = fy; P.vy = 0; P.ground = true; } else if (P.pos.y > fy + 0.05 && P.vy <= 0 && P.ground) P.ground = P.pos.y - fy < 0.3;
  for (const b of near(P.pos.x, P.pos.z, 2)) pushOut(b);
  for (const b of dynBoxes()) pushOut(b);
  if (P.pos.x < 800) { P.pos.x = clamp(P.pos.x, -330, 440); P.pos.z = clamp(P.pos.z, -END + 6, END - 6); }   // the rooms stand out past x = 800
  if (hero) {
    if (!emote && (P.ground || hero.cur !== hero.acts.jump)) hero.play(pickLoco(), 0.2, P.speed > 5.2 ? clamp(P.speed / 7, 0.8, 1.3) : clamp(P.speed / 2.4, 0.6, 1.7));
    hero.g.position.copy(P.pos); hero.g.rotation.y = P.yaw;
  }
  P.phase += dt * P.speed * 1.3; if (P.ground && P.speed > 6 && Math.floor(P.phase) !== Math.floor(P.phase - dt * P.speed * 1.3)) puff(P.pos.x, 0.15, P.pos.z);
  lantern.rotation.x = Math.sin(P.phase * 2) * 0.25 * Math.min(1, P.speed / 3);
  if (P.ground && P.speed > 0.6) { P.step = (P.step || 0) + P.speed * dt; const run = P.speed > 5.2; if (P.step > (run ? 1.15 : 0.72)) { P.step = 0; sfx.step(run, !!inside); } }
  const by = floorAt(P.pos.x, P.pos.z); blob.position.set(P.pos.x, by + 0.03, P.pos.z); blob.material.opacity = 0.35 / (1 + P.pos.y - by);
}
// ---------- weapons: for the RISKY only. People in town cannot be hit ----------
// fists are free; everything else is bought at The Armory in Westbank (the steel bat also at Yard Supply)
const WEAPONS = {
  fists: { name: 'Fists', reach: 2, dmg: 1, rate: 0.45 },
  knife: { name: 'Knife', reach: 2.1, dmg: 1, rate: 0.28, price: 30, col: 0xc9c7c2, len: 0.32 },
  crowbar: { name: 'Crowbar', reach: 2.5, dmg: 2, rate: 0.55, price: 40, col: 0x8a2a24, len: 0.7 },
  bat: { name: 'Steel bat', reach: 2.7, dmg: 2, rate: 0.5, price: 45, col: 0xb0b4ba, len: 0.85 },
  katana: { name: 'Katana', reach: 3.1, dmg: 3, rate: 0.45, price: 120, col: 0xd8dce2, len: 1.05 },
  pistol: { name: 'Pistol', range: 32, dmg: 2, rate: 0.35, price: 150, ammo: 'pistol', cone: 0.93, col: 0x1c1e22, gun: true },
  shotgun: { name: 'Shotgun', range: 16, dmg: 4, rate: 0.9, price: 300, ammo: 'shotgun', cone: 0.78, col: 0x3a2a20, gun: true },
};
const AMMO = { pistol: ['Pistol rounds', 12, 10], shotgun: ['Shotgun shells', 6, 15] };
save.arms ??= save.items?.includes('bat') ? ['bat'] : []; save.ammo ??= { pistol: 0, shotgun: 0 }; save.wield ??= 'fists';
const owned = () => ['fists', ...Object.keys(WEAPONS).filter(k => k !== 'fists' && (save.arms.includes(k) || (k === 'bat' && save.items?.includes('bat'))))];
let lastHit = 0;
// what is in your hand, drawn in the hand
const held = new THREE.Group(); scene.add(held);
function heldMesh() {
  held.clear(); const w = WEAPONS[save.wield]; if (!w || save.wield === 'fists') return;
  const m = (g, c, o = {}) => new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: c, metalness: 0.6, roughness: 0.35, ...o }));
  if (w.gun) { const L = save.wield === 'shotgun' ? 0.75 : 0.26; const b = m(new THREE.BoxGeometry(0.07, 0.09, L), w.col); b.position.z = L / 2; held.add(b); const g = m(new THREE.BoxGeometry(0.06, 0.16, 0.08), 0x2a2d32); g.position.set(0, -0.1, 0.04); held.add(g); }
  else { const b = m(new THREE.BoxGeometry(save.wield === 'knife' || save.wield === 'katana' ? 0.025 : 0.06, 0.06, w.len), w.col); b.position.z = w.len / 2; held.add(b); const h = m(new THREE.BoxGeometry(0.06, 0.07, 0.16), 0x2a2421); h.position.z = -0.04; held.add(h); }
}
heldMesh();
const armBone = hero?.root.getObjectByName('arm-right'), abv = new THREE.Vector3();
function heldTick() { held.visible = !!hero?.g.visible && save.wield !== 'fists'; if (!held.visible || !armBone) return; armBone.getWorldPosition(abv); held.position.set(abv.x + Math.sin(P.yaw) * 0.25 + Math.cos(P.yaw) * -0.05, abv.y - 0.42, abv.z + Math.cos(P.yaw) * 0.25); held.rotation.set(0, P.yaw, 0); }
function weaponUI() { const w = WEAPONS[save.wield], el = $('weapon'); el.innerHTML = `<span class="cap">${w.gun ? 'Q switch · F fire' : 'Q switch · F strike'}</span><b>${w.name}</b>${w.gun ? `<i>${save.ammo[w.ammo]} rounds</i>` : ''}`; el.classList.toggle('on', save.wield !== 'fists' || owned().length > 1); const b = $('b-swap'); if (b) b.textContent = w.gun ? 'GUN' : save.wield === 'fists' ? 'FIST' : 'ARM'; }
function swapWeapon() { const o = owned(), i = o.indexOf(save.wield); save.wield = o[(i + 1) % o.length]; keep(); heldMesh(); weaponUI(); sfx.ui(); }
addEventListener('keydown', e => { if (e.code === 'KeyQ' && !e.repeat && e.target.tagName !== 'INPUT') swapWeapon(); });
const tracerM = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9 });
function tracer(a, b) { const g = new THREE.BufferGeometry().setFromPoints([a, b]), l = new THREE.Line(g, tracerM); scene.add(l); setTimeout(() => { scene.remove(l); g.dispose(); }, 70); const f = new THREE.PointLight(0xffc070, 30, 8, 2); f.position.copy(a); scene.add(f); setTimeout(() => scene.remove(f), 60); }
function stopped(z) {
  nightKills++; save.kills = (save.kills || 0) + 1; const xp = z.boss ? 300 : z.kind === 'RUG' ? 40 : 15; addXp(xp); pay(z.boss ? 150 : z.kind === 'RUG' ? 15 : 5, 'bounty');
  if (z.kind === 'RUG') { save.rugs = (save.rugs || 0) + 1; keep(); }
  if (z.boss) { save.boss = (save.boss || 0) + 1; keep(); banner('THE RUG PULL IS DOWN', '$150, and the city owes you one'); }
  else banner(z.kind === 'RUG' ? 'RUG STOPPED' : 'RISKY STOPPED', `${nightKills} tonight · +${xp} XP`);
}
function damage(z, n) { if (z.state === 'dead') return; if (n > 1) z.hp = Math.max(1, z.hp - (n - 1)); puff(z.pos.x, 1.2, z.pos.z, 0xc9e8b8, 2, 0.4, 0.5); if (hitZombie(z, P.pos)) stopped(z); }
function doStrike() {
  if (!hero || P.down > 0 || P.dead) return;
  const w = WEAPONS[save.wield] || WEAPONS.fists, now = performance.now() / 1000; if (now - lastHit < w.rate) return; lastHit = now;
  const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
  if (w.gun) {
    if (save.ammo[w.ammo] <= 0) { sfx.ui(); banner('OUT OF AMMO', 'The Armory sells rounds'); return; }
    save.ammo[w.ammo]--; keep(); weaponUI(); doEmote('holding-right-shoot', 1.6); sfx.shot?.(save.wield === 'shotgun'); shake = save.wield === 'shotgun' ? 0.18 : 0.08;
    // the nearest RISKY in front of you, inside the cone
    let best = null, bd = w.range; for (const z of zombies) { if (z.state === 'dead') continue; const dx = z.pos.x - P.pos.x, dz = z.pos.z - P.pos.z, d = Math.hypot(dx, dz); if (d < bd && (dx * fx + dz * fz) / (d || 1) > w.cone) { bd = d; best = z; } }
    const from = new THREE.Vector3(P.pos.x + fx * 0.6, P.pos.y + 1.2, P.pos.z + fz * 0.6), to = best ? new THREE.Vector3(best.pos.x, 1.1, best.pos.z) : from.clone().add(new THREE.Vector3(fx * w.range, 0, fz * w.range));
    tracer(from, to); if (best) { damage(best, w.dmg); sfx.hit(); }
    return;
  }
  doEmote('attack-melee-right', save.wield === 'knife' ? 2.2 : 1.6); sfx.swing();
  setTimeout(() => { for (const z of zombies) { const dx = z.pos.x - P.pos.x, dz = z.pos.z - P.pos.z, d = Math.hypot(dx, dz); if (d < w.reach && (dx * fx + dz * fz) / (d || 1) > 0.3) { sfx.hit(); damage(z, w.dmg); } } }, 220);
}

// ---------- trains and cars can kill you ----------
// A moving train is not a wall: step in front of one and that is the end of the shift. A fast car knocks you down.
const hv2 = new THREE.Vector3();
function movingTrains() { const out = []; for (const t of EXTRA_TRAINS) if (t.v > 1.2 && t !== DRIVE.tr && !t.wreck) out.push({ cars: t.cars, v: t.v, dir: 1, x: null, head: t.s }); for (const a of ambient) if (a.v > 1.2) out.push({ cars: a.cars, v: a.v, dir: a.dir, x: a.x, head: a.s }); for (const t of [G.train, ...G.old]) if (t && t.g.visible && t.v > 1.2 && !t.wreck) out.push({ cars: t.cars, v: t.v, dir: 1, x: null, head: t.s }); return out; }
let hornT = 0;
function hazards(dt) {
  hornT -= dt;
  for (const t of movingTrains()) {
    for (const c of t.cars) {
      c.getWorldPosition(hv2); if (Math.abs(hv2.x - P.pos.x) > 6 || Math.abs(hv2.z - P.pos.z) > 7) continue;
      const s = Math.abs(Math.sin(c.rotation.y)), co = Math.abs(Math.cos(c.rotation.y)), hw = 1.7 * co + 4.7 * s, hd = 1.7 * s + 4.7 * co;
      if (Math.abs(P.pos.x - hv2.x) < hw + 0.3 && Math.abs(P.pos.z - hv2.z) < hd + 0.3 && P.pos.y < 3.4) return die('train', t.dir, t.v);
    }
    // the driver sees you on the line ahead and leans on the horn
    const tx = t.x ?? 0, ahead = (P.pos.z - t.head) * t.dir;
    if (hornT <= 0 && Math.abs(P.pos.x - tx) < 2.2 && ahead > 0 && ahead < 90 && P.pos.y < 0.8) { hornT = 3.5; sfx.horn(1); banner('GET OFF THE LINE', 'A train is coming'); }
  }
  for (const c of cars) {
    if (c.v < 5 || Math.abs(c.pos.x - P.pos.x) > 4 || Math.abs(c.pos.z - P.pos.z) > 4) continue;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), dx = P.pos.x - c.pos.x, dz = P.pos.z - c.pos.z, along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
    if (Math.abs(along) < c.L / 2 + 0.3 && side < 1.3 && (P.hitT || 0) <= 0) {
      P.hitT = 1.5; P.hp -= 45; shake = 0.4; sfx.hit(); sfx.hurt(); P.vy = 4; P.ground = false; P.pos.x += fx * 2.2 + (dx * fz - dz * fx > 0 ? fz : -fz) * 1.2; P.pos.z += fz * 2.2; c.v = 0;
      const h = $('hurt'); h.classList.remove('on'); void h.offsetWidth; h.classList.add('on');
      if (P.hp <= 0) return die('car', 1, c.v + 8); banner('HIT BY A CAR', 'Look both ways.');
    }
  }
  if (P.hitT > 0) P.hitT -= dt;
}
function die(by, dir, v) {
  if (P.dead) return;
  P.dead = { by, t: 0, vel: new THREE.Vector3((Math.random() - 0.5) * 6, 7 + v * 0.25, dir * (8 + v * 0.9)), spin: 6 + Math.random() * 6 };
  if (JOB.on) { JOB.on = false; parcel.visible = false; }
  shake = 0.9; sfx.crash(); if (by === 'train') sfx.horn(1); endTalk?.();
  const h = $('hurt'); h.classList.remove('on'); void h.offsetWidth; h.classList.add('on');
  save.deaths = (save.deaths || 0) + 1; keep();
}
function deadTick(dt) {
  const D = P.dead; D.t += dt;
  const fy = floorAt(P.pos.x, P.pos.z);
  if (D.t < 3) { D.vel.y -= 17 * dt; P.pos.addScaledVector(D.vel, dt); if (P.pos.y < fy) { P.pos.y = fy; D.vel.multiplyScalar(0.35); D.vel.y = Math.abs(D.vel.y) * 0.3; D.spin *= 0.4; } if (hero) { hero.g.position.copy(P.pos); hero.g.rotation.x += D.spin * dt; hero.g.rotation.z += D.spin * 0.4 * dt; } }
  if (D.t > 1.4 && !$('dead').classList.contains('on')) {
    $('dd-h').textContent = D.by === 'train' ? 'Hit by a train.' : 'Hit by a car.';
    $('dd-p').textContent = D.by === 'train' ? 'A train cannot stop for you. Stand behind the yellow line, cross where the barriers are, and listen for the horn.' : 'Cars stop for you when they can. At speed, they cannot.';
    $('dd-bill').textContent = save.cash >= 15 ? 'Hospital bill: $15' : 'Hospital bill waived: you are broke';
    $('dead').classList.add('on');
  }
  blob.position.set(P.pos.x, fy + 0.03, P.pos.z);
}
$('dd-go').onclick = () => {
  $('dead').classList.remove('on'); if (save.cash >= 15) { save.cash -= 15; keep(); walletUI(); }
  P.dead = null; P.hp = 100; P.energy = Math.max(P.energy, 60); P.vy = 0; P.pos.set(16, 1, -64); P.yaw = Math.PI / 2; look.yaw = P.yaw + Math.PI;
  if (hero) { hero.g.rotation.set(0, P.yaw, 0); emote = null; hero.play('idle', 0.2); } banner('JUNCTION FIRST AID', 'Patched up. Be careful out there.');
};
// ---------- the camera ----------
const camT = new THREE.Vector3(), camW = new THREE.Vector3();
function cameraClear(t, w) {
  for (let i = 1; i <= 14; i++) { const f = i / 14, x = lerp(t.x, w.x, f), y = lerp(t.y, w.y, f), z = lerp(t.z, w.z, f); for (const b of near(x, z, 0.5)) if (b.h > 3 && y < b.h && x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3) return Math.max(0.12, (i - 1) / 14); }
  return 1;
}
let inside = null;
function follow(dt) {
  camT.set(P.pos.x, P.pos.y + 1.45, P.pos.z);
  const d = inside ? Math.min(look.dist, 5.5) : look.dist, pitch = inside ? Math.max(look.pitch, 0.35) : look.pitch;
  camW.set(camT.x + Math.sin(look.yaw) * Math.cos(pitch) * d, camT.y + Math.sin(pitch) * d, camT.z + Math.cos(look.yaw) * Math.cos(pitch) * d);
  if (!inside) { const k = cameraClear(camT, camW); camW.lerpVectors(camT, camW, k); } camW.y = Math.max(0.5, camW.y);
  cam.position.lerp(camW, damp(dt, 12));
  if (shake > 0) { cam.position.x += (Math.random() - 0.5) * shake; cam.position.y += (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 1.4); }
  cam.lookAt(camT);
  const fov = lerp(cam.fov, P.speed > 6 ? 65 : 58, damp(dt, 4)); if (Math.abs(fov - cam.fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  sky.position.copy(cam.position);
}
// a roof lifts while you are under it, so the camera can see in
function roofs() {
  const now = interiors.find(r => P.pos.x > r.x0 && P.pos.x < r.x1 && P.pos.z > r.z0 && P.pos.z < r.z1) || null;
  if (now !== inside) { if (inside) inside.hide.forEach(o => o.visible = true); if (now) now.hide.forEach(o => o.visible = false); inside = now; sfx.door(); }
}

// ---------- the RISKY ----------
let zSpawnT = 0, wasNight = false;
const away = new THREE.Vector3(1e4, 0, 1e4);
function runNight(dt) {
  const night = ENV.night > 0.72;
  if (night && !wasNight) { nightKills = 0; banner('NIGHTFALL', 'The RISKY are out.'); }
  if (!night && wasNight) banner('DAYBREAK', nightKills ? `${nightKills} RISKY stopped` : 'The RISKY are gone.');
  wasNight = night;
  if (night && townReady) {
    zSpawnT -= dt;
    if (zSpawnT <= 0 && zombies.filter(z => z.state !== 'dead').length < (TOUCH ? 5 : 9)) {
      zSpawnT = 6 + Math.random() * 6;
      const c = place('crash'), nearCrash = Math.random() < 0.5;
      let x = 0, z = 0, tries = 0, bad = true;
      while (tries++ < 10 && bad) { const a = Math.random() * Math.PI * 2, r = nearCrash ? 6 + Math.random() * 10 : 30 + Math.random() * 30; x = (nearCrash ? c.x : P.pos.x) + Math.cos(a) * r; z = (nearCrash ? c.z : P.pos.z) + Math.sin(a) * r; bad = near(x, z, 1).some(b => x > b.x0 - 0.6 && x < b.x1 + 0.6 && z > b.z0 - 0.6 && z < b.z1 + 0.6) || interiors.some(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1); }
      if (!bad) spawnZombie(x, z, Math.random() < 0.15 ? 'RUG' : 'RISKY');
    }
  }
  // the RISKY do not come indoors
  const dmg = runZombies(dt, inside || P.down > 0 ? away : P.pos, night);
  if (dmg && P.down <= 0) { P.hp -= dmg; P.hurtT = 0; shake = 0.25; sfx.hurt(); const h = $('hurt'); h.classList.remove('on'); void h.offsetWidth; h.classList.add('on'); }
  P.hurtT += dt; if (P.hurtT > 5 && P.hp < 100) P.hp = Math.min(100, P.hp + dt * 4);
  if (P.hp <= 0 && P.down <= 0) { P.down = 3; if (hero) { emote = 'die'; hero.once('die', 0.1); } banner('KNOCKED DOWN', 'Carried back to the Signal Box.'); }
  if (P.down > 0) { P.down -= dt; if (P.down <= 0) { P.pos.set(6, 0, -18); P.hp = 100; TIME.h = 6.6; emote = null; hero?.play('idle', 0.2); } }
}

// ---------- what you can do where you stand ----------
const ACTS = [
  { at: SB_DOOR, r: 3.4, when: () => !G.on, text: () => loaded ? (TRAINS.length ? 'Signal Box · start a shift, five trains' : 'No trains on file right now') : 'Reading the trains…', go: () => loaded && startShift() },
  { at: levers.RIDE.pos, r: 1.9, when: () => G.on && G.train && !G.train.route, text: () => G.train.lever === 'RIDE' ? 'Lever is on RIDE' : 'Pull RIDE · let it ride the line', go: () => setLever('RIDE') },
  { at: levers.SIDING.pos, r: 1.9, when: () => G.on && G.train && !G.train.route, text: () => G.train.lever === 'SIDING' ? 'Lever is on SIDING' : 'Pull SIDING · send it off the line', go: () => setLever('SIDING') },
  ...PLACES.filter(p => PLACE_ACT[p.id]).map(p => ({ at: p.at, r: p.r, when: () => true, text: () => { const t = PLACE_ACT[p.id].text; return `${p.name} · ${typeof t === 'function' ? t() : t}`; }, go: PLACE_ACT[p.id].go })),
  { at: new THREE.Vector3(GRAD.x + 3, 0, GRAD.z), r: 6, when: () => true, text: () => 'Graduation Platform · tokens fresh off the Pons curve', go: () => { const g = DATA.grads?.tokens || []; info('Graduation Platform', 'Fresh off Pons, the last day', g.length ? gradRows(g) : '<p>No graduation on file in the last day.</p>', '/board/?t=grad', 'GRADUATED TAB →'); } },
];
let lastPrompt = '';
function interact() {
  let best = null, bd = 1e9;
  if (P.down <= 0 && !P.dead) for (const a of ACTS) { if (!a.when()) continue; const d = Math.hypot(a.at.x - P.pos.x, a.at.z - P.pos.z); if (d < a.r && d < bd) { best = a; bd = d; } }
  // a person close by wins over a place further off; T always talks
  let html = '', who = !TALK.f && townReady && P.down <= 0 ? nearestFolk() : null; if (who && best && bd < who.dist - 0.4) who = null; if (who) best = null;
  if (talkKey) { talkKey = false; const w = who || (!TALK.f && townReady ? nearestFolk(4.5) : null); if (w) { openTalk(w); who = null; } }
  nameTag(who);
  if (best) { html = `<kbd>${TOUCH ? 'ACT' : 'E'}</kbd>${best.text()}`; if (act && !$('info').classList.contains('on')) best.go(); }
  else if (who) { const n = persona(who); html = `<kbd>${TOUCH ? 'ACT' : 'E'}</kbd>Talk to ${n.name} · ${n.role}`; if (act && !$('info').classList.contains('on')) openTalk(who); }
  if (html !== lastPrompt) { lastPrompt = html; const el = $('prompt'); if (html) el.innerHTML = html; el.classList.toggle('on', !!html); }
  act = false;
  if (strike) { strike = false; doStrike(); }
  for (const m of MISSIONS) if (!isDone(m.id) && m.auto && m.auto()) complete(m.id);
}
// the objective line, the beam
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 90, 32, 1, true), additive(0x2ed3a0, 0.12)); scene.add(beam);
const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.35, 48), additive(0x2ed3a0, 0.9)); ring.rotation.x = -Math.PI / 2; scene.add(ring);
let lastObj = '', where = null;
function objective() {
  const m = active(); let text, title;
  if (G.on && G.train && !G.train.route) { title = 'Shift'; text = `Read the ${G.train.d.symbol || ''} manifest. Pull RIDE or SIDING at the lever frame before the train reaches the junction.`; where = leverSpot; }
  else if (G.on) { title = 'Shift'; text = 'Watch where it goes. The next train is on its way.'; where = null; }
  else if (jobGoal()) { const jg = jobGoal(); title = jg.title; text = jg.text; where = jg.at; }
  else if (m) { title = m.title; text = m.text; where = m.where(); }
  else { title = 'Free shift'; text = 'Every mission is done. Run shifts, walk the city, keep the line clean.'; where = SB_DOOR; }
  const key = title + text; if (key !== lastObj) { lastObj = key; $('objk').textContent = title; $('objt').textContent = text; const o = $('obj'); o.classList.remove('flash'); void o.offsetWidth; o.classList.add('flash'); }
  const dd = where ? dist(where) : 0; $('objd').textContent = where ? Math.round(dd) + ' M' : '';
  beam.visible = ring.visible = !!where; if (where) { beam.position.set(where.x, 45, where.z); ring.position.set(where.x, 0.2, where.z); }
  if (G.on && G.train && !G.train.route) { const eta = Math.max(0, (-1 - G.train.s) / G.train.v); $('m-eta').textContent = eta.toFixed(0) + 's'; $('m-eta').className = eta < 6 ? 'bad' : ''; }
  else { $('m-eta').textContent = '—'; $('m-eta').className = ''; }
}

// ---------- the maps ----------
const WX0 = -340, WX1 = 450, WZ0 = -END, WZ1 = END, BW = 1024, BS = BW / (WX1 - WX0), BH = Math.round((WZ1 - WZ0) * BS);
const mxB = x => (x - WX0) * BS, mzB = z => (z - WZ0) * BS;
const base = document.createElement('canvas'); base.width = BW; base.height = BH;
{
  const b = base.getContext('2d'); b.fillStyle = '#0f1a12'; b.fillRect(0, 0, BW, BH);
  b.fillStyle = '#121316'; b.fillRect(mxB(-306), mzB(-306), (WX1 - 26 + 306) * BS, 612 * BS);
  b.fillStyle = '#1c1d20'; for (const r of MAP.roads) b.fillRect(mxB(r.x0), mzB(r.z0), (r.x1 - r.x0) * BS, (r.z1 - r.z0) * BS);
  b.fillStyle = '#2c2e33'; for (const k of MAP.blocks) b.fillRect(mxB(k.x0), mzB(k.z0), (k.x1 - k.x0) * BS, (k.z1 - k.z0) * BS);
  for (const p of MAP.parks) { b.fillStyle = p.kind === 'park' ? '#22422a' : p.kind === 'market' ? '#4a3a1a' : '#2c2e33'; b.fillRect(mxB(p.x0), mzB(p.z0), (p.x1 - p.x0) * BS, (p.z1 - p.z0) * BS); }
  b.fillStyle = '#18191b'; b.fillRect(mxB(-40), mzB(-END), 80 * BS, 2 * END * BS);
  b.strokeStyle = 'rgba(237,235,230,.4)'; b.lineWidth = 1; for (const x of [0, ...AMB.map(t => t.x)]) { b.beginPath(); b.moveTo(mxB(x), 0); b.lineTo(mxB(x), BH); b.stroke(); }
  b.beginPath(); for (let s = 0; s <= 62; s += 2) { const p = along('siding', s); s ? b.lineTo(mxB(p.x), mzB(p.z)) : b.moveTo(mxB(p.x), mzB(p.z)); } b.stroke();
  b.fillStyle = '#2ed3a0'; b.fillRect(mxB(SB.x) - 3, mzB(SB.z) - 3, 6, 6);
  for (const p of PLACES) { b.fillStyle = p.color; b.beginPath(); b.arc(mxB(p.x), mzB(p.z), 4, 0, 7); b.fill(); }
}
const mc = $('mapc').getContext('2d');
function drawMap(t) {
  const Z = 3.2;
  mc.save(); mc.fillStyle = '#060708'; mc.fillRect(0, 0, 360, 360);
  mc.translate(180, 180); mc.rotate(look.yaw); mc.scale(Z, Z); mc.translate(-mxB(P.pos.x), -mzB(P.pos.z)); mc.drawImage(base, 0, 0);
  if (G.train) { mc.fillStyle = '#edebe6'; const c = G.train.cars[0].position; mc.fillRect(mxB(c.x) - 1, mzB(c.z) - 3, 2, 6); }
  mc.fillStyle = '#6f7278'; for (const a of ambient) mc.fillRect(mxB(a.x) - 1, mzB(a.s) - 3, 2, 6);
  mc.fillStyle = '#c9c7c2'; for (const c of cars) mc.fillRect(mxB(c.pos.x) - 0.8, mzB(c.pos.z) - 0.8, 1.6, 1.6);
  mc.fillStyle = '#9fd48a'; for (const z of zombies) if (z.state !== 'dead') { mc.beginPath(); mc.arc(mxB(z.pos.x), mzB(z.pos.z), 1.4, 0, 7); mc.fill(); }
  if (where) { mc.strokeStyle = '#2ed3a0'; mc.lineWidth = 1; mc.beginPath(); mc.arc(mxB(where.x), mzB(where.z), 3 + 1.5 * Math.sin(t * 5), 0, 7); mc.stroke(); }
  mc.restore();
  mc.save(); mc.translate(180, 180); mc.rotate(look.yaw + Math.PI - P.yaw); mc.fillStyle = '#2ed3a0'; mc.beginPath(); mc.moveTo(0, -12); mc.lineTo(8, 9); mc.lineTo(0, 4); mc.lineTo(-8, 9); mc.closePath(); mc.fill(); mc.restore();
  // an objective off this map gets an arrow on the rim
  if (where) { const dx = where.x - P.pos.x, dz = where.z - P.pos.z; if (Math.hypot(dx, dz) * BS * Z > 160) { const c = Math.cos(look.yaw), s = Math.sin(look.yaw), rx = dx * c - dz * s, rz = dx * s + dz * c, a = Math.atan2(rz, rx); mc.save(); mc.translate(180 + Math.cos(a) * 158, 180 + Math.sin(a) * 158); mc.rotate(a + Math.PI / 2); mc.fillStyle = '#2ed3a0'; mc.beginPath(); mc.moveTo(0, -10); mc.lineTo(7, 6); mc.lineTo(-7, 6); mc.fill(); mc.restore(); } }
}
function bigMap() {
  const c = $('bigc'), dpr = devicePixelRatio, W = c.clientWidth * dpr, H = c.clientHeight * dpr; c.width = W; c.height = H; const x = c.getContext('2d');
  const k = Math.min(W / BW, H / BH) * 0.96, ox = (W - BW * k) / 2, oy = (H - BH * k) / 2;
  x.fillStyle = '#060708'; x.fillRect(0, 0, W, H); x.drawImage(base, ox, oy, BW * k, BH * k);
  const X = v => ox + mxB(v) * k, Z = v => oy + mzB(v) * k, fs = Math.round(12 * dpr);
  x.font = `900 ${fs * 1.8}px D`; x.fillStyle = 'rgba(237,235,230,.28)'; x.textAlign = 'center';
  x.fillText('WESTBANK', X(-185), Z(-270)); x.fillText('EASTGATE', X(235), Z(-270)); x.fillText('THE YARD', X(0), Z(-420)); x.fillText('NORTH TUNNEL', X(0), Z(END - 30)); x.fillText('SOUTH TUNNEL', X(0), Z(-END + 40));
  x.font = `700 ${fs}px M`; for (const p of PLACES) { x.fillStyle = p.color; x.beginPath(); x.arc(X(p.x), Z(p.z), 5 * dpr, 0, 7); x.fill(); x.fillStyle = '#edebe6'; x.fillText(p.name.toUpperCase(), X(p.x), Z(p.z) - 9 * dpr); }
  x.fillStyle = '#2ed3a0'; x.textAlign = 'left'; x.fillText('SIGNAL BOX', X(SB.x) + 8 * dpr, Z(SB.z) + 4 * dpr); x.fillText('GRADUATION PLATFORM', X(GRAD.x) + 8 * dpr, Z(GRAD.z)); x.textAlign = 'center';
  if (where) { x.strokeStyle = '#2ed3a0'; x.lineWidth = 2 * dpr; x.beginPath(); x.arc(X(where.x), Z(where.z), 10 * dpr, 0, 7); x.stroke(); }
  x.save(); x.translate(X(P.pos.x), Z(P.pos.z)); x.rotate(Math.PI - P.yaw); x.fillStyle = '#edebe6'; x.beginPath(); x.moveTo(0, -10 * dpr); x.lineTo(7 * dpr, 8 * dpr); x.lineTo(-7 * dpr, 8 * dpr); x.fill(); x.restore();
}

// ---------- the HUD's other lines ----------
let lastWhere = '', hudT = 0;
function hud(dt) {
  hudT -= dt; if (hudT > 0) return; hudT = 0.25;
  $('clk').textContent = clock(); $('phase').textContent = phaseName(TIME.h) + (ENV.rain > 0.2 ? ' · RAIN' : '');
  const pl = PLACES.find(p => Math.hypot(p.x - P.pos.x, p.z - P.pos.z) < 24), sb = Math.hypot(SB.x - P.pos.x, SB.z - P.pos.z) < 18;
  const full = districtAt(P.pos.x, P.pos.z) + (pl ? ' · ' + pl.name : sb ? ' · Signal Box' : '');
  if (full !== lastWhere) { lastWhere = full; const el = $('where'); el.textContent = full; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  $('hpbar').style.width = Math.max(0, P.hp) + '%'; $('hp').classList.toggle('low', P.hp < 40); $('hp').classList.toggle('on', P.hp < 100 || ENV.night > 0.72);
}

// ---------- rain that follows the camera ----------
const RAIN = TOUCH ? 1400 : 3200, rainPos = new Float32Array(RAIN * 6), rainSeed = new Float32Array(RAIN * 3);
for (let i = 0; i < RAIN; i++) { rainSeed[i * 3] = (Math.random() - 0.5) * 70; rainSeed[i * 3 + 1] = Math.random() * 30; rainSeed[i * 3 + 2] = (Math.random() - 0.5) * 70; }
const rainG = new THREE.BufferGeometry(); rainG.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainG, new THREE.LineBasicMaterial({ color: 0x9fb0c8, transparent: true, opacity: 0.28 })); rain.frustumCulled = false; scene.add(rain);
function runRain(dt) {
  rain.visible = ENV.rain > 0.03; if (!rain.visible) return; rain.material.opacity = 0.3 * ENV.rain;
  const n = Math.floor(RAIN * ENV.rain); rainG.setDrawRange(0, n * 2);
  for (let i = 0; i < n; i++) { let y = rainSeed[i * 3 + 1] - dt * 26; if (y < 0) y += 30; rainSeed[i * 3 + 1] = y; const x = cam.position.x + rainSeed[i * 3], z = cam.position.z + rainSeed[i * 3 + 2]; rainPos.set([x, y, z, x + 0.12, y + 0.9, z + 0.05], i * 6); }
  rainG.attributes.position.needsUpdate = true;
}

// ---------- quality: start with everything, give back what the machine cannot carry ----------
const Q = { t: 0, n: 0, sum: 0, step: 0 };
function quality(dt) {
  Q.t += dt; if (Q.t < 2) return; Q.n++; Q.sum += dt;
  if (Q.n < 60) return;
  const fps = Q.n / Q.sum; Q.n = 0; Q.sum = 0; Q.t = 0;
  if (fps > 45 || Q.step >= 2) return;
  Q.step++;
  if (Q.step === 1) { R.shadowMap.enabled = false; sun.castShadow = false; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); }); }
  else { R.setPixelRatio(1); composer.setPixelRatio?.(1); bloom.strength *= 0.8; dispatchEvent(new Event('resize')); }
}

// ---------- level crossings: busy while any train is near, and the barriers follow ----------
function trainSpans() {
  const out = []; for (const a of ambient) out.push([Math.min(a.s, a.s - a.dir * a.len), Math.max(a.s, a.s - a.dir * a.len)]);
  for (const t of [G.train, ...G.old]) if (t && t.g.visible) out.push([t.s - t.cars.length * CAR, t.s]);
  return out;
}
function crossings(dt, t) {
  const spans = trainSpans();
  for (const X of CROSSINGS) {
    const was = X.busy; X.busy = spans.some(([a, b]) => X.z > a - 75 && X.z < b + 30);
    if (X.busy) X.hold = 2.5; else if ((X.hold = (X.hold || 0) - dt) > 0) X.busy = true;   // stay down a moment after the tail clears
    X.down = clamp(X.down + (X.busy ? dt / 3 : -dt / 2.5), 0, 1);
    X.lights.forEach((m, i) => { m.emissiveIntensity = X.busy ? ((Math.floor(t * 2.6) + i) % 2 ? 6 : 0.1) : 0.1; });
    for (const a of X.arms) a.g.rotation.x = -Math.PI / 2 * 0.96 * (1 - smoothK(X.down));
  }
}
const smoothK = k => k * k * (3 - 2 * k);

// ---------- the stations: announcements, people on and off, the live board, riding the train ----------
let voice = null;
const pickVoice = () => { const v = speechSynthesis?.getVoices?.() || []; voice = v.find(x => /en-GB/i.test(x.lang) && /natural|sonia|libby|female|google uk/i.test(x.name)) || v.find(x => /en-GB/i.test(x.lang)) || v.find(x => /^en/i.test(x.lang)) || null; };
try { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; } catch (e) {}
const PA = { busy: 0, queue: [], nextInfo: 40 };
function announce(where, text, caption) {
  if (!started) return;
  const d = Math.min(dist(new THREE.Vector3(where.x, 0, where.z)), 1e9); if (d > 110) return;
  PA.queue.push({ text, caption: caption || text, k: clamp(1.2 - d / 110, 0.25, 1), name: where.name });
}
function runPA(dt) {
  PA.busy -= dt; if (PA.busy > 0 || !PA.queue.length) return;
  const a = PA.queue.shift(), el = $('pa'); PA.busy = 4 + a.text.length * 0.065;
  $('pa-cap').textContent = a.name; $('pa-t').textContent = a.caption; el.classList.add('on'); clearTimeout(runPA.t); runPA.t = setTimeout(() => el.classList.remove('on'), PA.busy * 1000);
  if (!soundOn()) return;
  sfx.pa();
  setTimeout(() => { try { const u = new SpeechSynthesisUtterance(a.text); if (voice) u.voice = voice; u.lang = voice?.lang || 'en-GB'; u.rate = 0.94; u.pitch = 1.02; u.volume = a.k * 0.9; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {} }, 1700);
}
const STN = { junction: { x: JUNCTION.x, z: JUNCTION.z, name: 'Junction Station · PA' }, central: { x: 36, z: 150, name: 'Central Station · PA' } };
const spoken = n => String(n).split('').join(' ');
function stationLife(dt) {
  if (!townReady) return;
  runPigeons(dt, P.pos, P.speed, () => sfx.flutter());
  while (RAIL_EVENTS.length) {
    const e = RAIL_EVENTS.shift(), pf = e.pf, at = STN[pf.id], time = clock();
    stationEvent(e.kind, pf);
    if (e.kind === 'approach') announce(at, `The next train to arrive at platform ${pf.no} is the ${time} service to ${pf.to}, calling at ${pf.via}. Please stand behind the yellow line.`, `Platform ${pf.no}: the ${time} to ${pf.to}, calling at ${pf.via}. Stand behind the yellow line.`);
    if (e.kind === 'arrive') announce(at, `Platform ${pf.no}. The train now standing is for ${pf.to}. Please let passengers off the train first.`, `Platform ${pf.no}: the train now standing is for ${pf.to}. Let passengers off first.`);
    if (e.kind === 'closing') { if (dist(new THREE.Vector3(at.x, 0, at.z)) < 60) { sfx.whistle(clamp(1 - dist(new THREE.Vector3(at.x, 0, at.z)) / 60, 0.2, 1)); setTimeout(() => sfx.doors(), 700); } announce(at, 'Mind the gap. Doors are closing.', 'Mind the gap. Doors closing.'); }
  }
  // a train on the main line runs through platform 1 without stopping
  if (G.train && !G.train.route && G.train.s > -260 && !G.train.warned) { G.train.warned = true; announce(STN.junction, 'Platform one. Stand well back from the edge. The next train is not scheduled to stop at this station.', 'Platform 1: the next train is not stopping. Stand well back from the edge.'); }
  // between trains: information, from the record, and from the night
  PA.nextInfo -= dt;
  if (PA.nextInfo <= 0) {
    PA.nextInfo = 70 + Math.random() * 60;
    const near = dist(new THREE.Vector3(STN.junction.x, 0, STN.junction.z)) < dist(new THREE.Vector3(STN.central.x, 0, STN.central.z)) ? STN.junction : STN.central;
    const v = (DATA.verdicts?.verdicts || [])[0], pool = [];
    if (v) pool.push([`Customer information. The latest call on file is ${spoken(v.symbol || 'a token')}, filed ${v.verdict.toLowerCase()} with a score of ${v.score}. Shuntdesk's calls are not advice.`, `Latest call on file: ${v.symbol} · ${v.verdict} ${v.score}. Not advice.`]);
    if (ENV.night > 0.6) pool.push(['Passengers are reminded that RISKY sightings have been reported in Westbank after dark. Please stay in the light.', 'RISKY sightings in Westbank after dark. Stay in the light.']);
    pool.push(['Please keep your belongings with you at all times. If a token looks too good to be true, run the seven checks.', 'Keep your belongings with you. If a token looks too good to be true, run the seven checks.']);
    pool.push(['Shuntdesk reminds passengers: every token rides the line.', 'Every token rides the line.']);
    const [t, c] = pool[Math.floor(Math.random() * pool.length)]; announce(near, t, c);
  }
  runPA(dt);
  boardTick(dt);
}
// the departures board at Junction: the 22's countdown on top, the latest calls under it
let boardT = 0;
function boardTick(dt) {
  if ((boardT -= dt) > 0) return; boardT = 1;
  const pf = PLATFORMS[0], a = pf.train; let eta = '—';
  if (a) { if (a.wait > 0) eta = 'BOARDING'; else { const d = a.dir * (a.stop + 20 - a.s), left = d > 0 ? d : d + 2 * END + 140 + a.len, sec = left / Math.max(8, a.top); eta = d > 0 && d < 40 ? 'ARRIVING' : sec < 60 ? Math.round(sec) + ' SEC' : (sec / 60).toFixed(1) + ' MIN'; } }
  const v = DATA.verdicts?.verdicts || [];
  drawScreen('junction', `JUNCTION · ${clock()}`, [[`P2 · ${pf.to.toUpperCase()}`, eta, eta === 'BOARDING' ? '#2ed3a0' : '#ffb340'], ['P1 · MAIN LINE', 'NOT STOPPING', '#9a9da3'], ...v.slice(0, 3).map(x => [`LATEST · ${x.symbol}`, `${x.verdict} ${x.score}`, x.verdict === 'CLEAN' ? '#2ed3a0' : x.verdict === 'DANGER' ? '#ff4d5e' : '#ffb340'])], '#2ed3a0');
}
// ride the train that is standing: Junction platform 2 to Central, Central platform 1 to Junction
for (const pf of PLATFORMS) ACTS.push({ at: new THREE.Vector3(pf.edge, 1, (pf.z0 + pf.z1) / 2), r: 30, when: () => pf.dwell && Math.abs(P.pos.x - pf.edge) < 2.2 && P.pos.z > pf.z0 && P.pos.z < pf.z1 && P.pos.y > 0.5, text: () => `Board the ${pf.track} · ride to ${pf.ride === 'central' ? 'Central Station' : 'Junction Station'}`, go: () => {
  if (!fare(3, 'train')) return; const f = $('fade'); f.classList.add('on'); sfx.doors();
  setTimeout(() => { if (pf.ride === 'central') P.pos.set(35.5, 1, 150); else P.pos.set(16, 1, -70); P.yaw = pf.ride === 'central' ? -Math.PI / 2 : Math.PI / 2; look.yaw = P.yaw + Math.PI; cam.position.set(P.pos.x, 5, P.pos.z + 6); if (pf.id === 'junction') complete('ride'); banner('ARRIVED', pf.ride === 'central' ? 'Central Station' : 'Junction Station'); f.classList.remove('on'); }, 1600);
} });
// ---------- the bus: a ride across town ----------
function nearestStop() { let b = null, d = 1e9; for (const s of STOPS) { const k = dist(s.at); if (k < d) { d = k; b = s; } } return b?.at; }
function travel(to) {
  if (!fare(2, 'bus')) return;
  closeInfo(); const f = $('fade'); f.classList.add('on'); sfx.door();
  setTimeout(() => { P.pos.set(to.at.x, 0, to.at.z + 1.5); P.yaw = 0; look.yaw = Math.PI; cam.position.set(P.pos.x, 4, P.pos.z + 8); complete('bus'); banner('BUS', to.name); f.classList.remove('on'); }, 700);
}
for (const st of STOPS) ACTS.push({ at: st.at, r: 2.8, when: () => !G.on, text: () => `Bus stop · ${st.name} · ride across town`, go: () => { info('Where to?', `Bus stop · ${st.name}`, `<div class="stops">${STOPS.filter(x => x !== st).map(x => `<button class="btn ghost" data-stop="${x.id}">${esc(x.name)}</button>`).join('')}</div>`); $('in-b').querySelectorAll('[data-stop]').forEach(b => b.onclick = () => travel(STOPS.find(x => x.id === b.dataset.stop))); } });

// ---------- The Wheel: one slow turn over the city ----------
const RIDE = { on: false, t: 0, car: 0 };
const rideV = new THREE.Vector3(), rideLook = new THREE.Vector3();
ACTS.push({ at: place('wheel').at, r: 3.5, when: () => !G.on && !RIDE.on, text: () => 'The Wheel · take a ride', go: () => { RIDE.on = true; RIDE.t = 0; RIDE.car = WHEEL.cars.reduce((b, c, i) => { c.getWorldPosition(rideV); return rideV.y < b[1] ? [i, rideV.y] : b; }, [0, 1e9])[0]; if (hero) hero.g.visible = false; sfx.wheel(); banner('THE WHEEL', 'E to step off'); complete('wheel'); } });
function riding(dt) {
  RIDE.t += dt; WHEEL.cars[RIDE.car].getWorldPosition(rideV);
  // sit just in front of the car and look south over Eastgate, the yard and Westbank, panning slowly
  const a = Math.sin(RIDE.t * 0.09) * 0.7; rideLook.set(60 + Math.sin(a) * 260, 0, 40);
  scene.fog.density *= 0.22;   // up here the air is clear enough to see the whole city
  // on the city side of the wheel, so the wheel is behind you
  cam.position.lerp(rideV.set(rideV.x, rideV.y - 0.8, WHEEL.z - 7), damp(dt, 5)); cam.lookAt(rideLook); sky.position.copy(cam.position);
  if (lastPrompt) { lastPrompt = ''; $('prompt').classList.remove('on'); }
  if (act || RIDE.t > 42) { act = false; RIDE.on = false; if (hero) hero.g.visible = true; P.pos.copy(place('wheel').at); P.pos.z += 1; }
}

// ---------- the leaderboard: shifts scored by the server ----------
async function submitShift(results) {
  if (!save.handle || !results.length) return;
  try {
    const r = await fetch('/api/yard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: save.handle, calls: results.map(x => ({ token: x.d.token, call: x.call })) }) });
    const j = await r.json(); if (!j.ok) return banner('THE BOARD', j.why || 'not counted');
    LB.data = j; complete('lead'); banner('ON THE BOARD', `#${j.rank} this week · ${j.shift.pts} points`);
  } catch (e) {}
}
const LB = { data: null };
async function leaderboard() {
  $('lead').classList.add('on'); $('lb-name').value = save.handle || '';
  try { LB.data = await (await fetch('/api/yard' + (save.handle ? '?me=' + save.handle : ''), { cache: 'no-store' })).json(); } catch (e) {}
  const d = LB.data, ends = d ? Math.max(0, Math.round((d.ends - Date.now()) / 36e5)) : 0;
  $('lb-cap').textContent = d ? `This week · ${d.players} on the board · ends in ${ends > 48 ? Math.round(ends / 24) + ' days' : ends + ' h'}` : 'The board is not answering right now';
  $('lb-rows').innerHTML = d && d.rows.length ? d.rows.map((r, i) => `<div class="${r.handle === save.handle ? 'me' : ''}"><i>${i + 1}</i><b>${esc(r.handle)}</b><span>${r.right}/${r.read} right · ${r.shifts} shift${r.shifts === 1 ? '' : 's'}${r.beat ? ` · beat the desk ${r.beat}×` : ''}</span><em>${r.pts}</em></div>`).join('') : '<p>Nobody on the board this week yet. Pick a name and run a shift.</p>';
}
$('lb-save').onclick = () => { const h = $('lb-name').value.trim().toLowerCase(); if (!/^[a-z0-9_]{2,16}$/.test(h)) { $('lb-msg').textContent = '2 to 16 letters, digits or _'; return; } save.handle = h; keep(); $('lb-msg').textContent = 'Saved. Your next shift goes on the board.'; leaderboard(); };
$('lead').addEventListener('click', e => { if (e.target.closest('.x') || e.target === $('lead')) $('lead').classList.remove('on'); });
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (e.code === 'KeyL' && !e.repeat) { $('lead').classList.contains('on') ? $('lead').classList.remove('on') : leaderboard(); } if (e.code === 'KeyN' && !e.repeat) toggleSound(); });
tap('b-lead', () => leaderboard()); tap('b-photo', () => photo(!document.body.classList.contains('photo')));
function toggleSound() { setSound(!soundOn()); startAudio(); $('snd').textContent = soundOn() ? 'SOUND ON' : 'SOUND OFF'; }
$('snd').textContent = soundOn() ? 'SOUND ON' : 'SOUND OFF'; $('snd').addEventListener('click', toggleSound);

// ---------- what the world sounds like ----------
let groanT = 3;
const greens = PLACES.filter(p => ['park', 'square', 'lake', 'wheel', 'market'].includes(p.id));
function listen(dt) {
  let trainD = 1e9, trainV = 0;
  for (const a of ambient) { const z = clamp(P.pos.z, Math.min(a.s, a.s - a.dir * a.len), Math.max(a.s, a.s - a.dir * a.len)), d = Math.hypot(a.x - P.pos.x, z - P.pos.z); if (d < trainD) { trainD = d; trainV = a.v; } }
  for (const t of [G.train, ...G.old]) if (t) { const z = clamp(P.pos.z, t.s - t.cars.length * CAR, t.s), d = Math.hypot(P.pos.x, z - P.pos.z); if (d < trainD) { trainD = d; trainV = t.wreck ? 0 : t.v; } }
  let carD = 1e9, carV = 0; for (const c of cars) { const d = Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z); if (d < carD) { carD = d; carV = c.v; } }
  let bellD = 1e9; for (const X of CROSSINGS) if (X.busy) bellD = Math.min(bellD, Math.hypot(P.pos.x, P.pos.z - X.z));
  const district = districtAt(P.pos.x, P.pos.z), city = district === 'Eastgate' ? 1 : district === 'Westbank' ? 0.7 : district === 'The Yard' ? 0.45 : 0.2;
  // how many people are close, whether a train is braking near you, how far the nearest platform is
  let crowd = 0; if (townReady) for (const f of folk) if (f.p.g.visible && Math.abs(f.pos.x - P.pos.x) < 22 && Math.abs(f.pos.z - P.pos.z) < 22) crowd++;
  let braking = false, brakeD = 1e9;
  for (const a of ambient) if (a.stop != null && a.v > 0.6 && a.v < a.top - 1 && !a.done) { const d = Math.hypot(a.x - P.pos.x, a.s - P.pos.z); if (d < brakeD) { brakeD = d; braking = true; } }
  if (G.train && G.train.route === 'siding' && G.train.v > 0.5 && G.train.v < SPEED - 1) { const d = Math.hypot(SID.x - P.pos.x, G.train.s - P.pos.z); if (d < brakeD) { brakeD = d; braking = true; } }
  const stationD = 1e9;   // the station chime now comes with the announcements
  tickAudio(dt, { rain: ENV.rain, night: ENV.night, inside: !!inside, city, trainD, trainV, carD, carV, bellD, crowd: crowd / 12, braking, brakeD, stationD, duck: $('reveal').classList.contains('on') || $('done').hidden === false, green: greens.some(g => dist(g) < 70) || Math.abs(P.pos.z) > 310, title: !started });
  groanT -= dt; if (groanT <= 0) { groanT = 2 + Math.random() * 4; const z = zombies.find(z => z.state !== 'dead' && dist(z.pos) < 30); if (z) sfx.groan(1 - dist(z.pos) / 30); }
}

// ---------- city life: cash, energy, food and drink, jobs, the shop, the people you can talk to ----------
// Cash here is game money: earned in the yard and spent in the city. It is not $SHUNT, not a token, worth nothing outside.
// every field gets its default on its own, so a save from an older version still loads
save.cash ??= 20; save.earned ??= 0; save.items ??= []; save.talked ??= 0; save.parcels ??= 0; save.litter ??= 0; save.tix ??= []; save.ate ??= 0; save.drank ??= 0; save.favors ??= 0; save.photos ??= 0; save.seen ??= []; save.energy ??= 100; keep();
P.energy = save.energy ?? 100;
const has = id => save.items.includes(id);
function pay(n, why) { if (!n) return; save.cash += n; save.earned += n; keep(); walletUI(); const w = $('wallet'); w.classList.remove('gain'); void w.offsetWidth; w.classList.add('gain'); sfx.coin(); floatText(`+$${n}`); }
function spend(n) { if (save.cash < n) { banner('NOT ENOUGH CASH', `You need $${n}. Work a shift, deliver parcels, pick up litter.`); sfx.bad(); return false; } save.cash -= n; keep(); walletUI(); sfx.coin(); return true; }
function fare(n, what) { if (has('pass')) return true; if (!spend(n)) return false; floatText(`-$${n} ${what}`); return true; }
function floatText(t) { const el = document.createElement('div'); el.className = 'float'; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 1400); }
function walletUI() { $('cash').textContent = '$' + save.cash; $('enbar').style.width = Math.max(0, P.energy) + '%'; $('wallet').classList.toggle('tired', P.energy < 25); }
const runSpeed = () => (P.energy < 20 ? 6.2 : has('shoes') ? 9.8 : 8.2) + (P.boost > 0 ? 1.2 : 0);
let tiredSaid = false;
function energyTick(dt) {
  const running = P.speed > 5.2;
  P.energy = clamp(P.energy - dt * (0.09 + (running ? 0.32 : 0) + (ENV.rain > 0.3 && !inside && !has('coat') ? 0.08 : 0)), 0, 100);
  if (P.boost > 0) P.boost -= dt;
  if (P.energy < 22 && !tiredSaid) { tiredSaid = true; banner('RUNNING LOW', 'Eat or drink something: food trucks, the kiosk, the diner.'); } if (P.energy > 40) tiredSaid = false;
  save.energy = Math.round(P.energy); walletUI();
}
// eat and drink
const MENUS = {
  NOODLES: [['Noodles', 6, 45], ['Tea', 2, 12]], TACOS: [['Tacos', 5, 40], ['Lime soda', 2, 12]], COFFEE: [['Coffee', 3, 25, 'boost'], ['Pastry', 3, 18]],
  DUMPLINGS: [['Dumplings', 6, 45], ['Tea', 2, 12]], KEBAB: [['Kebab', 7, 52], ['Ayran', 2, 12]], 'ICE CREAM': [['Ice cream', 3, 15], ['Float', 4, 20]], BURGERS: [['Burger', 7, 55], ['Fries', 3, 20], ['Shake', 4, 22]],
  KIOSK: [['Coffee', 3, 25, 'boost'], ['Water', 1, 10], ['Sandwich', 5, 38]], DINER: [['Coffee', 3, 25, 'boost'], ['Slice of pie', 5, 35], ['The night line plate', 9, 80, 'heal']],
};
function menu(title, cap, key) {
  const items = MENUS[key];
  info(title, cap, `<p>Cash: <b>$${save.cash}</b> · energy ${Math.round(P.energy)}%</p><div class="menu">${items.map((it, i) => `<button class="btn ghost" data-buy="${i}"><span>${it[0]}</span><b>$${it[1]}</b></button>`).join('')}</div><p class="pm">${key === 'DINER' && ENV.night > 0.6 ? '<button class="btn ghost" id="wait">Wait here until morning</button>' : ''}</p>`);
  $('in-b').querySelectorAll('[data-buy]').forEach(b => b.onclick = () => {
    const [name, price, en, fx] = items[+b.dataset.buy]; if (!spend(price)) return;
    P.energy = Math.min(100, P.energy + en); if (fx === 'boost') { P.boost = 90; complete('coffee'); } if (fx === 'heal') P.hp = 100;
    const drink = /coffee|tea|water|soda|ayran|shake|float/i.test(name); drink ? save.drank++ : save.ate++; keep(); walletUI();
    sfx.coffee(); banner(drink ? 'DRINK' : 'FOOD', `${name} · energy ${Math.round(P.energy)}%`); closeInfo(); if (QUEST.want === name && QUEST.f) { QUEST.have = true; banner('FOR THE FAVOUR', `Take the ${name.toLowerCase()} back to ${QUEST.f.npc.name}.`); }
  });
  const w = $('wait'); if (w) w.onclick = () => { TIME.h = 6.6; closeInfo(); banner('MORNING', 'You sat out the night.'); };
}
for (const t of FOODTRUCKS) ACTS.push({ at: new THREE.Vector3(t.x, 0, t.z), r: 2.6, when: () => true, text: () => `${t.name} truck · eat and drink`, go: () => menu(t.name.toLowerCase().replace(/^\w/, c => c.toUpperCase()), 'Food truck · pay in cash', MENUS[t.name] ? t.name : 'NOODLES') });
ACTS.push({ at: new THREE.Vector3(JUNCTION.x, 1, JUNCTION.z + 13.6), r: 2.4, when: () => true, text: () => 'Junction kiosk · coffee and sandwiches', go: () => menu('Junction kiosk', 'Tickets · coffee', 'KIOSK') });
PLACE_ACT.diner = { text: 'Order something', go: () => menu('Night Line Diner', 'Open all night', 'DINER') };
{ const d = ACTS.find(a => a.at === place('diner')?.at); if (d) { d.text = () => 'Night Line Diner · order something'; d.go = PLACE_ACT.diner.go; } }

// the shop: Yard Supply, at Curve Market
const SHOP = [['shoes', 'Running shoes', 60, 'Run faster, for good.'], ['lantern', 'Bright lantern', 35, 'Twice the light after dark.'], ['bat', 'Steel bat', 45, 'Longer reach, harder hits on the RISKY.'], ['coat', 'Raincoat', 25, 'Rain stops wearing you down.'], ['pass', 'Season pass', 50, 'Buses and trains are free.']];
function shop() {
  info('Yard Supply', 'Curve Market · upgrades, paid in cash', `<p>Cash: <b>$${save.cash}</b></p><div class="menu">${SHOP.map(s => `<button class="btn ghost" data-shop="${s[0]}" ${has(s[0]) ? 'disabled' : ''}><span>${s[1]}<small>${s[3]}</small></span><b>${has(s[0]) ? 'OWNED' : '$' + s[2]}</b></button>`).join('')}</div>`);
  $('in-b').querySelectorAll('[data-shop]').forEach(b => b.onclick = () => { const s = SHOP.find(x => x[0] === b.dataset.shop); if (has(s[0]) || !spend(s[2])) return; save.items.push(s[0]); keep(); if (s[0] === 'lantern') { lanternL.distance = 22; } sfx.mission(); banner('BOUGHT', s[1]); shop(); });
}
PLACE_ACT.market.go = shop; { const m = ACTS.find(a => a.at === place('market')?.at); if (m) { m.text = () => 'Curve Market · Yard Supply, upgrades'; m.go = shop; } }
if (has('lantern')) lanternL.distance = 22;

// ---------- jobs: parcels from the job boards, litter on the streets, golden tickets lost round town ----------
const JOB = { on: false, to: null, pay: 0, t: 0 };
const parcel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.45), new THREE.MeshStandardMaterial({ color: 0xb08850, roughness: 0.8 })); parcel.position.set(0, 0.95, 0.35); parcel.visible = false; hero?.g.add(parcel);
const DROPS = ['diner', 'crew', 'deployer', 'station', 'radio', 'square', 'park', 'court', 'site', 'lake', 'wheel', 'stadium', 'junction', 'crash'].map(place).filter(Boolean);
function startJob(from) {
  if (JOB.on) return banner('ALREADY CARRYING', `Take the parcel to ${JOB.to.name}.`);
  const opts = DROPS.filter(d => Math.hypot(d.x - P.pos.x, d.z - P.pos.z) > 80), to = opts[Math.floor(Math.random() * opts.length)];
  const far = Math.hypot(to.x - P.pos.x, to.z - P.pos.z); Object.assign(JOB, { on: true, to, pay: Math.round(10 + far / 18), t: 0, limit: Math.round(far / 3.2 + 40) });
  parcel.visible = true; sfx.lever(); banner('PARCEL', `To ${to.name} · $${JOB.pay}, more if you are quick`); if (from) closeInfo();
}
function jobTick(dt) {
  if (!JOB.on) return; JOB.t += dt;
  const d = Math.hypot(JOB.to.at.x - P.pos.x, JOB.to.at.z - P.pos.z);
  if (d < 4.5) { const tip = JOB.t < JOB.limit ? Math.round(JOB.pay * 0.5) : 0; JOB.on = false; parcel.visible = false; save.parcels++; keep(); pay(JOB.pay + tip, 'parcel'); banner('DELIVERED', `${JOB.to.name}${tip ? ` · on time, +$${tip} tip` : ''}`); doEmote('emote-yes'); }
}
for (const [x, z, name] of [[-131.5, -28, 'Curve Market'], [JUNCTION.x - 3, JUNCTION.z + 22, 'Junction Station'], [241.5, 24, 'Signal Square']]) {
  const s = label(['JOB BOARD', 'PARCELS · CASH'], { size: 34, accent: '#ffb340', scale: 0.012 }); s.position.set(x, (name === 'Junction Station' ? 1 : 0) + 2.6, z); scene.add(s);
  ACTS.push({ at: new THREE.Vector3(x, 0, z), r: 2.6, when: () => true, text: () => JOB.on ? `Job board · you are carrying a parcel for ${JOB.to.name}` : 'Job board · take a parcel delivery', go: () => startJob() });
}
// litter
const LITTER = [], litterM = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4 }), litterRing = additive(0xffb340, 0.5);
function dropLitter(n) {
  for (let i = 0; i < n; i++) {
    const side = Math.random() < 0.5 ? -1 : 1, D = DISTRICTS[side < 0 ? 'west' : 'east'], ax = D.aves[Math.floor(Math.random() * D.aves.length)];
    const x = Math.random() < 0.35 ? side * (46 + Math.random() * 16) : ax + (Math.random() < 0.5 ? -1 : 1) * (ROAD / 2 + 1.6), z = -290 + Math.random() * 580;
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
    const bag = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), litterM); bag.position.y = 0.28; bag.scale.y = 0.85; g.add(bag);
    const r = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 20), litterRing); r.rotation.x = -Math.PI / 2; r.position.y = 0.05; g.add(r);
    LITTER.push({ g, x, z });
  }
}
dropLitter(36);
function litterTick() {
  for (let i = LITTER.length - 1; i >= 0; i--) { const L = LITTER[i]; if (Math.abs(L.x - P.pos.x) < 1.4 && Math.abs(L.z - P.pos.z) < 1.4 && P.pos.y < 0.6) { scene.remove(L.g); LITTER.splice(i, 1); save.litter++; keep(); pay(2, 'litter'); if (LITTER.length < 24) dropLitter(4); } }
}
// golden tickets: twelve, hidden round the edges of the places
const TIX = [], tixM = new THREE.MeshStandardMaterial({ color: 0x3a2a00, emissive: 0xffc340, emissiveIntensity: 2.2, metalness: 0.8, roughness: 0.3 });
PLACES.filter(p => !['junction'].includes(p.id)).slice(0, 12).forEach((p, i) => {
  const a = i * 2.39, x = p.x + Math.cos(a) * 14, z = p.z + Math.sin(a) * 14; let fx = x, fz = z;
  for (let k = 0; k < 12 && near(fx, fz, 1).some(b => fx > b.x0 - 0.8 && fx < b.x1 + 0.8 && fz > b.z0 - 0.8 && fz < b.z1 + 0.8); k++) { fx = p.x + Math.cos(a + k) * (10 + k); fz = p.z + Math.sin(a + k) * (10 + k); }
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.03), tixM); m.position.set(fx, 1.1, fz); scene.add(m); TIX.push({ m, i, x: fx, z: fz }); if (save.tix.includes(i)) m.visible = false;
});
function tixTick(t) {
  for (const k of TIX) { if (!k.m.visible) continue; k.m.rotation.y = t * 2 + k.i; k.m.position.y = 1.1 + Math.sin(t * 2.5 + k.i) * 0.12; if (Math.hypot(k.x - P.pos.x, k.z - P.pos.z) < 1.4) { k.m.visible = false; save.tix.push(k.i); keep(); pay(10, 'ticket'); addXp(30); banner('GOLDEN TICKET', `${save.tix.length} of 12 found`); sfx.mission(); } }
}

// ---------- the people: walk up, press E, talk. Every voice is a little different ----------
const FIRST = { f: ['Ana', 'Mira', 'Juno', 'Lena', 'Sasha', 'Rika', 'Noor', 'Ivy', 'Tess', 'Kai', 'Dara', 'Wren', 'Ola', 'Maya', 'Nell', 'Zoe'], m: ['Ben', 'Omar', 'Theo', 'Rafi', 'Dev', 'Luca', 'Arlo', 'Jonah', 'Sam', 'Ezra', 'Milo', 'Teddy', 'Hugo', 'Ravi', 'Nico', 'Otis'] };
let voices = []; const loadVoices = () => { try { voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)); } catch (e) {} }; loadVoices(); try { speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch (e) {}
function persona(f) {
  if (f.npc) return f.npc;
  const fem = /female/.test(f.p.model), h = Math.abs(Math.sin(f.pos.x * 12.9 + f.pos.z * 78.2) * 43758) % 1;
  const staff = f.p.model === 'male-c' && ['route', 'stay'].includes(f.kind) && (Math.abs(f.pos.x - 11) < 9 || Math.abs(f.pos.x - 35) < 6);
  const crew = f.p.model === 'male-e' && f.kind === 'pace', vendor = f.kind === 'stay' && f.act === 'interact-right';
  const role = staff ? 'station staff' : crew ? 'yard crew' : vendor ? 'trader' : ['commuter', 'night owl', 'student', 'chartist', 'tourist', 'old hand', 'courier', 'busker fan'][Math.floor(h * 8)];
  const name = (fem ? FIRST.f : FIRST.m)[Math.floor(h * 16) % 16];
  return (f.npc = { name, role, pitch: fem ? 1.15 + h * 0.35 : 0.72 + h * 0.3, rate: 0.9 + ((h * 7) % 1) * 0.25, voice: Math.floor(h * 97), favor: h < 0.3 ? ['Coffee', 'Noodles', 'Tacos', 'Ice cream'][Math.floor(h * 13) % 4] : null, met: false });
}
const TALK = { f: null, opts: [] };
function speak(npc, text) {
  if (!soundOn()) return; try { const u = new SpeechSynthesisUtterance(text); const pool = voices.length ? voices : speechSynthesis.getVoices(); if (pool.length) u.voice = pool[npc.voice % pool.length]; u.pitch = npc.pitch; u.rate = npc.rate; u.volume = 0.9; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
}
function say(text, opts) {
  const n = TALK.f.npc; $('tk-who').textContent = `${n.name} · ${n.role}`; $('tk-t').textContent = text; TALK.opts = opts;
  $('tk-o').innerHTML = opts.map((o, i) => `<button data-o="${i}"><kbd>${i + 1}</kbd>${esc(o[0])}</button>`).join('');
  $('tk-o').querySelectorAll('[data-o]').forEach(b => b.onclick = () => choose(+b.dataset.o));
  speak(n, text);
}
function choose(i) { const o = TALK.opts[i]; if (!o) return; sfx.ui(); o[1](); }
function endTalk() { if (TALK.f) { TALK.f.talk = false; if (TALK.f.p.cur) TALK.f.p.play(TALK.f.act || 'walk', 0.3); } TALK.f = null; $('talk').classList.remove('on'); try { speechSynthesis.cancel(); } catch (e) {} }
const QUEST = { f: null, want: null, have: false };
const pickOne = a => a[Math.floor(Math.random() * a.length)];
function tip() {
  const v = (DATA.verdicts?.verdicts || [])[0], d = DATA.desk, missing = TIX.filter(k => k.m.visible);
  const out = [];
  if (v) out.push(`Heard the board at the station? Last call was ${v.symbol}, ${v.verdict.toLowerCase()}, ${v.score}. Not that I'd take it as advice.`);
  if (d) out.push(`The crew's paper desk is sitting on ${money(d.equity)}. They started at ${money(d.start)}.`);
  if (missing.length) { const k = missing[Math.floor(Math.random() * missing.length)], pl = PLACES.reduce((b, p) => Math.hypot(p.x - k.x, p.z - k.z) < Math.hypot(b.x - k.x, b.z - k.z) ? p : b, PLACES[0]); out.push(`I saw something gold shining near ${pl.name}. A lost ticket, maybe.`); }
  if (ENV.night > 0.6) out.push('Watch yourself tonight. The RISKY come out of the Crash Site after dark.'); else out.push('Pick-up game at Westbank Court most afternoons. Worth a look.');
  out.push('If you need cash, the job boards always have parcels. Curve Market, Junction, Signal Square.');
  out.push('The Wheel by the lake. Ride it at night, you can see the whole city.');
  return pickOne(out);
}
const GREET = { 'station staff': ['Afternoon. Mind the yellow line, please.', 'Busy one today. Need anything?'], 'yard crew': ['Long shift. You with the Signal Box?', 'Careful on the tracks, mate.'], trader: ['Fresh today. What can I get you?', 'Hungry? Cash only.'],
  commuter: ['Sorry, can\'t be late for the 22.', 'Hi. Bit rushed, but go on.'], 'night owl': ['City looks better after dark, doesn\'t it?', 'Hey. Out late too?'], student: ['Hey! Do you work at the yard?', 'Hi! Is the Wheel open?'], chartist: ['Everything rides the line eventually.', 'You read the manifests? Me too.'],
  tourist: ['Excuse me, is this the way to the lake?', 'What a city! Where should I go?'], 'old hand': ['I\'ve seen a hundred rugs come through here, kid.', 'Evening. You\'re the new shunter.'], courier: ['Can\'t stop long, parcels to drop.', 'Hey. Job boards are paying well today.'], 'busker fan': ['Have you heard the guy in Signal Square? So good.', 'Hi! Music tonight at the square.'] };
const FLAVOR = { 'station staff': ['When is the next train?', () => { const a = PLATFORMS[0].train; return a && a.wait > 0 ? 'The 22 is standing at platform two right now. Hop on if you are going to Central.' : 'The 22 comes through platform two every few minutes. Check the board.'; }],
  'yard crew': ['Any advice for a shift?', () => 'Read the manifest, not the name. Fresh wallets and a thin pool mean siding, nine times out of ten.'],
  chartist: ['What do you look for?', () => 'Who holds it, who launched it, and whether the pool can take a sell. The rest is noise.'],
  'old hand': ['Seen a lot of rugs?', () => 'Enough to know they all look clean the hour before. That\'s why the yard checks seven things, not one.'],
  tourist: ['Where should I go?', () => 'I\'m told the Night Line Diner never closes, and the stadium is packed on match night.'] };
function openTalk(f) {
  const n = persona(f); TALK.f = f; f.talk = true; f.p.play('emote-yes', 0.2, 0.8); $('talk').classList.add('on');
  if (!n.met) { n.met = true; save.talked++; keep(); }
  // a favour comes back round
  if (QUEST.f === f && QUEST.have) return say(`That's my ${QUEST.want.toLowerCase()}! You're a star. Here, for your trouble.`, [['You\'re welcome.', () => { QUEST.f = null; QUEST.have = false; save.favors++; keep(); pay(12, 'favour'); addXp(25); endTalk(); }]]);
  if (QUEST.f === f) return say(`Still hoping for that ${QUEST.want.toLowerCase()}. Food trucks and the kiosk have it.`, [['On it.', endTalk]]);
  const opts = [['What\'s going on around here?', () => say(tip(), [['Thanks.', endTalk], ['Anything else?', () => say(tip(), [['Thanks.', endTalk]])]])]];
  if (FLAVOR[n.role]) opts.push([FLAVOR[n.role][0], () => say(FLAVOR[n.role][1](), [['Good to know.', endTalk]])]);
  if (n.role === 'trader') opts.push(['What are you selling?', () => { endTalk(); const t = FOODTRUCKS.reduce((b, x) => Math.hypot(x.x - P.pos.x, x.z - P.pos.z) < Math.hypot(b.x - P.pos.x, b.z - P.pos.z) ? x : b, FOODTRUCKS[0]); menu(t.name.toLowerCase().replace(/^\w/, c => c.toUpperCase()), 'Food truck · pay in cash', MENUS[t.name] ? t.name : 'NOODLES'); }]);
  opts.push(['Need a hand with anything?', () => {
    if (n.favor && !QUEST.f) return say(`Actually, yes. Could you get me ${/^[aeiou]/i.test(n.favor) ? 'an' : 'a'} ${n.favor.toLowerCase()}? I'll make it worth your while.`, [['Sure.', () => { Object.assign(QUEST, { f, want: n.favor, have: false }); banner('FAVOUR', `Buy ${n.favor.toLowerCase()} and bring it to ${n.name}`); endTalk(); }], ['Not now.', endTalk]]);
    say('I\'m fine, thanks. If it\'s work you want, there are parcels on the job boards.', [['Take me to one.', () => { endTalk(); banner('JOB BOARDS', 'Curve Market, Junction Station, Signal Square'); }], ['Okay.', endTalk]]);
  }]);
  opts.push(['See you.', () => say(pickOne(['Take care.', 'See you around.', 'Mind the trains.', 'Bye now.']), [['Bye.', endTalk]])]);
  say(pickOne(GREET[n.role] || ['Hi.']), opts);
}
// T to talk, a click on a person to talk, and a name over the head of whoever you could talk to
let talkKey = false;
addEventListener('keydown', e => { if (e.code === 'KeyT' && !e.repeat && e.target.tagName !== 'INPUT') talkKey = true; });
const tagV = new THREE.Vector3();
function nameTag(f) {
  const el = $('ntag'); if (!f || TALK.f) { el.classList.remove('on'); return; }
  tagV.set(f.pos.x, f.pos.y + 2.25, f.pos.z).project(cam); if (tagV.z > 1) { el.classList.remove('on'); return; }
  const n = persona(f); el.textContent = `${n.name} · ${TOUCH ? 'ACT' : 'E / T'} to talk`; el.style.left = ((tagV.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - tagV.y) / 2 * innerHeight) + 'px'; el.classList.add('on');
}
{
  const ray = new THREE.Raycaster(), m = new THREE.Vector2(); let down = null;
  cv.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  cv.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6 || TALK.f || !townReady) return;
    m.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(m, cam);
    let best = null, bd = 1e9;
    for (const f of folk) { if (!f.p.g.visible || Math.hypot(f.pos.x - P.pos.x, f.pos.z - P.pos.z) > 9) continue; tagV.set(f.pos.x, f.pos.y + 0.9, f.pos.z); const d = ray.ray.distanceToPoint(tagV); if (d < 0.8 && d < bd) { bd = d; best = f; } }
    if (best) openTalk(best);
  });
}function nearestFolk(range = 3.4) { let b = null, bd = range; for (const f of folk) { if (!f.p.g.visible || f.kind === 'board' && f.state !== 'wait') continue; const d = Math.hypot(f.pos.x - P.pos.x, f.pos.z - P.pos.z); if (d < bd && Math.abs(f.pos.y - P.pos.y) < 0.6) { bd = d; b = f; } } if (b) b.dist = bd; return b; }
addEventListener('keydown', e => { if (!TALK.f) return; const k = +e.key; if (k >= 1 && k <= TALK.opts.length) { choose(k - 1); e.stopImmediatePropagation(); } if (e.code === 'Escape') endTalk(); }, true);
$('talk').addEventListener('pointerdown', e => e.stopPropagation());

// ---------- photo mode: hide the HUD, save a picture with the name on it ----------
let photoNext = false;
function photo(on) { document.body.classList.toggle('photo', on); }
$('ph-save').onclick = () => { photoNext = true; };
$('ph-close').onclick = () => photo(false);
addEventListener('keydown', e => { if (e.code === 'KeyP' && !e.repeat && e.target.tagName !== 'INPUT') photo(!document.body.classList.contains('photo')); });
function takePhoto() {
  photoNext = false; const src = R.domElement, c = document.createElement('canvas'); c.width = src.width; c.height = src.height; const x = c.getContext('2d'); x.drawImage(src, 0, 0);
  const s = c.width / 1600; x.fillStyle = 'rgba(6,7,8,.6)'; x.fillRect(c.width - 330 * s, c.height - 70 * s, 310 * s, 50 * s); x.fillStyle = '#edebe6'; x.font = `900 ${26 * s}px D`; x.fillText('SHUNTDESK', c.width - 312 * s, c.height - 36 * s); x.fillStyle = '#2ed3a0'; x.font = `700 ${13 * s}px M`; x.fillText('THE YARD', c.width - 128 * s, c.height - 37 * s);
  c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `the-yard-${Date.now()}.png`; a.click(); }); save.photos++; keep(); complete('photo'); banner('SAVED', 'Picture saved to your downloads');
}

// ---------- districts you have walked in ----------
function seenTick() { const d = districtAt(P.pos.x, P.pos.z); if (!save.seen.includes(d)) { save.seen.push(d); keep(); } }

// ---------- more missions ----------
MISSIONS.push(
  { id: 'hello', title: 'Say hello', text: 'Walk up to anyone in town and press E to talk.', where: () => null, xp: 30, auto: () => save.talked >= 1 },
  { id: 'eat', title: 'First meal', text: 'Buy something to eat from a food truck. You will need the energy.', where: () => FOODTRUCKS[0] && new THREE.Vector3(FOODTRUCKS[0].x, 0, FOODTRUCKS[0].z), xp: 30, auto: () => save.ate >= 1 },
  { id: 'parcel', title: 'First delivery', text: 'Take a parcel from a job board and deliver it.', where: () => JOB.on ? JOB.to.at : new THREE.Vector3(JUNCTION.x - 3, 1, JUNCTION.z + 22), xp: 50, auto: () => save.parcels >= 1 },
  { id: 'litter', title: 'Clean streets', text: 'Pick up ten bags of litter: walk over the ones with the amber ring.', where: () => null, xp: 50, auto: () => save.litter >= 10 },
  { id: 'friends', title: 'Making friends', text: 'Talk to ten different people round town.', where: () => null, xp: 60, auto: () => save.talked >= 10 },
  { id: 'favor', title: 'A favour', text: 'Someone will ask you for something. Bring it to them.', where: () => QUEST.f ? QUEST.f.pos : null, xp: 50, auto: () => save.favors >= 1 },
  { id: 'cash100', title: 'Pocket money', text: 'Earn $100 in total. Shifts, parcels, litter, tickets, favours, bounties.', where: () => null, xp: 60, auto: () => save.earned >= 100 },
  { id: 'shoes', title: 'New shoes', text: 'Buy running shoes at Yard Supply in Curve Market.', where: () => at('market'), xp: 60, auto: () => has('shoes') },
  { id: 'tix3', title: 'Lost and found', text: 'Find three golden tickets. People round town may tell you where.', where: () => null, xp: 60, auto: () => save.tix.length >= 3 },
  { id: 'courier', title: 'Courier', text: 'Deliver five parcels.', where: () => JOB.on ? JOB.to.at : null, xp: 100, auto: () => save.parcels >= 5 },
  { id: 'districts', title: 'Know the city', text: 'Set foot in the Yard, Westbank, Eastgate and the Outskirts.', where: () => null, xp: 60, auto: () => ['The Yard', 'Westbank', 'Eastgate', 'Outskirts'].every(d => save.seen.includes(d)) },
  { id: 'rugstop', title: 'Stop a RUG', text: 'The big ones, the RUG, walk with the RISKY at night. Stop one.', where: () => at('crash'), xp: 120, auto: () => (save.rugs || 0) >= 1 },
  { id: 'cash500', title: 'Saving up', text: 'Earn $500 in total.', where: () => null, xp: 150, auto: () => save.earned >= 500 },
  { id: 'kit', title: 'Fully kitted', text: 'Own everything Yard Supply sells.', where: () => at('market'), xp: 200, auto: () => SHOP.every(s => has(s[0])) },
  { id: 'tix12', title: 'All twelve', text: 'Find every golden ticket in the city.', where: () => null, xp: 300, auto: () => save.tix.length >= 12 },
  { id: 'photo', title: 'Say cheese', text: 'Press P for photo mode and save a picture of the city.', where: () => null, xp: 30 },
  { id: 'fed', title: 'Regular', text: 'Eat or drink twenty times round town.', where: () => null, xp: 80, auto: () => save.ate + save.drank >= 20 },
);

function lifeTick(dt, t) { energyTick(dt); jobTick(dt); litterTick(); tixTick(t); seenTick(); if (TALK.f && Math.hypot(TALK.f.pos.x - P.pos.x, TALK.f.pos.z - P.pos.z) > 4) endTalk(); }
walletUI();

// ===================================================================================================================
// ---------- more to do: the daily shift, your own token, cards, driving, taxis, fishing, hoops, the counter,
// ---------- rooms you walk into, events, weather, animals, clothes, the paper, a board in the square ----------
// ===================================================================================================================
save.cards ??= []; save.fish ??= []; save.wear ??= []; save.worn ??= null; save.npc ??= {}; save.day ??= 1; save.pending ??= []; keep();
const EXTRA_TRAINS = [];
let MODE = null;                       // driving a train, driving a taxi, watching a film: who owns the camera
const MINI = { on: false };            // a timing game on screen
const LATER = [];                      // people for the rooms, made once the town's models are in
function populateRooms() { LATER.forEach(f => f()); }
function jobGoal() { if (EVT.cur) return { title: EVT.cur.title, text: EVT.cur.text, at: EVT.cur.at() }; if (JOB.on) return { title: 'Parcel', text: `Deliver the parcel to ${JOB.to.name}. Quick delivery earns a tip.`, at: JOB.to.at }; if (QUEST.f) return { title: 'A favour', text: QUEST.have ? `Take the ${QUEST.want.toLowerCase()} to ${QUEST.f.npc.name}.` : `Buy ${QUEST.want.toLowerCase()} for ${QUEST.f.npc.name}: food trucks, the kiosk, the diner.`, at: QUEST.have ? QUEST.f.pos : null }; return null; }

// ---------- the Signal Box: a practice shift, the daily shift, or a token of your own ----------
let DAILY = null;
async function loadDaily() { DAILY = await getLive('/api/daily' + (save.handle ? '?me=' + save.handle : ''), j => (j.trains || []).length > 0); return DAILY; }
loadDaily();
function signalMenu() {
  const d = DAILY, played = save.dailyDay === d?.day || d?.played;
  info('Signal Box', 'Pick a shift', `<div class="menu">
    <button class="btn ghost" data-sm="practice"><span>Practice shift<small>Five random calls from the record. As many as you like.</small></span><b>5</b></button>
    <button class="btn ghost" data-sm="daily" ${!d || !d.trains.length || played ? 'disabled' : ''}><span>Daily shift #${d?.no ?? '·'}<small>${played ? 'Played today. Back tomorrow.' : 'The same five trains for everyone today. One go.'}</small></span><b>${d?.players ?? 0} played</b></button>
    <button class="btn ghost" data-sm="own"><span>Bring your own token<small>Paste an address: the seven checks run live and it comes down the line.</small></span><b>LIVE</b></button>
  </div>${save.pending.length ? `<p class="pm">${save.pending.length} of your tokens are waiting on their hour.</p>` : ''}`);
  $('in-b').querySelectorAll('[data-sm]').forEach(b => b.onclick = () => {
    closeInfo(); const k = b.dataset.sm;
    if (k === 'practice') startShift();
    if (k === 'daily') { if (!save.handle) return askName(() => startDaily()); startDaily(); }
    if (k === 'own') ownToken();
  });
}
ACTS[0].go = () => { if (!loaded) return; checkPending(); signalMenu(); };
ACTS[0].text = () => loaded ? 'Signal Box · pick a shift' : 'Reading the trains…';
function askName(then) {
  info('Your name on the board', 'The Yard', '<div class="lbf"><input id="nm" maxlength="16" placeholder="2 to 16 letters, digits or _" spellcheck="false" autocomplete="off"><button class="btn" id="nm-go">Go</button></div><p class="cap" id="nm-msg"></p>', null);
  setTimeout(() => $('nm')?.focus(), 50);
  $('nm-go').onclick = () => { const h = $('nm').value.trim().toLowerCase(); if (!/^[a-z0-9_]{2,16}$/.test(h)) { $('nm-msg').textContent = '2 to 16 letters, digits or _'; return; } save.handle = h; keep(); closeInfo(); then(); };
}
function startDaily() {
  const list = DAILY.trains.map(t => TRAINS.find(x => x.token === t.token) || null).filter(Boolean);
  if (list.length < DAILY.trains.length) return banner('DAILY SHIFT', 'Today\'s trains are not in yet. Try again in a minute.');
  startShift(list, 'daily', { no: DAILY.no, day: DAILY.day });
}
async function submitDaily(results) {
  save.dailyDay = DAILY.day; keep();
  try { const r = await fetch('/api/daily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: save.handle, calls: results.map(x => ({ token: x.d.token, call: x.call })) }) }); const j = await r.json(); if (j.ok || j.rows) { DAILY = j; complete('daily'); banner('DAILY SHIFT', j.rank ? `#${j.rank} of ${j.players} today` : 'Counted'); } } catch (e) {}
}
// your own token: the real seven checks run in the browser, the result is the live price an hour later
async function ownToken() {
  info('Bring your own token', 'A token on Robinhood Chain', '<div class="lbf"><input id="own" placeholder="0x… token address" spellcheck="false" autocomplete="off"><button class="btn" id="own-go">Run it</button></div><p class="cap" id="own-msg">The seven checks run live, the same as the ticket on shuntdesk.com, and the call is filed like any ticket. You call it; the price an hour later decides.</p>');
  setTimeout(() => $('own')?.focus(), 50);
  $('own-go').onclick = async () => {
    const a = $('own').value.trim().toLowerCase(); if (!isAddr(a)) return $('own-msg').textContent = 'That is not a token address.';
    $('own-msg').textContent = 'Running the seven checks…'; $('own-go').disabled = true;
    let r = null, pair = null; try { [r, pair] = await Promise.all([scan(a), pairFor(a)]); } catch (e) {}
    if (!r || !r.steps?.length || !pair?.price) { $('own-msg').textContent = 'No pool or no price for that token right now.'; $('own-go').disabled = false; return; }
    closeInfo();
    startShift([{ token: a, symbol: r.sym || a.slice(0, 6), stops: r.steps.map(s => s.tag), liq: r.liq || pair.liq, verdict: r.verdict, score: r.score, pending: true, p0: pair.price }], 'own');
  };
}
function lockOwn(d, call) { save.pending.push({ token: d.token, symbol: d.symbol, call: call || 'RIDE', p0: d.p0, t: Date.now(), verdict: d.verdict, score: d.score }); save.pending = save.pending.slice(-6); keep(); }
async function checkPending() {
  const due = save.pending.filter(x => Date.now() - x.t > 3600e3); if (!due.length) return;
  for (const x of due) {
    let p = null; try { p = (await pairFor(x.token))?.price; } catch (e) {}
    if (!p) continue; const m = p / x.p0 - 1, rose = m >= 0.02, right = x.call === 'RIDE' ? rose : !rose;
    save.pending = save.pending.filter(y => y !== x); keep();
    if (right) { pay(20, 'your token'); addXp(80); }
    addCard({ symbol: x.symbol, token: x.token, verdict: x.verdict, score: x.score, call: x.call, m, right, own: true });
    banner(right ? 'YOUR READ HELD' : 'THE LINE SAID NO', `${x.symbol} ${pct(m)} an hour later · you said ${x.call}`); complete('own');
  }
}

// ---------- cards: every train you read goes in the album ----------
function addCard(c) { save.cards.unshift({ ...c, at: Date.now() }); save.cards = save.cards.slice(0, 200); keep(); }
function album() {
  const c = save.cards;
  info('The album', `${c.length} cards · ${c.filter(x => x.rare).length} rare`, c.length ? `<div class="cards">${c.slice(0, 60).map(x => `<div class="tc ${x.rare ? 'rare' : ''} ${x.right ? 'r' : 'w'}"><b>${esc(x.symbol || '?')}</b><span>${x.verdict} ${x.score}</span><i>${x.call || 'no call'} · ${x.m == null ? '…' : pct(x.m)}</i>${x.rare ? '<em>RUG SPOTTED</em>' : x.own ? '<em>YOUR TOKEN</em>' : ''}</div>`).join('')}</div>` : '<p>No cards yet. Every train you read in a shift lands here.</p>');
}
addEventListener('keydown', e => { if (e.code === 'KeyK' && !e.repeat && e.target.tagName !== 'INPUT') album(); });

// ---------- the share card ----------
function shareCard() {
  const res = G.results, you = res.filter(r => r.right).length, sd = res.filter(r => r.sdRight).length, daily = G.mode === 'daily';
  const c = document.createElement('canvas'); c.width = 1200; c.height = 675; const x = c.getContext('2d');
  try { x.drawImage(R.domElement, 0, 0, 1200, 675); } catch (e) {}
  x.fillStyle = 'rgba(6,7,8,.82)'; x.fillRect(0, 0, 1200, 675);
  x.fillStyle = '#2ed3a0'; x.fillRect(0, 0, 10, 675);
  x.fillStyle = '#9a9da3'; x.font = '700 22px M'; x.fillText(daily ? `THE YARD · DAILY SHIFT #${G.meta.no}` : 'THE YARD · SHIFT', 70, 90);
  x.fillStyle = '#edebe6'; x.font = '900 220px D'; x.fillText(`${you}/${res.length}`, 62, 320);
  x.font = '900 46px D'; x.fillStyle = you > sd ? '#2ed3a0' : '#edebe6'; x.fillText(you > sd ? 'BEAT THE DESK' : you === sd ? 'LEVEL WITH THE DESK' : 'THE DESK READ IT BETTER', 70, 390);
  x.fillStyle = '#9a9da3'; x.font = '700 24px M'; x.fillText(`Shuntdesk ${sd}/${res.length} on the same trains`, 70, 432);
  res.forEach((r, i) => { x.fillStyle = r.right ? '#2ed3a0' : '#ff4d5e'; x.fillRect(70 + i * 86, 470, 72, 72); x.fillStyle = '#060708'; x.font = '900 28px D'; x.fillText(r.call === 'SIDING' ? 'S' : r.call === 'RIDE' ? 'R' : '-', 94 + i * 86, 518); });
  x.fillStyle = '#edebe6'; x.font = '900 34px D'; x.fillText((save.handle || 'a shunter').toUpperCase(), 70, 610);
  x.fillStyle = '#9a9da3'; x.font = '700 20px M'; x.fillText('SHUNTDESK.COM/PLAY', 880, 610);
  c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `the-yard-${daily ? 'daily-' + G.meta.no : 'shift'}.png`; a.click(); });
  complete('share');
}
function postText() {
  const res = G.results, you = res.filter(r => r.right).length, sd = res.filter(r => r.sdRight).length;
  const row = res.map(r => r.right ? '▮' : '▯').join('');
  return `The Yard${G.mode === 'daily' ? ` daily #${G.meta.no}` : ''}: ${you}/${res.length} ${row}\nShuntdesk got ${sd}/${res.length} on the same trains.\nshuntdesk.com/play`;
}
$('d-card').onclick = shareCard;
$('d-post').onclick = () => window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(postText()), '_blank', 'noopener');

// ---------- the board in Signal Square: this week's top five, on a big screen ----------
{ const sq = place('square'); screen('board', 9, 4.6, sq.x, 4.2, sq.z - 15, 0); box(0.3, 4, 0.3, M(0x2a2d32), sq.x - 3.5, 2, sq.z - 15.2); box(0.3, 4, 0.3, M(0x2a2d32), sq.x + 3.5, 2, sq.z - 15.2); }
async function boardScreen() {
  let w = null; try { w = await (await fetch('/api/yard', { cache: 'no-store' })).json(); } catch (e) {}
  const rows = (w?.rows || []).slice(0, 5).map((r, i) => [`${i + 1}  ${r.handle}`, `${r.pts} PTS`, i ? '#edebe6' : '#2ed3a0']);
  drawScreen('board', 'THE YARD · THIS WEEK', rows.length ? rows : [['Nobody on the board yet', 'BE FIRST']], '#2ed3a0');
}
boardScreen(); setInterval(boardScreen, 120000);

// ---------- rooms you walk into: they stand outside town, a door in town takes you there ----------
const ROOMS = {};
function door(x, z, rot, name, sub, color) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
  box(2.4, 3.2, 0.3, M(0x15171a), 0, 1.6, 0, g, true); box(1.6, 2.5, 0.06, glow(new THREE.Color(color).getHex(), 1.3, true), 0, 1.3, 0.18, g); box(2.8, 0.15, 1.2, M(0x23262b), 0, 3.25, 0.4, g);
  const s = label([name, sub], { size: 34, accent: color, scale: 0.011 }); s.position.set(0, 4.2, 0.4); g.add(s);
}
function makeRoom(id, at, w, d, opts, outside, name = id) {
  const r = room({ x: at[0], z: at[1], w, d, h: 5, door: 's', ...opts });
  const inside = new THREE.Vector3(at[0], 0, at[1] + d / 2 - 2);
  ROOMS[id] = { r, inside, outside: new THREE.Vector3(...outside) };
  ACTS.push({ at: inside, r: 2, when: () => true, text: () => `Leave · back to town`, go: () => goTo(ROOMS[id].outside, '') });
  if (id !== 'supply') ACTS.push({ at: ROOMS[id].outside, r: 2.4, when: () => true, text: () => `${name} · go inside`, go: () => goTo(inside.clone().add(new THREE.Vector3(0, 0, -1.8)), name.toUpperCase(), 0) });
  return ROOMS[id];
}
function goTo(v, msg, yaw = Math.PI) { const f = $('fade'); f.classList.add('on'); sfx.door(); setTimeout(() => { P.pos.copy(v); P.vy = 0; look.yaw = yaw; cam.position.set(v.x, v.y + 4, v.z + 6); if (msg) banner(msg, ''); f.classList.remove('on'); }, 600); }
const furn = M(0x2a2421, { roughness: 0.7 }), wood = M(0x8a6a4a, { roughness: 0.6 }), fabric = M(0x2e5a8a, { roughness: 0.9 }), red2 = M(0xa3262f, { roughness: 0.6 });
// your flat, Westbank: sleep, keep things, change clothes
{
  door(-77.2, -100, Math.PI / 2, 'THE OLD MILL FLATS', 'FLAT 3B · YOURS', '#9fd48a');
  const R0 = makeRoom('flat', [900, 0], 14, 11, { color: 0x3a3430, light: 0xffd6a0 }, [-75.4, 0, -100], 'Your flat');
  const [x, z] = [900, 0];
  box(3, 0.6, 2.2, fabric, x - 4.5, 0.3, z - 3.2, scene, true); box(3, 0.5, 0.4, wood, x - 4.5, 0.9, z - 4.25, scene, true); solid(x - 4.5, z - 3.2, 3, 2.2, 1);
  box(1.6, 1.8, 0.8, wood, x + 4.8, 0.9, z - 4.6, scene, true); solid(x + 4.8, z - 4.6, 1.6, 0.8, 2);
  box(2.2, 2.4, 0.7, M(0x4a4e54), x + 1.2, 1.2, z - 4.8, scene, true); solid(x + 1.2, z - 4.8, 2.2, 0.7, 2.4);
  box(3, 0.8, 1.2, wood, x - 1, 0.4, z + 0.5, scene, true); solid(x - 1, z + 0.5, 3, 1.2, 1);
  box(4, 2.2, 0.06, glow(0x5a7ab8, 0.9), x, 2.6, z - 5.3); // the window, night or day
  const flat = (t, go) => ACTS.push({ at: new THREE.Vector3(...t), r: 1.8, when: () => true, text: go.text, go: go.go });
  flat([x - 4.5, 0, z - 1.6], { text: () => ENV.night > 0.5 ? 'Bed · sleep until morning' : 'Bed · take a nap', go: () => { const f = $('fade'); f.classList.add('on'); setTimeout(() => { if (ENV.night > 0.5 || TIME.h < 6) TIME.h = 7; else TIME.h = (TIME.h + 2) % 24; P.energy = 100; P.hp = 100; walletUI(); f.classList.remove('on'); banner('RESTED', `It is ${clock()}. Energy full.`); complete('sleep'); }, 1200); } });
  flat([x + 4.8, 0, z - 3.6], { text: () => 'Shelf · your things', go: () => info('Your things', 'Flat 3B', rows([['Cash', '$' + save.cash], ['Fish in the cooler', String(save.fish.length)], ['Cards in the album', String(save.cards.length)], ['Golden tickets', save.tix.length + ' / 12'], ...SHOP.filter(s => has(s[0])).map(s => [s[1], 'owned'])]) + '<p><button class="btn ghost" id="alb">Open the album</button></p>') || setTimeout(() => { const b = $('alb'); if (b) b.onclick = album; }, 0) });
  flat([x + 1.2, 0, z - 3.6], { text: () => 'Wardrobe · what you wear', go: wardrobe });
}
// Yard Supply, at Curve Market: upgrades and clothes, and they buy fish
{
  const m = place('market');
  const R1 = makeRoom('supply', [900, 80], 16, 12, { color: 0x2a3a3c, light: 0xfff0d8 }, [m.at.x, 0, m.at.z + 1.5]);
  const [x, z] = [900, 80];
  box(8, 1.1, 1, wood, x, 0.55, z - 2, scene, true); solid(x, z - 2, 8, 1, 1.2);
  for (let i = 0; i < 4; i++) { box(2.4, 2.6, 0.6, M(0x4a4e54), x - 5.5 + i * 3.6, 1.3, z - 5.4, scene, true); solid(x - 5.5 + i * 3.6, z - 5.4, 2.4, 0.6, 2.6); for (let k = 0; k < 3; k++) box(2.2, 0.06, 0.5, wood, x - 5.5 + i * 3.6, 0.6 + k * 0.8, z - 5.2); }
  LATER.push(() => { const clerk = makePerson('male-b', { height: 1.7 }); clerk.g.position.set(x, 0, z - 3.2); clerk.play('interact-right', 0, 0.5); folk.push({ p: clerk, kind: 'stay', pos: clerk.g.position, yaw: 0, act: 'interact-right' }); });
  ACTS.push({ at: new THREE.Vector3(x, 0, z - 0.8), r: 2.2, when: () => true, text: () => 'Counter · upgrades, clothes, sell your catch', go: shop });
  ACTS.find(a => a.at === m.at).go = () => goTo(ROOMS.supply.inside.clone().add(new THREE.Vector3(0, 0, -1.8)), 'YARD SUPPLY', 0); ACTS.find(a => a.at === m.at).text = () => 'Curve Market · Yard Supply, step inside';
}
// The Signal, a cinema in Eastgate
{
  door(229.6, 10, Math.PI / 2, 'THE SIGNAL', 'CINEMA · NOW SHOWING', '#ff4d8a');
  makeRoom('cinema', [900, 160], 22, 18, { color: 0x1c1416, light: 0x6a4a5a }, [231.6, 0, 10], 'The Signal cinema');
  const [x, z] = [900, 160];
  screen('cinema', 14, 6, x, 3.6, z - 8.6, 0);
  for (let r = 0; r < 4; r++) for (let c = -4; c <= 4; c++) { if (c === 0) continue; box(1, 0.5, 0.9, red2, x + c * 1.4, 0.25 + r * 0.25, z - 1 + r * 2, scene, true); box(1, 0.8, 0.15, red2, x + c * 1.4, 0.7 + r * 0.25, z - 0.5 + r * 2); }
  LATER.push(() => { for (let i = 0; i < 9; i++) { const p = makePerson(NAMES_ALL[i % NAMES_ALL.length], { height: 1.6 }); p.g.position.set(x + (i % 2 ? -1 : 1) * (1.4 + (i % 4) * 1.4), 0.3 + Math.floor(i / 3) * 0.25, z - 1.2 + Math.floor(i / 3) * 2); p.g.rotation.y = Math.PI; p.play('sit', 0); folk.push({ p, kind: 'stay', pos: p.g.position, yaw: Math.PI, act: 'sit' }); } });
  ACTS.push({ at: new THREE.Vector3(x, 0, z + 5), r: 3, when: () => !MODE, text: () => 'Take a seat · tonight\'s film, $4', go: () => { if (!spend(4)) return; startFilm(); } });
}
// Booth 7, an arcade by the diner: Up or Down, played on the record
{
  door(229.6, -48, Math.PI / 2, 'BOOTH 7', 'ARCADE · OPEN LATE', '#c58bff');
  makeRoom('arcade', [900, 240], 16, 12, { color: 0x1a1430, light: 0xc58bff }, [231.6, 0, -48], 'Booth 7 arcade');
  const [x, z] = [900, 240];
  for (let i = 0; i < 5; i++) { const cx = x - 6 + i * 3; box(1.4, 2.2, 1, M(0x15171a), cx, 1.1, z - 4.8, scene, true); box(1.1, 0.8, 0.06, glow([0xc58bff, 0x2ed3a0, 0xff4d8a, 0xffb340, 0xa9d6ff][i], 1.8), cx, 1.6, z - 4.28); solid(cx, z - 4.8, 1.4, 1, 2.2); }
  ACTS.push({ at: new THREE.Vector3(x - 3, 0, z - 3.6), r: 2.2, when: () => true, text: () => 'UP OR DOWN · $1 a go', go: upOrDown });
  ACTS.push({ at: new THREE.Vector3(x + 3, 0, z - 3.6), r: 2.2, when: () => true, text: () => 'HOOP SHOT · $1 a go', go: () => { if (!spend(1)) return; hoops(true); } });
}

// ---------- the film ----------
function startFilm() {
  const c = screens.cinema.userData.canvas, x = c.getContext('2d'), W = c.width, H = c.height, seat = new THREE.Vector3(900, 2.1, 162), at = new THREE.Vector3(900, 3.4, 151.4);
  let t = 0; hero && (hero.g.visible = false); complete('film');
  MODE = { tick(dt) {
    t += dt; cam.position.lerp(seat, damp(dt, 3)); cam.lookAt(at); sky.position.copy(cam.position);
    x.fillStyle = '#05060a'; x.fillRect(0, 0, W, H);
    const k = t % 24, sc = Math.floor(k / 6), u = (k % 6) / 6;
    x.save(); x.globalAlpha = Math.min(1, u * 4, (1 - u) * 4);
    if (sc === 0) { x.fillStyle = '#2ed3a0'; x.font = '700 30px M'; x.fillText('NOW SHOWING', 60, 120); x.fillStyle = '#edebe6'; x.font = '900 150px D'; x.fillText('THE LINE.', 60, 300); }
    if (sc === 1) { for (let i = 0; i < 6; i++) { x.fillStyle = i % 2 ? '#23272d' : '#2a2d32'; x.fillRect(((u * 1.6 - 0.3) * W) - i * 150, 260, 140, 90); } x.fillStyle = '#fff'; x.fillRect((u * 1.6 - 0.3) * W + 120, 280, 18, 18); x.fillStyle = '#edebe6'; x.font = '900 60px D'; x.fillText('EVERY TOKEN RIDES THE LINE', 60, 160); }
    if (sc === 2) { x.strokeStyle = '#ff4d5e'; x.lineWidth = 6; x.beginPath(); for (let i = 0; i <= 40; i++) { const px = 60 + i * (W - 120) / 40, v = i < 24 ? i / 24 : 1 - (i - 24) / 6; x.lineTo(px, H - 80 - Math.max(0, v) * 240 * Math.min(1, u * 1.5)); } x.stroke(); x.fillStyle = '#edebe6'; x.font = '900 60px D'; x.fillText('THEY ALL LOOK CLEAN', 60, 120); x.fillText('THE HOUR BEFORE.', 60, 190); }
    if (sc === 3) { x.fillStyle = '#edebe6'; x.font = '900 90px D'; x.fillText('READ THE MANIFEST.', 60, 220); x.fillStyle = '#2ed3a0'; x.fillText('KEEP THE LINE CLEAN.', 60, 330); }
    x.restore(); screens.cinema.needsUpdate = true;
    if (act || t > 24) { act = false; MODE = null; hero && (hero.g.visible = true); P.energy = Math.min(100, P.energy + 15); banner('THE END', 'Energy +15'); }
  } };
}

// ---------- timing games: fishing, hoops, the counter, up or down ----------
function mini(title, text, extra = '') { MINI.on = true; $('mn-h').textContent = title; $('mn-t').innerHTML = text; $('mn-x').innerHTML = extra; $('mini').classList.add('on'); }
function miniEnd(delay = 1600) { setTimeout(() => { MINI.on = false; MINI.tick = null; $('mini').classList.remove('on'); }, delay); }
addEventListener('keydown', e => { if (!MINI.on || e.repeat) return; if (e.code === 'KeyE' || e.code === 'Space') { MINI.hit?.(); e.preventDefault(); e.stopImmediatePropagation(); } const k = +e.key; if (k && MINI.pick) { MINI.pick(k - 1); e.stopImmediatePropagation(); } if (e.code === 'Escape') { MINI.on = false; MINI.tick = null; $('mini').classList.remove('on'); } }, true);
$('mini').addEventListener('pointerdown', e => { if (e.target.closest('[data-p]')) MINI.pick?.(+e.target.closest('[data-p]').dataset.p); else MINI.hit?.(); e.stopPropagation(); });
const CATCH = [['Perch', 3, 30], ['Carp', 5, 25], ['Pike', 9, 12], ['Old boot', 0, 14], ['Tin can', 0, 12], ['Eel', 7, 5], ['Golden carp', 40, 2]];
function fish() {
  let t = 0, bite = 2 + Math.random() * 5, state = 'wait';
  doEmote('interact-right', 0.6); mini('FISHING', 'Line out. Wait for the bite, then press <kbd>E</kbd>.', '<div class="bob">~</div>');
  MINI.hit = () => {
    if (state === 'wait') { state = 'done'; mini('FISHING', 'Too soon. It got away.'); return miniEnd(); }
    if (state !== 'bite') return; state = 'done';
    let r = Math.random() * 100, c = CATCH[0]; for (const k of CATCH) { if ((r -= k[2]) < 0) { c = k; break; } }
    save.fish.push(c[0]); keep(); mini('FISHING', `<b>${c[0]}</b>${c[1] ? ` · sells for $${c[1]} at Yard Supply` : ' · not worth much'}`); sfx.good(); complete('fish'); if (c[0] === 'Golden carp') complete('golden'); miniEnd(2200);
  };
  MINI.tick = dt => { t += dt; if (state === 'wait' && t > bite) { state = 'bite'; mini('FISHING', '<b class="ok">BITE! Press E now</b>', '<div class="bob on">!</div>'); sfx.ui(); } if (state === 'bite' && t > bite + 0.9) { state = 'done'; mini('FISHING', 'Too slow. It slipped the hook.'); miniEnd(); } };
}
function sellFish() { const v = save.fish.reduce((s, n) => s + (CATCH.find(c => c[0] === n)?.[1] || 0), 0); if (!save.fish.length) return banner('NOTHING TO SELL', 'Go fishing at Liquidity Lake'); save.fish = []; keep(); pay(v, 'fish'); banner('SOLD', `Your catch for $${v}`); }
function hoops(paid) {
  let shot = 0, made = 0, t = 0, pos = 0;
  const draw = () => mini('HOOP SHOT', `Shot ${shot + 1} of 5 · made ${made}. Press <kbd>E</kbd> when the marker is in the green.`, `<div class="meter"><i></i><u style="left:${pos * 100}%"></u></div>`);
  draw();
  MINI.tick = dt => { t += dt * (1.4 + shot * 0.25); pos = 0.5 + 0.5 * Math.sin(t * 3); const u = $('mn-x').querySelector('u'); if (u) u.style.left = pos * 100 + '%'; };
  MINI.hit = () => {
    const ok = Math.abs(pos - 0.5) < 0.09; shot++; if (ok) { made++; sfx.coin(); } else sfx.bad(); doEmote('jump', 1.3);
    if (shot < 5) return draw();
    MINI.tick = null; const prize = made * 2 + (made === 5 ? 10 : 0); mini('HOOP SHOT', `${made} of 5${prize ? ` · $${prize}` : ''}`); if (prize) pay(prize, 'hoops'); if (made >= 3) complete('hoops'); miniEnd(2200);
  };
}
function counter() {
  const items = ['Coffee', 'Water', 'Sandwich']; let n = 0, good = 0, t = 0, want = 0;
  const order = () => { want = Math.floor(Math.random() * 3); t = 0; mini('THE KIOSK', `Order ${n + 1} of 8: <b>${items[want]}</b>`, `<div class="menu">${items.map((it, i) => `<button class="btn ghost" data-p="${i}"><span><kbd>${i + 1}</kbd> ${it}</span></button>`).join('')}</div><div class="meter t"><u style="width:100%"></u></div>`); };
  order();
  MINI.tick = dt => { t += dt; const u = $('mn-x').querySelector('.t u'); if (u) u.style.width = Math.max(0, 100 - t / 3.5 * 100) + '%'; if (t > 3.5) MINI.pick(-1); };
  MINI.pick = i => { if (i === want) { good++; sfx.coin(); } else sfx.bad(); n++; if (n < 8) return order(); MINI.tick = null; MINI.pick = null; const prize = good * 2 + (good === 8 ? 5 : 0); mini('THE KIOSK', `${good} of 8 right · $${prize}`); pay(prize, 'kiosk'); complete('counter'); miniEnd(2000); };
}
function upOrDown() {
  if (!TRAINS.length || !spend(1)) return;
  const d = TRAINS[Math.floor(Math.random() * TRAINS.length)], [m, when] = moveOf(d), stops = (d.stops || []).filter(t => !/^(CLEAN|RISKY|DANGER) \d+$/.test(t)).slice(0, 6);
  mini('UP OR DOWN', `<b>${esc(d.symbol)}</b> · pool ${d.liq ? money(d.liq) : '—'}<br><span class="cap">${stops.join(' · ') || 'no stops on file'}</span><br>Up or down ${when}?`, '<div class="menu"><button class="btn ghost" data-p="0"><span><kbd>1</kbd> UP</span></button><button class="btn ghost" data-p="1"><span><kbd>2</kbd> DOWN</span></button></div>');
  MINI.pick = i => { MINI.pick = null; const up = m >= 0, right = (i === 0) === up; mini('UP OR DOWN', `${pct(m)} ${when} · ${right ? '<b class="ok">RIGHT · $3</b>' : '<b class="bad">WRONG</b>'}`); if (right) pay(3, 'arcade'); complete('arcade'); miniEnd(2200); };
}
ACTS.push({ at: new THREE.Vector3(280, 0, 377), r: 3, when: () => !MINI.on, text: () => 'Liquidity Lake · cast a line', go: fish });
ACTS.push({ at: new THREE.Vector3(JUNCTION.x, 1, JUNCTION.z + 19.8), r: 1.8, when: () => !MINI.on, text: () => 'Kiosk · work the counter, $2 an order', go: counter });
{ const c = ACTS.find(a => a.at === place('court')?.at); if (c) { c.text = () => 'Westbank Court · take five shots, $2 a basket'; c.go = () => hoops(false); } }

// ---------- driving a train: a driver's job from the depot at the south end of Junction ----------
const DRIVE = { on: false };
const cabV = new THREE.Vector3(), lookV = new THREE.Vector3();
function startDrive() {
  if (G.on || RUN.on) return banner('THE LINE IS BUSY', 'Finish the shift first.');
  const siding = Math.random() < 0.4, tr = makeTrain(4, { title: 'YOUR TRAIN', stripe: 0x2ed3a0, body: 0x23272d });
  Object.assign(DRIVE, { on: true, tr, s: -300, v: 9, route: siding ? 'siding' : 'main', target: siding ? 48 : -46, still: 0, done: false });
  Object.assign(tr, { s: -300, v: 9 }); EXTRA_TRAINS.push(tr);
  if (siding) { levers.SIDING.target = -0.55; levers.RIDE.target = 0.55; sig.sid.emissiveIntensity = 6; sig.stop.emissiveIntensity = 0.1; }
  hero && (hero.g.visible = false); $('drive').classList.add('on');
  banner('YOU HAVE THE TRAIN', siding ? 'Bring it into the siding and stop before the buffer' : 'Stop it at Junction platform 1, by the end marker');
  MODE = { tick: driveTick };
}
function placeTrain(tr, route, s) { tr.cars.forEach((c, i) => { const p = along(route, s - i * CAR); c.position.set(p.x, 0, p.z); c.rotation.set(0, p.yaw, 0); }); }
function driveTick(dt) {
  const D = DRIVE, power = keys.KeyW || keys.ArrowUp || (joy && joy.dy < -0.4), brake = keys.KeyS || keys.ArrowDown || keys.Space || (joy && joy.dy > 0.4);
  D.v = clamp(D.v + ((power ? 2.4 : 0) - (brake ? 5 : 0) - 0.12) * dt, 0, 26); D.s += D.v * dt; D.tr.s = D.s; D.tr.v = D.v; placeTrain(D.tr, D.route, D.s); spinWheels(D.tr, D.v, dt);
  const head = along(D.route, D.s), ahead = along(D.route, D.s + 40); cabV.set(head.x, 4.1, head.z + 2.6); lookV.set(ahead.x, 2, ahead.z);
  cam.position.lerp(cabV, damp(dt, 10)); cam.lookAt(lookV); sky.position.copy(cam.position);
  const err = D.s - D.target; $('dv-v').textContent = Math.round(D.v * 3.6); $('dv-d').textContent = err < 0 ? Math.round(-err) + ' M TO GO' : Math.round(err) + ' M PAST';
  $('dv-d').className = Math.abs(err) <= 3 ? 'ok' : err > 3 ? 'bad' : '';
  if (D.v < 0.05) D.still += dt; else D.still = 0;
  const end = (ok, title, msg, prize) => { D.on = false; MODE = null; $('drive').classList.remove('on'); hero && (hero.g.visible = true); banner(title, msg); if (prize) { pay(prize, 'driving'); complete('driver'); if (D.route === 'siding') complete('siding'); } else sfx.bad();
    P.pos.set(D.route === 'siding' ? -4 : 3, D.route === 'siding' ? 0 : 1, D.route === 'siding' ? 40 : -50); look.yaw = Math.PI; setTimeout(() => { scene.remove(D.tr.g); EXTRA_TRAINS.splice(EXTRA_TRAINS.indexOf(D.tr), 1); setLever(null); }, 4000); };
  if (D.route === 'siding' && D.s > 60) { shake = 0.8; sfx.crash(); return end(false, 'HIT THE BUFFER', 'Too fast into the siding. No pay.'); }
  if (err > 8) return end(false, 'OVERRAN', 'You ran past the stop. No pay.');
  if (D.still > 1 && Math.abs(err) <= 3) { const prize = Math.max(20, Math.round(45 - 8 * Math.abs(err))); sfx.good(); return end(true, 'PERFECT STOP', `${Math.abs(err).toFixed(1)} m off the mark · $${prize}`, prize); }
  if (D.still > 2.5 && err < -3) $('dv-h').textContent = 'Too short. Ease on the power (W).'; else $('dv-h').textContent = 'W power · S or SPACE brake';
}
ACTS.push({ at: new THREE.Vector3(JUNCTION.x, 1, JUNCTION.z - 24), r: 2.4, when: () => !DRIVE.on && !G.on, text: () => 'Drivers\' depot · drive the next train in', go: startDrive });
{ const s = label(['DRIVERS\' DEPOT', 'TAKE A TRAIN IN'], { size: 34, accent: '#2ed3a0', scale: 0.012 }); s.position.set(JUNCTION.x, 3.6, JUNCTION.z - 24); scene.add(s); }

// ---------- a runaway: no driver, full speed, and only the siding can stop it ----------
const RUN = { on: false };
function startRunaway() {
  const tr = makeTrain(5, { title: 'RUNAWAY', stripe: 0xff3b4e, body: 0x3a1e22 });
  Object.assign(tr, { s: -360, v: 25, route: null, end: null, wreck: 0, lever: null }); Object.assign(RUN, { on: true, tr, told: false }); EXTRA_TRAINS.push(tr); setLever(null);
  banner('RUNAWAY ON THE MAIN LINE', 'Run to the lever frame and pull SIDING before it reaches the junction'); sfx.horn(1);
}
function runawayTick(dt) {
  const tr = RUN.tr;
  if (!tr.route && tr.s >= -1) { const sid = levers.SIDING.target < 0; tr.route = sid ? 'siding' : 'main'; tr.end = { fell: !sid, rose: false }; if (sid) { pay(60, 'runaway'); addXp(120); banner('INTO THE SIDING', 'You saved the yard · $60'); complete('runaway'); } else banner('IT TORE THROUGH THE YARD', 'Next time, pull SIDING sooner'); }
  if (runTrain(tr, dt) || (tr.route === 'siding' && tr.v < 0.1) || (tr.wreck >= 1 && tr.v <= 0)) { setTimeout(() => { scene.remove(tr.g); EXTRA_TRAINS.splice(EXTRA_TRAINS.indexOf(tr), 1); setLever(null); }, 6000); RUN.on = false; }
}
ACTS[1].when = () => (G.on && G.train && !G.train.route) || (RUN.on && !RUN.tr.route); ACTS[1].text = () => (G.train?.lever ?? (levers.RIDE.target < 0 ? 'RIDE' : null)) === 'RIDE' ? 'Lever is on RIDE' : 'Pull RIDE · let it ride the line';
ACTS[2].when = () => (G.on && G.train && !G.train.route) || (RUN.on && !RUN.tr.route); ACTS[2].text = () => (G.train?.lever ?? (levers.SIDING.target < 0 ? 'SIDING' : null)) === 'SIDING' ? 'Lever is on SIDING' : 'Pull SIDING · send it off the line';

// ---------- the taxi rank by Central Station ----------
const TAXI = { on: false, car: makeCar(0xe6b450, 'taxi'), pos: new THREE.Vector3(62, 0, 84), yaw: 0, v: 0, fare: null };
TAXI.car.g.position.copy(TAXI.pos); solid(62, 84, 2.2, 4.6, 1.6);
{ const s = label(['TAXI RANK', 'DRIVE FOR FARES'], { size: 34, accent: '#e6b450', scale: 0.012 }); s.position.set(62, 3.4, 87.5); scene.add(s); }
function startTaxi() {
  Object.assign(TAXI, { on: true, v: 0, yaw: 0, fares: 0 }); TAXI.pos.set(62, 0, 84); hero && (hero.g.visible = false); newFare(); $('drive').classList.add('on'); $('dv-h').textContent = 'WASD drive · E to leave the cab';
  banner('ON DUTY', 'Pick up the fare at the green marker'); MODE = { tick: taxiTick };
}
function newFare() { const opts = DROPS.filter(d => Math.hypot(d.x - TAXI.pos.x, d.z - TAXI.pos.z) > 70); const from = opts[Math.floor(Math.random() * opts.length)]; TAXI.fare = { stage: 'pickup', from, to: null, t: 0 }; }
const tfw = new THREE.Vector3();
function taxiTick(dt) {
  const T = TAXI, up = keys.KeyW || keys.ArrowUp || (joy && joy.dy < -0.3), dn = keys.KeyS || keys.ArrowDown || (joy && joy.dy > 0.3), lt = keys.KeyA || keys.ArrowLeft || (joy && joy.dx < -0.3), rt = keys.KeyD || keys.ArrowRight || (joy && joy.dx > 0.3);
  T.v += ((up ? 7 : 0) - (dn ? (T.v > 0 ? 12 : 4) : 0)) * dt; T.v *= 1 - dt * 0.35; T.v = clamp(T.v, -5, 22);
  T.yaw += ((lt ? 1 : 0) - (rt ? 1 : 0)) * dt * 1.9 * clamp(Math.abs(T.v) / 6, 0, 1) * Math.sign(T.v || 1);
  tfw.set(Math.sin(T.yaw), 0, Math.cos(T.yaw)); const nx = T.pos.x + tfw.x * T.v * dt, nz = T.pos.z + tfw.z * T.v * dt;
  if (near(nx, nz, 3).some(b => b.h > 0.5 && nx > b.x0 - 1.1 && nx < b.x1 + 1.1 && nz > b.z0 - 1.1 && nz < b.z1 + 1.1 && !(Math.abs(b.x0 - 61) < 0.6 && Math.abs(b.z0 - 81.7) < 0.6))) { if (Math.abs(T.v) > 4) { sfx.hit(); shake = 0.2; } T.v *= -0.3; } else T.pos.set(nx, 0, nz);
  T.car.g.position.copy(T.pos); T.car.g.rotation.y = T.yaw; for (const w of T.car.wheels) w.rotation.x += T.v * dt / T.car.wr; P.pos.copy(T.pos);
  cabV.set(T.pos.x - tfw.x * 9, 4.2, T.pos.z - tfw.z * 9); lookV.set(T.pos.x + tfw.x * 6, 1.2, T.pos.z + tfw.z * 6); cam.position.lerp(cabV, damp(dt, 6)); cam.lookAt(lookV); sky.position.copy(cam.position);
  $('dv-v').textContent = Math.round(Math.abs(T.v) * 3.6);
  const F = T.fare; F.t += dt; const goal = F.stage === 'pickup' ? F.from : F.to, gd = Math.hypot(goal.at.x - T.pos.x, goal.at.z - T.pos.z);
  $('dv-d').textContent = `${F.stage === 'pickup' ? 'PICK UP' : 'DROP OFF'} · ${goal.name.toUpperCase()} · ${Math.round(gd)} M`; $('dv-d').className = '';
  if (gd < 9 && Math.abs(T.v) < 1.5) {
    if (F.stage === 'pickup') { const opts = DROPS.filter(d => d !== F.from && Math.hypot(d.x - F.from.x, d.z - F.from.z) > 90); F.to = opts[Math.floor(Math.random() * opts.length)]; F.stage = 'drop'; F.t = 0; F.far = Math.hypot(F.to.x - F.from.x, F.to.z - F.from.z); sfx.door(); banner('FARE ON BOARD', `To ${F.to.name}`); }
    else { const fareN = Math.round(8 + F.far / 14), tip = F.t < F.far / 9 ? Math.round(fareN * 0.4) : 0; pay(fareN + tip, 'fare'); save.fares = (save.fares || 0) + 1; keep(); banner('FARE PAID', `$${fareN}${tip ? ` + $${tip} tip` : ''}`); complete('taxi'); newFare(); }
  }
  if (act) { act = false; if (Math.abs(T.v) < 1) { T.on = false; MODE = null; $('drive').classList.remove('on'); hero && (hero.g.visible = true); P.pos.set(T.pos.x + Math.cos(T.yaw) * 2, 0, T.pos.z - Math.sin(T.yaw) * 2); TAXI.pos.set(62, 0, 84); TAXI.yaw = 0; T.car.g.position.copy(TAXI.pos); T.car.g.rotation.y = 0; banner('OFF DUTY', 'The cab went back to the rank'); } }
}
ACTS.push({ at: new THREE.Vector3(64.2, 0, 84), r: 2.6, when: () => !MODE, text: () => 'Taxi rank · drive a cab for fares', go: startTaxi });

// ---------- events: something happens in town every few minutes ----------
const EVT = { next: 120, cur: null };
const fireM = new THREE.SpriteMaterial({ map: haloTex, color: 0xff7a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
function startEvent(force) {
  if (!townReady) return;
  const kinds = ['breakdown', 'fire', 'thief']; if (!G.on && !DRIVE.on && !RUN.on) kinds.push('runaway');
  const k = force || kinds[Math.floor(Math.random() * kinds.length)];
  if (k === 'runaway') { startRunaway(); EVT.cur = { k, title: 'Runaway', text: 'Pull SIDING at the lever frame before the runaway reaches the junction.', at: () => leverSpot, done: () => !RUN.on }; return; }
  if (k === 'breakdown') {
    const a = ambient.find(a => a.stop == null && !a.broken && Math.abs(a.s) < 450); if (!a) return;
    a.broken = true; EVT.cur = { k, a, prog: 0, title: 'Train failure', text: `A train has broken down on track ${Math.abs(a.x)}. Get to the locomotive and hold E to fix it.`, at: () => new THREE.Vector3(a.x + 2.2, 0, a.s), t: 0 };
    banner('TRAIN FAILURE', `Track ${Math.abs(a.x)} · hold E at the locomotive`); return;
  }
  // somewhere on the streets 50 to 110 m from you
  let x = 0, z = 0; for (let i = 0; i < 20; i++) { const ang = Math.random() * 6.28, r = 50 + Math.random() * 60; x = P.pos.x + Math.cos(ang) * r; z = P.pos.z + Math.sin(ang) * r; if (Math.abs(x) > 48 && Math.abs(x) < 400 && Math.abs(z) < 290 && !near(x, z, 1).some(b => x > b.x0 - 1 && x < b.x1 + 1 && z > b.z0 - 1 && z < b.z1 + 1)) break; }
  if (k === 'fire') {
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g); const L = new THREE.PointLight(0xff6a2a, 60, 22, 1.6); L.position.y = 2; g.add(L);
    const fl = []; for (let i = 0; i < 12; i++) { const s = new THREE.Sprite(fireM); g.add(s); fl.push(s); }
    EVT.cur = { k, g, fl, L, prog: 0, t: 0, title: 'Fire', text: 'A fire on the street. Get there and hold E to put it out before it spreads.', at: () => g.position };
    banner('FIRE', 'Hold E next to it to put it out'); return;
  }
  // a thief: grabs a wallet and runs
  const p = makePerson('male-d', { height: 1.75, tint: new THREE.Color(0.35, 0.35, 0.45) }); p.play('sprint', 0, 0.9);
  const tag = label('THIEF', { size: 40, accent: '#ff4d5e', scale: 0.012, color: '#ff8a94' }); tag.position.y = 2.3; p.g.add(tag);
  EVT.cur = { k: 'thief', p, pos: new THREE.Vector3(x, 0, z), t: 0, dir: Math.random() * 6.28, title: 'Stop, thief!', text: 'Someone just snatched a wallet. Chase the THIEF down and catch him.', at: () => EVT.cur.pos };
  banner('STOP, THIEF!', 'Catch him before he gets away');
}
function eventTick(dt, t) {
  const E = EVT.cur;
  if (!E) { EVT.next -= dt; if (EVT.next <= 0) { EVT.next = 150 + Math.random() * 150; if (!MODE) startEvent(); } return; }
  const hold = keys.KeyE || (TOUCH && act), d = E.at ? Math.hypot(E.at().x - P.pos.x, E.at().z - P.pos.z) : 1e9;
  if (E.k === 'runaway') { runawayTick(dt); if (E.done()) EVT.cur = null; return; }
  E.t = (E.t || 0) + dt;
  if (E.k === 'breakdown') {
    if (d < 5) { if (hold) E.prog += dt * (TOUCH ? 3 : 1); $('prompt').innerHTML = `<kbd>${TOUCH ? 'ACT' : 'E'}</kbd>Hold to fix · ${Math.round(Math.min(1, E.prog / 3) * 100)}%`; $('prompt').classList.add('on'); lastPrompt = '_'; if (hold && Math.random() < 0.2) sparks(E.a.cars[0]); }
    if (E.prog >= 3) { E.a.broken = false; pay(25, 'repair'); addXp(40); banner('BACK IN SERVICE', `Track ${Math.abs(E.a.x)} is running again · $25`); complete('repair'); EVT.cur = null; }
    else if (E.t > 180) { E.a.broken = false; banner('FIXED BY THE DEPOT', 'Someone else got there first'); EVT.cur = null; }
  }
  if (E.k === 'fire') {
    E.fl.forEach((s, i) => { const k = (t * 1.6 + i / 12) % 1; s.position.set(Math.sin(i * 2.1) * 1.2 * (1 - k), k * 4, Math.cos(i * 1.7) * 1.2 * (1 - k)); s.scale.setScalar((2.4 - k * 1.6) * (1 - E.prog / 4 * 0.8)); });
    E.L.intensity = (50 + Math.sin(t * 20) * 15) * (1 - E.prog / 4); if (Math.random() < 0.15) puff(E.g.position.x, 4, E.g.position.z, 0x3a3a3e, 7, 3, 0.4);
    if (d < 4) { if (hold) E.prog += dt * (TOUCH ? 3 : 1); $('prompt').innerHTML = `<kbd>${TOUCH ? 'ACT' : 'E'}</kbd>Hold to put it out · ${Math.round(Math.min(1, E.prog / 4) * 100)}%`; $('prompt').classList.add('on'); lastPrompt = '_'; }
    if (E.prog >= 4) { scene.remove(E.g); pay(20, 'fire'); addXp(40); banner('FIRE OUT', '$20 from the city'); complete('fire'); EVT.cur = null; }
    else if (E.t > 150) { scene.remove(E.g); banner('THE FIRE BURNED OUT', 'Nobody hurt. Next time.'); EVT.cur = null; }
  }
  if (E.k === 'thief') {
    const dx = E.pos.x - P.pos.x, dz = E.pos.z - P.pos.z, dd = Math.hypot(dx, dz);
    if (dd < 30) E.dir = Math.atan2(dx, dz) + Math.sin(t * 0.7) * 0.5; else E.dir += (Math.random() - 0.5) * dt;
    const v = dd < 30 ? 6.6 : 2.5, nx = E.pos.x + Math.sin(E.dir) * v * dt, nz = E.pos.z + Math.cos(E.dir) * v * dt;
    if (near(nx, nz, 1).some(b => nx > b.x0 - 0.5 && nx < b.x1 + 0.5 && nz > b.z0 - 0.5 && nz < b.z1 + 0.5)) E.dir += 1.6 + Math.random(); else E.pos.set(nx, 0, nz);
    E.p.g.position.copy(E.pos); E.p.g.rotation.y = E.dir; E.p.mixer.update(dt);
    if (dd < 1.4) { scene.remove(E.p.g); pay(15, 'reward'); addXp(50); banner('CAUGHT HIM', 'The wallet goes back · $15 reward'); complete('thief'); EVT.cur = null; }
    else if (E.t > 60) { scene.remove(E.p.g); banner('HE GOT AWAY', 'Faster next time'); EVT.cur = null; }
  }
}
// nights with something on: a festival at Curve Market, match night at the stadium, and every seventh night the RUG PULL
const NIGHT = { dancers: [], boss: false, prevH: TIME.h };
function nightTick(dt) {
  if (NIGHT.prevH < 6 && TIME.h >= 6) { save.day++; keep(); NIGHT.boss = false; } NIGHT.prevH = TIME.h;
  const h = TIME.h, evening = h >= 19.5 || h < 2;
  const fest = save.day % 3 === 0 && evening, match = save.day % 2 === 1 && h >= 18 && h < 23;
  if (fest && !NIGHT.dancers.length && townReady) { const m = place('market'); for (let i = 0; i < 18; i++) { const p = makePerson(NAMES_ALL[i % NAMES_ALL.length], { height: 1.6 + Math.random() * 0.25 }); p.g.position.set(m.x - 14 + Math.random() * 28, 0, m.z - 12 + Math.random() * 24); p.g.rotation.y = Math.random() * 6; p.play(i % 3 ? 'emote-yes' : 'jump', 0, 0.8 + Math.random() * 0.5); NIGHT.dancers.push(p); } banner('FESTIVAL NIGHT', 'Lanterns and music at Curve Market'); }
  if (!fest && NIGHT.dancers.length) { NIGHT.dancers.forEach(p => scene.remove(p.g)); NIGHT.dancers = []; }
  for (const p of NIGHT.dancers) if (Math.hypot(p.g.position.x - P.pos.x, p.g.position.z - P.pos.z) < 70) p.mixer.update(dt);
  if (fest && dist(place('market')) < 30) complete('festival');
  if (match && dist(place('stadium')) < 160) { NIGHT.cheer = (NIGHT.cheer || 0) - dt; if (NIGHT.cheer <= 0) { NIGHT.cheer = 6 + Math.random() * 8; sfx.cheer?.(clamp(1 - dist(place('stadium')) / 160, 0.2, 1)); } if (CRANE.crowd) CRANE.crowd.position.y = Math.abs(Math.sin(performance.now() / 300)) * 0.25; if (dist(place('stadium')) < 60) complete('matchnight'); }
  if (save.day % 7 === 0 && (h >= 23 || h < 4) && !NIGHT.boss && townReady) { NIGHT.boss = true; const c = place('crash'); spawnZombie(c.x, c.z + 6, 'RUG PULL'); banner('THE RUG PULL HAS COME', 'Something huge walked out of the Crash Site'); sfx.horn(0.6); }
}
// weather beyond rain: morning fog on some days, thunder in a heavy storm
let flash = 0, thunderT = 8;
function skyTick(dt) {
  const fogDay = (save.day * 7919) % 3 === 0, mk = TIME.h > 5 && TIME.h < 9 ? Math.sin((TIME.h - 5) / 4 * Math.PI) : 0;
  if (fogDay && mk > 0) scene.fog.density *= 1 + 2.2 * mk;
  if (ENV.rain > 0.75) { thunderT -= dt; if (thunderT <= 0) { thunderT = 8 + Math.random() * 14; flash = 0.25; setTimeout(() => sfx.thunder?.(), 300 + Math.random() * 1500); } }
  if (flash > 0) { flash -= dt; R.toneMappingExposure += flash * 10; }
}

// ---------- animals: cats you can pet, a dog that follows you if you feed it ----------
const PETS = [];
function animal(kind, x, y, z, col) {
  const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g); const m = M(col, { roughness: 0.9 }), big = kind === 'dog' ? 1.6 : 1;
  box(0.22 * big, 0.2 * big, 0.5 * big, m, 0, 0.28 * big, 0, g); const head = box(0.2 * big, 0.18 * big, 0.2 * big, m, 0, 0.42 * big, 0.3 * big, g);
  for (const s of [-1, 1]) { box(0.05 * big, 0.08 * big, 0.04 * big, m, s * 0.06 * big, 0.54 * big, 0.3 * big, g); for (const zz of [-0.18, 0.18]) box(0.06 * big, 0.2 * big, 0.06 * big, m, s * 0.07 * big, 0.1 * big, zz * big, g); }
  const tail = box(0.04 * big, 0.04 * big, 0.3 * big, m, 0, 0.36 * big, -0.36 * big, g); tail.rotation.x = 0.6;
  const a = { kind, g, head, tail, home: new THREE.Vector3(x, y, z), t: Math.random() * 6, yaw: Math.random() * 6 }; PETS.push(a); return a;
}
[[262, 0, 38, 0x2a2a2a], [-150, 0, -40, 0xd8a060], [48, 0, -60, 0xedebe6], [300, 0, 374, 0x6a6a6a], [52, 0, 118, 0xc96a2a], [-70, 0, 64, 0x3a3a3a]].forEach(([x, y, z, c]) => animal('cat', x, y, z, c));
const DOG = animal('dog', -126, 0, -10, 0x8a6a4a); DOG.follow = !!save.dog;
function petsTick(dt, t) {
  for (const a of PETS) {
    a.t += dt;
    if (a === DOG && DOG.follow) { const tx = P.pos.x - Math.sin(P.yaw) * 1.8, tz = P.pos.z - Math.cos(P.yaw) * 1.8, dx = tx - a.g.position.x, dz = tz - a.g.position.z, d = Math.hypot(dx, dz); if (d > 0.4) { const v = Math.min(d * 2, 10); a.g.position.x += dx / d * v * dt; a.g.position.z += dz / d * v * dt; a.yaw = Math.atan2(dx, dz); } a.g.position.y = floorAt(a.g.position.x, a.g.position.z); a.tail.rotation.y = Math.sin(t * 14) * 0.5; if (d > 60) a.g.position.set(tx, 0, tz); }
    else { a.head.rotation.x = Math.sin(a.t * 0.8) * 0.15; a.tail.rotation.y = Math.sin(a.t * 2) * 0.4; if (a.kind === 'cat' && (a.t % 9) < 0.02) a.yaw += (Math.random() - 0.5) * 2; }
    a.g.rotation.y = a.yaw;
  }
}
for (const a of PETS) ACTS.push({ at: a.g.position, r: 1.8, when: () => a !== DOG || !DOG.follow, text: () => a === DOG ? 'A stray dog · give it a snack, $2' : 'A cat · pet it', go: () => { if (a === DOG) { if (!spend(2)) return; DOG.follow = true; save.dog = true; keep(); banner('NEW FRIEND', 'The dog follows you now'); complete('dog'); } else { a.head.rotation.x = -0.4; P.energy = Math.min(100, P.energy + 3); save.pets = (save.pets || 0) + 1; keep(); sfx.purr?.(); banner('PURR', 'Energy +3'); if (save.pets >= 3) complete('cats'); } } });

// ---------- clothes: hats and gear on top of the hi-vis ----------
const WEAR = [['cap', 'Conductor cap', 20], ['beanie', 'Beanie', 10], ['bucket', 'Bucket hat', 15], ['backpack', 'Backpack', 25], ['scarf', 'Scarf', 12]];
const gear = {};
{
  const g = (geo, c, y, z) => { const m = new THREE.Mesh(geo, M(c, { roughness: 0.7 })); m.position.set(0, y, z); return m; };
  const cap = new THREE.Group(); cap.add(g(new THREE.CylinderGeometry(0.27, 0.27, 0.14, 16), 0x1c2a4a, 0.07, 0)); cap.add(g(new THREE.BoxGeometry(0.3, 0.03, 0.18), 0x111214, 0, 0.24)); cap.add(g(new THREE.BoxGeometry(0.1, 0.06, 0.02), 0xe6b450, 0.08, 0.27)); gear.cap = cap;
  const bean = new THREE.Group(); bean.add(g(new THREE.SphereGeometry(0.27, 14, 10, 0, 6.3, 0, 1.6), 0xa3262f, 0, 0)); gear.beanie = bean;
  const buck = new THREE.Group(); buck.add(g(new THREE.CylinderGeometry(0.22, 0.26, 0.16, 14), 0x6a7a4a, 0.07, 0)); buck.add(g(new THREE.CylinderGeometry(0.38, 0.38, 0.03, 18), 0x6a7a4a, 0, 0)); gear.bucket = buck;
  gear.backpack = g(new THREE.BoxGeometry(0.42, 0.5, 0.2), 0x2e5a8a, 1.15, -0.3); gear.scarf = g(new THREE.TorusGeometry(0.2, 0.06, 6, 14), 0xffb340, 1.5, 0); gear.scarf.rotation.x = Math.PI / 2;
  for (const k of ['cap', 'beanie', 'bucket']) { gear[k].visible = false; scene.add(gear[k]); }
  for (const k of ['backpack', 'scarf']) { gear[k].visible = false; hero?.g.add(gear[k]); }
}
const headBone = hero?.root.getObjectByName('head'), hbv = new THREE.Vector3();
function wearTick() {
  const hat = ['cap', 'beanie', 'bucket'].find(k => save.worn?.includes?.(k));
  for (const k of ['cap', 'beanie', 'bucket']) gear[k].visible = k === hat && hero?.g.visible;
  if (hat && headBone) { headBone.getWorldPosition(hbv); gear[hat].position.set(hbv.x, hbv.y + 0.42, hbv.z); gear[hat].rotation.y = hero.g.rotation.y; }
  gear.backpack.visible = !!save.worn?.includes?.('backpack'); gear.scarf.visible = !!save.worn?.includes?.('scarf');
}
if (!Array.isArray(save.worn)) save.worn = [];
function wardrobe() {
  const own = WEAR.filter(w => save.wear.includes(w[0]));
  info('Wardrobe', 'Flat 3B', own.length ? `<div class="menu">${own.map(w => `<button class="btn ghost" data-w="${w[0]}"><span>${w[1]}</span><b>${save.worn.includes(w[0]) ? 'ON' : 'OFF'}</b></button>`).join('')}</div>` : '<p>Nothing here yet. Yard Supply sells clothes.</p>');
  $('in-b').querySelectorAll('[data-w]').forEach(b => b.onclick = () => { const k = b.dataset.w, hats = ['cap', 'beanie', 'bucket']; if (save.worn.includes(k)) save.worn = save.worn.filter(x => x !== k); else { if (hats.includes(k)) save.worn = save.worn.filter(x => !hats.includes(x)); save.worn.push(k); } keep(); wardrobe(); });
}
// the shop gains a clothes rail and a fish buyer
{
  const base = shop;
  shop = function () {
    base();
    $('in-b').insertAdjacentHTML('beforeend', `<div class="cap" style="margin-top:14px">Clothes</div><div class="menu">${WEAR.map(w => `<button class="btn ghost" data-wear="${w[0]}" ${save.wear.includes(w[0]) ? 'disabled' : ''}><span>${w[1]}</span><b>${save.wear.includes(w[0]) ? 'OWNED' : '$' + w[2]}</b></button>`).join('')}</div><p><button class="btn ghost" id="sellfish">Sell your catch (${save.fish.length} fish)</button></p>`);
    $('in-b').querySelectorAll('[data-wear]').forEach(b => b.onclick = () => { const w = WEAR.find(x => x[0] === b.dataset.wear); if (save.wear.includes(w[0]) || !spend(w[2])) return; save.wear.push(w[0]); const hats = ['cap', 'beanie', 'bucket']; if (hats.includes(w[0])) save.worn = save.worn.filter(x => !hats.includes(x)); save.worn.push(w[0]); keep(); banner('NEW LOOK', w[1]); complete('style'); shop(); });
    $('sellfish').onclick = () => { sellFish(); shop(); };
  };
}

// ---------- The Armory, Westbank: everything for the RISKY, from a knife to a shotgun ----------
{
  door(-77.2, 40, Math.PI / 2, 'THE ARMORY', 'FOR THE RISKY ONLY', '#ff4d5e');
  makeRoom('armory', [900, 320], 16, 12, { color: 0x2a1c1c, light: 0xffc890 }, [-75.4, 0, 40], 'The Armory');
  const [x, z] = [900, 320];
  box(9, 1.1, 1, M(0x3a3e45, { metalness: 0.5, roughness: 0.4 }), x, 0.55, z - 2, scene, true); solid(x, z - 2, 9, 1, 1.2);
  box(12, 3, 0.3, M(0x4a3a2a, { roughness: 0.8 }), x, 2.2, z - 5.7, scene, true);
  Object.entries(WEAPONS).filter(([k]) => k !== 'fists').forEach(([k, w], i) => { const len = w.gun ? (k === 'shotgun' ? 1.1 : 0.4) : w.len; box(len, 0.08, 0.08, M(w.col, { metalness: 0.6, roughness: 0.35 }), x - 4.5 + (i % 3) * 4.5, 1.6 + Math.floor(i / 3) * 1, z - 5.5); });
  LATER.push(() => { const c = makePerson('male-f', { height: 1.75 }); c.g.position.set(x, 0, z - 3.2); c.play('idle', 0); folk.push({ p: c, kind: 'stay', pos: c.g.position, yaw: 0, act: 'idle' }); });
  ACTS.push({ at: new THREE.Vector3(x, 0, z - 0.8), r: 2.4, when: () => true, text: () => 'Armory counter · weapons and ammo', go: armory });
}
function armory() {
  const rowsW = Object.entries(WEAPONS).filter(([k]) => k !== 'fists').map(([k, w]) => { const own = owned().includes(k); return `<button class="btn ghost" data-arm="${k}"><span>${w.name}<small>${w.gun ? `ranged, ${w.range} m, ${w.dmg} damage` : `melee, ${w.reach} m reach, ${w.dmg} damage`}</small></span><b>${own ? (save.wield === k ? 'IN HAND' : 'HOLD') : '$' + w.price}</b></button>`; }).join('');
  const rowsA = Object.entries(AMMO).map(([k, a]) => `<button class="btn ghost" data-ammo="${k}" ${owned().includes(k) ? '' : 'disabled'}><span>${a[0]} ×${a[1]}<small>you have ${save.ammo[k]}</small></span><b>$${a[2]}</b></button>`).join('');
  info('The Armory', 'Westbank · for the RISKY only', `<p>Cash: <b>$${save.cash}</b> · in hand: <b>${WEAPONS[save.wield].name}</b></p><div class="menu">${rowsW}</div><div class="cap" style="margin-top:12px">Ammunition</div><div class="menu">${rowsA}</div><p class="pm">Weapons only work on the RISKY, the RUG and the RUG PULL. Q switches what you hold, F uses it.</p>`);
  $('in-b').querySelectorAll('[data-arm]').forEach(b => b.onclick = () => { const k = b.dataset.arm, w = WEAPONS[k]; if (!owned().includes(k)) { if (!spend(w.price)) return; save.arms.push(k); if (w.gun) save.ammo[w.ammo] += AMMO[w.ammo][1]; banner('BOUGHT', w.name + (w.gun ? ` with ${AMMO[w.ammo][1]} rounds` : '')); complete('armed'); if (w.gun) complete('gun'); } save.wield = k; keep(); heldMesh(); weaponUI(); armory(); });
  $('in-b').querySelectorAll('[data-ammo]').forEach(b => b.onclick = () => { const k = b.dataset.ammo, a = AMMO[k]; if (!spend(a[2])) return; save.ammo[k] += a[1]; keep(); weaponUI(); armory(); });
}
MISSIONS.push(
  { id: 'armed', title: 'Armed', text: 'Buy a weapon at The Armory in Westbank. They only work on the RISKY.', where: () => new THREE.Vector3(-75.4, 0, 40), xp: 40 },
  { id: 'gun', title: 'Sidearm', text: 'Buy the pistol or the shotgun at The Armory.', where: () => new THREE.Vector3(-75.4, 0, 40), xp: 60 },
  { id: 'twenty', title: 'Night shift', text: 'Stop twenty RISKY in total.', where: () => at('crash'), xp: 150, auto: () => (save.kills || 0) >= 20 },
);
weaponUI();
// ---------- every building has a door. Behind it: a room that fits what the sign says ----------
// The rooms stand out past the city (x ≥ 1000); a door remembers where you came in, and the exit takes you back.
MENUS.PIZZA = [['Slice', 4, 30], ['Whole pie', 10, 70], ['Cola', 2, 12]]; MENUS.BAKERY = [['Croissant', 3, 18], ['Sourdough', 4, 24], ['Coffee', 3, 25, 'boost']];
MENUS.RAMEN = [['Ramen', 7, 55], ['Gyoza', 4, 25], ['Green tea', 2, 12]];
const KIND = t => /NOODLES|RAMEN|PIZZA|BAKERY/.test(t) ? 'eat' : /GYM/.test(t) ? 'gym' : /KARAOKE/.test(t) ? 'karaoke' : /HOTEL|24H/.test(t) ? 'hotel' : /PHARMACY/.test(t) ? 'pharmacy' : /CINEMA/.test(t) ? 'cinema' : /ARCADE/.test(t) ? 'arcade' : 'shop';
const TPL = {}, ENTER = { back: null, name: '', menu: null };
function tplRoom(id, z, w, d, color, light, decorate) {
  const x = 1000, r = room({ x, z, w, d, h: 5, door: 's', color, light });
  const inside = new THREE.Vector3(x, 0, z + d / 2 - 2);
  screen('tpl-' + id, 6, 1.6, x, 3.8, z - d / 2 + 0.25, 0);
  ACTS.push({ at: inside, r: 2, when: () => true, text: () => `Leave ${ENTER.name || ''} · back to the street`, go: () => goTo(ENTER.back || new THREE.Vector3(180, 0, -3), '') });
  decorate(x, z);
  TPL[id] = { inside, x, z };
}
const shelf = (x, z, n, col) => { for (let i = 0; i < n; i++) { box(2.2, 2.2, 0.6, M(0x3a3e45, { metalness: 0.4 }), x + i * 2.6, 1.1, z, scene, true); solid(x + i * 2.6, z, 2.2, 0.6, 2.2); for (let k = 0; k < 3; k++) for (let j = 0; j < 4; j++) box(0.32, 0.36, 0.3, M(col[(i + j + k) % col.length], { roughness: 0.6 }), x + i * 2.6 - 0.8 + j * 0.53, 0.55 + k * 0.7, z + 0.05); } };
const counterAt = (x, z, w = 5) => { box(w, 1.1, 1, M(0x6a5038, { roughness: 0.6 }), x, 0.55, z, scene, true); solid(x, z, w, 1, 1.2); };
const staff = (model, x, z, act = 'interact-right') => LATER.push(() => { const c = makePerson(model, { height: 1.7 }); c.g.position.set(x, 0, z); c.play(act, 0, 0.6); folk.push({ p: c, kind: 'stay', pos: c.g.position, yaw: 0, act }); });
const guests = (n, x0, z0, a = 'sit') => LATER.push(() => { for (let i = 0; i < n; i++) { const c = makePerson(NAMES_ALL[(i * 3) % NAMES_ALL.length], { height: 1.6 + Math.random() * 0.2 }); c.g.position.set(x0 + (i % 3) * 2.6, a === 'sit' ? 0.25 : 0, z0 + Math.floor(i / 3) * 2.4); c.g.rotation.y = i % 2 ? Math.PI / 2 : -Math.PI / 2; c.play(a, 0, 0.7 + Math.random() * 0.4); folk.push({ p: c, kind: 'stay', pos: c.g.position, yaw: c.g.rotation.y, act: a }); } });
// the rooms
tplRoom('lobby', 0, 14, 12, 0x2e3238, 0xfff0d8, (x, z) => { counterAt(x + 3, z - 2, 4); staff('female-c', x + 3, z - 3.2); for (let i = 0; i < 6; i++) box(0.6, 0.5, 0.15, M(0x8a8a8c, { metalness: 0.7 }), x - 5 + (i % 3) * 0.7, 1.3 + Math.floor(i / 3) * 0.6, z - 5.8); box(2, 3, 0.2, M(0x9a9a9c, { metalness: 0.8, roughness: 0.25 }), x - 3, 1.5, z - 5.85); for (const s of [-1, 1]) { const pl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), M(0x2f4a2a, { flatShading: true })); pl.position.set(x + s * 5.5, 1.1, z + 3); scene.add(pl); box(0.6, 0.6, 0.6, M(0x6a5038), x + s * 5.5, 0.3, z + 3); }
  ACTS.push({ at: new THREE.Vector3(x - 3, 0, z - 4.6), r: 1.8, when: () => true, text: () => 'Lift · out of order today', go: () => banner('OUT OF ORDER', 'Someone is coming to fix it. Probably.') });
  ACTS.push({ at: new THREE.Vector3(x - 4.3, 0, z - 4.8), r: 1.6, when: () => true, text: () => 'Mailboxes · nothing for you', go: () => banner('MAILBOXES', pickOne(['Nothing for flat 3B. You live in Westbank.', 'A flyer: festival at Curve Market, every third night.', 'A flyer: The Armory, Westbank. For the RISKY only.'])) }); });
tplRoom('shop', 80, 16, 12, 0x2a3a3c, 0xfff0d8, (x, z) => { shelf(x - 6, z - 5.2, 5, [0xa3262f, 0x2e5a8a, 0xe6b450, 0x2e7d6a, 0xedebe6]); counterAt(x, z, 4); staff('female-e', x, z - 1.2);
  ACTS.push({ at: new THREE.Vector3(x, 0, z + 1.4), r: 2.2, when: () => true, text: () => `${ENTER.name} · buy a little something, $4`, go: () => { if (!spend(4)) return; save.souvenirs = (save.souvenirs || 0) + 1; keep(); addXp(10); banner('BOUGHT', `Something from ${ENTER.name.toLowerCase()}`); } }); });
tplRoom('eat', 160, 18, 14, 0x3a2a24, 0xffc890, (x, z) => { counterAt(x, z - 4.5, 7); staff('male-a', x, z - 5.7);
  for (let i = 0; i < 6; i++) { const tx = x - 5 + (i % 3) * 5, tz = z - 0.5 + Math.floor(i / 3) * 3.6; const top = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 14), M(0xedebe6)); top.position.set(tx, 0.8, tz); scene.add(top); box(0.1, 0.78, 0.1, M(0x2a2d32), tx, 0.39, tz); solid(tx, tz, 1.4, 1.4, 0.9); }
  guests(6, x - 6, z - 0.5); ACTS.push({ at: new THREE.Vector3(x, 0, z - 3.2), r: 2.4, when: () => true, text: () => `${ENTER.name} · order`, go: () => menu(ENTER.name, 'Eat in · pay in cash', ENTER.menu || 'NOODLES') }); });
tplRoom('gym', 240, 18, 14, 0x23272d, 0xd8f0ff, (x, z) => { for (let i = 0; i < 4; i++) { box(1.2, 1.4, 2.2, M(0x15171a), x - 6 + i * 4, 0.7, z - 3, scene, true); box(1.1, 0.06, 2, M(0x3a3e45), x - 6 + i * 4, 1.42, z - 3); solid(x - 6 + i * 4, z - 3, 1.2, 2.2, 1.4); } for (let i = 0; i < 6; i++) box(0.5, 0.5, 0.5, M(0x2a2d32), x - 5 + i * 2, 0.25, z + 2);
  guests(4, x - 6, z - 1.2, 'sprint'); ACTS.push({ at: new THREE.Vector3(x, 0, z + 0.5), r: 2.4, when: () => !MINI.on, text: () => `${ENTER.name} · work out, $3`, go: () => { if (!spend(3)) return; workout(); } }); });
tplRoom('karaoke', 320, 14, 12, 0x2a1430, 0xff4d8a, (x, z) => { box(4, 0.4, 2.5, M(0x15171a), x, 0.2, z - 4, scene, true); box(0.08, 1.5, 0.08, M(0x9a9a9c), x, 1.15, z - 3.5); box(3.6, 2, 0.1, glow(0xc58bff, 1.2), x, 2.6, z - 5.8);
  for (let i = 0; i < 4; i++) { box(2.2, 0.6, 1, M(0xa3262f), x - 4 + i * 2.6, 0.3, z + 1, scene, true); solid(x - 4 + i * 2.6, z + 1, 2.2, 1, 0.8); } guests(4, x - 4, z + 0.8);
  ACTS.push({ at: new THREE.Vector3(x, 0, z - 2.4), r: 2.2, when: () => !MINI.on, text: () => `${ENTER.name} · take the mic, $3`, go: () => { if (!spend(3)) return; karaoke(); } }); });
tplRoom('hotel', 400, 16, 12, 0x3a3430, 0xffd6a0, (x, z) => { counterAt(x + 3, z - 2, 4); staff('male-b', x + 3, z - 3.2); box(3, 0.6, 2, M(0x6a2a30), x - 4, 0.3, z - 3, scene, true); box(3, 0.9, 0.3, M(0x6a2a30), x - 4, 0.75, z - 4, scene, true); solid(x - 4, z - 3, 3, 2, 1);
  ACTS.push({ at: new THREE.Vector3(x + 3, 0, z - 0.8), r: 2.2, when: () => true, text: () => `${ENTER.name} · a room for the night, $8`, go: () => { if (!spend(8)) return; const f = $('fade'); f.classList.add('on'); setTimeout(() => { TIME.h = ENV.night > 0.5 || TIME.h < 6 ? 7 : (TIME.h + 3) % 24; P.energy = 100; P.hp = 100; walletUI(); f.classList.remove('on'); banner('RESTED', `${clock()} · energy full`); complete('sleep'); }, 1200); } }); });
tplRoom('pharmacy', 480, 14, 11, 0x2a3a34, 0xeaffea, (x, z) => { shelf(x - 5, z - 4.7, 4, [0xedebe6, 0x2ed3a0, 0xa9d6ff]); counterAt(x, z - 0.5, 4); staff('female-a', x, z - 1.7);
  ACTS.push({ at: new THREE.Vector3(x, 0, z + 1), r: 2.2, when: () => true, text: () => `${ENTER.name} · first aid kit, $8`, go: () => { if (!spend(8)) return; P.hp = 100; P.energy = Math.min(100, P.energy + 20); walletUI(); banner('PATCHED UP', 'Health full, energy +20'); } }); });
function workout() { let reps = 0, t = 0, pos = 0; mini('WORK OUT', 'Press <kbd>E</kbd> in the green. Ten reps.', '<div class="meter"><i></i><u></u></div>'); MINI.tick = dt => { t += dt * 2.2; pos = 0.5 + 0.5 * Math.sin(t * 3); const u = $('mn-x').querySelector('u'); if (u) u.style.left = pos * 100 + '%'; }; MINI.hit = () => { if (Math.abs(pos - 0.5) < 0.12) { reps++; sfx.coin(); doEmote('jump', 1.5); } else sfx.bad(); $('mn-t').innerHTML = `${reps} of 10 reps`; if (reps >= 10) { MINI.tick = null; P.energy = Math.min(100, P.energy + 30); walletUI(); mini('WORK OUT', 'Ten reps. Energy +30'); complete('gym'); miniEnd(1800); } }; }
function karaoke() { const notes = [72, 74, 76, 79, 76, 74, 72, 69]; let n = 0, good = 0, t = 0, pos = 0; mini('KARAOKE', 'Hit <kbd>E</kbd> on the beat: when the marker crosses the green.', '<div class="meter"><i></i><u></u></div>'); MINI.tick = dt => { t += dt * 1.6; pos = (t % 1); const u = $('mn-x').querySelector('u'); if (u) u.style.left = pos * 100 + '%'; }; MINI.hit = () => { const ok = Math.abs(pos - 0.5) < 0.1; if (ok) { good++; sfx.good(); } else sfx.bad(); n++; $('mn-t').innerHTML = `${good} of ${n} on the beat`; if (n >= notes.length) { MINI.tick = null; const tip = good * 2; mini('KARAOKE', good >= 6 ? `The room loved it. Tips: $${tip}` : `${good} of 8. The room clapped politely.`); if (tip) pay(tip, 'tips'); if (good >= 6) complete('karaoke'); miniEnd(2200); } }; }
// the doors: one on every building at street level, on the face with a sign if it has one, else the face nearest a road
const DOORS = [];
{
  const signOf = new Map(neon.map(n => [n.x + ',' + n.z, n]));
  const faces = (t) => [[0, -t.d / 2 - 0.15, Math.PI, 0], [t.w / 2 + 0.15, 0, Math.PI / 2, 1], [0, t.d / 2 + 0.15, 0, 2], [-t.w / 2 - 0.15, 0, -Math.PI / 2, 3]];
  const roadDist = (x, z) => Math.min(...[...DISTRICTS.west.aves, ...DISTRICTS.east.aves].map(a => Math.abs(x - a)), ...STREETS_Z.map(s => Math.abs(z - s)));
  for (const t of towers) {
    if (t.y) continue;
    const n = signOf.get(t.x + ',' + t.z), opts = faces(t).map(f => ({ f, x: t.x + f[0], z: t.z + f[1] }));
    const pickF = n ? opts[n.side] : opts.filter(o => !near(o.x + Math.sin(o.f[2]) * 1.5, o.z + Math.cos(o.f[2]) * 1.5, 1).some(b => { const px = o.x + Math.sin(o.f[2]) * 1.5, pz = o.z + Math.cos(o.f[2]) * 1.5; return px > b.x0 && px < b.x1 && pz > b.z0 && pz < b.z1; })).sort((a, b) => roadDist(a.x, a.z) - roadDist(b.x, b.z))[0];
    if (!pickF) continue;
    const kind = n ? KIND(n.text) : 'lobby', name = n ? n.text.charAt(0) + n.text.slice(1).toLowerCase() : pickOne(['The Ashby', 'Rail House', 'Signal Court', 'The Lantern', 'Pons House', 'Gate Tower', 'The Siding', 'Junction House', 'Yardley', 'Curve House']);
    const out = new THREE.Vector3(pickF.x + Math.sin(pickF.f[2]) * 1.4, 0, pickF.z + Math.cos(pickF.f[2]) * 1.4);
    DOORS.push({ x: pickF.x, z: pickF.z, rot: pickF.f[2], kind, name, text: n?.text, out });
  }
  const frame = new THREE.InstancedMesh(BOX_G, M(0x15171a), DOORS.length), pane = new THREE.InstancedMesh(BOX_G, glow(0xffe2b0, 1.1, true), DOORS.length), o = new THREE.Object3D();
  DOORS.forEach((d, i) => { o.position.set(d.x, 1.4, d.z); o.rotation.set(0, d.rot, 0); o.scale.set(2, 2.8, 0.2); o.updateMatrix(); frame.setMatrixAt(i, o.matrix); o.position.set(d.x + Math.sin(d.rot) * 0.12, 1.25, d.z + Math.cos(d.rot) * 0.12); o.scale.set(1.4, 2.3, 0.04); o.updateMatrix(); pane.setMatrixAt(i, o.matrix); });
  scene.add(frame, pane);
  for (const d of DOORS) ACTS.push({ at: d.out, r: 1.9, when: () => !MODE, text: () => `${d.name} · go inside`, go: () => enterDoor(d) });
}
function enterDoor(d) {
  if (d.kind === 'cinema') return goTo(ROOMS.cinema.inside.clone().add(new THREE.Vector3(0, 0, -1.8)), 'THE SIGNAL', 0);
  if (d.kind === 'arcade') return goTo(ROOMS.arcade.inside.clone().add(new THREE.Vector3(0, 0, -1.8)), 'BOOTH 7', 0);
  const T = TPL[d.kind] || TPL.shop; ENTER.back = d.out.clone(); ENTER.name = d.name; ENTER.menu = d.text && MENUS[d.text] ? d.text : 'NOODLES';
  drawScreen('tpl-' + (TPL[d.kind] ? d.kind : 'shop'), d.name.toUpperCase(), [], '#2ed3a0');
  save.entered ??= []; if (!save.entered.includes(d.x + ',' + d.z)) { save.entered.push(d.x + ',' + d.z); keep(); }
  goTo(T.inside.clone().add(new THREE.Vector3(0, 0, -1.8)), d.name.toUpperCase(), 0);
}
// the radio tower has a hut, the stadium has its stands
{
  const r = place('radio'); ACTS.push({ at: new THREE.Vector3(r.x + 5, 0, r.z + 7.2), r: 2, when: () => true, text: () => 'Radio hut · listen in', go: () => { info('Radio Tower', 'On the air', '<p>Static, then a voice: "This is the yard. Every token rides the line. If you want the full read on one, the bot is on Telegram."</p>', 'https://t.me/shuntdesk_bot', 'OPEN THE BOT →'); complete('radio'); } });
  const s = place('stadium'); ACTS.push({ at: s.at, r: 5, when: () => !MODE, text: () => 'Curve Stadium · watch from the stands, $5', go: () => { if (!spend(5)) return; watchMatch(); } });
}
function watchMatch() {
  const S = place('stadium'), seat = new THREE.Vector3(S.x, 9, S.z + 34), at = new THREE.Vector3(S.x, 0, S.z); let t = 0; hero && (hero.g.visible = false); complete('matchnight');
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), M(0xedebe6)); scene.add(ball);
  MODE = { tick(dt) { t += dt; cam.position.lerp(seat, damp(dt, 3)); cam.lookAt(at); sky.position.copy(cam.position); ball.position.set(S.x + Math.sin(t * 0.7) * 30, 0.5 + Math.abs(Math.sin(t * 2.3)) * 3, S.z + Math.sin(t * 1.1) * 15); if (Math.random() < dt * 0.3) sfx.cheer?.(0.9); if (CRANE.crowd) CRANE.crowd.position.y = Math.abs(Math.sin(t * 6)) * 0.3;
    if (act || t > 30) { act = false; MODE = null; scene.remove(ball); hero && (hero.g.visible = true); P.pos.copy(S.at); banner('FULL TIME', 'What a match'); } } };
}
MISSIONS.push(
  { id: 'explorer', title: 'Behind every door', text: 'Walk into ten different buildings round town. Every building has a door.', where: () => null, xp: 100, auto: () => (save.entered || []).length >= 10 },
  { id: 'gym', title: 'Leg day', text: 'Work out at a gym. Look for a GYM sign.', where: () => null, xp: 30 },
  { id: 'karaoke', title: 'Take the mic', text: 'Sing at a karaoke bar and hit six of eight on the beat.', where: () => null, xp: 50 },
);

// ---------- the Yard Gazette: a paper at the newsstands, written from the record ----------
function gazette() {
  if (!spend(1)) return;
  const v = DATA.verdicts?.verdicts || [], d = DATA.desk, g = DATA.grads?.tokens || [], r = DATA.rugs?.rows || [], top = LB.data?.rows?.[0];
  const heads = [];
  if (d) heads.push([`CREW DESK AT ${money(d.equity)}`, `The crew's paper desk has ${d.open.length} positions open and started at ${money(d.start)}.`]);
  if (v[0]) heads.push([`${v[0].symbol} CALLED ${v[0].verdict}`, `The latest call on file scored ${v[0].score}. ${v.filter(x => x.verdict === 'CLEAN').length} of the last ${v.length} calls read clean.`]);
  if (g.length) heads.push([`${g.length} FRESH OFF PONS`, 'Tokens that finished the curve in the last day pull into the Graduation Platform.']);
  if (r[0]) heads.push([`WRECK OF THE WEEK: ${r[0].symbol}`, `${pct(r[0].fall)} ${r[0].after} after the call. Read it at the Crash Site.`]);
  if (top) heads.push([`${top.handle.toUpperCase()} LEADS THE YARD`, `${top.pts} points this week. The board is in Signal Square.`]);
  heads.push([save.day % 7 === 0 ? 'THE RUG PULL WALKS TONIGHT' : `${7 - save.day % 7} NIGHTS TO THE RUG PULL`, 'Stay in the light, or bring a bat.']);
  if (save.day % 3 === 0) heads.push(['FESTIVAL AT CURVE MARKET TONIGHT', 'Lanterns, music, and more people than the stalls can feed.']);
  info('The Yard Gazette', `Day ${save.day} · $1`, heads.map(h => `<div class="news"><b>${esc(h[0])}</b><p>${esc(h[1])}</p></div>`).join(''));
  complete('paper');
}
for (const [x, y, z] of [[254, 0, 18], [JUNCTION.x + 3.6, 1, JUNCTION.z + 24]]) { box(1.4, 1.4, 0.8, M(0x23272d), x, y + 0.7, z, scene, true); box(1.5, 0.12, 1, M(0x2ed3a0), x, y + 2.3, z); box(0.1, 0.9, 0.1, M(0x2a2d32), x, y + 1.8, z); const s = label('GAZETTE · $1', { size: 30, accent: '#2ed3a0', scale: 0.01 }); s.position.set(x, y + 2.9, z); scene.add(s); ACTS.push({ at: new THREE.Vector3(x, y, z + 1), r: 1.8, when: () => true, text: () => 'Newsstand · the Yard Gazette, $1', go: gazette }); }

// ---------- people remember you ----------
const npcKey = n => n.name + '|' + n.role;
function remember(n) { const k = npcKey(n); save.npc[k] = (save.npc[k] || 0) + 1; keep(); return save.npc[k]; }

// ---------- conversations, by topic: ask about the game, money, the city, nights, Shuntdesk, the news ----------
const rankName = () => RANKS.reduce((r, x) => save.xp >= x[0] ? x[1] : r, RANKS[0][1]);
const VOICE = { 'old hand': s => 'Listen, kid. ' + s, trader: s => s, 'station staff': s => s, 'yard crew': s => 'Right. ' + s, chartist: s => s, student: s => 'Oh! ' + s, tourist: s => 'Well, ' + s.charAt(0).toLowerCase() + s.slice(1), 'night owl': s => s, commuter: s => 'Quickly then. ' + s, courier: s => s, 'busker fan': s => s };
const T_ = {
  play: ['How does the Signal Box work?', () => 'Every train coming down the main line is a real call Shuntdesk filed. You get its manifest, the six checks from the ticket and the pool size. Before it reaches the junction you pull RIDE or SIDING at the lever frame, next to the Signal Box. Then you see what the price really did an hour or a day later.', ['manifest', 'levers', 'score']],
  manifest: ['What is on a manifest?', () => 'Six stops. Sources found a pool. Gate checks liquidity and age. Scout reads the holders. Tracer follows where the money came from. Linker looks for wallets moving together. Auditor reads the contract. Green tags passed, amber is a note, red is a stop you should worry about.', ['redflags', 'levers']],
  redflags: ['Which tags should worry me?', () => 'TOO THIN means a small sell can move it hard. TOP HEAVY means a few wallets hold most of it. DEPLOYER PAID and FRESH WALLETS mean the buyers were funded by the launcher. BUNDLED means wallets bought together. TRAP DOOR means the contract can stop you selling. Two of those and I send it to the siding.', ['levers', 'shuntdesk']],
  levers: ['RIDE or SIDING, how do I choose?', () => 'RIDE when the manifest is clean and the pool can take a sell. SIDING when you see red, a thin pool, or a crowd of fresh wallets. A siding that saves the line from a fall pays the most. Missing a train that went up costs you, but not as much as letting a rug ride.', ['score', 'daily']],
  score: ['How is a shift scored?', () => 'Up to a hundred for a good ride, more for a siding that saved the line from a big fall. Three right in a row pays half again. And it tells you how Shuntdesk itself called the same trains. Beat the desk and you have done something.', ['daily', 'money']],
  daily: ['What is the daily shift?', () => 'Same five trains for everyone, one go a day. Pick it at the Signal Box. Afterwards you can save a card or post your score. The board for the day is on the server, so nobody can fake it.', ['money', 'cityguide']],
  money: ['How do I make money here?', () => 'Plenty of ways. Right calls in a shift pay. The job boards have parcels. Drive a cab from the taxi rank by Central. Drive a train in from the drivers\' depot. Fish at the lake and sell the catch. Work the kiosk counter. Pick up litter. Stop a thief, fix a broken train, put out a fire.', ['parcels', 'taxi', 'trainjob', 'fishing']],
  parcels: ['How do the parcels work?', () => 'Take one from a job board: Curve Market, Junction Station or Signal Square. It tells you where it goes and you carry it there. Be quick and they tip half again. Further away pays more.', ['taxi', 'cityguide']],
  taxi: ['Tell me about the taxis.', () => 'The rank is on the plaza by Central Station. Get in, drive to the green marker, pick up, drop off. Fast fares tip. Press E to leave the cab when you stop.', ['trainjob', 'money']],
  trainjob: ['Can I drive a train?', () => 'The drivers\' depot is on Junction Station, the south end of the platform. W for power, S or space to brake. Stop it at the end marker, or bring it into the siding before the buffer. A clean stop pays well. Overrun and you get nothing.', ['runaway', 'money']],
  runaway: ['What if a train runs away?', () => 'It happens. One comes down the main line with nobody driving. Run to the lever frame and pull SIDING before it reaches the junction. The siding stops it. The main line does not.', ['night', 'money']],
  fishing: ['Is there fishing?', () => 'Off the jetty at Liquidity Lake. Wait for the bite, then strike, not before. Perch and carp sell at Yard Supply, pike sells well, and there is a golden carp people talk about.', ['cityguide', 'money']],
  cityguide: ['Where is worth going?', () => { const p = PLACES.filter(x => x.note).sort(() => Math.random() - 0.5).slice(0, 3); return `Try ${p.map(x => `${x.name}. ${x.note}`).join(' Or ')} And there is a cinema called The Signal and an arcade, Booth 7, in Eastgate.`; }, ['getaround', 'night']],
  getaround: ['How do I get around?', () => 'Buses from the green signs, two dollars. The 22 between Junction and Central, three dollars. A season pass from Yard Supply makes both free. Or borrow a cab and drive yourself.', ['cityguide', 'money']],
  night: ['What happens at night?', () => `The RISKY walk out of the Crash Site after dark. Every seventh night something bigger comes, the RUG PULL. ${save.day % 3 === 0 ? 'Tonight there is a festival at Curve Market.' : 'Every third night there is a festival at Curve Market.'} Match nights, the stadium is loud.`, ['fight', 'cityguide']],
  fight: ['How do I deal with the RISKY?', () => 'F to strike. A steel bat from Yard Supply reaches further and hits harder. They do not come indoors, so the diner is safe, and your flat. Sleep through the night if you would rather not.', ['night', 'money']],
  shuntdesk: ['What is Shuntdesk anyway?', () => 'It reads tokens on Robinhood Chain. Seven fixed checks, one score: clean, risky or danger. A public paper desk trades on the calls, so you can see if they were right. This yard is their playground, real calls as trains.', ['checks', 'desk', 'record']],
  checks: ['What are the seven checks?', () => 'The six on the manifest, Sources, Gate, Scout, Tracer, Linker and Auditor, and the Judge, who adds it up. Seventy-five and over is clean, under forty-five is danger. You can run them on any token at the Signal Box, bring your own.', ['desk', 'record']],
  desk: ['What is the crew desk?', () => DATA.desk ? `A paper desk, not real money. It started at ${money(DATA.desk.start)} and stands at ${money(DATA.desk.equity)} with ${DATA.desk.open.length} open. Clean calls go long, danger calls on deep pools go short. The wall in Crew Desk HQ shows it live.` : 'A paper desk that trades on the calls. Crew Desk HQ in Eastgate shows it live.', ['record', 'shuntdesk']],
  record: ['Can I check their record?', () => 'Every call is priced again after an hour and a day, and the lot is published on Hugging Face. The Crash Site has the worst falls, and the replay shows a whole chart.', ['news', 'shuntdesk']],
  news: ['Any news?', () => tip(), ['news2', 'cityguide']],
  news2: ['What else?', () => tip(), ['tickets', 'cityguide']],
  tickets: ['Heard about the golden tickets?', () => { const k = TIX.filter(k => k.m.visible); if (!k.length) return 'Gone, the lot. Someone found all twelve. Was it you?'; const t = k[Math.floor(Math.random() * k.length)], pl = PLACES.reduce((b, p) => Math.hypot(p.x - t.x, p.z - t.z) < Math.hypot(b.x - t.x, b.z - t.z) ? p : b, PLACES[0]); return `Twelve were lost round town, ten dollars each. I saw one shining near ${pl.name}, about fifteen metres off.`; }, ['cityguide', 'money']],
};
const START = { 'station staff': ['play', 'getaround', 'trainjob'], 'yard crew': ['play', 'manifest', 'runaway'], trader: ['money', 'fishing', 'news'], commuter: ['getaround', 'news', 'parcels'], 'night owl': ['night', 'fight', 'cityguide'], student: ['shuntdesk', 'play', 'daily'], chartist: ['redflags', 'checks', 'desk'], tourist: ['cityguide', 'getaround', 'night'], 'old hand': ['levers', 'redflags', 'record'], courier: ['parcels', 'taxi', 'money'], 'busker fan': ['cityguide', 'night', 'tickets'] };
function topic(key) {
  const [, ans, next] = T_[key], n = TALK.f.npc, voice = VOICE[n.role] || (s => s);
  const opts = next.filter(k => T_[k]).slice(0, 3).map(k => [T_[k][0], () => topic(k)]);
  opts.push(['Something else.', () => root(true)], ['Thanks. See you.', () => say(pickOne(['Any time.', 'Good luck out there.', 'Mind the trains.', 'See you around, ' + (save.handle || 'shunter') + '.']), [['Bye.', endTalk]])]);
  save.topics = (save.topics || 0) + 1; keep(); if (save.topics >= 15) complete('curious');
  say(voice(typeof ans === 'function' ? ans() : ans), opts);
}
function root(again) {
  const f = TALK.f, n = f.npc, starts = START[n.role] || ['play', 'money', 'cityguide'], extra = Object.keys(T_).filter(k => !starts.includes(k));
  const keysNow = [...starts, extra[Math.floor(Math.random() * extra.length)]].slice(0, 4);
  const opts = keysNow.map(k => [T_[k][0], () => topic(k)]);
  if (n.role === 'trader') opts.push(['What are you selling?', () => { endTalk(); const t = FOODTRUCKS.reduce((b, x) => Math.hypot(x.x - P.pos.x, x.z - P.pos.z) < Math.hypot(b.x - P.pos.x, b.z - P.pos.z) ? x : b, FOODTRUCKS[0]); menu(t.name.toLowerCase().replace(/^\w/, c => c.toUpperCase()), 'Food truck · pay in cash', MENUS[t.name] ? t.name : 'NOODLES'); }]);
  opts.push(['Need a hand with anything?', () => {
    if (n.favor && !QUEST.f) return say(`Actually, yes. Could you get me ${/^[aeiou]/i.test(n.favor) ? 'an' : 'a'} ${n.favor.toLowerCase()}? I'll make it worth your while.`, [['Sure.', () => { Object.assign(QUEST, { f, want: n.favor, have: false }); banner('FAVOUR', `Buy ${n.favor.toLowerCase()} and bring it to ${n.name}`); endTalk(); }], ['Not now.', () => root(true)]]);
    say('I\'m fine, thanks. If it\'s work you want, the job boards always have parcels.', [['How do the parcels work?', () => topic('parcels')], ['Okay.', () => root(true)]]);
  }]);
  opts.push(['See you.', () => say(pickOne(['Take care.', 'See you around.', 'Mind the trains.']), [['Bye.', endTalk]])]);
  const times = save.npc[npcKey(n)] || 0, who = save.handle || 'shunter';
  const greet = again ? 'What else?' : times >= 5 ? `${who}! My favourite ${rankName().toLowerCase()}. What is it today?` : times >= 2 ? `Oh, ${who} again. Still working as a ${rankName().toLowerCase()}?` : pickOne(GREET[n.role] || ['Hi.']);
  say(greet, opts);
}
const openTalkV1 = openTalk;
openTalk = function (f) {
  const n = persona(f); TALK.f = f; f.talk = true; f.p.play('emote-yes', 0.2, 0.8); $('talk').classList.add('on');
  if (!n.met) { n.met = true; save.talked++; keep(); } remember(n);
  if (QUEST.f === f && QUEST.have) return say(`That's my ${QUEST.want.toLowerCase()}! You're a star. Here, for your trouble.`, [['You\'re welcome.', () => { QUEST.f = null; QUEST.have = false; save.favors++; keep(); pay(12, 'favour'); addXp(25); endTalk(); }]]);
  if (QUEST.f === f) return say(`Still hoping for that ${QUEST.want.toLowerCase()}. Food trucks and the kiosk have it.`, [['On it.', endTalk]]);
  root(false);
};

// ---------- missions for all of it ----------
MISSIONS.push(
  { id: 'daily', title: 'The daily shift', text: 'Pick the daily shift at the Signal Box: the same five trains as everyone today.', where: () => SB_DOOR, xp: 80 },
  { id: 'share', title: 'Show your card', text: 'Finish a shift and save its card from the summary.', where: () => null, xp: 30 },
  { id: 'own', title: 'Your own token', text: 'Run a token of your own at the Signal Box, then come back after the hour for the result.', where: () => SB_DOOR, xp: 80 },
  { id: 'driver', title: 'Driver', text: 'Sign on at the drivers\' depot on Junction Station and stop a train on the mark.', where: () => new THREE.Vector3(JUNCTION.x, 1, JUNCTION.z - 24), xp: 80 },
  { id: 'siding', title: 'Into the siding', text: 'Drive a train into the siding and stop it before the buffer.', where: () => new THREE.Vector3(JUNCTION.x, 1, JUNCTION.z - 24), xp: 100 },
  { id: 'runaway', title: 'Runaway', text: 'When a runaway comes down the main line, pull SIDING in time.', where: () => null, xp: 150 },
  { id: 'taxi', title: 'Cabbie', text: 'Take a cab from the rank by Central Station and complete a fare.', where: () => new THREE.Vector3(64, 0, 84), xp: 60 },
  { id: 'fish', title: 'Gone fishing', text: 'Catch something at Liquidity Lake.', where: () => new THREE.Vector3(280, 0, 377), xp: 40 },
  { id: 'golden', title: 'The golden carp', text: 'Catch the golden carp. It is rare.', where: () => null, xp: 200 },
  { id: 'hoops', title: 'Three from five', text: 'Make three of five shots at Westbank Court.', where: () => at('court'), xp: 40 },
  { id: 'counter', title: 'Behind the counter', text: 'Work the kiosk counter at Junction Station.', where: () => new THREE.Vector3(JUNCTION.x, 1, JUNCTION.z + 19.8), xp: 40 },
  { id: 'arcade', title: 'Booth 7', text: 'Play Up or Down at the arcade by the diner.', where: () => new THREE.Vector3(231.6, 0, -48), xp: 30 },
  { id: 'film', title: 'Night at the pictures', text: 'Watch the film at The Signal cinema in Eastgate.', where: () => new THREE.Vector3(231.6, 0, 10), xp: 30 },
  { id: 'sleep', title: 'Home', text: 'Find your flat in Westbank, The Old Mill Flats, and sleep in your own bed.', where: () => new THREE.Vector3(-75.4, 0, -100), xp: 40 },
  { id: 'style', title: 'New look', text: 'Buy something to wear at Yard Supply.', where: () => at('market'), xp: 30 },
  { id: 'repair', title: 'Fix it', text: 'When a train breaks down, get to it and repair it.', where: () => null, xp: 80 },
  { id: 'fire', title: 'Firefighter', text: 'When a fire breaks out, put it out.', where: () => null, xp: 80 },
  { id: 'thief', title: 'Stop, thief!', text: 'Catch a thief before he gets away.', where: () => null, xp: 80 },
  { id: 'festival', title: 'Festival night', text: 'Be at Curve Market on a festival night. Every third night.', where: () => at('market'), xp: 50 },
  { id: 'matchnight', title: 'Under the lights', text: 'Be at Curve Stadium on a match night.', where: () => at('stadium'), xp: 40 },
  { id: 'boss', title: 'The RUG PULL', text: 'Every seventh night the RUG PULL walks out of the Crash Site. Stop it.', where: () => at('crash'), xp: 400, auto: () => (save.boss || 0) >= 1 },
  { id: 'dog', title: 'Best friend', text: 'Feed the stray dog near Curve Market.', where: () => new THREE.Vector3(-126, 0, -10), xp: 30 },
  { id: 'cats', title: 'Cat person', text: 'Pet three cats round town.', where: () => null, xp: 30 },
  { id: 'paper', title: 'Read all about it', text: 'Buy the Yard Gazette at a newsstand.', where: () => new THREE.Vector3(254, 0, 19), xp: 20 },
  { id: 'curious', title: 'Curious', text: 'Ask people round town fifteen questions.', where: () => null, xp: 50 },
  { id: 'collector', title: 'Collector', text: 'Fill the album with twenty cards (K).', where: () => null, xp: 80, auto: () => save.cards.length >= 20 },
  { id: 'rugcard', title: 'Rug spotter', text: 'Send a train to the siding that then fell more than 10%. It earns a rare card.', where: () => SB_DOOR, xp: 100, auto: () => save.cards.some(c => c.rare) },
);

// ---------- the phone taskbar ----------
document.querySelectorAll('#tbar [data-tb]').forEach(b => b.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation(); sfx.ui(); const k = b.dataset.tb;
  if (k === 'missions') toggle('journal'); if (k === 'map') toggle('bigmap'); if (k === 'board') leaderboard(); if (k === 'album') album();
  if (k === 'photo') photo(!document.body.classList.contains('photo')); if (k === 'sound') { toggleSound(); tbarUI(); }
}));
function tbarUI() { const s = document.querySelector('#tbar [data-tb="sound"]'); if (s) s.classList.toggle('on', soundOn()); const m = document.querySelector('#tbar [data-tb="missions"]'); if (m) m.classList.toggle('dot', !!active() && !isDone(active().id)); }
tbarUI(); setInterval(tbarUI, 3000);
// on a phone the mission is a pill: tap it for the whole text
$('obj').addEventListener('pointerdown', e => { if (!TOUCH) return; e.stopPropagation(); $('obj').classList.toggle('open'); });// ---------- what runs each frame ----------
function extrasTick(dt, t) {
  eventTick(dt, t); nightTick(dt); petsTick(dt, t); wearTick(); heldTick();
  document.body.classList.toggle('busy', !!document.querySelector('.panel.on') || $('talk').classList.contains('on') || MINI.on || $('dead').classList.contains('on') || !$('done').hidden);
  if (MINI.on && MINI.tick) MINI.tick(dt);
  if (RUN.on && EVT.cur?.k !== 'runaway') runawayTick(dt);
}

// ---------- the loop ----------
let last = performance.now(), started = false, intro = 0;
$('go').onclick = () => { startAudio(); $('intro').hidden = true; document.body.classList.remove('title'); started = true; look.yaw = Math.PI; look.pitch = 0.3; doEmote('emote-yes'); if (!save.done.length) setTimeout(() => banner('WELCOME TO THE YARD', 'J missions · M map'), 1600); };
const camFocus = new THREE.Vector3(), titleFocus = new THREE.Vector3(4, 0, -10);
// a frame that throws must not stop the game: show the error once, keep going
let frameErr = null;
function safeFrame(now) { try { frame(now); } catch (e) { if (!frameErr) { frameErr = e; showErr(e); } requestAnimationFrame(safeFrame); } }
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000), t = now / 1000; last = now;
  camFocus.copy(started ? P.pos : titleFocus);
  tickTime(started ? dt : dt * 0.15, camFocus);
  wheelTick(dt); if (CRANE.jib) CRANE.jib.rotation.y = Math.sin(t * 0.05) * 1.2;
  skyTick(dt);
  if (started && !RIDE.on && !MODE) move(dt); else if (!started && hero) { hero.g.position.copy(P.pos); hero.g.rotation.y = P.yaw + Math.PI * 0.85; }
  if (hero) hero.mixer.update(dt);
  runAmbient(dt);
  if (G.train && runTrain(G.train, dt)) G.train.g.visible = false;
  for (let i = G.old.length - 1; i >= 0; i--) if (runTrain(G.old[i], dt)) { scene.remove(G.old[i].g); G.old.splice(i, 1); }
  if (townReady) { runTown(dt, cam.position, P.pos); runCars(dt, P.pos, ENV.night); }
  runParts(dt);
  if (started) { runNight(dt); roofs(); }
  for (const k in levers) { const L = levers[k]; L.arm.rotation.x = lerp(L.arm.rotation.x, L.target, damp(dt, 14)); }
  for (const h of halos) h.material.opacity = clamp(h.userData.mat.emissiveIntensity / 6, 0, 1);
  const bl = Math.sin(t * 2.4) > 0.3 ? 6 : 0.2; if (PLACES.antennas) PLACES.antennas.emissiveIntensity = bl * (0.3 + 0.7 * ENV.night); for (const m of PLACES.blink || []) m.emissiveIntensity = bl;
  crossings(dt, t); stationLife(dt);
  const fire = place('crash')?.fire; if (fire) fire.intensity = 40 + Math.sin(t * 13) * 10 + Math.sin(t * 5.3) * 8;
  poolMat.opacity = 0.35 * ENV.street;
  beam.material.opacity = (0.09 + 0.05 * Math.sin(t * 3)) * clamp((dist(beam.position) - 2) / 6, 0, 1); ring.scale.setScalar(1 + 0.15 * Math.sin(t * 4));
  bufLamp.emissiveIntensity = 2.5 + 2 * Math.sin(t * 6); lanternL.intensity = (0.8 + 1.4 * ENV.night) * (has('lantern') ? 2.2 : 1) + Math.sin(t * 17) * 0.12;
  if (started) { if (RIDE.on) riding(dt); else if (MODE) { MODE.tick(dt); act = false; if (lastPrompt) { lastPrompt = ''; $('prompt').classList.remove('on'); } nameTag(null); } else { follow(dt); interact(); } hud(dt); lifeTick(dt, t); extrasTick(dt, t); }
  else { intro += dt; const a = -0.6 + intro * 0.05, r = 26; cam.position.set(4 + Math.sin(a) * r, 7 + Math.sin(intro * 0.2) * 1.5, -8 + Math.cos(a) * r); cam.lookAt(4, 2.5, -10); sky.position.copy(cam.position); }
  runRain(dt); objective(); drawMap(t); listen(dt);
  if (++shadowTick % 2 === 0) R.shadowMap.needsUpdate = true;   // shadows every other frame
  if (started) quality(dt);
  if (window.__film) window.__film(cam, sky, t);   // a camera for making videos of the city, set from outside
  composer.render(); if (photoNext) takePhoto();
  requestAnimationFrame(safeFrame);
}
if (/[?&]debug\b/.test(location.search)) window.__yard = { PLACES, DOORS, get MODE() { return MODE; }, startEvent, EVT, RUN, DRIVE, TAXI, ROOMS, openTalk, nearestFolk, TALK, JOB, startJob, pay, get cash() { return save.cash; }, announce, PLATFORMS, CROSSINGS, cam, get RIDE() { return RIDE; }, WHEEL, R, bloom, sun, scene, P, G, look, TIME, ENV, startShift, setLever, zombies, spawnZombie, folk, cars, complete, save, get hero() { return hero; }, get started() { return started; }, get townReady() { return townReady; } };
// the first frames compile the shaders; show the city once two have drawn
let firstFrames = 0; const bootWatch = () => { if (++firstFrames >= 3) { window.bootDone?.(); if (!townReady) $('go').textContent = 'Waking up the town…'; } else requestAnimationFrame(bootWatch); };
requestAnimationFrame(safeFrame); requestAnimationFrame(bootWatch);
