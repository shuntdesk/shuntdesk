---
name: shuntdesk
description: Read a token on Robinhood Chain (chain id 4663) before buying, holding or recommending it. Use when the user pastes a 0x address of a Robinhood Chain or Pons token, asks whether a token is safe or a rug, what a contract can do, who launched it and what that launcher did, what a buy on a Pons bonding curve would return, which contracts share its code, or which wallets hold two tokens. Read-only, no key, data from shuntdesk.com.
---

# Shuntdesk: read a Robinhood Chain token before acting on it

Shuntdesk reads public chain data about tokens on Robinhood Chain. Every read is rule-based and can be wrong.
It never moves funds and never needs a key or a wallet.

## How to call it

Prefer the CLI with `--json` (Node 18 or later, nothing to install first):

```
npx -y shuntdesk <command> <args> --json
```

| Question | Command |
| --- | --- |
| Everything at once about one token, with the findings sorted | `check <token>` |
| The same seven checks for a Solana token (pass the mint) | `sol <mint>` (or just the mint) |
| What can this contract do? Mint, pause, block wallets, change the tax, swap the code? Who owns it? | `scan <token>` |
| What does Shuntdesk's verdict say, red flags, holders, snipers, bundles, dev share, curve progress? | `token <token>` |
| What would a buy of N ETH on its Pons curve get, and what comes back on a straight sell? | `sim <token> <eth>` |
| Where did the launcher send its tokens: sold, sent away, burned, still held? | `ledger <token>` |
| What is this launcher wallet's record across its Pons launches? | `dev <launcher wallet>` |
| Which contracts run exactly the same code, and how did they end? | `twins <token>` |
| Which top wallets hold both of two tokens? | `shared <token> <token>` |
| What tokens does this wallet hold, and are any of them copies of real tokens? | `wallet <wallet>` |
| Which Pons curves are closest to bonding, or just bonded? | `bonds`, `grads` |
| What new tokens did the radar just read? | `radar` |
| Is its website new, flagged or malicious? | `site <token>` |
| How did tokens that looked like it at launch end? | `alike <token>` |
| How have Shuntdesk's own calls and flags done? | `calls`, `caught`, `lab` |
| What would a buy get back if the dev, the snipers or a big wallet sold first? | `exit <token> [size]` |
| What did its price do since launch? | `replay <token>` |

Without Node, the same answers come from `GET https://shuntdesk.com/api/v1/<endpoint>?a=0x…` with the endpoints
`scan`, `token`, `sim`, `ledger`, `devscore`, `twins`, `shared` (`&b=0x…` for the second token). The MCP server at
`https://shuntdesk.com/mcp` has them as tools too.

A good first read for an unknown token is `check`, which runs `token`, `scan` and `ledger` together. For a Pons token, add `sim` before any
buy, and `dev` on the launcher wallet that `ledger` names.

## How to read the answers to the user

- Say what was found, with the numbers. Do not turn a reading into "safe", "legit" or "guaranteed". A clean read means
  no red flag was found in what was read, nothing more.
- An `ok: false` answer, or a part marked `unread`, `partial` or `not read`, means the data was not read. Say it was not
  read. Never report it as zero, as "none" or as clean.
- `no result yet` on a twin or a call means its later price is not known yet, not that it held.
- A power in `scan` that exists can be used by whoever holds control. If the owner is renounced (the zero or dead
  address), say that too. A proxy means the code can be swapped.
- In `ledger`, tokens sent to contracts are pools or other contracts; the index cannot tell a deposit from a sale
  through a router. Say so when that share is large.
- In `sim`, the result assumes no other trades land first. It does not model others selling, gas, or a buy that crosses
  the bond mark. Fees are taken both ways, so a straight round trip loses money.
- Holding both tokens in `shared`, or the same code in `twins`, is a link, not proof that the same people are behind it.
- Shuntdesk is not advice. Close with the link the CLI prints, so the user can check the read on the site.

## Limits

120 calls an hour per caller. `dev` and `shared` read a chain index with a daily budget; when it is spent they answer
that it is back at 00:00 UTC. Say that and offer the reads that still work.
