const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getUser, peekUser, addCoins, applyDelta, markDirty, fmt } = require('./economy');

const JOIN_MS = 60 * 1000;
const MIN_COINS = 100; // to join, since you'd pay a fine if it fails
const COOLDOWN_MS = 30 * 60 * 1000;

const heists = new Map(); // channelId -> heist

// More crew means better odds, and a bigger vault (that the crew splits)
const chance = (crew) => Math.min(0.8, 0.35 + 0.08 * crew);
const vault = (crew) => 400 + 150 * crew;

function joinError(userId) {
  const u = peekUser(userId);
  if (u.coins < MIN_COINS) return `You need at least **${fmt(MIN_COINS)}** to join a heist.`;
  const readyAt = (u.lastHeist ?? 0) + COOLDOWN_MS;
  if (Date.now() < readyAt) return `⏳ You're still laying low. You can join another heist <t:${Math.ceil(readyAt / 1000)}:R>.`;
  return null;
}

function render(heist, closed = false) {
  const n = heist.crew.size;
  const lines = [
    `🧨 **Heist!** <@${heist.starter}> is planning to crack the bank vault!`,
    closed ? '' : `Join within <t:${Math.floor(heist.endsAt / 1000)}:R>. More crew means better odds, but the loot is shared.`,
    '',
    `👥 **Crew (${n}):** ${[...heist.crew].map((id) => `<@${id}>`).join(', ')}`,
    n >= 2
      ? `🎯 Success chance: **${Math.round(chance(n) * 100)}%** · 💰 Vault: **${fmt(vault(n))}** (${fmt(Math.floor(vault(n) / n))} each)`
      : '🎯 You need at least **2** people to pull this off.',
    `-# Fail and every member pays a fine of 8% of their coins (20 to 400).`,
  ];
  const components = closed
    ? []
    : [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`heist:join:${heist.channelId}`).setLabel('Join the heist').setEmoji('🧨').setStyle(ButtonStyle.Danger)
        ),
      ];
  return { content: lines.filter((l) => l !== '').join('\n'), components };
}

async function startHeist(message) {
  const channelId = message.channel.id;
  if (heists.has(channelId)) return message.reply('A heist is already being planned in this channel!');

  const error = joinError(message.author.id);
  if (error) return message.reply(error);

  getUser(message.author.id).lastHeist = Date.now();
  markDirty();

  const heist = { channelId, starter: message.author.id, crew: new Set([message.author.id]), endsAt: Date.now() + JOIN_MS, message: null };
  heists.set(channelId, heist);

  try {
    heist.message = await message.reply(render(heist));
  } catch (err) {
    heists.delete(channelId);
    throw err;
  }
  setTimeout(() => resolve(heist), JOIN_MS);
}

async function handleJoin(interaction) {
  const channelId = interaction.customId.split(':')[2];
  const heist = heists.get(channelId);
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (!heist) return reply('This heist is already over.');
  if (heist.crew.has(interaction.user.id)) return reply("You're already in the crew!");

  const error = joinError(interaction.user.id);
  if (error) return reply(error);

  getUser(interaction.user.id).lastHeist = Date.now();
  markDirty();
  heist.crew.add(interaction.user.id);
  return interaction.update(render(heist));
}

async function resolve(heist) {
  heists.delete(heist.channelId);
  const crew = [...heist.crew];
  const n = crew.length;

  if (n < 2) {
    getUser(heist.starter).lastHeist = 0; // no penalty if nobody joined
    markDirty();
    await heist.message.edit({ content: '🧨 Nobody joined the heist, so it was called off.', components: [] }).catch(() => {});
    return;
  }

  const lines = [];
  if (Math.random() < chance(n)) {
    const share = Math.floor(vault(n) / n);
    crew.forEach((id) => addCoins(id, share));
    lines.push(`✅ **The heist was a success!** The crew cracked the vault and split **${fmt(vault(n))}**: **${fmt(share)}** each.`);
  } else {
    lines.push('🚔 **The heist failed!** The police showed up and everyone paid a fine:');
    for (const id of crew) {
      const fine = Math.min(400, Math.max(20, Math.floor(peekUser(id).coins * 0.08)));
      const paid = -applyDelta(id, -fine);
      lines.push(`• <@${id}> paid ${fmt(paid)}`);
    }
  }
  lines.push('', `👥 Crew: ${crew.map((id) => `<@${id}>`).join(', ')}`);
  await heist.message.edit({ content: lines.join('\n'), components: [] }).catch(() => {});
}

module.exports = { startHeist, handleJoin };
