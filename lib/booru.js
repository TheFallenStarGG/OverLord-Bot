const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { readJson, writeJson } = require('./storage');
const { isAllowed } = require('./redditAllow');
const { sendPosts } = require('./media');

// ================= Settings =================
const MAX_COUNT = 50;
const DEDUPE_MS = 10 * 60 * 1000;
const MAX_SAVED = 25; // saved searches per person, per command
const SAVED_FILE = path.join(__dirname, '..', 'booru_saved.json');

// ================= Blocked terms (shared by all three commands) =================
// Whole words (a tag like "young_human" or a title like "Young fox" is split into words first)
const BLOCKED_WORDS = new Set([
  'young', 'cub', 'cubs', 'loli', 'shota', 'toddlercon', 'toddler', 'child', 'children', 'infant',
  'underage', 'minor', 'minors', 'kid', 'kids', 'teen', 'teens', 'teenage', 'teenager', 'preteen', 'jailbait',
]);
// Any word that STARTS with one of these
const BLOCKED_PREFIXES = ['loli', 'shota', 'toddlercon', 'underage', 'preteen', 'jailbait'];
// Only used for subreddit NAMES, where words are often glued together ("legalteens")
const BLOCKED_FRAGMENTS = ['teen', 'jailbait', 'preteen', 'underage', 'toddlercon', 'lolicon', 'shotacon'];
// Add anything else you never want shown (whole words)
const EXTRA_BLOCKED = new Set([]);

function isBlockedText(text) {
  const words = String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.some(
    (w) => BLOCKED_WORDS.has(w) || EXTRA_BLOCKED.has(w) || BLOCKED_PREFIXES.some((p) => w.startsWith(p))
  );
}

function isBlockedSubreddit(name) {
  const n = String(name || '').toLowerCase().replace(/eighteen|nineteen/g, '');
  return isBlockedText(n) || BLOCKED_FRAGMENTS.some((f) => n.includes(f));
}

// A search tag: a leading "-" means "exclude", which is always fine
function blockedTagToken(t) {
  return !t.startsWith('-') && isBlockedText(t);
}

// ================= Access =================
function canUse(ctx, userId) {
  return Boolean(ctx.isOwner) || isAllowed(userId);
}

// ================= File types =================
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const VIDEO_EXTS = new Set(['webm', 'mp4', 'mov', 'm4v']);
function kindFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (IMAGE_EXTS.has(e)) return 'image';
  if (VIDEO_EXTS.has(e)) return 'video';
  return null;
}

// ================= "Sent recently" memory =================
const recent = new Map(); // key -> timestamp
function wasSent(key) {
  const now = Date.now();
  for (const [k, at] of recent) if (now - at > DEDUPE_MS) recent.delete(k);
  return recent.has(key);
}
function markSent(key) {
  recent.set(key, Date.now());
}

// ================= Requests, spacing and the one automatic retry =================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextSlot = new Map();

async function throttle(label, gapMs) {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(label) || 0);
  nextSlot.set(label, slot + gapMs);
  if (slot > now) await sleep(slot - now);
}

function retryable(message) {
  const err = new Error(message);
  err.retryable = true;
  return err;
}

// Timeouts, network errors and "busy" responses are marked retryable
async function request(url, { label, headers = {}, gapMs = 0, timeout = 20_000 } = {}) {
  if (gapMs) await throttle(label, gapMs);
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  } catch {
    throw retryable(`${label} did not answer in time.`);
  }
  if ([429, 502, 503, 504].includes(res.status)) {
    throw retryable(`${label} is busy or rate limiting the bot. Try again in a few seconds.`);
  }
  return res;
}

// Runs fn; if it fails with a retryable error, waits 2 seconds and tries exactly once more
async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!err?.retryable) throw err;
    await sleep(2000);
    return fn();
  }
}

// ================= Reading the command text =================
// Lowercases, turns commas into spaces, and pulls out the word "gallery" wherever it is
function splitArgs(raw) {
  let tokens = String(raw || '').toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  const gallery = tokens.includes('gallery');
  if (gallery) tokens = tokens.filter((t) => t !== 'gallery');
  return { tokens, gallery };
}

// count:N anywhere, or a plain number at the end (only if something else comes before it).
// anywhere = true is for !!r, where any number after the first word is the count.
function takeCount(tokens, { anywhere = false } = {}) {
  let count = null;
  let rest = [];
  for (const t of tokens) {
    const m = t.match(/^count:(\d+)$/);
    if (m) count = parseInt(m[1], 10);
    else rest.push(t);
  }
  if (anywhere) {
    const kept = rest.slice(0, 1);
    for (const t of rest.slice(1)) {
      if (/^\d+$/.test(t)) count = parseInt(t, 10);
      else kept.push(t);
    }
    rest = kept;
  } else if (rest.length > 1 && /^\d+$/.test(rest[rest.length - 1])) {
    count = parseInt(rest.pop(), 10);
  }
  return { rest, count };
}

function clampCount(n, fallback) {
  return Math.min(MAX_COUNT, Math.max(1, n || fallback));
}

// ================= Saved searches (per person) =================
// Stored as { userId: { e621: { name: [tags] }, rule34: {...}, r: {...} } }
const NAME_RULE = /^[a-z0-9][a-z0-9_-]{0,19}$/;

function loadSaved() {
  const d = readJson(SAVED_FILE, null);
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}
function getSaved(userId, source, name) {
  const mine = loadSaved()[userId]?.[source];
  return mine && Object.hasOwn(mine, name) ? mine[name] : null;
}
function putSaved(userId, source, name, list) {
  const d = loadSaved();
  if (!d[userId] || typeof d[userId] !== 'object') d[userId] = {};
  if (!d[userId][source]) d[userId][source] = {};
  const mine = d[userId][source];
  const existed = Object.hasOwn(mine, name);
  if (!existed && Object.keys(mine).length >= MAX_SAVED) return 'full';
  mine[name] = list;
  writeJson(SAVED_FILE, d);
  return existed ? 'updated' : 'created';
}
function removeSaved(userId, source, name) {
  const d = loadSaved();
  const mine = d[userId]?.[source];
  if (!mine || !Object.hasOwn(mine, name)) return false;
  delete mine[name];
  writeJson(SAVED_FILE, d);
  return true;
}

function normalizeTags(tokens) {
  const list = tokens.filter((t) => !t.startsWith('@'));
  if (!list.length) return { error: 'Give at least one tag.' };
  if (list.length > 30) return { error: 'That is too many tags (max 30).' };
  if (list.some(blockedTagToken)) return { error: 'That list includes a tag that is blocked on this bot.' };
  return { list };
}

function normalizeSubs(tokens) {
  const list = tokens.filter((t) => !t.startsWith('@')).map((t) => t.replace(/^\/?r\//i, '')).filter(Boolean);
  if (!list.length) return { error: 'Give at least one subreddit.' };
  if (list.length > 20) return { error: 'That is too many subreddits (max 20).' };
  if (list.some((s) => !/^[A-Za-z0-9_]+$/.test(s))) {
    return { error: 'Subreddit names can only use letters, numbers and underscores.' };
  }
  if (list.some(isBlockedSubreddit)) return { error: 'That list includes a subreddit that is blocked on this bot.' };
  return { list };
}

// Handles: <cmd> save <name> <...> · <cmd> saved · <cmd> unsave <name>. Returns true if it handled the message.
async function handleSaved(message, tokens, spec) {
  const action = tokens[0];
  if (!['save', 'saved', 'unsave'].includes(action)) return false;

  const { source, cmd, noun, what, normalize } = spec;
  const uid = message.author.id;

  if (action === 'saved') {
    const mine = loadSaved()[uid]?.[source] || {};
    const names = Object.keys(mine);
    if (!names.length) {
      await message.reply(`You have no saved ${what}s yet.\nMake one: \`${cmd} save <name> <${noun}...>\``);
      return true;
    }
    const lines = names.map((n) => `• \`@${n}\` → \`${mine[n].join(' ').replace(/`/g, '')}\``);
    await message.reply(`**Your saved ${what}s** (use one with \`${cmd} @name\`)\n${lines.join('\n')}`.slice(0, 1900));
    return true;
  }

  const name = (tokens[1] || '').replace(/^@/, '');

  if (action === 'unsave') {
    if (!name) {
      await message.reply(`Usage: \`${cmd} unsave <name>\``);
      return true;
    }
    const ok = removeSaved(uid, source, name);
    await message.reply(ok ? `Deleted your saved ${what} \`@${name}\`.` : `You don't have a saved ${what} called \`${name}\`.`);
    return true;
  }

  // save
  const usage = `Usage: \`${cmd} save <name> <${noun}...>\`\nNames are 1-20 letters, numbers, \`-\` or \`_\`.`;
  if (!NAME_RULE.test(name)) {
    await message.reply(usage);
    return true;
  }
  const { list, error } = normalize(tokens.slice(2));
  if (error) {
    await message.reply(`${error}\n${usage}`);
    return true;
  }
  const result = putSaved(uid, source, name, list);
  if (result === 'full') {
    await message.reply(`You already have ${MAX_SAVED} saved ${what}s here. Delete one with \`${cmd} unsave <name>\` first.`);
    return true;
  }
  await message.reply(
    `${result === 'updated' ? 'Updated' : 'Saved'} \`@${name}\` → \`${list.join(' ').replace(/`/g, '')}\`\nUse it with \`${cmd} @${name}\``
  );
  return true;
}

// Swaps every @name for that person's saved list
function expandSaved(userId, source, tokens) {
  const out = [];
  const missing = [];
  for (const t of tokens) {
    if (t.startsWith('@') && t.length > 1) {
      const saved = getSaved(userId, source, t.slice(1));
      if (!saved) missing.push(t.slice(1));
      else out.push(...saved);
    } else {
      out.push(t);
    }
  }
  return { tokens: out, missing };
}

// ================= Showing results =================
// Gallery: one post at a time with ◀ ▶ ✖ buttons. Only the person who ran the command can use them.
async function showGallery(message, posts, { header, makeEmbed, makeVideo }) {
  let i = 0;
  const head = String(header).slice(0, 300);

  const view = () => {
    const post = posts[i];
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('booru:prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('booru:pos').setLabel(`${i + 1} / ${posts.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId('booru:next').setEmoji('▶️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('booru:close').setEmoji('✖️').setStyle(ButtonStyle.Danger)
    );
    return post.isVideo
      ? { content: `${head}\n${makeVideo(post, i)}`, embeds: [], components: [row] }
      : { content: head, embeds: [makeEmbed(post, i)], components: [row] };
  };

  const sent = await message.channel.send(view());
  const collector = sent.createMessageComponentCollector({
    idle: 3 * 60 * 1000,
    time: 15 * 60 * 1000,
    filter: (b) => b.customId.startsWith('booru:'),
  });

  collector.on('collect', async (btn) => {
    try {
      if (btn.user.id !== message.author.id) {
        await btn.reply({ content: 'Only the person who ran the command can use these buttons.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (btn.customId === 'booru:close') {
        await btn.deferUpdate();
        collector.stop('closed');
        await sent.delete().catch(() => {});
        return;
      }
      i = btn.customId === 'booru:next' ? (i + 1) % posts.length : (i - 1 + posts.length) % posts.length;
      await btn.update(view());
    } catch {
      /* ignore */
    }
  });

  collector.on('end', (_, reason) => {
    if (reason !== 'closed') sent.edit({ components: [] }).catch(() => {});
  });
}

async function present(message, posts, { header, embed, videoText, onSent, gallery }) {
  const total = posts.length;
  const makeEmbed = (p, i) => embed(p, i, total);
  const makeVideo = (p, i) => videoText(p, i, total);

  if (gallery) {
    posts.forEach(onSent);
    return showGallery(message, posts, { header, makeEmbed, makeVideo });
  }
  await message.channel.send(String(header).slice(0, 1900));
  await sendPosts(message.channel, posts, { embed: makeEmbed, videoText: makeVideo, onSent });
}

// ================= "Did you mean...?" =================
async function suggestTags(adapter, tags) {
  const plain = [
    ...new Set(
      tags
        .filter((t) => !t.startsWith('-'))
        .map((t) => t.replace(/^[~+]/, ''))
        .filter((t) => t && !/[:*]/.test(t))
    ),
  ].slice(0, 3);

  const found = [];
  let checked = false;
  for (const tag of plain) {
    let result = null;
    try {
      result = await adapter.autocomplete(tag);
    } catch {
      result = null;
    }
    if (!result) continue;
    checked = true;
    if (result.exact) continue;
    const names = (result.names || []).filter((n) => n !== tag && !isBlockedText(n)).slice(0, 3);
    found.push({ tag, names });
  }
  return { checked, found };
}

// ================= Builds a whole tag-search command (used by e621 and rule34) =================
function createTagBooru(adapter) {
  const cmd = adapter.name;
  const SAVED = { source: adapter.key, cmd, noun: 'tags', what: 'search', normalize: normalizeTags };

  async function collect(searchTags, want) {
    // Ask for extra: duplicates and blocked posts get filtered out afterwards
    const limit = Math.min(adapter.maxLimit, Math.max(want * 4, 20));
    const raw = await adapter.fetch(searchTags, limit);

    const seen = new Set();
    const out = [];
    for (const p of raw) {
      const key = `${adapter.key}:${p.id}`;
      if (seen.has(key) || wasSent(key)) continue;
      if (p.tags.some((t) => isBlockedText(t))) continue;
      seen.add(key);
