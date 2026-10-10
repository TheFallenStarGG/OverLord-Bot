const { FILES } = require('../config');
const { readJson, writeJson, allScoped } = require('./storage');
const { levelFromXp } = require('./economy');
const seasons = require('./seasons');
const blacklist = require('./blacklist');
const { ENTRIES } = require('./changelog');

// ---------- Settings you can tweak ----------
const REPO = process.env.WEB_REPO || 'TheFallenStarGG/Overlord-ToS';
const BRANCH = process.env.WEB_BRANCH || 'data';
const TOP = 50; // names listed on each leaderboard
const SERVER_TOP_PLAYERS = 5; // a server's score = its richest players added up
const SERVER_MIN_PLAYERS = 3; // players with MIN_COINS a server needs to be listed
const SERVER_MIN_COINS = 100;

// ---------- People who hid themselves from the website ----------
const hidden = readJson(FILES.webhide, {});
const saveHidden = () => writeJson(FILES.webhide, hidden);
saveHidden();

const isHidden = (id) => Boolean(hidden[id]);
function setHidden(id, on) {
  if (on) hidden[id] = 1;
  else delete hidden[id];
  saveHidden();
}

// ---------- Building the data ----------

// Every server the bot is in, unless its admins ran "!!settings website off"
function listedGuilds(client) {
  const world = new Map(allScoped('world').map((e) => [e.guildId, e.data]));
  return [...client.guilds.cache.values()].filter(
    (guild) => world.get(guild.id)?.settings?.website !== false && !blacklist.isGuildBlocked(guild.id)
  );
}

async function nameOf(client, id) {
  const user = client.users.cache.get(id) ?? (await client.users.fetch(id).catch(() => null));
  if (!user || user.bot) return null;
  return String(user.globalName || user.username).slice(0, 40);
}

// Turns a sorted [{ id, ... }] list into named rows (skips bots and accounts that no longer exist)
async function nameRows(client, list, make) {
  const rows = [];
  for (const entry of list) {
    if (rows.length >= TOP) break;
    const name = await nameOf(client, entry.id);
    if (name) rows.push(make(entry, name));
  }
  return rows;
}

async function buildLeaderboards(client) {
  const guilds = listedGuilds(client);
  const eco = new Map(allScoped('economy').map((e) => [e.guildId, e.data]));
  const sea = new Map(allScoped('seasons').map((e) => [e.guildId, e.data]));
  const key = seasons.seasonKey();

  const coins = new Map();
  const xp = new Map();
  const score = new Map();
  const servers = [];

  for (const guild of guilds) {
    const users = Object.entries(eco.get(guild.id) ?? {}).filter(
      ([id, u]) => u && typeof u === 'object' && !blacklist.isUserBlocked(id)
    );

    // All-time players (everyone's servers added together)
    for (const [id, u] of users) {
      if (isHidden(id)) continue;
      coins.set(id, (coins.get(id) ?? 0) + (u.coins ?? 0));
      xp.set(id, (xp.get(id) ?? 0) + (u.xp ?? 0));
    }

    // Server score: the combined coins of its richest players (hidden players still count, unnamed)
    const rich = users.map(([, u]) => u.coins ?? 0).filter((c) => c >= SERVER_MIN_COINS).sort((a, b) => b - a);
    if (rich.length >= SERVER_MIN_PLAYERS) {
      servers.push({
        name: guild.name.slice(0, 60),
        icon: guild.iconURL({ extension: 'png', size: 64 }),
        score: rich.slice(0, SERVER_TOP_PLAYERS).reduce((a, b) => a + b, 0),
        players: rich.length,
        members: guild.memberCount,
      });
    }

    // This season's scores
    for (const e of seasons.board(sea.get(guild.id) ?? {}, 's', 'sk', key)) {
      if (isHidden(e.id) || blacklist.isUserBlocked(e.id)) continue;
      score.set(e.id, (score.get(e.id) ?? 0) + e.value);
    }
  }

  const ranked = (map) =>
    [...map].map(([id, value]) => ({ id, value })).filter((e) => e.value > 0).sort((a, b) => b.value - a.value);

  const seasonRows = await nameRows(client, ranked(score), (e, name) => ({ name, score: e.value }));
  const coinRows = await nameRows(client, ranked(coins), (e, name) => ({ name, value: e.value }));
  const xpRows = await nameRows(client, ranked(xp), (e, name) => ({ name, value: e.value, level: levelFromXp(e.value) }));
  servers.sort((a, b) => b.score - a.score);

  return {
    generatedAt: new Date().toISOString(),
    serversListed: guilds.length,
    season: { number: seasons.seasonNumber(key), endsAt: new Date(seasons.seasonEnd(key)).toISOString(), players: seasonRows },
    servers: servers.slice(0, TOP),
    players: { coins: coinRows, xp: xpRows },
  };
}

function buildChangelog() {
  return {
    updates: ENTRIES.map((e) => ({
      emoji: e.emoji,
      title: e.title,
      date: e.date,
      summary: e.summary,
      color: '#' + (e.color ?? 0x5865f2).toString(16).padStart(6, '0'),
      sections: e.sections.map((s) => ({ heading: s.heading, items: s.items })),
    })),
  };
}

// ---------- Sending it to GitHub ----------

const last = new Map(); // file -> what we last sent (so unchanged data never makes a commit)

function github(method, file, body) {
  return fetch(`https://api.github.com/repos/${REPO}/contents/${file}${method === 'GET' ? `?ref=${BRANCH}` : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.WEB_GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'OverLorder-Bot',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
}

// Returns true if a new version was saved, false if nothing changed
async function publish(file, text, sameAs) {
  if (last.get(file) === sameAs) return false;

  let sha;
  const get = await github('GET', file);
  if (get.ok) {
    const remote = await get.json();
    sha = remote.sha;
    if (Buffer.from(remote.content ?? '', 'base64').toString('utf8') === text) {
      last.set(file, sameAs);
      return false;
    }
  } else if (get.status !== 404) {
    throw new Error(`GitHub answered ${get.status} while reading ${file}`);
  }

  const put = await github('PUT', file, {
    message: `Update ${file}`,
    content: Buffer.from(text, 'utf8').toString('base64'),
    branch: BRANCH,
    sha,
  });
  if (!put.ok) {
    const hint = put.status === 404 || put.status === 422 ? ` (does the "${BRANCH}" branch exist, and can the token write to ${REPO}?)` : '';
    throw new Error(`GitHub answered ${put.status} while saving ${file}${hint}`);
  }
  last.set(file, sameAs);
  return true;
}

async function exportAll(client) {
  if (!process.env.WEB_GITHUB_TOKEN) return { skipped: 'the WEB_GITHUB_TOKEN environment variable is not set' };

  const changelogText = JSON.stringify(buildChangelog());
  const changelog = await publish('changelog.json', changelogText, changelogText);

  const board = await buildLeaderboards(client);
  const { generatedAt, ...stable } = board;
  const leaderboards = await publish('leaderboards.json', JSON.stringify(board), JSON.stringify(stable));

  return { changelog, leaderboards, servers: board.serversListed, players: board.players.coins.length };
}

module.exports = { exportAll, isHidden, setHidden };
