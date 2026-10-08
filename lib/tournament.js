const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { spendCoins, addCoins, fmt } = require('./economy');
const { startGame } = require('./games/common');
const duel = require('./games/duel');
const { logging } = require('./logging');
const { scoped, writeJson, currentGuild } = require('./storage');

const FILE = path.join(__dirname, '..', 'tournament.json');
const ENTRY_FEE = 200;
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 16;
const READY_MS = 5 * 60 * 1000;
const HOUSE_CUT = 0.1; // taken from the prize pool

let state = readJson(FILE, { players: [], channelId: null, lastAutoDay: null, running: false });

const state = scoped(FILE, (d) => {
  d.players ??= [];
  d.channelId ??= null;
  d.lastAutoDay ??= null;
  d.running ??= false;
  // If the bot restarted in the middle of a tournament, everyone is refunded
  if (d.running) {
    d.players.forEach((id) => addCoins(id, ENTRY_FEE));
    d.players = [];
    d.running = false;
  }
});
const runs = new Map(); // guildId -> the bracket that's being played right now
const save = () => writeJson(FILE, state);

// ---------- Signing up ----------

function joinTournament(userId, channelId) {
  if (state.running) return { error: 'A tournament is running right now. Join the next one!' };
  if (state.players.includes(userId)) return { error: "You're already signed up." };
  if (state.players.length >= MAX_PLAYERS) return { error: `The tournament is full (${MAX_PLAYERS} players).` };
  if (!spendCoins(userId, ENTRY_FEE)) return { error: `The entry fee is **${fmt(ENTRY_FEE)}** and you don't have enough.` };

  state.players.push(userId);
  state.channelId = channelId; // the tournament is played in the last channel someone signed up from
  save();
  return { text: `🏆 You're in! **${state.players.length}** fighter(s) signed up (${MIN_PLAYERS} needed). You paid ${fmt(ENTRY_FEE)}.` };
}

function leaveTournament(userId) {
  if (state.running) return { error: "You can't leave once it has started." };
  if (!state.players.includes(userId)) return { error: "You're not signed up." };
  state.players = state.players.filter((id) => id !== userId);
  addCoins(userId, ENTRY_FEE);
  save();
  return { text: `You left the tournament and got your **${fmt(ENTRY_FEE)}** back.` };
}

function tournamentInfo() {
  const pool = Math.floor(state.players.length * ENTRY_FEE * (1 - HOUSE_CUT));
  return [
    '🏆 **Weekly Tournament**',
    state.running ? '⚔️ A tournament is being played right now!' : `Fighters signed up: **${state.players.length}** / ${MAX_PLAYERS} (need ${MIN_PLAYERS})`,
    state.players.length ? state.players.map((id) => `<@${id}>`).join(', ') : '*Nobody yet*',
    `Entry fee: ${fmt(ENTRY_FEE)} · Prize pool: **${fmt(pool)}** (70% to the winner, 30% to the runner-up)`,
    'Starts automatically every **Saturday at 18:00 UTC** (with at least 4 fighters). No gear or items: everyone fights on equal terms.',
    'Join with `!!tournament join`, or leave with `!!tournament leave`.',
  ].join('\n');
}

// ---------- Running the bracket ----------

const readyButton = (matchId) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tourney:ready:${matchId}`).setLabel('Ready').setEmoji('⚔️').setStyle(ButtonStyle.Success)
  );

async function startRound() {
  const run = runs.get(currentGuild());
  if (run.alive.length === 1) return finishTournament(run.alive[0]);

  run.round++;
  run.matches = [];
  run.nextAlive = [];
  run.pending = 0;
  const isFinal = run.alive.length === 2;

  for (let i = 0; i < run.alive.length; i += 2) {
    const a = run.alive[i];
    const b = run.alive[i + 1];
    if (!b) {
      run.nextAlive.push(a); // a bye: advances automatically
      await run.channel.send(`🎟️ <@${a}> gets a bye in round ${run.round} and moves on!`);
    } else {
      await postMatch(a, b, isFinal);
    }
  }
  if (run.pending === 0) {
    run.alive = run.nextAlive;
    await startRound();
  }
}

async function postMatch(a, b, isFinal) {
  const run = runs.get(currentGuild());
  const match = { id: Math.random().toString(36).slice(2, 8), a, b, isFinal, ready: new Set(), message: null, timer: null, done: false };
  run.matches.push(match);
  run.pending++;

  match.message = await run.channel.send({
    content:
      `⚔️ **${isFinal ? 'THE FINAL' : `Round ${run.round}`}:** <@${a}> vs <@${b}>${isFinal ? ' (best of 3)' : ''}\n` +
      'Both fighters press **Ready** within 5 minutes, or the missing fighter forfeits.',
    components: [readyButton(match.id)],
    allowedMentions: { users: [a, b] },
  });
  match.timer = setTimeout(() => noShow(match), READY_MS);
}

function matchOver(match, winnerId) {
  const run = runs.get(currentGuild());
  if (match.done) return;
  match.done = true;
  clearTimeout(match.timer);

  run.nextAlive.push(winnerId);
  if (match.isFinal) run.runnerUp = winnerId === match.a ? match.b : match.a;
  run.pending--;
  if (run.pending <= 0) {
    run.alive = run.nextAlive;
    startRound().catch((err) => logging('error', 'Tournament round failed', err));
  }
}

async function noShow(match) {
  if (match.done) return;
  const present = [...match.ready];
  const winner = present.length === 1 ? present[0] : [match.a, match.b][Math.floor(Math.random() * 2)];
  await match.message
    .edit({ content: `⌛ Time's up! <@${winner}> advances${present.length === 1 ? ' because their opponent didn\'t show up' : ' (nobody showed, so it was decided at random)'}.`, components: [] })
    .catch(() => {});
  matchOver(match, winner);
}

async function handleReady(interaction) {
  const run = runs.get(currentGuild());
  const matchId = interaction.customId.split(':')[2];
  const match = run?.matches.find((m) => m.id === matchId);
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (!match || match.done) return reply('This match is no longer active.');
  if (![match.a, match.b].includes(interaction.user.id)) return reply("This isn't your match.");

  match.ready.add(interaction.user.id);
  if (match.ready.size < 2) return reply('✅ You\'re ready! Waiting for your opponent…');

  await interaction.deferUpdate();
  clearTimeout(match.timer);

  const names = await Promise.all(
    [match.a, match.b].map(async (id) => (await run.client.users.fetch(id).catch(() => null))?.username ?? 'Fighter')
  );
  const game = duel.createMatch({
    players: [match.a, match.b],
    names,
    fair: true,
    bestOf: match.isFinal ? 3 : 1,
    noDraw: true,
    onFinish: (winnerId) => matchOver(match, winnerId),
  });
  game.message = match.message;
  startGame(game);
  await match.message.edit(duel.render(game)).catch(() => {});
}

async function finishTournament(winnerId) {
  const run = runs.get(currentGuild());
  const entrants = run.entrants.length;
  const pool = Math.floor(entrants * ENTRY_FEE * (1 - HOUSE_CUT));
  const first = Math.floor(pool * 0.7);
  const second = pool - first;
  const runnerUp = run.runnerUp;

  addCoins(winnerId, first);
  if (runnerUp) addCoins(runnerUp, second);

  await run.channel.send({
    content:
      `🏆 **The tournament is over!**\n🥇 <@${winnerId}> wins **${fmt(first)}**!\n` +
      `${runnerUp ? `🥈 <@${runnerUp}> takes home **${fmt(second)}**.\n` : ''}Thanks for playing, ${entrants} fighters!`,
    allowedMentions: { users: [winnerId, runnerUp].filter(Boolean) },
  });
  logging('info', 'Tournament finished', `${entrants} fighters, prize pool ${pool}`);

  state.players = [];
  state.running = false;
  save();
  run = null;
}

async function startTournament(client) {
  if (state.running) return { error: 'A tournament is already running.' };
  if (state.players.length < MIN_PLAYERS) return { error: `Not enough fighters yet (${state.players.length}/${MIN_PLAYERS}).` };

  const channel = await client.channels.fetch(state.channelId).catch(() => null);
  if (!channel) return { error: "I can't find the channel for the tournament. Sign up again from the channel you want it in." };

  const entrants = [...state.players].sort(() => Math.random() - 0.5);
  runs.set(currentGuild(), { client, channel, entrants, alive: entrants, round: 0, matches: [], nextAlive: [], pending: 0, runnerUp: null });
  state.running = true;
  save();

  await channel.send(
    `🏆 **The tournament begins!** ${entrants.length} fighters: ${entrants.map((id) => `<@${id}>`).join(', ')}\n` +
    'No gear or items: everyone fights on equal terms. Good luck!'
  );
  await startRound();
  return { text: 'The tournament has started!' };
}

async function cancelTournament() {
  const run = runs.get(currentGuild());
  if (run) {
    run.matches.forEach((m) => clearTimeout(m.timer));
    runs.delete(currentGuild());
  }
  
  state.players.forEach((id) => addCoins(id, ENTRY_FEE));
  const count = state.players.length;
  state.players = [];
  state.running = false;
  save();
  return { text: `The tournament was cancelled and ${count} fighter(s) were refunded.` };
}

// Runs every minute: starts the tournament on Saturdays at 18:00 UTC
async function checkAutoStart(client) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (state.running || now.getUTCDay() !== 6 || now.getUTCHours() < 18 || state.lastAutoDay === today) return;

  state.lastAutoDay = today;
  save();
  if (state.players.length >= MIN_PLAYERS) {
    const result = await startTournament(client);
    if (result.error) logging('warn', 'Tournament did not start', result.error);
  } else if (state.players.length > 0 && state.channelId) {
    const channel = await client.channels.fetch(state.channelId).catch(() => null);
    await channel?.send(`🏆 Not enough fighters for this week's tournament (${state.players.length}/${MIN_PLAYERS}). You stay signed up for next week!`).catch(() => {});
  }
}

module.exports = {
  ENTRY_FEE,
  joinTournament,
  leaveTournament,
  tournamentInfo,
  startTournament,
  cancelTournament,
  handleReady,
  checkAutoStart,
};
