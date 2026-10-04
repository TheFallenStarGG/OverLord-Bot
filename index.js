const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
  allowedMentions: { parse: [], repliedUser: false },
});

const SYSTEM_PROMPT = 'You are a discord bot named The Overlorder. You are the ruler of the universe and look down upon everything. Keep messages around long to mid length, minimum 300 chars, maximum 1000. If questioned or opposed in being the overlord of the universe, make up any lies you deem necesary to prove your soveriegnity of the universe. Also avoid making the entire message one paragraph where possible. Feel free to make fun of people if theyre rude, and make sarcastic jokes occasionally too. Do NOT include descriptions of the image if you are sent an image.';
const API = 'https://openrouter.ai/api/v1';
const MAX_HISTORY = 20; // total messages remembered per channel (user + bot)
const CONFIRM_WINDOW_MS = 30 * 1000; // time allowed to confirm a wipe
const COOLDOWN_MS = 5 * 1000; // per-user wait between questions
const BAD_MODEL_MS = 10 * 60 * 1000; // how long a failing model is skipped
const BAD_SCORE = 5; // a model is skipped once (👎 minus 👍) reaches this
const MAX_IMAGES = 4; // max images sent per question
const MINUTE_LIMIT = 20; // free-model requests per minute
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT) || 50; // free-model requests per day

// Any model whose ID contains one of these is never used (add more with !!block)
const BLOCKED_MODELS = ['content-safety', 'guard'];

const HISTORY_FILE = path.join(__dirname, 'history.json');
const USAGE_FILE = path.join(__dirname, 'usage.json');
const BLOCKED_FILE = path.join(__dirname, 'blocked.json');
const RATINGS_FILE = path.join(__dirname, 'ratings.json');

// ---------- Saving to disk ----------

// Writes to a temp file first, then swaps it in, so a crash mid-save can't corrupt the data
function writeJson(file, data) {
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error(`Could not save ${path.basename(file)}:`, err);
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// ---------- Chat memory ----------

const histories = new Map(Object.entries(readJson(HISTORY_FILE, {}))); // channelId -> [{ role, content }, ...]

function saveHistories() {
  writeJson(HISTORY_FILE, Object.fromEntries(histories));
}

const pendingWipes = new Map(); // "channelId:userId" -> expiry timestamp
const cooldowns = new Map(); // userId -> last question timestamp
const lastAsked = new Map(); // channelId -> last question (for !!retry, lost on restart)

// ---------- Request usage tracking ----------

const todayUTC = () => new Date().toISOString().slice(0, 10);

let usage = readJson(USAGE_FILE, { date: todayUTC(), count: 0 });
let recentRequests = []; // timestamps from the last minute

function todayCount() {
  return usage.date === todayUTC() ? usage.count : 0;
}

function nextResetTs() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

// Called once for every request sent to OpenRouter
function recordRequest() {
  if (usage.date !== todayUTC()) usage = { date: todayUTC(), count: 0 };
  usage.count++;
  recentRequests.push(Date.now());
  writeJson(USAGE_FILE, usage);
}

function usageMessage() {
  const today = todayCount();
  recentRequests = recentRequests.filter((t) => Date.now() - t < 60 * 1000);
  const left = Math.max(DAILY_LIMIT - today, 0);
  const ts = nextResetTs();

  return [
    `Requests today: **${today} / ${DAILY_LIMIT}** (${left} left)`,
    `Last minute: ${recentRequests.length} / ${MINUTE_LIMIT}`,
    `Daily count resets: <t:${ts}:F> (<t:${ts}:R>)`,
  ].join('\n');
}

function dailyLimitText() {
  return `I've used all ${DAILY_LIMIT} of today's free requests. They reset <t:${nextResetTs()}:R>.`;
}

// Returns a message to send if the user can't ask right now, otherwise starts their cooldown
function checkLimits(userId, isOwner) {
  if (todayCount() >= DAILY_LIMIT) return dailyLimitText();
  if (!isOwner) {
    const wait = (cooldowns.get(userId) ?? 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) return `Slow down! Try again in ${Math.ceil(wait / 1000)}s.`;
  }
  cooldowns.set(userId, Date.now());
  return null;
}

// ---------- Help ----------

function helpText() {
  const free = '🔓 Free to use';
  // These are only locked if the OWNER_ID environment variable is set
  const locked = process.env.OWNER_ID ? '🔒 Owner only' : '🔓 Anyone (not locked: set OWNER_ID)';
  const lockedAlways = '🔒 Owner only (needs OWNER_ID set)';

  return [
    '**Commands**',
    '',
    `**<@${client.user.id}> <message>** — ${free}`,
    `Ask the AI anything. Attach images, or reply to a message to give it context. Each person has a ${COOLDOWN_MS / 1000}s cooldown.`,
    '',
    `**!!retry** — ${free}`,
    'Answers the last question in this channel again with a different model.',
    '',
    `**!!help** — ${free}`,
    'Shows this list.',
    '',
    `**!!usage** — ${locked}`,
    "Shows today's free requests used, requests in the last minute, and when the count resets.",
    '',
    `**!!models** — ${locked}`,
    'Lists the available free models with their 👍/👎 scores and whether any are being skipped.',
    '',
    `**!!memory-wipe** — ${locked}`,
    "Erases my memory of this channel. Asks you to reply `proceed` to confirm.",
    '',
    `**!!block <name>** — ${lockedAlways}`,
    'Blocks every model whose ID contains the text, e.g. `!!block nemotron`.',
    '',
    `**!!unblock <name>** — ${lockedAlways}`,
    'Removes a block that was added with `!!block`.',
    '',
    'React with 👍 or 👎 on my answers to rate the model that wrote them.',
  ].join('\n');
}

// ---------- Blocklist and ratings ----------

const blockedExtra = readJson(BLOCKED_FILE, []); // patterns added with !!block
const ratings = readJson(RATINGS_FILE, {}); // modelId -> { up, down }

function isBlocked(id) {
  const lower = id.toLowerCase();
  return [...BLOCKED_MODELS, ...blockedExtra].some((b) => lower.includes(b.toLowerCase()));
}

function poorlyRated(id) {
  const r = ratings[id];
  return Boolean(r) && r.down - r.up >= BAD_SCORE;
}

function adjustRating(model, vote, delta) {
  const r = (ratings[model] ??= { up: 0, down: 0 });
  if (vote === 1) r.up += delta;
  else r.down += delta;
  writeJson(RATINGS_FILE, ratings);
}

// ---------- OpenRouter ----------

let cachedModels = []; // [{ id, image }]
let cachedAt = 0;
const badModels = new Map(); // modelId -> timestamp until which it's skipped

// All free text models (the blocklist is applied separately, so !!block takes effect instantly)
async function getFreeModels() {
  if (cachedModels.length && Date.now() - cachedAt < 60 * 60 * 1000) return cachedModels;

  const res = await fetch(`${API}/models`);
  const data = await res.json();

  cachedModels = data.data
    .filter((m) => m.id.endsWith(':free'))
    .filter((m) => m.architecture?.output_modalities?.includes('text') ?? true)
    .map((m) => ({
      id: m.id,
      image: m.architecture?.input_modalities?.includes('image') ?? false,
    }));
  cachedAt = Date.now();
  return cachedModels;
}

async function getUsableModels() {
  return (await getFreeModels()).filter((m) => !isBlocked(m.id));
}

// Picks a random model, avoiding recently failed and poorly rated ones (unless nothing else is left)
function pickModel(pool, tried) {
  const now = Date.now();
  let candidates = pool.filter(
    (m) => !tried.has(m.id) && (badModels.get(m.id) ?? 0) <= now && !poorlyRated(m.id)
  );
  if (!candidates.length) candidates = pool.filter((m) => !tried.has(m.id));
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// messages = full conversation (history + the new question)
// needsImage = only use models that can see images
// exclude = model IDs not to use (used by !!retry)
// Returns { text, model }
async function askAI(messages, needsImage, exclude = []) {
  const models = await getUsableModels();
  const pool = models.filter((m) => !needsImage || m.image);
  if (!pool.length) {
    const err = new Error('No suitable free models found');
    err.code = needsImage ? 'NO_VISION' : 'NO_MODELS';
    throw err;
  }

  const tried = new Set(exclude);
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (todayCount() >= DAILY_LIMIT) {
      const err = new Error('Daily limit reached');
      err.code = 'DAILY_LIMIT';
      throw err;
    }

    const picked = pickModel(pool, tried);
    if (!picked) break;
    const model = picked.id;
    tried.add(model);

    try {
      recordRequest();
      const res = await fetch(`${API}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.error?.message || res.statusText);
        err.status = res.status;
        throw err;
      }

      const text = data.choices?.[0]?.message?.content;
      if (text) return { text, model };
      throw new Error('Empty response');
    } catch (err) {
      lastError = err;
      badModels.set(model, Date.now() + BAD_MODEL_MS);
      console.error(`Model ${model} failed:`, err.message);
    }
  }

  if (lastError) throw lastError;
  const err = new Error('No other models available');
  err.code = 'NO_MODELS';
  throw err;
}

// ---------- Answers and rating reactions ----------

const answers = new Map(); // answer messageId -> { model, votes: Map(userId -> 1 | -1) }
const VOTES = { '👍': 1, '👎': -1 };

async function registerAnswer(sent, model) {
  answers.set(sent.id, { model, votes: new Map() });
  if (answers.size > 300) answers.delete(answers.keys().next().value); // keep the newest 300
  try {
    await sent.react('👍');
    await sent.react('👎');
  } catch (err) {
    console.error('Could not add reactions:', err.message);
  }
}

client.on('messageReactionAdd', (reaction, user) => {
  if (user.bot) return;
  const vote = VOTES[reaction.emoji.name];
  const answer = answers.get(reaction.message.id);
  if (!vote || !answer) return;

  const previous = answer.votes.get(user.id);
  if (previous === vote) return;
  if (previous) adjustRating(answer.model, previous, -1); // user switched their vote
  answer.votes.set(user.id, vote);
  adjustRating(answer.model, vote, 1);
});

client.on('messageReactionRemove', (reaction, user) => {
  if (user.bot) return;
  const vote = VOTES[reaction.emoji.name];
  const answer = answers.get(reaction.message.id);
  if (!vote || !answer || answer.votes.get(user.id) !== vote) return;

  answer.votes.delete(user.id);
  adjustRating(answer.model, vote, -1);
});

// ---------- Asking and replying ----------

const imageUrls = (msg) =>
  [...msg.attachments.values()]
    .filter((a) => a.contentType?.startsWith('image/'))
    .map((a) => a.url);

// history = conversation so far (this function adds the new exchange to it)
async function respond(message, { history, userMessage, savedUserMessage, hasImages, exclude = [] }) {
  try {
    await message.channel.sendTyping();
    const { text: reply, model } = await askAI([...history, userMessage], hasImages, exclude);

    // Save the exchange, keeping only the newest MAX_HISTORY messages
    history.push(savedUserMessage, { role: 'assistant', content: reply });
    while (history.length > MAX_HISTORY) history.shift();
    histories.set(message.channel.id, history);
    saveHistories();
    lastAsked.set(message.channel.id, { userMessage, savedUserMessage, hasImages, model });

    // Split long answers; the small-text footer goes on the last chunk
    const chunks = [];
    for (let i = 0; i < reply.length; i += 1900) chunks.push(reply.slice(i, i + 1900));
    chunks[chunks.length - 1] += `\n-# answered by ${model}`;

    let sent;
    for (const chunk of chunks) sent = await message.reply(chunk);
    await registerAnswer(sent, model);
  } catch (err) {
    console.error(err);
    if (err.code === 'DAILY_LIMIT') return message.reply(dailyLimitText());
    if (err.code === 'NO_VISION') {
      return message.reply("I can't look at images right now because no free model with image support is available. Try again later, or ask without the image.");
    }
    if (err.code === 'NO_MODELS') return message.reply('There is no other free model available to try right now.');
    if (err.status === 429) return message.reply('The free models are rate-limited right now. Try again in a minute.');
    return message.reply('Something went wrong talking to the AI.');
  }
}

// ---------- Message handling ----------

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim().toLowerCase();
  const cmd = content.split(/\s+/)[0];
  const arg = content.slice(cmd.length).trim();
  const channelId = message.channel.id;
  const pendingKey = `${channelId}:${message.author.id}`;

  // Confirmation step for !!memory-wipe
  if (pendingWipes.has(pendingKey)) {
    const expiresAt = pendingWipes.get(pendingKey);
    pendingWipes.delete(pendingKey); // any message uses up the pending request

    if (Date.now() <= expiresAt && content === 'proceed') {
      histories.delete(channelId);
      saveHistories();
      return message.reply('Memory for this channel has been wiped.');
    }
    // Anything else cancels the wipe, then is handled normally below
  }

  // !!help (free for everyone)
  if (cmd === '!!help') return message.reply(helpText());

  // Optional: set OWNER_ID to restrict the admin commands to just you
  const isOwner = Boolean(process.env.OWNER_ID) && message.author.id === process.env.OWNER_ID;
  const ownerCommands = ['!!usage', '!!memory-wipe', '!!models', '!!block', '!!unblock'];
  if (ownerCommands.includes(cmd) && process.env.OWNER_ID && !isOwner) return;

  // !!memory-wipe
  if (cmd === '!!memory-wipe') {
    const stored = histories.get(channelId)?.length ?? 0;
    if (!stored) return message.reply('There is no saved memory in this channel to wipe.');

    pendingWipes.set(pendingKey, Date.now() + CONFIRM_WINDOW_MS);
    return message.reply(
      `⚠️ **Warning:** this will permanently erase my memory of this channel (${stored} saved messages). ` +
      `This cannot be undone.\nReply **proceed** within ${CONFIRM_WINDOW_MS / 1000} seconds to confirm. ` +
      `Anything else cancels it.`
    );
  }

  // !!usage
  if (cmd === '!!usage') return message.reply(usageMessage());

  // !!models
  if (cmd === '!!models') {
    let usable;
    try {
      usable = await getUsableModels();
    } catch {
      return message.reply('Could not fetch the model list.');
    }

    const lines = [`**${usable.length} free models available** (👁 = can see images)`];
    for (const m of usable) {
      const r = ratings[m.id] ?? { up: 0, down: 0 };
      const flags = [];
      if (m.image) flags.push('👁');
      if ((badModels.get(m.id) ?? 0) > Date.now()) flags.push('failing, skipped for now');
      if (poorlyRated(m.id)) flags.push('low rating, skipped');
      lines.push(`• \`${m.id}\` 👍${r.up} 👎${r.down}${flags.length ? ' — ' + flags.join(', ') : ''}`);
    }
    const blockedList = [...BLOCKED_MODELS, ...blockedExtra].map((b) => `\`${b}\``).join(', ');
    lines.push('', `Blocked patterns: ${blockedList || 'none'}`);

    let chunk = '';
    for (const line of lines) {
      if (chunk.length + line.length + 1 > 1900) {
        await message.reply(chunk);
        chunk = '';
      }
      chunk += line + '\n';
    }
    if (chunk) await message.reply(chunk);
    return;
  }

  // !!block <name> and !!unblock <name>
  if (cmd === '!!block' || cmd === '!!unblock') {
    if (!isOwner) return message.reply('Set the `OWNER_ID` environment variable to your user ID to use this command.');
    if (!arg) return message.reply(`Usage: \`${cmd} <part of a model name>\``);

    if (cmd === '!!block') {
      let usable;
      try {
        usable = await getUsableModels();
      } catch {
        return message.reply('Could not fetch the model list.');
      }
      const matched = usable.filter((m) => m.id.toLowerCase().includes(arg));
      if (!matched.length) return message.reply(`No available model matches \`${arg}\`, so nothing was blocked.`);
      if (matched.length === usable.length) return message.reply('That would block every free model, so I did not do it.');

      blockedExtra.push(arg);
      writeJson(BLOCKED_FILE, blockedExtra);
      const list = matched.map((m) => `\`${m.id}\``).join(', ');
      return message.reply(`Blocked \`${arg}\`. Removed ${matched.length} model(s): ${list}`.slice(0, 1900));
    }

    const i = blockedExtra.indexOf(arg);
    if (i === -1) {
      if (BLOCKED_MODELS.includes(arg)) {
        return message.reply('That entry is built into the code. Remove it from `BLOCKED_MODELS` at the top of `index.js` instead.');
      }
      return message.reply(`\`${arg}\` isn't in the list added with \`!!block\`.`);
    }
    blockedExtra.splice(i, 1);
    writeJson(BLOCKED_FILE, blockedExtra);
    return message.reply(`Unblocked \`${arg}\`.`);
  }

  // !!retry: answer the last question again with a different model
  if (cmd === '!!retry') {
    const last = lastAsked.get(channelId);
    const history = histories.get(channelId) ?? [];
    const n = history.length;
    if (!last || n < 2 || history[n - 1].role !== 'assistant' || history[n - 2].content !== last.savedUserMessage.content) {
      return message.reply('I have no recent question in this channel to retry.');
    }

    const blockedMsg = checkLimits(message.author.id, isOwner);
    if (blockedMsg) return message.reply(blockedMsg);

    return respond(message, {
      history: history.slice(0, -2), // the old answer is replaced by the new one
      userMessage: last.userMessage,
      savedUserMessage: last.savedUserMessage,
      hasImages: last.hasImages,
      exclude: [last.model],
    });
  }

  // AI chat: only when pinged
  if (!message.mentions.users.has(client.user.id)) return;

  const name = message.member?.displayName ?? message.author.username;
  let prompt = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();

  // Reply context: include the message being replied to (and its images)
  let refNote = '';
  let images = imageUrls(message);
  if (message.reference?.messageId) {
    const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (ref) {
      const refName = ref.member?.displayName ?? ref.author.username;
      const refText = ref.content.slice(0, 500) || '(no text)';
      refNote = `\n[Replying to ${refName}'s message: "${refText}"]`;
      images = images.concat(imageUrls(ref));
    }
  }
  images = images.slice(0, MAX_IMAGES);

  if (!prompt && !images.length) return message.reply('Yes? Ask me something!');
  if (!prompt) prompt = 'Describe this image.';

  const blockedMsg = checkLimits(message.author.id, isOwner);
  if (blockedMsg) return message.reply(blockedMsg);

  const text = `${name}: ${prompt}${refNote}`;

  // What's sent now includes the images; what's saved to memory is text only
  const userMessage = images.length
    ? {
        role: 'user',
        content: [
          { type: 'text', text },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      }
    : { role: 'user', content: text };
  const savedUserMessage = {
    role: 'user',
    content: images.length ? `${text}\n[attached ${images.length} image(s)]` : text,
  };

  await respond(message, {
    history: histories.get(channelId) ?? [],
    userMessage,
    savedUserMessage,
    hasImages: images.length > 0,
  });
});

client.login(process.env.TOKEN);
