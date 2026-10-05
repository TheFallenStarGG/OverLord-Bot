const { startGame, endGame, isBusy } = require('../lib/games/common');
const minesweeper = require('../lib/games/minesweeper');
const { peekUser, parseBet, betError } = require('../lib/economy');

module.exports = {
  name: '!!minesweeper',
  aliases: ['!!ms'],
  usage: '!!minesweeper [bet] [mines]',
  description:
    'Reveal safe tiles on a grid and cash out before you hit a mine! More mines (2 to 10, default 4) means bigger payouts. Leave out the bet for a practice round.',
  access: 'free',

  async run(message, arg) {
    if (isBusy(message.author.id)) return message.reply("You're already in a game. Finish it first!");

    const [betText, minesText] = arg.split(/\s+/);
    let bet = 0;
    if (betText) {
      bet = parseBet(betText, peekUser(message.author.id).coins);
      const error = betError(message.author.id, bet, { allowZero: true });
      if (error) return message.reply(`${error}\nUsage: \`!!minesweeper [bet] [mines]\``);
    }

    let mines = 4;
    if (minesText) {
      mines = parseInt(minesText, 10);
      if (!(mines >= 2 && mines <= 10)) return message.reply('Pick between 2 and 10 mines.');
    }

    const game = minesweeper.create({ user: message.author, bet, mines });
    startGame(game);
    try {
      game.message = await message.reply(minesweeper.render(game));
    } catch (err) {
      endGame(game);
      throw err;
    }
  },
};
