const { MAX_HISTORY, MAX_IMAGES } = require('../config');
const { histories, lastAsked, saveHistories } = require('./memory');
const { askAI } = require('./ai');
const { registerAnswer } = require('./answers');
const { checkLimits, dailyLimitText } = require('./usage');
const { logging, whoWhere } = require('./logging');

const imageUrls = (msg) =>
  [...msg.attachments.values()]
    .filter((a) => a.contentType?.startsWith('image/'))
    .map((a) => a.url);

// history = conversation so far (this function adds the new exchange to it)
async function respond(message, { history, userMessage, savedUserMessage, hasImages, exclude = [] }) {
  try {
    await message.channel.sendTyping();
    const { text: reply, model } = await askAI([...history, userMessage], hasImages, exclude);

    // Save the exchange, keeping only the newest MAX_HISTORY messages
    history.push(savedUserMessage, { role: 'assistant', content: reply });
    while (history.length > MAX_HISTORY) history.shift();
    histories.set(message.channel.id, history);
    saveHistories();
    lastAsked.set(message.channel.id, { userMessage, savedUserMessage, hasImages, model });

    // Split long answers; the small-text footer goes on the last chunk
    const chunks = [];
    for (let i = 0; i < reply.length; i += 1900) chunks.push(reply.slice(i, i + 1900));
    chunks[chunks.length - 1] += `\n-# answered by ${model}`;

    let sent;
    for (const chunk of chunks) sent = await message.reply(chunk);
    await registerAnswer(sent, model);

    logging(
      'info',
      'AI answered',
      `${whoWhere(message)} · ${model}${exclude.length ? ' (retry)' : ''}${hasImages ? ' · with images' : ''}`
    );
  } catch (err) {
    if (err.code === 'DAILY_LIMIT') {
      logging('warn', 'Daily request limit reached', whoWhere(message));
      return message.reply(dailyLimitText());
    }
    if (err.code === 'NO_VISION') {
      logging('warn', 'No image-capable model available', whoWhere(message));
      return message.reply("I can't look at images right now because no free model with image support is available. Try again later, or ask without the image.");
    }
    if (err.code === 'NO_MODELS') {
      logging('warn', 'No other model available to try', whoWhere(message));
      return message.reply('There is no other free model available to try right now.');
    }
    if (err.status === 429) {
      logging('warn', 'Free models are rate-limited', whoWhere(message));
      return message.reply('The free models are rate-limited right now. Try again in a minute.');
    }
    logging('error', 'AI request failed', err);
    return message.reply('Something went wrong talking to the AI.');
  }
}

// Handles a normal message that pings the bot
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
    history: histories.get(channelId) ?? [],
    userMessage,
    savedUserMessage,
    hasImages: images.length > 0,
  });
}

module.exports = { respond, handleChat };
