const { buyTickets, lotteryInfo } = require('../lib/lottery');

module.exports = {
  name: '!!lottery',
  usage: '!!lottery [buy <amount>]',
  description: 'A daily lottery with a shared pot. Tickets cost 50 each, and one winner is drawn at midnight UTC.',
  access: 'free',

  async run(message, arg) {
    const text = arg.trim();
    if (!text) return message.reply(lotteryInfo(message.author.id));

    const match = /^(?:buy\s+)?(\d+)$/.exec(text);
    if (!match) return message.reply('Usage: `!!lottery` to see the pot, or `!!lottery buy <amount>` to buy tickets.');

    const result = buyTickets(message.author.id, parseInt(match[1], 10), message.channel.id);
    await message.reply(result.error ?? `${result.text}\n${lotteryInfo(message.author.id)}`);
  },
};
