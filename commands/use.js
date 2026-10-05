const { useItem, parseNameAndAmount } = require('../lib/inventory');

module.exports = {
  name: '!!use',
  usage: '!!use <item> [amount]',
  description: 'Uses an item from your inventory: boosts, Loot Boxes (`!!use lootbox 3`), or equips a title.',
  access: 'free',

  async run(message, arg) {
    const { name, amount } = parseNameAndAmount(arg);
    if (!name) return message.reply('What do you want to use? Try `!!use <item>`. See `!!inventory` for what you have.');

    const result = useItem(message.author.id, name, amount);
    await message.reply(result.error ?? result.text);
  },
};
