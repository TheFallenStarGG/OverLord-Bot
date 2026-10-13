const { runGather } = require('../lib/gathering');
const { isLegacy } = require('../lib/legacyMode');

module.exports = {
  name: '!!fish',
  usage: '!!fish [stats|top]',
  description:
    'Pick a zone and follow the on-screen hook prompt for better rares. `!!legacy-commands` for the classic version.',
  access: 'free',

  async run(message) {
    await runGather(message, 'fish', { legacy: isLegacy(message.author.id) });
  },
};
