const { retry } = require('../lib/chat');

module.exports = {
  name: '!!retry',
  usage: '!!retry',
  description: 'Answers the last question in this channel again with a different model.',
  access: 'free',

  async run(message, arg, ctx) {
    const error = await retry(message, message.author, ctx.isOwner);
    if (error) await message.reply(error);
  },
};
