const { EmbedBuilder } = require('discord.js');
const { fmt } = require('../lib/economy');
const { STOCKS, FEE, price, change, range, spark, trend, fmtPrice, nextTickAt, getNews, resolveSym, positionOf } = require('../lib/stocks');

const unix = (ms) => Math.floor(ms / 1000);
const signed = (n) => `${n >= 0 ? '+' : '-'}${fmt(Math.abs(Math.round(n)))}`;

function overview() {
  const lines = Object.entries(STOCKS).map(
    ([sym, s]) => `${s.emoji} \`${sym}\` **${s.name}**\n**${fmtPrice(price(sym))}** 🪙 · ${trend(change(sym))} · \`${spark(sym)}\``
  );
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('📈 The Realm Stock Exchange')
    .setDescription(lines.join('\n\n'))
    .addFields(
      { name: '⏱️ Next price update', value: `<t:${unix(nextTickAt())}:R>`, inline: true },
      { name: '💡 Tips', value: '`!!stocks <symbol>` for details\n`!!stocks news` for headlines', inline: true }
    )
    .setFooter({ text: `% change uses recent history · prices update hourly · ${Math.round(FEE * 100)}% fee when buying and selling` });
}

function detail(sym, userId) {
  const s = STOCKS[sym];
  const { low, high } = range(sym);
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`${s.emoji} ${sym} · ${s.name}`)
    .setDescription(s.blurb)
    .addFields(
      { name: 'Price', value: `**${fmtPrice(price(sym))}** 🪙`, inline: true },
      { name: '24h change', value: trend(change(sym)), inline: true },
      { name: '24h range', value: `${fmtPrice(low)} - ${fmtPrice(high)}`, inline: true },
      { name: 'Recent history', value: `\`${spark(sym, 24, 48)}\`` },
      { name: 'What moves it', value: s.movers }
    )
    .setFooter({ text: `Buy with !!invest ${sym} <coins> · ${Math.round(FEE * 100)}% fee when buying and selling` });

  const pos = positionOf(userId, sym);
  if (pos) {
    const value = pos.shares * price(sym);
    embed.addFields({
      name: 'Your position',
      value: `${pos.shares.toFixed(2)} shares · worth **${fmt(Math.round(value))}** · ${trend(pos.spent ? value / pos.spent - 1 : 0)} (${signed(value - pos.spent)})`,
    });
  }
  return embed;
}

function news() {
  const items = getNews();
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('📰 Market news')
    .setDescription(items.length ? items.map((n) => `<t:${unix(n.at)}:R> ${n.line}`).join('\n') : 'Nothing has happened yet. Check back soon!');
}

module.exports = {
  name: '!!stocks',
  aliases: ['!!market'],
  usage: '!!stocks [symbol | news]',
  description: 'See the stock market. Prices change every 5 minutes. Add a symbol like `KRKN` for details, or `news` for headlines.',
  access: 'free',

  async run(message, arg) {
    if (!arg) return message.reply({ embeds: [overview()] });
    if (arg === 'news') return message.reply({ embeds: [news()] });

    const sym = resolveSym(arg);
    if (!sym) return message.reply(`I do not know a stock called \`${arg}\`. The symbols are: ${Object.keys(STOCKS).map((s) => `\`${s}\``).join(', ')}.`);
    return message.reply({ embeds: [detail(sym, message.author.id)] });
  },
};
