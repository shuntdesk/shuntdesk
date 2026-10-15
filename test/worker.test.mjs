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
test('MCP: initialize, list the five tools, refuse a bad address', async () => {
  const rpc = async b => { const r = await worker.fetch(new Request('http://x/mcp', { method: 'POST', body: JSON.stringify(b) }), env); return r.status === 202 ? null : r.json(); };
  const i = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }); assert.equal(i.result.serverInfo.name, 'shuntdesk');
  assert.equal(await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const l = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); assert.equal(l.result.tools.length, 5);
  const c = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'token', arguments: { address: 'x' } } }); assert.equal(c.result.isError, true);
});
test('Telegram: the webhook refuses a wrong secret', async () => {
  const r = await worker.fetch(new Request('http://x/api/tg', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'nope' }, body: '{"message":{"chat":{"id":1},"text":"/start"}}' }), { ...env, TELEGRAM_SECRET: 'right' });
  assert.equal(r.status, 403);
});