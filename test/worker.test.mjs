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