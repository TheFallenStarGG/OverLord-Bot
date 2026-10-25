const { FILES } = require('../config');
const { scoped, writeJson } = require('./storage');

// Per-server map: userId -> { at }
const data = scoped(FILES.optout, (d) => (d && typeof d === 'object' ? d : {}));

const save = () => writeJson(FILES.optout, data);

function isOptedOut(userId) {
  return Boolean(userId && data[userId]);
}

function optOut(userId) {
  data[userId] = { at: Date.now() };
  save();
}

function optIn(userId) {
  if (!data[userId]) return false;
  delete data[userId];
  save();
  return true;
}

module.exports = { isOptedOut, optOut, optIn };
