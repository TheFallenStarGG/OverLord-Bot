const { randomInt } = require('crypto');

module.exports = {
  name: '!!flip',
  usage: '!!flip',
  description: 'Flips a coin.',
  access: 'free',

  async run(message) {
    await message.reply(`🪙 **${randomInt(2) === 0 ? 'Heads' : 'Tails'}**`);
  },
};
