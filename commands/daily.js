const { claimDaily, fmt } = require('../lib/economy');

module.exports = {
  name: '!!daily',
  usage: '!!daily',
  description: 'Claims your free coins for the day. Claiming on consecutive days builds a streak bonus.',
  access: 'free',

  async run(message) {
    const result = claimDaily(message.author.id);

    if (!result.ok) {
      return message.reply(`⏳ You already claimed today. Come back <t:${result.nextTs}:R>!`);
    }
    await message.reply(
      `🎁 You claimed **${fmt(result.amount)}**!\n🔥 Streak: **${result.streak}** day${result.streak === 1 ? '' : 's'} ` +
      `(the bonus grows for up to 11 days in a row)\nBalance: ${fmt(result.coins)}`
    );
  },
};
