const { buildQuests } = require('../lib/quests');

module.exports = {
  name: '!!quests',
  aliases: ['!!quest'],
  usage: '!!quests',
  description: 'Shows your 3 daily and 2 weekly quests. Finished quests pay coins (weekly ones also give a Loot Box) when you check them.',
  access: 'free',

  async run(message) {
    await message.reply(buildQuests(message.author.id));
  },
};
