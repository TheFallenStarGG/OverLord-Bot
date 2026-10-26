const { FILES } = require('../../config');
const { scoped, writeJson, currentGuild } = require('../storage');
const { list, get, resolveName, areNeighbors, allCities, resolveCity, cityById } = require('./provinces');
const { renderMap, HOUSE_PALETTE } = require('./render');
const { seasonKey, seasonNumber, record } = require('../seasons');
const economy = require('../economy');

const TICK_MS = 6 * 60 * 60 * 1000; // 6 hours
const RECRUIT_COST = 40; // coins per troop
const MAX_RECRUIT_PER_TICK = 50;
const ATTACK_NOISE = 0.08; // ±8% public variance

const data = scoped(FILES.conquest, (d) => {
  d.active ??= false;
  d.paused ??= false;
  d.channelId ??= null;
  d.mapMessageId ??= null;
  d.seasonKey ??= seasonKey();
  d.turn ??= 0;
  d.nextTickAt ??= Date.now() + TICK_MS;
  d.houses ??= {}; // id -> { id, name, color, leaderId, members: [] }
  d.memberOf ??= {}; // userId -> houseId
  d.owner ??= {}; // provinceId -> houseId | null (all cities held by that house)
  d.cityOwner ??= {}; // cityId -> houseId | null
  d.armies ??= {}; // provinceId -> [{ houseId, size }]
  d.orders ??= []; // move/attack/siege until tick
  d.log ??= [];
  return d;
});

const save = () => writeJson(FILES.conquest, data);

function pushLog(text) {
  data.log.unshift({ at: Date.now(), text });
  if (data.log.length > 25) data.log.length = 25;
}

function ensureSeason() {
  const key = seasonKey();
  if (data.seasonKey === key) return;
  // New calendar season: soft reset ownership/armies, keep houses
  data.seasonKey = key;
  data.turn = 0;
  data.owner = {};
  data.armies = {};
  data.orders = [];
  data.cityOwner = {};
  for (const p of list()) {
    data.owner[p.id] = null;
    data.armies[p.id] = [];
  }
  data.nextTickAt = Date.now() + TICK_MS;
  pushLog(`Season ${seasonNumber(key)} began — the map was reset.`);
  save();
}

function startCampaign() {
  ensureSeason();
  data.active = true;
  data.paused = false;
  if (!Object.keys(data.owner).length) {
    for (const p of list()) {
      data.owner[p.id] = null;
      data.armies[p.id] = [];
    }
  }
  data.nextTickAt = Date.now() + TICK_MS;
  pushLog('Campaign started.');
  save();
  return data;
}

function pauseCampaign(on) {
  data.paused = Boolean(on);
  pushLog(data.paused ? 'Campaign paused.' : 'Campaign resumed.');
  save();
}

function houseOf(userId) {
  const hid = data.memberOf[userId];
  return hid ? data.houses[hid] : null;
}

function createHouse(userId, name) {
  ensureSeason();
  if (data.memberOf[userId]) return { error: 'You already belong to a house. Leave it first.' };
  const clean = String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
  if (clean.length < 2) return { error: 'House name must be at least 2 characters.' };
  const taken = Object.values(data.houses).some((h) => h.name.toLowerCase() === clean.toLowerCase());
  if (taken) return { error: 'That house name is taken.' };

  const id = `h${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const n = Object.keys(data.houses).length;
  data.houses[id] = {
    id,
    name: clean,
    color: HOUSE_PALETTE[n % HOUSE_PALETTE.length], // default; change with !!campaign color
    leaderId: userId,
    members: [userId],
    score: 0,
  };
  data.memberOf[userId] = id;
  pushLog(`House **${clean}** was founded.`);
  save();
  return { ok: true, house: data.houses[id] };
}

function joinHouse(userId, name) {
  ensureSeason();
  if (data.memberOf[userId]) return { error: 'You already belong to a house.' };
  const house = Object.values(data.houses).find((h) => h.name.toLowerCase() === String(name || '').trim().toLowerCase());
  if (!house) return { error: 'No house with that name. Create one with `!!campaign create <name>`.' };
  house.members.push(userId);
  data.memberOf[userId] = house.id;
  save();
  return { ok: true, house };
}

function leaveHouse(userId) {
  const hid = data.memberOf[userId];
  if (!hid) return { error: 'You are not in a house.' };
  const house = data.houses[hid];
  house.members = house.members.filter((id) => id !== userId);
  delete data.memberOf[userId];
  if (!house.members.length) {
    // Clear ownership/armies of empty house
    for (const pid of Object.keys(data.owner)) {
      if (data.owner[pid] === hid) data.owner[pid] = null;
    }
    for (const pid of Object.keys(data.armies)) {
      data.armies[pid] = (data.armies[pid] || []).filter((a) => a.houseId !== hid);
    }
    data.orders = data.orders.filter((o) => o.houseId !== hid);
    delete data.houses[hid];
    pushLog(`House **${house.name}** dissolved.`);
  } else if (house.leaderId === userId) {
    house.leaderId = house.members[0];
  }
  save();
  return { ok: true };
}

function setHouseColor(userId, colorText) {
  const house = houseOf(userId);
  if (!house) return { error: 'Join or create a house first.' };
  if (house.leaderId !== userId) return { error: 'Only the house leader can set the tint color.' };

  let hex = String(colorText || '').trim();
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return { error: 'Use a hex color like `#8b2942` or `2f5d8c`.' };
  }
  house.color = `#${hex.toLowerCase()}`;
  save();
  return { ok: true, color: house.color, name: house.name };
}

function stackSize(provinceId, houseId) {
  return (data.armies[provinceId] || []).filter((a) => a.houseId === houseId).reduce((s, a) => s + a.size, 0);
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

function claimCapitalIfNeeded(house) {
  // First house province claim: if house owns nothing, recruit also claims neutral land
  return !Object.values(data.owner).includes(house.id);
}

function queueOrder(order) {
  data.orders.push({ ...order, id: `o${Date.now().toString(36)}${Math.floor(Math.random() * 99)}` });
  save();
}

function syncProvinceOwner(provinceId) {
  const prov = get(provinceId);
  if (!prov?.cities?.length) return;
  const owners = prov.cities.map((c) => data.cityOwner[c.id] || null);
  const first = owners[0];
  if (first && owners.every((o) => o === first)) {
    data.owner[provinceId] = first;
  } else {
    data.owner[provinceId] = null; // contested or mixed
  }
}

function claimAllCities(provinceId, houseId) {
  const prov = get(provinceId);
  if (!prov?.cities) return;
  for (const c of prov.cities) data.cityOwner[c.id] = houseId;
  data.owner[provinceId] = houseId;
}

function recruit(userId, provinceText, amount) {
  if (!data.active || data.paused) return { error: 'The campaign is not running. An admin must `!!campaign start`.' };
  const house = houseOf(userId);
  if (!house) return { error: 'Join or create a house first: `!!campaign create <name>`.' };
  const prov = resolveName(provinceText);
  if (!prov) return { error: 'Unknown province. Try `!!campaign provinces`.' };
  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n < 1 || n > MAX_RECRUIT_PER_TICK) {
    return { error: `Recruit between 1 and ${MAX_RECRUIT_PER_TICK} troops.` };
  }

  const owner = data.owner[prov.id];
  if (owner && owner !== house.id) {
    return { error: 'Enemy province. Siege its cities with `!!campaign siege <city>` from an adjacent province.' };
  }

  // Expansion rules for neutral / contested land
  if (owner !== house.id) {
    const owned = Object.entries(data.owner)
      .filter(([, h]) => h === house.id)
      .map(([id]) => id);
    const isFirst = owned.length === 0;
    if (!isFirst && !owned.some((id) => areNeighbors(id, prov.id))) {
      return { error: 'You can only expand into **neutral** provinces that border land you fully control.' };
    }
    // Must be fully neutral (no enemy cities)
    const enemyCity = (prov.cities || []).some((c) => data.cityOwner[c.id] && data.cityOwner[c.id] !== house.id);
    if (enemyCity) {
      return { error: 'This province has enemy cities. Use `!!campaign siege <city>` to take them.' };
    }
  }

  const cost = n * RECRUIT_COST;
  if (economy.peekUser(userId).coins < cost) {
    return { error: `That costs **${cost}** coins. You don't have enough.` };
  }
  economy.spendCoins(userId, cost);

  // Instant: troops + full claim if neutral
  if (data.owner[prov.id] !== house.id) {
    claimAllCities(prov.id, house.id);
    pushLog(`**${house.name}** claimed **${prov.name}** (${(prov.cities || []).length} cities).`);
  }
  addTroops(prov.id, house.id, n);
  save();

  return {
    ok: true,
    instant: true,
    cost,
    size: n,
    province: prov.name,
    cities: (prov.cities || []).map((c) => c.name),
    owner: house.name,
  };
}

function move(userId, fromText, toText, amount) {
  if (!data.active || data.paused) return { error: 'The campaign is not running.' };
  const house = houseOf(userId);
  if (!house) return { error: 'Join or create a house first.' };
  const from = resolveName(fromText);
  const to = resolveName(toText);
  if (!from || !to) return { error: 'Unknown province.' };
  if (from.id === to.id) return { error: 'Pick two different provinces.' };
  if (!areNeighbors(from.id, to.id)) return { error: 'Those provinces do not border each other.' };
  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n < 1) return { error: 'Invalid troop count.' };
  if (stackSize(from.id, house.id) < n) return { error: 'You do not have that many troops there.' };
  queueOrder({ type: 'move', userId, houseId: house.id, fromId: from.id, toId: to.id, size: n });
  return { ok: true, from: from.name, to: to.name, size: n };
}

function attack(userId, fromText, toText) {
  if (!data.active || data.paused) return { error: 'The campaign is not running.' };
  const house = houseOf(userId);
  if (!house) return { error: 'Join or create a house first.' };
  const from = resolveName(fromText);
  const to = resolveName(toText);
  if (!from || !to) return { error: 'Unknown province.' };
  if (!areNeighbors(from.id, to.id)) return { error: 'You can only attack adjacent provinces.' };
  const atk = stackSize(from.id, house.id);
  if (atk < 1) return { error: 'You have no army in the origin province.' };
  const defOwner = data.owner[to.id];
  if (defOwner === house.id) return { error: 'You already hold that province. Move troops instead.' };
  queueOrder({ type: 'attack', userId, houseId: house.id, fromId: from.id, toId: to.id });
  return { ok: true, from: from.name, to: to.name, power: atk };
}

function cancelOrders(userId) {
  const before = data.orders.length;
  data.orders = data.orders.filter((o) => o.userId !== userId);
  save();
  return before - data.orders.length;
}

function listOrders(userId) {
  return data.orders.filter((o) => o.userId === userId);
}

function resolveTick(guildId) {
  ensureSeason();
  if (!data.active || data.paused) return { skipped: true };

  const reports = [];

  // 1) Recruits
  for (const o of data.orders.filter((x) => x.type === 'recruit')) {
    if (!data.owner[o.provinceId] || data.owner[o.provinceId] === o.houseId) {
      data.owner[o.provinceId] = o.houseId;
      addTroops(o.provinceId, o.houseId, o.size);
      const name = get(o.provinceId)?.name || o.provinceId;
      reports.push(`Recruit: House troops +${o.size} in ${name}.`);
    }
  }

  // 2) Moves
  for (const o of data.orders.filter((x) => x.type === 'move')) {
    if (!removeTroops(o.fromId, o.houseId, o.size)) continue;
    addTroops(o.toId, o.houseId, o.size);
    if (!data.owner[o.toId]) data.owner[o.toId] = o.houseId;
    reports.push(
      `Move: ${o.size} → ${get(o.toId)?.name || o.toId} from ${get(o.fromId)?.name || o.fromId}.`
    );
  }

  // 3) Attacks
  for (const o of data.orders.filter((x) => x.type === 'attack')) {
    const atk = stackSize(o.fromId, o.houseId);
    if (atk < 1) continue;
    const defOwner = data.owner[o.toId];
    const def = defOwner
      ? (data.armies[o.toId] || []).reduce((s, a) => s + a.size, 0)
      : Math.max(5, Math.floor(atk * 0.15)); // neutral militia

    const atkRoll = atk * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
    const defRoll = def * (1 + (Math.random() * 2 - 1) * ATTACK_NOISE);
    const fromName = get(o.fromId)?.name || o.fromId;
    const toName = get(o.toId)?.name || o.toId;
    const atkHouse = data.houses[o.houseId]?.name || 'Attacker';
    const defHouse = defOwner ? data.houses[defOwner]?.name || 'Defender' : 'Neutral militia';

    if (atkRoll > defRoll) {
      const lossAtk = Math.min(atk - 1, Math.max(1, Math.round(def * 0.35)));
      removeTroops(o.fromId, o.houseId, lossAtk);
      // Wipe defenders
      data.armies[o.toId] = [];
      const survivors = Math.max(1, atk - lossAtk);
      removeTroops(o.fromId, o.houseId, survivors);
      addTroops(o.toId, o.houseId, survivors);
      data.owner[o.toId] = o.houseId;
      if (data.houses[o.houseId]) data.houses[o.houseId].score = (data.houses[o.houseId].score || 0) + 3;
      // Season score for the commander
      try {
        record(guildId, o.userId, 150);
      } catch {}
      reports.push(
        `Battle ${fromName} → ${toName}: **${atkHouse}** took the field from **${defHouse}** (lost ${lossAtk}).`
      );
      pushLog(`${atkHouse} captured **${toName}**.`);
    } else {
      const lossAtk = Math.min(atk, Math.max(1, Math.round(atk * 0.4)));
      removeTroops(o.fromId, o.houseId, lossAtk);
      if (defOwner) {
        const lossDef = Math.min(def, Math.max(0, Math.round(atk * 0.2)));
        // proportionally strip defenders
        let left = lossDef;
        for (const row of data.armies[o.toId] || []) {
          const take = Math.min(row.size, left);
          row.size -= take;
          left -= take;
        }
        data.armies[o.toId] = (data.armies[o.toId] || []).filter((a) => a.size > 0);
      }
      reports.push(
        `Battle ${fromName} → ${toName}: **${defHouse}** held against **${atkHouse}** (attacker lost ${lossAtk}).`
      );
      pushLog(`${atkHouse} failed to take **${toName}**.`);
    }
  }

  data.orders = [];
  data.turn += 1;
  data.nextTickAt = Date.now() + TICK_MS;
  // Passive score: +1 per province per house
  for (const [pid, hid] of Object.entries(data.owner)) {
    if (hid && data.houses[hid]) data.houses[hid].score = (data.houses[hid].score || 0) + 1;
  }
  save();
  return { skipped: false, turn: data.turn, reports };
}

async function buildMapBuffer() {
  ensureSeason();
  return renderMap(data, {
    title: `Season ${seasonNumber(data.seasonKey)} · Turn ${data.turn}`,
    subtitle: data.paused ? 'Paused' : `Next resolve <t:${Math.floor(data.nextTickAt / 1000)}:R>`.replace(/<t:.*:R>/, () => {
      const mins = Math.max(0, Math.round((data.nextTickAt - Date.now()) / 60000));
      return mins >= 60 ? `Next in ~${Math.round(mins / 60)}h` : `Next in ~${mins}m`;
    }),
  });
}

function snapshot() {
  ensureSeason();
  return {
    active: data.active,
    paused: data.paused,
    channelId: data.channelId,
    mapMessageId: data.mapMessageId,
    seasonKey: data.seasonKey,
    turn: data.turn,
    nextTickAt: data.nextTickAt,
    houses: data.houses,
    memberOf: data.memberOf,
    owner: data.owner,
    armies: data.armies,
    orders: data.orders,
    log: data.log,
  };
}

function setChannel(id) {
  data.channelId = id || null;
  save();
}

function setMapMessageId(id) {
  data.mapMessageId = id || null;
  save();
}

module.exports = {
  TICK_MS,
  RECRUIT_COST,
  data,
  save,
  ensureSeason,
  startCampaign,
  pauseCampaign,
  houseOf,
  createHouse,
  joinHouse,
  leaveHouse,
  setHouseColor,
  recruit,
  move,
  attack,
  cancelOrders,
  listOrders,
  resolveTick,
  buildMapBuffer,
  snapshot,
  setChannel,
  setMapMessageId,
  resolveName,
  listProvinces: list,
  getProvince: get,
};
