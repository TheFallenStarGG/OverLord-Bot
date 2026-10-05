const { MessageFlags, ChannelType } = require('discord.js');
const { buildShop } = require('../lib/shopPages');
const { buildPrestige, performPrestige } = require('../lib/prestige');
const { handleJoin } = require('../lib/heist');
const { spawnBoss, handleBossHit } = require('../lib/boss');
const { drawIfDue } = require('../lib/lottery');
const { fmt } = require('../lib/economy');
const { logging } = require('../lib/logging');

// Bosses are rare: any message has a small chance, and a server can't get one more often than every 2 hours
const BOSS_SPAWN_CHANCE = 1 / 600;
const BOSS_MIN_GAP_MS = 2 * 60 * 60 * 1000;
const lastBossSpawn = new Map(); // guildId -> time

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

  // Rare boss spawns
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild || message.channel.type !== ChannelType.GuildText) return;
    if (Math.random() > BOSS_SPAWN_CHANCE) return;

    const guildId = message.guild.id;
    if (Date.now() - (lastBossSpawn.get(guildId) ?? 0) < BOSS_MIN_GAP_MS) return;

    try {
      const boss = await spawnBoss(message.channel);
      if (boss) {
        lastBossSpawn.set(guildId, Date.now());
        logging('info', 'Boss spawned', `${boss.name} in #${message.channel.name} (${message.guild.name})`);
      }
    } catch (err) {
      logging('error', 'Boss spawn failed', err);
    }
  });

  // The daily lottery draw happens once a new day (UTC) starts
  setInterval(() => {
    drawIfDue(client).catch((err) => logging('error', 'Lottery draw failed', err));
  }, 60 * 1000);
};
