// How a paper trade is filled, marked and closed. One set of rules, used by your desk in the browser
// and by the crew desk on the server. Prices are real; only the money is not.

export const FEE = 0.001;          // 0.1% of position size, charged on the way in and on the way out
export const BORROW_HR = 0.0002;   // 0.02% an hour on the borrowed part (size minus collateral)
export const LIQ = 0.9;            // liquidated once 90% of the collateral is gone
export const MAX_IMPACT = 0.08;    // an order that would move the pool more than 8% is refused

// constant-product pool: an order of `size` against one side of the pool (half its liquidity)
export const impact = (size, liq) => liq > 0 ? 2 * size / liq : 0;
// buying pushes the price up, selling pushes it down. opening a long and closing a short are buys.
export const fill = (price, size, liq, buy) => price * (buy ? 1 + Math.min(impact(size, liq), 0.5) : 1 - Math.min(impact(size, liq), 0.5));

// what a position is worth if it were closed now at `mark`
export function value(p, mark, liq, now = Date.now()) {
  const size = p.size ?? p.col * p.lev, long = p.side === 'long';
  const exit = fill(mark, size, liq, !long);
  const gross = size * (exit / p.entry - 1) * (long ? 1 : -1);
  const closeFee = size * FEE, borrow = (size - p.col) * BORROW_HR * Math.max(0, now - p.t) / 3600000;
  const left = p.col + gross - closeFee - borrow;
  return { exit, gross, closeFee, borrow, back: Math.max(0, left), health: left / p.col, net: Math.max(0, left) - p.col - (p.fee0 || 0) };
}
// the mark price at which the position is liquidated (borrow cost and exit impact move it a little closer)
export const liqPrice = (entry, lev, side) => entry * (side === 'long' ? 1 - (LIQ - FEE * lev) / lev : 1 + (LIQ - FEE * lev) / lev);
