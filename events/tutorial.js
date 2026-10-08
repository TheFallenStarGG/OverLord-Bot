const { MessageFlags } = require('discord.js');
const { USER_PAGES, ADMIN_PAGES, buildTutorial } = require('../commands/tutorial');
const { logging } = require('../lib/logging');

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || !interaction.customId.startsWith('tutorial:')) return;
    try {
      const [, mode, action, pageText, ownerId] = interaction.customId.split(':');
      if (interaction.user.id !== ownerId) {
        return interaction.reply({ content: 'Run `!!tutorial` yourself to use these buttons.', flags: MessageFlags.Ephemeral });
      }
      if (action === 'close') {
        await interaction.deferUpdate();
        await interaction.message.delete().catch(() => {});
        return;
      }
      const pages = mode === 'admin' ? ADMIN_PAGES : USER_PAGES;
      const page = Number(pageText) + (action === 'next' ? 1 : -1);
      await interaction.update(buildTutorial(pages, page, ownerId, mode));
    } catch (err) {
      logging('error', 'Tutorial button failed', err);
    }
  });
};
