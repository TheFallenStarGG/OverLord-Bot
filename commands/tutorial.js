const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const USER_PAGES = [
  {
    title: 'Welcome',
    body:
      'I\'m **The Overlord** — economy, games, and server events.\n\n' +
      '• Commands start with `!!` (preferred over slash)\n' +
      '• Start with `!!daily`, `!!work`, and `!!balance`\n' +
      '• See everything: `!!help` · search: `!!help rob`',
  },
  {
    title: 'Earn & spend',
    body:
      '• `!!daily` — once per day (streaks help)\n' +
      '• `!!work` — short cooldown job pay\n' +
      '• `!!shop` / `!!buy` — items, gear, titles\n' +
      '• `!!fish` / `!!mine` — gather and sell loot\n' +
      '• Coins are **per server** and have **no real-world value**',
  },
  {
    title: 'Games & combat',
    body:
      '• Friendly games: `!!wordle`, `!!tictactoe`, `!!connect4`, …\n' +
      '• Betting games may be disabled by admins (`!!settings`)\n' +
      '• Combat: `!!duel`, `!!boss`, `!!loadout`, `!!forge`\n' +
      '• Profile: `!!rank`, `!!profile`, `!!quests`',
  },
  {
    title: 'World Campaign',
    body:
      'Servers share **one** map. Your server is one house.\n\n' +
      '• `!!campaign map` — the world\n' +
      '• `!!campaign recruit <province> <n>` — claim empty land\n' +
      '• `!!campaign siege <from> <city>` — take cities (need all of them to own a province)\n' +
      '• `!!campaign collect` — city taxes from the house treasury\n' +
      '• Seasons reset the map; top houses get treasury prizes\n' +
      'More: `!!campaign help`',
  },
  {
    title: 'Vote (free coins)',
    body:
      'The bot is on top.gg.\n\n' +
      '• Vote: https://top.gg/bot/1555446743515144232/vote\n' +
      '• Then `!!vote` once every 12 hours for coins (and a short earn buff)\n' +
      'Optional. No paywall.',
  },
  {
    title: 'Rules of the realm',
    body:
      '• Don\'t abuse bugs or spam commands\n' +
      '• Prefix (`!!`) is the supported way to play\n' +
      '• Terms: https://thefallenstargg.github.io/Overlord-Website/terms.html\n' +
      '• Admins: run `!!tutorial admin` for setup',
  },
];

const ADMIN_PAGES = [
  {
    title: 'Admin setup',
    body:
      'You need **Manage Server** for these.\n\n' +
      '1. `!!settings events #channel` — Gazette, bosses, decrees\n' +
      '2. `!!settings levels #channel` — level-up messages (or leave off)\n' +
      '3. `!!settings` — review gambling / rob toggles\n' +
      '4. Optional: `!!edittitles` — shop titles tied to Discord roles',
  },
  {
    title: 'Permissions',
    body:
      'The bot needs in its channels:\n' +
      'View Channel · Send Messages · Embed Links · Read History · Add Reactions\n\n' +
      'For role titles: **Manage Roles**, and my highest role must sit **above** the titles I assign.',
  },
  {
    title: 'Going live',
    body:
      '• Tell members: `!!tutorial` and `!!help`\n' +
      '• Turn off gambling/rob if your community doesn\'t want them\n' +
      '• Terms & Privacy: https://thefallenstargg.github.io/Overlord-ToS/\n' +
      '• Slash commands exist but are experimental — prefer `!!`',
  },
];

function build(pages, page, userId, mode) {
  const i = Math.min(Math.max(page, 0), pages.length - 1);
  const p = pages[i];
  const embed = new EmbedBuilder()
    .setColor(mode === 'admin' ? 0xe67e22 : 0x5865f2)
    .setTitle(`${mode === 'admin' ? '🛠️' : '📖'} Tutorial — ${p.title}`)
    .setDescription(p.body)
    .setFooter({ text: `Page ${i + 1}/${pages.length} · !!tutorial${mode === 'admin' ? ' admin' : ''}` });

  const id = (action) => `tutorial:${mode}:${action}:${i}:${userId}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id('prev')).setLabel('Back').setStyle(ButtonStyle.Secondary).setDisabled(i === 0),
    new ButtonBuilder().setCustomId(id('next')).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(i === pages.length - 1),
    new ButtonBuilder().setCustomId(id('close')).setLabel('Close').setStyle(ButtonStyle.Danger)
  );
  return { embeds: [embed], components: [row] };
}

module.exports = {
  name: '!!tutorial',
  usage: '!!tutorial [admin]',
  description: 'Guided intro for new players, or `!!tutorial admin` for first-time server setup.',
  access: 'free',

  async run(message, arg) {
    const mode = String(arg || '').includes('admin') ? 'admin' : 'user';
    const pages = mode === 'admin' ? ADMIN_PAGES : USER_PAGES;
    return message.reply(build(pages, 0, message.author.id, mode));
  },
};

// Button handler lives in events/tutorial.js
module.exports.buildTutorial = build;
module.exports.USER_PAGES = USER_PAGES;
module.exports.ADMIN_PAGES = ADMIN_PAGES;
