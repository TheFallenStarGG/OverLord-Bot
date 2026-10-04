const { histories } = require('../lib/memory');
const { replyLines } = require('../lib/utils');

module.exports = {
  name: '!!history',
  usage: '!!history',
  description: 'Shows the saved memory (up to 20 messages) for the current channel.',
  access: 'owner-required',

  async run(message) {
    const history = histories.get(message.channel.id) ?? [];
    if (!history.length) return message.reply('There is no saved memory in this channel.');

    const lines = [`**Saved memory for this channel** (${history.length} messages, oldest first)`];
    history.forEach((m, i) => {
      const text = String(m.content).replace(/\s+/g, ' ');
      const short = text.length > 200 ? text.slice(0, 200) + '…' : text;
      lines.push(`${i + 1}. **${m.role}:** ${short}`);
    });

    await replyLines(message, lines);
  },
};
