const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registerModule, endGame, privateReply, settlePvp } = require('./common');
const { fmt } = require('../economy');

const MARKS = ['❌', '⭕'];
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

async function finish(interaction, game, winnerIdx, line) {
  game.over = true;
  game.result = `${line}\n${settlePvp(game, winnerIdx)}`;
  endGame(game);
  return interaction.update(ttt.render(game));
}

const ttt = {
  type: 'ttt',

  create(challenge) {
    return {
      type: 'ttt',
      players: [challenge.challenger.id, challenge.opponent.id],
      names: [challenge.challenger.username, challenge.opponent.username],
      bet: challenge.bet,
      board: Array(9).fill(null), // null, 0 or 1 (the player who owns the square)
      turn: Math.random() < 0.5 ? 0 : 1,
      over: false,
      result: null,
    };
  },

  render(game) {
    const lines = [
      `❌⭕ **Tic-Tac-Toe**${game.bet ? ` — bet: **${fmt(game.bet)}**` : ''}`,
      `<@${game.players[0]}> ${MARKS[0]} vs <@${game.players[1]}> ${MARKS[1]}`,
      '',
      game.over ? game.result : `🎯 <@${game.players[game.turn]}>'s turn (${MARKS[game.turn]})`,
    ];

    const rows = [];
    for (let r = 0; r < 3; r++) {
      const row = new ActionRowBuilder();
      for (let c = 0; c < 3; c++) {
        const i = r * 3 + c;
        const owner = game.board[i];
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`game:ttt:${game.id}:move:${i}`)
            .setEmoji(owner === null ? '⬜' : MARKS[owner])
            .setStyle(owner === null ? ButtonStyle.Secondary : owner === 0 ? ButtonStyle.Danger : ButtonStyle.Primary)
            .setDisabled(game.over || owner !== null)
        );
      }
      rows.push(row);
    }
    if (!game.over) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`game:ttt:${game.id}:forfeit`).setLabel('Forfeit').setEmoji('🏳️').setStyle(ButtonStyle.Secondary)
        )
      );
    }

    return { content: lines.join('\n'), components: rows };
  },

  async handleButton(interaction, game, action, arg) {
    const me = game.players.indexOf(interaction.user.id);
    if (me === -1) return privateReply(interaction, "You're not in this game.");

    if (action === 'forfeit') return finish(interaction, game, 1 - me, `🏳️ **${game.names[me]}** forfeited!`);
    if (me !== game.turn) return privateReply(interaction, "It's not your turn!");

    const i = Number(arg);
    if (!(i >= 0 && i < 9) || game.board[i] !== null) return privateReply(interaction, 'That square is taken.');

    game.board[i] = me;

    if (LINES.some((line) => line.every((j) => game.board[j] === me))) {
      return finish(interaction, game, me, `🎉 **${game.names[me]}** got three in a row!`);
    }
    if (game.board.every((v) => v !== null)) {
      game.over = true;
      game.result = "🤝 It's a draw! No coins change hands.";
      endGame(game);
      return interaction.update(ttt.render(game));
    }

    game.turn = 1 - me;
    return interaction.update(ttt.render(game));
  },

  async onExpire(game) {
    const idle = game.turn;
    game.over = true;
    game.result = `⌛ **${game.names[idle]}** ran out of time and forfeits.\n${settlePvp(game, 1 - idle)}`;
    await game.message?.edit(ttt.render(game)).catch(() => {});
  },
};

registerModule('ttt', ttt);
module.exports = ttt;
