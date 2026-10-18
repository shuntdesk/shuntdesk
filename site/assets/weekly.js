// /weekly/: the last seven days drawn as one 1200x675 card from Shuntdesk's own reads, to save and post
import { createYard } from './yard.js';
import { mountChrome, $ } from './ui.js';
import { api } from './data.js';

mountChrome('');
createYard($('#yard'), { ambient: true });
const cv = $('#wk'), x = cv.getContext('2d'), W = 1200, H = 675;
const D = '"Big Shoulders Display"', B = '"Barlow"', M = '"JetBrains Mono"';
const n0 = v => Math.round(v || 0).toLocaleString('en-US'), pc = v => v == null ? '—' : Math.round(v * 100) + '%';
const MARK = new Path2D('M136 456V297.7L292 173.7V90L326 56H376V214.3L220 338.3V422L186 456Z');

function box(x0, y0, w, h, label, big, sub, color) {
  x.fillStyle = 'rgba(14,15,17,.92)'; x.fillRect(x0, y0, w, h);
  x.strokeStyle = 'rgba(237,235,230,.12)'; x.lineWidth = 1; x.strokeRect(x0 + .5, y0 + .5, w - 1, h - 1);
  x.fillStyle = color; x.fillRect(x0, y0, 3, h);
  x.fillStyle = '#8d8b86'; x.font = `700 13px ${M}`; x.fillText(label.toUpperCase().split('').join(String.fromCharCode(8202)), x0 + 22, y0 + 32);
  x.fillStyle = color === '#edebe6' ? '#edebe6' : color; x.font = `900 58px ${D}`; x.fillText(big, x0 + 22, y0 + 96);
  x.fillStyle = '#bdbbb6'; x.font = `600 17px ${B}`; x.fillText(sub, x0 + 22, y0 + 126);
}
function draw(v) {
  x.fillStyle = '#060708'; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(237,235,230,.045)'; for (let i = 0; i <= W; i += 50) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); } for (let i = 0; i <= H; i += 50) { x.beginPath(); x.moveTo(0, i); x.lineTo(W, i); x.stroke(); }
  const g = x.createRadialGradient(1000, 0, 0, 1000, 0, 700); g.addColorStop(0, 'rgba(46,211,160,.12)'); g.addColorStop(1, 'rgba(46,211,160,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.save(); x.translate(60, 46); x.scale(18 / 400, 18 / 400); x.translate(-136, -56); x.fillStyle = '#edebe6'; x.fill(MARK); x.restore();
  x.fillStyle = '#edebe6'; x.font = `700 15px ${M}`; x.fillText('SHUNTDESK  ·  THE WEEK ON THE LINE', 92, 62);
  const end = new Date(v.read), start = new Date(end - 7 * 864e5), f = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  x.fillStyle = '#2ed3a0'; x.textAlign = 'right'; x.fillText(`${f(start).toUpperCase()} – ${f(end).toUpperCase()}`, W - 60, 62); x.textAlign = 'left';
  x.fillStyle = '#edebe6'; x.font = `900 76px ${D}`; x.fillText('SEVEN DAYS ON PONS.', 60, 150);
  const bw = (W - 120 - 36) / 4, y = 186;
  box(60, y, bw, 150, 'Launched', n0(v.pons?.launched), 'new tokens on Pons', '#edebe6');
  box(60 + (bw + 12), y, bw, 150, 'Bonded', n0(v.pons?.bonded), v.pons?.rate ? `about 1 in ${Math.round(1 / v.pons.rate)}` : 'completed the curve', '#2ed3a0');
  box(60 + (bw + 12) * 2, y, bw, 150, 'Caught', n0(v.radar?.caught), `of ${n0(v.radar?.flagged)} flagged lost half`, '#ff7a3d');
  box(60 + (bw + 12) * 3, y, bw, 150, 'Missed', n0(v.radar?.missed), 'no flag, lost half anyway', '#8d8b86');
  const hw = (W - 120 - 12) / 2, y2 = 350;
  box(60, y2, hw, 150, 'Strongest rule in the Lab', v.lab ? `${v.lab.lift.toFixed(1)}×` : '—', v.lab ? `${v.lab.rule}: ${pc(v.lab.rate)} lost half in a day, ${pc(v.lab.others)} for the rest` : 'not enough results yet', '#ff7a3d');
  box(60 + hw + 12, y2, hw, 150, '$SHUNT burned this week', v.shunt ? n0(v.shunt.burnedWeek) : '—', v.shunt ? `${v.shunt.burnsWeek} burns · ${n0(v.shunt.burnedAll)} in all · dev sold ${n0(v.shunt.sold)}` : 'read from the chain', '#2ed3a0');
  x.fillStyle = '#5f5d59'; x.font = `700 14px ${M}`; x.fillText('READ FROM ROBINHOOD CHAIN BY SHUNTDESK · FINDINGS, NOT ADVICE', 60, 625);
  x.fillStyle = '#edebe6'; x.textAlign = 'right'; x.fillText('SHUNTDESK.COM', W - 60, 625); x.textAlign = 'left';
}
async function run() {
  await Promise.all([`900 76px ${D}`, `700 15px ${M}`, `600 17px ${B}`].map(f => document.fonts.load(f).catch(() => 0)));
  let v = null; try { v = await api('weekly'); } catch (e) {}
  if (!v?.ok) { $('#wk-msg').textContent = 'Not answering right now.'; return; }
  draw(v); $('#wk-msg').textContent = 'Read ' + new Date(v.read).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
$('#wk-save').addEventListener('click', () => { const a = document.createElement('a'); a.download = 'shuntdesk-week.png'; a.href = cv.toDataURL('image/png'); a.click(); });
run();
