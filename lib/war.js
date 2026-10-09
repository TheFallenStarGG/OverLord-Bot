const { FILES } = require('../config');
const { readJson, writeJson, allScoped } = require('./storage');
const { board, weekKey } = require('./seasons');

const MIN_CONTRIBUTORS = 3; // players a server needs to be ranked
const MIN_PROFIT = 100; // weekly profit a player needs to count as a contributor
const TOP_N = 5; // the best players that add up to the war score
const PRIZES = [2000, 1000, 500]; // coins for every contributor of the top 3 servers

// { week, history: [{ week, top: [{ guildId, name, score }] }], wins: { guildId: count } }
const state = readJson(FILES.war, {});
state.week ??= weekKey();
state.history ??= [];
state.wins ??= {};
const save = () => writeJson(FILES.war, state);
save();

function scoreGuild(data, key) {
  const contributors = board(data, 'w', 'wk', key).filter((e) => e.value >= MIN_PROFIT);
  return {
    score: contributors.slice(0, TOP_N).reduce((sum, e) => sum + e.value, 0),
    players: contributors.length,
    ids: contributors.map((e) => e.id),
  };
}

// Every ranked server for a given week, best first
function standingsFor(client, key) {
  const out = [];
  for (const { guildId, data } of allScoped('seasons')) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild || data.__meta?.warOut) continue;
    const s = scoreGuild(data, key);
    if (s.players < MIN_CONTRIBUTORS) continue;
    out.push({ guildId, name: guild.name, ...s });
  }
  return out.sort((a, b) => b.score - a.score);
}

// How one server is doing, ranked or not
function guildProgress(guildId, key) {
  const entry = allScoped('seasons').find((e) => e.guildId === guildId);
  return entry ? scoreGuild(entry.data, key) : { score: 0, players: 0, ids: [] };
}

module.exports = { MIN_CONTRIBUTORS, MIN_PROFIT, TOP_N, PRIZES, state, save, standingsFor, guildProgress };
