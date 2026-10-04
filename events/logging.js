const { version: discordJsVersion } = require('discord.js');
const { setClient, logging, flushAll } = require('../lib/logging');

module.exports = (client, ctx) => {
  setClient(client);

  // Errors anywhere in the bot
  process.on('uncaughtException', (err) => logging('error', 'Uncaught exception', err));
  process.on('unhandledRejection', (err) => logging('error', 'Unhandled promise rejection', err));
  client.on('error', (err) => logging('error', 'Discord client error', err));
  client.on('warn', (info) => logging('warn', 'Discord warning', info));

  // Connection status
  client.on('shardDisconnect', (event, id) =>
    logging('warn', 'Disconnected from Discord', `shard ${id}, code ${event.code}`)
  );
  client.on('shardReconnecting', (id) => logging('info', 'Reconnecting to Discord', `shard ${id}`));
  client.on('shardResume', (id, replayed) =>
    logging('info', 'Reconnected to Discord', `shard ${id}, replayed ${replayed} events`)
  );

  // Servers
  client.on('guildCreate', (guild) =>
    logging('info', 'Joined a server', `${guild.name} (${guild.memberCount} members)`)
  );
  client.on('guildDelete', (guild) => logging('info', 'Left a server', guild.name ?? guild.id));

  // Startup (newer discord.js versions call this event "clientReady", older ones "ready")
  let started = false;
  const onReady = () => {
    if (started) return;
    started = true;
    logging(
      'info',
      'Bot started',
      `${client.user.username} · ${client.guilds.cache.size} server(s) · ${ctx.commands.size} commands · discord.js v${discordJsVersion} · Node ${process.version}`
    );
  };
  client.once('clientReady', onReady);
  client.once('ready', onReady);

  // Shutdown (when the host stops or restarts the bot)
  const shutdown = async (signal) => {
    logging('warn', 'Bot shutting down', signal);
    await flushAll();
    process.exit(0);
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
};
