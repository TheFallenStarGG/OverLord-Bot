const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  allowedMentions: { parse: [], repliedUser: false },
});

const SYSTEM_PROMPT = 'You are a discord bot named The Overlorder. You are the ruler of the universe and look down upon everything. Keep messages around long to mid length, minimum 300 chars, maximum 1000. If questioned or opposed in being the overlord of the universe, make up any lies you deem necesary to prove your soveriegnity of the universe. Also avoid making the entire message one paragraph where possible.';
const API = 'https://openrouter.ai/api/v1';
const MAX_HISTORY = 20; // total messages remembered per channel (user + bot)
const CONFIRM_WINDOW_MS = 30 * 1000; // time allowed to confirm a wipe
const COOLDOWN_MS = 5 * 1000; // per-user wait between questions
const BAD_MODEL_MS = 10 * 60 * 1000; // how long a failing model is skipped
const MAX_IMAGES = 4; // max images sent per question
const BLOCKED_MODELS = ['content-safety', 'guard']; 
const MINUTE_LIMIT = 20; // free-model requests per minute
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT) || 50; // free-model requests per day
const HISTORY_FILE = path.join(__dirname, 'history.json');
const USAGE_FILE = path.join(__dirname, 'usage.json');

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

// ---------- Chat memory ----------

let histories = new Map(); // channelId -> [{ role, content }, ...]
try {
  histories = new Map(Object.entries(JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))));
} catch {}

function saveHistories() {
  writeJson(HISTORY_FILE, Object.fromEntries(histories));
}

const pendingWipes = new Map(); // "channelId:userId" -> expiry timestamp
const cooldowns = new Map(); // userId -> last question timestamp

// ---------- Request usage tracking ----------

const todayUTC = () => new Date().toISOString().slice(0, 10);

let usage = { date: todayUTC(), count: 0 };
try {
  usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
} catch {}

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

// ---------- OpenRouter ----------

let cachedModels = []; // [{ id, image }]
let cachedAt = 0;
const badModels = new Map(); // modelId -> timestamp until which it's skipped

async function getFreeModels() {
  if (cachedModels.length && Date.now() - cachedAt < 60 * 60 * 1000) return cachedModels;

  const res = await fetch(`${API}/models`);
  const data = await res.json();

  cachedModels = data.data
    .filter((m) => m.id.endsWith(':free'))
    .filter((m) => !BLOCKED_MODELS.some((b) => m.id.includes(b)))
    .filter((m) => m.architecture?.output_modalities?.includes('text') ?? true)
    .map((m) => ({
      id: m.id,
      image: m.architecture?.input_modalities?.includes('image') ?? false,
    }));
  cachedAt = Date.now();
  return cachedModels;
}

// Picks a random model, avoiding ones that failed recently (unless nothing else is left)
function pickModel(pool, tried) {
  const now = Date.now();
  let candidates = pool.filter((m) => !tried.has(m.id) && (badModels.get(m.id) ?? 0) <= now);
  if (!candidates.length) candidates = pool.filter((m) => !tried.has(m.id));
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// messages = full conversation (history + the new question)
// needsImage = only use models that can see images
// Returns { text, model }
async function askAI(messages, needsImage) {
  const models = await getFreeModels();
  const pool = models.filter((m) => !needsImage || m.image);
  if (!pool.length) {
    const err = new Error('No suitable free models found');
    err.code = needsImage ? 'NO_VISION' : 'NO_MODELS';
    throw err;
  }

  const tried = new Set();
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
  throw lastError ?? new Error('No models available');
}

// ---------- Helpers ----------

const imageUrls = (msg) =>
  [...msg.attachments.values()]
    .filter((a) => a.contentType?.startsWith('image/'))
    .map((a) => a.url);

// ---------- Message handling ----------

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim().toLowerCase();
  const pendingKey = `${message.channel.id}:${message.author.id}`;

  // Confirmation step for !!memory-wipe
  if (pendingWipes.has(pendingKey)) {
    const expiresAt = pendingWipes.get(pendingKey);
    pendingWipes.delete(pendingKey); // any message uses up the pending request

    if (Date.now() <= expiresAt && content === 'proceed') {
      histories.delete(message.channel.id);
      saveHistories();
      return message.reply('Memory for this channel has been wiped.');
    }
    // Anything else cancels the wipe, then is handled normally below
  }

  // Optional: set OWNER_ID to restrict the commands to just you
  const isOwner = process.env.OWNER_ID && message.author.id === process.env.OWNER_ID;
  const isCommand = content === '!!usage' || content === '!!memory-wipe';
  if (isCommand && process.env.OWNER_ID && !isOwner) return;

  // !!memory-wipe
  if (content === '!!memory-wipe') {
    const stored = histories.get(message.channel.id)?.length ?? 0;
    if (!stored) return message.reply('There is no saved memory in this channel to wipe.');

    pendingWipes.set(pendingKey, Date.now() + CONFIRM_WINDOW_MS);
    return message.reply(
      `⚠️ **Warning:** this will permanently erase my memory of this channel (${stored} saved messages). ` +
      `This cannot be undone.\nReply **proceed** within ${CONFIRM_WINDOW_MS / 1000} seconds to confirm. ` +
      `Anything else cancels it.`
    );
  }

  // !!usage
  if (content === '!!usage') return message.reply(usageMessage());

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

  // Out of requests for today
  if (todayCount() >= DAILY_LIMIT) return message.reply(dailyLimitText());

  // Per-user cooldown (you're exempt if OWNER_ID is set to your ID)
  if (!isOwner) {
    const wait = (cooldowns.get(message.author.id) ?? 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) return message.reply(`Slow down! Try again in ${Math.ceil(wait / 1000)}s.`);
  }
  cooldowns.set(message.author.id, Date.now());

  const text = `${name}: ${prompt}${refNote}`;
  const history = histories.get(message.channel.id) ?? [];

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

  try {
    await message.channel.sendTyping();
    const { text: reply, model } = await askAI([...history, userMessage], images.length > 0);

    // Save the exchange, keeping only the newest MAX_HISTORY messages
    history.push(savedUserMessage, { role: 'assistant', content: reply });
    while (history.length > MAX_HISTORY) history.shift();
    histories.set(message.channel.id, history);
    saveHistories();

    // Split long answers; the small-text footer goes on the last chunk
    const chunks = [];
    for (let i = 0; i < reply.length; i += 1900) chunks.push(reply.slice(i, i + 1900));
    chunks[chunks.length - 1] += `\n-# answered by ${model}`;
    for (const chunk of chunks) await message.reply(chunk);
  } catch (err) {
    console.error(err);
    if (err.code === 'DAILY_LIMIT') return message.reply(dailyLimitText());
    if (err.code === 'NO_VISION') {
      return message.reply("I can't look at images right now because no free model with image support is available. Try again later, or ask without the image.");
    }
    if (err.status === 429) return message.reply('The free models are rate-limited right now. Try again in a minute.');
    return message.reply('Something went wrong talking to the AI.');
  }
});

client.login(process.env.TOKEN);
