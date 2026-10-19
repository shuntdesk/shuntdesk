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
