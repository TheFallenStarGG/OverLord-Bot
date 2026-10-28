const { list, get, resolveName, areNeighbors } = require('./provinces');
const { renderMap } = require('./render');
const economy = require('../economy');
const { FILES } = require('../../config');
const { readJson, writeJson } = require('../storage');

const TICK_MS = 6 * 60 * 60 * 1000;
const RECRUIT_COST = 8;
const INVADE_COST = 120;
const INVADE_TROOPS = 18;
const MAX_RECRUIT_PER_TICK = 40;
const MAX_FORT = 3;
const FORT_COST = 40;
const AI_HOUSE_ID = 'ai_shadow';
const AI_HOUSE_NAME = 'The Shadow Court';
const ATTACK_NOISE = 0.18;
const SEASON_TOP_TREASURY = [800, 450, 250];
const SIEGE_MIN_TROOPS = 5;

function seasonKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function seasonNumber(key) {
  const [y, m] = String(key || '').split('-').map(Number);
  if (!y || !m) return 1;
  return (y - 2025) * 12 + m;
}

function blankState() {
  const owner = {};
  const armies = {};
  const cityOwner = {};
  for (const p of list()) {
    owner[p.id] = null;
    for (const c of p.cities || []) {
      cityOwner[c.id] = null;
      armies[c.id] = [];
    }
  }
  return {
    active: false,
    paused: false,
    seasonKey: seasonKey(),
    turn: 0,
    nextTickAt: Date.now() + TICK_MS,
    houses: {},
    owner,
    cityOwner,
    armies,
    orders: [],
    channels: {},
    mapMessages: {},
    log: [],
    version: 2,
    forts: {},
    alliances: {},
    lastSeason: null,
  };
}

function load() {
  const raw = readJson(FILES.conquest, null);
  if (!raw || !raw.global || raw.version !== 2) {
    // tolerate non-global shape if version 2 present
  }
  if (!raw || raw.version !== 2) {
    const fresh = blankState();
    writeJson(FILES.conquest, fresh);
    return fresh;
  }
  raw.houses ??= {};
  raw.owner ??= {};
  raw.cityOwner ??= {};
  raw.armies ??= {};
  raw.orders ??= [];
  raw.channels ??= {};
  raw.mapMessages ??= {};
  raw.forts ??= {};
  raw.log ??= [];
  raw.alliances ??= {};
  for (const p of list()) {
    if (!(p.id in raw.owner)) raw.owner[p.id] = null;
    for (const c of p.cities || []) {
      if (!(c.id in raw.cityOwner)) raw.cityOwner[c.id] = null;
      if (!Array.isArray(raw.armies[c.id])) raw.armies[c.id] = [];
    }
  }
  return raw;
}

let data = load();
const save = () => writeJson(FILES.conquest, data);

function pushLog(text) {
  data.log.unshift({ at: Date.now(), text });
  if (data.log.length > 30) data.log.length = 30;
}

function ensureSeason() {
  const key = seasonKey();
  if (data.seasonKey === key) return;

  // Podium awards before reset
  const ranked = Object.values(data.houses || {})
    .filter((h) => !h.ai)
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  const results = [];
  for (let i = 0; i < SEASON_TOP_TREASURY.length && i < ranked.length; i++) {
    const h = ranked[i];
    const prize = SEASON_TOP_TREASURY[i];
    h.treasury = (h.treasury || 0) + prize;
    results.push(`#${i + 1} ${h.name} (+${prize} treasury)`);
  }
  if (results.length) {
    pushLog(`Season ${seasonNumber(data.seasonKey)} ended. Podium: ${results.join(' · ')}`);
  }

  data.seasonKey = key;
  data.turn = 0;
  data.orders = [];
  data.alliances = {};
  for (const p of list()) {
    data.owner[p.id] = null;
    for (const c of p.cities || []) {
      data.cityOwner[c.id] = null;
      data.armies[c.id] = [];
    }
    delete data.armies[p.id];
    if (data.forts) {
      for (const c of p.cities || []) data.forts[c.id] = 0;
    }
  }
  for (const h of Object.values(data.houses || {})) {
    if (!h.ai) h.score = 0;
  }
  data.nextTickAt = Date.now() + TICK_MS;
  pushLog(`Season ${seasonNumber(key)} began — map reset. Houses kept.`);
  ensureAI();
  save();
}

function ensureHouse(guild) {
  ensureSeason();
  const id = guild.id;
  if (!data.houses[id]) {
    data.houses[id] = {
      id,
      name: guild.name || `Server ${id}`,
      color: '#6b8cae',
      score: 0,
      treasury: 0,
    };
    save();
  } else if (guild.name && data.houses[id].name !== guild.name) {
    data.houses[id].name = guild.name;
  }
  return data.houses[id];
}

function areAllied(a, b) {
  if (!a || !b || a === b) return false;
  data.alliances ??= {};
  return data.alliances[a] === b || data.alliances[b] === a;
}

function allyWith(guild, targetGuildId) {
  const house = ensureHouse(guild);
  const other = data.houses[targetGuildId];
  if (!other) return { error: 'That server has no house on the map yet.' };
  if (other.id === house.id) return { error: 'Cannot ally with yourself.' };
  if (other.ai) return { error: 'Cannot ally with the Shadow Court.' };
  data.alliances ??= {};
  const old = data.alliances[house.id];
  if (old && data.alliances[old] === house.id) delete data.alliances[old];
  data.alliances[house.id] = other.id;
  data.alliances[other.id] = house.id;
  save();
  return { ok: true, ally: other.name };
}

function clearAlly(guild) {
  const house = ensureHouse(guild);
  data.alliances ??= {};
  const other = data.alliances[house.id];
  if (other && data.alliances[other] === house.id) delete data.alliances[other];
  delete data.alliances[house.id];
  save();
  return { ok: true };
}

function houseOfGuild(guildId) {
  return data.houses[guildId] || null;
}

function houseOwnsAny(houseId) {
  return Object.values(data.owner).some((h) => h === houseId);
}

function syncProvinceOwner(provinceId) {
  const prov = get(provinceId);
  if (!prov?.cities?.length) return;
  const owners = prov.cities.map((c) => data.cityOwner[c.id] || null);
  const first = owners[0];
  if (first && owners.every((o) => o === first)) {
    data.owner[provinceId] = first;
  } else {
    data.owner[provinceId] = null;
  }
}

function citiesOfHouse(houseId) {
  const out = [];
  for (const p of list()) {
    for (const c of p.cities || []) {
      if (data.cityOwner[c.id] === houseId) out.push({ ...c, provinceId: p.id, provinceName: p.name });
    }
  }
  return out;
}

function resolveCityName(text) {
  const q = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!q) return null;
  for (const p of list()) {
    for (const c of p.cities || []) {
      const id = c.id.toLowerCase().replace(/[^a-z0-9]/g, '');
      const name = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (id === q || name === q || name.includes(q) || q.includes(name)) {
        return { ...c, provinceId: p.id, provinceName: p.name };
      }
    }
  }
  return null;
}

function claimAllCities(provinceId, houseId) {
  const p = get(provinceId);
  if (!p) return;
  for (const c of p.cities || []) data.cityOwner[c.id] = houseId;
  data.owner[provinceId] = houseId;
}

function neutralProvinces() {
  return list().filter((p) => !data.owner[p.id]);
}

function mapIsFull() {
  return neutralProvinces().length === 0;
}

function cityDefense(cityId, provinceId) {
  let def = 8;
  const owner = data.cityOwner[cityId];
  if (owner) def += 6;
  def += (data.forts?.[cityId] || 0) * 5;
  def += stackSizeCity(cityId, owner || 'none') * 0.5;
  return def;
}

function cityIdsInProvince(provinceId) {
  const p = get(provinceId);
  return (p?.cities || []).map((c) => c.id);
}

function stackSizeCity(cityId, houseId) {
  return (data.armies[cityId] || [])
    .filter((a) => a.houseId === houseId)
    .reduce((s, a) => s + a.size, 0);
}

function stackSize(provinceId, houseId) {
  return cityIdsInProvince(provinceId).reduce(
    (s, cid) => s + stackSizeCity(cid, houseId),
    0
  );
}

function addTroops(cityId, houseId, size) {
  if (!cityId || size <= 0) return;
  const arr = (data.armies[cityId] ??= []);
  const row = arr.find((a) => a.houseId === houseId);
  if (row) row.size += size;
  else arr.push({ houseId, size });
}

function removeTroops(cityId, houseId, size) {
  const arr = data.armies[cityId] || [];
  const row = arr.find((a) => a.houseId === houseId);
  if (!row || row.size < size) return false;
  row.size -= size;
  if (row.size <= 0) data.armies[cityId] = arr.filter((a) => a !== row);
  return true;
}

function removeTroopsFromProvince(provinceId, houseId, size) {
  let need = size;
  const cities = cityIdsInProvince(provinceId)
    .map((cid) => ({ cid, n: stackSizeCity(cid, houseId) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  for (const { cid, n } of cities) {
    if (need <= 0) break;
    const take = Math.min(n, need);
    removeTroops(cid, houseId, take);
    need -= take;
  }
  return need === 0;
}

function migrateProvinceArmiesToCities() {
  for (const p of list()) {
    const stacks = data.armies[p.id];
    if (!Array.isArray(stacks) || !stacks.length) continue;
    const cities = p.cities || [];
    if (!cities.length) {
      delete data.armies[p.id];
      continue;
    }
    for (const a of stacks) {
      const dest =
        cities.find((c) => data.cityOwner[c.id] === a.houseId) || cities[0];
      addTroops(dest.id, a.houseId, a.size);
    }
    delete data.armies[p.id];
  }
}

migrateProvinceArmiesToCities();

function startCampaign() {
  ensureSeason();
  data.active = true;
  ensureAI();
  data.paused = false;
  data.nextTickAt = Date.now() + TICK_MS;
  pushLog('Global campaign started.');
  save();
  return data;
}

function pauseCampaign(on) {
  data.paused = Boolean(on);
  pushLog(data.paused ? 'Campaign paused.' : 'Campaign resumed.');
  save();
}

function setHouseColor(guildId, colorText) {
  const house = houseOfGuild(guildId);
  if (!house) return { error: 'This server has no house yet. Run any campaign command here first.' };
  let hex = String(colorText || '').trim();
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return { error: 'Use a hex color like `#8b2942`.' };
  house.color = `#${hex.toLowerCase()}`;
  save();
  return { ok: true, color: house.color, name: house.name };
}

function recruit(guild, userId, provinceText, amount) {
  if (!data.active || data.paused) {
    return { error: 'Campaign is not running. Bot owner: `!!campaign start`.' };
  }
  const house = ensureHouse(guild);
  const prov = resolveName(provinceText);
  if (!prov) return { error: 'Unknown province. Check the map names.' };

  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n < 1 || n > MAX_RECRUIT_PER_TICK) {
    return { error: `Recruit 1–${MAX_RECRUIT_PER_TICK} troops.` };
  }

  const owner = data.owner[prov.id] || null;
  if (owner && owner !== house.id) {
    return {
      error: `**${prov.name}** belongs to **${data.houses[owner]?.name || 'another house'}**. Use attack/invade.`,
    };
  }

  if (!owner) {
    if (houseOwnsAny(house.id)) {
      const ownedIds = Object.entries(data.owner)
        .filter(([, h]) => h === house.id)
        .map(([id]) => id);
      if (!ownedIds.some((id) => areNeighbors(id, prov.id))) {
        return { error: `**${prov.name}** is not adjacent to your land.` };
      }
    } else if (mapIsFull()) {
      return {
        error:
          'The map is full and your server holds no land. Use `!!campaign invade <province>` for a foothold (costs coins, fights the holder).',
      };
    }
  }

  const cost = n * RECRUIT_COST;
  if (economy.peekUser(userId).coins < cost) {
    return { error: `Need **${cost}** coins.` };
  }
  economy.spendCoins(userId, cost);

  claimAllCities(prov.id, house.id);
  const homeCity =
    (prov.cities || []).find((c) => data.cityOwner[c.id] === house.id) ||
    (prov.cities || [])[0];
  if (homeCity) addTroops(homeCity.id, house.id, n);
  pushLog(`**${house.name}** recruited **${n}** in **${prov.name}**.`);
  save();

  return {
    ok: true,
    cost,
    size: n,
    province: prov.name,
    house: house.name,
  };
}

function move(guild, userId, fromText, toText, amount) {
  if (!data.active || data.paused) return { error: 'Campaign is not running.' };
  const house = ensureHouse(guild);
  const from = resolveName(fromText);
  const to = resolveName(toText);
  if (!from || !to) return { error: 'Unknown province.' };
  if (!areNeighbors(from.id, to.id)) return { error: 'Those provinces do not border each other.' };
  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n < 1) return { error: 'How many troops?' };
  if (stackSize(from.id, house.id) < n) {
    return { error: `You only have **${stackSize(from.id, house.id)}** troops in **${from.name}**.` };
  }
  data.orders.push({
    id: `o${Date.now().toString(36)}`,
    type: 'move',
    guildId: guild.id,
    houseId: house.id,
    userId,
    fromId: from.id,
    toId: to.id,
    size: n,
  });
  save();
  return { ok: true, from: from.name, to: to.name, size: n };
}

function attack(guild, userId, fromText, toText) {
  if (!data.active || data.paused) return { error: 'Campaign is not running.' };
  const house = ensureHouse(guild);
  const from = resolveName(fromText);
  const to = resolveName(toText);
  if (!from || !to) return { error: 'Unknown province.' };
  if (!areNeighbors(from.id, to.id)) return { error: 'Only adjacent provinces.' };
  if (stackSize(from.id, house.id) < SIEGE_MIN_TROOPS) {
    return { error: `Need at least **${SIEGE_MIN_TROOPS}** troops in **${from.name}**.` };
  }
  const cities = (to.cities || []).filter((c) => data.cityOwner[c.id] !== house.id);
  if (!cities.length) return { error: `You already hold every city in **${to.name}**.` };

  if (cities.every((c) => areAllied(house.id, data.cityOwner[c.id]))) {
    return { error: 'Those cities belong to your ally. Use `!!campaign unally` first.' };
  }

  const target =
    cities.find((c) => !areAllied(house.id, data.cityOwner[c.id])) || cities[0];

  data.orders.push({
    id: `o${Date.now().toString(36)}`,
    type: 'siege',
    guildId: guild.id,
    houseId: house.id,
    userId,
    fromId: from.id,
    toId: to.id,
    cityId: target.id,
  });
  save();
  return {
    ok: true,
    from: from.name,
    to: to.name,
    city: target.name,
    power: stackSize(from.id, house.id),
    note: 'Siege resolves on the next tick. Take every city to control the province.',
  };
}

function siege(guild, userId, fromText, cityText) {
  if (!data.active || data.paused) return { error: 'Campaign is not running.' };
  const house = ensureHouse(guild);
  const from = resolveName(fromText);
  const city = resolveCityName(cityText);
  if (!from) return { error: 'Unknown origin province (where your troops are).' };
  if (!city) return { error: 'Unknown city. Use names from `!!campaign province <name>`.' };

  if (from.id !== city.provinceId && !areNeighbors(from.id, city.provinceId)) {
    return {
      error: `**${from.name}** does not border **${city.provinceName}** (and it is not the same province).`,
    };
  }

  if (stackSize(from.id, house.id) < SIEGE_MIN_TROOPS) {
    return {
      error: `Need at least **${SIEGE_MIN_TROOPS}** troops in **${from.name}** (any of its cities).`,
    };
  }
  if (data.cityOwner[city.id] === house.id) {
    return { error: `You already hold **${city.name}**.` };
  }

  const defender = data.cityOwner[city.id];
  if (defender && areAllied(house.id, defender)) {
    return { error: `**${city.name}** is held by your ally. Use \`!!campaign unally\` first.` };
  }

  data.orders.push({
    id: `o${Date.now().toString(36)}`,
    type: 'siege',
    guildId: guild.id,
    houseId: house.id,
    userId,
    fromId: from.id,
    toId: city.provinceId,
    cityId: city.id,
  });
  save();
  return {
    ok: true,
    from: from.name,
    city: city.name,
    province: city.provinceName,
    power: stackSize(from.id, house.id),
  };
}

function fortify(guild, userId, cityText) {
  if (!data.active || data.paused) return { error: 'Campaign is not running.' };
  const house = ensureHouse(guild);
  const city = resolveCityName(cityText);
  if (!city) return { error: 'Unknown city.' };
  if (data.cityOwner[city.id] !== house.id) {
    return { error: `You must own **${city.name}** to fortify it.` };
  }
  data.forts ??= {};
  const lvl = data.forts[city.id] || 0;
  if (lvl >= MAX_FORT) return { error: `**${city.name}** is already at max fort (${MAX_FORT}).` };
  if (economy.peekUser(userId).coins < FORT_COST) {
    return { error: `Fortify costs **${FORT_COST}** coins.` };
  }
  economy.spendCoins(userId, FORT_COST);
  data.forts[city.id] = lvl + 1;
  pushLog(`**${house.name}** fortified **${city.name}** (level ${lvl + 1}).`);
  save();
  return { ok: true, city: city.name, level: lvl + 1, cost: FORT_COST };
}

function collectTax(guild, userId) {
  if (!data.active || data.paused) return { error: 'Campaign is not running.' };
  const house = ensureHouse(guild);
  const cities = citiesOfHouse(house.id);
  if (!cities.length) return { error: 'You hold no cities.' };
  let amount = 0;
  for (const c of cities) amount += c.tax || 15;
  amount = Math.floor(amount / 2);
  economy.addCoins(userId, amount);
  return { ok: true, amount, cities: cities.length };
}

function invade(guild, userId, provinceText) {
  if (!data.active || data.paused) return { error: 'Campaign is not running.' };
  const house = ensureHouse(guild);
  const prov = resolveName(provinceText);
  if (!prov) return { error: 'Unknown province.' };

  if (houseOwnsAny(house.id) && !mapIsFull()) {
    return { error: 'You already have land. Expand with recruit/attack on adjacent provinces.' };
  }
  if (houseOwnsAny(house.id) && mapIsFull()) {
    return { error: 'Use `!!campaign attack <from> <to>` from land you hold.' };
  }

  if (economy.peekUser(userId).coins < INVADE_COST) {
    return { error: `Invasion costs **${INVADE_COST}** coins.` };
  }
  economy.spendCoins(userId, INVADE_COST);

  data.orders.push({
    id: `o${Date.now().toString(36)}`,
    type: 'invade',
    guildId: guild.id,
    houseId: house.id,
    userId,
    toId: prov.id,
    power: INVADE_TROOPS,
  });
  save();
  pushLog(`**${house.name}** launched an invasion of **${prov.name}**.`);
  return { ok: true, province: prov.name, cost: INVADE_COST, power: INVADE_TROOPS };
}

function cancelOrders(guildId) {
  const before = data.orders.length;
  data.orders = data.orders.filter((o) => o.guildId !== guildId);
  save();
  return before - data.orders.length;
}

function listOrders(guildId) {
  return data.orders.filter((o) => o.guildId === guildId);
}

function applyCityTaxes() {
  const byHouse = {};
  for (const p of list()) {
    for (const c of p.cities || []) {
      const hid = data.cityOwner[c.id];
      if (!hid || !data.houses[hid]) continue;
      byHouse[hid] = (byHouse[hid] || 0) + (c.tax || 15);
    }
  }
  const lines = [];
  for (const [hid, amount] of Object.entries(byHouse)) {
    const h = data.houses[hid];
    h.treasury = (h.treasury || 0) + amount;
    if (!h.ai) lines.push(`**${h.name}** +${amount} tax (treasury ${h.treasury})`);
  }
  return lines;
}

function ensureAI() {
  if (!data.houses[AI_HOUSE_ID]) {
    data.houses[AI_HOUSE_ID] = {
      id: AI_HOUSE_ID,
      name: AI_HOUSE_NAME,
      color: '#2c2c2c',
      score: 0,
      treasury: 0,
      ai: true,
    };
  }
  const any = citiesOfHouse(AI_HOUSE_ID);
  if (!any.length) {
    const neutrals = list().filter((p) => !data.owner[p.id]);
    if (neutrals.length) {
      const pick = neutrals[Math.floor(Math.random() * neutrals.length)];
      claimAllCities(pick.id, AI_HOUSE_ID);
      const home =
        (pick.cities || []).find((c) => data.cityOwner[c.id] === AI_HOUSE_ID) ||
        (pick.cities || [])[0];
      if (home) addTroops(home.id, AI_HOUSE_ID, 25);
      pushLog(`**${AI_HOUSE_NAME}** claimed **${pick.name}**.`);
    }
  }
  save();
}

function aiAct() {
  ensureAI();
  const reports = [];
  const anyCity = citiesOfHouse(AI_HOUSE_ID);
  if (!anyCity.length) {
    ensureAI();
    return reports;
  }

  let baseId = anyCity[0].provinceId;
  let best = 0;
  for (const p of list()) {
    const n = stackSize(p.id, AI_HOUSE_ID);
    if (n > best) {
      best = n;
      baseId = p.id;
    }
  }
  if (best < 40) {
    const baseProv = get(baseId);
    const home =
      (baseProv?.cities || []).find((c) => data.cityOwner[c.id] === AI_HOUSE_ID) ||
      (baseProv?.cities || [])[0];
    if (home) addTroops(home.id, AI_HOUSE_ID, 8);
    reports.push(`**${AI_HOUSE_NAME}** mustered **8** troops in **${get(baseId)?.name}**.`);
  }

  const fromIds = list()
    .filter((p) => stackSize(p.id, AI_HOUSE_ID) >= SIEGE_MIN_TROOPS)
    .map((p) => p.id);
  const targets = [];
  for (const fromId of fromIds) {
    // same province enemy cities
    for (const c of get(fromId)?.cities || []) {
      if (data.cityOwner[c.id] !== AI_HOUSE_ID) {
        targets.push({ fromId, toId: fromId, cityId: c.id, cityName: c.name });
      }
    }
    for (const n of get(fromId)?.neighbors || []) {
      const prov = get(n);
      for (const c of prov?.cities || []) {
        if (data.cityOwner[c.id] !== AI_HOUSE_ID) {
          targets.push({ fromId, toId: n, cityId: c.id, cityName: c.name });
        }
      }
    }
  }
  if (targets.length && Math.random() < 0.55) {
    const t = targets[Math.floor(Math.random() * targets.length)];
    const result = resolveSiege({
      houseId: AI_HOUSE_ID,
      fromId: t.fromId,
      toId: t.toId,
      cityId: t.cityId,
    });
    reports.push(result);
  } else if (best < 50) {
    const baseProv = get(baseId);
    const home =
      (baseProv?.cities || []).find((c) => data.cityOwner[c.id] === AI_HOUSE_ID) ||
      (baseProv?.cities || [])[0];
    if (home) addTroops(home.id, AI_HOUSE_ID, 5);
    reports.push(`**${AI_HOUSE_NAME}** quietly mustered troops.`);
  }
  return reports;
}

function resolveSiege(order) {
  const { houseId, fromId, cityId, toId } = order;
  const city = (get(toId)?.cities || []).find((c) => c.id === cityId);
  const cityName = city?.name || cityId;
  const fromName = get(fromId)?.name || fromId;
  const atkHouse = data.houses[houseId]?.name || 'Attacker';
  const power = stackSize(fromId, houseId);
  if (power < 1) return `Siege of **${cityName}** aborted (no troops in ${fromName}).`;

  const defOwner = data.cityOwner[cityId] || null;
  const def = cityDefense(cityId, toId);
  const atkRoll = power * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
  const defRoll = def * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
  const defHouse = defOwner ? data.houses[defOwner]?.name || 'Defender' : 'Neutral garrison';

  if (atkRoll > defRoll) {
    const loss = Math.min(power - 1, Math.max(1, Math.round(def * 0.4)));
    removeTroopsFromProvince(fromId, houseId, loss);
    data.cityOwner[cityId] = houseId;
    if (data.forts) data.forts[cityId] = 0;
    syncProvinceOwner(toId);
    const provTaken = data.owner[toId] === houseId;
    if (data.houses[houseId]) data.houses[houseId].score += provTaken ? 5 : 2;

    const march = Math.min(
      stackSize(fromId, houseId),
      Math.max(3, Math.floor(power * 0.3))
    );
    if (march > 0) {
      removeTroopsFromProvince(fromId, houseId, march);
      addTroops(cityId, houseId, march);
    }
    pushLog(
      `**${atkHouse}** took city **${cityName}**${
        provTaken ? ` and now controls **${get(toId)?.name}**` : ''
      }.`
    );
    return `Siege **${cityName}**: **${atkHouse}** won vs **${defHouse}** (−${loss} troops)${
      provTaken ? ' — province secured' : ''
    }.`;
  }

  const loss = Math.min(power, Math.max(1, Math.round(power * 0.35)));
  removeTroopsFromProvince(fromId, houseId, loss);
  pushLog(`**${atkHouse}** failed to take **${cityName}**.`);
  return `Siege **${cityName}**: **${defHouse}** held (−${loss} attackers).`;
}

function resolveInvade(houseId, toId, power) {
  const prov = get(toId);
  const toName = prov?.name || toId;
  const atkHouse = data.houses[houseId]?.name || 'Invader';
  const open = (prov?.cities || []).filter((c) => data.cityOwner[c.id] !== houseId);
  if (!open.length) return `Invasion of **${toName}**: no city left to take.`;
  const city = open[0];
  const defOwner = data.cityOwner[city.id];
  const def = cityDefense(city.id, toId);
  const atkRoll = power * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
  const defRoll = def * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
  const defHouse = defOwner ? data.houses[defOwner]?.name || 'Defender' : 'Neutral';

  if (atkRoll > defRoll) {
    data.cityOwner[city.id] = houseId;
    if (data.forts) data.forts[city.id] = 0;
    syncProvinceOwner(toId);
    addTroops(city.id, houseId, Math.max(5, Math.floor(power * 0.6)));
    if (data.houses[houseId]) data.houses[houseId].score += 3;
    pushLog(`Invasion: **${atkHouse}** took **${city.name}** in **${toName}**.`);
    return `Invasion: **${atkHouse}** seized city **${city.name}** (${toName}) from **${defHouse}**.`;
  }
  pushLog(`Invasion: **${atkHouse}** failed at **${toName}**.`);
  return `Invasion of **${toName}**: **${defHouse}** held vs **${atkHouse}**.`;
}

function resolveTick() {
  ensureSeason();
  if (!data.active || data.paused) return { skipped: true };
  ensureAI();

  const reports = [];

  for (const o of data.orders.filter((x) => x.type === 'move')) {
    if (!removeTroopsFromProvince(o.fromId, o.houseId, o.size)) continue;
    const destProv = get(o.toId);
    const destCity =
      (destProv?.cities || []).find((c) => data.cityOwner[c.id] === o.houseId) ||
      (destProv?.cities || [])[0];
    if (destCity) addTroops(destCity.id, o.houseId, o.size);
    reports.push(
      `**${data.houses[o.houseId]?.name}** moved **${o.size}** ${get(o.fromId)?.name} → ${get(o.toId)?.name}.`
    );
  }

  for (const o of data.orders.filter((x) => x.type === 'siege' || x.type === 'attack')) {
    reports.push(resolveSiege(o));
  }

  for (const o of data.orders.filter((x) => x.type === 'invade')) {
    reports.push(resolveInvade(o.houseId, o.toId, o.power || INVADE_TROOPS));
  }

  data.orders = [];

  reports.push(...aiAct());
  reports.push(...applyCityTaxes());

  data.turn += 1;
  data.nextTickAt = Date.now() + TICK_MS;

  for (const [pid, hid] of Object.entries(data.owner)) {
    if (hid && data.houses[hid]) data.houses[hid].score = (data.houses[hid].score || 0) + 1;
  }
  save();

  const holdings = [];
  for (const [pid, hid] of Object.entries(data.owner)) {
    if (!hid) continue;
    const troops = cityIdsInProvince(pid).reduce(
      (s, cid) => s + (data.armies[cid] || []).reduce((t, a) => t + a.size, 0),
      0
    );
    holdings.push(`${get(pid)?.name}: **${data.houses[hid]?.name}** (${troops})`);
  }
  if (holdings.length) reports.push('**Map:** ' + holdings.join(' · '));

  return { skipped: false, turn: data.turn, reports };
}

async function buildMapBuffer() {
  ensureSeason();
  const mins = Math.max(0, Math.round((data.nextTickAt - Date.now()) / 60000));
  const subtitle = data.paused
    ? 'Paused'
    : mins >= 60
      ? `Next in ~${Math.round(mins / 60)}h`
      : `Next in ~${mins}m`;
  return renderMap(data, {
    title: `World · Season ${seasonNumber(data.seasonKey)} · Turn ${data.turn}`,
    subtitle,
  });
}

function snapshot() {
  ensureSeason();
  return {
    active: data.active,
    paused: data.paused,
    seasonKey: data.seasonKey,
    turn: data.turn,
    nextTickAt: data.nextTickAt,
    houses: data.houses,
    owner: data.owner,
    cityOwner: data.cityOwner,
    forts: data.forts || {},
    armies: data.armies,
    orders: data.orders,
    channels: data.channels,
    mapMessages: data.mapMessages,
    log: data.log,
    full: mapIsFull(),
    neutral: neutralProvinces().length,
    alliances: data.alliances || {},
  };
}

function setChannel(guildId, channelId) {
  data.channels[guildId] = channelId;
  save();
}

function setMapMessageId(guildId, messageId) {
  data.mapMessages[guildId] = messageId;
  save();
}

function holdingsOf(houseId) {
  return list()
    .filter((p) => data.owner[p.id] === houseId)
    .map((p) => ({
      id: p.id,
      name: p.name,
      troops: stackSize(p.id, houseId),
      cities: (p.cities || []).filter((c) => data.cityOwner[c.id] === houseId).map((c) => c.name),
    }));
}

function resetWorld() {
  data = blankState();
  data.active = true;
  ensureAI();
  save();
  return data;
}

module.exports = {
  TICK_MS,
  RECRUIT_COST,
  INVADE_COST,
  data,
  save,
  ensureSeason,
  ensureHouse,
  startCampaign,
  pauseCampaign,
  setHouseColor,
  recruit,
  move,
  attack,
  invade,
  cancelOrders,
  listOrders,
  resolveTick,
  buildMapBuffer,
  snapshot,
  setChannel,
  setMapMessageId,
  holdingsOf,
  houseOfGuild,
  houseOwnsAny,
  mapIsFull,
  resetWorld,
  resolveName,
  listProvinces: list,
  getProvince: get,
  siege,
  fortify,
  collectTax,
  ensureAI,
  AI_HOUSE_ID,
  resolveCityName,
  citiesOfHouse,
  allyWith,
  clearAlly,
  areAllied,
  stackSizeCity,
  cityIdsInProvince,
  removeTroopsFromProvince,
  migrateProvinceArmiesToCities,
};
