const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const { API, FILES, LOG_CHANNEL_ID, DAILY_LIMIT } = require('../config');
const { getUsableModels } = require('../lib/models');
const { todayCount } = require('../lib/usage');
const { status: dbStatus } = require('../lib/storage');

const OK = '✅';
const WARN = '⚠️';
const BAD = '❌';

async function timed(fn) {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

// Permission names -> what the bot uses them for
const PERMISSIONS = {
  ViewChannel: 'view the channel',
  SendMessages: 'send messages',
  ReadMessageHistory: 'read message history (reply context, polls)',
  AddReactions: 'add reactions (polls)',
  };

module.exports = {
  name: '!!doctor',
  usage: '!!doctor',
  description: 'Runs a self-check and reports what is working or broken: keys, model list, data files, log channel, and permissions.',
  access: 'owner-required',

  async run(message, arg, ctx) {
    const { client, commands } = ctx;
    const sent = await message.reply('🩺 Running checks…');
    const results = [];

    // Node.js
    const major = parseInt(process.versions.node);
    results.push(
      major >= 18 && typeof fetch === 'function'
        ? `${OK} Node.js ${process.version}`
        : `${BAD} Node.js ${process.version} is too old (needs 18 or newer)`
    );

    // Settings
    results.push(
      process.env.OWNER_ID
        ? `${OK} OWNER_ID is set`
        : `${WARN} OWNER_ID is not set: owner commands are locked for everyone until you set it`
    );
    results.push(`${OK} Daily request limit: ${DAILY_LIMIT} ${process.env.DAILY_LIMIT ? '(from DAILY_LIMIT)' : '(default)'}, ${todayCount()} used today`);

    // OpenRouter key (this does not use up any of your daily requests)
    if (!process.env.OPENROUTER_API_KEY) {
      results.push(`${BAD} OPENROUTER_API_KEY is not set`);
    } else {
      try {
        const { value: res, ms } = await timed(() =>
          fetch(`${API}/key`, {
            headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
            signal: AbortSignal.timeout(10 * 1000),
          })
        );
        if (res.status === 401) results.push(`${BAD} OpenRouter rejected the API key (invalid or deleted)`);
        else if (!res.ok) results.push(`${WARN} OpenRouter answered with status ${res.status}`);
        else results.push(`${OK} OpenRouter API key is valid (${ms} ms)`);
      } catch (err) {
        results.push(`${BAD} Could not reach OpenRouter: ${err.message}`);
      }
    }

    // Model list
    try {
      const { value: res, ms } = await timed(() =>
        fetch(`${API}/models`, { signal: AbortSignal.timeout(10 * 1000) })
      );
      const data = await res.json();
      const free = data.data.filter((m) => m.id.endsWith(':free')).length;
      const usable = await getUsableModels();
      const vision = usable.filter((m) => m.image).length;
      results.push(
        usable.length
          ? `${OK} Model list loads (${ms} ms): ${free} free, ${usable.length} usable after blocks, ${vision} can see images`
          : `${WARN} Model list loads, but no usable free models are left after blocking`
      );
    } catch (err) {
      results.push(`${BAD} Could not load the model list: ${err.message}`);
    }

    // Database
    const db = dbStatus();
    if (!db.connected) results.push(`${BAD} Database is not connected`);
    else if (db.lastError) results.push(`${BAD} The last database save failed: ${db.lastError}`);
    else results.push(`${OK} Database connected (${db.files} files, ${db.rows} rows, ${db.waiting} waiting to save)`);

    // Log channel
    if (!LOG_CHANNEL_ID) {
      results.push(`${WARN} LOG_CHANNEL_ID is empty: logs only go to the console`);
    } else {
      try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID);
        const perms = channel.guild ? channel.permissionsFor(channel.guild.members.me) : null;
        const canPost = perms && perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages);
        results.push(
          canPost
            ? `${OK} Log channel #${channel.name} is reachable`
            : `${BAD} I can see the log channel but can't send messages in it`
        );
      } catch {
        results.push(`${BAD} Can't reach the log channel (wrong ID, or I don't have access)`);
      }
    }

    // Permissions in the channel where this was run
    if (message.guild) {
      const perms = message.channel.permissionsFor(message.guild.members.me);
      const missing = Object.entries(PERMISSIONS)
        .filter(([flag]) => !perms.has(PermissionFlagsBits[flag]))
        .map(([, use]) => use);
      results.push(
        missing.length
          ? `${WARN} Missing permissions here: ${missing.join(', ')}`
          : `${OK} Permissions in this channel look good`
      );
    }

    // Discord connection
    results.push(
      client.ws.ping < 500
        ? `${OK} Discord connection: ${client.ws.ping} ms`
        : `${WARN} Discord connection is slow: ${client.ws.ping} ms`
    );
    results.push(`${OK} Reading message text works (Message Content Intent is on)`);
    results.push(`${OK} ${commands.size} commands loaded`);

    const problems = results.filter((r) => r.startsWith(BAD)).length;
    const warnings = results.filter((r) => r.startsWith(WARN)).length;
    const summary = problems || warnings
      ? `**🩺 Doctor report:** ${problems} problem(s), ${warnings} warning(s)`
      : '**🩺 Doctor report:** everything looks good!';

    await sent.edit([summary, '', ...results].join('\n').slice(0, 1990));
  },
};
