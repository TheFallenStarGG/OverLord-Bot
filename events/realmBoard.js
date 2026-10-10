const { forEachGuild } = require('../lib/storage');
const { getBoardChannelId, refreshBoard } = require('../lib/realmBoard');
const { logging } = require('../lib/logging');

const CHECK_MS = 5 * 60 * 1000; // every 5 minutes

module.exports = (client) => {
  let started = false;

  const tick = () => {
    forEachGuild(client, async () => {
      if (!getBoardChannelId()) return;
      try {
        await refreshBoard(client);
      } catch (err) {
        logging('warn', 'Realm board refresh failed', err.message || err);
      }
    });
  };

  const start = () => {
    if (started) return;
    started = true;
    setTimeout(tick, 25 * 1000); // shortly after boot
    setInterval(tick, CHECK_MS);
  };

  client.once('clientReady', start);
  client.once('ready', start);
};
