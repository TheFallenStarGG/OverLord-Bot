const { EmbedBuilder } = require('discord.js');
const { isAllowed } = require('../lib/redditAllow');

const API = 'https://meme-api.com/gimme';
const MAX = 50;          // meme-api's hard limit per request
const PER_MESSAGE = 10;  // Discord's limit of embeds per message
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

// Pick a usable image URL from one meme-api post (or null if it's not an image)
function pickImage(m) {
  if (m?.url && isImageUrl(m.url)) return String(m.url);
  // fall back to the highest-quality preview (last in the array)
  if (Array.isArray(m?.preview) && m.preview.length) {
    return String(m.preview[m.preview.length - 1]).replace(/&amp;/g, '&');
  }
  return null;
}

function formatUps(n) {
  n = Number(n) || 0;
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}

function parseArgs(raw) {
  const parts = String(raw || '').trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').replace(/^\/?r\//i, '').trim();
  let count = 5;

  for (const p of parts.slice(1)) {
    if (/^\d+$/.test(p)) count = parseInt(p, 10);
  }

  count = Math.min(MAX, Math.max(1, count || 5));
  return { sub, count };
}

async function fetchImages(sub, want) {
  // Ask for extra, because the API returns random posts and we drop
  // duplicates / non-images / recently sent ones afterwards.
  const ask = Math.min(MAX, Math.max(want * 2, want + 5));
  const url = `${API}/${encodeURIComponent(sub)}/${ask}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* handled below */
  }

  // meme-api reports problems as { code, message }
  if (json && json.code && json.message) throw new Error(json.message);
  if (res.status === 404) throw new Error(`Subreddit r/${sub} not found.`);
  if (!res.ok) throw new Error(`Meme API returned HTTP ${res.status}.`);

  const memes = Array.isArray(json?.memes) ? json.memes : json?.url ? [json] : null;
  if (!memes) throw new Error('Unexpected response from the Meme API.');

  const seen = new Set();
  const images = [];
  for (const m of memes) {
    const img = pickImage(m);
    if (!img || seen.has(img) || wasSentRecently(img)) continue;
    seen.add(img);

    images.push({
      url: img,
      title: String(m.title || 'post').slice(0, 200),
      permalink: m.postLink || null,
      author: m.author || 'unknown',
      sub: m.subreddit || sub,
      ups: m.ups,
      nsfw: Boolean(m.nsfw),
      spoiler: Boolean(m.spoiler),
    });
    if (images.length >= want) break;
  }
  return images;
}

module.exports = {
  name: '!!r',
  usage: '!!r <subreddit> [count]',
  description: 'Owner/allowlist only. Pull random image posts from any subreddit.',
  access: 'free',
  hidden: true,

  async run(message, arg, ctx) {
    // Not allowed → ignore completely (no reply)
    if (!canUse(ctx, message.author.id)) return;

    // Adult content tool → NSFW channel only
    if (!message.channel?.nsfw) {
      return message.reply('This command only works in an **NSFW** channel.');
    }

    const { sub, count } = parseArgs(ctx.rawArg || arg);
    if (!sub || !/^[A-Za-z0-9_]+$/.test(sub)) {
      return message.reply(
        'Usage: `!!r <subreddit> [count]`\nExample: `!!r take1leave1 20`'
      );
    }

    await message.channel.sendTyping().catch(() => {});

    let images;
    try {
      images = await fetchImages(sub, count);
    } catch (err) {
      return message.reply(`Could not fetch r/${sub}: ${err.message}`);
    }

    if (!images.length) {
      return message.reply(
        `No new **image** posts found for r/${sub} — try again in a moment (images sent in the last 10 minutes are skipped).`
      );
    }

    await message.channel.send(
      `**r/${sub}** · ${images.length} image${images.length === 1 ? '' : 's'}`
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
            text:
              `r/${img.sub} · ${i + j + 1}/${images.length} · u/${img.author} · ▲ ${formatUps(img.ups)}` +
              `${img.nsfw ? ' · NSFW' : ''}${img.spoiler ? ' · SPOILER' : ''}`,
          })
      );
      await message.channel.send({ embeds });
      for (const img of batch) markSent(img.url);
    }
  },
};
