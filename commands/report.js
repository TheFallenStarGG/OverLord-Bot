const inbox = require('../lib/inbox');

module.exports = {
  name: '!!report',
  usage: '!!report <what went wrong>',
  description: 'Sends a bug or a problem (like a broken command or someone abusing the bot) straight to the bot owner. Your username and server name are included.',
  access: 'free',

  async run(message, arg, ctx) {
    if (!ctx.rawArg) return message.reply('Tell me what went wrong! Usage: `!!report <what happened>`');
    const result = await inbox.submit(ctx.client, 'report', message, ctx.rawArg);
    if (result.error) return message.reply(result.error);
    return message.reply(`✅ Thanks! Your report was sent to the bot owner. Reference: \`${result.id}\``);
  },
};
