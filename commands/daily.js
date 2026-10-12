const daily = require('../lib/daily');

module.exports = {
  name: '!!daily',
  usage: '!!daily [stats|top]',
  description:
    'Claim your free coins for the day. Pick Safe, Lucky, or Gamble, hit streak milestones, and check `!!daily stats`.',
  access: 'free',

  async run(message, arg) {
    return daily.run(message, arg);
  },
};
