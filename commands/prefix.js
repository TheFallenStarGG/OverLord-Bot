const { PermissionFlagsBits } = require('discord.js');
const prefixLib = require('../lib/prefix');

module.exports = {
  name: '!!prefix',
  usage: '!!prefix [new prefix | reset]',
  description: 'Show or change this server’s command prefix (Manage Server). !!help always works.',
  access: 'free',
  noSlash: true,

  async run(message, arg, ctx) {
    if (!message.guild) return message.reply('Prefixes are per server, so use this inside a server.');
    const current = prefixLib.get();
    const raw = String(ctx.rawArg || '').trim().replace(/^set\s+/i, '');

    if (!raw) {
      return message.reply(
        `This server’s prefix is \`${current}\`${current === prefixLib.DEFAULT ? ' (the default)' : ''}.\n` +
          'Admins can change it with `!!prefix <new prefix>` or put it back with `!!prefix reset`. `!!help` always works, whatever the prefix is.'
      );
    }

    const isAdmin = ctx.isOwner || message.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    if (!isAdmin) return message.reply('🔒 You need **Manage Server** to change the prefix.');

    if (/^reset$/i.test(raw) || raw === prefixLib.DEFAULT) {
      prefixLib.set(null);
      return message.reply('✅ Prefix reset to `!!`. Try `!!daily`.');
    }

    const problem = prefixLib.validate(raw);
    if (problem) return message.reply(problem);

    prefixLib.set(raw);
    return message.reply(
      `✅ Prefix changed to \`${raw}\`. Commands now look like \`${raw}daily\`.\n` +
        '`!!help` still works everywhere and shows the current prefix if anyone forgets it.'
    );
  },
};
