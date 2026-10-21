#!/usr/bin/env node
// shuntdesk: the Shuntdesk reads of Robinhood Chain tokens, from a terminal. Read-only, no key, the same answers as
// shuntdesk.com, through its agent interface (https://shuntdesk.com/llms.txt). Nothing here is advice.
import { simulate, breakEven, curveExit, poolExit } from '../lib/curve.mjs';
import { createInterface } from 'node:readline';

const VERSION = '1.3.0';
const BASE = (process.env.SHUNTDESK_API || 'https://shuntdesk.com').replace(/\/$/, '');
const RPC = process.env.SHUNTDESK_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const argv = process.argv.slice(2), flags = new Set(argv.filter(a => a.startsWith('--'))), args = argv.filter(a => !a.startsWith('--'));
const JSON_OUT = flags.has('--json');
const TTY = process.stdout.isTTY && !JSON_OUT;
const color = TTY && !process.env.NO_COLOR;

// ---------- the look ----------
const paint = c => s => color ? `\x1b[${c}m${s}\x1b[0m` : String(s);
const bold = paint('1'), dim = paint('2'), red = paint('31'), green = paint('32'), yellow = paint('33'), cyan = paint('36'), inv = paint('7');
const plain = s => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - plain(s).length));
const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const isSol = a => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a || '');   // a Solana mint: base58, case matters
const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '—';
const n0 = v => v == null ? '—' : v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? Math.round(v).toLocaleString('en-US') : (+(+v).toFixed(2)).toString();
const eth = v => v == null ? '—' : v.toFixed(v < 0.01 ? 5 : 4) + ' ETH';
const pc = (v, d = 1) => v == null ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
const pct = (v, d = 1) => v == null ? '—' : Number(v).toFixed(d) + '%';
const usd = v => v == null ? '—' : (v < 0 ? '-' : '') + '$' + (Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString('en-US') : Math.abs(v).toFixed(2));
const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 60 ? m + 'm ago' : m < 2880 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
const wrap = (s, w = 92) => String(s).split(' ').reduce((o, word) => { const l = o[o.length - 1]; if ((l + ' ' + word).trim().length > w) o.push(word); else o[o.length - 1] = (l + ' ' + word).trim(); return o; }, ['']).join('\n');
const bar = (p, w = 30, c = green) => { const f = Math.max(0, Math.min(w, Math.round((p || 0) / 100 * w))); return c('█'.repeat(f)) + dim('░'.repeat(w - f)); };
const line = (k, v) => console.log('  ' + dim(pad(k, 20)) + v);
const head = (s, sub = '') => console.log('\n ' + inv(bold(` ${s} `)) + (sub ? ' ' + dim(sub) : ''));
const foot = (note, link) => { if (note) console.log('\n' + dim(wrap(note).replace(/^/gm, '  '))); if (link) console.log('  ' + cyan(link)); console.log(); };
const box = (title, rows) => { const w = Math.max(plain(title).length + 4, ...rows.map(r => plain(r).length + 4)); console.log('  ┌─ ' + bold(title) + ' ' + '─'.repeat(Math.max(0, w - plain(title).length - 3)) + '┐'); for (const r of rows) console.log('  │ ' + pad(r, w - 1) + '│'); console.log('  └' + '─'.repeat(w) + '┘'); };
const MARK = ['   ▄▄', '  ███▀', ' ▄██▀', '▀▀'];
const banner = () => { if (!TTY) return; console.log(''); console.log(MARK.map((m, i) => '  ' + bold(m.padEnd(8)) + (i === 1 ? bold('SHUNTDESK') + dim('  ' + VERSION) : i === 2 ? dim('reads of Robinhood Chain tokens') : '')).join('\n')); };

// a spinner on stderr while a read is out; nothing when piped
async function spin(label, p) {
  if (!process.stderr.isTTY || JSON_OUT) return p;
  const F = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'; let i = 0; const t = setInterval(() => process.stderr.write(`\r  ${cyan(F[i++ % F.length])} ${dim(label)}   `), 80);
  try { return await p; } finally { clearInterval(t); process.stderr.write('\r' + ' '.repeat(plain(label).length + 8) + '\r'); }
}

// ---------- reads ----------
class ReadError extends Error {}
const fetchV1 = path => fetchAt('/api/v1/' + path);
async function fetchAt(path, body) {
  const H = { 'User-Agent': 'shuntdesk-cli/' + VERSION, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) };
  let r; try { r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) }); }
  catch (e) { throw new ReadError('could not reach ' + BASE + ': ' + (e.cause?.code || e.message)); }
  const j = await r.json().catch(() => null);
  if (r.status === 429) throw new ReadError((j?.error || 'rate limited') + '. Try again later.');
  if (!j) throw new ReadError('the server did not answer with data (' + r.status + ')');
  if (j.error) throw new ReadError(j.error);
  if (j.ok === false) throw new ReadError(j.why || 'not answering right now');
  return j;
}
const get = (path, label = 'reading') => spin(label, fetchV1(path)).catch(e => die(e.message));
const getApi = (path, label = 'reading', body) => spin(label, fetchAt('/api/' + path, body)).catch(e => die(e.message));
const flagVal = k => { const f = argv.find(a => a.startsWith('--' + k + '=')); return f ? f.slice(k.length + 3) : null; };
const soft = (path, tries = 2) => fetchV1(path).then(v => ({ v }), async e => tries > 1 && !/rate limited|run out|not a pons|bad address|0x followed/i.test(e.message) ? (await new Promise(r => setTimeout(r, 1500)), soft(path, tries - 1)) : { why: e.message });   // a read that may fail without ending the report
async function codeOf(a) { const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [a, 'latest'] }), signal: AbortSignal.timeout(20000) }); return (await r.json()).result; }
const ethCall = async (to, data) => { const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }), signal: AbortSignal.timeout(20000) }); const j = await r.json(); if (!j.result || j.result === '0x') throw new Error('not read'); return BigInt(j.result); };
async function supplyOf(a) { const [s, d] = await Promise.all([ethCall(a, '0x18160ddd'), ethCall(a, '0x313ce567')]); return Number(s / 10n ** (d > 4n ? d - 4n : 0n)) / (d > 4n ? 1e4 : 10 ** Number(d)); }
function die(msg) { if (JSON_OUT) console.log(JSON.stringify({ ok: false, why: msg })); else console.error('  ' + red('✖ ') + msg); if (!INTERACTIVE) process.exit(1); throw new ReadError(msg); }
const need = (a, what = 'token') => { if (isSol(a)) return a; if (!isAddr(a)) die(`pass a ${what} address: 0x followed by 40 hex characters, or a Solana address`); return a.toLowerCase(); };
const out = (j, render) => { if (JSON_OUT) console.log(JSON.stringify(j, null, 2)); else render(j); };
const toBond = h => h == null ? '' : h < 0.1 ? 'bonded at launch' : h < 1 ? Math.round(h * 60) + ' min to bond' : h.toFixed(1) + 'h to bond';
const dead = o => /^0x0{40}$/i.test(o || '') || /dead$/i.test(o || '');

// ---------- what a report says: findings, never a verdict of safe ----------
function findings({ tok, scan, led, sim, site, alike }) {
  const F = [], add = (lvl, text) => { if (!F.some(f => f.text === text)) F.push({ lvl, text }); };
  if (scan) {
    const renounced = scan.owner && dead(scan.owner);
    for (const p of (scan.powers || []).filter(p => p.level === 'high').slice(0, 4)) add(renounced ? 'yellow' : 'red', `the contract can ${p.what}${renounced ? ', but its owner is renounced' : ''}`);
    if (scan.proxy) add('red', 'it sits behind a proxy: the code can be swapped');
    if (!(scan.powers || []).some(p => p.level === 'high') && !scan.proxy) add('green', 'no function that mints, pauses, blocks wallets or changes the tax');
  }
  const s = tok?.serverCheck; for (const f of s?.redFlags || []) add('red', f);
  const l = tok?.launch;
  if (l?.ok) {
    if (l.bundlerPct > 5) add('yellow', `bundles hold ${pct(l.bundlerPct)}`); if (l.sniperPct > 5) add('yellow', `snipers hold ${pct(l.sniperPct)}`);
    if (l.insiderPct > 5) add('yellow', `insiders hold ${pct(l.insiderPct)}`); if (l.devPct > 10) add('yellow', `the dev holds ${pct(l.devPct)}`);
  }
  if (led) {
    const L = led.ledger || {}, got = (L.bought || 0) + (L.received || 0);
    if (got) {
      const sh = k => (L[k] || 0) / got;
      if (sh('sold') >= 0.5) add('red', `the launcher sold ${pct(sh('sold') * 100, 0)} of what it got`); else if (sh('sold') > 0) add('yellow', `the launcher sold ${pct(sh('sold') * 100, 0)} of what it got`);
      if (sh('toWallets') >= 0.25) add('yellow', `the launcher sent ${pct(sh('toWallets') * 100, 0)} to other wallets`);
      if (sh('burned') >= 0.5) add('green', `the launcher burned ${pct(sh('burned') * 100, 0)} of what it got`);
      if (!L.sold && !L.toWallets) add('green', 'the launcher has not sold or sent its tokens to other wallets');
    }
    if (led.partial) add('yellow', 'part of the launcher\'s history could not be read');
  }
  for (const f of site?.flags || []) add(f.level === 'high' ? 'red' : f.level === 'medium' ? 'yellow' : 'green', f.text.replace(/^The /, 'the '));
  if (site?.website?.urlscan?.malicious) add('red', 'urlscan.io marks its website as malicious');
  const d24 = alike?.after24h; if (d24?.n >= 5) add(d24.fell50 / d24.n >= 0.5 ? 'yellow' : 'green', `of ${d24.n} tokens that looked like it at launch, ${d24.fell50} lost half within a day`);
  if (sim) { const r = simulate(sim, 0.05); add(r.back / 0.05 - 1 < -0.04 ? 'yellow' : 'green', `a 0.05 ETH round trip on the curve comes back ${pc(r.back / 0.05 - 1)} after fees`); }
  return F.sort((a, b) => ['red', 'yellow', 'green'].indexOf(a.lvl) - ['red', 'yellow', 'green'].indexOf(b.lvl));
}
const dot = { red: red('●'), yellow: yellow('●'), green: green('●') };

// ---------- commands ----------
const COMMANDS = {
  // a Solana token: the same seven stops, read on the server
  async sol([a]) {
    if (!isSol(a)) die('pass a Solana mint address');
    const v = await get('sol?a=' + a, 'reading the token on Solana');
    out(v, r => {
      const col = r.verdict === 'CLEAN' ? green : r.verdict === 'RISKY' ? yellow : red;
      head((r.sym || short(a)) + (r.name ? ' · ' + r.name : ''), 'Solana');
      console.log('  ' + dim(r.addr) + '\n\n  ' + bold(col(r.verdict === 'NO POOL' ? 'NO POOL' : r.verdict + ' ' + r.score)) + dim(r.verdict === 'NO POOL' ? '' : ' / 100') + '\n');
      for (const st of r.steps.filter(x => x.key !== 'judge')) {
        const c = st.status === 'ok' ? green : st.status === 'bad' ? red : st.status === 'warn' ? yellow : dim;
        console.log('  ' + pad(bold(st.name), 10) + c(st.tag)); console.log(dim(wrap(st.detail, 84).replace(/^/gm, '    ')));
        if (st.facts?.length) console.log('    ' + st.facts.map(f => dim(f[0] + ' ') + f[1]).join(dim('  ·  ')));
        console.log();
      }
      foot('A rule-based reading of public Solana data. It can be wrong. Not advice.', BASE + '/ticket/?a=' + r.addr);
    });
  },
  // First Buyers: a Pump.fun launch's first seconds
  async first([a]) {
    if (!isSol(a)) die('pass a Pump.fun mint on Solana');
    const v = await get('first?a=' + a, 'reading the first trades on its curve');
    out(v, v => {
      head('First Buyers', short(v.token) + dim(' · Pump.fun'));
      if (v.devBoughtPct != null) line('the deployer', `bought ${pct(v.devBoughtPct)} at launch, holds ${pct(v.devHoldsPct)} now`);
      line('same slot', `${(v.sameSlotPct >= 20 ? red : v.sameSlot ? yellow : green)(bold(v.sameSlot + ' wallets'))} bought ${pct(v.sameSlotPct)} beside the launch ${dim('· hold ' + pct(v.sameSlotHoldsPct) + ' now')}`);
      line('first buyers', `${v.first} · ${v.soldAll} sold everything ${dim('· hold ' + pct(v.firstHoldsPct) + ' of the ' + pct(v.firstPct) + ' they bought')}`);
      if (v.fundedByDev) line('funded by the dev', red(String(v.fundedByDev)));
      for (const g of v.sharedFunders || []) line('one funder', yellow(`${g.n} wallets from ${short(g.funder)}, ${pct(g.boughtPct)} bought`));
      console.log(); for (const b of v.buyers.slice(0, 12)) console.log('  ' + pad(short(b.wallet), 14) + pad(b.isDev ? red('deployer') : b.byDev ? red('dev-funded') : b.sameSlot ? yellow('same slot') : dim('+' + b.secondsAfter + 's'), 14) + pad('bought ' + pct(b.boughtPct, 2), 18) + 'holds ' + pct(b.holdsPct, 2));
      foot(v.note, `${BASE}/ticket/?a=${v.token}`);
    });
  },
  // Graduation Watch: the Pump.fun curves closest to graduating
  async graduation() {
    const v = await get('graduation', 'reading the Pump.fun curves');
    out(v, v => {
      head('Graduation Watch', 'Pump.fun on Solana · closest first'); console.log();
      for (const r of v.rows.slice(0, 20)) console.log('  ' + pad(bold((r.symbol || '?').slice(0, 12)), 14) + pad(dim(short(r.token)), 14) + bar(r.progress, 16) + ' ' + pad(r.progress.toFixed(1) + '%', 8) + pad(r.raised == null ? dim('other quote') : `${r.raised.toFixed(1)}/${r.need} SOL`, 16) + (r.perHour == null ? dim('pace ···') : (r.perHour > 0 ? green : red)((r.perHour > 0 ? '+' : '') + r.perHour + ' pts/h')));
      if (v.graduated.length) { console.log('\n  ' + dim('just graduated: ') + v.graduated.slice(0, 6).map(g => `${g.symbol} (${ago(g.at)})`).join(', ')); }
      foot(v.note, `${BASE}/graduation/`);
    });
  },
  async check([a]) {
    if (isSol(a)) return COMMANDS.sol([a]);
    a = need(a);
    const [t, x, d, w, k] = await spin('reading the token, its contract, its launcher and its website', Promise.all([soft('token?a=' + a), soft('scan?a=' + a), soft('ledger?a=' + a), soft('site?a=' + a), soft('lookalikes?a=' + a)]));
    const tok = t.v, onCurve = tok?.launch?.ok && /pons/i.test(tok.launch.launchpad || '') && !tok.launch.graduated;
    const s = onCurve ? await spin('reading the curve', soft('sim?a=' + a)) : null;
    const parts = { tok, scan: x.v, led: d.v, sim: s?.v, site: w.v, alike: k.v }, F = findings(parts), unread = [['token', t], ['contract', x], ['ledger', d], ['website', w], ...(s ? [['curve', s]] : [])].filter(([, r]) => r.why);
    out({ token: a, ...parts, findings: F, unread: unread.map(([k, r]) => ({ part: k, why: r.why })) }, () => {
      const name = tok?.symbol ? '$' + tok.symbol : short(a);
      head(name, (tok?.name ? tok.name + ' · ' : '') + a);
      const vd = tok?.verdict;
      if (vd) { const c = vd.verdict === 'CLEAN' ? green : vd.verdict === 'DANGER' ? red : yellow; line('verdict', `${c(bold(vd.verdict))} ${vd.score}/100 ${dim(ago(vd.at))}${vd.priceAtVerdict && vd.after1h ? dim(' · an hour later ') + pc(vd.after1h / vd.priceAtVerdict - 1) : ''}`); }
      else if (tok) line('verdict', dim('none filed yet: run the checks on the site'));
      const l = tok?.launch;
      if (l?.ok && l.launchpad) line('launch', `${l.launchpad}${l.graduated ? green(' · bonded') : ''}${tok.serverCheck?.holders ? dim(' · ') + n0(tok.serverCheck.holders) + ' holders' : ''}${l.liquidity ? dim(' · liquidity ') + usd(l.liquidity) : ''}`);
      if (parts.sim) { const c = parts.sim; line('curve', `${bar(c.progress, 24)} ${bold(c.progress.toFixed(1) + '%')} ${dim(`${c.raised.toFixed(3)} of ${c.need} ETH`)}`); }
      if (x.v) line('contract', `${x.v.functions} functions · owner ${x.v.owner == null ? 'not read' : dead(x.v.owner) ? green('renounced') : yellow(short(x.v.owner))} · ${x.v.proxy ? red('proxy') : 'no proxy'} · source ${x.v.source?.verified ? green('verified') : 'not verified'}`);
      if (d.v) { const L = d.v.ledger || {}, got = (L.bought || 0) + (L.received || 0), sh = k => got ? pct((L[k] || 0) / got * 100, 0) : '—';
        line('launcher', `${short(d.v.dev)} · got ${n0(got)} · sold ${L.sold ? red(sh('sold')) : green('0')} · to wallets ${L.toWallets ? yellow(sh('toWallets')) : '0'} · burned ${sh('burned')} · holds ${n0(d.v.holdsNow)}`); }
      const ws = w.v?.website; if (ws) line('website', `${ws.domain}${ws.ageDays != null ? dim(` · domain ${ws.ageDays} day${ws.ageDays === 1 ? '' : 's'} old`) : ''}${ws.urlscan ? (ws.urlscan.malicious ? red(' · urlscan: malicious') : dim(' · urlscan: clean')) : ''}`); else if (w.v) line('website', dim('none found'));
      const d24 = k.v?.after24h; if (d24?.n) line('lookalikes', `${d24.n} like it a day later: median ${pc(d24.median, 0)} · ${d24.fell50} lost half · ${d24.rose} rose`);
      console.log(); box('What the chain shows', F.length ? F.map(f => `${dot[f.lvl]} ${f.text}`) : [dim('nothing read to report')]);
      for (const [k, r] of unread) console.log('  ' + yellow('○ ') + dim(`${k} not read: ${r.why}`));
      foot('Findings read from public chain data, not a verdict on anyone and not advice. A part not read is said as not read.', `${BASE}/ticket/?a=${a}`);
      console.log(dim('  share it: ') + cyan(`${BASE}/card/${a}`) + dim('  (shows as a card on X and Telegram)') + '\n');
      if (onCurve) console.log(dim('  next: ') + `shuntdesk sim ${short(a)} 0.05` + dim('  ·  ') + `shuntdesk watch ${short(a)}` + (d.v?.dev ? dim('  ·  ') + `shuntdesk dev ${short(d.v.dev)}` : '') + '\n');
    });
  },
  async scan([a]) {
    a = need(a); const v = await get('scan?a=' + a, 'reading the contract');
    out(v, v => {
      head('Contract X-ray', v.token);
      line('functions', `${v.functions} ${dim(`(${v.named} named${v.unknown ? `, ${v.unknown} unknown` : ''})`)}`);
      line('owner', v.owner == null ? 'not read' : dead(v.owner) ? green('renounced') + dim(' ' + short(v.owner)) : yellow(v.owner));
      line('proxy', v.proxy ? red('yes, the code can be swapped') + dim(' ' + short(v.proxy.impl || v.proxy)) : 'no');
      line('roles', v.roles ? yellow('answers to an admin role') : 'none found');
      line('source', v.source?.verified ? green('verified') + dim(' on ' + v.source.by) : 'not verified' + (v.source?.by ? dim(' on ' + v.source.by) : ''));
      const P = (v.powers || []).filter(p => p.level === 'high' || p.level === 'medium');
      console.log(); box('Powers in the code', P.length ? P.map(p => `${p.level === 'high' ? red('▲ high  ') : yellow('△ medium')} ${p.what} ${dim(p.fn)}`) : [green('● no function that mints, pauses, blocks wallets or changes the tax')]);
      foot('Read from the contract code. A power that is there can be used while someone holds control; renounced control cannot use it. Not advice.', `${BASE}/scan/?a=${v.token}`);
    });
  },
  async token([a]) {
    if (isSol(a)) return COMMANDS.sol([a]);
    a = need(a); const v = await get('token?a=' + a, 'reading the token');
    out(v, v => {
      head(v.symbol ? '$' + v.symbol : short(v.token), (v.name || '') + ' · ' + v.token);
      const vd = v.verdict;
      if (vd) { const c = vd.verdict === 'CLEAN' ? green : vd.verdict === 'DANGER' ? red : yellow; line('verdict', `${c(bold(vd.verdict))} ${vd.score}/100 ${dim(ago(vd.at))}`);
        if (vd.priceAtVerdict && vd.after1h) line('an hour later', pc(vd.after1h / vd.priceAtVerdict - 1)); if (vd.priceAtVerdict && vd.after24h) line('a day later', pc(vd.after24h / vd.priceAtVerdict - 1)); }
      else line('verdict', dim('no verdict filed yet'));
      const s = v.serverCheck; if (s) { line('red flags', s.redFlags?.length ? red(s.redFlags.join(', ')) : green('none found') + dim(' (' + s.source + ')')); line('holders', n0(s.holders)); }
      const l = v.launch; if (l?.ok && l.launchpad) {
        line('launchpad', l.launchpad + (l.graduated ? green(' · bonded') : ''));
        if (!l.graduated && l.progress != null) line('curve', `${bar(l.progress, 24)} ${l.progress.toFixed(1)}%`);
        const hold = (n, p, warn) => `${n ?? '—'} ${dim('holding')} ${p > warn ? yellow(pct(p)) : pct(p)}`;
        line('snipers', hold(l.snipers, l.sniperPct, 5)); line('bundles', hold(l.bundlers, l.bundlerPct, 5)); line('insiders', hold(l.insiders, l.insiderPct, 5)); line('dev holds', l.devPct > 10 ? yellow(pct(l.devPct)) : pct(l.devPct));
        if (l.liquidity != null) line('liquidity', usd(l.liquidity));
      }
      foot('A verdict is a rule-based reading of public data, and it can be wrong. Not advice.', `${BASE}/ticket/?a=${v.token}`);
    });
  },
  async sim([a, e]) {
    a = need(a); const sol = isSol(a), U = sol ? 'SOL' : 'ETH', E = e === undefined ? (sol ? 0.5 : 0.05) : Number(e); if (!(E > 0 && E < 1000)) die(`the size is an amount of ${U}, more than 0`);
    const c = await get('sim?a=' + a, 'reading the curve'), r = simulate(c, E), be = breakEven(c, E), eth = v => v == null ? '—' : v.toFixed(v < 0.01 ? 5 : 4) + ' ' + U;
    const after = (sol ? [0.5, 1, 2.5, 5, 10, 20] : [0.05, 0.1, 0.25, 0.5, 1, 2]).map(X => ({ others: X, ...simulate(c, E, X) }));
    out({ curve: c, size: E, result: r, breakEvenInflow: be, after }, () => {
      head('Curve Simulator', `${short(c.token)} · ${E} ${U} in${sol ? ' · Pump.fun' : ''}`);
      line('curve now', `${bar(c.progress, 24)} ${c.progress.toFixed(1)}% ${dim(`${c.raised.toFixed(3)} of ${c.need} ${U} · fee ${(c.fee * 100).toFixed(1)}% each way`)}`);
      line('after your buy', `${bar(r.after, 24, cyan)} ${r.after.toFixed(1)}%` + (r.bonds ? green(sol ? ' · graduates the curve' : ' · reaches the bond mark') : ''));
      line('you get', `${bold(n0(r.tok))} tokens ${dim(`at $${(r.avg * c.ethUsd).toPrecision(3)} average, ${usd(E * c.ethUsd)} in`)}`);
      line('price moves', pc(r.impact) + dim(' from your buy alone'));
      line('sold straight back', `${eth(r.back)} ${(r.back < E ? red : green)(pc(r.back / E - 1))}`);
      line('break even when', be == null ? yellow(sol ? 'the curve graduates first' : 'the curve bonds first') : `${bold(eth(be))} ${dim('comes in after you')}`);
      console.log('\n  ' + dim(pad('others put in', 16) + pad('curve then', 30) + 'you get back'));
      for (const q of after) console.log('  ' + pad(`${q.others} ${U}`, 16) + pad(`${bar(q.afterX, 16, dim)} ${q.afterX.toFixed(1)}%`, 30) + `${eth(q.back)} ${(q.back < E ? red : green)(pc(q.back / E - 1))}`);
      foot('Worked on the curve\'s own reserves, read from its contract now: constant product, the fee off the ETH in and out, never more out than the curve has raised. Not modeled: others selling, the order of trades in a block, gas, a buy that crosses the bond mark. Not advice.', `${BASE}/sim/?a=${c.token}&e=${E}`);
    });
  },
  async watch([a, s]) {
    a = need(a); const every = Math.max(30, Number(s) || 60); let first = null, last = null, n = 0;
    if (JSON_OUT) die('watch draws a live screen; use sim --json for one read');
    const draw = (c, err) => {
      if (TTY) process.stdout.write('\x1b[H\x1b[2J');
      const price = c ? c.quoteEth / c.tokens * c.ethUsd : null, hrs = first ? (Date.now() - first.t) / 3600000 : 0, d = c && first ? c.raised - first.raised : 0, pace = hrs > 0.01 ? d / hrs : null;
      if (!TTY) { if (c) console.log(`${new Date().toISOString().slice(11, 19)}  ${c.progress.toFixed(2)}%  ${c.raised.toFixed(4)} ETH  $${price.toPrecision(3)}${err ? '  (' + err + ')' : ''}`); return; }
      banner(); head('Watching the curve', `${a} · every ${every}s · ctrl+c to stop`); console.log();
      if (!c) { console.log('  ' + yellow(err || 'waiting for the first read')); return; }
      console.log('  ' + bar(c.progress, 50) + ' ' + bold(c.progress.toFixed(2) + '%'));
      console.log('  ' + dim(`${c.raised.toFixed(4)} of ${c.need} ETH raised · ${(c.need - c.realEth).toFixed(4)} ETH to bond`) + '\n');
      line('price', `$${price.toPrecision(4)}` + (first ? ' ' + (price >= first.price ? green : red)(pc(price / first.price - 1, 2)) + dim(' since you started') : ''));
      line('since you started', first ? (d >= 0 ? green : red)((d >= 0 ? '+' : '') + d.toFixed(4) + ' ETH') + dim(` net into the curve over ${Math.round(hrs * 60)} min`) : '—');
      line('pace', pace == null ? dim('needs a few reads') : `${pace >= 0 ? '+' : ''}${pace.toFixed(4)} ETH an hour` + (pace > 0 ? dim(` · at this pace it bonds in ${((c.need - c.realEth) / pace).toFixed(1)} h`) : ''));
      line('last move', last == null ? '—' : last > 0 ? green(`buy pressure +${last.toFixed(4)} ETH`) : last < 0 ? red(`sell pressure ${last.toFixed(4)} ETH`) : dim('quiet'));
      line('reads', `${n}` + (err ? yellow('  last read failed: ' + err) : ''));
      console.log('\n  ' + cyan(`${BASE}/sim/?a=${a}`));
    };
    let prev = null; process.on('SIGINT', () => { if (TTY) process.stdout.write('\n'); process.exit(0); });
    for (;;) {
      let c = null, err = null; try { c = await fetchV1('sim?a=' + a); n++; } catch (e) { err = e.message; if (/not a pons|no curve|graduat|bad address/i.test(err) && !prev) die(err); }
      if (c) { if (!first) first = { t: Date.now(), raised: c.raised, price: c.quoteEth / c.tokens * c.ethUsd }; last = prev ? c.raised - prev.raised : null; prev = c; }
      draw(c || prev, err);
      if (c && c.progress >= 100) { console.log('\n  ' + green(bold('It reached the bond mark.')) + '\n'); return; }
      await new Promise(r => setTimeout(r, every * 1000));
    }
  },
  async ledger([a]) {
    a = need(a); const v = await get('ledger?a=' + a, 'reading every transfer of the launcher');
    out(v, v => {
      head('Dev Ledger', v.token);
      line('launcher', (v.dev || 'not found') + (v.devFound ? dim(' · from the ' + v.devFound) : ''));
      const L = v.ledger || {}, got = (L.bought || 0) + (L.received || 0);
      line('got', bold(n0(got)) + dim(` · bought ${n0(L.bought)}, received ${n0(L.received)}`)); console.log();
      const row = (k, label, c) => { const p = got ? (L[k] || 0) / got * 100 : 0; console.log('  ' + dim(pad(label, 20)) + bar(p, 28, c) + ' ' + pad(n0(L[k] || 0), 9) + dim(pct(p))); };
      row('sold', 'sold', red); row('toWallets', 'to other wallets', yellow); row('toContracts', 'to contracts', cyan); row('burned', 'burned', green);
      console.log(); line('holds now', n0(v.holdsNow));
      if (v.burns?.count) line('burns', `${v.burns.count} burns, ${n0(v.burns.total)} in all${v.burns.byDev === v.burns.count ? dim(' · every one by the launcher') : dim(` · ${v.burns.byDev} by the launcher`)}`);
      if (v.sideBuys?.length) { console.log('  ' + yellow(`○ the deployer paid for buys that landed in ${v.sideBuys.length} other wallet${v.sideBuys.length > 1 ? 's' : ''}:`)); for (const x of v.sideBuys.slice(0, 5)) console.log('    ' + pad(x.wallet, 46) + n0(x.amount)); }
      if (v.partial) console.log('  ' + yellow('○ part of the history could not be read: the totals may be low'));
      foot(v.note || 'Read from the chain index. Not advice.', `${BASE}/ticket/?a=${v.token}`);
    });
  },
  async dev([w]) {
    w = need(w, 'launcher wallet'); const v = await get('devscore?a=' + w, 'reading every launch by this wallet');
    if (v.chain === 'solana') return out(v, v => {
      head('Dev Score', v.wallet + dim(' · Solana'));
      line('score', v.score == null ? dim('no launch over an hour old yet') : `${bar(v.score, 24, v.score >= 80 ? green : v.score >= 50 ? yellow : red)} ${bold(v.score + '/100')} ${dim('share of launches still alive after an hour')}`);
      line('launched', `${v.launched} ${dim(`· the newest ${v.read} read`)}`); line('graduated', String(v.bonded)); line('dead', (v.dead ? red : green)(String(v.dead)) + dim(` of ${v.judged} over an hour old`));
      if (v.launches?.length) { console.log(); for (const l of v.launches.slice(0, 12)) console.log('  ' + pad(bold((l.symbol || '?').slice(0, 12)), 14) + pad(dim(short(l.token)), 14) + pad(dim(ago(l.launched)), 10) + pad(usd(l.marketCap), 10) + (l.bonded ? green('graduated') : l.dead ? red('dead') : dim(l.progress != null ? Math.round(l.progress) + '% to graduation' : 'live'))); }
      foot(v.note, `${BASE}/dev/?w=${v.wallet}`);
    });
    out(v, v => {
      head('Dev Score', v.wallet);
      line('score', v.score == null ? dim('no launch it held tokens of') : `${bar(v.score, 24, v.score >= 80 ? green : v.score >= 50 ? yellow : red)} ${bold(v.score + '/100')} ${dim('share of its launches it did not dump')}`);
      line('launched', `${v.launched} on Pons ${dim(`· ${v.read} read in full`)}`); line('bonded', String(v.bonded));
      line('dumped', (v.dumped ? red : green)(String(v.dumped)) + dim(` · ${v.dumpedFirstHour} in the first hour`)); line('burned most', String(v.burnedMost));
      if (v.partial) console.log('  ' + yellow(`○ ${v.unread} launch${v.unread === 1 ? '' : 'es'} could not be read: the record is partial`));
      if (v.launches?.length) { console.log(); for (const l of v.launches.slice(0, 12)) console.log('  ' + pad(bold(l.symbol || '?'), 14) + pad(dim(short(l.token)), 14) + (l.unread ? yellow('not read') : `${l.bonded ? green('bonded  ') : dim('on curve')}  ${l.dumped ? red('dumped') : ''}${l.burnedMost ? green(' burned most') : ''}`)); }
      foot(v.note, `${BASE}/dev/?w=${v.wallet}`); console.log(dim('  share it: ') + cyan(`${BASE}/card/dev/${v.wallet}`) + '\n');
    });
  },
  async twins([a]) {
    a = need(a); const v = await get('twins?a=' + a, 'comparing the code with the radar\'s log');
    out(v, v => {
      head('Twin Finder', v.token);
      if (v.pons) { console.log('\n' + wrap(v.note).replace(/^/gm, '  ')); console.log('\n  ' + dim('try: ') + 'shuntdesk ledger ' + short(v.token) + dim(' to find the launcher, then ') + 'shuntdesk dev <wallet>\n'); return; }
      line('functions', String(v.functions)); line('twins', `${bold(v.twins)} ${dim('with exactly the same code')}`);
      line('lost half', v.judged ? `${bar(v.lostHalf / v.judged * 100, 24, red)} ${v.lostHalf} of ${v.judged} with a result` : '—');
      line('log compared', `${v.marked}${v.logged ? ' of ' + v.logged : ''} tokens`);
      if (v.rows.length) { console.log(); for (const r of v.rows.slice(0, 12)) console.log('  ' + pad(bold(r.symbol || '?'), 14) + pad(dim(short(r.token)), 14) + pad(dim(ago(r.read)), 10) + (r.worst == null ? dim('no result yet') : (r.worst <= -0.5 ? red : String)(pc(r.worst, 0)))); }
      foot(v.note, `${BASE}/twins/?a=${v.token}`);
    });
  },
  async shared([a, b]) {
    a = need(a); b = need(b); if (a === b) die('pass two different tokens'); const v = await get(`shared?a=${a}&b=${b}`, 'reading both holder lists');
    out(v, v => {
      head('Shared Bags', `${short(v.a)} and ${short(v.b)}`);
      line('wallets in both', bold(v.shared) + dim(` · of ${v.readA} and ${v.readB} holders read`));
      line('together they hold', `${pct(v.heldA, 2)} of the first · ${pct(v.heldB, 2)} of the second`);
      if (v.wallets.length) { console.log(); for (const w of v.wallets.slice(0, 15)) console.log('  ' + pad(w.wallet, 44) + pad(pct(w.shareA, 2), 10) + pct(w.shareB, 2)); }
      if (v.unread) console.log('  ' + yellow(`○ ${v.unread} shared address${v.unread === 1 ? '' : 'es'} could not be checked for code and are left out`));
      foot(v.note, `${BASE}/shared/?a=${v.a}&b=${v.b}`);
    });
  },
  async wallet([w]) {
    w = need(w, 'wallet'); const v = await get('wallet?a=' + w, 'reading the wallet');
    out(v, v => {
      head('Wallet X-ray', v.wallet + (v.chain === 'solana' ? dim(' · Solana') : ''));
      const T = v.tokens || []; if (v.sol) line('SOL', `${v.sol.amount.toFixed(4)}${v.sol.usd != null ? dim(' · ' + usd(v.sol.usd)) : ''}`); line('tokens', String(T.length)); console.log();
      for (const t of T.slice(0, 25)) {
        const amt = Number(BigInt(t.balance || '0') / 10n ** BigInt(Math.max(0, (t.decimals ?? 18) - 4))) / 1e4, vd = t.verdict;
        const tags = [t.impostor ? red(v.chain === 'solana' ? `copy of ${t.impostor}, not the real one` : `copy: the real ${t.symbol || 'token'} is ${short(t.impostor)}`) : '', vd ? (vd.verdict === 'CLEAN' ? green : vd.verdict === 'DANGER' ? red : yellow)(vd.verdict) : '', t.curve?.progress != null ? dim(`curve ${pct(t.curve.progress)}`) : '', t.powers?.length ? yellow(t.powers.length + ' powers') : ''].filter(Boolean).join(dim(' · '));
        console.log('  ' + pad(bold((t.symbol || '?').slice(0, 12)), 14) + pad(n0(amt), 12) + pad(dim(short(t.token)), 14) + tags);
      }
      if (T.length > 25) console.log('  ' + dim(`and ${T.length - 25} more`));
      foot((v.note || '') + ' What each would fetch if sold now is worked on the site.', `${BASE}/wallet/?w=${v.wallet}`); if (v.chain !== 'solana') console.log(dim('  share it: ') + cyan(`${BASE}/card/wallet/${v.wallet}`) + '\n');
    });
  },
  async bonds([k]) {
    const v = await get('bonds', 'reading every open Pons curve'), N = Math.min(40, Number(k) || 12);
    out(v, v => {
      const day = v.days?.[v.days.length - 1];
      head('Bond Watch', `${v.onCurve ?? v.rows.length} on the curve${day ? ` · today ${day.l} launched, ${day.g} bonded` : ''}`); console.log();
      for (const r of v.rows.slice(0, N)) console.log('  ' + pad(bold((r.symbol || '?').slice(0, 11)), 13) + bar(r.progress, 26, r.progress >= 80 ? green : r.progress >= 50 ? yellow : dim) + ' ' + pad(bold(pct(r.progress)), 7) + pad(dim(`${r.raised.toFixed(2)}/${r.need}`), 11) + (r.perHour > 0 ? green(`+${r.perHour.toFixed(2)}/h`) + (r.etaHours != null ? dim(` ~${r.etaHours.toFixed(1)}h`) : '') : dim('quiet')) + '  ' + dim(short(r.token)));
      if (v.bonded?.length) { console.log('\n  ' + dim('bonded lately: ') + v.bonded.slice(0, 3).map(b => `${b.symbol} ${dim(toBond(b.hoursToBond))}`).join(dim(' · '))); }
      foot('Progress read from each curve contract. Pace is the last hour. Not advice.', `${BASE}/bonds/`);
    });
  },
  async radar([k]) {
    const v = await get('radar', 'reading the radar'), N = Math.min(40, Number(k) || 12);
    out(v, v => {
      head('Radar', `${n0(v.logged)} new tokens logged · ${n0(v.flagged)} with a flag`);
      const R = v.record; if (R) line('the record', `flagged: ${R.flagged.fellHalf1h} of ${R.flagged.n} fell half in an hour · clean reads: ${R.clean.fellHalf1h} of ${R.clean.n}`);
      console.log();
      for (const r of v.rows.slice(0, N)) console.log('  ' + pad(bold((r.symbol || '?').slice(0, 11)), 13) + pad(dim(ago(r.read)), 9) + pad(n0(r.holders) + dim(' holders'), 16) + pad(r.launchpad ? dim(r.launchpad) : dim('—'), 7) + (r.flags.length ? red('● ') + r.flags.slice(0, 2).join(dim(' · ')) : green('● ') + dim('no flag found')) + '  ' + dim(short(r.token)));
      foot('New tokens with 25 or more holders, read 30 to 90 minutes after launch. A flag is a finding, not a verdict. Not advice.', `${BASE}/radar/`);
    });
  },
  async site([a]) {
    a = need(a); const v = await get('site?a=' + a, 'checking the website and links');
    out(v, v => {
      head('Site Check', v.token);
      const ws = v.website;
      if (ws) { line('website', ws.url); if (ws.registered) line('domain', `registered ${ws.registered.slice(0, 10)}${ws.ageDays != null ? dim(` · ${ws.ageDays} days ago`) : ''}`);
        if (ws.urlscan) line('urlscan.io', ws.urlscan.status !== 'done' ? dim('still scanning') : ws.urlscan.malicious ? red('malicious') : green('not malicious') + dim(` · score ${ws.urlscan.score}`)); }
      else line('website', dim('none found in the contract or the token\'s links'));
      for (const l of (v.links || []).slice(0, 8)) line(l.kind, l.url + dim(' · from the ' + l.from));
      console.log(); box('What the check found', (v.flags || []).length ? v.flags.map(f => `${f.level === 'high' ? red('●') : f.level === 'medium' ? yellow('●') : green('●')} ${f.text}`) : [green('● no flag found')]);
      if (v.pending) console.log('  ' + yellow('○ part of the check is still running: run it again in a minute'));
      foot('Google Safe Browsing, RDAP for the domain\'s age, urlscan.io for what the page loads. Not advice.', `${BASE}/ticket/?a=${v.token}`);
    });
  },
  async alike([a]) {
    a = need(a); const v = await get('lookalikes?a=' + a, 'finding the tokens it looked like');
    out(v, v => {
      head('Lookalikes', `${v.symbol ? '$' + v.symbol + ' · ' : ''}${v.token}`);
      const L = v.looks || {}; line('as it stood', `${n0(L.holders)} holders · top ten ${pct(L.top10Pct)} · liquidity ${usd(L.liquidity)} · bundles ${pct(L.bundlerPct)} · dev ${pct(L.devPct)}`);
      const row = (k, s) => s?.n ? line(k, `${bar(s.fell50 / s.n * 100, 20, red)} ${s.fell50} of ${s.n} lost half · median ${(s.median >= 0 ? green : red)(pc(s.median, 0))} · ${s.rose} rose`) : line(k, dim('not enough with a result yet'));
      row('an hour later', v.after1h); row('a day later', v.after24h);
      if (v.closest?.length) { console.log(); console.log('  ' + dim(pad('closest', 14) + pad('holders', 10) + pad('top ten', 10) + pad('1h', 9) + 'a day')); for (const c of v.closest.slice(0, 8)) console.log('  ' + pad(bold((c.symbol || '?').slice(0, 12)), 14) + pad(n0(c.holders), 10) + pad(pct(c.top10Pct), 10) + pad(c.move1h == null ? dim('—') : (c.move1h < 0 ? red : green)(pc(c.move1h, 0)), 9) + (c.move24h == null ? dim('—') : (c.move24h < 0 ? red : green)(pc(c.move24h, 0)))); }
      foot(v.note, `${BASE}/ticket/?a=${v.token}`);
    });
  },
  async calls([k]) {
    const v = await get('verdicts', 'reading the latest calls'), N = Math.min(50, Number(k) || 15);
    out(v, v => {
      const R = v.record || {};
      head('Calls', 'the latest verdicts Shuntdesk filed, and how they held');
      for (const [name, c] of [['CLEAN', green], ['DANGER', red]]) { const r = R[name]; if (r) line(name.toLowerCase() + ' calls', r.n ? `${bar(r.right / r.n * 100, 20, c)} ${r.right} of ${r.n} priced ${name === 'CLEAN' ? 'higher' : 'lower'} an hour later` : dim('none with a result yet')); }
      console.log();
      for (const x of (v.verdicts || []).slice(0, N)) { const c = x.verdict === 'CLEAN' ? green : x.verdict === 'DANGER' ? red : yellow, m = x.priceAtVerdict && x.after1h ? x.after1h / x.priceAtVerdict - 1 : null;
        console.log('  ' + pad(bold((x.symbol || '?').slice(0, 12)), 14) + pad(c(x.verdict), 8) + pad(dim(x.score + '/100'), 9) + pad(dim(ago(x.at)), 10) + (m == null ? dim('no price an hour later yet') : (m < 0 ? red : green)(pc(m) + ' an hour later')) + '  ' + dim(short(x.token))); }
      foot('Every call is filed with its price, and checked an hour and a day later. The record counts the misses too. Not advice.', `${BASE}/report/`);
    });
  },
  async caught([k]) {
    const v = await get('caught', 'reading the radar\'s record'), N = Math.min(30, Number(k) || 8);
    out(v, v => {
      head('Caught', 'what the radar flagged, and what it missed');
      line('scanned', `${n0(v.scanned)} new tokens · ${n0(v.judged)} with a result`);
      line('caught', `${green(bold(v.caught))} flagged when scanned, then lost half`); line('missed', `${red(bold(v.missed))} with no flag that lost half anyway`);
      line('this week', `${v.week?.flagged} flagged · ${v.week?.caught} caught · ${v.week?.missed} missed`);
      const rows = (title, R, c) => { if (!R?.length) return; console.log('\n  ' + dim(title)); for (const r of R.slice(0, N)) console.log('  ' + pad(bold((r.symbol || '?').slice(0, 12)), 14) + pad(red(pc(r.worst, 0)), 7) + pad(dim(ago(r.read)), 10) + (r.flags.length ? c(r.flags[0]) : dim('no flag'))); };
      rows('caught:', v.caughtRows, yellow); rows('missed:', v.missedRows, dim);
      foot(v.note, `${BASE}/caught/`);
    });
  },
  async desk() {
    const v = await get('desk', 'reading the crew desk');
    out(v, v => {
      head('Crew desk', 'a public paper desk that bets on Shuntdesk verdicts · all money is simulated');
      const ch = v.equity / v.start - 1; line('equity', `${bold(usd(v.equity))} ${(ch >= 0 ? green : red)(pc(ch))} ${dim(`from ${usd(v.start)} · cash ${usd(v.cash)}`)}`);
      if (v.open?.length) { console.log('\n  ' + dim('open')); for (const o of v.open) console.log('  ' + pad(bold((o.symbol || '?').slice(0, 12)), 14) + pad(o.side + (o.leverage > 1 ? ' ' + o.leverage + 'x' : ''), 9) + pad(pc(o.mark / o.entry - 1), 9) + (o.net >= 0 ? green : red)(usd(o.net))); }
      if (v.closed?.length) { console.log('\n  ' + dim('closed')); for (const c of v.closed.slice(0, 8)) console.log('  ' + pad(bold((c.symbol || '?').slice(0, 12)), 14) + pad(c.side, 9) + pad((c.pnl >= 0 ? green : red)(usd(c.pnl)), 12) + dim(c.why || '')); }
      foot('Paper money only. Every trade follows a verdict and gets a post-mortem.', `${BASE}/desk/`);
    });
  },
  async stocks() {
    const v = await get('stocks', 'reading the stocks behind the stock tokens');
    out(v, v => {
      head('Stocks', 'the stocks behind Robinhood Chain\'s stock tokens · ' + v.source); console.log();
      for (const [sym, r] of Object.entries(v.rows || {})) { const m = r.close ? r.last / r.close - 1 : null; console.log('  ' + pad(bold(sym), 8) + pad('$' + Number(r.last).toFixed(2), 12) + pad(m == null ? '' : (m >= 0 ? green : red)(pc(m, 2)), 10) + dim(r.session)); }
      foot('Compare a stock token\'s price with these before you trade it.', `${BASE}/stocks/`);
    });
  },
  async proof() {
    const v = await getApi('proof', 'reading $SHUNT from the chain');
    out(v, v => {
      head('$SHUNT proof', v.token);
      const c = v.contract; if (c) line('contract', `${c.functions} functions · ${c.powers?.length ? red(c.powers.length + ' powers') : green('no power to mint, pause, block or tax')} · ${c.proxy ? red('proxy') : 'no proxy'}`);
      const k = v.curve; if (k) line('curve', `${bar(k.progress, 24)} ${k.progress.toFixed(1)}% ${dim(`${k.raised.toFixed(3)} of ${k.need} ETH · ${k.holders} holders`)}`);
      const L = v.ledger?.ledger; if (L) line('dev wallet', `bought ${n0(L.bought)} · sold ${L.sold ? red(n0(L.sold)) : green('0')} · burned ${green(n0(L.burned))} · to the pool ${n0(L.toContracts)}`); else line('dev wallet', dim('not read right now: shuntdesk ledger ' + short(v.token)));
      for (const p of v.pools || []) line('liquidity', `${p.dex} ${p.pair} · ${p.fee} · ${p.range} · ${p.eth} ETH + ${n0(p.shunt)} SHUNT`);
      const r = v.record; if (r) line('the record', `${r.calls} calls filed · clean calls priced higher a day later: ${r.clean.right} of ${r.clean.n}`);
      for (const [k2, u] of Object.entries(v.links || {})) line(k2, cyan(u));
      foot('Everything here is read from the chain or published openly. Check it yourself.', `${BASE}/proof/`);
    });
  },
  async week() {
    const v = await get('weekly', 'reading the week');
    out(v, v => {
      head('The week on Robinhood Chain', 'from Shuntdesk\'s own record');
      if (v.pons) line('pons', `${n0(v.pons.launched)} launched · ${n0(v.pons.bonded)} bonded ${dim(`(${pct(v.pons.rate * 100, 2)})`)}`);
      if (v.radar) line('radar', `${v.radar.flagged} flagged · ${green(v.radar.caught)} caught · ${red(v.radar.missed)} missed`);
      if (v.lab) line('best rule', `${v.lab.rule}: ${pct(v.lab.rate * 100, 0)} lost half, against ${pct(v.lab.others * 100, 0)} of the rest ${dim(`(${v.lab.lift.toFixed(1)}x)`)}`);
      if (v.shunt) line('$SHUNT', `${n0(v.shunt.burnedWeek)} burned this week in ${v.shunt.burnsWeek} burns · ${n0(v.shunt.burnedAll)} in all · dev sold ${v.shunt.sold}`);
      foot('', `${BASE}/weekly/`);
    });
  },
  async rugrun() {
    if (JSON_OUT || !process.stdin.isTTY) die('Rug Run is played at a terminal: run shuntdesk rugrun');
    if (INTERACTIVE) die('quit the prompt and run shuntdesk rugrun on its own');
    const run = await getApi('rugrun', 'picking ten real new tokens');
    head('Rug Run', 'ten real new tokens as the radar read them, names hidden'); console.log('\n' + dim(wrap(run.note).replace(/^/gm, '  ')) + '\n');
    const rl = createInterface({ input: process.stdin }), lines = rl[Symbol.asyncIterator](), calls = [];
    const ask = async q => { process.stdout.write(q); const n = await lines.next(); if (n.done) { rl.close(); die('stopped before the run was finished'); } if (!TTY || !process.stdin.isTTY) console.log(n.value); return n.value.trim(); };
    for (const t of run.tokens) {
      console.log('  ' + inv(bold(` #${t.n} `)) + '  ' + [t.liquidity > 0 ? `pool ${usd(t.liquidity)}` : dim('pool not read'), `${n0(t.holders)} holders`, `top ten ${pct(t.top10)}`, `dev ${pct(t.dev)}`, `snipers ${pct(t.snipers)}`, `bundles ${pct(t.bundles)}`, t.age != null ? `${t.age} min old` : '', t.launchpad || dim('launchpad not named')].filter(Boolean).join(dim(' · ')));
      console.log('       ' + (t.flags.length ? t.flags.map(f => red('● ' + f)).join('  ') : green('● no flag found')));
      let a = ''; while (!/^[rd]/i.test(a)) a = await ask('       ' + cyan('rug or ride? ') + dim('[r/d] '));
      calls.push(/^r/i.test(a)); console.log();
    }
    let h = (flagVal('handle') || process.env.SHUNTDESK_HANDLE || '').toLowerCase();
    while (!/^[a-z0-9_]{2,16}$/.test(h)) h = (await ask('  ' + cyan('your handle for the board ') + dim('(2 to 16 letters, digits or _) '))).toLowerCase();
    rl.close();
    const r = await getApi('rugrun', 'asking the record', { id: run.id, handle: h, calls });
    console.log(); head(`${r.right} of ${r.of} right`, r.right >= 8 ? 'you read launches well' : r.right >= 5 ? 'not bad' : 'the chain won this one'); console.log();
    r.results.forEach((x, i) => console.log('  ' + pad(`#${i + 1}`, 5) + pad(bold(x.symbol || '?'), 14) + pad(x.move24h == null ? dim('no result') : x.rug ? red(`RUG ${pc(x.move24h, 0)}`) : green(`RIDE ${pc(x.move24h, 0)}`), 14) + dim('you said ') + (calls[i] ? 'rug ' : 'ride') + '  ' + (x.move24h == null ? '' : calls[i] === x.rug ? green('✔') : red('✖'))));
    if (r.board?.length) { console.log('\n  ' + dim('this week\'s board')); r.board.slice(0, 10).forEach((b, i) => console.log('  ' + pad(`${i + 1}.`, 4) + pad(bold(b.handle) + (b.holder ? green(' holder') : ''), 24) + `${b.best} of 10`)); }
    foot('', `${BASE}/rug-run/`);
  },
  async exit([a, e]) {
    a = need(a); const sol = isSol(a);
    let tok, l, supply;
    if (sol) { const r = await get('sol?a=' + a, 'reading the token'); if (r.verdict === 'NO POOL') die('no pool found for this token');
      tok = { symbol: r.sym }; l = { ok: true, launchpad: r.launch?.pad === 'pumpfun' ? 'Pump.fun' : r.launch?.pad || null, graduated: r.launch?.pad !== 'pumpfun' || !!r.launch?.graduated, devPct: r.devShare, sniperPct: r.launch?.sn, bundlerPct: r.launch?.bu, insiderPct: r.launch?.ins, price: r.price, liquidity: r.liq };
      supply = r.fdv && r.price ? r.fdv / r.price : 1e9; }
    else { tok = await get('token?a=' + a, 'reading the token'); l = tok.launch;
      if (!l?.ok) die('no launch facts for this token: try it on the site');
      supply = await spin('reading the supply', supplyOf(a)).catch(() => null); if (!supply) die('the supply could not be read'); }
    const onCurve = sol ? !l.graduated : /pons/i.test(l.launchpad || '') && !l.graduated, CU = sol ? 'SOL' : 'ETH';
    const hold = await spin('reading the largest holders', soft('holders?a=' + a));
    const top = hold.v ? [['the largest wallet sells first', hold.v.top1], ['the three largest wallets sell first', hold.v.top3], ['the ten largest wallets sell first', hold.v.top10]] : [['if a wallet with 1% sells first', 1], ['if wallets with 5% sell first', 5]];
    const first = [['nobody sells before you', 0], ['the dev sells first', l.devPct], ['launch snipers and bundles sell first', (l.sniperPct || 0) + (l.bundlerPct || 0)], ['insiders sell first', l.insiderPct]].filter(([, s], i) => i === 0 || s >= 0.1).concat(top.filter(([, s]) => s >= 0.1));
    let rows, size, unit;
    if (onCurve) {
      const c = await get('sim?a=' + a, 'reading the curve'); size = e === undefined ? (sol ? 0.5 : 0.05) : Number(e); unit = CU; if (!(size > 0 && size < 1000)) die(`the size is an amount of ${CU}, more than 0`);
      rows = first.map(([label, share]) => ({ label, share, ...curveExit(c, size, share / 100 * supply) }));
    } else {
      if (!(l.price > 0 && l.liquidity > 0)) die('no price or liquidity read for its pool');
      size = e === undefined ? 100 : Number(e); unit = 'USD'; if (!(size > 0)) die('the size is an amount of dollars, more than 0');
      rows = first.map(([label, share]) => ({ label, share, ...poolExit({ price: l.price, liquidity: l.liquidity }, size, share / 100 * supply) }));
    }
    out({ token: a, onCurve, size, unit, rows, holders: hold.v || { ok: false, why: hold.why } }, () => {
      head('Exit Door', `${tok.symbol ? '$' + tok.symbol + ' · ' : ''}${size} ${unit} in · ${onCurve ? `on its ${sol ? 'Pump.fun' : 'Pons'} curve` : 'through its pool'}`); console.log();
      const fmt = v => unit === 'USD' ? usd(v) : v.toFixed(v < 0.01 ? 5 : 4) + ' ' + unit;
      if (hold.why) console.log('  ' + yellow('○ ') + dim(`the largest holders were not read (${hold.why}): the 1% and 5% rows are examples`) + '\n');
      for (const r of rows) { const k = r.back / size; console.log('  ' + pad(r.label, 40) + pad(r.share ? dim(pct(r.share) + ' of supply') : '', 18) + bar(Math.max(0, k * 100), 20, k >= 0.9 ? green : k >= 0.5 ? yellow : red) + ' ' + pad(bold(fmt(r.back)), 14) + (k - 1 < 0 ? red : green)(pc(k - 1, 0))); }
      foot(onCurve ? `Worked on the ${sol ? 'Pump.fun ' : ''}curve's own reserves, the fee off the ${CU} out, never more out than the curve holds.` + ' The dev, snipers and insiders as read 30 to 90 minutes after launch; the largest wallets read now from the chain index. Taxes are not read here.'
        : 'One constant-product pool holding its quoted liquidity, half each side, a 0.3% fee: an estimate of size, not a quote. A concentrated pool can be thinner away from the price. Taxes are not read here: the site reads them.', `${BASE}/exit/?a=${a}`);
    });
  },
  async bondgame() {
    const me = (flagVal('handle') || process.env.SHUNTDESK_HANDLE || '').toLowerCase(), vs = (flagVal('vs') || '').toLowerCase();
    const v = await getApi(`bondgame?me=${encodeURIComponent(me)}${vs ? '&vs=' + encodeURIComponent(vs) : ''}`, 'reading today\'s curves');
    const draw = v => {
      head('Will it bond?', `${v.day} · ${v.mine ? 'your calls are in' : v.open ? `calls close ${v.closes.slice(11, 16)} UTC · ${v.players} in` : `closed · the chain answers ${v.resolves.slice(11, 16)} UTC`}`); console.log();
      v.tokens.forEach((t, i) => { const p = t.progress ?? t.startProgress, m = v.mine?.[i]; console.log('  ' + pad(`${i + 1}.`, 4) + pad(bold(t.symbol), 12) + bar(p, 30, p >= 80 ? green : p >= 50 ? yellow : dim) + ' ' + pad(pct(p), 7) + dim(`from ${pct(t.startProgress)}`) + (m == null ? '' : '  ' + dim('you: ') + (m ? green('bonds') : red('no bond')))); });
      const y = v.yesterday; if (y) console.log('\n  ' + dim('yesterday: ') + y.tokens.map(t => `${t.symbol} ${t.bonded ? green('bonded') : red('did not')}`).join(dim(' · ')) + dim(` · ${y.players} played`) + (y.mine != null ? dim(' · you got ') + bold(y.mine) : ''));
      if (v.me) console.log('  ' + dim('you: ') + `streak ${bold(v.me.streak)} · ${v.me.perfect} perfect · ${v.me.week} points this week`);
      if (v.board?.length) { console.log('\n  ' + dim('the board, last seven days')); v.board.slice(0, 8).forEach((b, i) => console.log('  ' + pad(`${i + 1}.`, 4) + pad(bold(b.handle) + (b.holder ? green(' holder') : ''), 24) + `${b.pts} pts` + (b.streak >= 3 ? dim(` · ${b.streak} days running`) : ''))); }
      if (v.duel) console.log('\n  ' + dim('duel with ') + bold(v.duel.vs) + dim(': today they are ') + (v.duel.theirsToday ? (Array.isArray(v.duel.theirsToday) ? v.duel.theirsToday.map(x => x ? 'bonds' : 'no').join(' · ') : 'in, calls hidden until 12:00 UTC') : 'not in yet'));
    };
    if (JSON_OUT) return out(v, () => {});
    draw(v);
    if (v.open && !v.mine && v.tokens.length && process.stdin.isTTY && !INTERACTIVE) {
      console.log('\n  ' + dim('call each curve: b for bonds, n for no bond'));
      const rl = createInterface({ input: process.stdin }), lines = rl[Symbol.asyncIterator](), ask = async q => { process.stdout.write(q); const n = await lines.next(); if (n.done) { rl.close(); die('stopped before the calls were in'); } return n.value.trim(); };
      const picks = []; for (const t of v.tokens) { let x = ''; while (!/^[bn]/i.test(x)) x = await ask('  ' + cyan(`${t.symbol}: `) + dim('[b/n] ')); picks.push(/^b/i.test(x)); }
      let h = me; while (!/^[a-z0-9_]{2,16}$/.test(h)) h = (await ask('  ' + cyan('your handle ') + dim('(2 to 16 letters, digits or _) '))).toLowerCase();
      rl.close();
      const r = await getApi('bondgame', 'locking your calls', { handle: h, picks }); console.log('\n  ' + green('● locked in. the chain answers at midnight UTC.')); draw(r);
      console.log('\n  ' + dim('challenge a friend: ') + cyan(`${BASE}/bond-game/?vs=${h}`) + dim('  or  ') + `shuntdesk bondgame --vs=${h}`);
    } else if (v.open && !v.mine) console.log('\n  ' + dim('play it: ') + 'shuntdesk bondgame' + dim(' at a terminal, or ') + cyan(`${BASE}/bond-game/`));
    foot(v.note, '');
  },
  async replay([a]) {
    a = need(a); const v = await getApi('replay?a=' + a, 'replaying its chart');
    out(v, v => {
      head('Replay', `${v.symbol ? '$' + v.symbol + ' · ' : ''}${v.token}`);
      const bars = v.bars || []; if (!bars.length) { console.log('  ' + dim('no chart to replay yet')); return; }
      const W = Math.min(72, bars.length), step = bars.length / W, closes = Array.from({ length: W }, (_, i) => bars[Math.min(bars.length - 1, Math.floor(i * step + step - 1))][4]);
      const lg = closes.map(c => Math.log(Math.max(c, 1e-18))), lo = Math.min(...lg), hi = Math.max(...lg), H = 10, rowsOut = [];
      for (let r = H - 1; r >= 0; r--) rowsOut.push('  ' + lg.map((c, i) => { const y = hi > lo ? (c - lo) / (hi - lo) * (H - 1) : 0; const up = i === 0 || c >= lg[i - 1]; return Math.round(y) === r ? (up ? green('●') : red('●')) : Math.round(y) > r ? dim('│') : ' '; }).join(''));
      console.log('\n  ' + dim('price, log scale: high $' + Math.max(...closes).toPrecision(3) + ' · low $' + Math.min(...closes).toPrecision(3))); console.log(rowsOut.join('\n')); console.log('  ' + dim(`${new Date(bars[0][0]).toISOString().slice(5, 16).replace('T', ' ')}`.padEnd(W - 11) + new Date(bars[bars.length - 1][0]).toISOString().slice(5, 16).replace('T', ' ')));
      console.log();
      const t = x => new Date(x).toISOString().slice(5, 16).replace('T', ' ') + ' UTC';
      if (v.launch) line('launched', `${t(v.launch.t)} ${dim('by ' + short(v.launch.by))}`);
      if (v.peak) line('peak', `$${v.peak.price.toPrecision(3)} ${dim(t(v.peak.t))}`);
      if (v.drop) line('sharpest drop', `${red(pc(v.drop.d, 0))} ${dim(t(v.drop.t))}`);
      if (v.graduated) line('bonded', t(v.graduated.t || v.graduated));
      if (v.now) line('now', `$${v.now.price.toPrecision(3)} ${(v.now.fromPeak < 0 ? red : green)(pc(v.now.fromPeak, 0) + ' from the peak')}`);
      for (const x of (v.verdicts || []).slice(0, 3)) line('a verdict', `${x.verdict} ${x.score}/100 ${dim(t(x.at || x.t))}`);
      foot('Price bars from the chain\'s trades. What happened, not what will. Not advice.', `${BASE}/replay/?a=${v.token}`);
    });
  },
  async lab() {
    const v = await get('lab', 'reading the Verdict Lab');
    out(v, v => {
      head('Verdict Lab', `every rule against what happened · ${n0(v.scanned)} tokens read since ${v.since.slice(0, 10)}`);
      line('all tokens', `${pct(v.base.h24.rate * 100, 1)} lost half within a day ${dim(`(${v.base.h24.lostHalf} of ${v.base.h24.n})`)}`); console.log();
      const R = [...v.rules].filter(r => r.caughtThen.h24.n >= 5).sort((p, q) => (q.lift24h ?? -1) - (p.lift24h ?? -1) || q.caughtThen.h24.rate - p.caughtThen.h24.rate);
      console.log('  ' + dim(pad('rule', 50) + pad('caught', 9) + pad('lost half in a day', 28) + 'lift'));
      for (const r of R.slice(0, 14)) { const c = r.caughtThen.h24; console.log('  ' + pad(r.rule.replace(/ \(a split, not a warning\)/, '').slice(0, 48), 50) + pad(String(r.caught), 9) + bar(c.rate * 100, 14, c.rate >= 0.3 ? red : yellow) + ' ' + pad(pct(c.rate * 100, 0), 13) + (r.lift24h != null ? bold(r.lift24h.toFixed(1) + 'x') : dim('—'))); }
      foot(v.note, `${BASE}/lab/`);
    });
  },
  async watchlist([sub, x, y]) {
    // the same list as the site, the extension and the bot, under a code kept in ~/.shuntdesk.json
    const { readFileSync, writeFileSync } = await import('node:fs'), { homedir } = await import('node:os'), { join } = await import('node:path');
    const CFG = join(homedir(), '.shuntdesk.json'), cfg = (() => { try { return JSON.parse(readFileSync(CFG, 'utf8')); } catch (e) { return {}; } })();
    const save = c => { try { writeFileSync(CFG, JSON.stringify({ ...cfg, watchlist: c }, null, 2)); } catch (e) {} };
    if (/^wl-[a-z0-9]{6}$/i.test(sub || '')) { cfg.watchlist = sub.toLowerCase(); save(cfg.watchlist); sub = undefined; }
    let code = cfg.watchlist;
    if (sub === 'add' || sub === 'remove') {
      const a = need(x); const r = await getApi('watch', sub === 'add' ? 'adding it to your watchlist' : 'taking it off your watchlist', sub === 'add' ? { c: code, add: { a, sym: y || '' } } : { c: code, remove: a });
      code = r.code; save(code); console.log('\n  ' + green('● ') + (sub === 'add' ? `added ${short(a)}` : `removed ${short(a)}`) + dim(` · watchlist ${code}`));
    }
    if (!code) { console.log(`\n  ${dim('no watchlist yet.')} Add a token: ${bold('shuntdesk watchlist add 0x…')}\n  ${dim('or use the code from the site, the extension or the bot:')} ${bold('shuntdesk watchlist wl-xxxxxx')}\n`); return; }
    const v = await getApi('watch?c=' + code, 'reading your watchlist');
    out(v, v => {
      head('Watchlist', `${v.code} · ${v.tokens.length} of ${v.max}${v.telegram ? ' · alerts on in Telegram' : ''}`); console.log();
      for (const t of v.tokens) { const n = t.now;
        const state = !n ? dim('not read yet: the server looks every five minutes') : n.bonded ? green('bonded') : n.progress != null ? `${bar(n.progress, 18, n.progress >= 80 ? green : n.progress >= 50 ? yellow : dim)} ${pct(n.progress)}` : n.price ? `$${n.price.toPrecision(4)}` : dim('no price read');
        console.log('  ' + pad(bold('$' + (t.sym || '?').slice(0, 12)), 15) + pad(dim(short(t.a)), 14) + state); }
      if (v.events?.length) { console.log('\n  ' + dim('what changed')); for (const e of v.events.slice(0, 10)) console.log('  ' + pad(dim(ago(new Date(e.t).toISOString())), 10) + (/half|launcher|fell/.test(e.kind + e.text) ? yellow('● ') : green('● ')) + e.text); }
      else console.log('\n  ' + dim('nothing has changed since these were added.'));
      console.log('\n  ' + dim('the same list everywhere: the site\'s watchlist panel, the extension, and ') + bold(`/watchlist ${v.code}`) + dim(' on @shuntdesk_bot'));
      console.log('  ' + dim('shuntdesk watchlist add 0x… · shuntdesk watchlist remove 0x…') + '\n');
    });
  },
  async live() {
    // every Pons launch and bond as it happens, read from the chain's own log on the user's machine; each new token then
    // gets the contract read and its curve from Shuntdesk. Reads are queued so a burst never runs past the hourly limit.
    if (JSON_OUT) die('live draws a running feed; use radar --json for one read');
    const PONS = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e', T_LAUNCH = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607', T_GRAD = '0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259';
    const onlyClean = flags.has('--clean'), rpcJ = async (method, params) => { const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; };
    const word = h => '0x' + h.slice(26), sym = async a => { try { const h = (await rpcJ('eth_call', [{ to: a, data: '0x95d89b41' }, 'latest'])).slice(2); const n = parseInt(h.slice(64, 128), 16); return Buffer.from(h.slice(128, 128 + n * 2), 'hex').toString('utf8').replace(/[^\x20-\x7e]/g, '').slice(0, 14) || '?'; } catch (e) { return '?'; } };
    const clock = () => new Date().toISOString().slice(11, 19), seen = new Set(), queue = []; let n = { launches: 0, clean: 0, flagged: 0, bonds: 0 };
    banner(); head('Live', `every Pons launch and bond as it lands · ${onlyClean ? 'clean reads only · ' : ''}ctrl+c to stop`); console.log('\n  ' + dim('watching the Pons factory on Robinhood Chain…') + '\n');
    process.on('SIGINT', () => { console.log('\n  ' + dim(`${n.launches} launches read · ${n.clean} clean · ${n.flagged} with a flag · ${n.bonds} bonds`) + '\n'); process.exit(0); });
    let from = parseInt(await rpcJ('eth_blockNumber', []), 16) - 600;   // about a minute back, so the feed starts with something
    const readOne = async ({ token, by, at }) => {
      const [x, s, y] = await Promise.all([fetchV1('scan?a=' + token).catch(() => null), fetchV1('sim?a=' + token).catch(() => null), sym(token)]);
      const hi = (x?.powers || []).filter(p => p.level === 'high'), bad = hi.length || x?.proxy;
      n.launches++; if (bad) n.flagged++; else if (x) n.clean++;
      if (onlyClean && (bad || !x)) return;
      const tag = !x ? yellow('○ contract not read') : bad ? red('● ' + [...new Set(hi.map(p => p.what))].slice(0, 2).join(' · ') + (x.proxy ? ' · proxy' : '')) : green('● no power to mint, pause, block or tax');
      const curve = s ? `${bar(s.progress, 14, s.progress >= 50 ? green : dim)} ${pct(s.progress)} ${dim(s.raised.toFixed(3) + ' ETH in')}` : dim('curve not read yet');
      console.log('  ' + dim(at) + '  ' + pad(bold('$' + y), 16) + pad(dim(short(token)), 14) + dim('by ') + short(by));
      console.log('            ' + tag + dim('  ·  ') + curve);
      console.log('            ' + dim(`npx shuntdesk ${short(token)}  ·  ${BASE}/ticket/?a=${token}`) + '\n');
    };
    (async () => { for (;;) { const job = queue.shift(); if (job) await readOne(job).catch(() => {}); await new Promise(r => setTimeout(r, job ? 8000 : 1000)); } })();   // eight seconds a read: well inside 120 an hour
    for (;;) {
      try {
        const head = parseInt(await rpcJ('eth_blockNumber', []), 16);
        if (head > from) {
          const logs = await rpcJ('eth_getLogs', [{ address: PONS, topics: [[T_LAUNCH, T_GRAD]], fromBlock: '0x' + (from + 1).toString(16), toBlock: '0x' + head.toString(16) }]);
          for (const l of logs) {
            const key = l.transactionHash + l.logIndex; if (seen.has(key)) continue; seen.add(key);
            if (l.topics[0] === T_LAUNCH) queue.push({ token: word(l.topics[1]), by: word(l.topics[3]), at: clock() });
            else { n.bonds++; const t = word(l.topics[1]); console.log('  ' + dim(clock()) + '  ' + green(bold('BONDED ')) + pad(bold('$' + await sym(t)), 16) + dim(short(t)) + dim('  reached the bond mark') + '\n'); }
          }
          from = head;
        }
      } catch (e) { console.log('  ' + yellow('○ ') + dim('the node did not answer, trying again: ' + String(e.message).slice(0, 60))); }
      await new Promise(r => setTimeout(r, 6000));
    }
  },
  async grads() {
    const v = await get('bonds', 'reading the bonds');
    out(v.bonded || [], B => { head('Fresh bonds', 'Pons curves that reached the bond mark'); console.log(); for (const b of B.slice(0, 20)) console.log('  ' + pad(bold(b.symbol || '?'), 14) + pad(dim(ago(b.bonded)), 10) + pad(toBond(b.hoursToBond), 18) + dim(b.token)); foot('', `${BASE}/bonds/`); });
  },
};
const ALIAS = { grad: 'graduation', pumpfun: 'graduation', xray: 'scan', verdict: 'token', simulate: 'sim', devledger: 'ledger', devscore: 'dev', score: 'dev', twin: 'twins', bags: 'shared', feed: 'live', launches: 'live', wl: 'watchlist', curves: 'bonds', new: 'radar', graduated: 'grads', bonded: 'grads', report: 'check', website: 'site', lookalikes: 'alike', looks: 'alike', verdicts: 'calls', record: 'calls', crew: 'desk', stock: 'stocks', shunt: 'proof', weekly: 'week', game: 'rugrun', 'rug-run': 'rugrun', door: 'exit', 'exit-door': 'exit', bond: 'bondgame', 'will-it-bond': 'bondgame', chart: 'replay', rules: 'lab' };

// a bare address: a contract gets the full check, a wallet (or a smart wallet) its X-ray
async function auto(a) {
  const code = await spin('looking at the address', codeOf(a).catch(() => null));
  if (code == null) return COMMANDS.check([a]);
  return code === '0x' || /^0xef0100/i.test(code) ? COMMANDS.wallet([a]) : COMMANDS.check([a]);
}

function help() {
  banner();
  const c = (cmd, what) => console.log('  ' + pad(bold(cmd), 34) + dim(what));
  console.log('\n  ' + dim('paste any address:') + '\n'); c('shuntdesk <0x…>', 'a token gets the full check, a wallet its X-ray'); c('shuntdesk <solana mint>', 'a Solana token through the seven checks'); c('shuntdesk first <mint>', 'a Pump.fun launch: who bought first, who still holds'); c('shuntdesk graduation', 'Pump.fun curves closest to graduating');
  console.log('\n  ' + dim('tokens:') + '\n'); c('shuntdesk check <token>', 'everything at once, and what the chain shows'); c('shuntdesk scan <token>', 'the contract: powers, owner, proxy, source'); c('shuntdesk token <token>', 'the verdict, flags, holders, launch facts'); c('shuntdesk ledger <token>', 'where the launcher sent its tokens'); c('shuntdesk twins <token>', 'contracts running exactly the same code'); c('shuntdesk shared <token> <token>', 'top wallets holding both'); c('shuntdesk site <token>', 'its website: domain age, urlscan, links'); c('shuntdesk alike <token>', 'tokens that looked like it, and how they ended'); c('shuntdesk exit <token> [size]', 'what a buy gets back if the dev or snipers sell first'); c('shuntdesk replay <token>', 'its chart in your terminal: launch, peak, drop, now');
  console.log('\n  ' + dim('pons curves:') + '\n'); c('shuntdesk live [--clean]', 'every Pons launch and bond as it lands, read on arrival'); c('shuntdesk watchlist [code]', 'your watchlist, the same one as the site, extension and bot'); c('shuntdesk sim <token> [eth]', 'run a buy before you make it, and its break even'); c('shuntdesk watch <token> [seconds]', 'the curve live in your terminal'); c('shuntdesk bonds [n]', 'the curves closest to bonding'); c('shuntdesk grads', 'curves that just bonded');
  console.log('\n  ' + dim('wallets and the radar:') + '\n'); c('shuntdesk wallet <wallet>', 'every token in it, flags and copies'); c('shuntdesk dev <wallet>', 'a launcher\'s record on Pons'); c('shuntdesk radar [n]', 'the newest tokens the radar read');
  console.log('\n  ' + dim('the record:') + '\n'); c('shuntdesk calls [n]', 'the latest verdicts and how they held'); c('shuntdesk caught', 'what the radar flagged, and what it missed'); c('shuntdesk week', 'the week on Robinhood Chain'); c('shuntdesk desk', 'the crew\'s paper desk'); c('shuntdesk stocks', 'the stocks behind the stock tokens'); c('shuntdesk proof', '$SHUNT, read from the chain'); c('shuntdesk lab', 'every flag rule against what happened');
  console.log('\n  ' + dim('play:') + '\n'); c('shuntdesk rugrun', 'ten real new tokens, names hidden: rug or ride?'); c('shuntdesk bondgame', 'five Pons curves a day: will they bond?');
  console.log(`\n  ${dim('--json for the raw answer · run')} shuntdesk ${dim('alone for a prompt')}\n  ${dim('read-only, no key, 120 reads an hour. nothing here is advice.')} ${cyan('shuntdesk.com')}\n`);
}

// run shuntdesk alone: a prompt that takes addresses and commands until q
let INTERACTIVE = false;
async function prompt() {
  INTERACTIVE = true; banner(); console.log('\n  ' + dim('paste a token or a wallet, or type a command (help, bonds, radar…). q to quit.') + '\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '  ' + cyan('shunt ›') + ' ' });
  rl.prompt();
  for await (const raw of rl) {
    const words = raw.trim().split(/\s+/).filter(Boolean);
    if (!words.length) { rl.prompt(); continue; }
    if (/^(q|quit|exit)$/i.test(words[0])) break;
    try { await run(words); } catch (e) { if (!(e instanceof ReadError)) console.error('  ' + red('✖ ') + e.message); }
    rl.prompt();
  }
  rl.close();
}
async function run([cmd, ...rest]) {
  if (isAddr(cmd)) return auto(cmd.toLowerCase());
  if (isSol(cmd)) return COMMANDS.sol([cmd]);
  if (cmd === 'help') return help();
  const f = COMMANDS[ALIAS[cmd] || cmd];
  if (!f) { console.error('  ' + red('✖ ') + `no command "${cmd}"`); if (!INTERACTIVE) { help(); process.exit(1); } return; }
  return f(rest);
}

if (flags.has('--version') || flags.has('-v')) console.log(VERSION);
else if (flags.has('--help')) help();
else if (!args.length) { if (process.stdin.isTTY && TTY) await prompt(); else help(); }
else await run(args);
