// Sends a list of lines as one or more replies, staying under Discord's 2000 character limit
async function replyLines(message, lines) {
  let chunk = '';
  for (const line of lines) {
    if (chunk.length + line.length + 1 > 1900) {
      await message.reply(chunk);
      chunk = '';
    }
    chunk += line + '\n';
  }
  if (chunk) await message.reply(chunk);
}

module.exports = { replyLines };
