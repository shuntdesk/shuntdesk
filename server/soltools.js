// The Robinhood Chain tools, for Solana: largest holders, Shared Bags, Dev Ledger, Wallet X-ray and the Pump.fun
// curve for the simulator. Each answers in the shape the Robinhood Chain version already has, so the pages draw both.
import { rpc, getJ, pumpCurve, solPrice, cache, SYSTEM, INCIN, PUMP_NEED } from './solana.js';

const RAY_AUTH = new Set(['5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL', 'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh']);   // Raydium AMM, CPMM and LaunchLab authorities
const keep = (m, k, v, n = 200) => { m.set(k, { t: Date.now(), v }); if (m.size > n) m.delete(m.keys().next().value); return v; };
const fresh = (m, k, ms) => { const h = m.get(k); return h && Date.now() - h.t < ms ? h.v : null; };

// the largest holders of a mint, each token account resolved to its owner and the owner to a wallet or a program
async function owners(env, mint) {
  // the node's largest accounts; for the very largest tokens it gives up, and GoPlus's holder list stands in
  const [acct, big] = await Promise.all([rpc(env, 'getAccountInfo', [mint, { encoding: 'jsonParsed' }]), rpc(env, 'getTokenLargestAccounts', [mint]).catch(() => null)]);
  const mi = acct?.value?.data?.parsed?.info; if (!mi) throw new Error('not a token mint on Solana');
  const supply = BigInt(mi.supply || '0'), list = big?.value || []; let rows;
  if (list.length) {
    const accts = (await rpc(env, 'getMultipleAccounts', [list.map(x => x.address), { encoding: 'jsonParsed' }]))?.value || [];
    rows = list.map((x, i) => ({ owner: accts[i]?.data?.parsed?.info?.owner || null, amount: BigInt(x.amount) })).filter(r => r.owner);
  } else {
    const gp = (await getJ('https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=' + mint).catch(() => null))?.result?.[mint];
    if (!gp?.holders?.length) throw new Error('the node could not list the holders right now');
    rows = gp.holders.slice(0, 20).map(h => ({ owner: h.account, amount: BigInt(Math.round(Number(h.percent) * 1e9)) * supply / 1000000000n }));
  }
  const uniq = [...new Set(rows.map(r => r.owner))], kinds = (await rpc(env, 'getMultipleAccounts', [uniq, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]))?.value || [];
  const wallet = new Map(uniq.map((o, i) => [o, kinds[i]?.owner === SYSTEM && o !== INCIN]));
  const by = new Map(); for (const r of rows) { const w = by.get(r.owner) || { wallet: r.owner, amount: 0n, isWallet: wallet.get(r.owner) }; w.amount += r.amount; by.set(r.owner, w); }
  const d = mi.decimals;
  return { supply, decimals: d, list: [...by.values()].map(w => ({ ...w, share: supply > 0n ? Number(w.amount * 10000000n / supply) / 100000 : null, tokens: Number(w.amount / 10n ** BigInt(Math.max(0, d - 4))) / 10 ** Math.min(4, d) })).sort((a, b) => (b.share || 0) - (a.share || 0)) };
}
const holdHit = new Map();
export async function solHolders(env, mint) {
  const c = fresh(holdHit, mint, 15 * 60000); if (c) return c;
  let o; try { o = await owners(env, mint); } catch (e) { return { ok: false, why: e.message }; }
  const wallets = o.list.filter(w => w.isWallet), sum = n => wallets.slice(0, n).reduce((s, w) => s + (w.share || 0), 0);
  return keep(holdHit, mint, { ok: true, token: mint, chain: 'solana', read: o.list.length, unread: 0, wallets: wallets.map(({ wallet, share, tokens }) => ({ wallet, share, tokens })), top1: sum(1), top3: sum(3), top10: sum(10),
    note: 'The largest 20 token accounts from the Solana node, resolved to their owners, wallets only: pools, the curve and other programs left out. Shares of the whole supply.' });
}
const bagHit = new Map();
export async function solShared(env, a, b) {
  const key = [a, b].sort().join(':'), c = fresh(bagHit, key, 30 * 60000); if (c) return c;
  let A, B; try { [A, B] = await Promise.all([owners(env, a), owners(env, b)]); } catch (e) { return { ok: false, why: e.message }; }
  const ma = new Map(A.list.filter(w => w.isWallet).map(w => [w.wallet, w.share]));
  const wallets = B.list.filter(w => w.isWallet && ma.has(w.wallet)).map(w => ({ wallet: w.wallet, shareA: ma.get(w.wallet), shareB: w.share })).sort((p, q) => Math.min(q.shareA, q.shareB) - Math.min(p.shareA, p.shareB));
  return keep(bagHit, key, { ok: true, a, b, chain: 'solana', readA: A.list.length, readB: B.list.length, shared: wallets.length, unread: 0, past40: 0, wallets, heldA: wallets.reduce((s, w) => s + (w.shareA || 0), 0), heldB: wallets.reduce((s, w) => s + (w.shareB || 0), 0),
    note: 'The largest 20 holders of each token from the Solana node (that is as many as it lists); wallets that hold both, pools, curves and programs left out. Holding both is a link, not proof of a group. Not advice.' });
}

// Dev Ledger on Solana: the creator's own transactions, parsed by Helius, and every move of this token in them
async function parsed(env, w, pages = 2) {
  const out = []; let before = '';
  for (let i = 0; i < pages; i++) {
    const j = await getJ(`https://api.helius.xyz/v0/addresses/${w}/transactions?api-key=${env.HELIUS_API_KEY}&limit=100${before ? '&before=' + before : ''}`);
    if (!Array.isArray(j) || !j.length) break; out.push(...j); before = j[j.length - 1].signature; if (j.length < 100) break;
  }
  return out;
}
const ledHit = new Map();
export async function solLedger(env, mint, scan) {
  const c = fresh(ledHit, mint, 10 * 60000); if (c) return c;
  const dev = scan?.creator; if (!dev) return { ok: false, why: 'the creator could not be found' };
  const pools = new Set([scan.pool, ...RAY_AUTH].filter(Boolean));
  let txs; try { txs = await parsed(env, dev); } catch (e) { return { ok: false, why: 'the parsed history did not answer' }; }
  const L = { bought: 0, received: 0, burned: 0, sold: 0, toContracts: 0, toWallets: 0 }, moves = [], side = new Map();
  for (const t of [...txs].reverse()) {
    const swap = /SWAP|BUY|SELL|CREATE/.test(t.type || '') || /PUMP|RAYDIUM|JUPITER|METEORA|ORCA/.test(t.source || '');
    for (const x of (t.tokenTransfers || []).filter(x => x.mint === mint)) {
      const v = Number(x.tokenAmount) || 0, from = x.fromUserAccount, to = x.toUserAccount, at = new Date(t.timestamp * 1000).toISOString();
      let kind = null;
      if (to === dev && from !== dev) kind = pools.has(from) || swap ? 'bought' : 'received';
      else if (from === dev && to !== dev) kind = to === INCIN || t.type === 'BURN' ? 'burned' : pools.has(to) || swap ? 'sold' : 'toWallets';
      else if (t.feePayer === dev && from !== dev && to && to !== dev) { side.set(to, (side.get(to) || 0) + v); continue; }   // the creator paid, another wallet got the tokens
      if (!kind) continue;
      L[kind] += v; moves.push({ kind, amount: v, to: kind === 'bought' || kind === 'received' ? from : to, at, tx: t.signature });
    }
  }
  let holdsNow = null;
  try { holdsNow = ((await rpc(env, 'getTokenAccountsByOwner', [dev, { mint }, { encoding: 'jsonParsed' }]))?.value || []).reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0); } catch (e) {}
  const v = { ok: true, chain: 'solana', token: mint, dev, devFound: 'deployer record', curve: scan.launch?.pad === 'pumpfun' ? scan.pool : null, ledger: L, holdsNow, moves: moves.slice(-40).reverse(), partial: txs.length >= 200,
    sideBuys: [...side].map(([wallet, amount]) => ({ wallet, amount })).sort((a, b) => b.amount - a.amount).slice(0, 10),
    note: 'Every move of this token in the creator wallet\'s own transactions (the latest 200), parsed by Helius: buys and sells through Pump.fun or a pool, transfers to other wallets, burns, and tokens the creator paid for that landed in another wallet. Read only. Not advice.' };
  return keep(ledHit, mint, v);
}

// Wallet X-ray on Solana: every fungible token with a balance, priced, and copies of well-known tokens marked
const KNOWN = { USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', SOL: 'So11111111111111111111111111111111111111112', WSOL: 'So11111111111111111111111111111111111111112', RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', PYTH: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', JTO: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2KRzh8', POPCAT: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr' };
const walHit = new Map();
export async function solWallet(env, w) {
  const c = fresh(walHit, w, 5 * 60000); if (c) return c;
  let r; try { r = await rpc(env, 'getAssetsByOwner', { ownerAddress: w, page: 1, limit: 200, displayOptions: { showFungible: true, showNativeBalance: true, showZeroBalance: false } }); } catch (e) { return { ok: false, why: e.message }; }
  const items = (r?.items || []).filter(i => /Fungible/.test(i.interface) && Number(i.token_info?.balance) > 0);
  const tokens = items.map(i => { const ti = i.token_info, sym = ti.symbol || i.content?.metadata?.symbol || '', up = sym.toUpperCase().replace(/^\$/, '');
    return { token: i.id, symbol: sym || null, name: i.content?.metadata?.name || null, balance: String(ti.balance), decimals: ti.decimals, priceDas: ti.price_info?.price_per_token ?? null, impostor: KNOWN[up] && KNOWN[up] !== i.id ? up : null }; });
  // DexScreener for price and pool depth, thirty at a time; the node's own price where it has none
  const px = {};
  for (let i = 0; i < Math.min(tokens.length, 90); i += 30) try { for (const p of await getJ('https://api.dexscreener.com/tokens/v1/solana/' + tokens.slice(i, i + 30).map(t => t.token).join(','))) { const a = p.baseToken?.address; if (a && (!px[a] || (p.liquidity?.usd || 0) > px[a].liq)) px[a] = { price: Number(p.priceUsd) || null, liq: p.liquidity?.usd || 0 }; } } catch (e) {}
  const nb = r?.nativeBalance;
  const v = { ok: true, chain: 'solana', wallet: w, sol: nb ? { amount: nb.lamports / 1e9, usd: nb.total_price ?? null } : null,
    tokens: tokens.map(t => { const p = px[t.token], s = cache.get(t.token); return { ...t, price: p?.price ?? t.priceDas, liq: p?.liq ?? null, verdict: s ? { verdict: s.verdict, score: s.score } : null }; }),
    note: 'Every token with a balance in this wallet, from the Solana node (Helius). Prices and pool depth from DexScreener, the node\'s own price where DexScreener has none. A copy is a token named like a well-known one at another address. Read only. Not advice.' };
  return keep(walHit, w, v);
}

// the Pump.fun curve for the simulator, in the shape of the Pons one (the ETH fields carry SOL, unit says so)
export async function solSim(env, mint) {
  const c = await pumpCurve(env, mint).catch(() => null); if (!c) return { ok: false, why: 'not a Pump.fun token, or its curve did not answer' };
  if (c.complete) return { ok: false, why: 'this token has graduated: it trades in a pool now, not on its curve' };
  const usd = await solPrice(env); if (!usd) return { ok: false, why: 'the SOL price did not answer' };
  // the simulator works in SOL raised (of 85); Pump.fun's own figure counts tokens sold, so both are given
  return { ok: true, chain: 'solana', unit: 'SOL', token: mint, curve: c.curve, progress: Math.min(100, c.realSol / PUMP_NEED * 100), tokenProgress: c.progress, raised: c.realSol, need: PUMP_NEED, quoteEth: c.vSol, tokens: c.vTok, realEth: c.realSol, fee: c.fee, ethUsd: usd,
    note: 'Read from the Pump.fun curve account now. Progress here is SOL raised of the 85 that graduate it; Pump.fun shows progress by tokens sold, which runs ahead. A constant product over its virtual reserves, the fee (protocol and creator, from Pump.fun\'s global account) taken off the SOL going in and out, never more out than the curve has raised. Other trades move it before yours lands. Not advice.' };
}
