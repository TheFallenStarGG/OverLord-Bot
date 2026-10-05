const { buildChangelog } = require('../lib/changelog');

module.exports = {
  name: '!!changelog',
  aliases: ['!!changelogs', '!!updates'],
  usage: '!!changelog [page]',
  description: 'Shows what\'s new in the bot, one update per page, newest first.',
  access: 'free',

  async run(message, arg) {
    // People count pages from 1, the code counts from 0
    const page = Number(arg) ? Number(arg) - 1 : 0;
    await message.reply(buildChangelog(page, message.author.id));
  },
};
