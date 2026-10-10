const { invest, resolveSym, fmtPrice, FEE, MIN_INVEST } = require('../lib/stocks');
const { fmt, peekUser } = require('../lib/economy');
const { requestConfirm } = require('../lib/confirm');

const CONFIRM_AT = 1000; // coins

module.exports = {
  name: '!!invest',
  usage: '!!invest <symbol> <coins|half|all>',
  description: `Buy shares on the Realm Stock Exchange (${Math.round(FEE * 100)}% fee). Large buys ask for confirmation. Bankrupt stocks can wipe your position.`,
  access: 'free',

  async run(message, arg, ctx) {
    const parts = (ctx.rawArg || arg || '').trim().split(/\s+/).filter(Boolean);
    const symText = parts[0];
    const amountText = parts[1];
    if (!symText || !amountText) {
      return message.reply('Usage: `!!invest <symbol> <coins|half|all>` — see `!!stocks`.');
    }

    const sym = resolveSym(symText);
    if (!sym) return message.reply(`Unknown stock \`${symText}\`. Check \`!!stocks\`.`);

    const balance = peekUser(message.author.id).coins;
    let coins;
    const low = amountText.toLowerCase();
    if (low === 'all') coins = balance;
    else if (low === 'half') coins = Math.floor(balance / 2);
    else if (/^\d+$/.test(amountText)) coins = parseInt(amountText, 10);
    else return message.reply('Amount must be a number, `half`, or `all`.');

    if (!Number.isInteger(coins) || coins < MIN_INVEST) {
      return message.reply(`Minimum investment is **${fmt(MIN_INVEST)}**.`);
    }

    const doInvest = async (msg) => {
      const r = invest(msg.author.id, sym, coins);
      if (r.error) return msg.reply(r.error);
      return msg.reply(
        `📈 Bought **${r.shares.toFixed(2)}** shares of **${sym}** at **${fmtPrice(r.price)}** 🪙 ` +
          `(spent **${fmt(coins)}**, fee **${fmt(r.fee)}**).\n` +
          `-# If this company goes **bankrupt**, this position can go to **0**. Sell with \`!!cashout\`.`
      );
    };

    if (coins >= CONFIRM_AT) {
      requestConfirm(message.author.id, 'invest', doInvest);
      return message.reply(
        `You're about to invest **${fmt(coins)}** in **${sym}**. ` +
          `Type **yes** within 30s to confirm, or **no** to cancel.\n` +
          `-# Bankrupt stocks wipe shareholders.`
      );
    }

    return doInvest(message);
  },
};
