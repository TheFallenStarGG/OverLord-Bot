const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { fmt } = require('../lib/economy');
const {
  getMode,
  setMode,
  statusSnapshot,
  isScarce,
  TAX_BRACKETS,
} = require('../lib/economyMode');
const treasury = require('../lib/treasury');

module.exports = {
  name: '!!economy',
  aliases: ['!!treasury', '!!econ'],
  usage: '!!economy [status | mode classic|scarce]',
  description:
    'Shows this server’s economy mode and realm treasury. Admins can switch `classic` (default, open minting) or `scarce` (wages paid from the treasury, wealth tax).',
  access: 'free',

  async run(message, arg, ctx) {
    if (!message.guild) return message.reply('This only works in a server.');
    const parts = String(arg || '').trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] || 'status').toLowerCase();

    if (sub === 'mode' || sub === 'set') {
      const admin =
        ctx.isOwner || message.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
      if (!admin) return message.reply('You need **Manage Server** to change the economy mode.');
      const val = (parts[1] || '').toLowerCase();
      if (val !== 'classic' && val !== 'scarce') {
        return message.reply(
          'Usage: `!!economy mode classic` or `!!economy mode scarce`\n' +
            '**classic** (default) — jobs and rewards can mint coins.\n' +
            '**scarce** — job rewards come from the realm treasury; progressive wealth tax funds it.'
        );
      }
      const mode = setMode(val);
      if (mode === 'scarce') {
        return message.reply(
          `🏛️ Economy mode is now **scarce**.\n` +
            `• Work / daily / similar rewards are paid from the **treasury** (may pay less if the reserve is low).\n` +
            `• Progressive **wealth tax** runs about once a day on large wallets → treasury.\n` +
            `• Rob protection is weaker for the ultra-rich.\n` +
            `Treasury: **${fmt(treasury.getReserve())}**\n` +
            `Admins: \`!!economy mode classic\` to go back.`
        );
      }
      return message.reply('🏛️ Economy mode is now **classic** (default open minting). Treasury still exists but wages mint again.');
    }

    const s = statusSnapshot();
    const embed = new EmbedBuilder()
      .setColor(s.mode === 'scarce' ? 0xc0392b : 0x2ecc71)
      .setTitle(`Economy — ${message.guild.name}`)
      .setDescription(
        s.mode === 'scarce'
          ? '**Scarce mode** — rewards are paid from the realm treasury when possible. Large fortunes are taxed into the reserve.'
          : '**Classic mode** (default) — jobs and rewards may mint new coins. Toggle scarce with `!!economy mode scarce` (Manage Server).'
      )
      .addFields(
        { name: 'Mode', value: `\`${s.mode}\``, inline: true },
        { name: 'Treasury', value: `**${fmt(s.reserve)}**`, inline: true },
        { name: 'Circulating (top wallets)', value: `**${fmt(s.circulating)}**`, inline: true },
        {
          name: 'Target supply (scarce guide)',
          value: `**${fmt(s.targetM)}** · ~${s.activeUsers} active users`,
          inline: false,
        }
      );

    if (s.mode === 'scarce') {
      const brackets = TAX_BRACKETS.map(
        (b) => `over ${fmt(b.above)} → **${Math.round(b.rate * 100)}%** on that band`
      ).join('\n');
      embed.addFields({ name: 'Wealth tax (daily)', value: brackets });
    }

    embed.setFooter({ text: '!!economy mode classic|scarce · also !!settings economy' });
    return message.reply({ embeds: [embed] });
  },
};
