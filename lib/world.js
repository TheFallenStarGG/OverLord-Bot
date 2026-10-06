const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');

// Saved state for the Rebellion, bounties, and the Gazette. It all lives on disk,
// so restarting the bot never resets a timer.
const data = readJson(FILES.world, null) ?? {};
data.rebellion ??= { meter: 0, raid: null, usurper: null };
data.bounty ??= { active: null, nextAt: 0 };
data.chronicle ??= { log: [] };
data.gazette ??= { lastDay: null, snapshot: null, latest: null };

let timer = null;
function saveNow() {
  if (timer) clearTimeout(timer);
  timer = null;
  writeJson(FILES.world, data);
}
// Small, frequent changes (like Rebellion points) are saved a few seconds later in one go
function save() {
  if (!timer) timer = setTimeout(saveNow, 3000);
}

// A short list of what happened lately. The Gazette reads from it.
function logEvent(text) {
  data.chronicle.log.push({ at: Date.now(), text });
  if (data.chronicle.log.length > 60) data.chronicle.log.shift();
  save();
}

module.exports = { data, save, saveNow, logEvent };
