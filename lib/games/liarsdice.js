const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { registerModule, endGame, joinGame, leaveGame, isBusy, privateReply } = require('./common');
const { betError, transferUpTo, fmt } = require('../economy');

const START_DICE = 4; // dice each player starts with
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;
const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const SINGULAR = ['one', 'two', 'three', 'four', 'five', 'six'];
const PLURAL = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];

const alive = (game, i) => game.counts[i] > 0;
const aliveList = (game) => game.players.map((_, i) => i).filter((i) => alive(game, i));
const totalDice = (game) => game.counts.reduce((a, b) => a + b, 0);
const dieLine = (dice) => dice.map((d) => FACES[d - 1]).join(' ');
const bidText = (qty, face) => `**${qty} × ${FACES[face - 1]}** (${qty} ${qty === 1 ? SINGULAR[face - 1] : PLURAL[face - 1]})`;
const tag = (game, i) => `<@${game.players[i]}>`;

function nextAlive(game, from) {
  for (let k = 1; k <= game.players.length; k++) {
    const i = (from + k) % game.players.length;
    if (alive(game, i)) return i;
  }
  return from;
}

// Everyone still in rolls their dice in secret, and `starter` (or the next player still in) goes first
function startRound(game, starter) {
  game.round++;
  game.dice = game.players.map((_, i) => Array.from({ length: game.counts[i] }, () => 1 + Math.floor(Math.random() * 6)));
  game.bid = null;
  game.turn = alive(game, starter) ? starter : nextAlive(game, starter);
}

function createLobby(user, bet) {
  return {
    type: 'ldice',
    phase: 'lobby', // lobby -> play -> over
    players: [user.id],
    names: [user.username],
    host: user.id,
    bet,
    dice: [],
    counts: [],
    turn: 0,
    bid: null, // { qty, face, by }
    round: 0,
    log: [],
    reveal: null,
    over: false,
    result: null,
  };
}

function begin(game) {
  game.phase = 'play';
  game.counts = game.players.map(() => START_DICE);
  startRound(game, Math.floor(Math.random() * game.players.length));
  game.log.push('The dice are rolled. Press **My dice** to peek at yours!');
}

function finish(interaction, game, winnerIdx) {
  game.phase = 'over';
  game.over = true;
  const winner = game.players[winnerIdx];
  let pot = 0;
  if (game.bet) game.players.forEach((p, i) => (i === winnerIdx ? 0 : (pot += transferUpTo(p, winner, game.bet))));
  game.result = `🏆 <@${winner}> is the last player standing and wins!${pot ? ` They collect **${fmt(pot)}** from the other players.` : ''}`;
  endGame(game);
  return interaction.update(ldice.render(game));
}

// Someone called "Liar!": reveal everything and see who loses a die
function resolveCall(interaction, game, caller) {
  const { qty, face, by } = game.bid;
  const actual = game.dice.flat().filter((d) => d === face).length;
  const bidderLied = actual < qty;
  const loser = bidderLied ? by : caller;

  const hands = game.players
    .map((_, i) => (alive(game, i) ? `${tag(game, i)}: ${dieLine(game.dice[i])}` : null))
    .filter(Boolean)
    .join('\n');
  game.reveal =
    `🔎 ${tag(game, caller)} called **Liar!** on ${bidText(qty, face)}.\n` +
    `There were **${actual}** ${actual === 1 ? SINGULAR[face - 1] : PLURAL[face - 1]} on the table, so ` +
    `${bidderLied ? `${tag(game, by)} was lying!` : `${tag(game, by)} was telling the truth!`}\n${hands}`;

  game.counts[loser]--;
  const out = game.counts[loser] === 0;
  game.log.push(`💥 ${tag(game, loser)} loses a die${out ? ' and is out of the game! 💀' : ` (${game.counts[loser]} left).`}`);

  const left = aliveList(game);
  if (left.length === 1) return finish(interaction, game, left[0]);

  startRound(game, loser); // the loser starts the next round (or the next player if they are out)
  return interaction.update(ldice.render(game));
}

function bidModal(game) {
  const b = game.bid;
  return new ModalBuilder()
    .setCustomId(`game:ldice:${game.id}:bidSubmit`)
    .setTitle('Place your bid')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('qty')
          .setLabel(`How many dice? (1-${totalDice(game)})`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(b ? `More than ${b.qty}, or ${b.qty} with a higher face` : 'For example 3')
          .setRequired(true)
          .setMaxLength(2)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('face')
          .setLabel('Which face? (1-6)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('1 to 6')
          .setRequired(true)
          .setMaxLength(1)
      )
    );
}

const RULES =
  `Everyone secretly rolls ${START_DICE} dice. Take turns bidding on how many dice of one face are on the table **in total**, across everyone's dice. ` +
  'Each bid must go higher (more dice, or the same number of a higher face), or you can call **Liar!** ' +
  'If the bid was true, the caller loses a die. If it was a lie, the bidder does. The last player with dice wins.';

const ldice = {
  type: 'ldice',
  createLobby,

  render(game) {
    const id = (action) => `game:ldice:${game.id}:${action}`;
    const button = (action, label, style, emoji) => {
      const b = new ButtonBuilder().setCustomId(id(action)).setLabel(label).setStyle(style);
      if (emoji) b.setEmoji(emoji);
      return b;
    };
    const title = `🎲 **Liar's Dice**${game.bet ? ` — bet: **${fmt(game.bet)}** each` : ''}`;

    if (game.phase === 'lobby') {
      return {
        content: [
          title,
          `**Players (${game.players.length}/${MAX_PLAYERS}):** ${game.players.map((p) => `<@${p}>`).join(', ')}`,
          '',
          RULES,
          `-# The host starts the game once ${MIN_PLAYERS}-${MAX_PLAYERS} players have joined.${game.bet ? ' Everyone who joins antes the bet.' : ''}`,
        ].join('\n'),
        components: [
          new ActionRowBuilder().addComponents(
            button('join', 'Join', ButtonStyle.Success, '🎲'),
            button('leave', 'Leave', ButtonStyle.Secondary, '🚪'),
            button('start', 'Start', ButtonStyle.Primary, '▶️').setDisabled(game.players.length < MIN_PLAYERS),
            button('cancel', 'Cancel', ButtonStyle.Danger, '✖️')
          ),
        ],
      };
    }

    const standings = game.players
      .map((p, i) => (alive(game, i) ? `<@${p}> 🎲×${game.counts[i]}` : `~~<@${p}>~~ 💀`))
      .join('  ·  ');

    if (game.phase === 'over') {
      return {
        content: [title, standings, '', ...(game.reveal ? [game.reveal, ''] : []), ...game.log.slice(-2).map((l) => `> ${l}`), '', game.result].join('\n'),
        components: [],
      };
    }

    const bidLine = game.bid
      ? `Current bid: ${bidText(game.bid.qty, game.bid.face)} by ${tag(game, game.bid.by)}`
      : `No bid yet. ${tag(game, game.turn)} opens the round.`;

    return {
      content: [
        title,
        standings,
        '',
        ...(game.reveal && !game.bid ? [game.reveal, ''] : []),
        `**Round ${game.round}** · ${totalDice(game)} dice in play`,
        bidLine,
        '',
        ...game.log.slice(-3).map((l) => `> ${l}`),
        '',
        `🎯 ${tag(game, game.turn)}'s turn.`,
      ].join('\n'),
      components: [
        new ActionRowBuilder().addComponents(
          button('bid', 'Bid', ButtonStyle.Primary, '📣'),
          button('liar', 'Call Liar!', ButtonStyle.Danger, '🤥').setDisabled(!game.bid),
          button('dice', 'My dice', ButtonStyle.Secondary, '🎲'),
          button('forfeit', 'Forfeit', ButtonStyle.Secondary, '🏳️')
        ),
      ],
    };
  },

  async handleButton(interaction, game, action) {
    const userId = interaction.user.id;
    const me = game.players.indexOf(userId);

    // ----- Lobby -----
    if (game.phase === 'lobby') {
      const isHost = userId === game.host;

      if (action === 'join') {
        if (me !== -1) return privateReply(interaction, "You've already joined.");
        if (game.players.length >= MAX_PLAYERS) return privateReply(interaction, 'This game is full.');
        if (isBusy(userId)) return privateReply(interaction, "You're already in another game.");
        const error = betError(userId, game.bet, { allowZero: true });
        if (error) return privateReply(interaction, error);
        joinGame(game, userId);
        game.names.push(interaction.user.username);
        return interaction.update(ldice.render(game));
      }

      if (action === 'leave') {
        if (me === -1) return privateReply(interaction, "You haven't joined.");
        if (isHost) return privateReply(interaction, 'You are the host. Press Cancel to close the lobby instead.');
        leaveGame(game, userId);
        game.names.splice(me, 1);
        return interaction.update(ldice.render(game));
      }

      if (action === 'cancel') {
        if (!isHost) return privateReply(interaction, 'Only the host can cancel the game.');
        game.over = true;
        endGame(game);
        return interaction.update({ content: "🚫 The host cancelled Liar's Dice.", components: [] });
      }

      if (action === 'start') {
        if (!isHost) return privateReply(interaction, 'Only the host can start the game.');
        if (game.players.length < MIN_PLAYERS) return privateReply(interaction, `You need at least ${MIN_PLAYERS} players.`);
        for (const p of game.players) {
          if (betError(p, game.bet, { allowZero: true })) return privateReply(interaction, `<@${p}> no longer has enough coins for the bet.`);
        }
        begin(game);
        return interaction.update(ldice.render(game));
      }

      return privateReply(interaction, 'The game has not started yet.');
    }

    // ----- Playing -----
    if (me === -1) return privateReply(interaction, "You're not in this game.");
    if (!alive(game, me)) return privateReply(interaction, "You're out of this game!");

    if (action === 'dice') {
      return privateReply(interaction, `🎲 **Your dice:** ${dieLine(game.dice[me])}\n-# ${totalDice(game)} dice in play in total.`);
    }

    if (action === 'forfeit') {
      game.counts[me] = 0;
      game.log.push(`🏳️ ${tag(game, me)} forfeited and is out of the game!`);
      const left = aliveList(game);
      if (left.length === 1) return finish(interaction, game, left[0]);
      game.reveal = null;
      startRound(game, me); // everyone re-rolls
      return interaction.update(ldice.render(game));
    }

    if (me !== game.turn) return privateReply(interaction, "It's not your turn!");

    if (action === 'bid') return interaction.showModal(bidModal(game));

    if (action === 'liar') {
      if (!game.bid) return privateReply(interaction, 'There is no bid to challenge yet. Make the first bid!');
      return resolveCall(interaction, game, me);
    }

    if (action === 'bidSubmit') {
      const qty = Number(interaction.fields.getTextInputValue('qty').trim());
      const face = Number(interaction.fields.getTextInputValue('face').trim());
      const total = totalDice(game);

      if (!Number.isInteger(qty) || qty < 1 || qty > total) {
        return privateReply(interaction, `The number of dice must be a whole number from 1 to ${total}.`);
      }
      if (!Number.isInteger(face) || face < 1 || face > 6) {
        return privateReply(interaction, 'The face must be a number from 1 to 6.');
      }
      const b = game.bid;
      if (b && !(qty > b.qty || (qty === b.qty && face > b.face))) {
        return privateReply(interaction, `Your bid has to beat **${b.qty} × ${FACES[b.face - 1]}**: more dice, or the same number of a higher face.`);
      }

      game.bid = { qty, face, by: me };
      game.reveal = null;
      game.log.push(`${tag(game, me)} bids ${bidText(qty, face)}.`);
      game.turn = nextAlive(game, me);
      return interaction.update(ldice.render(game));
    }

    return privateReply(interaction, "You can't do that right now.");
  },

  async onExpire(game) {
    if (game.phase === 'lobby') {
      game.over = true;
      await game.message?.edit({ content: "⌛ The Liar's Dice lobby expired.", components: [] }).catch(() => {});
      return;
    }
    if (game.phase !== 'play') return;

    // Whoever was holding up the game forfeits and pays the players still in
    const idle = game.turn;
    game.phase = 'over';
    game.over = true;
    let paid = 0;
    if (game.bet) {
      game.players.forEach((p, i) => {
        if (i !== idle && alive(game, i)) paid += transferUpTo(game.players[idle], p, game.bet);
      });
    }
    game.result = `⌛ ${tag(game, idle)} ran out of time and forfeits.${paid ? ` They pay **${fmt(paid)}** to the players still in.` : ''}`;
    await game.message?.edit(ldice.render(game)).catch(() => {});
  },
};

registerModule('ldice', ldice);
module.exports = ldice;
