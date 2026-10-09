const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { isDisabled } = require('./commandAccess');

// The pages, in order. "names" lists the commands shown on each page.
const PAGES = [  
  {
    key: 'combat',
    emoji: '⚔️',
    title: 'Combat',
    color: 0xe74c3c,
    intro: 'Duels, bosses, gear, and glory. Forge weapons from your ores, then put them to the test.',
    names: ['!!duel', '!!boss', '!!rebellion', '!!usurper', '!!bounty', '!!loadout', '!!forge', '!!stats', '!!ranked', '!!tournament'],
  },
  {
    key: 'games',
    emoji: '🎮',
    title: 'Games',
    color: 0xeb459e,
    intro: 'Challenge a friend or play solo. Bets use your 🪙 coins.',
    names: ['!!tictactoe', '!!connect4', '!!battleship', '!!blackjack', '!!minesweeper', '!!wordle', '!!slots', '!!gamble', '!!heist', '!!crash', '!!roulette', '!!higherlower', '!!hangman', '!!liarsdice'],
  },
  {
    key: 'economy',
    emoji: '💰',
    title: 'Economy',
    color: 0xfee75c,
    intro: 'Earn coins, climb the ranks, or take a risk and steal some.',
    names: ['!!balance', '!!daily', '!!work', '!!career', '!!rob', '!!give', '!!trade', '!!tribute', '!!decree', '!!event', '!!quests', '!!prestige', '!!lottery', '!!leaderboard', '!!season', '!!war', '!!rank', '!!profile'],
  },
  {
    key: 'market',
    emoji: '📈',
    title: 'Market & World',
    color: 0x2ecc71,
    intro: 'Invest in the stock market, watch the weather, and hire muscle that works while you are offline.',
    names: ['!!stocks', '!!invest', '!!cashout', '!!portfolio', '!!ipo', '!!forecast', '!!muscle', '!!spy', '!!project'],
  },
  {
    key: 'shop',
    emoji: '🛒',
    title: 'Shop & Loot',
    color: 0xe67e22,
    intro: 'Buy upgrades, go fishing or mining, and sell what you find.',
    names: ['!!shop', '!!buy', '!!sell', '!!inventory', '!!use', '!!fish', '!!mine', '!!pet'],
  },
  {
    key: 'fun',
    emoji: '🎲',
    title: 'Fun & Useful',
    color: 0x57f287,
    intro: 'Handy little tools for your server.',
    names: ['!!poll', '!!roll', '!!flip', '!!choose', '!!changelog', '!!gazette', '!!help', '!!events-channel', '!!donate', '!!levelchannel', '!!settings', '!!tutorial', '!!edittitles', '!!invite', '!!support', '!!deletedata', '!!report', '!!feedback'],
  },
  {
    key: 'owner',
    emoji: '🔒',
    title: 'Owner only',
    color: 0xed4245,
    intro: 'Only the bot owner can use these. Set the `OWNER_ID` environment variable to lock them to you.',
    names: ['!!usage', '!!status', '!!models', '!!doctor', '!!bossspawn', '!!block', '!!unblock', '!!blacklist', '!!inbox'],
  },
];

function buildPages(commands) {
  commands = new Map([...commands].filter(([, c]) => !isDisabled(c)));
  const mapped = new Set(PAGES.flatMap((p) => p.names));
  const pages = PAGES.map((p) => ({ ...p, list: p.names.map((n) => commands.get(n)).filter(Boolean) }));

  
  // Any command that isn't on a page above (like a new one you add) goes on a "More" page
  const extra = [...commands.values()].filter((c) => !mapped.has(c.name));
  if (extra.length) {
    pages.push({ key: 'more', emoji: '✨', title: 'More', color: 0x95a5a6, intro: 'Everything else.', list: extra });
  }
  return pages.filter((p) => p.list.length);
}

// requested = a page number (starting at 0) or a page name like "games"
function buildHelp(commands, client, requested, userId) {
  const pages = buildPages(commands);

  let page = 0;
  if (typeof requested === 'number' || /^\d+$/.test(String(requested))) {
    page = Number(requested);
  } else {
    const query = String(requested).toLowerCase();
    const found = pages.findIndex((p) => p.key.startsWith(query) || p.title.toLowerCase().includes(query));
    if (found !== -1) page = found;
  }
  page = Math.min(Math.max(page, 0), pages.length - 1);

  const current = pages[page];
  const tabs = pages.map((p, i) => (i === page ? `**${p.emoji} ${p.title}**` : p.emoji)).join('  ·  ');

  const fields = [];
  for (const c of current.list) {
    const alias = c.aliases?.length ? `\n_Also works as: ${c.aliases.join(', ')}_` : '';
    fields.push({ name: c.usage, value: `${c.description}${alias}`.slice(0, 1024) });
  }

    const embed = new EmbedBuilder()
    .setColor(current.color)
    .setTitle(`${current.emoji} ${current.title}`)
    .setDescription(`${tabs}\n\n${current.intro}`)
    .addFields(fields)
    .setFooter({
      text: `Page ${page + 1} of ${pages.length} · Terms: https://thefallenstargg.github.io/Overlord-ToS/terms.html`,
    });

  const id = (action) => `help:${action}:${page}:${userId}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id('prev')).setEmoji('◀️').setLabel('Back').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(id('noop')).setLabel(`${page + 1} / ${pages.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(id('next')).setEmoji('▶️').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page === pages.length - 1),
    new ButtonBuilder().setCustomId(id('close')).setEmoji('✖️').setLabel('Close').setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setLabel('Terms')
      .setStyle(ButtonStyle.Link)
      .setURL('https://thefallenstargg.github.io/Overlord-ToS/terms.html')
  );

  return { embeds: [embed], components: [row] };
}

function searchCommands(commands, query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  return [...commands.values()]
    .filter((c) => c.access === 'free' || true) // show all; owner cmds still gated when run
    .filter((c) => {
      const blob = `${c.name} ${(c.aliases || []).join(' ')} ${c.usage || ''} ${c.description || ''}`.toLowerCase();
      return blob.includes(q) || c.name.replace(/^!!/, '').includes(q);
    })
    .slice(0, 10);
}

module.exports = { buildHelp, searchCommands };
