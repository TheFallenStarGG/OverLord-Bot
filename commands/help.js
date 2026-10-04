const { buildHelp } = require('../lib/helpPages');

module.exports = {
  name: '!!help',
  usage: '!!help [page]',
  description: 'Opens the command list. Flip through the pages with the buttons, or jump straight to one, like `!!help games`.',
  access: 'free',

  async run(message, arg, ctx) {
    await message.reply(buildHelp(ctx.commands, ctx.client, arg || 0, message.author.id));
  },
};
