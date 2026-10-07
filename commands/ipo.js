const { EmbedBuilder } = require('discord.js');
const { fmt } = require('../lib/economy');
const { fmtPrice, trend, change } = require('../lib/stocks');
const { MIN_LEVEL, LISTING_FEE, IPO_PRICE, MAX_COMPANIES, ABANDON_HOURS, found, info, all, companyOf } = require('../lib/companies');

const signedPct = (n) => `${n >= 0 ? '+' : '-'}${Math.abs(n * 100).toFixed(1)}%`;

function companyEmbed(sym) {
  const c = info(sym);
  const away = c.idleHours > 24 ? `⚠️ Away for ${Math.floor(c.idleHours)}h, which is dragging the price down` : '✅ Active';
  return new EmbedBuilder()
    .setColor(0x8e44ad)
    .setTitle(`🏢 ${c.name} (${c.sym})`)
    .setDescription(`Founded by <@${c.founder}>`)
    .addFields(
      { name: 'Share price', value: `**${fmtPrice(c.price)}** 🪙`, inline: true },
      { name: '24h change', value: trend(change(c.sym)), inline: true },
      { name: 'Founder', value: away, inline: true },
      { name: 'Net worth vs IPO', value: `${signedPct(c.growth)} (the price follows this)`, inline: true },
      { name: 'Fees earned', value: fmt(c.fees ?? 0), inline: true }
    )
    .setFooter({ text: `Buy shares with !!invest ${c.sym} <coins> · founders cannot trade their own shares` });
}

function intro(userId) {
  return new EmbedBuilder()
    .setColor(0x8e44ad)
    .setTitle('🏢 Player companies')
    .setDescription(
      `Take your own company public and let the realm invest in it!\n\n` +
        `• **Cost:** ${fmt(LISTING_FEE)} to list, and you must be level ${MIN_LEVEL}. One company per player, ${MAX_COMPANIES} on the exchange at most.\n` +
        `• **Price:** shares start at ${fmt(IPO_PRICE)}. The price follows how much richer (or poorer) **you** get compared to listing day, so investors are betting on you.\n` +
        `• **Stay active:** if you stop playing for more than a day the price starts to sink, and after ${ABANDON_HOURS / 24} days the company is delisted.\n` +
        `• **Income:** every time someone buys or sells your shares, the trading fee goes to you.\n` +
        `• **Trading:** everyone can buy with \`!!invest\` and sell with \`!!cashout\`. You cannot trade your own shares.\n` +
        `• **Closing:** if the price falls too low or you vanish, shareholders are paid out at the final price.\n\n` +
        `Found one with \`!!ipo found <SYMBOL> <Company Name>\`, for example \`!!ipo found BOBB Bobs Bait & Tackle\`.`
    );
}

module.exports = {
  name: '!!ipo',
  usage: '!!ipo [found <SYMBOL> <name> | list]',
  description: `Take your own company public on the stock market for ${LISTING_FEE} coins. Its price follows how rich and active you are, and you earn its trading fees.`,
  access: 'free',

  async run(message, arg, ctx) {
    const userId = message.author.id;
    const parts = ctx.rawArg.split(/\s+/).filter(Boolean);
    const sub = (parts[0] ?? '').toLowerCase();

    if (sub === 'found' || sub === 'create') {
      const r = found(userId, parts[1], parts.slice(2).join(' '));
      if (r.error) return message.reply(r.error);
      return message.reply({
        content: `🔔 **${r.company.name}** (${r.company.sym}) is now on the Realm Stock Exchange at **${fmtPrice(r.company.ipoPrice)}** 🪙 per share!`,
        embeds: [companyEmbed(r.company.sym)],
      });
    }

    if (sub === 'list') {
      const companies = all();
      if (!companies.length) return message.reply('There are no player companies yet. Be the first with `!!ipo found <SYMBOL> <name>`!');
      const lines = companies.map((c) => {
        const i = info(c.sym);
        return `🏢 \`${c.sym}\` **${c.name}** · ${fmtPrice(i.price)} 🪙 · ${trend(change(c.sym))} · <@${c.founder}>`;
      });
      return message.reply({ embeds: [new EmbedBuilder().setColor(0x8e44ad).setTitle('🏢 Player companies').setDescription(lines.join('\n'))] });
    }

    const mine = companyOf(userId);
    if (mine) return message.reply({ embeds: [companyEmbed(mine.sym)] });
    return message.reply({ embeds: [intro(userId)] });
  },
};
