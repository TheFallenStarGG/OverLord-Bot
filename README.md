# The Overlord

A feature-rich Discord bot for **economy**, **games**, **combat**, **stocks**, and **server events**.  
Prefix commands use `!!` (preferred). Slash commands also exist but are **experimental**.

- **Website / Terms / Privacy:** https://thefallenstargg.github.io/Overlord-ToS/
- **Source:** this repository

Economy and most progression are **per server**. Coins and items have **no real-world value**.

---

## Features (overview)

- Virtual economy: daily, work, shop, rob, give, quests, prestige
- Games: Wordle, cards, board games, betting games (can be disabled per server)
- Combat: duels, bosses, loadouts, forging, rebellion / usurper
- Markets: stocks, companies, weather, hired muscle
- World loop: Gazette, decrees, bounties, seasons, server wars
- Admin tools: settings, custom title shop (+ optional Discord roles), data deletion
- Safety: rate limits, abuse checks, owner blacklist
- Cloud saves via **Turso** (libSQL)

---

## Requirements

- **Node.js** 18+ (fetch + modern Discord.js)
- A Discord bot application with:
  - **Message Content Intent** enabled
  - Invite permissions (recommended integer **`268438528`**):
    - View Channel, Send Messages, Embed Links, Read Message History, Add Reactions, **Manage Roles**
- Hosting that can run a long-lived Node process (e.g. bot-hosting.net)
- A **Turso** database (or compatible libSQL HTTP endpoint)

---

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `TOKEN` | Yes | Discord bot token |
| `TURSO_DATABASE_URL` | Yes | Turso DB URL (`libsql://…` or `https://…`) |
| `TURSO_AUTH_TOKEN` | Yes | Turso auth token |
| `OWNER_ID` | Strongly recommended | Your Discord user ID (owner commands) |
| `HOME_GUILD_ID` | Only for legacy migration | Original server ID when moving old global JSON into per-server data |
| `OPENROUTER_API_KEY` | For Gazette AI | OpenRouter API key |
| `DAILY_LIMIT` | No | Daily AI request cap (default `50`) |
| `SUPPORT_URL` | No | Support server invite used by `!!support` |

Never commit tokens or secrets.

---

## Setup

```bash
git clone https://github.com/TheFallenStarGG/OverLord-Bot.git
cd OverLord-Bot
npm install
# set env vars in your host panel or a local .env loader you provide
node index.js
```

### Invite URL

```text
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=268438528&scope=bot%20applications.commands
```

Replace `YOUR_CLIENT_ID` with the Application ID from the Discord Developer Portal.

### First-time server setup (admins)

1. `!!tutorial admin`
2. `!!settings events #channel` — Gazette, bosses, decrees, updates
3. `!!settings levels #channel` — optional level-up messages
4. `!!settings` — gambling / rob / ignored channels / disabled commands / game channels
5. Optional: `!!edittitles` — custom shop titles and Discord roles

Players: `!!tutorial`, then `!!daily`, `!!work`, `!!help`.

---

## Project structure

```text
index.js          Bot entry: DB init, load commands/events, login
config.js         Constants, file paths, scoped data list
commands/         One file per !! command
events/           Discord event wiring (messages, buttons, timers)
lib/              Core logic (economy, games, storage, world, …)
package.json      discord.js, @libsql/client
```

`index.js` loads every `commands/*.js` and `events/*.js`. A single broken file is skipped (soft-fail) so the rest of the bot can start.

---

## Commands

Access:

- **free** — anyone (unless the server disabled that command)
- **owner** / **owner-required** — only `OWNER_ID`

Aliases are listed where they exist.

### Economy & progression

| Command | Usage | Description |
|---------|--------|-------------|
| `!!balance` | `!!balance [@user]` | Show coin balance |
| `!!daily` | `!!daily` | Daily coins + streak |
| `!!work` | `!!work` | Job payout (career ladder) |
| `!!career` | `!!career` | Job rank and progress |
| `!!rob` | `!!rob @user` | Attempt to steal coins |
| `!!give` | `!!give @user <amount>` | Give coins (large amounts need **yes** confirm) |
| `!!trade` | `!!trade @user` | Trade coins/items in a two-sided UI |
| `!!tribute` | `!!tribute <amount>` | Pay the Overlord; affects rebellion meter |
| `!!quests` | `!!quests` | Daily/weekly quests |
| `!!prestige` | `!!prestige` | Prestige for permanent bonuses |
| `!!leaderboard` | `!!leaderboard [coins\|xp\|…]` | Server leaderboard |
| `!!globalleaderboard` | `!!globalleaderboard` | Cross-server ranking |
| `!!rank` | `!!rank [@user]` | Level, XP bar, title |
| `!!profile` | `!!profile [@user]` | Full profile card |
| `!!lottery` | `!!lottery` | Lottery tickets / info |

### Shop & gathering

| Command | Usage | Description |
|---------|--------|-------------|
| `!!shop` | `!!shop [page]` | Browse shop pages |
| `!!buy` | `!!buy <item> [amount]` | Buy items / titles |
| `!!sell` | `!!sell <item> [amount]` | Sell loot |
| `!!inventory` | `!!inventory` | Show inventory |
| `!!use` | `!!use <item> [amount]` | Use consumables or equip titles |
| `!!fish` | `!!fish` | Fishing minigame / loot |
| `!!mine` | `!!mine` | Mining minigame / loot |
| `!!pet` | `!!pet` | Pet status / actions |

### Games

| Command | Usage | Description |
|---------|--------|-------------|
| `!!wordle` | `!!wordle` | Channel Wordle |
| `!!tictactoe` | `!!tictactoe @user [bet]` | Tic-tac-toe |
| `!!connect4` | `!!connect4 @user [bet]` | Connect Four |
| `!!battleship` | `!!battleship [@user] [bet]` | Battleship (PvP or solo) |
| `!!blackjack` | `!!blackjack [bet]` | Blackjack |
| `!!minesweeper` | `!!minesweeper [bet]` | Minesweeper |
| `!!crash` | `!!crash [bet]` | Crash multiplier game |
| `!!higherlower` | `!!higherlower [bet]` | Higher or lower |
| `!!hangman` | `!!hangman` | Hangman |
| `!!liarsdice` | `!!liarsdice [bet]` | Liar’s dice |
| `!!slots` | `!!slots [bet]` |Slots |
| `!!gamble` | `!!gamble [bet]` | Simple gamble |
| `!!roulette` | `!!roulette <bet> <choice>` | Roulette |
| `!!heist` | `!!heist` | Group heist flow |

Betting games respect **`!!settings gambling`**. Free (no-bet) games can still work when gambling is off.

### Combat & world

| Command | Usage | Description |
|---------|--------|-------------|
| `!!duel` | `!!duel @user [bet] [ranked] [bo3]` | Class-based duel |
| `!!boss` | `!!boss` | Active raid boss info |
| `!!rebellion` | `!!rebellion` | Rebellion meter / raid status |
| `!!usurper` | `!!usurper [decree\|stipend\|challenge]` | Throne holder actions |
| `!!bounty` | `!!bounty` | Current bounty |
| `!!loadout` | `!!loadout …` | Class, gear, battle items |
| `!!forge` | `!!forge …` | Craft weapons/armor from materials |
| `!!stats` | `!!stats` | Combat stats |
| `!!ranked` | `!!ranked` | Ranked ratings / seasons |
| `!!tournament` | `!!tournament [join\|leave]` | Weekly tournament bracket |
| `!!decree` | `!!decree` | Active Overlord decrees |
| `!!event` | `!!event` | Active server events |
| `!!gazette` | `!!gazette` | Latest Gazette edition |
| `!!war` | `!!war [join\|leave]` | Weekly server war (`!!serverwar`) |
| `!!project` | `!!project` | Realm projects |

### Market & muscle

| Command | Usage | Description |
|---------|--------|-------------|
| `!!stocks` | `!!stocks` | Market prices / news |
| `!!invest` | `!!invest <symbol> <coins>` | Buy shares |
| `!!cashout` | `!!cashout <symbol\|all> [amount]` | Sell shares (large sells confirm) |
| `!!portfolio` | `!!portfolio` | Your holdings |
| `!!ipo` | `!!ipo` | Company IPO flow |
| `!!forecast` | `!!forecast` | Weather forecast |
| `!!muscle` | `!!muscle` | Hired muscle |
| `!!spy` | `!!spy @user` | Spy on another player’s defenses |

### Server admin & setup

| Command | Usage | Description |
|---------|--------|-------------|
| `!!settings` | `!!settings …` | Gambling, rob, channels, ignore list, disable commands, game channels |
| `!!events-channel` | `!!events-channel [#channel\|off]` | Events / Gazette channel |
| `!!levelchannel` | `!!levelchannel [#channel\|off]` | Level-up messages channel |
| `!!edittitles` | `!!edittitles …` | Custom shop titles + optional roles |
| `!!deletedata` | `!!deletedata` | Wipe **all** data for this server (confirm) |
| `!!tutorial` | `!!tutorial [admin]` | Player or admin onboarding |

### Utility & meta

| Command | Usage | Description |
|---------|--------|-------------|
| `!!help` | `!!help [page\|search]` | Command list, pages, or search |
| `!!changelog` | `!!changelog [page]` | Patch notes (`!!updates`) |
| `!!poll` | `!!poll …` | Quick poll |
| `!!roll` | `!!roll …` | Dice |
| `!!flip` | `!!flip` | Coin flip |
| `!!choose` | `!!choose a \| b \| c` | Random choice |
| `!!donate` | `!!donate` | Support the bot |
| `!!invite` | `!!invite` | Bot invite link |
| `!!support` | `!!support` | Support / help links |
| `!!feedback` | `!!feedback <text>` | Send feedback to the operator |
| `!!report` | `!!report <text>` | Report a bug / issue |
| `!!status` | `!!status` | Uptime, latency, DB, memory |
| `!!inbox` | (owner tooling) | Owner inbox routing for reports/feedback |

### Owner only

| Command | Usage | Description |
|---------|--------|-------------|
| `!!doctor` | `!!doctor` | Health check |
| `!!usage` | `!!usage` | AI usage counters |
| `!!models` | `!!models` | Model list / ratings view |
| `!!block` / `!!unblock` | `!!block <name>` | Block OpenRouter model ID substrings |
| `!!bossspawn` | `!!bossspawn [hp]` | Force a boss spawn |
| `!!blacklist` | `!!blacklist …` | Block users or entire servers (`!!bl`) |

> Exact strings can change slightly in code; `!!help` and `!!changelog` are always authoritative in a running bot.

---

## `lib/` modules

### Core platform

| File | Role |
|------|------|
| `storage.js` | Turso client, cache, scoped per-guild data, read/write batching |
| `economy.js` | Users, coins, XP, work, daily, rob, bets helpers, leaderboards |
| `serverSettings.js` | Per-server toggles, channels, custom titles |
| `commandAccess.js` | Disabled commands, ignored channels, game-channel limits |
| `confirm.js` | Pending **yes/no** confirmations |
| `guard.js` | Blacklist + abuse hooks before commands run |
| `abuse.js` | Spam / farming heuristics |
| `blacklist.js` | Persisted blocked users/guilds |
| `logging.js` | Console + optional Discord log channel |
| `utils.js` | `replyLines`, duration/bytes helpers |
| `slashBridge.js` | Slash ↔ prefix adapter |
| `guildData.js` | Wipe server data; schedule delete after leave (~30 days) |
| `digest.js` | Aggregated operator digest / summary helpers |
| `inbox.js` | Report/feedback submission to owner channels |

### World & events

| File | Role |
|------|------|
| `world.js` | Per-server world blob: rebellion, bounty, gazette, settings |
| `announce.js` | Events-channel registry + broadcast |
| `modifiers.js` | Decrees & timed server events |
| `gazette.js` | Daily newspaper composition + AI editorial |
| `boss.js` | Raid boss fights |
| `bounty.js` | Rotating bounties |
| `rebellion.js` | Meter, raids, usurper |
| `throne.js` | Usurp button / throne interactions |
| `seasons.js` | Season state |
| `war.js` | Weekly server war |
| `tournament.js` | Tournament brackets |
| `weather.js` | Weather cycle and effects |
| `questDefs.js` / `quests.js` | Quest definitions and progress |

### Economy satellites

| File | Role |
|------|------|
| `items.js` | Shop catalog, loot tables, custom title merge |
| `inventory.js` | Buy / use / sell inventory logic |
| `shopPages.js` | Shop embeds + buttons |
| `gathering.js` | Fish/mine resolution |
| `stocks.js` | Market simulation |
| `companies.js` | Player companies / IPO hooks |
| `muscle.js` | Hired muscle jobs |
| `spy.js` | Spy reports |
| `pets.js` / `petData.js` | Pets |
| `prestige.js` | Prestige UI + perform |
| `lottery.js` | Lottery state |
| `ranked.js` | Ranked ratings |
| `realm.js` | Realm projects / perks |
| `donate.js` | Donation links + occasional nudge |
| `helpPages.js` | `!!help` pages + search |
| `changelog.js` | In-bot changelog entries |

### AI (Gazette only)

| File | Role |
|------|------|
| `ai.js` | OpenRouter chat completions (stream) |
| `models.js` | Free model list, blocks, ratings |
| `usage.js` | Daily/minute AI usage tracking |

### Combat

| File | Role |
|------|------|
| `combat/classes.js` | Classes and arenas |
| `combat/engine.js` | Round resolution |
| `combat/gear.js` | Gear, titles, profiles, duel stats |

### Games (`lib/games/`)

| File | Role |
|------|------|
| `common.js` | Shared lobby, bets, buttons, lifecycle |
| `duel.js` | Duel flow |
| `tictactoe.js`, `connect4.js`, `battleship.js` | Board games |
| `blackjack.js`, `crash.js`, `higherlower.js`, `minesweeper.js` | Solo/table games |
| `hangman.js`, `liarsdice.js`, `trade.js`, `wordle.js`, `words.js` | Other games + word list |

---

## `events/` modules

| File | Role |
|------|------|
| `messageCreate.js` | Prefix commands, confirms, guards, flood control |
| `slashCommands.js` | Register + handle slash commands |
| `help.js` | Help pagination buttons |
| `tutorial.js` | Tutorial pagination buttons |
| `gameButtons.js` | Game button/modal router |
| `features.js` | Shop/prestige/heist/boss/lottery interactions |
| `combat.js` | Duel rematch + tournament ready checks |
| `economy.js` | Message XP + level-up posts |
| `world.js` | Boss raids, bounties, usurper, gazette ticks |
| `market.js` | Stocks, muscle, weather announcements |
| `decree.js` | Periodic decrees |
| `serverEvents.js` | Timed modifier events |
| `seasons.js` | Season / war timers and payouts |
| `announce.js` | New server / changelog announce helpers |
| `changelog.js` | Changelog buttons |
| `spy.js` | Spy intel buttons |
| `wordle.js` | Wordle guess listener |
| `logging.js` | Attach logger + flush on shutdown |
| `status.js` | Presence / status text rotation |

---

## Data model (important)

- **Scoped files** (per guild): modifiers, world, economy, lottery, ranked, stocks, weather, muscle, companies, realm, tournament, seasons, …
- **Global files**: announce map, usage, model blocks/ratings, blacklist, inbox channels, digest, etc.
- Persistence: in-memory cache + periodic flush to **Turso**.
- Removing the bot from a server schedules **deletion of that server’s data** after a retention window (~**30 days**). Admins can wipe sooner with `!!deletedata`.

---

## Slash commands

- Registered automatically on startup from the same command list.
- Still **experimental**; many flows work better with `!!`.
- Prefer prefix for mentions, complex args, and games.

---

## License / contributing

Add your license file if you have one (e.g. MIT).

When contributing:

1. Keep commands in `commands/` with `name`, `usage`, `description`, `access`, `run`.
2. Put shared logic in `lib/`.
3. Wire timers/buttons in `events/`.
4. Add a short entry at the **top** of `lib/changelog.js`.

---

## Links

- Terms: https://thefallenstargg.github.io/Overlord-ToS/terms.html
- Privacy: https://thefallenstargg.github.io/Overlord-ToS/privacy.html
- Support: use `!!support` in Discord once configured

---

*Not affiliated with Discord Inc.*
