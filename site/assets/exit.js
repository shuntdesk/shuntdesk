// Exit Door page: runs the ticket's checks on a token (or reuses this browser's last run), then works out what a
// buy of the chosen size gets back, straight away and after the biggest holders sell first.
import { createYard } from './yard.js';
import { mountChrome, $, $$, esc, feedYard } from './ui.js';
import { scan, cachedScan, isToken as isAddr, isSol, normAddr, compact } from './data.js';
import { exitDoor } from './door.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const msg = $('#msg');
const usdFmt = v => v >= 100 ? '$' + Math.round(v).toLocaleString('en-US') : '$' + v.toFixed(2);
let usd = 500, job = 0, last = null;

function size(v) {
  usd = Math.max(1, Math.min(1e7, v));
  $$('#sizes button').forEach(b => b.classList.toggle('on', +b.dataset.usd === usd));
  if (last) paint(last.res);
}
$$('#sizes button').forEach(b => b.onclick = () => { $('#usd').value = ''; size(+b.dataset.usd); });
$('#usd').addEventListener('input', e => { const v = parseFloat(e.target.value.replace(/[^\d.]/g, '')); if (v > 0) size(v); });

function paint(res) {
  const d = exitDoor(res, usd);
  if (!d) { msg.textContent = 'NO POOL TO SELL INTO: THIS TOKEN HAS NO PRICE OR NO LIQUIDITY ON ROBINHOOD CHAIN.'; $('#out').hidden = true; return; }
  last = { res, d }; const top = d.firsts.find(f => f.key === 'top10');
  $('#out').hidden = false;
  $('#x-sym').textContent = (res.sym || '').toUpperCase();
  $('#x-in').textContent = usdFmt(usd); $('#x-now').textContent = usdFmt(d.now);
  $('#x-now').className = d.now < usd * 0.8 ? 'short' : '';
  $('#x-line').textContent = d.noSell ? 'A sell fails in simulation: nothing comes back.' : `Bought and sold straight back, ${usdFmt(usd)} comes back as ${usdFmt(d.now)}.${top ? ` If the ten largest wallets sell first, ${usdFmt(top.back)}.` : ''}`;
  const max = Math.max(usd, ...d.firsts.map(f => f.back));
  $('#x-list').innerHTML = d.firsts.map(f => {
    const k = f.back / usd;
    return `<div class="dr${k < 0.5 ? ' bad' : k < 0.9 ? ' warn' : ''}"><div class="dl"><b>${esc(f.label)}</b><small>${f.share ? `${f.share.toFixed(1)}% of supply sold ahead of you · they take ${usdFmt(f.theirs)} · pool left $${compact(f.poolLeft)}` : 'only your own sale moves the pool'}</small></div>
      <div class="db"><i style="width:${Math.max(1, f.back / max * 100).toFixed(1)}%"></i></div><div class="dv">${usdFmt(f.back)}<small>${Math.round((k - 1) * 100)}%</small></div></div>`;
  }).join('');
  const cp = res.launch?.pool && !res.launch.graduated ? res.launch.pool : null;
  $('#x-liq').textContent = '$' + compact(cp ? cp.realUsd : res.liq);
  const sol = isSol(res.addr), pad = sol ? 'Pump.fun' : 'Pons', unit = sol ? 'SOL' : 'ETH';
  $('#x-liq2').textContent = cp ? `${unit} raised on the ${pad} curve, ${Math.round(res.launch.progress)}% to ${sol ? 'graduation' : 'bond'}` : 'liquidity, both sides';
  $('#x-model').textContent = cp
    ? `An estimate, not a quote. The token is still on its ${pad} curve, so the sale goes into the curve: a constant product over the curve's own reserves, with its fee and the creator's tax (${(cp.fee * 100).toFixed(1)}% together) taken off the ${unit} going in and coming out, and never more out than the curve has raised. Worked the way the curve's own buy and sell answer. Holder shares come from the ticket's own reading. Nothing is bought or sold. Not advice.`
    : `An estimate, not a quote. The pool is treated as one constant-product pool holding its quoted liquidity, with a 0.3% swap fee; concentrated pools can be deeper near the price and thinner away from it. Holder shares come from the ticket's own reading. Nothing is bought or sold. Not advice.`;
  $('#x-imp').textContent = '+' + (d.buyImpact * 100).toFixed(1) + '%';
  $('#x-tax').textContent = `${res.buyTax == null ? '?' : res.buyTax.toFixed(0)}% / ${res.sellTax == null ? '?' : res.sellTax.toFixed(0)}%`;
  $('#x-ver').textContent = `${res.verdict} ${res.score}`; $('#x-ver').className = 'v sm ' + (res.verdict === 'CLEAN' ? 'long' : res.verdict === 'DANGER' ? 'short' : '');
  $('#x-ticket').href = '/ticket/?a=' + res.addr;
  msg.textContent = res.topShares ? `READ ${res.sym?.toUpperCase()} · ${res.holders?.toLocaleString('en-US') || '?'} HOLDERS · TOP TEN KEEP ${res.top10?.toFixed(1)}%` : `READ ${res.sym?.toUpperCase()} · THE HOLDER LIST COULD NOT BE READ, SO ONLY YOUR OWN SALE IS SHOWN`;
  history.replaceState(null, '', `?a=${res.addr}&usd=${usd}`);
}

async function run(addr) {
  const id = ++job; addr = normAddr(addr); $('#a').value = addr;
  let res = cachedScan(addr);
  // a run from before Exit Door kept no holder shares or taxes: run it again
  if (!res || res.sellTax === undefined) {
    $('#out').hidden = true; msg.textContent = 'RUNNING THE SEVEN CHECKS…';
    try { res = await scan(addr, s => { if (id === job) msg.textContent = `RUNNING THE SEVEN CHECKS · ${s.name.toUpperCase()}`; }); } catch (e) { msg.textContent = 'A DATA SOURCE DID NOT ANSWER. TRY AGAIN IN A MINUTE.'; return; }
  }
  if (id !== job) return;
  if (res.verdict === 'NO POOL') { msg.textContent = 'NO POOL FOUND FOR THIS ADDRESS ON ROBINHOOD CHAIN.'; return; }
  paint(res);
}

$('#f').addEventListener('submit', e => { e.preventDefault(); const a = $('#a').value.trim(); if (!isAddr(a)) { msg.textContent = 'THAT IS NOT A TOKEN ADDRESS. PASTE 0x… FOR ROBINHOOD CHAIN OR A SOLANA MINT.'; return; } run(a); });
const q = new URLSearchParams(location.search);
if (+q.get('usd') > 0) { const v = +q.get('usd'); const chip = $$('#sizes button').find(b => +b.dataset.usd === v); if (!chip) $('#usd').value = v; size(v); }
if (isAddr(q.get('a'))) run(q.get('a'));

// the result as a picture, for saving or posting
async function card() {
  if (!last) return null;
  const { res, d } = last, W = 1200, H = 675, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  await document.fonts.load('900 40px "Big Shoulders Display"'); await document.fonts.load('400 20px "JetBrains Mono"'); await document.fonts.load('700 20px "JetBrains Mono"');
  const g = c.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, W * 0.7); g.addColorStop(0, '#17191c'); g.addColorStop(1, '#060708'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(237,235,230,.2)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(42, 22); c.lineTo(W - 22, 22); c.lineTo(W - 22, H - 42); c.lineTo(W - 42, H - 22); c.lineTo(22, H - 22); c.lineTo(22, 42); c.closePath(); c.stroke();
  c.fillStyle = '#edebe6'; 
  c.font = '900 38px "Big Shoulders Display"'; c.fillText('SHUNTDESK', 90, 86);
  c.font = '400 18px "JetBrains Mono"'; c.fillStyle = '#8b8e94'; c.textAlign = 'right'; c.fillText('EXIT DOOR · ' + (res.sym || '').toUpperCase(), W - 56, 82); c.textAlign = 'left';
  c.fillText('IN', 58, 170); c.fillText('BACK, SOLD STRAIGHT AWAY', 430, 170);
  c.font = '900 120px "Big Shoulders Display"'; c.fillStyle = '#edebe6'; c.fillText(usdFmt(usd), 52, 280); c.fillStyle = d.now < usd * 0.8 ? '#ff4d5e' : '#edebe6'; c.fillText(usdFmt(d.now), 424, 280);
  c.font = '400 18px "JetBrains Mono"'; c.fillStyle = '#8b8e94'; c.fillText('IF THEY SELL FIRST', 58, 344);
  d.firsts.slice(1).sort((p, q) => p.back - q.back).slice(0, 4).forEach((f, i) => { const y = 386 + i * 52; c.font = '400 19px "JetBrains Mono"'; c.fillStyle = '#c9c7c2'; c.fillText(f.label.replace(' sells first', '').replace(' sell first', '').toUpperCase(), 58, y); c.font = '900 40px "Big Shoulders Display"'; c.fillStyle = f.back < usd * 0.5 ? '#ff4d5e' : '#edebe6'; c.textAlign = 'right'; c.fillText(usdFmt(f.back), W - 58, y + 8); c.textAlign = 'left'; });
  c.font = '400 16px "JetBrains Mono"'; c.fillStyle = '#8b8e94'; c.fillText('ESTIMATE FROM POOL DEPTH AND SELL TAX · NOT ADVICE', 58, 630); c.textAlign = 'right'; c.fillText('SHUNTDESK.COM/EXIT', W - 56, 630); c.textAlign = 'left';
  return cv;
}
const link = () => `${location.origin}/exit/?a=${last?.res.addr}&usd=${usd}`;
$('#x-save').onclick = async () => { const cv = await card(); if (!cv) return; cv.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `shuntdesk-exit-${(last.res.sym || 'token').toLowerCase()}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png'); };
$('#x-x').onclick = () => { if (!last) return; const d = last.d, top = d.firsts.find(f => f.key === 'top10'), txt = `Exit Door on $${(last.res.sym || '').toUpperCase()}: ${usdFmt(usd)} in, ${usdFmt(d.now)} back if sold straight away${top ? `, ${usdFmt(top.back)} if the ten largest wallets sell first` : ''}.`; window.open('https://x.com/intent/post?text=' + encodeURIComponent(txt) + '&url=' + encodeURIComponent(link()), '_blank', 'noopener'); };
$('#x-link').onclick = async e => { if (!last) return; try { await navigator.clipboard.writeText(link()); e.target.textContent = 'Copied'; } catch (x) { e.target.textContent = link(); } };
