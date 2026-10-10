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
const access = require('../lib/commandAccess');

const parseChannelId = (text) => (String(text ?? '').match(/^<#(\d+)>$/) ?? String(text ?? '').match(/^(\d{17,20})$/))?.[1] ?? null;

// Finds the first channel mention or ID anywhere in the words
function findChannel(parts, guild) {
  for (const part of parts) {
    const id = parseChannelId(part);
    const channel = id && guild.channels.cache.get(id);
    if (channel) return channel;
  }
  return null;
}

// Text channels and categories can both carry a rule (a category covers every channel inside it)
const usableChannel = (c) => Boolean(c && (c.isTextBased() || c.type === 4));

function findCommand(ctx, text) {
  const clean = String(text ?? '').toLowerCase().replace(/^[!/]+/, '');
  if (!clean) return null;
  const key = `!!${clean}`;
  const direct = ctx.commands.get(key);
  if (direct) return direct;
  return [...ctx.commands.values()].find((c) => (c.aliases ?? []).some((a) => a.toLowerCase() === key)) ?? null;
}

function listText(items, max = 12) {
  if (!items.length) return 'none';
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} (+${items.length - max} more)` : shown;
}

module.exports = {
  name: '!!settings',
  usage: '!!settings [gambling|rob|events|levels|board|command|ignore|unignore|games] [on|off|add|remove|#channel]',
  description:
    'Server setup for admins (Manage Server): gambling, rob, events and level-up channels, turning commands off, ignored channels, and games-only channels.',
  access: 'free',

  async run(message, arg, ctx) {
    if (!message.guild) return message.reply('This only works in a server.');
    if (!ctx.isOwner && !message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('You need the **Manage Server** permission to change settings.');
    }

    const parts = (ctx.rawArg || arg || '').trim().split(/\s+/).filter(Boolean);
    const key = (parts[0] || '').toLowerCase();
    const val = (parts[1] || '').toLowerCase();
    const guild = message.guild;

    if (!key) {
      access.pruneMissing(guild);
      const s = settingsSummary(guild.id);
      const disabled = access.disabledCommands().map((n) => `\`!!${n}\``);
      const ignored = access.ignoredChannels().map((id) => `<#${id}>`);
      const games = access.gameChannels().map((id) => `<#${id}>`);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`Settings — ${guild.name}`)
        .setDescription(
          [
            `**Gambling:** ${s.gambling ? 'on' : 'off'} · \`!!settings gambling on|off\``,
            `**Robbing:** ${s.rob ? 'on' : 'off'} · \`!!settings rob on|off\``,
            `**Events channel:** ${s.eventsChannelId ? `<#${s.eventsChannelId}>` : 'off'} · \`!!settings events #channel|off\``,
            `**Level-ups channel:** ${s.levelChannelId ? `<#${s.levelChannelId}>` : 'off'} · \`!!settings levels #channel|off\``,
            `**Realm board:** ${s.boardChannelId ? `<#${s.boardChannelId}>` : 'off'} · \`!!settings board #channel|off\``,
            `**Custom shop titles:** ${s.customTitleCount} · \`!!edittitles\``,
            '',
            `**Turned-off commands:** ${listText(disabled)} · \`!!settings command <name> on|off\``,
            `**Ignored channels:** ${listText(ignored)} · \`!!settings ignore #channel\` / \`unignore #channel\``,
            `**Games only in:** ${games.length ? listText(games) : 'everywhere'} · \`!!settings games add|remove|clear #channel\``,
            '',
            'Ignored channels (or categories) are silent and give no XP. Admins can still run commands there.',
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
        clearChannel(guild.id);
        return message.reply('Events channel is off.');
      }
      const id = (val.match(/^<#(\d+)>$/) ?? val.match(/^(\d{17,20})$/))?.[1];
      const channel = id && guild.channels.cache.get(id);
      if (!channel?.isTextBased()) return message.reply('Mention a text channel, like `!!settings events #updates`.');
      setChannel(guild.id, channel.id);
      return message.reply(`Events will post in ${channel}.`);
    }

    if (key === 'levels' || key === 'level' || key === 'levelchannel') {
      if (!val || val === 'off') {
        setLevelChannelId(null);
        return message.reply('Level-up messages are off.');
      }
      const id = (val.match(/^<#(\d+)>$/) ?? val.match(/^(\d{17,20})$/))?.[1];
      const channel = id && guild.channels.cache.get(id);
      if (!channel?.isTextBased()) return message.reply('Mention a text channel, like `!!settings levels #level-ups`.');
      setLevelChannelId(channel.id);
      return message.reply(`Level-ups will post in ${channel}.`);
    }

    // ----- Realm board (single updating "Today in the Realm" message) -----
    if (key === 'board' || key === 'realmboard' || key === 'realm-board' || key === 'today') {
      const { setBoardChannel, clearBoardChannel, refreshBoard, getBoardChannelId } = require('../lib/realmBoard');

      if (val === 'off' || val === 'clear' || val === 'none') {
        clearBoardChannel();
        return message.reply('Realm board turned **off**. The old message stays unless you delete it.');
      }

      const channel =
        message.mentions.channels.first() ||
        guild.channels.cache.get(parts[1]) ||
        null;

      if (!channel?.isTextBased()) {
        const current = getBoardChannelId();
        return message.reply(
          current
            ? `Realm board is ${current ? `<#${current}>` : 'off'}. Use \`!!settings board #channel\` or \`off\`.\nThis posts **one** message there and **edits it** over time (not a feed).`
            : 'Use `!!settings board #channel` to post a living **Today in the Realm** message, or `off` to disable.'
        );
      }

      const perms = channel.permissionsFor(message.client.user);
      if (
        !perms?.has([
          require('discord.js').PermissionFlagsBits.ViewChannel,
          require('discord.js').PermissionFlagsBits.SendMessages,
          require('discord.js').PermissionFlagsBits.EmbedLinks,
        ])
      ) {
        return message.reply(
          `I need **View Channel**, **Send Messages**, and **Embed Links** in ${channel}.`
        );
      }

      setBoardChannel(channel.id);
      const r = await refreshBoard(message.client);
      if (!r.ok) {
        return message.reply(
          `Channel saved, but I couldn't post yet (${r.reason}). Fix permissions, then \`!!board refresh\`.`
        );
      }
      return message.reply(
        `Realm board set to ${channel}. I'll keep **one** message updated there (weather, decrees, bounty, throne, market, chronicles).\nAnyone can peek anytime with \`!!board\`.`
      );
    }
    
    // ----- Turn commands on or off: !!settings command rob off -----
    if (key === 'command' || key === 'commands' || key === 'cmd') {
      const name = parts[1];
      const state = (parts[2] || '').toLowerCase();
      if (!name) {
        const disabled = access.disabledCommands().map((n) => `\`!!${n}\``);
        return message.reply(`Turned-off commands: ${listText(disabled, 30)}\nUse \`!!settings command <name> on|off\`.`);
      }
      const command = findCommand(ctx, name);
      if (!command || command.access !== 'free') return message.reply(`I don't have a command called \`${name}\`.`);
      if (access.isProtected(command)) {
        return message.reply(`\`${command.name}\` can't be turned off, so you can always manage the bot.`);
      }
      if (state !== 'on' && state !== 'off') return message.reply(`Use \`!!settings command ${name} on\` or \`off\`.`);
      access.setCommandEnabled(command, state === 'on');
      return message.reply(`\`${command.name}\` is now **${state}** in this server.`);
    }

    // ----- Ignore channels: !!settings ignore #channel / unignore #channel -----
    if (key === 'ignore' || key === 'unignore') {
      access.pruneMissing(guild);
      const channel = findChannel(parts.slice(1), guild);
      if (!channel) {
        const ignored = access.ignoredChannels().map((id) => `<#${id}>`);
        return message.reply(
          `Ignored channels: ${listText(ignored, 30)}\nUse \`!!settings ignore #channel\` or \`!!settings unignore #channel\` (a category works too).`
        );
      }
      if (!usableChannel(channel)) return message.reply('Pick a text channel or a category.');
      if (key === 'unignore') {
        access.setChannelIgnored(channel.id, false);
        return message.reply(`I'll listen in ${channel} again.`);
      }
      if (!access.setChannelIgnored(channel.id, true)) return message.reply('That is the most ignored channels I can keep (50).');
      return message.reply(`I'll stay silent in ${channel} and it won't earn XP. Admins can still use commands there.`);
    }

    // ----- Games-only channels: !!settings games add|remove|clear #channel -----
    if (key === 'games' || key === 'game' || key === 'gameschannel') {
      access.pruneMissing(guild);
      const action = val;
      if (!action || action === 'list') {
        const games = access.gameChannels().map((id) => `<#${id}>`);
        return message.reply(
          games.length
            ? `Games only work in ${listText(games, 30)}.\nUse \`!!settings games add|remove #channel\` or \`clear\`.`
            : 'Games work in every channel. Use `!!settings games add #channel` to limit them.'
        );
      }
      if (action === 'clear') {
        access.clearGameChannels();
        return message.reply('Games work in every channel again.');
      }
      if (action !== 'add' && action !== 'remove') return message.reply('Use `!!settings games add #channel`, `remove #channel`, or `clear`.');
      const channel = findChannel(parts.slice(2), guild);
      if (!usableChannel(channel)) return message.reply(`Mention a text channel or category, like \`!!settings games ${action} #casino\`.`);
      if (action === 'remove') {
        access.removeGameChannel(channel.id);
        return message.reply(`Games are no longer limited to ${channel}.`);
      }
      if (!access.addGameChannel(channel.id)) return message.reply('You can pick up to 10 games channels.');
      return message.reply(`Games now work in ${channel}. Outside the games channels they're blocked for regular members.`);
    }

    return message.reply('Unknown setting. Try `!!settings` with no args for the list.');
  },
};
