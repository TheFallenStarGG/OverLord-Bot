const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getUser, markDirty, fmt } = require('./economy');
const { addItem } = require('./inventory');

const DURATION_MS = 10 * 60 * 1000; // how long a boss stays before escaping
const HIT_COOLDOWN_MS = 6 * 1000; // between each person's attacks
const RENDER_GAP_MS = 2500; // the message updates at most this often

const BOSSES = [
  ['Giant Crab', '🦀'],
  ['Ancient Dragon', '🐉'],
  ['Shadow Golem', '🗿'],
  ['Sewer King', '🐀'],
  ['Kraken', '🐙'],
  ['Storm Titan', '⛈️'],
  ['Skeleton Lord', '💀'],
];

const bosses = new Map(); // guildId -> the active boss there
let lastDefeated = null; // { name, emoji, at }

const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const MEDALS = ['🥇', '🥈', '🥉', '4.', '5.'];

const bar = (hp, max) => {
  const filled = Math.max(0, Math.ceil((hp / max) * 20));
  return '🟥'.repeat(filled) + '⬛'.repeat(20 - filled);
};

function render(boss) {
  const top = [...boss.damage]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, dmg], i) => `${MEDALS[i]} <@${id}> — **${dmg.toLocaleString('en-US')}**`)
    .join('\n') || '*Nobody has attacked yet. Be the first!*';

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`${boss.emoji} A wild ${boss.name} appeared!`)
    .setDescription(
      `${bar(boss.hp, boss.maxHp)}\n**${Math.max(boss.hp, 0).toLocaleString('en-US')} / ${boss.maxHp.toLocaleString('en-US')} HP**\n` +
      `It escapes <t:${Math.floor(boss.expiresAt / 1000)}:R>!`
    )
    .addFields(
      { name: '⚔️ Top damage', value: top },
      { name: '📜 Recent hits', value: boss.log.slice(-4).join('\n') || '—' }
    )
    .setFooter({ text: 'Everyone can help! Press Attack as often as you can.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`boss:hit:${boss.id}`).setLabel('Attack!').setEmoji('⚔️').setStyle(ButtonStyle.Danger)
  );
  return { embeds: [embed], components: [row] };
}

// Starts a boss in a channel. Returns the boss, or null if one is already active in that server.
async function spawnBoss(channel, hp) {
  const guildId = channel.guild.id;
  if (bosses.has(guildId)) return null;

  const [name, emoji] = BOSSES[Math.floor(Math.random() * BOSSES.length)];
  const maxHp = hp ?? rand(2500, 4000);
  const boss = {
    id: Math.random().toString(36).slice(2, 8),
    guildId,
    channelId: channel.id,
    name,
    emoji,
    maxHp,
    hp: maxHp,
    damage: new Map(), // userId -> total damage
    lastHit: new Map(), // userId -> when they last attacked
    log: [],
    expiresAt: Date.now() + DURATION_MS,
    lastRender: 0,
    renderTimer: null,
    timer: null,
    message: null,
    ended: false,
  };
  bosses.set(guildId, boss);

  try {
    boss.message = await channel.send({ content: '🚨 **A boss has appeared!**', ...render(boss) });
  } catch (err) {
    bosses.delete(guildId);
    throw err;
  }
  boss.timer = setTimeout(() => expire(boss), DURATION_MS);
  return boss;
}

function endBoss(boss) {
  boss.ended = true;
  clearTimeout(boss.timer);
  clearTimeout(boss.renderTimer);
  bosses.delete(boss.guildId);
}

// Pays out: the pool is split by damage dealt. Top damager and last hitter get a Loot Box.
function defeat(boss, killerId) {
  endBoss(boss);
  lastDefeated = { name: boss.name, emoji: boss.emoji, at: Date.now() };

  const total = [...boss.damage.values()].reduce((a, b) => a + b, 0);
  const pool = 2000 + 300 * boss.damage.size;
  const sorted = [...boss.damage].sort((a, b) => b[1] - a[1]);

  const lines = [];
  sorted.forEach(([id, dmg], i) => {
    let payout = Math.max(50, Math.floor((pool * dmg) / total));
    const extras = [];
    if (id === killerId) {
      payout += 200;
      extras.push('last hit +200');
    }

    const u = getUser(id);
    u.coins += payout;
    if (i === 0 || id === killerId || Math.random() < 0.2) {
      addItem(u, 'lootbox');
      extras.push('🎁 Loot Box');
    }
    if (lines.length < 8) {
      lines.push(`${MEDALS[i] ?? `${i + 1}.`} <@${id}> — ${dmg.toLocaleString('en-US')} dmg → **${fmt(payout)}**${extras.length ? ` (${extras.join(', ')})` : ''}`);
    }
  });
  markDirty();

  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`🎉 The ${boss.name} was defeated!`)
    .setDescription(`The final blow was struck by <@${killerId}>!\nTotal reward pool: **${fmt(pool)}**, split by damage dealt.`)
    .addFields({ name: '🏆 Rewards', value: lines.join('\n') });
}

async function expire(boss) {
  if (boss.ended) return;
  endBoss(boss);

  for (const id of boss.damage.keys()) getUser(id).coins += 25; // small thanks for trying
  markDirty();

  const embed = new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle(`${boss.emoji} The ${boss.name} escaped!`)
    .setDescription(
      boss.damage.size
        ? `Nobody dealt enough damage in time. Everyone who fought got **${fmt(25)}** for trying.`
        : 'Nobody dared to fight it...'
    );
  await boss.message.edit({ embeds: [embed], components: [] }).catch(() => {});
}

async function handleBossHit(interaction) {
  const bossId = interaction.customId.split(':')[2];
  const boss = [...bosses.values()].find((b) => b.id === bossId);
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  if (!boss || boss.ended) return reply('This boss is already gone!');

  const now = Date.now();
  const userId = interaction.user.id;
  const wait = (boss.lastHit.get(userId) ?? 0) + HIT_COOLDOWN_MS - now;
  if (wait > 0) return reply(`Catch your breath! You can attack again in ${Math.ceil(wait / 1000)}s.`);
  boss.lastHit.set(userId, now);

  let dmg = rand(20, 60);
  const crit = Math.random() < 0.1;
  if (crit) dmg *= 2;
  boss.hp -= dmg;
  boss.damage.set(userId, (boss.damage.get(userId) ?? 0) + dmg);
  boss.log.push(`${crit ? '💥 CRIT! ' : ''}<@${userId}> hit for **${dmg}**`);
  if (boss.log.length > 6) boss.log.shift();

  if (boss.hp <= 0) {
    const summary = defeat(boss, userId);
    return interaction.update({ content: '', embeds: [summary], components: [] });
  }

  // Update the message right away, or a moment later if it was just updated
  if (now - boss.lastRender >= RENDER_GAP_MS) {
    boss.lastRender = now;
    return interaction.update(render(boss));
  }
  await interaction.deferUpdate();
  if (!boss.renderTimer) {
    boss.renderTimer = setTimeout(() => {
      boss.renderTimer = null;
      boss.lastRender = Date.now();
      if (!boss.ended) boss.message.edit(render(boss)).catch(() => {});
    }, RENDER_GAP_MS - (now - boss.lastRender));
  }
}

const getActiveBoss = (guildId) => bosses.get(guildId) ?? null;
const getLastDefeated = () => lastDefeated;

module.exports = { spawnBoss, handleBossHit, getActiveBoss, getLastDefeated };
