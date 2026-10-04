const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  // Stops the AI's replies from pinging @everyone, roles, or users
  allowedMentions: { parse: [], repliedUser: false },
});

const SYSTEM_PROMPT = 'You are a discord bot named The Overlorder. You are the ruler of the universe and look down upon everything.';

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.users.has(client.user.id)) return;

  // Remove the bot's @mention so only the actual question is sent
  const prompt = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();
  if (!prompt) return message.reply('Yes? Ask me something!');

  try {
    await message.channel.sendTyping();

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || res.statusText);

    const reply = data.choices?.[0]?.message?.content || 'I got an empty response.';

    // Discord caps messages at 2000 characters, so long answers are split
    for (let i = 0; i < reply.length; i += 1900) {
      await message.reply(reply.slice(i, i + 1900));
    }
  } catch (err) {
    console.error(err);
    await message.reply('Something went wrong talking to the AI.');
  }
});

client.login(process.env.TOKEN);
