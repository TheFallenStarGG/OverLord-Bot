// Cross-server raids: two servers fight in a timed battle, with a live chat between them.
// A running raid only lives in memory. Coins move the instant a strike resolves, so a restart can never
// swallow anyone's coins. Settings, opt-outs and records live in raid.json.
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits: P,
  PermissionsBitField,
  StringSelectMenuBuilder,
  escapeMarkdown,
} = require('discord.js');
const { FILES } = require('../config');
const { readJson, writeJson, runIn: inGuild } = require('./storage');
const economy = require('./economy');
const { removeItem } = require('./inventory');
const { isRobEnabled } = require('./serverSettings');
const { flag } = require('./modifiers');
const blacklist = require('./blacklist');
const inbox = require('./inbox');
const announce = require('./announce');
const { logging } = require('./logging');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ---------- Settings you can tweak ----------
const RULES = {
  LOBBY_MS: 2 * MIN, // time to join before the battle starts
  BATTLE_MS: 10 * MIN,
  JOIN_CLOSE_MS: 2 * MIN, // joining closes this long before the end
  START_COOLDOWN_MS: 3 * HOUR, // how often one server can start a raid
  TARGET_COOLDOWN_MS: 2 * HOUR, // how often one server can be picked as the rival
  ACTIVE_WINDOW_MS: 30 * MIN, // "recently active" window for matchmaking
  MIN_ACTIVE: 2, // a rival needs this many recent chatters (set to 1 while testing)
  MAX_PER_SIDE: 25,
  MIN_WALLET: 100, // to join and to strike, and to be a target
  STRIKE_COOLDOWN_MS: 30 * 1000,
  MAX_STRIKES: 10, // per player per raid
  PROTECT_MS: 45 * 1000, // after being hit
  BRACE_MS: 90 * 1000,
  BRACE_COOLDOWN_MS: 4 * MIN,
  BASE_CHANCE: 0.45,
  STAKE_MIN: 0.03, // share of the TARGET's wallet
  STAKE_MAX: 0.07,
  STAKE_OWN_CAP: 0.2, // never risk more than this share of YOUR wallet in one strike
  STAKE_ABS_CAP: 1500,
  EXPOSURE: 0.2, // most a player can lose in one raid (share of their wallet when they joined)
  WIN_PAY: 150, // end-of-raid pay (only for players who struck or braced)
  DRAW_PAY: 90,
  PART_PAY: 40,
  REPORT_HIDE_AT: 3, // this many different 🚩 reports hide a message on both sides
  CLEANUP_MS: 60 * 1000, // how long the results stay up before the channels are deleted
};

const MODIFIERS = [
  { id: 'none', emoji: '⚔️', name: 'Open Field', text: 'No special rules. Pure skill and luck.', weight: 4 },
  { id: 'gold', emoji: '💰', name: 'Gold Rush', text: 'Strike stakes are 25% bigger.', weight: 2 },
  { id: 'blitz', emoji: '⚡', name: 'Blitz', text: 'Strike cooldowns are halved.', weight: 2 },
  { id: 'fog', emoji: '🌫️', name: 'Fog of War', text: 'Nobody can see how rich their targets are.', weight: 2 },
  { id: 'wall', emoji: '🛡️', name: 'Iron Wall', text: 'Bracing is twice as strong.', weight: 2 },
];

// ---------- Saved data ----------
const db = readJson(FILES.raid, {});
db.guilds ??= {}; // guildId -> { categoryId, off, pingRole, lastStartAt, lastTargetedAt, lastOpponent }
db.optout ??= {}; // userId -> true
db.banned ??= {}; // userId -> true (owner, via !!raid-admin)
db.active ??= {}; // raidId -> { channels } so leftovers can be deleted after a restart
db.stats ??= {}; // guildId -> { name, raids, wins, losses, draws, points }
const save = () => writeJson(FILES.raid, db);
const cfgOf = (guildId) => (db.guilds[guildId] ??= {});

// ---------- Live state (memory only) ----------
let bot = null;
const raids = new Map(); // raidId -> raid
const byGuild = new Map(); // guildId -> raid (or a { phase: 'setup' } placeholder while channels are made)
const byChannel = new Map(); // channelId -> raid
const relayBySource = new Map(); // original message id -> { raidId, authorId, authorName, guildName, text, channelId, copies, reporters, sent }
const relayByCopy = new Map(); // relayed copy message id -> original message id
const activity = new Map(); // guildId -> Map(userId -> last time they chatted)

const init = (client) => {
  bot = client;
};

// ---------- Small helpers ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const short = (s, n = 24) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const esc = (s) => escapeMarkdown(String(s));
const ts = (ms) => Math.floor(ms / 1000);
const fmt = economy.fmt;
const shuffle = (list) => [...list].sort(() => Math.random() - 0.5);
const userError = (message) => Object.assign(new Error(message), { user: true });
const say = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
const bar = (v) => `${'▰'.repeat(Math.round(v / 10))}${'▱'.repeat(10 - Math.round(v / 10))} ${Math.round(v)}`;
const purse = (n) => (n < 500 ? '💰 Small purse' : n < 5000 ? '💰💰 Comfortable' : n < 50000 ? '💰💰💰 Wealthy' : '💰💰💰💰 Loaded');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'rival';

const isOut = (userId) => Boolean(db.optout[userId] || db.banned[userId] || blacklist.isUserBlocked(userId));
// Raids follow the server's own rob setting and any Decree of Peace
const guildAllows = (guildId) => inGuild(guildId, () => isRobEnabled() && !flag('robBan'));

// ---------- Who has been around lately (used to pick rivals) ----------
function noteActivity(guildId, userId) {
  let m = activity.get(guildId);
  if (!m) activity.set(guildId, (m = new Map()));
  m.set(userId, Date.now());
  if (m.size > 400) {
    const cut = Date.now() - RULES.ACTIVE_WINDOW_MS;
    for (const [id, t] of m) if (t < cut) m.delete(id);
  }
}

function activeCount(guildId) {
  const m = activity.get(guildId);
  if (!m) return 0;
  const cut = Date.now() - RULES.ACTIVE_WINDOW_MS;
  let n = 0;
  for (const [id, t] of m) {
    if (t < cut) m.delete(id);
    else if (!isOut(id)) n++;
  }
  return n;
}

// ---------- Players and coins ----------
const playersOf = (raid, sideIdx) => [...raid.players.values()].filter((p) => p.sideIdx === sideIdx);
const room = (p) => Math.max(0, Math.floor(p.startCoins * RULES.EXPOSURE) - p.lost);
const isSpent = (p) => room(p) < 5;
const walletOf = (p) => inGuild(p.guildId, () => economy.peekUser(p.id).coins);
const pull = (p, amount) => inGuild(p.guildId, () => -economy.applyDelta(p.id, -amount)); // takes up to `amount`, returns what moved
const give = (p, amount) => inGuild(p.guildId, () => economy.addCoins(p.id, amount));

function rankBonus(p) {
  const wins = inGuild(p.guildId, () => economy.peekUser(p.id).rob?.wins ?? 0);
  let bonus = 0;
  for (const r of require('./rob').RANKS) if (wins >= r.min) bonus = r.chance;
  return bonus;
}
const guardsOf = (p) => inGuild(p.guildId, () => require('./muscle').guardPower(p.id));

// A Padlock stops one strike and breaks (same as !!rob)
function breakPadlock(p) {
  return inGuild(p.guildId, () => {
    if ((economy.peekUser(p.id).inventory?.padlock ?? 0) < 1) return false;
    removeItem(economy.getUser(p.id), 'padlock');
    economy.markDirty();
    return true;
  });
}

const moraleOf = (side) => clamp(side.morale - (Date.now() - side.moraleAt) / 20000, 0, 100);
function addMorale(side, delta) {
  side.morale = clamp(moraleOf(side) + delta, 0, 100);
  side.moraleAt = Date.now();
}

// The smaller side earns bonus points, so a small server isn't doomed
function underdogMult(raid, idx) {
  const mine = playersOf(raid, idx).length;
  const theirs = playersOf(raid, 1 - idx).length;
  if (!mine || mine >= theirs) return 1;
  return 1 + Math.min(1, (theirs / mine - 1) * 0.25);
}

function pickModifier() {
  let roll = Math.random() * MODIFIERS.reduce((n, m) => n + m.weight, 0);
  for (const m of MODIFIERS) {
    roll -= m.weight;
    if (roll < 0) return m;
  }
  return MODIFIERS[0];
}

// ---------- Setting up channels ----------
async function ensureCategory(guild) {
  const cfg = cfgOf(guild.id);
  let category = cfg.categoryId ? guild.channels.cache.get(cfg.categoryId) : null;
  if (category && category.type !== ChannelType.GuildCategory) category = null;
  if (!category) {
    category = await guild.channels.create({
      name: '⚔️ Raids',
      type: ChannelType.GuildCategory,
      reason: 'Cross-server raids (admins can pick another category with !!raid-config category)',
    });
    cfg.categoryId = category.id;
    save();
  }
  return category;
}

// Makes the raid channel. It copies the category's permissions (so it stays as private as the category),
// but nobody can talk in it until they press Join Raid.
async function makeChannel(guild, rivalName) {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const need = [P.ManageChannels, P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory];
  const missing = need.filter((perm) => !me.permissions.has(perm));
  if (missing.length) {
    throw userError(`I'm missing permissions in **${guild.name}**: ${new PermissionsBitField(missing).toArray().join(', ')}.`);
  }

  const category = await ensureCategory(guild);
  const overwrites = [];
  let hasEveryone = false;
  for (const o of category.permissionOverwrites.cache.values()) {
    if (o.id === me.id) continue;
    const allow = new PermissionsBitField(o.allow.bitfield);
    const deny = new PermissionsBitField(o.deny.bitfield);
    if (o.id === guild.id) {
      hasEveryone = true;
      allow.remove(P.SendMessages);
      deny.add(P.SendMessages);
    } else if (o.type === OverwriteType.Role) {
      allow.remove(P.SendMessages);
    }
    overwrites.push({ id: o.id, type: o.type, allow: allow.bitfield, deny: deny.bitfield });
  }
  if (!hasEveryone) overwrites.push({ id: guild.id, type: OverwriteType.Role, deny: [P.SendMessages] });

  const mine = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.AddReactions, P.ManageMessages].filter((perm) =>
    me.permissions.has(perm)
  );
  overwrites.push({ id: me.id, type: OverwriteType.Member, allow: mine });

  return guild.channels.create({
    name: `raid-${slug(rivalName)}`,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `⚔️ Cross-server raid vs ${short(rivalName, 60)}. Messages here are shared live with the other server. React 🚩 to report a message.`,
    rateLimitPerUser: 2,
    permissionOverwrites: overwrites,
    reason: 'Cross-server raid',
  });
}

async function grantChat(channel, member) {
  try {
    await channel.permissionOverwrites.create(member, { SendMessages: true, AddReactions: true }, { reason: 'Joined the raid' });
    return true;
  } catch (err) {
    logging('warn', 'Could not unlock raid chat for a player', err.message);
    return false;
  }
}

// ---------- Starting a raid ----------
function pickOpponent(from) {
  const now = Date.now();
  const last = cfgOf(from.id).lastOpponent;
  const ok = [...bot.guilds.cache.values()].filter((g) => {
    if (g.id === from.id || byGuild.has(g.id)) return false;
    const cfg = db.guilds[g.id] ?? {};
    if (cfg.off || blacklist.isGuildBlocked(g.id)) return false;
    if (now - (cfg.lastTargetedAt ?? 0) < RULES.TARGET_COOLDOWN_MS) return false;
    if (!g.members.me?.permissions.has(P.ManageChannels)) return false;
    if (!guildAllows(g.id)) return false;
    return activeCount(g.id) >= RULES.MIN_ACTIVE;
  });
  const fresh = ok.filter((g) => g.id !== last);
  const pool = fresh.length ? fresh : ok;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

// Returns a message explaining why this person can't start a raid right now, or null
function startProblem(guild, user) {
  const cfg = cfgOf(guild.id);
  if (cfg.off) return '⚔️ This server has opted out of raids. An admin can turn them back on with `!!raid-config optin`.';
  if (db.banned[user.id]) return '🚫 You are not allowed to raid.';
  if (db.optout[user.id]) return 'You opted out of raids. Use `!!raid optin` to take part again.';
  if (byGuild.has(guild.id)) return '⚔️ A raid is already happening in this server!';
  const wait = (cfg.lastStartAt ?? 0) + RULES.START_COOLDOWN_MS - Date.now();
  if (wait > 0) return `⏳ This server is catching its breath. A new raid can start <t:${ts(Date.now() + wait)}:R>.`;
  if (!guildAllows(guild.id)) return '🕊️ Raids are off here: robbing is turned off (`!!settings rob on`) or a Decree of Peace is active.';
  const coins = inGuild(guild.id, () => economy.peekUser(user.id).coins);
  if (coins < RULES.MIN_WALLET) return `You need at least **${fmt(RULES.MIN_WALLET)}** to lead a raid.`;
  return null;
}

function makePlayer(raid, sideIdx, member) {
  const side = raid.sides[sideIdx];
  const p = {
    id: member.id,
    name: short(member.displayName ?? member.nick ?? member.user?.globalName ?? member.user?.username ?? 'Raider', 32),
    guildId: side.guildId,
    sideIdx,
    startCoins: inGuild(side.guildId, () => economy.peekUser(member.id).coins),
    lost: 0, gained: 0, strikes: 0, wins: 0, braces: 0, defends: 0, hits: 0, reward: 0,
    lastStrikeAt: 0, braceUntil: 0, braceReadyAt: 0, protectedUntil: 0, lastRelayAt: 0, lastChatAt: 0, spentNotified: false,
  };
  raid.players.set(p.id, p);
  return p;
}

async function launch(guild, member) {
  const problem = startProblem(guild, member.user);
  if (problem) return { error: problem };
  const rival = pickOpponent(guild);
  if (!rival) {
    return {
      error:
        `No rival is ready right now. A rival server needs my **Manage Channels** permission and at least ${RULES.MIN_ACTIVE} people who chatted in the last ` +
        `${RULES.ACTIVE_WINDOW_MS / MIN} minutes. Try again soon!`,
    };
  }

  const cfgA = cfgOf(guild.id);
  const cfgB = cfgOf(rival.id);
  const prev = { start: cfgA.lastStartAt, target: cfgB.lastTargetedAt };
  const placeholder = { phase: 'setup' };
  byGuild.set(guild.id, placeholder);
  byGuild.set(rival.id, placeholder);

  const made = [];
  try {
    made.push(await makeChannel(guild, rival.name));
    try {
      made.push(await makeChannel(rival, guild.name));
    } catch (err) {
      logging('warn', 'Raid: could not set up the rival server', `${rival.name}: ${err.message}`);
      throw userError('The rival server could not be reached. Try again in a moment.');
    }
  } catch (err) {
    for (const c of made) await c.delete('Raid setup failed').catch(() => {});
    byGuild.delete(guild.id);
    byGuild.delete(rival.id);
    logging('warn', 'Raid setup failed', `${guild.name} vs ${rival.name}: ${err.message}`);
    return { error: err.user ? err.message : "I couldn't set up the raid channels. I need the **Manage Channels** permission." };
  }

  const now = Date.now();
  const id = Math.random().toString(36).slice(2, 7);
  const mkSide = (g, channel, emoji) => ({
    guildId: g.id, name: g.name, channel, channelId: channel.id, emoji, score: 0, morale: 50, moraleAt: now, boardMsg: null,
  });
  const raid = {
    id,
    phase: 'lobby',
    createdAt: now,
    lobbyEndsAt: now + RULES.LOBBY_MS,
    endsAt: now + RULES.LOBBY_MS + RULES.BATTLE_MS,
    joinClosesAt: now + RULES.LOBBY_MS + RULES.BATTLE_MS - RULES.JOIN_CLOSE_MS,
    modifier: pickModifier(),
    sides: [mkSide(guild, made[0], '🟥'), mkSide(rival, made[1], '🟦')],
    players: new Map(),
    log: [],
    timers: [],
    boardTimer: null,
    prev,
  };

  raids.set(id, raid);
  byGuild.set(guild.id, raid);
  byGuild.set(rival.id, raid);
  byChannel.set(made[0].id, raid);
  byChannel.set(made[1].id, raid);
  db.active[id] = { channels: [made[0].id, made[1].id] };
  cfgA.lastStartAt = now;
  cfgA.lastOpponent = rival.id;
  cfgB.lastTargetedAt = now;
  cfgB.lastOpponent = guild.id;
  save();

  // The person who started the raid is on side 1 automatically
  makePlayer(raid, 0, member);
  await grantChat(made[0], member);
  raid.log.unshift(`🟥 **${esc(raid.players.get(member.id).name)}** launched the raid!`);

  for (const s of raid.sides) s.boardMsg = await s.channel.send(boardPayload(raid)).catch(() => null);
  await callToArms(raid);

  raid.timers.push(setTimeout(() => beginBattle(raid).catch((e) => logging('error', 'Raid battle start failed', e)), RULES.LOBBY_MS));
  raid.timers.push(setTimeout(() => endRaid(raid).catch((e) => logging('error', 'Raid end failed', e)), RULES.LOBBY_MS + RULES.BATTLE_MS));
  logging('info', 'Raid started', `${guild.name} vs ${rival.name} (${raid.modifier.name})`);
  return { raid };
}

async function callToArms(raid) {
  for (let i = 0; i < 2; i++) {
    const me = raid.sides[i];
    const foe = raid.sides[1 - i];
    const role = cfgOf(me.guildId).pingRole;
    const text =
      i === 0
        ? `⚔️ **Raid launched against ${esc(foe.name)}!** Press **Join Raid** to fight. The battle starts <t:${ts(raid.lobbyEndsAt)}:R>.`
        : `🚨 **${esc(foe.name)}** is raiding this server! Press **Join Raid** to defend your coins and hit back. The battle starts <t:${ts(raid.lobbyEndsAt)}:R>.`;
    await me.channel
      .send({ content: `${role ? `<@&${role}> ` : ''}${text}`, allowedMentions: role ? { roles: [role] } : { parse: [] } })
      .catch(() => {});
    postEvents(me.guildId, { content: `${text} → <#${me.channelId}>`, allowedMentions: { parse: [] } }, me.channelId);
  }
}

// ---------- The board (one message per channel) ----------
const btn = (raid, action, label, style, emoji, disabled = false) =>
  new ButtonBuilder().setCustomId(`raid:${raid.id}:${action}`).setLabel(label).setStyle(style).setEmoji(emoji).setDisabled(disabled);

function boardPayload(raid) {
  const [A, B] = raid.sides;
  const now = Date.now();
  const ended = raid.phase === 'ended';
  const counts = [playersOf(raid, 0).length, playersOf(raid, 1).length];
  const phase =
    raid.phase === 'lobby'
      ? `🟡 **Gathering warriors.** The battle starts <t:${ts(raid.lobbyEndsAt)}:R>.`
      : raid.phase === 'battle'
        ? `🔴 **Battle in progress.** It ends <t:${ts(raid.endsAt)}:R>.${now > raid.joinClosesAt ? ' Joining is closed.' : ''}`
        : '🏁 **This raid is over.**';
  const side = (s, i) => ({
    name: `${s.emoji} ${short(s.name, 30)}`,
    value: `⚔️ **${s.score}** pts\n👥 ${counts[i]} warriors\n🔥 ${bar(moraleOf(s))}`,
    inline: true,
  });
  const under = [0, 1]
    .filter((i) => underdogMult(raid, i) > 1)
    .map((i) => `🐺 **${esc(short(raid.sides[i].name, 24))}** has fewer warriors: +${Math.round((underdogMult(raid, i) - 1) * 100)}% points`);

  const embed = new EmbedBuilder()
    .setColor(ended ? 0x95a5a6 : raid.phase === 'lobby' ? 0xf1c40f : 0xe74c3c)
    .setTitle(`⚔️ ${short(A.name, 30)} vs ${short(B.name, 30)}`)
    .setDescription(`${phase}\n${raid.modifier.emoji} **${raid.modifier.name}**: ${raid.modifier.text}${under.length ? `\n${under.join('\n')}` : ''}`)
    .addFields(side(A, 0), side(B, 1), {
      name: '📜 Recent action',
      value: raid.log.length ? raid.log.join('\n').slice(0, 1000) : '*Nothing yet.*',
    })
    .setFooter({ text: '🚩 React to any message to report it · Only players who joined can talk here' });

  const row = new ActionRowBuilder().addComponents(
    btn(raid, 'join', 'Join Raid', ButtonStyle.Success, '⚔️', ended || now > raid.joinClosesAt),
    btn(raid, 'strike', 'Strike', ButtonStyle.Danger, '🗡️', raid.phase !== 'battle'),
    btn(raid, 'brace', 'Brace', ButtonStyle.Primary, '🛡️', raid.phase !== 'battle'),
    btn(raid, 'rules', 'Rules', ButtonStyle.Secondary, '📖')
  );
  return { embeds: [embed], components: [row] };
}

function refreshBoards(raid) {
  const payload = boardPayload(raid);
  for (const s of raid.sides) s.boardMsg?.edit(payload).catch(() => {});
}

// Edits are batched so a busy raid doesn't hit Discord's rate limits
function scheduleBoard(raid) {
  if (raid.boardTimer || raid.phase === 'ended') return;
  raid.boardTimer = setTimeout(() => {
    raid.boardTimer = null;
    refreshBoards(raid);
  }, 4000);
}

function pushLog(raid, text) {
  raid.log.unshift(text);
  if (raid.log.length > 6) raid.log.length = 6;
  scheduleBoard(raid);
}

const postBoth = (raid, text) => {
  for (const s of raid.sides) s.channel.send({ content: String(text).slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => {});
};

function postEvents(guildId, payload, exceptChannelId) {
  const id = announce.getChannel(guildId);
  if (!id || id === exceptChannelId) return;
  bot.channels
    .fetch(id)
    .then((c) => c?.isTextBased() && c.send(payload))
    .catch(() => {});
}

// ---------- Lifecycle ----------
function clearTimers(raid) {
  for (const t of raid.timers) clearTimeout(t);
  raid.timers = [];
  if (raid.boardTimer) clearTimeout(raid.boardTimer);
  raid.boardTimer = null;
}

async function beginBattle(raid) {
  if (raid.phase !== 'lobby') return;
  if (!playersOf(raid, 0).length || !playersOf(raid, 1).length) return fizzle(raid);
  raid.phase = 'battle';
  postBoth(raid, '🔔 **The battle begins!** Press **Strike** to raid an enemy, or **Brace** to hold the line. Chat with the other server. Trash talk raises your morale!');
  refreshBoards(raid);
}

// Nobody answered on one side: call it off and give the cooldown back
function fizzle(raid) {
  clearTimers(raid);
  raid.phase = 'ended';
  const [A, B] = raid.sides;
  cfgOf(A.guildId).lastStartAt = raid.prev.start;
  cfgOf(B.guildId).lastTargetedAt = raid.prev.target;
  save();
  postBoth(raid, '🏳️ Nobody answered the call on one side, so the raid was called off. No cooldown was used.');
  refreshBoards(raid);
  raid.timers.push(setTimeout(() => cleanup(raid), 20 * 1000));
}

async function abort(raid, why) {
  if (raid.phase === 'ended') return;
  clearTimers(raid);
  raid.phase = 'ended';
  postBoth(raid, `🛑 ${why}`);
  refreshBoards(raid);
  raid.timers.push(setTimeout(() => cleanup(raid), 10 * 1000));
}

function resultsEmbed(raid, result) {
  const [A, B] = raid.sides;
  const embed = new EmbedBuilder()
    .setColor(result === -1 ? 0x95a5a6 : 0xf1c40f)
    .setTitle(result === -1 ? '🤝 The raid ended in a draw!' : `🏆 ${short(raid.sides[result].name, 60)} wins the raid!`)
    .setDescription(`${A.emoji} **${esc(short(A.name, 30))}** ${A.score} — ${B.score} **${esc(short(B.name, 30))}** ${B.emoji}\n${raid.modifier.emoji} ${raid.modifier.name}`);
  raid.sides.forEach((s, i) => {
    const ps = playersOf(raid, i);
    const sum = (key) => ps.reduce((n, p) => n + p[key], 0);
    const mvp = [...ps].sort((a, b) => b.gained - a.gained || b.wins - a.wins)[0];
    embed.addFields({
      name: `${s.emoji} ${short(s.name, 30)}`,
      inline: true,
      value:
        `Warriors: **${ps.length}**\nStrikes: **${sum('strikes')}** (${sum('wins')} landed)\nCoins won: **${fmt(sum('gained'))}**` +
        (mvp && mvp.gained > 0 ? `\n⭐ MVP: **${esc(mvp.name)}** (${fmt(mvp.gained)})` : ''),
    });
  });
  embed.setFooter({ text: `Everyone who struck or braced was paid: winners ${RULES.WIN_PAY}, draw ${RULES.DRAW_PAY}, others ${RULES.PART_PAY}` });
  return embed;
}

async function endRaid(raid) {
  if (raid.phase === 'ended') return;
  clearTimers(raid);
  raid.phase = 'ended';
  const [A, B] = raid.sides;
  const result = A.score > B.score ? 0 : B.score > A.score ? 1 : -1;

  // Small end-of-raid pay (only for players who actually took part)
  for (const p of raid.players.values()) {
    if (p.strikes + p.braces < 1) continue;
    p.reward = result === -1 ? RULES.DRAW_PAY : result === p.sideIdx ? RULES.WIN_PAY : RULES.PART_PAY;
    give(p, p.reward);
  }

  for (let i = 0; i < 2; i++) {
    const s = raid.sides[i];
    const st = (db.stats[s.guildId] ??= { name: s.name, raids: 0, wins: 0, losses: 0, draws: 0, points: 0 });
    st.name = s.name;
    st.raids++;
    st.points += s.score;
    if (result === -1) st.draws++;
    else if (result === i) st.wins++;
    else st.losses++;

    const foe = raid.sides[1 - i];
    const text =
      result === -1
        ? `⚔️ A cross-server raid against **${foe.name}** ended in a draw (${s.score}–${foe.score}).`
        : result === i
          ? `⚔️ This server won a raid against **${foe.name}**, ${s.score}–${foe.score}!`
          : `⚔️ This server lost a raid to **${foe.name}**, ${s.score}–${foe.score}.`;
    try {
      inGuild(s.guildId, () => require('./world').logEvent(text));
    } catch {
      /* the chronicle is optional */
    }
  }
  save();

  const embed = resultsEmbed(raid, result);
  for (const s of raid.sides) {
    s.channel.send({ embeds: [embed] }).catch(() => {});
    postEvents(s.guildId, { embeds: [embed] }, s.channelId);
  }
  refreshBoards(raid);
  logging('info', 'Raid finished', `${A.name} ${A.score}–${B.score} ${B.name} · ${raid.players.size} players`);
  raid.timers.push(setTimeout(() => cleanup(raid), RULES.CLEANUP_MS));
}

function dropRelay(sourceId) {
  const rec = relayBySource.get(sourceId);
  if (!rec) return;
  for (const c of rec.copies) relayByCopy.delete(c.messageId);
  relayBySource.delete(sourceId);
}

function cleanup(raid) {
  clearTimers(raid);
  for (const s of raid.sides) {
    if (byGuild.get(s.guildId) === raid) byGuild.delete(s.guildId);
    byChannel.delete(s.channelId);
    s.channel.delete('Raid over').catch(() => {});
  }
  raids.delete(raid.id);
  delete db.active[raid.id];
  for (const [key, rec] of [...relayBySource]) if (rec.raidId === raid.id) dropRelay(key);
  save();
}

// After a restart, any raid channels that were left behind are deleted
async function recover() {
  for (const [id, info] of Object.entries(db.active)) {
    for (const channelId of info.channels ?? []) {
      const channel = await bot.channels.fetch(channelId).catch(() => null);
      if (channel) await channel.delete('Raid interrupted by a restart').catch(() => {});
    }
    delete db.active[id];
  }
  save();
}

function forgetGuild(guildId) {
  const r = byGuild.get(guildId);
  if (r?.id) abort(r, 'One of the servers removed the bot, so the raid is over.');
  delete db.guilds[guildId];
  delete db.stats[guildId];
  save();
}

function onChannelDelete(channel) {
  const raid = byChannel.get(channel.id);
  if (raid && raid.phase !== 'ended') abort(raid, 'A raid channel was deleted, so the raid is over.');
}

// ---------- Buttons and menus ----------
async function handleInteraction(interaction) {
  const [, first, action] = interaction.customId.split(':');
  if (first === 'launch' || first === 'cancel') return handleLaunch(interaction, first, action);

  const raid = raids.get(first);
  if (!raid || !raid.sides.some((s) => s.channelId === interaction.channelId)) return say(interaction, '⌛ That raid is over.');

  if (action === 'rules') return interaction.reply({ embeds: [rulesEmbed()], flags: MessageFlags.Ephemeral });
  if (action === 'join') return join(interaction, raid);
  if (isOut(interaction.user.id)) return say(interaction, db.banned[interaction.user.id] ? '🚫 You are not allowed to raid.' : 'You opted out of raids. Use `!!raid optin` to take part.');
  if (raid.phase === 'ended') return say(interaction, '🏁 This raid is over.');
  if (action === 'strike') return openStrikeMenu(interaction, raid);
  if (action === 'brace') return brace(interaction, raid);
  if (action === 'target') return strikeTarget(interaction, raid, interaction.values?.[0]);
  return interaction.deferUpdate().catch(() => {});
}

async function handleLaunch(interaction, kind, ownerId) {
  if (interaction.user.id !== ownerId) return say(interaction, 'Only the person who ran `!!raid` can press this.');
  if (kind === 'cancel') return interaction.update({ content: 'Raid cancelled.', embeds: [], components: [] });
  const problem = startProblem(interaction.guild, interaction.user);
  if (problem) return interaction.update({ content: problem, embeds: [], components: [] });

  await interaction.update({ content: '🔍 Scouting for a rival server…', embeds: [], components: [] });
  const res = await launch(interaction.guild, interaction.member);
  if (res.error) return interaction.editReply({ content: `⚠️ ${res.error}` });
  return interaction.editReply({ content: `⚔️ **Raid launched!** Head to ${res.raid.sides[0].channel} to fight **${esc(res.raid.sides[1].name)}**!` });
}

async function join(interaction, raid) {
  const now = Date.now();
  const sideIdx = raid.sides.findIndex((s) => s.channelId === interaction.channelId);
  const side = raid.sides[sideIdx];
  const uid = interaction.user.id;

  if (raid.phase === 'ended' || now > raid.joinClosesAt) return say(interaction, '⏳ Joining is closed for this raid.');
  if (raid.players.has(uid)) return say(interaction, "You're already in this raid!");
  if (isOut(uid)) return say(interaction, db.banned[uid] ? '🚫 You are not allowed to raid.' : 'You opted out of raids. Use `!!raid optin` to take part.');
  if (!guildAllows(side.guildId)) return say(interaction, '🕊️ Raiding is switched off in this server right now.');
  if (playersOf(raid, sideIdx).length >= RULES.MAX_PER_SIDE) return say(interaction, 'Your side is full.');
  const coins = inGuild(side.guildId, () => economy.peekUser(uid).coins);
  if (coins < RULES.MIN_WALLET) return say(interaction, `You need at least **${fmt(RULES.MIN_WALLET)}** to take part (you have ${fmt(coins)}).`);

  const p = makePlayer(raid, sideIdx, interaction.member);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const unlocked = await grantChat(interaction.channel, interaction.member);
  pushLog(raid, `${side.emoji} **${esc(p.name)}** joined the raid.`);
  return interaction.editReply(
    unlocked
      ? `✅ You're in! You can now chat here (it's shared with the other server) and use **Strike** and **Brace**. You can lose at most **${fmt(room(p))}** in this raid.`
      : `⚠️ You're in, but I couldn't unlock chat for you. Ask an admin to give me **Manage Channels**. You can lose at most **${fmt(room(p))}** in this raid.`
  );
}

async function brace(interaction, raid) {
  const now = Date.now();
  const p = raid.players.get(interaction.user.id);
  if (raid.phase !== 'battle') return say(interaction, raid.phase === 'lobby' ? `⏳ The battle starts <t:${ts(raid.lobbyEndsAt)}:R>.` : 'The raid is over.');
  if (!p) return say(interaction, 'Press **Join Raid** first!');
  if (p.braceUntil > now) return say(interaction, `🛡️ You're already braced until <t:${ts(p.braceUntil)}:R>.`);
  if (p.braceReadyAt > now) return say(interaction, `⏳ You can brace again <t:${ts(p.braceReadyAt)}:R>.`);

  p.braceUntil = now + RULES.BRACE_MS;
  p.braceReadyAt = now + RULES.BRACE_COOLDOWN_MS;
  p.braces++;
  pushLog(raid, `${raid.sides[p.sideIdx].emoji} **${esc(p.name)}** raised a shield wall! 🛡️`);
  const power = raid.modifier.id === 'wall' ? 30 : 15;
  return say(interaction, `🛡️ You brace for **${RULES.BRACE_MS / 1000}s**. Enemies are **${power}%** less likely to hit you, but you can't strike until it ends.`);
}

function strikeProblem(raid, p, now) {
  if (raid.phase === 'lobby') return `⏳ The battle starts <t:${ts(raid.lobbyEndsAt)}:R>. Hold your fire!`;
  if (raid.phase !== 'battle') return 'The raid is over.';
  if (!p) return 'Press **Join Raid** first!';
  if (isOut(p.id)) return 'You opted out of raids.';
  if (!guildAllows(p.guildId)) return '🕊️ Raiding is switched off in your server right now.';
  if (p.braceUntil > now) return `🛡️ You're braced until <t:${ts(p.braceUntil)}:R>. You can't strike while holding the line.`;
  const cooldown = raid.modifier.id === 'blitz' ? RULES.STRIKE_COOLDOWN_MS / 2 : RULES.STRIKE_COOLDOWN_MS;
  const wait = p.lastStrikeAt + cooldown - now;
  if (wait > 0) return `⏳ Your weapon needs a moment. Try again <t:${ts(now + wait)}:R>.`;
  if (p.strikes >= RULES.MAX_STRIKES) return `You've used all ${RULES.MAX_STRIKES} of your strikes.`;
  if (isSpent(p)) return '🏳️ You have lost as much as the rules allow in this raid. You can still chat and brace.';
  if (walletOf(p) < RULES.MIN_WALLET) return `You need at least **${fmt(RULES.MIN_WALLET)}** to strike.`;
  return null;
}

function targetProblem(def, now) {
  if (!def) return 'That target is gone.';
  if (isOut(def.id)) return `**${esc(def.name)}** left the raid.`;
  if (isSpent(def)) return `🏳️ **${esc(def.name)}** has lost all the rules allow and can't be raided any more.`;
  if (def.protectedUntil > now) return `🛡️ **${esc(def.name)}** was just hit. Pick someone else or wait a moment.`;
  if (!guildAllows(def.guildId)) return `🕊️ **${esc(def.name)}**'s server isn't allowing raids right now.`;
  if (walletOf(def) < RULES.MIN_WALLET) return `**${esc(def.name)}** doesn't have enough coins to be worth it.`;
  return null;
}

async function openStrikeMenu(interaction, raid) {
  const now = Date.now();
  const me = raid.players.get(interaction.user.id);
  const problem = strikeProblem(raid, me, now);
  if (problem) return say(interaction, problem);

  const targets = shuffle(playersOf(raid, 1 - me.sideIdx).filter((t) => !targetProblem(t, now))).slice(0, 25);
  if (!targets.length) return say(interaction, '🎯 Nobody can be hit right now (they are protected, spent, or the other side is empty). Try again in a few seconds.');

  const fog = raid.modifier.id === 'fog';
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`raid:${raid.id}:target`)
    .setPlaceholder('Pick who to raid')
    .addOptions(
      targets.map((t) => ({
        label: short(t.name, 90),
        value: t.id,
        description: fog ? '🌫️ Hidden by the fog' : `${purse(walletOf(t))}${t.braceUntil > now ? ' · 🛡️ braced' : ''}`,
      }))
    );
  return interaction.reply({
    content: `🗡️ **Who do you want to raid?** Win and you take their coins. Get caught and you pay the same amount. (Strike ${me.strikes + 1}/${RULES.MAX_STRIKES})`,
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

// ---------- A strike (runs in one go, so nothing can change halfway) ----------
function strike(raid, atk, def, now) {
  const me = raid.sides[atk.sideIdx];
  const foe = raid.sides[def.sideIdx];
  const mod = raid.modifier.id;
  const atkCoins = walletOf(atk);
  const defCoins = walletOf(def);

  let stake = Math.floor(defCoins * rand(RULES.STAKE_MIN, RULES.STAKE_MAX) * (mod === 'gold' ? 1.25 : 1));
  stake = Math.max(1, Math.min(stake, Math.floor(atkCoins * RULES.STAKE_OWN_CAP), RULES.STAKE_ABS_CAP, room(atk), room(def)));

  const braced = def.braceUntil > now;
  const chance = clamp(
    RULES.BASE_CHANCE +
      rankBonus(atk) +
      ((moraleOf(me) - moraleOf(foe)) / 100) * 0.08 -
      (braced ? (mod === 'wall' ? 0.3 : 0.15) : 0) -
      Math.min(0.12, guardsOf(def)),
    0.1,
    0.75
  );

  atk.strikes++;
  atk.lastStrikeAt = now;
  const out = { kind: 'fail', stake, chance, braced, moved: 0, points: 0 };

  if (breakPadlock(def)) {
    out.kind = 'padlock';
    out.points = Math.round(4 * underdogMult(raid, def.sideIdx));
    foe.score += out.points;
    def.defends++;
    addMorale(foe, 2);
    addMorale(me, -2);
  } else if (Math.random() < chance) {
    out.kind = 'win';
    out.moved = pull(def, stake);
    give(atk, out.moved);
    out.points = Math.round((10 + (braced ? 5 : 0)) * underdogMult(raid, atk.sideIdx));
    me.score += out.points;
    atk.wins++;
    atk.gained += out.moved;
    def.lost += out.moved;
    def.hits++;
    def.protectedUntil = now + RULES.PROTECT_MS;
    addMorale(me, 6);
    addMorale(foe, -4);
  } else {
    out.moved = pull(atk, stake);
    give(def, out.moved);
    out.points = Math.round(6 * underdogMult(raid, def.sideIdx));
    foe.score += out.points;
    atk.lost += out.moved;
    def.gained += out.moved;
    def.defends++;
    addMorale(foe, 5);
    addMorale(me, -3);
  }
  return out;
}

function feedLine(raid, atk, def, out) {
  const a = `${raid.sides[atk.sideIdx].emoji} **${esc(atk.name)}**`;
  const d = `${raid.sides[def.sideIdx].emoji} **${esc(def.name)}**`;
  if (out.kind === 'padlock') return `🔒 ${d}'s **Padlock** stopped ${a}! (+${out.points} pts)`;
  if (out.kind === 'win') return `🗡️ ${a} raided ${d} and took **${fmt(out.moved)}**${out.braced ? ' through their shield wall' : ''}! (+${out.points} pts)`;
  return `🚔 ${a} was caught raiding ${d} and paid **${fmt(out.moved)}**! (+${out.points} pts for ${esc(short(raid.sides[def.sideIdx].name, 20))})`;
}

async function strikeTarget(interaction, raid, targetId) {
  const now = Date.now();
  const atk = raid.players.get(interaction.user.id);
  const def = raid.players.get(targetId);
  const problem = strikeProblem(raid, atk, now) ?? (def && def.sideIdx !== atk.sideIdx ? targetProblem(def, now) : 'That target is gone.');
  if (problem) return interaction.update({ content: problem, components: [] });

  const out = strike(raid, atk, def, now);
  const odds = `${Math.round(out.chance * 100)}% chance`;
  const mine =
    out.kind === 'win'
      ? `🗡️ **Success!** You took **${fmt(out.moved)}** from **${esc(def.name)}**. (${odds})`
      : out.kind === 'padlock'
        ? `🔒 **${esc(def.name)}** had a Padlock. It broke, but you paid nothing. (${odds})`
        : `🚔 **Caught!** You paid **${fmt(out.moved)}** to **${esc(def.name)}**. (${odds})`;
  await interaction.update({ content: mine, components: [] });

  const line = feedLine(raid, atk, def, out);
  pushLog(raid, line);
  postBoth(raid, line);
  for (const p of [atk, def]) {
    if (isSpent(p) && !p.spentNotified) {
      p.spentNotified = true;
      pushLog(raid, `🏳️ **${esc(p.name)}** has lost all the rules allow and is out of the fight.`);
    }
  }
}

// ---------- Live chat between the two servers ----------
function cleanText(text) {
  return String(text ?? '')
    .replace(/discord(?:app)?\.(?:gg|com\/invite)\/\S+/gi, '[invite]')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '[link]')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<@[!&]?\d+>/g, '@someone')
    .replace(/<#\d+>/g, '#channel')
    .replace(/@(everyone|here)/gi, '@\u200b$1')
    .trim();
}

function rememberRelay(source, raid, p, text, copies) {
  relayBySource.set(source.id, {
    raidId: raid.id, authorId: p.id, authorName: p.name, guildName: raid.sides[p.sideIdx].name,
    text, channelId: source.channelId, copies, reporters: new Set(), sent: false,
  });
  for (const c of copies) relayByCopy.set(c.messageId, source.id);
  if (relayBySource.size > 1500) dropRelay(relayBySource.keys().next().value);
}

// Only players who joined can talk, and only their messages are shared. Commands stay local.
async function relay(message) {
  const raid = byChannel.get(message.channelId);
  if (!raid || raid.phase === 'ended') return;
  const p = raid.players.get(message.author.id);
  if (!p || isOut(p.id)) return;
  const raw = message.content ?? '';
  if (raw.trim().startsWith('!!')) return;

  let text = cleanText(raw);
  if (message.attachments?.size || message.stickers?.size) text = text ? `${text} 📎` : '📎 *sent an attachment*';
  if (!text) return;

  const now = Date.now();
  if (now - p.lastRelayAt < 1200) return;
  p.lastRelayAt = now;

  const side = raid.sides[p.sideIdx];
  if (raw.length >= 6 && now - p.lastChatAt >= 20000) {
    p.lastChatAt = now;
    addMorale(side, 3);
  }

  const other = raid.sides[1 - p.sideIdx];
  const line = `${side.emoji} **${esc(p.name)}** ‹${esc(short(side.name, 18))}›: ${text.slice(0, 700)}`;
  const sent = await other.channel.send({ content: line.slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => null);
  if (sent) rememberRelay(message, raid, p, text, [{ channelId: other.channelId, messageId: sent.id }]);
}

function hideRelay(sourceId) {
  const rec = relayBySource.get(sourceId);
  if (!rec) return;
  for (const c of rec.copies) bot.channels.cache.get(c.channelId)?.messages.delete(c.messageId).catch(() => {});
  bot.channels.cache.get(rec.channelId)?.messages.delete(sourceId).catch(() => {});
  dropRelay(sourceId);
}

// 🚩 on any shared message sends a report to the owner's inbox (the same one !!report uses)
async function onReaction(reaction, user) {
  if (user.bot || reaction.emoji.name !== '🚩') return;
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message) return;
  const raid = byChannel.get(message.channelId);
  if (!raid) return;

  const sourceId = relayByCopy.get(message.id) ?? message.id;
  const rec = relayBySource.get(sourceId);
  if (!rec || user.id === rec.authorId || rec.reporters.has(user.id)) return;
  rec.reporters.add(user.id);

  let note = null;
  if (!rec.sent) {
    const who = user.partial ? await user.fetch().catch(() => user) : user;
    const body = `🚩 **Raid message reported** (raid \`${raid.id}\`)\n**Author:** ${rec.authorName} (\`${rec.authorId}\`) from **${rec.guildName}**\n**Message:** ${rec.text}`.slice(0, 1450);
    const res = await inbox.submit(bot, 'report', { author: who, guild: message.guild, url: message.url }, body);
    if (res.error) {
      note = `⚠️ ${res.error}`;
    } else {
      rec.sent = true;
      note = `🚩 Thanks! The report was sent to the bot owner (ref \`${res.id}\`).`;
    }
  }
  if (note) {
    message.channel
      .send({ content: note, allowedMentions: { parse: [] } })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 10 * 1000))
      .catch(() => {});
  }
  if (rec.reporters.size >= RULES.REPORT_HIDE_AT) {
    logging('warn', 'Raid message hidden after reports', `${rec.authorName} (${rec.authorId})`);
    hideRelay(sourceId);
  }
}

// If someone deletes their message, the shared copy goes too
function onDelete(message) {
  const rec = relayBySource.get(message.id);
  if (!rec) return;
  for (const c of rec.copies) bot.channels.cache.get(c.channelId)?.messages.delete(c.messageId).catch(() => {});
  dropRelay(message.id);
}

// ---------- Info for commands ----------
function rulesEmbed() {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('⚔️ Cross-server raids')
    .setDescription(
      `A raid pairs your server with a random rival. A channel opens in both servers and everything players type there is shared live.\n\n` +
        `**1. Join.** Press **Join Raid** (you need ${fmt(RULES.MIN_WALLET)}+). Only players who joined can chat or be hit. The lobby lasts ${RULES.LOBBY_MS / MIN} min, then the battle lasts ${RULES.BATTLE_MS / MIN} min.\n` +
        `**2. Strike.** Pick an enemy. Win (about 45%) and you take **${RULES.STAKE_MIN * 100}-${RULES.STAKE_MAX * 100}%** of their wallet. Get caught and you pay the same amount to them. You never risk more than ${RULES.STAKE_OWN_CAP * 100}% of your own coins per strike.\n` +
        `**3. Brace.** For ${RULES.BRACE_MS / 1000}s enemies are 15% less likely to hit you, but you can't strike.\n` +
        `**4. Morale.** Chatting and winning fights raises your side's morale (up to +8% strike chance).\n` +
        `**5. Safe limits.** You can lose at most **${RULES.EXPOSURE * 100}%** of your wallet in one raid. Padlocks, guards and your thief rank all count. The smaller side gets bonus points.\n` +
        `**6. Win.** The side with more points wins. Everyone who struck or braced gets paid (${RULES.WIN_PAY} win, ${RULES.PART_PAY} loss).\n\n` +
        `🚩 React to any message to report it. Opt out any time with \`!!raid optout\`. Admins can opt a server out with \`!!raid-config optout\`.`
    );
}

function statusEmbed(guild, user) {
  const cfg = cfgOf(guild.id);
  const wait = (cfg.lastStartAt ?? 0) + RULES.START_COOLDOWN_MS - Date.now();
  const st = db.stats[guild.id];
  const live = byGuild.get(guild.id);
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('⚔️ Raid status')
    .addFields(
      { name: 'This server', value: cfg.off ? '🚫 Opted out' : '✅ Taking part (on by default)', inline: true },
      { name: 'You', value: db.optout[user.id] ? '🚫 Opted out' : '✅ Taking part', inline: true },
      { name: 'Raid category', value: cfg.categoryId ? `<#${cfg.categoryId}>` : 'Made automatically when needed', inline: true },
      { name: 'Next raid', value: live ? '⚔️ A raid is happening now' : wait > 0 ? `<t:${ts(Date.now() + wait)}:R>` : '✅ Ready', inline: true },
      { name: 'Record', value: st ? `${st.wins}W · ${st.losses}L · ${st.draws}D · ${st.points} pts` : 'No raids yet', inline: true }
    );
}

function topServers(n = 10) {
  return Object.entries(db.stats)
    .filter(([id]) => !db.guilds[id]?.off)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.wins - a.wins || b.points - a.points)
    .slice(0, n);
}

function topEmbed() {
  const rows = topServers(10);
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🏆 Top raiding servers')
    .setDescription(
      rows.length
        ? rows.map((r, i) => `**${i + 1}.** ${esc(short(r.name, 30))} · ${r.wins}W ${r.losses}L ${r.draws}D · ${r.points} pts`).join('\n')
        : 'No raids have finished yet. Be the first with `!!raid`!'
    );
}

function setOptOut(userId, out) {
  if (out) db.optout[userId] = true;
  else delete db.optout[userId];
  save();
}

const raidOf = (guildId) => {
  const r = byGuild.get(guildId);
  return r?.id ? r : null;
};

function forceEnd(id) {
  const r = raids.get(id);
  if (!r || r.phase === 'ended') return false;
  abort(r, 'The bot owner ended this raid.');
  return true;
}

const listRaids = () => [...raids.values()];

module.exports = {
  RULES, init, db, save, cfgOf, noteActivity, startProblem, launch, boardPayload, handleInteraction,
  relay, onReaction, onDelete, onChannelDelete, recover, forgetGuild,
  rulesEmbed, statusEmbed, topEmbed, setOptOut, raidOf, forceEnd, listRaids,
};
