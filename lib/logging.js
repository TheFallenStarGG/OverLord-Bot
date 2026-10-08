const { EmbedBuilder } = require('discord.js');
const { LOG_CHANNEL_ID, LOG_FLUSH_MS, LOG_ALL_ACTIVITY } = require('../config');

const MAX_QUEUE = 200;
const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_CHARS_PER_MESSAGE = 5500; // Discord allows 6000 across all embeds in one message

const LEVEL_COLORS = { warn: 0xf1c40f, error: 0xe74c3c };

// [title pattern, icon, label, color]. The first match decides how an entry looks.
const CATEGORIES = [
  [/^Bot started/, '🟢', 'Startup', 0x2ecc71],
  [/^Bot shutting down/, '🔴', 'Shutdown', 0x95a5a6],
  [/^(Disconnected|Reconnect)/, '🔌', 'Connection', 0x95a5a6],
  [/^(Command|Confirmed|Unexpected error handling)/, '⌨️', 'Commands', 0x5865f2],
  [/^Blocked command/, '🚫', 'Security', 0xe67e22],
  [/^(AI |Question blocked|Model failed|No |Daily request|Free models)/, '🤖', 'AI', 0x9b59b6],
  [/^(Answer|Rating)/, '⭐', 'Feedback', 0xf1c40f],
  [/^(Level up|Wordle)/, '🎮', 'Games', 0xeb459e],
  [/^(Joined|Left)/, '🏠', 'Servers', 0x3498db],
  [/^Chat thread/, '💬', 'Threads', 0x1abc9c],
];
const DEFAULT_CATEGORY = ['📋', 'General', 0x5865f2];

// Routine info entries only go to the console unless LOG_ALL_ACTIVITY is on. Warnings and errors always post.
const ALWAYS_POST = /^(Bot started|Bot shutting down|Joined a server|Left a server|Gazette published|Announced new update|Boss spawned|Reconnected)/;

let client = null;
let timer = null;
const queue = [];
const recentErrors = new Map(); // error text -> when it was last logged
let errorHook = null;
function setErrorHook(fn) {
  errorHook = fn;
}

function setClient(c) {
  client = c;
}

// "username in #channel (Server)" for a message (user defaults to the message's author)
function whoWhere(message, user = message.author) {
  const channel = message.channel?.name ? `#${message.channel.name}` : 'a DM';
  const server = message.guild ? ` (${message.guild.name})` : '';
  return `${user.username} in ${channel}${server}`;
}

// ---------- Turning log text into neat fields ----------

// "Alice in #general (My Server)" -> { user: 'Alice', place: '#general · My Server' }
function splitWho(text) {
  const m = /^(.*?) in (#.+?|a DM)(?: \((.+)\))?$/.exec(text.trim());
  if (!m) return { user: text.trim(), place: null };
  return { user: m[1], place: `${m[2]}${m[3] ? ` · ${m[3]}` : ''}` };
}

function splitOnce(text, separator) {
  const i = text.indexOf(separator);
  return i === -1 ? [text, ''] : [text.slice(0, i), text.slice(i + separator.length)];
}

const code = (text) => (text ? `\`${text}\`` : '');

// Each formatter turns the detail text of one kind of entry into [name, value, inline?] fields
const commandFields = (text, extra = []) => {
  const [command, who] = splitOnce(text, ' by ');
  const { user, place } = splitWho(who);
  return [['Command', code(command)], ['User', user], ['Where', place], ...extra];
};

const ratingFields = (text) => {
  const m = /^(\S+) for (.+) by (.+)$/.exec(text);
  return m ? [['Vote', m[1]], ['Model', code(m[2])], ['By', m[3]]] : null;
};

const FORMATS = {
  'Command used': (d) => commandFields(d),
  'Confirmed action': (d) => commandFields(d),
  'Blocked command attempt': (d) =>
    commandFields(d.replace(/ \(not the owner\)$/, ''), [['Reason', 'Not the owner']]),

  'AI answered': (d) => {
    const [who, model = '', ...notes] = d.split(' · ');
    const { user, place } = splitWho(who);
    const retry = model.endsWith(' (retry)');
    return [
      ['User', user],
      ['Where', place],
      ['Model', code(model.replace(' (retry)', ''))],
      ['Notes', [retry && 'Retry', ...notes].filter(Boolean).join(', ')],
    ];
  },
  'Question blocked': (d) => {
    const [who, reason] = d.split(' · ');
    const { user, place } = splitWho(who);
    return [['User', user], ['Where', place], ['Reason', reason]];
  },
  'Model failed': (d) => {
    const [model, error] = splitOnce(d, ' — ');
    return [['Model', code(model)], ['Error', error, false]];
  },

  'Answer rated': ratingFields,
  'Rating removed': ratingFields,

  'Bot started': (d) => {
    const [name, servers, commands, discordJs, node] = d.split(' · ');
    return [['Bot', name], ['Servers', servers], ['Commands', commands], ['discord.js', discordJs], ['Node', node]];
  },
  'Level up': (d) => {
    const m = /^(.+) reached level (\d+)$/.exec(d);
    return m ? [['User', m[1]], ['Level', m[2]]] : null;
  },
  'Chat thread created': (d) => threadFields(d),
  'Chat thread closed': (d) => threadFields(d),
};

function threadFields(text) {
  const m = /^(.*) by (.+? in (?:#.+?|a DM)(?: \(.+\))?)$/.exec(text);
  if (!m) return null;
  const { user, place } = splitWho(m[2]);
  return [['Thread', m[1]], ['Started by', user], ['Where', place]];
}

// ---------- Building the log cards ----------

function buildEmbed(level, title, text, extraFields) {
  const [icon, label, categoryColor] = CATEGORIES.find(([pattern]) => pattern.test(title))?.slice(1) ?? DEFAULT_CATEGORY;

  const embed = new EmbedBuilder()
    .setColor(LEVEL_COLORS[level] ?? categoryColor)
    .setAuthor({ name: `${icon} ${label}` })
    .setTitle(title.slice(0, 250))
    .setFooter({ text: level.toUpperCase() })
    .setTimestamp();

  let fields = extraFields ? Object.entries(extraFields) : null;
  let description = '';

  if (level === 'error' && text) {
    description = `\`\`\`\n${text.replace(/```/g, "'''").slice(0, 900)}\n\`\`\``;
  } else if (!fields && text) {
    try {
      fields = FORMATS[title]?.(text) ?? null;
    } catch {
      fields = null;
    }
    if (!fields) description = text.split(' · ').join('\n').slice(0, 1000);
  }

  if (description) embed.setDescription(description);
  if (fields) {
    const valid = fields.filter(([, value]) => value);
    if (valid.length) {
      embed.addFields(
        valid.map(([name, value, inline = true]) => ({ name, value: String(value).slice(0, 300), inline }))
      );
    }
  }
  return embed;
}

function embedSize(embed) {
  const d = embed.data;
  return (
    (d.title?.length ?? 0) +
    (d.description?.length ?? 0) +
    (d.footer?.text.length ?? 0) +
    (d.author?.name.length ?? 0) +
    (d.fields ?? []).reduce((total, f) => total + f.name.length + f.value.length, 0)
  );
}

// ---------- The logging function ----------

const timestamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// level: 'info' | 'warn' | 'error'
// detail: text or an Error
// fields (optional): { Name: 'value', ... } to show as labeled fields instead of the text
// Always prints to the console, and posts to the log channel if LOG_CHANNEL_ID is set
function logging(level, title, detail = '', fields = null) {
  const text = detail instanceof Error ? detail.stack || detail.message : String(detail);
  if (level === 'error' && errorHook) {
    try {
      errorHook(title, text);
    } catch {
      /* the digest must never break logging */
    }
    }

  // Console line: 2026-10-04 12:34:56 | INFO  | Title | details
  const method = level === 'info' ? 'log' : level === 'warn' ? 'warn' : 'error';
  const header = `${timestamp()} | ${level.toUpperCase().padEnd(5)} | ${title}`;
  if (!text) console[method](header);
  else if (level === 'error') console[method](`${header}\n${text}`);
  else console[method](`${header} | ${text.replace(/\n/g, ' ')}`);

  if (!client || !LOG_CHANNEL_ID) return;

  if (level === 'info' && !LOG_ALL_ACTIVITY && !ALWAYS_POST.test(title)) return;

  // Don't repeat the same error more than once a minute
  if (level === 'error') {
    const key = `${title}|${text.split('\n')[0]}`;
    const now = Date.now();
    if (now - (recentErrors.get(key) ?? 0) < 60 * 1000) return;
    if (recentErrors.size > 100) recentErrors.clear();
    recentErrors.set(key, now);
  }

  queue.push(buildEmbed(level, title, text, fields));
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE); // drop the oldest
  if (!timer) timer = setTimeout(flush, LOG_FLUSH_MS);
}

// Posts as many queued cards as fit in one message
async function flushOnce() {
  const batch = [];
  let size = 0;
  while (queue.length && batch.length < MAX_EMBEDS_PER_MESSAGE) {
    const next = embedSize(queue[0]);
    if (batch.length && size + next > MAX_CHARS_PER_MESSAGE) break;
    size += next;
    batch.push(queue.shift());
  }
  if (!batch.length) return;

  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    await channel.send({ embeds: batch });
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

module.exports = { setClient, logging, whoWhere, flushAll, setErrorHook };
