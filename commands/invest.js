const { fmt, peekUser } = require('../lib/economy');
const { STOCKS, MIN_INVEST, FEE, resolveSym, parseAmount, fmtPrice, invest } = require('../lib/stocks');

module.exports = {
  name: '!!invest',
  usage: '!!invest <symbol> <coins|all>',
  description: `Buy shares of a stock with your coins (${Math.round(FEE * 100)}% fee). Coins invested are safe from \`!!rob\`, but prices can drop! See \`!!stocks\`.`,
  access: 'free',

  async run(message, arg) {
    const [symText, amountText] = arg.split(/\s+/);
    const usage = `Usage: \`!!invest <symbol> <coins|all>\`, for example \`!!invest KRKN 500\`. See the symbols with \`!!stocks\`.`;
    if (!symText) return message.reply(usage);

    const sym = resolveSym(symText);
    if (!sym) return message.reply(`I do not know a stock called \`${symText}\`. The symbols are: ${Object.keys(STOCKS).map((s) => `\`${s}\``).join(', ')}.`);

    const wallet = peekUser(message.author.id).coins;
    const coins = parseAmount(amountText, wallet);
    if (coins === null) return message.reply(usage);
    if (coins < MIN_INVEST) return message.reply(`The minimum investment is ${fmt(MIN_INVEST)}.`);

    const r = invest(message.author.id, sym, coins);
    if (r.error) return message.reply(r.error);

    return message.reply(
      `📈 You put **${fmt(coins)}** into ${STOCKS[sym].emoji} **${sym}** at **${fmtPrice(r.price)}** 🪙 per share.\n` +
        `You received **${r.shares.toFixed(2)} shares** (trading fee: ${fmt(r.fee)}).\n` +
        `-# Sell any time with \`!!cashout ${sym}\` · see your profit with \`!!portfolio\``
    );
  },
};
