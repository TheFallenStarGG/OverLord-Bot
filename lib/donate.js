const CASH_APP = 'cash.app/$TheFallenStarGG';
const CASH_APP_URL = 'https://cash.app/$TheFallenStarGG';
const STATUS_TEXT = 'cash.app/$TheFallenStarGG - donations welcome :3';

const NUDGE_CHANCE = 0.03; // about 1 in 33 commands
const NUDGE_COOLDOWN_MS = 3 * 60 * 60 * 1000; // the same person is never nudged more than once per 3 hours
const NUDGE_LIFETIME_MS = 80 * 1000; // the reminder deletes itself after this long

const NUDGES = [
  `💖 Enjoying the bot? Donations are really helpful and always welcome! <${CASH_APP_URL}>`,
  `✨ Donations help keep The Overlord running, and they are always appreciated! <${CASH_APP_URL}>`,
  `🪙 Fun fact: donations are super helpful and very welcome. You can send one here: <${CASH_APP_URL}>`,
  `💸 If you are having fun, a donation would be amazing (and always welcome!) <${CASH_APP_URL}>`,
];

const lastNudge = new Map();

// Called after a command succeeds. Rarely sends a short reminder that deletes itself.
// (Prefix commands cannot send "only you can see this" messages, so this is the closest thing.)
function maybeNudge(message) {
  if (Math.random() >= NUDGE_CHANCE) return;

  const now = Date.now();
  if (now - (lastNudge.get(message.author.id) ?? 0) < NUDGE_COOLDOWN_MS) return;
  lastNudge.set(message.author.id, now);

  // Wait a moment so it appears after the command's own reply
  setTimeout(async () => {
    try {
      const text = NUDGES[Math.floor(Math.random() * NUDGES.length)];
      const sent = await message.reply({
        content: `${text}\n-# This message will delete itself in ${NUDGE_LIFETIME_MS / 1000} seconds.`,
        failIfNotExists: false,
      });
      setTimeout(() => sent.delete().catch(() => {}), NUDGE_LIFETIME_MS);
    } catch {
      // not worth reporting if a reminder could not be sent
    }
  }, 1500);
}

module.exports = { CASH_APP, CASH_APP_URL, STATUS_TEXT, maybeNudge };
