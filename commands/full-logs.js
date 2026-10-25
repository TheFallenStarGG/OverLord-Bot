const { PermissionFlagsBits } = require('discord.js');
const consoleMirror = require('../lib/consoleMirror');

module.exports = {
  name: 'full-logs',
  aliases: ['fulllogs', 'console-logs'],
  description: 'Owner only: set the channel for the full raw console mirror (or turn it off).',
  usage: '!!full-logs [#channel|off]',
  access: 'free',
  async run(message, ctx) {
    if (!ctx.isOwner) return;

    const usage = 'Usage: `!!full-logs #channel` · `!!full-logs off` · `!!full-logs` (status)';
    const arg = (ctx.rawArg || '').trim();

    if (!arg) {
      const id = consoleMirror.getChannelId();
      return message.reply(
        id
          ? `🖥 **Full console mirror** is on → <#${id}>\nRaw stdout/stderr/console lines are batched here. The normal log channel is unchanged.`
          : `🖥 **Full console mirror** is off.\n${usage}`
      );
    }

    if (arg.toLowerCase() === 'off') {
      consoleMirror.setChannelId(null);
      return message.reply('🔕 Full console mirror turned **off**. Normal logs are unchanged.');
    }

    const id = (arg.match(/^<#(\d+)>$/) ?? arg.match(/^(\d{17,20})$/))?.[1];
    if (!id) return message.reply(`Mention a channel or paste its ID.\n${usage}`);

    const channel = await ctx.client.channels.fetch(id).catch(() => null);
    if (!channel?.isTextBased?.()) {
      return message.reply("I can't find that text channel (or I can't see it).");
    }

    const perms = channel.guild ? channel.permissionsFor(channel.guild.members.me) : null;
    if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return message.reply('I need **View Channel** and **Send Messages** there.');
    }

    try {
      await channel.send(
        '✅ **Full console mirror** enabled here.\nEverything from the process console will be posted in this channel (batched). The normal activity log is separate.'
      );
    } catch {
      return message.reply("I couldn't post in that channel, so I didn't save it.");
    }

    consoleMirror.setChannelId(id);
    return message.reply(`Done. Full raw console → <#${id}>. Normal logs stay on the old channel.`);
  },
};
