const { announceNewChangelog } = require('../lib/announce');

module.exports = (client) => {
  let ran = false;
  const onReady = () => {
    if (ran) return;
    ran = true;
    announceNewChangelog(client);
  };
  client.once('clientReady', onReady);
  client.once('ready', onReady);
};
