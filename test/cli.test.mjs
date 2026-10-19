import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { simulate, breakEven } from '../cli/lib/curve.mjs';

// a curve as /api/v1/sim answered for $SHUNT on 19 Oct
const c = { progress: 36.7525, raised: 1.543608, need: 4.2, quoteEth: 3.223608, tokens: 521155087.661935, realEth: 1.543608, fee: 0.025, ethUsd: 2420.67 };

test('the CLI works the curve with the same sums as the site', () => {
  const src = readFileSync(new URL('../site/assets/sim.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function run('), src.indexOf('let job'));
  const run = new Function(body + '; return run;')();
  for (const [E, X] of [[0.05, 0], [0.05, 0.5], [1, 2], [0.3, 10]]) assert.deepEqual(simulate(c, E, X), run(c, E, X));
});
test('break even: the inflow found gives the size back, and less gives less', () => {
  const be = breakEven(c, 0.05); assert.ok(be > 0.05 && be < 0.1);
  assert.ok(Math.abs(simulate(c, 0.05, be).back - 0.05) < 1e-9);
  assert.ok(simulate(c, 0.05, be * 0.99).back < 0.05);
  assert.equal(breakEven({ ...c, realEth: 4.19 }, 1), null);   // the curve would bond before the trade paid
});
test('the CLI prints help and refuses a bad address without calling out', () => {
  const bin = new URL('../cli/bin/shuntdesk.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  assert.match(execFileSync(process.execPath, [bin, 'help'], { encoding: 'utf8' }), /shuntdesk sim <token>/);
  assert.throws(() => execFileSync(process.execPath, [bin, 'scan', '0x12'], { encoding: 'utf8', stdio: 'pipe' }), /0x followed by 40 hex/);
});
