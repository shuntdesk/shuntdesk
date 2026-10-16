// Same Hand page: follows the money behind a launch and lists what the same hand launched before.
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { rpc, api, prices, isAddr, compact, ageShort, cachedScan } from './data.js';
import { sameHand, DEAD_LIQ } from './hand.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const msg = $('#msg'), short = a => a.slice(0, 6) + '…' + a.slice(-4), X = 'https://robinhoodchain.blockscout.com/address/';
const io = {
  rpc,
  wallet: async (w, creator) => api(`hand?w=${w}${creator ? '&creator=1' : ''}`),
  launches: async ws => (await api('hand/launches?w=' + ws.join(','))).launches || {},
  pools: async list => { const m = await prices(list); const out = {}; for (const [a, p] of Object.entries(m)) out[a] = { sym: p.sym, liq: p.liq }; return out; },
  pause: () => new Promise(r => setTimeout(r, 250)),
};
const STEP = { launcher: 'FINDING WHO LAUNCHED IT…', funders: 'FOLLOWING THE FIRST FUNDS…', siblings: 'FINDING WHO ELSE THEY PAID…', launches: 'READING EVERY PONS LAUNCH BY THEM…', pools: 'LOOKING AT EACH POOL TODAY…' };
let job = 0, last = null;

async function look(input) {
  const id = ++job; input = input.toLowerCase(); $('#a').value = input; $('#out').hidden = true;
  history.replaceState(null, '', '?a=' + input);
  let r;
  try { r = await sameHand(input, io, s => { if (id === job) msg.textContent = STEP[s] || ''; }); } catch (e) { if (id === job) msg.textContent = 'A DATA SOURCE DID NOT ANSWER. TRY AGAIN IN A MINUTE.'; return; }
  if (id !== job) return;
  if (!r.ok) { msg.textContent = r.why.toUpperCase() + '.'; return; }
  last = r; paint(r); intel(r);
}

function paint(r) {
  $('#out').hidden = false;
  const tag = { dead: 'SAME HAND · MOSTLY DEAD', same: 'SAME HAND', new: 'NO EARLIER LAUNCH FOUND' }[r.hand];
  $('#sh-tag').textContent = tag; $('#sh-hero').className = 'stub hand-hero ' + (r.hand === 'dead' ? 'r' : r.hand === 'same' ? '' : 'g');
  $('#sh-sub').textContent = r.token ? `${r.viaPons ? 'launched on Pons' : 'deployed'} by ${short(r.launcher)}` : `wallet ${short(r.launcher)}`;
  const busy = r.chain.find(c => c.busy && c.role !== 'launcher'), ends = r.chain.at(-1);
  $('#sh-line').textContent = r.launched
    ? `${r.token ? 'This launch' : 'This wallet'} traces back to ${r.launchers} wallet${r.launchers > 1 ? 's' : ''} that launched ${r.launched} token${r.launched > 1 ? 's' : ''} on Pons${r.token ? ' before' : ''}. ${r.dead} of them now hold under $1K.`
    : `Nothing else on Pons from the launcher${r.chain.length > 1 ? ' or the wallets behind it' : ''}.${busy ? ` The trail stops at ${short(busy.addr)}, a busy wallet (an exchange, a bridge or a bot).` : ends.contract ? ` The trail stops at a contract, ${short(ends.addr)}.` : r.chain.length === 1 ? ' Its first funds could not be traced.' : ''}`;
  $('#sh-trail').innerHTML = r.chain.map((c, i) => `<div class="tn${c.busy || c.contract ? ' end' : ''}"><small>${esc(c.role.toUpperCase())}</small><a href="${X}${c.addr}" target="_blank" rel="noopener">${short(c.addr)}</a>
    <span>${c.launches ? `${c.launches} launch${c.launches > 1 ? 'es' : ''} on Pons` : 'no Pons launch'}${c.paid != null && !c.busy ? ` · paid ${c.paid} wallet${c.paid === 1 ? '' : 's'}` : ''}${c.busy ? ' · busy wallet, trail ends' : ''}${c.contract ? ' · a contract, trail ends' : ''}</span>
    ${i ? `<i>sent ${c.eth != null ? c.eth.toFixed(4) + ' ETH' : 'funds'}${c.at ? ' · ' + ageShort(c.at) + ' ago' : ''}${c.via === 'contract call' ? ' · inside a contract call' : ''}</i>` : ''}</div>`).join('<b class="ar">←</b>');
  $('#sh-n').textContent = r.launched; $('#sh-dead').textContent = r.dead; $('#sh-alive').textContent = r.alive; $('#sh-who').textContent = r.launchers;
  $('#sh-dead').className = 'v' + (r.dead ? ' short' : '');
  $('#sh-list').innerHTML = '<div class="r h"><span>LAUNCHED</span><span>TOKEN</span><span>BY</span><span>LIQUIDITY</span><span></span></div>' + (r.rows.slice(0, 80).map(x => {
    const v = cachedScan(x.token);
    return `<a class="r" href="/ticket/?a=${x.token}"><span>~${ageShort(x.t)}</span><span class="sy">${esc(x.sym || short(x.token))}<small>${v ? `${v.verdict} ${v.score} on this browser` : short(x.token)}</small></span>
      <span>${esc(x.how)}${x.via ? ' ' + short(x.via) : ''}</span><span class="${x.liq < DEAD_LIQ ? 'short' : ''}">${x.pool ? '$' + compact(x.liq) : 'no pool'}</span><span class="go">→</span></a>`;
  }).join('') || '<p class="note" style="margin:10px 0 0">No other Pons launch from this hand.</p>');
  msg.textContent = `${tag} · ${r.launched} EARLIER LAUNCH${r.launched === 1 ? '' : 'ES'} · ${r.dead} DEAD`;
}

$('#f').addEventListener('submit', e => { e.preventDefault(); const a = $('#a').value.trim(); if (!isAddr(a)) { msg.textContent = 'THAT IS NOT AN ADDRESS. IT SHOULD BE 0x FOLLOWED BY 40 HEX CHARACTERS.'; return; } look(a); });
const q = new URLSearchParams(location.search);
if (isAddr(q.get('a'))) look(q.get('a'));

async function card() {
  if (!last) return null;
  const r = last, W = 1200, H = 675, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  await document.fonts.load('900 40px "Big Shoulders Display"'); await document.fonts.load('400 20px "JetBrains Mono"'); await document.fonts.load('700 20px "JetBrains Mono"');
  const g = c.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, W * 0.7); g.addColorStop(0, '#17191c'); g.addColorStop(1, '#060708'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(237,235,230,.2)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(42, 22); c.lineTo(W - 22, 22); c.lineTo(W - 22, H - 42); c.lineTo(W - 42, H - 22); c.lineTo(22, H - 22); c.lineTo(22, 42); c.closePath(); c.stroke();
  c.fillStyle = '#edebe6'; c.save(); c.translate(56, 52); c.scale(0.08, 0.08); c.translate(-136, -56); c.fill(new Path2D('M136 456V297.7L292 173.7V90L326 56H376V214.3L220 338.3V422L186 456Z')); c.restore();
  c.font = '900 38px "Big Shoulders Display"'; c.fillText('SHUNTDESK', 90, 86);
  c.font = '400 18px "JetBrains Mono"'; c.fillStyle = '#8b8e94'; c.textAlign = 'right'; c.fillText('SAME HAND · ' + (r.token ? short(r.token) : short(r.launcher)).toUpperCase(), W - 56, 82); c.textAlign = 'left';
  c.font = '900 104px "Big Shoulders Display"'; c.fillStyle = r.hand === 'dead' ? '#ff4d5e' : '#edebe6'; c.fillText({ dead: 'SAME HAND.', same: 'SAME HAND.', new: 'NO EARLIER LAUNCH.' }[r.hand], 52, 250);
  c.font = '400 20px "JetBrains Mono"'; c.fillStyle = '#c9c7c2'; c.fillText(r.chain.map(x => `${x.role.toUpperCase()} ${short(x.addr)}`).join('  ←  '), 58, 312);
  [['LAUNCHED BEFORE', r.launched], ['DEAD', r.dead], ['STILL TRADING', r.alive]].forEach(([k, v], i) => { const x = 58 + i * 300, y = 360; c.fillStyle = 'rgba(16,17,19,.85)'; c.strokeStyle = 'rgba(237,235,230,.16)'; c.beginPath(); c.moveTo(x + 14, y); c.lineTo(x + 278, y); c.lineTo(x + 278, y + 136); c.lineTo(x + 264, y + 150); c.lineTo(x, y + 150); c.lineTo(x, y + 14); c.closePath(); c.fill(); c.stroke();
    c.font = '700 15px "JetBrains Mono"'; c.fillStyle = '#edebe6'; c.fillText(k, x + 22, y + 38); c.font = '900 84px "Big Shoulders Display"'; c.fillStyle = i === 1 && v ? '#ff4d5e' : '#edebe6'; c.fillText(String(v), x + 20, y + 126); });
  c.font = '400 16px "JetBrains Mono"'; c.fillStyle = '#8b8e94'; c.fillText('FIRST FUNDS FOLLOWED BACK TWO STEPS · A LINK, NOT PROOF · NOT ADVICE', 58, 612); c.textAlign = 'right'; c.fillText('SHUNTDESK.COM/HAND', W - 56, 612); c.textAlign = 'left';
  return cv;
}
const link = () => location.origin + '/hand/?a=' + last?.input;
$('#sh-save').onclick = async () => { const cv = await card(); if (!cv) return; cv.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `shuntdesk-hand-${last.input.slice(2, 8)}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png'); };
$('#sh-x').onclick = () => { if (!last) return; const r = last, txt = r.launched ? `Same Hand on ${short(r.input)}: the money behind it traces to wallets that launched ${r.launched} tokens on Pons. ${r.dead} of them now hold under $1K.` : `Same Hand on ${short(r.input)}: no earlier Pons launch found behind it.`; window.open('https://x.com/intent/post?text=' + encodeURIComponent(txt) + '&url=' + encodeURIComponent(link()), '_blank', 'noopener'); };
$('#sh-link').onclick = async e => { if (!last) return; try { await navigator.clipboard.writeText(link()); e.target.textContent = 'Copied'; } catch (x) { e.target.textContent = link(); } };

// what the same wallets have done off this chain: Webacy's risk read and their history on Ethereum and Arbitrum
async function intel(r) {
  const ws = r.chain.filter(c => !c.contract).map(c => c.addr).slice(0, 4); if (!ws.length) return;
  let j = null; try { j = await api('intel?w=' + ws.join(',')); } catch (e) {}
  if (!j?.ok || last !== r) return;
  r.chain.forEach((c, i) => {
    const v = j.wallets[c.addr]; if (!v?.ok) return;
    const node = document.querySelectorAll('#sh-trail .tn')[i]; if (!node) return;
    const bits = [];
    if (v.risk?.tags?.length) bits.push(`<b class="short">${v.risk.tags.slice(0, 3).map(t => esc(t.name)).join(' · ')}</b>`);
    for (const [k, h] of [['Ethereum', v.ethereum], ['Arbitrum', v.arbitrum]]) if (h?.txs) bits.push(`${k}: ${h.txs} tx${h.made ? `, ${h.made} contract${h.made > 1 ? 's' : ''} made` : ''}, since ${new Date(h.firstSeen).toISOString().slice(0, 7)}`);
    if (!bits.length) bits.push('no risk flag, no history on Ethereum or Arbitrum');
    node.insertAdjacentHTML('beforeend', `<i class="xi">${bits.join('<br>')}</i>`);
  });
}