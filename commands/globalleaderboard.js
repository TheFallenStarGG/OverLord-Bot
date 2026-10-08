const { EmbedBuilder } = require('discord.js');
const { allScoped } = require('../lib/storage');
const { levelFromXp, fmt } = require('../lib/economy');

const MEDALS = ['🥇', '🥈', '🥉'];
const place = (i) => MEDALS[i] ?? `**${i + 1}.**`;

// Adds up every player's coins and XP across all servers the bot is in
function totals(client) {
  const sums = new Map();
  for (const { guildId, data } of allScoped('economy')) {
    if (!client.guilds.cache.has(guildId)) continue;
    for (const [id, u] of Object.entries(data)) {
      const s = sums.get(id) ?? { coins: 0, xp: 0 };
      s.coins += u.coins ?? 0;
      s.xp += u.xp ?? 0;
      sums.set(id, s);
    }
  }
  return sums;
}

module.exports = {
  name: '!!globalleaderboard',
  aliases: ['!!glb', '!!global'],
  usage: '!!globalleaderboard',
  description: 'Shows the richest and most active players across every server, with each player\'s servers added together.',
  access: 'free',

  async run(message, arg, ctx) {
    const sums = totals(ctx.client);
    const rank = (field) =>
      [...sums].map(([id, s]) => ({ id, value: s[field] })).filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
    const coins = rank('coins');
    const xp = rank('xp');
    if (!coins.length && !xp.length) return message.reply('Nobody is on the global board yet.');

    const nameOf = async (id) => (await ctx.client.users.fetch(id).catch(() => null))?.username ?? 'Unknown player';
    const lines = async (list, text) =>
      (await Promise.all(list.slice(0, 10).map(async (e, i) => `${place(i)} ${await nameOf(e.id)}\n┗ ${text(e.value)}`))).join('\n') || '*Nobody yet*';

    const me = message.author.id;
    const rankOf = (list) => list.findIndex((e) => e.id === me) + 1 || list.length + 1;

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('🌍 Global Leaderboard')
      .setDescription('Everyone\'s coins and XP added up across every server.')
      .addFields(
        { name: '💰 Richest', value: await lines(coins, fmt), inline: true },
        { name: '📈 Top Chatters', value: await lines(xp, (v) => `Lv **${levelFromXp(v)}** · ${v.toLocaleString('en-US')} XP`), inline: true }
      )
      .setFooter({ text: `Your ranks: #${rankOf(coins)} in coins · #${rankOf(xp)} in XP` })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },
};
