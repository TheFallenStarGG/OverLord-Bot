const { sellItems, parseNameAndAmount } = require('../lib/inventory');

module.exports = {
  name: '!!sell',
  usage: '!!sell [item] [amount|all]',
  description: 'Sells the fish and ore you found. `!!sell all` sells everything, or pick one like `!!sell carp 3`.',
  access: 'free',

  async run(message, arg) {
    const { name, amount } = parseNameAndAmount(arg);
    const result = sellItems(message.author.id, name, amount);
    await message.reply(result.error ?? result.text);
  },
};
