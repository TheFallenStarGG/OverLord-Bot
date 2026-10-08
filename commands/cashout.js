const { fmt } = require('../lib/economy');
const { STOCKS, FEE, resolveSym, parseAmount, fmtPrice, price, positionOf, cashout, cashoutAll } = require('../lib/stocks');
const { requestConfirm } = require('../lib/confirm');

const profitLine = (n) => (n >= 0 ? `🟢 Profit: **+${fmt(n)}**` : `🔴 Loss: **-${fmt(-n)}**`);

module.exports = {
  name: '!!cashout',
  usage: '!!cashout <symbol|all> [coins|half|50%|all]',
  description: `Sell your shares for coins (${Math.round(FEE * 100)}% fee). Leave the amount out to sell everything in that stock, or use \`!!cashout all\` to sell everything.`,
  access: 'free',

  async run(message, arg) {
    const [symText, amountText] = arg.split(/\s+/);
    const userId = message.author.id;
    if (!symText) {
      return message.reply('Usage: `!!cashout <symbol|all> [coins|half|50%|all]`. See what you own with `!!portfolio`.');
    }

    // ----- Sell everything -----
    if (symText === 'all') {
      requestConfirm(message.author.id, 'cashout', async (msg) => {
        const r = cashoutAll(msg.author.id);
        if (!r.results.length) {
          return msg.reply('You do not own any shares. Try `!!stocks` and `!!invest`.');
        }
        return msg.reply(
          `💵 You cashed out **${r.results.length}** stock${r.results.length === 1 ? '' : 's'} and received **${fmt(r.net)}**.\n${profitLine(r.profit)}`
        );
      });
      return message.reply(
        'You are about to sell **all** your stocks. Type **yes** within 30s to confirm, or **no** to cancel.'
      );
    }

    // ----- Sell one stock -----
    const sym = resolveSym(symText);
    if (!sym) {
      return message.reply(`I do not know a stock called \`${symText}\`. See what you own with \`!!portfolio\`.`);
    }

    const pos = positionOf(userId, sym);
    if (!pos) {
      return message.reply(`You do not own any **${sym}**. See what you have with \`!!portfolio\`.`);
    }

    let fraction = 1;
    if (amountText && amountText !== 'all') {
      if (amountText === 'half') {
        fraction = 0.5;
      } else if (/^\d+(\.\d+)?%$/.test(amountText)) {
        fraction = parseFloat(amountText) / 100;
      } else {
        const coins = parseAmount(amountText, 0);
        if (coins === null) {
          return message.reply('How much? Use a coin amount, a percentage like `50%`, `half`, or `all`.');
        }
        fraction = coins / (pos.shares * price(sym));
      }
      if (!(fraction > 0)) return message.reply('That amount is too small.');
      fraction = Math.min(1, fraction);
    }

    const doCashout = async (msg) => {
      const r = cashout(msg.author.id, sym, fraction);
      if (r.error) return msg.reply(r.error);
      return msg.reply(
        `💵 You sold ${STOCKS[sym].emoji} **${sym}** at **${fmtPrice(r.price)}** 🪙 per share and received **${fmt(r.net)}** (fee: ${fmt(r.fee)}).\n${profitLine(r.profit)}`
      );
    };

    // Rough value after fee — confirm only if it's large
    const rough = Math.floor(pos.shares * price(sym) * fraction * (1 - FEE));
    if (rough >= 1000) {
      requestConfirm(message.author.id, 'cashout', doCashout);
      return message.reply(
        `You're about to cash out about **${fmt(rough)}**. Type **yes** within 30s to confirm, or **no** to cancel.`
      );
    }

    // Small cashout — no confirm
    return doCashout(message);
  },
};
