const { dueForEvent, startEvent, scheduleNextEvent, eventEmbed } = require('../lib/modifiers');
const { getChannel, broadcast } = require('../lib/announce');
const { forEachGuild } = require('../lib/storage');
const { logging } = require('../lib/logging');

const CHECK_MS = 5 * 60 * 1000;

module.exports = (client) => {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;

    // Only servers with an events channel get server events
    setInterval(() => {
      forEachGuild(client, async (guild) => {
        try {
          if (!getChannel(guild.id) || !dueForEvent()) return;
          const entry = startEvent();
          scheduleNextEvent();
          logging('info', 'Server event', `${entry.def.name} in ${guild.name}`);
          await broadcast(client, { embeds: [eventEmbed(entry, '🎪 **A server event has begun!**')] });
        } catch (err) {
          logging('error', 'Event check failed', err);
        }
      });
    }, CHECK_MS);
  };
  client.once('clientReady', start);
  client.once('ready', start);
};
