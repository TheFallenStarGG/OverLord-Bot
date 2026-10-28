const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { isDisabled } = require('./commandAccess');

const TERMS = 'https://thefallenstargg.github.io/Overlord-Website/terms.html';

/**
 * Each page is a theme. names = command names only.
 * Display is compact (usage + one line), not a huge embed field per command.
 */
const PAGES = [
  {
    key: 'start',
    emoji: '🏠',
    title: 'Start here',
    color: 0xd4af37,
    intro:
      'Prefix is `!!` (preferred). Slash is experimental.\n' +
      '`!!help <word>` searches · `!!help economy` jumps to a page · buttons flip pages.\n' +
      'New? `!!tutorial` · Admins? `!!tutorial admin`',
    names: ['!!tutorial', '!!help', '!!daily', '!!work', '!!balance', '!!invite', '!!support', '!!changelog'],
  },
  {
    key: 'earn',
    emoji: '🪙',
    title: 'Earn',
    color: 0xfee75c,
    intro: 'Honest money. Mostly.',
    names: ['!!daily', '!!work', '!!career', '!!fish', '!!mine', '!!quests', '!!tribute', '!!lottery', '!!vote', '!!legacy-commands'],
  },
  {
    key: 'spend',
    emoji: '🛒',
    title: 'Spend & gear',
    color: 0xe67e22,
    intro: 'Shop, craft, pets, inventory.',
    names: ['!!shop', '!!buy', '!!sell', '!!inventory', '!!use', '!!craft', '!!forge', '!!loadout', '!!pet'],
  },
  {
    key: 'risk',
    emoji: '🕵️',
    title: 'Risk & theft',
    color: 0xc0392b,
    intro: 'Rob, heist, bank, bounties. Protection items matter.',
    names: ['!!rob', '!!heist', '!!bank', '!!bounty', '!!give', '!!trade', '!!muscle', '!!spy'],
  },
  {
    key: 'market',
    emoji: '📈',
    title: 'Market',
    color: 0x2ecc71,
    intro: 'Stocks can crash. Don’t cry about it.',
    names: ['!!stocks', '!!invest', '!!cashout', '!!portfolio', '!!ipo', '!!project'],
  },
  {
    key: 'games',
    emoji: '🎮',
    title: 'Games',
    color: 0xeb459e,
    intro: 'Board and party games. Bets use server coins when enabled.',
    names: [
      '!!tictactoe',
      '!!connect4',
      '!!battleship',
      '!!wordle',
      '!!hangman',
      '!!minesweeper',
      '!!liarsdice',
      '!!blackjack',
      '!!higherlower',
    ],
  },
  {
    key: 'gamble',
    emoji: '🎰',
    title: 'Gambling',
    color: 0x9b59b6,
    intro: 'Pure chance. Admin can disable these in settings.',
    names: ['!!slots', '!!roulette', '!!crash', '!!gamble'],
  },
  {
    key: 'combat',
    emoji: '⚔️',
    title: 'Combat',
    color: 0xe74c3c,
    intro: 'Duels, bosses, raids, rankings.',
    names: ['!!duel', '!!boss', '!!stats', '!!ranked', '!!tournament', '!!raid', '!!raid-config'],
  },
  {
    key: 'campaign',
    emoji: '🗺️',
    title: 'Campaign',
    color: 0x1abc9c,
    intro:
      'Global map — one house per server. Cities, sieges, seasons, AI Shadow Court.\n' +
      'Full guide: `!!campaign help`',
    names: ['!!campaign'],
  },
  {
    key: 'realm',
    emoji: '🌍',
    title: 'Realm & seasons',
    color: 0x3498db,
    intro: 'Shared world flavor and competition between servers.',
    names: [
      '!!gazette',
      '!!forecast',
      '!!event',
      '!!decree',
      '!!rebellion',
      '!!usurper',
      '!!war',
      '!!season',
      '!!board',
      '!!economy',
    ],
  },
  {
    key: 'profile',
    emoji: '👤',
    title: 'You',
    color: 0x95a5a6,
    intro: 'Profile, ranks, privacy.',
    names: [
      '!!profile',
      '!!rank',
      '!!leaderboard',
      '!!globalleaderboard',
      '!!prestige',
      '!!optout',
      '!!optin',
      '!!deletedata',
      '!!webhide',
    ],
  },
  {
    key: 'server',
    emoji: '🛠️',
    title: 'Server admin',
    color: 0x57f287,
    intro: 'Manage Server (or equivalent) for most of these.',
    names: [
      '!!settings',
      '!!events-channel',
      '!!levelchannel',
      '!!reactionroles',
      '!!edittitles',
      '!!raid-config',
      '!!poll',
      '!!report',
      '!!feedback',
    ],
  },
  {
    key: 'utility',
    emoji: '🔧',
    title: 'Utility',
    color: 0xbdc3c7,
    intro: 'Small tools and links.',
    names: ['!!roll', '!!flip', '!!choose', '!!donate', '!!invite', '!!support', '!!changelog'],
  },
  {
    key: 'owner',
    emoji: '🔒',
    title: 'Owner',
    color: 0xed4245,
    intro: 'Bot owner only (`OWNER_ID`).',
    names: [
      '!!usage',
      '!!status',
      '!!models',
      '!!doctor',
      '!!bossspawn',
      '!!block',
      '!!unblock',
      '!!blacklist',
      '!!inbox',
      '!!raid-admin',
      '!!webexport',
      '!!full-logs',
      '!!bangifs',
    ],
  },
];

function shortLine(c) {
  const desc = String(c.description || '').replace(/\s+/g, ' ').trim();
  const one = desc.length > 90 ? desc.slice(0, 87) + '…' : desc;
  const usage = c.usage || c.name;
  return `**${usage}** — ${one || 'No description.'}`;
}

function buildPages(commands) {
  commands = new Map([...commands].filter(([, c]) => !isDisabled(c)));
  const mapped = new Set(PAGES.flatMap((p) => p.names));
  const pages = PAGES.map((p) => ({
    ...p,
    list: p.names.map((n) => commands.get(n)).filter(Boolean),
  }));

  const extra = [...commands.values()].filter((c) => !mapped.has(c.name) && !c.hidden);
  if (extra.length) {
    pages.push({
      key: 'more',
      emoji: '✨',
      title: 'More',
      color: 0x95a5a6,
      intro: 'Not filed above yet (usually new or rare commands).',
      list: extra,
    });
  }
  return pages.filter((p) => p.list.length);
}

function buildHelp(commands, client, requested, userId) {
  const pages = buildPages(commands);

  let page = 0;
  if (typeof requested === 'number' || /^\d+$/.test(String(requested))) {
    page = Number(requested);
  } else {
    const query = String(requested || '').toLowerCase();
    const found = pages.findIndex(
      (p) => p.key.startsWith(query) || p.title.toLowerCase().includes(query)
    );
    if (found !== -1) page = found;
  }
  page = Math.min(Math.max(page, 0), Math.max(pages.length - 1, 0));

  const current = pages[page] || pages[0];
  const tabs = pages.map((p, i) => (i === page ? `**${p.title}**` : p.title)).join(' · ');

  const body = current.list.map(shortLine).join('\n');
  const description = `${tabs}\n\n${current.intro}\n\n${body}`.slice(0, 4090);

  const embed = new EmbedBuilder()
    .setColor(current.color)
    .setTitle(`${current.emoji} ${current.title}`)
    .setDescription(description)
    .setFooter({
      text: `Page ${page + 1}/${pages.length} · !!help <search> · ${TERMS.replace('https://', '')}`,
    });

  const id = (action) => `help:${action}:${page}:${userId}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(id('prev'))
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(id('noop'))
      .setLabel(`${page + 1} / ${pages.length}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(id('next'))
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= pages.length - 1),
    new ButtonBuilder().setCustomId(id('close')).setLabel('Close').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setLabel('Terms').setStyle(ButtonStyle.Link).setURL(TERMS)
  );

  return { embeds: [embed], components: [row] };
}

function searchCommands(commands, query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  return [...commands.values()]
    .filter((c) => !c.hidden)
    .filter((c) => {
      const blob = `${c.name} ${(c.aliases || []).join(' ')} ${c.usage || ''} ${c.description || ''}`.toLowerCase();
      return blob.includes(q) || c.name.replace(/^!!/, '').includes(q);
    })
    .slice(0, 12);
}

module.exports = { buildHelp, searchCommands, PAGES };
