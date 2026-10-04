const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');

// channelId -> [{ role, content }, ...]
const histories = new Map(Object.entries(readJson(FILES.history, {})));

// channelId -> last question, used by !!retry (lost on restart)
const lastAsked = new Map();

function saveHistories() {
  writeJson(FILES.history, Object.fromEntries(histories));
}

module.exports = { histories, lastAsked, saveHistories };
