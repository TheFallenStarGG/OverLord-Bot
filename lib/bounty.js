const { EmbedBuilder } = require('discord.js');
const { top, peekUser, addCoins, spendCoins, fmt } = require('./economy');
const { data, saveNow, logEvent } = require('./world');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Time between Overlord bounties (hours).
const GAP_HOURS = [12, 24];
const MIN_COINS = 200;
const ACTIVE_MS = 2 * DAY;
const MAX_DEFENSES = 4;

// Player-posted bounties
const PLAYER_MIN_REWARD = 500;
const PLAYER_MAX_REWARD = 50000;
const PLAYER_MIN_HOURS = 1;
const PLAYER_MAX_HOURS = 48;
const PLAYER_DEFAULT_HOURS = 12;
const PLAYER_MAX_OPEN_PER_POSTER = 3;
const PLAYER_MAX_OPEN_ON_TARGET = 5;
// One successful rob must steal at least this much to claim a player bounty (also scales with reward).
const playerRobMin = (reward) => Math.max(150, Math.floor(reward * 0.1));
// Overlord bounty: steal at least this much in one rob to claim the purse.
const overlordRobMin = (reward) => Math.max(150, Math.floor(reward * 0.08));

const BOUNTY_TYPES = {
  standard: {
    id: 'standard',
    emoji: '🎯',
    name: 'Marked',
    blurb: 'A classic mark. Win a duel **or** rob enough coins from them to claim the purse.',
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
    blurb: 'Huge purse, shorter clock. Duel them or rob a serious cut of their wallet.',
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
    blurb: 'The mark lasts a long time. Patience — duel or rob when the time is right.',
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
    blurb: 'The Overlord wants a public takedown. Fat reward for a duel win **or** a heavy rob.',
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
    defenseBonus: 1,
  },
};

function ensurePlayerStore() {
  data.playerBounties ??= { list: [], nextId: 1 };
  data.playerBounties.list ??= [];
  data.playerBounties.nextId ??= 1;
  return data.playerBounties;
}

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
  const optOutLib = require('./optOut');

  let pool = top('lastXp', 200)
    .filter((e) => e.value >= cutoff)
    .map((e) => ({ id: e.id, coins: peekUser(e.id).coins, lastXp: e.value }))
    .filter((e) => e.coins >= MIN_COINS)
    .filter((e) => !optOutLib.isOptedOut(e.id));

  const withoutLast = pool.filter((e) => e.id !== lastId);
  if (withoutLast.length) pool = withoutLast;
  if (!pool.length) return null;

  pool.sort((a, b) => b.lastXp - a.lastXp);
  const topN = pool.slice(0, Math.min(8, pool.length));
  if (Math.random() < 0.2) return topN.slice().sort((a, b) => b.coins - a.coins)[0];
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
const typeOf = (b) => BOUNTY_TYPES[b?.type] || BOUNTY_TYPES.standard;

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

/** Claim Overlord bounty by defeating the mark (duel) or by a heavy enough rob. */
function claimOverlordBounty(hunterId, targetId, via = 'duel') {
  const b = getActiveBounty();
  if (!b || targetId !== b.targetId || hunterId === targetId) return null;

  addCoins(hunterId, b.reward);
  const t = typeOf(b);
  bounty().active = null;
  const how = via === 'rob' ? 'robbing' : 'defeating in a duel';
  logEvent(`🎯 <@${hunterId}> collected the bounty on <@${targetId}> (${fmt(b.reward)}, ${via})`);
  saveNow();
  return (
    `${t.emoji} **${t.name} claimed!** <@${hunterId}> takes **${fmt(b.reward)}** ` +
    `from the Overlord for ${how} <@${targetId}>!`
  );
}

function duelBountyResult(winnerId, loserId) {
  const notes = [];

  const claimed = claimOverlordBounty(winnerId, loserId, 'duel');
  if (claimed) notes.push(claimed);

  const b = getActiveBounty();
  if (b && winnerId === b.targetId && loserId !== b.targetId) {
    b.defenses = Math.min(MAX_DEFENSES, b.defenses + 1);
    saveNow();
    notes.push(
      `🛡️ <@${winnerId}> beat a bounty hunter! Survivor bonus is now **${survivorPercent(b)}%**.`
    );
  }

  const playerNotes = claimPlayerBountiesOnDuel(winnerId, loserId);
  notes.push(...playerNotes);

  return notes.length ? notes.join('\n') : null;
}

// ---------- Player-posted bounties ----------

function listPlayerBounties() {
  const store = ensurePlayerStore();
  const now = Date.now();
  let changed = false;
  const open = [];
  for (const p of store.list) {
    if (p.status !== 'open') continue;
    if (p.until <= now) {
      p.status = 'expired';
      addCoins(p.posterId, p.reward);
      logEvent(`⌛ Player bounty on <@${p.targetId}> expired — ${fmt(p.reward)} returned to <@${p.posterId}>`);
      changed = true;
      continue;
    }
    open.push(p);
  }
  if (changed) {
    store.list = store.list.filter((p) => p.status === 'open' || Date.now() - (p.resolvedAt || p.until) < 7 * DAY);
    if (store.list.length > 80) store.list = store.list.slice(-80);
    saveNow();
  }
  return open;
}

function postPlayerBounty(posterId, targetId, reward, hours = PLAYER_DEFAULT_HOURS) {
  if (!posterId || !targetId) return { error: 'Need a target.' };
  if (posterId === targetId) return { error: "You can't put a bounty on yourself." };

  reward = Math.floor(Number(reward));
  if (!Number.isFinite(reward) || reward < PLAYER_MIN_REWARD) {
    return { error: `Minimum bounty is **${fmt(PLAYER_MIN_REWARD)}**.` };
  }
  if (reward > PLAYER_MAX_REWARD) {
    return { error: `Maximum bounty is **${fmt(PLAYER_MAX_REWARD)}**.` };
  }

  hours = Math.floor(Number(hours) || PLAYER_DEFAULT_HOURS);
  hours = Math.max(PLAYER_MIN_HOURS, Math.min(PLAYER_MAX_HOURS, hours));

  const open = listPlayerBounties();
  if (open.filter((p) => p.posterId === posterId).length >= PLAYER_MAX_OPEN_PER_POSTER) {
    return { error: `You already have **${PLAYER_MAX_OPEN_PER_POSTER}** open bounties. Cancel one first.` };
  }
  if (open.filter((p) => p.targetId === targetId).length >= PLAYER_MAX_OPEN_ON_TARGET) {
    return { error: 'That player already has too many open bounties.' };
  }

  const wallet = peekUser(posterId).coins;
  if (wallet < reward) {
    return { error: `You need **${fmt(reward)}** (you have ${fmt(wallet)}). The reward is held until claimed or it expires.` };
  }

  spendCoins(posterId, reward);
  const store = ensurePlayerStore();
  const id = store.nextId++;
  const entry = {
    id,
    posterId,
    targetId,
    reward,
    robMin: playerRobMin(reward),
    status: 'open',
    createdAt: Date.now(),
    until: Date.now() + hours * HOUR,
  };
  store.list.push(entry);
  logEvent(`💰 <@${posterId}> posted a **${fmt(reward)}** bounty on <@${targetId}>`);
  saveNow();
  return { ok: true, bounty: entry };
}

function cancelPlayerBounty(posterId, bountyId) {
  const store = ensurePlayerStore();
  listPlayerBounties();
  const p = store.list.find((x) => x.id === Number(bountyId) && x.status === 'open');
  if (!p) return { error: 'No open bounty with that id.' };
  if (p.posterId !== posterId) return { error: 'Only the poster can cancel that bounty.' };

  p.status = 'cancelled';
  p.resolvedAt = Date.now();
  const refund = Math.floor(p.reward * 0.95);
  const fee = p.reward - refund;
  addCoins(posterId, refund);
  saveNow();
  return { ok: true, refund, fee, bounty: p };
}

function claimPlayerBountiesOnDuel(winnerId, loserId) {
  const notes = [];
  const store = ensurePlayerStore();
  for (const p of listPlayerBounties()) {
    if (p.targetId !== loserId) continue;
    if (winnerId === p.targetId) continue;
    p.status = 'claimed';
    p.resolvedAt = Date.now();
    p.claimerId = winnerId;
    p.via = 'duel';
    addCoins(winnerId, p.reward);
    notes.push(
      `💰 **Player bounty #${p.id} claimed!** <@${winnerId}> earns **${fmt(p.reward)}** ` +
        `(posted by <@${p.posterId}>) for beating <@${loserId}> in a duel.`
    );
    logEvent(`💰 Player bounty #${p.id} claimed by <@${winnerId}> via duel (${fmt(p.reward)})`);
  }
  if (notes.length) saveNow();
  return notes;
}

/**
 * After a successful player-vs-player rob.
 * amount = coins stolen from target this attempt.
 * robberIds = crew (leader first); reward goes to the leader (or split? leader for clarity).
 */
function onSuccessfulRob(robberIds, targetId, amount) {
  const notes = [];
  const leaderId = robberIds[0];
  if (!leaderId || !targetId || !(amount > 0)) return notes;

  const b = getActiveBounty();
  if (b && b.targetId === targetId && leaderId !== targetId) {
    const need = overlordRobMin(b.reward);
    if (amount >= need) {
      const msg = claimOverlordBounty(leaderId, targetId, 'rob');
      if (msg) notes.push(msg);
    } else {
      notes.push(
        `🎯 Overlord bounty: stole **${fmt(amount)}** / need **${fmt(need)}** in one rob to claim the **${fmt(b.reward)}** purse.`
      );
    }
  }

  for (const p of listPlayerBounties()) {
    if (p.targetId !== targetId) continue;
    if (leaderId === targetId) continue;
    if (amount >= p.robMin) {
      p.status = 'claimed';
      p.resolvedAt = Date.now();
      p.claimerId = leaderId;
      p.via = 'rob';
      addCoins(leaderId, p.reward);
      notes.push(
        `💰 **Player bounty #${p.id} claimed!** <@${leaderId}> earns **${fmt(p.reward)}** ` +
          `(posted by <@${p.posterId}>) for robbing **${fmt(amount)}** from <@${targetId}>.`
      );
      logEvent(`💰 Player bounty #${p.id} claimed by <@${leaderId}> via rob (${fmt(p.reward)})`);
    } else {
      notes.push(
        `💰 Bounty #${p.id}: stole **${fmt(amount)}** / need **${fmt(p.robMin)}** in one rob to claim **${fmt(p.reward)}**.`
      );
    }
  }
  if (notes.some((n) => n.includes('claimed'))) saveNow();
  return notes;
}

function bountyEmbed(b, headline) {
  const t = typeOf(b);
  const robNeed = overlordRobMin(b.reward);
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
        name: '⚔️ How to claim',
        value:
          `• Win a **duel** against them (\`!!duel @user\`), **or**\n` +
          `• **Rob** at least **${fmt(robNeed)}** from them in one successful \`!!rob\`.\n` +
          `Full purse goes to the hunter.`,
      },
      {
        name: '🛡️ The marked',
        value:
          `Survive the timer to keep **${survivorPercent(b)}%** of the reward.\n` +
          'Beat a hunter in a duel: +10% survivor share (max 65%).',
      },
      {
        name: '💰 Player bounties',
        value: 'Anyone can post one with `!!bounty post @user <amount> [hours]`.',
      }
    );
}

function playerBountyEmbed(list) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('💰 Player bounties')
    .setFooter({ text: '!!bounty post @user <amount> [hours] · !!bounty cancel <id>' });

  if (!list.length) {
    embed.setDescription(
      'None open right now.\n\n' +
        `Post one: \`!!bounty post @user <${PLAYER_MIN_REWARD}+>\`\n` +
        'Claim by **dueling** the target or **robbing** enough coins from them in one go.'
    );
    return embed;
  }

  const lines = list.slice(0, 15).map((p) => {
    return (
      `**#${p.id}** · **${fmt(p.reward)}** on <@${p.targetId}>\n` +
      `Poster <@${p.posterId}> · rob ≥ **${fmt(p.robMin)}** or win a duel · ends <t:${Math.floor(p.until / 1000)}:R>`
    );
  });
  embed.setDescription(lines.join('\n\n'));
  return embed;
}

module.exports = {
  BOUNTY_TYPES,
  PLAYER_MIN_REWARD,
  PLAYER_MAX_REWARD,
  getActiveBounty,
  dueForBounty,
  startBounty,
  scheduleNextBounty,
  expireBounty,
  endBounty,
  duelBountyResult,
  claimOverlordBounty,
  onSuccessfulRob,
  overlordRobMin,
  listPlayerBounties,
  postPlayerBounty,
  cancelPlayerBounty,
  bountyEmbed,
  playerBountyEmbed,
};
