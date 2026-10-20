import { createYard, STOPS, progressAtStop } from './yard.js';
import { mountChrome, $, $$, flap, esc, feedYard } from './ui.js';
import { scan, cachedScan, recentScans, newPools, isAddr, compact, sig, fmtAge, ageShort, EXPLORER, api } from './data.js';
import { saveCard, postUrl } from './share.js';
import { mountWatch, watch, unwatch, watching } from './watch.js';
import { exitDoor } from './door.js';
import { siteCheck } from './sitecheck.js';

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
  second(res); extras(res); devCard(res);
  $('#t-acts').innerHTML = (live ? `<a class="btn ${res.platform === 'short' ? 'r' : res.platform === 'long' ? 'g' : ''}" href="/desk/?a=${res.addr}">Trade it on paper →</a><button class="btn ghost" data-do="ask">Ask the conductor</button>` : '')
    + `<button class="btn ghost" data-do="card">Save the card</button><button class="btn ghost" data-do="x">Post on X</button><button class="btn ghost" data-do="link">Copy link</button><a class="btn ghost" href="${EXPLORER}/token/${res.addr}" target="_blank" rel="noopener">Explorer ↗</a>`
    + (live ? `<button class="btn ghost" data-do="watch">${watching(res.addr) ? 'Watching' : 'Watch'}</button><a class="btn ghost" href="/scan/?a=${res.addr}">Agent Scan</a><a class="btn ghost" href="/hand/?a=${res.addr}">Same Hand</a><a class="btn ghost" href="/deployer/?t=${res.addr}">Deployer record</a><a class="btn ghost" href="/replay/?a=${res.addr}">Replay</a>` : '');
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
  const link = location.origin + '/card/' + shown.addr;   // the card page: a preview image on X and Telegram, then straight to this ticket
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
  $('#t-stamp').classList.remove('in'); $('#t-acts').innerHTML = ''; $('#tkx').hidden = true; $('#t-zone').textContent = ''; $('#t-crew').textContent = ''; $('#cond').hidden = true; typing++;
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
// Exit Door and Lookalikes, under the verdict: what $500 gets back, and how tokens that looked like this one went
const usd = v => v >= 100 ? '$' + Math.round(v).toLocaleString('en-US') : '$' + v.toFixed(2);
const mv = v => v == null ? '···' : (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
let extrasFor = '';
async function extras(res) {
  const box = $('#tkx');
  if (res.verdict === 'NO POOL') { box.hidden = true; return; }
  box.hidden = false; scanCard(res);
  const d = exitDoor(res, 500), top = d?.firsts.find(f => f.key === 'top10');
  $('#dx').innerHTML = !d ? '<p class="note">No pool to sell into.</p>' : `<div class="door-big sm"><span>$500</span><i>→</i><b class="${d.now < 400 ? 'short' : ''}">${usd(d.now)}</b></div>
    <p class="note" style="margin:0">${d.noSell ? 'A SELL FAILS IN SIMULATION: NOTHING COMES BACK.' : top ? `IF THE TEN LARGEST WALLETS SELL FIRST: ${usd(top.back)}` : 'THE HOLDER LIST COULD NOT BE READ'}</p>`;
  $('#dx-a').href = `/exit/?a=${res.addr}&usd=500`;
  if (extrasFor === res.addr) return; extrasFor = res.addr;
  const lk = $('#lk'); lk.innerHTML = '<p class="note">READING THE LOG…</p>';
  let r = null; try { r = await api('looks?a=' + res.addr); } catch (e) {}
  if (extrasFor !== res.addr) return;
  if (!r || !r.ok) { lk.innerHTML = `<p class="note">${esc((r?.why || 'not answering right now').toUpperCase())}.</p>`; return; }
  const day = r.after24h, hr = r.after1h;
  const at = iso => new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).toUpperCase();
  if (!r.base.judged) { lk.innerHTML = `<p class="note">THE LOG STARTED ${r.base.since ? at(r.base.since) : 'JUST NOW'} AND HOLDS ${r.base.logged.toLocaleString('en-US')} TOKENS. THEIR FIRST RESULTS, AN HOUR ON, COME IN AROUND ${r.base.firstHour ? at(r.base.firstHour) : 'THE NEXT HOUR'}; A DAY ON, AROUND ${r.base.firstDay ? at(r.base.firstDay) : 'TOMORROW'}.</p>`; return; }
  if (!r.matches || (!day && !hr)) { lk.innerHTML = `<p class="note">NO CLOSE MATCH YET IN ${r.base.judged.toLocaleString('en-US')} TOKENS WITH A KNOWN RESULT. THE LOG GROWS EVERY HOUR.</p>`; return; }
  const s = day || hr, when = day ? 'A DAY LATER' : 'AN HOUR LATER';
  lk.innerHTML = `<div class="lk-big"><b class="${s.fell50 / s.n >= 0.5 ? 'short' : ''}">${s.fell50} of ${s.n}</b><span>FELL MORE THAN HALF ${when}</span></div>
    <div class="lk-row"><span>Median ${day ? 'a day' : 'an hour'} later<b class="${s.median < 0 ? 'short' : 'long'}">${mv(s.median)}</b></span><span>Rose over 10%<b>${s.rose}</b></span>${day ? `<span>Pool drained<b>${day.drained}</b></span>` : ''}</div>
    <div class="lk-list">${r.closest.slice(0, 4).map(c => `<a href="/replay/?a=${c.token}">${esc(c.symbol || c.token.slice(0, 8))}<b class="${(c.move24h ?? c.move1h) < 0 ? 'short' : 'long'}">${mv(c.move24h ?? c.move1h)}</b></a>`).join('')}</div>
    <p class="note" style="margin:8px 0 0">${!day && r.base.firstDay ? `RESULTS A DAY ON START AROUND ${at(r.base.firstDay)}. ` : ''}${r.ageMin != null && r.ageMin > 360 ? 'THIS TOKEN IS OLDER THAN THE ONES IT IS SET AGAINST, WHICH WERE READ 30 TO 90 MINUTES AFTER LAUNCH. ' : ''}PAST RESULTS OF OTHER TOKENS, NOT A FORECAST.</p>`;
  $('#lk-by').textContent = `${r.matches} closest of ${r.base.judged.toLocaleString('en-US')} tokens logged since ${new Date(r.base.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}
// Dev Ledger, under the verdict: every transfer of this token in or out of the wallet that launched it
let devFor = '';
async function devCard(res) {
  if (devFor === res.addr) return; devFor = res.addr;
  const box = $('#dv'), n0 = v => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v).toLocaleString('en-US');
  let v = null; try { v = await api('ledger?a=' + res.addr); } catch (e) {}
  if (devFor !== res.addr) return;
  if (!v?.ok) { box.innerHTML = `<p class="note">${esc((v?.why || 'not answering right now').toUpperCase())}.</p>`; return; }
  const L = v.ledger, got = L.bought + L.received, pct = x => got > 0 ? ` · ${Math.round(x / got * 100)}%` : '';
  box.innerHTML = [[n0(got), L.received ? 'Bought or received' : 'Bought on the curve'], [n0(L.sold) + pct(L.sold), 'Sold into the curve'], [n0(L.toContracts) + pct(L.toContracts), 'Into other contracts'],
    [n0(L.toWallets) + pct(L.toWallets), 'Sent to other wallets'], [n0(L.burned) + pct(L.burned), 'Burned'], [v.holdsNow == null ? '?' : n0(v.holdsNow), 'Holds now']]
    .map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join('');
  $('#dv-by').innerHTML = `launcher ${v.dev.slice(0, 6)}…${v.dev.slice(-4)}, found from the ${esc(v.devFound)} · <a href="/dev/?w=${v.dev}">every launch by this dev →</a>`;
  $('#dv-n').textContent = (v.partial ? 'The launcher has over 1,000 transfers of it; the first 1,000 are counted. ' : '') + '"Into other contracts" can be a sale through a router or a deposit: the chain index cannot tell which.';
}// Agent Scan, under the verdict: what the contract lets its controller do
let scanFor = '';
async function scanCard(res) {
  if (scanFor === res.addr) return; scanFor = res.addr;
  siteCheck($('#sc'), res.addr, res.links || [], v => { $('#sc-by').textContent = `${v.links.length} link${v.links.length === 1 ? '' : 's'} · ${v.flags.filter(f => f.level === 'high').length} high · Safe Browsing, urlscan.io, RDAP, the page itself`; });
  $('#xs-a').href = '/scan/?a=' + res.addr; $('#xs-sum').textContent = 'Reading the bytecode…'; $('#xs-pw').innerHTML = '';
  let v = null; try { v = await api('xray?a=' + res.addr); } catch (e) {}
  if (scanFor !== res.addr) return;
  if (!v?.ok) { $('#xs-sum').textContent = 'Agent Scan is not answering right now.'; return; }
  $('#xs-sum').textContent = v.summary.text;
  $('#xs-by').textContent = `${v.functions} functions · ${v.proxy ? 'proxy' : 'fixed code'} · ${v.summary.by === 'model' ? 'written by a language model' : 'written by fixed rules'}`;
  const pw = v.powers.filter(p => p.level === 'high' || p.level === 'medium').slice(0, 6);
  $('#xs-pw').innerHTML = pw.map(p => `<div class="xr-r ${p.level}"><em>${p.level.toUpperCase()}</em><code>${esc(p.fn)}</code></div>`).join('');
}