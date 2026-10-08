const { dueForDecree, scheduleNext, issueDecree, decreeEmbed } = require('../lib/modifiers');
const { getChannel, broadcast } = require('../lib/announce');
const { forEachGuild } = require('../lib/storage');
const { logging } = require('../lib/logging');

const CHECK_MS = 5 * 60 * 1000;

module.exports = (client) => {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;

    // Only servers with an events channel get Overlord decrees
    setInterval(() => {
      forEachGuild(client, async (guild) => {
        try {
          if (!getChannel(guild.id) || !dueForDecree()) return;
          const entry = issueDecree();
          scheduleNext();
          logging('info', 'Overlord decree', `${entry.def.name} in ${guild.name}`);
          await broadcast(client, { embeds: [decreeEmbed(entry, '📣 **The Overlord speaks!**')] });
        } catch (err) {
          logging('error', 'Decree check failed', err);
        }
      });
    }, CHECK_MS);
  };
  client.once('clientReady', start);
  client.once('ready', start);
};
