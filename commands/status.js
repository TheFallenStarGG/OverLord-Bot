const os = require('os');
const fs = require('fs');
const { version: discordJsVersion } = require('discord.js');
const { FILES, DAILY_LIMIT, BLOCKED_MODELS } = require('../config');
const { histories } = require('../lib/memory');
const { todayCount } = require('../lib/usage');
const { blockedExtra, ratings, badModels } = require('../lib/models');
const { formatDuration, formatBytes } = require('../lib/utils');

module.exports = {
  name: '!!status',
  usage: '!!status',
  description: 'Shows technical stats: uptime, latency, memory, versions, saved data, and usage.',
  access: 'owner',

  async run(message, arg, ctx) {
    const { client, commands } = ctx;

    // Round trip: how long it takes to send a reply
    const sent = await message.reply('Checking...');
    const roundTrip = sent.createdTimestamp - message.createdTimestamp;

    // Event loop delay: how long the bot takes to get to a task that is waiting
    const lagStart = process.hrtime.bigint();
    await new Promise((resolve) => setImmediate(resolve));
    const loopLag = Number(process.hrtime.bigint() - lagStart) / 1e6;

    const mem = process.memoryUsage();
    const load = os.loadavg().map((n) => n.toFixed(2)).join(' / ');

    let storedMessages = 0;
    for (const h of histories.values()) storedMessages += h.length;

    const files = Object.entries(FILES).map(([name, file]) => {
      try {
        return `${name} ${formatBytes(fs.statSync(file).size)}`;
      } catch {
        return `${name} (none yet)`;
      }
    });

    const failingNow = [...badModels.values()].filter((t) => t > Date.now()).length;

    const lines = [
      `Uptime:          ${formatDuration(process.uptime())} (Discord session ${formatDuration((client.uptime ?? 0) / 1000)})`,
      `Gateway ping:    ${client.ws.ping} ms`,
      `Reply latency:   ${roundTrip} ms`,
      `Event loop lag:  ${loopLag.toFixed(2)} ms`,
      '',
      `Node.js:         ${process.version} (${process.platform} ${process.arch})`,
      `discord.js:      v${discordJsVersion}`,
      `Process ID:      ${process.pid}`,
      '',
      `Bot memory:      ${formatBytes(mem.rss)} total, heap ${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}`,
      `Host RAM:        ${formatBytes(os.freemem())} free of ${formatBytes(os.totalmem())} (whole machine)`,
      `Host CPU:        ${os.cpus().length} cores, load ${load}`,
      '',
      `Servers:         ${client.guilds.cache.size}`,
      `Cached:          ${client.channels.cache.size} channels, ${client.users.cache.size} users`,
      `Commands:        ${commands.size} loaded`,
      '',
      `Chat memory:     ${histories.size} channels, ${storedMessages} saved messages`,
      `Data files:      ${files.join(', ')}`,
      '',
      `Requests today:  ${todayCount()} / ${DAILY_LIMIT}`,
      `Blocked:         ${BLOCKED_MODELS.length + blockedExtra.length} patterns`,
      `Models rated:    ${Object.keys(ratings).length}, ${failingNow} failing right now`,
    ];

    await sent.edit('```\n' + lines.join('\n') + '\n```');
  },
};
