# shuntdesk

Read Robinhood Chain tokens from a terminal: what a contract can do, what the launcher did with its tokens, what a
buy on a Pons curve returns, a curve live, which contracts run the same code and which wallets hold two tokens.

The same reads as [shuntdesk.com](https://shuntdesk.com). Read-only, no key, no wallet. Not advice.

```
npx shuntdesk sim 0x7e517e779b85895894becad80c9bb69b4cb1c4d6 0.05
```

```
  Curve Simulator  0x7e51…c4d6 · 0.05 ETH in
  curve now           ██████░░░░░░░░░░░░░░░░░░ 23.8% 0.999 of 4.2 ETH · fee 2.5% each way
  after your buy      ██████░░░░░░░░░░░░░░░░░░ 24.9%
  you get             11.21M tokens at $0.0000107 average, $120 in
  price moves         +3.7% from your buy alone
  sold straight back  0.0475 ETH -4.9%
  break even when     0.0724 ETH comes in after you
```

## Commands

Paste any address and it works out the rest: a token gets the full check, a wallet its X-ray.

```
npx shuntdesk 0x7e517e779b85895894becad80c9bb69b4cb1c4d6
```

Run `shuntdesk` alone for a prompt that takes addresses and commands until you quit.

| Command | What it reads |
| --- | --- |
| `shuntdesk check <token>` | Everything at once: verdict, contract, launcher, curve, and a box of what the chain shows |
| `shuntdesk scan <token>` | The contract: functions that mint, pause, block wallets, change the tax or swap the code; owner, proxy, source |
| `shuntdesk token <token>` | Shuntdesk's verdict and how the price moved after it, red flags, holders, snipers, bundles, dev share |
| `shuntdesk ledger <token>` | Where the launcher sent its tokens: sold, sent to wallets, sent to contracts, burned, still held |
| `shuntdesk twins <token>` | Contracts in the radar's log running exactly the same code, and how many lost half |
| `shuntdesk shared <token> <token>` | Top wallets holding both tokens, pools and contracts left out |
| `shuntdesk sim <token> [eth]` | A buy on a Pons curve worked through the curve's own reserves, fees both ways, the round trip and the inflow needed to break even |
| `shuntdesk watch <token> [seconds]` | The curve live in your terminal: progress, price, net flow, pace and time to bond at that pace |
| `shuntdesk bonds [n]` | The open Pons curves closest to bonding, with their pace |
| `shuntdesk grads` | Curves that just bonded, and how long each took |
| `shuntdesk radar [n]` | The newest tokens the radar read, with their flags, and the radar's own record |
| `shuntdesk wallet <wallet>` | Every token in a wallet, with verdicts, curves and copies of real tokens |
| `shuntdesk dev <wallet>` | A launcher's record on Pons: launches, bonded, dumped, burned |
| `shuntdesk site <token>` | Its website and links: domain age, urlscan.io, Google Safe Browsing |
| `shuntdesk alike <token>` | Tokens that looked like it at launch, and how they did an hour and a day later |
| `shuntdesk calls [n]` | The latest verdicts and whether the price went the way they called it |
| `shuntdesk caught` | What the radar flagged and then lost half, and what it missed |
| `shuntdesk week` | The week on Robinhood Chain: launches, bonds, the radar, the best rule, $SHUNT burns |
| `shuntdesk desk` | The crew's public paper desk: equity, open positions, closed trades |
| `shuntdesk stocks` | The stocks behind Robinhood Chain's stock tokens |
| `shuntdesk proof` | $SHUNT read from the chain: contract, curve, dev wallet, liquidity |
| `shuntdesk rugrun` | A game: ten real new tokens, names hidden. Call rug or ride, the record answers |

Add `--json` for the raw answer. Set `SHUNTDESK_API` to point at another host.

A part that could not be read is said as not read, never as zero.

## For AI agents

- **Skill:** `skill/shuntdesk/SKILL.md` in this package teaches an agent when to call these reads and how to report them
  honestly. Copy the `shuntdesk` folder into your agent's skills folder (for Claude Code, `~/.claude/skills/`).
- **MCP:** add `https://shuntdesk.com/mcp` as a remote server. No key.
- **HTTP:** `GET https://shuntdesk.com/api/v1/<scan|token|sim|ledger|devscore|twins|shared>?a=0x…`. See
  [llms.txt](https://shuntdesk.com/llms.txt).

The curve sums are exported too: `import { simulate, breakEven } from 'shuntdesk/curve'`.

## Limits

120 calls an hour per caller. `dev` and `shared` read a chain index with a daily budget and say so when it is spent;
it is back at 00:00 UTC.

## License

MIT
