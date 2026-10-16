# Changelog

## 1.3.0 · 16 October 2026

- Docs (/docs/): the whole project on one page, with contents that follow you: the seven checks and the score, the board, the crew desk, your paper desk and its rules, Pons, the watchlist, reports and replays, every part of The Yard (controls, shifts, the city, work and cash, talking, the armory, events, missions, the leaderboard), the Telegram bot, the agent API, MCP, the open record, data sources, architecture, $SHUNT and an FAQ. Linked from the header and the landing page.
- Privacy (/privacy/) and Terms (/terms/) replace the fine print, updated for the game, the boards, phone alerts and the bot. The manifesto's principles moved into the docs. Old links redirect.
- Telegram: the bot stays quiet in groups unless it gets a command, a mention or a reply; /id gives a chat's id. The footer links the community at t.me/shuntdesk.

## 1.2.0 · 16 October 2026

- The Yard (`/play/`): a walkable 3D rail yard. In a Signal Box shift, real calls with a known later price arrive as trains; read the manifest, pull RIDE or SIDING, and compare your read with the desk's.
- The Yard grows into a city: Westbank and Eastgate around the yard, tunnels at both ends, traffic, townsfolk, four buildings to walk into with live screens, a day and night cycle with weather, the RISKY after dark, ten missions with a journal, and a city map.
- The Yard: synthesised sound, a weekly leaderboard scored by the server (`/api/yard`), Liquidity Lake and The Wheel, bus stops, buses, taxis and trucks in both districts, more townsfolk, pitched roofs in Westbank, billboards, six more missions.
- The Yard gets busier: walkers follow you round town, parked cars and trees on the streets, food trucks with queues and tables, a busker's crowd in Signal Square, Westbank Court, a building site with a crane, Curve Stadium, the yard crew on the lines, people on the platforms, two more bus stops and two more missions.
- The Yard: Junction Station by the Signal Box, a busy island platform with its own departures board, staff in one uniform, crowds waiting, and the track 22 train calling there; platforms you can step onto; a new sound design with a lo-fi music loop, a crowd murmur, station chimes, brakes and a two-tone horn.
- The Yard: station staff and passengers at work (cleaning, ticket checks, the kiosk, guards who whistle trains out, people getting on and off), spoken platform announcements with captions, Junction Crossing by the spawn with lights, bell and barriers, riding the 22 between Junction and Central, a live countdown on the Junction board, pigeons, and showers that come and go.
- The Yard: traffic over Junction Crossing waits at the barriers; talk to anyone in town (names, roles, voices, replies to pick, favours); game cash earned from shifts, parcels, litter, golden tickets and bounties, spent on food, drink, fares and Yard Supply upgrades; energy; photo mode; seventeen more missions.
- The Yard: a daily shift (`/api/daily`, the same five trains for everyone, one go) with share cards and a post button; bring your own token (the seven checks run live, the price an hour later decides); an album of cards; driving trains into the platform or the siding; runaway trains; taxis; fishing; hoops; the kiosk counter; your flat, Yard Supply, The Signal cinema and Booth 7 arcade to walk into; events (fires, thieves, breakdowns, runaways); festival and match nights; the RUG PULL every seventh night; fog and thunder; cats and a dog; clothes; the Yard Gazette; a live board in Signal Square; people who remember you; conversations by topic; /daily on the Telegram bot.
- The Yard: every building has a door (lobbies, shops, restaurants, gyms, karaoke, hotels, pharmacies), The Armory with knife, crowbar, bat, katana, pistol, shotgun and ammo (for the RISKY only), a stadium you can watch from, a phone taskbar, and older saves load safely.
- `GET /api/play`: the trains, with the stops each ticket showed and the move an hour and a day later.

## 1.1.0 · 16 October 2026

- Telegram bot (`@shuntdesk_bot`): `/check`, `/new`, `/desk`, `/report`, and plain questions answered from Shuntdesk's own figures.
- Phone alerts: watch a token and get a web push when price or liquidity moves 30%, with the site closed.
- MCP server at `/mcp`: five read-only tools (token, verdicts, crew_desk, pons_graduations, daily_report).
- Rug replay at `/replay/`: a token's life on one chart with launch, graduation, the call, the peak and the fall.

## 1.0.0 · 15 October 2026

- Surplus: the conductor runs on Surplus, with OpenRouter as the fallback.
- ChargeAI's second read on Pons tickets, labelled as another model's opinion.
- The open record on Hugging Face, published daily.
- For agents: `/api/v1/*` and `/llms.txt`, runnable on `/agents/`.
- Post-mortems on closed crew trades; a conductor paragraph on the daily report.
- The landing shows fresh Pons graduations; graduated tokens ride the yard as their own trains.
- Deployer record cards to save or post.

## 0.9.0 · 15 October 2026

- Graduation desk, deployer record, sniper and bundle check, watchlist, daily report, weekly seasons.
- `` on the paper desk; the contract address in the header.

## 0.8.0 · 14 October 2026

- Live at shuntdesk.com: the seven checks, the crew desk, the paper desk with four markets, the board of
  desks, the manifesto and the fine print.