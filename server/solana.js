// Solana tokens through the same seven stops as a Robinhood Chain token, read on the server: the chain through
// Helius, the pool from DexScreener, the mint's powers from the mint account itself, a second reading from GoPlus,
// launch facts from Codex, and for Pump.fun tokens the bonding curve account. The result has the shape the ticket
// page already draws.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const isSol = a => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(a || ''));
const SYSTEM = '11111111111111111111111111111111', TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', PUMP_REAL0 = 793100000000000n;   // Pump.fun's program and the tokens its curve starts with for sale
const INCIN = '1nc1nerator11111111111111111111111111111111';
const short = a => a.slice(0, 4) + '…' + a.slice(-4);
const compact = n => { n = Number(n) || 0; return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(0); };
const sig = n => { n = Number(n) || 0; if (n === 0) return '0'; if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 }); return n.toPrecision(3); };
const fmtAge = min => min < 1 ? 'under a minute' : min < 60 ? Math.round(min) + ' min' : min < 1440 ? (min / 60).toFixed(1) + ' h' : Math.round(min / 1440) + ' days';

function b58decode(s) {
  let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
  const out = []; while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c !== '1') break; out.unshift(0); }
  return Uint8Array.from(out);
}
function b58encode(b) {
  let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const x of b) { if (x) break; s = '1' + s; }
  return s;
}
// a program address must not be a point on ed25519: y from the 32 bytes, then whether (y²-1)/(dy²+1) has a square root
const P = 2n ** 255n - 19n, D = (P - 121665n) * modpow(121666n, P - 2n) % P;
function modpow(b, e) { let r = 1n; b %= P; while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; }
function onCurve(k) {
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? k[i] & 0x7f : k[i]);
  if (y >= P) return false;
  const y2 = y * y % P, u = (y2 - 1n + P) % P, v = (D * y2 + 1n) % P, x2 = u * modpow(v, P - 2n) % P;
  return x2 === 0n || modpow(x2, (P - 1n) / 2n) === 1n;
}
async function pda(seeds, program) {
  const prog = b58decode(program), tail = new TextEncoder().encode('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, Uint8Array.of(bump), prog, tail], len = parts.reduce((s, p) => s + p.length, 0), buf = new Uint8Array(len); let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    if (!onCurve(h)) return b58encode(h);
  }
  return null;
}

async function rpc(env, method, params, tries = 3) {
  if (!env.HELIUS_API_KEY) throw new Error('no Solana node set up');
  const r = await fetch('https://mainnet.helius-rpc.com/?api-key=' + env.HELIUS_API_KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(9000) });
  if (r.status === 429 && tries > 1) { await new Promise(x => setTimeout(x, 450 * (4 - tries))); return rpc(env, method, params, tries - 1); }   // the free plan allows ten calls a second
  const j = await r.json(); if (j.error) throw new Error(j.error.message || 'node error'); return j.result;
}
const getJ = async (url, opt = {}) => { const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
async function pool3(items, fn) { const out = []; let i = 0; await Promise.all([0, 1, 2, 3].map(async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; } } })); return out; }

// the Pump.fun curve for a mint: how far to graduation, whether it graduated, and the wallet that made it
async function pumpCurve(env, mint) {
  const at = await pda([new TextEncoder().encode('bonding-curve'), b58decode(mint)], PUMP); if (!at) return null;
  const v = (await rpc(env, 'getAccountInfo', [at, { encoding: 'base64' }]))?.value; if (!v || v.owner !== PUMP) return null;
  const b = Uint8Array.from(atob(v.data[0]), c => c.charCodeAt(0)), dv = new DataView(b.buffer); if (b.length < 49) return null;
  const u = o => dv.getBigUint64(o, true), realTok = u(24), realSol = u(32), complete = b[48] === 1;
  const creator = b.length >= 81 ? b58encode(b.subarray(49, 81)) : null;
  const progress = complete ? 100 : Math.max(0, Math.min(100, Number((PUMP_REAL0 - realTok) * 10000n / PUMP_REAL0) / 100));
  return { curve: at, complete, progress, realSol: Number(realSol) / 1e9, creator: creator && creator !== SYSTEM ? creator : null };
}

// GeckoTerminal's pools for a mint, in DexScreener's shape
async function geckoPairs(mint) {
  try {
    const j = await getJ(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools?page=1`, { headers: { Accept: 'application/json' } });
    return (j.data || []).map(p => { const a = p.attributes || {}, tx = a.transactions?.h24 || {};
      return { chainId: 'solana', dexId: String(p.relationships?.dex?.data?.id || '').replace('pump-fun', 'pumpfun').replace(/-.*/, ''), pairAddress: a.address, baseToken: { symbol: String(a.name || '').split(' / ')[0] || null },
        priceUsd: Number(a.base_token_price_usd) || null, liquidity: { usd: Number(a.reserve_in_usd) || null }, fdv: Number(a.fdv_usd) || null, pairCreatedAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
        volume: { h24: Number(a.volume_usd?.h24) || 0 }, txns: { h24: { buys: tx.buys || 0, sells: tx.sells || 0 } }, url: `https://www.geckoterminal.com/solana/pools/${a.address}` }; });
  } catch (e) { return null; }
}

const cache = new Map();
export async function solScan(env, mint, { goplus, codex } = {}) {
  const hit = cache.get(mint); if (hit && Date.now() - hit.at < 10 * 60000) return hit;
  const res = { addr: mint, chain: 'solana', steps: [], score: 100, at: Date.now() };
  const push = s => { res.steps.push(s); res.score -= s.cost || 0; return s; };
  const unread = (key, name, why) => push({ key, name, status: 'skip', tag: 'NO READ', detail: `Could not read this stop (${why}).`, facts: [], cost: 5 });

  // everything independent starts at once
  const pMint = rpc(env, 'getAccountInfo', [mint, { encoding: 'jsonParsed' }]).then(r => r?.value).catch(e => /Invalid param/i.test(e.message) ? null : undefined);   // a malformed address is no mint; a silent node is unknown
  const pPairs = getJ('https://api.dexscreener.com/tokens/v1/solana/' + mint).catch(() => null);
  const pGp = (goplus ? goplus(mint) : Promise.resolve(null)).catch(() => null);
  const pLaunch = (codex ? codex(mint) : Promise.resolve(null)).catch(() => null);
  const pCurve = (/pump$/.test(mint) ? pumpCurve(env, mint) : Promise.resolve(null)).catch(() => null);
  const pLargest = rpc(env, 'getTokenLargestAccounts', [mint]).then(r => r?.value || []).catch(() => null);

  const acct = await pMint;
  if (acct === null || (acct && acct.owner !== TOKEN && acct.owner !== TOKEN22) || acct?.data?.parsed?.type !== 'mint') {
    if (acct === undefined) throw new Error('the Solana node did not answer');
    push({ key: 'sources', name: 'Sources', status: 'bad', tag: 'NO POOL', detail: 'This address is not a token mint on Solana.', facts: [], cost: 100 });
    return Object.assign(res, { sym: short(mint), verdict: 'NO POOL', platform: 'depot', score: 0, zone: 3, maxLev: 0 });
  }
  const mi = acct.data.parsed.info, dec = mi.decimals, supply = BigInt(mi.supply || '0'), t22 = acct.owner === TOKEN22;

  // 1. Sources: DexScreener, and when it turns the server away, GeckoTerminal, then Codex and GoPlus's pool list
  // (an index that turns the server away can answer with nothing at all, so an empty answer is not taken as "no pool")
  const ds = await pPairs; let pairs = (ds || []).filter(p => p.chainId === 'solana'), from = 'DexScreener', gt = null;
  if (!pairs.length) { gt = await geckoPairs(mint); if (gt?.length) { pairs = gt; from = 'GeckoTerminal'; } }
  const curve = await pCurve, meta = (mi.extensions || []).find(e => e.extension === 'tokenMetadata')?.state || (await pGp)?.metadata || {};
  if (!pairs.length) {   // neither pool index had it: build the pool from what Codex and GoPlus know
    const L = await pLaunch, dex = ((await pGp)?.dex || []).sort((a, b) => Number(b.tvl) - Number(a.tvl))[0];
    if (L?.ok && (L.liquidity || L.price)) { pairs = [{ chainId: 'solana', dexId: dex?.dex_name || null, baseToken: { symbol: L.symbol || meta.symbol, name: meta.name }, priceUsd: L.price, liquidity: { usd: L.liquidity }, pairCreatedAt: L.created, pairAddress: dex?.id }]; from = 'Codex'; }
    else if (dex) { pairs = [{ chainId: 'solana', dexId: dex.dex_name, baseToken: { symbol: meta.symbol, name: meta.name }, liquidity: { usd: Number(dex.tvl) || null }, pairAddress: dex.id }]; from = 'GoPlus'; }
    else if (!curve && (ds == null || gt == null)) throw new Error('the pool indexes did not answer, try again in a minute');
  }
  const pair = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  if (pair && !pair.baseToken?.symbol && meta.symbol) pair.baseToken = { symbol: meta.symbol, name: meta.name };
  if (!pair && !curve) {
    push({ key: 'sources', name: 'Sources', status: 'bad', tag: 'NO POOL', detail: 'No pool found for this token on Solana.', facts: [], cost: 100 });
    return Object.assign(res, { sym: short(mint), verdict: 'NO POOL', platform: 'depot', score: 0, zone: 3, maxLev: 0 });
  }
  const solUsd = pair && Number(pair.priceNative) ? Number(pair.priceUsd) / Number(pair.priceNative) : null;
  const live = curve && !curve.complete, liq = pair?.liquidity?.usd ?? (live && solUsd ? curve.realSol * solUsd * 2 : null);
  const created = pair?.pairCreatedAt || null, ageMin = created ? (Date.now() - created) / 60000 : null;
  const dexName = { pumpfun: 'the Pump.fun curve', pumpswap: 'PumpSwap', raydium: 'Raydium', meteora: 'Meteora', orca: 'Orca' }[pair?.dexId] || pair?.dexId || 'the Pump.fun curve';
  Object.assign(res, { sym: pair?.baseToken?.symbol || meta.symbol || short(mint), name: pair?.baseToken?.name || meta.name || '', price: Number(pair?.priceUsd) || null, liq, pool: pair?.pairAddress || curve?.curve, ageMin, url: pair?.url || null, fdv: pair?.fdv || null,
    links: [...(pair?.info?.websites || []).map(w => w.url), ...(pair?.info?.socials || []).map(s => s.url)].filter(Boolean).slice(0, 6) });
  push({ key: 'sources', name: 'Sources', status: 'ok', tag: 'FOUND', detail: `${res.sym} trades on ${dexName}${pairs.length > 1 ? ` and ${pairs.length - 1} other pool${pairs.length > 2 ? 's' : ''}` : ''}, ${ageMin == null ? 'age unknown' : fmtAge(ageMin) + ' old'}.`,
    facts: [['Price', res.price ? '$' + sig(res.price) : 'unknown'], ['24h trades', pair ? (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0) : 'unknown'], ['24h volume', '$' + compact(pair?.volume?.h24 || 0)], ['Chain', 'Solana'], ['Read from', from]] });

  // 2. Gate
  {
    const thin = liq != null && liq < 1000, low = liq != null && liq < 3000, young = ageMin != null && ageMin < 10;
    const curveNote = live ? ` Still on the Pump.fun curve, ${curve.progress.toFixed(0)}% of the way to graduation.` : '';
    push({ key: 'gate', name: 'Gate', status: thin ? 'bad' : low || young || liq == null ? 'warn' : 'ok', tag: thin ? 'TOO THIN' : low || young || liq == null ? 'NOTE' : 'PASS', cost: thin ? 30 : low || young ? 10 : liq == null ? 6 : 0,
      detail: (liq == null ? 'Liquidity could not be read.' : thin ? `Only $${compact(liq)} in the pool. One sale moves the price.` : low ? `Liquidity is $${compact(liq)}, under the $3K floor.` : young ? `Pool is ${fmtAge(ageMin)} old, under ten minutes.` : `Liquidity $${compact(liq)}, old enough to read.`) + curveNote,
      facts: [['Liquidity', liq == null ? 'unknown' : '$' + compact(liq)], ['FDV', '$' + compact(res.fdv)], ...(curve ? [['Pump.fun curve', curve.complete ? 'graduated' : curve.progress.toFixed(1) + '%']] : [])] });
  }

  // 3. Scout: the largest token accounts, each resolved to the wallet or program that owns it
  const gp = await pGp; let wallets = [], creator = curve?.creator || gp?.creators?.[0]?.address || null;
  try {
    // the node's largest accounts; for the very largest tokens it gives up, and GoPlus's holder list stands in
    const big = await pLargest; let owners;
    if (big?.length) {
      const accts = (await rpc(env, 'getMultipleAccounts', [big.map(x => x.address), { encoding: 'jsonParsed' }]))?.value || [];
      owners = big.map((x, i) => ({ ta: x.address, owner: accts[i]?.data?.parsed?.info?.owner || null, share: supply > 0n ? Number(BigInt(x.amount) * 100000n / supply) / 1000 : 0 }));
    } else if (gp?.holders?.length) { owners = gp.holders.slice(0, 20).map(h => ({ ta: h.token_account, owner: h.account, share: Number(h.percent) * 100 })); res.holderSrc = 'GoPlus'; }
    else throw new Error('the node gave no holder list');
    const uniq = [...new Set(owners.map(o => o.owner).filter(Boolean))];
    const kinds = uniq.length ? (await rpc(env, 'getMultipleAccounts', [uniq, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]))?.value || [] : [];
    const isWallet = new Map(uniq.map((o, i) => [o, kinds[i]?.owner === SYSTEM]));
    const byOwner = new Map(); for (const o of owners) if (o.owner) { const w = byOwner.get(o.owner) || { a: o.owner, share: 0, wallet: isWallet.get(o.owner) && o.owner !== INCIN }; w.share += o.share; byOwner.set(o.owner, w); }
    const all = [...byOwner.values()].sort((a, b) => b.share - a.share);
    wallets = all.filter(w => w.wallet && w.a !== curve?.curve);
    const top10 = wallets.slice(0, 10).reduce((s, w) => s + w.share, 0), inPrograms = all.filter(w => !w.wallet).reduce((s, w) => s + w.share, 0);
    let count = Number(gp?.holder_count) || (await pLaunch)?.holders || null, many = false;
    if (count == null) try { const t = (await rpc(env, 'getTokenAccounts', { mint, limit: 1000 }))?.total; if (t != null) { if (t < 1000) count = t; else many = true; } } catch (e) {}   // a page of accounts: the whole count when under a thousand
    const st = top10 > 50 ? 'bad' : top10 > 25 || (count != null && count < 25) ? 'warn' : 'ok';
    Object.assign(res, { holders: count, top10, topShares: wallets.slice(0, 10).map(w => Math.round(w.share * 1000) / 1000), holderSrc: big?.length ? 'Helius' : 'GoPlus' });
    const burnt = gp?.dex?.map(d => d.burn_percent).filter(v => v != null) || [], lpFacts = burnt.length ? [['Pool tokens burned', Math.max(...burnt).toFixed(0) + '%']] : [];
    push({ key: 'scout', name: 'Scout', status: st, tag: st === 'bad' ? 'TOP HEAVY' : st === 'warn' ? 'NOTE' : 'SPREAD', cost: top10 > 50 ? 25 : top10 > 25 ? 10 : count != null && count < 25 ? 6 : 0,
      detail: `${count == null ? many ? 'Over 1,000 holders' : 'Holder count unknown' : count.toLocaleString('en-US') + ' holders'}. The ten largest wallets keep ${top10.toFixed(1)}% of supply${inPrograms > 1 ? `; pools and programs hold ${inPrograms.toFixed(1)}%` : ''}.`,
      facts: [['Holders', count == null ? many ? '1,000+' : 'unknown' : count.toLocaleString('en-US')], ['Top 10 wallets', top10.toFixed(1) + '%'], ['Held by pools and programs', inPrograms.toFixed(1) + '%'], ...lpFacts, ['Read from', res.holderSrc]] });
  } catch (e) { unread('scout', 'Scout', e.message); }

  // 4. Tracer: who first sent SOL to each of the largest wallets
  let funders = [];
  try {
    const got = await pool3(wallets.slice(0, 6), async w => {
      const sigs = await rpc(env, 'getSignaturesForAddress', [w.a, { limit: 100 }]);
      if (sigs.length >= 100) return { ...w, old: true, funder: null, txs: sigs.length };
      const first = sigs[sigs.length - 1]; if (!first) return { ...w, old: false, funder: null, txs: 0 };
      const tx = await rpc(env, 'getTransaction', [first.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
      const ins = [...(tx?.transaction?.message?.instructions || []), ...(tx?.meta?.innerInstructions || []).flatMap(x => x.instructions)];
      const pay = ins.find(i => i.program === 'system' && i.parsed?.type === 'transfer' && i.parsed.info?.destination === w.a);
      return { ...w, old: false, funder: pay?.parsed?.info?.source || tx?.transaction?.message?.accountKeys?.[0]?.pubkey || null, txs: sigs.length };
    });
    funders = got.filter(Boolean);
    const fresh = funders.filter(f => !f.old && f.txs <= 3).length, byCreator = funders.filter(f => creator && (f.funder === creator || f.a === creator)).length;
    const flagged = (gp?.creators || []).some(c => c.malicious_address == 1);
    const st = byCreator >= 2 || flagged ? 'bad' : fresh >= 5 ? 'warn' : 'ok', traced = funders.length > 0;
    res.creator = creator;
    push({ key: 'tracer', name: 'Tracer', status: traced || flagged ? st : 'skip', tag: flagged ? 'DEPLOYER FLAGGED' : !traced ? 'NOTHING TO TRACE' : st === 'bad' ? 'DEPLOYER PAID' : st === 'warn' ? 'FRESH WALLETS' : 'TRACED', cost: (byCreator >= 2 ? 15 : fresh >= 5 ? 8 : 0) + (flagged ? 20 : 0),
      detail: (flagged ? `GoPlus marks the creator ${short(creator)} as malicious. ` : '') + (!traced ? 'No ordinary wallets among the top holders yet.' : `Traced ${funders.length} top wallets. ${fresh} are brand new, ${byCreator} tie back to the creator.`),
      facts: [['Creator', creator ? short(creator) : 'unknown'], ['Wallets traced', funders.length], ['Brand new', fresh]] });
  } catch (e) { unread('tracer', 'Tracer', e.message); }

  // 5. Linker: wallets that share a funder, the creator's own share, and who bought at launch
  {
    const groups = {}; for (const f of funders) if (f.funder) (groups[f.funder] = groups[f.funder] || []).push(f);
    const multi = Object.entries(groups).filter(([, g]) => g.length >= 2).map(([k, g]) => ({ funder: k, n: g.length, share: g.reduce((s, h) => s + h.share, 0) })).sort((a, b) => b.share - a.share);
    const big = multi[0];
    let devShare = creator ? (wallets.find(w => w.a === creator)?.share || 0) : 0;
    if (creator && !devShare && supply > 0n) try { const ta = (await rpc(env, 'getTokenAccountsByOwner', [creator, { mint }, { encoding: 'jsonParsed' }]))?.value || []; devShare = ta.reduce((s, x) => s + Number(BigInt(x.account.data.parsed.info.tokenAmount.amount) * 100000n / supply) / 1000, 0); } catch (e) {}
    let st = big && big.share > 15 ? 'bad' : big && big.share > 5 || devShare > 10 ? 'warn' : 'ok', cost = big && big.share > 15 ? 28 : big && big.share > 5 ? 12 : devShare > 10 ? 10 : 0;
    res.group = big || null; res.devShare = devShare;
    const L = await pLaunch, lf = [], said = [];
    if (curve || L?.launchpad) lf.push(['Launchpad', curve ? `Pump.fun${curve.complete ? ', graduated' : `, ${Math.round(curve.progress)}% to graduation`}` : L.launchpad]);
    if (L?.ok) {
      const p = v => v == null ? null : Number(v), sn = p(L.sniperPct), bu = p(L.bundlerPct), ins = p(L.insiderPct);
      res.launch = { pad: curve ? 'pumpfun' : L.launchpad, graduated: curve ? curve.complete : L.graduated, progress: curve ? curve.progress : L.progress, sn, bu, ins, dev: devShare };
      for (const [k, v] of [['Snipers hold', sn], ['Bundles hold', bu], ['Insiders hold', ins]]) if (v != null) lf.push([k, v.toFixed(1) + '%']);
      const worse = s => { if (s === 'bad' || (s === 'warn' && st === 'ok')) st = s; };
      if (bu != null && bu > 25) { cost += 18; worse('bad'); said.push(`bundles still hold ${bu.toFixed(1)}%`); } else if (bu != null && bu > 10) { cost += 7; worse('warn'); said.push(`bundles hold ${bu.toFixed(1)}%`); }
      if (sn != null && sn > 15) { cost += 10; worse('warn'); said.push(`snipers hold ${sn.toFixed(1)}%`); }
      if (ins != null && ins > 15) { cost += 8; worse('warn'); said.push(`insiders hold ${ins.toFixed(1)}%`); }
    } else if (curve) res.launch = { pad: 'pumpfun', graduated: curve.complete, progress: curve.progress, dev: devShare };
    const linked = funders.length > 0 || lf.length > 0;
    push({ key: 'linker', name: 'Linker', status: linked ? st : 'skip', tag: !linked ? 'NOTHING TO LINK' : st === 'bad' ? 'BUNDLED' : st === 'warn' ? 'NOTE' : 'NO GROUP', cost,
      detail: (big ? `${big.n} top wallets were funded by ${short(big.funder)} and keep ${big.share.toFixed(1)}% between them.` : devShare > 10 ? `No shared funder, but the creator still keeps ${devShare.toFixed(1)}%.` : funders.length ? 'No two top wallets share a funder.' : 'No top wallets to trace.') + (said.length ? ` At launch: ${said.join(', ')}.` : lf.length > 1 ? ' No heavy sniping or bundling at launch.' : ''),
      facts: [['Groups found', multi.length], ['Largest group', big ? big.share.toFixed(1) + '%' : 'none'], ['Creator keeps', devShare.toFixed(1) + '%'], ...lf] });
  }

  // 6. Auditor: what the mint lets someone do, read from the mint account; GoPlus for what the account does not say
  {
    const ext = Object.fromEntries((mi.extensions || []).map(e => [e.extension, e.state || {}]));
    const fee = ext.transferFeeConfig?.newerTransferFee?.transferFeeBasisPoints ?? ext.transferFeeConfig?.olderTransferFee?.transferFeeBasisPoints ?? null;
    const feePct = fee == null ? null : fee / 100, gpOn = k => gp?.[k]?.status === '1' || gp?.[k] === '1';
    const frozenDefault = ext.defaultAccountState?.accountState === 'frozen' || gp?.default_account_state === '2';
    const found = [
      [ext.nonTransferable || gp?.non_transferable === '1', 'tokens that cannot be moved', 60, 1],
      [ext.permanentDelegate?.delegate, 'a permanent delegate who can move or burn anyone\'s tokens', 45, 1],
      [gpOn('balance_mutable_authority'), 'an authority that can change balances', 40, 1],
      [!!mi.freezeAuthority, 'a freeze authority that can lock any holder\'s tokens', 25, 1],
      [!!mi.mintAuthority, 'a live mint authority: more can be printed', 22, 1],
      [frozenDefault, 'new token accounts start frozen', 30, 1],
      [feePct != null && feePct > 10, `a ${feePct?.toFixed(0)}% transfer fee`, 25, 1], [feePct != null && feePct > 0 && feePct <= 10, `a ${feePct?.toFixed(1)}% transfer fee`, 6, 0],
      [ext.transferHook?.programId, 'a transfer hook: another program runs on every transfer', 15, 0],
      [gpOn('closable'), 'a mint that can be closed', 8, 0],
    ].filter(f => f[0]);
    const mutable = gp?.metadata_mutable?.status === '1' || null;
    // an issuer token GoPlus lists as trusted (a stablecoin, say) keeps its mint and freeze powers by design: noted, not a trap
    const trusted = gp?.trusted_token == 1;
    if (trusted) for (const f of found) if (/^a (freeze|live mint) authority/.test(f[1])) { f[2] = 4; f[3] = 0; }
    const hard = found.some(f => f[3]), st = hard ? 'bad' : found.length ? 'warn' : 'ok';
    const cost = found.reduce((s, f) => s + f[2], 0) + (mutable ? 2 : 0);
    res.noSell = !!(ext.nonTransferable || frozenDefault); res.sellTax = feePct; res.buyTax = feePct;
    push({ key: 'auditor', name: 'Auditor', status: st, tag: st === 'bad' ? 'TRAP DOOR' : st === 'warn' ? 'NOTE' : 'READS CLEAN', cost,
      detail: found.length ? `The mint carries ${found.map(f => f[1]).join(', ')}.${trusted ? ' GoPlus lists it as a trusted issuer token, so those powers are noted rather than counted as a trap.' : ''}` : `Mint authority and freeze authority are both revoked${t22 ? '; a Token-2022 mint with no dangerous extension' : ''}.${mutable ? ' The name and image can still be changed.' : ''} No trap found.`,
      facts: [['Mint authority', mi.mintAuthority ? short(mi.mintAuthority) : 'revoked'], ['Freeze authority', mi.freezeAuthority ? short(mi.freezeAuthority) : 'revoked'], ['Program', t22 ? 'Token-2022' : 'SPL Token'], ['Transfer fee', feePct == null ? 'none' : feePct.toFixed(2) + '%'], ['Metadata', mutable ? 'can change' : gp ? 'fixed' : 'unknown'], ['Read from', ['the mint account', gp && 'GoPlus'].filter(Boolean).join(' + ')]] });
  }

  // 7. Judge, by the same rules as on Robinhood Chain
  res.score = Math.max(0, Math.min(100, Math.round(res.score)));
  const early = (ageMin != null && ageMin < 60) || (res.holders != null && res.holders < 50), blind = res.steps.some(s => s.tag === 'NO READ');
  if (early || blind) res.score = Math.min(res.score, 70);
  res.verdict = res.score >= 75 ? 'CLEAN' : res.score >= 45 ? 'RISKY' : 'DANGER';
  res.platform = 'depot'; res.zone = 3; res.maxLev = 0;
  const why = blind && res.score === 70 ? 'One of the stops could not be read, so this cannot be called clean. Run it again.' : early && res.score === 70 ? 'Under an hour old or under 50 holders: too early to call clean.' : res.verdict === 'CLEAN' ? 'Nothing here holds it back.' : res.verdict === 'RISKY' ? 'Read the stops above before riding it.' : 'Too many marks against it.';
  push({ key: 'judge', name: 'Judge', status: res.verdict === 'CLEAN' ? 'ok' : res.verdict === 'RISKY' ? 'warn' : 'bad', tag: `${res.verdict} ${res.score}`, detail: why + ' Solana tokens are read, not traded by the crew.', facts: [['Score', res.score + ' / 100'], ['Chain', 'Solana']] });
  res.at = Date.now();
  if (!blind) { cache.set(mint, res); if (cache.size > 300) cache.delete(cache.keys().next().value); }
  return res;
}
