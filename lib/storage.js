const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client/web');
const { logging } = require('./logging');

// Every file the bot used to keep as a .json file now lives in one database table. Each top-level key
// of a file (for economy, each player) is its own row, so a save only writes what actually changed.
// The rest of the bot still calls readJson / writeJson exactly like before.

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

async function run() {
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
  const name = nameOf(file);
  cache.set(name, data);
  pending.set(name, data);
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

function readJson(file, fallback) {
  const name = nameOf(file);
  return cache.has(name) ? cache.get(name) : fallback;
}

// Must finish BEFORE any other file reads its data (see index.js)
async function init(files = {}) {
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
  const done = new Set((await db.execute('SELECT file FROM imported')).rows.map((r) => String(r.file)));
  for (const filePath of Object.values(files)) {
    const name = nameOf(filePath);
    if (done.has(name) || !fs.existsSync(filePath)) continue;
    try {
      if (!cache.has(name)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        await writeFile(name, data);
        cache.set(name, data);
        console.log(`Imported ${path.basename(filePath)} into the database`);
      }
      await db.execute({ sql: 'INSERT OR IGNORE INTO imported (file) VALUES (?)', args: [name] });
    } catch (err) {
      console.error(`Could not import ${path.basename(filePath)}: ${err.message}`);
    }
  }

  console.log(`Database ready (${cache.size} data files loaded)`);
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

module.exports = { init, readJson, writeJson, flush, status };
