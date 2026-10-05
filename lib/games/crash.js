const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registerModule, endGame, privateReply } = require('./common');
const { applyDelta, peekUser, recordQuest, fmt } = require('../economy');

const TICK_MS = 1500; // how often the multiplier updates
const MAX_MULT = 50;
const HOUSE_EDGE = 0.97;

// The multiplier after a number of ticks. It speeds up as it climbs.
const multAt = (ticks) => Math.round((1 + 0.12 * ticks + 0.018 * ticks * ticks) * 100) / 100;

// Fair odds minus 3%: the chance of getting past ×x is 0.97 / x
function rollCrashPoint() {
  const point = Math.floor((HOUSE_EDGE / (1 - Math.random())) * 100) / 100;
  return Math.min(Math.max(point, 1), MAX_MULT);
}

const profit = (game) => Math.floor(game.bet * (game.mult - 1));

function settle(game, kind) {
  game.over = true;
  clearInterval(game.tick);
  const userId = game.players[0];
  let text;

  if (kind === 'crash') {
    game.mult = game.crashPoint;
    const lost = game.bet ? -applyDelta(userId, -game.bet) : 0;
    text = `💥 **Crashed at ×${game.crashPoint.toFixed(2)}!**${lost ? ` You lost **${fmt(lost)}**.` : ''}`;
  } else {
    const won = game.bet ? applyDelta(userId, profit(game)) : 0;
    if (game.bet) recordQuest(userId, 'win');
    text = `💰 **Cashed out at ×${game.mult.toFixed(2)}!**${game.bet ? ` You won **${fmt(won)}**.` : ''}\n-# It would have crashed at ×${game.crashPoint.toFixed(2)}.`;
  }
  if (game.bet) text += `\nBalance: ${fmt(peekUser(userId).coins)}`;
  game.result = text;
}

const crash = {
  type: 'cr',

  create({ user, bet }) {
    return { type: 'cr', players: [user.id], name: user.username, bet, crashPoint: rollCrashPoint(), ticks: 0, mult: 1, tick: null, over: false, result: null };
  },

  render(game) {
    const lines = [
      `🚀 **Crash**${game.bet ? ` — bet: **${fmt(game.bet)}**` : ' — practice round (no bet)'}`,
      `📈 Multiplier: **×${game.mult.toFixed(2)}**`,
    ];
    if (game.over) {
      lines.push('', game.result);
      return { content: lines.join('\n'), components: [] };
    }
    lines.push(game.ticks === 0 ? 'Liftoff in a moment...' : 'Cash out before it crashes!');

    const label = game.ticks === 0 ? 'Cash out' : `Cash out ×${game.mult.toFixed(2)}${game.bet ? ` (+${fmt(profit(game))})` : ''}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`game:cr:${game.id}:cash`).setLabel(label).setEmoji('💰').setStyle(ButtonStyle.Success).setDisabled(game.ticks === 0)
    );
    return { content: lines.join('\n'), components: [row] };
  },

  // Starts the climb. Call this once the message has been sent.
  start(game) {
    game.tick = setInterval(async () => {
      if (game.over) return;
      game.ticks++;
      const next = multAt(game.ticks);
      if (next >= game.crashPoint) {
        settle(game, 'crash');
        endGame(game);
      } else {
        game.mult = next;
      }
      await game.message?.edit(crash.render(game)).catch(() => {});
    }, TICK_MS);
  },

  async handleButton(interaction, game, action) {
    if (interaction.user.id !== game.players[0]) return privateReply(interaction, "This isn't your game.");
    if (action !== 'cash' || game.over || game.ticks === 0) return;
    settle(game, 'cash');
    endGame(game);
    return interaction.update(crash.render(game));
  },

  async onExpire(game) {
    if (game.over) return;
    settle(game, 'cash');
    await game.message?.edit(crash.render(game)).catch(() => {});
  },
};

registerModule('cr', crash);
module.exports = crash;
