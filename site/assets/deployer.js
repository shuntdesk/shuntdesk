// Deployer record: every Pons launch by one wallet, from the factory log, with how each pool stands today.
// Given a token, the page first finds who launched it.
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { deployerRecord, ponsLauncher, isAddr, compact, ageShort, cachedScan } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const msg = $('#msg'), short = a => a.slice(0, 6) + '…' + a.slice(-4);
let job = 0, last = null;

async function look(input, isToken) {
  const id = ++job; input = input.toLowerCase();
  history.replaceState(null, '', (isToken ? '?t=' : '?a=') + input);
  $('#a').value = input; $('#out').hidden = true;
  let wallet = input;
  if (isToken) {
    msg.textContent = 'FINDING WHO LAUNCHED THIS TOKEN…';
    try { wallet = await ponsLauncher(input); } catch (e) { msg.textContent = 'THE CHAIN DID NOT ANSWER. TRY AGAIN IN A MINUTE.'; return; }
    if (id !== job) return;
    if (!wallet) { msg.textContent = 'THIS TOKEN WAS NOT LAUNCHED THROUGH PONS, SO ITS LAUNCHER IS NOT IN THE FACTORY LOG.'; return; }
  }
  msg.textContent = 'READING THE FACTORY LOG…';
  let rows;
  try { rows = await deployerRecord(wallet, (done, all) => { if (id === job) msg.textContent = `READING THE FACTORY LOG · ${Math.min(100, Math.round(done / all * 100))}%`; }); }
  catch (e) { msg.textContent = 'THE CHAIN DID NOT ANSWER. TRY AGAIN IN A MINUTE.'; return; }
  if (id !== job) return;
  $('#out').hidden = false;
  $('#d-who').innerHTML = `<a href="https://robinhoodchain.blockscout.com/address/${wallet}" target="_blank" rel="noopener">${short(wallet)}</a>`;
  $('#d-src').textContent = isToken ? `launched ${short(input)}` : 'from the Pons factory log';
  const live = rows.filter(r => r.pair && r.pair.liq >= 1000).length, grads = rows.filter(r => r.graduated).length;
  $('#d-n').textContent = rows.length; $('#d-g').textContent = grads; $('#d-live').textContent = live;
  $('#d-span').textContent = rows.length ? `on Pons, first ${ageShort(rows[rows.length - 1].t)} ago` : 'on Pons';
  const list = $('#d-list'); list.querySelectorAll('.r:not(.h)').forEach(n => n.remove());
  list.insertAdjacentHTML('beforeend', rows.slice(0, 60).map(r => {
    const p = r.pair, v = cachedScan(r.addr), chg = p?.chg;
    return `<a class="r" href="/ticket/?a=${r.addr}"><span>~${ageShort(r.t)}</span><span class="sy">${esc(p?.sym || short(r.addr))}<small>${v ? `${v.verdict} ${v.score} on this browser` : esc((p?.name || '').slice(0, 22))}</small></span>
      <span>${r.graduated ? '<span class="tag CLEAN">GRADUATED</span>' : '<span class="tag">ON CURVE</span>'}</span><span>${p ? '$' + compact(p.liq) : 'no pool'}</span><span>${p?.fdv ? '$' + compact(p.fdv) : '···'}</span>
      <span class="${chg == null ? '' : chg >= 0 ? 'long' : 'short'}">${chg == null ? '···' : (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%'}</span><span class="go">→</span></a>`;
  }).join('') || '<p class="note" style="margin:10px 0 0">No launch through the Pons V2 factory from this wallet.</p>');
  last = { wallet, rows, grads, live, token: isToken ? input : null };
  msg.textContent = rows.length ? `${rows.length} LAUNCH${rows.length > 1 ? 'ES' : ''} BY ${short(wallet).toUpperCase()} · ${grads} GRADUATED · ${live} STILL TRADING` : 'NO PONS LAUNCH FROM THIS WALLET.';
}

$('#f').addEventListener('submit', async e => {
  e.preventDefault();
  const a = $('#a').value.trim();
  if (!isAddr(a)) { msg.textContent = 'THAT IS NOT AN ADDRESS. IT SHOULD BE 0x FOLLOWED BY 40 HEX CHARACTERS.'; return; }
  // a token has a launch event naming it; a wallet does not, so try it as a token first
  msg.textContent = 'CHECKING WHAT THIS ADDRESS IS…';
  let launcher = null; try { launcher = await ponsLauncher(a); } catch (e) {}
  look(a, !!launcher);
});
const q = new URLSearchParams(location.search);
if (isAddr(q.get('t'))) look(q.get('t'), true); else if (isAddr(q.get('a'))) look(q.get('a'), false);

// the record as a picture, in the site's look, for saving or posting
async function card() {
  if (!last) return null;
  const W = 1200, H = 675, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  await document.fonts.load('900 40px "Big Shoulders Display"'); await document.fonts.load('400 20px "JetBrains Mono"'); await document.fonts.load('700 20px "JetBrains Mono"');
  const g = c.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, W * 0.7); g.addColorStop(0, '#17191c'); g.addColorStop(1, '#060708'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let k = -8; k <= 8; k++) { const on = k === 0 || k === 1; c.strokeStyle = on ? 'rgba(237,235,230,.18)' : 'rgba(237,235,230,.045)'; c.lineWidth = on ? 2 : 1; c.beginPath(); c.moveTo(W / 2, H * 0.3); c.lineTo(W / 2 + (k - 0.5) * 170, H + 30); c.stroke(); }
  c.strokeStyle = 'rgba(237,235,230,.2)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(42, 22); c.lineTo(W - 22, 22); c.lineTo(W - 22, H - 42); c.lineTo(W - 42, H - 22); c.lineTo(22, H - 22); c.lineTo(22, 42); c.closePath(); c.stroke();
  c.fillStyle = '#edebe6'; 
  c.font = '900 38px "Big Shoulders Display"'; c.fillText('SHUNTDESK', 90, 86);
  c.font = '400 18px "JetBrains Mono"'; c.fillStyle = '#8b8e94'; c.textAlign = 'right'; c.fillText('DEPLOYER RECORD · PONS', W - 56, 82); c.textAlign = 'left';
  c.fillText('LAUNCHER', 58, 176); c.font = '900 110px "Big Shoulders Display"'; c.fillStyle = '#edebe6'; c.fillText(short(last.wallet).toUpperCase(), 52, 284);
  const tiles = [['LAUNCHED', last.rows.length], ['GRADUATED', last.grads], ['STILL TRADING', last.live]];
  tiles.forEach(([k, v], i) => { const x = 58 + i * 300, y = 336; c.fillStyle = 'rgba(16,17,19,.85)'; c.strokeStyle = 'rgba(237,235,230,.16)'; c.beginPath(); c.moveTo(x + 14, y); c.lineTo(x + 278, y); c.lineTo(x + 278, y + 136); c.lineTo(x + 264, y + 150); c.lineTo(x, y + 150); c.lineTo(x, y + 14); c.closePath(); c.fill(); c.stroke();
    c.font = '700 15px "JetBrains Mono"'; c.fillStyle = '#edebe6'; c.fillText(k, x + 22, y + 38); c.font = '900 84px "Big Shoulders Display"'; c.fillStyle = i === 1 && v ? '#2ed3a0' : '#edebe6'; c.fillText(String(v), x + 20, y + 126); });
  const recent = last.rows.slice(0, 4).map(r => (r.pair?.sym || short(r.addr)).toUpperCase() + (r.graduated ? ' ✓' : '')).join('   ·   ');
  c.font = '400 19px "JetBrains Mono"'; c.fillStyle = '#8b8e94'; c.fillText(recent ? 'LATEST  ' + recent : 'NO PONS LAUNCH FROM THIS WALLET', 58, 550);
  c.fillText('READ FROM THE PONS V2 FACTORY LOG · NOT ADVICE', 58, 612); c.textAlign = 'right'; c.fillText('SHUNTDESK.COM/DEPLOYER', W - 56, 612); c.textAlign = 'left';
  return cv;
}
const link = () => location.origin + '/deployer/' + (last?.token ? '?t=' + last.token : '?a=' + last?.wallet);
$('#d-save').onclick = async () => { const cv = await card(); if (!cv) return; cv.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `shuntdesk-deployer-${last.wallet.slice(2, 8)}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png'); };
$('#d-x').onclick = () => { if (!last) return; const txt = `Deployer ${short(last.wallet)} on Pons: ${last.rows.length} launched, ${last.grads} graduated, ${last.live} still trading. Read from the factory log.`; window.open('https://x.com/intent/post?text=' + encodeURIComponent(txt) + '&url=' + encodeURIComponent(link()), '_blank', 'noopener'); };
$('#d-link').onclick = async e => { if (!last) return; try { await navigator.clipboard.writeText(link()); e.target.textContent = 'Copied'; } catch (x) { e.target.textContent = link(); } };