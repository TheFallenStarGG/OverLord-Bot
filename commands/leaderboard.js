const { EmbedBuilder } = require('discord.js');
const { top, rankOf, levelFromXp, fmt } = require('../lib/economy');

const MEDALS = ['🥇', '🥈', '🥉'];
const place = (i) => MEDALS[i] ?? `**${i + 1}.**`;

module.exports = {
  name: '!!leaderboard',
  aliases: ['!!lb'],
  usage: '!!leaderboard',
  description: 'Shows this server\'s richest members and top chatters side by side.',
  access: 'free',

  async run(message) {
    const coins = top('coins', 10);
    const xp = top('xp', 10);
    if (!coins.length && !xp.length) {
      return message.reply('Nobody is on the board yet. Start chatting and claim your `!!daily`!');
    }

    const coinLines =
      coins.map((e, i) => `${place(i)} <@${e.id}>\n┗ ${fmt(e.value)}`).join('\n') || '*Nobody yet*';
    const xpLines =
      xp
        .map((e, i) => `${place(i)} <@${e.id}>\n┗ Lv **${levelFromXp(e.value)}** · ${e.value.toLocaleString('en-US')} XP`)
        .join('\n') || '*Nobody yet*';

    const me = message.author.id;
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🏆 Leaderboard')
      .setDescription('The richest and most active members.')
      .addFields(
        { name: '💰 Richest', value: coinLines, inline: true },
        { name: '📈 Top Chatters', value: xpLines, inline: true }
      )
      .setFooter({ text: `Your ranks: #${rankOf(me, 'coins')} in coins · #${rankOf(me, 'xp')} in XP` })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },
};
