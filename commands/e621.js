const { EmbedBuilder } = require('discord.js');
const { isAllowed } = require('../lib/redditAllow');

const BASE = 'https://e621.net/posts.json';
const MAX = 50;           // max images per command
const PER_MESSAGE = 10;   // Discord's limit of embeds per message
const DEDUPE_MS = 10 * 60 * 1000;
const MIN_GAP_MS = 700;   // e621's hard limit is 2 requests/second

// Optional: set E621_USER and E621_KEY in your host's env variables.
// e621 asks bots to identify themselves, and a key unlocks more of the site.
const E621_USER = process.env.E621_USER;
const E621_KEY = process.env.E621_KEY;
const UA = E621_USER
  ? `OverLorderBot/1.0 (by ${E621_USER} on e621)`
  : 'OverLorderBot/1.0 (Discord bot; github.com/TheFallenStarGG/OverLorder-Bot)';

// Only these file types can be shown inside a Discord embed (no videos)
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

// Posts with these tags are NEVER shown, and searching for them is refused.
// This is checked on the bot's side, so it doesn't use up any of e621's tag slots.
const ALWAYS_BLOCKED = new Set([
  'young', 'cub', 'loli', 'shota', 'toddlercon', 'toddler', 'child', 'infant', 'underage', 'minor',
]);
const ALWAYS_BLOCKED_PREFIXES = ['loli', 'shota', 'toddlercon'];

// Add anything else you never want shown (example: 'gore', 'scat'). Easy to edit.
const EXTRA_BLOCKED = new Set([]);

const HIDDEN_ARTISTS = new Set([
  'unknown_artist', 'anonymous_artist', 'conditional_dnp', 'sound_warning', 'epilepsy_warning',
]);

const RATINGS = { s: 'Safe', q: 'Questionable', e: 'Explicit' };

// post id -> timestamp when we last sent it
const recentlySent = new Map();

function pruneDedupe() {
  const now = Date.now();
  for (const [id, at] of recentlySent) {
    if (now - at > DEDUPE_MS) recentlySent.delete(id);
  }
}
function wasSentRecently(id) {
  pruneDedupe();
  const at = recentlySent.get(id);
  return Boolean(at && Date.now() - at < DEDUPE_MS);
}
function markSent(id) {
  recentlySent.set(id, Date.now());
}

function canUse(ctx, userId) {
  return Boolean(ctx.isOwner) || isAllowed(userId);
}

function isBlockedTag(tag) {
  const t = String(tag).toLowerCase();
  return (
    ALWAYS_BLOCKED.has(t) ||
    EXTRA_BLOCKED.has(t) ||
    ALWAYS_BLOCKED_PREFIXES.some((p) => t.startsWith(p))
  );
}

// Keeps requests under e621's 2-per-second limit
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

// !!e621 <tags...> [count]    (or count:N anywhere)
function parseArgs(raw) {
  const tokens = String(raw || '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let count = 5;
  const tags = [];
  for (const tok of tokens) {
    const m = tok.match(/^count:(\d+)$/);
    if (m) count = parseInt(m[1], 10);
    else tags.push(tok);
  }
  // a plain number at the end is the count (only if there's at least one real tag before it)
  if (tags.length > 1 && /^\d+$/.test(tags[tags.length - 1])) {
    count = parseInt(tags.pop(), 10);
  }

  count = Math.min(MAX, Math.max(1, count || 5));
  return { tags, count };
}

async function fetchPosts(tags, want) {
  // Ask for extra: videos, duplicates and blocked posts get filtered out afterwards
  const limit = Math.min(320, Math.max(want * 4, 20));
  const params = new URLSearchParams({ tags: tags.join(' '), limit: String(limit) });

  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (E621_USER && E621_KEY) {
    headers.Authorization = 'Basic ' + Buffer.from(`${E621_USER}:${E621_KEY}`).toString('base64');
  }

  await throttle();
  const res = await fetch(`${BASE}?${params}`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* handled below */
  }

  if (json && json.success === false) {
    throw new Error(json.message || json.reason || 'e621 rejected that search.');
  }
  if (res.status === 403) throw new Error('e621 refused the request (the bot’s host may be blocked).');
  if (res.status === 429 || res.status === 503) {
    throw new Error('e621 is rate limiting the bot. Try again in a few seconds.');
  }
  if (!res.ok) throw new Error(`e621 returned HTTP ${res.status}.`);
  if (!Array.isArray(json?.posts)) throw new Error('Unexpected response from e621.');

  const seen = new Set();
  const out = [];
  for (const p of json.posts) {
    if (!p || seen.has(p.id) || wasSentRecently(p.id)) continue;
    if (p.flags?.deleted) continue;

    const url = p.file?.url;
    const ext = String(p.file?.ext || '').toLowerCase();
    if (!url || !IMAGE_EXTS.has(ext)) continue; // no link, or a video/flash file

    const allTags = Object.values(p.tags || {}).flat();
    if (allTags.some(isBlockedTag)) continue;

    seen.add(p.id);
    const artists = (p.tags?.artist || [])
      .filter((a) => !HIDDEN_ARTISTS.has(a))
      .map((a) => a.replace(/_/g, ' '));

    out.push({
      id: p.id,
      url,
      artists,
      score: p.score?.total ?? 0,
      favs: p.fav_count ?? 0,
      rating: RATINGS[p.rating] || '?',
    });
    if (out.length >= want) break;
  }
  return out;
}

module.exports = {
  name: '!!e621',
  aliases: ['!!e6'],
  usage: '!!e621 <tags...> [count]',
  description: 'Owner/allowlist only. Pull image posts from e621 using tag searches.',
  access: 'free',
  hidden: true,

  async run(message, arg, ctx) {
    // Not allowed → ignore completely (no reply)
    if (!canUse(ctx, message.author.id)) return;

    // Adult content tool → NSFW channel only
    if (!message.channel?.nsfw) {
      return message.reply('This command only works in an **NSFW** channel.');
    }

    const { tags, count } = parseArgs(ctx.rawArg || arg);
    if (!tags.length) {
      return message.reply(
        'Usage: `!!e621 <tags...> [count]`\n' +
          'Examples:\n' +
          '`!!e621 fox solo rating:e 10`\n' +
          '`!!e621 wolf score:>200 order:score 5`\n' +
          '`!!e621 canine -solo type:gif 8`\n' +
          'Tips: `-tag` excludes a tag, `~tag` means "any of", `rating:s/q/e` filters by rating. ' +
          'Posts come back in random order unless you add your own `order:` tag.'
      );
    }

    // Refuse searches for blocked tags (a leading "-" is fine, that excludes them)
    const blockedAsked = tags.find((t) => !t.startsWith('-') && isBlockedTag(t.replace(/^[~+]/, '')));
    if (blockedAsked) {
      return message.reply('That search includes a tag that is blocked on this bot.');
    }

    // Random order by default (uses one of e621's tag slots)
    if (!tags.some((t) => t.startsWith('order:'))) tags.push('order:random');

    await message.channel.sendTyping().catch(() => {});

    let posts;
    try {
      posts = await fetchPosts(tags, count);
    } catch (err) {
      return message.reply(`Could not fetch from e621: ${err.message}`);
    }

    const shownTags = tags.join(' ').replace(/`/g, '');

    if (!posts.length) {
      return message.reply(
        `No new **image** posts found for \`${shownTags}\`. Check the tags, or they may all be videos or already sent in the last 10 minutes.`
      );
    }

    await message.channel.send(
      `**e621** · ${posts.length} image${posts.length === 1 ? '' : 's'} · \`${shownTags}\``
    );

    for (let i = 0; i < posts.length; i += PER_MESSAGE) {
      const batch = posts.slice(i, i + PER_MESSAGE);
      const embeds = batch.map((p, j) =>
        new EmbedBuilder()
          .setColor(0x00549e)
          .setTitle((p.artists.length ? p.artists.join(', ') : `Post #${p.id}`).slice(0, 256))
          .setURL(`https://e621.net/posts/${p.id}`)
          .setImage(p.url)
          .setFooter({
            text: `e621 #${p.id} · ${i + j + 1}/${posts.length} · ▲ ${p.score} · ♥ ${p.favs} · ${p.rating}`,
          })
      );
      await message.channel.send({ embeds });
      for (const p of batch) markSent(p.id);
    }
  },
};
