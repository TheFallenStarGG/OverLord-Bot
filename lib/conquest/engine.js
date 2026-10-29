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

// The Shadow Court may never hold more than this share of all cities, and it
// stops attacking/mustering completely when no player has acted for a while.
const AI_MAX_CITY_SHARE = 0.25;
const AI_IDLE_MS = 24 * 60 * 60 * 1000;
const AI_MUSTER_CAP = 40; // troops it will stack in one city

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// city id -> { ...city, provinceId, provinceName }
const CITY_INFO = {};
for (const p of list()) {
  for (const c of p.cities || []) CITY_INFO[c.id] = { ...c, provinceId: p.id, provinceName: p.name };
}

function seasonKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function seasonNumber(key) {
  const cur = String(key || seasonKey());
  data.firstSeasonKey ??= cur;
  const parse = (k) => {
    const [y, m] = String(k).split('-').map(Number);
    return y && m ? y * 12 + m : 0;
  };
  const n = parse(cur) - parse(data.firstSeasonKey) + 1;
  return n > 0 ? n : 1;
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
    lastHumanAt: Date.now(),
    firstSeasonKey: seasonKey(),
  };
}

function load() {
  const raw = readJson(FILES.conquest, null);
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
  raw.firstSeasonKey ??= raw.seasonKey || seasonKey();
  raw.lastHumanAt ??= Date.now();
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

/** Called whenever a real player does something on the map. */
function touchActivity() {
  data.lastHumanAt = Date.now();
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

/** Allies fight and hold cities together, so they share one "side". */
function coalitionKey(houseId) {
  const ally = data.alliances?.[houseId];
  if (ally && data.alliances[ally] === houseId) return [houseId, ally].sort()[0];
  return houseId;
}

const isHostileTo = (attackerId, houseId) => houseId !== attackerId && !areAllied(attackerId, houseId);

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
  const was = other ? data.houses[other]?.name || null : null;
  if (other && data.alliances[other] === house.id) delete data.alliances[other];
  delete data.alliances[house.id];
  save();
  return { ok: true, was };
}

function houseOfGuild(guildId) {
  return data.houses[guildId] || null;
}

// ---------------------------------------------------------------- ownership

/** A province is controlled only when ONE house holds EVERY city in it. */
function syncProvinceOwner(provinceId) {
  const prov = get(provinceId);
  if (!prov?.cities?.length) return;
  const owners = prov.cities.map((c) => data.cityOwner[c.id] || null);
  const first = owners[0];
  data.owner[provinceId] = first && owners.every((o) => o === first) ? first : null;
}

function syncAllProvinces() {
  for (const p of list()) syncProvinceOwner(p.id);
}

function citiesOfHouse(houseId) {
  const out = [];
  for (const info of Object.values(CITY_INFO)) {
    if (data.cityOwner[info.id] === houseId) out.push({ ...info });
  }
  return out;
}

function houseOwnsAny(houseId) {
  return Object.values(data.cityOwner).some((h) => h === houseId);
}

function neutralCityCount() {
  return Object.values(CITY_INFO).filter((c) => !data.cityOwner[c.id]).length;
}

function neutralProvinces() {
  return list().filter((p) => !(p.cities || []).some((c) => data.cityOwner[c.id]));
}

function mapIsFull() {
  return neutralCityCount() === 0;
}

function resolveCityName(text) {
  const q = norm(text);
  if (!q) return null;
  const infos = Object.values(CITY_INFO);
  const hit =
    infos.find((c) => norm(c.id) === q || norm(c.name) === q) ||
    infos.find((c) => norm(c.name).includes(q) || (norm(c.name).length > 3 && q.includes(norm(c.name))));
  return hit ? { ...hit } : null;
}

/** "frostmere" -> province, "frost haven" -> city. Exact matches win over fuzzy ones. */
function resolveTarget(text) {
  const q = norm(text);
  if (!q) return null;
  const provExact = list().find((p) => p.id === q || norm(p.name) === q);
  if (provExact) return { prov: provExact };
  const cityExact = Object.values(CITY_INFO).find((c) => norm(c.id) === q || norm(c.name) === q);
  if (cityExact) return { city: { ...cityExact } };
  const provFuzzy = resolveName(text);
  if (provFuzzy) return { prov: provFuzzy };
  const cityFuzzy = resolveCityName(text);
  if (cityFuzzy) return { city: cityFuzzy };
  return null;
}

// ------------------------------------------------------------------- troops

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
  return cityIdsInProvince(provinceId).reduce((s, cid) => s + stackSizeCity(cid, houseId), 0);
}

/** Troops of the city's own garrison are not free to march: 1 always stays. */
function spareInCity(cityId, houseId) {
  const n = stackSizeCity(cityId, houseId);
  return Math.max(0, n - (data.cityOwner[cityId] === houseId ? 1 : 0));
}

/** Troops in a province that can leave without abandoning a city. */
function movable(provinceId, houseId) {
  return cityIdsInProvince(provinceId).reduce((s, cid) => s + spareInCity(cid, houseId), 0);
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
    .map((cid) => ({ cid, n: spareInCity(cid, houseId) }))
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

function hostileTroops(cityId, attackerId) {
  return (data.armies[cityId] || [])
    .filter((a) => isHostileTo(attackerId, a.houseId))
    .reduce((s, a) => s + a.size, 0);
}

/** Defenders lose troops (never the last one) when they beat off an attack. */
function bleedDefenders(cityId, attackerId, amount) {
  let need = Math.min(amount, Math.max(0, hostileTroops(cityId, attackerId) - 1));
  const rows = (data.armies[cityId] || [])
    .filter((a) => isHostileTo(attackerId, a.houseId))
    .sort((a, b) => b.size - a.size);
  for (const row of rows) {
    if (need <= 0) break;
    const take = Math.min(need, row.size - (row === rows[0] ? 1 : 0));
    if (take > 0) {
      row.size -= take;
      need -= take;
    }
  }
  data.armies[cityId] = (data.armies[cityId] || []).filter((a) => a.size > 0);
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
      const dest = cities.find((c) => data.cityOwner[c.id] === a.houseId) || cities[0];
      addTroops(dest.id, a.houseId, a.size);
    }
    delete data.armies[p.id];
  }
}

migrateProvinceArmiesToCities();

// ----------------------------------------------------------- city control

function cityDefense(cityId, attackerId) {
  let def = 8;
  if (data.cityOwner[cityId]) def += 6;
  def += (data.forts?.[cityId] || 0) * 5;
  def += hostileTroops(cityId, attackerId); // every defender counts
  return def;
}

/** Take a city: defenders are routed (wiped), the attacker's side stays. */
function captureCity(cityId, houseId) {
  data.armies[cityId] = (data.armies[cityId] || []).filter(
    (a) => a.houseId === houseId || areAllied(houseId, a.houseId)
  );
  data.cityOwner[cityId] = houseId;
  data.forts ??= {};
  data.forts[cityId] = 0;
  syncProvinceOwner(CITY_INFO[cityId].provinceId);
}

function releaseCity(cityId) {
  data.cityOwner[cityId] = null;
  data.armies[cityId] = (data.armies[cityId] || []).filter((a) => a.size > 0);
  data.forts ??= {};
  data.forts[cityId] = 0;
  syncProvinceOwner(CITY_INFO[cityId].provinceId);
}

/**
 * The single rule that decides who holds a city:
 *  - rival armies in the same city fight; the bigger side wins, the loser is
 *    wiped out and the winner bleeds (60% of the loser's strength),
 *  - the city belongs to the winning side (never to the side with fewer troops),
 *  - a city nobody garrisons is abandoned (neutral) — troops hold cities.
 */
function settleCity(cityId, reports) {
  const info = CITY_INFO[cityId];
  if (!info) return;
  const stacks = (data.armies[cityId] || []).filter((a) => a.size > 0);
  data.armies[cityId] = stacks;
  const owner = data.cityOwner[cityId] || null;

  if (!stacks.length) {
    if (owner) {
      const name = data.houses[owner]?.name || 'A house';
      releaseCity(cityId);
      pushLog(`**${name}** abandoned **${info.name}** (no garrison).`);
      reports.push(`**${name}** lost **${info.name}** — no troops left to hold it.`);
    }
    return;
  }

  const groups = new Map();
  for (const s of stacks) {
    const k = coalitionKey(s.houseId);
    const g = groups.get(k) || { key: k, total: 0, rows: [] };
    g.total += s.size;
    g.rows.push(s);
    groups.set(k, g);
  }
  const ordered = [...groups.values()].sort((a, b) => b.total - a.total);
  const ownerKey = owner ? coalitionKey(owner) : null;
  let winner = ordered[0];

  if (ordered.length > 1) {
    const tied = ordered.filter((g) => g.total === winner.total);
    if (tied.length > 1) {
      winner = tied.find((g) => g.key === ownerKey) || tied[Math.floor(Math.random() * tied.length)];
    }
    const losers = ordered.filter((g) => g !== winner);
    const loserTotal = losers.reduce((s, g) => s + g.total, 0);
    const loss = Math.min(winner.total - 1, Math.round(loserTotal * 0.6));
    const f = (winner.total - loss) / winner.total;
    for (const r of winner.rows) r.size = Math.max(1, Math.round(r.size * f));
    data.armies[cityId] = winner.rows.filter((r) => r.size > 0);

    const nameOf = (g) => data.houses[g.rows.slice().sort((a, b) => b.size - a.size)[0].houseId]?.name || 'Unknown';
    reports.push(
      `Battle at **${info.name}**: **${nameOf(winner)}** (${winner.total}) crushed ${losers
        .map((g) => `**${nameOf(g)}** (${g.total})`)
        .join(', ')}.`
    );
  }

  if (ownerKey === null || winner.key !== ownerKey) {
    const top = winner.rows.slice().sort((a, b) => b.size - a.size)[0].houseId;
    const oldName = owner ? data.houses[owner]?.name || 'its owner' : null;
    captureCity(cityId, top);
    if (data.houses[top]) data.houses[top].score = (data.houses[top].score || 0) + 2;
    const topName = data.houses[top]?.name || 'A house';
    pushLog(`**${topName}** took **${info.name}**${oldName ? ` from **${oldName}**` : ''} by force of arms.`);
  }
}

function settleAll(reports = []) {
  for (const id of Object.keys(CITY_INFO)) settleCity(id, reports);
  syncAllProvinces();
  return reports;
}

// ----------------------------------------------------------------- campaign

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

/**
 * Recruit into ONE city. Give a city name to choose it, or a province name to
 * reinforce your weakest city there (or claim its best neutral city).
 */
function recruit(guild, userId, targetText, amount) {
  if (!data.active || data.paused) {
    return { error: 'Campaign is not running. Bot owner: `!!campaign start`.' };
  }
  const house = ensureHouse(guild);
  const target = resolveTarget(targetText);
  if (!target) return { error: 'Unknown city or province. Check the map names.' };

  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n < 1 || n > MAX_RECRUIT_PER_TICK) {
    return { error: `Recruit 1–${MAX_RECRUIT_PER_TICK} troops.` };
  }

  let city = target.city || null;
  const prov = target.prov || get(city.provinceId);

  if (!city) {
    const all = (prov.cities || []).map((c) => ({ ...c, provinceId: prov.id }));
    const mine = all
      .filter((c) => data.cityOwner[c.id] === house.id)
      .sort((a, b) => stackSizeCity(a.id, house.id) - stackSizeCity(b.id, house.id));
    const neutral = all.filter((c) => !data.cityOwner[c.id]).sort((a, b) => (b.tax || 0) - (a.tax || 0));
    city = mine[0] || neutral[0] || null;
    if (!city) {
      return {
        error: `Every city in **${prov.name}** belongs to someone else. Use \`!!campaign siege\` to take one.`,
      };
    }
  }

  const holder = data.cityOwner[city.id] || null;
  if (holder && holder !== house.id) {
    return {
      error: `**${city.name}** belongs to **${data.houses[holder]?.name || 'another house'}**. Use siege to take it.`,
    };
  }

  if (!holder) {
    if (houseOwnsAny(house.id)) {
      const reachable = citiesOfHouse(house.id).some(
        (c) => c.provinceId === prov.id || areNeighbors(c.provinceId, prov.id)
      );
      if (!reachable) return { error: `**${city.name}** is not adjacent to your land.` };
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

  const claimed = !holder;
  if (claimed) {
    data.cityOwner[city.id] = house.id;
    data.forts ??= {};
    data.forts[city.id] = 0;
  }
  addTroops(city.id, house.id, n);
  syncProvinceOwner(prov.id);
  touchActivity();
  pushLog(`**${house.name}** recruited **${n}** in **${city.name}** (${prov.name}).`);
  save();

  const open = (prov.cities || [])
    .filter((c) => !data.cityOwner[c.id])
    .map((c) => c.name);

  return {
    ok: true,
    cost,
    size: n,
    province: prov.name,
    city: city.name,
    claimed,
    house: house.name,
    controlled: data.owner[prov.id] === house.id,
    open,
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

  const free = movable(from.id, house.id);
  if (free < n) {
    return {
      error: `You can move at most **${free}** troops out of **${from.name}** (one troop always stays to hold each city you own).`,
    };
  }
  if (!cityIdsInProvince(to.id).some((cid) => data.cityOwner[cid] === house.id)) {
    return {
      error: `You hold no city in **${to.name}**. Take one first with \`siege\` or \`recruit\`.`,
    };
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
  touchActivity();
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
  if (movable(from.id, house.id) < SIEGE_MIN_TROOPS) {
    return {
      error: `Need at least **${SIEGE_MIN_TROOPS}** free troops in **${from.name}** (one stays in each city you hold).`,
    };
  }
  const cities = (to.cities || []).filter((c) => data.cityOwner[c.id] !== house.id);
  if (!cities.length) return { error: `You already hold every city in **${to.name}**.` };

  if (cities.every((c) => areAllied(house.id, data.cityOwner[c.id]))) {
    return { error: 'Those cities belong to your ally. Use `!!campaign unally` first.' };
  }

  const target = cities.find((c) => !areAllied(house.id, data.cityOwner[c.id])) || cities[0];

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
  touchActivity();
  save();
  return {
    ok: true,
    from: from.name,
    to: to.name,
    city: target.name,
    power: movable(from.id, house.id),
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

  if (movable(from.id, house.id) < SIEGE_MIN_TROOPS) {
    return {
      error: `Need at least **${SIEGE_MIN_TROOPS}** free troops in **${from.name}** (one stays in each city you hold).`,
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
  touchActivity();
  save();
  return {
    ok: true,
    from: from.name,
    city: city.name,
    province: city.provinceName,
    power: movable(from.id, house.id),
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
  touchActivity();
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
  touchActivity();
  return { ok: true, amount, cities: cities.length, house: house.name };
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
  touchActivity();
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
  for (const info of Object.values(CITY_INFO)) {
    const hid = data.cityOwner[info.id];
    if (!hid || !data.houses[hid]) continue;
    byHouse[hid] = (byHouse[hid] || 0) + (info.tax || 15);
  }
  const lines = [];
  for (const [hid, amount] of Object.entries(byHouse)) {
    const h = data.houses[hid];
    h.treasury = (h.treasury || 0) + amount;
    if (!h.ai) lines.push(`**${h.name}** +${amount} tax (treasury ${h.treasury})`);
  }
  return lines;
}

// ----------------------------------------------------------------------- AI

const totalCities = () => Object.keys(CITY_INFO).length;
const aiCityCap = () => Math.max(3, Math.floor(totalCities() * AI_MAX_CITY_SHARE));
const humansIdle = () => Date.now() - (data.lastHumanAt || 0) > AI_IDLE_MS;

function ensureAI() {
  // Remove fake/duplicate Shadow Courts; keep only ai_shadow
  for (const [id, h] of Object.entries(data.houses || {})) {
    if (id === AI_HOUSE_ID) continue;
    const namedShadow =
      h?.ai === true ||
      String(h?.name || '').toLowerCase() === String(AI_HOUSE_NAME).toLowerCase();
    if (!namedShadow) continue;

    for (const [pid, hid] of Object.entries(data.owner || {})) {
      if (hid === id) data.owner[pid] = AI_HOUSE_ID;
    }
    for (const [cid, hid] of Object.entries(data.cityOwner || {})) {
      if (hid === id) data.cityOwner[cid] = AI_HOUSE_ID;
    }
    for (const [cid, arr] of Object.entries(data.armies || {})) {
      if (!Array.isArray(arr)) continue;
      for (const a of arr) {
        if (a.houseId === id) a.houseId = AI_HOUSE_ID;
      }
    }
    delete data.houses[id];
  }

  if (!data.houses[AI_HOUSE_ID]) {
    data.houses[AI_HOUSE_ID] = {
      id: AI_HOUSE_ID,
      name: AI_HOUSE_NAME,
      color: '#2c2c2c',
      score: 0,
      treasury: 0,
      ai: true,
    };
  } else {
    data.houses[AI_HOUSE_ID].name = AI_HOUSE_NAME;
    data.houses[AI_HOUSE_ID].ai = true;
  }
  if (!citiesOfHouse(AI_HOUSE_ID).length) {
const free = list().filter((p) => (p.cities || []).some((c) => !data.cityOwner[c.id]));
    const untouched = free.filter((p) => (p.cities || []).every((c) => !data.cityOwner[c.id]));
    const pool = untouched.length ? untouched : free;
    if (pool.length) {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const home = (pick.cities || [])
        .filter((c) => !data.cityOwner[c.id])
        .sort((a, b) => (b.tax || 0) - (a.tax || 0))[0];
      data.cityOwner[home.id] = AI_HOUSE_ID;
      addTroops(home.id, AI_HOUSE_ID, 25);
      syncProvinceOwner(pick.id);
      pushLog(`**${AI_HOUSE_NAME}** claimed **${home.name}**.`);
    }
  }
  save();
}

/** The Shadow Court never holds more than its share of the board. */
function enforceAICap(reports) {
  const cap = aiCityCap();
  const mine = citiesOfHouse(AI_HOUSE_ID);
  if (mine.length <= cap) return;
  const extras = mine
    .map((c) => ({ c, n: stackSizeCity(c.id, AI_HOUSE_ID) }))
    .sort((a, b) => a.n - b.n || (a.c.tax || 0) - (b.c.tax || 0))
    .slice(0, mine.length - cap);
  for (const { c } of extras) {
    data.armies[c.id] = (data.armies[c.id] || []).filter((a) => a.houseId !== AI_HOUSE_ID);
    releaseCity(c.id);
  }
  pushLog(`**${AI_HOUSE_NAME}** withdrew from **${extras.length}** cities.`);
  reports.push(`**${AI_HOUSE_NAME}** is overextended and withdrew from **${extras.length}** cities.`);
}

function aiAct() {
  ensureAI();
  const reports = [];
  enforceAICap(reports);

  const mine = citiesOfHouse(AI_HOUSE_ID);
  if (!mine.length) return reports;

  // Nobody has played for a while: the Court sits tight instead of
  // quietly swallowing the whole map.
  if (humansIdle()) return reports;

  const home = mine
    .map((c) => ({ c, n: stackSizeCity(c.id, AI_HOUSE_ID) }))
    .sort((a, b) => b.n - a.n)[0];
  if (home.n < AI_MUSTER_CAP) {
    addTroops(home.c.id, AI_HOUSE_ID, 8);
    reports.push(`**${AI_HOUSE_NAME}** mustered **8** troops in **${home.c.name}**.`);
  }

  if (mine.length >= aiCityCap() || Math.random() >= 0.55) return reports;

  const targets = [];
  for (const p of list()) {
    if (movable(p.id, AI_HOUSE_ID) < SIEGE_MIN_TROOPS) continue;
    for (const pid of [p.id, ...p.neighbors]) {
      for (const c of get(pid)?.cities || []) {
        if (data.cityOwner[c.id] !== AI_HOUSE_ID) targets.push({ fromId: p.id, toId: pid, cityId: c.id });
      }
    }
  }
  if (targets.length) {
    const t = targets[Math.floor(Math.random() * targets.length)];
    reports.push(resolveSiege({ houseId: AI_HOUSE_ID, ...t }));
  }
  return reports;
}

// ------------------------------------------------------------------- sieges

function resolveSiege(order) {
  const { houseId, fromId, cityId, toId } = order;
  const info = CITY_INFO[cityId];
  const cityName = info?.name || cityId;
  const fromName = get(fromId)?.name || fromId;
  const atkHouse = data.houses[houseId]?.name || 'Attacker';

  const defOwner = data.cityOwner[cityId] || null;
  if (defOwner === houseId) return `Siege of **${cityName}** cancelled (already yours).`;
  if (defOwner && areAllied(houseId, defOwner)) return `Siege of **${cityName}** cancelled (allied city).`;

  const power = movable(fromId, houseId);
  if (power < 1) return `Siege of **${cityName}** aborted (no free troops in ${fromName}).`;

  const def = cityDefense(cityId, houseId);
  const atkRoll = power * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
  const defRoll = def * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
  const defHouse = defOwner ? data.houses[defOwner]?.name || 'Defender' : 'Neutral garrison';

  if (atkRoll > defRoll) {
    const loss = Math.min(power - 1, Math.max(1, Math.round(def * 0.4)));
    removeTroopsFromProvince(fromId, houseId, loss);
    captureCity(cityId, houseId);

    const left = movable(fromId, houseId);
    const march = Math.min(left, Math.max(3, Math.floor(power * 0.3)));
    if (march > 0) {
      removeTroopsFromProvince(fromId, houseId, march);
      addTroops(cityId, houseId, march);
    }

    const provId = info?.provinceId || toId;
    const provTaken = data.owner[provId] === houseId;
    if (data.houses[houseId]) data.houses[houseId].score += provTaken ? 5 : 2;
    pushLog(
      `**${atkHouse}** took city **${cityName}**${
        provTaken ? ` and now controls **${get(provId)?.name}**` : ''
      }.`
    );
    return `Siege **${cityName}**: **${atkHouse}** won vs **${defHouse}** (−${loss} troops)${
      provTaken ? ' — province secured' : ''
    }.`;
  }

  const loss = Math.min(power, Math.max(1, Math.round(power * 0.35)));
  removeTroopsFromProvince(fromId, houseId, loss);
  bleedDefenders(cityId, houseId, Math.round(power * 0.3));
  pushLog(`**${atkHouse}** failed to take **${cityName}**.`);
  return `Siege **${cityName}**: **${defHouse}** held (−${loss} attackers).`;
}

function resolveInvade(houseId, toId, power) {
  const prov = get(toId);
  const toName = prov?.name || toId;
  const atkHouse = data.houses[houseId]?.name || 'Invader';
  const open = (prov?.cities || []).filter(
    (c) => data.cityOwner[c.id] !== houseId && !areAllied(houseId, data.cityOwner[c.id])
  );
  if (!open.length) return `Invasion of **${toName}**: no city left to take.`;
  const city = open[0];
  const defOwner = data.cityOwner[city.id];
  const def = cityDefense(city.id, houseId);
  const atkRoll = power * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
  const defRoll = def * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
  const defHouse = defOwner ? data.houses[defOwner]?.name || 'Defender' : 'Neutral';

  if (atkRoll > defRoll) {
    captureCity(city.id, houseId);
    addTroops(city.id, houseId, Math.max(5, Math.floor(power * 0.6)));
    if (data.houses[houseId]) data.houses[houseId].score += 3;
    pushLog(`Invasion: **${atkHouse}** took **${city.name}** in **${toName}**.`);
    return `Invasion: **${atkHouse}** seized city **${city.name}** (${toName}) from **${defHouse}**.`;
  }
  bleedDefenders(city.id, houseId, Math.round(power * 0.3));
  pushLog(`Invasion: **${atkHouse}** failed at **${toName}**.`);
  return `Invasion of **${toName}**: **${defHouse}** held vs **${atkHouse}**.`;
}

function resolveTick() {
  ensureSeason();
  if (!data.active || data.paused) return { skipped: true };
  ensureAI();

  const reports = [];

  for (const o of data.orders.filter((x) => x.type === 'move')) {
    const n = Math.min(o.size, movable(o.fromId, o.houseId));
    if (n < 1) {
      reports.push(`Move cancelled: no free troops left in **${get(o.fromId)?.name}**.`);
      continue;
    }
    const dest = cityIdsInProvince(o.toId)
      .filter((cid) => data.cityOwner[cid] === o.houseId)
      .sort((a, b) => stackSizeCity(a, o.houseId) - stackSizeCity(b, o.houseId))[0];
    if (!dest) {
      reports.push(`Move cancelled: **${data.houses[o.houseId]?.name}** no longer holds a city in **${get(o.toId)?.name}**.`);
      continue;
    }
    removeTroopsFromProvince(o.fromId, o.houseId, n);
    addTroops(dest, o.houseId, n);
    reports.push(
      `**${data.houses[o.houseId]?.name}** moved **${n}** ${get(o.fromId)?.name} → ${get(o.toId)?.name}.`
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
  settleAll(reports); // battles, abandoned cities, province control
  reports.push(...applyCityTaxes());

  data.turn += 1;
  data.nextTickAt = Date.now() + TICK_MS;

  for (const hid of Object.values(data.owner)) {
    if (hid && data.houses[hid]) data.houses[hid].score = (data.houses[hid].score || 0) + 1;
  }
  save();

  const holdings = [];
  for (const [pid, hid] of Object.entries(data.owner)) {
    if (!hid) continue;
    holdings.push(`${get(pid)?.name}: **${data.houses[hid]?.name}** (${stackSize(pid, hid)})`);
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

/**
 * Houses worth showing on map key / !!campaign list.
 * Drops: 0 score with no land/troops, left servers (if client given), duplicate AI junk.
 */
function visibleHouses(client) {
  ensureSeason();
  const out = [];
  const seen = new Set();

  for (const h of Object.values(data.houses || {})) {
    if (!h?.id || seen.has(h.id)) continue;

    // Only one AI row
    if (h.ai || h.id === AI_HOUSE_ID) {
      if (h.id !== AI_HOUSE_ID) continue;
      const hasFoot =
        Object.values(data.owner || {}).includes(AI_HOUSE_ID) ||
        citiesOfHouse(AI_HOUSE_ID).length > 0 ||
        Object.values(data.armies || {}).some((arr) =>
          (arr || []).some((a) => a.houseId === AI_HOUSE_ID)
        );
      if (!hasFoot) continue;
      seen.add(h.id);
      out.push(h);
      continue;
    }

    // Bot left this server → hide
    if (client && !client.guilds.cache.has(h.id)) continue;

    const score = h.score || 0;
    const ownsLand = Object.values(data.owner || {}).includes(h.id);
    const ownsCity = citiesOfHouse(h.id).length > 0;
    const hasTroops = Object.values(data.armies || {}).some((arr) =>
      (arr || []).some((a) => a.houseId === h.id && a.size > 0)
    );

    // No points and no presence on the map → hide
    if (score <= 0 && !ownsLand && !ownsCity && !hasTroops) continue;

    seen.add(h.id);
    out.push(h);
  }

  return out.sort((a, b) => (b.score || 0) - (a.score || 0));
}
      
function snapshot() {
  ensureSeason();
  return {
    visibleHouseIds: visibleHouses().map((h) => h.id),
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
    totalCities: totalCities(),
    claimedCities: totalCities() - neutralCityCount(),
    aiDormant: humansIdle(),
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

/** What `!!campaign me` shows: every province where the house holds a city or troops. */
function holdingsSummary(guildId) {
  const house = data.houses[guildId];
  if (!house) return { error: 'This server has no house yet. Run any campaign command first.' };
  const rows = [];
  for (const p of list()) {
    const cities = p.cities || [];
    const held = cities.filter((c) => data.cityOwner[c.id] === guildId);
    const troops = stackSize(p.id, guildId);
    if (!held.length && !troops) continue;
    rows.push({
      id: p.id,
      name: p.name,
      troops,
      citiesHeld: held.length,
      citiesTotal: cities.length,
      cityNames: held.map((c) => c.name),
      controlled: data.owner[p.id] === guildId,
    });
  }
  return { house, treasury: house.treasury || 0, rows, mapFull: mapIsFull() };
}

function resetWorld() {
  data = blankState();
  data.active = true;
  ensureAI();
  save();
  return data;
}

// Clean up any state left by the old "recruiting claims the whole province"
// rules: rival troops sharing a city fight, empty cities become neutral.
settleAll([]);
save();

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
  holdingsSummary,
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
  visibleHouses,
};
