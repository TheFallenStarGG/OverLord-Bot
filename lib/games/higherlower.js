const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registerModule, endGame, privateReply } = require('./common');
const { applyDelta, peekUser, recordQuest, fmt } = require('../economy');

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const HOUSE_EDGE = 0.97;
const MAX_MULT = 50;

const draw = () => ({ rank: 1 + Math.floor(Math.random() * 13), suit: SUITS[Math.floor(Math.random() * SUITS.length)] });
const show = (c) => `**${RANKS[c.rank - 1]}${c.suit}**`;
// Chance the next card is higher or lower (a tie loses)
const chance = (rank, dir) => (dir === 'higher' ? 13 - rank : rank - 1) / 13;
const profit = (game) => Math.floor(game.bet * (game.mult - 1));

function settle(game, kind) {
  game.over = true;
  const userId = game.players[0];
  let text;

  if (kind === 'lose') {
    const lost = game.bet ? -applyDelta(userId, -game.bet) : 0;
    text = `❌ **Wrong!**${lost ? ` You lost **${fmt(lost)}**.` : ''}`;
  } else if (game.streak === 0) {
    text = 'You walked away without guessing.';
  } else {
    const won = game.bet ? applyDelta(userId, profit(game)) : 0;
    if (game.bet) recordQuest(userId, 'win');
    text = `💰 **Cashed out at ×${game.mult.toFixed(2)}** after ${game.streak} correct guess${game.streak === 1 ? '' : 'es'}!${game.bet ? ` You won **${fmt(won)}**.` : ''}`;
  }
  if (game.bet) text += `\nBalance: ${fmt(peekUser(userId).coins)}`;
  game.result = text;
}

const hl = {
  type: 'hl',

  create({ user, bet }) {
    return { type: 'hl', players: [user.id], name: user.username, bet, card: draw(), streak: 0, mult: 1, last: null, over: false, result: null };
  },

  render(game) {
    const lines = [
      `🃏 **Higher or Lower**${game.bet ? ` — bet: **${fmt(game.bet)}**` : ' — practice round (no bet)'}`,
      `Streak: **${game.streak}** · Multiplier: **×${game.mult.toFixed(2)}**${game.bet && game.streak ? ` (+${fmt(profit(game))})` : ''}`,
      '',
    ];
    if (game.last) lines.push(`${show(game.last.from)} → ${show(game.last.to)} ${game.last.ok ? '✅' : '❌'}`);
    lines.push(`Current card: ${show(game.card)}`);
    lines.push(game.over ? game.result : 'Will the next card be higher or lower? A tie loses.');

    if (game.over) return { content: lines.join('\n'), components: [] };

    const r = game.card.rank;
    const up = r < 13 ? HOUSE_EDGE / chance(r, 'higher') : 0;
    const down = r > 1 ? HOUSE_EDGE / chance(r, 'lower') : 0;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`game:hl:${game.id}:higher`).setEmoji('⬆️').setLabel(`Higher${up ? ` ×${up.toFixed(2)}` : ''}`).setStyle(ButtonStyle.Primary).setDisabled(r === 13),
      new ButtonBuilder().setCustomId(`game:hl:${game.id}:lower`).setEmoji('⬇️').setLabel(`Lower${down ? ` ×${down.toFixed(2)}` : ''}`).setStyle(ButtonStyle.Primary).setDisabled(r === 1),
      new ButtonBuilder().setCustomId(`game:hl:${game.id}:cash`).setEmoji('💰').setLabel('Cash out').setStyle(ButtonStyle.Success).setDisabled(game.streak === 0)
    );
    return { content: lines.join('\n'), components: [row] };
  },

  async handleButton(interaction, game, action) {
    if (interaction.user.id !== game.players[0]) return privateReply(interaction, "This isn't your game.");

    if (action === 'cash') {
      if (game.streak === 0) return privateReply(interaction, 'Make a guess first.');
      settle(game, 'cash');
    } else if (action === 'higher' || action === 'lower') {
      const p = chance(game.card.rank, action);
      if (p === 0) return privateReply(interaction, "That can't happen!");
      const next = draw();
      const win = action === 'higher' ? next.rank > game.card.rank : next.rank < game.card.rank;
      game.last = { from: game.card, to: next, ok: win };
      game.card = next;
      if (win) {
        game.mult *= HOUSE_EDGE / p;
        game.streak++;
        if (game.mult >= MAX_MULT) {
          game.mult = MAX_MULT;
          settle(game, 'cash');
        }
      } else {
        settle(game, 'lose');
      }
    } else {
      return;
    }

    if (game.over) endGame(game);
    return interaction.update(hl.render(game));
  },

  async onExpire(game) {
    if (game.over) return;
    settle(game, 'cash');
    await game.message?.edit(hl.render(game)).catch(() => {});
  },
};

registerModule('hl', hl);
module.exports = hl;
