const { peekUser, parseBet, betError } = require('../lib/economy');
const { isBusy, startGame } = require('../lib/games/common');
const ldice = require('../lib/games/liarsdice');

module.exports = {
  name: '!!liarsdice',
  aliases: ['!!ld'],
  usage: '!!liarsdice [bet]',
  description: "Opens a lobby for Liar's Dice (2-5 players). Bluff about how many dice are on the table, or call someone a liar. The last player with dice wins, and everyone antes the bet.",
  access: 'free',

  async run(message, arg) {
    if (isBusy(message.author.id)) return message.reply("You're already in a game. Finish it first!");

    let bet = 0;
    if (arg) {
      bet = parseBet(arg.split(/\s+/)[0], peekUser(message.author.id).coins);
      if (bet === null) return message.reply('That bet is not valid. Usage: `!!liarsdice [bet]`');
    }
    const error = betError(message.author.id, bet, { allowZero: true });
    if (error) return message.reply(error);

    const game = ldice.createLobby(message.author, bet);
    startGame(game);
    game.message = await message.reply(ldice.render(game));
  },
};
