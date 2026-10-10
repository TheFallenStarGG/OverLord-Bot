const { EmbedBuilder } = require('discord.js');
const { top, peekUser, addCoins, fmt } = require('./economy');
const { data, saveNow, logEvent } = require('./world');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Time between bounties (hours). Still uncommon, not spammy.
const GAP_HOURS = [12, 24];
const MIN_COINS = 200;
const ACTIVE_MS = 2 * DAY; // chatted in last 2 days
const MAX_DEFENSES = 4;

// Different bounty “flavors”
const BOUNTY_TYPES = {
  standard: {
    id: 'standard',
    emoji: '🎯',
    name: 'Marked',
    blurb: 'A classic mark. Win a duel against them to claim the purse.',
    durationMs: 12 * HOUR,
    coinShare: 0.18,
    minReward: 1200,
    maxReward: 10000,
    weight: 3,
  },
  high_stakes: {
    id: 'high_stakes',
    emoji: '💎',
    name: 'High Stakes',
    blurb: 'Huge purse, shorter clock. Hunters will swarm.',
    durationMs: 6 * HOUR,
    coinShare: 0.3,
    minReward: 2500,
    maxReward: 15000,
    weight: 2,
  },
  long_hunt: {
    id: 'long_hunt',
    emoji: '🕰️',
    name: 'Long Hunt',
    blurb: 'The mark lasts a long time. Patience and planning win.',
    durationMs: 20 * HOUR,
    coinShare: 0.15,
    minReward: 1000,
    maxReward: 9000,
    weight: 2,
  },
  blood_price: {
    id: 'blood_price',
    emoji: '🩸',
    name: 'Blood Price',
    blurb: 'The Overlord wants a public takedown. Fat reward for a clean duel win.',
    durationMs: 8 * HOUR,
    coinShare: 0.25,
    minReward: 2000,
    maxReward: 14000,
    weight: 2,
  },
  soft_mark: {
    id: 'soft_mark',
    emoji: '🛡️',
    name: 'Soft Mark',
    blurb: 'Smaller purse, but the marked player starts with a better survivor share.',
    durationMs: 14 * HOUR,
    coinShare: 0.12,
    minReward: 800,
    maxReward: 7000,
    weight: 2,
    defenseBonus: 1, // start with +1 defense
  },
};

const bounty = () => data.bounty;
const gapMs = () => (GAP_HOURS[0] + Math.random() * (GAP_HOURS[1] - GAP_HOURS[0])) * HOUR;

function pickType() {
  const entries = Object.values(BOUNTY_TYPES);
  let roll = Math.random() * entries.reduce((s, t) => s + t.weight, 0);
  for (const t of entries) {
    roll -= t.weight;
    if (roll < 0) return t;
  }
  return entries[0];
}

function scheduleNextBounty() {
  bounty().nextAt = Date.now() + gapMs();
  saveNow();
}

const getActiveBounty = () => {
  const b = bounty().active;
  return b && b.until > Date.now() ? b : null;
};

const dueForBounty = () => !bounty().active && Date.now() >= bounty().nextAt;

function pickTarget() {
  const cutoff = Date.now() - ACTIVE_MS;
  const lastId = bounty().lastTargetId || null;

  let pool = top('lastXp', 200)
    .filter((e) => e.value >= cutoff)
    .map((e) => ({ id: e.id, coins: peekUser(e.id).coins, lastXp: e.value }))
    .filter((e) => e.coins >= MIN_COINS);

  const withoutLast = pool.filter((e) => e.id !== lastId);
  if (withoutLast.length) pool = withoutLast;

  if (!pool.length) return null;

  pool.sort((a, b) => b.lastXp - a.lastXp);
  const topN = pool.slice(0, Math.min(8, pool.length));

  // 20% mark the richest active person (juicier reward)
  if (Math.random() < 0.2) {
    return topN.slice().sort((a, b) => b.coins - a.coins)[0];
  }
  return topN[Math.floor(Math.random() * topN.length)];
}

function startBounty({ targetId = null, typeId = null } = {}) {
  if (bounty().active) return null;

  const type = (typeId && BOUNTY_TYPES[typeId]) || pickType();

  let id = targetId;
  let coins;
  if (id) {
    coins = peekUser(id).coins;
  } else {
    const pick = pickTarget();
    if (!pick) return null;
    id = pick.id;
    coins = pick.coins;
  }

  const reward = Math.min(
    type.maxReward,
    Math.max(type.minReward, Math.round(coins * type.coinShare))
  );

  bounty().active = {
    targetId: id,
    reward,
    type: type.id,
    defenses: type.defenseBonus || 0,
    startedAt: Date.now(),
    until: Date.now() + type.durationMs,
  };
  bounty().lastTargetId = id;
  logEvent(`${type.emoji} ${type.name}: ${fmt(reward)} on <@${id}>`);
  saveNow();
  return bounty().active;
}

const survivorPercent = (b) => Math.round(Math.min(0.65, 0.25 + 0.1 * b.defenses) * 100);

function typeOf(b) {
  return BOUNTY_TYPES[b?.type] || BOUNTY_TYPES.standard;
}

function expireBounty() {
  const b = bounty().active;
  if (!b || b.until > Date.now()) return null;

  const payout = Math.round((b.reward * survivorPercent(b)) / 100);
  addCoins(b.targetId, payout);
  bounty().active = null;
  logEvent(`🛡️ <@${b.targetId}> survived their bounty and kept ${fmt(payout)}`);
  saveNow();
  return { ...b, payout };
}

function endBounty() {
  const had = Boolean(bounty().active);
  bounty().active = null;
  saveNow();
  return had;
}

function duelBountyResult(winnerId, loserId) {
  const b = getActiveBounty();
  if (!b) return null;

  if (loserId === b.targetId && winnerId !== b.targetId) {
    addCoins(winnerId, b.reward);
    const t = typeOf(b);
    bounty().active = null;
    logEvent(`🎯 <@${winnerId}> collected the bounty on <@${loserId}> (${fmt(b.reward)})`);
    saveNow();
    return (
      `${t.emoji} **${t.name} claimed!** <@${winnerId}> takes **${fmt(b.reward)}** ` +
      `from the Overlord for defeating <@${loserId}> in a duel!`
    );
  }
  if (winnerId === b.targetId && loserId !== b.targetId) {
    b.defenses = Math.min(MAX_DEFENSES, b.defenses + 1);
    saveNow();
    return (
      `🛡️ <@${winnerId}> beat a bounty hunter! ` +
      `Survivor bonus is now **${survivorPercent(b)}%**.`
    );
  }
  return null;
}

function bountyEmbed(b, headline) {
  const t = typeOf(b);
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`${t.emoji} Bounty — ${t.name}`)
    .setDescription(
      `${headline}\n\n` +
        `${t.blurb}\n\n` +
        `<@${b.targetId}> is marked.\n` +
        `**Reward: ${fmt(b.reward)}** (paid by the Overlord).\n` +
        `Ends <t:${Math.floor(b.until / 1000)}:R>.`
    )
    .addFields(
      {
        name: '⚔️ Hunters',
        value: 'Win a **duel** (`!!duel @user`) against the marked player to claim the **full** reward.',
      },
      {
        name: '🛡️ The marked',
        value:
          `Survive the timer to keep **${survivorPercent(b)}%** of the reward.\n` +
          'Beat a hunter in a duel: +10% survivor share (max 65%).',
      }
    );
}

module.exports = {
  BOUNTY_TYPES,
  getActiveBounty,
  dueForBounty,
  startBounty,
  scheduleNextBounty,
  expireBounty,
  endBounty,
  duelBountyResult,
  bountyEmbed,
};
