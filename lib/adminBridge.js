const { createClient } = require('@libsql/client/web');
const { EmbedBuilder, version: DISCORD_JS } = require('discord.js');
const { FILES } = require('../config');
const storage = require('./storage');
const adminState = require('./adminState');
const blacklist = require('./blacklist');
const access = require('./commandAccess');
const { logging } = require('./logging');
const { withRetry, reason } = require('./retry');
const banNotice = require('./banNotice');

// Talks to the website admin panel through two small tables in the same database:
//   admin_state: the bot publishes snapshots here (overview, servers, config, settings)
//   admin_queue: the website drops requests here and the bot carries them out

const PUBLISH_MS = 30 * 1000;
const QUEUE_MS = 4 * 1000;
const EXPIRE_MS = 5 * 60 * 1000; // requests the bot didn't pick up in time are dropped
const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_SERVERS = 300;
const MAX_COINS = 1_000_000_000_000;
const ID = /^\d{17,20}$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Users the dashboard can pick from ----------
// People who recently ran a command (kept in memory) plus everyone with a game account
const seen = new Map(); // userId -> { name, username, guildName, at }
const resolved = new Map(); // userId -> { name, username } | null (null = Discord couldn't find them)
const MAX_SEEN = 3000;
const MAX_USERS = 600;
const RESOLVE_PER_PUBLISH = 15;

function noteUser(user, guild) {
  if (!user || user.bot) return;
  const old = seen.get(user.id);
  seen.delete(user.id); // re-adding keeps the Map ordered oldest → newest
  seen.set(user.id, {
    name: user.globalName || user.username,
    username: user.username,
    guildName: guild?.name ?? old?.guildName ?? '',
    at: Date.now(),
  });
  if (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
}

function trackUsers(client) {
  client.on('messageCreate', (m) => {
    if (m.content?.startsWith('!!')) noteUser(m.author, m.guild);
  });
  client.on('interactionCreate', (i) => {
    if (i.isChatInputCommand?.()) noteUser(i.user, i.guild);
  });
}

function knownName(client, id) {
  const u = client.users.cache.get(id);
  return seen.get(id)?.name ?? resolved.get(id)?.name ?? (u ? u.globalName || u.username : null);
}

// Everyone with a game account: userId -> one server they play in
function playerIds() {
  const out = new Map();
  for (const e of storage.allScoped('economy')) {
    for (const [uid, u] of Object.entries(e.data ?? {})) {
      if (!ID.test(uid) || !u || typeof u !== 'object') continue;
      if (!out.has(uid)) out.set(uid, e.guildId);
    }
  }
  return out;
}

async function buildUsers(client) {
  const players = playerIds();

  // Look up a few unknown players each round so their names fill in over time
  let budget = RESOLVE_PER_PUBLISH;
  for (const id of players.keys()) {
    if (budget <= 0) break;
    if (seen.has(id) || resolved.has(id) || client.users.cache.has(id)) continue;
    budget--;
    try {
      const u = await client.users.fetch(id);
      resolved.set(id, { name: u.globalName || u.username, username: u.username });
    } catch {
      resolved.set(id, null);
    }
  }

  const skip = new Set([process.env.OWNER_ID, client.user.id]);
  const rows = [];
  const done = new Set();
  // Row format: [id, name, username, server, lastSeen, blocked]
  const push = (id, name, username, server, at) => {
    if (done.has(id) || skip.has(id) || !name) return;
    done.add(id);
    rows.push([id, name, username || '', server || '', at || 0, blacklist.isUserBlocked(id) ? 1 : 0]);
  };

  for (const [id, s] of [...seen.entries()].reverse()) push(id, s.name, s.username, s.guildName, s.at); // newest first
  for (const [id, guildId] of players) {
    const cached = client.users.cache.get(id);
    const r = resolved.get(id);
    push(id, cached ? cached.globalName || cached.username : r?.name, cached ? cached.username : r?.username, client.guilds.cache.get(guildId)?.name, 0);
  }
  return rows.slice(0, MAX_USERS);
}

let db = null;

function connect() {
  if (db) return db;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return null;
  db = createClient({ url: url.replace(/^libsql:/, 'https:'), authToken });
  return db;
}

async function ensureTables() {
  await db.batch(
    [
      'CREATE TABLE IF NOT EXISTS admin_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)',
      "CREATE TABLE IF NOT EXISTS admin_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, payload TEXT NOT NULL, by_id TEXT, by_name TEXT, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', result TEXT, done_at INTEGER)",
    ],
    'write'
  );
}

async function loadSettings() {
  const result = await db.execute({ sql: 'SELECT value FROM admin_state WHERE key = ?', args: ['settings'] });
  if (result.rows[0]) {
    try {
      adminState.load(JSON.parse(String(result.rows[0].value)));
    } catch {
      /* ignore a damaged row */
    }
  }
}

const stateRow = (key, value) => ({
  sql: 'INSERT INTO admin_state (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated',
  args: [key, JSON.stringify(value), Date.now()],
});

// ---------- What the bot publishes ----------

function buildOverview(client, commands) {
  const mem = process.memoryUsage();
  const today = storage.readJson(FILES.digest, null);
  const topCommands = Object.entries(today?.commands ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const errors = Object.entries(today?.errors ?? {}).sort((a, b) => b[1].count - a[1].count);
  const database = storage.status();

  return {
    bot: client.user?.tag ?? null,
    uptimeSec: Math.round(process.uptime()),
    pingMs: Math.max(0, Math.round(client.ws.ping)),
    servers: client.guilds.cache.size,
    members: [...client.guilds.cache.values()].reduce((total, g) => total + (g.memberCount ?? 0), 0),
    commandsLoaded: commands.size,
    memoryMb: Math.round(mem.rss / 1048576),
    node: process.version,
    discordJs: DISCORD_JS,
    database: {
      connected: database.connected,
      files: database.files,
      rows: database.rows,
      waiting: database.waiting,
      failures: database.failures,
      lastSaveAt: database.lastSaveAt,
      lastError: database.lastError ? String(database.lastError).slice(0, 200) : null,
    },
    today: today
      ? {
          day: today.day,
          commands: Object.values(today.commands ?? {}).reduce((a, b) => a + b, 0),
          topCommands,
          errors: errors.reduce((total, [, e]) => total + e.count, 0),
          topErrors: errors.slice(0, 6).map(([key, e]) => [key, e.count, e.last]),
          joined: today.joined ?? 0,
          left: today.left ?? 0,
          blocked: today.blocked ?? 0,
          floods: today.floods ?? 0,
          alerts: today.alerts ?? 0,
          permWarnings: today.permWarnings ?? 0,
        }
      : null,
  };
}

function buildServers(client) {
  const world = new Map(storage.allScoped('world').map((e) => [e.guildId, e.data]));
  const eco = new Map(storage.allScoped('economy').map((e) => [e.guildId, e.data]));
  return [...client.guilds.cache.values()]
    .map((g) => ({
      id: g.id,
      name: g.name,
      members: g.memberCount ?? 0,
      ownerId: g.ownerId,
      joinedAt: g.joinedTimestamp ?? null,
      players: Object.values(eco.get(g.id) ?? {}).filter((u) => u && typeof u === 'object').length,
      listed: world.get(g.id)?.settings?.website !== false, // shown on the public website pages
      blocked: Boolean(blacklist.isGuildBlocked(g.id)),
    }))
    .sort((a, b) => b.members - a.members)
    .slice(0, MAX_SERVERS);
}

function buildConfig(commands) {
  const { users, guilds } = blacklist.list();
  const row = ([id, e]) => ({ id, name: e.name ?? '', reason: e.reason ?? '', by: e.by ?? '', at: e.at ?? 0 });
  const inbox = require('./inbox');
  return {
    blacklist: { users: users.map(row), guilds: guilds.map(row) },
    inbox: { report: inbox.getChannelId('report'), feedback: inbox.getChannelId('feedback') },
    commands: [...commands.values()]
      .filter((c) => c.access === 'free')
      .map((c) => ({
        name: c.name.replace(/^!!/, ''),
        protected: access.isProtected(c),
        description: String(c.description ?? '').slice(0, 140),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const buildGuilds = (client) => [...client.guilds.cache.values()].map((g) => [g.id, g.name]);

async function publish(client, commands) {
  const rows = [
    stateRow('overview', buildOverview(client, commands)),
    stateRow('servers', buildServers(client)),
    stateRow('users', await buildUsers(client)),
    stateRow('config', buildConfig(commands)),
    stateRow('settings', adminState.snapshot()),
    stateRow('guilds', buildGuilds(client)),
  ];
  await withRetry(() => db.batch(rows, 'write'));
}

// ---------- What the website can ask for ----------

const shortName = (name) => String(name).replace(/^!!/, '').toLowerCase();

const ACTIONS = {
  async maintenance({ on, message }) {
    adminState.setMaintenance(Boolean(on), message);
    return on ? 'Maintenance mode is ON (everyone except the owner is blocked)' : 'Maintenance mode is OFF';
  },

  async command({ name, on }, { commands, by }) {
    const key = shortName(name);
    const exists = [...commands.values()].some((c) => c.access === 'free' && shortName(c.name) === key);
    if (!exists) throw new Error(`There is no command called !!${key}`);
    if (access.isProtected(key)) throw new Error(`!!${key} is protected and can't be switched off`);
    adminState.setCommandDisabled(key, !on, by.id);
    return `!!${key} is now ${on ? 'ON' : 'OFF'} for every server`;
  },

  async blacklist({ op, kind, id, reason }, { client, by }) {
    if (!ID.test(String(id))) throw new Error('That is not a valid ID');
    if (id === process.env.OWNER_ID || id === client.user.id) throw new Error("I won't block the owner or myself");
    if (op === 'remove') {
      const had = kind === 'user' ? blacklist.unblockUser(id) : blacklist.unblockGuild(id);
      return had ? `Removed ${id} from the blacklist` : `${id} wasn't on the blacklist`;
    }
    const why = String(reason || '').slice(0, 200) || 'Blocked from the admin panel';
    if (kind === 'user') {
      const name = knownName(client, id);
      blacklist.blockUser(id, why, by.id, name);
      const dmed = await banNotice.dmBannedUser(client, id, why);
      return `Blocked ${name ?? `user ${id}`}${dmed ? ' (ban DM sent)' : " (couldn't DM them)"}`;
    }
    const guild = client.guilds.cache.get(id);
    blacklist.blockGuild(id, why, by.id, guild?.name);
    if (guild) await banNotice.noticeAndLeave(guild, why);
    return `Blocked server ${guild?.name ?? id}${guild ? ' and left it' : ''}`;
  },

  async broadcast({ title, text }, { client }) {
    const announce = require('./announce');
    const count = announce.channelIds().length;
    if (!count) throw new Error('No server has set an events channel yet');
    const embed = new EmbedBuilder()
      .setColor(0xe0b84a)
      .setTitle(`📢 ${String(title).slice(0, 240)}`)
      .setDescription(String(text).slice(0, 3000))
      .setFooter({ text: 'Announcement from the bot owner' })
      .setTimestamp();
    await announce.broadcast(client, { embeds: [embed] });
    return `Sent to ${count} events channel${count === 1 ? '' : 's'}`;
  },

  async guildSettings({ guildId, changes }, { client, commands, by }) {
    return require('./guildSettings').apply(client, commands, guildId, by.id, changes);
  },

  async modAction(payload, { client, by }) {
    return require('./webMod').run(client, by.id, payload);
  },
  
  async coins({ guildId, userId, mode, amount }, { client }) {
    if (!ID.test(String(guildId)) || !ID.test(String(userId))) throw new Error('Bad server or user ID');
    if (!['add', 'remove', 'set'].includes(mode)) throw new Error('Bad mode');
    const n = Math.floor(Number(amount));
    if (!Number.isFinite(n) || n < 0 || n > MAX_COINS) throw new Error('Bad amount');

    const entry = storage.allScoped('economy').find((e) => e.guildId === guildId);
    if (!entry?.data?.[userId] || typeof entry.data[userId] !== 'object') {
      throw new Error('That player has no account in that server yet');
    }

    const summary = storage.runIn(guildId, () => {
      const economy = require('./economy');
      const user = economy.getUser(userId);
      const before = user.coins;
      user.coins = mode === 'set' ? n : mode === 'add' ? before + n : Math.max(0, before - n);
      economy.saveNow();
      return `${before.toLocaleString('en-US')} → ${user.coins.toLocaleString('en-US')} coins`;
    });
    await storage.flush(); // write it to the database right away so the website shows the new balance
    const name = client.guilds.cache.get(guildId)?.name ?? guildId;
    return `${summary} (${name})`;
  },

  async wipeUser({ guildId, userId }) {
    if (!ID.test(String(guildId || '')) || !ID.test(String(userId || ''))) {
      throw new Error('Pick a server and a user');
    }
    const { wipeUserInGuild } = require('./userWipe');
    wipeUserInGuild(String(guildId), String(userId));
    storage.runIn(String(guildId), () => {
      require('./optOut').optOut(String(userId));
    });
    await storage.flush();
    return `Wiped user ${userId} in ${guildId} and marked opted out`;
  },

  async wipeGuild({ guildId }) {
    if (!ID.test(String(guildId || ''))) throw new Error('Pick a server');
    const { wipeGuild } = require('./guildData');
    const result = await wipeGuild(String(guildId));
    return `Wiped server ${guildId} (${result.rows} rows)`;
  },

  async topggVote({ userId, weight, isWeekend }, { client }) {
    const uid = String(userId || '');
    if (!/^\d{17,20}$/.test(uid)) throw new Error('Bad user id');

    const { grantVoteReward, payVoteCoinsInGuilds, isTopggWeekend } = require('./vote');
    const activity = require('./activity');
    const storage = require('./storage');

    // Never trust webhook weight for 2× — ask top.gg (or assume weekday)
    let weekend = false;
    try {
      weekend = await isTopggWeekend();
    } catch (_) {
      weekend = false;
    }
    const w = weekend ? 2 : 1;

    // Claim + buff once; coins paid per guild below
    const r = grantVoteReward(uid, w, { skipPay: true });
    if (!r.ok) return `Vote cooldown for ${uid}`;

    let paid = payVoteCoinsInGuilds(uid, r.amount, client);

    // Cache miss: pay last-command server and/or first mutual we can resolve
    if (!paid.length) {
      const act = activity.get(uid);
      const fallbackIds = [];
      if (act?.guildId) fallbackIds.push(act.guildId);
      if (client?.guilds?.cache) {
        for (const g of client.guilds.cache.values()) {
          if (fallbackIds.includes(g.id)) continue;
          const m = await g.members.fetch(uid).catch(() => null);
          if (m) fallbackIds.push(g.id);
          if (fallbackIds.length >= 15) break; // safety
        }
      }
      for (const gid of fallbackIds) {
        try {
          storage.runIn(gid, () => {
            require('./economy').addCoins(uid, r.amount, { transfer: true });
          });
          if (!paid.includes(gid)) paid.push(gid);
        } catch (_) {}
      }
    }

    // Notify — never throw if this fails
    const act = activity.get(uid);
    const buffPct = Math.round(((r.buffMult || 1.1) - 1) * 100);
    const buffH = r.buffHours || 1;
    const text =
      `<@${uid}> thanks for voting on top.gg!\n` +
      `**+${r.amount}** coins` +
      (r.weekend ? ' (**weekend 2×**)' : '') +
      ` in **${paid.length || 0}** server(s)` +
      ` · **+${buffPct}%** earn buff for **${buffH}h**.`;

    let notified = false;
    if (client && act?.channelId) {
      const ch = await client.channels.fetch(act.channelId).catch(() => null);
      if (ch?.isTextBased?.()) {
        await ch.send({ content: text }).catch(() => {});
        notified = true;
      }
    }
    if (!notified && client) {
      const user = await client.users.fetch(uid).catch(() => null);
      if (user) {
        await user.send({ content: text.replace(`<@${uid}> `, '') }).catch(() => {});
      }
    }

    return (
      `Vote reward ${r.amount} coins → ${uid} ×${paid.length || 0} servers` +
      (r.weekend ? ' (weekend)' : '')
    );
  },
};

const QUIET = new Set(['guildSettings', 'modAction']); // dashboard actions by server admins (not owner tools)

let busy = false;
let lastCleanup = 0;

async function processQueue(client, commands) {
  if (busy) return;
  busy = true;
  try {
    const now = Date.now();
    await withRetry(() =>
      db.execute({ sql: "UPDATE admin_queue SET status = 'expired', done_at = ? WHERE status = 'pending' AND created < ?", args: [now, now - EXPIRE_MS] })
    );
    const rows = (
      await withRetry(() => db.execute("SELECT id, action, payload, by_id, by_name FROM admin_queue WHERE status = 'pending' ORDER BY id LIMIT 10"))
    ).rows;

    for (const row of rows) {
      let status = 'done';
      let result = '';
      const by = { id: String(row.by_id ?? ''), name: String(row.by_name ?? '') };
      try {
        const handler = ACTIONS[String(row.action)];
        if (!handler) throw new Error('Unknown action');
        result = await handler(JSON.parse(String(row.payload)), { client, commands, by });
        if (!QUIET.has(String(row.action))) await publish(client, commands).catch(() => {}); // so the admin page sees the change straight away
      } catch (err) {
        status = 'error';
        result = String(err?.message ?? err).slice(0, 300);
      }
      // Retried harder, because if this write is lost the request would be picked up and run again
      await withRetry(
        () =>
          db.execute({
            sql: 'UPDATE admin_queue SET status = ?, result = ?, done_at = ? WHERE id = ?',
            args: [status, String(result).slice(0, 500), Date.now(), row.id],
          }),
        5
      );
      logging(QUIET.has(String(row.action)) ? 'info' : 'warn', 'Admin panel action', `${row.action} by ${by.name || by.id} (${by.id}) · ${status}: ${result}`);
    }

    if (now - lastCleanup > 60 * 60 * 1000) {
      lastCleanup = now;
      await withRetry(() => db.execute({ sql: 'DELETE FROM admin_queue WHERE created < ?', args: [now - KEEP_MS] }));
    }
  } finally {
    busy = false;
  }
}

// ---------- Start ----------

async function start(client, commands) {
  if (!connect()) {
    console.log('Admin panel link is off (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are not set)');
    return;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      await ensureTables();
      await loadSettings();
      break;
    } catch (err) {
      if (attempt >= 5) {
        logging('error', 'Admin panel link could not start', err);
        return;
      }
      await sleep(5000 * attempt);
    }
  }

  trackUsers(client);
  
  // Each job counts its own failures. One-off blips are ignored; it only warns after 3 failed runs in a row, once per streak.
  const run = (name, fn) => {
    let streak = 0;
    return async () => {
      try {
        await fn();
        streak = 0;
      } catch (err) {
        streak++;
        if (streak === 3) logging('warn', `Admin panel link problem (${name})`, `${reason(err)} (3 failures in a row)`);
      }
    };
  };
  const doPublish = run('publish', () => publish(client, commands));
  await doPublish();
  setInterval(doPublish, PUBLISH_MS).unref();
  setInterval(run('queue', () => processQueue(client, commands)), QUEUE_MS).unref();
  console.log('Admin panel link ready');
}

module.exports = { start };
