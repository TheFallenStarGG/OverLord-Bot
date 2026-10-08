const { logging, setErrorHook } = require('../lib/logging');
const { scheduleDeletion, cancelDeletion, runDueDeletions, scheduleMissing } = require('../lib/guildData');
const blacklist = require('../lib/blacklist');
const digest = require('../lib/digest');

module.exports = (client) => {
  setErrorHook(digest.noteError);

  client.on('guildCreate', (guild) => {
    cancelDeletion(guild.id); // they came back, keep their data
    digest.bump('joined');
    if (blacklist.isGuildBlocked(guild.id)) {
      logging('warn', 'Left a blacklisted server', `${guild.name} (${guild.id})`);
      guild.leave().catch(() => {});
    }
  });

  client.on('guildDelete', (guild) => {
    if (guild.available === false) return; // just a Discord outage, not a removal
    scheduleDeletion(guild.id);
    digest.bump('left');
  });

  let started = false;
  const onReady = () => {
    if (started) return;
    started = true;
    scheduleMissing(client);
    runDueDeletions(client);
    setInterval(() => runDueDeletions(client), 60 * 60 * 1000).unref();
    digest.start(client);
  };
  client.once('clientReady', onReady);
  client.once('ready', onReady);
};
