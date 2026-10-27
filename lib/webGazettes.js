const storage = require('./storage');
const { data: worldData } = require('./world');

async function nameOf(client, id) {
  try {
    const u = client.users.cache.get(id) ?? (await client.users.fetch(id));
    return u.globalName || u.username;
  } catch {
    return 'someone';
  }
}

async function plain(client, text) {
  let out = String(text || '');
  const ids = [...out.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]);
  for (const id of new Set(ids)) {
    const n = await nameOf(client, id);
    out = out.replaceAll(`<@${id}>`, n).replaceAll(`<@!${id}>`, n);
  }
  return out
    .replace(/<t:\d+(?::[a-zA-Z])?>/g, '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s*[🪙💰]\uFE0F?/gu, ' coins')
    .replace(/\b(coins)(\s+coins)+\b/gi, '$1')
    .replace(/[█░]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ctx.guilds is already limited to servers that are listed on the website
async function buildGazettes(client, ctx, slugOf) {
  const editions = [];

  for (const guild of ctx.guilds) {
    await storage.runIn(guild.id, async () => {
      const ed = worldData.gazette?.latest;
      const web = worldData.gazette?.web;
      if (!ed || !ed.date) return;

      const sections = [];
      for (const s of ed.sections || []) {
        sections.push({
          name: (await plain(client, String(s.name || '').replace(/^[^\p{L}\p{N}]+/u, ''))).slice(0, 80),
          value: (await plain(client, s.value)).slice(0, 900),
        });
      }

      editions.push({
        slug: slugOf(guild.id),
        name: guild.name.slice(0, 80),
        icon: guild.iconURL({ extension: 'png', size: 64 }),
        date: web?.date || ed.date,
        image: web ? `gazette/${web.slug}.png` : null,
        imageV: web?.at || null,
        editorial: (await plain(client, ed.editorial || '')).slice(0, 1500),
        sections,
        richestName: ed.richestName || null,
      });
    });
  }

  editions.sort((a, b) => a.name.localeCompare(b.name));
  return { generatedAt: new Date().toISOString(), count: editions.length, editions };
}

module.exports = { buildGazettes };
