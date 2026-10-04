const { BLOCKED_MODELS } = require('../config');
const { getUsableModels, blockedExtra, ratings, poorlyRated, badModels } = require('../lib/models');
const { replyLines } = require('../lib/utils');

module.exports = {
  name: '!!models',
  usage: '!!models',
  description: 'Lists the available free models with their 👍/👎 scores and whether any are being skipped.',
  access: 'owner',

  async run(message) {
    let usable;
    try {
      usable = await getUsableModels();
    } catch {
      return message.reply('Could not fetch the model list.');
    }

    const lines = [`**${usable.length} free models available** (👁 = can see images)`];
    for (const m of usable) {
      const r = ratings[m.id] ?? { up: 0, down: 0 };
      const flags = [];
      if (m.image) flags.push('👁');
      if ((badModels.get(m.id) ?? 0) > Date.now()) flags.push('failing, skipped for now');
      if (poorlyRated(m.id)) flags.push('low rating, skipped');
      lines.push(`• \`${m.id}\` 👍${r.up} 👎${r.down}${flags.length ? ' — ' + flags.join(', ') : ''}`);
    }

    const blockedList = [...BLOCKED_MODELS, ...blockedExtra].map((b) => `\`${b}\``).join(', ');
    lines.push('', `Blocked patterns: ${blockedList || 'none'}`);

    await replyLines(message, lines);
  },
};
