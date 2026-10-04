const { runChallengeCommand } = require('../lib/games/common');
require('../lib/games/connect4');

module.exports = {
  name: '!!connect4',
  usage: '!!connect4 @user [bet]',
  description: 'Challenges someone to Connect Four, played with column buttons. Optionally bet coins on it.',
  access: 'free',

  run(message, arg, ctx) {
    return runChallengeCommand(message, ctx, {
      type: 'c4',
      title: '🔴🟡 **Connect Four challenge**',
      usage: 'Usage: `!!connect4 @user [bet]`',
    });
  },
};
