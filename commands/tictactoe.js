const { runChallengeCommand } = require('../lib/games/common');
require('../lib/games/tictactoe');

module.exports = {
  name: '!!tictactoe',
  usage: '!!tictactoe @user [bet]',
  description: 'Challenges someone to tic-tac-toe, played with buttons. Optionally bet coins on it.',
  access: 'free',

  run(message, arg, ctx) {
    return runChallengeCommand(message, ctx, {
      type: 'ttt',
      title: '❌⭕ **Tic-Tac-Toe challenge**',
      usage: 'Usage: `!!tictactoe @user [bet]`',
    });
  },
};
