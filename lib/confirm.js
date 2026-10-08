const WINDOW_MS = 30 * 1000;
const pending = new Map(); // userId -> { expires, label, run }

function requestConfirm(userId, label, run) {
  pending.set(userId, { expires: Date.now() + WINDOW_MS, label, run });
}

/** @returns {Promise<boolean>} true if this message was a yes/no for a pending confirm */
async function handleConfirm(message, content) {
  const entry = pending.get(message.author.id);
  if (!entry) return false;
  if (Date.now() > entry.expires) {
    pending.delete(message.author.id);
    return false;
  }

  const c = content.trim().toLowerCase();
  if (c === 'yes' || c === 'confirm' || c === 'y') {
    pending.delete(message.author.id);
    await entry.run(message);
    return true;
  }
  if (c === 'no' || c === 'cancel' || c === 'n') {
    pending.delete(message.author.id);
    await message.reply('Cancelled.');
    return true;
  }
  return false;
}

module.exports = { requestConfirm, handleConfirm, WINDOW_MS };
