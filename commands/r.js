const { EmbedBuilder } = require('discord.js');
const { isAllowed } = require('../lib/redditAllow');

const DEDUPE_MS = 10 * 60 * 1000;
// url -> timestamp when we last sent it
const recentlySent = new Map();

function pruneDedupe() {
  const now = Date.now();
  for (const [url, at] of recentlySent) {
    if (now - at > DEDUPE_MS) recentlySent.delete(url);
  }
}

function wasSentRecently(url) {
  pruneDedupe();
  const at = recentlySent.get(url);
  return Boolean(at && Date.now() - at < DEDUPE_MS);
}

function markSent(url) {
  recentlySent.set(url, Date.now());
}

const MAX = 50;
const PER_MESSAGE = 10;
const UA = 'TheOverlordBot/1.0 (private owner tool; contact: discord bot owner)';

// !!r <sub> [count] [sort]
// sort: new | hot | top | rising | popular  (popular = top of all time)
const SORTS = {
  new: 'new',
  hot: 'hot',
  rising: 'rising',
  top: 'top',
  popular: 'top', // most popular = top (all time)
};

function canUse(ctx, userId) {
  return Boolean(ctx.isOwner) || isAllowed(userId);
}

function isImageUrl(url) {
  if (!url) return false;
  const u = String(url).split('?')[0].toLowerCase();
  return (
    /\.(jpe?g|png|gif|webp)$/i.test(u) ||
    u.includes('i.redd.it/') ||
    u.includes('i.imgur.com/') ||
    u.includes('preview.redd.it/')
  );
}

function imageUrlFromPost(post) {
  const d = post?.data;
  if (!d || d.stickied) return null;

  // Pure image link
  const url = String(d.url || '');
  if (isImageUrl(url)) return url.split('?')[0];

  // Hosted image with preview
  if (d.post_hint === 'image' || d.is_reddit_media_domain) {
    const preview = d.preview?.images?.[0]?.source?.url;
    if (preview) return preview.replace(/&amp;/g, '&');
  }

  // Gallery — first still image only
  if (d.is_gallery && d.media_metadata) {
    for (const meta of Object.values(d.media_metadata)) {
      if (meta?.e && meta.e !== 'Image') continue;
      const u = meta?.s?.u || meta?.s?.gif;
      if (u) return String(u).replace(/&amp;/g, '&');
    }
  }

  // No videos (v.redd.it), text posts, link posts without image
  return null;
}

function parseArgs(raw) {
  const parts = String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const sub = (parts[0] || '').replace(/^r\//i, '').trim();
  let count = 5;
  let sortKey = 'new';

  for (const p of parts.slice(1)) {
    const low = p.toLowerCase();
    if (SORTS[low]) {
      sortKey = low;
      continue;
    }
    if (/^\d+$/.test(p)) {
      count = parseInt(p, 10);
    }
  }

  count = Math.min(MAX, Math.max(1, count || 5));
  return { sub, count, sortKey, redditSort: SORTS[sortKey] };
}

async function fetchRecentImages(sub, want, sortKey, redditSort) {
  const limit = Math.min(100, Math.max(want * 4, 25));
  let path = `https://www.reddit.com/r/${encodeURIComponent(sub)}/${redditSort}.json?limit=${limit}`;

  // "popular" → all-time top; plain "top" → today
  if (sortKey === 'popular') {
    path += '&t=all';
  } else if (sortKey === 'top') {
    path += '&t=day';
  }

  const res = await fetch(path, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 404) throw new Error(`Subreddit r/${sub} not found.`);
  if (res.status === 403) throw new Error(`Subreddit r/${sub} is private or banned.`);
  if (!res.ok) throw new Error(`Reddit returned HTTP ${res.status}.`);

  const json = await res.json();
  const children = json?.data?.children;
  if (!Array.isArray(children)) throw new Error('Unexpected Reddit response.');

  const images = [];
  for (const child of children) {
    const d = child.data;
    const img = imageUrlFromPost(child);
    if (!img) continue;
    if (wasSentRecently(img)) continue;

    images.push({
      url: img,
      title: String(d.title || 'post').slice(0, 200),
      permalink: d.permalink ? `https://reddit.com${d.permalink}` : null,
      author: d.author || 'unknown',
      nsfw: Boolean(d.over_18),
    });
    if (images.length >= want) break;
  }
  return images;
}

module.exports = {
  name: '!!r',
  usage: '!!r <subreddit> [count] [new|hot|top|rising|popular]',
  description: 'Owner/allowlist only. Pull image posts from a subreddit.',
  access: 'free',
  hidden: true,

  async run(message, arg, ctx) {
    // Not allowed → ignore completely (no reply)
    if (!canUse(ctx, message.author.id)) return;

    // Adult content tool → NSFW channel only
    if (!message.channel?.nsfw) {
      return message.reply('This command only works in an **NSFW** channel.');
    }

    const { sub, count, sortKey, redditSort } = parseArgs(ctx.rawArg || arg);
    if (!sub || !/^[A-Za-z0-9_]+$/.test(sub)) {
      return message.reply(
        'Usage: `!!r <subreddit> [count] [new|hot|top|rising|popular]`\n' +
          'Example: `!!r take1leave1 20 popular`'
      );
    }

    let images;
    try {
      images = await fetchRecentImages(sub, count, sortKey, redditSort);
    } catch (err) {
      return message.reply(`Could not fetch r/${sub}: ${err.message}`);
    }

    if (!images.length) {
      return message.reply(
        `No new **image** posts for r/${sub} (**${sortKey}**) — nothing left that wasn’t already sent in the last 10 minutes.`
      );
    }

    const sortLabel =
      sortKey === 'popular' ? 'popular (top all-time)' : sortKey === 'top' ? 'top (today)' : sortKey;

    await message.channel.send(
      `**r/${sub}** · ${images.length} image${images.length === 1 ? '' : 's'} · sort: **${sortLabel}**`
    );
    for (let i = 0; i < images.length; i += PER_MESSAGE) {
      const batch = images.slice(i, i + PER_MESSAGE);
      const embeds = batch.map((img, j) =>
        new EmbedBuilder()
          .setColor(0xff4500)
          .setTitle(img.title.slice(0, 256))
          .setURL(img.permalink || img.url)
          .setImage(img.url)
          .setFooter({
            text: `r/${sub} · ${i + j + 1}/${images.length} · u/${img.author}${img.nsfw ? ' · NSFW' : ''}`,
          })
      );
      await message.channel.send({ embeds });
      for (const img of batch) markSent(img.url);
    }
  },
};
