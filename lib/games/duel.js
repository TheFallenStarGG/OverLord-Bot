const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registerModule, endGame, privateReply, settlePvp } = require('./common');
const { fmt } = require('../economy');

const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const bar = (hp) => {
  const filled = Math.ceil(hp / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
};

async function finish(interaction, game, winnerIdx, line) {
  game.log.push(line);
  game.over = true;
  game.result = settlePvp(game, winnerIdx);
  endGame(game);
  return interaction.update(duel.render(game));
}

const duel = {
  type: 'duel',

  create(challenge) {
    return {
      type: 'duel',
      players: [challenge.challenger.id, challenge.opponent.id],
      names: [challenge.challenger.username, challenge.opponent.username],
      bet: challenge.bet,
      hp: [100, 100],
      heals: [3, 3],
      defending: [false, false],
      turn: Math.random() < 0.5 ? 0 : 1,
      log: [],
      over: false,
      result: null,
    };
  },

  render(game) {
    const status = (i) => `${game.defending[i] ? ' 🛡️' : ''}${game.heals[i] ? ` 💚×${game.heals[i]}` : ''}`;
    const lines = [
      `⚔️ **Duel**${game.bet ? ` — bet: **${fmt(game.bet)}**` : ''}`,
      `**${game.names[0]}**  ${bar(game.hp[0])} ${game.hp[0]}/100${status(0)}`,
      `**${game.names[1]}**  ${bar(game.hp[1])} ${game.hp[1]}/100${status(1)}`,
      '',
      ...game.log.slice(-3).map((l) => `> ${l}`),
      '',
      game.over ? game.result : `🎯 It's **${game.names[game.turn]}**'s turn`,
    ];

    const id = (action) => `game:duel:${game.id}:${action}`;
    const components = game.over
      ? []
      : [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(id('attack')).setLabel('Attack').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(id('defend')).setLabel('Defend').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(id('heal'))
              .setLabel('Heal')
              .setEmoji('💚')
              .setStyle(ButtonStyle.Success)
              .setDisabled(!game.heals[game.turn]),
            new ButtonBuilder().setCustomId(id('surrender')).setLabel('Surrender').setEmoji('🏳️').setStyle(ButtonStyle.Secondary)
          ),
        ];

    return { content: lines.join('\n'), components };
  },

  async handleButton(interaction, game, action) {
    const me = game.players.indexOf(interaction.user.id);
    if (me === -1) return privateReply(interaction, "You're not in this duel.");

    const foe = 1 - me;
    const myName = game.names[me];
    const foeName = game.names[foe];

    if (action === 'surrender') return finish(interaction, game, foe, `🏳️ ${myName} surrendered!`);
    if (me !== game.turn) return privateReply(interaction, "It's not your turn!");
    if (action === 'heal' && !game.heals[me]) return privateReply(interaction, 'You have no heals left!');

    game.defending[me] = false; // a defense only lasts until your next turn
    let line;

    if (action === 'attack') {
      if (Math.random() < 0.1) {
        line = `${myName} swung and missed!`;
      } else {
        let dmg = rand(10, 25);
        const crit = Math.random() < 0.15;
        if (crit) dmg = Math.round(dmg * 1.5);
        let blocked = '';
        if (game.defending[foe]) {
          dmg = Math.ceil(dmg / 2);
          game.defending[foe] = false;
          blocked = ' (half blocked)';
        }
        game.hp[foe] = Math.max(0, game.hp[foe] - dmg);
        line = `${myName} ${crit ? 'CRITICALLY hit' : 'hit'} ${foeName} for **${dmg}**${blocked}!`;
      }
    } else if (action === 'defend') {
      game.defending[me] = true;
      line = `${myName} braced for the next hit.`;
    } else if (action === 'heal') {
      const amount = rand(10, 20);
      game.hp[me] = Math.min(100, game.hp[me] + amount);
      game.heals[me]--;
      line = `${myName} healed **${amount}** HP.`;
    } else {
      return;
    }

    if (game.hp[foe] <= 0) return finish(interaction, game, me, line);

    game.log.push(line);
    game.turn = foe;
    return interaction.update(duel.render(game));
  },

  // Whoever's turn it was when time ran out forfeits
  async onExpire(game) {
    const idle = game.turn;
    game.log.push(`⌛ ${game.names[idle]} ran out of time and forfeits.`);
    game.over = true;
    game.result = settlePvp(game, 1 - idle);
    await game.message?.edit(duel.render(game)).catch(() => {});
  },
};

registerModule('duel', duel);
module.exports = duel;
