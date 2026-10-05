const { PermissionFlagsBits } = require('discord.js');
const { getChannel, setChannel, clearChannel } = require('../lib/announce');

module.exports = {
  name: '!!events-channel',
  usage: '!!events-channel [#channel | off]',
  description: 'Picks where I announce new updates with an @everyone ping. Needs Manage Server. Use it with no channel to see the current one, or `off` to stop.',
  access: 'free',

  async run(message, arg, ctx) {
    if (!message.guild) return message.reply('This only works in a server.');
    if (!ctx.isOwner && !message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('You need the **Manage Server** permission to change this.');
    }

    const current = getChannel(message.guild.id);
    if (!arg) {
      return message.reply(current ? `Updates are announced in <#${current}>.` : 'No updates channel set. Use `!!events-channel #channel`.');
    }

    if (arg === 'off') {
      clearChannel(message.guild.id);
      return message.reply('Update announcements are off.');
    }

    const id = (arg.match(/^<#(\d+)>$/) ?? arg.match(/^(\d{17,20})$/))?.[1];
    const channel = id && message.guild.channels.cache.get(id);
    if (!channel || !channel.isTextBased() || channel.isThread()) {
      return message.reply('Mention a text channel, like `!!events-channel #updates`.');
    }

    const perms = channel.permissionsFor(message.guild.members.me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return message.reply(`I need View Channel, Send Messages and Embed Links in ${channel}.`);
    }

    setChannel(message.guild.id, channel.id);
    const warn = perms.has(PermissionFlagsBits.MentionEveryone) ? '' : '\n⚠️ I don\'t have **Mention @everyone** there, so I won\'t be able to ping.';
    return message.reply(`Done. New updates will be announced in ${channel}.${warn}`);
  },
};
