const { handleRematch } = require('../lib/games/duel');
const { handleReady, checkAutoStart } = require('../lib/tournament');
const { logging } = require('../lib/logging');
const { forEachGuild } = require('../lib/storage');

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    const id = interaction.customId;

    try {
      if (id.startsWith('rematch:duel:')) return await handleRematch(interaction);
      if (id.startsWith('tourney:ready:')) return await handleReady(interaction);
    } catch (err) {
      logging('error', 'Combat button failed', err);
    }
  });

  setInterval(() => {
    forEachGuild(client, () => checkAutoStart(client));
  }, 60 * 1000);
};
