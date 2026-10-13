// Per-user toggle: classic one-shot work/rob/fish/mine instead of interactive UIs
const { getUser, markDirty } = require('./economy');

function isLegacy(userId) {
  return Boolean(getUser(userId).legacyMode);
}

function setLegacy(userId, on) {
  const u = getUser(userId);
  u.legacyMode = Boolean(on);
  markDirty();
  return u.legacyMode;
}

function toggleLegacy(userId) {
  return setLegacy(userId, !isLegacy(userId));
}

module.exports = { isLegacy, setLegacy, toggleLegacy };
