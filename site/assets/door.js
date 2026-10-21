// Exit Door: what a buy of a given size gets back on the way out, through the pool's own depth, and what is left
// of it if the wallets that hold the most sell first. Shared by the Exit Door page and the ticket.
//
// The pool is treated as one constant-product pool holding its quoted liquidity, half on each side, with a 0.3%
// swap fee. Concentrated pools (Uniswap v3 and v4) can be deeper near the price and thinner away from it, so
// the figures are an estimate of size, not a quote. Holder shares are shares of the whole supply, worked out from
// the fully diluted value; a wallet's tokens sold into the pool move it as any seller's would.
const FEE = 0.003;

export function exitDoor(t, usd) {
  if (!t || !(t.price > 0) || !(t.liq > 0) || !(usd > 0)) return null;
  const supply = t.fdv > 0 ? t.fdv / t.price : null;
  const buyTax = Math.min(0.99, (t.buyTax || 0) / 100), sellTax = Math.min(0.99, (t.sellTax || 0) / 100);
  // a token still on its Pons curve trades against the curve: a constant product over the curve's virtual reserves,
  // the fee and the creator's tax (2.5% together on Pons today) taken off the ETH going in and the ETH coming out,
  // and never more ETH out than the curve has really raised. Checked against the curve's own buy and sell answers.
  const cp = t.launch?.pool && !t.launch.graduated ? t.launch.pool : null;
  const q0 = cp ? cp.quoteUsd : t.liq / 2, t0 = cp ? cp.tokens : q0 / t.price, cap = cp ? cp.realUsd : Infinity;
  const swap = cp
    ? (q, k, tokIn) => { const t1 = k + tokIn, q1 = q * k / t1, gross = Math.min(q - q1, cap - (q0 - q)); return { out: Math.max(0, gross) * (1 - cp.fee), q: q - Math.max(0, gross), t: t1 }; }
    : (q, k, tokIn) => { const t1 = k + tokIn * (1 - FEE), q1 = q * k / t1; return { out: q - q1, q: q1, t: t1 }; };
  // the buy: dollars in, tokens out
  const qIn = usd * (1 - buyTax) * (1 - (cp ? cp.fee : FEE)), q1 = q0 + qIn, t1 = q0 * t0 / q1, got = t0 - t1;
  const sellable = got * (1 - sellTax);
  const run = (share) => {
    let q = q1, k = t1, theirs = 0;
    if (share > 0 && supply) { const s = swap(q, k, share / 100 * supply * (1 - sellTax)); q = s.q; k = s.t; theirs = s.out; }
    const me = swap(q, k, sellable);
    return { back: t.noSell ? 0 : me.out, theirs, poolLeft: Math.max(0, cp ? cap - (q0 - me.q) : me.q * 2) };
  };
  const sum = a => (a || []).reduce((s, v) => s + (Number(v) || 0), 0);
  const L = t.launch || {};
  const firsts = [
    ['nobody', 'Nobody sells before you', 0],
    ['dev', 'The developer sells first', t.devShare || L.dev || 0],
    ['group', 'The largest funded group sells first', t.group?.share || 0],
    ['launch', 'Snipers and bundles from the launch sell first', (L.sn || 0) + (L.bu || 0)],
    ['top1', 'The largest wallet sells first', t.topShares?.[0] || 0],
    ['top3', 'The three largest wallets sell first', sum((t.topShares || []).slice(0, 3))],
    ['top10', 'The ten largest wallets sell first', sum(t.topShares) || t.top10 || 0],
  ].filter(([k, , s], i) => i === 0 || s >= 0.1).map(([key, label, share]) => ({ key, label, share, ...run(share) }));
  return {
    usd, tokens: got, paidAvg: got > 0 ? usd / got : 0, buyImpact: got > 0 ? usd / (got * t.price) - 1 : 0,
    buyTax: buyTax * 100, sellTax: sellTax * 100, noSell: !!t.noSell, supplyKnown: !!supply,
    firsts, now: firsts[0].back, worst: Math.min(...firsts.map(f => f.back))
  };
}
