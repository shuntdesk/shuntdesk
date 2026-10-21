// A ticket as a picture: drawn on a canvas in the browser, then saved or handed to the share sheet.
import { compact, fmtAge } from './data.js';

const COL = { CLEAN: '#2ed3a0', RISKY: '#a9acb2', DANGER: '#ff4d5e', 'NO POOL': '#ff4d5e' };
const DOT = { ok: '#2ed3a0', warn: '#c9c7c2', bad: '#ff4d5e', skip: '#5f6268' };

export async function drawCard(res) {
  if (document.fonts) await Promise.all([document.fonts.load('900 100px "Big Shoulders Display"'), document.fonts.load('700 20px "JetBrains Mono"')]).catch(() => {});
  const W = 1200, H = 630, cv = document.createElement('canvas'), c = cv.getContext('2d');
  cv.width = W; cv.height = H;
  const disp = px => `900 ${px}px "Big Shoulders Display", sans-serif`, mono = (px, w = 400) => `${w} ${px}px "JetBrains Mono", monospace`;
  const col = COL[res.verdict] || '#a9acb2';
  c.fillStyle = '#060708'; c.fillRect(0, 0, W, H);
  let g = c.createRadialGradient(W * 0.86, H * 0.1, 0, W * 0.86, H * 0.1, 760); g.addColorStop(0, 'rgba(237,235,230,.12)'); g.addColorStop(1, 'rgba(237,235,230,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  // rails running off to a vanishing point behind the stamp
  const vx = W * 0.8, vy = H * 0.3; c.lineCap = 'round';
  for (let k = -9; k <= 9; k++) { c.strokeStyle = k === 0 || k === 1 ? 'rgba(237,235,230,.75)' : 'rgba(237,235,230,.11)'; c.lineWidth = k === 0 || k === 1 ? 2.4 : 1; c.beginPath(); c.moveTo(vx, vy); c.lineTo(vx + (k - 0.5) * 210, H + 40); c.stroke(); }
  g = c.createLinearGradient(0, 0, W * 0.7, 0); g.addColorStop(0, 'rgba(6,7,8,.96)'); g.addColorStop(1, 'rgba(6,7,8,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  // frame with cut corners
  c.strokeStyle = 'rgba(237,235,230,.22)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(42, 22); c.lineTo(W - 22, 22); c.lineTo(W - 22, H - 42); c.lineTo(W - 42, H - 22); c.lineTo(22, H - 22); c.lineTo(22, 42); c.closePath(); c.stroke();
  c.fillStyle = '#edebe6'; c.save(); c.translate(64, 63); c.scale(0.0725, 0.0725); c.translate(-136, -56); c.fill(new Path2D('M136 456V297.7L292 173.7V90L326 56H376V214.3L220 338.3V422L186 456Z')); c.restore();
  c.font = disp(40); c.textBaseline = 'alphabetic'; c.fillText('SHUNTDESK', 94, 92);
  c.fillStyle = '#ffffff'; c.font = mono(15, 700); c.fillText('TICKET ' + (res.chain === 'solana' ? res.addr.slice(0, 4) + '   ·   SOLANA' : res.addr.slice(2, 6).toUpperCase() + '   ·   ROBINHOOD CHAIN'), 64, 122);
  // token
  const sym = (res.sym || '').toUpperCase().slice(0, 10); let px = 230; c.font = disp(px);
  while (c.measureText(sym).width > 560 && px > 80) { px -= 10; c.font = disp(px); }
  c.fillStyle = '#edebe6'; c.fillText(sym, 58, 330);
  c.fillStyle = '#9a9da3'; c.font = mono(17); c.fillText(res.addr, 64, 366);
  const facts = [['PRICE', res.price != null ? '$' + Number(res.price).toPrecision(4) : '—'], ['LIQUIDITY', res.liq != null ? '$' + compact(res.liq) : '—'], ['POOL AGE', res.ageMin != null ? fmtAge(res.ageMin) : '—'], ['HOLDERS', res.holders != null ? res.holders.toLocaleString('en-US') : '—']];
  facts.forEach((f, i) => { const x = 64 + i * 150; c.fillStyle = '#5f6268'; c.font = mono(12); c.fillText(f[0], x, 410); c.fillStyle = '#edebe6'; c.font = mono(19, 700); c.fillText(f[1], x, 436); });
  // the stamp
  c.save(); c.translate(W * 0.76, 250); c.rotate(-0.12);
  const label = res.verdict === 'NO POOL' ? 'NO POOL' : `${res.verdict} ${res.score}`; c.font = disp(112);
  const tw = c.measureText(label).width; c.strokeStyle = col; c.lineWidth = 8; c.shadowColor = col; c.shadowBlur = 40;
  c.strokeRect(-tw / 2 - 34, -86, tw + 68, 138); c.shadowBlur = 0; c.fillStyle = col; c.textAlign = 'center'; c.fillText(label, 0, 28); c.restore(); c.textAlign = 'left';
  c.fillStyle = col; c.font = mono(17, 700);
  const where = res.verdict === 'NO POOL' ? 'NEVER LEFT THE STATION' : res.platform === 'long' ? 'SENT TO THE LONG DESK' : res.platform === 'short' ? 'SENT TO THE SHORT DESK' : 'SENT TO THE DEPOT';
  c.textAlign = 'center'; c.fillText(where + (res.maxLev ? `   ·   ZONE ${res.zone}   ·   MAX ${res.maxLev}X` : ''), W * 0.76, 388); c.textAlign = 'left';
  // the seven stops
  const y = 486, x0 = 84, x1 = W - 84, n = res.steps.length;
  c.strokeStyle = 'rgba(237,235,230,.25)'; c.lineWidth = 2; c.setLineDash([6, 8]); c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); c.setLineDash([]);
  c.strokeStyle = '#ffffff'; c.lineWidth = 3; c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + (x1 - x0) * (n - 1) / 6, y); c.stroke();
  ['SOURCES', 'GATE', 'SCOUT', 'TRACER', 'LINKER', 'AUDITOR', 'JUDGE'].forEach((name, i) => {
    const x = x0 + (x1 - x0) * i / 6, s = res.steps[i];
    c.fillStyle = s ? DOT[s.status] || '#5f6268' : '#060708'; c.strokeStyle = s ? c.fillStyle : '#5f6268'; c.lineWidth = 2.5;
    c.beginPath(); c.arc(x, y, 10, 0, 7); c.fill(); c.stroke();
    c.textAlign = 'center'; c.fillStyle = s ? '#edebe6' : '#5f6268'; c.font = disp(24); c.fillText(name, x, y + 44);
    c.fillStyle = s ? DOT[s.status] || '#9a9da3' : '#5f6268'; c.font = mono(12, 700); c.fillText(s ? s.tag : '', x, y + 64);
  });
  c.textAlign = 'left'; c.fillStyle = '#5f6268'; c.font = mono(12);
  c.fillText(new Date(res.at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC   ·   FIXED-RULE READING OF PUBLIC CHAIN DATA   ·   IT CAN BE WRONG   ·   NOT ADVICE', 64, H - 40);
  return cv;
}

// phone: the share sheet with the picture attached. desktop: a download.
export async function saveCard(res) {
  const cv = await drawCard(res), blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const name = `shuntdesk-${(res.sym || 'ticket').toLowerCase().replace(/[^a-z0-9]/g, '')}-${res.verdict.toLowerCase().replace(' ', '')}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(hover: none)').matches) {
    try { await navigator.share({ files: [file], title: 'Shuntdesk ticket', text: postText(res) }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'saved';
}
export function postText(res) {
  const where = res.platform === 'long' ? 'sent to the long desk' : res.platform === 'short' ? 'sent to the short desk' : 'sent to the depot, no trade';
  if (res.chain === 'solana') return `${res.sym} rode the line at Shuntdesk: ${res.verdict} ${res.score}/100. Seven fixed-rule checks on public Solana data.`;
  return `${res.sym} rode the line at Shuntdesk: ${res.verdict} ${res.score}/100, ${where}. Seven fixed-rule checks on public Robinhood Chain data.`;
}
export const postUrl = (res, link) => 'https://x.com/intent/post?text=' + encodeURIComponent(postText(res)) + '&url=' + encodeURIComponent(link);
