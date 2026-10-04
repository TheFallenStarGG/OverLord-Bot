const { COOLDOWN_MS } = require('../config');
const { replyLines } = require('../lib/utils');

const order = { free: 0, owner: 1, 'owner-required': 2 };

function accessLabel(access) {
  if (access === 'free') return '🔓 Free to use';
  if (access === 'owner-required') return '🔒 Owner only (needs OWNER_ID set)';
  // 'owner' commands are only locked if the OWNER_ID environment variable is set
  return process.env.OWNER_ID ? '🔒 Owner only' : '🔓 Anyone (not locked: set OWNER_ID)';
}

module.exports = {
  name: '!!help',
  usage: '!!help',
  description: 'Shows this list.',
  access: 'free',

  async run(message, arg, ctx) {
    const sorted = [...ctx.commands.values()].sort(
      (a, b) => order[a.access] - order[b.access] || a.name.localeCompare(b.name)
    );

    const lines = [
      '**Commands**',
      '',
      `**<@${ctx.client.user.id}> <message>** — 🔓 Free to use`,
      `Ask the AI anything. Attach images, or reply to a message to give it context. Each person has a ${COOLDOWN_MS / 1000}s cooldown.`,
      '',
    ];
    for (const c of sorted) {
      lines.push(`**${c.usage}** — ${accessLabel(c.access)}`, c.description, '');
    }
    lines.push('Use the buttons under my answers to rate them (👍/👎), retry (🔁), or delete (🗑️) them.');

    await replyLines(message, lines);
  },
};
