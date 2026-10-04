const { BLOCKED_MODELS } = require('../config');
const { blockedExtra, saveBlocked } = require('../lib/models');

module.exports = {
  name: '!!unblock',
  usage: '!!unblock <name>',
  description: 'Removes a block that was added with `!!block`.',
  access: 'owner-required',

  async run(message, arg) {
    if (!arg) return message.reply('Usage: `!!unblock <part of a model name>`');

    const i = blockedExtra.indexOf(arg);
    if (i === -1) {
      if (BLOCKED_MODELS.includes(arg)) {
        return message.reply('That entry is built into the code. Remove it from `BLOCKED_MODELS` in `config.js` instead.');
      }
      return message.reply(`\`${arg}\` isn't in the list added with \`!!block\`.`);
    }

    blockedExtra.splice(i, 1);
    saveBlocked();
    return message.reply(`Unblocked \`${arg}\`.`);
  },
};
