const { ActivityType } = require('discord.js');
const { STATUS_LINES } = require('../lib/donate');

const ROTATE_MS = 12 * 60 * 1000; // every 12 minutes

module.exports = (client) => {
  let index = Math.floor(Math.random() * STATUS_LINES.length);
  let started = false;

  const apply = () => {
    const line = STATUS_LINES[index % STATUS_LINES.length];
    index += 1;
    try {
      client.user.setPresence({
        status: 'online',
        activities: [
          {
            name: 'Custom Status',
            type: ActivityType.Custom,
            state: line,
          },
        ],
      });
    } catch {
      /* presence is best-effort */
    }
  };

  const start = () => {
    if (started) return;
    started = true;
    apply();
    setInterval(apply, ROTATE_MS);
  };

  client.once('clientReady', start);
  client.once('ready', start);
};
