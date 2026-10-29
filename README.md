# The Overlord

A Discord bot for a **shared realm**: coins, jobs, stocks, a bank, a **global Campaign map**, a daily **Gazette**, games, raids, and a full **moderation** toolkit for people who actually run servers.

| | |
|---|---|
| **Prefix** | `!!` (some slash commands exist; prefix is the reliable path) |
| **Website** | [thefallenstargg.github.io/Overlord-Website](https://thefallenstargg.github.io/Overlord-Website/) |
| **Support** | [discord.gg/vZrsPCMHys](https://discord.gg/vZrsPCMHys) |
| **Vote** | [top.gg/bot/1555446743515144232](https://top.gg/bot/1555446743515144232) |
| **Invite** | Website invite button, or `!!invite` from a server that already has the bot |

This README is a **player and server-admin guide**. It is not a self-host or developer setup manual.

---

## Table of contents

1. [Quick start](#1-quick-start)
2. [How the bot thinks about servers](#2-how-the-bot-thinks-about-servers)
3. [Finding commands](#3-finding-commands)
4. [Economy and progression](#4-economy-and-progression)
5. [Shop, gather, craft, loadout](#5-shop-gather-craft-loadout)
6. [Stocks, bank, companies](#6-stocks-bank-companies)
7. [World Campaign](#7-world-campaign)
8. [Gazette, board, events](#8-gazette-board-events)
9. [Combat, raids, bounties](#9-combat-raids-bounties)
10. [Games](#10-games)
11. [Profiles, ranks, social](#11-profiles-ranks-social)
12. [Moderation](#12-moderation)
13. [Server setup (admins)](#13-server-setup-admins)
14. [Voting and supporting the bot](#14-voting-and-supporting-the-bot)
15. [Opt out and privacy](#15-opt-out-and-privacy)
16. [Website](#16-website)
17. [Troubleshooting](#17-troubleshooting)

---

## 1. Quick start

1. **Add the bot** from the [website](https://thefallenstargg.github.io/Overlord-Website/) (or run `!!invite` somewhere it already exists).
2. In your server, run **`!!help`** — that is the live menu.
3. Touch the economy: **`!!daily`**, **`!!work`**, **`!!balance`**.
4. Admins: **`!!settings`**, **`!!events-channel`**, **`!!modhelp`**.
5. Optional: vote on [top.gg](https://top.gg/bot/1555446743515144232/vote), then **`!!vote`** in a server.

If commands do nothing, confirm the bot can **see the channel**, **send messages**, and **embed links**. Moderation, raids, and Campaign need extra permissions (see [Server setup](#13-server-setup-admins)).

---

## 2. How the bot thinks about servers

- **Economy, inventory, settings, moderation cases** are **per server**. Rich in one community does not automatically mean rich in another.
- **World Campaign** is **global**: every server is one **house** on the **same map**.
- Raids and global leaderboards cross servers on purpose; admins can opt out of raids.
- People who only want to hang out can **`!!optout`** (wipes **that server’s** data for them and stops bot targeting until **`!!optin`**).

---

## 3. Finding commands

| Command | Purpose |
|--------|---------|
| `!!help` | Browse categories / search |
| `!!modhelp` | Full moderation list |
| `!!campaign help` | Campaign rules and subcommands |
| `!!tutorial` | First-time / admin orientation |
| `!!changelog` | What’s new |
| `!!support` | Support server link |

Also: [Commands on the website](https://thefallenstargg.github.io/Overlord-Website/commands.html).

---

## 4. Economy and progression

Earn coins, spend them, risk them. Most balances are **server-local**.

| Command | Usage | What it does |
|--------|--------|--------------|
| `!!balance` | `!!balance [@user]` | Your coins (or someone else’s) |
| `!!daily` | `!!daily [stats\|top]` | Daily claim; styles and streaks |
| `!!work` | `!!work [stats\|top]` | Paid shift; career ladder |
| `!!career` | `!!career` | Job, pay, progress to promotion |
| `!!fish` | `!!fish` | Fishing |
| `!!mine` | `!!mine` | Mining |
| `!!rob` | `!!rob [@user]` / `stats` / `top` / `bribe` | Robbery (minigame unless legacy mode) |
| `!!legacy-commands` | `!!legacy-commands` | Toggle classic simple work/rob/fish/mine |
| `!!give` | `!!give @user <amount>` | Send coins |
| `!!trade` | `!!trade @user` | Two-sided trade window |
| `!!tribute` | `!!tribute <amount>` | Pay the Overlord; outcomes vary |
| `!!quests` | `!!quests` | Daily / weekly quests |
| `!!prestige` | `!!prestige` | Reset level for permanent earn bonus (level gates apply) |
| `!!leaderboard` | `!!leaderboard` | Server rich list / activity |
| `!!globalleaderboard` | `!!globalleaderboard` | Across servers |
| `!!vote` | `!!vote` | Claim top.gg reward **in this server** |

Slots, roulette, and other gambling only work if admins left gambling **on** in `!!settings`.

---

## 5. Shop, gather, craft, loadout

| Command | Usage | What it does |
|--------|--------|--------------|
| `!!shop` | `!!shop` | Browse the shop |
| `!!buy` | `!!buy <item> [amount]` | Buy |
| `!!sell` | `!!sell <item> [amount]` | Sell |
| `!!inventory` | `!!inventory` | Items, catch, gear, titles, boosts |
| `!!use` | `!!use <item>` | Use a consumable |
| `!!craft` | `!!craft [recipe]` | Craft from materials |
| `!!forge` | `!!forge` | Weapons / armor |
| `!!loadout` | `!!loadout [slot] <name>` | Equip weapon, armor, class, title, etc. |
| `!!pet` | `!!pet` | Pet status / care |
| `!!muscle` | `!!muscle [shop\|hire\|fire\|collect]` | Guards / thieves vs robbery |
| `!!edittitles` | (admins) | Custom shop titles / optional Discord roles |

---

## 6. Stocks, bank, companies

| Command | Usage | What it does |
|--------|--------|--------------|
| `!!stocks` | `!!stocks` | Market overview |
| `!!invest` | `!!invest <symbol> <amount>` | Buy shares |
| `!!portfolio` | `!!portfolio` | Your holdings |
| `!!cashout` | `!!cashout <symbol\|all> [amount]` | Sell shares |
| `!!ipo` | `!!ipo [found … \| list]` | Personal company listing when available |
| `!!bank` | `!!bank [deposit\|withdraw\|heist] …` | Vault vs pocket; optional heist |
| `!!forecast` | `!!forecast` | Market / weather style outlook |

Website: [Stocks](https://thefallenstargg.github.io/Overlord-Website/stocks.html).

---

## 7. World Campaign

**Global** mode: one map, one season clock, **one house per Discord server** (named after the server).

### Core ideas

- Provinces contain **cities**. Taking land is about cities, not only a province flag.
- **Troops** sit on cities. You can siege from a neighboring province **or the same province** to retake a city you already stand in.
- Orders queue until the next **tick**.
- Score tracks **cities held over time**, not only one-off captures.

### Commands

| Command | Usage | What it does |
|--------|--------|--------------|
| `!!campaign` | `!!campaign` | Status overview |
| `!!campaign map` | `!!campaign map` | Map image / refresh map message |
| `!!campaign me` | `!!campaign me` | Your house holdings |
| `!!campaign houses` | `!!campaign houses` | Active houses |
| `!!campaign province <name>` | | Cities, owners, troops |
| `!!campaign recruit <province> <n>` | | Raise troops (costs coins) |
| `!!campaign move <from> <to> <n>` | | March between neighbors |
| `!!campaign attack <from> <to>` | | Queue a siege into that province |
| `!!campaign siege <from> <city>` | | Siege a specific city |
| `!!campaign invade <province>` | | Paid foothold when you need one |
| `!!campaign fortify <city>` | | Fortify a city you own |
| `!!campaign` tax / collect | | Income from held cities where enabled |
| `!!campaign color <#hex>` | | House color on the map |
| `!!campaign orders` / `cancel` | | Queued orders |
| `!!campaign channel` | | Map / campaign posts (admins) |
| `!!campaign help` | | Full in-bot help |

Live board: [Campaign](https://thefallenstargg.github.io/Overlord-Website/campaign.html).

---

## 8. Gazette, board, events

| Command | Usage | What it does |
|--------|--------|--------------|
| `!!gazette` | `!!gazette` | Latest newspaper-style image |
| `!!board` | `!!board` | “Today in the Realm” snapshot |
| `!!events-channel` | `!!events-channel [#channel\|off]` | Where Gazette / world posts go |
| `!!event` | (varies) | World events where enabled |
| `!!decree` | | Realm decrees |

Website: [Gazette](https://thefallenstargg.github.io/Overlord-Website/gazette.html).

---

## 9. Combat, raids, bounties

| Command | Usage | What it does |
|--------|--------|--------------|
| `!!duel` | `!!duel @user` | Player duel |
| `!!bounty` | `!!bounty [post … \| list \| cancel]` | Overlord + player bounties |
| `!!boss` | `!!boss` | Shared boss when active |
| `!!raid` | `!!raid` | Cross-server raid |
| `!!raid-config` | (admins) | Category, opt-out, ping role |
| `!!heist` | `!!heist` | Heist content where enabled |
| `!!rebellion` / `!!usurper` | | Throne / rebellion flavor |

Raids need channel permissions in participating servers. Opted-out or empty servers are skipped.

---

## 10. Games

Most accept an optional bet when gambling is enabled.

| Command | Notes |
|--------|--------|
| `!!blackjack` | vs dealer |
| `!!slots` / `!!roulette` / `!!flip` / `!!roll` | luck |
| `!!gamble` | general wager |
| `!!lottery` | server lottery |
| `!!crash` | crash-style |
| `!!higherlower` | higher / lower |
| `!!tictactoe` / `!!connect4` / `!!battleship` | vs member |
| `!!hangman` / `!!minesweeper` / `!!liarsdice` | party games |
| `!!choose a \| b \| c` | random pick |

Limit game channels with `!!settings games …`.

---

## 11. Profiles, ranks, social

| Command | What it does |
|--------|----------------|
| `!!profile` / `!!stats` / `!!rank` | Progression |
| `!!inbox` | Notices |
| `!!poll` | Quick poll |
| `!!feedback` / `!!report` | Feedback or report |
| `!!status` | Bot status line |
| `!!donate` | Support links |

---

## 12. Moderation

**Prefix-only** (does not consume slash slots). Need the matching Discord permission **or** a `!!modrole` role.

Start with **`!!modhelp`**.

| Area | Commands |
|------|----------|
| Warnings | `!!warn`, `!!warnings`, `!!delwarn`, `!!clearwarns`, `!!note` |
| Mute | `!!mute`, `!!unmute` |
| Remove | `!!kick`, `!!ban`, `!!tempban`, `!!softban`, `!!unban` |
| Chat | `!!purge`, `!!slowmode`, `!!lock`, `!!unlock` |
| Identity | `!!nick`, `!!role` |
| Info | `!!userinfo`, `!!history`, `!!case` |
| Config | `!!modlog`, `!!modrole`, `!!modconfig`, `!!automod` |
| Safety | `!!antiraid`, `!!welcome` |

**Anti-raid** (`!!antiraid`): join spikes, optional minimum account age, kick/ban/timeout, optional soft lock, alert channel. The bot application needs **Server Members Intent**.

**Welcome** (`!!welcome #channel …`): `{user}`, `{server}`, `{membercount}`.

**Automod** (`!!automod`): invites, links, spam, caps, mass mentions, word list — staff exempt.

---

## 13. Server setup (admins)

Usually needs **Manage Server**.

| Command | Purpose |
|--------|---------|
| `!!settings` | Gambling, rob, events, levels, ignore channels, games channels, disable a command |
| `!!events-channel` | Gazette / world feed |
| `!!levelchannel` | Level-up messages |
| `!!reactionroles` | Role panels |
| `!!edittitles` | Custom shop titles |
| `!!raid-config` | Raid category / opt-out / ping |
| `!!deletedata` | Wipe **this server’s** bot data (confirmation required) |
| `!!tutorial` | Walkthrough |

**Invite permissions integer:** `1099981778134`  
(View/Send/Embed/Attach/History/Reactions, Manage Messages, Moderate Members, Kick/Ban, Manage Nicknames/Roles/Channels, View Audit Log, and related.) Re-invite if you still use an old minimal link.

More detail: [Setup](https://thefallenstargg.github.io/Overlord-Website/setup.html).

---

## 14. Voting and supporting the bot

1. [Vote on top.gg](https://top.gg/bot/1555446743515144232/vote)
2. In a server where you play: **`!!vote`**
3. Rewards: coins (often **2× on weekends**) plus a short **earn buff**
4. Auto-reward may thank you in the **last channel** you used a bot command in

`!!donate` shows other support options.

---

## 15. Opt out and privacy

| Command | Effect |
|--------|--------|
| `!!optout` | After confirm: delete **your** data **in this server**; bot ignores you here |
| `!!optin` | Return; fresh start in that server |

[Terms](https://thefallenstargg.github.io/Overlord-Website/terms.html) · [Privacy](https://thefallenstargg.github.io/Overlord-Website/privacy.html)

---

## 16. Website

[thefallenstargg.github.io/Overlord-Website](https://thefallenstargg.github.io/Overlord-Website/)

| Page | Why open it |
|------|-------------|
| Campaign | Live global map / houses |
| Gazette | Daily paper |
| Stocks | Market view |
| Commands | Command index |
| Changelog | Updates |
| Setup | Admin checklist |
| Status / leaderboards | Public pulse |

---

## 17. Troubleshooting

| Problem | Try |
|--------|-----|
| Bot ignores commands | Channel perms; not ignored in `!!settings`; not opted out |
| Vote reward / economy “no server” | Use `!!vote` (or any command) **inside a server** |
| Campaign “does not border” on a city you occupy | `!!campaign siege <that province> <city>` |
| Moderation fails | Role hierarchy; Kick/Ban/Moderate Members/Manage Messages |
| Anti-raid / welcome never fire | **Server Members Intent** on; check `!!antiraid` / `!!welcome` |
| No Gazette in Discord | `!!events-channel #channel`; or `!!gazette` |
| Raids never find rivals | Other servers need the bot, permissions, and not be opted out |

Still stuck: [support server](https://discord.gg/vZrsPCMHys) or Discord **TheFallenStarGG**.

---

## Credits

Built and maintained by **TheFallenStarGG**. Thanks to everyone who votes, reports bugs, and keeps their realms weird.

Not affiliated with Discord Inc. or top.gg beyond normal bot listing and voting.
