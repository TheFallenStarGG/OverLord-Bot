const { runChallengeCommand } = require('../lib/games/common');
require('../lib/games/duel');

module.exports = {
  name: '!!duel',
  usage: '!!duel @user [bet]',
  description: 'Challenges someone to a turn-based duel with attack, defend, and heal buttons. Optionally bet coins on it.',
  access: 'free',

  run(message, arg, ctx) {
    return runChallengeCommand(message, ctx, {
      type: 'duel',
      title: '⚔️ **Duel challenge**',
      usage: 'Usage: `!!duel @user [bet]`',
    });
  },
};
