const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { registerModule, endGame, privateReply } = require('./common');
const { addCoins, recordQuest, fmt } = require('../economy');

const MAX_MISSES = 6;

const WORDS = [
  'discord', 'keyboard', 'dragon', 'treasure', 'pirate', 'galaxy', 'volcano', 'castle', 'wizard', 'rocket',
  'jungle', 'diamond', 'library', 'pyramid', 'lantern', 'octopus', 'penguin', 'thunder', 'blizzard', 'harvest',
  'compass', 'mermaid', 'tornado', 'pancake', 'backpack', 'festival', 'glacier', 'hamburger', 'island', 'jigsaw',
  'kangaroo', 'labyrinth', 'mountain', 'notebook', 'orchestra', 'parachute', 'quicksand', 'rainbow', 'sandwich',
  'telescope', 'umbrella', 'village', 'waterfall', 'xylophone', 'yesterday', 'zeppelin', 'blueberry', 'campfire',
  'dinosaur', 'elephant', 'firework', 'giraffe', 'hurricane', 'jellyfish', 'knight', 'lighthouse', 'magnet',
  'nightmare', 'popcorn', 'raccoon', 'skeleton', 'sunflower', 'treehouse', 'vampire', 'werewolf', 'goblin',
  'blacksmith', 'tavern', 'dungeon', 'phoenix', 'unicorn', 'submarine', 'astronaut', 'avalanche', 'butterfly',
];

const reward = (game) => 20 + 5 * (MAX_MISSES - game.misses); // 25 to 50 coins

function drawing(m) {
  const head = m >= 1 ? 'O' : ' ';
  const body = m >= 2 ? '|' : ' ';
  const lArm = m >= 3 ? '/' : ' ';
  const rArm = m >= 4 ? '\\' : ' ';
  const lLeg = m >= 5 ? '/' : ' ';
  const rLeg = m >= 6 ? '\\' : ' ';
  return ['  +---+', '  |   |', `  ${head}   |`, ` ${lArm}${body}${rArm}  |`, ` ${lLeg} ${rLeg}  |`, '      |', '========='].join('\n');
}

const solved = (game) => [...game.word].every((c) => game.letters.has(c));

const hangman = {
  type: 'hm',

  create({ user }) {
    return {
      type: 'hm',
      players: [user.id],
      name: user.username,
      word: WORDS[Math.floor(Math.random() * WORDS.length)],
      letters: new Set(), // every letter guessed
      wrong: new Set(), // wrong letters
      misses: 0,
      over: false,
      result: null,
    };
  },

  render(game) {
    const shown = [...game.word].map((c) => (game.letters.has(c) || game.over ? c.toUpperCase() : '_')).join(' ');
    const wrong = [...game.wrong].map((c) => c.toUpperCase()).join(', ') || 'none';
    const lines = [
      `🔤 **Hangman** — started by **${game.name}**. Anyone can guess!`,
      '```\n' + drawing(game.misses) + '\n```',
      `Word: \`${shown}\``,
      `❌ Wrong letters: ${wrong} (${game.misses}/${MAX_MISSES})`,
    ];
    if (game.over) {
      lines.push('', game.result);
      return { content: lines.join('\n'), components: [] };
    }
    lines.push('Press **Guess** to try a letter or the whole word.');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`game:hm:${game.id}:guess`).setEmoji('✏️').setLabel('Guess').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`game:hm:${game.id}:giveup`).setEmoji('🏳️').setLabel('Give up').setStyle(ButtonStyle.Danger)
    );
    return { content: lines.join('\n'), components: [row] };
  },

  async handleButton(interaction, game, action) {
    if (action === 'giveup') {
      if (interaction.user.id !== game.players[0]) return privateReply(interaction, 'Only the person who started the game can give up.');
      game.over = true;
      game.result = `🏳️ Given up. The word was **${game.word.toUpperCase()}**.`;
      endGame(game);
      return interaction.update(hangman.render(game));
    }

    if (action === 'guess') {
      const modal = new ModalBuilder()
        .setCustomId(`game:hm:${game.id}:modal`)
        .setTitle('Hangman guess')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('guess').setLabel('A letter, or the whole word').setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(20).setRequired(true)
          )
        );
      return interaction.showModal(modal);
    }

    if (action !== 'modal') return;

    const text = interaction.fields.getTextInputValue('guess').trim().toLowerCase();
    if (!/^[a-z]+$/.test(text)) return privateReply(interaction, 'Use letters only (a to z).');

    if (text.length === 1) {
      if (game.letters.has(text)) return privateReply(interaction, `The letter **${text.toUpperCase()}** was already guessed.`);
      game.letters.add(text);
      if (!game.word.includes(text)) {
        game.wrong.add(text);
        game.misses++;
      }
    } else if (text === game.word) {
      for (const c of game.word) game.letters.add(c);
    } else {
      game.misses++; // a wrong whole-word guess costs a life
    }

    if (solved(game)) {
      const prize = reward(game);
      addCoins(interaction.user.id, prize);
      recordQuest(interaction.user.id, 'win');
      game.over = true;
      game.result = `🎉 <@${interaction.user.id}> solved it! The word was **${game.word.toUpperCase()}**. They win **${fmt(prize)}**.`;
    } else if (game.misses >= MAX_MISSES) {
      game.over = true;
      game.result = `💀 Out of lives! The word was **${game.word.toUpperCase()}**.`;
    }

    if (game.over) endGame(game);
    return interaction.update(hangman.render(game));
  },

  async onExpire(game) {
    if (game.over) return;
    game.over = true;
    game.result = `⌛ Nobody finished in time. The word was **${game.word.toUpperCase()}**.`;
    await game.message?.edit(hangman.render(game)).catch(() => {});
  },
};

registerModule('hm', hangman);
module.exports = hangman;
