const { startGame, endGame, isBusy } = require('../lib/games/common');
const crash = require('../lib/games/crash');
const { peekUser, parseBet, betError } = require('../lib/economy');

module.exports = {
  name: '!!crash',
  usage: '!!crash [bet]',
  description: 'A rocket multiplier climbs higher and higher. Cash out before it crashes! Leave out the bet for a practice round.',
  access: 'free',

  async run(message, arg) {
    const userId = message.author.id;
    if (isBusy(userId)) return message.reply("You're already in a game. Finish it first!");

    let bet = 0;
    if (arg) {
      bet = parseBet(arg.split(/\s+/)[0], peekUser(userId).coins);
      const error = betError(userId, bet, { allowZero: true });
      if (error) return message.reply(`${error}\nUsage: \`!!crash [bet]\``);
    }

    const game = crash.create({ user: message.author, bet });
    startGame(game);
    try {
      game.message = await message.reply(crash.render(game));
      crash.start(game);
    } catch (err) {
      endGame(game);
      throw err;
    }
  },
};
