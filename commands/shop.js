const { buildShop } = require('../lib/shopPages');

module.exports = {
  name: '!!shop',
  usage: '!!shop',
  description: 'Browse the shop: supplies, gear upgrades, and titles. One item is 20% off every day!',
  access: 'free',

  async run(message) {
    await message.reply(buildShop(0, message.author.id));
  },
};
