// Shuntdesk on the page: finds the token a Pons or DexScreener page is about, reads it through shuntdesk.com's
// read-only agent interface, and shows what the chain shows in a small panel. Nothing is signed, nothing is stored.
(() => {
  const BASE = 'https://shuntdesk.com', cache = new Map();
  const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a || ''), isSol = a => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a || '');
  const get = async path => { const r = await fetch(BASE + '/api/v1/' + path, { headers: { Accept: 'application/json' } }); const j = await r.json().catch(() => null); if (!j || j.error || j.ok === false) throw new Error(j?.why || j?.error || 'not answering'); return j; };
  const soft = path => get(path).then(v => ({ v }), e => ({ why: e.message }));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (v, d = 1) => v == null ? '—' : Number(v).toFixed(d) + '%';
  const n0 = v => v == null ? '—' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v).toLocaleString('en-US');
  const dead = o => /^0x0{40}$/i.test(o || '') || /dead$/i.test(o || '');

  // which token this page is about
  async function tokenOfPage() {
    const u = location.href;
    let m = /ponsfamily\.com\/(?:launchpad|token|coin)\/(0x[0-9a-fA-F]{40})/i.exec(u); if (m) return m[1].toLowerCase();
    m = /dexscreener\.com\/robinhood\/(0x[0-9a-fA-F]{40,64})/i.exec(u);
    if (m) { const id = m[1].toLowerCase(); if (cache.has('pair:' + id)) return cache.get('pair:' + id);
      try { const j = await (await fetch(`https://api.dexscreener.com/latest/dex/pairs/robinhood/${id}`)).json(); const t = (j.pairs || j.pair && [j.pair] || [])[0]?.baseToken?.address?.toLowerCase(); const out = t || (id.length === 42 ? id : null); cache.set('pair:' + id, out); return out; } catch (e) { return id.length === 42 ? id : null; } }
    // Solana: a Pump.fun coin, a DexScreener Solana pair, a Solscan token (base58 keeps its case)
    m = /pump\.fun\/(?:coin\/)?([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(u); if (m) return m[1];
    m = /solscan\.io\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(u); if (m) return m[1];
    m = /dexscreener\.com\/solana\/([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(u);
    if (m) { const id = m[1]; if (cache.has('pair:' + id)) return cache.get('pair:' + id);
      let out = null; try { const j = await (await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${id}`)).json(); out = (j.pairs || j.pair && [j.pair] || [])[0]?.baseToken?.address || null; } catch (e) {}
      if (!out) out = id;   // a mint can be in the address too
      cache.set('pair:' + id, out); return out; }
    m = /(0x[0-9a-fA-F]{40})/.exec(location.pathname); return m ? m[1].toLowerCase() : null;
  }

  // the same findings the CLI and the ticket give: what was read, sorted, never a verdict of safe
  function findings(tok, scan, led, sim) {
    const F = [], add = (lvl, text) => { if (!F.some(f => f.text === text)) F.push({ lvl, text }); };
    if (scan) { const ren = scan.owner && dead(scan.owner);
      for (const p of (scan.powers || []).filter(p => p.level === 'high').slice(0, 4)) add(ren ? 'y' : 'r', `the contract can ${p.what}${ren ? ', owner renounced' : ''}`);
      if (scan.proxy) add('r', 'behind a proxy: the code can be swapped');
      if (!(scan.powers || []).some(p => p.level === 'high') && !scan.proxy) add('g', 'no function that mints, pauses, blocks wallets or changes the tax'); }
    for (const f of tok?.serverCheck?.redFlags || []) add('r', f);
    const l = tok?.launch; if (l?.ok) { if (l.bundlerPct > 5) add('y', `bundles hold ${pct(l.bundlerPct)}`); if (l.sniperPct > 5) add('y', `snipers hold ${pct(l.sniperPct)}`); if (l.insiderPct > 5) add('y', `insiders hold ${pct(l.insiderPct)}`); }
    if (led) { const L = led.ledger || {}, got = (L.bought || 0) + (L.received || 0);
      if (got) { const sh = k => (L[k] || 0) / got;
        if (sh('sold') >= 0.5) add('r', `the launcher sold ${pct(sh('sold') * 100, 0)} of what it got`); else if (sh('sold') > 0) add('y', `the launcher sold ${pct(sh('sold') * 100, 0)}`);
        if (sh('toWallets') >= 0.25) add('y', `the launcher sent ${pct(sh('toWallets') * 100, 0)} to other wallets`);
        if (sh('burned') >= 0.5) add('g', `the launcher burned ${pct(sh('burned') * 100, 0)} of what it got`);
        if (!L.sold && !L.toWallets) add('g', 'the launcher has not sold or sent its tokens away'); }
      if (led.partial) add('y', 'part of the launcher\'s history could not be read'); }
    if (sim) { const f = sim.fee, inn = 0.05 * (1 - f), tok2 = sim.tokens * inn / (sim.quoteEth + inn), Q1 = sim.quoteEth + inn, T1 = sim.tokens - tok2, back = Math.min(Q1 * tok2 / (T1 + tok2), sim.realEth + inn) * (1 - f);
      add(back / 0.05 - 1 < -0.04 ? 'y' : 'g', `a 0.05 ETH round trip on the curve comes back ${((back / 0.05 - 1) * 100).toFixed(1)}% after fees`); }
    return F.sort((a, b) => 'ryg'.indexOf(a.lvl) - 'ryg'.indexOf(b.lvl));
  }

  // the panel lives in its own shadow root, so the page's styles never touch it
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;'; const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host { all: initial; } * { box-sizing: border-box; }
    .p { width: 340px; transition: width .15s; } .min.p { width: 250px; } .p { font: 13px/1.45 ui-monospace, "JetBrains Mono", Consolas, monospace; color: #e8e6e1; background: rgba(9,10,12,.96); border: 1px solid rgba(237,235,230,.22); border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.55); overflow: hidden; }
    .h { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: rgba(237,235,230,.06); border-bottom: 1px solid rgba(237,235,230,.1); cursor: pointer; user-select: none; }
    .h svg { width: 12px; height: 18px; color: #edebe6; } .h b { letter-spacing: .18em; font-size: 11px; } .h span { margin-left: auto; color: #8d8b86; font-size: 11px; } .h span em { font-style: normal; margin-left: 6px; } .h .cr { color: #ff6b6b; } .h .cy { color: #f0c75e; } .h .cg { color: #2ed3a0; }
    .b { padding: 10px 12px 12px; max-height: 60vh; overflow: auto; } .min .b { display: none; }
    .t { font-weight: 700; font-size: 15px; } .s { color: #8d8b86; font-size: 11px; word-break: break-all; }
    .row { display: flex; justify-content: space-between; gap: 10px; margin-top: 4px; } .row i { color: #8d8b86; font-style: normal; }
    .bar { height: 6px; background: #26272a; border-radius: 3px; margin-top: 6px; overflow: hidden; } .bar u { display: block; height: 100%; background: #2ed3a0; }
    ul { list-style: none; padding: 0; margin: 10px 0 0; border-top: 1px solid rgba(237,235,230,.1); padding-top: 8px; } li { padding: 3px 0 3px 16px; position: relative; }
    li::before { content: ""; position: absolute; left: 2px; top: 9px; width: 7px; height: 7px; border-radius: 50%; } li.r::before { background: #ff6b6b; } li.y::before { background: #f0c75e; } li.g::before { background: #2ed3a0; } li.u { color: #8d8b86; } li.u::before { border: 1px solid #8d8b86; }
    a { color: #6fd3ff; text-decoration: none; } .f { margin-top: 10px; display: flex; justify-content: space-between; font-size: 11px; } .f em { color: #6f6d68; font-style: normal; }
    .v-CLEAN { color: #2ed3a0; } .v-RISKY { color: #f0c75e; } .v-DANGER { color: #ff6b6b; }
  </style><div class="p"><div class="h"><svg viewBox="136 56 240 400"><path fill="currentColor" d="M136 456V297.7L292 173.7V90L326 56H376V214.3L220 338.3V422L186 456Z"/></svg><b>SHUNTDESK</b><span id="st">reading…</span></div><div class="b" id="body"></div></div>`;
  const $ = id => root.getElementById(id), panel = root.querySelector('.p');
  let min = true; try { min = sessionStorage.getItem('sd.ext.min') !== '0'; } catch (e) {}   // folded by default, so it never sits over a page's buttons
  panel.classList.toggle('min', min);
  root.querySelector('.h').addEventListener('click', () => { min = !min; panel.classList.toggle('min', min); const ar = root.querySelector('.h span em:last-child'); if (ar) ar.textContent = min ? '▴' : '▾'; try { sessionStorage.setItem('sd.ext.min', min ? '1' : '0'); } catch (e) {} });

  let current = null, job = 0;
  async function show() {
    const a = await tokenOfPage(); if (a === current) return; current = a;
    if (!a) { host.remove(); return; } if (!host.isConnected) document.documentElement.appendChild(host);
    const id = ++job; $('st').textContent = 'reading…'; $('body').innerHTML = `<div class="s">${a}</div>`;
    if (isSol(a) && !isAddr(a)) return showSol(a, id);
    let parts = cache.get(a);
    if (!parts) { const [t, x, d] = await Promise.all([soft('token?a=' + a), soft('scan?a=' + a), soft('ledger?a=' + a)]);
      const onCurve = t.v?.launch?.ok && /pons/i.test(t.v.launch.launchpad || '') && !t.v.launch.graduated; const s = onCurve ? await soft('sim?a=' + a) : null;
      parts = { t, x, d, s }; cache.set(a, parts); setTimeout(() => cache.delete(a), 5 * 60000); }
    if (id !== job) return;
    const { t, x, d, s } = parts, tok = t.v, vd = tok?.verdict, l = tok?.launch, F = findings(tok, x.v, d.v, s?.v);
    const unread = [['token', t], ['contract', x], ['launcher', d], ...(s ? [['curve', s]] : [])].filter(([, r]) => r.why);
    const cnt = k => F.filter(f => f.lvl === k).length;
    $('st').innerHTML = (vd ? `<em class="v-${vd.verdict}">${vd.verdict}</em>` : '') + (cnt('r') ? `<em class="cr">● ${cnt('r')}</em>` : '') + (cnt('y') ? `<em class="cy">● ${cnt('y')}</em>` : '') + (cnt('g') ? `<em class="cg">● ${cnt('g')}</em>` : '') + `<em>${min ? '▴' : '▾'}</em>`;
    $('body').innerHTML = `<div class="t">${esc(tok?.symbol ? '$' + tok.symbol : a.slice(0, 10))}${vd ? ` <span class="v-${vd.verdict}">${vd.verdict} ${vd.score}/100</span>` : ''}</div><div class="s">${a}</div>
      ${l?.ok ? `<div class="row"><i>holders</i><span>${n0(tok.serverCheck?.holders ?? l.holders)}</span></div>${l.liquidity ? `<div class="row"><i>liquidity</i><span>$${n0(l.liquidity)}</span></div>` : ''}` : ''}
      ${s?.v ? `<div class="row"><i>curve</i><span>${s.v.progress.toFixed(1)}% · ${s.v.raised.toFixed(3)} of ${s.v.need} ETH</span></div><div class="bar"><u style="width:${Math.min(100, s.v.progress)}%"></u></div>` : ''}
      <ul>${F.map(f => `<li class="${f.lvl}">${esc(f.text)}</li>`).join('')}${unread.map(([k, r]) => `<li class="u">${k} not read: ${esc(r.why).slice(0, 80)}</li>`).join('')}</ul>
      <div class="f"><a href="${BASE}/ticket/?a=${a}" target="_blank" rel="noopener">Full check →</a><a href="#" id="wt">Watch</a><a href="${BASE}/card/${a}" target="_blank" rel="noopener">Share card</a><em>not advice</em></div>`;
    // Watch puts the token on the watchlist this extension shares with the site, the CLI and the bot
    $('wt').addEventListener('click', async e => { e.preventDefault(); const b = e.currentTarget; b.textContent = 'Adding…';
      try { const r = await chrome.runtime.sendMessage({ type: 'watch', a, sym: tok?.symbol || '' }); b.textContent = r?.ok ? `Watching · ${r.code}` : 'Not added'; } catch (x) { b.textContent = 'Not added'; } });
  }
  // a Solana token: the seven checks and the deployer's ledger, read by shuntdesk.com
  async function showSol(a, id) {
    let parts = cache.get(a);
    if (!parts) { const [t, d] = await Promise.all([soft('sol?a=' + a), soft('ledger?a=' + a)]); parts = { t, d }; cache.set(a, parts); setTimeout(() => cache.delete(a), 5 * 60000); }
    if (id !== job) return;
    const { t, d } = parts, r = t.v, F = [], add = (lvl, text) => { if (text && !F.some(f => f.text === text)) F.push({ lvl, text }); };
    if (!r) { $('st').textContent = 'not read'; $('body').innerHTML = `<div class="s">${a}</div><ul><li class="u">${esc(t.why || 'not answering').slice(0, 90)}</li></ul>`; return; }
    for (const x of r.steps || []) { if (x.key === 'sources' || x.key === 'judge') continue; const first = String(x.detail || '').split(/(?<=\.)\s/)[0]; if (x.status === 'bad') add('r', first); else if (x.status === 'warn') add('y', first); }
    if (d.v) { const L = d.v.ledger || {}, got = (L.bought || 0) + (L.received || 0); if (got) { const sold = (L.sold || 0) / got; add(sold >= 0.5 ? 'r' : sold > 0 ? 'y' : 'g', sold > 0 ? `the deployer sold ${pct(sold * 100, 0)} of what it got` : 'the deployer has not sold'); }
      if (d.v.sideBuys?.length) add('y', `the deployer paid for buys landing in ${d.v.sideBuys.length} other wallet${d.v.sideBuys.length > 1 ? 's' : ''}`); }
    if ((r.steps || []).find(x => x.key === 'auditor')?.status === 'ok') add('g', 'mint and freeze authority both revoked');
    F.sort((p, q) => 'ryg'.indexOf(p.lvl) - 'ryg'.indexOf(q.lvl));
    const vd = r.verdict !== 'NO POOL' ? r : null, L = r.launch, cnt = k => F.filter(f => f.lvl === k).length;
    $('st').innerHTML = (vd ? `<em class="v-${vd.verdict}">${vd.verdict}</em>` : '') + (cnt('r') ? `<em class="cr">● ${cnt('r')}</em>` : '') + (cnt('y') ? `<em class="cy">● ${cnt('y')}</em>` : '') + (cnt('g') ? `<em class="cg">● ${cnt('g')}</em>` : '') + `<em>${min ? '▴' : '▾'}</em>`;
    $('body').innerHTML = `<div class="t">${esc(r.sym ? '$' + r.sym : a.slice(0, 10))}${vd ? ` <span class="v-${vd.verdict}">${vd.verdict} ${vd.score}/100</span>` : ''}</div><div class="s">${a} · Solana</div>
      ${r.holders != null ? `<div class="row"><i>holders</i><span>${n0(r.holders)}</span></div>` : ''}${r.liq ? `<div class="row"><i>liquidity</i><span>$${n0(r.liq)}</span></div>` : ''}
      ${L?.pad === 'pumpfun' && !L.graduated && L.progress != null ? `<div class="row"><i>Pump.fun curve</i><span>${L.progress.toFixed(1)}%${L.raised != null ? ` · ${L.raised.toFixed(1)} of ${L.need ?? 85} SOL` : ''}</span></div><div class="bar"><u style="width:${Math.min(100, L.progress)}%"></u></div>` : ''}
      <ul>${F.map(f => `<li class="${f.lvl}">${esc(f.text)}</li>`).join('')}${d.why ? `<li class="u">deployer not read: ${esc(d.why).slice(0, 80)}</li>` : ''}</ul>
      <div class="f"><a href="${BASE}/ticket/?a=${a}" target="_blank" rel="noopener">Full check →</a><a href="#" id="wt">Watch</a><a href="${BASE}/card/${a}" target="_blank" rel="noopener">Share card</a><em>not advice</em></div>`;
    $('wt').addEventListener('click', async e => { e.preventDefault(); const b = e.currentTarget; b.textContent = 'Adding…';
      try { const x = await chrome.runtime.sendMessage({ type: 'watch', a, sym: r.sym || '' }); b.textContent = x?.ok ? `Watching · ${x.code}` : 'Not added'; } catch (y) { b.textContent = 'Not added'; } });
  }
  show(); let last = location.href; setInterval(() => { if (location.href !== last) { last = location.href; show(); } }, 800);   // the pages change address without reloading
})();
