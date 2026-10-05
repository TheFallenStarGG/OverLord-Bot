const { buildRanked } = require('../lib/ranked');

module.exports = {
  name: '!!ranked',
  usage: '!!ranked [duel|connect4|battleship]',
  description: 'Shows the ranked ladder for duels, Connect Four, and Battleship. Beat other players to climb. Seasons last a month and the top 3 win coins.',
  access: 'free',

  async run(message, arg) {
    await message.reply(buildRanked(arg.trim(), message.author.id));
  },
};
