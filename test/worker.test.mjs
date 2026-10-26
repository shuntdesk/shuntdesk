// the backend with an in-memory store and no outside service: routing, the board of desks, the agent interface
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { keccak256 } from '../server/worker.js';

let store = null;
const env = { KV: { get: async () => store, put: async (k, v) => { store = v; } } };
const call = async (path, body) => { const r = await worker.fetch(new Request('http://x/api/' + path, body ? { method: 'POST', body: JSON.stringify(body) } : {}), env); return [r.status, await r.json()]; };

test('keccak-256 matches the known vector for empty input', () => {
  assert.equal(keccak256(''), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');   // hex in, hex out, no 0x
  assert.equal(keccak256('00'), 'bc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a');
});
test('the crew desk starts at 10,000 paper USDG', async () => {
  const [s, d] = await call('desk'); assert.equal(s, 200); assert.equal(d.start, 10000); assert.equal(d.equity, 10000);
});
test('the board ranks this week and refuses bad handles', async () => {
  const [, bad] = await call('board', { handle: 'x', equity: 1 }); assert.equal(bad.ok, false);
  const [, b] = await call('board'); const [, posted] = await call('board', { handle: 'tester', equity: 10250, pnl: 250, season: b.season, trades: 2, wins: 1 });
  assert.equal(posted.rows[0].handle, 'tester'); assert.equal(posted.rows[0].pnl, 250);
});
test('the agent interface answers unknown paths with a pointer to llms.txt', async () => {
  const [s, j] = await call('v1/nope'); assert.equal(s, 404); assert.match(j.see, /llms\.txt/);
});
test('the agent interface asks for an address', async () => {
  const [s] = await call('v1/token?a=nope'); assert.equal(s, 400);
});
test('MCP: initialize, list the eighteen tools, refuse a bad address', async () => {
  const rpc = async b => { const r = await worker.fetch(new Request('http://x/mcp', { method: 'POST', body: JSON.stringify(b) }), env); return r.status === 202 ? null : r.json(); };
  const i = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }); assert.equal(i.result.serverInfo.name, 'shuntdesk');
  assert.equal(await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const l = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); assert.equal(l.result.tools.length, 18); assert.ok(l.result.tools.some(t => t.name === 'bond_hunters')); assert.ok(l.result.tools.some(t => t.name === 'solana_token')); assert.ok(l.result.tools.some(t => t.name === 'shared_bags' && t.inputSchema.required.includes('other')));
  const c = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'token', arguments: { address: 'x' } } }); assert.equal(c.result.isError, true);
});
test('the yard game gets only calls whose later price is known', async () => {
  const [s, j] = await call('play'); assert.equal(s, 200); assert.ok(Array.isArray(j.trains));
  for (const t of j.trains) assert.ok(t.move1h != null || t.move24h != null);
});
test('the yard leaderboard scores shifts itself and refuses trains it has no record of', async () => {
  const [s0, v] = await call('yard'); assert.equal(s0, 200); assert.ok(Array.isArray(v.rows));
  const [s1, bad] = await call('yard', { handle: 'x' }); assert.equal(s1, 400); assert.equal(bad.ok, false);
  const [s2, none] = await call('yard', { handle: 'tester', calls: [{ token: '0x' + '1'.repeat(40), call: 'RIDE' }] }); assert.equal(s2, 400); assert.match(none.why, /on file/);
});
test('the daily shift: same trains for the day, all of them must be called', async () => {
  const [s, d] = await call('daily'); assert.equal(s, 200); assert.ok(d.no >= 1); assert.ok(Array.isArray(d.trains));
  for (const t of d.trains) assert.equal(t.move1h, undefined);
  const [s2] = await call('daily', { handle: 'tester', calls: [] }); assert.equal(s2, 400);
});
test('Telegram in a group: quiet unless spoken to, and /id gives the chat id', async () => {
  const tg = async text => { const r = await worker.fetch(new Request('http://x/api/tg', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'right' }, body: JSON.stringify({ message: { message_id: 1, chat: { id: -100123, type: 'supergroup', title: 'Yard' }, text } }) }), { ...env, TELEGRAM_SECRET: 'right' }); return r.headers.get('content-type')?.includes('json') ? (await r.json()).text : await r.text(); };
  assert.equal(await tg('follow @shuntdesk on X'), 'ok');
  assert.equal(await tg('gm everyone'), 'ok');
  assert.equal(await tg('/start@SkeletonPriceBot'), 'ok');
  assert.match(await tg('/id'), /-100123/);
  // called by name it answers; the ticker in passing, or another bot, it does not
  assert.equal(await tg('$SHUNT to the moon'), 'ok');
  assert.equal(await tg('buy more shunt'), 'ok');
  assert.notEqual(await tg('gm shunt'), 'ok');
  assert.notEqual(await tg('Hey Shunt, what bonded today?'), 'ok');
  const fromBot = await worker.fetch(new Request('http://x/api/tg', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'right' }, body: JSON.stringify({ message: { message_id: 2, chat: { id: -100123, type: 'supergroup', title: 'Yard' }, from: { id: 9, is_bot: true }, text: 'Shunt NEW BUY' } }) }), { ...env, TELEGRAM_SECRET: 'right' });
  assert.equal(await fromBot.text(), 'ok');
});
test('Telegram: the webhook refuses a wrong secret', async () => {
  const r = await worker.fetch(new Request('http://x/api/tg', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'nope' }, body: '{"message":{"chat":{"id":1},"text":"/start"}}' }), { ...env, TELEGRAM_SECRET: 'right' });
  assert.equal(r.status, 403);
});test('Exit Door: a round trip loses only the swap fees; a failed sell gives nothing back; big sellers first leave less', async () => {
  const { exitDoor } = await import('../site/assets/door.js');
  const t = { price: 0.001, liq: 100000, fdv: 1000000, buyTax: 0, sellTax: 0, topShares: [10, 5, 5], group: { share: 8 } };
  const d = exitDoor(t, 100);
  assert.ok(d.now > 99 && d.now < 100);
  const top = d.firsts.find(f => f.key === 'top10'), grp = d.firsts.find(f => f.key === 'group');
  assert.ok(top.back < grp.back && grp.back < d.now);
  assert.equal(exitDoor({ ...t, noSell: true }, 100).now, 0);
  assert.equal(exitDoor({ ...t, liq: 0 }, 100), null);
});
test('Lookalikes and the money trail answer a bad address with 400', async () => {
  for (const p of ['looks?a=nope', 'hand?w=nope', 'hand/launches?w=nope']) { const [s] = await call(p); assert.equal(s, 400); }
});test('Agent Scan finds the functions a dispatcher compares against', async () => {
  // DUP1 PUSH4 a9059cbb EQ ..., PUSH4 40c10f19 DUP2 EQ ..., and a PUSH4 used as a mask that must not count
  const { dispatcher } = await import('../server/worker.js');
  const code = '0x' + '80' + '63a9059cbb' + '14' + '61' + '0100' + '57' + '63' + '40c10f19' + '81' + '14' + '61' + '0200' + '57' + '63ffffffff' + '16' + '7f' + '63deadbeef14'.padEnd(64, '0');
  assert.deepEqual(dispatcher(code).sort(), ['40c10f19', 'a9059cbb']);
  const [s] = await call('xray?a=nope'); assert.equal(s, 400);
});
test('the Pons selectors are the keccak-256 of their signatures', () => {
  const sel = s => keccak256([...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('')).slice(0, 8);
  assert.deepEqual(['realQuoteReserve()', 'graduationThreshold()', 'graduated()', 'symbol()', 'isNativeQuote()', 'pairToken()', 'curve()'].map(sel), ['4f1f58fd', '8b0bc501', 'e7c2b772', '95d89b41', 'dc08e094', '3de35b79', '7165485d']);
});

test('Exit Door prices a Pons curve as the curve answers: virtual reserves, 2.5% off each way', async () => {
  const { exitDoor } = await import('../site/assets/door.js');
  // $SHUNT's curve on 17 Oct 2026, ETH at $2,418.23: the curve's own buy() gave 34,534,023 tokens for 0.3 ETH
  const eth = 2418.23, pool = { quoteUsd: 3.628777732776932 * eth, tokens: 462965803.836757, realUsd: 1.948777 * eth, fee: 0.025 };
  const d = exitDoor({ price: pool.quoteUsd / pool.tokens, liq: pool.realUsd, fdv: 1e9 * pool.quoteUsd / pool.tokens, launch: { pool } }, 0.3 * eth);
  assert.ok(Math.abs(d.tokens / 34534023.56 - 1) < 0.001, `tokens ${d.tokens}`);
  // straight back out: the round trip costs the two fees, about 4.9%
  assert.ok(Math.abs(d.now / (0.3 * eth) - 0.975 * 0.975) < 0.002, `back ${d.now}`);
});

test('Telegram: /ledger asks for an address, and /help lists it', async () => {
  const tg = async text => { const r = await worker.fetch(new Request('http://x/api/tg', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'right' }, body: JSON.stringify({ message: { message_id: 1, chat: { id: 777, type: 'private' }, text } }) }), { ...env, TELEGRAM_SECRET: 'right' }); return (await r.json()).text; };
  assert.match(await tg('/ledger'), /Send \/ledger followed by a token address/);
  assert.match(await tg('/help'), /\/ledger/);
});

test('Verdict Lab counts what each rule caught and how those tokens did', async () => {
  const { labView } = await import('../server/worker.js');
  // 40 tokens: the 20 with a mint power all lost half within the hour, the 20 without held
  const rows = Array.from({ length: 40 }, (_, i) => ({ f: [5000, 100, 20, 0, 0, 0, 0], p0: 1, p1: i < 20 ? 0.3 : 1.1, p24: i < 20 ? 0 : 1.2, x: { h: i < 20 ? ['mint'] : [], m: [], o: -1, p: 0, n: 10 } }));
  const v = labView(rows), mint = v.rules.find(r => r.key === 'mint');
  assert.equal(v.base.h1.n, 40); assert.equal(v.base.h1.lostHalf, 20);
  assert.equal(mint.caught, 20); assert.equal(mint.caughtThen.h1.rate, 1); assert.equal(mint.othersThen.h1.rate, 0);
  assert.equal(mint.caughtThen.h24.lostHalf, 20);   // no price a day later counts as lost
  assert.equal(v.rules.find(r => r.key === 'honeypot').read, 0);   // no GoPlus read: not counted either way
});

test('Will it bond refuses a bad handle and an incomplete set of calls; /alarms in a DM explains itself', async () => {
  const [c1, o1] = await call('bondgame', { handle: 'x', picks: [] }); assert.equal(c1, 400); assert.match(o1.why, /handle|not set/);
  const tg = async text => { const r = await worker.fetch(new Request('http://x/api/tg', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'right' }, body: JSON.stringify({ message: { message_id: 1, chat: { id: 778, type: 'private' }, from: { id: 5 }, text } }) }), { ...env, TELEGRAM_SECRET: 'right' }); return (await r.json()).text; };
  assert.match(await tg('/alarms on'), /admin sends \/alarms on/);
  assert.match(await tg('/report'), /crew desk/i);   // with no address it is the daily report; with one, a token report
  assert.match(await tg('/spotters'), /No report has been priced|Top spotters/);
});

test('a $SHUNT holder link: /link gives a code, a signature from the wallet links it, a wrong one is refused', async () => {
  const { personalDigest, holderMessage, keccak256: k } = await import('../server/worker.js');
  const tg = async text => { const r = await worker.fetch(new Request('http://x/api/tg', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'right' }, body: JSON.stringify({ message: { message_id: 1, chat: { id: 4242, type: 'private' }, from: { id: 9 }, text } }) }), { ...env, TELEGRAM_SECRET: 'right' }); return (await r.json()).text; };
  const code = (await tg('/link')).match(/holder\/\?c=([0-9a-z]+x[0-9a-z]+x[0-9a-f]{12})/)[1];
  // a signer, worked out here the textbook way: r = (kG).x, s = k⁻¹(e + r·d)
  const P = 2n ** 256n - 2n ** 32n - 977n, N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n, G = [0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n, 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n];
  const m = (a, q = P) => ((a % q) + q) % q, pw = (b, e, q) => { let r = 1n; b = m(b, q); while (e) { if (e & 1n) r = r * b % q; b = b * b % q; e >>= 1n; } return r; }, inv = (a, q) => pw(a, q - 2n, q);
  const add = (a, b) => { if (!a) return b; if (!b) return a; if (a[0] === b[0] && a[1] !== b[1]) return null; const l = a[0] === b[0] ? m(3n * a[0] * a[0] * inv(2n * a[1], P)) : m((b[1] - a[1]) * inv(b[0] - a[0], P)); const x = m(l * l - a[0] - b[0]); return [x, m(l * (a[0] - x) - a[1])]; };
  const mul = (p, n) => { let r = null; while (n) { if (n & 1n) r = add(r, p); p = add(p, p); n >>= 1n; } return r; };
  const d = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn, Q = mul(G, d), addr = '0x' + k(Q[0].toString(16).padStart(64, '0') + Q[1].toString(16).padStart(64, '0')).slice(24);
  const sign = (digest, key) => { const e = BigInt('0x' + digest), kk = 0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567n, R = mul(G, kk), r = m(R[0], N), s = m(inv(kk, N) * (e + r * key), N); return '0x' + r.toString(16).padStart(64, '0') + s.toString(16).padStart(64, '0') + (27 + Number(R[1] & 1n)).toString(16); };
  const digest = personalDigest(holderMessage(code));
  const call = async (path, body) => { const r = await worker.fetch(new Request('http://x/api/' + path, { method: 'POST', body: JSON.stringify(body) }), { ...env, TELEGRAM_SECRET: 'right' }); return [r.status, await r.json()]; };   // the same secret seals and opens the code
  const [c0, bad] = await call('holder', { code, address: addr, sig: sign(digest, d + 1n) }); assert.equal(c0, 400); assert.match(bad.why, /not from that wallet/);
  const [c1, ok] = await call('holder', { code, address: addr, sig: sign(digest, d) }); assert.equal(c1, 200); assert.equal(ok.ok, true); assert.equal(ok.holder, false);   // a fresh key holds no $SHUNT
  const [c2] = await call('holder', { code, address: addr, sig: sign(digest, d) }); assert.equal(c2, 400);   // a code works once
});

test('every script the site serves parses', async () => {
  // a broken template string once took a whole page down (Bond Watch): every file under site/assets is checked
  const { readdirSync } = await import('node:fs'), { spawnSync } = await import('node:child_process');
  const bad = readdirSync('site/assets').filter(f => f.endsWith('.js')).filter(f => spawnSync(process.execPath, ['--check', 'site/assets/' + f]).status !== 0);
  assert.deepEqual(bad, []);
});

test('burn to boost takes only a burn from the wallet linked to the chat', async () => {
  const tg = async text => { const r = await worker.fetch(new Request('http://x/api/tg', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'right' }, body: JSON.stringify({ message: { message_id: 1, chat: { id: 5151, type: 'private' }, from: { id: 3 }, text } }) }), { ...env, TELEGRAM_SECRET: 'right' }); return (await r.json()).text; };
  // someone else's burn, from a chat with no linked wallet: refused before anything is read from the chain
  assert.match(await tg('/boost 0x5804beee8368132d32ad4b8818ce86eba9c4bd37 0x63f00e5caebb3d42e5311cd02c6af2cf5c73d8620f0f9ec7c4e88441f9cc1408'), /link the wallet you burn from first/);
});

test('the ledger route answers a bad address with 400 and a good one without a server error', async () => {
  const r1 = await worker.fetch(new Request('http://x/api/ledger?a=nope'), env); assert.equal(r1.status, 400);
  const r2 = await worker.fetch(new Request('http://x/api/ledger?a=0x0000000000000000000000000000000000000001'), env); assert.notEqual(r2.status, 500);
});

test('Rug Run: a run needs a known record, the server scores it once, and the sim answers a non-Pons address plainly', async () => {
  const [c0, v0] = await call('rugrun'); assert.equal(c0, 200); assert.equal(v0.ok, false);   // an empty log has no results to play
  const [c1, v1] = await call('rugrun', { id: 'nope', handle: 'tester', calls: [] }); assert.equal(c1, 400); assert.match(v1.why, /ended/);
  const r = await worker.fetch(new Request('http://x/api/sim?a=nope'), env); assert.equal(r.status, 400);
});
test('one watchlist: a code is made on the first edit, tokens are added, read back and removed', async () => {
  const T = '0x7e517e779b85895894becad80c9bb69b4cb1c4d6';
  const [s0, a] = await call('watch', { add: { a: T, sym: 'SHUNT' } }); assert.equal(s0, 200); assert.match(a.code, /^wl-[a-z0-9]{6}$/); assert.equal(a.tokens.length, 1);
  const [s1, b] = await call('watch?c=' + a.code); assert.equal(s1, 200); assert.equal(b.tokens[0].a, T);
  const [s2, c] = await call('watch', { c: a.code, remove: T }); assert.equal(s2, 200); assert.equal(c.tokens.length, 0);
  const [s3] = await call('watch?c=wl-zzzzzz'); assert.equal(s3, 404);
  const [s4, d] = await call('watch', { c: a.code, add: { a: 'nope' } }); assert.equal(s4, 400); assert.equal(d.ok, false);
});
test('games, part two: every board answers, and a bad pick is refused with a reason', async () => {
  for (const g of ['race', 'bingo', 'fantasy', 'snipe', 'season']) { const [s, v] = await call(g + '?me=tester'); assert.equal(s, 200, g); assert.ok('ok' in v, g); }
  const [s1, b] = await call('bingo', { handle: 'tester', picks: ['nope'] }); assert.ok(s1 === 400 && b.ok === false && b.why);
  const [s2, c] = await call('snipe', { handle: 'x', token: '0x7e517e779b85895894becad80c9bb69b4cb1c4d6' }); assert.ok(s2 === 400 && /handle/.test(c.why));
  const [s3, d] = await call('fantasy', { handle: 'tester', wallets: ['0x12'] }); assert.ok(s3 === 400 && /five/.test(d.why));
  const [, sv] = await call('season'); assert.ok(sv.games.length === 6 && sv.tournament.name);
});
test('Bond Hunters answers with an empty board and refuses a bad wallet', async () => {
  const [s, v] = await call('hunters'); assert.equal(s, 200); assert.equal(v.ok, true); assert.ok(Array.isArray(v.hunters)); assert.ok(Array.isArray(v.inNow));
  const [bs] = await call('hunters?w=0x12'); assert.equal(bs, 400);
  const [, one] = await call('hunters?w=0x' + '1'.repeat(40)); assert.equal(one.found, false);
});
test('Shadow Desk answers with its rules and no trade', async () => {
  const [s, v] = await call('shadow'); assert.equal(s, 200); assert.equal(v.ok, true); assert.equal(v.size, 0.1); assert.ok(Array.isArray(v.open)); assert.match(v.rules, /Paper only/);
});
test('Profit Map refuses a bad address', async () => {
  const [s, v] = await call('profit?a=0x12'); assert.equal(s, 400); assert.equal(v.ok, false);
});
test('Wallet Wrapped refuses a bad wallet', async () => {
  const [s, v] = await call('wrapped?w=0x12'); assert.equal(s, 400); assert.equal(v.ok, false);
});
test('Fresh Wallets refuses a bad address', async () => {
  const [s, v] = await call('fresh?a=0x12'); assert.equal(s, 400); assert.equal(v.ok, false);
});
