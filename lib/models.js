const { API, BLOCKED_MODELS, BAD_SCORE, FILES } = require('../config');
const { readJson, writeJson } = require('./storage');

const blockedExtra = readJson(FILES.blocked, []); // patterns added with !!block
const ratings = readJson(FILES.ratings, {}); // modelId -> { up, down }
const badModels = new Map(); // modelId -> timestamp until which it's skipped

let cachedModels = []; // [{ id, image }]
let cachedAt = 0;

function saveBlocked() {
  writeJson(FILES.blocked, blockedExtra);
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

module.exports = {
  blockedExtra,
  saveBlocked,
  ratings,
  badModels,
  isBlocked,
  poorlyRated,
  adjustRating,
  getFreeModels,
  getUsableModels,
  pickModel,
};
