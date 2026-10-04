const { top, levelFromXp } = require('../lib/economy');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  name: '!!top',
  usage: '!!top',
  description: 'Shows the 10 members with the most XP.',
  access: 'free',

  async run(message) {
    const entries = top('xp', 10);
    if (!entries.length) return message.reply('Nobody has any XP yet. Start chatting!');

    const lines = entries.map(
      (e, i) => `${MEDALS[i] ?? `**${i + 1}.**`} <@${e.id}> — Level ${levelFromXp(e.value)} (${e.value.toLocaleString('en-US')} XP)`
    );
    await message.reply(`🏆 **Top chatters**\n${lines.join('\n')}`);
  },
};
