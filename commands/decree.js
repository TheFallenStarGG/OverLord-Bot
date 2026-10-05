const { EmbedBuilder } = require('discord.js');
const { DEFS, activeList, findDecree, issueDecree, getTreasury, decreeEmbed } = require('../lib/modifiers');

module.exports = {
  name: '!!decree',
  usage: '!!decree',
  description: "Shows the Overlord's active decrees and how full the tribute treasury is. Fill it with `!!tribute` to earn a free decree for everyone.",
  access: 'free',

  async run(message, arg, ctx) {
    if (arg.startsWith('issue')) {
      if (!ctx.isOwner) return message.reply('Only the bot owner can issue decrees.');
      const id = findDecree(arg.slice(5).trim()) ?? undefined;
      if (arg.slice(5).trim() && !id) return message.reply(`Unknown decree. Options: ${Object.keys(DEFS).map((d) => `\`${d}\``).join(', ')}.`);
      const entry = issueDecree({ id });
      return message.reply({ embeds: [decreeEmbed(entry, 'The Overlord speaks!')] });
    }

    const active = activeList();
    const t = getTreasury();
    const filled = Math.floor((t.amount / t.goal) * 10);

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('📜 Decrees of the Overlord')
      .setDescription(
        active.length
          ? active.map((e) => `${e.def.emoji} **${e.def.name}**\n${e.def.desc} Ends <t:${Math.floor(e.until / 1000)}:R>.`).join('\n\n')
          : 'The Overlord has issued no decrees right now. He speaks every few hours, so keep an eye out.'
      )
      .addFields({
        name: '🏛️ Tribute treasury',
        value: `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${t.amount.toLocaleString('en-US')} / ${t.goal.toLocaleString('en-US')} 🪙\nFill it with \`!!tribute\` and the Overlord issues a free decree for everyone.`,
      });

    return message.reply({ embeds: [embed] });
  },
};
