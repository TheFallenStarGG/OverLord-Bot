# The Overlord

Discord bot for a light **per-server economy**, optional **games/combat**, **stocks**, and a shared **realm** layer (weather, events, board, Gazette).  
**Prefix `!!` is the main way to use it.** Slash commands exist but are experimental.

- **Website:** https://thefallenstargg.github.io/Overlord-Website/
- **Dashboard (Discord login):** https://thefallenstargg.github.io/Overlord-Website/dashboard.html
- **Support:** https://discord.gg/vZrsPCMHys
- **Terms / Privacy:** on the website

Virtual coins and items have **no real-world value**. Progress is **per server** unless a feature says otherwise.

---

## Features

| Area | What you get |
|------|----------------|
| Economy | Daily, work, shop, trade, craft, fish/mine, rob (toggleable), quests, prestige |
| Games | Wordle and other casual games; gambling can be disabled per server |
| Combat | Duels, bosses, gear/forge, loadouts (optional) |
| Markets | Stocks, companies, weather, muscle |
| Realm | Board (`!!board` / settings), Gazette, decrees, bounties, seasons, server wars |
| Admin | `!!settings`, title shop, reaction roles, data wipe |
| Website | Live leaderboards, stocks, wars, wiki, commands, status, changelog |
| Dashboard | OAuth login: your stats, full server settings, titles and role panels |
| Staff | Private admin panel (logs, inbox, tools) for the owner and allowlisted people |

---

## Requirements

- **Node.js 18+**
- Discord application with **Message Content Intent**
- Recommended invite permission integer: **268438528** (View Channel, Send Messages, Embed Links, Read Message History, Add Reactions, Manage Roles)
- Long-running host (e.g. bot-hosting.net)
- **Turso** (libSQL) database

---

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| TOKEN | Yes | Discord bot token |
| TURSO_DATABASE_URL | Yes | Database URL |
| TURSO_AUTH_TOKEN | Yes | Database token |
| OWNER_ID | Strongly recommended | Your Discord user ID |
| WEB_GITHUB_TOKEN | For public site data | Pushes leaderboards/wiki/etc. to the website data branch |
| WEB_REPO | No | Default TheFallenStarGG/Overlord-Website |
| WEB_BRANCH | No | Default data |
| OPENROUTER_API_KEY | For Gazette AI | Optional |
| DAILY_LIMIT | No | AI daily cap (default 50) |
| SUPPORT_URL | No | Overrides support invite for !!support |
| HOME_GUILD_ID | Migration only | Legacy global to per-server import |

Never commit secrets.

---

## Setup

git clone https://github.com/TheFallenStarGG/OverLord-Bot.git
cd OverLord-Bot
npm install
# set env vars on your host
node index.js

### Invite

https://discord.com/api/oauth2/authorize?client_id=1555446743515144232&permissions=268438528&scope=bot%20applications.commands

---

## First-time server setup

1. Invite the bot with the permissions above
2. Run !!tutorial admin or open Dashboard then Server settings
3. Set events channel (Gazette, bosses, decrees)
4. Optional: realm board, level-ups, turn off rob/gambling
5. Members: !!tutorial, !!help, !!daily

Website listing is on by default. Opt out: !!settings website off.
Hide yourself from public boards: !!webhide.

---

## Website and dashboard

| URL | Purpose |
|-----|---------|
| https://thefallenstargg.github.io/Overlord-Website/ | Overview and live status |
| https://thefallenstargg.github.io/Overlord-Website/dashboard.html | Login, stats, server settings, titles, role panels |
| https://thefallenstargg.github.io/Overlord-Website/commands.html | Command list |
| https://thefallenstargg.github.io/Overlord-Website/setup.html | Admin checklist |
| https://thefallenstargg.github.io/Overlord-Website/faq.html | Common questions |
| https://thefallenstargg.github.io/Overlord-Website/status.html | Online / incidents |

Dashboard auth uses a Cloudflare Worker and Discord OAuth (identify and guilds).
Settings changes go through a queue in Turso; the bot applies them and re-checks Manage Server.

Admin panel (owner and allowlist): logs, reports/feedback, overview, moderation tools.

Public site JSON is published to the repo data branch when WEB_GITHUB_TOKEN is set.

---

## Commands (summary)

Use !!help in Discord for the live list. Groups include:

- Economy: !!daily, !!work, !!bal, !!shop, !!buy, !!craft, !!fish, !!mine
- Games / combat: !!wordle, !!duel, !!boss, !!loadout
- Realm: !!board, !!event, !!bounty
- Admin: !!settings, !!edittitles, !!reactionroles, !!deletedata, !!tutorial admin
- Meta: !!help, !!changelog, !!invite, !!support, !!feedback, !!report

Owner-only and private media commands are not documented on the public site.

---

## Project layout

| Path | Role |
|------|------|
| index.js | Starts the client, loads commands/events |
| config.js | Constants, file names, channel IDs |
| commands/ | One file per !! command |
| events/ | Discord listeners |
| lib/storage.js | Turso and per-guild scoped data |
| lib/economy.js | Coins, XP, inventories |
| lib/serverSettings.js | Toggles, channels, custom titles |
| lib/guildSettings.js | Applies dashboard / settings changes |
| lib/adminBridge.js | Publishes snapshots and processes website action queue |
| lib/reactionRoles.js | Role panels |
| lib/webexport.js | Pushes public JSON to GitHub |
| lib/changelog.js | In-bot and site changelog entries |

---

## Privacy (short)

We store Discord IDs and per-server gameplay data to run the bot.
Website login uses Discord OAuth; staff tools are restricted.
Public leaderboards only for servers/users that have not opted out.
Details: https://thefallenstargg.github.io/Overlord-Website/privacy.html

---

## Contact

Operator: TheFallenStarGG
Email: DarkstarGaming2326@proton.me
Support: https://discord.gg/vZrsPCMHys

Not affiliated with Discord Inc.
