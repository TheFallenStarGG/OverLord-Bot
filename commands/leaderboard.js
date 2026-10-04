const { top, fmt } = require('../lib/economy');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  name: '!!leaderboard',
  usage: '!!leaderboard',
  description: 'Shows the 10 richest members.',
  access: 'free',

  async run(message) {
    const entries = top('coins', 10);
    if (!entries.length) return message.reply('Nobody has any coins yet.');

    const lines = entries.map((e, i) => `${MEDALS[i] ?? `**${i + 1}.**`} <@${e.id}> — ${fmt(e.value)}`);
    await message.reply(`🏦 **Richest members**\n${lines.join('\n')}`);
  },
};
