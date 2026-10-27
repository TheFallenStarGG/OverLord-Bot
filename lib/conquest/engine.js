const { FILES } = require('../../config');
const { readJson, writeJson } = require('../storage');
const { list, get, resolveName, areNeighbors } = require('./provinces');
const { renderMap, HOUSE_PALETTE } = require('./render');
const { seasonKey, seasonNumber } = require('../seasons');
const economy = require('../economy');

const TICK_MS = 6 * 60 * 60 * 1000;
const RECRUIT_COST = 40;
const MAX_RECRUIT_PER_TICK = 50;
const ATTACK_NOISE = 0.08;
const INVADE_COST = 2500;
const INVADE_TROOPS = 15;
const AI_HOUSE_ID = 'npc-shadow-court';
const AI_HOUSE_NAME = 'The Shadow Court';
const AI_COLOR = '#2b2b2b';
const FORT_COST = 80; // coins per fort level
const MAX_FORT = 3;
const SIEGE_MIN_TROOPS = 5;

function blankState() {
  const owner = {};
  const armies = {};
  const cityOwner = {};
  for (const p of list()) {
    owner[p.id] = null;
    armies[p.id] = [];
    for (const c of p.cities || []) cityOwner[c.id] = null;
  }
  return {
    active: false,
    paused: false,
    seasonKey: seasonKey(),
    turn: 0,
    nextTickAt: Date.now() + TICK_MS,
    // guildId -> { id, name, color, score }
    houses: {},
    // provinceId -> guildId (house id)
    owner,
    cityOwner,
    armies,
    orders: [],
    // per-server map channel / message
    channels: {},
    mapMessages: {},
    log: [],
    // wipe marker so old per-server saves are ignored
    global: true,
    version: 2,
    forts: {}, // cityId -> 0..MAX_FORT
  };
}

function load() {
  const raw = readJson(FILES.conquest, null);
  if (!raw || !raw.global || raw.version !== 2) {
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
  for (const p of list()) {
    if (!(p.id in raw.owner)) raw.owner[p.id] = null;
    if (!raw.armies[p.id]) raw.armies[p.id] = [];
    for (const c of p.cities || []) {
      if (!(c.id in raw.cityOwner)) raw.cityOwner[c.id] = null;
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
  if (!data.seasonKey) {
    data.seasonKey = key;
    save();
    return;
  }
  if (data.seasonKey === key) return;

  data.seasonKey = key;
  data.turn = 0;
  data.orders = [];
  for (const p of list()) {
    data.owner[p.id] = null;
    data.armies[p.id] = [];
    for (const c of p.cities || []) data.cityOwner[c.id] = null;
  }
  data.nextTickAt = Date.now() + TICK_MS;
  pushLog(`Season ${seasonNumber(key)} began — the world map was reset. Houses kept.`);
  save();
}

/** One house per Discord server; always named after the server. */
function ensureHouse(guild) {
  if (!guild?.id) return null;
  ensureSeason();
  const id = guild.id;
  const name = String(guild.name || 'Unknown Server').slice(0, 80);
  if (!data.houses[id]) {
    const n = Object.keys(data.houses).length;
    data.houses[id] = {
      id,
      name,
      color: HOUSE_PALETTE[n % HOUSE_PALETTE.length],
      score: 0,
    };
    pushLog(`House **${name}** entered the campaign.`);
  } else if (data.houses[id].name !== name) {
    data.houses[id].name = name;
  }
  save();
  return data.houses[id];
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
  const q = String(text || '').toLowerCase().replace(/\s+/g, '');
  if (!q) return null;
  for (const p of list()) {
    for (const c of p.cities || []) {
      const id = c.id.toLowerCase().replace(/\s+/g, '');
      const name = c.name.toLowerCase().replace(/\s+/g, '');
      if (id === q || name === q || name.includes(q) || id.includes(q)) {
        return { ...c, provinceId: p.id, provinceName: p.name };
      }
    }
  }
  return null;
}

function ensureAI() {
  if (!data.houses[AI_HOUSE_ID]) {
    data.houses[AI_HOUSE_ID] = {
      id: AI_HOUSE_ID,
      name: AI_HOUSE_NAME,
      color: AI_COLOR,
      score: 0,
      treasury: 0,
      ai: true,
    };
  }
  const hasLand = houseOwnsAny(AI_HOUSE_ID);
  if (!hasLand) {
    const neutrals = list().filter((p) => !data.owner[p.id]);
    const pool = neutrals.length ? neutrals : list();
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) {
      claimAllCities(pick.id, AI_HOUSE_ID);
      addTroops(pick.id, AI_HOUSE_ID, 25);
      pushLog(`**${AI_HOUSE_NAME}** seized **${pick.name}** as its seat.`);
    }
  }
  save();
}

function cityDefense(cityId, provinceId) {
  const fort = (data.forts && data.forts[cityId]) || 0;
  const owner = data.cityOwner[cityId];
  const garrison = owner ? stackSize(provinceId, owner) : 8;
  return Math.max(6, Math.floor(garrison * 0.35) + fort * 8);
}

function neutralProvinces() {
  return list().filter((p) => !data.owner[p.id]);
}

function mapIsFull() {
  return neutralProvinces().length === 0;
}

function claimAllCities(provinceId, houseId) {
  const prov = get(provinceId);
  if (!prov) return;
  for (const c of prov.cities || []) {
    data.cityOwner[c.id] = houseId;
    if (data.forts) data.forts[c.id] = 0;
  }
  data.owner[provinceId] = houseId;
}

function stackSize(provinceId, houseId) {
  return (data.armies[provinceId] || [])
    .filter((a) => a.houseId === houseId)
    .reduce((s, a) => s + a.size, 0);
}

function addTroops(provinceId, houseId, size) {
  const arr = (data.armies[provinceId] ??= []);
  const row = arr.find((a) => a.houseId === houseId);
  if (row) row.size += size;
  else arr.push({ houseId, size });
}

function removeTroops(provinceId, houseId, size) {
  const arr = data.armies[provinceId] || [];
  const row = arr.find((a) => a.houseId === houseId);
  if (!row || row.size < size) return false;
  row.size -= size;
  if (row.size <= 0) data.armies[provinceId] = arr.filter((a) => a !== row);
  return true;
}

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

  // Instant claim + cities + troops (fixes empty cityOwner wipe)
  claimAllCities(prov.id, house.id);
  addTroops(prov.id, house.id, n);
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
  if (from.id === to.id) return { error: 'Pick two different provinces.' };
  if (!areNeighbors(from.id, to.id)) return { error: 'Those provinces do not border each other.' };
  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n < 1) return { error: 'Invalid troop count.' };
  if (stackSize(from.id, house.id) < n) return { error: 'Not enough troops there.' };

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
  // Backward compatible: attack province → siege first enemy/neutral city there
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
  const target = cities[0];
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
  if (!from) return { error: 'Unknown origin province.' };
  if (!city) return { error: 'Unknown city. Use names from `!!campaign province <name>`.' };
  if (!areNeighbors(from.id, city.provinceId)) {
    return { error: `**${from.name}** does not border **${city.provinceName}**.` };
  }
  if (stackSize(from.id, house.id) < SIEGE_MIN_TROOPS) {
    return { error: `Need at least **${SIEGE_MIN_TROOPS}** troops in **${from.name}**.` };
  }
  if (data.cityOwner[city.id] === house.id) {
    return { error: `You already hold **${city.name}**.` };
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
  const house = ensureHouse(guild);
  const amount = Math.floor(house.treasury || 0);
  if (amount < 1) return { error: 'House treasury is empty. Taxes land each tick from cities you hold.' };
  house.treasury = 0;
  economy.addCoins(userId, amount);
  save();
  return { ok: true, amount, house: house.name };
}

/** Landless (or map-full) foothold: pay coins, fight for a province you need not border. */
function invade(guild, userId, provinceText) {
  if (!data.active || data.paused) return { error: 'Campaign is not running.' };
  const house = ensureHouse(guild);
  const prov = resolveName(provinceText);
  if (!prov) return { error: 'Unknown province.' };

  if (data.owner[prov.id] === house.id) {
    return { error: 'You already hold that province. Use recruit.' };
  }

  // Allow invade if landless, OR map is full and they still want a second front (landless only is cleaner)
  if (houseOwnsAny(house.id) && !mapIsFull()) {
    return { error: 'You already have land. Expand with recruit/attack on adjacent provinces.' };
  }
  if (houseOwnsAny(house.id) && mapIsFull()) {
    // has land but map full — normal attack only
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

function aiAct() {
  ensureAI();
  const reports = [];
  const owned = list().filter((p) => data.owner[p.id] === AI_HOUSE_ID);
  const anyCity = citiesOfHouse(AI_HOUSE_ID);
  if (!anyCity.length) {
    ensureAI();
    return reports;
  }

  // Reinforce capital-ish: biggest stack province
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
    addTroops(baseId, AI_HOUSE_ID, 8);
    reports.push(`**${AI_HOUSE_NAME}** mustered **8** troops in **${get(baseId)?.name}**.`);
  }

  // Siege an adjacent city we don't own
  const fromIds = list().filter((p) => stackSize(p.id, AI_HOUSE_ID) >= SIEGE_MIN_TROOPS).map((p) => p.id);
  const targets = [];
  for (const fromId of fromIds) {
    for (const n of get(fromId)?.neighbors || []) {
      const prov = get(n);
      for (const c of prov?.cities || []) {
        if (data.cityOwner[c.id] !== AI_HOUSE_ID) {
          targets.push({ fromId, toId: n, cityId: c.id, cityName: c.name });
        }
      }
    }
  }
  if (targets.length) {
    const t = targets[Math.floor(Math.random() * targets.length)];
    const result = resolveSiege({
      houseId: AI_HOUSE_ID,
      fromId: t.fromId,
      toId: t.toId,
      cityId: t.cityId,
    });
    reports.push(result);
  }
  return reports;
}

function resolveTick() {
  ensureSeason();
  if (!data.active || data.paused) return { skipped: true };
  ensureAI();

  const reports = [];

  for (const o of data.orders.filter((x) => x.type === 'move')) {
    if (!removeTroops(o.fromId, o.houseId, o.size)) continue;
    addTroops(o.toId, o.houseId, o.size);
    reports.push(`Move: **${data.houses[o.houseId]?.name}** ${o.size} → ${get(o.toId)?.name}`);
  }

  for (const o of data.orders.filter((x) => x.type === 'siege' || x.type === 'attack')) {
    if (o.type === 'attack' && !o.cityId) {
      const to = get(o.toId);
      const city = (to?.cities || []).find((c) => data.cityOwner[c.id] !== o.houseId);
      if (city) o.cityId = city.id;
    }
    if (o.cityId) reports.push(resolveSiege(o));
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
    const troops = (data.armies[pid] || []).reduce((s, a) => s + a.size, 0);
    holdings.push(`${get(pid)?.name}: **${data.houses[hid]?.name}** (${troops})`);
  }
  if (holdings.length) reports.push('**Map:** ' + holdings.join(' · '));

  return { skipped: false, turn: data.turn, reports };
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
    removeTroops(fromId, houseId, loss);
    data.cityOwner[cityId] = houseId;
    if (data.forts) data.forts[cityId] = 0;
    syncProvinceOwner(toId);
    const provTaken = data.owner[toId] === houseId;
    if (data.houses[houseId]) data.houses[houseId].score += provTaken ? 5 : 2;
    // Move some troops into the province
    const march = Math.min(stackSize(fromId, houseId), Math.max(3, Math.floor(power * 0.3)));
    if (march > 0) {
      removeTroops(fromId, houseId, march);
      addTroops(toId, houseId, march);
    }
    pushLog(`**${atkHouse}** took city **${cityName}**${provTaken ? ` and now controls **${get(toId)?.name}**` : ''}.`);
    return `Siege **${cityName}**: **${atkHouse}** won vs **${defHouse}** (−${loss} troops)${provTaken ? ' — province secured' : ''}.`;
  }

  const loss = Math.min(power, Math.max(1, Math.round(power * 0.35)));
  removeTroops(fromId, houseId, loss);
  pushLog(`**${atkHouse}** failed to take **${cityName}**.`);
  return `Siege **${cityName}**: **${defHouse}** held (−${loss} attackers).`;
}

function resolveInvade(houseId, toId, power) {
  // Invade captures ONE city only (foothold), not the whole province
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
    addTroops(toId, houseId, Math.max(5, Math.floor(power * 0.6)));
    if (data.houses[houseId]) data.houses[houseId].score += 3;
    pushLog(`Invasion: **${atkHouse}** took **${city.name}** in **${toName}**.`);
    return `Invasion: **${atkHouse}** seized city **${city.name}** (${toName}) from **${defHouse}**.`;
  }
  pushLog(`Invasion: **${atkHouse}** failed at **${toName}**.`);
  return `Invasion of **${toName}**: **${defHouse}** held vs **${atkHouse}**.`;
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
  };
}

function setChannel(guildId, channelId) {
  if (channelId) data.channels[guildId] = channelId;
  else delete data.channels[guildId];
  save();
}

function setMapMessageId(guildId, messageId) {
  if (messageId) data.mapMessages[guildId] = messageId;
  else delete data.mapMessages[guildId];
  save();
}

function holdingsOf(guildId) {
  const house = houseOfGuild(guildId);
  if (!house) return { error: 'This server is not on the map yet.' };
  const rows = [];
  for (const p of list()) {
    const mine = (p.cities || []).filter((c) => data.cityOwner[c.id] === house.id);
    if (!mine.length && data.owner[p.id] !== house.id) continue;
    rows.push({
      id: p.id,
      name: p.name,
      troops: stackSize(p.id, house.id),
      citiesHeld: mine.length,
      citiesTotal: (p.cities || []).length,
      controlled: data.owner[p.id] === house.id,
    });
  }
  return {
    house,
    rows,
    treasury: house.treasury || 0,
    mapFull: mapIsFull(),
    cities: citiesOfHouse(house.id),
  };
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
};
