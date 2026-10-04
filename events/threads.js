const { isChatThread, removeChatThread } = require('../lib/threads');
const { histories, saveHistories } = require('../lib/memory');
const { logging } = require('../lib/logging');

module.exports = (client) => {
  // If someone deletes a chat thread, forget it and its memory
  client.on('threadDelete', (thread) => {
    if (!isChatThread(thread.id)) return;
    removeChatThread(thread.id);
    histories.delete(thread.id);
    saveHistories();
    logging('info', 'Chat thread deleted', thread.name);
  });
};
