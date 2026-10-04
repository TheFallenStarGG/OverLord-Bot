const { MessageFlags } = require('discord.js');
const { handleGameButton } = require('../lib/games/common');
const { logging } = require('../lib/logging');

// Loading these registers each game with the button router
require('../lib/games/duel');
require('../lib/games/tictactoe');
require('../lib/games/connect4');
require('../lib/games/blackjack');

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || !interaction.customId.startsWith('game:')) return;

    try {
      await handleGameButton(interaction);
    } catch (err) {
      logging('error', 'Game button failed', err);
      if (!interaction.replied && !interaction.deferred) {
        interaction
          .reply({ content: 'Something went wrong with that game.', flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    }
  });
};
