const conquest = require('./conquest');
const { list } = require('./conquest/provinces');

function buildCampaign(client) {
  const snap = conquest.snapshot();
  const houses = Object.values(snap.houses || {}).map((h) => {
    const guild = client.guilds.cache.get(h.id);
    const provinces = list()
      .filter((p) => snap.owner[p.id] === h.id)
      .map((p) => {
        const troops = (snap.armies[p.id] || [])
          .filter((a) => a.houseId === h.id)
          .reduce((s, a) => s + a.size, 0);
        return { id: p.id, name: p.name, troops };
      });
    return {
      id: h.id,
      name: h.name,
      color: h.color || null,
      score: h.score || 0,
      stillInBot: Boolean(guild),
      provinces,
      provinceCount: provinces.length,
    };
  });

  houses.sort((a, b) => b.score - a.score || b.provinceCount - a.provinceCount);

  const provinces = list().map((p) => {
    const ownerId = snap.owner[p.id] || null;
    const house = ownerId ? snap.houses[ownerId] : null;
    const armies = (snap.armies[p.id] || []).map((a) => ({
      houseId: a.houseId,
      houseName: snap.houses[a.houseId]?.name || a.houseId,
      size: a.size,
    }));
    return {
      id: p.id,
      name: p.name,
      ownerId,
      ownerName: house?.name || null,
      ownerColor: house?.color || null,
      armies,
      cities: (p.cities || []).map((c) => ({
        id: c.id,
        name: c.name,
        ownerId: snap.cityOwner?.[c.id] || null,
        ownerName: snap.cityOwner?.[c.id]
          ? snap.houses[snap.cityOwner[c.id]]?.name || null
          : null,
      })),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    active: Boolean(snap.active),
    paused: Boolean(snap.paused),
    seasonKey: snap.seasonKey,
    turn: snap.turn || 0,
    nextTickAt: snap.nextTickAt ? new Date(snap.nextTickAt).toISOString() : null,
    full: Boolean(snap.full),
    neutral: snap.neutral ?? provinces.filter((p) => !p.ownerId).length,
    houseCount: houses.length,
    houses,
    provinces,
    log: (snap.log || []).slice(0, 15).map((e) => ({
      at: e.at ? new Date(e.at).toISOString() : null,
      text: String(e.text || '').replace(/\*\*/g, ''),
    })),
    mapImage: 'campaign-map.png',
  };
}

module.exports = { buildCampaign };
