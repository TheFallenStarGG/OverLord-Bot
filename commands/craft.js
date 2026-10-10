const { EmbedBuilder } = require('discord.js');
const { recipeLines, craftItem } = require('../lib/craft');

module.exports = {
  name: '!!craft',
  usage: '!!craft [recipe name]',
  description:
    'Craft food, tools, potions, and trinkets from fish, ore, and parts. `!!craft` lists recipes; `!!craft bait` makes one. Combat gear still uses `!!forge`.',
  access: 'free',

  async run(message, arg, ctx) {
    const text = (ctx.rawArg || arg || '').trim();

    if (text) {
      const result = craftItem(message.author.id, text);
      return message.reply(result.error ?? result.text);
    }

    const lines = recipeLines();
    // Discord field limit — split into two fields if needed
    const mid = Math.ceil(lines.length / 2);
    const left = lines.slice(0, mid).join('\n\n');
    const right = lines.slice(mid).join('\n\n');

    const embed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle('🧪 Crafting')
      .setDescription(
        'Turn **fish, ore, and parts** into food, tools, and jewelry.\n' +
          'Combat weapons/armor stay on `!!forge`.\n' +
          'Craft with `!!craft <name>` — example: `!!craft fish stew`.'
      )
      .addFields(
        { name: 'Recipes', value: left.slice(0, 1020) || '—' },
        { name: '\u200b', value: right.slice(0, 1020) || '—' }
      )
      .setFooter({ text: 'Sell crafts with !!sell · activate some with !!use' });

    return message.reply({ embeds: [embed] });
  },
};
