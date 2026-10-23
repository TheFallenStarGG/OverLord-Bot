// Retries a database call when the network hiccups ("fetch failed"), so a blip doesn't turn into an error
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The real reason is hidden inside err.cause (for example ECONNRESET or a DNS timeout)
const reason = (err) => {
  const bits = [err?.message, err?.cause?.code, err?.cause?.message].filter(Boolean);
  return [...new Set(bits)].join(' · ');
};

const isNetwork = (err) =>
  /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|socket|network|timeout/i.test(
    `${err?.message ?? ''} ${err?.cause?.code ?? ''}`
  );

async function withRetry(fn, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= tries || !isNetwork(err)) throw err;
      await sleep(400 * attempt);
    }
  }
}

module.exports = { withRetry, reason };
