const { ChannelType, PermissionFlagsBits } = require('discord.js');
const raid = require('../lib/raid');

function findCategory(guild, text) {
  const id = (text.match(/^<#(\d+)>$/) ?? text.match(/^(\d{17,20})$/))?.[1];
  if (id) {
    const c = guild.channels.cache.get(id);
    return c?.type === ChannelType.GuildCategory ? c : null;
  }
  const name = text.toLowerCase();
  return guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === name) ?? null;
}

module.exports = {
  name: '!!raid-config',
  usage: '!!raid-config [category <name or #category> | category reset | optout | optin | ping <role> | ping off]',
  description:
    'Admin settings for cross-server raids (needs Manage Server). Pick the category raid channels are created in, add a role to ping, or opt the whole server out of raids.',
  access: 'free',

  async run(message, arg, ctx) {
    if (!message.guild) return message.reply('This only works in a server.');
    if (!ctx.isOwner && !message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('You need the **Manage Server** permission to change raid settings.');
    }

    const cfg = raid.cfgOf(message.guild.id);
    const words = (ctx.rawArg ?? '').split(/\s+/).filter(Boolean);
    const sub = (words[0] ?? '').toLowerCase();
    const rest = words.slice(1).join(' ').trim();

    if (!sub || sub === 'status') {
      return message.reply(
        `**Raids in this server:** ${cfg.off ? '🚫 opted out' : '✅ on (default)'}\n` +
          `**Category:** ${cfg.categoryId ? `<#${cfg.categoryId}>` : 'made automatically when a raid starts'}\n` +
          `**Ping role:** ${cfg.pingRole ? `<@&${cfg.pingRole}>` : 'none'}\n\n` +
          'Change it with `!!raid-config category <name or id>`, `ping <role>`, or `optout` / `optin`.'
      );
    }

    if (sub === 'optout') {
      cfg.off = true;
      raid.save();
      return message.reply('🚫 This server has opted out of raids. Nobody here can be matched, and the bot will not open raid channels. Turn it back on with `!!raid-config optin`.');
    }
    if (sub === 'optin') {
      delete cfg.off;
      raid.save();
      return message.reply('✅ This server takes part in raids again.');
    }

    if (sub === 'category') {
      if (!rest) return message.reply('Tell me the category: `!!raid-config category <name or id>`, or `category reset` to let me make one.');
      if (rest.toLowerCase() === 'reset') {
        delete cfg.categoryId;
        raid.save();
        return message.reply('Okay. I will create a **⚔️ Raids** category the next time a raid starts.');
      }
      const category = findCategory(message.guild, rest);
      if (!category) return message.reply("I couldn't find a category like that. Use its exact name or its ID (a category, not a channel).");
      const perms = category.permissionsFor(message.guild.members.me);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) {
        return message.reply(`I need **View Channel** and **Manage Channels** in **${category.name}** to create raid channels there.`);
      }
      cfg.categoryId = category.id;
      raid.save();
      return message.reply(`Done! Raid channels will be created in **${category.name}**. They copy that category's permissions, but only players who join a raid can talk.`);
    }

    if (sub === 'ping') {
      if (rest.toLowerCase() === 'off') {
        delete cfg.pingRole;
        raid.save();
        return message.reply('Raid pings are off.');
      }
      const id = (rest.match(/^<@&(\d+)>$/) ?? rest.match(/^(\d{17,20})$/))?.[1];
      const role = id && message.guild.roles.cache.get(id);
      if (!role) return message.reply('Mention a role, like `!!raid-config ping @Raiders`, or use `ping off`.');
      cfg.pingRole = role.id;
      raid.save();
      return message.reply(`I will ping ${role.name} when a raid starts (the role must be mentionable, or I need the Mention Everyone permission).`);
    }

    return message.reply('Options: `category <name or id>`, `category reset`, `ping <role>`, `ping off`, `optout`, `optin`.');
  },
};
