const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { createClient } = require('@libsql/client/web');
const { logging } = require('./logging');

// Every file the bot used to keep as a .json file now lives in one database table. Each top-level key of
// a file (for economy, each player) is its own row, so a save only writes what actually changed.
//
// "Scoped" files (economy, stocks, world...) are kept separately for every server. The bot remembers which
// server the current event came from (see index.js), and scoped() quietly hands out that server's data.

const FLUSH_MS = 10 * 1000; // changes are batched and sent this often
const BATCH_SIZE = 50;
const ROOT_KEY = '__root__'; // used when a file's data isn't a plain object (like an array)

let db = null;
const cache = new Map(); // file name -> the live data the bot works with
const saved = new Map(); // file name -> Map(key -> JSON text last written to the database)
const pending = new Map(); // file name -> data waiting to be saved
let timer = null;
let chain = Promise.resolve();
const stats = { rowsWritten: 0, flushes: 0, failures: 0, lastSaveAt: null, lastError: null, startedAt: Date.now() };

const nameOf = (file) => path.basename(file, '.json');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Which server is this about? ----------

const als = new AsyncLocalStorage();
const SCOPED = Symbol('overlorder.scoped');
const scopedInfo = new Map(); // base file name -> { init, ready: Set of server ids }
const touched = new Map(); // base file name -> server ids used since the file was last queued for saving
const dirtyScoped = new Set(); // base file names that a module asked to save

const currentGuild = () => als.getStore()?.guildId ?? null;
const runIn = (guildId, fn) => als.run({ guildId }, fn);

function touch(base, guildId) {
  let set = touched.get(base);
  if (!set) touched.set(base, (set = new Set()));
  set.add(guildId);
}

// Behaves like a plain object, but always shows the data of the server the current event came from.
// init(data) runs once per server, the first time that server's data is used.
function scoped(file, init = () => {}) {
  const base = nameOf(file);
  const info = { init, ready: new Set() };
  scopedInfo.set(base, info);

  const resolve = () => {
    const guildId = currentGuild();
    if (!guildId) throw new Error(`"${base}" was used with no server attached to it`);
    const name = `${base}@${guildId}`;
    let data = cache.get(name);
    if (!data) cache.set(name, (data = {}));
    touch(base, guildId);
    if (!info.ready.has(guildId)) {
      info.ready.add(guildId);
      info.init(data, guildId);
    }
    return data;
  };

  return new Proxy(
    {},
    {
      get: (_, key) => (key === SCOPED ? base : Reflect.get(resolve(), key)),
      set: (_, key, value) => Reflect.set(resolve(), key, value),
      has: (_, key) => key in resolve(),
      deleteProperty: (_, key) => Reflect.deleteProperty(resolve(), key),
      ownKeys: () => Reflect.ownKeys(resolve()),
      getOwnPropertyDescriptor: (_, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), key);
        if (descriptor) descriptor.configurable = true;
        return descriptor;
      },
    }
  );
}

const hasScoped = (base, guildId) => cache.has(`${base}@${guildId}`);

// Every server's data for one scoped file (used by the global leaderboard)
function allScoped(base) {
  const prefix = `${base}@`;
  const out = [];
  for (const [name, data] of cache) if (name.startsWith(prefix)) out.push({ guildId: name.slice(prefix.length), data });
  return out;
}

// Runs fn once for every server that has data, one after another, each with its own server attached
async function forEachGuild(client, fn, base = 'economy') {
  for (const guild of client.guilds.cache.values()) {
    if (base && !hasScoped(base, guild.id)) continue;
    try {
      await runIn(guild.id, () => fn(guild));
    } catch (err) {
      logging('error', 'A per-server task failed', `${guild.name}: ${err.message}`);
    }
  }
}

// ---------- Saving ----------

function rebuild(entries) {
  if (entries.size === 1 && entries.has(ROOT_KEY)) {
    try {
      return JSON.parse(entries.get(ROOT_KEY));
    } catch {
      return undefined;
    }
  }
  const data = {};
  for (const [key, text] of entries) {
    try {
      data[key] = JSON.parse(text);
    } catch {
      console.error(`Skipped a corrupted database row: ${key}`);
    }
  }
  return data;
}

// Turns data into Map(key -> JSON text) in one go, so it's consistent even if the bot keeps changing things
function snapshot(data) {
  const rows = new Map();
  if (isObject(data)) {
    for (const [key, value] of Object.entries(data)) {
      const text = JSON.stringify(value);
      if (text !== undefined) rows.set(key, text);
    }
  } else {
    rows.set(ROOT_KEY, JSON.stringify(data));
  }
  return rows;
}

// Sends only the rows that changed since the last save
async function writeFile(name, data) {
  const before = saved.get(name) ?? new Map();
  const now = snapshot(data);
  const statements = [];

  for (const [key, text] of now) {
    if (before.get(key) !== text) {
      statements.push({
        sql: 'INSERT INTO kv (file, key, value) VALUES (?, ?, ?) ON CONFLICT(file, key) DO UPDATE SET value = excluded.value',
        args: [name, key, text],
      });
    }
  }
  for (const key of before.keys()) {
    if (!now.has(key)) statements.push({ sql: 'DELETE FROM kv WHERE file = ? AND key = ?', args: [name, key] });
  }

  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_SIZE), 'write');
  }
  saved.set(name, now);
  stats.rowsWritten += statements.length;
}

// A module saved a scoped file: queue the data of every server that was used since the last save
function expandScoped() {
  for (const base of dirtyScoped) {
    for (const guildId of touched.get(base) ?? []) {
      const name = `${base}@${guildId}`;
      if (cache.has(name)) pending.set(name, cache.get(name));
    }
    touched.delete(base);
  }
  dirtyScoped.clear();
}

async function run() {
  expandScoped();
  const batch = [...pending];
  pending.clear();
  let ok = true;

  for (const [name, data] of batch) {
    try {
      await writeFile(name, data);
      stats.lastError = null;
    } catch (err) {
      ok = false;
      stats.failures++;
      stats.lastError = err.message;
      if (!pending.has(name)) pending.set(name, data); // try again next round with the newest data
      logging('error', 'Database save failed', err);
    }
  }

  stats.flushes++;
  if (ok) stats.lastSaveAt = Date.now();
  if (pending.size && !timer) timer = setTimeout(flush, FLUSH_MS);
}

// Saves everything that's waiting. Safe to call at any time (saves never overlap).
function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  chain = chain.then(run);
  return chain;
}

function writeJson(file, data) {
  if (data !== null && typeof data === 'object' && data[SCOPED]) {
    dirtyScoped.add(data[SCOPED]); // scoped data: saves whichever servers were used
  } else {
    const name = nameOf(file);
    cache.set(name, data);
    pending.set(name, data);
  }
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

function readJson(file, fallback) {
  const name = nameOf(file);
  return cache.has(name) ? cache.get(name) : fallback;
}

// Must finish BEFORE any other file reads its data (see index.js)
async function init(files = {}, scopedFiles = []) {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error('Set the TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables.');

  // The https:// form works everywhere (libsql:// needs websockets)
  db = createClient({ url: url.replace(/^libsql:/, 'https:'), authToken });

  let rows;
  for (let attempt = 1; ; attempt++) {
    try {
      await db.execute(
        'CREATE TABLE IF NOT EXISTS kv (file TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (file, key)) WITHOUT ROWID'
      );
      await db.execute('CREATE TABLE IF NOT EXISTS imported (file TEXT PRIMARY KEY)');
      rows = (await db.execute('SELECT file, key, value FROM kv')).rows;
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
      console.error(`Could not reach the database (try ${attempt} of 4): ${err.message}`);
      await sleep(3000 * attempt);
    }
  }

  const grouped = new Map();
  for (const row of rows) {
    const file = String(row.file);
    if (!grouped.has(file)) grouped.set(file, new Map());
    grouped.get(file).set(String(row.key), String(row.value));
  }
  for (const [file, entries] of grouped) {
    const data = rebuild(entries);
    if (data === undefined) continue;
    cache.set(file, data);
    saved.set(file, entries);
  }

  // One-time import of your old .json files (only for files the database doesn't have yet)
  const scopedSet = new Set(scopedFiles);
  const done = new Set((await db.execute('SELECT file FROM imported')).rows.map((r) => String(r.file)));
  const toMark = [];
  for (const filePath of Object.values(files)) {
    const name = nameOf(filePath);
    if (done.has(name) || !fs.existsSync(filePath)) continue;
    try {
      const hasData = [...cache.keys()].some((k) => k === name || (scopedSet.has(name) && k.startsWith(`${name}@`)));
      if (!hasData) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!scopedSet.has(name)) await writeFile(name, data); // scoped files are saved below, under a server
        cache.set(name, data);
        console.log(`Imported ${path.basename(filePath)}`);
      }
      toMark.push(name);
    } catch (err) {
      console.error(`Could not import ${path.basename(filePath)}: ${err.message}`);
    }
  }

  // Data from before servers were separate belongs to your original server
  for (const base of scopedSet) {
    if (!cache.has(base)) continue;
    const home = process.env.HOME_GUILD_ID;
    if (!home) {
      throw new Error(
        `Your saved "${base}" data belongs to your original server. Set the HOME_GUILD_ID environment variable to that server's ID and restart.`
      );
    }
    const legacy = cache.get(base);
    await writeFile(`${base}@${home}`, legacy);
    cache.set(`${base}@${home}`, legacy);
    await writeFile(base, {}); // removes the old rows
    cache.delete(base);
    saved.delete(base);
    console.log(`Moved ${base} data to server ${home}`);
  }

  for (const name of toMark) {
    await db.execute({ sql: 'INSERT OR IGNORE INTO imported (file) VALUES (?)', args: [name] });
  }
  console.log(`Database ready (${cache.size} data files loaded)`);
}

// Erases every row and cached copy of one server's scoped data
async function deleteGuild(guildId) {
  const suffix = `@${guildId}`;
  const names = [...cache.keys()].filter((n) => n.endsWith(suffix));
  for (const name of names) {
    cache.delete(name);
    pending.delete(name);
    saved.delete(name);
  }
  for (const [base, info] of scopedInfo) {
    info.ready.delete(guildId);
    touched.get(base)?.delete(guildId);
  }
  await chain.catch(() => {}); // let a save that is already running finish first
  for (const name of [...pending.keys()]) if (name.endsWith(suffix)) pending.delete(name);
  const result = await db.execute({ sql: 'DELETE FROM kv WHERE file LIKE ?', args: [`%${suffix}`] });
  return { files: names.length, rows: result.rowsAffected ?? 0 };
}
              
function status() {
  return {
    connected: Boolean(db),
    files: cache.size,
    rows: [...saved.values()].reduce((total, rowsMap) => total + rowsMap.size, 0),
    waiting: pending.size,
    ...stats,
  };
}

module.exports = { init, readJson, writeJson, flush, status, scoped, currentGuild, runIn, forEachGuild, hasScoped, allScoped };
