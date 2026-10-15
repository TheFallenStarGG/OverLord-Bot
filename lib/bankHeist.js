// Bank heist minigame: procedural solvable map → guards → drill → loot → escape → getaway.
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
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

const sessions = new Map(); // id -> session
const byUser = new Map(); // userId -> sessionId

const WALL = '#';
const FLOOR = '·';
const PLAYER = '@';
const GUARD = 'G';
const VAULT = 'V';
const EXIT = 'E';
const START = 'S';

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
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

    // Fixed-ish room anchors with jitter so maps vary but stay completable
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

    // Place 2–3 guards on floor tiles not on critical path choke (allow detour)
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
    // shuffle
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const want = 2 + ((rng() * 2) | 0);
    for (const [x, y] of candidates) {
      if (guards.length >= want) break;
      // Prefer off main path so map stays solvable without fighting every tile
      if (pathSet.has(idx(x, y)) && rng() < 0.55) continue;
      guards.push({ x, y, hp: 1 + ((rng() * 2) | 0) });
    }
    if (guards.length < 1) {
      const [x, y] = candidates[0] || [vault.x, start.y];
      if (x != null) guards.push({ x, y, hp: 1 });
    }

    // Verify still solvable treating guards as floors (you can fight through)
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

function renderGrid(map, fog = false) {
  const lines = [];
  const { player, vault, exit, guards, cells, drilled } = map;
  const guardAt = new Map(guards.filter((g) => g.hp > 0).map((g) => [idx(g.x, g.y), g]));
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (player.x === x && player.y === y) row += PLAYER;
      else if (guardAt.has(i)) row += GUARD;
      else if (vault.x === x && vault.y === y) row += drilled ? '$' : VAULT;
      else if (exit.x === x && exit.y === y) row += EXIT;
      else row += cells[i] === WALL ? '█' : '·';
    }
    lines.push(row);
  }
  return '```\n' + lines.join('\n') + '\n```';
}

function phaseOf(s) {
  if (s.phase) return s.phase;
  return 'infiltrate';
}

function buildView(s) {
  const map = s.map;
  const phase = phaseOf(s);
  const embed = new EmbedBuilder().setColor(0x2c3e50).setTitle('🏦 Bank Heist');

  let desc = renderGrid(map);
  desc += `\n**Target:** <@${s.targetId}>'s vault · **Phase:** ${phase}`;
  if (map.alarm) desc += ' · 🚨 **ALARM**';
  if (map.loot) desc += ` · 💰 carrying **${fmt(map.loot)}**`;
  desc += `\nHP **${s.hp}/3** · Moves **${map.moves}**`;

  if (phase === 'infiltrate' || phase === 'escape') {
    desc +=
      '\n\n**@** you · **G** guard · **V** vault · **E** exit · **█** wall\n' +
      'Move with the buttons. Step onto a guard to fight. Reach **V**, drill, then **E**.';
  }
  if (phase === 'drill') {
    desc += '\n\n🔐 **Drill the vault!** Press the matching codes in order before time runs out.';
  }
  if (phase === 'getaway') {
    desc += '\n\n🚓 **Getaway!** Pick the right moves to lose the police.';
  }

  embed.setDescription(desc);
  embed.setFooter({ text: 'Hard heist · fail and you pay a fine · cooldown 3h' });

  const rows = [];
  if (phase === 'infiltrate' || phase === 'escape') {
    const id = s.id;
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bankheist:${id}:n`).setLabel('N').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bankheist:${id}:s`).setLabel('S').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bankheist:${id}:w`).setLabel('W').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bankheist:${id}:e`).setLabel('E').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bankheist:${id}:abort`).setLabel('Abort').setStyle(ButtonStyle.Danger)
      )
    );
  } else if (phase === 'drill') {
    const opts = s.drillOptions || [];
    rows.push(
      new ActionRowBuilder().addComponents(
        ...opts.map((o, i) =>
          new ButtonBuilder()
            .setCustomId(`bankheist:${s.id}:drill:${i}`)
            .setLabel(o)
            .setStyle(ButtonStyle.Primary)
        )
      )
    );
  } else if (phase === 'getaway') {
    const opts = s.getawayOptions || ['Alley', 'Highway', 'Sewers'];
    rows.push(
      new ActionRowBuilder().addComponents(
        ...opts.map((o, i) =>
          new ButtonBuilder()
            .setCustomId(`bankheist:${s.id}:go:${i}`)
            .setLabel(o)
            .setStyle(ButtonStyle.Success)
        )
      )
    );
  }

  return { embeds: [embed], components: rows };
}

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
    embeds: [
      new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🏦 Heist failed')
        .setDescription(`${reason}\nFine: **${fmt(fine)}**\nYou can try another vault <t:${Math.ceil((Date.now() + COOLDOWN_MS) / 1000)}:R>.`),
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
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🏦 Heist complete!')
        .setDescription(
          `You got away with **${fmt(loot)}** from <@${s.targetId}>'s bank.\n` +
            `Pocket now: **${fmt(peekUser(s.userId).coins)}**.\n` +
            `Lay low until <t:${Math.ceil((Date.now() + COOLDOWN_MS) / 1000)}:R>.`
        ),
    ],
    components: [],
  });
}

function startDrill(s) {
  s.phase = 'drill';
  s.drillStep = 0;
  s.drillSeq = [];
  const codes = ['A1', 'B7', 'C3', 'D9', 'E2', 'F4'];
  for (let i = 0; i < 3; i++) s.drillSeq.push(codes[(Math.random() * codes.length) | 0]);
  s.drillOptions = [...s.drillSeq].sort(() => Math.random() - 0.5);
  // ensure all unique display - pad with decoys
  while (s.drillOptions.length < 4) {
    const c = codes[(Math.random() * codes.length) | 0];
    if (!s.drillOptions.includes(c)) s.drillOptions.push(c);
  }
  s.drillOptions = s.drillOptions.slice(0, 4).sort(() => Math.random() - 0.5);
}

function startGetaway(s) {
  s.phase = 'getaway';
  s.getawayStep = 0;
  s.getawayNeed = 3;
  s.getawayCorrect = [];
  const pool = ['Alley', 'Highway', 'Sewers', 'Rooftops', 'Metro'];
  for (let i = 0; i < 3; i++) {
    s.getawayCorrect.push(pool[(Math.random() * pool.length) | 0]);
  }
  s.getawayOptions = [...new Set([s.getawayCorrect[0], ...pool])].slice(0, 4);
  // shuffle
  s.getawayOptions.sort(() => Math.random() - 0.5);
}

function movePlayer(s, dir) {
  const map = s.map;
  const dx = dir === 'e' ? 1 : dir === 'w' ? -1 : 0;
  const dy = dir === 's' ? 1 : dir === 'n' ? -1 : 0;
  const nx = map.player.x + dx;
  const ny = map.player.y + dy;
  if (!inBounds(nx, ny) || map.cells[idx(nx, ny)] === WALL) {
    return { ok: false, msg: 'Wall.' };
  }

  const guard = map.guards.find((g) => g.hp > 0 && g.x === nx && g.y === ny);
  if (guard) {
    // Fight
    const win = Math.random() < (map.alarm ? 0.45 : 0.62);
    map.moves++;
    if (win) {
      guard.hp -= 1;
      if (guard.hp <= 0) {
        map.kills++;
        map.player.x = nx;
        map.player.y = ny;
        if (Math.random() < 0.35) map.alarm = true;
        return { ok: true, msg: 'Guard down.' };
      }
      return { ok: true, msg: 'You wound the guard — hit them again!' };
    }
    s.hp -= 1;
    map.alarm = true;
    if (s.hp <= 0) return { ok: false, dead: true, msg: 'The guards dropped you.' };
    return { ok: true, msg: 'Guard hit you! Alarm raised.' };
  }

  map.player.x = nx;
  map.player.y = ny;
  map.moves++;

  // Alarm patrol: random guard step toward player sometimes
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
    return { ok: true, msg: 'Vault reached — start the drill!' };
  }

  if (map.drilled && map.loot > 0 && map.player.x === map.exit.x && map.player.y === map.exit.y) {
    startGetaway(s);
    return { ok: true, msg: 'Outside! Lose the police.' };
  }

  return { ok: true };
}

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
  const steal = Math.min(
    MAX_STEAL,
    Math.max(MIN_STEAL, Math.floor(bal * (0.1 + Math.random() * (MAX_STEAL_PCT - 0.1))))
  );

  const s = {
    id,
    userId,
    targetId: target.id,
    channelId: message.channel.id,
    hp: 3,
    phase: 'infiltrate',
    map,
    maxLoot: steal,
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
    return interaction.update(failHeist(s, 'You took too long — security locked down.'));
  }

  if (action === 'abort') {
    return interaction.update(failHeist(s, 'You aborted the job.'));
  }

  if (action === 'n' || action === 's' || action === 'e' || action === 'w') {
    const r = movePlayer(s, action);
    if (r.dead) return interaction.update(failHeist(s, r.msg));
    return interaction.update(buildView(s));
  }

  if (action === 'drill') {
    const pick = Number(parts[3]);
    const label = s.drillOptions[pick];
    const need = s.drillSeq[s.drillStep];
    if (label !== need) {
      s.map.alarm = true;
      s.hp -= 1;
      if (s.hp <= 0) return interaction.update(failHeist(s, 'The drill tripped a failsafe.'));
      return interaction.update(buildView(s));
    }
    s.drillStep++;
    if (s.drillStep >= s.drillSeq.length) {
      s.map.drilled = true;
      const taken = stealFromBank(s.targetId, s.userId, s.maxLoot);
      s.map.loot = taken;
      if (taken < 1) {
        return interaction.update(failHeist(s, 'The vault was empty after all.'));
      }
      // Money already in pocket from stealFromBank; mark as "carrying" for flavor — if they fail getaway, reclaim portion
      s.phase = 'escape';
      s.map.alarm = true;
      return interaction.update(buildView(s));
    }
    // refresh options for next step flavor
    return interaction.update(buildView(s));
  }

  if (action === 'go') {
    const pick = Number(parts[3]);
    const label = s.getawayOptions[pick];
    const need = s.getawayCorrect[s.getawayStep];
    // Soft: any pick has 55% success, correct label 85%
    const ok = label === need ? Math.random() < 0.9 : Math.random() < 0.4;
    if (!ok) {
      s.hp -= 1;
      if (s.hp <= 0) {
        // lose half loot
        const loss = Math.floor((s.map.loot || 0) * 0.5);
        if (loss > 0) {
          getUser(s.userId).coins = Math.max(0, getUser(s.userId).coins - loss);
          ensureBank(getUser(s.targetId)).bank += loss;
          markDirty();
        }
        return interaction.update(failHeist(s, 'Police boxed you in. Half the loot was recovered.'));
      }
      return interaction.update(buildView(s));
    }
    s.getawayStep++;
    if (s.getawayStep >= s.getawayNeed) {
      return interaction.update(winHeist(s));
    }
    // new options for next leg
    const pool = ['Alley', 'Highway', 'Sewers', 'Rooftops', 'Metro', 'Docks'];
    s.getawayOptions = pool.sort(() => Math.random() - 0.5).slice(0, 4);
    return interaction.update(buildView(s));
  }

  return interaction.update(buildView(s));
}

module.exports = { start, handleInteraction, COOLDOWN_MS, MIN_BANK };
