const rob = require('../lib/rob');

module.exports = {
  name: '!!rob',
  usage: '!!rob [@user] | stats | top | bribe',
  description:
    'Rob a player (pick your method, play the lock minigame, or team up in a crew) or hit an NPC mark. ' +
    'Climb the thief ranks and watch your Heat. `!!rob` alone shows the marks, `!!rob stats` your record.',
  access: 'free',

  async run(message, arg, ctx) {
    return rob.run(message, arg, ctx);
  },
};
