const { attemptRob, ROB, fmt } = require('../lib/economy');

module.exports = {
  name: '!!rob',
  usage: '!!rob @user',
  description:
    `Try to steal ${ROB.MIN_PERCENT}-${ROB.MAX_PERCENT}% of someone's coins. You have a ${Math.round(ROB.SUCCESS_CHANCE * 100)}% chance to pull it off, ` +
    `but if you're caught you pay them the same amount. Both of you need at least ${ROB.MIN_COINS} coins. ` +
    `${ROB.COOLDOWN_MS / 60000} minute cooldown, and robbed players are protected for ${ROB.PROTECTION_MS / 60000} minutes. ` +
    'A Lockpick (`!!use lockpick`) helps you, and a Padlock protects you.',
  access: 'free',

  async run(message) {
    const target = message.mentions.users.first();
    if (!target) return message.reply('Who do you want to rob? Usage: `!!rob @user`');
    if (target.bot) return message.reply("Bots don't carry any coins.");
    if (target.id === message.author.id) return message.reply("You can't rob yourself!");

    const result = attemptRob(message.author.id, target.id);
    if (result.error) return message.reply(result.error);

    const pick = result.usedLockpick ? ' 🪛 (your lockpick was used up)' : '';

    if (result.blocked) {
      return message.reply(`🔒 <@${target.id}> had a **Padlock**! Your robbery failed and their lock broke. You pay nothing.${pick}`);
    }
    if (result.success) {
      return message.reply(
        `🦹 You snuck up on <@${target.id}> and stole **${fmt(result.amount)}** (${result.percent}% of their coins)!${pick}\n` +
        `Balance: ${fmt(result.robberCoins)}`
      );
    }
    await message.reply(
      `🚔 You got caught trying to rob <@${target.id}>! You had to pay them **${fmt(result.amount)}**.${pick}\n` +
      `Balance: ${fmt(result.robberCoins)}`
    );
  },
};
