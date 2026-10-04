const { randomInt } = require('crypto');

module.exports = {
  name: '!!roll',
  usage: '!!roll [NdM+X]',
  description:
    'Rolls dice. `!!roll` is one d6, `!!roll 2d6+3` rolls two six-sided dice and adds 3, and `!!roll d20` or `!!roll 20` rolls a d20. Max 20 dice and 1000 sides.',
  access: 'free',

  async run(message, arg) {
    const text = (arg || '1d6').replace(/\s+/g, '');

    let match = /^(\d*)d(\d+)([+-]\d+)?$/.exec(text);
    if (!match) {
      const plain = /^(\d+)$/.exec(text); // "20" means one d20
      if (plain) match = [null, '1', plain[1], undefined];
    }
    if (!match) return message.reply('Usage: `!!roll 2d6`, `!!roll d20+5`, or `!!roll 20`.');

    const count = match[1] ? parseInt(match[1]) : 1;
    const sides = parseInt(match[2]);
    const modifier = match[3] ? parseInt(match[3]) : 0;

    if (count < 1 || count > 20) return message.reply('You can roll between 1 and 20 dice.');
    if (sides < 2 || sides > 1000) return message.reply('Dice need between 2 and 1000 sides.');
    if (Math.abs(modifier) > 1000) return message.reply('The modifier can be at most ±1000.');

    const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
    const total = rolls.reduce((a, b) => a + b, 0) + modifier;
    const modText = modifier ? ` ${modifier > 0 ? '+' : '-'} ${Math.abs(modifier)}` : '';

    return message.reply(`🎲 **${count}d${sides}${match[3] ?? ''}**: [${rolls.join(', ')}]${modText} = **${total}**`);
  },
};
