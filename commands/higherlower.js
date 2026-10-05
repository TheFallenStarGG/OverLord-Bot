const { startGame, endGame, isBusy } = require('../lib/games/common');
const hl = require('../lib/games/higherlower');
const { peekUser, parseBet, betError } = require('../lib/economy');

module.exports = {
  name: '!!higherlower',
  aliases: ['!!hl'],
  usage: '!!higherlower [bet]',
  description: 'Guess if the next card is higher or lower. Every correct guess raises your multiplier, so cash out before you slip! Leave out the bet for a practice round.',
  access: 'free',

  async run(message, arg) {
    const userId = message.author.id;
    if (isBusy(userId)) return message.reply("You're already in a game. Finish it first!");

    let bet = 0;
    if (arg) {
      bet = parseBet(arg.split(/\s+/)[0], peekUser(userId).coins);
      const error = betError(userId, bet, { allowZero: true });
      if (error) return message.reply(`${error}\nUsage: \`!!higherlower [bet]\``);
    }

    const game = hl.create({ user: message.author, bet });
    startGame(game);
    try {
      game.message = await message.reply(hl.render(game));
    } catch (err) {
      endGame(game);
      throw err;
    }
  },
};
