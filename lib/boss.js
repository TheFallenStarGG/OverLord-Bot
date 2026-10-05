const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getUser, markDirty, fmt } = require('./economy');
const { CLASSES } = require('./combat/classes');
const { ensureProfile, playerGear, awardTitle, ELEMENTS, MATERIALS, SKINS, TITLES } = require('./combat/gear');

const DURATION_MS = 10 * 60 * 1000; // how long a boss stays before escaping
const RENDER_GAP_MS = 2500; // the message updates at most this often
const SPECIAL_CD_MS = 45 * 1000;
const TELEGRAPH_MS = 10 * 1000; // time you get to block
const TELEGRAPH_EVERY_MS = 60 * 1000;
const ENRAGED_EVERY_MS = 35 * 1000;

// weak = the element that deals extra damage. drop = the essence it drops.
const BOSSES = [
  { name: 'Giant Crab', emoji: '🦀', weak: 'fire', drop: 'essence_ice' },
  { name: 'Ancient Dragon', emoji: '🐉', weak: 'ice', drop: 'essence_fire', special: 'dragonscale' },
  { name: 'Shadow Golem', emoji: '🗿', weak: 'fire', drop: 'essence_poison' },
  { name: 'Sewer King', emoji: '🐀', weak: 'fire', drop: 'essence_poison' },
  { name: 'Kraken', emoji: '🐙', weak: 'poison', drop: 'essence_ice' },
  { name: 'Storm Titan', emoji: '⛈️', weak: 'poison', drop: 'essence_fire' },
  { name: 'Skeleton Lord', emoji: '💀', weak: 'fire', drop: 'essence_poison' },
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
  const now = Date.now();
  const top = [...boss.damage]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, dmg], i) => `${MEDALS[i]} <@${id}> — **${dmg.toLocaleString('en-US')}**`)
    .join('\n') || '*Nobody has attacked yet. Be the first!*';

  const lines = [
    `${bar(boss.hp, boss.maxHp)}\n**${Math.max(boss.hp, 0).toLocaleString('en-US')} / ${boss.maxHp.toLocaleString('en-US')} HP**`,
    `💥 Weak to ${ELEMENTS[boss.weak].emoji} **${ELEMENTS[boss.weak].name}** (enchanted weapons deal ×1.5)`,
    boss.enraged ? '🔥 **ENRAGED!** It attacks much more often!' : null,
    boss.rallyUntil > now ? `📣 **Rally!** Everyone deals +20% until <t:${Math.floor(boss.rallyUntil / 1000)}:R>` : null,
    boss.telegraph
      ? `\n⚠️ **The ${boss.name} is charging a devastating attack!** Press **Block** before <t:${Math.floor(boss.telegraph.until / 1000)}:R> or be stunned!`
      : `It escapes <t:${Math.floor(boss.expiresAt / 1000)}:R>!`,
  ].filter(Boolean);

  const stunned = [...boss.stunned].filter(([, until]) => until > now).length;

  const embed = new EmbedBuilder()
    .setColor(boss.telegraph ? 0xf1c40f : boss.enraged ? 0xe67e22 : 0xed4245)
    .setTitle(`${boss.emoji} A wild ${boss.name} appeared!`)
    .setDescription(lines.join('\n'))
    .addFields(
      { name: '⚔️ Top damage', value: top },
      { name: '📜 Recent events', value: boss.log.slice(-4).join('\n') || '—' }
    )
    .setFooter({ text: `Attack with your weapon, use your class Special, and Block telegraphed attacks.${stunned ? ` · 💫 ${stunned} stunned` : ''}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`boss:hit:${boss.id}`).setLabel('Attack').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`boss:special:${boss.id}`).setLabel('Special').setEmoji('✨').setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`boss:block:${boss.id}`)
      .setLabel('Block!')
      .setEmoji('🛡️')
      .setStyle(boss.telegraph ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!boss.telegraph)
  );
  return { embeds: [embed], components: [row] };
}

// Starts a boss in a channel. Returns the boss, or null if one is already active in that server.
async function spawnBoss(channel, hp) {
  const guildId = channel.guild.id;
  if (bosses.has(guildId)) return null;

  const def = BOSSES[Math.floor(Math.random() * BOSSES.length)];
  const maxHp = hp ?? rand(3000, 5000);
  const boss = {
    id: Math.random().toString(36).slice(2, 8),
    guildId,
    channelId: channel.id,
    ...def,
    maxHp,
    hp: maxHp,
    damage: new Map(), // userId -> total damage
    hits: new Map(), // userId -> number of attacks
    lastHit: new Map(), // userId -> when they last attacked
    specialAt: new Map(), // userId -> when they last used their special
    stunned: new Map(), // userId -> stunned until
    exploit: new Set(), // users whose next hit deals triple damage
    rallyUntil: 0,
    enraged: false,
    telegraph: null, // { until, blockers: Set }
    log: [],
    expiresAt: Date.now() + DURATION_MS,
    lastRender: 0,
    renderTimer: null,
    timer: null,
    telegraphTimer: null,
    resolveTimer: null,
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
  scheduleTelegraph(boss);
  return boss;
}

function endBoss(boss) {
  boss.ended = true;
  [boss.timer, boss.renderTimer, boss.telegraphTimer, boss.resolveTimer].forEach(clearTimeout);
  bosses.delete(boss.guildId);
}

// ---------- Telegraphed attacks ----------

function scheduleTelegraph(boss) {
  clearTimeout(boss.telegraphTimer);
  boss.telegraphTimer = setTimeout(() => startTelegraph(boss), boss.enraged ? ENRAGED_EVERY_MS : TELEGRAPH_EVERY_MS);
}

async function startTelegraph(boss) {
  if (boss.ended) return;
  boss.telegraph = { until: Date.now() + TELEGRAPH_MS, blockers: new Set() };
  boss.log.push(`⚠️ The ${boss.name} rears back for a huge attack!`);
  await boss.message.edit(render(boss)).catch(() => {});
  boss.resolveTimer = setTimeout(() => resolveTelegraph(boss), TELEGRAPH_MS);
}

// Anyone who fought but didn't block gets stunned (armor shortens it)
async function resolveTelegraph(boss) {
  if (boss.ended) return;
  const { blockers } = boss.telegraph;
  boss.telegraph = null;

  const hurt = [];
  for (const id of boss.damage.keys()) {
    if (blockers.has(id)) continue;
    const reduce = playerGear(ensureProfile(getUser(id))).armor.reduce;
    boss.stunned.set(id, Date.now() + Math.max(8, 20 - reduce) * 1000);
    hurt.push(id);
  }
  boss.log.push(
    hurt.length
      ? `💫 The attack lands! ${hurt.slice(0, 4).map((id) => `<@${id}>`).join(', ')}${hurt.length > 4 ? ` and ${hurt.length - 4} more` : ''} stunned.`
      : '🛡️ Everyone blocked the attack!'
  );
  await boss.message.edit(render(boss)).catch(() => {});
  scheduleTelegraph(boss);
}

// ---------- Damage, enraging, and winning ----------

const rewardShare = (boss, id, totalDmg, totalHits) =>
  0.6 * ((boss.damage.get(id) ?? 0) / totalDmg) + 0.4 * ((boss.hits.get(id) ?? 0) / totalHits);

function giveMaterial(u, id, n = 1) {
  u.inventory[id] = (u.inventory[id] ?? 0) + n;
}

// Pays out: 60% of each person's share comes from damage and 40% from number of hits (so gear can't take everything)
function defeat(boss, killerId) {
  endBoss(boss);
  lastDefeated = { name: boss.name, emoji: boss.emoji, at: Date.now() };

  const totalDmg = [...boss.damage.values()].reduce((a, b) => a + b, 0);
  const totalHits = [...boss.hits.values()].reduce((a, b) => a + b, 0) || 1;
  const pool = 2000 + 300 * boss.damage.size;
  const sorted = [...boss.damage].sort((a, b) => b[1] - a[1]);

  const lines = [];
  const titles = [];
  sorted.forEach(([id, dmg], i) => {
    const u = ensureProfile(getUser(id));
    const share = rewardShare(boss, id, totalDmg, totalHits);
    let payout = Math.max(50, Math.floor(pool * share));
    const extras = [];

    if (id === killerId) {
      payout += 200;
      extras.push('last hit +200');
    }
    u.coins += payout;

    // Everyone who fought gets crafting materials
    const essence = boss.drop;
    const n = rand(1, 2);
    giveMaterial(u, essence, n);
    extras.push(`${n}× ${MATERIALS[essence].emoji}`);
    if (Math.random() < 0.3) {
      const other = ['essence_fire', 'essence_ice', 'essence_poison'][rand(0, 2)];
      giveMaterial(u, other);
      extras.push(`1× ${MATERIALS[other].emoji}`);
    }
    if (boss.special && i < 5 && Math.random() < 0.35) {
      giveMaterial(u, boss.special);
      extras.push(`**${MATERIALS[boss.special].emoji} ${MATERIALS[boss.special].name}!**`);
    }
    if (i === 0 && Math.random() < 0.25) {
      const skin = Object.keys(SKINS)[rand(0, Object.keys(SKINS).length - 1)];
      if (!u.inventory[skin]) {
        giveMaterial(u, skin);
        extras.push(`${SKINS[skin].emoji} **${SKINS[skin].name} skin!**`);
      }
    }

    u.combat.bossKills++;
    u.combat.bossDamage += dmg;
    if (boss.name === 'Ancient Dragon' && share >= 0.1 && awardTitle(u, 'title_dragonslayer')) titles.push(`<@${id}> unlocked **${TITLES.title_dragonslayer.name}**`);
    if (u.combat.bossKills >= 5 && awardTitle(u, 'title_bosshunter')) titles.push(`<@${id}> unlocked **${TITLES.title_bosshunter.name}**`);

    if (lines.length < 8) {
      lines.push(`${MEDALS[i] ?? `${i + 1}.`} <@${id}> — ${dmg.toLocaleString('en-US')} dmg → **${fmt(payout)}** (${extras.join(', ')})`);
    }
  });
  markDirty();

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`🎉 The ${boss.name} was defeated!`)
    .setDescription(`The final blow was struck by <@${killerId}>!\nReward pool: **${fmt(pool)}**, split by damage (60%) and number of hits (40%).`)
    .addFields({ name: '🏆 Rewards', value: lines.join('\n') })
    .setFooter({ text: 'Everyone who fought got crafting materials. Check !!forge!' });
  if (titles.length) embed.addFields({ name: '🏷️ New titles', value: titles.join('\n').slice(0, 1000) });
  return embed;
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
  await boss.message.edit({ content: '', embeds: [embed], components: [] }).catch(() => {});
}

// Applies damage to the boss and updates the message. Returns after responding to the interaction.
async function dealDamage(interaction, boss, userId, dmg, text) {
  const now = Date.now();
  boss.hp -= dmg;
  boss.damage.set(userId, (boss.damage.get(userId) ?? 0) + dmg);
  boss.hits.set(userId, (boss.hits.get(userId) ?? 0) + 1);
  boss.log.push(text);
  if (boss.log.length > 6) boss.log.shift();

  if (boss.hp <= 0) {
    const summary = defeat(boss, userId);
    return interaction.update({ content: '', embeds: [summary], components: [] });
  }

  // At half health the boss gets angry and attacks faster
  if (!boss.enraged && boss.hp <= boss.maxHp / 2) {
    boss.enraged = true;
    boss.log.push(`🔥 The ${boss.name} is **ENRAGED**! Its attacks come much faster!`);
    if (!boss.telegraph) scheduleTelegraph(boss);
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

// ---------- Buttons ----------

async function handleBossHit(interaction) {
  const [, action, bossId] = interaction.customId.split(':');
  const boss = [...bosses.values()].find((b) => b.id === bossId);
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  if (!boss || boss.ended) return reply('This boss is already gone!');

  const now = Date.now();
  const userId = interaction.user.id;

  if (action === 'block') {
    if (!boss.telegraph) return reply('There\'s nothing to block right now.');
    boss.telegraph.blockers.add(userId);
    return reply('🛡️ You brace for impact!');
  }

  const stunnedUntil = boss.stunned.get(userId) ?? 0;
  if (stunnedUntil > now) return reply(`💫 You're stunned for another ${Math.ceil((stunnedUntil - now) / 1000)}s!`);

  const u = ensureProfile(getUser(userId));
  const gear = playerGear(u);
  const weakness = gear.weapon.element === boss.weak;
  const name = `<@${userId}>`;

  // Class special (45s cooldown)
  if (action === 'special') {
    const wait = (boss.specialAt.get(userId) ?? 0) + SPECIAL_CD_MS - now;
    if (wait > 0) return reply(`Your special is recharging: ${Math.ceil(wait / 1000)}s left.`);
    const cls = CLASSES[u.loadout.class] ?? CLASSES.warrior;
    boss.specialAt.set(userId, now);

    if (cls.boss.id === 'rally') {
      boss.rallyUntil = now + 15000;
      boss.log.push(`📣 ${name} rallies the group! Everyone deals +20% for 15s.`);
      return interaction.update(render(boss));
    }
    if (cls.boss.id === 'exploit') {
      boss.exploit.add(userId);
      boss.log.push(`🎯 ${name} spots an opening. Their next hit deals triple damage!`);
      return interaction.update(render(boss));
    }
    if (cls.boss.id === 'cleanse') {
      boss.stunned.clear();
      boss.log.push(`💚 ${name} cleanses everyone! All stuns removed.`);
      return interaction.update(render(boss));
    }
    // Mage: Arcane Burst
    let dmg = rand(120, 200) + gear.weapon.bossBonus * 2;
    if (weakness) dmg = Math.round(dmg * 1.5);
    return dealDamage(interaction, boss, userId, dmg, `✨ ${name} unleashes **Arcane Burst** for **${dmg}**!`);
  }

  // Normal attack (the cooldown depends on your weapon)
  const wait = (boss.lastHit.get(userId) ?? 0) + gear.weapon.bossCd - now;
  if (wait > 0) return reply(`Your ${gear.weapon.name} needs ${Math.ceil(wait / 1000)}s before the next swing.`);
  boss.lastHit.set(userId, now);

  let dmg = rand(20, 60) + gear.weapon.bossBonus;
  const crit = Math.random() < 0.1 + gear.weapon.crit;
  if (crit) dmg *= 2;
  const notes = [];
  if (weakness) {
    dmg = Math.round(dmg * 1.5);
    notes.push(`${ELEMENTS[boss.weak].emoji} weakness`);
  }
  if (boss.exploit.delete(userId)) {
    dmg *= 3;
    notes.push('🎯 exploit');
  }
  if (boss.rallyUntil > now) dmg = Math.round(dmg * 1.2);

  return dealDamage(
    interaction,
    boss,
    userId,
    dmg,
    `${gear.weapon.emoji} ${crit ? '💥 CRIT! ' : ''}${name} hit for **${dmg}**${notes.length ? ` (${notes.join(', ')})` : ''}`
  );
}

const getActiveBoss = (guildId) => bosses.get(guildId) ?? null;
const getLastDefeated = () => lastDefeated;

module.exports = { spawnBoss, handleBossHit, getActiveBoss, getLastDefeated };
