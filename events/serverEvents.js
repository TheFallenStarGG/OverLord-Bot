const { dueForEvent, startEvent, scheduleNextEvent, eventEmbed } = require('../lib/modifiers');
const { broadcast } = require('../lib/announce');
const { logging } = require('../lib/logging');

const CHECK_MS = 5 * 60 * 1000;
const PING_EVENTS = false; // set to true to @everyone when an event starts

module.exports = (client) => {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;

    setInterval(async () => {
      try {
        if (!dueForEvent()) return;
        const entry = startEvent();
        scheduleNextEvent();
        logging('info', 'Server event', entry.def.name);

        await broadcast(client, {
          content: PING_EVENTS ? '@everyone' : undefined,
          embeds: [eventEmbed(entry, '🎪 **A server event has begun!**')],
          allowedMentions: PING_EVENTS ? { parse: ['everyone'] } : undefined,
        });
      } catch (err) {
        logging('error', 'Event check failed', err);
      }
    }, CHECK_MS);
  };
  client.once('clientReady', start);
  client.once('ready', start);
};
