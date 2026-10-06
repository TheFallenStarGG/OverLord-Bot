const { EmbedBuilder } = require('discord.js');
const { DEFS, EVENT_IDS, activeList, findEvent, startEvent, endEvents, eventEmbed } = require('../lib/modifiers');
const { broadcast } = require('../lib/announce');

module.exports = {
  name: '!!event',
  usage: '!!event',
  description: 'Shows the server events happening right now. Events start every day or so, with boosted fishing, XP, sales, and more, plus a limited-time shop title.',
  access: 'free',

  async run(message, arg, ctx) {
    const [sub, ...words] = arg.split(/\s+/).filter(Boolean);

    if (sub === 'start' || sub === 'end') {
      if (!ctx.isOwner) return message.reply('Only the bot owner can do that.');

      if (sub === 'end') {
        const id = words.length ? findEvent(words.join(' ')) : null;
        if (words.length && !id) return message.reply(`Unknown event. Options: ${EVENT_IDS.map((e) => `\`${e}\``).join(', ')}.`);
        return message.reply(endEvents(id) ? '🛑 Event ended.' : 'No matching event is running.');
      }

      let hours = null;
      if (words.length && /^\d+(\.\d+)?$/.test(words[words.length - 1])) hours = parseFloat(words.pop());
      const id = words.length ? findEvent(words.join(' ')) : null;
      if (words.length && !id) return message.reply(`Unknown event. Options: ${EVENT_IDS.map((e) => `\`${e}\``).join(', ')}.`);

      const entry = startEvent({ id, hours });
      await broadcast(message.client, { embeds: [eventEmbed(entry, '🎪 **A server event has begun!**')] });
      return message.reply({ embeds: [eventEmbed(entry, 'Event started!')] });
    }

    const live = activeList().filter((e) => e.def.event);
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('🎪 Server events')
      .setDescription(
        live.length
          ? live.map((e) => `${e.def.emoji} **${e.def.name}**\n${e.def.desc}\n🏷️ Limited title in \`!!shop\`: **${e.def.titleName}**\nEnds <t:${Math.floor(e.until / 1000)}:R>.`).join('\n\n')
          : 'No event is running right now. A new one starts every day or so, so keep an eye out!'
      )
      .addFields({
        name: 'What can happen',
        value: EVENT_IDS.map((id) => `${DEFS[id].emoji} **${DEFS[id].name}**: ${DEFS[id].desc}`).join('\n').slice(0, 1000),
      });

    return message.reply({ embeds: [embed] });
  },
};
