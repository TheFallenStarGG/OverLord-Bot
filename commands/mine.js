const { runGather } = require('../lib/gathering');

module.exports = {
  name: '!!mine',
  usage: '!!mine [stats|top]',
  description:
    'Pick a mining zone (Surface, Cave, Deep), optional timing bonus, and climb delver ranks. Better picks help. `!!mine stats`.',
  access: 'free',

  async run(message) {
    await runGather(message, 'mine');
  },
};
