const inbox = require('../lib/inbox');

module.exports = {
  name: '!!feedback',
  usage: '!!feedback <your idea or opinion>',
  description: 'Sends an idea, suggestion, or opinion straight to the bot owner. Your username and server name are included.',
  access: 'free',

  async run(message, arg, ctx) {
    if (!ctx.rawArg) return message.reply('What would you like to tell me? Usage: `!!feedback <your idea>`');
    const result = await inbox.submit(ctx.client, 'feedback', message, ctx.rawArg);
    if (result.error) return message.reply(result.error);
    return message.reply(`💡 Thanks for the feedback! It was sent to the bot owner. Reference: \`${result.id}\``);
  },
};
