const { peekUser, parseBet, betError, spendCoins, addCoins, recordQuest, fmt } = require('../lib/economy');

const BET_WINDOW_MS = 20 * 1000;
const MAX_BETS_PER_USER = 3;
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? '🟢' : RED.has(n) ? '🔴' : '⚫');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// pays = profit as a multiple of the stake (the stake itself is also returned on a win)
function parseChoice(text) {
  if (text === 'red') return { label: '🔴 Red', pays: 1, wins: (n) => n !== 0 && RED.has(n) };
  if (text === 'black') return { label: '⚫ Black', pays: 1, wins: (n) => n !== 0 && !RED.has(n) };
  if (text === 'green') return { label: '🟢 Green (0)', pays: 35, wins: (n) => n === 0 };
  if (text === 'odd') return { label: 'Odd', pays: 1, wins: (n) => n !== 0 && n % 2 === 1 };
  if (text === 'even') return { label: 'Even', pays: 1, wins: (n) => n !== 0 && n % 2 === 0 };
  if (text === 'low') return { label: 'Low (1-18)', pays: 1, wins: (n) => n >= 1 && n <= 18 };
  if (text === 'high') return { label: 'High (19-36)', pays: 1, wins: (n) => n >= 19 };
  if (text === '1st') return { label: '1st dozen (1-12)', pays: 2, wins: (n) => n >= 1 && n <= 12 };
  if (text === '2nd') return { label: '2nd dozen (13-24)', pays: 2, wins: (n) => n >= 13 && n <= 24 };
  if (text === '3rd') return { label: '3rd dozen (25-36)', pays: 2, wins: (n) => n >= 25 };
  if (/^\d+$/.test(text) && Number(text) <= 36) {
    const pick = Number(text);
    return { label: `${colorOf(pick)} Number ${pick}`, pays: 35, wins: (n) => n === pick };
  }
  return null;
}

const tables = new Map(); // channelId -> open table

function renderTable(table) {
  const lines = [
    `🎰 **Roulette** — place your bets! The wheel spins <t:${Math.ceil(table.closesAt / 1000)}:R>.`,
    '`!!roulette <bet> <red|black|green|odd|even|low|high|1st|2nd|3rd|0-36>`',
    '',
    ...table.bets.map((b) => `<@${b.userId}> bet **${fmt(b.stake)}** on ${b.choice.label}`),
  ];
  return lines.join('\n').slice(0, 1900);
}

async function spin(channelId, table) {
  tables.delete(channelId);
  const show = (content) => (table.message ? table.message.edit({ content }) : table.channel.send({ content }));

  try {
    await show('🎰 **No more bets!** The wheel is spinning... 🎡');
    await sleep(2000);

    const n = Math.floor(Math.random() * 37);
    const lines = [`🎰 The ball lands on ${colorOf(n)} **${n}**!`, ''];
    for (const b of table.bets) {
      if (b.choice.wins(n)) {
        addCoins(b.userId, b.stake * (1 + b.choice.pays));
        recordQuest(b.userId, 'win');
        lines.push(`✅ <@${b.userId}> won **${fmt(b.stake * b.choice.pays)}** (${b.choice.label})`);
      } else {
        lines.push(`❌ <@${b.userId}> lost **${fmt(b.stake)}** (${b.choice.label})`);
      }
    }
    await show(lines.join('\n').slice(0, 1900));
  } catch (err) {
    // If the result can't be shown, give everyone their stakes back
    for (const b of table.bets) addCoins(b.userId, b.stake);
    throw err;
  }
}

module.exports = {
  name: '!!roulette',
  usage: '!!roulette <bet> <red|black|green|odd|even|low|high|1st|2nd|3rd|0-36>',
  description:
    'Bet on the roulette wheel. The first bet opens a table for 20 seconds, and anyone in the channel can join before it spins. Colors, odd/even, and low/high pay 1:1, dozens pay 2:1, and a single number pays 35:1.',
  access: 'free',

  async run(message, arg) {
    const usage = `Usage: \`${module.exports.usage}\``;
    const [betText, choiceText] = arg.split(/\s+/);
    if (!betText || !choiceText) return message.reply(usage);

    const choice = parseChoice(choiceText);
    if (!choice) return message.reply(`I don't know that bet. ${usage}`);

    const userId = message.author.id;
    const stake = parseBet(betText, peekUser(userId).coins);
    const error = betError(userId, stake);
    if (error) return message.reply(error);

    let table = tables.get(message.channel.id);
    if (table && table.bets.filter((b) => b.userId === userId).length >= MAX_BETS_PER_USER) {
      return message.reply(`You can place up to ${MAX_BETS_PER_USER} bets per spin.`);
    }
    if (!spendCoins(userId, stake)) return message.reply("You don't have enough coins.");

    const isNew = !table;
    if (isNew) {
      table = { bets: [], message: null, channel: message.channel, closesAt: Date.now() + BET_WINDOW_MS };
      tables.set(message.channel.id, table);
      setTimeout(() => spin(message.channel.id, table).catch(() => {}), BET_WINDOW_MS);
    }
    table.bets.push({ userId, stake, choice });

    if (isNew) {
      table.message = await message.reply(renderTable(table));
    } else {
      message.react('🎰').catch(() => {});
      table.message?.edit(renderTable(table)).catch(() => {});
    }
  },
};
