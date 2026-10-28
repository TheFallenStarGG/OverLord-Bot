const CASH_APP = 'cash.app/$TheFallenStarGG';
const CASH_APP_URL = 'https://cash.app/$TheFallenStarGG';
const STATUS_TEXT = 'cash.app/$TheFallenStarGG - donations welcome :3';

const TOPGG_URL = 'https://top.gg/bot/1555446743515144232';
const TOPGG_VOTE_URL = 'https://top.gg/bot/1555446743515144232/vote';

const NUDGE_CHANCE = 0.03; // ~1 in 33 commands
const NUDGE_LIFETIME_MS = 8 * 1000;

// Donate nudges: same person at most once per 3 hours
const DONATE_COOLDOWN_MS = 3 * 60 * 60 * 1000;
// Vote nudges: same person at most once per 12 hours
const VOTE_NUDGE_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const DONATE_NUDGES = [
  `💖 Enjoying the bot? Donations are really helpful and always welcome! <${CASH_APP_URL}>`,
  `✨ Donations help keep The Overlord running, and they are always appreciated! <${CASH_APP_URL}>`,
  `🪙 Fun fact: donations are super helpful and very welcome. You can send one here: <${CASH_APP_URL}>`,
  `💸 If you are having fun, a donation would be amazing (and always welcome!) <${CASH_APP_URL}>`,
];

const VOTE_NUDGES = [
  `🗳️ Free support: vote for The Overlord on top.gg every 12 hours! <${TOPGG_VOTE_URL}>\nReward after voting: \`!!vote\``,
  `⭐ Top.gg votes help the bot grow. Vote here (once per 12h): <${TOPGG_VOTE_URL}>\nThen run \`!!vote\` for a coin bonus.`,
  `📣 Liked the realm? A top.gg vote takes a few seconds: <${TOPGG_VOTE_URL}>\nClaim your reward with \`!!vote\`.`,
];

const lastDonateNudge = new Map(); // userId -> timestamp
const lastVoteNudge = new Map(); // userId -> timestamp
let lastNudgeType = null; // 'donate' | 'vote' — never the same type twice in a row (global)

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function maybeNudge(message) {
  if (Math.random() >= NUDGE_CHANCE) return;

  const now = Date.now();
  const uid = message.author.id;

  const donateOk = now - (lastDonateNudge.get(uid) ?? 0) >= DONATE_COOLDOWN_MS;
  const voteOk = now - (lastVoteNudge.get(uid) ?? 0) >= VOTE_NUDGE_COOLDOWN_MS;

  let type;
  if (donateOk && voteOk) {
    // 50/50, but never same type twice in a row
    type = Math.random() < 0.5 ? 'donate' : 'vote';
    if (type === lastNudgeType) type = type === 'donate' ? 'vote' : 'donate';
  } else if (donateOk) {
    type = 'donate';
  } else if (voteOk) {
    type = 'vote';
  } else {
    return;
  }

  // If forced type equals last and the other is available, flip
  if (type === lastNudgeType) {
    if (type === 'donate' && voteOk) type = 'vote';
    else if (type === 'vote' && donateOk) type = 'donate';
  }

  if (type === 'donate') lastDonateNudge.set(uid, now);
  else lastVoteNudge.set(uid, now);
  lastNudgeType = type;

  const text = type === 'donate' ? pick(DONATE_NUDGES) : pick(VOTE_NUDGES);

  setTimeout(async () => {
    try {
      const sent = await message.reply({
        content: `${text}\n-# This message will delete itself in ${NUDGE_LIFETIME_MS / 1000} seconds.`,
        failIfNotExists: false,
      });
      setTimeout(() => sent.delete().catch(() => {}), NUDGE_LIFETIME_MS);
    } catch {
      /* ignore */
    }
  }, 1500);
}

module.exports = {
  CASH_APP,
  CASH_APP_URL,
  STATUS_TEXT,
  TOPGG_URL,
  TOPGG_VOTE_URL,
  maybeNudge,
};
