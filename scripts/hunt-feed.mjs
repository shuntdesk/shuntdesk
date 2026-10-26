// The outside reader for Bond Hunters, run by a scheduled GitHub Action: asks shuntdesk.com which Pons tokens it still
// needs, reads each one's first half hour of transfers from the public Robinhood Chain node, and sends them back.
// Cloudflare's shared addresses keep hitting the node's limits; a GitHub runner does not. node scripts/hunt-feed.mjs
const SITE = process.env.SITE || 'https://shuntdesk.com', KEY = process.env.HUNT_KEY, RPC = 'https://rpc.mainnet.chain.robinhood.com';
const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', WIN = 18000;
if (!KEY) { console.log('HUNT_KEY is not set: nothing to do'); process.exit(0); }
const sleep = ms => new Promise(r => setTimeout(r, ms)), hex = n => '0x' + n.toString(16), addr = w => '0x' + String(w).slice(-40).toLowerCase();
async function rpc(method, params) {
  for (let k = 0; k < 4; k++) {
    try { const j = await (await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) })).json(); if (j.result !== undefined) return j.result; } catch (e) {}
    await sleep(1500 * (k + 1));
  }
  return null;
}
const sym = async t => { const h = await rpc('eth_call', [{ to: t, data: '0x95d89b41' }, 'latest']); try { const x = h.slice(2), n = parseInt(x.slice(64, 128), 16); return Buffer.from(x.slice(128, 128 + n * 2), 'hex').toString().replace(/[^\x20-\x7e]/g, '').slice(0, 16); } catch (e) { return null; } };
const todo = await (await fetch(SITE + '/api/_hunt/todo', { headers: { 'x-feed': KEY } })).json();
if (!todo.ok) { console.log('todo:', JSON.stringify(todo)); process.exit(1); }
const head = parseInt(await rpc('eth_blockNumber', []), 16), rows = [];
for (const r of todo.rows) {
  // a bond that left the board has no launch block on file: its mint log is its launch, and the mint goes to the curve
  if (!r.b || !r.c) { const m = await rpc('eth_getLogs', [{ address: r.t0, topics: [T, '0x' + '0'.repeat(64)], fromBlock: hex(Math.max(0, head - 9000000)), toBlock: hex(head) }]); if (!m?.[0]) continue; r.b = parseInt(m[0].blockNumber, 16); r.c = addr(m[0].topics[2]); r.s = r.s || await sym(r.t0); }
  const logs = await rpc('eth_getLogs', [{ address: r.t0, topics: [T], fromBlock: hex(r.b), toBlock: hex(Math.min(head, r.b + WIN)) }]);
  if (logs) rows.push({ t0: r.t0, c: r.c, b: r.b, s: r.s, at: r.at, logs: logs.map(l => [l.transactionHash, addr(l.topics[1]), addr(l.topics[2])]) });
  await sleep(300);
}
const res = await (await fetch(SITE + '/api/_hunt/feed', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-feed': KEY }, body: JSON.stringify({ rows }) })).json();
console.log(`asked ${todo.rows.length}, read ${rows.length}, applied ${res.applied}`);
