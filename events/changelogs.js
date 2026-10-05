const { MessageFlags } = require('discord.js');
const { buildChangelog } = require('../lib/changelog');
const { logging } = require('../lib/logging');

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || !interaction.customId.startsWith('changelog:')) return;

    try {
      // Button IDs look like changelog:<action>:<current page>:<who opened it>
      const [, action, pageText, ownerId] = interaction.customId.split(':');

      if (interaction.user.id !== ownerId) {
        return interaction.reply({
          content: 'Run `!!changelog` yourself to flip through the pages!',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (action === 'close') {
        await interaction.deferUpdate();
        await interaction.message.delete().catch(() => {});
        return;
      }

      const page = Number(pageText) + (action === 'next' ? 1 : -1);
      await interaction.update(buildChangelog(page, ownerId));
    } catch (err) {
      logging('error', 'Changelog button failed', err);
    }
  });
};
