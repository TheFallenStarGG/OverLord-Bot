const { dueForDecree, scheduleNext, issueDecree, decreeEmbed } = require('../lib/modifiers');
const { channelIds } = require('../lib/announce');
const { logging } = require('../lib/logging');

const CHECK_MS = 5 * 60 * 1000;

module.exports = (client) => {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;

    setInterval(async () => {
      try {
        if (!dueForDecree()) return;
        const entry = issueDecree();
        scheduleNext();
        logging('info', 'Overlord decree', entry.def.name);

        for (const id of channelIds()) {
          const channel = await client.channels.fetch(id).catch(() => null);
          if (channel?.isTextBased()) {
            await channel.send({ embeds: [decreeEmbed(entry, '📣 **The Overlord speaks!**')] }).catch(() => {});
          }
        }
      } catch (err) {
        logging('error', 'Decree check failed', err);
      }
    }, CHECK_MS);
  };
  client.once('clientReady', start);
  client.once('ready', start);
};
