const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');
const economy = require('./economy');
const { logging } = require('./logging');
const { TOPGG_VOTE_URL } = require('./donate');

const BOT_ID = '1555446743515144232';
const VOTE_REWARD_COINS = 250;
const VOTE_WINDOW_MS = 12 * 60 * 60 * 1000;
const BUFF_MS = 60 * 60 * 1000; // +10% non-transfer coins for 1 hour
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

  data.claims[userId] = now;
  data.buffs[userId] = now + BUFF_MS;
  save(data);
  economy.addCoins(userId, VOTE_REWARD_COINS, { transfer: true }); // flat reward; no double buff

  return {
    ok: true,
    amount: VOTE_REWARD_COINS,
    buffHours: 1,
    voteUrl: TOPGG_VOTE_URL,
  };
}

module.exports = {
  claimVoteReward,
  hasVotedOnTopgg,
  voteBuffMult,
  VOTE_REWARD_COINS,
  VOTE_WINDOW_MS,
  TOPGG_VOTE_URL,
};
