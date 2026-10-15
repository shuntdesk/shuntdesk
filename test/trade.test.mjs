// the paper-trading arithmetic every desk uses (site/assets/trade.js), with no network
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEE, LIQ, MAX_IMPACT, impact, fill, liqPrice } from '../site/assets/trade.js';

test('constants match the published rules', () => {
  assert.equal(FEE, 0.001); assert.equal(LIQ, 0.9); assert.equal(MAX_IMPACT, 0.08);
});
test('price impact is twice the size over the pool depth', () => {
  assert.equal(impact(1000, 100000), 0.02); assert.equal(impact(1000, 0), 0);
});
test('a buy fills above the quote and a sell below it', () => {
  const buy = fill(1, 1000, 100000, true), sell = fill(1, 1000, 100000, false);
  assert.ok(Math.abs(buy - 1.02) < 1e-12); assert.ok(Math.abs(sell - 0.98) < 1e-12);
});
test('impact is capped at 50% of the price', () => {
  assert.equal(fill(1, 1e9, 1, true), 1.5); assert.equal(fill(1, 1e9, 1, false), 0.5);
});
test('liquidation sits where 90% of the collateral is gone, fees included', () => {
  const l = liqPrice(100, 10, 'long'), s = liqPrice(100, 10, 'short');
  assert.ok(l < 100 && l > 90); assert.ok(s > 100 && s < 110);
  assert.ok(Math.abs((100 - l) - (100 - s) * -1) < 1e-9);
});