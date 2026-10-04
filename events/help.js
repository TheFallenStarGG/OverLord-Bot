const { MessageFlags } = require('discord.js');
const { buildHelp } = require('../lib/helpPages');
const { logging } = require('../lib/logging');

module.exports = (client, ctx) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || !interaction.customId.startsWith('help:')) return;

    try {
      // Button IDs look like help:<action>:<current page>:<who opened it>
      const [, action, pageText, ownerId] = interaction.customId.split(':');

      if (interaction.user.id !== ownerId) {
        return interaction.reply({
          content: 'Run `!!help` yourself to flip through the pages!',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (action === 'close') {
        await interaction.deferUpdate();
        await interaction.message.delete().catch(() => {});
        return;
      }

      const page = Number(pageText) + (action === 'next' ? 1 : -1);
      await interaction.update(buildHelp(ctx.commands, client, page, ownerId));
    } catch (err) {
      logging('error', 'Help button failed', err);
    }
  });
};
