const { exportAll } = require('../lib/webexport');
const { logging } = require('../lib/logging');

const EVERY_MS = 15 * 60 * 1000;

module.exports = (client) => {
  let started = false;
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await exportAll(client);
    } catch (err) {
      logging('error', 'Website export failed', err);
    }
    running = false;
  };

  const start = () => {
    if (started) return;
    started = true;
    setTimeout(run, 60 * 1000);
    setInterval(run, EVERY_MS);
  };
  client.once('clientReady', start);
  client.once('ready', start);
};
