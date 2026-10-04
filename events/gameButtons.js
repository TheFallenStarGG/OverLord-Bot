const { MessageFlags } = require('discord.js');
const { handleGameButton } = require('../lib/games/common');
const { logging } = require('../lib/logging');

// Loading these registers each game with the button router
require('../lib/games/duel');
require('../lib/games/tictactoe');
require('../lib/games/connect4');
require('../lib/games/blackjack');
require('../lib/games/battleship');

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    const isGameInteraction =
      (interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('game:');
    if (!isGameInteraction) return;

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
