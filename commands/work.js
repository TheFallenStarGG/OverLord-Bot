const work = require('../lib/work');
const { isLegacy } = require('../lib/legacyMode');
const { doWork, fmt } = require('../lib/economy');

module.exports = {
  name: '!!work',
  usage: '!!work [stats|top]',
  description:
    'Pick a shift and optional hustle check for coins. Career ladder still applies. `!!legacy-commands` switches to the classic one-message version.',
  access: 'free',

  async run(message, arg) {
    if (isLegacy(message.author.id) && !String(arg || '').trim()) {
      const result = doWork(message.author.id);
      if (!result.ok) return message.reply(`⏳ You're tired! You can work again <t:${result.nextTs}:R>.`);
      let text =
        `${result.career.emoji} As a **${result.career.name}**, you ${result.job} and earned **${fmt(result.amount)}**` +
        `${result.boosted ? ' ⚡ (boosted!)' : ''}.\nBalance: ${fmt(result.coins)}`;
      if (result.promoted) {
        text += `\n🎉 **Promotion!** You're now a ${result.promoted.emoji} **${result.promoted.name}** and earn ×${result.promoted.mult} pay!`;
      }
      return message.reply(text);
    }
    return work.run(message, arg);
  },
};
