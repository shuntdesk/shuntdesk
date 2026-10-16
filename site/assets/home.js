import { createYard, STOPS, GZ } from './yard.js';
import { mountChrome, $, $$, flap, band, clamp, esc, feedYard } from './ui.js';
import { newPools, graduates, compact, ageShort, isAddr } from './data.js';
import { crewLines } from './crew.js';

mountChrome('Yard');
const yard = createYard($('#yard'), { snap: location.search.includes('snap') });

const COPY = [
  ['No pool, no ride. First it finds where the token trades, how old the pool is and how busy.', 'DexScreener · GeckoTerminal', 'a token with no pool at all'],
  ['Too thin or too young costs points before the ride has really begun.', 'pool liquidity and age', 'under $3K, or under ten minutes old'],
  ['Counts the holders. Then asks the real question: how much do the ten biggest keep?', 'Blockscout, or GoPlus if it is down', 'ten wallets holding over half the supply'],
  ['Follows the money back. Who paid for each top wallet, and what has the deployer done before?', 'Blockscout transactions · GoPlus', 'wallets the deployer funded, a deployer on record'],
  ['Wallets that share a funder are one hand in several gloves. It counts the hands.', 'the tracer’s findings', 'one funder behind over 15% of supply'],
  ['Tries to sell before you ever buy. Then reads what the owner is still allowed to do.', 'GoPlus sell simulation · bytecode over RPC', 'a failed sell, high tax, blacklist, owner minting'],
  ['Starts at 100 and takes off every point the six stops found. Same rules for every token.', 'the six stops before it', 'nothing. It only adds up']
];

// bottom strip: seven stops and a filling line
const strip = $('#strip'), span = GZ[6] - GZ[0];
STOPS.forEach((s, i) => strip.insertAdjacentHTML('beforeend', `<div class="nd" style="left:${(GZ[i] - GZ[0]) / span * 100}%"><span>${s}</span></div>`));
const nodes = $$('.nd', strip), stopBox = $('#h-stop'), card = $('.stopcard .in');
let shown = -2;
function showStop(i) {
  if (i === shown || i < 0 || i > 6) return;
  shown = i;
  stopBox.className = i % 2 ? 'R' : 'L';
  $('#st-ghost').textContent = '0' + (i + 1);
  flap($('#st-no'), `STOP 0${i + 1} / 07`, 300);
  flap($('#st-name'), STOPS[i].toUpperCase(), 420);
  $('#st-text').textContent = COPY[i][0]; $('#st-reads').textContent = COPY[i][1]; $('#st-flags').textContent = COPY[i][2];
  card.classList.remove('swap'); void card.offsetWidth; card.classList.add('swap');
}

const hero = $('#h-hero'), hint = $('#h-hint'), stripBox = $('#h-strip'), fork = $('#h-fork'), map = $('#h-map'), cta = $('#h-cta');
const forkCards = $$('.verdict', fork), crew = $$('#crew > .stub').slice(0, 4), crewSt = crew.map(c => $('.st', c));
// each card shows the last thing that crew member really did on the shared desk
const ROLES = ['Dispatcher', 'Sizer', 'Signal', 'Guard'];
let CREW_ST = ROLES.map(() => 'no ticket yet');
const crewPoll = async () => { const c = await crewLines(); if (c) CREW_ST = ROLES.map(r => c.lines[r] || 'no ticket yet'); };
crewPoll(); setInterval(crewPoll, 30000);
const show = (node, k, y = 0) => { node.style.opacity = k.toFixed(3); node.style.visibility = k < 0.01 ? 'hidden' : 'visible'; node.style.transform = y ? `translateY(${y.toFixed(1)}px)` : ''; };

const hud = $('#hud'), foot = $('.after'), root0 = document.documentElement;
yard.onFrame((s, t) => {
  const p = s.p;
  // the whole overlay fades as the footer rises, so nothing is ever cut in half
  hud.style.opacity = clamp((foot.getBoundingClientRect().top - innerHeight * 0.62) / (innerHeight * 0.3)).toFixed(3);
  show(hero, clamp(1 - p / 0.07), -p * 900);
  show(hint, clamp(1 - p / 0.03));
  // the stop card rides along with the camera
  const kStop = band(p, 0.105, 0.6, 0.02);
  stopBox.style.opacity = kStop.toFixed(3); stopBox.style.visibility = kStop < 0.01 ? 'hidden' : 'visible';
  stopBox.style.transform = `translateY(-50%)`;
  if (kStop > 0) showStop(clamp(s.stop, 0, 6));
  stripBox.style.opacity = kStop.toFixed(3);
  const f = clamp((s.camZ - GZ[0] + 30) / span);
  $('#strip-fill').style.width = (f * 100).toFixed(2) + '%';
  nodes.forEach((n, i) => n.classList.toggle('on', s.camZ > GZ[i] - 30));
  // fork
  const kFork = band(p, 0.615, 0.79, 0.025);
  show(fork, kFork);
  forkCards.forEach((c, i) => { const k = clamp((p - 0.635 - i * 0.022) / 0.04); c.style.transform = `translateY(${(1 - k) * 90}px) rotateX(${(1 - k) * -50}deg)`; c.style.opacity = k; });
  // map: zones and crew
  show(map, band(p, 0.815, 0.925, 0.025));
  const act = Math.floor(t / 1.7) % 4;
  crew.forEach((c, i) => { c.classList.toggle('act', i === act); flap(crewSt[i], CREW_ST[i], 500); });
  show(cta, clamp((p - 0.935) / 0.03));
  root0.classList.remove('boot');   // every panel has its place now; let them be seen
});
// if the yard never draws a frame, show the panels anyway
setTimeout(() => root0.classList.remove('boot'), 3000);

const track = $('#track');
function onScroll() { yard.setProgress(scrollY / (track.offsetHeight - innerHeight)); }
addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll); onScroll();

$('#cta-form').addEventListener('submit', e => {
  e.preventDefault();
  const a = $('#cta-in').value.trim();
  location.href = '/ticket/' + (isAddr(a) ? '?a=' + a : '');
});

// live departures: the newest pools on the chain, and their names on the trains
const feed = (async () => {
  const box = $('#hb-rows');
  try {
    const { rows, source } = await newPools();
    $('#hb-src').textContent = 'live · ' + source;
    // the fallback feed lists tokens that were recently listed or updated, not the newest pools: say which it is
    if (source === 'DexScreener') $('#hb-what').textContent = 'Recently listed tokens · not the newest pools';
    box.innerHTML = rows.slice(0, 6).map(r => `<a class="r" href="/ticket/?a=${esc(r.addr)}"><span>${ageShort(r.created)}</span><b>${esc(r.sym)}</b><span>${r.liq ? "$" + compact(r.liq) : "···"}</span><em>RIDE →</em></a>`).join('');
    $$('.r b', box).forEach((b, i) => { const txt = b.textContent; b.textContent = ''; setTimeout(() => flap(b, txt.toUpperCase().slice(0, 14)), 200 + i * 130); });
    feedYard(yard, rows);
  } catch (e) {
    $('#hb-src').textContent = 'feed unavailable'; $('#hb-src').classList.remove('live');
    box.innerHTML = '<div class="r"><span></span><b>No feed right now</b></div>';
  }
})();

// The entrance. A first visit to the landing page starts above the approach to the yard, with three signals
// at danger. Each turns green when a real thing has loaded: the typeface, the first frame of the yard, the live
// feed. Then the visitor chooses to come in, and the camera drops onto the rails.
const gate = $('#gate');
if (gate && !document.documentElement.classList.contains('in')) {
  const root = document.documentElement, btn = $('#g-enter');
  root.classList.add('gated'); scrollTo(0, 0); yard.setIntro(1, true);
  // the name is already on screen from the first paint; it shuffles and settles, it never goes blank
  flap($('#g-name'), 'SHUNTDESK', 1100);
  const green = id => $(id).classList.add('ok');
  const type = (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => green('#g-1'));
  const first = new Promise(r => yard.onFrame(() => r())).then(() => new Promise(r => setTimeout(r, 450))).then(() => green('#g-2'));
  // the feed gets five seconds; the entrance does not wait for a slow data service, and does not pretend either
  Promise.race([feed, new Promise(r => setTimeout(r, 5000))]).then(() => { if ($$('#hb-rows a.r').length) green('#g-3'); else { $('#g-3').classList.add('slow'); $('#g-3').lastElementChild.textContent = 'Live feed is slow'; } });
  Promise.all([type, first, new Promise(r => setTimeout(r, 1500))]).then(() => { btn.disabled = false; flap($('#g-clear'), 'LINE CLEAR', 500); $('#g-clear').classList.add('ok'); btn.focus({ preventScroll: true }); });
  const seen = () => { try { sessionStorage.setItem('sd.in', '1'); } catch (e) {} };
  btn.onclick = () => {
    seen(); gate.classList.add('open'); root.classList.remove('gated'); root.classList.add('entering'); yard.setIntro(0);
    setTimeout(() => gate.remove(), 1700); setTimeout(() => root.classList.remove('entering'), 2600);
  };
  $('#g-mani').onclick = seen;   // back from the docs, the way in is already open
} else if (gate) gate.remove();

// the latest Pons graduations, live under the headline
(async function fresh() {
  try {
    let g = await graduates().catch(() => []);
    if (!g.length) { await new Promise(r => setTimeout(r, 4000)); g = await graduates().catch(() => []); }   // one more try after the page settles
    if (!g.length) return;
    $('#h-fresh-list').innerHTML = g.slice(0, 4).map(r => `<span>${esc(r.sym.toUpperCase().slice(0, 9))}<small>${ageShort(r.created)}</small></span>`).join('');
    $('#h-fresh').hidden = false;
  } catch (e) {}
})();