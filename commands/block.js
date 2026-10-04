const { getUsableModels, blockedExtra, saveBlocked } = require('../lib/models');

module.exports = {
  name: '!!block',
  usage: '!!block <name>',
  description: 'Blocks every model whose ID contains the text, e.g. `!!block nemotron`.',
  access: 'owner-required',

  async run(message, arg) {
    if (!arg) return message.reply('Usage: `!!block <part of a model name>`');

    let usable;
    try {
      usable = await getUsableModels();
    } catch {
      return message.reply('Could not fetch the model list.');
    }

    const matched = usable.filter((m) => m.id.toLowerCase().includes(arg));
    if (!matched.length) return message.reply(`No available model matches \`${arg}\`, so nothing was blocked.`);
    if (matched.length === usable.length) return message.reply('That would block every free model, so I did not do it.');

    blockedExtra.push(arg);
    saveBlocked();
    const list = matched.map((m) => `\`${m.id}\``).join(', ');
    return message.reply(`Blocked \`${arg}\`. Removed ${matched.length} model(s): ${list}`.slice(0, 1900));
  },
};
