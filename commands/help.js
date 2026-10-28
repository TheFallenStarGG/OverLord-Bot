const { EmbedBuilder } = require('discord.js');
const { buildHelp, searchCommands, PAGES } = require('../lib/helpPages');

module.exports = {
  name: '!!help',
  usage: '!!help [page | search]',
  description: 'Command list by section, or search (e.g. !!help rob, !!help campaign).',
  access: 'free',

  async run(message, arg, ctx) {
    const q = (arg || '').trim();
    if (q && !/^\d+$/.test(q)) {
      const keys = PAGES.map((p) => p.key);
      const isPage = keys.some((p) => p.startsWith(q.toLowerCase()) || q.toLowerCase().startsWith(p));
      if (!isPage) {
        const hits = searchCommands(ctx.commands, q);
        if (!hits.length) {
          return message.reply(
            `Nothing matches \`${q}\`. Try \`!!help\`, \`!!help earn\`, or \`!!help campaign\`.`
          );
        }
        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(`Search: ${q}`)
          .setDescription(
            hits.map((c) => `**${c.usage || c.name}**\n${c.description || ''}`).join('\n\n').slice(0, 4000)
          )
          .setFooter({
            text: '!!help campaign · !!help earn · Terms on the main help footer',
          });
        return message.reply({ embeds: [embed] });
      }
    }
    await message.reply(buildHelp(ctx.commands, ctx.client, arg || 0, message.author.id));
  },
};
