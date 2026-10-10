const { PermissionFlagsBits } = require('discord.js');
const {
  buildBoardEmbed,
  getBoardChannelId,
  refreshBoard,
} = require('../lib/realmBoard');

module.exports = {
  name: '!!board',
  aliases: ['!!realm', '!!today'],
  usage: '!!board',
  description:
    'Today in the Realm — weather, decrees, bounty, throne, market, and recent headlines. Optional living board: !!settings board #channel',
  access: 'free',

  async run(message, arg, ctx) {
    // Always allow a one-off snapshot in chat (spectator-friendly)
    const embed = buildBoardEmbed();

    const isAdmin =
      ctx.isOwner || message.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    const wantRefresh = ['refresh', 'update', 'post'].includes((arg || '').toLowerCase());

    if (isAdmin && wantRefresh) {
      if (!getBoardChannelId()) {
        return message.reply(
          'No realm board channel set. Use `!!settings board #channel` first.'
        );
      }
      const r = await refreshBoard(message.client);
      if (!r.ok) {
        return message.reply(
          `Could not update the board (${r.reason || 'error'}). Check channel permissions (View, Send, Embed Links).`
        );
      }
      return message.reply(
        r.edited
          ? 'Realm board message updated in place.'
          : 'Posted a new realm board message (and pinned it if I could).'
      );
    }

    return message.reply({ embeds: [embed] });
  },
};
