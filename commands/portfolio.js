const { EmbedBuilder } = require('discord.js');
const { fmt } = require('../lib/economy');
const { STOCKS, trend, portfolio } = require('../lib/stocks');

const signed = (n) => `${n >= 0 ? '+' : '-'}${fmt(Math.abs(Math.round(n)))}`;

module.exports = {
  name: '!!portfolio',
  aliases: ['!!pf'],
  usage: '!!portfolio [@user]',
  description: 'See your stock investments, what they are worth, and your profit or loss.',
  access: 'free',

  async run(message) {
    const target = message.mentions.users.first() ?? message.author;
    const mine = target.id === message.author.id;
    const p = portfolio(target.id);

    if (!p.holdings.length) {
      return message.reply(mine ? 'You have no investments yet. Try `!!stocks` and `!!invest`.' : `${target.username} has no investments.`);
    }

    const lines = p.holdings.map(
      (h) =>
        `${STOCKS[h.sym].emoji} **${h.sym}** · ${h.shares.toFixed(2)} shares · worth **${fmt(Math.round(h.value))}**\n${trend(h.pct)} (${signed(h.profit)})`
    );
    const embed = new EmbedBuilder()
      .setColor(p.profit >= 0 ? 0x2ecc71 : 0xe74c3c)
      .setTitle(`📊 ${target.username}'s portfolio`)
      .setDescription(lines.join('\n\n'))
      .addFields(
        { name: 'Invested', value: fmt(Math.round(p.spent)), inline: true },
        { name: 'Worth now', value: fmt(Math.round(p.value)), inline: true },
        { name: 'Profit / loss', value: signed(p.profit), inline: true }
      )
      .setFooter({ text: 'Values are before the selling fee · coins in stocks cannot be robbed' });

    return message.reply({ embeds: [embed] });
  },
};
