const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registerModule, endGame, privateReply } = require('./common');
const { applyDelta, peekUser, recordQuest, fmt } = require('../economy');

const ROWS = 4;
const COLS = 5;
const TILES = ROWS * COLS;
const HOUSE_EDGE = 0.97; // payouts are fair odds minus 3%

// The more safe tiles you've found, the bigger the multiplier
function multiplier(game) {
  const found = game.revealed.size;
  if (found === 0) return 1;
  let survive = 1;
  for (let i = 0; i < found; i++) survive *= (TILES - game.mines - i) / (TILES - i);
  return HOUSE_EDGE / survive;
}

const profit = (game) => Math.floor(game.bet * (multiplier(game) - 1));

function settle(game, kind) {
  game.over = true;
  const userId = game.players[0];
  const found = game.revealed.size;
  let text;

  if (kind === 'mine') {
    const lost = game.bet ? -applyDelta(userId, -game.bet) : 0;
    text = `💥 **BOOM!** You hit a mine.${lost ? ` You lost **${fmt(lost)}**.` : ''}`;
  } else if (found === 0) {
    text = 'You walked away without picking a tile.';
  } else {
    const won = game.bet ? applyDelta(userId, profit(game)) : 0;
    recordQuest(userId, 'win');
    text = `💰 **Cashed out at ×${multiplier(game).toFixed(2)}!**${game.bet ? ` You won **${fmt(won)}**.` : ''}`;
  }
  if (game.bet) text += `\nBalance: ${fmt(peekUser(userId).coins)}`;
  game.result = text;
}

const minesweeper = {
  type: 'ms',

  create({ user, bet, mines }) {
    const order = Array.from({ length: TILES }, (_, i) => i).sort(() => Math.random() - 0.5);
    return {
      type: 'ms',
      players: [user.id],
      name: user.username,
      bet,
      mines,
      mineSet: new Set(order.slice(0, mines)),
      revealed: new Set(),
      over: false,
      result: null,
    };
  },

  render(game) {
    const found = game.revealed.size;
    const mult = multiplier(game);

    const lines = [
      `💣 **Minesweeper**${game.bet ? ` — bet: **${fmt(game.bet)}**` : ' — practice round (no bet)'}`,
      `**${game.mines}** mines are hidden among ${TILES} tiles. Find safe tiles to raise your payout!`,
      `💎 Safe tiles found: **${found}** · Multiplier: **×${mult.toFixed(2)}**`,
      '',
      game.over ? game.result : 'Pick a tile, or cash out whenever you like.',
    ];

    const rows = [];
    for (let r = 0; r < ROWS; r++) {
      const row = new ActionRowBuilder();
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const button = new ButtonBuilder().setCustomId(`game:ms:${game.id}:tile:${i}`);

        if (game.revealed.has(i)) {
          button.setEmoji('💎').setStyle(ButtonStyle.Success).setDisabled(true);
        } else if (game.over && game.mineSet.has(i)) {
          button.setEmoji('💣').setStyle(ButtonStyle.Danger).setDisabled(true);
        } else {
          button.setEmoji('❔').setStyle(ButtonStyle.Secondary).setDisabled(game.over);
        }
        row.addComponents(button);
      }
      rows.push(row);
    }

    if (!game.over) {
      const label = `Cash out ×${mult.toFixed(2)}${game.bet && found ? ` (+${fmt(profit(game))})` : ''}`;
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`game:ms:${game.id}:cash`)
            .setLabel(label)
            .setEmoji('💰')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(found === 0)
        )
      );
    }
    return { content: lines.join('\n'), components: rows };
  },

  async handleButton(interaction, game, action, arg) {
    if (interaction.user.id !== game.players[0]) return privateReply(interaction, "This isn't your game.");

    if (action === 'tile') {
      const i = Number(arg);
      if (game.revealed.has(i)) return privateReply(interaction, 'You already opened that tile.');

      if (game.mineSet.has(i)) {
        settle(game, 'mine');
      } else {
        game.revealed.add(i);
        if (game.revealed.size === TILES - game.mines) settle(game, 'cash'); // cleared the whole board
      }
    } else if (action === 'cash') {
      settle(game, 'cash');
    } else {
      return;
    }

    if (game.over) endGame(game);
    return interaction.update(minesweeper.render(game));
  },

  // If you walk away, you automatically cash out
  async onExpire(game) {
    if (game.over) return;
    settle(game, 'cash');
    await game.message?.edit(minesweeper.render(game)).catch(() => {});
  },
};

registerModule('ms', minesweeper);
module.exports = minesweeper;
