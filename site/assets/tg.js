// /tg/: the Telegram mini app. Check a token in place (the same seven checks as the ticket), play Rug or Ride on real
// tokens, watch $SHUNT and the curves live, keep one handle for every game. Telegram's own theme, haptics and back button.
import { scan, isToken, normAddr, recentScans, api, compact, sig, esc, ageShort } from './data.js';
import { watch, watching, watchCode } from './watch.js';

const tg = window.Telegram?.WebApp; try { tg?.ready(); tg?.expand(); tg?.setHeaderColor?.('#060708'); tg?.setBackgroundColor?.('#060708'); } catch (e) {}
const $ = id => document.getElementById(id), buzz = k => { try { tg?.HapticFeedback?.[k === 'tap' ? 'selectionChanged' : 'notificationOccurred'](k === 'tap' ? undefined : k); } catch (e) {} };
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const user = tg?.initDataUnsafe?.user, handle0 = (user?.username || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16);
const handle = () => store.get('sd.bg.h') || handle0 || '';
$('hi').textContent = user?.first_name ? 'GM, ' + user.first_name.toUpperCase().slice(0, 14) : '';

// ---------- tabs, and the back button inside a tab's sub-screen ----------
let tab = 'check';
function show(t) { tab = t; document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === 't-' + t)); document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); buzz('tap'); scrollTo(0, 0); if (t === 'live') live(); if (t === 'me') me(); }
$('nav').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (b) show(b.dataset.t); });

// ---------- $SHUNT on the ticker ----------
const SHUNT = '0x7e517e779b85895894becad80c9bb69b4cb1c4d6';
let shuntNow = null;
async function ticker() {
  try {
    const [c, w] = await Promise.all([api('sim?a=' + SHUNT).catch(() => null), api('weekly').catch(() => null)]);
    const mc = c?.ok ? c.quoteEth / c.tokens * 1e9 * c.ethUsd : null;
    shuntNow = { mc, progress: c?.progress, raised: c?.raised, need: c?.need, burned: w?.shunt?.burnedAll, sold: w?.shunt?.sold };
    $('tick').innerHTML = `<span><b>$SHUNT</b></span>${mc ? `<span>MC <b>$${compact(mc)}</b></span>` : ''}${c?.ok ? `<span>CURVE <b class="g">${c.progress.toFixed(1)}%</b></span>` : ''}${w?.shunt ? `<span>BURNED <b>${compact(w.shunt.burnedAll)}</b></span><span>DEV SOLD <b class="g">0</b></span>` : ''}`;
  } catch (e) {}
}
ticker(); setInterval(ticker, 60000);

// ---------- Check: the seven checks, stop by stop, right here ----------
const NAMES = ['Sources', 'Gate', 'Scout', 'Tracer', 'Linker', 'Auditor', 'Judge'];
let job = 0;
async function check(a) {
  const id = ++job; a = normAddr(a); buzz('tap');
  $('res').innerHTML = `<div class="card"><div class="facts" style="margin:0"><div><span>TOKEN</span>${esc(a.slice(0, 6) + '…' + a.slice(-4))}</div><div><span>READING</span>public chain data</div></div><div class="stops" id="stops">${NAMES.map((n, i) => `<div class="stop${i ? '' : ' run'}" id="sp${i}"><span>${n}</span><b></b></div>`).join('')}</div></div>`;
  let res;
  try { res = await scan(a, (s, i) => { if (id !== job) return; const el = $('sp' + i); if (!el) return; el.className = 'stop ' + s.status; el.querySelector('b').textContent = s.tag; const nx = $('sp' + (i + 1)); if (nx && s.tag !== 'NO POOL') nx.classList.add('run'); }); }
  catch (e) { if (id === job) $('res').innerHTML = `<div class="card"><p class="s" style="margin:0">The line stopped: ${esc(e.message)}. Try again in a minute.</p></div>`; return; }
  if (id !== job) return;
  const v = res.verdict, sol = res.chain === 'solana';
  buzz(v === 'CLEAN' ? 'success' : v === 'DANGER' || v === 'NO POOL' ? 'error' : 'warning');
  const fact = (k, x) => `<div><span>${k}</span>${x}</div>`;
  const top = res.steps.filter(s => s.status === 'bad' || s.status === 'warn').slice(0, 3).map(s => `<p class="s" style="margin:6px 0 0">· ${esc(s.detail.split(/(?<=\.)\s/)[0])}</p>`).join('');
  $('res').innerHTML = `<div class="card"><div class="verdict"><div class="stamp ${v === 'NO POOL' ? 'DANGER' : v}">${v === 'NO POOL' ? 'NO POOL' : v + ' ' + res.score}</div><div><div style="font:900 30px/1 'Big Shoulders Display'">${esc(res.sym || '')}</div><div class="note" style="margin:4px 0 0">${sol ? 'SOLANA' : 'ROBINHOOD CHAIN'}</div></div></div>
    ${v !== 'NO POOL' ? `<div class="facts">${fact('PRICE', res.price ? '$' + sig(res.price) : '—')}${fact('LIQUIDITY', res.liq != null ? '$' + compact(res.liq) : '—')}${fact('HOLDERS', res.holders != null ? res.holders.toLocaleString('en-US') : '—')}${fact('TOP 10', res.top10 != null ? res.top10.toFixed(1) + '%' : '—')}</div>` : ''}
    <div class="stops">${res.steps.slice(0, 6).map(s => `<div class="stop ${s.status}"><span>${esc(s.name)}</span><b>${esc(s.tag)}</b></div>`).join('')}</div>${top}
    ${!sol && v !== 'NO POOL' ? `<div class="row2"><a class="btn ghost" href="/profit/?a=${res.addr}">Who is in profit</a><a class="btn ghost" href="/ticket/?a=${res.addr}#fw">Fresh wallets</a></div>` : ''}
    <div class="row2"><a class="btn" href="/ticket/?a=${res.addr}">Full ticket</a>${v !== 'NO POOL' ? `<button class="ghost" id="w">${watching(res.addr) ? 'Watching' : 'Watch'}</button>` : ''}<button class="ghost" id="sh">Share</button></div></div>`;
  $('w')?.addEventListener('click', e => { if (!watching(res.addr)) { watch(res); e.target.textContent = 'Watching'; buzz('success'); } });
  $('sh').addEventListener('click', () => { const u = location.origin + '/card/' + res.addr, t = `${res.sym} on Shuntdesk: ${v} ${res.score}/100`; try { tg?.openTelegramLink?.(`https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`) ?? open(u); } catch (x) { open(u); } });
  recent();
}
$('f').addEventListener('submit', e => { e.preventDefault(); const a = $('a').value.trim(); if (isToken(a)) check(a); else { $('a').value = ''; $('a').placeholder = 'not a token address: 0x… or a Solana mint'; buzz('error'); } });
function recent() { const r = recentScans().slice(0, 6); $('recent').innerHTML = r.length ? r.map(x => `<a href="#" data-a="${x.addr}"><span>${esc(x.sym || x.addr.slice(0, 8))}<small> · ${ageShort(x.at)} ago</small></span><b class="${x.verdict}">${x.verdict} ${x.verdict === 'NO POOL' ? '' : x.score}</b></a>`).join('') : '<p class="s">Nothing checked yet on this phone.</p>'; }
$('recent').addEventListener('click', e => { const a = e.target.closest('a[data-a]'); if (a) { e.preventDefault(); $('a').value = a.dataset.a; check(a.dataset.a); } });
recent();
const start = new URLSearchParams(location.search).get('a') || tg?.initDataUnsafe?.start_param || '';
if (isToken(start)) { $('a').value = start; check(start); }

// ---------- Wallet Wrapped: a wallet's week on Pons as its card, shared straight into a chat ----------
$('wf').addEventListener('submit', async e => {
  e.preventDefault(); const w = $('wa').value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(w)) { $('wa').value = ''; $('wa').placeholder = 'a Robinhood Chain wallet: 0x…'; buzz('error'); return; }
  buzz('tap'); $('wres').innerHTML = '<p class="s" style="margin:10px 0 0">Reading the week from the chain…</p>';
  let v = null; try { v = await api('wrapped?w=' + w); } catch (x) {}
  if (!v?.ok) { $('wres').innerHTML = `<p class="s" style="margin:10px 0 0">${esc(v?.error || 'Could not read it right now.')}</p>`; buzz('error'); return; }
  if (!v.tokens) { $('wres').innerHTML = '<p class="s" style="margin:10px 0 0">No buy or sell of a Pons token by this wallet in the last seven days.</p>'; return; }
  const link = location.origin + '/card/wrapped/' + w, t = `My week on Pons: ${v.pnl >= 0 ? '+' : ''}${v.pnl.toFixed(4)} ETH across ${v.tokens} tokens`;
  $('wres').innerHTML = `<img src="/card/wrapped/${w}.png?h=${Math.floor(Date.now() / 1800000)}" alt="Wallet Wrapped card" style="width:100%;border-radius:8px;margin-top:12px;display:block;aspect-ratio:1200/630;background:#0b0c0e"><div class="row2"><button id="wsh">Share</button><a class="btn ghost" href="/wrapped/?w=${w}">Every token</a></div>`;
  buzz(v.pnl >= 0 ? 'success' : 'warning');
  $('wsh').addEventListener('click', () => { const u = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t)}`; try { tg?.openTelegramLink ? tg.openTelegramLink(u) : open(u); } catch (x) { open(u); } });
});

// ---------- Rug or Ride: ten real tokens, names hidden; the server already knows how each one went ----------
let run = null, calls = [];
const best = () => Number(store.get('sd.rr.best') || 0);
$('rr-best').textContent = best() ? 'BEST ' + best() + '/10' : '';
async function rrStart() {
  $('rr').innerHTML = '<p class="s" style="margin:0">Pulling ten tokens off the log…</p>'; buzz('tap');
  try { run = await api('rugrun'); } catch (e) { run = null; }
  if (!run?.ok) { $('rr').innerHTML = `<p class="s">${esc(run?.why || 'Not answering right now')}.</p><button id="rr-go" style="width:100%">Try again</button>`; $('rr-go').onclick = rrStart; return; }
  calls = []; rrCard();
}
function rrCard() {
  const i = calls.length, x = run.tokens[i];
  if (!x) return rrSend();
  const kv = (k, v) => `<div><b>${v}</b><span>${k}</span></div>`;
  $('rr').innerHTML = `<div class="n">TOKEN ${i + 1} OF ${run.tokens.length}</div><div class="big">${x.launchpad === 'pons' ? 'ON PONS' : 'NEW TOKEN'}</div><div class="note" style="margin:0">${x.age} MIN OLD WHEN READ · SITE: ${esc(String(x.site).toUpperCase())}</div>
    <div class="kv">${kv('HOLDERS', x.holders)}${kv('TOP 10', x.top10.toFixed(0) + '%')}${kv('LIQUIDITY', '$' + compact(x.liquidity))}${kv('SNIPERS', x.snipers.toFixed(1) + '%')}${kv('BUNDLES', x.bundles.toFixed(1) + '%')}${kv('DEV', x.dev.toFixed(1) + '%')}</div>
    <div class="flags">${x.flags.length ? esc(x.flags.join(' · ')) : 'no flag raised'}</div>
    <div class="go"><button class="rug" data-c="1">RUG</button><button data-c="0">RIDE</button></div>
    <div class="dots">${run.tokens.map((_, k) => `<i class="${k < i ? 'c' : ''}"></i>`).join('')}</div>`;
  $('rr').querySelector('.go').addEventListener('click', e => { const b = e.target.closest('button[data-c]'); if (!b) return; calls.push(b.dataset.c === '1'); buzz('tap'); rrCard(); });
}
async function rrSend() {
  const h = handle() || 'tg_' + (user?.id ? String(user.id).slice(-6) : Math.floor(Math.random() * 1e6));
  $('rr').innerHTML = '<p class="s" style="margin:0">Asking the chain how they went…</p>';
  let r = null; try { r = await api('rugrun', { id: run.id, handle: h, calls }); } catch (e) {}
  if (!r?.ok) { $('rr').innerHTML = `<p class="s">${esc(r?.why || 'Not answering right now')}.</p><button id="rr-go" style="width:100%">New run</button>`; $('rr-go').onclick = rrStart; return; }
  if (r.right > best()) store.set('sd.rr.best', r.right); $('rr-best').textContent = 'BEST ' + Math.max(best(), r.right) + '/10';
  buzz(r.right >= 7 ? 'success' : r.right >= 4 ? 'warning' : 'error');
  const pc = v => v == null ? 'no result yet' : (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
  $('rr').innerHTML = `<div class="n">YOUR RUN</div><div class="big">${r.right} / ${r.results.filter(x => x.move24h !== null).length || r.of}</div><p class="s">read right, a day later · as ${esc(h)}</p>
    <div class="list" style="text-align:left">${r.results.map((x, i) => `<a href="/ticket/?a=${x.token}"><span>${esc(x.symbol || x.token.slice(0, 8))}<small> · you said ${calls[i] ? 'rug' : 'ride'}</small></span><b class="${x.move24h == null ? '' : x.rug ? 'DANGER' : 'CLEAN'}">${pc(x.move24h)}</b></a>`).join('')}</div>
    <h2 style="margin-top:18px">This week's board</h2><div class="list" style="text-align:left">${(r.board || []).slice(0, 10).map((b, i) => `<div class="r"><span>${i + 1}. ${esc(b.handle)}${b.handle === h ? ' <small>· you</small>' : ''}${b.holder ? ' <small>· holder</small>' : ''}</span><b>${b.best}/10</b></div>`).join('') || '<p class="s">You are the first this week.</p>'}</div>
    <div class="row2"><button id="rr-go">Another run</button><button class="ghost" id="rr-sh">Share my score</button></div>`;
  $('rr-go').onclick = rrStart;
  // the score goes to any chat the player picks, the group included, with the link to play
  const place = (r.board || []).findIndex(b => b.handle === h) + 1;
  $('rr-sh').onclick = () => { const t = `I read ${r.right} of 10 right on Rug or Ride${place ? `, #${place} on this week's board` : ''}. Ten real Robinhood Chain tokens, names hidden: rug or ride?`, u = 'https://t.me/shuntdesk_bot';
    buzz('tap'); try { tg?.openTelegramLink ? tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`) : open(`https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`); } catch (x) {} };
}
$('rr-go').onclick = rrStart;

// ---------- Live: $SHUNT, the curves closest to bonding, the latest calls ----------
async function live() {
  const s = shuntNow;
  $('shunt').innerHTML = !s ? '<p class="s">Reading…</p>' : `<div class="facts" style="margin:0"><div><span>MARKET CAP</span>${s.mc ? '$' + compact(s.mc) : '—'}</div><div><span>BURNED IN ALL</span>${s.burned ? compact(s.burned) : '—'}</div><div><span>CURVE</span>${s.progress != null ? s.progress.toFixed(1) + '% · ' + s.raised.toFixed(2) + ' of ' + s.need + ' ETH' : '—'}</div><div><span>SOLD BY THE DEV</span>0</div></div>${s.progress != null ? `<div class="bar"><u style="width:${s.progress}%"></u></div>` : ''}
    <div class="row2"><a class="btn" href="/ticket/?a=${SHUNT}">Its ticket</a><a class="btn ghost" href="/proof/">Proof</a></div>`;
  hot(); try { const h = await api('hunters'); $('hunt').innerHTML = (h.inNow || []).slice(0, 5).map(c => `<a href="/profit/?a=${c.token}"><span>${esc(c.symbol)}<small> · curve ${c.progress ?? '?'}%</small></span><b>${c.hunters.length} hunters</b></a>`).join('') || '<p class="s">None of the board is early in an open curve right now.</p>'; } catch (e) {}
  try { const b = await api('bonds'); $('bonds').innerHTML = (b.rows || []).slice(0, 6).map(r => `<a href="/ticket/?a=${r.token}"><span>${esc(r.symbol)}<small> · ${ageShort(Date.parse(r.launched))}</small></span><b>${r.progress}%</b></a>`).join('') || '<p class="s">No curve near the mark.</p>'; } catch (e) {}
  try { const v = await api('v1/verdicts'); $('calls').innerHTML = (v.verdicts || []).slice(0, 6).map(x => `<a href="/ticket/?a=${x.token}"><span>${esc(x.symbol)}<small> · ${ageShort(Date.parse(x.at))} ago</small></span><b class="${x.verdict}">${x.verdict} ${x.score}</b></a>`).join(''); } catch (e) {}
}

// the curves taking in the most ETH net of sells in the last ten minutes, read by this phone from the public node
const T_BUY = '0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455', T_SELL = '0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df';
async function hot() {
  try {
    const node = async (method, params) => { const j = await (await fetch('https://rpc.mainnet.chain.robinhood.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json(); if (j.error) throw new Error(j.error.message); return j.result; };
    const head = parseInt(await node('eth_blockNumber', []), 16), q = t => node('eth_getLogs', [{ topics: [t], fromBlock: '0x' + (head - 6000).toString(16), toBlock: '0x' + head.toString(16) }]);
    const [buys, sells, map] = await Promise.all([q(T_BUY), q(T_SELL), api('tapemap').catch(() => ({ curves: {} }))]);
    const w = (d, i) => Number(BigInt('0x' + d.slice(2 + 64 * i, 66 + 64 * i)) / 10n ** 12n) / 1e6, net = new Map();
    for (const [ls, k, s] of [[buys, 0, 1], [sells, 1, -1]]) for (const l of ls) { const c = l.address.toLowerCase(), x = net.get(c) || { c, eth: 0, n: 0 }; x.eth += s * w(l.data, k); x.n++; net.set(c, x); }
    const top = [...net.values()].filter(x => x.eth > 0 && map.curves[x.c]).sort((a, b) => b.eth - a.eth).slice(0, 5);
    $('hot').innerHTML = top.map(x => { const [t, s, , p] = map.curves[x.c]; return `<a href="/profit/?a=${t}"><span>${esc(s || t.slice(0, 8))}<small> · ${x.n} trades${p != null ? ' · curve ' + p + '%' : ''}</small></span><b class="g">+${x.eth.toFixed(3)} ETH</b></a>`; }).join('') || '<p class="s">No curve took in more than it paid out in the last ten minutes.</p>';
  } catch (e) { $('hot').innerHTML = '<p class="s">The node did not answer. Open <a href="/tape/">The Tape</a>.</p>'; }
}

// ---------- Me: one handle for every game, the Season Pass, the watchlist ----------
async function me() {
  const h = handle(); $('h').value = h; $('me-name').textContent = h || (user?.first_name || 'Guest');
  const code = watchCode(); $('me-watch').innerHTML = code ? `<div class="facts" style="margin:0"><div><span>YOUR CODE</span>${esc(code)}</div><div><span>IN THIS GROUP</span>/watchlist ${esc(code)}</div></div>` : $('me-watch').innerHTML;
  if (!h) { $('me-xp').innerHTML = ''; return; }
  try { const v = await api('season?me=' + encodeURIComponent(h)); if (v?.ok) $('me-xp').innerHTML = `<div><span>XP THIS WEEK</span>${v.me ? v.me.xp.toLocaleString('en-US') : 0}</div><div><span>RANK</span>${esc(v.me?.rank || 'Rookie')}</div><div><span>TOURNAMENT</span>${esc(v.tournament?.name || '—')}</div><div><span>RUG OR RIDE BEST</span>${best() ? best() + '/10' : '—'}</div>`; } catch (e) {}
}
$('hf').addEventListener('submit', e => { e.preventDefault(); const h = $('h').value.trim().toLowerCase(); if (!/^[a-z0-9_]{2,16}$/.test(h)) { buzz('error'); $('h').value = ''; $('h').placeholder = '2 to 16 letters, digits or _'; return; } store.set('sd.bg.h', h); buzz('success'); me(); });
if (!store.get('sd.bg.h') && handle0) store.set('sd.bg.h', handle0);
