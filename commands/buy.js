const { buyItem, parseNameAndAmount } = require('../lib/inventory');
const { itemDef } = require('../lib/items');

module.exports = {
  name: '!!buy',
  usage: '!!buy <item> [amount]',
  description: 'Buys something from the shop, like `!!buy padlock` or `!!buy lootbox 3`.',
  access: 'free',

  async run(message, arg) {
    const { name, amount } = parseNameAndAmount(arg);
    if (!name) return message.reply('What do you want to buy? Check `!!shop`, then try `!!buy <item> [amount]`.');

    const result = buyItem(message.author.id, name, amount);
    if (result.error) return message.reply(result.error);

    // If they bought a title linked to a Discord role, try to give that role
    if (result.titleId && message.member) {
      const def = itemDef(result.titleId);
      if (def?.roleId) {
        await message.member.roles.add(def.roleId).catch(() => {});
      }
    }

    return message.reply(result.text);
  },
};
