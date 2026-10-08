const { EmbedBuilder } = require('discord.js');
const { buildHelp, searchCommands } = require('../lib/helpPages');

module.exports = {
  name: '!!help',
  usage: '!!help [page | search]',
  description: 'Opens the command list, jumps to a page (`!!help games`), or searches (`!!help rob`).',
  access: 'free',

  async run(message, arg, ctx) {
    const q = (arg || '').trim();
    if (q && !/^\d+$/.test(q)) {
      const pages = ['combat', 'games', 'economy', 'market', 'shop', 'fun', 'owner', 'more'];
      const isPage = pages.some((p) => p.startsWith(q) || q.startsWith(p));
      if (!isPage) {
        const hits = searchCommands(ctx.commands, q);
        if (!hits.length) {
          return message.reply(`No commands match \`${q}\`. Try \`!!help\` or \`!!help games\`.`);
        }
        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(`Search: ${q}`)
          .setDescription(hits.map((c) => `**${c.usage}**\n${c.description}`).join('\n\n').slice(0, 4000))
          .setFooter({ text: 'Tip: !!help games opens a full page · Terms: https://thefallenstargg.github.io/Overlord-ToS/terms.html' });
        return message.reply({ embeds: [embed] });
      }
    }
    await message.reply(buildHelp(ctx.commands, ctx.client, arg || 0, message.author.id));
  },
};
