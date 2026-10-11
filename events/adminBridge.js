const { start } = require('../lib/adminBridge');

module.exports = (client, ctx) => {
  let started = false;
  const go = () => {
    if (started) return;
    started = true;
    start(client, ctx.commands);
  };
  client.once('clientReady', go);
  client.once('ready', go);
};
