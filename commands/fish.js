const { runGather } = require('../lib/gathering');

module.exports = {
  name: '!!fish',
  usage: '!!fish',
  description: 'Go fishing! Every 3 minutes you can catch something to sell. Better rods find rarer fish.',
  access: 'free',

  async run(message) {
    await runGather(message, 'fish');
  },
};
