const { API, SYSTEM_PROMPT, DAILY_LIMIT, BAD_MODEL_MS } = require('../config');
const { getUsableModels, pickModel, badModels } = require('./models');
const { recordRequest, todayCount } = require('./usage');
const { logging } = require('./logging');

// messages = full conversation (history + the new question)
// needsImage = only use models that can see images
// exclude = model IDs not to use (used by !!retry)
// Returns { text, model }
async function askAI(messages, needsImage, exclude = []) {
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
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.error?.message || res.statusText);
        err.status = res.status;
        throw err;
      }

      const text = data.choices?.[0]?.message?.content;
      if (text) return { text, model };
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
