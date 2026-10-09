const { EmbedBuilder } = require('discord.js');
const { isAllowed } = require('../lib/redditAllow');

const MAX = 50;
const PER_MESSAGE = 10;
const UA = 'TheOverlordBot/1.0 (private owner tool; contact: discord bot owner)';

function canUse(ctx, userId) {
  return Boolean(ctx.isOwner) || isAllowed(userId);
}

function imageUrlFromPost(post) {
  const d = post?.data;
  if (!d || d.stickied) return null;

  // Skip galleries that need special handling if no simple URL
  const url = String(d.url || '');
  if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(url)) return url.split('?')[0];
  if (url.includes('i.redd.it/')) return url.split('?')[0];

  // Reddit preview
  const preview = d.preview?.images?.[0]?.source?.url;
  if (preview) return preview.replace(/&amp;/g, '&');

  // Gallery: first image
  if (d.is_gallery && d.media_metadata) {
    const first = Object.values(d.media_metadata)[0];
    const u = first?.s?.u || first?.s?.gif;
    if (u) return String(u).replace(/&amp;/g, '&');
  }

  return null;
}

async function fetchRecentImages(sub, want) {
  // Reddit allows up to 100 per request; we may need one page for up to 50 images
  const limit = Math.min(100, Math.max(want * 3, 25));
  const res = await fetch(`https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=${limit}`, {
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
    if (d?.over_18) continue; // skip NSFW for safety
    const img = imageUrlFromPost(child);
    if (!img) continue;
    images.push({
      url: img,
      title: String(d.title || 'post').slice(0, 200),
      permalink: d.permalink ? `https://reddit.com${d.permalink}` : null,
      author: d.author || 'unknown',
    });
    if (images.length >= want) break;
  }
  return images;
}

module.exports = {
  name: '!!r',
  usage: '!!r <subreddit> [count]',
  description: 'Owner/allowlist only. Pull recent image posts from a subreddit.',
  access: 'free', // gated in run() so allowlist users can run it
  hidden: true,

  async run(message, arg, ctx) {
    if (!canUse(ctx, message.author.id)) return; // silent for non-allowed

    const parts = (ctx.rawArg || arg || '').trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] || '').replace(/^r\//i, '').trim();
    if (!sub || !/^[A-Za-z0-9_]+$/.test(sub)) {
      return message.reply('Usage: `!!r <subreddit> [count]` (example: `!!r take1leave1 20`)');
    }

    let count = parseInt(parts[1] || '5', 10);
    if (!Number.isFinite(count) || count < 1) count = 5;
    count = Math.min(MAX, count);

    let images;
    try {
      images = await fetchRecentImages(sub, count);
    } catch (err) {
      return message.reply(`Could not fetch r/${sub}: ${err.message}`);
    }

    if (!images.length) {
      return message.reply(`No recent **image** posts found in r/${sub} (NSFW is skipped).`);
    }

    // Discord: max 10 embeds per message → split into batches
    for (let i = 0; i < images.length; i += PER_MESSAGE) {
      const batch = images.slice(i, i + PER_MESSAGE);
      const embeds = batch.map((img, j) =>
        new EmbedBuilder()
          .setColor(0xff4500)
          .setTitle(img.title.slice(0, 256))
          .setURL(img.permalink || img.url)
          .setImage(img.url)
          .setFooter({
            text: `r/${sub} · ${i + j + 1}/${images.length} · u/${img.author}`,
          })
      );
      await message.channel.send({ embeds });
    }
  },
};
