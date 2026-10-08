const { PermissionFlagsBits } = require('discord.js');
const { data, saveNow } = require('../lib/world');

module.exports = {
  name: '!!levelchannel',
  aliases: ['!!level-channel'],
  usage: '!!levelchannel [#channel | off]',
  description: 'Picks where level-up messages are posted in this server. Needs Manage Server. Use it with no channel to see the current one, or off to stop them.',
  access: 'free',

  async run(message, arg, ctx) {
    if (!message.guild) return message.reply('This only works in a server.');
    if (!ctx.isOwner && !message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('You need the **Manage Server** permission to change this.');
    }

    const current = data.settings.levelChannelId;
    if (!arg) {
      return message.reply(current ? `Level-ups are posted in <#${current}>.` : 'Level-up messages are off. Use `!!levelchannel #channel` to turn them on.');
    }

    if (arg === 'off') {
      data.settings.levelChannelId = null;
      saveNow();
      return message.reply('Level-up messages are off.');
    }

    const id = (arg.match(/^<#(\d+)>$/) ?? arg.match(/^(\d{17,20})$/))?.[1];
    const channel = id && message.guild.channels.cache.get(id);
    if (!channel || !channel.isTextBased() || channel.isThread()) {
      return message.reply('Mention a text channel, like `!!levelchannel #level-ups`.');
    }

    const perms = channel.permissionsFor(message.guild.members.me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return message.reply(`I need View Channel and Send Messages in ${channel}.`);
    }

    data.settings.levelChannelId = channel.id;
    saveNow();
    return message.reply(`Done! Level-up messages will be posted in ${channel}.`);
  },
};
