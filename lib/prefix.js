const { currentGuild } = require('./storage');
const { data, saveNow } = require('./world');

const DEFAULT = '!!';
const MAX_LEN = 5;

function get() {
  if (!currentGuild()) return DEFAULT;
  return data.settings?.prefix || DEFAULT;
}

function set(prefix) {
  if (!prefix || prefix === DEFAULT) delete data.settings.prefix;
  else data.settings.prefix = prefix;
  saveNow();
}

// Returns an error message, or null if the prefix is fine
function validate(text) {
  const p = String(text || '').trim();
  if (!p) return 'Give me a prefix, like `?` or `$`.';
  if (p.length > MAX_LEN) return `Keep it to ${MAX_LEN} characters or fewer.`;
  if (/\s/.test(p)) return 'The prefix cannot contain spaces.';
  if (/^\/|[`<>@#\\]/.test(p)) return 'That would clash with Discord. Avoid `/`, `@`, `#`, `<`, `>`, backticks and backslashes.';
  return null;
}

// "!!daily" -> "<prefix>daily". "!!help" is left alone because it always works.
const BANG = /!!(?!help\b)(?=[a-z])/gi;
const swap = (text, prefix) => text.replace(BANG, () => prefix);

function deep(value, prefix) {
  if (typeof value === 'string') return swap(value, prefix);
  if (Array.isArray(value)) return value.map((v) => deep(v, prefix));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deep(v, prefix);
    return out;
  }
  return value;
}

// Rewrites command hints in a reply (text and embeds) without touching shared embed objects
function localize(payload, prefix = get()) {
  if (!payload || prefix === DEFAULT) return payload;
  if (typeof payload === 'string') return swap(payload, prefix);
  if (typeof payload !== 'object') return payload;
  const out = { ...payload };
  if (typeof out.content === 'string') out.content = swap(out.content, prefix);
  if (Array.isArray(out.embeds)) {
    out.embeds = out.embeds.map((e) => deep(typeof e?.toJSON === 'function' ? e.toJSON() : e, prefix));
  }
  return out;
}

module.exports = { DEFAULT, get, set, validate, localize };
