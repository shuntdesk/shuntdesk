// Two reads only Solana gives this cleanly. First Buyers: who bought in the first seconds of a Pump.fun launch,
// who among them shared the launch slot with the deployer, who was funded by it, and who still holds. Serial
// Launcher: how many tokens the deployer created in its latest transactions. Both from the Helius node and its
// parsed history, no paid source.
import { rpc, getJ, pumpCurve, pda, b58decode, SYSTEM } from './solana.js';
import { parsed } from './soltools.js';

const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', PAGES = 14;
const keep = (m, k, v, n = 200) => { m.set(k, { t: Date.now(), v }); if (m.size > n) m.delete(m.keys().next().value); return v; };
async function pool4(items, fn) { const out = []; let i = 0; await Promise.all([0, 1, 2, 3].map(async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; } } })); return out; }

// who first sent SOL to a wallet: its oldest transaction, when the wallet is young enough to reach it
async function funderOf(env, w) {
  const sigs = await rpc(env, 'getSignaturesForAddress', [w, { limit: 200 }]);
  if (sigs.length >= 200) return { old: true, funder: null };
  const first = sigs[sigs.length - 1]; if (!first) return { old: false, funder: null };
  const tx = await rpc(env, 'getTransaction', [first.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
  const ins = [...(tx?.transaction?.message?.instructions || []), ...(tx?.meta?.innerInstructions || []).flatMap(x => x.instructions)];
  const pay = ins.find(i => i.program === 'system' && i.parsed?.type === 'transfer' && i.parsed.info?.destination === w);
  return { old: false, funder: pay?.parsed?.info?.source || tx?.transaction?.message?.accountKeys?.[0]?.pubkey || null };
}

const firstHit = new Map();
export async function solFirst(env, mint, scan) {
  const h = firstHit.get(mint); if (h && Date.now() - h.t < 6 * 3600000) return h.v;
  const curve = await pumpCurve(env, mint).catch(() => null);
  if (!curve) return { ok: false, why: 'First Buyers reads Pump.fun launches: this token has no Pump.fun curve' };
  // the curve's whole history, newest first, back to its first trade
  let before = '', sigs = [];
  for (let p = 0; p < PAGES; p++) {
    const s = await rpc(env, 'getSignaturesForAddress', [curve.curve, { limit: 1000, ...(before ? { before } : {}) }]);
    sigs.push(...s); if (s.length < 1000) break; before = s[s.length - 1].signature;
    if (p === PAGES - 1) return keep(firstHit, mint, { ok: false, why: `over ${(PAGES * 1000).toLocaleString('en-US')} trades on its curve: the first ones are too far back to reach` });
  }
  const oldest = sigs.reverse().filter(s => !s.err).slice(0, 60).map(s => s.signature);
  if (!oldest.length) return { ok: false, why: 'no trades found on its curve' };
  let txs; try { txs = await getJ(`https://api.helius.xyz/v0/transactions?api-key=${env.HELIUS_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactions: oldest }) }); } catch (e) { return { ok: false, why: 'the parsed history did not answer' }; }
  txs = (Array.isArray(txs) ? txs : []).sort((a, b) => a.slot - b.slot);
  const mintAcct = (await rpc(env, 'getAccountInfo', [mint, { encoding: 'jsonParsed' }]))?.value, info = mintAcct?.data?.parsed?.info;
  const supply = Number(info?.supply || 0) / 10 ** (info?.decimals || 6), program = mintAcct?.owner;
  const launch = txs.find(t => t.type === 'CREATE') || txs[0], slot0 = launch?.slot, dev = scan?.creator || launch?.feePayer || null;
  // every buy out of the curve, in order; a wallet counts once, at its first buy
  const buyers = new Map();
  for (const t of txs) for (const x of (t.tokenTransfers || []).filter(x => x.mint === mint && x.fromUserAccount === curve.curve && x.toUserAccount)) {
    const w = x.toUserAccount, b = buyers.get(w) || { wallet: w, slot: t.slot, at: t.timestamp * 1000, bought: 0, buys: 0, sameSlot: t.slot === slot0, payer: t.feePayer };
    b.bought += Number(x.tokenAmount) || 0; b.buys++; buyers.set(w, b);
  }
  const list = [...buyers.values()].slice(0, 20).sort((p, q) => (q.wallet === (scan?.creator || launch?.feePayer)) - (p.wallet === (scan?.creator || launch?.feePayer)) || p.slot - q.slot);
  if (!list.length) return { ok: false, why: 'no buys found among the first trades' };
  // what each still holds, from its associated token account
  const atas = await Promise.all(list.map(b => pda([b58decode(b.wallet), b58decode(program), b58decode(mint)], ATA)));
  const bal = (await rpc(env, 'getMultipleAccounts', [atas, { encoding: 'jsonParsed' }]).catch(() => null))?.value || [];
  list.forEach((b, i) => { b.holds = bal[i] ? Number(bal[i].data?.parsed?.info?.tokenAmount?.uiAmount || 0) : 0; b.boughtPct = supply ? b.bought / supply * 100 : null; b.holdsPct = supply ? b.holds / supply * 100 : null; b.isDev = b.wallet === dev; });
  // who funded the first twelve that are not the deployer
  const traced = await pool4(list.filter(b => !b.isDev).slice(0, 12), b => funderOf(env, b.wallet));
  list.filter(b => !b.isDev).slice(0, 12).forEach((b, i) => { const f = traced[i]; b.funder = f?.funder || null; b.oldWallet = !!f?.old; b.byDev = !!dev && (b.funder === dev || b.payer === dev); });
  const groups = {}; for (const b of list) if (b.funder && !b.isDev) (groups[b.funder] = groups[b.funder] || []).push(b);
  const shared = Object.entries(groups).filter(([, g]) => g.length >= 2).map(([funder, g]) => ({ funder, n: g.length, boughtPct: g.reduce((s, b) => s + (b.boughtPct || 0), 0) })).sort((a, b) => b.boughtPct - a.boughtPct);
  const others = list.filter(b => !b.isDev), same = others.filter(b => b.sameSlot);
  const sum = (a, k) => a.reduce((s, b) => s + (b[k] || 0), 0);
  const v = { ok: true, chain: 'solana', token: mint, curve: curve.curve, dev, launchSlot: slot0, launchAt: launch ? new Date(launch.timestamp * 1000).toISOString() : null,
    devBoughtPct: list.find(b => b.isDev)?.boughtPct ?? null, devHoldsPct: list.find(b => b.isDev)?.holdsPct ?? null,
    sameSlot: same.length, sameSlotPct: sum(same, 'boughtPct'), sameSlotHoldsPct: sum(same, 'holdsPct'),
    first: others.length, firstPct: sum(others, 'boughtPct'), firstHoldsPct: sum(others, 'holdsPct'), soldAll: others.filter(b => b.holds === 0).length,
    fundedByDev: others.filter(b => b.byDev).length, sharedFunders: shared.slice(0, 5),
    buyers: list.map(b => ({ wallet: b.wallet, isDev: b.isDev, sameSlot: b.sameSlot, secondsAfter: launch ? Math.round((b.at - launch.timestamp * 1000) / 1000) : null, boughtPct: b.boughtPct, holdsPct: b.holdsPct, funder: b.funder || null, byDev: !!b.byDev, oldWallet: !!b.oldWallet })),
    note: 'The first buyers of this Pump.fun launch, read from its curve\'s own history (Helius): who bought in the launch slot beside the deployer, what each still holds in its token account now, and who sent the first SOL to the first twelve. A wallet can hold tokens in another account, and a shared funder can be an exchange. Read only. Not advice.' };
  return keep(firstHit, mint, v);
}

// Serial Launcher: tokens the deployer created among its latest parsed transactions
const serialHit = new Map();
export async function solSerial(env, w) {
  const h = serialHit.get(w); if (h && Date.now() - h.t < 30 * 60000) return h.v;
  let txs; try { txs = await parsed(env, w, 1); } catch (e) { return null; }
  const made = txs.filter(t => t.type === 'CREATE' && t.feePayer === w);
  const span = made.length > 1 ? (made[0].timestamp - made[made.length - 1].timestamp) / 3600 : null;
  return keep(serialHit, w, { created: made.length, read: txs.length, hours: span, full: txs.length >= 100 });
}
