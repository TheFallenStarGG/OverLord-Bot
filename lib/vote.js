const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');
const economy = require('./economy');
const { logging } = require('./logging');
const { TOPGG_VOTE_URL } = require('./donate');

const BOT_ID = '1555446743515144232';
const VOTE_REWARD_COINS = 250;
const VOTE_WINDOW_MS = 12 * 60 * 60 * 1000;
const BUFF_MS = 60 * 60 * 1000;
const BUFF_MULT = 1.1;

function load() {
  return readJson(FILES.votes || 'votes.json', { claims: {}, buffs: {} });
}

function save(data) {
  writeJson(FILES.votes || 'votes.json', data);
}

function voteBuffMult(userId) {
  const data = load();
  const until = data.buffs?.[userId] || 0;
  if (Date.now() >= until) return 1;
  return BUFF_MULT;
}

async function hasVotedOnTopgg(userId) {
  const token = process.env.TOPGG_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      `https://top.gg/api/bots/${BOT_ID}/check?userId=${userId}`,
      {
        headers: { Authorization: token },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) {
      logging('warn', 'top.gg vote check failed', `HTTP ${res.status}`);
      return null;
    }
    const body = await res.json();
    return Boolean(body.voted);
  } catch (err) {
    logging('warn', 'top.gg vote check error', err.message || err);
    return null;
  }
}

/** Weekend multiplier from top.gg (true = votes count double). */
async function isTopggWeekend() {
  const token = process.env.TOPGG_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch('https://top.gg/api/weekend', {
      headers: { Authorization: token },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return Boolean(body.is_weekend ?? body.weekend);
  } catch {
    return false;
  }
}

/**
 * Pay out a vote (webhook or !!vote).
 * weight: 1 normal, 2 weekend (from webhook or weekend API).
 */
function grantVoteReward(userId, weight = 1) {
  const data = load();
  data.buffs ??= {};
  const now = Date.now();
  const last = data.claims[userId] || 0;
  const remaining = VOTE_WINDOW_MS - (now - last);

  if (remaining > 0) {
    return {
      ok: false,
      reason: 'cooldown',
      remainingMs: remaining,
      voteUrl: TOPGG_VOTE_URL,
    };
  }

  const w = Math.max(1, Math.min(2, Math.floor(Number(weight) || 1)));
  const amount = VOTE_REWARD_COINS * w;

  data.claims[userId] = now;
  data.buffs[userId] = now + BUFF_MS;
  save(data);
  economy.addCoins(userId, amount, { transfer: true });

  return {
    ok: true,
    amount,
    weight: w,
    weekend: w >= 2,
    buffMult: BUFF_MULT,
    buffMs: BUFF_MS,
    buffHours: BUFF_MS / (60 * 60 * 1000),
    voteUrl: TOPGG_VOTE_URL,
  };
}

/** Fallback: user runs !!vote after voting on the site. */
async function claimVoteReward(userId) {
  const data = load();
  data.buffs ??= {};
  const now = Date.now();
  const last = data.claims[userId] || 0;
  const remaining = VOTE_WINDOW_MS - (now - last);

  if (remaining > 0) {
    return {
      ok: false,
      reason: 'cooldown',
      remainingMs: remaining,
      voteUrl: TOPGG_VOTE_URL,
      buffUntil: data.buffs[userId] || 0,
    };
  }

  const voted = await hasVotedOnTopgg(userId);
  if (voted === null) {
    return {
      ok: false,
      reason: 'nocheck',
      voteUrl: TOPGG_VOTE_URL,
      reward: VOTE_REWARD_COINS,
    };
  }
  if (!voted) {
    return {
      ok: false,
      reason: 'novote',
      voteUrl: TOPGG_VOTE_URL,
      reward: VOTE_REWARD_COINS,
    };
  }

  const weekend = await isTopggWeekend();
  return grantVoteReward(userId, weekend ? 2 : 1);
}

module.exports = {
  claimVoteReward,
  grantVoteReward,
  hasVotedOnTopgg,
  isTopggWeekend,
  voteBuffMult,
  VOTE_REWARD_COINS,
  VOTE_WINDOW_MS,
  TOPGG_VOTE_URL,
};
