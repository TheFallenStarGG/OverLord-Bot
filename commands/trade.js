const { runChallengeCommand } = require('../lib/games/common');

module.exports = {
  name: '!!trade',
  usage: '!!trade @user',
  description:
    'Trade coins and items with another member in a safe, two-sided window. You can trade fish, ores, materials, supplies, and forged weapons or armor (not equipped gear).',
  access: 'free',

  async run(message, arg, ctx) {
    return runChallengeCommand(message, ctx, {
      type: 'tr',
      title: '🤝 **Trade request**',
      usage: 'Usage: `!!trade @user`',
      verb: 'wants to trade with',
    });
  },
};
