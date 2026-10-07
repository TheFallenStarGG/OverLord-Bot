const { ActivityType } = require('discord.js');
const { STATUS_TEXT } = require('../lib/donate');

module.exports = (client) => {
  let done = false;
  const apply = () => {
    if (done) return;
    done = true;
    client.user.setPresence({
      status: 'online',
      activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: STATUS_TEXT }],
    });
  };
  client.once('clientReady', apply);
  client.once('ready', apply);
};
