const { exportAll, exportStatus } = require('../lib/webexport');
const { logging } = require('../lib/logging');

const EVERY_MS = 15 * 60 * 1000; // leaderboards, commands, wiki, wars, servers
const STATUS_EVERY_MS = 10 * 60 * 1000; // the status heartbeat

module.exports = (client, ctx) => {
  let started = false;
  let running = false;
  let beating = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await exportAll(client, ctx.commands);
    } catch (err) {
      logging('error', 'Website export failed', err);
    }
    running = false;
  };

  const beat = async () => {
    if (beating) return;
    beating = true;
    try {
      await exportStatus(client);
    } catch (err) {
      logging('error', 'Status export failed', err);
    }
    beating = false;
  };

  const start = () => {
    if (started) return;
    started = true;
    setTimeout(run, 60 * 1000);
    setInterval(run, EVERY_MS);
    setTimeout(beat, 20 * 1000);
    setInterval(beat, STATUS_EVERY_MS);
  };
  client.once('clientReady', start);
  client.once('ready', start);
};
