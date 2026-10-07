const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

// Newest first. To add an update, copy an entry and put it at the TOP of this list.
const ENTRIES = [
      {
    emoji: '🌍',
    title: 'Ready for more servers',
    date: 'Oct 7, 2026',
    color: 0x3498db,
    summary: 'Progress now lives in a real database, and the AI chat has been retired.',
    sections: [
      {
        heading: '🔧 Changed',
        items: [
          'Coins, XP, and everything else are now saved in an online database, so they are much safer',
          'New updates are announced quietly, with no @everyone ping',
          'The Gazette, world events, and boss fights now appear in the channel picked with `!!events-channel`. Bosses only show up once a channel is set',
        ],
      },
      {
        heading: '🗑️ Removed',
        items: ['Chatting with the AI (`!!chat`, `!!endchat`, `!!retry`, `!!memory-wipe`) is gone. The AI now only writes the daily Gazette editorial'],
      },
    ],
  },
    {
    emoji: '🏢',
    title: 'Companies, spies, realm projects & Liar\'s Dice',
    date: 'Oct 6, 2026',
    color: 0x8e44ad,
    summary: 'Found your own company, spy on rivals, build things together, and bluff your friends.',
    sections: [
      {
        heading: '🏢 Player companies',
        items: [
          '`!!ipo found <SYMBOL> <name>` takes your own company public for 3,000 coins (level 5+). It shows up in `!!stocks` and anyone can `!!invest` in it',
          'The price follows how much richer you get compared to listing day, and drops if you stop playing. Trading fees on your shares go to you',
          'If a company is abandoned for 7 days or goes bankrupt, shareholders are paid out at the final price',
        ],
      },
      {
        heading: '🕵️ Spy network',
        items: [
          '`!!spy @user` costs 300 coins and reveals their wallet, guards, thieves, padlocks, and more. Only you can read the report',
          'A successful spy makes your next `!!rob` on that person 10% more likely to work. Guards make spies easier to catch, and caught spies are announced to everyone',
        ],
      },
      {
        heading: '🏗️ Realm projects',
        items: [
          'The whole server builds projects together with `!!project give` using coins and fish or ore. See progress with `!!project`',
          'Finished projects give everyone a permanent perk: better fishing and mining luck, more XP, better sell prices, bigger dailies, and bigger boss rewards',
        ],
      },
      {
        heading: '🎲 Liar\'s Dice',
        items: [
          '`!!liarsdice [bet]` opens a lobby for 2-5 players. Bid on how many dice are on the table, or call someone a liar',
          'Everyone has secret dice and loses one for every lost challenge. The last player standing wins the bets',
        ],
      },
    ],
  },
  {
    emoji: '📈',
    title: 'Stocks, weather & hired muscle',
    date: 'Oct 6, 2026',
    color: 0x2ecc71,
    summary: 'A living stock market, a changing sky, hired NPCs who work while you sleep, and a way to support the bot.',
    sections: [
      {
        heading: '📈 The stock market',
        items: [
          '8 stocks with prices that move every 5 minutes, with random swings, company news, and rare market-wide booms and crashes. See them with `!!stocks`',
          '`!!invest <symbol> <coins>` buys shares and `!!cashout <symbol>` sells them for coins (1% fee each way). `!!portfolio` shows your profit or loss',
          'Server events, weather, and decrees move some stocks. For example, Kraken Fisheries rises during Fishing Frenzy and falls in thunderstorms',
          'Coins invested in stocks are safe from `!!rob`, but prices can drop',
        ],
      },
      {
        heading: '🌦️ Living weather',
        items: [
          'The sky changes every 1-4 hours: clear, rain, thunderstorm, fog, heatwave, snow, and the rare rainbow. `!!forecast` shows what is coming next',
          'Weather changes fishing, mining, and robbing. Storms bring rare fish but slower, riskier casts, fog helps robbers, heatwaves slow mining, and rainbows boost your luck',
        ],
      },
      {
        heading: '🥷 Hired muscle',
        items: [
          '`!!muscle` lets you hire NPCs that work while you are offline. They cost daily upkeep',
          '**Guards** (Bouncer, Sellsword, Warden) make you harder to rob, up to 35% less likely to succeed against you',
          '**Thieves** (Pickpocket, Burglar, Mastermind) rob an active player every 3 hours and bring the loot to your stash (`!!muscle collect`). If one is caught, you pay damages and they go to jail for 6 hours',
          'Thieves are blocked by Padlocks and the Decree of Peace, and victims are left alone by thieves for 6 hours afterwards',
        ],
      },
      {
        heading: '💖 Donations',
        items: [
          '`!!donate` shows how to support the bot. Donations help increase the AI usage limit, so more people can chat with the Overlord each day',
          'The bot now shows its Cash App in its status: cash.app/$TheFallenStarGG',
          'Once in a while, a short donation reminder pops up after a command and deletes itself after 20 seconds. Donations are always welcome, but never expected',
        ],
      },
    ],
  },
              {
    emoji: '🔥',
    title: 'The Rebellion, bounties & the Gazette',
    date: 'Oct 6, 2026',
    color: 0xc0392b,
    summary: 'The realm now has a story: rise against the Overlord, hunt bounties, and read the daily news.',
    sections: [
      {
        heading: '🔥 The Rebellion',
        items: [
          'Every command you run and every boss fight you join fills the Rebellion meter. `!!rebellion` shows it',
          'When it\'s full, **the Overlord himself descends** as a giant raid boss. Whoever lands the final blow becomes the **Usurper** for 24 hours',
          'The Usurper can command one decree, collect a royal stipend, and shows off a 👑 on `!!profile` (`!!usurper`)',
          'Anyone can challenge the throne with `!!usurper challenge`, a best-of-3 duel on equal gear',
        ],
      },
      {
        heading: '🎯 Bounties',
        items: [
          'Every few hours the Overlord puts a bounty on an active player. Beat them in a `!!duel` to collect it (`!!bounty`)',
          'Targets who survive keep part of the reward, and more if they beat hunters',
        ],
      },
      {
        heading: '📰 The Gazette',
        items: ['A daily newspaper in the Overlord\'s voice, posted at 00:05 UTC with the richest player, biggest gains and losses, headlines, and the state of the realm. Read the latest with `!!gazette`'],
      },
    ],
  },
            {
    emoji: '🐾',
    title: 'Server events & pets',
    date: 'Oct 6, 2026',
    color: 0x9b59b6,
    summary: 'Surprise events pop up every day or so, and you can now adopt a pet.',
    sections: [
      {
        heading: '🎪 Server events',
        items: [
          'Random events start every day or so: Fishing Frenzy, Mining Rush, XP Surge, Gold Rush, Flash Sale, and Boss Rush',
          'Each event has a limited-time title in `!!shop` that you keep forever once bought',
          '`!!event` shows what\'s running right now',
        ],
      },
      {
        heading: '🐾 Pets',
        items: [
          '`!!pet adopt` gets you a random pet for 1,500 coins, from common Dogs and Cats up to a legendary Dragon',
          'Feed your pet fish from `!!fish` to level it up. It evolves at level 10, and its perks get 50% stronger',
          'Every pet gives a small perk, like more work pay, better fishing luck, bonus XP, better sell prices, bigger daily rewards, or extra boss damage',
          'A hungry pet stops helping until you feed it. Play with it once an hour for a little XP',
          '`!!pet @user` shows someone else\'s pet, and `!!profile` now shows yours',
        ],
      },
    ],
  },
          {
    emoji: '👑',
    title: 'Trading, profiles & the Overlord\'s decrees',
    date: 'Oct 5, 2026',
    color: 0xf1c40f,
    summary: 'Swap items safely, show off your profile, and win the Overlord\'s favor.',
    sections: [
      {
        heading: '✨ New',
        items: [
          '`!!trade @user` opens a safe two-sided trade window for coins, fish, ores, materials, supplies, and forged gear',
          '`!!profile [@user]` (or `!!me`) shows your level, coins, career, gear, combat record, and ranked ratings',
          '`!!tribute <amount>` pays the Overlord for a random outcome, from disdain to blessings, curses, and jackpots',
          'The Overlord now issues **decrees** every few hours, like double work pay, double XP, or no robbing. `!!decree` shows what\'s active',
          'Every tribute fills a shared treasury. When it\'s full, everyone gets a free decree',
        ],
      },
    ],
  },
        {
    emoji: '🎲',
    title: 'Crash, roulette & more games',
    date: 'Oct 5, 2026',
    color: 0x9b59b6,
    summary: 'Four new ways to play, and a way to share your coins.',
    sections: [
      {
        heading: '✨ New',
        items: [
          '`!!crash [bet]` is a climbing multiplier. Cash out before the rocket crashes',
          '`!!roulette <bet> <choice>` opens a shared table for 20 seconds, so everyone can bet before the wheel spins',
          '`!!higherlower [bet]` (or `!!hl`) is a card streak game where you cash out before you slip',
          '`!!hangman` is a co-op word game. Anyone can guess, and the solver wins coins',
          '`!!give @user <amount>` sends coins to a friend',
        ],
      },
    ],
  },
      {
    emoji: '⚔️',
    title: 'Combat overhaul',
    date: 'Oct 5, 2026',
    color: 0xe74c3c,
    summary: 'Duels and boss fights were rebuilt, with weapons, armor, and crafting.',
    sections: [
      {
        heading: '✨ New',
        items: [
          'Duels now use **classes** (Warrior, Rogue, Mage, Cleric) and **secret simultaneous moves**: Attack, Defend, or Feint, plus class specials and battle items',
          'Random arenas, status effects, spectator cheering, best of 3 (`bo3`), rematches, and `!!duel @user ranked` for equal-gear ladder fights',
          '`!!forge` crafts weapons (Sword, Dagger, Hammer, Bow) and armor from your ores and boss drops, and enchants weapons with elements',
          '`!!loadout` equips your gear, class, 3 battle items, skins, and titles. `!!stats` shows your combat record',
          'New Battle Supplies page in the shop: potions, smoke bombs, bombs, antidotes, and adrenaline',
          '`!!tournament` runs a weekly bracket with an entry fee and prizes',
        ],
      },
      {
        heading: '🔧 Changed',
        items: [
          'Boss fights have **weaknesses**, an **enrage** phase, telegraphed attacks you must **Block**, class abilities, and materials, skins, and titles as drops',
          'Boss rewards now split between damage (60%) and number of hits (40%), so big swords can\'t take everything',
        ],
      },
    ],
  },
    {
    emoji: '🏅',
    title: 'Quests, prestige & ranked',
    date: 'Oct 4, 2026',
    color: 0xe74c3c,
    summary: 'Reasons to keep playing, and a ladder to climb.',
    sections: [
      {
        heading: '✨ New',
        items: [
          '`!!quests` gives you 3 daily and 2 weekly goals that pay coins (and Loot Boxes)',
          '`!!prestige` resets your level for a permanent +5% coin bonus, a badge, and a reward',
          '`!!ranked` tracks ratings for duels, Connect Four, and Battleship, with monthly seasons and prizes for the top 3',
        ],
      },
    ],
  },
  {
    emoji: '🐉',
    title: 'Bosses, heists & minesweeper',
    date: 'Oct 4, 2026',
    color: 0xed4245,
    summary: 'Group content and a new solo game.',
    sections: [
      {
        heading: '✨ New',
        items: [
          'Rare raid bosses appear while people chat, and everyone can fight them together (`!!boss`)',
          '`!!heist` lets a crew team up for a big payout, at the risk of a fine',
          '`!!minesweeper [bet] [mines]` is a button grid where you cash out before hitting a mine',
        ],
      },
    ],
  },
  {
    emoji: '🛒',
    title: 'Shop, careers & gathering',
    date: 'Oct 4, 2026',
    color: 0xe67e22,
    summary: 'Lots of new ways to earn and spend coins.',
    sections: [
      {
        heading: '✨ New',
        items: [
          '`!!shop`, `!!buy`, `!!sell`, `!!inventory`, and `!!use`, with boosts, padlocks, lockpicks, gear upgrades, titles, and a daily 20% deal',
          '`!!fish` and `!!mine` find loot to sell, and better gear finds rarer things',
          '`!!lottery` has a shared daily pot, drawn at midnight UTC',
          '`!!career` shows your job ladder. Working more gets you promoted to higher pay',
        ],
      },
      {
        heading: '🔧 Changed',
        items: ['`!!work` pay now depends on your career, and `!!rob` can be blocked by a Padlock'],
      },
    ],
  },
  {
    emoji: '🧾',
    title: 'Neater logs & changelog',
    date: 'Oct 4, 2026',
    color: 0x5865f2,
    summary: 'The bot\'s logs got a makeover, and you can now browse updates with `!!changelog`.',
    sections: [
      {
        heading: '✨ New',
        items: ['`!!changelog` shows what has been added, one update per page (you\'re using it right now!)'],
      },
      {
        heading: '🎨 Changed',
        items: [
          'Log channel entries are now color-coded cards with labeled fields (user, where, model, and more)',
          'Console logs now have a timestamp and an aligned level, with errors showing full details underneath',
        ],
      },
    ],
  },
  {
    emoji: '🚢',
    title: 'Battleship',
    date: 'Oct 4, 2026',
    color: 0x3498db,
    summary: 'The classic naval game, played with buttons and pop-up forms.',
    sections: [
      {
        heading: '✨ New',
        items: [
          '`!!battleship [@user] [bet]` challenges a friend, with an optional coin bet',
          'Both players pick the board size (10×10 or 8×8), and the game starts once you pick the same one',
          'Place your ships by hand in private by typing a start square and direction, like `B3 H` (there\'s also a 🎲 Random button)',
          'Take turns firing by typing squares like `C4`',
          'Leave out the player (or mention the bot) to play a solo practice round against the bot, with no coins at stake',
        ],
      },
      {
        heading: '🔧 Changed',
        items: ['Added to the Games page of `!!help`'],
      },
    ],
  },
  {
    emoji: '💰',
    title: 'Work, Rob & leaderboard',
    date: 'Oct 4, 2026',
    color: 0xfee75c,
    summary: 'Two new ways to get (or lose) coins, and a better leaderboard.',
    sections: [
      {
        heading: '✨ New',
        items: [
          '`!!work` earns 15-45 coins, once a minute',
          '`!!rob @user` tries to steal 10-30% of their coins. It works 45% of the time, and if you\'re caught you pay them the same amount',
          'Both people need at least 100 coins to rob, there\'s a 5 minute cooldown, and robbed players are protected for 30 minutes',
        ],
      },
      {
        heading: '🔧 Changed',
        items: [
          '`!!leaderboard` now shows the richest members and top chatters side by side in one card',
          '`!!lb` works as a shortcut for `!!leaderboard`, and `!!top` was merged into it',
          'Commands can now have alternate names, called aliases',
        ],
      },
    ],
  },
  {
    emoji: '📖',
    title: 'Help redesign',
    date: 'Oct 4, 2026',
    color: 0x57f287,
    summary: '`!!help` is now a book you flip through instead of one long message.',
    sections: [
      {
        heading: '🔧 Changed',
        items: [
          '`!!help` now has pages with Back, Next, and Close buttons',
          'Commands are grouped into AI & Chat, Games, Economy, Fun & Useful, and Owner only',
          'Jump straight to a page with `!!help games` or `!!help owner`',
          'New commands show up automatically on a "More" page',
        ],
      },
    ],
  },
];

// requested = page number (starting at 0, newest update first)
function buildChangelog(requested, userId) {
  const total = ENTRIES.length;
  const page = Math.min(Math.max(Number(requested) || 0, 0), total - 1);
  const entry = ENTRIES[page];

  const tabs = ENTRIES.map((e, i) => (i === page ? `**${e.emoji}**` : e.emoji)).join('  ·  ');
  const label = page === 0 ? 'Latest update' : `Update #${total - page}`;

  const embed = new EmbedBuilder()
    .setColor(entry.color ?? 0x5865f2)
    .setTitle(`${entry.emoji} ${entry.title}`)
    .setDescription(`${tabs}\n\n**${label}** · ${entry.date}\n${entry.summary}`)
    .addFields(
      entry.sections.map((s) => ({
        name: s.heading,
        value: s.items.map((item) => `• ${item}`).join('\n').slice(0, 1024),
      }))
    )
    .setFooter({ text: `Page ${page + 1} of ${total} · newest first` });

  const id = (action) => `changelog:${action}:${page}:${userId}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id('prev')).setEmoji('◀️').setLabel('Newer').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(id('noop')).setLabel(`${page + 1} / ${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(id('next')).setEmoji('▶️').setLabel('Older').setStyle(ButtonStyle.Primary).setDisabled(page === total - 1),
    new ButtonBuilder().setCustomId(id('close')).setEmoji('✖️').setLabel('Close').setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

const entryId = (entry) => `${entry.date}|${entry.title}`;

// The card posted when a new update is announced (no buttons)
function buildAnnouncement(entry) {
  return new EmbedBuilder()
    .setColor(entry.color ?? 0x5865f2)
    .setTitle(`${entry.emoji} ${entry.title}`)
    .setDescription(`**New update** · ${entry.date}\n${entry.summary}`)
    .addFields(
      entry.sections.map((s) => ({
        name: s.heading,
        value: s.items.map((item) => `• ${item}`).join('\n').slice(0, 1024),
      }))
    )
    .setFooter({ text: 'See older updates with !!changelog' });
}

module.exports = { buildChangelog, buildAnnouncement, entryId, ENTRIES };
