const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { COOLDOWN_MS } = require('../config');

// The pages, in order. "names" lists the commands shown on each page.
const PAGES = [
  {
    key: 'ai',
    emoji: '🤖',
    title: 'AI & Chat',
    color: 0x5865f2,
    intro: 'Ping me to chat! I answer using free AI models.',
    names: ['!!chat', '!!endchat', '!!retry'],
  },
  {
    key: 'combat',
    emoji: '⚔️',
    title: 'Combat',
    color: 0xe74c3c,
    intro: 'Duels, bosses, gear, and glory. Forge weapons from your ores, then put them to the test.',
    names: ['!!duel', '!!boss', '!!loadout', '!!forge', '!!stats', '!!ranked', '!!tournament'],
  },
  {
    key: 'games',
    emoji: '🎮',
    title: 'Games',
    color: 0xeb459e,
    intro: 'Challenge a friend or play solo. Bets use your 🪙 coins.',
    names: ['!!tictactoe', '!!connect4', '!!battleship', '!!blackjack', '!!minesweeper', '!!wordle', '!!slots', '!!gamble', '!!heist', '!!crash', '!!roulette', '!!higherlower', '!!hangman'],
  },
  {
    key: 'economy',
    emoji: '💰',
    title: 'Economy',
    color: 0xfee75c,
    intro: 'Earn coins, climb the ranks, or take a risk and steal some.',
    names: ['!!balance', '!!daily', '!!work', '!!career', '!!rob', '!!give', '!!trade', '!!tribute', '!!decree', '!!event', '!!quests', '!!prestige', '!!lottery', '!!leaderboard', '!!rank', '!!profile'],
  },
  {
    key: 'shop',
    emoji: '🛒',
    title: 'Shop & Loot',
    color: 0xe67e22,
    intro: 'Buy upgrades, go fishing or mining, and sell what you find.',
    names: ['!!shop', '!!buy', '!!sell', '!!inventory', '!!use', '!!fish', '!!mine'],
  },
  {
    key: 'fun',
    emoji: '🎲',
    title: 'Fun & Useful',
    color: 0x57f287,
    intro: 'Handy little tools for your server.',
    names: ['!!poll', '!!roll', '!!flip', '!!choose', '!!changelog', '!!help', '!!events-channel'],
  },
  {
    key: 'owner',
    emoji: '🔒',
    title: 'Owner only',
    color: 0xed4245,
    intro: 'Only the bot owner can use these. Set the `OWNER_ID` environment variable to lock them to you.',
    names: ['!!usage', '!!status', '!!models', '!!history', '!!doctor', '!!bossspawn', '!!memory-wipe', '!!block', '!!unblock'],
  },
];

function buildPages(commands) {
  const mapped = new Set(PAGES.flatMap((p) => p.names));
  const pages = PAGES.map((p) => ({ ...p, list: p.names.map((n) => commands.get(n)).filter(Boolean) }));

  // Any command that isn't on a page above (like a new one you add) goes on a "More" page
  const extra = [...commands.values()].filter((c) => !mapped.has(c.name));
  if (extra.length) {
    pages.push({ key: 'more', emoji: '✨', title: 'More', color: 0x95a5a6, intro: 'Everything else.', list: extra });
  }
  return pages.filter((p) => p.list.length || p.key === 'ai');
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
  if (current.key === 'ai') {
    fields.push({
      name: `@${client.user.username} <message>`,
      value:
        `Ask the AI anything. Attach images, or reply to a message to give it context. Each person has a ${COOLDOWN_MS / 1000}s cooldown.\n` +
        'Use the buttons under my answers to rate (👍/👎), retry (🔁), or delete (🗑️) them.',
    });
  }
  for (const c of current.list) {
    const alias = c.aliases?.length ? `\n_Also works as: ${c.aliases.join(', ')}_` : '';
    fields.push({ name: c.usage, value: `${c.description}${alias}`.slice(0, 1024) });
  }

  const embed = new EmbedBuilder()
    .setColor(current.color)
    .setTitle(`${current.emoji} ${current.title}`)
    .setDescription(`${tabs}\n\n${current.intro}`)
    .addFields(fields)
    .setFooter({ text: `Page ${page + 1} of ${pages.length} · Try !!help ${current.key === 'owner' ? 'combat' : 'owner'} to jump to a page` });

  const id = (action) => `help:${action}:${page}:${userId}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id('prev')).setEmoji('◀️').setLabel('Back').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(id('noop')).setLabel(`${page + 1} / ${pages.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(id('next')).setEmoji('▶️').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page === pages.length - 1),
    new ButtonBuilder().setCustomId(id('close')).setEmoji('✖️').setLabel('Close').setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = { buildHelp };
