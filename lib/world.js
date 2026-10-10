const { FILES } = require('../config');
const { scoped, writeJson } = require('./storage');

const HOUR = 60 * 60 * 1000;
const BOUNTY_GAP_HOURS = [12, 24]; // keep in sync with lib/bounty.js

// Saved state for the Rebellion, bounties, the Gazette, and server settings. One copy per server.
const data = scoped(FILES.world, (d) => {
  d.rebellion ??= { meter: 0, raid: null, usurper: null };
  d.bounty ??= { active: null, nextAt: 0, lastTargetId: null };
  d.bounty.lastTargetId ??= null;
  d.chronicle ??= { log: [] };
  d.gazette ??= { lastDay: null, snapshot: null, latest: null };
  d.settings ??= { levelChannelId: null, gambling: true, rob: true, customTitles: {} };
  d.settings.gambling ??= true;
  d.settings.rob ??= true;
  d.settings.customTitles ??= {};
  
  const gap = () => (BOUNTY_GAP_HOURS[0] + Math.random() * (BOUNTY_GAP_HOURS[1] - BOUNTY_GAP_HOURS[0])) * HOUR;
  if (!d.bounty.nextAt) d.bounty.nextAt = Date.now() + gap();
  d.bounty.nextAt = Math.min(d.bounty.nextAt, Date.now() + BOUNTY_GAP_HOURS[1] * HOUR);

  // The first Gazette comes out at the next midnight, not the moment a server starts
  d.gazette.lastDay ??= new Date().toISOString().slice(0, 10);
});

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
