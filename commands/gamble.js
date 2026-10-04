const { peekUser, spendCoins, addCoins, parseBet, betError, fmt } = require('../lib/economy');

const WIN_CHANCE = 0.49;

module.exports = {
  name: '!!gamble',
  usage: '!!gamble <bet>',
  description: 'Double or nothing! Slightly under a 50% chance to win. Use `all` to bet everything.',
  access: 'free',

  async run(message, arg) {
    const bet = parseBet(arg.split(/\s+/)[0], peekUser(message.author.id).coins);
    const error = betError(message.author.id, bet);
    if (error) return message.reply(`${error}\nUsage: \`!!gamble <bet>\``);
    if (!spendCoins(message.author.id, bet)) return message.reply("You don't have enough coins.");

    const won = Math.random() < WIN_CHANCE;
    if (won) addCoins(message.author.id, bet * 2);

    await message.reply(
      `${won ? `🎲 **You won ${fmt(bet)}!**` : `🎲 **You lost ${fmt(bet)}.**`}\nBalance: ${fmt(peekUser(message.author.id).coins)}`
    );
  },
};
