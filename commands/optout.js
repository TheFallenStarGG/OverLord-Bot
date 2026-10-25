const { requestConfirm } = require('../lib/confirm');
const optOutLib = require('../lib/optOut');
const { wipeUserInGuild } = require('../lib/userWipe');
const { logging } = require('../lib/logging');

module.exports = {
  name: '!!optout',
  aliases: ['!!opt-out'],
  description: 'Opt out of the bot in this server (deletes your data here).',
  usage: '!!optout',
  access: 'free',
  async run(message) {
    if (!message.guild) return message.reply('This only works in a server.');

    if (optOutLib.isOptedOut(message.author.id)) {
      return message.reply('You are already opted out here. Use `!!optin` to come back (you start from zero).');
    }

    requestConfirm(message.author.id, 'optout', async (msg) => {
      try {
        wipeUserInGuild(message.guild.id, message.author.id);
        optOutLib.optOut(message.author.id);
        logging('warn', 'User opted out', `${message.author.tag} (${message.author.id}) in ${message.guild.name}`);
        return msg.reply(
          '✅ You are opted out in **this server**.\n' +
            '• Coins, bank, items, stocks, muscle, and related data **here** were deleted.\n' +
            '• The bot will ignore you until you use `!!optin`.\n' +
            '• Other servers are unchanged.'
        );
      } catch {
        return msg.reply('Something went wrong deleting your data. Try again in a moment.');
      }
    });

    return message.reply(
      '⚠️ **Opt out of The Overlord in this server?**\n\n' +
        'This **permanently deletes** your coins, bank, items, stocks, and other progress **in this server**. It cannot be undone.\n' +
        'You will also stop being targeted for bounties / bot attention here.\n\n' +
        'Type **yes** within 30s to confirm, or **no** to cancel.'
    );
  },
};
