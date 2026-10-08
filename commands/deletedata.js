const { PermissionFlagsBits } = require('discord.js');
const { requestConfirm } = require('../lib/confirm');
const { wipeGuild } = require('../lib/guildData');

module.exports = {
  name: '!!deletedata',
  usage: '!!deletedata',
  description:
    "Permanently erases ALL of this server's bot data (economy, stocks, pets, settings, everything). Needs Manage Server and a confirmation. This cannot be undone.",
  access: 'free',

  async run(message, arg, ctx) {
    // The bot owner can also wipe another server by ID: !!deletedata <serverId>
    const typed = ctx.rawArg.trim();
    const targetId = ctx.isOwner && /^\d{17,20}$/.test(typed) ? typed : message.guild?.id;
    if (!targetId) return message.reply('This only works in a server.');

    if (!ctx.isOwner && !message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('You need the **Manage Server** permission to delete this server\'s data.');
    }

    const here = targetId === message.guild?.id;
    requestConfirm(message.author.id, 'deletedata', async (msg) => {
      try {
        const result = await wipeGuild(targetId);
        return msg.reply(
          `🗑️ Done. All data for ${here ? 'this server' : `server \`${targetId}\``} was erased (${result.rows} records). ` +
            `${here ? 'Everyone starts fresh from now on.' : ''}`
        );
      } catch (err) {
        return msg.reply('I could not delete the data right now. Please try again in a moment.');
      }
    });

    return message.reply(
      `⚠️ This will **permanently erase everything** for ${here ? 'this server' : `server \`${targetId}\``}: coins, items, stocks, pets, settings, leaderboards. It cannot be undone.\n` +
        'Type **yes** within 30s to confirm, or **no** to cancel.'
    );
  },
};
