const { startGame, endGame, isBusy } = require('../lib/games/common');
const blackjack = require('../lib/games/blackjack');
const { peekUser, parseBet, betError } = require('../lib/economy');

module.exports = {
  name: '!!blackjack',
  usage: '!!blackjack [bet]',
  description: 'Plays blackjack against the dealer with hit and stand buttons. Blackjack pays 3:2. Leave out the bet for a practice round.',
  access: 'free',

  async run(message, arg) {
    if (isBusy(message.author.id)) return message.reply("You're already in a game. Finish it first!");

    const token = arg.split(/\s+/)[0];
    let bet = 0;
    if (token) {
      bet = parseBet(token, peekUser(message.author.id).coins);
      const error = betError(message.author.id, bet);
      if (error) return message.reply(`${error}\nUsage: \`!!blackjack [bet]\``);
    }

    const game = blackjack.create({ user: message.author, bet });
    if (!game.over) startGame(game); // naturals are settled immediately and never need a game slot

    try {
      game.message = await message.reply(blackjack.render(game));
    } catch (err) {
      if (!game.over) endGame(game);
      throw err;
    }
  },
};
