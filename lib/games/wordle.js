const { WORDS } = require('./words');
const { addCoins, fmt } = require('../economy');
const { isChatThread } = require('../threads');
const { logging } = require('../logging');

const MAX_GUESSES = 6;
const GAME_MS = 10 * 60 * 1000;
const START_COOLDOWN_MS = 5 * 60 * 10;

const wordles = new Map(); // channelId -> game
const cooldowns = new Map(); // userId -> when they last started one

// Standard Wordle scoring, including repeated letters
function score(guess, answer) {
  const result = Array(5).fill('⬛');
  const remaining = {};

  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) result[i] = '🟩';
    else remaining[answer[i]] = (remaining[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (result[i] === '🟩') continue;
    if (remaining[guess[i]] > 0) {
      result[i] = '🟨';
      remaining[guess[i]]--;
    }
  }
  return result.join('');
}

function boardText(game, footer) {
  const lines = [`🟩 **Wordle** — guess the 5-letter word! (${game.guesses.length}/${MAX_GUESSES})`, ''];
  for (const g of game.guesses) lines.push(`${g.squares} \`${g.word.toUpperCase().split('').join(' ')}\``);
  for (let i = game.guesses.length; i < MAX_GUESSES; i++) lines.push('⬜⬜⬜⬜⬜');
  lines.push('', footer);
  return lines.join('\n');
}

const START_FOOTER = 'Type a 5-letter word in this channel to guess. Everyone can play! Closes in 10 minutes.';

async function startWordle(message) {
  if (message.channel.isThread() && isChatThread(message.channel.id)) {
    return message.reply("Wordle can't run in a chat thread, because I'd treat every guess as a question. Try another channel.");
  }
  if (wordles.has(message.channel.id)) return message.reply('There is already a Wordle running in this channel!');

  const wait = (cooldowns.get(message.author.id) ?? 0) + START_COOLDOWN_MS - Date.now();
  if (wait > 0) return message.reply(`Take a breather! You can start another Wordle in ${Math.ceil(wait / 1000)}s.`);
  cooldowns.set(message.author.id, Date.now());

  const game = {
    answer: WORDS[Math.floor(Math.random() * WORDS.length)],
    guesses: [],
    board: null,
    timer: null,
  };
  wordles.set(message.channel.id, game);

  game.board = await message.channel.send(boardText(game, START_FOOTER));
  game.timer = setTimeout(async () => {
    wordles.delete(message.channel.id);
    await message.channel.send(`⏰ Time's up! The word was **${game.answer.toUpperCase()}**.`).catch(() => {});
  }, GAME_MS);
}

// Called for every message: treats any 5-letter word as a guess while a game is running in the channel
async function handleGuess(message) {
  if (message.author.bot) return;
  const game = wordles.get(message.channel.id);
  if (!game) return;

  const word = message.content.trim().toLowerCase();
  if (!/^[a-z]{5}$/.test(word)) return;
  if (game.guesses.some((g) => g.word === word)) return message.react('🔁').catch(() => {});

  game.guesses.push({ word, squares: score(word, game.answer) });
  const solved = word === game.answer;
  const outOfGuesses = game.guesses.length >= MAX_GUESSES;

  let footer = START_FOOTER;
  if (solved) {
    const reward = (MAX_GUESSES + 1 - game.guesses.length) * 25;
    addCoins(message.author.id, reward);
    footer = `🎉 <@${message.author.id}> got it in **${game.guesses.length}**! They win **${fmt(reward)}**.`;
    logging('info', 'Wordle solved', `${message.author.username} in ${game.guesses.length} guess(es)`);
  } else if (outOfGuesses) {
    footer = `💀 Out of guesses! The word was **${game.answer.toUpperCase()}**.`;
  }

  if (solved || outOfGuesses) {
    clearTimeout(game.timer);
    wordles.delete(message.channel.id);
  }

  // Move the board down to the bottom of the chat so it's easy to find
  game.board?.delete().catch(() => {});
  game.board = await message.channel.send(boardText(game, footer));
}

module.exports = { startWordle, handleGuess };
