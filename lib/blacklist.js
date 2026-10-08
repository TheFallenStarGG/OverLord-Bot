const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');

function data() {
  let d = readJson(FILES.blacklist, null);
  if (!d) {
    d = { users: {}, guilds: {} };
    writeJson(FILES.blacklist, d);
  }
  d.users ??= {};
  d.guilds ??= {};
  return d;
}
const save = () => writeJson(FILES.blacklist, data());

const isUserBlocked = (id) => data().users[id] ?? null;
const isGuildBlocked = (id) => data().guilds[id] ?? null;

function blockUser(id, reason, by) {
  data().users[id] = { reason, by, at: Date.now() };
  save();
}
function unblockUser(id) {
  const had = Boolean(data().users[id]);
  delete data().users[id];
  save();
  return had;
}
function blockGuild(id, reason, by) {
  data().guilds[id] = { reason, by, at: Date.now() };
  save();
}
function unblockGuild(id) {
  const had = Boolean(data().guilds[id]);
  delete data().guilds[id];
  save();
  return had;
}
function list() {
  const d = data();
  return { users: Object.entries(d.users), guilds: Object.entries(d.guilds) };
}

module.exports = { isUserBlocked, isGuildBlocked, blockUser, unblockUser, blockGuild, unblockGuild, list };
