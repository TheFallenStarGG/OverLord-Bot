const { ERROR_LOG_CHANNEL_ID } = require('../config');

let client = null;
let lastSent = 0;
const recent = new Map(); // error text -> when it was last posted

function setClient(c) {
  client = c;
}

// Prints the error to the console and posts it to the error log channel (if one is set)
async function logError(title, err) {
  console.error(`${title}:`, err);
  if (!client || !ERROR_LOG_CHANNEL_ID) return;

  const now = Date.now();
  const key = `${title}|${err?.message ?? err}`;

  // Don't repeat the same error within a minute, and post at most once every 3 seconds
  if (now - (recent.get(key) ?? 0) < 60 * 1000) return;
  if (recent.size > 100) recent.clear();
  recent.set(key, now);
  if (now - lastSent < 3000) return;
  lastSent = now;

  try {
    const channel = await client.channels.fetch(ERROR_LOG_CHANNEL_ID);
    const detail = String(err?.stack || err).slice(0, 1700);
    await channel.send(`⚠️ **${title}**\n\`\`\`\n${detail}\n\`\`\``);
  } catch (e) {
    console.error('Could not post to the error log channel:', e.message);
  }
}

module.exports = { setClient, logError };
