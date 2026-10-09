const PER_MESSAGE = 10; // Discord's limit of embeds per message

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'gifv']);
const VIDEO_HOSTS = ['redgifs.com'];

function extOf(url) {
  const clean = String(url).split('?')[0].split('#')[0];
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}

// 'image', 'video', or null (can't be shown)
function kindOf(url) {
  if (!url) return null;
  const ext = extOf(url);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  let host = '';
  try {
    host = new URL(String(url)).hostname.toLowerCase();
  } catch {
    /* not a valid URL */
  }
  if (VIDEO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 'video';
  return null;
}

// imgur ".gifv" pages aren't real video files; the .mp4 version is
function videoLink(url) {
  return String(url).replace(/\.gifv(\?.*)?$/i, '.mp4');
}

// Sends posts in order. Images are grouped into embeds (10 per message).
// Videos are sent as their own message with the plain link, so Discord shows a player.
async function sendPosts(channel, posts, { embed, videoText, onSent }) {
  let buffer = [];

  const flush = async () => {
    if (!buffer.length) return;
    await channel.send({ embeds: buffer.map((b) => b.embed) });
    for (const b of buffer) onSent(b.post);
    buffer = [];
  };

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    if (post.isVideo) {
      await flush();
      await channel.send({ content: videoText(post, i) });
      onSent(post);
    } else {
      buffer.push({ post, embed: embed(post, i) });
      if (buffer.length >= PER_MESSAGE) await flush();
    }
  }
  await flush();
}

module.exports = { kindOf, videoLink, sendPosts };
