const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { logging } = require('../logging');
const { peekUser, parseBet, betError, transferUpTo, recordQuest, fmt } = require('../economy');
const { recordRanked } = require('../ranked');

const CHALLENGE_MS = 60 * 1000; // how long a challenge can wait for an answer
const IDLE_MS = 5 * 60 * 1000; // a game ends if nobody clicks for this long

const games = new Map(); // gameId -> game
const challenges = new Map(); // challengeId -> challenge
const busy = new Map(); // userId -> gameId (one game at a time per person)
const modules = {}; // game type -> game module

function newId(map) {
  let id;
  do {
    id = Math.random().toString(36).slice(2, 8);
  } while (map.has(id));
  return id;
}

const registerModule = (type, mod) => {
  modules[type] = mod;
};
const isBusy = (userId) => busy.has(userId);
const privateReply = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral });

// ---------- Game lifecycle ----------

// (Re)starts the idle timer. When it runs out, the game's onExpire runs and the game ends.
function touch(game) {
  clearTimeout(game.timer);
  game.timer = setTimeout(async () => {
    try {
      await modules[game.type].onExpire(game);
    } catch (err) {
      logging('warn', 'Game expiry failed', err.message);
    }
    endGame(game);
  }, IDLE_MS);
}

function startGame(game) {
  game.id = newId(games);
  games.set(game.id, game);
  for (const player of game.players) busy.set(player, game.id);
  touch(game);
  return game;
}

function endGame(game) {
  clearTimeout(game.timer);
  games.delete(game.id);
  for (const player of game.players) {
    if (busy.get(player) === game.id) busy.delete(player);
  }
}

// Moves the bet from the loser to the winner (up to what the loser has). Returns the result text.
function settlePvp(game, winnerIdx) {
  const winner = game.players[winnerIdx];
  const loser = game.players[1 - winnerIdx];
  const moved = game.bet ? transferUpTo(loser, winner, game.bet) : 0;
  return `🏆 <@${winner}> wins!${moved ? ` They take **${fmt(moved)}** from <@${loser}>.` : ''}`;
}

// ---------- Challenges (duel, tic-tac-toe, Connect Four) ----------

async function sendChallenge(message, { type, title, challenger, opponent, bet }) {
  const id = newId(challenges);
  const challenge = { id, type, challenger, opponent, bet, timer: null };
  challenges.set(id, challenge);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`game:ch:${id}:accept`).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`game:ch:${id}:decline`).setLabel('Decline').setStyle(ButtonStyle.Danger)
  );

  const sent = await message.reply({
    content:
      `${title}\n<@${challenger.id}> challenges <@${opponent.id}>${bet ? ` for **${fmt(bet)}**` : ''}!\n` +
      `-# Only ${opponent.username} can accept. Expires in 60 seconds.`,
    components: [row],
    allowedMentions: { users: [opponent.id], repliedUser: false },
  });

  challenge.timer = setTimeout(() => {
    if (!challenges.delete(id)) return;
    sent.edit({ content: '⌛ The challenge expired.', components: [] }).catch(() => {});
  }, CHALLENGE_MS);
}

// Shared by !!duel, !!tictactoe, !!connect4: checks everything, then sends the challenge
async function runChallengeCommand(message, ctx, { type, title, usage }) {
  const opponent = message.mentions.users.first();
  if (!opponent) return message.reply(`Who do you want to play against? ${usage}`);
  if (opponent.bot) return message.reply("Bots can't play. Challenge a real person!");
  if (opponent.id === message.author.id) return message.reply("You can't challenge yourself.");

  let bet = 0;
  const betToken = ctx.rawArg.split(/\s+/).find((t) => t && !/^<@!?\d+>$/.test(t));
  if (betToken) {
    bet = parseBet(betToken, peekUser(message.author.id).coins);
    if (bet === null) return message.reply(`That bet isn't valid. ${usage}`);
  }

  const myError = betError(message.author.id, bet, { allowZero: true });
  if (myError) return message.reply(myError);
  if (betError(opponent.id, bet, { allowZero: true })) {
    return message.reply(`${opponent.username} can't afford a ${fmt(bet)} bet.`);
  }
  if (isBusy(message.author.id)) return message.reply("You're already in a game. Finish it first!");
  if (isBusy(opponent.id)) return message.reply(`${opponent.username} is already in a game.`);

  return sendChallenge(message, { type, title, challenger: message.author, opponent, bet });
}

async function handleChallenge(interaction, id, action) {
  const challenge = challenges.get(id);
  if (!challenge) return privateReply(interaction, 'That challenge has expired.');

  const userId = interaction.user.id;
  const { challenger, opponent } = challenge;

  if (action === 'decline') {
    if (userId !== opponent.id && userId !== challenger.id) {
      return privateReply(interaction, "This challenge isn't for you.");
    }
    clearTimeout(challenge.timer);
    challenges.delete(id);
    return interaction.update({
      content: userId === challenger.id
        ? `🚫 <@${challenger.id}> cancelled the challenge.`
        : `🚫 <@${opponent.id}> declined the challenge.`,
      components: [],
    });
  }

  // Accept
  if (userId !== opponent.id) {
    return privateReply(interaction, userId === challenger.id ? "You can't accept your own challenge." : "This challenge isn't for you.");
  }
  if (isBusy(challenger.id) || isBusy(opponent.id)) {
    return privateReply(interaction, 'One of you is already in another game.');
  }
  if (betError(challenger.id, challenge.bet, { allowZero: true }) || betError(opponent.id, challenge.bet, { allowZero: true })) {
    return privateReply(interaction, 'One of you no longer has enough coins for that bet.');
  }

  clearTimeout(challenge.timer);
  challenges.delete(id);

  const mod = modules[challenge.type];
  const game = mod.create(challenge);
  game.message = interaction.message;
  startGame(game);
  await interaction.update(mod.render(game));
}

// ---------- Button routing ----------

// Button IDs look like game:<type>:<gameId>:<action>:<extra>
async function handleGameButton(interaction) {
  const [, kind, id, action, arg] = interaction.customId.split(':');
  if (kind === 'ch') return handleChallenge(interaction, id, action);

  const game = games.get(id);
  if (!game) return privateReply(interaction, 'That game has ended or expired.');

  touch(game);
  await modules[game.type].handleButton(interaction, game, action, arg);
}

module.exports = {
  registerModule,
  startGame,
  endGame,
  isBusy,
  privateReply,
  settlePvp,
  runChallengeCommand,
  handleGameButton,
};
