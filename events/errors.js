const { setClient, logError } = require('../lib/errorLog');

module.exports = (client) => {
  setClient(client);

  process.on('uncaughtException', (err) => logError('Uncaught exception', err));
  process.on('unhandledRejection', (err) => logError('Unhandled promise rejection', err));
  client.on('error', (err) => logError('Discord client error', err));
};
