const storage = require('./storage');
const { data: worldData } = require('./world');

async function nameOf(client, id) {
  try {
    const u = await client.users.fetch(id);
    return u.username;
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
    .replace(/<t:\d+:[a-zA-Z]>/g, '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[🪙💰]/g, ' coins')
    .replace(/[█░]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function buildGazettes(client) {
  const editions = [];

  for (const guild of client.guilds.cache.values()) {
    await storage.runIn(guild.id, async () => {
      const ed = worldData.gazette?.latest;
      if (!ed || !ed.date) return;

      const sections = [];
      for (const s of ed.sections || []) {
        sections.push({
          name: (await plain(client, s.name)).slice(0, 80),
          value: (await plain(client, s.value)).slice(0, 900),
        });
      }

      editions.push({
        guildId: guild.id,
        name: guild.name.slice(0, 80),
        icon: guild.iconURL({ extension: 'png', size: 64 }),
        date: ed.date,
        editorial: (await plain(client, ed.editorial || '')).slice(0, 1500),
        sections,
        richestName: ed.richestName || null,
      });
    });
  }

  editions.sort((a, b) => a.name.localeCompare(b.name));
  return {
    generatedAt: new Date().toISOString(),
    count: editions.length,
    editions,
  };
}

module.exports = { buildGazettes };
