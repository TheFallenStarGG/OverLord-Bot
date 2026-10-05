const { doWork, fmt } = require('../lib/economy');

module.exports = {
  name: '!!work',
  usage: '!!work',
  description: 'Do a job for coins, once a minute. The more you work, the higher you climb the career ladder and the better you get paid. See `!!career`.',
  access: 'free',

  async run(message) {
    const result = doWork(message.author.id);

    if (!result.ok) {
      return message.reply(`⏳ You're tired! You can work again <t:${result.nextTs}:R>.`);
    }

    let text =
      `${result.career.emoji} As a **${result.career.name}**, you ${result.job} and earned **${fmt(result.amount)}**` +
      `${result.boosted ? ' ⚡ (boosted!)' : ''}.\nBalance: ${fmt(result.coins)}`;
    if (result.promoted) {
      text += `\n🎉 **Promotion!** You're now a ${result.promoted.emoji} **${result.promoted.name}** and earn ×${result.promoted.mult} pay!`;
    }
    await message.reply(text);
  },
};
