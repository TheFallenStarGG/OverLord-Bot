const { peekUser, rankOf, fmt } = require('../lib/economy');

module.exports = {
  name: '!!balance',
  usage: '!!balance [@user]',
  description: 'Shows your coin balance, or someone else\'s.',
  access: 'free',

  async run(message) {
    const target = message.mentions.users.first() ?? message.author;
    if (target.bot) return message.reply("Bots don't carry coins.");

    const coins = peekUser(target.id).coins;
    await message.reply(
      `🪙 **${target.username}** has **${fmt(coins)}**\n-# #${rankOf(target.id, 'coins')} on \`!!leaderboard\``
    );
  },
};
