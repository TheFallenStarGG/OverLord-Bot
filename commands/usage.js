const { usageMessage } = require('../lib/usage');

module.exports = {
  name: '!!usage',
  usage: '!!usage',
  description: "Shows today's free requests used, requests in the last minute, and when the count resets.",
  access: 'owner',

  async run(message) {
    await message.reply(usageMessage());
  },
};
