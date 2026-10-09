const { EmbedBuilder } = require('discord.js');
const { isAllowed } = require('../lib/redditAllow');
const { sendPosts } = require('../lib/media');

const BASE = 'https://api.rule34.xxx/index.php';
const MAX = 50;           // max images per command
const PER_MESSAGE = 10;   // Discord's limit of embeds per message
const DEDUPE_MS = 10 * 60 * 1000;
const MIN_GAP_MS = 1000;  // be polite: at most 1 request per second

// rule34 REQUIRES an account API key + user ID (set these as env variables on your host)
const R34_API_KEY = process.env.R34_API_KEY;
const R34_USER_ID = process.env.R34_USER_ID;
const UA = 'OverLorderBot/1.0 (Discord bot; github.com/TheFallenStarGG/OverLorder-Bot)';

// Images go in an embed; videos are sent as a plain link so Discord makes a player
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v']);

// Posts with these tags are NEVER shown, and searching for them is refused.
// Checked on the bot's side, so it doesn't change what you search for.
const ALWAYS_BLOCKED = new Set([
  'young', 'cub', 'loli', 'shota', 'toddlercon', 'toddler', 'child', 'infant', 'underage', 'minor',
]);
const ALWAYS_BLOCKED_PREFIXES = ['loli', 'shota', 'toddlercon'];

// Add anything else you never want shown (example: 'gore', 'scat'). Easy to edit.
const EXTRA_BLOCKED = new Set([]);

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

// Keeps requests spaced out
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

// !!rule34 <tags...> [count]    (or count:N anywhere)
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

function extOf(url) {
  const clean = String(url).split('?')[0];
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}

async function fetchPosts(tags, want) {
  // Ask for extra: videos, duplicates and blocked posts get filtered out afterwards
  const limit = Math.min(200, Math.max(want * 4, 20));
  const params = new URLSearchParams({
    page: 'dapi',
    s: 'post',
    q: 'index',
    json: '1',
    limit: String(limit),
    tags: tags.join(' '),
    api_key: R34_API_KEY,
    user_id: R34_USER_ID,
  });

  await throttle();
  const res = await fetch(`${BASE}?${params}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });

  const text = (await res.text()).trim();

  if (res.status === 401 || res.status === 403) {
    throw new Error('rule34 refused the request. Check R34_API_KEY and R34_USER_ID (or the bot’s host may be blocked).');
  }
  if (res.status === 429 || res.status === 503) {
    throw new Error('rule34 is rate limiting the bot. Try again in a few seconds.');
  }
  if (!res.ok) throw new Error(`rule34 returned HTTP ${res.status}.`);

  // A search with no results comes back as an empty body
  if (!text) return [];

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    if (/auth|api.?key|credential|missing/i.test(text)) {
      throw new Error('rule34 rejected the credentials. Check R34_API_KEY and R34_USER_ID.');
    }
    throw new Error('Unexpected response from rule34.');
  }

  if (!Array.isArray(json)) {
    throw new Error(json?.message || json?.error || 'rule34 rejected that search.');
  }

  const seen = new Set();
  const out = [];
  for (const p of json) {
    if (!p || !p.id || seen.has(p.id) || wasSentRecently(p.id)) continue;

    let url = p.file_url;
    if (!url) continue;
    if (url.startsWith('//')) url = `https:${url}`;
    const ext = extOf(url);
    const isVideo = VIDEO_EXTS.has(ext);
    if (!IMAGE_EXTS.has(ext) && !isVideo) continue; // not an image or video
    
    const postTags = String(p.tags || '').split(/\s+/).filter(Boolean);
    if (postTags.some(isBlockedTag)) continue;

    seen.add(p.id);
    const rating = String(p.rating || '?');
    out.push({
      id: p.id,
      url,
      isVideo,
      score: p.score ?? 0,
      rating: rating.charAt(0).toUpperCase() + rating.slice(1),
    });
    if (out.length >= want) break;
  }
  return out;
}

module.exports = {
  name: '!!rule34',
  aliases: ['!!r34'],
  usage: '!!rule34 <tags...> [count]',
  description: 'Owner/allowlist only. Pull image posts from rule34 using tag searches.',
  access: 'free',
  hidden: true,

  async run(message, arg, ctx) {
    // Not allowed → ignore completely (no reply)
    if (!canUse(ctx, message.author.id)) return;

    // Adult content tool → NSFW channel only
    if (!message.channel?.nsfw) {
      return message.reply('This command only works in an **NSFW** channel.');
    }

    if (!R34_API_KEY || !R34_USER_ID) {
      return message.reply(
        'rule34 needs an API key. Set the `R34_API_KEY` and `R34_USER_ID` env variables on the host, then restart the bot.'
      );
    }

    const { tags, count } = parseArgs(ctx.rawArg || arg);
    if (!tags.length) {
      return message.reply(
        'Usage: `!!rule34 <tags...> [count]`\n' +
          'Examples:\n' +
          '`!!rule34 some_tag another_tag 10`\n' +
          '`!!rule34 some_tag score:>100 sort:score 5`\n' +
          '`!!rule34 some_tag -unwanted_tag rating:explicit 8`\n' +
          'Tips: `-tag` excludes a tag, `rating:safe/questionable/explicit` filters by rating. ' +
          'Posts come back in random order unless you add your own `sort:` tag.'
      );
    }

    // Refuse searches for blocked tags (a leading "-" is fine, that excludes them)
    const blockedAsked = tags.find((t) => !t.startsWith('-') && isBlockedTag(t.replace(/^[~+]/, '')));
    if (blockedAsked) {
      return message.reply('That search includes a tag that is blocked on this bot.');
    }

    // Random order by default
    if (!tags.some((t) => t.startsWith('sort:'))) tags.push('sort:random');

    await message.channel.sendTyping().catch(() => {});

    let posts;
    try {
      posts = await fetchPosts(tags, count);
    } catch (err) {
      return message.reply(`Could not fetch from rule34: ${err.message}`);
    }

    const shownTags = tags.join(' ').replace(/`/g, '');

    if (!posts.length) {
      return message.reply(
        `No new **image** posts found for \`${shownTags}\`. Check the tags, or they may all be videos or already sent in the last 10 minutes.`
      );
    }

    await message.channel.send(
      `**rule34** · ${posts.length} post${posts.length === 1 ? '' : 's'} · \`${shownTags}\``
    );

    await sendPosts(message.channel, posts, {
      embed: (p, i) =>
        new EmbedBuilder()
          .setColor(0xaae5a4)
          .setTitle(`Post #${p.id}`)
          .setURL(`https://rule34.xxx/index.php?page=post&s=view&id=${p.id}`)
          .setImage(p.url)
          .setFooter({
            text: `rule34 #${p.id} · ${i + 1}/${posts.length} · ▲ ${p.score} · ${p.rating}`,
          }),
      videoText: (p, i) =>
        `**rule34 #${p.id}** · ${i + 1}/${posts.length} · ▲ ${p.score} · ${p.rating} · <https://rule34.xxx/index.php?page=post&s=view&id=${p.id}>\n${p.url}`,
      onSent: (p) => markSent(p.id),
    });
    
  },
};
