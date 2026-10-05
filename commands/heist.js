const { startHeist } = require('../lib/heist');

module.exports = {
  name: '!!heist',
  usage: '!!heist',
  description: 'Plans a team heist. Others have 60 seconds to join. More crew means better odds, but the loot is shared and failure costs everyone a fine.',
  access: 'free',

  async run(message) {
    await startHeist(message);
  },
};
