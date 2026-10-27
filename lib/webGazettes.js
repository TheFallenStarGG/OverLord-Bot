const storage = require('./storage');
const { data: worldData } = require('./world');

function stripMentions(text) {
  return String(text || '')
    .replace(/<@!?\d+>/g, '@player')
    .replace(/<t:\d+:[a-zA-Z]>/g, '')
    .trim();
}

async function buildGazettes(client) {
  const editions = [];

  for (const guild of client.guilds.cache.values()) {
    await storage.runIn(guild.id, async () => {
      const ed = worldData.gazette?.latest;
      if (!ed || !ed.date) return;
      editions.push({
        guildId: guild.id,
        name: guild.name.slice(0, 80),
        icon: guild.iconURL({ extension: 'png', size: 64 }),
        date: ed.date,
        editorial: stripMentions(ed.editorial || '').slice(0, 1200),
        sections: (ed.sections || []).map((s) => ({
          name: String(s.name || '').slice(0, 80),
          value: stripMentions(s.value).slice(0, 800),
        })),
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
