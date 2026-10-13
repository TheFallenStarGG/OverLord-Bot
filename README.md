# The Overlord

A multi-server Discord bot focused on a **living realm**, a **virtual economy**, **PvP and PvE combat**, **stocks**, **minigames**, and **cross-server raids**.  
Commands use the prefix **`!!`**. Slash commands exist but are **experimental and may be buggy** — prefix is preferred.

| Resource | Link |
|----------|------|
| Website | https://thefallenstargg.github.io/Overlord-Website/ |
| Terms of Service | https://thefallenstargg.github.io/Overlord-Website/terms.html |
| Privacy Policy | https://thefallenstargg.github.io/Overlord-Website/privacy.html |
| Support server | https://discord.gg/vZrsPCMHys |
| Source code | https://github.com/TheFallenStarGG/OverLord-Bot |

**Important:** Coins, items, stocks, raid loot, and every other in-bot currency or asset have **no real-world value**. They cannot be redeemed for money. Almost all progression is **per Discord server** (your balance on Server A is separate from Server B), except where a feature is explicitly global (for example some leaderboards or cross-server raids).

This README is the full operator and contributor reference for the current bot.

---

## Table of contents

1. [Feature overview](#1-feature-overview)
2. [Requirements](#2-requirements)
3. [Environment variables](#3-environment-variables)
4. [Setup and invite](#4-setup-and-invite)
5. [First-time server setup](#5-first-time-server-setup)
6. [Project structure](#6-project-structure)
7. [How data is stored](#7-how-data-is-stored)
8. [Command reference](#8-command-reference)
9. [Lib modules (what each major file does)](#9-lib-modules-what-each-major-file-does)
10. [Events](#10-events)
11. [Cross-server raids](#11-cross-server-raids)
12. [Website and dashboard](#12-website-and-dashboard)
13. [Legacy command mode](#13-legacy-command-mode)
14. [Rob economy rules](#14-rob-economy-rules)
15. [Soft-fail loading and reliability](#15-soft-fail-loading-and-reliability)
16. [Privacy and data deletion](#16-privacy-and-data-deletion)
17. [Operator / owner notes](#17-operator--owner-notes)
18. [License and affiliation](#18-license-and-affiliation)

---

## 1. Feature overview

### Economy and progression
- Daily rewards with streak tracking and interactive claim options
- Work with career ranks, shift choices, and a clear “hustle” skill check
- Fishing and mining with zone choice and on-screen action prompts for rare bonuses
- Shop, buy, sell, inventory, use, craft, forge, loadout
- Pets, muscle/guards, spy marks, padlocks and other defensive items
- Rob with methods (pickpocket, burglary, smash & grab, crew), heat, ranks, optional lock minigame, NPC marks
- Give (large transfers confirm), trade UI, tribute (feeds rebellion systems)
- Quests, prestige, lottery
- Server leaderboards and global leaderboard
- Rank, profile, and stats cards
- **`!!legacy-commands`**: per-user toggle to restore classic one-message work / rob / fish / mine

### Realm and world simulation
- Weather, forecasts, decrees, gazette (optional AI), random events
- Bosses and boss spawns, bounties, rebellion and usurper flows
- Realm board / “while you were away” style overview when channels are configured
- Events channel and level-up channel settings
- Wars (server vs server), tournaments, ranked queues for some games

### Combat and PvP
- Duels (optional ranked / best-of), heists
- Boss fights and loadouts
- **Cross-server raids** with live linked channels, multiple combat actions, objectives (vault, banner, chests), ghost garrisons when a side is empty, and mid-raid events

### Stocks and markets
- Per-server stock market with invest, portfolio, cashout, IPO flows where enabled
- Market updates on a slower cadence than older designs (to reduce DB load)
- Company-style events (including severe outcomes such as crashes or buyouts) with optional event-channel announcements

### Games
Wordle, tic-tac-toe, connect4, battleship, blackjack, minesweeper, crash, higher-lower, hangman, liar’s dice, slots, gamble, roulette, flip, roll, choose, poll, and related betting games. Admins can disable gambling or restrict games to certain channels via `!!settings`.

### Moderation and server config
- `!!settings` for gambling, rob, events, levels, board, ignored channels, disabled commands, game channels
- Reaction roles, editable title shop with optional Discord role links
- `!!deletedata` for admins to wipe **this server’s** bot data after confirmation

### Website
- Public documentation, searchable commands, wiki, leaderboards, stocks UI, servers, wars, status, changelog, FAQ, about
- Discord OAuth dashboard for user stats and server settings (where permitted)
- Operator admin panel (allowlisted users): logs, admin allowlist management, tools
- Cookie / storage notice on the Site
- Optional published JSON data from bot exports (`!!webexport` / related pipeline)

### Operator tools
Blacklist, block/unblock feature flags, inbox for reports/feedback, usage stats, doctor diagnostics, web export/hide, raid-admin, models (AI), and private media helpers that are **not** part of normal public help.

---

## 2. Requirements

- **Node.js** 18 or newer (native `fetch`, modern discord.js)
- A Discord application with:
  - **Message Content Intent** enabled (prefix commands)
  - Bot invited with permissions integer **`268438528`**:
    - View Channel
    - Send Messages
    - Embed Links
    - Read Message History
    - Add Reactions
    - **Manage Roles** (titles / reaction roles / some combat features)
  - For **raids**, the bot also needs **Manage Channels** in each participating server (to create the temporary raid category/channel)
- Hosting that keeps a Node process online (for example bot-hosting.net)
- A **Turso** database (or compatible libSQL HTTP API). Free tiers that do not require a credit card exist; the bot is designed for a **remote** database, not a SQLite file only on the bot host

---

## 3. Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `TOKEN` | **Yes** | Discord bot token |
| `TURSO_DATABASE_URL` | **Yes** | Turso / libSQL database URL (`libsql://…` or `https://…`) |
| `TURSO_AUTH_TOKEN` | **Yes** | Turso auth token |
| `OWNER_ID` | Strongly recommended | Your Discord snowflake ID; gates owner commands |
| `HOME_GUILD_ID` | Only for migration | Original single-server guild ID when migrating old global JSON into per-guild storage |
| `OPENROUTER_API_KEY` | Optional | Enables Gazette / AI-backed features via OpenRouter |
| `DAILY_LIMIT` | Optional | Cap on AI requests per day (default `50` if used) |
| `SUPPORT_URL` | Optional | Override the support invite shown by `!!support` |

**Never** commit tokens, auth secrets, or `.env` files containing them. Set variables in your host’s secret/env UI.

---

## 4. Setup and invite

```bash
git clone https://github.com/TheFallenStarGG/OverLord-Bot.git
cd OverLord-Bot
npm install
# Configure TOKEN, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, OWNER_ID on the host
node index.js
```

Dependencies (see `package.json`): `discord.js` (v14+), `@libsql/client`.

### Invite URL template

```text
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=268438528&scope=bot%20applications.commands
```

Replace `YOUR_CLIENT_ID` with the Application ID from the Discord Developer Portal.  
If you use slash commands, keep `applications.commands` in the scope.

---

## 5. First-time server setup

### For admins
1. Run **`!!tutorial admin`** (or read the Setup page on the website).
2. **`!!settings events #channel`** (or `!!events-channel #channel`) — decrees, bosses, gazette, market major events, and similar announcements.
3. **`!!settings levels #channel`** (or `!!levelchannel`) — optional level-up posts.
4. Review **`!!settings`** — enable/disable rob and gambling, set ignored channels, disable individual commands, limit game channels.
5. Optional: **`!!edittitles`**, **`!!reactionroles`**, or the **website dashboard** (Discord login) for title shop and reaction-role style configuration without only using commands.
6. For raids: ensure the bot has **Manage Channels**; optionally **`!!raid-config`** for category / opt-in behavior.

### For players
1. **`!!tutorial`**
2. **`!!daily`**, **`!!work`**, **`!!help`**
3. Explore fish/mine/shop/rob when ready; read **`!!raid rules`** before raiding.

---

## 6. Project structure

```text
OverLord-Bot/
  index.js          Entry point: connect DB, soft-load commands & events, login
  config.js         Paths, scoped data keys, shared constants
  package.json      Dependencies and start script
  commands/         One module per !! command (export name, usage, description, run)
  events/           Discord listeners and scheduled world ticks
  lib/              Business logic (economy, rob, raid, stocks, storage, …)
```

`index.js` loads every file under `commands/` and `events/`. A single file that throws on load is **skipped** (soft-fail) so the rest of the bot can still start; check logs for which file failed.

---

## 7. How data is stored

- **Turso / libSQL** holds persistent JSON-like documents keyed per guild (and some global operator data).
- Typical per-guild data includes economy users, server settings, stocks, raid settings/stats, reaction roles, title shop custom entries, war participation, etc.
- **In-memory** state is used for active raids, short minigame sessions, and similar; coin transfers for combat resolve immediately so a process restart should not “eat” a completed strike’s coins.
- After the bot is **removed** from a server, deletion of that guild’s stored data is **scheduled** (about **30 days**), unless wiped earlier with **`!!deletedata`**.

---

## 8. Command reference

Access levels:
- **free** — anyone in the server (unless an admin disabled that command)
- **owner** / **owner-required** — restricted to `OWNER_ID` (or stricter internal checks)

Descriptions below are taken from the live command modules (shortened only when the source string was empty or broken).


### Economy & progression

| Command | Access | Usage | Description |
|---------|--------|-------|-------------|
| `!!balance` | free | `!!balance [@user]` | Shows your coin balance, or someone else's. |
| `!!daily` | free | `!!daily [stats\|top]` | Claim your free coins for the day. Pick Safe, Lucky, or Gamble, hit streak milestones, and check `!!daily stats`. |
| `!!work` | free | `!!work [stats\|top]` | Pick a shift and optional hustle check for coins. Career ladder still applies. `!!legacy-commands` switches to the classic one-message version. |
| `!!career` | free | `!!career` | Shows your job, your pay, and how close you are to a promotion. Every `!!work` counts. |
| `!!rob` | free | `!!rob [@user] \| stats \| top \| bribe` | Rob a player or NPC mark (methods, minigame, heat). `!!legacy-commands` uses the old simple !!rob @user roll. |
| `!!legacy-commands` | free | `!!legacy-commands` | Toggle classic mode for !!work, !!rob, !!fish, and !!mine. When on, those commands use the old simple one-message versions with no menus or minigames. |
| `!!give` | free | `!!give @user <amount>` | Gives some of your coins to another member. |
| `!!trade` | free | `!!trade @user` | Trade coins and items with another member in a safe, two-sided window. You can trade fish, ores, materials, supplies, and forged weapons or armor (not equipped gear). |
| `!!tribute` | free | `!!tribute <amount>` | Pay tribute to the Overlord (${MIN} to ${MAX.toLocaleString('en-US')} coins) and see how he feels: from disdain to blessings, curses, and rare jackpots. Every tribute also fills the shared treasury, a |
| `!!quests` | free | `!!quests` | Shows your 3 daily and 2 weekly quests. Finished quests pay coins (weekly ones also give a Loot Box) when you check them. |
| `!!prestige` | free | `!!prestige` | Reset your level for a permanent +5% coin bonus, a badge, and a coin reward. Needs level 20 (then 25, 30...). Up to 10 times. |
| `!!leaderboard` | free | `!!leaderboard` | Shows this server's richest members and top chatters side by side. |
| `!!globalleaderboard` | free | `!!globalleaderboard` | Shows the richest and most active players across every server, with each player's servers added together. |
| `!!rank` | free | `!!rank [@user]` | Shows your level, XP progress, prestige, and title. You earn XP by chatting. |
| `!!profile` | — | — | (see `!!help`) |
| `!!stats` | free | `!!stats [@user]` | Shows a combat record: duel wins and losses, streaks, damage dealt, favorite move, boss kills, and titles. |
| `!!lottery` | free | `!!lottery [buy <amount>]` | A daily lottery with a shared pot. Tickets cost 50 each, and one winner is drawn at midnight UTC. |
| `!!cashout` | free | `!!cashout <symbol\|all> [coins\|half\|50%\|all]` | Sell your shares for coins (${Math.round(FEE * 100)}% fee). Leave the amount out to sell everything in that stock, or use \ |
| `!!invest` | free | `!!invest <symbol> <coins\|half\|all>` | Buy shares on the Realm Stock Exchange (${Math.round(FEE * 100)}% fee). Large buys ask for confirmation. Bankrupt stocks can wipe your position. |
| `!!portfolio` | free | `!!portfolio [@user]` | See your stock investments, what they are worth, and your profit or loss. |
| `!!ipo` | — | — | (see `!!help`) |
| `!!stocks` | — | — | (see `!!help`) |
| `!!donate` | free | `!!donate` | Support the bot! Donations help keep it running. |
| `!!project` | — | — | (see `!!help`) |

### Shop, gather, craft, pets

| Command | Access | Usage | Description |
|---------|--------|-------|-------------|
| `!!shop` | free | `!!shop` | Browse the shop: supplies, gear upgrades, and titles. One item is 20% off every day! |
| `!!buy` | free | `!!buy <item> [amount]` | Buys something from the shop, like `!!buy padlock` or `!!buy lootbox 3`. |
| `!!sell` | free | `!!sell [item] [amount\|all]` | Sells the fish and ore you found. `!!sell all` sells everything, or pick one like `!!sell carp 3`. |
| `!!inventory` | — | — | (see `!!help`) |
| `!!use` | free | `!!use <item> [amount]` | Uses an item from your inventory: boosts, Loot Boxes (`!!use lootbox 3`), or equips a title. |
| `!!fish` | free | `!!fish [stats\|top]` | Pick a zone and follow the on-screen hook prompt for better rares. `!!legacy-commands` for the classic version. |
| `!!mine` | free | `!!mine [stats\|top]` | Pick a zone and follow the on-screen strike prompt for better rares. `!!legacy-commands` for the classic version. |
| `!!craft` | free | `!!craft [recipe name]` | Craft food, tools, potions, and trinkets from fish, ore, and parts. `!!craft` lists recipes; `!!craft bait` makes one. Combat gear still uses `!!forge`. |
| `!!forge` | free | `!!forge [item \| enchant <element>]` | Forge weapons and armor from ore, coal, and boss drops. `!!forge` shows the recipes, `!!forge iron sword` crafts one, and `!!forge enchant fire` enchants your weapon. |
| `!!loadout` | — | — | (see `!!help`) |
| `!!pet` | free | `!!pet [adopt \| feed [fish] \| play \| name <name> \| release confirm \| list \| @user]` | Adopt a pet (${ADOPT_COST.toLocaleString('en-US')} coins) that gives you a small perk. Feed it fish from \ |
| `!!muscle` | — | — | (see `!!help`) |
| `!!edittitles` | free | `!!edittitles [list\|add\|price\|role\|remove] ...` | Admin (Manage Server): manage custom shop titles and optional Discord roles. Built-in items cannot be edited. |

### Realm, events, war, raids

| Command | Access | Usage | Description |
|---------|--------|-------|-------------|
| `!!board` | free | `!!board` | Today in the Realm — weather, decrees, bounty, throne, market, and recent headlines. Optional living board: !!settings board #channel |
| `!!forecast` | free | `!!forecast` | See the current weather and what is coming next. Weather changes fishing, mining, and robberies. |
| `!!gazette` | free | `!!gazette` | Shows the latest edition of the Overlord's Gazette, the daily newspaper that comes out at 00:05 UTC. |
| `!!decree` | free | `!!decree` | Shows the Overlord's active decrees and how full the tribute treasury is. Fill it with `!!tribute` to earn a free decree for everyone. |
| `!!event` | free | `!!event` | Shows the server events happening right now. Events start every day or so, with boosted fishing, XP, sales, and more, plus a limited-time shop title. |
| `!!events-channel` | free | `!!events-channel [#channel \| off]` | Picks where I post the Gazette, world events, boss fights, and update notes. Needs Manage Server. Use it with no channel to see the current one, or off to stop. |
| `!!boss` | free | `!!boss` | Checks if a raid boss is active. Bosses show up rarely while people chat, and everyone can fight them together. |
| `!!bossspawn` | owner-required | `!!bossspawn [hp]` | Forces a raid boss to appear in this channel, for testing. You can set its HP (100 to 100000). |
| `!!bounty` | free | `!!bounty` | Shows the Overlord's current bounty. Beat the marked player in a `!!duel` to collect the reward. If they survive, they keep part of it. |
| `!!rebellion` | free | `!!rebellion` | Shows the Rebellion meter. Everyone running commands and fighting bosses fills it. When it's full, the Overlord himself descends, and whoever lands the final blow becomes the Usurper. |
| `!!usurper` | free | `!!usurper [decree <name> \| stipend \| challenge]` | Shows who holds the throne. The Usurper can command one decree per reign and collect a royal stipend every 2 hours. Anyone can challenge them with `!!usurper challenge` (best of 3, equal gear). |
| `!!war` | free | `!!war [join\|leave]` | The weekly Server War: servers compete on how much profit their top players make. Admins can opt this server out with `!!war leave` and back in with `!!war join`. |
| `!!tournament` | free | `!!tournament [join\|leave]` | A weekly single-elimination bracket every Saturday at 18:00 UTC. Entry costs 200 coins, there are no gear or items, and the winner takes 70% of the prize pool. |
| `!!ranked` | free | `!!ranked [duel\|connect4\|battleship]` | Shows the ranked ladder for duels, Connect Four, and Battleship. Beat other players to climb. Seasons last a month and the top 3 win coins. |
| `!!raid` | free | `!!raid [rules \| status \| top \| optout \| optin]` | Raid a random server! A live battle channel opens in both servers — strike, ambush, brace, rally, taunt, spy, and mid-raid events. `!!raid rules` explains everything, `!!raid optout` removes you from  |
| `!!raid-config` | free | `!!raid-config [category <name or #category> \| category reset \| optout \| optin \| ping <role> \| ping off]` | Admin settings for cross-server raids (needs Manage Server). Pick the category raid channels are created in, add a role to ping, or opt the whole server out of raids. |
| `!!raid-admin` | owner | `!!raid-admin list \| end <raid id> \| ban <user id> \| unban <user id> \| banned` | Owner tools for raids: list or force-end raids and ban people from raiding. |
| `!!heist` | free | `!!heist` | Plans a team heist. Others have 60 seconds to join. More crew means better odds, but the loot is shared and failure costs everyone a fine. |
| `!!duel` | free | `!!duel @user [bet] [ranked] [bo3]` | Challenges someone to a duel. Pick a class, then choose moves in secret each round. Your gear and battle items count! |
| `!!spy` | free | `!!spy @user` | Pay ${SPY_COST} coins to send a spy and learn someone's wallet, guards, and thieves. Success also makes your next \ |

### Games & luck

| Command | Access | Usage | Description |
|---------|--------|-------|-------------|
| `!!wordle` | free | `!!wordle` | Starts a Wordle for the whole channel. Type 5-letter words to guess. The solver wins coins, more for fewer guesses. |
| `!!tictactoe` | free | `!!tictactoe @user [bet]` | Challenges someone to tic-tac-toe, played with buttons. Optionally bet coins on it. |
| `!!connect4` | free | `!!connect4 @user [bet]` | Challenges someone to Connect Four, played with column buttons. Optionally bet coins on it. |
| `!!battleship` | free | `!!battleship [@user] [bet]` | Plays Battleship. Challenge a friend (optionally with a coin bet), or leave out the player to play a solo practice round against me. |
| `!!blackjack` | free | `!!blackjack [bet]` | Plays blackjack against the dealer with hit and stand buttons. Blackjack pays 3:2. Leave out the bet for a practice round. |
| `!!minesweeper` | free | `!!minesweeper [bet] [mines]` | Reveal safe tiles on a grid and cash out before you hit a mine! More mines (2 to 10, default 4) means bigger payouts. Leave out the bet for a practice round. |
| `!!crash` | free | `!!crash [bet]` | A rocket multiplier climbs higher and higher. Cash out before it crashes! Leave out the bet for a practice round. |
| `!!higherlower` | free | `!!higherlower [bet]` | Guess if the next card is higher or lower. Every correct guess raises your multiplier, so cash out before you slip! Leave out the bet for a practice round. |
| `!!hangman` | free | `!!hangman` | Guess the hidden word before the drawing is finished. Anyone in the channel can help, and whoever solves it wins 25 to 50 coins. |
| `!!liarsdice` | free | `!!liarsdice [bet]` | Opens a lobby for Liar's Dice (2-5 players). Bluff about how many dice are on the table, or call someone a liar. The last player with dice wins, and everyone antes the bet. |
| `!!slots` | free | `!!slots <bet>` | Spins a slot machine. Three of a kind pays big, two of a kind returns your bet. Use `all` to bet everything. |
| `!!gamble` | free | `!!gamble <bet>` | Double or nothing! Slightly under a 50% chance to win. Use `all` to bet everything. |
| `!!roulette` | free | `!!roulette <bet> <red\|black\|green\|odd\|even\|low\|high\|1st\|2nd\|3rd\|0-36>` | Bet on the roulette wheel. The first bet opens a table for 20 seconds, and anyone in the channel can join before it spins. Colors, odd/even, and low/high pay 1:1, dozens pay 2:1, and a single number p |
| `!!flip` | free | `!!flip` | Flips a coin. |
| `!!roll` | free | `!!roll [NdM+X]` | Rolls dice. `!!roll` is one d6, `!!roll 2d6+3` rolls two six-sided dice and adds 3, and `!!roll d20` or `!!roll 20` rolls a d20. Max 20 dice and 1000 sides. |
| `!!choose` | free | `!!choose <option> \| <option> \| ...` | Picks one of your options at random. Separate them with `\|` (or commas). Example: `!!choose pizza \| tacos \| sushi`. |
| `!!poll` | free | `!!poll [time] <question> \| <option> \| <option>` | Starts a poll with 2-10 options, or yes/no if you give none. Add a time like `10m` or `2h` at the start to close it and show results (max 24h). Example: `!!poll 1h Pizza or tacos? \| Pizza \| Tacos`. |

### Utility & server admin

| Command | Access | Usage | Description |
|---------|--------|-------|-------------|
| `!!help` | free | `!!help [page \| search]` | Opens the command list, jumps to a page (`!!help games`), or searches (`!!help rob`). |
| `!!tutorial` | free | `!!tutorial [admin]` | Guided intro for new players, or `!!tutorial admin` for first-time server setup. |
| `!!changelog` | free | `!!changelog [page]` | Shows what's new in the bot, one update per page, newest first. |
| `!!invite` | free | `!!invite` | Gets the link to add this bot to your own server. |
| `!!support` | free | `!!support` | Gets help, report a bug, or ask a question about the bot. |
| `!!status` | owner | `!!status` | Shows technical stats: uptime, latency, memory, versions, database, and Gazette AI usage. |
| `!!settings` | free | `!!settings [gambling\|rob\|events\|levels\|board\|command\|ignore\|unignore\|games] [on\|off\|add\|remove\|#channel]` | Server setup for admins (Manage Server): gambling, rob, events and level-up channels, turning commands off, ignored channels, and games-only channels. |
| `!!levelchannel` | free | `!!levelchannel [#channel \| off]` | Picks where level-up messages are posted in this server. Needs Manage Server. Use it with no channel to see the current one, or off to stop them. |
| `!!reactionroles` | free | `!!reactionroles [list\|delete <message id>]` | Admin (Manage Roles): build role panels with buttons, a dropdown or reactions. Create roles and colors in the builder. |
| `!!deletedata` | free | `!!deletedata` | Permanently erases ALL of this server's bot data (economy, stocks, pets, settings, everything). Needs Manage Server and a confirmation. This cannot be undone. |
| `!!report` | free | `!!report <what went wrong>` | Sends a bug or a problem (like a broken command or someone abusing the bot) straight to the bot owner. Your username and server name are included. |
| `!!feedback` | free | `!!feedback <your idea or opinion>` | Sends an idea, suggestion, or opinion straight to the bot owner. Your username and server name are included. |
| `!!webhide` | free | `!!webhide [on\|off]` | Hides you from the public website leaderboards (`on`), or shows you again (`off`). With no option it flips your current choice. |

### Operator / owner

| Command | Access | Usage | Description |
|---------|--------|-------|-------------|
| `!!blacklist` | owner | `!!blacklist <add\|remove\|list> [user\|server] [id] [reason]` | Owner only. Blocks a user or a whole server from using the bot. Blocked servers are left right away. |
| `!!block` | owner-required | `!!block <name>` | Blocks every model whose ID contains the text, e.g. `!!block nemotron`. |
| `!!unblock` | owner-required | `!!unblock <name>` | Removes a block that was added with `!!block`. |
| `!!inbox` | owner | `!!inbox [report\|feedback\|both] [#channel\|channel id\|off]` | Owner only. Picks the channel where `!!report` and `!!feedback` messages are sent. It can be in any server the bot is in. Use it with no options to see the current channels. |
| `!!doctor` | owner-required | `!!doctor` | Runs a self-check and reports what is working or broken: keys, model list, data files, log channel, and permissions. |
| `!!usage` | owner | `!!usage` | Shows today's free requests used, requests in the last minute, and when the count resets. |
| `!!webexport` | owner | `!!webexport` | Owner only. Sends everything to the website right now instead of waiting for the next automatic update. |
| `!!models` | owner | `!!models` | Lists the available free models with their 👍/👎 scores and whether any are being skipped. |
| `!!allow-18` | owner | `!!allow-18 [@user \| remove @user \| list]` | Owner only. Who may use !!r, !!e621 and !!rule34. |
| `!!r` | free | `!!r <subreddit> [count] [gallery]` | Owner/allowlist only. Pull random image posts from any subreddit. |
| `!!rule34` | free | `!!rule34 <tags...> [count] [gallery]` | Owner/allowlist only. Pull posts from rule34 using tag searches. |
| `!!e621` | free | `!!e621 <tags...> [count] [gallery]` | Owner/allowlist only. Pull posts from e621 using tag searches. |

### Other commands

| Command | Access | Usage | Description |
|---------|--------|-------|-------------|
| `🐟 Catch (worth ${fmt(lootValue)})` | free | `!!inventory` | Shows your items, catch, gear, titles, and any boosts you have running. |
| `Share price` | free | `!!ipo [found <SYMBOL> <name> \| list]` | Take your own company public on the stock market for ${LISTING_FEE} coins. Its price follows how rich and active you are, and you earn its trading fees. |
| `${cls.emoji} Class (for boss fights)` | free | `!!loadout [weapon\|armor\|class\|item\|skin\|title] <name>` | Shows or changes your gear. Examples: `!!loadout weapon iron sword`, `!!loadout armor chain`, `!!loadout class mage`, `!!loadout item add potion`, `!!loadout title duelist`. |
| `🛡️ Guards (up to ${MAX_GUARDS})` | free | `!!muscle [shop \| hire <name> \| fire <name> \| collect]` | Hire guards that make you harder to rob, or thieves that rob other players while you are offline. They cost daily upkeep. |
| `${currentUsurper()?.id === target.id ? '👑 ' : ''}${target.username}${u.prestige ?` | free | `!!profile [@user]` | Shows a full profile card: level, coins, career, gear, pet, combat record, and ranked ratings. |
| `${def.goods.kind === 'fish' ? '🐟 Fish' : '🪨 Ore'}` | free | `!!project [name \| give <name> <coins\|goods> <amount\|all>]` | The whole server builds projects together with coins, fish, and ore. Finished projects give everyone a permanent perk. |
| `⏱️ Next price update` | free | `!!stocks [symbol \| news]` | See the stock market. Prices update hourly. Add a symbol like `KRKN` for details, or `news` for headlines. |


Use **`!!help`** or **`!!help <search>`** in Discord for the live list, aliases, and multi-page help (including Terms/Privacy footer links where configured).

---

## 9. Lib modules (what each major file does)

| Area | Files (examples) | Role |
|------|------------------|------|
| Storage | `storage.js`, `guildData.js`, `guildSettings.js` | Turso read/write, per-guild documents, settings apply queue |
| Economy | `economy.js`, `inventory.js`, `items.js`, `shopPages.js` | Coins, items, shop definitions, transfers |
| Work / gather / daily | `work.js`, `gathering.js`, `daily.js` | Interactive UIs for common grinds |
| Rob | `rob.js`, `spy.js`, `muscle.js` | Underworld UI, marks, guards |
| Raids | `raid.js` | Matchmaking, channels, combat, relay chat, objectives |
| Stocks | `stocks.js`, `companies.js`, `webStocks.js` | Market simulation and website export helpers |
| World | `world.js`, `weather.js`, `modifiers.js`, `realm.js`, `realmBoard.js`, `digest.js` | Events, weather, decrees, board text |
| Combat | `combat/`, `boss.js`, `heist.js`, `ranked.js` | Duels, bosses, ranked |
| Games | `games/` | Minigame implementations |
| Admin / web | `adminBridge.js`, `adminState.js`, `webexport.js`, `webWiki.js` | Dashboard bridge, public data |
| UX | `helpPages.js`, `confirm.js`, `commandAccess.js`, `legacyMode.js` | Help, confirms, access, legacy toggle |
| Safety | `blacklist.js`, `logging.js`, `guard.js` | Blocks, logs, reconnect throttling |

Not every file is listed; treat `lib/` as the source of truth when a command’s thin wrapper only calls into a module.

---

## 10. Events

| Event module (examples) | Responsibility |
|-------------------------|----------------|
| `messageCreate.js` | Prefix routing, XP, activity for raids/matchmaking |
| `slashCommands.js` / slash bridge | Experimental slash handling |
| `gameButtons.js` | Shared button collectors for games |
| `raid.js` | Raid interactions, relay, reactions |
| `rob.js` | Rob session buttons |
| `world.js`, `serverEvents.js`, `decree.js`, `market.js` | Timed world/market ticks |
| `economy.js` | Periodic economy saves / maintenance |
| `reactionRoles.js` | Reaction role assignment |
| `realmBoard.js` | Updating board messages |
| `logging.js`, `uptime.js`, `status.js` | Health, presence, log channel |
| `cleanup.js` | Leaving guilds, scheduled data cleanup |
| `webexports.js` | Pushing public JSON for the website |
| `help.js`, `tutorial.js`, `changelog.js` | Related UX hooks |
| `adminBridge.js` | HTTP/bridge for dashboard if configured |
| `features.js`, `combat.js`, `spy.js`, `seasons.js`, `wordle.js`, `inbox.js`, `announce.js` | Feature-specific wiring |

---

## 11. Cross-server raids

- Start with **`!!raid`** (rules: **`!!raid rules`**, status/top/optout/optin also available).
- The bot picks a rival server that is eligible (bot online, Manage Channels, rob allowed, not on target cooldown, etc.). Quiet servers can still be matched under relaxed rules.
- A raid channel is created on **both** sides; players **Join Raid**, then fight with Strike, Ambush, Brace, Rally, Taunt, Spy, Siege, Loot, Bomb, Banner, and more.
- Empty human sides get **ghost garrison** NPC defenders so the fight is not cancelled for “nobody showed up.”
- A **server vault** and **banner** objectives give structure beyond pure 1v1 strikes.
- Chat in the raid channel is **relayed** to the other server (filtered); report with 🚩.
- **`!!raid optout`** stops participation and targeting for that user.
- Admins: **`!!raid-config`**. Operators: **`!!raid-admin`**.

---

## 12. Website and dashboard

- Static site on GitHub Pages (see the Overlord website repository).
- **`data.js`** builds shared nav/footer, fetches published JSON, and shows the **cookie / storage notice**.
- **Dashboard**: Discord OAuth login; list guilds you can manage that intersect with bot-present guilds; edit settings, title shop, reaction-role style tools where implemented.
- **Admin panel**: only Operator + manually allowlisted Discord user IDs; logs and admin management at minimum.
- Backend for OAuth may use a Cloudflare Worker and KV; bot may expose guild lists via Turso / admin bridge.

---

## 13. Legacy command mode

**`!!legacy-commands`** (aliases `!!legacy`, `!!classic`) toggles a **per-user** flag stored in economy user data.

| Mode | Behavior |
|------|----------|
| Off (default) | Interactive work / rob / fish / mine |
| On | Classic single-reply `!!work`, `!!rob @user`, `!!fish`, `!!mine` using older resolution paths |

---

## 14. Rob economy rules

Interactive rob (`lib/rob.js`) and legacy `attemptRob` share the design goal:

- **Success payout** scales primarily with the **target’s** wallet (percentage band + absolute ceiling), so a poor player can steal a meaningful amount from a rich target.
- **Fail cost** is limited by a percentage of the **robber’s** own wallet so one loss does not always wipe a poor player.
- Methods (pickpocket / burglary / smash / crew) change odds, heat, and stake bands.
- Optional **5-step** lock minigame: short memorize window; one wrong input fails the bonus; perfect sequence improves success chance.
- NPC marks use a higher unit payout than early designs so grinding marks is not worthless.

---

## 15. Soft-fail loading and reliability

- Command and event files that throw during `require` are logged and skipped.
- Discord reconnect log spam is throttled so brief blips do not flood logs.
- Circular dependency warnings in logging should be avoided by structuring requires carefully; check startup logs after edits.

---

## 16. Privacy and data deletion

- Full policy: https://thefallenstargg.github.io/Overlord-Website/privacy.html  
- Admins: **`!!deletedata`** wipes **this guild’s** bot data after confirmation.  
- Removing the bot schedules guild data deletion after ~**30 days**.  
- Raid opt-out, cookie notice, and OAuth logout cover additional choices.

---

## 17. Operator / owner notes

- Set **`OWNER_ID`** correctly or owner commands will not run for you.
- Private media commands (`!!r`, `!!rule34`, `!!e621`, allow lists) are intentional operator tools — keep them out of public documentation in-server if you do not want them advertised; enforce Discord ToS and channel NSFW rules yourself.
- **`!!webexport`** publishes data the website reads; **`!!webhide`** lets users opt out of public leaderboard-style exposure where implemented.
- Keep Turso tokens rotated if leaked; never paste tokens into tickets or screenshots.

---

## 18. License and affiliation

Not affiliated with Discord Inc.  
Use of the Bot is also subject to the [Terms of Service](https://thefallenstargg.github.io/Overlord-Website/terms.html) and [Privacy Policy](https://thefallenstargg.github.io/Overlord-Website/privacy.html) on the website.

© 2026 The Overlord.
