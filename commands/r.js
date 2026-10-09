const { EmbedBuilder } = require('discord.js');
const { kindOf, videoLink } = require('../lib/media');
const booru = require('../lib/booru');

const API = 'https://meme-api.com/gimme';
const MAX = 50; // meme-api's hard limit per request

const SAVED = { source: 'r', cmd: '!!r', noun: 'subreddits', what: 'list', normalize: booru.normalizeSubs };

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

// Pick a usable image or video from one meme-api post (or null if there's nothing to show)
function pickMedia(m) {
  if (m?.url) {
    if (isImageUrl(m.url)) return { url: String(m.url), isVideo: false };
    if (kindOf(m.url) === 'video') return { url: videoLink(m.url), isVideo: true };
  }
  // fall back to the highest-quality preview (last in the array)
  if (Array.isArray(m?.preview) && m.preview.length) {
    return { url: String(m.preview[m.preview.length - 1]).replace(/&amp;/g, '&'), isVideo: false };
  }
  return null;
}

function formatUps(n) {
  n = Number(n) || 0;
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}

async function fetchImages(sub, want) {
  // Ask for extra, because the API returns random posts and we drop
  // duplicates / non-images / blocked / recently sent ones afterwards.
  const ask = Math.min(MAX, Math.max(want * 2, want + 5));
  const res = await booru.request(`${API}/${encodeURIComponent(sub)}/${ask}`, { label: 'The Meme API' });

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
    // Safety: skip posts whose title or subreddit hits the shared blocklist
    if (booru.isBlockedText(m.title) || booru.isBlockedSubreddit(m.subreddit || sub)) continue;

    const media = pickMedia(m);
    if (!media || seen.has(media.url) || booru.wasSent(`r:${media.url}`)) continue;
    seen.add(media.url);

    images.push({
      url: media.url,
      isVideo: media.isVideo,
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
  usage: '!!r <subreddit> [count] [gallery]',
  description: 'Owner/allowlist only. Pull random image posts from any subreddit.',
  access: 'free',
  hidden: true,

  async run(message, arg, ctx) {
    // Not allowed → ignore completely (no reply)
    if (!booru.canUse(ctx, message.author.id)) return;

    // Adult content tool → NSFW channel only
    if (!message.channel?.nsfw) {
      return message.reply('This command only works in an **NSFW** channel.');
    }

    const { tokens, gallery } = booru.splitArgs(ctx.rawArg || arg);

    // save / saved / unsave
    if (await booru.handleSaved(message, tokens, SAVED)) return;

    // Swap @name for the saved subreddits
    const expanded = booru.expandSaved(message.author.id, 'r', tokens);
    if (expanded.missing.length) {
      return message.reply(`You don't have a saved list called \`${expanded.missing[0]}\`. See yours with \`!!r saved\`.`);
    }

    const { rest, count: asked } = booru.takeCount(expanded.tokens, { anywhere: true });
    const subs = [...new Set(rest.map((s) => s.replace(/^\/?r\//i, '')).filter(Boolean))];

    if (!subs.length || subs.some((s) => !/^[A-Za-z0-9_]+$/.test(s))) {
      return message.reply(
        'Usage: `!!r <subreddit> [count] [gallery]`\n' +
          'Example: `!!r take1leave1 20` · add `gallery` to flip through one at a time\n' +
          'Give several subreddits (or use a saved list) and it picks one at random each time.\n' +
          'Saved lists (just yours): `!!r save <name> <subs...>` · `!!r @name` · `!!r saved` · `!!r unsave <name>`'
      );
    }

    // Safety: refuse blocked subreddit names
    if (subs.some(booru.isBlockedSubreddit)) {
      return message.reply('That includes a subreddit that is blocked on this bot.');
    }

    const sub = subs[Math.floor(Math.random() * subs.length)];
    const count = booru.clampCount(asked, gallery ? 10 : 5);

    await message.channel.sendTyping().catch(() => {});

    let images;
    try {
      images = await booru.withRetry(() => fetchImages(sub, count));
    } catch (err) {
      return message.reply(`Could not fetch r/${sub}: ${err.message}`);
    }

    if (!images.length) {
      return message.reply(
        `No new **image** posts found for r/${sub} — try again in a moment (images sent in the last 10 minutes are skipped).`
      );
    }

    await booru.present(message, images, {
      header: `**r/${sub}** · ${images.length} post${images.length === 1 ? '' : 's'}${gallery ? ' · gallery' : ''}`,
      embed: (img, i, n) =>
        new EmbedBuilder()
          .setColor(0xff4500)
          .setTitle(img.title.slice(0, 256))
          .setURL(img.permalink || img.url)
          .setImage(img.url)
          .setFooter({
            text:
              `r/${img.sub} · ${i + 1}/${n} · u/${img.author} · ▲ ${formatUps(img.ups)}` +
              `${img.nsfw ? ' · NSFW' : ''}${img.spoiler ? ' · SPOILER' : ''}`,
          }),
      videoText: (img, i, n) =>
        `**r/${img.sub}** · ${i + 1}/${n} · u/${img.author} · ▲ ${formatUps(img.ups)}` +
        `${img.permalink ? ` · <${img.permalink}>` : ''}\n${img.url}`,
      onSent: (img) => booru.markSent(`r:${img.url}`),
      gallery,
    });
  },
};
