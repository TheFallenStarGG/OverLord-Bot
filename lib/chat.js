const { MAX_HISTORY, MAX_IMAGES, STREAM_EDIT_MS } = require('../config');
const { histories, lastAsked, saveHistories } = require('./memory');
const { askAI } = require('./ai');
const { createAnswer, saveAnswer, answerButtons } = require('./answers');
const { checkLimits, dailyLimitText } = require('./usage');
const { logging, whoWhere } = require('./logging');

const imageUrls = (msg) =>
  [...msg.attachments.values()]
    .filter((a) => a.contentType?.startsWith('image/'))
    .map((a) => a.url);

// Edits a message as the answer streams in (at most once every STREAM_EDIT_MS)
function createStreamer(sent) {
  let latest = '';
  let lastEdit = 0;
  let timer = null;
  let stopped = false;
  let inFlight = Promise.resolve();

  const show = (text) => (text.length > 1900 ? text.slice(0, 1900) + '…' : text) + ' ▌';

  function edit() {
    timer = null;
    if (stopped) return;
    lastEdit = Date.now();
    inFlight = inFlight.then(() => sent.edit(show(latest))).catch(() => {});
  }

  return {
    update(text) {
      latest = text;
      if (timer || stopped) return;
      timer = setTimeout(edit, Math.max(STREAM_EDIT_MS - (Date.now() - lastEdit), 0));
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
}

// target = the message to reply to, asker = the user who asked
// history = conversation so far (this function adds the new exchange to it)
async function respond(target, { asker, history, userMessage, savedUserMessage, hasImages, exclude = [] }) {
  const who = whoWhere(target, asker);
  let sent;
  const fail = (text) =>
    sent
      ? sent.edit({ content: text, components: [] }).catch(() => {})
      : target.reply(text).catch(() => {});

  try {
    sent = await target.reply('💭 Thinking…');
    const streamer = createStreamer(sent);

    let result;
    try {
      result = await askAI([...history, userMessage], hasImages, exclude, (text) => streamer.update(text));
    } finally {
      await streamer.stop();
    }
    const { text: reply, model } = result;

    // Save the exchange, keeping only the newest MAX_HISTORY messages
    history.push(savedUserMessage, { role: 'assistant', content: reply });
    while (history.length > MAX_HISTORY) history.shift();
    histories.set(target.channel.id, history);
    saveHistories();

    // Split long answers; the small-text footer goes on the last chunk
    const chunks = [];
    for (let i = 0; i < reply.length; i += 1900) chunks.push(reply.slice(i, i + 1900));
    chunks[chunks.length - 1] += `\n-# answered by ${model}`;

    // The buttons go on the last message of the answer
    const answer = createAnswer(model, asker.id);
    const messageIds = [sent.id];
    let last = sent;

    if (chunks.length === 1) {
      await sent.edit({ content: chunks[0], components: answerButtons(answer) });
    } else {
      await sent.edit({ content: chunks[0] });
      for (let i = 1; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        last = await sent.channel.send(
          isLast ? { content: chunks[i], components: answerButtons(answer) } : chunks[i]
        );
        messageIds.push(last.id);
      }
    }

    saveAnswer(answer, messageIds, last.id);
    lastAsked.set(target.channel.id, {
      userMessage,
      savedUserMessage,
      hasImages,
      model,
      answerMessageId: last.id,
    });

    logging('info', 'AI answered', `${who} · ${model}${exclude.length ? ' (retry)' : ''}${hasImages ? ' · with images' : ''}`);
  } catch (err) {
    if (err.code === 'DAILY_LIMIT') {
      logging('warn', 'Daily request limit reached', who);
      return fail(dailyLimitText());
    }
    if (err.code === 'NO_VISION') {
      logging('warn', 'No image-capable model available', who);
      return fail("I can't look at images right now because no free model with image support is available. Try again later, or ask without the image.");
    }
    if (err.code === 'NO_MODELS') {
      logging('warn', 'No other model available to try', who);
      return fail('There is no other free model available to try right now.');
    }
    if (err.status === 429) {
      logging('warn', 'Free models are rate-limited', who);
      return fail('The free models are rate-limited right now. Try again in a minute.');
    }
    logging('error', 'AI request failed', err);
    return fail('Something went wrong talking to the AI.');
  }
}

// Answers the last question in the channel again with a different model.
// Returns an error message to show, or null if the retry went ahead.
// expectMessageId (optional): only retry if this is the latest answer (used by the Retry button)
async function retry(target, asker, isOwner, expectMessageId) {
  const channelId = target.channel.id;
  const last = lastAsked.get(channelId);
  const history = histories.get(channelId) ?? [];
  const n = history.length;

  if (!last || n < 2 || history[n - 1].role !== 'assistant' || history[n - 2].content !== last.savedUserMessage.content) {
    return 'I have no recent question in this channel to retry.';
  }
  if (expectMessageId && last.answerMessageId !== expectMessageId) {
    return "That isn't the latest answer here anymore, so I can't retry it. Ask the question again instead.";
  }

  const blockedMsg = checkLimits(asker.id, isOwner);
  if (blockedMsg) return blockedMsg;

  await respond(target, {
    asker,
    history: history.slice(0, -2), // the old answer is replaced by the new one
    userMessage: last.userMessage,
    savedUserMessage: last.savedUserMessage,
    hasImages: last.hasImages,
    exclude: [last.model],
  });
  return null;
}

// Handles a message that pings the bot (or is typed in a chat thread)
async function handleChat(message, ctx) {
  const { client, isOwner } = ctx;
  const channelId = message.channel.id;

  const name = message.member?.displayName ?? message.author.username;
  let prompt = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();

  // Reply context: include the message being replied to (and its images)
  let refNote = '';
  let images = imageUrls(message);
  if (message.reference?.messageId) {
    const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (ref) {
      const refName = ref.member?.displayName ?? ref.author.username;
      const refText = ref.content.slice(0, 500) || '(no text)';
      refNote = `\n[Replying to ${refName}'s message: "${refText}"]`;
      images = images.concat(imageUrls(ref));
    }
  }
  images = images.slice(0, MAX_IMAGES);

  if (!prompt && !images.length) return message.reply('Yes? Ask me something!');
  if (!prompt) prompt = 'Describe this image.';

  const blockedMsg = checkLimits(message.author.id, isOwner);
  if (blockedMsg) {
    const reason = blockedMsg.startsWith('Slow down') ? 'cooldown' : 'daily limit reached';
    logging('info', 'Question blocked', `${whoWhere(message)} · ${reason}`);
    return message.reply(blockedMsg);
  }

  const text = `${name}: ${prompt}${refNote}`;

  // What's sent now includes the images; what's saved to memory is text only
  const userMessage = images.length
    ? {
        role: 'user',
        content: [
          { type: 'text', text },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      }
    : { role: 'user', content: text };
  const savedUserMessage = {
    role: 'user',
    content: images.length ? `${text}\n[attached ${images.length} image(s)]` : text,
  };

  await respond(message, {
    asker: message.author,
    history: histories.get(channelId) ?? [],
    userMessage,
    savedUserMessage,
    hasImages: images.length > 0,
  });
}

module.exports = { respond, retry, handleChat };
