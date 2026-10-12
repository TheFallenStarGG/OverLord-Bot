const { runGather } = require('../lib/gathering');

module.exports = {
  name: '!!fish',
  usage: '!!fish [stats|top]',
  description:
    'Pick a fishing zone (Pond, River, Ocean), optional timing bonus, and climb angler ranks. Better rods help. `!!fish stats`.',
  access: 'free',

  async run(message) {
    await runGather(message, 'fish');
  },
};
