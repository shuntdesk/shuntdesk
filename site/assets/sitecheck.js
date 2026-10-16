// Site Check, drawn into a box: the token's links, the website's age, what Safe Browsing, urlscan and the page itself
// say. Shared by the ticket and the Agent Scan page. A new urlscan scan takes a little while, so a pending result is
// asked for again a few times.
import { api, esc } from './data.js';

const LV = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };
export async function siteCheck(box, token, links = [], onDone) {
  box.innerHTML = '<p class="note" style="margin:0">CHECKING THE WEBSITE AND LINKS…</p>';
  let v = null;
  for (let i = 0; i < 5; i++) {
    try { v = await api(`site?a=${token}${links.length ? '&u=' + encodeURIComponent(links.join(' ')) : ''}`); } catch (e) { v = null; }
    if (!v?.ok || !v.pending) break;
    paint(box, v); await new Promise(r => setTimeout(r, 12000));
  }
  if (!v?.ok) { box.innerHTML = `<p class="note" style="margin:0">${esc((v?.why || 'not answering right now').toUpperCase())}.</p>`; return; }
  paint(box, v); onDone && onDone(v);
}
function paint(box, v) {
  const w = v.website, us = w?.urlscan;
  const flags = v.flags.map(f => `<div class="xr-r ${f.level}"><em>${LV[f.level]}</em><span style="color:var(--ink)">${esc(f.text)}</span></div>`).join('');
  const links = v.links.map(l => `<a class="sc-l${l.threat ? ' bad' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener nofollow">${esc(l.kind)}<small>${esc(l.url.replace(/^https?:\/\//, '').slice(0, 40))}</small></a>`).join('');
  const facts = w ? [
    ['Domain', esc(w.domain)],
    ['Registered', w.registered ? `${w.registered.slice(0, 10)} · ${w.ageDays} day${w.ageDays === 1 ? '' : 's'} ago` : 'not found'],
    ['Google Safe Browsing', v.links.some(l => l.threat) ? '<b class="short">listed</b>' : 'not listed'],
    ['urlscan.io', !us ? 'not scanned' : us.status === 'scanning' ? 'scanning now…' : us.malicious ? '<b class="short">malicious</b>' : `clean · ${us.requests ?? '?'} requests · <a href="${us.report}" target="_blank" rel="noopener">report ↗</a>`],
    ['The page', w.page ? `${w.page.words.toLocaleString('en-US')} words${w.page.connect ? ' · asks to connect a wallet' : ''}${w.page.seed ? ' · <b class="short">asks for a seed phrase</b>' : ''}` : 'could not be read'],
  ].map(([k, x]) => `<div><span>${k}</span><b>${x}</b></div>`).join('') : '';
  box.innerHTML = `${flags || '<p class="note" style="margin:0 0 6px">NOTHING FOUND AGAINST THE WEBSITE OR ITS LINKS.</p>'}
    ${w ? `<div class="sc-w">${us?.status === 'done' ? `<a href="${us.report}" target="_blank" rel="noopener"><img src="${us.screenshot}" alt="The website, as urlscan.io saw it" loading="lazy"></a>` : ''}<div class="xr-st">${facts}</div></div>${w.page?.summary ? `<p class="xr-sum" style="font-size:15px">${esc(w.page.summary)}</p>` : ''}` : ''}
    ${links ? `<div class="sc-ls">${links}</div>` : ''}`;
}
