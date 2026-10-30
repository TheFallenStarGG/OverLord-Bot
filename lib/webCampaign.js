const conquest = require('./conquest');
const { list } = require('./conquest/provinces');

function buildCampaign(client) {
  const snap = conquest.snapshot();
  const provinceList = list();
  const nameOf = (id) => snap.houses?.[id]?.name || id;

  // Same list the bot shows in Discord: no empty houses, no servers the bot has left
  const visible = conquest.visibleHouses(client);

  const houses = visible.map((h) => {
    const provinces = provinceList
      .filter((p) => snap.owner[p.id] === h.id)
      .map((p) => {
        const troops = (p.cities || []).reduce(
          (sum, c) =>
            sum +
            (snap.armies[c.id] || [])
              .filter((a) => a.houseId === h.id)
              .reduce((s, a) => s + a.size, 0),
          0
        );
        return { id: p.id, name: p.name, troops };
      });
    const cityCount = provinceList.reduce(
      (n, p) => n + (p.cities || []).filter((c) => snap.cityOwner?.[c.id] === h.id).length,
      0
    );
    return {
      id: h.id,
      name: h.name,
      color: h.color || null,
      score: h.score || 0,
      ai: Boolean(h.ai),
      stillInBot: h.ai ? true : Boolean(client.guilds.cache.get(h.id)),
      provinces,
      provinceCount: provinces.length,
      cityCount,
    };
  });

  houses.sort((a, b) => b.score - a.score || b.provinceCount - a.provinceCount);

  const provinces = provinceList.map((p) => {
    const ownerId = snap.owner[p.id] || null;
    const house = ownerId ? snap.houses[ownerId] : null;

    const cities = (p.cities || []).map((c) => {
      const cityOwnerId = snap.cityOwner?.[c.id] || null;
      return {
        id: c.id,
        name: c.name,
        tax: c.tax || 15,
        fort: snap.forts?.[c.id] || 0,
        ownerId: cityOwnerId,
        ownerName: cityOwnerId ? nameOf(cityOwnerId) : null,
        troops: (snap.armies[c.id] || [])
          .filter((a) => a.size > 0)
          .map((a) => ({ houseId: a.houseId, houseName: nameOf(a.houseId), size: a.size })),
      };
    });

    // Province totals per house (armies are stored per city)
    const totals = {};
    for (const c of cities) for (const t of c.troops) totals[t.houseId] = (totals[t.houseId] || 0) + t.size;
    const armies = Object.entries(totals).map(([houseId, size]) => ({
      houseId,
      houseName: nameOf(houseId),
      size,
    }));

    return {
      id: p.id,
      name: p.name,
      ownerId,
      ownerName: house?.name || null,
      ownerColor: house?.color || null,
      armies,
      cities,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    active: Boolean(snap.active),
    paused: Boolean(snap.paused),
    seasonKey: snap.seasonKey,
    seasonNumber: snap.seasonNumber ?? null,
    turn: snap.turn || 0,
    nextTickAt: snap.nextTickAt ? new Date(snap.nextTickAt).toISOString() : null,
    full: Boolean(snap.full),
    neutral: snap.neutral ?? provinces.filter((p) => !p.ownerId).length,
    totalCities: snap.totalCities ?? null,
    claimedCities: snap.claimedCities ?? null,
    aiDormant: Boolean(snap.aiDormant),
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
