const work = require('../lib/work');

module.exports = {
  name: '!!work',
  usage: '!!work [stats|top]',
  description:
    'Pick a shift (Easy, Standard, or Double), optional hustle minigame for bonus pay, and climb careers. `!!work stats` for your record.',
  access: 'free',

  async run(message, arg) {
    return work.run(message, arg);
  },
};
