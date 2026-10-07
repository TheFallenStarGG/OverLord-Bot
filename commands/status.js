const os = require('os');
const { version: discordJsVersion } = require('discord.js');
const { DAILY_LIMIT } = require('../config');
const { todayCount } = require('../lib/usage');
const { status: dbStatus } = require('../lib/storage');
const { formatDuration, formatBytes } = require('../lib/utils');

module.exports = {
  name: '!!status',
  usage: '!!status',
  description: 'Shows technical stats: uptime, latency, memory, versions, database, and Gazette AI usage.',
  access: 'owner',

  async run(message, arg, ctx) {
    const { client, commands } = ctx;

    const sent = await message.reply('Checking...');
    const roundTrip = sent.createdTimestamp - message.createdTimestamp;

    const lagStart = process.hrtime.bigint();
    await new Promise((resolve) => setImmediate(resolve));
    const loopLag = Number(process.hrtime.bigint() - lagStart) / 1e6;

    const mem = process.memoryUsage();
    const load = os.loadavg().map((n) => n.toFixed(2)).join(' / ');

    const db = dbStatus();
    const hours = (Date.now() - db.startedAt) / 3600000;
    const pace =
      hours >= 1
        ? `about ${Math.round((db.rowsWritten / hours) * 24 * 30).toLocaleString('en-US')} per month at this pace`
        : 'too early to estimate';

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
      `Database:        ${db.connected ? 'connected' : 'NOT connected'}, ${db.files} files, ${db.rows} rows`,
      `Rows written:    ${db.rowsWritten.toLocaleString('en-US')} since start (${pace}; free limit 10,000,000)`,
      `Last save:       ${db.lastSaveAt ? formatDuration((Date.now() - db.lastSaveAt) / 1000) + ' ago' : 'nothing saved yet'}${db.waiting ? `, ${db.waiting} file(s) waiting` : ''}`,
      db.lastError ? `Last DB error:   ${db.lastError}` : null,
      '',
      `Gazette AI:      ${todayCount()} / ${DAILY_LIMIT} requests today`,
    ].filter((line) => line !== null);

    await sent.edit('```\n' + lines.join('\n') + '\n```');
  },
};
