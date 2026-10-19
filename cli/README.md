# shuntdesk

Read Robinhood Chain tokens from a terminal: what a contract can do, what the launcher did with its tokens, what a
buy on a Pons curve returns, which contracts run the same code and which wallets hold two tokens.

The same reads as [shuntdesk.com](https://shuntdesk.com). Read-only, no key, no wallet. Not advice.

```
npx shuntdesk sim 0x7e517e779b85895894becad80c9bb69b4cb1c4d6 0.05
```

```
Curve Simulator · 0x7e51…c4d6 · 0.05 ETH
  curve now           36.8% · 1.544 of 4.2 ETH · fee 2.5% each way
  you get             7.76M tokens average $0.0000156, $121.07 in
  price moves         +3.0% from your buy alone
  curve after         37.9% · 2.607 ETH left to bond
  sold straight back  0.0475 ETH -4.9%
  break even when     others put in 0.0867 ETH after you
```

## Commands

| Command | What it reads |
| --- | --- |
| `shuntdesk scan <token>` | The contract: functions that mint, pause, block wallets, change the tax or swap the code; owner, proxy, source |
| `shuntdesk token <token>` | Shuntdesk's verdict and how the price moved after it, red flags, holders, snipers, bundles, dev share, curve progress |
| `shuntdesk sim <token> [eth]` | A buy on a Pons curve worked through the curve's own reserves, fees both ways, the round trip and the inflow needed to break even |
| `shuntdesk ledger <token>` | Where the launcher sent its tokens: sold, sent to wallets, sent to contracts, burned, still held |
| `shuntdesk dev <wallet>` | A launcher's record on Pons: launches, bonded, dumped, burned |
| `shuntdesk twins <token>` | Contracts in the radar's log running exactly the same code, and how many lost half |
| `shuntdesk shared <token> <token>` | Top wallets holding both tokens, pools and contracts left out |

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
