const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');

// threadId -> { creatorId, createdAt }
const threads = readJson(FILES.threads, {});

function save() {
  writeJson(FILES.threads, threads);
}

const isChatThread = (id) => Object.hasOwn(threads, id);
const getChatThread = (id) => threads[id];

function addChatThread(id, creatorId) {
  threads[id] = { creatorId, createdAt: Date.now() };
  save();
}

function removeChatThread(id) {
  delete threads[id];
  save();
}

module.exports = { isChatThread, getChatThread, addChatThread, removeChatThread };
