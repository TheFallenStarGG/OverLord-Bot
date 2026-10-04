const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registerModule, endGame, privateReply, settlePvp } = require('./common');
const { fmt } = require('../economy');

const ROWS = 6;
const COLS = 7;
const PIECES = ['🔴', '🟡'];
const symbol = (v) => (v === null ? '⚪' : PIECES[v]);

// Does the piece at (r, c) complete four in a row for player p?
function wins(grid, r, c, p) {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let count = 1;
    for (const s of [1, -1]) {
      let rr = r + dr * s;
      let cc = c + dc * s;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && grid[rr][cc] === p) {
        count++;
        rr += dr * s;
        cc += dc * s;
      }
    }
    if (count >= 4) return true;
  }
  return false;
}

async function finish(interaction, game, winnerIdx, line) {
  game.over = true;
  game.result = `${line}\n${settlePvp(game, winnerIdx)}`;
  endGame(game);
  return interaction.update(c4.render(game));
}

const c4 = {
  type: 'c4',

  create(challenge) {
    return {
      type: 'c4',
      players: [challenge.challenger.id, challenge.opponent.id],
      names: [challenge.challenger.username, challenge.opponent.username],
      bet: challenge.bet,
      grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
      turn: Math.random() < 0.5 ? 0 : 1,
      over: false,
      result: null,
    };
  },

  render(game) {
    const lines = [
      `🔴🟡 **Connect Four**${game.bet ? ` — bet: **${fmt(game.bet)}**` : ''}`,
      `<@${game.players[0]}> ${PIECES[0]} vs <@${game.players[1]}> ${PIECES[1]}`,
      '',
      '1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣',
      ...game.grid.map((row) => row.map(symbol).join('')),
      '',
      game.over ? game.result : `🎯 <@${game.players[game.turn]}>'s turn (${PIECES[game.turn]})`,
    ];

    const button = (col) =>
      new ButtonBuilder()
        .setCustomId(`game:c4:${game.id}:drop:${col}`)
        .setLabel(String(col + 1))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(game.over || game.grid[0][col] !== null);

    const row1 = new ActionRowBuilder().addComponents([0, 1, 2, 3, 4].map(button));
    const row2 = new ActionRowBuilder().addComponents([5, 6].map(button));
    if (!game.over) {
      row2.addComponents(
        new ButtonBuilder().setCustomId(`game:c4:${game.id}:forfeit`).setLabel('Forfeit').setEmoji('🏳️').setStyle(ButtonStyle.Secondary)
      );
    }

    return { content: lines.join('\n'), components: [row1, row2] };
  },

  async handleButton(interaction, game, action, arg) {
    const me = game.players.indexOf(interaction.user.id);
    if (me === -1) return privateReply(interaction, "You're not in this game.");

    if (action === 'forfeit') return finish(interaction, game, 1 - me, `🏳️ **${game.names[me]}** forfeited!`);
    if (me !== game.turn) return privateReply(interaction, "It's not your turn!");

    const col = Number(arg);
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (game.grid[r][col] === null) {
        row = r;
        break;
      }
    }
    if (row === -1) return privateReply(interaction, 'That column is full.');

    game.grid[row][col] = me;

    if (wins(game.grid, row, col, me)) {
      return finish(interaction, game, me, `🎉 **${game.names[me]}** connected four!`);
    }
    if (game.grid[0].every((v) => v !== null)) {
      game.over = true;
      game.result = "🤝 The board is full, it's a draw! No coins change hands.";
      endGame(game);
      return interaction.update(c4.render(game));
    }

    game.turn = 1 - me;
    return interaction.update(c4.render(game));
  },

  async onExpire(game) {
    const idle = game.turn;
    game.over = true;
    game.result = `⌛ **${game.names[idle]}** ran out of time and forfeits.\n${settlePvp(game, 1 - idle)}`;
    await game.message?.edit(c4.render(game)).catch(() => {});
  },
};

registerModule('c4', c4);
module.exports = c4;
