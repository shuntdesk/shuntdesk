// The popup: the watchlist on this code, what changed, and a place to paste a code from the site, the CLI or the bot.
const $ = id => document.getElementById(id), send = m => chrome.runtime.sendMessage(m);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? m + 'm' : m < 2880 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; };

async function paint() {
  const r = await send({ type: 'list' });
  if (!r?.ok) { $('m').innerHTML = `<p class="s">Not answering right now: ${esc(r?.why || '')}</p>`; return; }
  if (!r.code) {
    $('st').textContent = 'no watchlist yet';
    $('m').innerHTML = `<p>Press <b>Watch</b> on any token's Shuntdesk panel on Pons or DexScreener, or paste the code you use on shuntdesk.com, the CLI or the bot.</p>
      <input id="c" placeholder="wl-xxxxxx" spellcheck="false"><button id="use">Use this code</button><p class="s" id="msg"></p>`;
    $('use').onclick = use; return;
  }
  $('st').textContent = `${r.code} · ${r.tokens.length} of ${r.max}`;
  const rows = r.tokens.map(t => { const n = t.now, s = !n ? '<span class="s">read soon</span>' : n.bonded ? '<span style="color:#2ed3a0">bonded</span>' : n.progress != null ? `<span class="bar"><u style="width:${Math.min(100, n.progress)}%"></u></span>${n.progress.toFixed(1)}%` : n.price ? '$' + n.price.toPrecision(3) : '<span class="s">no price</span>';
    return `<div class="row"><a href="https://shuntdesk.com/ticket/?a=${t.a}" target="_blank">$${esc(t.sym || t.a.slice(0, 8))}</a><span>${s}</span></div>`; }).join('');
  const ev = (r.events || []).slice(0, 6).map(e => `<p><span class="s">${ago(e.t)}</span> ${esc(e.text)}</p>`).join('');
  $('m').innerHTML = (rows || '<p class="s">No tokens yet: press Watch on a token page.</p>') + `<div class="ev">${ev || '<p class="s">Nothing has changed yet. You hear about it here and as a notification.</p>'}</div>
    <p class="s" style="margin-top:10px">Same list on shuntdesk.com, in the CLI (<code>npx shuntdesk watchlist ${r.code}</code>) and the bot (<code>/watchlist ${r.code}</code>).</p>
    <button class="g" id="other">Use another code</button>`;
  $('other').onclick = async () => { await send({ type: 'forget' }); paint(); };
}
async function use() { const r = await send({ type: 'use', code: $('c').value }); if (r?.ok) paint(); else $('msg').textContent = r?.why || 'No watchlist with that code.'; }
paint();
