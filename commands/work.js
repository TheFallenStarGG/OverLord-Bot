const { doWork, fmt } = require('../lib/economy');

module.exports = {
  name: '!!work',
  usage: '!!work',
  description: 'Do a quick job for a few coins. You can work once a minute.',
  access: 'free',

  async run(message) {
    const result = doWork(message.author.id);

    if (!result.ok) {
      return message.reply(`⏳ You're tired! You can work again <t:${result.nextTs}:R>.`);
    }
    await message.reply(`💼 You ${result.job} and earned **${fmt(result.amount)}**.\nBalance: ${fmt(result.coins)}`);
  },
};
