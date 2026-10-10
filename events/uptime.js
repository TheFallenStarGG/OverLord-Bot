const { FILES } = require('../config');
const { readJson, writeJson } = require('../lib/storage');
const { logging } = require('../lib/logging');

const BEAT_MS = 60 * 1000; // how often the bot says "I'm alive"
const OFFLINE_AFTER_MS = 3 * 60 * 1000; // a longer silence means the bot was down
const DISCORD_AFTER_MS = 60 * 1000; // losing Discord for longer than this counts as an incident
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_INCIDENTS = 200;

const state = readJson(FILES.webstatus, {});
state.since ??= Date.now(); // when tracking began
state.incidents ??= [];
const save = () => writeJson(FILES.webstatus, state);

function addIncident(kind, start, end) {
  const cutoff = Date.now() - KEEP_MS;
  state.incidents = [{ kind, start, end }, ...state.incidents].filter((i) => i.end > cutoff).slice(0, MAX_INCIDENTS);
  save();
}

module.exports = (client) => {
  const previousBeat = state.lastBeat ?? 0; // the last sign of life from the run before this one
  let started = false;
  let droppedAt = 0;

  const start = () => {
    if (started) return;
    started = true;
    const now = Date.now();
    if (previousBeat && now - previousBeat > OFFLINE_AFTER_MS) {
      addIncident('offline', previousBeat, now);
      logging('warn', 'Back online', `The bot was down for about ${Math.round((now - previousBeat) / 60000)} min`);
    }
    state.lastBeat = now;
    save();
    setInterval(() => {
      state.lastBeat = Date.now();
      save();
    }, BEAT_MS);
  };
  client.once('clientReady', start);
  client.once('ready', start);

  // Discord connection drops while the bot itself kept running
  client.on('shardDisconnect', () => {
    droppedAt ||= Date.now();
  });
  const reconnected = () => {
    if (droppedAt && Date.now() - droppedAt > DISCORD_AFTER_MS) addIncident('discord', droppedAt, Date.now());
    droppedAt = 0;
  };
  client.on('shardResume', reconnected);
  client.on('shardReady', reconnected);
};
