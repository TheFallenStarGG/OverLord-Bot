const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const rr = require('../lib/reactionRoles');
const { startBuilder } = require('../lib/rrBuilder');

module.exports = {
  name: '!!reactionroles',
  aliases: ['!!rr', '!!reactionrole'],
  usage: '!!reactionroles [list|delete <message id>]',
  description: 'Admin (Manage Roles): build role panels with buttons, a dropdown or reactions. Create roles and colors in the builder.',
  access: 'free',

  async run(message, arg, ctx) {
    if (!message.guild) return message.reply('This only works in a server.');
    if (!ctx.isOwner && !message.member?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply('You need the **Manage Roles** permission to manage role panels.');
    }

    const me = await rr.getMe(message.guild);
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply(
        'I need the **Manage Roles** permission first. Give it to my role in **Server Settings → Roles**, and drag my role above the roles you want to hand out.'
      );
    }

    const parts = (ctx.rawArg || '').trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] || 'create').toLowerCase();

    if (sub === 'list') {
      const panels = rr.listPanels();
      const lines = panels.map(
        (p, i) =>
          `**${i + 1}.** [Jump to panel](https://discord.com/channels/${message.guild.id}/${p.channelId}/${p.messageId}) · ${rr.MODE_LABEL[p.mode]} · ${p.roles.length} role${p.roles.length === 1 ? '' : 's'}\nID: \`${p.messageId}\``
      );
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Role panels in this server')
        .setDescription((lines.join('\n\n') || 'None yet. Run `!!reactionroles` to build one.').slice(0, 4000));
      return message.reply({ embeds: [embed] });
    }

    if (sub === 'delete' || sub === 'remove') {
      const id = parts[1];
      if (!id || !/^\d{17,20}$/.test(id)) return message.reply('Usage: `!!reactionroles delete <message id>` (see `!!reactionroles list`).');
      const panel = rr.getPanel(id);
      if (!panel) return message.reply('I don\'t have a panel with that message ID in this server.');

      const channel = await message.guild.channels.fetch(panel.channelId).catch(() => null);
      const target = channel?.isTextBased() ? await channel.messages.fetch(id).catch(() => null) : null;
      rr.deletePanel(id);
      if (target) await target.delete().catch(() => {});
      return message.reply('🗑️ Panel removed. The roles themselves were not deleted.');
    }

    return startBuilder(message);
  },
};
