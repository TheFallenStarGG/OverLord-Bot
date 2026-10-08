const { data, saveNow } = require('./world');
const { getChannel, setChannel, clearChannel } = require('./announce');

function ensure() {
  data.settings ??= {};
  data.settings.gambling ??= true;
  data.settings.rob ??= true;
  data.settings.customTitles ??= {};
  return data.settings;
}

function isGamblingEnabled() {
  return ensure().gambling !== false;
}

function isRobEnabled() {
  return ensure().rob !== false;
}

function setGambling(on) {
  ensure().gambling = Boolean(on);
  saveNow();
}

function setRob(on) {
  ensure().rob = Boolean(on);
  saveNow();
}

function getLevelChannelId() {
  return ensure().levelChannelId ?? null;
}

function setLevelChannelId(id) {
  ensure().levelChannelId = id;
  saveNow();
}

/** @returns {Record<string, { name: string, emoji: string, price: number, roleId: string|null, desc: string }>} */
function getCustomTitles() {
  return ensure().customTitles;
}

function setCustomTitle(id, def) {
  ensure().customTitles[id] = def;
  saveNow();
}

function removeCustomTitle(id) {
  delete ensure().customTitles[id];
  saveNow();
}

function settingsSummary(guildId) {
  const s = ensure();
  const events = getChannel(guildId);
  return {
    gambling: s.gambling !== false,
    rob: s.rob !== false,
    levelChannelId: s.levelChannelId ?? null,
    eventsChannelId: events || null,
    customTitleCount: Object.keys(s.customTitles || {}).length,
  };
}

module.exports = {
  ensure,
  isGamblingEnabled,
  isRobEnabled,
  setGambling,
  setRob,
  getLevelChannelId,
  setLevelChannelId,
  getCustomTitles,
  setCustomTitle,
  removeCustomTitle,
  settingsSummary,
  getChannel,
  setChannel,
  clearChannel,
};
