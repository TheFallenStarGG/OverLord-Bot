const { FILES, DAILY_LIMIT, MINUTE_LIMIT, COOLDOWN_MS } = require('../config');
const { readJson, writeJson } = require('./storage');

const todayUTC = () => new Date().toISOString().slice(0, 10);

let usage = readJson(FILES.usage, { date: todayUTC(), count: 0 });
let recentRequests = []; // timestamps from the last minute
const cooldowns = new Map(); // userId -> last question timestamp

function todayCount() {
  return usage.date === todayUTC() ? usage.count : 0;
}

function nextResetTs() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

// Called once for every request sent to OpenRouter
function recordRequest() {
  if (usage.date !== todayUTC()) usage = { date: todayUTC(), count: 0 };
  usage.count++;
  recentRequests.push(Date.now());
  writeJson(FILES.usage, usage);
}

function usageMessage() {
  const today = todayCount();
  recentRequests = recentRequests.filter((t) => Date.now() - t < 60 * 1000);
  const left = Math.max(DAILY_LIMIT - today, 0);
  const ts = nextResetTs();

  return [
    `Requests today: **${today} / ${DAILY_LIMIT}** (${left} left)`,
    `Last minute: ${recentRequests.length} / ${MINUTE_LIMIT}`,
    `Daily count resets: <t:${ts}:F> (<t:${ts}:R>)`,
  ].join('\n');
}

function dailyLimitText() {
  return `I've used all ${DAILY_LIMIT} of today's free requests. They reset <t:${nextResetTs()}:R>.`;
}

// Returns a message to send if the user can't ask right now, otherwise starts their cooldown
function checkLimits(userId, isOwner) {
  if (todayCount() >= DAILY_LIMIT) return dailyLimitText();
  if (!isOwner) {
    const wait = (cooldowns.get(userId) ?? 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) return `Slow down! Try again in ${Math.ceil(wait / 1000)}s.`;
  }
  cooldowns.set(userId, Date.now());
  return null;
}

module.exports = {
  todayCount,
  nextResetTs,
  recordRequest,
  usageMessage,
  dailyLimitText,
  checkLimits,
};
