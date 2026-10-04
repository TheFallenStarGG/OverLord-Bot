const { peekUser, spendCoins, addCoins, parseBet, betError, fmt } = require('../lib/economy');

// [symbol, how common it is, payout multiplier for three of a kind]
const SYMBOLS = [
  ['🍒', 30, 5],
  ['🍋', 25, 8],
  ['🍇', 20, 12],
  ['🔔', 12, 25],
  ['⭐', 8, 50],
  ['💎', 4, 100],
  ['7️⃣', 1, 500],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const spinning = new Set(); // users with a spin in progress

function spinOne() {
  let roll = Math.random() * 100;
  for (const symbol of SYMBOLS) {
    roll -= symbol[1];
    if (roll < 0) return symbol;
  }
  return SYMBOLS[0];
}

module.exports = {
  name: '!!slots',
  usage: '!!slots <bet>',
  description: 'Spins a slot machine. Three of a kind pays big, two of a kind returns your bet. Use `all` to bet everything.',
  access: 'free',

  async run(message, arg) {
    const bet = parseBet(arg.split(/\s+/)[0], peekUser(message.author.id).coins);
    const error = betError(message.author.id, bet);
    if (error) return message.reply(`${error}\nUsage: \`!!slots <bet>\``);
    if (spinning.has(message.author.id)) return;

    spinning.add(message.author.id);
    try {
      if (!spendCoins(message.author.id, bet)) return message.reply("You don't have enough coins.");

      // The result is decided and paid out right away. The animation is just for show.
      const [a, b, c] = [spinOne(), spinOne(), spinOne()];
      let payout = 0;
      let verdict;
      if (a[0] === b[0] && b[0] === c[0]) {
        payout = bet * (1 + a[2]);
        verdict = `🎉 **THREE ${a[0]}!** You won **${fmt(bet * a[2])}**!`;
      } else if (a[0] === b[0] || b[0] === c[0] || a[0] === c[0]) {
        payout = bet;
        verdict = '🤝 Two of a kind. Your bet is returned.';
      } else {
        verdict = `❌ No match. You lost **${fmt(bet)}**.`;
      }
      if (payout) addCoins(message.author.id, payout);

      const header = `🎰 **Slots** — bet: **${fmt(bet)}**`;
      const reels = (x, y, z) => `┃ ${x} ┃ ${y} ┃ ${z} ┃`;

      const sent = await message.reply(`${header}\n${reels('🔄', '🔄', '🔄')}`);
      await sleep(800);
      await sent.edit(`${header}\n${reels(a[0], '🔄', '🔄')}`);
      await sleep(800);
      await sent.edit(`${header}\n${reels(a[0], b[0], '🔄')}`);
      await sleep(800);
      await sent.edit(`${header}\n${reels(a[0], b[0], c[0])}\n${verdict}\nBalance: ${fmt(peekUser(message.author.id).coins)}`);
    } finally {
      spinning.delete(message.author.id);
    }
  },
};
