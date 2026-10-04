const { startWordle } = require('../lib/games/wordle');

module.exports = {
  name: '!!wordle',
  usage: '!!wordle',
  description: 'Starts a Wordle for the whole channel. Type 5-letter words to guess. The solver wins coins, more for fewer guesses.',
  access: 'free',

  async run(message) {
    await startWordle(message);
  },
};
