const { EmbedBuilder } = require('discord.js');
const { top, peekUser, addCoins, fmt } = require('./economy');
const { data, saveNow, logEvent } = require('./world');

const HOUR = 60 * 60 * 1000;
const GAP_HOURS = [3, 8]; // time between bounties
const DURATION_MS = 3 * HOUR;
const MIN_REWARD = 500;
const MAX_REWARD = 5000;
const MIN_COINS = 300; // a target needs at least this much
const MAX_DEFENSES = 4;

const bounty = () => data.bounty;
const gapMs = () => (GAP_HOURS[0] + Math.random() * (GAP_HOURS[1] - GAP_HOURS[0])) * HOUR;

function scheduleNextBounty() {
  bounty().nextAt = Date.now() + gapMs();
  saveNow();
}
if (!bounty().nextAt) scheduleNextBounty();
bounty().nextAt = Math.min(bounty().nextAt, Date.now() + GAP_HOURS[1] * HOUR); // never wait longer than the longest gap

const getActiveBounty = () => {
  const b = bounty().active;
  return b && b.until > Date.now() ? b : null;
};

const dueForBounty = () => !bounty().active && Date.now() >= bounty().nextAt;

// Someone who chatted in the last 24 hours and has some coins. Sometimes the richest.
function pickTarget() {
  const cutoff = Date.now() - 24 * HOUR;
  const active = top('lastXp', 200)
    .filter((e) => e.value >= cutoff)
    .map((e) => ({ id: e.id, coins: peekUser(e.id).coins }))
    .filter((e) => e.coins >= MIN_COINS);
  if (!active.length) return null;
  if (Math.random() < 0.3) return active.sort((a, b) => b.coins - a.coins)[0];
  return active[Math.floor(Math.random() * active.length)];
}

function startBounty({ targetId = null } = {}) {
  if (bounty().active) return null;

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

  const reward = Math.min(MAX_REWARD, Math.max(MIN_REWARD, Math.round(coins * 0.1)));
  bounty().active = { targetId: id, reward, defenses: 0, startedAt: Date.now(), until: Date.now() + DURATION_MS };
  logEvent(`🎯 The Overlord put a ${fmt(reward)} bounty on <@${id}>`);
  saveNow();
  return bounty().active;
}

const survivorPercent = (b) => Math.round(Math.min(0.65, 0.25 + 0.1 * b.defenses) * 100);

// If the time ran out, the target survives and is paid. Returns the finished bounty (or null).
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

// Called when a normal duel ends. Returns a message to show, or null.
function duelBountyResult(winnerId, loserId) {
  const b = getActiveBounty();
  if (!b) return null;

  if (loserId === b.targetId && winnerId !== b.targetId) {
    addCoins(winnerId, b.reward);
    bounty().active = null;
    logEvent(`🎯 <@${winnerId}> collected the bounty on <@${loserId}> (${fmt(b.reward)})`);
    saveNow();
    return `🎯 **Bounty claimed!** <@${winnerId}> collects **${fmt(b.reward)}** from the Overlord for taking down <@${loserId}>!`;
  }
  if (winnerId === b.targetId && loserId !== b.targetId) {
    b.defenses = Math.min(MAX_DEFENSES, b.defenses + 1);
    saveNow();
    return `🛡️ <@${winnerId}> beat a bounty hunter! Their survivor bonus is now **${survivorPercent(b)}%**.`;
  }
  return null;
}

function bountyEmbed(b, headline) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🎯 Bounty')
    .setDescription(`${headline}\n\n<@${b.targetId}> is marked! **Reward: ${fmt(b.reward)}**, paid by the Overlord.\nEnds <t:${Math.floor(b.until / 1000)}:R>.`)
    .addFields(
      { name: '⚔️ Hunters', value: 'Beat them in a duel (`!!duel @user`) to collect the whole reward.' },
      { name: '🛡️ The target', value: `Survive to keep **${survivorPercent(b)}%** of the reward. Beat a hunter in a duel and it grows by 10% (up to 65%).` }
    );
}

module.exports = {
  getActiveBounty, dueForBounty, startBounty, scheduleNextBounty, expireBounty, endBounty, duelBountyResult, bountyEmbed,
};
