// Same Hand: who is behind a launch, followed through the money. Shared by the Same Hand page and the server's
// Telegram alert, so each side passes in its own way of reading the chain:
//   io.rpc(method, params)  a Robinhood Chain node
//   io.wallet(w, creator)   the money behind a wallet: { ok, first: { from, eth, at, via }, sent: [wallets], busy, creator }
//   io.pools(tokens)        { token: { sym, liq } } for the tokens that still have a pool
//
// The launcher of a Pons token is in the factory's launch log. Its first funds came from someone (the funder),
// whose own first funds came from someone else. Each wallet the funder sent money to is a sibling. Every Pons
// launch by any of them is read from the same log, and each launch's pool is looked at as it stands now.
export const PONS = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e', PONS_FROM = 39100000;
export const T_LAUNCH = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607', T_GRAD = '0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259';
const word = a => '0x' + a.slice(2).toLowerCase().padStart(64, '0'), fromWord = w => '0x' + w.slice(-40).toLowerCase();
const ZERO = '0x0000000000000000000000000000000000000000';
export const DEAD_LIQ = 1000;   // a pool under $1K has next to nothing left to sell into

// a contract has code; a wallet does not
// a 7702 wallet (0xef0100 and an address) is a person's wallet, not a contract
const isContract = async (io, a) => { try { const c = await io.rpc('eth_getCode', [a, 'latest']); return !!c && c !== '0x' && !/^0xef0100[0-9a-f]{40}$/i.test(c); } catch (e) { return false; } };

export async function sameHand(input, io, onStep = () => {}) {
  input = input.toLowerCase();
  const head = parseInt(await io.rpc('eth_blockNumber'), 16);
  onStep('launcher');
  // a token: its launcher from the log, or its creator when it did not come from Pons. A wallet: itself.
  let token = null, launcher = null, viaPons = false;
  if (await isContract(io, input)) {
    token = input;
    const w = await io.wallet(input, true).catch(() => null);
    launcher = w?.ponsBy || w?.creator || null; viaPons = !!w?.ponsBy;
  } else launcher = input;
  if (!launcher) return { ok: false, why: 'the creator of this contract could not be read' };

  // the money behind the launcher, two steps back. A busy wallet (an exchange, a bridge, a bot) ends the trail:
  // everyone it paid is not one hand.
  onStep('funders');
  const chain = [{ addr: launcher, role: 'launcher' }], sib = new Map();
  let at = chain[0];
  for (const role of ['funder', 'funder of the funder']) {
    const w = await io.wallet(at.addr).catch(() => null);
    if (!w?.ok) break;
    if (at !== chain[0]) { at.busy = w.busy; at.paid = w.sent.length; if (!w.busy) for (const s of w.sent) if (!sib.has(s)) sib.set(s, at.addr); }
    if (w.busy && at !== chain[0]) break;
    const f = w.first; if (!f || f.from === ZERO) break;
    const node = { addr: f.from, role, eth: f.eth, at: f.at, via: f.via, contract: await isContract(io, f.from) };
    chain.push(node);
    if (node.contract) break;   // a contract funded it: a bridge, an exchange or a router; the trail ends there
    at = node;
  }
  // the last funder found: who else it paid
  const tail = chain[chain.length - 1];
  if (tail !== chain[0] && !tail.contract && tail.paid === undefined) {
    const w = await io.wallet(tail.addr).catch(() => null);
    if (w?.ok) { tail.busy = w.busy; tail.paid = w.sent.length; if (!w.busy) for (const s of w.sent) if (!sib.has(s)) sib.set(s, tail.addr); }
  }
  for (const c of chain) sib.delete(c.addr);
  // every Pons launch by any of them
  onStep('launches');
  const wallets = [...chain.filter(c => !c.contract && !c.busy).map(c => c.addr), ...sib.keys()].slice(0, 160);   // a busy wallet launches nothing of its own
  const launches = [];
  for (let i = 0; i < wallets.length; i += 40) {
    const got = await io.launches(wallets.slice(i, i + 40)).catch(() => ({}));
    for (const [by, list] of Object.entries(got)) for (const l of list) launches.push({ ...l, by });
  }
  const tokens = [...new Map(launches.map(l => [l.token, l])).values()].filter(l => l.token !== token).sort((a, b) => b.block - a.block);
  onStep('pools');
  let pools = {}; try { pools = await io.pools(tokens.slice(0, 150).map(t => t.token)); } catch (e) {}
  const ago = b => Date.now() - (head - b) * 100.4;   // about ten blocks a second
  const rows = tokens.map(t => {
    const p = pools[t.token] || null, by = chain.find(c => c.addr === t.by);
    return { token: t.token, sym: p?.sym || null, by: t.by, how: by ? by.role : 'paid by a funder', via: sib.get(t.by) || null, t: t.t || ago(t.block), pool: !!p, liq: p ? p.liq : 0 };
  });
  for (const c of chain) c.launches = rows.filter(r => r.by === c.addr).length;
  const dead = rows.filter(r => r.liq < DEAD_LIQ).length;
  return {
    ok: true, input, token, viaPons, launcher, chain, siblings: sib.size, launchers: new Set(rows.map(r => r.by)).size,
    launched: rows.length, dead, alive: rows.length - dead,
    hand: rows.length ? (dead / rows.length >= 0.6 ? 'dead' : 'same') : 'new',
    rows
  };
}