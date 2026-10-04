const { runChallengeCommand, startGame, endGame, isBusy } = require('../lib/games/common');
const battleship = require('../lib/games/battleship');

module.exports = {
  name: '!!battleship',
  usage: '!!battleship [@user] [bet]',
  description:
    'Plays Battleship. Challenge a friend (optionally with a coin bet), or leave out the player to play a solo practice round against me. ' +
    'You pick the board size (10×10 or 8×8), place your ships in secret, then take turns typing squares like `C4`.',
  access: 'free',

  async run(message, arg, ctx) {
    const opponent = message.mentions.users.first();
    const vsBot = !opponent || opponent.id === ctx.client.user.id;

    // Challenging another person
    if (!vsBot) {
      return runChallengeCommand(message, ctx, {
        type: 'bs',
        title: '🚢 **Battleship challenge**',
        usage: 'Usage: `!!battleship [@user] [bet]`',
      });
    }

    // No opponent: offer a solo game against the bot
    if (isBusy(message.author.id)) return message.reply("You're already in a game. Finish it first!");

    const game = battleship.createSolo(message.author);
    startGame(game);
    try {
      game.message = await message.reply(battleship.render(game));
    } catch (err) {
      endGame(game);
      throw err;
    }
  },
};
