const { MessageFlags } = require('discord.js');
const raid = require('../lib/raid');
const { logging } = require('../lib/logging');

module.exports = (client) => {
  raid.init(client);

  // Delete any raid channels left behind by a restart
  let ran = false;
  const onReady = () => {
    if (ran) return;
    ran = true;
    raid.recover().catch((err) => logging('warn', 'Raid cleanup failed', err.message));
  };
  client.once('clientReady', onReady);
  client.once('ready', onReady);

  client.on('interactionCreate', async (interaction) => {
    if (!(interaction.isButton() || interaction.isStringSelectMenu())) return;
    if (!interaction.customId.startsWith('raid:')) return;
    try {
      await raid.handleInteraction(interaction);
    } catch (err) {
      logging('error', 'Raid interaction failed', err);
      const payload = { content: 'Something went wrong with that raid action. Try again.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) interaction.followUp(payload).catch(() => {});
      else interaction.reply(payload).catch(() => {});
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    raid.noteActivity(message.guild.id, message.author.id);
    try {
      await raid.relay(message);
    } catch (err) {
      logging('warn', 'Raid relay failed', err.message);
    }
  });

  client.on('messageReactionAdd', async (reaction, user) => {
    try {
      await raid.onReaction(reaction, user);
    } catch (err) {
      logging('warn', 'Raid report failed', err.message);
    }
  });

  client.on('messageDelete', (message) => {
    try {
      raid.onDelete(message);
    } catch {
      /* ignore */
    }
  });

  client.on('channelDelete', (channel) => {
    try {
      raid.onChannelDelete(channel);
    } catch {
      /* ignore */
    }
  });

  client.on('guildDelete', (guild) => {
    if (guild.available === false) return; // just a Discord outage
    raid.forgetGuild(guild.id);
  });
};
