const { EmbedBuilder } = require('discord.js');
const { FILES } = require('../config');
const { addCoins, fmt } = require('./economy');
const { scoped, writeJson } = require('./storage');

// Which games are ranked: [emoji, name]
const GAMES = { duel: ['⚔️', 'Duel'], c4: ['🔴', 'Connect Four'], bs: ['🚢', 'Battleship'] };
const ALIASES = { duel: 'duel', c4: 'c4', connect4: 'c4', connect: 'c4', bs: 'bs', battleship: 'bs' };

const K = 32; // how much a single result can move your rating
const SEASON_REWARDS = [1000, 600, 300]; // coins for 1st, 2nd, 3rd at the end of each season
const MIN_GAMES_FOR_REWARD = 5;
const MAX_PAIR_GAMES_PER_DAY = 5; // beating the same person more than this in a day doesn't count

const seasonKey = () => new Date().toISOString().slice(0, 7); // like 2026-10
const todayKey = () => new Date().toISOString().slice(0, 10);

const data = scoped(FILES.ranked, (d) => {
  d.season ??= seasonKey();
  d.games ??= { duel: {}, c4: {}, bs: {} };
  d.pairs ??= {};
  d.pairsDay ??= todayKey();
});
const save = () => writeJson(FILES.ranked, data);

// Ranks, from the rating
const TIERS = [
  { name: 'Bronze', emoji: '🥉', min: 0 },
  { name: 'Silver', emoji: '🥈', min: 1000 },
  { name: 'Gold', emoji: '🥇', min: 1200 },
  { name: 'Platinum', emoji: '💠', min: 1400 },
  { name: 'Diamond', emoji: '💎', min: 1600 },
];
const tierOf = (elo) => [...TIERS].reverse().find((t) => elo >= t.min);

// At the start of a new month: pay the top 3 of each game, then pull everyone halfway back to 1000
function ensureSeason() {
  if (data.season === seasonKey()) return;

  for (const game of Object.keys(GAMES)) {
    const board = data.games[game];
    const eligible = Object.entries(board)
      .filter(([, r]) => r.wins + r.losses >= MIN_GAMES_FOR_REWARD)
      .sort((a, b) => b[1].elo - a[1].elo)
      .slice(0, SEASON_REWARDS.length);
    eligible.forEach(([id], i) => addCoins(id, SEASON_REWARDS[i]));

    for (const r of Object.values(board)) {
      r.elo = 1000 + Math.round((r.elo - 1000) / 2);
      r.wins = 0;
      r.losses = 0;
    }
  }
  data.season = seasonKey();
  save();
}

// Called when a ranked game ends with a winner
function recordRanked(gameType, winnerId, loserId) {
  if (!GAMES[gameType]) return;
  ensureSeason();

  // Beating the same person over and over in one day stops counting
  if (data.pairsDay !== todayKey()) {
    data.pairs = {};
    data.pairsDay = todayKey();
  }
  const pairKey = `${[winnerId, loserId].sort().join('-')}:${gameType}`;
  data.pairs[pairKey] = (data.pairs[pairKey] ?? 0) + 1;
  if (data.pairs[pairKey] > MAX_PAIR_GAMES_PER_DAY) {
    save();
    return;
  }

  const board = data.games[gameType];
  const winner = (board[winnerId] ??= { elo: 1000, wins: 0, losses: 0 });
  const loser = (board[loserId] ??= { elo: 1000, wins: 0, losses: 0 });

  const expected = 1 / (1 + 10 ** ((loser.elo - winner.elo) / 400));
  const change = Math.round(K * (1 - expected));
  winner.elo += change;
  loser.elo = Math.max(100, loser.elo - change);
  winner.wins++;
  loser.losses++;
  save();
}

function buildRanked(query, userId) {
  ensureSeason();
  const key = query ? ALIASES[query.toLowerCase().replace(/\s+/g, '')] : null;

  const seasonEnd = new Date();
  seasonEnd.setUTCMonth(seasonEnd.getUTCMonth() + 1, 1);
  seasonEnd.setUTCHours(0, 0, 0, 0);

  const lines = (game, count) => {
    const entries = Object.entries(data.games[game]).sort((a, b) => b[1].elo - a[1].elo).slice(0, count);
    if (!entries.length) return '*No ranked games yet*';
    return entries
      .map(([id, r], i) => `${i + 1}. <@${id}> — **${r.elo}** ${tierOf(r.elo).emoji} (${r.wins}W-${r.losses}L)`)
      .join('\n');
  };

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🏅 Ranked ladder')
    .setDescription(
      `Season **${data.season}** ends <t:${Math.floor(seasonEnd.getTime() / 1000)}:R>. ` +
      `The top 3 of each game win ${SEASON_REWARDS.map(fmt).join(' / ')} (at least ${MIN_GAMES_FOR_REWARD} games needed).\n` +
      'Win duels, Connect Four, or Battleship against other players to climb. Everyone starts at 1000.'
    );

  const mine = Object.keys(GAMES)
    .map((g) => {
      const r = data.games[g][userId];
      return r ? `${GAMES[g][0]} ${r.elo} ${tierOf(r.elo).emoji}` : `${GAMES[g][0]} unranked`;
    })
    .join(' · ');

  if (key) {
    embed.addFields({ name: `${GAMES[key][0]} ${GAMES[key][1]} — top 10`, value: lines(key, 10) });
  } else {
    for (const game of Object.keys(GAMES)) {
      embed.addFields({ name: `${GAMES[game][0]} ${GAMES[game][1]}`, value: lines(game, 5), inline: true });
    }
  }
  embed.setFooter({ text: `Your ratings: ${mine}` });
  return { embeds: [embed] };
}

function getRatings(userId) {
  ensureSeason();
  const out = [];
  for (const game of Object.keys(GAMES)) {
    const r = data.games[game][userId];
    if (r) out.push({ emoji: GAMES[game][0], name: GAMES[game][1], elo: r.elo, tier: tierOf(r.elo), wins: r.wins, losses: r.losses });
  }
  return out;
}

module.exports = { recordRanked, buildRanked, getRatings };
