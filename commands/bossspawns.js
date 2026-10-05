const { spawnBoss } = require('../lib/boss');

module.exports = {
  name: '!!bossspawn',
  usage: '!!bossspawn [hp]',
  description: 'Forces a raid boss to appear in this channel, for testing. You can set its HP (100 to 100000).',
  access: 'owner-required',

  async run(message, arg) {
    if (!message.guild) return message.reply('Bosses only appear in servers.');

    let hp;
    if (arg) {
      hp = parseInt(arg, 10);
      if (!(hp >= 100 && hp <= 100000)) return message.reply('The HP must be a number from 100 to 100000.');
    }

    const boss = await spawnBoss(message.channel, hp);
    if (!boss) return message.reply('A boss is already active in this server!');
  },
};
