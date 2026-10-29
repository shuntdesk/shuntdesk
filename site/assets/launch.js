// /launch/: Launch Desk, Shuntdesk's own token on StonkFun read live. ?m= shows any StonkFun token in the same layout
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';
mountChrome('Launch');
feedYard(createYard($('#yard'), { ambient: true }));
const usd = v => v == null ? '—' : '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v));
const w4 = a => a.slice(0, 4) + '…' + a.slice(-4);
async function draw(mint, preview) {
  let t = null; try { t = await api('stonk?m=' + mint); } catch (e) {}
  if (!t?.ok) { $('#ld-soon').hidden = false; $('#ld-soon .cap b').textContent = 'Could not read it'; $('#ld-soon .pf-body').innerHTML = `<p>${esc(t?.error || 'StonkFun did not answer. Try again in a minute.')}</p>`; return; }
  $('#ld-out').hidden = false;
  if (preview) $('#ld-side').textContent = `PREVIEW: ANOTHER STONKFUN TOKEN IN THE LAUNCH DESK LAYOUT. OUR OWN TOKEN APPEARS HERE AT LAUNCH.`;
  $('#ld-name').textContent = '$' + (t.symbol || '?') + ' · ' + (t.name || ''); $('#ld-by').textContent = `StonkFun · paired with ${t.quote || '?'} · ${t.mode || ''}`;
  $('#ld-ca').textContent = mint; $('#ld-cp').onclick = async e => { try { await navigator.clipboard.writeText(mint); e.target.textContent = 'Copied'; } catch (x) { e.target.textContent = 'Select it'; } };
  const p = t.status === 'graduated' ? 100 : t.curve ? t.curve.progress : t.sfProgress;
  $('#ld-p').textContent = p == null ? '—' : p.toFixed(1) + '%'; $('#ld-fill').style.width = Math.min(100, p || 0) + '%';
  $('#ld-ps').textContent = t.status === 'graduated' ? 'graduated to a Raydium pool' : t.curve ? `of its curve: ${t.curve.raised.toFixed(2)} of ${t.curve.target.toFixed(2)} ${t.quote} raised, read from the LaunchLab pool` : `StonkFun's measure: market cap toward $40,000 (a direct Raydium launch has no curve)`;
  $('#ld-mc').textContent = usd(t.marketCap); $('#ld-mc-s').textContent = t.peak ? 'peak ' + usd(t.peak) : 'now'; $('#ld-vol').textContent = usd(t.volume24h);
  $('#ld-links').innerHTML = `<p><a class="acc" href="/ticket/?a=${mint}">The seven checks →</a></p><p><a class="acc" href="https://www.stonkfun.xyz/token/${mint}" target="_blank" rel="noopener">On StonkFun →</a></p>${t.creator ? `<p>Launched by <code>${w4(t.creator)}</code> · <a class="acc" href="/wallet/?a=${t.creator}">its wallet →</a></p>` : ''}<p><a class="acc" href="https://solscan.io/token/${mint}" target="_blank" rel="noopener">On Solscan →</a></p>`;
  $('#ld-note').textContent = t.note;
  let h = null; try { h = await api('holders?a=' + mint); } catch (e) {}
  if (h?.ok) {
    $('#ld-hold').textContent = h.read >= 20 ? '20+' : String(h.wallets.length); $('#ld-hold-s').textContent = `top 10 wallets hold ${(h.top10 || 0).toFixed(1)}%`;
    const dev = t.creator && h.wallets.find(w => w.wallet === t.creator);
    $('#ld-dev').textContent = !t.creator ? '—' : dev ? dev.share.toFixed(2) + '%' : '0%'; $('#ld-dev-s').textContent = !t.creator ? 'launcher unknown' : dev ? 'of the supply, read now' : 'not among the 20 largest accounts';
    $('#ld-top').innerHTML = `<div class="r h"><span>WALLET</span><span>SHARE</span></div>` + h.wallets.slice(0, 10).map(w => `<a class="r" href="/wallet/?a=${w.wallet}"><span class="sy">${w4(w.wallet)}${w.wallet === t.creator ? '<small class="short">LAUNCHER</small>' : ''}</span><span>${w.share.toFixed(2)}%</span></a>`).join('');
  } else $('#ld-top').innerHTML = '<p class="note">HOLDERS NOT READ RIGHT NOW.</p>';
}
(async () => {
  const q = new URLSearchParams(location.search).get('m');
  let v = null; try { v = await api('launchdesk'); } catch (e) {}
  if (v?.mint && !q) return draw(v.mint, false);
  if (q) return draw(q, true);
  $('#ld-soon').hidden = false;
})();
setInterval(() => { if (!document.hidden && !$('#ld-out').hidden) location.reload(); }, 5 * 60000);
