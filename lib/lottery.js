const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');
const { spendCoins, addCoins, fmt } = require('./economy');

const TICKET_PRICE = 50;
const MAX_TICKETS = 25; // per person, per draw
const HOUSE_CUT = 0.1; // taken out of the pot

const todayUTC = () => new Date().toISOString().slice(0, 10);

// day = the day these tickets are for. The draw happens when a new day (UTC) starts.
let state = readJson(FILES.lottery, { day: todayUTC(), tickets: {}, channelId: null, lastWinner: null });
const save = () => writeJson(FILES.lottery, state);

const totalTickets = () => Object.values(state.tickets).reduce((a, b) => a + b, 0);
const pot = () => Math.floor(totalTickets() * TICKET_PRICE * (1 - HOUSE_CUT));

function buyTickets(userId, amount, channelId) {
  const have = state.tickets[userId] ?? 0;
  if (!(amount >= 1)) return { error: 'Buy at least 1 ticket.' };
  if (have + amount > MAX_TICKETS) {
    return { error: `You can hold at most **${MAX_TICKETS}** tickets per draw (you have ${have}).` };
  }
  if (!spendCoins(userId, amount * TICKET_PRICE)) {
    return { error: `${amount} ticket${amount === 1 ? '' : 's'} cost **${fmt(amount * TICKET_PRICE)}**, and you don't have enough.` };
  }

  state.tickets[userId] = have + amount;
  state.channelId = channelId; // the draw result is announced in the last channel someone bought in
  save();
  return { text: `🎟️ You bought **${amount}** ticket${amount === 1 ? '' : 's'} for **${fmt(amount * TICKET_PRICE)}**! You now have **${have + amount}**.` };
}

function lotteryInfo(userId) {
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  const mine = state.tickets[userId] ?? 0;
  const total = totalTickets();

  const lines = [
    '🎟️ **Daily Lottery**',
    `Pot: **${fmt(pot())}** · Tickets sold: **${total}** from **${Object.keys(state.tickets).length}** player(s)`,
    `Your tickets: **${mine}** / ${MAX_TICKETS}${total && mine ? ` (${((mine / total) * 100).toFixed(1)}% chance to win)` : ''}`,
    `Next draw: <t:${Math.floor(midnight.getTime() / 1000)}:R>`,
    `Tickets cost ${fmt(TICKET_PRICE)} each. Buy with \`!!lottery buy <amount>\`.`,
  ];
  if (state.lastWinner) {
    lines.push(`🏆 Last winner: <@${state.lastWinner.id}> won **${fmt(state.lastWinner.amount)}**`);
  }
  lines.push('-# The more people play, the bigger the pot. At least 2 players are needed, or tickets are refunded.');
  return lines.join('\n');
}

// Runs every minute: when a new day has started, draw yesterday's lottery
async function drawIfDue(client) {
  if (state.day === todayUTC()) return;

  const entries = Object.entries(state.tickets);
  const total = totalTickets();
  const prize = pot();
  let announcement = null;

  if (entries.length === 1) {
    // Nobody to compete against: refund
    const [id, n] = entries[0];
    addCoins(id, n * TICKET_PRICE);
    announcement = `🎟️ **Lottery:** only <@${id}> played yesterday, so their tickets were refunded.`;
    state.lastWinner = null;
  } else if (entries.length >= 2) {
    let roll = Math.random() * total;
    let winner = entries[0][0];
    for (const [id, n] of entries) {
      roll -= n;
      if (roll < 0) {
        winner = id;
        break;
      }
    }
    addCoins(winner, prize);
    state.lastWinner = { id: winner, amount: prize };
    announcement =
      `🎟️ **Lottery draw!** <@${winner}> won **${fmt(prize)}** ` +
      `(${state.tickets[winner]} of ${total} tickets from ${entries.length} players). Congratulations! 🎉`;
  }

  const channelId = state.channelId;
  state = { day: todayUTC(), tickets: {}, channelId, lastWinner: state.lastWinner };
  save();

  if (announcement && channelId) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    await channel?.send({ content: announcement, allowedMentions: { users: entries.map(([id]) => id) } }).catch(() => {});
  }
}

module.exports = { TICKET_PRICE, buyTickets, lotteryInfo, drawIfDue };
