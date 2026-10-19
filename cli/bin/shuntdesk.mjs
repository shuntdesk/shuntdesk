#!/usr/bin/env node
// shuntdesk: the Shuntdesk reads of Robinhood Chain tokens, from a terminal. Read-only, no key, the same answers as
// shuntdesk.com, through its agent interface (https://shuntdesk.com/llms.txt). Nothing here is advice.
import { simulate, breakEven } from '../lib/curve.mjs';

const VERSION = '1.0.0';
const BASE = (process.env.SHUNTDESK_API || 'https://shuntdesk.com').replace(/\/$/, '');
const argv = process.argv.slice(2), flags = new Set(argv.filter(a => a.startsWith('--'))), args = argv.filter(a => !a.startsWith('--'));
const JSON_OUT = flags.has('--json');
const color = process.stdout.isTTY && !process.env.NO_COLOR && !JSON_OUT;
const paint = c => s => color ? `\x1b[${c}m${s}\x1b[0m` : String(s);
const bold = paint('1'), dim = paint('2'), red = paint('31'), green = paint('32'), yellow = paint('33');
const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '—';
const n0 = v => v == null ? '—' : v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? Math.round(v).toLocaleString('en-US') : (+v.toFixed(2)).toString();
const eth = v => v == null ? '—' : v.toFixed(v < 0.01 ? 5 : 4) + ' ETH';
const pc = (v, d = 1) => v == null ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
const pct = (v, d = 1) => v == null ? '—' : Number(v).toFixed(d) + '%';
const line = (k, v) => console.log('  ' + dim(k.padEnd(20)) + v);
const head = s => console.log('\n' + bold(s));
const foot = (note, link) => { if (note) console.log('\n' + dim(wrap(note))); if (link) console.log(dim(link)); console.log(); };
const wrap = (s, w = 96) => String(s).split(' ').reduce((o, word) => { const l = o[o.length - 1]; if ((l + ' ' + word).trim().length > w) o.push(word); else o[o.length - 1] = (l + ' ' + word).trim(); return o; }, ['']).join('\n');

async function get(path) {
  let r; try { r = await fetch(BASE + '/api/v1/' + path, { headers: { 'User-Agent': 'shuntdesk-cli/' + VERSION, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) }); }
  catch (e) { die('could not reach ' + BASE + ': ' + (e.cause?.code || e.message)); }
  const j = await r.json().catch(() => null);
  if (r.status === 429) die((j?.error || 'rate limited') + '. Try again later.');
  if (!j) die('the server did not answer with data (' + r.status + ')');
  if (j.error) die(j.error);
  if (j.ok === false) die(j.why || 'not answering right now');
  return j;
}
function die(msg) { if (JSON_OUT) console.log(JSON.stringify({ ok: false, why: msg })); else console.error(red('shuntdesk: ') + msg); process.exit(1); }
const need = (a, what = 'token') => { if (!isAddr(a)) die(`pass a ${what} address: 0x followed by 40 hex characters`); return a.toLowerCase(); };
const out = (j, render) => { if (JSON_OUT) console.log(JSON.stringify(j, null, 2)); else render(j); };

const COMMANDS = {
  async scan([a]) {
    a = need(a); const v = await get('scan?a=' + a);
    out(v, v => {
      head('Contract X-ray · ' + short(v.token));
      const dead = o => /^0x0{40}$/i.test(o) || /dead$/i.test(o);
      line('functions', `${v.functions} (${v.named} named${v.unknown ? `, ${v.unknown} unknown` : ''})`);
      line('owner', v.owner == null ? 'not read' : dead(v.owner) ? green('renounced') + dim(' ' + short(v.owner)) : yellow(v.owner));
      line('proxy', v.proxy ? yellow('yes, the code can be swapped') + dim(' ' + short(v.proxy.impl || v.proxy)) : 'no');
      line('roles', v.roles ? yellow('answers to an admin role') : 'none found');
      line('source', v.source?.verified ? green('verified') + dim(' on ' + v.source.by) : 'not verified' + (v.source?.by ? dim(' on ' + v.source.by) : ''));
      const hi = (v.powers || []).filter(p => p.level === 'high'), mid = (v.powers || []).filter(p => p.level === 'medium');
      if (!(v.powers || []).length) line('powers', green('no function that mints, pauses, blocks wallets or changes the tax'));
      for (const p of [...hi, ...mid]) line(p.level === 'high' ? red(p.level) : yellow(p.level), `${p.what} ${dim(p.fn)}`);
      foot('Read from the contract code. A power that is there can be used while someone holds control; renounced control cannot use it. Not advice.', `${BASE}/scan/?a=${v.token}`);
    });
  },
  async token([a]) {
    a = need(a); const v = await get('token?a=' + a);
    out(v, v => {
      head(`${v.symbol ? '$' + v.symbol : short(v.token)} · ${v.name || ''}`.trim());
      const vd = v.verdict;
      if (vd) { const c = vd.verdict === 'CLEAN' ? green : vd.verdict === 'DANGER' ? red : yellow; line('verdict', `${c(vd.verdict)} ${vd.score}/100 ${dim('at ' + vd.at.slice(0, 16).replace('T', ' ') + ' UTC')}`);
        if (vd.priceAtVerdict && vd.after1h) line('an hour later', pc(vd.after1h / vd.priceAtVerdict - 1));
        if (vd.priceAtVerdict && vd.after24h) line('a day later', pc(vd.after24h / vd.priceAtVerdict - 1)); }
      else line('verdict', 'no verdict filed yet');
      const s = v.serverCheck; if (s) { line('red flags', s.redFlags?.length ? red(s.redFlags.join(', ')) : green('none found') + dim(' (' + s.source + ')')); line('holders', n0(s.holders)); }
      const l = v.launch; if (l?.ok && l.launchpad) {
        line('launchpad', l.launchpad + (l.graduated ? green(' · bonded') : l.progress != null ? ` · curve ${pct(l.progress)}` : ''));
        line('snipers', `${l.snipers ?? '—'} holding ${pct(l.sniperPct)}`); line('bundles', `${l.bundlers ?? '—'} holding ${pct(l.bundlerPct)}`);
        line('insiders', `${l.insiders ?? '—'} holding ${pct(l.insiderPct)}`); line('dev holds', pct(l.devPct));
        if (l.liquidity != null) line('liquidity', '$' + n0(l.liquidity));
      }
      foot('A verdict is a rule-based reading of public data, and it can be wrong. Not advice.', `${BASE}/ticket/?a=${v.token}`);
    });
  },
  async sim([a, e]) {
    a = need(a); const E = e === undefined ? 0.05 : Number(e); if (!(E > 0 && E < 100)) die('the size is an amount of ETH, more than 0');
    const c = await get('sim?a=' + a), r = simulate(c, E), be = breakEven(c, E);
    const after = [0.05, 0.1, 0.25, 0.5, 1, 2].map(X => ({ others: X, ...simulate(c, E, X) }));
    out({ curve: c, size: E, result: r, breakEvenInflow: be, after }, () => {
      head(`Curve Simulator · ${short(c.token)} · ${E} ETH`);
      line('curve now', `${c.progress.toFixed(1)}% · ${c.raised.toFixed(3)} of ${c.need} ETH · fee ${(c.fee * 100).toFixed(1)}% each way`);
      line('you get', `${n0(r.tok)} tokens ${dim(`average $${(r.avg * c.ethUsd).toPrecision(3)}, $${(E * c.ethUsd).toFixed(2)} in`)}`);
      line('price moves', pc(r.impact) + dim(' from your buy alone'));
      line('curve after', `${r.after.toFixed(1)}%` + (r.bonds ? green(' · reaches the bond mark') : dim(` · ${(c.need - c.realEth - E * (1 - c.fee)).toFixed(3)} ETH left to bond`)));
      line('sold straight back', `${eth(r.back)} ${(r.back < E ? red : green)(pc(r.back / E - 1))}`);
      line('break even when', be == null ? yellow('not before the curve bonds') : `others put in ${eth(be)} after you`);
      console.log('\n  ' + dim('others put in'.padEnd(20) + 'curve then'.padEnd(14) + 'you get back'));
      for (const q of after) console.log('  ' + `${q.others} ETH`.padEnd(20) + `${q.afterX.toFixed(1)}%`.padEnd(14) + `${eth(q.back)} ${(q.back < E ? red : green)(pc(q.back / E - 1))}`);
      foot('Worked on the curve\'s own reserves, read from its contract now: constant product, the fee off the ETH in and out, never more out than the curve has raised. Not modeled: others selling, the order of trades in a block, gas, a buy that crosses the bond mark. Not advice.', `${BASE}/sim/?a=${c.token}&e=${E}`);
    });
  },
  async ledger([a]) {
    a = need(a); const v = await get('ledger?a=' + a);
    out(v, v => {
      head('Dev Ledger · ' + short(v.token));
      line('launcher', v.dev ? v.dev + dim(' (from the ' + v.devFound + ')') : 'not found');
      const L = v.ledger || {}; const got = (L.bought || 0) + (L.received || 0);
      line('got', n0(got) + dim(` (bought ${n0(L.bought)}, received ${n0(L.received)})`));
      const part = k => got ? dim(' · ' + pct((L[k] || 0) / got * 100)) : '';
      line('sold', (L.sold ? red(n0(L.sold)) : green('0')) + part('sold'));
      line('sent to wallets', (L.toWallets ? yellow(n0(L.toWallets)) : '0') + part('toWallets'));
      line('to contracts', n0(L.toContracts) + part('toContracts') + dim(' (pools and other contracts, not a sale)'));
      line('burned', n0(L.burned) + part('burned'));
      line('holds now', n0(v.holdsNow));
      if (v.partial) console.log('  ' + yellow('part of the history could not be read: the totals may be low'));
      foot(v.note || 'Read from the chain index. Not advice.', `${BASE}/ticket/?a=${v.token}`);
    });
  },
  async dev([w]) {
    w = need(w, 'launcher wallet'); const v = await get('devscore?a=' + w);
    out(v, v => {
      head('Dev Score · ' + short(v.wallet));
      line('score', v.score == null ? 'no launch it held tokens of' : (v.score >= 80 ? green : v.score >= 50 ? yellow : red)(v.score + '/100') + dim(' share of its launches it did not dump'));
      line('launched', `${v.launched} on Pons · ${v.read} read in full`);
      line('bonded', String(v.bonded)); line('dumped', (v.dumped ? red : green)(String(v.dumped)) + dim(` (${v.dumpedFirstHour} in the first hour)`));
      line('burned most', String(v.burnedMost));
      if (v.partial) console.log('  ' + yellow(`${v.unread} launch${v.unread === 1 ? '' : 'es'} could not be read: the record is partial`));
      for (const l of (v.launches || []).slice(0, 10)) console.log('  ' + `${l.symbol}`.padEnd(14) + dim(short(l.token)).padEnd(color ? 23 : 14) + (l.unread ? yellow('not read') : `${l.bonded ? green('bonded') : 'on curve'}  ${l.dumped ? red('dumped') : ''}${l.burnedMost ? ' burned most' : ''}`));
      foot(v.note, `${BASE}/dev/?w=${v.wallet}`);
    });
  },
  async twins([a]) {
    a = need(a); const v = await get('twins?a=' + a);
    out(v, v => {
      head('Twin Finder · ' + short(v.token));
      if (v.pons) { console.log(wrap(v.note, 92).replace(/^/gm, '  ')); console.log(dim(`\n  Try: shuntdesk dev <launcher wallet>   ·   ${BASE}/twins/?a=${v.token}\n`)); return; }
      line('functions', String(v.functions)); line('twins', `${v.twins} with the same code`);
      line('lost half', v.judged ? `${(v.lostHalf / v.judged >= 0.5 ? red : yellow)(v.lostHalf)} of ${v.judged} with a result` : '—');
      line('log compared', `${v.marked}${v.logged ? ' of ' + v.logged : ''} tokens`);
      for (const r of v.rows.slice(0, 10)) console.log('  ' + `${r.symbol || '?'}`.padEnd(14) + dim(short(r.token)).padEnd(color ? 23 : 14) + `${r.read.slice(0, 10)}  ` + (r.worst == null ? dim('no result yet') : (r.worst <= -0.5 ? red : String)(pc(r.worst, 0))));
      foot(v.note, `${BASE}/twins/?a=${v.token}`);
    });
  },
  async shared([a, b]) {
    a = need(a); b = need(b); if (a === b) die('pass two different tokens'); const v = await get(`shared?a=${a}&b=${b}`);
    out(v, v => {
      head(`Shared Bags · ${short(v.a)} and ${short(v.b)}`);
      line('wallets in both', String(v.shared)); line('holders read', `${v.readA} · ${v.readB}`);
      line('they hold', `${pct(v.heldA, 2)} of the first · ${pct(v.heldB, 2)} of the second`);
      for (const w of v.wallets.slice(0, 15)) console.log('  ' + w.wallet.padEnd(44) + `${pct(w.shareA, 2)}`.padEnd(10) + pct(w.shareB, 2));
      if (v.unread) console.log('  ' + yellow(`${v.unread} shared address${v.unread === 1 ? '' : 'es'} could not be checked for code and are left out`));
      foot(v.note, `${BASE}/shared/?a=${v.a}&b=${v.b}`);
    });
  },
};
const ALIAS = { xray: 'scan', verdict: 'token', simulate: 'sim', devledger: 'ledger', devscore: 'dev', score: 'dev', twin: 'twins', bags: 'shared' };

function help() {
  console.log(`
${bold('shuntdesk')} ${VERSION} · reads of Robinhood Chain tokens from shuntdesk.com

  ${bold('shuntdesk scan')} <token>          the contract: powers, owner, proxy, source
  ${bold('shuntdesk token')} <token>         the verdict, red flags, holders, launch facts
  ${bold('shuntdesk sim')} <token> [eth]     run a buy on a Pons curve before you make it (default 0.05 ETH)
  ${bold('shuntdesk ledger')} <token>        where the launcher sent its tokens
  ${bold('shuntdesk dev')} <wallet>          a launcher's record on Pons
  ${bold('shuntdesk twins')} <token>         contracts running exactly the same code, and how they ended
  ${bold('shuntdesk shared')} <token> <token> top wallets holding both

  --json      the raw answer, for scripts and agents
  --version   the version

  Read-only, no key. 120 calls an hour per caller; dev and shared use a daily index budget
  and say so when it is spent. Nothing here is advice. ${dim('https://shuntdesk.com')}
`);
}

const [cmd, ...rest] = args;
if (flags.has('--version') || flags.has('-v')) console.log(VERSION);
else if (!cmd || cmd === 'help' || flags.has('--help')) help();
else { const f = COMMANDS[ALIAS[cmd] || cmd]; if (!f) { console.error(red('shuntdesk: ') + `no command "${cmd}"`); help(); process.exit(1); } await f(rest); }
