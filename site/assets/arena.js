// /arena/: Stonk Arena, the week's best and worst traders of StonkFun tokens among its earliest buyers
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';
mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const sol = v => `${v >= 0 ? '+' : ''}${v.toFixed(3)}`, w4 = a => a.slice(0, 4) + '…' + a.slice(-4);
(async () => {
  let v = null; try { v = await api('arena'); } catch (e) {}
  if (!v?.ok) { $('#ar-list').innerHTML = '<p class="note">COULD NOT READ THE ARENA RIGHT NOW.</p>'; return; }
  $('#ar-n').textContent = v.read; $('#ar-note').textContent = v.note;
  if (!v.top.length) { $('#ar-list').innerHTML = '<p class="note">THE FIRST WALLETS ARE STILL BEING READ: THE ARENA FILLS AS STONK HUNTERS READS MORE CURVES.</p>'; ['#ar-best', '#ar-worst'].forEach(s => { $(s).textContent = '—'; }); return; }
  $('#ar-best').textContent = sol(v.top[0].pnl); $('#ar-best-s').textContent = 'SOL · ' + w4(v.top[0].wallet);
  const wr = v.worst[0]; $('#ar-worst').textContent = wr ? sol(wr.pnl) : '—'; $('#ar-worst-s').textContent = wr ? 'SOL · ' + w4(wr.wallet) : '';
  $('#ar-list').innerHTML = `<div class="r h"><span>#</span><span>WALLET</span><span>THE WEEK</span><span>SOL IN</span><span>MULTIPLE</span><span>BEST TRADE</span></div>` + v.top.map((r, i) => `<a class="r" href="/wrapped/?w=${r.wallet}"><span>${i + 1}</span><span class="sy">${w4(r.wallet)}<small>${r.tokens} StonkFun tokens</small></span><span class="${r.pnl >= 0 ? 'long' : 'short'}">${sol(r.pnl)} SOL</span><span>${r.in.toFixed(3)}</span><span class="${r.mult >= 1 ? 'long' : 'short'}">${r.mult}x</span><span>${r.best ? esc(r.best.symbol || r.best.token.slice(0, 6)) + ' ' + sol(r.best.pnl) : '—'}</span></a>`).join('');
})();
