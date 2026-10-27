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
const INVADE_COST = 2500; // coins to force a foothold when the map is full
const INVADE_TROOPS = 15; // free troops placed if invade wins

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

function neutralProvinces() {
  return list().filter((p) => !data.owner[p.id]);
}

function mapIsFull() {
  return neutralProvinces().length === 0;
}

function claimAllCities(provinceId, houseId) {
  const prov = get(provinceId);
  if (!prov) return;
  for (const c of prov.cities || []) data.cityOwner[c.id] = houseId;
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
  if (!data.active || data.paused) return { error: 'Campaign is not running.' };
  const house = ensureHouse(guild);
  const from = resolveName(fromText);
  const to = resolveName(toText);
  if (!from || !to) return { error: 'Unknown province.' };
  if (!areNeighbors(from.id, to.id)) return { error: 'Only adjacent provinces.' };
  if (stackSize(from.id, house.id) < 1) return { error: 'No army in the origin province.' };
  if (data.owner[to.id] === house.id) return { error: 'You already hold that province.' };

  data.orders.push({
    id: `o${Date.now().toString(36)}`,
    type: 'attack',
    guildId: guild.id,
    houseId: house.id,
    userId,
    fromId: from.id,
    toId: to.id,
  });
  save();
  return {
    ok: true,
    from: from.name,
    to: to.name,
    power: stackSize(from.id, house.id),
  };
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

function resolveTick() {
  ensureSeason();
  if (!data.active || data.paused) return { skipped: true };

  const reports = [];

  // Moves
  for (const o of data.orders.filter((x) => x.type === 'move')) {
    if (!removeTroops(o.fromId, o.houseId, o.size)) continue;
    addTroops(o.toId, o.houseId, o.size);
    reports.push(
      `Move: **${data.houses[o.houseId]?.name}** ${o.size} → ${get(o.toId)?.name}`
    );
  }

  // Attacks (from adjacent land)
  for (const o of data.orders.filter((x) => x.type === 'attack')) {
    const result = resolveBattle(o.houseId, o.fromId, o.toId, stackSize(o.fromId, o.houseId));
    reports.push(result);
  }

  // Invades (off-map foothold)
  for (const o of data.orders.filter((x) => x.type === 'invade')) {
    const result = resolveInvade(o.houseId, o.toId, o.power || INVADE_TROOPS);
    reports.push(result);
  }

  data.orders = [];
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

function resolveBattle(houseId, fromId, toId, atkPower) {
  const atk = atkPower;
  if (atk < 1) return `Attack aborted (no troops).`;
  const defOwner = data.owner[toId];
  const def = defOwner
    ? (data.armies[toId] || []).reduce((s, a) => s + a.size, 0)
    : Math.max(5, Math.floor(atk * 0.15));

  const atkRoll = atk * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
  const defRoll = def * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
  const fromName = get(fromId)?.name || fromId;
  const toName = get(toId)?.name || toId;
  const atkHouse = data.houses[houseId]?.name || 'Attacker';
  const defHouse = defOwner ? data.houses[defOwner]?.name || 'Defender' : 'Neutral';

  if (atkRoll > defRoll) {
    const lossAtk = Math.min(atk - 1, Math.max(1, Math.round(def * 0.35)));
    removeTroops(fromId, houseId, lossAtk);
    data.armies[toId] = [];
    const survivors = Math.max(1, atk - lossAtk);
    removeTroops(fromId, houseId, survivors);
    claimAllCities(toId, houseId);
    addTroops(toId, houseId, survivors);
    if (data.houses[houseId]) data.houses[houseId].score += 3;
    pushLog(`${atkHouse} captured **${toName}**.`);
    return `Battle ${fromName}→${toName}: **${atkHouse}** took it from **${defHouse}** (lost ${lossAtk}).`;
  }

  const lossAtk = Math.min(atk, Math.max(1, Math.round(atk * 0.4)));
  removeTroops(fromId, houseId, lossAtk);
  pushLog(`${atkHouse} failed to take **${toName}**.`);
  return `Battle ${fromName}→${toName}: **${defHouse}** held vs **${atkHouse}** (attacker −${lossAtk}).`;
}

function resolveInvade(houseId, toId, power) {
  const toName = get(toId)?.name || toId;
  const atkHouse = data.houses[houseId]?.name || 'Invader';
  const defOwner = data.owner[toId];
  const def = defOwner
    ? (data.armies[toId] || []).reduce((s, a) => s + a.size, 0)
    : 8;
  const atkRoll = power * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
  const defRoll = def * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
  const defHouse = defOwner ? data.houses[defOwner]?.name || 'Defender' : 'Neutral';

  if (atkRoll > defRoll) {
    data.armies[toId] = [];
    claimAllCities(toId, houseId);
    addTroops(toId, houseId, Math.max(5, Math.floor(power * 0.6)));
    if (data.houses[houseId]) data.houses[houseId].score += 5;
    pushLog(`Invasion: **${atkHouse}** seized **${toName}**.`);
    return `Invasion of **${toName}**: **${atkHouse}** won vs **${defHouse}**.`;
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
    if (data.owner[p.id] !== house.id) continue;
    rows.push({ id: p.id, name: p.name, troops: stackSize(p.id, house.id) });
  }
  return { house, rows, mapFull: mapIsFull() };
}

function resetWorld() {
  data = blankState();
  data.active = true;
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
};
