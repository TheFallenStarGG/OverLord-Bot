const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

// Newest first. To add an update, copy an entry and put it at the TOP of this list.
const ENTRIES = [
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

module.exports = { buildChangelog };
