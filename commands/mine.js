const { runGather } = require('../lib/gathering');
const { isLegacy } = require('../lib/legacyMode');

module.exports = {
  name: '!!mine',
  usage: '!!mine [stats|top]',
  description:
    'Pick a zone and follow the on-screen strike prompt for better rares. `!!legacy-commands` for the classic version.',
  access: 'free',

  async run(message) {
    await runGather(message, 'mine', { legacy: isLegacy(message.author.id) });
  },
};
