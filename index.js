const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  allowedMentions: { parse: [], repliedUser: false },
});

const SYSTEM_PROMPT = 'You are a discord bot named The Overlorder. You are the ruler of the universe and look down upon everything. Keep messages around mid length';
const API = 'https://openrouter.ai/api/v1';

let cachedModels = [];
let cachedAt = 0;

// Fetches the list of free text models, cached for an hour
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

// Tries up to 3 different random free models until one answers
async function askAI(prompt) {
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
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
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

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.users.has(client.user.id)) return;

  const prompt = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();
  if (!prompt) return message.reply('Yes? Ask me something!');

  try {
    await message.channel.sendTyping();
    const reply = await askAI(prompt);

    for (let i = 0; i < reply.length; i += 1900) {
      await message.reply(reply.slice(i, i + 1900));
    }
  } catch (err) {
    console.error(err);
    await message.reply('Something went wrong talking to the AI.');
  }
});

client.login(process.env.TOKEN);
