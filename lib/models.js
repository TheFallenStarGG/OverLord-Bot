const path = require('path');
const { API, BLOCKED_MODELS, BAD_SCORE, FILES } = require('../config');
const { readJson, writeJson } = require('./storage');

const blockedExtra = readJson(FILES.blocked, []); // patterns added with !!block
const ratings = readJson(FILES.ratings, {}); // modelId -> { up, down }

// modelId -> timestamp until which it's skipped. Saved to a file so bans survive restarts.
const BAD_FILE = path.join(__dirname, '..', 'badmodels.json');
const badModels = new Map(Object.entries(readJson(BAD_FILE, {})).filter(([, until]) => Number(until) > Date.now()));

let cachedModels = []; // [{ id, image }]
let cachedAt = 0;

function saveBlocked() {
  writeJson(FILES.blocked, blockedExtra);
}

function saveBadModels() {
  writeJson(BAD_FILE, Object.fromEntries(badModels));
}

function banModel(id, ms) {
  badModels.set(id, Date.now() + ms);
  saveBadModels();
}

// Lifts every ban. Returns how many were lifted.
function clearBans() {
  const count = badModels.size;
  if (!count) return 0;
  badModels.clear();
  saveBadModels();
  return count;
}

function isBlocked(id) {
  const lower = id.toLowerCase();
  return [...BLOCKED_MODELS, ...blockedExtra].some((b) => lower.includes(b.toLowerCase()));
}

function poorlyRated(id) {
  const r = ratings[id];
  return Boolean(r) && r.down - r.up >= BAD_SCORE;
}

function adjustRating(model, vote, delta) {
  const r = (ratings[model] ??= { up: 0, down: 0 });
  if (vote === 1) r.up += delta;
  else r.down += delta;
  writeJson(FILES.ratings, ratings);
}

// All free text models (the blocklist is applied separately, so !!block takes effect instantly)
async function getFreeModels() {
  if (cachedModels.length && Date.now() - cachedAt < 60 * 60 * 1000) return cachedModels;

  const res = await fetch(`${API}/models`);
  const data = await res.json();

  cachedModels = data.data
    .filter((m) => m.id.endsWith(':free'))
    .filter((m) => m.architecture?.output_modalities?.includes('text') ?? true)
    .map((m) => ({
      id: m.id,
      image: m.architecture?.input_modalities?.includes('image') ?? false,
    }));
  cachedAt = Date.now();
  return cachedModels;
}

async function getUsableModels() {
  return (await getFreeModels()).filter((m) => !isBlocked(m.id));
}

// Picks a random model, avoiding recently failed and poorly rated ones (unless nothing else is left)
function pickModel(pool, tried) {
  const now = Date.now();
  let candidates = pool.filter(
    (m) => !tried.has(m.id) && (badModels.get(m.id) ?? 0) <= now && !poorlyRated(m.id)
  );
  if (!candidates.length) candidates = pool.filter((m) => !tried.has(m.id));
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Like pickModel, but NEVER returns a banned model (returns null when none are left, so the caller can lift the bans)
function pickAvailable(pool, tried) {
  const now = Date.now();
  const free = pool.filter((m) => !tried.has(m.id) && (badModels.get(m.id) ?? 0) <= now);
  const good = free.filter((m) => !poorlyRated(m.id));
  const candidates = good.length ? good : free;
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

module.exports = {
  blockedExtra,
  saveBlocked,
  ratings,
  badModels,
  banModel,
  clearBans,
  isBlocked,
  poorlyRated,
  adjustRating,
  getFreeModels,
  getUsableModels,
  pickModel,
  pickAvailable,
};
