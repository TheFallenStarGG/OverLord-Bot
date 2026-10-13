const rob = require('../lib/rob');
const { isLegacy } = require('../lib/legacyMode');
const { attemptRob, fmt, peekUser } = require('../lib/economy');

module.exports = {
  name: '!!rob',
  usage: '!!rob [@user] | stats | top | bribe',
  description:
    'Rob a player or NPC mark (methods, minigame, heat). `!!legacy-commands` uses the old simple !!rob @user roll.',
  access: 'free',

  async run(message, arg, ctx) {
    if (isLegacy(message.author.id)) {
      const target = message.mentions.users.first();
      if (!target) {
        return message.reply(
          '📜 **Legacy rob:** mention someone — `!!rob @user`.\n' +
            'For the full underworld menu, run `!!legacy-commands` to turn classic mode off.'
        );
      }
      if (target.bot || target.id === message.author.id) {
        return message.reply("You can't rob that.");
      }
      const result = attemptRob(message.author.id, target.id);
      if (result.error) return message.reply(result.error);
      if (result.blocked) return message.reply(result.blocked);
      if (result.success) {
        return message.reply(
          `🧤 You robbed **${target.username}** for **${fmt(result.amount)}**!\nYour balance: ${fmt(result.robberCoins)}`
        );
      }
      return message.reply(
        `🚔 Caught! You paid **${fmt(result.amount)}** to **${target.username}**.\nYour balance: ${fmt(peekUser(message.author.id).coins)}`
      );
    }
    return rob.run(message, arg, ctx);
  },
};
