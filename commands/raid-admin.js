const raid = require('../lib/raid');

module.exports = {
  name: '!!raid-admin',
  usage: '!!raid-admin list | end <raid id> | ban <user id> | unban <user id> | banned',
  description: 'Owner tools for raids: list or force-end raids and ban people from raiding.',
  access: 'owner',

  async run(message, arg, ctx) {
    const words = (ctx.rawArg ?? '').split(/\s+/).filter(Boolean);
    const sub = (words[0] ?? '').toLowerCase();
    const id = (ctx.rawArg.match(/\d{17,20}/) ?? [])[0];

    if (sub === 'list' || !sub) {
      const list = raid.listRaids();
      if (!list.length) return message.reply('No raids are running.');
      return message.reply(
        list
          .map((r) => `\`${r.id}\` ${r.sides[0].name} vs ${r.sides[1].name} · ${r.phase} · ${r.players.size} players · ${r.sides[0].score}-${r.sides[1].score}`)
          .join('\n')
          .slice(0, 1900)
      );
    }
    if (sub === 'end') {
      return message.reply(raid.forceEnd(words[1]) ? '🛑 Raid ended.' : 'No running raid with that ID.');
    }
    if (sub === 'ban') {
      if (!id) return message.reply('Give me a user ID: `!!raid-admin ban <user id>`');
      raid.db.banned[id] = true;
      raid.save();
      return message.reply(`🚫 <@${id}> is banned from raids.`);
    }
    if (sub === 'unban') {
      if (!id) return message.reply('Give me a user ID: `!!raid-admin unban <user id>`');
      delete raid.db.banned[id];
      raid.save();
      return message.reply(`✅ <@${id}> can raid again.`);
    }
    if (sub === 'banned') {
      const ids = Object.keys(raid.db.banned);
      return message.reply(ids.length ? ids.map((x) => `<@${x}> (\`${x}\`)`).join('\n').slice(0, 1900) : 'Nobody is banned from raids.');
    }
    return message.reply('Options: `list`, `end <raid id>`, `ban <user id>`, `unban <user id>`, `banned`.');
  },
};
