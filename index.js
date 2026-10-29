const { Client, GatewayIntentBits, Partials, Guild } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { FILES, SCOPED_FILES } = require('./config');
const storage = require('./lib/storage');
const consoleMirror = require('./lib/consoleMirror');
consoleMirror.install(); // capture console from here on

const client = new Client({
  intents: [
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
  allowedMentions: { parse: [], repliedUser: false },
});
client.setMaxListeners(50);

// discord.js renamed 'ready' to 'clientReady'. Redirect any old 'ready' listeners so they
// don't trigger the deprecation warning, and skip a listener already registered under the new name.
for (const method of ['on', 'once', 'addListener', 'prependListener', 'prependOnceListener']) {
  const orig = client[method].bind(client);
  client[method] = (event, listener) => {
    if (event === 'ready') {
      event = 'clientReady';
      if (client.listeners('clientReady').includes(listener)) return client;
    }
    return orig(event, listener);
  };
}

// Every event runs "inside" the server it came from, so per-server data just works everywhere
const guildIdOf = (arg) => {
  if (!arg || typeof arg !== 'object') return null;
  if (arg instanceof Guild) return arg.id;
  return arg.guildId ?? arg.guild?.id ?? arg.message?.guildId ?? null;
};
const originalEmit = client.emit.bind(client);
client.emit = (event, ...args) => {
  const guildId = guildIdOf(args[0]);
  return guildId ? storage.runIn(guildId, () => originalEmit(event, ...args)) : originalEmit(event, ...args);
};

async function main() {
  // Load all saved data from the database BEFORE any other file reads its data
  await storage.init(FILES, SCOPED_FILES);

  // Load every file in commands/ automatically (skip broken files instead of crashing)
  const commands = new Map();
  const commandsDir = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
    try {
      const exported = require(path.join(commandsDir, file));
      for (const command of [].concat(exported)) {
        if (!command?.name || typeof command.run !== 'function') {
          console.error(`Skipped a command in ${file}: missing name or run()`);
          continue;
        }
        commands.set(command.name, command);
      }
    } catch (err) {
      console.error(`Failed to load command ${file}:`, err.message);
    }
  }
  console.log(`Loaded ${commands.size} commands: ${[...commands.keys()].join(', ')}`);

  // Load every file in events/ automatically (skip broken files instead of crashing)
  const ctx = { client, commands };
  const eventsDir = path.join(__dirname, 'events');
  for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
    try {
      require(path.join(eventsDir, file))(client, ctx);
    } catch (err) {
      console.error(`Failed to load event ${file}:`, err.message);
    }
  }

  client.login(process.env.TOKEN);
}

main().catch((err) => {
  console.error('The bot could not start:', err);
  process.exit(1);
});
