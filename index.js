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

const SYSTEM_PROMPT = 'You are a discord bot named The Overlorder. You are the ruler of the universe and look down upon everything. Keep messages around long ish to mid range, but no longer than 1000 characters/chars.';
const API = 'https://openrouter.ai/api/v1';
const MAX_HISTORY = 20; // total messages remembered per channel (user + bot)
const CONFIRM_WINDOW_MS = 30 * 1000; // time allowed to confirm a wipe
const HISTORY_FILE = path.join(__dirname, 'history.json');

// ---------- Memory (saved to disk) ----------

let histories = new Map(); // channelId -> [{ role, content }, ...]
try {
  histories = new Map(Object.entries(JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))));
} catch {}

// Writes to a temp file first, then swaps it in, so a crash mid-save can't corrupt the memory
function saveHistories() {
  const tmp = HISTORY_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(histories)));
    fs.renameSync(tmp, HISTORY_FILE);
  } catch (err) {
    console.error('Could not save history:', err);
  }
}

// Pending wipe confirmations: "channelId:userId" -> expiry timestamp
const pendingWipes = new Map();

// ---------- OpenRouter ----------

let cachedModels = [];
let cachedAt = 0;

async function getFreeModels() {
  if (cachedModels.length && Date.now() - cachedAt < 60 * 60 * 1000) return cachedModels;

  const res = await fetch(`${API}/models`);
  const data = await res.json();

  cachedModels = data.data
    .filter((m) => m.id.endsWith(':free'))
    .filter((m) => m.architecture?.output_modalities?.includes('text') ?? true)
    .map((m) => m.id);
  cachedAt = Date.now();
  return cachedModels;
}

// messages = full conversation (history + the new question)
async function askAI(messages) {
  const models = await getFreeModels();
  if (!models.length) throw new Error('No free models found');

  const tried = new Set();
  let lastError;

  for (let attempt = 0; attempt < 3 && tried.size < models.length; attempt++) {
    let model;
    do {
      model = models[Math.floor(Math.random() * models.length)];
    } while (tried.has(model));
    tried.add(model);

    try {
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
      if (!res.ok) throw new Error(data.error?.message || res.statusText);

      const text = data.choices?.[0]?.message?.content;
      if (text) return text;
      throw new Error('Empty response');
    } catch (err) {
      lastError = err;
      console.error(`Model ${model} failed:`, err.message);
    }
  }
  throw lastError;
}

// ---------- Credits ----------

// Works out the next reset time from the key's reset type (UTC-based)
function nextReset(type) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  if (type === 'daily') return new Date(Date.UTC(y, m, d + 1));
  if (type === 'weekly') {
    const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
    return new Date(Date.UTC(y, m, d + daysUntilMonday));
  }
  if (type === 'monthly') return new Date(Date.UTC(y, m + 1, 1));
  return null;
}

async function creditsMessage() {
  const res = await fetch(`${API}/key`, {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || res.statusText);
  const k = json.data;

  const usd = (n) => `$${Number(n).toFixed(4)}`;
  const lines = [];

  if (k.limit === null || k.limit === undefined) {
    lines.push('This key has no spending limit set.');
  } else {
    lines.push(`Remaining: **${usd(k.limit_remaining)}** of ${usd(k.limit)}`);
    const reset = nextReset(k.limit_reset);
    if (reset) {
      const ts = Math.floor(reset.getTime() / 1000);
      lines.push(`Resets (${k.limit_reset}): <t:${ts}:F> (<t:${ts}:R>)`);
    } else {
      lines.push('Limit does not reset automatically.');
    }
  }

  lines.push(`Used today: ${usd(k.usage_daily)} | This month: ${usd(k.usage_monthly)} | Total: ${usd(k.usage)}`);
  if (k.is_free_tier) lines.push('This is a free-tier key.');
  return lines.join('\n');
}

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
  const isCommand = content === '!!credits' || content === '!!memory-wipe';
  if (isCommand && process.env.OWNER_ID && message.author.id !== process.env.OWNER_ID) return;

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

  // !!credits
  if (content === '!!credits') {
    try {
      return await message.reply(await creditsMessage());
    } catch (err) {
      console.error(err);
      return message.reply('Could not fetch credit info.');
    }
  }

  // AI chat: only when pinged
  if (!message.mentions.users.has(client.user.id)) return;

  const prompt = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();
  if (!prompt) return message.reply('Yes? Ask me something!');

  const name = message.member?.displayName ?? message.author.username;
  const history = histories.get(message.channel.id) ?? [];
  const userMessage = { role: 'user', content: `${name}: ${prompt}` };

  try {
    await message.channel.sendTyping();
    const reply = await askAI([...history, userMessage]);

    // Save the exchange, keeping only the newest MAX_HISTORY messages
    history.push(userMessage, { role: 'assistant', content: reply });
    while (history.length > MAX_HISTORY) history.shift();
    histories.set(message.channel.id, history);
    saveHistories();

    for (let i = 0; i < reply.length; i += 1900) {
      await message.reply(reply.slice(i, i + 1900));
    }
  } catch (err) {
    console.error(err);
    await message.reply('Something went wrong talking to the AI.');
  }
});

client.login(process.env.TOKEN);
