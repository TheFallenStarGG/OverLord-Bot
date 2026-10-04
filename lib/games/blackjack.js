const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registerModule, endGame, privateReply } = require('./common');
const { applyDelta, peekUser, fmt } = require('../economy');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function newDeck() {
  const deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Aces count as 11 unless that would bust the hand
function value(hand) {
  let total = 0;
  let aces = 0;
  for (const { rank } of hand) {
    if (rank === 'A') {
      total += 11;
      aces++;
    } else if (['10', 'J', 'Q', 'K'].includes(rank)) {
      total += 10;
    } else {
      total += Number(rank);
    }
  }
  while (total > 21 && aces) {
    total -= 10;
    aces--;
  }
  return total;
}

const show = (hand) => hand.map((c) => `**${c.rank}${c.suit}**`).join(' ');

// outcome: 'blackjack' | 'win' | 'lose' | 'push'
function settle(game, outcome, why) {
  game.over = true;

  let delta = 0;
  if (outcome === 'blackjack') delta = Math.floor(game.bet * 1.5);
  else if (outcome === 'win') delta = game.bet;
  else if (outcome === 'lose') delta = -game.bet;

  const actual = game.bet ? applyDelta(game.players[0], delta) : 0;
  const headline = {
    blackjack: '🎉 **Blackjack!**',
    win: '✅ **You win!**',
    lose: '❌ **You lose.**',
    push: '🤝 **Push.**',
  }[outcome];

  let money = '';
  if (game.bet) {
    if (actual > 0) money = ` +${fmt(actual)}`;
    else if (actual < 0) money = ` −${fmt(-actual)}`;
    else money = ' Your bet is returned.';
    money += `\nBalance: ${fmt(peekUser(game.players[0]).coins)}`;
  }
  game.result = `${headline} ${why}${money}`;
}

// The dealer draws until reaching 17, then the hands are compared
function dealerPlay(game) {
  while (value(game.dealer) < 17) game.dealer.push(game.deck.pop());
  const p = value(game.player);
  const d = value(game.dealer);

  if (d > 21) settle(game, 'win', 'The dealer busts.');
  else if (p > d) settle(game, 'win', `${p} beats ${d}.`);
  else if (p < d) settle(game, 'lose', `The dealer's ${d} beats your ${p}.`);
  else settle(game, 'push', `You both have ${p}.`);
}

const blackjack = {
  type: 'blackjack',

  create({ user, bet }) {
    const deck = newDeck();
    const game = {
      type: 'blackjack',
      players: [user.id],
      name: user.username,
      bet,
      deck,
      player: [deck.pop(), deck.pop()],
      dealer: [deck.pop(), deck.pop()],
      over: false,
      result: null,
    };

    // Naturals are settled straight away
    const playerNatural = value(game.player) === 21;
    const dealerNatural = value(game.dealer) === 21;
    if (playerNatural && dealerNatural) settle(game, 'push', 'You both have blackjack.');
    else if (playerNatural) settle(game, 'blackjack', 'You were dealt 21!');
    else if (dealerNatural) settle(game, 'lose', 'The dealer has blackjack.');

    return game;
  },

  render(game) {
    const lines = [
      `🃏 **Blackjack**${game.bet ? ` — bet: **${fmt(game.bet)}**` : ' — practice round (no bet)'}`,
      `**${game.name}:** ${show(game.player)} — **${value(game.player)}**`,
      `**Dealer:** ${game.over ? `${show(game.dealer)} — **${value(game.dealer)}**` : `${show([game.dealer[0]])} ❓`}`,
      '',
      game.over ? game.result : 'Hit or stand?',
    ];

    const components = game.over
      ? []
      : [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`game:blackjack:${game.id}:hit`).setLabel('Hit').setEmoji('🃏').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`game:blackjack:${game.id}:stand`).setLabel('Stand').setEmoji('✋').setStyle(ButtonStyle.Success)
          ),
        ];

    return { content: lines.join('\n'), components };
  },

  async handleButton(interaction, game, action) {
    if (interaction.user.id !== game.players[0]) return privateReply(interaction, "This isn't your game.");

    if (action === 'hit') {
      game.player.push(game.deck.pop());
      const total = value(game.player);
      if (total > 21) settle(game, 'lose', `You bust with ${total}.`);
      else if (total === 21) dealerPlay(game); // 21 stands automatically
    } else if (action === 'stand') {
      dealerPlay(game);
    } else {
      return;
    }

    if (game.over) endGame(game);
    return interaction.update(blackjack.render(game));
  },

  // If you walk away, you automatically stand
  async onExpire(game) {
    dealerPlay(game);
    await game.message?.edit(blackjack.render(game)).catch(() => {});
  },
};

registerModule('blackjack', blackjack);
module.exports = blackjack;
