const mod = require('../lib/moderation');
const { logging } = require('../lib/logging');

const CHECK_MS = 60 * 1000;

module.exports = (client) => {
  const loop = () => mod.processTimers(client).catch((err) => logging('error', 'Temp-ban check failed', err));
  client.once('clientReady', () => {
    loop();
    setInterval(loop, CHECK_MS);
  });
};
