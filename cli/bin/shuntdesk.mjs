#!/usr/bin/env node
// shuntdesk: the Shuntdesk reads of Robinhood Chain tokens, from a terminal. Read-only, no key, the same answers as
// shuntdesk.com, through its agent interface (https://shuntdesk.com/llms.txt). Nothing here is advice.
import { simulate, breakEven } from '../lib/curve.mjs';
import { createInterface } from 'node:readline';

const VERSION = '1.0.0';
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
const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '—';
const n0 = v => v == null ? '—' : v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? Math.round(v).toLocaleString('en-US') : (+(+v).toFixed(2)).toString();
const eth = v => v == null ? '—' : v.toFixed(v < 0.01 ? 5 : 4) + ' ETH';
const pc = (v, d = 1) => v == null ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
const pct = (v, d = 1) => v == null ? '—' : Number(v).toFixed(d) + '%';
const usd = v => v == null ? '—' : '$' + (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2));
const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 60 ? m + 'm ago' : m < 2880 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
const wrap = (s, w = 92) => String(s).split(' ').reduce((o, word) => { const l = o[o.length - 1]; if ((l + ' ' + word).trim().length > w) o.push(word); else o[o.length - 1] = (l + ' ' + word).trim(); return o; }, ['']).join('\n');
const bar = (p, w = 30, c = green) => { const f = Math.max(0, Math.min(w, Math.round((p || 0) / 100 * w))); return c('█'.repeat(f)) + dim('░'.repeat(w - f)); };
const line = (k, v) => console.log('  ' + dim(pad(k, 20)) + v);
const head = (s, sub = '') => console.log('\n ' + inv(bold(` ${s} `)) + (sub ? ' ' + dim(sub) : ''));
const foot = (note, link) => { if (note) console.log('\n' + dim(wrap(note).replace(/^/gm, '  '))); if (link) console.log('  ' + cyan(link)); console.log(); };
const box = (title, rows) => { const w = Math.max(plain(title).length + 4, ...rows.map(r => plain(r).length + 4)); console.log('  ┌─ ' + bold(title) + ' ' + '─'.repeat(Math.max(0, w - plain(title).length - 3)) + '┐'); for (const r of rows) console.log('  │ ' + pad(r, w - 1) + '│'); console.log('  └' + '─'.repeat(w + 1) + '┘'); };
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
async function fetchV1(path) {
  let r; try { r = await fetch(BASE + '/api/v1/' + path, { headers: { 'User-Agent': 'shuntdesk-cli/' + VERSION, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) }); }
  catch (e) { throw new ReadError('could not reach ' + BASE + ': ' + (e.cause?.code || e.message)); }
  const j = await r.json().catch(() => null);
  if (r.status === 429) throw new ReadError((j?.error || 'rate limited') + '. Try again later.');
  if (!j) throw new ReadError('the server did not answer with data (' + r.status + ')');
  if (j.error) throw new ReadError(j.error);
  if (j.ok === false) throw new ReadError(j.why || 'not answering right now');
  return j;
}
const get = (path, label = 'reading') => spin(label, fetchV1(path)).catch(e => die(e.message));
const soft = (path) => fetchV1(path).then(v => ({ v }), e => ({ why: e.message }));   // a read that may fail without ending the report
async function codeOf(a) { const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [a, 'latest'] }), signal: AbortSignal.timeout(20000) }); return (await r.json()).result; }
function die(msg) { if (JSON_OUT) console.log(JSON.stringify({ ok: false, why: msg })); else console.error('  ' + red('✖ ') + msg); if (!INTERACTIVE) process.exit(1); throw new ReadError(msg); }
const need = (a, what = 'token') => { if (!isAddr(a)) die(`pass a ${what} address: 0x followed by 40 hex characters`); return a.toLowerCase(); };
const out = (j, render) => { if (JSON_OUT) console.log(JSON.stringify(j, null, 2)); else render(j); };
const toBond = h => h == null ? '' : h < 0.1 ? 'bonded at launch' : h < 1 ? Math.round(h * 60) + ' min to bond' : h.toFixed(1) + 'h to bond';
const dead = o => /^0x0{40}$/i.test(o || '') || /dead$/i.test(o || '');

// ---------- what a report says: findings, never a verdict of safe ----------
function findings({ tok, scan, led, sim }) {
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
  if (sim) { const r = simulate(sim, 0.05); add(r.back / 0.05 - 1 < -0.04 ? 'yellow' : 'green', `a 0.05 ETH round trip on the curve comes back ${pc(r.back / 0.05 - 1)} after fees`); }
  return F.sort((a, b) => ['red', 'yellow', 'green'].indexOf(a.lvl) - ['red', 'yellow', 'green'].indexOf(b.lvl));
}
const dot = { red: red('●'), yellow: yellow('●'), green: green('●') };

// ---------- commands ----------
const COMMANDS = {
  async check([a]) {
    a = need(a);
    const [t, x, d] = await spin('reading the token, its contract and its launcher', Promise.all([soft('token?a=' + a), soft('scan?a=' + a), soft('ledger?a=' + a)]));
    const tok = t.v, onCurve = tok?.launch?.ok && /pons/i.test(tok.launch.launchpad || '') && !tok.launch.graduated;
    const s = onCurve ? await spin('reading the curve', soft('sim?a=' + a)) : null;
    const parts = { tok, scan: x.v, led: d.v, sim: s?.v }, F = findings(parts), unread = [['token', t], ['contract', x], ['ledger', d], ...(s ? [['curve', s]] : [])].filter(([, r]) => r.why);
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
      console.log(); box('What the chain shows', F.length ? F.map(f => `${dot[f.lvl]} ${f.text}`) : [dim('nothing read to report')]);
      for (const [k, r] of unread) console.log('  ' + yellow('○ ') + dim(`${k} not read: ${r.why}`));
      foot('Findings read from public chain data, not a verdict on anyone and not advice. A part not read is said as not read.', `${BASE}/ticket/?a=${a}`);
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
    a = need(a); const E = e === undefined ? 0.05 : Number(e); if (!(E > 0 && E < 100)) die('the size is an amount of ETH, more than 0');
    const c = await get('sim?a=' + a, 'reading the curve'), r = simulate(c, E), be = breakEven(c, E);
    const after = [0.05, 0.1, 0.25, 0.5, 1, 2].map(X => ({ others: X, ...simulate(c, E, X) }));
    out({ curve: c, size: E, result: r, breakEvenInflow: be, after }, () => {
      head('Curve Simulator', `${short(c.token)} · ${E} ETH in`);
      line('curve now', `${bar(c.progress, 24)} ${c.progress.toFixed(1)}% ${dim(`${c.raised.toFixed(3)} of ${c.need} ETH · fee ${(c.fee * 100).toFixed(1)}% each way`)}`);
      line('after your buy', `${bar(r.after, 24, cyan)} ${r.after.toFixed(1)}%` + (r.bonds ? green(' · reaches the bond mark') : ''));
      line('you get', `${bold(n0(r.tok))} tokens ${dim(`at $${(r.avg * c.ethUsd).toPrecision(3)} average, ${usd(E * c.ethUsd)} in`)}`);
      line('price moves', pc(r.impact) + dim(' from your buy alone'));
      line('sold straight back', `${eth(r.back)} ${(r.back < E ? red : green)(pc(r.back / E - 1))}`);
      line('break even when', be == null ? yellow('the curve bonds first') : `${bold(eth(be))} ${dim('comes in after you')}`);
      console.log('\n  ' + dim(pad('others put in', 16) + pad('curve then', 30) + 'you get back'));
      for (const q of after) console.log('  ' + pad(`${q.others} ETH`, 16) + pad(`${bar(q.afterX, 16, dim)} ${q.afterX.toFixed(1)}%`, 30) + `${eth(q.back)} ${(q.back < E ? red : green)(pc(q.back / E - 1))}`);
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
      if (v.partial) console.log('  ' + yellow('○ part of the history could not be read: the totals may be low'));
      foot(v.note || 'Read from the chain index. Not advice.', `${BASE}/ticket/?a=${v.token}`);
    });
  },
  async dev([w]) {
    w = need(w, 'launcher wallet'); const v = await get('devscore?a=' + w, 'reading every launch by this wallet');
    out(v, v => {
      head('Dev Score', v.wallet);
      line('score', v.score == null ? dim('no launch it held tokens of') : `${bar(v.score, 24, v.score >= 80 ? green : v.score >= 50 ? yellow : red)} ${bold(v.score + '/100')} ${dim('share of its launches it did not dump')}`);
      line('launched', `${v.launched} on Pons ${dim(`· ${v.read} read in full`)}`); line('bonded', String(v.bonded));
      line('dumped', (v.dumped ? red : green)(String(v.dumped)) + dim(` · ${v.dumpedFirstHour} in the first hour`)); line('burned most', String(v.burnedMost));
      if (v.partial) console.log('  ' + yellow(`○ ${v.unread} launch${v.unread === 1 ? '' : 'es'} could not be read: the record is partial`));
      if (v.launches?.length) { console.log(); for (const l of v.launches.slice(0, 12)) console.log('  ' + pad(bold(l.symbol || '?'), 14) + pad(dim(short(l.token)), 14) + (l.unread ? yellow('not read') : `${l.bonded ? green('bonded  ') : dim('on curve')}  ${l.dumped ? red('dumped') : ''}${l.burnedMost ? green(' burned most') : ''}`)); }
      foot(v.note, `${BASE}/dev/?w=${v.wallet}`);
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
      head('Wallet X-ray', v.wallet);
      const T = v.tokens || []; line('tokens', String(T.length)); console.log();
      for (const t of T.slice(0, 25)) {
        const amt = Number(BigInt(t.balance || '0') / 10n ** BigInt(Math.max(0, (t.decimals ?? 18) - 4))) / 1e4, vd = t.verdict;
        const tags = [t.impostor ? red(`copy: the real ${t.symbol || 'token'} is ${short(t.impostor)}`) : '', vd ? (vd.verdict === 'CLEAN' ? green : vd.verdict === 'DANGER' ? red : yellow)(vd.verdict) : '', t.curve?.progress != null ? dim(`curve ${pct(t.curve.progress)}`) : '', t.powers?.length ? yellow(t.powers.length + ' powers') : ''].filter(Boolean).join(dim(' · '));
        console.log('  ' + pad(bold((t.symbol || '?').slice(0, 12)), 14) + pad(n0(amt), 12) + pad(dim(short(t.token)), 14) + tags);
      }
      if (T.length > 25) console.log('  ' + dim(`and ${T.length - 25} more`));
      foot((v.note || '') + ' What each would fetch if sold now is worked on the site.', `${BASE}/wallet/?w=${v.wallet}`);
    });
  },
  async bonds([k]) {
    const v = await get('bonds', 'reading every open Pons curve'), N = Math.min(40, Number(k) || 12);
    out(v, v => {
      const day = v.days?.[v.days.length - 1];
      head('Bond Watch', `${v.onCurve ?? v.rows.length} on the curve${day ? ` · today ${day.l} launched, ${day.g} bonded` : ''}`); console.log();
      for (const r of v.rows.slice(0, N)) console.log('  ' + pad(bold((r.symbol || '?').slice(0, 11)), 13) + bar(r.progress, 26, r.progress >= 80 ? green : r.progress >= 50 ? yellow : dim) + ' ' + pad(bold(pct(r.progress)), 7) + pad(dim(`${r.raised.toFixed(2)}/${r.need}`), 11) + (r.perHour > 0 ? green(`+${r.perHour.toFixed(2)}/h`) + (r.etaHours != null ? dim(` ~${r.etaHours.toFixed(1)}h`) : '') : dim('quiet')) + '  ' + dim(short(r.token)));
      if (v.bonded?.length) { console.log('\n  ' + dim('bonded lately: ') + v.bonded.slice(0, 6).map(b => `${b.symbol} ${dim(toBond(b.hoursToBond))}`).join(dim(' · '))); }
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
  async grads() {
    const v = await get('bonds', 'reading the bonds');
    out(v.bonded || [], B => { head('Fresh bonds', 'Pons curves that reached the bond mark'); console.log(); for (const b of B.slice(0, 20)) console.log('  ' + pad(bold(b.symbol || '?'), 14) + pad(dim(ago(b.bonded)), 10) + pad(toBond(b.hoursToBond), 18) + dim(b.token)); foot('', `${BASE}/bonds/`); });
  },
};
const ALIAS = { xray: 'scan', verdict: 'token', simulate: 'sim', devledger: 'ledger', devscore: 'dev', score: 'dev', twin: 'twins', bags: 'shared', live: 'watch', curves: 'bonds', new: 'radar', graduated: 'grads', bonded: 'grads', report: 'check' };

// a bare address: a contract gets the full check, a wallet (or a smart wallet) its X-ray
async function auto(a) {
  const code = await spin('looking at the address', codeOf(a).catch(() => null));
  if (code == null) return COMMANDS.check([a]);
  return code === '0x' || /^0xef0100/i.test(code) ? COMMANDS.wallet([a]) : COMMANDS.check([a]);
}

function help() {
  banner();
  const c = (cmd, what) => console.log('  ' + pad(bold(cmd), 34) + dim(what));
  console.log('\n  ' + dim('paste any address:') + '\n'); c('shuntdesk <0x…>', 'a token gets the full check, a wallet its X-ray');
  console.log('\n  ' + dim('tokens:') + '\n'); c('shuntdesk check <token>', 'everything at once, and what the chain shows'); c('shuntdesk scan <token>', 'the contract: powers, owner, proxy, source'); c('shuntdesk token <token>', 'the verdict, flags, holders, launch facts'); c('shuntdesk ledger <token>', 'where the launcher sent its tokens'); c('shuntdesk twins <token>', 'contracts running exactly the same code'); c('shuntdesk shared <token> <token>', 'top wallets holding both');
  console.log('\n  ' + dim('pons curves:') + '\n'); c('shuntdesk sim <token> [eth]', 'run a buy before you make it, and its break even'); c('shuntdesk watch <token> [seconds]', 'the curve live in your terminal'); c('shuntdesk bonds [n]', 'the curves closest to bonding'); c('shuntdesk grads', 'curves that just bonded');
  console.log('\n  ' + dim('wallets and the radar:') + '\n'); c('shuntdesk wallet <wallet>', 'every token in it, flags and copies'); c('shuntdesk dev <wallet>', 'a launcher\'s record on Pons'); c('shuntdesk radar [n]', 'the newest tokens the radar read');
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
  if (cmd === 'help') return help();
  const f = COMMANDS[ALIAS[cmd] || cmd];
  if (!f) { console.error('  ' + red('✖ ') + `no command "${cmd}"`); if (!INTERACTIVE) { help(); process.exit(1); } return; }
  return f(rest);
}

if (flags.has('--version') || flags.has('-v')) console.log(VERSION);
else if (flags.has('--help')) help();
else if (!args.length) { if (process.stdin.isTTY && TTY) await prompt(); else help(); }
else await run(args);
