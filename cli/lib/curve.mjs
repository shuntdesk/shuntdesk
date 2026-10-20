// The Pons curve worked the way the curve works it, the same sums as shuntdesk.com/sim: a constant product over the
// virtual reserves, the fee taken off the ETH going in and coming out, never more out than the curve has raised.
// c is the /api/v1/sim answer: quoteEth and tokens are the virtual reserves, realEth what it has raised, need the bond mark.

// one buy of E ETH, then others put in X ETH, then everything is sold back
export function simulate(c, E, X = 0) {
  const f = c.fee, Q = c.quoteEth, T = c.tokens, inn = E * (1 - f), tok = T * inn / (Q + inn), Q1 = Q + inn, T1 = T - tok;
  const inX = X * (1 - f), Q2 = Q1 + inX, T2 = Q1 * T1 / Q2, real = c.realEth + inn + inX;
  const gross = Math.min(Q2 * tok / (T2 + tok), real), back = gross * (1 - f);
  return { tok, avg: E / tok, impact: (Q1 / T1) / (Q / T) - 1, after: Math.min(100, (c.realEth + inn) / c.need * 100), afterX: Math.min(100, real / c.need * 100), back, bonds: c.realEth + inn >= c.need };
}

// the least ETH others must put in after a buy of E for a straight sell to give back E; null when the curve would bond first
// (past the bond mark the curve stops and the token moves to a pool, which this does not model)
export function breakEven(c, E) {
  const f = c.fee, room = (c.need - c.realEth - E * (1 - f)) / (1 - f);
  if (simulate(c, E).back >= E) return 0;
  if (!(room > 0) || simulate(c, E, room).back < E) return null;
  let lo = 0, hi = room;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (simulate(c, E, mid).back >= E) hi = mid; else lo = mid; }
  return hi;
}

// Exit Door on a Pons curve: a buy of E ETH, then others sell `first` tokens into the curve, then the buy is sold.
// The same curve sums: the fee off the ETH out, never more ETH out than the curve still holds.
export function curveExit(c, E, first = 0) {
  const f = c.fee, inn = E * (1 - f);
  let Q = c.quoteEth + inn, T = c.tokens - c.tokens * inn / (c.quoteEth + inn), real = c.realEth + inn;
  const mine = c.tokens - T;
  const sell = t => { const gross = Math.min(Q - Q * T / (T + t), real); Q -= gross; T += t; real -= gross; return gross * (1 - f); };
  const theirs = first > 0 ? sell(first) : 0, back = sell(mine);
  return { tokens: mine, theirs, back, left: real };
}

// Exit Door on a pool, as the site works it: one constant-product pool holding its quoted liquidity, half on each side,
// a 0.3% swap fee. A concentrated pool can be deeper near the price and thinner away from it: an estimate of size, not a quote.
export function poolExit({ price, liquidity, sellTax = 0, buyTax = 0 }, usd, first = 0) {
  const FEE = 0.003, q0 = liquidity / 2, t0 = q0 / price;
  const qIn = usd * (1 - buyTax) * (1 - FEE), q1 = q0 + qIn, t1 = q0 * t0 / q1, got = t0 - t1;
  let q = q1, k = t1;
  const sell = tok => { const kk = k + tok * (1 - FEE), qq = q * k / kk, out = q - qq; q = qq; k = kk; return out; };
  const theirs = first > 0 ? sell(first * (1 - sellTax)) : 0, back = sell(got * (1 - sellTax));
  return { tokens: got, theirs, back, left: q * 2 };
}
