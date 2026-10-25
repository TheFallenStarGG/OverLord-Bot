const { FILES } = require('../config');
const storage = require('./storage');

const FLUSH_MS = 500; // how often we try to drain the queue
const GAP_MS = 1200; // min wait between Discord messages (manual rate limit)
const MAX_LEN = 1900;
const MAX_QUEUE = 500;

let client = null;
let timer = null;
let lastSendAt = 0;
let sending = false;
let installed = false;
const queue = [];

function load() {
  const data = storage.readJson(FILES.fullLogs, null);
  return data && typeof data === 'object' ? data : { channelId: null };
}

function save(data) {
  storage.writeJson(FILES.fullLogs, data);
}

function getChannelId() {
  return load().channelId || null;
}

function setChannelId(id) {
  const data = load();
  data.channelId = id || null;
  save(data);
}

function setClient(c) {
  client = c;
}

function enqueue(text) {
  const s = String(text ?? '');
  if (!s) return;
  // split huge chunks so one npm dump doesn't become one impossible message
  if (s.length > MAX_LEN) {
    for (let i = 0; i < s.length; i += MAX_LEN) queue.push(s.slice(i, i + MAX_LEN));
  } else {
    queue.push(s.endsWith('\n') ? s.slice(0, -1) : s);
  }
  while (queue.length > MAX_QUEUE) queue.shift();
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

async function flush() {
  timer = null;
  if (sending) return;

  const channelId = getChannelId();
  if (!client || !channelId || !queue.length) return;

  const wait = GAP_MS - (Date.now() - lastSendAt);
  if (wait > 0) {
    timer = setTimeout(flush, wait);
    return;
  }

  sending = true;
  const body = String(queue.shift() ?? '').slice(0, MAX_LEN);
  if (!body.trim()) {
    sending = false;
    if (queue.length) timer = setTimeout(flush, FLUSH_MS);
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isTextBased?.()) {
      await channel.send({ content: body, allowedMentions: { parse: [] } });
      lastSendAt = Date.now();
    }
  } catch (err) {
    const msg = String(err?.message || err);
    // Hit Discord rate limit — put the line back and wait longer
    if (/rate limit|429/i.test(msg) || err?.status === 429 || err?.httpStatus === 429) {
      queue.unshift(body);
      lastSendAt = Date.now();
      const retry = Math.max(GAP_MS, Number(err?.retryAfter || err?.rawError?.retry_after || 5) * 1000);
      sending = false;
      timer = setTimeout(flush, retry);
      return;
    }
    try {
      process.stderr.write(`[full-logs] failed to post: ${msg}\n`);
    } catch {
      /* ignore */
    }
  }

  sending = false;
  if (queue.length) timer = setTimeout(flush, GAP_MS);
}

function install() {
  if (installed) return;
  installed = true;

  const wrap =
    (orig) =>
    (...args) => {
      try {
        const line = args
          .map((a) => {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return a.stack || a.message;
            try {
              return typeof a === 'object' ? JSON.stringify(a) : String(a);
            } catch {
              return String(a);
            }
          })
          .join(' ');
        enqueue(line);
      } catch {
        /* never break the real console */
      }
      return orig(...args);
    };

  console.log = wrap(console.log.bind(console));
  console.info = wrap(console.info.bind(console));
  console.warn = wrap(console.warn.bind(console));
  console.error = wrap(console.error.bind(console));
  console.debug = wrap(console.debug.bind(console));

  // Catch writes that skip console.* (some libs, progress bars, etc.)
  for (const stream of [process.stdout, process.stderr]) {
    const origWrite = stream.write.bind(stream);
    stream.write = (chunk, encoding, cb) => {
      try {
        const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(encoding || 'utf8');
        if (s && s.trim()) enqueue(s.replace(/\r/g, ''));
      } catch {
        /* ignore */
      }
      return origWrite(chunk, encoding, cb);
    };
  }

  process.on('warning', (w) => {
    enqueue(`(node) ${w?.name || 'Warning'}: ${w?.message || w}${w?.stack ? '\n' + w.stack : ''}`);
  });
}

module.exports = {
  install,
  setClient,
  getChannelId,
  setChannelId,
  flush,
};
