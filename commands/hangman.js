const { startGame, endGame, isBusy } = require('../lib/games/common');
const hangman = require('../lib/games/hangman');

const COOLDOWN_MS = 5 * 60 * 1000; // stops people farming rewards by starting rounds nonstop
const lastStarted = new Map();

module.exports = {
  name: '!!hangman',
  usage: '!!hangman',
  description: 'Guess the hidden word before the drawing is finished. Anyone in the channel can help, and whoever solves it wins 25 to 50 coins.',
  access: 'free',

  async run(message) {
    const userId = message.author.id;
    if (isBusy(userId)) return message.reply("You're already in a game. Finish it first!");

    const readyAt = (lastStarted.get(userId) ?? 0) + COOLDOWN_MS;
    if (Date.now() < readyAt) {
      return message.reply(`Take a short break! You can start another round <t:${Math.ceil(readyAt / 1000)}:R>.`);
    }
    lastStarted.set(userId, Date.now());

    const game = hangman.create({ user: message.author });
    startGame(game);
    try {
      game.message = await message.reply(hangman.render(game));
    } catch (err) {
      endGame(game);
      throw err;
    }
  },
};
