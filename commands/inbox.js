const { PermissionFlagsBits } = require('discord.js');
const inbox = require('../lib/inbox');
const { logging } = require('../lib/logging');

const describe = async (client, id) => {
  if (!id) return '*not set*';
  const channel = await client.channels.fetch(id).catch(() => null);
  return channel ? `<#${id}>${channel.guild ? ` in **${channel.guild.name}**` : ''}` : `\`${id}\` *(I can't reach it)*`;
};

module.exports = {
  name: '!!inbox',
  usage: '!!inbox [report|feedback|both] [#channel|channel id|off]',
  description: 'Owner only. Picks the channel where `!!report` and `!!feedback` messages are sent. It can be in any server the bot is in. Use it with no options to see the current channels.',
  access: 'owner',

  async run(message, arg, ctx) {
    if (!ctx.isOwner) return;
    const usage = 'Usage: `!!inbox report #channel` · `!!inbox feedback #channel` · `!!inbox both #channel` · `!!inbox report off`';
    const [which, target] = ctx.rawArg.split(/\s+/).filter(Boolean);

    if (!which) {
      return message.reply(
        `📨 **Report inbox:** ${await describe(ctx.client, inbox.getChannelId('report'))}\n💡 **Feedback inbox:** ${await describe(ctx.client, inbox.getChannelId('feedback'))}\n${usage}`
      );
    }

    const choice = which.toLowerCase();
    const kinds = choice === 'both' ? ['report', 'feedback'] : Object.hasOwn(inbox.KINDS, choice) ? [choice] : null;
    if (!kinds || !target) return message.reply(usage);

    if (target.toLowerCase() === 'off') {
      kinds.forEach((k) => inbox.clearChannelId(k));
      return message.reply(`🔕 Turned off: ${kinds.join(' and ')}. Players will be told it isn't being collected.`);
    }

    const id = (target.match(/^<#(\d+)>$/) ?? target.match(/^(\d{17,20})$/))?.[1];
    if (!id) return message.reply(`Mention a channel or paste its ID. ${usage}`);

    const channel = await ctx.client.channels.fetch(id).catch(() => null);
    if (!channel?.isTextBased()) return message.reply("I can't find that text channel. Make sure I'm in that server and can see it.");

    const perms = channel.guild ? channel.permissionsFor(channel.guild.members.me) : null;
    if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return message.reply('I need **View Channel**, **Send Messages** and **Embed Links** in that channel.');
    }

    try {
      await channel.send(`✅ ${kinds.map((k) => inbox.KINDS[k].label + 's').join(' and ')} will arrive in this channel.`);
    } catch {
      return message.reply("I couldn't post in that channel, so I didn't save it.");
    }

    kinds.forEach((k) => inbox.setChannelId(k, id));
    logging('info', 'Inbox channel set', `${kinds.join(', ')} → ${id}`);
    return message.reply(`Done! ${kinds.join(' and ')} will be sent to <#${id}>.`);
  },
};
