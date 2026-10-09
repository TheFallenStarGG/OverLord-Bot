const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');

function load() {
  const d = readJson(FILES.redditAllow, null) || { users: [] };
  d.users = Array.isArray(d.users) ? d.users.map(String) : [];
  return d;
}

function save(d) {
  writeJson(FILES.redditAllow, d);
}

function isAllowed(userId) {
  return load().users.includes(String(userId));
}

function allow(userId) {
  const d = load();
  const id = String(userId);
  if (d.users.includes(id)) return false;
  d.users.push(id);
  save(d);
  return true;
}

function deny(userId) {
  const d = load();
  const id = String(userId);
  const before = d.users.length;
  d.users = d.users.filter((u) => u !== id);
  save(d);
  return d.users.length < before;
}

function list() {
  return load().users.slice();
}

module.exports = { isAllowed, allow, deny, list };
