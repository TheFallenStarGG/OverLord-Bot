const optOutLib = require('../lib/optOut');
const { logging } = require('../lib/logging');

module.exports = {
  name: '!!optin',
  aliases: ['!!opt-in'],
  description: 'Opt back into the bot after !!optout (fresh start in this server).',
  usage: '!!optin',
  access: 'free',
  async run(message) {
    if (!message.guild) return message.reply('This only works in a server.');

    if (!optOutLib.isOptedOut(message.author.id)) {
      return message.reply('You are not opted out here.');
    }

    optOutLib.optIn(message.author.id);
    logging('info', 'User opted in', `${message.author.tag} (${message.author.id}) in ${message.guild.name}`);
    return message.reply(
      '✅ Welcome back. You start fresh in this server.\nTry `!!tutorial` or `!!daily`.'
    );
  },
};
