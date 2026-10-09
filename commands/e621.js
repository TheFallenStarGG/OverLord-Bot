const { EmbedBuilder } = require('discord.js');
const booru = require('../lib/booru');

const BASE = 'https://e621.net';

// Optional: set E621_USER and E621_KEY in your host's env variables.
// e621 asks bots to identify themselves, and a key unlocks more of the site.
const E621_USER = process.env.E621_USER;
const E621_KEY = process.env.E621_KEY;
const UA = E621_USER
  ? `OverLorderBot/1.0 (by ${E621_USER} on e621)`
  : 'OverLorderBot/1.0 (Discord bot; github.com/TheFallenStarGG/OverLorder-Bot)';

function headers() {
  const h = { 'User-Agent': UA, Accept: 'application/json' };
  if (E621_USER && E621_KEY) {
    h.Authorization = 'Basic ' + Buffer.from(`${E621_USER}:${E621_KEY}`).toString('base64');
  }
  return h;
}

const HIDDEN_ARTISTS = new Set([
  'unknown_artist', 'anonymous_artist', 'conditional_dnp', 'sound_warning', 'epilepsy_warning',
]);
const RATINGS = { s: 'Safe', q: 'Questionable', e: 'Explicit' };

module.exports = booru.createTagBooru({
  key: 'e621',
  name: '!!e621',
  aliases: ['!!e6'],
  label: 'e621',
  usage: '!!e621 <tags...> [count] [gallery]',
  description: 'Owner/allowlist only. Pull posts from e621 using tag searches.',
  examples: ['!!e621 fox solo rating:e 10', '!!e621 wolf score:>200 order:score 5', '!!e621 canine -solo type:gif 8 gallery'],
  tips:
    '`-tag` excludes a tag, `~tag` means "any of", `rating:s/q/e` filters by rating. ' +
    'Posts come back in random order unless you add your own `order:` tag.',
  orderTag: 'order:random',
  orderPrefix: 'order:',
  maxLimit: 320,

  async fetch(tags, limit) {
    const params = new URLSearchParams({ tags: tags.join(' '), limit: String(limit) });
    const res = await booru.request(`${BASE}/posts.json?${params}`, {
      label: 'e621',
      headers: headers(),
      gapMs: 700, // e621's hard limit is 2 requests/second
    });

    let json = null;
    try {
      json = await res.json();
    } catch {
      /* handled below */
    }

    if (json && json.success === false) throw new Error(json.message || json.reason || 'e621 rejected that search.');
    if (res.status === 403) throw new Error('e621 refused the request (the bot’s host may be blocked).');
    if (!res.ok) throw new Error(`e621 returned HTTP ${res.status}.`);
    if (!Array.isArray(json?.posts)) throw new Error('Unexpected response from e621.');

    const out = [];
    for (const p of json.posts) {
      if (!p || p.flags?.deleted) continue;
      const url = p.file?.url;
      const kind = booru.kindFromExt(p.file?.ext);
      if (!url || !kind) continue; // no link, or a flash file

      out.push({
        id: p.id,
        url,
        isVideo: kind === 'video',
        tags: Object.values(p.tags || {}).flat(),
        artists: (p.tags?.artist || []).filter((a) => !HIDDEN_ARTISTS.has(a)).map((a) => a.replace(/_/g, ' ')),
        score: p.score?.total ?? 0,
        favs: p.fav_count ?? 0,
        rating: RATINGS[p.rating] || '?',
      });
    }
    return out;
  },

  // For "did you mean": returns { exact, names }
  async autocomplete(tag) {
    const lookup = async (term) => {
      const params = new URLSearchParams({ 'search[name_matches]': term, expiry: '7' });
      const res = await booru.request(`${BASE}/tags/autocomplete.json?${params}`, {
        label: 'e621',
        headers: headers(),
        gapMs: 700,
        timeout: 8000,
      });
      if (!res.ok) return [];
      const json = await res.json().catch(() => null);
      return Array.isArray(json) ? json : [];
    };

    let rows = await lookup(tag);
    const exact = rows.some((r) => r.name === tag || r.antecedent_name === tag);
    // Nothing starts with what was typed (typo?) → try just the first few letters
    if (!rows.length && tag.length > 4) rows = await lookup(tag.slice(0, 4));
    return { exact, names: rows.map((r) => r.name).filter(Boolean) };
  },

  embed: (p, i, n) =>
    new EmbedBuilder()
      .setColor(0x00549e)
      .setTitle((p.artists.length ? p.artists.join(', ') : `Post #${p.id}`).slice(0, 256))
      .setURL(`https://e621.net/posts/${p.id}`)
      .setImage(p.url)
      .setFooter({ text: `e621 #${p.id} · ${i + 1}/${n} · ▲ ${p.score} · ♥ ${p.favs} · ${p.rating}` }),

  videoText: (p, i, n) =>
    `**e621 #${p.id}** · ${i + 1}/${n} · ▲ ${p.score} · ♥ ${p.favs} · ${p.rating} · <https://e621.net/posts/${p.id}>\n${p.url}`,
});
