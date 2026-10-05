const { buyItem, parseNameAndAmount } = require('../lib/inventory');

module.exports = {
  name: '!!buy',
  usage: '!!buy <item> [amount]',
  description: 'Buys something from the shop, like `!!buy padlock` or `!!buy lootbox 3`.',
  access: 'free',

  async run(message, arg) {
    const { name, amount } = parseNameAndAmount(arg);
    if (!name) return message.reply('What do you want to buy? Check `!!shop`, then try `!!buy <item> [amount]`.');

    const result = buyItem(message.author.id, name, amount);
    await message.reply(result.error ?? result.text);
  },
};
