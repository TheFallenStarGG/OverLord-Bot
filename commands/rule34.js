const { EmbedBuilder } = require('discord.js');
const booru = require('../lib/booru');

const BASE = 'https://api.rule34.xxx/index.php';

// rule34 REQUIRES an account API key + user ID (set these as env variables on your host)
const R34_API_KEY = process.env.R34_API_KEY;
const R34_USER_ID = process.env.R34_USER_ID;
const UA = 'OverLorderBot/1.0 (Discord bot; github.com/TheFallenStarGG/OverLorder-Bot)';

function extOf(url) {
  const clean = String(url).split('?')[0];
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}

module.exports = booru.createTagBooru({
  key: 'rule34',
  name: '!!rule34',
  aliases: ['!!r34'],
  label: 'rule34',
  usage: '!!rule34 <tags...> [count] [gallery]',
  description: 'Owner/allowlist only. Pull posts from rule34 using tag searches.',
  examples: ['!!rule34 some_tag another_tag 10', '!!rule34 some_tag score:>100 sort:score 5', '!!rule34 some_tag -unwanted_tag rating:explicit 8 gallery'],
  tips:
    '`-tag` excludes a tag, `rating:safe/questionable/explicit` filters by rating. ' +
    'Posts come back in random order unless you add your own `sort:` tag.',
  orderTag: 'sort:random',
  orderPrefix: 'sort:',
  maxLimit: 200,

  precheck() {
    if (!R34_API_KEY || !R34_USER_ID) {
      return 'rule34 needs an API key. Set the `R34_API_KEY` and `R34_USER_ID` env variables on the host, then restart the bot.';
    }
    return null;
  },

  async fetch(tags, limit) {
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

    const res = await booru.request(`${BASE}?${params}`, {
      label: 'rule34',
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      gapMs: 1000, // be polite: at most 1 request per second
    });

    const text = (await res.text()).trim();

    if (res.status === 401 || res.status === 403) {
      throw new Error('rule34 refused the request. Check R34_API_KEY and R34_USER_ID (or the bot’s host may be blocked).');
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
    if (!Array.isArray(json)) throw new Error(json?.message || json?.error || 'rule34 rejected that search.');

    const out = [];
    for (const p of json) {
      if (!p || !p.id || !p.file_url) continue;
      let url = p.file_url;
      if (url.startsWith('//')) url = `https:${url}`;
      const kind = booru.kindFromExt(extOf(url));
      if (!kind) continue; // not an image or video

      const rating = String(p.rating || '?');
      out.push({
        id: p.id,
        url,
        isVideo: kind === 'video',
        tags: String(p.tags || '').split(/\s+/).filter(Boolean),
        score: p.score ?? 0,
        rating: rating.charAt(0).toUpperCase() + rating.slice(1),
      });
    }
    return out;
  },

  // For "did you mean": returns { exact, names }. Best effort; if it fails, the command still works.
  async autocomplete(tag) {
    const parse = (json) =>
      Array.isArray(json)
        ? json
            .map((it) =>
              typeof it === 'string' ? it : String(it.value ?? it.name ?? it.label ?? '').replace(/\s*\(\d+\)\s*$/, '')
            )
            .filter(Boolean)
        : null;

    const lookup = async (term) => {
      const attempts = [
        { url: `https://api.rule34.xxx/autocomplete.php?${new URLSearchParams({ q: term })}`, headers: {} },
        {
          url: `https://rule34.xxx/public/autocomplete.php?${new URLSearchParams({ q: term })}`,
          headers: { Referer: 'https://rule34.xxx/' },
        },
      ];
      for (const a of attempts) {
        try {
          const res = await booru.request(a.url, {
            label: 'rule34',
            headers: { 'User-Agent': UA, Accept: 'application/json', ...a.headers },
            gapMs: 1000,
            timeout: 8000,
          });
          if (!res.ok) continue;
          const names = parse(await res.json().catch(() => null));
          if (names) return names;
        } catch {
          /* try the next one */
        }
      }
      return null;
    };

    let names = await lookup(tag);
    if (names === null) throw new Error('rule34 autocomplete is not available.');
    const exact = names.includes(tag);
    if (!names.length && tag.length > 4) names = (await lookup(tag.slice(0, 4))) || [];
    return { exact, names };
  },

  embed: (p, i, n) =>
    new EmbedBuilder()
      .setColor(0xaae5a4)
      .setTitle(`Post #${p.id}`)
      .setURL(`https://rule34.xxx/index.php?page=post&s=view&id=${p.id}`)
      .setImage(p.url)
      .setFooter({ text: `rule34 #${p.id} · ${i + 1}/${n} · ▲ ${p.score} · ${p.rating}` }),

  videoText: (p, i, n) =>
    `**rule34 #${p.id}** · ${i + 1}/${n} · ▲ ${p.score} · ${p.rating} · <https://rule34.xxx/index.php?page=post&s=view&id=${p.id}>\n${p.url}`,
});
