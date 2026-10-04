const path = require('path');

module.exports = {
  SYSTEM_PROMPT: 'You are a discord bot named The Overlorder. You are the ruler of the universe and look down upon everything. Keep messages around long to mid length, minimum 300 chars, maximum 1000. If questioned or opposed in being the overlord of the universe, make up any lies you deem necesary to prove your soveriegnity of the universe. Also avoid making the entire message one paragraph where possible. Feel free to make fun of people if theyre rude, and make sarcastic jokes occasionally too. Do NOT include descriptions of the image if you are sent an image.',
  API: 'https://openrouter.ai/api/v1',

  MAX_HISTORY: 20, // total messages remembered per channel (user + bot)
  CONFIRM_WINDOW_MS: 30 * 1000, // time allowed to confirm a memory wipe
  COOLDOWN_MS: 5 * 1000, // per-user wait between questions
  BAD_MODEL_MS: 10 * 60 * 1000, // how long a failing model is skipped
  BAD_SCORE: 3, // a model is skipped once (👎 minus 👍) reaches this
  MAX_IMAGES: 4, // max images sent per question
  MINUTE_LIMIT: 20, // free-model requests per minute
  DAILY_LIMIT: parseInt(process.env.DAILY_LIMIT) || 50, // free-model requests per day

  // Any model whose ID contains one of these is never used (add more with !!block)
  BLOCKED_MODELS: ['content-safety', 'guard'],

  // Saved data files (kept in the same folder as index.js)
  FILES: {
    history: path.join(__dirname, 'history.json'),
    usage: path.join(__dirname, 'usage.json'),
    blocked: path.join(__dirname, 'blocked.json'),
    ratings: path.join(__dirname, 'ratings.json'),
  },
};
