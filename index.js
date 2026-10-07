const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { FILES } = require('./config');
const storage = require('./lib/storage');

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

async function main() {
  // Load all saved data from the database BEFORE any other file reads its data
  await storage.init(FILES);

  // Load every file in commands/ automatically
  const commands = new Map();
  const commandsDir = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(commandsDir, file));
    commands.set(command.name, command);
  }
  console.log(`Loaded ${commands.size} commands: ${[...commands.keys()].join(', ')}`);

  // Load every file in events/ automatically
  const ctx = { client, commands };
  const eventsDir = path.join(__dirname, 'events');
  for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
    require(path.join(eventsDir, file))(client, ctx);
  }

  client.login(process.env.TOKEN);
}

main().catch((err) => {
  console.error('The bot could not start:', err);
  process.exit(1);
});
