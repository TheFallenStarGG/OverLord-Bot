const { version: discordJsVersion } = require('discord.js');
const { setClient, logging, flushAll } = require('../lib/logging');
const storage = require('../lib/storage');
const consoleMirror = require('../lib/consoleMirror');

module.exports = (client, ctx) => {
  setClient(client);
  consoleMirror.setClient(client);

  // Errors anywhere in the bot
  process.on('uncaughtException', (err) => logging('error', 'Uncaught exception', err));
  process.on('unhandledRejection', (err) => logging('error', 'Unhandled promise rejection', err));
  client.on('error', (err) => logging('error', 'Discord client error', err));
  client.on('warn', (info) => logging('warn', 'Discord warning', info));

  // Connection status — only log if Discord was gone for a while (not brief blips)
  const DISCORD_LOG_AFTER_MS = 3 * 60 * 1000; // 3 minutes
  const droppedAt = new Map(); // shard id -> when it dropped

  client.on('shardDisconnect', (event, id) => {
    if (!droppedAt.has(id)) droppedAt.set(id, Date.now());
    // No log here — wait to see if it comes back quickly
  });

  client.on('shardReconnecting', (id) => {
    // Silent: reconnecting every blip is noise
  });

  client.on('shardResume', (id, replayed) => {
    const since = droppedAt.get(id);
    droppedAt.delete(id);
    if (!since) return;
    const ms = Date.now() - since;
    if (ms < DISCORD_LOG_AFTER_MS) return; // short blip — ignore
    const mins = Math.round(ms / 60000);
    logging(
      'info',
      'Reconnected to Discord',
      `shard ${id}, offline about ${mins} min, replayed ${replayed} events`
    );
  });

  client.on('shardReady', (id) => {
    // First ready or recovery without a tracked drop — clear any stale timer
    droppedAt.delete(id);
  });

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
    process.emit('exit', 0); // runs the files' own "save now" hooks (they only queue their data)
    await Promise.race([storage.flush(), new Promise((resolve) => setTimeout(resolve, 8000))]);
    await flushAll();
    process.exit(0);
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
};
