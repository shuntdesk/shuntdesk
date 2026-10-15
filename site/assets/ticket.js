import { createYard, STOPS, progressAtStop } from './yard.js';
import { mountChrome, $, $$, flap, esc, feedYard } from './ui.js';
import { scan, cachedScan, recentScans, newPools, isAddr, compact, sig, fmtAge, ageShort, EXPLORER, api } from './data.js';
import { saveCard, postUrl } from './share.js';
import { mountWatch, watch, unwatch, watching } from './watch.js';

mountChrome('Ticket');
const paintWatch = mountWatch(document.getElementById('watch'));
// here the yard is not just a backdrop: the camera rides to each gantry as that check reports
document.body.classList.add('tk3d');
const yard = createYard($('#yard'));
yard.setProgress(0.035); feedYard(yard);
const route = $('#route'), msg = $('#msg');
STOPS.forEach((s, i) => route.insertAdjacentHTML('beforeend', `<div class="stop" data-s="pending"><div class="hd"><i>0${i + 1}</i><h3>${s}</h3><span class="tag"></span></div><p></p><div class="fx"></div></div>`));
const stops = $$('.stop', route);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let run = 0;

function moveCar(i) {
  yard.setProgress(progressAtStop(i));
  const n = stops[Math.min(i, 6)], y = n.offsetTop;
  $('#car').style.transform = `translateY(${y}px)`;
  $('#fillv').style.height = y + 'px';
}
function paintStop(i, s) {
  const n = stops[i];
  n.dataset.s = s.status;
  const tag = $('.tag', n); tag.className = 'tag ' + (i === 6 ? s.tag.split(' ')[0] : s.status); flap(tag, s.tag, 380);
  $('p', n).textContent = s.detail;
  $('.fx', n).innerHTML = (s.facts || []).map(f => `<span>${esc(f[0])}<b>${esc(f[1])}</b></span>`).join('');
}
function paintCard(res, done) {
  $('#t-no').textContent = 'TICKET ' + res.addr.slice(2, 6).toUpperCase();
  flap($('#t-sym'), (res.sym || '······').toUpperCase().slice(0, 9));
  $('#t-ad').textContent = res.addr;
  const rows = [['Price', res.price != null ? '$' + sig(res.price) : '…'], ['Liquidity', res.liq != null ? '$' + compact(res.liq) : '…'], ['Pool age', res.ageMin != null ? fmtAge(res.ageMin) : '…'], ['Holders', res.holders != null ? res.holders.toLocaleString('en-US') : '…']];
  $('#t-facts').innerHTML = rows.map(r => `<div><span>${r[0]}</span><b>${esc(r[1])}</b></div>`).join('');
  if (!done) return;
  const col = res.verdict === 'CLEAN' ? 'var(--long)' : res.verdict === 'RISKY' ? '#a9acb2' : 'var(--short)';
  const st = $('#t-stamp'); st.textContent = res.verdict === 'NO POOL' ? 'NO POOL' : `${res.verdict} ${res.score}`; st.style.color = col; st.classList.remove('in'); void st.offsetWidth; st.classList.add('in');
  const card = $('#card'); card.className = 'stub tkstub ' + (res.verdict === 'CLEAN' ? 'g' : res.verdict === 'RISKY' ? 'n' : 'r');
  const pl = $('#t-plat'); pl.className = 'plat ' + (res.platform === 'depot' ? '' : res.platform);
  pl.firstElementChild.textContent = res.verdict === 'NO POOL' ? 'Never left the station' : res.platform === 'long' ? 'Sent to the long desk' : res.platform === 'short' ? 'Sent to the short desk' : 'Sent to the depot';
  $('#t-zone').textContent = res.maxLev ? `Zone ${res.zone} · max ${res.maxLev}x` : '';
  shown = res;
  const live = res.verdict !== 'NO POOL';
  $('#t-crew').textContent = !live || !res.crew ? '' : 'CREW DESK: ' + ({ offline: 'NOT ANSWERING', 'no answer': 'NO ANSWER YET' }[res.crew] || res.crew.toUpperCase());
  second(res);
  $('#t-acts').innerHTML = (live ? `<a class="btn ${res.platform === 'short' ? 'r' : res.platform === 'long' ? 'g' : ''}" href="/desk/?a=${res.addr}">Trade it on paper →</a><button class="btn ghost" data-do="ask">Ask the conductor</button>` : '')
    + `<button class="btn ghost" data-do="card">Save the card</button><button class="btn ghost" data-do="x">Post on X</button><button class="btn ghost" data-do="link">Copy link</button><a class="btn ghost" href="${EXPLORER}/token/${res.addr}" target="_blank" rel="noopener">Explorer ↗</a>`
    + (live ? `<button class="btn ghost" data-do="watch">${watching(res.addr) ? 'Watching' : 'Watch'}</button><a class="btn ghost" href="/deployer/?t=${res.addr}">Deployer record</a>` : '');
}
// the conductor puts the verdict in plain words, typed out
let shown = null, typing = 0;
async function ask(q = '') {
  const box = $('#cond'), out = $('#cond-text'), id = ++typing;
  box.hidden = false; out.textContent = ''; $('#cond-by').textContent = 'thinking';
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  let r; try { r = await api('explain', { q, addr: shown.addr, sym: shown.sym, verdict: shown.verdict, score: shown.score, platform: shown.platform, steps: shown.steps.map(s => ({ name: s.name, status: s.status, tag: s.tag, detail: s.detail })) }); } catch (e) { r = null; }
  if (id !== typing) return;
  if (!r || !r.text) { $('#cond-by').textContent = 'not answering'; out.textContent = 'The conductor is not answering right now. The reasons are all listed in the route above.'; return; }
  $('#cond-by').textContent = r.by === 'model' ? 'written by a language model from the findings above' : 'written from the findings above by fixed rules';
  for (let i = 1; i <= r.text.length && id === typing; i++) { out.textContent = r.text.slice(0, i); if (i % 3 === 0) await sleep(14); }
}
$('#cond-form').addEventListener('submit', e => { e.preventDefault(); const q = $('#cond-q').value.trim(); if (q && shown) ask(q); });
$('#t-acts').addEventListener('click', async e => {
  const b = e.target.closest('[data-do]'); if (!b || !shown) return;
  const link = location.origin + '/ticket/?a=' + shown.addr;
  if (b.dataset.do === 'ask') ask();
  if (b.dataset.do === 'card') { b.textContent = 'Drawing…'; const how = await saveCard(shown).catch(() => 'failed'); b.textContent = how === 'saved' ? 'Saved' : how === 'shared' ? 'Shared' : 'Save the card'; }
  if (b.dataset.do === 'x') window.open(postUrl(shown, link), '_blank', 'noopener');
  if (b.dataset.do === 'watch') { if (watching(shown.addr)) { unwatch(shown.addr); b.textContent = 'Watch'; } else { watch(shown); b.textContent = 'Watching'; } paintWatch(); }
  if (b.dataset.do === 'link') { try { await navigator.clipboard.writeText(link); b.textContent = 'Copied'; } catch (x) { b.textContent = link; } }
});

async function ride(addr, fresh) {
  const id = ++run;
  addr = addr.toLowerCase();
  history.replaceState(null, '', '?a=' + addr);
  $('#a').value = addr; $('#tk').hidden = false;
  stops.forEach(n => { n.dataset.s = 'pending'; $('.tag', n).textContent = ''; $('.tag', n).className = 'tag'; $('p', n).textContent = ''; $('.fx', n).innerHTML = ''; });
  $('#t-stamp').classList.remove('in'); $('#t-acts').innerHTML = ''; $('#t-zone').textContent = ''; $('#t-crew').textContent = ''; $('#cond').hidden = true; typing++;
  $('#t-plat').className = 'plat'; $('#t-plat').firstElementChild.textContent = 'On the line'; $('#card').className = 'stub tkstub';
  paintCard({ addr }, false); moveCar(0);
  const cached = fresh ? null : cachedScan(addr);
  const queue = []; let finished = null, shownN = 0;
  $('#rt-state').textContent = cached ? `from this browser, ${ageShort(cached.at)} ago` : 'running';
  msg.textContent = cached ? 'SHOWING THE SAVED RESULT · PRESS THE BUTTON AGAIN TO RE-RUN' : 'READING PUBLIC CHAIN DATA…';
  stops[0].dataset.s = 'run';
  const feed = cached ? Promise.resolve(cached).then(r => { r.steps.forEach(s => queue.push([s, r])); return r; }) : scan(addr, (s, i, r) => queue.push([s, { ...r }]));
  feed.then(r => { finished = r; }).catch(e => { finished = { error: e.message }; });
  // show stops one at a time, so the ride can be followed
  while (id === run) {
    if (queue.length) {
      const [s, r] = queue.shift();
      paintStop(shownN, s); paintCard(r, false); shownN++;
      if (shownN < 7 && s.tag !== 'NO POOL') { stops[shownN].dataset.s = 'run'; moveCar(shownN); }
      await sleep(cached ? 170 : 520);
    } else if (finished) break;
    else await sleep(120);
  }
  if (id !== run) return;
  if (finished.error) { msg.textContent = 'THE LINE STOPPED: ' + finished.error.toUpperCase(); $('#rt-state').textContent = 'stopped'; return; }
  paintCard(finished, true);
  // climb over the fork and send this token down its branch
  if (finished.verdict !== 'NO POOL') { yard.setProgress(0.705); yard.setTokens([0, 1, 2].map(() => ({ sym: (finished.sym || '').toUpperCase().slice(0, 8), to: finished.platform }))); }
  $('#rt-state').textContent = cached ? `from this browser, ${ageShort(finished.at)} ago` : 'arrived';
  msg.textContent = 'RULE-BASED VERDICT FROM PUBLIC DATA · IT CAN BE WRONG · NOT ADVICE';
  recent();
}

let last = '';
$('#f').addEventListener('submit', e => {
  e.preventDefault();
  const a = $('#a').value.trim();
  if (!isAddr(a)) { msg.textContent = 'THAT IS NOT A TOKEN ADDRESS. IT SHOULD BE 0x FOLLOWED BY 40 HEX CHARACTERS.'; return; }
  ride(a, a.toLowerCase() === last); last = a.toLowerCase();
});

async function recent() {
  const box = $('#sugg'), mine = recentScans().slice(0, 4);
  let html = mine.map(r => `<span class="chip" data-a="${r.addr}">${esc(r.sym)}<b>${r.verdict} ${r.score}</b></span>`).join('');
  box.innerHTML = html;
  try {
    const { rows } = await newPools();
    const seen = new Set(mine.map(r => r.addr));
    html += rows.filter(r => !seen.has(r.addr)).slice(0, 6 - mine.length + 2).map(r => `<span class="chip" data-a="${r.addr}">${esc(r.sym)}<b>${ageShort(r.created)}</b></span>`).join('');
    box.innerHTML = html;
  } catch (e) {}
}
$('#sugg').addEventListener('click', e => { const c = e.target.closest('.chip'); if (c) { last = c.dataset.a; ride(c.dataset.a, false); } });

const q = new URLSearchParams(location.search).get('a');
recent();
if (isAddr(q)) { last = q.toLowerCase(); ride(q, false); }

// ChargeAI's read for Pons launches: asked once per ticket, shown beside the verdict, never mixed into it
let secondFor = '';
async function second(res) {
  const box = $('#second');
  if (!res.launch || res.launch.pad !== 'pons' || res.verdict === 'NO POOL') { box.hidden = true; return; }
  if (secondFor === res.addr && !box.hidden) return; secondFor = res.addr;
  box.hidden = false; $('#sec-text').textContent = 'Asking ChargeAI…';
  let r = null; try { r = await api('second', { addr: res.addr, sym: res.sym, ageMin: res.ageMin, holders: res.holders, top10: res.top10, liq: res.liq }); } catch (e) {}
  if (secondFor !== res.addr) return;
  if (!r || !r.ok) { $('#sec-text').textContent = 'ChargeAI is not answering right now' + (r?.why ? ` (${r.why})` : '') + '.'; return; }
  $('#sec-text').textContent = r.text;
  $('#sec-by').textContent = `${r.model} via ${r.via}, read at ${new Date(r.t).toTimeString().slice(0, 5)}`;
}