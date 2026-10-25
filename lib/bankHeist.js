// Bank heist minigame: infiltrate → drill the vault (heat management) → escape → getaway (read the police radio).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { peekUser, getUser, fmt, markDirty } = require('./economy');
const { bankOf, stealFromBank, ensureBank } = require('./bank');
const { isRobEnabled } = require('./serverSettings');

const W = 11;
const H = 9;
const SESSION_MS = 12 * 60 * 1000;
const COOLDOWN_MS = 3 * 60 * 60 * 1000;
const MIN_BANK = 400;
const MAX_STEAL_PCT = 0.22;
const MIN_STEAL = 50;
const MAX_STEAL = 8000;

// Drill tuning
const DRILL = {
  normal: { gain: 18, heat: 22 },
  power: { gain: 30, heat: 45 },
};
const COOL = 35; // heat removed by cooling down
const OVERHEAT_AT = 100; // heat above this = overheat
const OVERHEAT_LOSS = 15; // % progress lost on overheat
const PATROL_START = 8; // actions before the patrol finds you

const ROUTES = [
  { name: 'Alley', emoji: '🏚️' },
  { name: 'Highway', emoji: '🛣️' },
  { name: 'Sewers', emoji: '🕳️' },
  { name: 'Rooftops', emoji: '🏙️' },
  { name: 'Metro', emoji: '🚇' },
  { name: 'Docks', emoji: '⚓' },
];

const sessions = new Map(); // id -> session
const byUser = new Map(); // userId -> sessionId

const WALL = '#';
const FLOOR = '·';

const TILE = {
  wall: '⬛',
  floor: '⬜',
  player: '🥷',
  guard: '💂',
  vault: '🏦',
  vaultOpen: '💰',
  exit: '🚪',
};

const PHASES = {
  infiltrate: { title: '🏦 Bank Heist · Infiltrate', color: 0x3498db },
  drill: { title: '🔐 Bank Heist · Crack the vault', color: 0xf1c40f },
  escape: { title: '🏃 Bank Heist · Escape!', color: 0xe67e22 },
  getaway: { title: '🚓 Bank Heist · Getaway', color: 0x9b59b6 },
};

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < W && y < H;
}

function idx(x, y) {
  return y * W + x;
}

function neighbors(x, y) {
  return [
    [x, y - 1],
    [x, y + 1],
    [x - 1, y],
    [x + 1, y],
  ].filter(([a, b]) => inBounds(a, b));
}

function bfs(walkable, start, goal) {
  const [sx, sy] = start;
  const [gx, gy] = goal;
  const q = [[sx, sy]];
  const prev = new Map([[idx(sx, sy), null]]);
  while (q.length) {
    const [x, y] = q.shift();
    if (x === gx && y === gy) {
      const path = [];
      let cur = idx(gx, gy);
      while (cur != null) {
        path.push([cur % W, Math.floor(cur / W)]);
        cur = prev.get(cur);
      }
      return path.reverse();
    }
    for (const [nx, ny] of neighbors(x, y)) {
      const i = idx(nx, ny);
      if (prev.has(i) || !walkable[i]) continue;
      prev.set(i, idx(x, y));
      q.push([nx, ny]);
    }
  }
  return null;
}

/** Carve a solvable bank layout. Retries until path start→vault→exit exists. */
function generateMap(rng) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const cells = Array(W * H).fill(WALL);
    const rooms = [];

    const tryRoom = (cx, cy, rw, rh) => {
      if (cx - rw < 1 || cy - rh < 1 || cx + rw >= W - 1 || cy + rh >= H - 1) return null;
      for (let y = cy - rh; y <= cy + rh; y++) {
        for (let x = cx - rw; x <= cx + rw; x++) cells[idx(x, y)] = FLOOR;
      }
      return { x: cx, y: cy };
    };

    const anchors = [
      [2 + (rng() * 2) | 0, 2 + (rng() * 2) | 0],
      [W - 3 - ((rng() * 2) | 0), 2 + (rng() * 2) | 0],
      [2 + (rng() * 2) | 0, H - 3 - ((rng() * 2) | 0)],
      [W - 3 - ((rng() * 2) | 0), H - 3 - ((rng() * 2) | 0)],
      [((W / 2) | 0) + ((rng() * 3) | 0) - 1, ((H / 2) | 0) + ((rng() * 3) | 0) - 1],
    ];
    for (const [cx, cy] of anchors) {
      const r = tryRoom(cx, cy, 1 + ((rng() * 2) | 0), 1);
      if (r) rooms.push(r);
    }
    if (rooms.length < 3) continue;

    const corridor = (x1, y1, x2, y2) => {
      let x = x1;
      let y = y1;
      while (x !== x2) {
        cells[idx(x, y)] = FLOOR;
        x += x2 > x ? 1 : -1;
      }
      while (y !== y2) {
        cells[idx(x, y)] = FLOOR;
        y += y2 > y ? 1 : -1;
      }
      cells[idx(x, y)] = FLOOR;
    };

    for (let i = 1; i < rooms.length; i++) {
      corridor(rooms[0].x, rooms[0].y, rooms[i].x, rooms[i].y);
    }
    for (let i = 1; i < rooms.length - 1; i++) {
      if (rng() < 0.5) corridor(rooms[i].x, rooms[i].y, rooms[i + 1].x, rooms[i + 1].y);
    }

    const start = { x: rooms[2].x, y: rooms[2].y };
    const vaultRoom = rooms[0];
    const exitRoom = rooms[Math.min(3, rooms.length - 1)];
    const vault = { x: vaultRoom.x, y: vaultRoom.y };
    const exit = { x: exitRoom.x, y: exitRoom.y };

    const walkable = cells.map((c) => c === FLOOR);
    const toVault = bfs(walkable, [start.x, start.y], [vault.x, vault.y]);
    const toExit = bfs(walkable, [vault.x, vault.y], [exit.x, exit.y]);
    if (!toVault || !toExit || toVault.length < 3) continue;

    const guards = [];
    const pathSet = new Set(toVault.map(([x, y]) => idx(x, y)));
    const candidates = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = idx(x, y);
        if (!walkable[i]) continue;
        if (i === idx(start.x, start.y) || i === idx(vault.x, vault.y) || i === idx(exit.x, exit.y)) continue;
        candidates.push([x, y]);
      }
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const want = 2 + ((rng() * 2) | 0);
    for (const [x, y] of candidates) {
      if (guards.length >= want) break;
      if (pathSet.has(idx(x, y)) && rng() < 0.55) continue;
      guards.push({ x, y, hp: 1 + ((rng() * 2) | 0) });
    }
    if (guards.length < 1) {
      const [x, y] = candidates[0] || [vault.x, start.y];
      if (x != null) guards.push({ x, y, hp: 1 });
    }

    return {
      cells,
      start,
      vault,
      exit,
      guards,
      player: { ...start },
      drilled: false,
      loot: 0,
      alarm: false,
      kills: 0,
      moves: 0,
    };
  }
  // Fallback corridor map
  const cells = Array(W * H).fill(WALL);
  for (let x = 1; x < W - 1; x++) {
    cells[idx(x, 4)] = FLOOR;
    cells[idx(x, 3)] = FLOOR;
  }
  for (let y = 1; y < H - 1; y++) cells[idx(5, y)] = FLOOR;
  return {
    cells,
    start: { x: 1, y: 4 },
    vault: { x: W - 2, y: 4 },
    exit: { x: 1, y: 3 },
    guards: [
      { x: 5, y: 4, hp: 2 },
      { x: 7, y: 3, hp: 1 },
    ],
    player: { x: 1, y: 4 },
    drilled: false,
    loot: 0,
    alarm: false,
    kills: 0,
    moves: 0,
  };
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Drawing ----------

function renderGrid(map) {
  const { player, vault, exit, guards, cells, drilled } = map;
  const guardAt = new Set(guards.filter((g) => g.hp > 0).map((g) => idx(g.x, g.y)));
  const rows = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (player.x === x && player.y === y) row += TILE.player;
      else if (guardAt.has(i)) row += TILE.guard;
      else if (vault.x === x && vault.y === y) row += drilled ? TILE.vaultOpen : TILE.vault;
      else if (exit.x === x && exit.y === y) row += TILE.exit;
      else row += cells[i] === WALL ? TILE.wall : TILE.floor;
    }
    rows.push(row);
  }
  return rows.join('\n');
}

const hearts = (hp) => '❤️'.repeat(Math.max(0, hp)) + '🖤'.repeat(Math.max(0, 3 - hp));

function progressBar(pct) {
  const full = Math.round((pct / 100) * 10);
  return '▰'.repeat(full) + '▱'.repeat(10 - full);
}

function heatBar(heat) {
  const filled = Math.min(10, Math.ceil(heat / 10));
  let out = '';
  for (let i = 0; i < 10; i++) {
    if (i >= filled) out += '⬛';
    else if (i < 5) out += '🟩';
    else if (i < 7) out += '🟨';
    else if (i < 9) out += '🟧';
    else out += '🟥';
  }
  return out;
}

const listNames = (names) => {
  const bold = names.map((n) => `**${n}**`);
  return bold.length <= 1 ? bold.join('') : `${bold.slice(0, -1).join(', ')} and ${bold[bold.length - 1]}`;
};

function walkText(s) {
  const map = s.map;
  const left = map.guards.filter((g) => g.hp > 0).length;
  const goal = map.drilled
    ? '💰 The vault is open and the alarm is blaring! Get to the exit 🚪 with the loot.'
    : 'Reach the vault 🏦 and crack it, then escape through the exit 🚪.';
  return [
    `**Goal:** ${goal}`,
    `🥷 you · 💂 guard (${left} left) · 🏦 vault · 🚪 exit`,
    '',
    'Walk with the arrow buttons. Walking into a guard starts a fight: you win a round about 60% of the time (45% once the alarm is on), and some guards take two hits.',
  ].join('\n');
}

function drillText(s) {
  const d = s.drill;
  return [
    '**Goal:** drill through the vault door (reach **100%**) before the patrol finds you.',
    '',
    `⛏️ **Progress** ${progressBar(d.progress)} **${d.progress}%**`,
    `🌡️ **Heat** ${heatBar(d.heat)} **${d.heat}/${OVERHEAT_AT}**`,
    `🚨 **Patrol** arrives in **${d.patrol}** action${d.patrol === 1 ? '' : 's'}`,
    '',
    `⛏️ **Drill:** +${DRILL.normal.gain}% progress, +${DRILL.normal.heat} heat`,
    `⚡ **Power drill:** +${DRILL.power.gain}% progress, +${DRILL.power.heat} heat`,
    `❄️ **Cool down:** −${COOL} heat (still uses up an action)`,
    '',
    `*Go over ${OVERHEAT_AT} heat and the drill overheats: −1 HP, the alarm trips and you lose ${OVERHEAT_LOSS}% progress. A red button means pressing it would overheat the drill.*`,
  ].join('\n');
}

function getawayText(s) {
  const g = s.getaway;
  return [
    `**Goal:** lose the police in **${g.legs}** legs. You are on leg **${g.leg + 1}/${g.legs}**.`,
    '',
    `📻 *Dispatch: all units are heading to the ${listNames(g.blocked)}!*`,
    '',
    'Pick a route the police are **not** covering. A covered route costs you 1 HP and the leg starts over.',
  ].join('\n');
}

function buildView(s) {
  const map = s.map;
  const phase = s.phase;
  const meta = PHASES[phase];
  const embed = new EmbedBuilder().setColor(map.alarm ? 0xe74c3c : meta.color).setTitle(meta.title);

  let desc;
  if (phase === 'drill') desc = drillText(s);
  else if (phase === 'getaway') desc = getawayText(s);
  else desc = walkText(s);
  if (s.note) desc += `\n\n📣 ${s.note}`;
  embed.setDescription(desc);

  const fields = [
    { name: '❤️ Health', value: hearts(s.hp), inline: true },
    { name: '🎯 Target', value: `<@${s.targetId}>'s vault`, inline: true },
    { name: map.alarm ? '🚨 Alarm' : '🔕 Alarm', value: map.alarm ? '**ON**' : 'Quiet', inline: true },
  ];
  if (map.loot) fields.push({ name: '💰 Carrying', value: `**${fmt(map.loot)}**`, inline: true });
  else if (phase !== 'getaway') fields.push({ name: '💰 Up to', value: `**${fmt(s.maxLoot)}**`, inline: true });
  embed.addFields(fields);
  embed.setFooter({ text: 'Hard heist · fail and you pay a fine · cooldown 3h' });

  const id = s.id;
  const rows = [];

  if (phase === 'infiltrate' || phase === 'escape') {
    const pad = (n) =>
      new ButtonBuilder().setCustomId(`bankheist:${id}:pad${n}`).setLabel('⠀').setStyle(ButtonStyle.Secondary).setDisabled(true);
    const arrow = (dir, emoji) =>
      new ButtonBuilder().setCustomId(`bankheist:${id}:${dir}`).setEmoji(emoji).setStyle(ButtonStyle.Primary);
    rows.push(new ActionRowBuilder().addComponents(pad(1), arrow('n', '⬆️'), pad(2)));
    rows.push(
      new ActionRowBuilder().addComponents(
        arrow('w', '⬅️'),
        arrow('s', '⬇️'),
        arrow('e', '➡️'),
        new ButtonBuilder().setCustomId(`bankheist:${id}:abort`).setLabel('Abort').setStyle(ButtonStyle.Danger)
      )
    );
  } else if (phase === 'drill') {
    const d = s.drill;
    const risky = (kind) => d.heat + DRILL[kind].heat > OVERHEAT_AT;
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bankheist:${id}:drill:normal`)
          .setLabel(`Drill +${DRILL.normal.gain}%`)
          .setEmoji('⛏️')
          .setStyle(risky('normal') ? ButtonStyle.Danger : ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`bankheist:${id}:drill:power`)
          .setLabel(`Power drill +${DRILL.power.gain}%`)
          .setEmoji('⚡')
          .setStyle(risky('power') ? ButtonStyle.Danger : ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`bankheist:${id}:drill:cool`)
          .setLabel('Cool down')
          .setEmoji('❄️')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`bankheist:${id}:abort`).setLabel('Abort').setEmoji('🏳️').setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (phase === 'getaway') {
    rows.push(
      new ActionRowBuilder().addComponents(
        ...s.getaway.routes.map((r, i) =>
          new ButtonBuilder().setCustomId(`bankheist:${id}:go:${i}`).setLabel(r.name).setEmoji(r.emoji).setStyle(ButtonStyle.Primary)
        )
      )
    );
  }

  const content = phase === 'infiltrate' || phase === 'escape' ? renderGrid(map) : '';
  return { content, embeds: [embed], components: rows };
}

// ---------- Ending ----------

function endSession(s, payload) {
  sessions.delete(s.id);
  byUser.delete(s.userId);
  return payload;
}

function failHeist(s, reason) {
  const fine = Math.min(peekUser(s.userId).coins, 80 + s.map.moves * 5 + (s.map.loot ? 100 : 0));
  if (fine > 0) {
    getUser(s.userId).coins -= fine;
    markDirty();
  }
  getUser(s.userId).lastBankHeist = Date.now();
  markDirty();
  return endSession(s, {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🚔 Heist failed')
        .setDescription(`${reason}\n\n💸 Fine: **${fmt(fine)}**\n⏳ You can try another vault <t:${Math.ceil((Date.now() + COOLDOWN_MS) / 1000)}:R>.`),
    ],
    components: [],
  });
}

function winHeist(s) {
  const loot = s.map.loot;
  getUser(s.userId).lastBankHeist = Date.now();
  markDirty();
  try {
    require('./world').logEvent(`🏦 <@${s.userId}> cracked <@${s.targetId}>'s bank vault for ${fmt(loot)}`);
  } catch (_) {}
  return endSession(s, {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('💰 Heist complete!')
        .setDescription(
          `You got away with **${fmt(loot)}** from <@${s.targetId}>'s bank.\n` +
            `Pocket now: **${fmt(peekUser(s.userId).coins)}**.\n` +
            `Lay low until <t:${Math.ceil((Date.now() + COOLDOWN_MS) / 1000)}:R>.`
        ),
    ],
    components: [],
  });
}

// ---------- Phases ----------

function startDrill(s) {
  s.phase = 'drill';
  s.drill = { progress: 0, heat: 0, patrol: PATROL_START };
}

// One drill action. Returns { done } | { dead, reason } | { note }
function drillStep(s, kind) {
  const d = s.drill;
  let note = '';

  if (kind === 'cool') {
    d.heat = Math.max(0, d.heat - COOL);
    note = '❄️ You let the drill cool down.';
  } else {
    const t = DRILL[kind];
    d.progress = Math.min(100, d.progress + t.gain);
    d.heat += t.heat;
    note = kind === 'power' ? '⚡ The power drill screams through the metal.' : '⛏️ The drill bites into the door.';

    if (d.heat > OVERHEAT_AT) {
      s.hp -= 1;
      s.map.alarm = true;
      d.progress = Math.max(0, d.progress - OVERHEAT_LOSS);
      d.heat = 60;
      note = `💥 The drill overheated! −1 HP, the alarm is ringing and you lost ${OVERHEAT_LOSS}% progress.`;
      if (s.hp <= 0) return { dead: true, reason: 'The overheated drill blew up in your hands.' };
    }
  }

  if (d.progress >= 100) return { done: true };

  d.patrol -= 1;
  if (d.patrol <= 0) {
    s.hp -= 1;
    s.map.alarm = true;
    d.patrol = 3;
    note += ' 🚨 The patrol found you! −1 HP. You have 3 actions before they are back.';
    if (s.hp <= 0) return { dead: true, reason: 'The patrol caught you at the vault door.' };
  }
  return { note };
}

function startGetaway(s) {
  s.phase = 'getaway';
  s.getaway = { leg: 0, legs: 3, routes: [], blocked: [] };
  rollLeg(s);
}

// Later legs have more routes covered (1, then 2, then 3 of 4), so there is always at least one safe route
function rollLeg(s) {
  const g = s.getaway;
  const routes = shuffle([...ROUTES]).slice(0, 4);
  const coveredCount = Math.min(3, 1 + g.leg);
  g.blocked = routes.slice(0, coveredCount).map((r) => r.name);
  g.routes = shuffle(routes);
}

function movePlayer(s, dir) {
  const map = s.map;
  const dx = dir === 'e' ? 1 : dir === 'w' ? -1 : 0;
  const dy = dir === 's' ? 1 : dir === 'n' ? -1 : 0;
  const nx = map.player.x + dx;
  const ny = map.player.y + dy;
  if (!inBounds(nx, ny) || map.cells[idx(nx, ny)] === WALL) {
    return { ok: false, msg: '🧱 That is a wall.' };
  }

  const guard = map.guards.find((g) => g.hp > 0 && g.x === nx && g.y === ny);
  if (guard) {
    const win = Math.random() < (map.alarm ? 0.45 : 0.62);
    map.moves++;
    if (win) {
      guard.hp -= 1;
      if (guard.hp <= 0) {
        map.kills++;
        map.player.x = nx;
        map.player.y = ny;
        if (Math.random() < 0.35) map.alarm = true;
        return { ok: true, msg: '💥 Guard down!' };
      }
      return { ok: true, msg: '🥊 You wounded the guard. Hit them again!' };
    }
    s.hp -= 1;
    map.alarm = true;
    if (s.hp <= 0) return { ok: false, dead: true, msg: 'The guards dropped you.' };
    return { ok: true, msg: '🩸 The guard hit you! The alarm is on.' };
  }

  map.player.x = nx;
  map.player.y = ny;
  map.moves++;

  // Alarm patrol: guards sometimes step toward the player
  if (map.alarm && Math.random() < 0.4) {
    for (const g of map.guards.filter((g) => g.hp > 0)) {
      const gx = g.x + Math.sign(map.player.x - g.x);
      const gy = g.y + Math.sign(map.player.y - g.y);
      const tryX = Math.random() < 0.5 ? gx : g.x;
      const tryY = tryX === g.x ? gy : g.y;
      if (inBounds(tryX, tryY) && map.cells[idx(tryX, tryY)] !== WALL) {
        if (!(tryX === map.player.x && tryY === map.player.y)) {
          g.x = tryX;
          g.y = tryY;
        } else {
          s.hp -= 1;
          if (s.hp <= 0) return { ok: false, dead: true, msg: 'A guard caught you on patrol.' };
        }
      }
    }
  }

  if (!map.drilled && map.player.x === map.vault.x && map.player.y === map.vault.y) {
    startDrill(s);
    return { ok: true, msg: '🔐 You reached the vault. Time to drill!' };
  }

  if (map.drilled && map.loot > 0 && map.player.x === map.exit.x && map.player.y === map.exit.y) {
    startGetaway(s);
    return { ok: true, msg: '🚪 Outside! Now lose the police.' };
  }

  return { ok: true };
}

// ---------- Starting and button handling ----------

async function start(message, target) {
  if (!message.guild) return message.reply('Only in a server.');
  if (!isRobEnabled()) return message.reply('Robbing is turned off here.');
  const userId = message.author.id;
  if (target.id === userId) return message.reply("You can't heist your own vault.");
  if (target.bot) return message.reply("Bots don't use the bank.");

  if (byUser.has(userId)) return message.reply('You already have a heist in progress.');

  const ready = (peekUser(userId).lastBankHeist || 0) + COOLDOWN_MS;
  if (Date.now() < ready) {
    return message.reply(`⏳ Still laying low. Try again <t:${Math.ceil(ready / 1000)}:R>.`);
  }

  ensureBank(getUser(target.id));
  const bal = bankOf(target.id);
  if (bal < MIN_BANK) {
    return message.reply(`Their bank only has **${fmt(bal)}**. Need at least **${fmt(MIN_BANK)}** in the vault to heist.`);
  }

  const seed = (Date.now() ^ Number(userId.slice(-6))) >>> 0;
  const map = generateMap(mulberry32(seed));
  const id = newId();
  const steal = Math.min(MAX_STEAL, Math.max(MIN_STEAL, Math.floor(bal * (0.1 + Math.random() * (MAX_STEAL_PCT - 0.1)))));

  const s = {
    id,
    userId,
    targetId: target.id,
    channelId: message.channel.id,
    hp: 3,
    phase: 'infiltrate',
    map,
    maxLoot: steal,
    note: '',
    expires: Date.now() + SESSION_MS,
  };
  sessions.set(id, s);
  byUser.set(userId, id);

  const msg = await message.reply(buildView(s));
  s.msg = msg;
  setTimeout(() => {
    if (!sessions.has(id)) return;
    const cur = sessions.get(id);
    endSession(cur, null);
    msg.edit({ content: '⏰ Heist timed out.', embeds: [], components: [] }).catch(() => {});
  }, SESSION_MS);
}

async function handleInteraction(interaction) {
  if (!interaction.isButton()) return;
  const id = interaction.customId;
  if (!id.startsWith('bankheist:')) return;

  const parts = id.split(':');
  const sid = parts[1];
  const action = parts[2];
  const s = sessions.get(sid);
  if (!s) {
    return interaction.update({ content: 'This heist is over.', embeds: [], components: [] }).catch(() => {});
  }
  if (interaction.user.id !== s.userId) {
    return interaction.reply({ content: 'Not your heist.', flags: MessageFlags.Ephemeral });
  }
  if (Date.now() > s.expires) {
    return interaction.update(failHeist(s, 'You took too long, security locked down.'));
  }

  s.note = '';

  if (action === 'abort') {
    return interaction.update(failHeist(s, 'You aborted the job.'));
  }

  // Walking
  if (['n', 's', 'e', 'w'].includes(action)) {
    if (s.phase !== 'infiltrate' && s.phase !== 'escape') return interaction.update(buildView(s));
    const r = movePlayer(s, action);
    if (r.dead) return interaction.update(failHeist(s, r.msg));
    s.note = r.msg || '';
    return interaction.update(buildView(s));
  }

  // Drilling
  if (action === 'drill') {
    if (s.phase !== 'drill') return interaction.update(buildView(s));
    const kind = parts[3];
    if (!['normal', 'power', 'cool'].includes(kind)) return interaction.update(buildView(s));

    const r = drillStep(s, kind);
    if (r.dead) return interaction.update(failHeist(s, r.reason));
    if (r.done) {
      s.map.drilled = true;
      const taken = stealFromBank(s.targetId, s.userId, s.maxLoot);
      s.map.loot = taken;
      if (taken < 1) return interaction.update(failHeist(s, 'The vault was empty after all.'));
      s.phase = 'escape';
      s.map.alarm = true;
      s.note = '🔓 **The vault door swings open!** Grab the cash and run for the exit.';
      return interaction.update(buildView(s));
    }
    s.note = r.note || '';
    return interaction.update(buildView(s));
  }

  // Getaway
  if (action === 'go') {
    if (s.phase !== 'getaway') return interaction.update(buildView(s));
    const g = s.getaway;
    const route = g.routes[Number(parts[3])];
    if (!route) return interaction.update(buildView(s));

    if (g.blocked.includes(route.name)) {
      s.hp -= 1;
      if (s.hp <= 0) {
        const loss = Math.floor((s.map.loot || 0) * 0.5);
        if (loss > 0) {
          getUser(s.userId).coins = Math.max(0, getUser(s.userId).coins - loss);
          ensureBank(getUser(s.targetId)).bank += loss;
          markDirty();
        }
        return interaction.update(failHeist(s, 'Police boxed you in. Half the loot was recovered.'));
      }
      rollLeg(s);
      s.note = `🚔 The ${route.name} was crawling with cops! −1 HP. The police moved, so check the new dispatch.`;
      return interaction.update(buildView(s));
    }

    g.leg++;
    if (g.leg >= g.legs) return interaction.update(winHeist(s));
    rollLeg(s);
    s.note = `✅ You slipped through the ${route.name}.`;
    return interaction.update(buildView(s));
  }

  return interaction.update(buildView(s));
}

module.exports = { start, handleInteraction, COOLDOWN_MS, MIN_BANK };
