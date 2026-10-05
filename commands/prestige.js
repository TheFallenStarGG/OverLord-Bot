const { buildPrestige } = require('../lib/prestige');

module.exports = {
  name: '!!prestige',
  usage: '!!prestige',
  description: 'Reset your level for a permanent +5% coin bonus, a badge, and a coin reward. Needs level 20 (then 25, 30...). Up to 10 times.',
  access: 'free',

  async run(message) {
    await message.reply(buildPrestige(message.author.id));
  },
};
