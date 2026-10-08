const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const {
  settingsSummary,
  setGambling,
  setRob,
  setLevelChannelId,
  getChannel,
  setChannel,
  clearChannel,
} = require('../lib/serverSettings');

module.exports = {
  name: '!!settings',
  usage: '!!settings [gambling|rob|events|levels] [on|off|#channel]',
  description: 'Server setup for admins (Manage Server): view or change gambling, rob, events channel, and level-up channel.',
  access: 'free',

  async run(message, arg, ctx) {
    if (!message.guild) return message.reply('This only works in a server.');
    if (!ctx.isOwner && !message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('You need the **Manage Server** permission to change settings.');
    }

    const parts = (ctx.rawArg || arg || '').trim().split(/\s+/).filter(Boolean);
    const key = (parts[0] || '').toLowerCase();
    const val = (parts[1] || '').toLowerCase();

    if (!key) {
      const s = settingsSummary(message.guild.id);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`Settings — ${message.guild.name}`)
        .setDescription(
          [
            `**Gambling:** ${s.gambling ? 'on' : 'off'} · \`!!settings gambling on|off\``,
            `**Robbing:** ${s.rob ? 'on' : 'off'} · \`!!settings rob on|off\``,
            `**Events channel:** ${s.eventsChannelId ? `<#${s.eventsChannelId}>` : 'off'} · \`!!settings events #channel|off\``,
            `**Level-ups channel:** ${s.levelChannelId ? `<#${s.levelChannelId}>` : 'off'} · \`!!settings levels #channel|off\``,
            `**Custom shop titles:** ${s.customTitleCount} · \`!!edittitles\``,
            '',
            'Also: `!!tutorial admin` for first-time setup.',
          ].join('\n')
        );
      return message.reply({ embeds: [embed] });
    }

    if (key === 'gambling') {
      if (val !== 'on' && val !== 'off') return message.reply('Use `!!settings gambling on` or `off`.');
      setGambling(val === 'on');
      return message.reply(`Gambling is now **${val}**.`);
    }

    if (key === 'rob') {
      if (val !== 'on' && val !== 'off') return message.reply('Use `!!settings rob on` or `off`.');
      setRob(val === 'on');
      return message.reply(`Robbing is now **${val}**.`);
    }

    if (key === 'events' || key === 'event') {
      if (!val || val === 'off') {
        clearChannel(message.guild.id);
        return message.reply('Events channel is off.');
      }
      const id = (val.match(/^<#(\d+)>$/) ?? val.match(/^(\d{17,20})$/))?.[1];
      const channel = id && message.guild.channels.cache.get(id);
      if (!channel?.isTextBased()) return message.reply('Mention a text channel, like `!!settings events #updates`.');
      setChannel(message.guild.id, channel.id);
      return message.reply(`Events will post in ${channel}.`);
    }

    if (key === 'levels' || key === 'level' || key === 'levelchannel') {
      if (!val || val === 'off') {
        setLevelChannelId(null);
        return message.reply('Level-up messages are off.');
      }
      const id = (val.match(/^<#(\d+)>$/) ?? val.match(/^(\d{17,20})$/))?.[1];
      const channel = id && message.guild.channels.cache.get(id);
      if (!channel?.isTextBased()) return message.reply('Mention a text channel, like `!!settings levels #level-ups`.');
      setLevelChannelId(channel.id);
      return message.reply(`Level-ups will post in ${channel}.`);
    }

    return message.reply('Unknown setting. Try `!!settings` with no args for the list.');
  },
};
