const { API, SYSTEM_PROMPT, DAILY_LIMIT, BAD_MODEL_MS } = require('../config');
const { getUsableModels, pickModel, badModels } = require('./models');
const { recordRequest, todayCount } = require('./usage');
const { logging } = require('./logging');

// Reads the streamed response and calls onText(textSoFar) whenever more text arrives
async function readStream(res, onText) {
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // the last piece may be unfinished

    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue; // skips blank lines and keep-alive comments
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;

      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }

      if (json.error) {
        const err = new Error(json.error.message || 'Stream error');
        if (typeof json.error.code === 'number') err.status = json.error.code;
        throw err;
      }

      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onText(text);
      }
    }
  }
  return text;
}

// messages = full conversation (history + the new question)
// needsImage = only use models that can see images
// exclude = model IDs not to use (used by retries)
// onUpdate(textSoFar, model) = called as the answer streams in
// Returns { text, model }
async function askAI(messages, needsImage, exclude = [], onUpdate = () => {}) {
  const models = await getUsableModels();
  const pool = models.filter((m) => !needsImage || m.image);
  if (!pool.length) {
    const err = new Error('No suitable free models found');
    err.code = needsImage ? 'NO_VISION' : 'NO_MODELS';
    throw err;
  }

  const tried = new Set(exclude);
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (todayCount() >= DAILY_LIMIT) {
      const err = new Error('Daily limit reached');
      err.code = 'DAILY_LIMIT';
      throw err;
    }

    const picked = pickModel(pool, tried);
    if (!picked) break;
    const model = picked.id;
    tried.add(model);

    try {
      recordRequest();
      const res = await fetch(`${API}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        }),
        signal: AbortSignal.timeout(120 * 1000), // give up on a model after 2 minutes
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error?.message || res.statusText);
        err.status = res.status;
        throw err;
      }

      const text = await readStream(res, (partial) => onUpdate(partial, model));
      if (text.trim()) return { text, model };
      throw new Error('Empty response');
    } catch (err) {
      lastError = err;
      badModels.set(model, Date.now() + BAD_MODEL_MS);
      logging('warn', 'Model failed', `${model} — ${err.message}`);
    }
  }

  if (lastError) throw lastError;
  const err = new Error('No other models available');
  err.code = 'NO_MODELS';
  throw err;
}

module.exports = { askAI };
