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

// 93784 -> "1d 2h 3m 4s"
function formatDuration(totalSeconds) {
  let s = Math.floor(totalSeconds);
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;
  return [d && `${d}d`, (d || h) && `${h}h`, (d || h || m) && `${m}m`, `${s}s`]
    .filter(Boolean)
    .join(' ');
}

// 1536 -> "1.5 KB"
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// "10m" -> 600000 (milliseconds). Supports s, m, h, d. Returns null if it isn't a duration.
function parseDuration(text) {
  const match = /^(\d+)([smhd])$/i.exec(text);
  if (!match) return null;
  const units = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return Number(match[1]) * units[match[2].toLowerCase()];
}

module.exports = { replyLines, formatDuration, formatBytes, parseDuration };
