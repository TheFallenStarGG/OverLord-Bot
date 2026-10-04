const { LOG_CHANNEL_ID, LOG_FLUSH_MS } = require('../config');

const ICONS = { info: 'ℹ️', warn: '⚠️', error: '🚨' };
const MAX_QUEUE = 200;

let client = null;
let timer = null;
const queue = [];
const recentErrors = new Map(); // error text -> when it was last logged

function setClient(c) {
  client = c;
}

// "username in #channel (Server)" for a message
function whoWhere(message) {
  const channel = message.channel?.name ? `#${message.channel.name}` : 'a DM';
  const server = message.guild ? ` (${message.guild.name})` : '';
  return `${message.author.username} in ${channel}${server}`;
}

// level: 'info' | 'warn' | 'error'   detail: text or an Error
// Always prints to the console, and posts to the log channel if LOG_CHANNEL_ID is set
function logging(level, title, detail = '') {
  const text = detail instanceof Error ? detail.stack || detail.message : String(detail);
  const consoleMethod = level === 'info' ? 'log' : level === 'warn' ? 'warn' : 'error';
  console[consoleMethod](`[${level}] ${title}${text ? ': ' + text : ''}`);

  if (!client || !LOG_CHANNEL_ID) return;

  // Don't repeat the same error more than once a minute
  if (level === 'error') {
    const key = `${title}|${text.split('\n')[0]}`;
    const now = Date.now();
    if (now - (recentErrors.get(key) ?? 0) < 60 * 1000) return;
    if (recentErrors.size > 100) recentErrors.clear();
    recentErrors.set(key, now);
  }

  let entry = `<t:${Math.floor(Date.now() / 1000)}:T> ${ICONS[level] ?? ICONS.info} **${title}**`;
  if (text) {
    if (level === 'error') {
      entry += `\n\`\`\`\n${text.replace(/```/g, "'''").slice(0, 800)}\n\`\`\``;
    } else {
      entry += ` — ${text.slice(0, 300)}`;
    }
  }

  queue.push(entry.slice(0, 1800));
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE); // drop the oldest
  if (!timer) timer = setTimeout(flush, LOG_FLUSH_MS);
}

// Posts as many queued entries as fit in one message
async function flushOnce() {
  let text = '';
  while (queue.length && text.length + queue[0].length + 1 <= 1900) {
    text += queue.shift() + '\n';
  }
  if (!text) return;

  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    await channel.send(text);
  } catch (err) {
    console.error('Could not post to the log channel:', err.message);
  }
}

async function flush() {
  timer = null;
  await flushOnce();
  if (queue.length) timer = setTimeout(flush, LOG_FLUSH_MS);
}

// Posts everything still waiting (used when the bot is shutting down)
async function flushAll() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!client || !LOG_CHANNEL_ID) return;
  while (queue.length) await flushOnce();
}

module.exports = { setClient, logging, whoWhere, flushAll };
