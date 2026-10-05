const { runGather } = require('../lib/gathering');

module.exports = {
  name: '!!mine',
  usage: '!!mine',
  description: 'Go mining! Every 3 minutes you can dig up something to sell. Better pickaxes find rarer ores.',
  access: 'free',

  async run(message) {
    await runGather(message, 'mine');
  },
};
