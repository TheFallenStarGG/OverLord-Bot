const { handleGuess } = require('../lib/games/wordle');
const { logging } = require('../lib/logging');

module.exports = (client) => {
  client.on('messageCreate', async (message) => {
    try {
      await handleGuess(message);
    } catch (err) {
      logging('error', 'Wordle guess failed', err);
    }
  });
};
