const { randomInt } = require('crypto');

module.exports = {
  name: '!!choose',
  usage: '!!choose <option> | <option> | ...',
  description: 'Picks one of your options at random. Separate them with `|` (or commas). Example: `!!choose pizza | tacos | sushi`.',
  access: 'free',

  async run(message, arg, ctx) {
    const raw = ctx.rawArg;

    let options = raw.split('|').map((s) => s.trim()).filter(Boolean);
    if (options.length < 2) options = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (options.length < 2) return message.reply('Give me at least 2 options, like `!!choose pizza | tacos`.');

    const pick = options[randomInt(options.length)];
    return message.reply(`🤔 I choose: **${pick}**`.slice(0, 1900));
  },
};
