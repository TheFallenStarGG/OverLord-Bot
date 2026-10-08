const { MessageFlags, ChannelType } = require('discord.js');
const { buildShop } = require('../lib/shopPages');
const { buildPrestige, performPrestige } = require('../lib/prestige');
const { handleJoin } = require('../lib/heist');
const { spawnBoss, handleBossHit } = require('../lib/boss');
const { drawIfDue } = require('../lib/lottery');
const { fmt } = require('../lib/economy');
const { logging } = require('../lib/logging');
const { bossDue, bossSpawned, bossRetryLater } = require('../lib/modifiers');
const { getChannel } = require('../lib/announce');
const { forEachGuild } = require('../lib/storage');

// Bosses follow a saved schedule (2 to 6 hours apart, see lib/modifiers.js), so restarting the bot doesn't affect them

async function handleShopButton(interaction) {
  // Button IDs look like shop:<action>:<current page>:<who opened it>
  const [, action, pageText, ownerId] = interaction.customId.split(':');

  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'Run `!!shop` yourself to browse!', flags: MessageFlags.Ephemeral });
  }
  if (action === 'close') {
    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => {});
    return;
  }
  const page = Number(pageText) + (action === 'next' ? 1 : -1);
  await interaction.update(buildShop(page, ownerId));
}

async function handlePrestigeButton(interaction) {
  const [, action, ownerId] = interaction.customId.split(':');

  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'Only the person who ran `!!prestige` can press this.', flags: MessageFlags.Ephemeral });
  }
  if (action === 'cancel') {
    return interaction.update({ content: 'No problem, prestige whenever you\'re ready!', embeds: [], components: [] });
  }

  const result = performPrestige(ownerId);
  if (result.error) return interaction.update({ content: `⚠️ ${result.error}`, embeds: [], components: [] });

  logging('info', 'Prestige', `${interaction.user.username} reached prestige ${result.prestige}`);
  return interaction.update({
    content: `✨ **You reached Prestige ${result.prestige}!** Your level was reset, you got a permanent bonus, and **${fmt(result.reward)}** as a reward!`,
    embeds: [],
    components: [],
  });
}

module.exports = (client) => {
  // Buttons
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    const id = interaction.customId;

    try {
      if (id.startsWith('shop:')) return await handleShopButton(interaction);
      if (id.startsWith('prestige:')) return await handlePrestigeButton(interaction);
      if (id.startsWith('heist:')) return await handleJoin(interaction);
      if (id.startsWith('boss:')) return await handleBossHit(interaction);
    } catch (err) {
      logging('error', 'Button failed', err);
    }
  });

  // Rare boss spawns: only in servers that picked an events channel, and always in that channel
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const guildId = message.guild.id;
    const channelId = getChannel(guildId);
    if (!channelId || !bossDue(guildId)) return;

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) throw new Error('The events channel is missing');
      const boss = await spawnBoss(channel);
      bossSpawned(guildId); // a boss appeared (or one was already there), so schedule the next one
      if (boss) logging('info', 'Boss spawned', `${boss.name} in #${channel.name} (${message.guild.name})`);
    } catch (err) {
      bossRetryLater(guildId);
      logging('warn', 'Boss spawn failed', err.message);
    }
  });

  // The daily lottery draw happens once a new day (UTC) starts
  setInterval(() => {
    forEachGuild(client, () => drawIfDue(client));
  }, 60 * 1000);
};
