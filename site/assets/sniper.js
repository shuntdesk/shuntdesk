// /sniper/: Paper Sniper. New Pons launches read straight from the chain in this browser; a snipe is a paper buy at the
// price the curve quotes, priced again by the server an hour later
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api, rpc } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const PONS = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e', T_LAUNCH = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const short = a => a.slice(0, 6) + '…' + a.slice(-4), pc = v => v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(0) + '%';
const ago = iso => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 90 ? s + 's ago' : Math.round(s / 60) + 'm ago'; };
const feed = new Map();   // token → { token, symbol, launched, progress }
let v = null, from = null;

async function symbolOf(a) { try { const h = (await rpc('eth_call', [{ to: a, data: '0x95d89b41' }, 'latest'])).slice(2); const n = parseInt(h.slice(64, 128), 16); return new TextDecoder().decode(Uint8Array.from(h.slice(128, 128 + n * 2).match(/../g) || [], b => parseInt(b, 16))).replace(/[^\x20-\x7e]/g, '').slice(0, 14) || '?'; } catch (e) { return '?'; } }
// the factory's launch log, read here every fifteen seconds: a launch shows up within a block or two
async function scan() {
  try {
    const head = parseInt(await rpc('eth_blockNumber'), 16); if (from === null) from = head - 600;
    if (head > from) { const lo = Math.max(from + 1, head - 2000), logs = await rpc('eth_getLogs', [{ address: PONS, topics: [T_LAUNCH], fromBlock: '0x' + lo.toString(16), toBlock: '0x' + head.toString(16) }]);
      for (const l of logs) { const t = '0x' + l.topics[1].slice(26); if (!feed.has(t)) feed.set(t, { token: t, symbol: await symbolOf(t), launched: new Date().toISOString(), progress: null, chain: true }); }
      from = head; }
    $('#sn-state').textContent = `watching the Pons factory · block ${head.toLocaleString('en-US')}`;
  } catch (e) { $('#sn-state').textContent = 'the node did not answer: trying again'; }
  for (const x of [...feed.values()].filter(x => x.progress == null).slice(0, 4)) try { const c = await (await fetch('/api/sim?a=' + x.token)).json(); x.progress = c.ok ? c.progress : -1; } catch (e) {}
  paintFeed();
}
function paintFeed() {
  const list = [...feed.values()].filter(x => x.progress === null || (x.progress >= 0 && x.progress < 5)).sort((a, b) => Date.parse(b.launched) - Date.parse(a.launched)).slice(0, 12);
  $('#sn-feed').innerHTML = '<div class="r h"><span>NEW LAUNCH</span><span>SEEN</span><span>CURVE</span><span></span></div>' + (list.length ? list.map(x => `<div class="r"><a class="sy" href="/ticket/?a=${x.token}">$${esc(x.symbol || '?')}<small>${short(x.token)}</small></a><span>${ago(x.launched)}</span><span>${x.progress == null ? '···' : x.progress.toFixed(1) + '%'}</span><button type="button" class="btn ghost" data-t="${x.token}" data-s="${esc(x.symbol || '')}">Snipe</button></div>`).join('')
    : '<p class="note" style="margin:10px 0">Waiting for the next launch: they come every few minutes.</p>');
}
function paint() {
  const m = v.mine; for (const x of v.fresh) if (!feed.has(x.token)) feed.set(x.token, { ...x });
  $('#sn-mine').innerHTML = m && (m.open.length || m.closed.length) ? [...m.open.map(x => `<p>⏳ $${esc(x.symbol || short(x.token))} · in at ${x.entryProgress}% · priced at ${new Date(x.closes).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>`), ...m.closed.map(x => `<p>${x.ret == null ? '○' : x.ret >= 0 ? '<b class="long">' + pc(x.ret) + '</b>' : '<b class="short">' + pc(x.ret) + '</b>'} $${esc(x.symbol || short(x.token))}${x.bonded ? ' · bonded' : ''}${x.ret == null ? ' · no price read' : ' · ' + x.pts + ' pts'}</p>`)].join('') : '<p>Snipe a launch to see it here.</p>';
  $('#sn-board').innerHTML = v.board.length ? v.board.map((b, i) => `<p>${i + 1}. ${esc(b.handle)}${b.holder ? ' <b class="long">HOLDER</b>' : ''} · <b>${b.pts}</b></p>`).join('') : '<p>Nobody yet this week.</p>';
  $('#sn-note').textContent = v.note; paintFeed();
}
async function load() { const me = store.get('sd.bg.h') || ''; if (me && !$('#sn-h').value) $('#sn-h').value = me; try { v = await api('snipe?me=' + encodeURIComponent(me)); } catch (e) {} if (v?.ok) paint(); }
$('#sn-feed').addEventListener('click', async e => {
  const b = e.target.closest('button[data-t]'); if (!b) return; const h = $('#sn-h').value.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,16}$/.test(h)) return $('#sn-msg').textContent = 'TYPE YOUR HANDLE FIRST: 2 TO 16 LETTERS, DIGITS OR _.';
  b.disabled = true; b.textContent = 'Sniping…';
  let r = null; try { r = await api('snipe', { handle: h, token: b.dataset.t, symbol: b.dataset.s }); } catch (x) {}
  if (r?.ok) { store.set('sd.bg.h', h); $('#sn-msg').textContent = `SNIPED AT ${r.entry.progress.toFixed(1)}% OF THE CURVE. PRICED AGAIN AT ${new Date(r.entry.closes).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`; b.textContent = 'Sniped'; load(); }
  else { $('#sn-msg').textContent = (r?.why || 'not answering right now').toUpperCase() + '.'; b.disabled = false; b.textContent = 'Snipe'; }
});
load(); scan(); setInterval(scan, 15000); setInterval(load, 60000);
