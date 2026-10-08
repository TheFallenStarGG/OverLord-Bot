const { FILES, SCOPED_FILES } = require('../config');
const { readJson, writeJson, deleteGuild, allScoped } = require('./storage');
const { clearChannel } = require('./announce');
const { logging } = require('./logging');

const DAY = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30; // data is kept this long after the bot is removed from a server

function meta() {
  let m = readJson(FILES.guildmeta, null);
  if (!m) {
    m = { pending: {} };
    writeJson(FILES.guildmeta, m);
  }
  m.pending ??= {};
  return m;
}
const saveMeta = () => writeJson(FILES.guildmeta, meta());

async function wipeGuild(guildId) {
  const result = await deleteGuild(guildId);
  clearChannel(guildId);
  const m = meta();
  if (m.pending[guildId]) {
    delete m.pending[guildId];
    saveMeta();
  }
  logging('warn', 'Server data deleted', `${guildId}: ${result.files} data files, ${result.rows} rows`);
  return result;
}

function scheduleDeletion(guildId) {
  meta().pending[guildId] = Date.now() + RETENTION_DAYS * DAY;
  saveMeta();
}

function cancelDeletion(guildId) {
  const m = meta();
  if (!m.pending[guildId]) return;
  delete m.pending[guildId];
  saveMeta();
}

async function runDueDeletions(client) {
  const m = meta();
  const now = Date.now();
  for (const [guildId, due] of Object.entries(m.pending)) {
    if (due > now) continue;
    if (client.guilds.cache.has(guildId)) {
      cancelDeletion(guildId); // the bot is back in that server
      continue;
    }
    try {
      await wipeGuild(guildId);
    } catch (err) {
      logging('error', 'Scheduled data deletion failed', `${guildId}: ${err.message}`);
    }
  }
}

// Servers that have saved data but the bot is no longer in (for example it was removed while offline)
function scheduleMissing(client) {
  if (!client.guilds.cache.size) return;
  const m = meta();
  let changed = false;
  for (const base of SCOPED_FILES) {
    for (const { guildId } of allScoped(base)) {
      if (!client.guilds.cache.has(guildId) && !m.pending[guildId]) {
        m.pending[guildId] = Date.now() + RETENTION_DAYS * DAY;
        changed = true;
      }
    }
  }
  if (changed) saveMeta();
}

module.exports = { RETENTION_DAYS, wipeGuild, scheduleDeletion, cancelDeletion, runDueDeletions, scheduleMissing };
