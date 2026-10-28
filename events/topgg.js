const { logging } = require('../lib/logging');

const BOT_ID = '1555446743515144232';
const POST_MS = 30 * 60 * 1000; // every 30 minutes

async function postStats(client) {
  const token = process.env.TOPGG_TOKEN;
  if (!token) return;

  const server_count = client.guilds.cache.size;
  try {
    const res = await fetch(`https://top.gg/api/bots/${BOT_ID}/stats`, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ server_count }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logging('warn', 'top.gg stats post failed', `HTTP ${res.status} ${text.slice(0, 120)}`);
      return;
    }
    logging('info', 'top.gg stats posted', `${server_count} servers`);
  } catch (err) {
    logging('warn', 'top.gg stats post error', err.message || err);
  }
}

module.exports = (client) => {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    postStats(client);
    setInterval(() => postStats(client), POST_MS).unref?.();
  };

  client.once('clientReady', start);
  client.once('ready', start);

  // Refresh soon after joins/leaves so the listing isn't stale for hours
  let debounce = null;
  const schedule = () => {
    if (!started) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => postStats(client), 15000);
  };
  client.on('guildCreate', schedule);
  client.on('guildDelete', schedule);
};
