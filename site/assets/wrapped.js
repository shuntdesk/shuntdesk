// /wrapped/: Wallet Wrapped, one wallet's last seven days on Pons as a card to share
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';
mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const isW = a => /^0x[0-9a-fA-F]{40}$/.test(a);
const eth = v => `${v >= 0 ? '+' : ''}${v.toFixed(4)}`;
const cls = v => v > 0 ? 'long' : v < 0 ? 'short' : '';
let job = 0;
async function run(w) {
  const id = ++job; w = w.toLowerCase(); $('#wr-w').value = w; history.replaceState(null, '', '?w=' + w);
  $('#wr-out').hidden = true; $('#wr-msg').textContent = 'READING THE WEEK FROM THE CHAIN…';
  let v = null; try { v = await api('wrapped?w=' + w); } catch (e) {}
  if (id !== job) return;
  if (!v?.ok) { $('#wr-msg').textContent = (v?.error || 'could not read it right now').toUpperCase() + '.'; return; }
  if (!v.tokens) { $('#wr-msg').textContent = 'NO BUY OR SELL OF A PONS TOKEN BY THIS WALLET IN THE LAST SEVEN DAYS.'; return; }
  $('#wr-msg').textContent = `${v.tokens} PONS TOKENS · ${v.buys} BUYS · ${v.sells} SELLS · ${eth(v.pnl)} ETH${v.full ? '' : ' · A BUSY WALLET: THE OLDEST TRADES OF THE WEEK MAY BE MISSING'}`;
  const link = `https://shuntdesk.com/card/wrapped/${w}`, img = `/card/wrapped/${w}.png?h=${Math.floor(Date.now() / 1800000)}`;
  $('#wr-card').src = img; $('#wr-png').href = img; $('#wr-link').textContent = link;
  $('#wr-x').href = 'https://x.com/intent/post?text=' + encodeURIComponent(`My week on Pons, read from the chain: ${eth(v.pnl)} ETH across ${v.tokens} tokens, ${v.won} won, ${v.lost} lost.\n\n${link}`);
  $('#wr-copy').onclick = async e => { try { await navigator.clipboard.writeText(link); e.target.textContent = 'Copied'; } catch (x) { e.target.textContent = 'Select the link'; } };
  $('#wr-list').innerHTML = `<div class="r h"><span>TOKEN</span><span>IN</span><span>RESULT</span><span>MULTIPLE</span></div>` + v.rows.map(r => `<a class="r" href="/profit/?a=${r.token}"><span class="sy">${esc(r.symbol || r.token.slice(0, 8))}<small>${r.bonded ? 'bonded' : r.token.slice(0, 6) + '…' + r.token.slice(-4)}</small></span><span>${r.in.toFixed(4)} ETH</span><span class="${cls(r.pnl)}">${eth(r.pnl)} ETH</span><span class="${cls(r.mult - 1)}">${r.mult != null ? r.mult + 'x' : '—'}</span></a>`).join('');
  $('#wr-note').textContent = v.note + (v.movedAway?.length ? ` Set aside, sent on with nothing back: ${v.movedAway.map(x => x.symbol || x.token.slice(0, 8)).join(', ')}.` : '') + (v.unpriced ? ` ${v.unpriced} token${v.unpriced > 1 ? 's' : ''} still held could not be priced and count as 0.` : '');
  $('#wr-out').hidden = false;
}
$('#wr-form').addEventListener('submit', e => { e.preventDefault(); const a = $('#wr-w').value.trim(); if (isW(a)) run(a); else $('#wr-msg').textContent = 'PASTE A 0x… WALLET.'; });
const q = new URLSearchParams(location.search).get('w'); if (q && isW(q)) run(q);
