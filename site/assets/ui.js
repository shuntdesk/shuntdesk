// Shared chrome: header, footer, the pointer light on cards, split-flap text.
import { blockNumber, newPools, cachedScan, graduates } from './data.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MARK = 'M136 456V297.7L292 173.7V90L326 56H376V214.3L220 338.3V422L186 456Z';   // the Shuntdesk mark: one stroke leaving its lane for the next
const LOGO = `<svg viewBox="136 56 240 400" fill="currentColor" aria-hidden="true"><path d="${MARK}"/></svg>`;
const NAV = [['Yard', '/'], ['Board', '/board/'], ['Desk', '/desk/'], ['Ticket', '/ticket/'], ['Tools', '/tools/'], ['Docs', '/docs/']];
// the project's X account, shown in the header and the footer; empty hides both links
const X_HANDLE = 'shuntdesk';
const X_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
// the token's contract, shown in the header with a copy button; empty hides it
const CA = '0x7e517e779b85895894becad80c9bb69b4cb1c4d6';
const caChip = () => CA ? `<button class="cachip" type="button" title="Copy the contract address" aria-label="Copy the contract address ${CA}"><b>CA</b><span>${CA.slice(0, 6)}…${CA.slice(-4)}</span><i>COPY</i></button>` : '';
const xLink = cls => X_HANDLE ? `<a class="${cls}" href="https://x.com/${X_HANDLE}" target="_blank" rel="noopener" aria-label="Shuntdesk on X">${X_ICON}<span>@${X_HANDLE}</span></a>` : '';

export function mountChrome(active) {
  const top = el(`<header class="top">
    <a class="logo" href="/">${LOGO}<b>SHUNTDESK</b></a>
    <nav>${NAV.map(n => `<a href="${n[1]}"${n[0] === active ? ' class="on"' : ''}>${n[0]}</a>`).join('')}</nav>
    <div class="sp"></div>
    ${caChip()}
    ${xLink('xlink')}
    <div class="chain"><i></i><span>ROBINHOOD CHAIN</span><b id="blk">······</b></div>
  </header>`);
  document.body.prepend(top);
  const chip = $('.cachip', top);
  if (chip) chip.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(CA); ok = true; } catch (e) {
      const t = document.createElement('textarea'); t.value = CA; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.append(t); t.select();
      try { ok = document.execCommand('copy'); } catch (e2) {} t.remove();
    }
    const i = $('i', chip), lab = getComputedStyle(i).display === 'none' ? $('b', chip) : i, was = lab.textContent;   // on a phone only 'CA' shows, so that is what answers
    const small = lab.tagName === 'B'; lab.textContent = ok ? (small ? 'OK' : 'COPIED') : (small ? '!' : 'COPY FAILED'); chip.classList.toggle('done', ok);
    clearTimeout(chip._t); chip._t = setTimeout(() => { lab.textContent = was; chip.classList.remove('done'); }, 1600);
  });
  const tick = async () => { try { const n = await blockNumber(); $('#blk').textContent = '#' + n.toLocaleString('en-US'); } catch (e) {} };
  tick(); setInterval(tick, 12000);

  const foot = $('.foot');
  const phrase = '<span>Every token rides the line</span><b>✦</b><span class="f">Shuntdesk</span><b>✦</b><span>A scanner with something to lose</span><b>✦</b><span class="f">Paper money, real data</span><b>✦</b>';
  if (foot) foot.innerHTML = `
    <div class="mq"><div>${phrase}${phrase}</div></div>
    <div class="fgrid">
      <div class="fbrand"><a class="logo" href="/">${LOGO}<b>SHUNTDESK</b></a><p>We check tokens on Robinhood Chain, then bet paper money on our own verdicts. The balance is public. So are the misses.</p><div class="pills"><span>PAPER ONLY</span><span>NO WALLET</span><span>NO KEY</span></div>${xLink('xlink xfoot')}</div>
      <div class="fcol"><h5>The line</h5>${NAV.map(n => `<a href="${n[1]}">${n[0]}</a>`).join('')}<a href="/exit/">Exit Door</a><a href="/hand/">Same Hand</a><a href="/stocks/">Stock gap</a><a href="/report/">Daily report</a><a href="/deployer/">Deployer record</a><a href="/replay/">Rug replay</a><a href="/play/">The Yard (game)</a><a href="/agents/">For agents</a><a href="https://t.me/shuntdesk" target="_blank" rel="noopener">Telegram community ↗</a><a href="https://t.me/shuntdesk_bot" target="_blank" rel="noopener">Telegram bot ↗</a><a href="https://huggingface.co/datasets/shuntdesk/verdicts" target="_blank" rel="noopener">Open data ↗</a><a href="https://github.com/shuntdesk/shuntdesk" target="_blank" rel="noopener">Source code ↗</a><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a></div>
      <div class="fcol"><h5>Read from</h5><span>DexScreener</span><span>GeckoTerminal</span><span>Blockscout</span><span>GoPlus</span><span>Codex</span><span>Binance</span><span>Robinhood Chain RPC</span><span>Surplus · ChargeAI</span><span>Hugging Face</span></div>
      <div class="stub endplate"><div class="in"><div class="cap"><b>Terminus</b><span>end of the line</span></div><h4>Ride it again.</h4><a class="btn" href="/ticket/">Board with a token →</a></div></div>
    </div>
    <p class="fine">Every balance and position here is simulated. Verdicts come from fixed rules reading public chain data, so they can be wrong. A clean verdict is not a reason to buy, and a danger verdict is not proof of fraud. Not financial advice.</p>`;

  // cards: a light under the pointer, and a lean toward it
  let lit = null;
  const ret = el('<div class="ret"></div>'); document.body.append(ret);
  let rx = 0, ry = 0, tx = 0, ty = 0;
  addEventListener('pointermove', e => {
    tx = e.clientX; ty = e.clientY; ret.classList.add('on');
    ret.classList.toggle('big', !!(e.target.closest && e.target.closest('a, button, .chip, input, .sw')));
    const s = e.target.closest ? e.target.closest('.stub') : null;
    if (lit && lit !== s) ['--rx', '--ry', '--px', '--py'].forEach(v => lit.style.removeProperty(v));
    lit = s; if (!s) return;
    const r = s.getBoundingClientRect(), inn = s.firstElementChild, px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    inn.style.setProperty('--mx', (e.clientX - r.left) + 'px'); inn.style.setProperty('--my', (e.clientY - r.top) + 'px');
    // A card with anything to press or type in must hold still: if it leans or shrinks between the press and the
    // release, the release lands on something else and the browser does not count it as a click.
    if (s.querySelector('button, input, a, select, .chip')) return;
    // small cards lean hard, wide panels barely move; the contents shift against the lean for depth
    const deg = 15 * Math.min(1, 360 / r.width);
    s.style.setProperty('--ry', ((px - 0.5) * 2 * deg).toFixed(2) + 'deg'); s.style.setProperty('--rx', ((0.5 - py) * 2 * deg).toFixed(2) + 'deg');
    s.style.setProperty('--px', ((px - 0.5) * 2).toFixed(3)); s.style.setProperty('--py', ((py - 0.5) * 2).toFixed(3));
  }, { passive: true });
  // a click: one small ring, briefly
  addEventListener('pointerdown', e => {
    const n = el(`<div class="burst" style="left:${e.clientX}px;top:${e.clientY}px"></div>`); document.body.append(n); setTimeout(() => n.remove(), 500);
  }, { passive: true });
  (function follow() { rx += (tx - rx) * 0.2; ry += (ty - ry) * 0.2; ret.style.translate = `${rx.toFixed(1)}px ${ry.toFixed(1)}px`; requestAnimationFrame(follow); })();

  // no wipe between pages: on a phone the next page loads slower than the wipe, which left the screen black
  mountZoom();
}

// A card that carries a hidden .more block opens in place: it grows from where it sits to the middle of the
// screen and shows the full detail. The page behind stays where it was. Close: the button, a click outside, Esc.
function mountZoom() {
  const cards = $$('.stub').filter(c => c.querySelector(':scope > .in > .more'));
  for (const c of cards) { c.classList.add('zoomable'); c.tabIndex = 0; c.setAttribute('role', 'button'); c.firstElementChild.insertAdjacentHTML('beforeend', '<i class="zhint">+ details</i>'); }
  let open = null;
  function show(card) {
    if (open) return;
    const inn = card.firstElementChild, kind = ['g', 'r', 'n'].find(k => card.classList.contains(k)) || '';
    const veil = el(`<div class="zoom"><div class="zwrap"><button class="zx" type="button">Close ✕</button><div class="stub ${kind} zcard"><div class="in"><div class="zhead"></div><div class="zbody"></div></div></div></div></div>`);
    const head = $('.zhead', veil);
    for (const n of inn.children) if (!n.matches('.more, .zhint')) head.append(n.cloneNode(true));
    $('.zbody', veil).innerHTML = $('.more', inn).innerHTML;
    document.body.append(veil);
    const wrap = veil.firstElementChild, from = card.getBoundingClientRect(), to = wrap.getBoundingClientRect();
    const place = r => `translate(${r.left - to.left}px, ${r.top - to.top}px) scale(${r.width / to.width}, ${r.height / to.height})`;
    wrap.style.transform = place(from); card.style.visibility = 'hidden';
    const scrollY0 = scrollY, lock = () => scrollTo(0, scrollY0);   // the page must not travel underneath
    addEventListener('scroll', lock);
    requestAnimationFrame(() => requestAnimationFrame(() => { veil.classList.add('on'); wrap.style.transform = 'none'; }));
    open = () => {
      veil.classList.remove('on'); wrap.style.transform = place(card.getBoundingClientRect());
      setTimeout(() => { veil.remove(); card.style.visibility = ''; removeEventListener('scroll', lock); open = null; }, 380);
    };
    veil.addEventListener('click', e => { if (!e.target.closest('.zcard') || e.target.closest('.zx')) open(); });
    $('.zx', veil).focus({ preventScroll: true });
  }
  addEventListener('click', e => { const c = e.target.closest ? e.target.closest('.zoomable') : null; if (c && !e.target.closest('a, button, input')) show(c); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && open) open();
    else if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.classList?.contains('zoomable')) { e.preventDefault(); show(document.activeElement); }
  });
}


// names the trains after the newest pools; a train takes a branch only if this browser has scanned that token
export async function feedYard(yard, rows) {
  try {
    rows = rows || (await newPools()).rows;
    const train = r => ({ sym: r.sym.toUpperCase().slice(0, 8), to: cachedScan(r.addr)?.platform || null, grad: !!r.grad });
    yard.setTokens(rows.slice(0, 7).map(train));
    // two of the trains carry tokens that just graduated from Pons, when there are any
    const g = await graduates().catch(() => []);
    if (g.length) yard.setTokens([...g.slice(0, 2).map(train), ...rows.filter(r => !g.some(x => x.addr === r.addr)).slice(0, 5).map(train)]);
  } catch (e) {}
}

const GLYPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
// split-flap: letters tumble, then settle left to right
export function flap(node, text, ms = 520) {
  text = String(text);
  if (node._flapTo === text) return;
  node._flapTo = text; cancelAnimationFrame(node._flap);
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / ms);
    let out = '';
    for (let i = 0; i < text.length; i++) out += (i / text.length < k || text[i] === ' ') ? text[i] : GLYPH[(Math.random() * GLYPH.length) | 0];
    node.textContent = out;
    if (k < 1) node._flap = requestAnimationFrame(step);
  };
  node._flap = requestAnimationFrame(step);
}
export const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
// 0 outside [a,b], 1 inside, with soft edges of width e
export const band = (p, a, b, e = 0.025) => clamp((p - a) / e) * clamp((b - p) / e);
