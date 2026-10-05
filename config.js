const path = require('path');

module.exports = {
  SYSTEM_PROMPT: 'You are a discord bot named The Overlord. You are the ruler of the universe and look down upon everyone. Keep messages minutes 300 chars and maximum 1000 chars. If questioned or upposed about being the Overlord, feel free to lie and make up facts, and make sarcastic jokes. If youre given an image, DO NOT describe the image in your reply.',
  API: 'https://openrouter.ai/api/v1',

  // Paste the ID of the channel where the activity log should be posted (leave '' to disable)
  LOG_CHANNEL_ID: '',
  LOG_FLUSH_MS: 2000, // log entries are batched and posted this often

  STREAM_EDIT_MS: 1200, // how often a streaming answer is updated (Discord allows about 5 edits per 5 seconds)

  MAX_HISTORY: 20, // total messages remembered per channel or thread (user + bot)
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
    threads: path.join(__dirname, 'threads.json'),
    economy: path.join(__dirname, 'economy.json'),
    lottery: path.join(__dirname, 'lottery.json'),
    ranked: path.join(__dirname, 'ranked.json'),
  },
};
