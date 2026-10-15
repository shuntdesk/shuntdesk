// The daily report card: the crew desk's last 24 hours, drawn as a picture that can be saved or posted.
// Every figure comes from /api/report, which reads the desk's own state. Nothing is rounded up or left out.
import { createYard } from './yard.js';
import { mountChrome, $, feedYard } from './ui.js';
import { api } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const cv = $('#r-card'), c = cv.getContext('2d'), W = 1600, H = 900;
const money = n => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = n => (n >= 0 ? '+' : '') + money(n);
const MARK = 'M136 456V297.7L292 173.7V90L326 56H376V214.3L220 338.3V422L186 456Z';
const INK = '#edebe6', MUT = '#8b8e94', LONG = '#2ed3a0', SHORT = '#ff4d5e';
const disp = px => `900 ${px}px "Big Shoulders Display", sans-serif`, mono = (px, w = 400) => `${w} ${px}px "JetBrains Mono", monospace`;
let rep = null;

function draw(r) {
  c.clearRect(0, 0, W, H);
  const g = c.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, W * 0.75); g.addColorStop(0, '#17191c'); g.addColorStop(1, '#060708');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // rails to one vanishing point, the two in the middle lit, as on the site
  const vx = W * 0.5, vy = H * 0.36;
  for (let k = -9; k <= 9; k++) { const on = k === 0 || k === 1; c.strokeStyle = on ? 'rgba(237,235,230,.22)' : 'rgba(237,235,230,.05)'; c.lineWidth = on ? 2 : 1; c.beginPath(); c.moveTo(vx, vy); c.lineTo(vx + (k - 0.5) * 220, H + 40); c.stroke(); }
  // the site's cut-corner frame
  c.strokeStyle = 'rgba(237,235,230,.2)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(56, 28); c.lineTo(W - 28, 28); c.lineTo(W - 28, H - 56); c.lineTo(W - 56, H - 28); c.lineTo(28, H - 28); c.lineTo(28, 56); c.closePath(); c.stroke();
  // brand and date
  c.fillStyle = INK; c.save(); c.translate(70, 64); c.scale(0.1, 0.1); c.translate(-136, -56); c.fill(new Path2D(MARK)); c.restore();
  c.font = disp(46); c.textBaseline = 'alphabetic'; c.fillText('SHUNTDESK', 112, 104);
  const d = new Date(r.t); c.font = mono(20); c.fillStyle = MUT; c.textAlign = 'right';
  c.fillText(`DAILY REPORT · ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase()} · ${d.toISOString().slice(11, 16)} UTC`, W - 70, 100); c.textAlign = 'left';
  // the balance
  c.font = mono(20); c.fillStyle = MUT; c.fillText('CREW DESK · PAPER USDG', 70, 210);
  c.font = disp(190); c.fillStyle = INK; c.fillText(money(r.equity), 62, 380);
  const col = v => v > 0 ? LONG : v < 0 ? SHORT : MUT;
  c.font = mono(30, 700); c.fillStyle = col(r.change); c.fillText(`${signed(r.change)} in 24 hours`, 70, 440);
  c.font = mono(22); c.fillStyle = MUT; c.fillText(`${signed(r.total)} since it started with ${r.start.toLocaleString('en-US')}`, 70, 482);
  // the tiles
  const tiles = [
    ['VERDICTS', `${r.verdicts.CLEAN} · ${r.verdicts.RISKY} · ${r.verdicts.DANGER}`, 'clean · risky · danger'],
    ['HELD AN HOUR LATER', r.judged ? `${r.held} of ${r.judged}` : 'none yet', 'clean higher, danger lower'],
    ['TRADES CLOSED', r.closed ? `${r.wins} of ${r.closed}` : '0', r.closed ? 'closed in profit' : 'none in 24 hours'],
    ['GRADUATED FROM PONS', String(r.grads), 'seen on the board'],
  ];
  const tw = (W - 140 - 3 * 24) / 4;
  tiles.forEach(([k, v, s], i) => {
    const x = 70 + i * (tw + 24), y = 560;
    c.fillStyle = 'rgba(16,17,19,.85)'; c.strokeStyle = 'rgba(237,235,230,.14)'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x + 18, y); c.lineTo(x + tw, y); c.lineTo(x + tw, y + 170 - 18); c.lineTo(x + tw - 18, y + 170); c.lineTo(x, y + 170); c.lineTo(x, y + 18); c.closePath(); c.fill(); c.stroke();
    c.font = mono(17, 700); c.fillStyle = INK; c.fillText(k, x + 26, y + 44);
    c.font = disp(v.length > 9 ? 60 : 74); c.fillText(v, x + 24, y + 120);
    c.font = mono(16); c.fillStyle = MUT; c.fillText(s, x + 26, y + 152);
  });
  // best and worst
  const line = (h, lab) => h ? `${lab} ${h.sym} ${h.side} ${signed(h.pnl)}` : '';
  const bw = [line(r.best, 'BEST'), line(r.worst, 'WORST')].filter(Boolean).join('    ·    ') || 'NO TRADE CLOSED IN THE LAST 24 HOURS';
  c.font = mono(20); c.fillStyle = MUT; c.fillText(bw.toUpperCase(), 70, 810);
  c.textAlign = 'right'; c.fillText('PAPER ONLY · NOT ADVICE · SHUNTDESK.COM', W - 70, 810); c.textAlign = 'left';
}

function stats(r) {
  const t = (k, v, s) => `<div class="stub stat"><div class="in"><div class="cap"><b>${k}</b></div><div class="v">${v}</div><small>${s}</small></div></div>`;
  $('#r-stats').innerHTML = t('Open now', r.open, 'crew positions') + t('Best trade', r.best ? signed(r.best.pnl) : '—', r.best ? `${r.best.sym} ${r.best.side}, ${r.best.why}` : 'none closed in 24 h')
    + t('Worst trade', r.worst ? signed(r.worst.pnl) : '—', r.worst ? `${r.worst.sym} ${r.worst.side}, ${r.worst.why}` : 'none closed in 24 h') + t('Since the start', signed(r.total), 'paper USDG');
}

async function load() {
  try { rep = await api('report'); } catch (e) { rep = null; }
  if (!rep || rep.error) { $('#r-msg').textContent = 'THE CREW DESK IS NOT ANSWERING. TRY AGAIN IN A MINUTE.'; return; }
  await document.fonts.load(disp(40)); await document.fonts.load(mono(20)); await document.fonts.load(mono(20, 700));
  draw(rep); stats(rep);
  const n = $('#r-note'); if (n && rep.note?.text) { n.hidden = false; n.innerHTML = `<b>The conductor</b><p>${rep.note.text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p><small>${rep.note.by === 'model' ? 'written by a language model from the figures above; it explains, it does not trade' : 'written from the figures above by fixed rules'}</small>`; }
  $('#r-msg').textContent = `THE CREW DESK'S OWN FIGURES, READ AT ${new Date(rep.t).toTimeString().slice(0, 5)}.`;
}
$('#r-save').onclick = () => { if (!rep) return; cv.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `shuntdesk-report-${new Date(rep.t).toISOString().slice(0, 10)}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png'); };
$('#r-x').onclick = () => {
  if (!rep) return;
  const v = rep.verdicts, txt = `Shuntdesk daily report: crew desk at ${money(rep.equity)} paper USDG (${signed(rep.change)}). ${v.CLEAN + v.RISKY + v.DANGER} verdicts, ${rep.judged ? `${rep.held} of ${rep.judged} held an hour later` : 'none checked an hour later yet'}. Misses included.`;
  window.open('https://x.com/intent/post?text=' + encodeURIComponent(txt) + '&url=' + encodeURIComponent('https://shuntdesk.com/report/'), '_blank', 'noopener');
};
load(); setInterval(load, 120000);
