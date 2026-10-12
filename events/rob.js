const { MessageFlags } = require('discord.js');
const rob = require('../lib/rob');
const { logging } = require('../lib/logging');

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || !interaction.customId.startsWith('rob:')) return;
    try {
      await rob.handleInteraction(interaction);
    } catch (err) {
      logging('error', 'Rob button failed', err);
      if (!interaction.replied && !interaction.deferred) {
        interaction.reply({ content: 'Something went wrong with that robbery.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });
};
