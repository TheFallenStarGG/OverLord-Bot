const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');
const economy = require('./economy');
const { logging } = require('./logging');
const { TOPGG_VOTE_URL } = require('./donate');

const BOT_ID = '1555446743515144232';
const VOTE_REWARD_COINS = 250;
const VOTE_WINDOW_MS = 12 * 60 * 60 * 1000;

function load() {
  return readJson(FILES.votes || 'votes.json', { claims: {} });
}

function save(data) {
  writeJson(FILES.votes || 'votes.json', data);
}

/** @returns {Promise<boolean|null>} true = voted, false = not, null = could not check */
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

/**
 * Claim reward if top.gg says they voted and they have not claimed in the last 12h.
 */
async function claimVoteReward(userId) {
  const data = load();
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
  save(data);
  economy.addCoins(userId, VOTE_REWARD_COINS);

  return {
    ok: true,
    amount: VOTE_REWARD_COINS,
    voteUrl: TOPGG_VOTE_URL,
  };
}

module.exports = {
  claimVoteReward,
  hasVotedOnTopgg,
  VOTE_REWARD_COINS,
  VOTE_WINDOW_MS,
  TOPGG_VOTE_URL,
};
