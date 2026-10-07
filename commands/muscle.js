const { EmbedBuilder } = require('discord.js');
const { fmt } = require('../lib/economy');
const { GUARDS, THIEVES, STAFF, MAX_GUARDS, MAX_THIEVES, JOB_MS, hire, fire, collect, status, takeNotices, findStaff } = require('../lib/muscle');

const unix = (ms) => Math.floor(ms / 1000);
const pct = (n) => `${Math.round(n * 100)}%`;

function shopEmbed() {
  const guards = Object.values(GUARDS)
    .map((g) => `${g.emoji} **${g.name}** · hire ${fmt(g.cost)} · upkeep ${fmt(g.upkeep)}/day\nMakes you ${pct(g.power)} harder to rob.`)
    .join('\n\n');
  const thieves = Object.values(THIEVES)
    .map(
      (t) =>
        `${t.emoji} **${t.name}** · hire ${fmt(t.cost)} · upkeep ${fmt(t.upkeep)}/day\n${pct(t.chance)} base success, steals ${pct(t.min)}-${pct(t.max)} of a victim's coins (max ${fmt(t.cap)}).`
    )
    .join('\n\n');

  return new EmbedBuilder()
    .setColor(0x2c3e50)
    .setTitle('🥷 Muscle for hire')
    .setDescription('Hired muscle works while you are offline. Upkeep is paid automatically every 24 hours, and anyone you cannot afford walks out.')
    .addFields(
      { name: `🛡️ Guards (up to ${MAX_GUARDS})`, value: guards },
      { name: `🥷 Thieves (up to ${MAX_THIEVES}, one job every ${JOB_MS / 3600000} hours)`, value: thieves }
    )
    .setFooter({ text: 'Hire with !!muscle hire <name> · a caught thief costs you damages and sits in jail for 6 hours' });
}

function statusEmbed(userId) {
  const st = status(userId);
  const embed = new EmbedBuilder().setColor(0x2c3e50).setTitle('🥷 Your hired muscle');

  const notices = takeNotices(userId);
  if (notices.length) embed.addFields({ name: '📣 While you were away', value: notices.join('\n') });

  if (!st.staff.length && !st.stash && !st.incidents.length) {
    embed.setDescription('You have nobody on the payroll yet. See who is for hire with `!!muscle shop`.');
    return embed;
  }

  const lines = st.staff.map((s) => {
    const def = STAFF[s.id];
    return def.kind === 'guard'
      ? `${def.emoji} **${def.name}**: ${pct(def.power)} harder to rob you`
      : `${def.emoji} **${def.name}**: next job <t:${unix(Math.max(s.nextAt ?? 0, Date.now()))}:R>`;
  });
  embed.setDescription(lines.join('\n') || '*Nobody is working for you right now.*');

  embed.addFields(
    { name: '💰 Stash', value: `${fmt(st.stash)}\nCollect it with \`!!muscle collect\``, inline: true },
    {
      name: '💸 Upkeep',
      value: st.staff.length ? `${fmt(st.upkeep)} per day\nNext payment <t:${unix(st.nextUpkeepAt)}:R>` : 'None',
      inline: true,
    },
    { name: '🛡️ Protection', value: st.guardPower ? `${pct(st.guardPower)} harder to rob` : 'None', inline: true }
  );

  if (st.log.length) {
    embed.addFields({ name: '📜 Recent reports', value: st.log.slice(-4).reverse().map((l) => `<t:${unix(l.at)}:R> ${l.text}`).join('\n').slice(0, 1024) });
  }
  if (st.incidents.length) {
    embed.addFields({ name: '🚨 Break-ins at your place', value: st.incidents.slice(0, 3).map((i) => `<t:${unix(i.at)}:R> ${i.text}`).join('\n').slice(0, 1024) });
  }
  return embed;
}

module.exports = {
  name: '!!muscle',
  aliases: ['!!hire'],
  usage: '!!muscle [shop | hire <name> | fire <name> | collect]',
  description: 'Hire guards that make you harder to rob, or thieves that rob other players while you are offline. They cost daily upkeep.',
  access: 'free',

  async run(message, arg) {
    const userId = message.author.id;
    const [sub = '', ...rest] = arg.split(/\s+/).filter(Boolean);
    const name = rest.join(' ');

    switch (sub) {
      case '':
      case 'status':
        return message.reply({ embeds: [statusEmbed(userId)] });

      case 'shop':
      case 'list':
        return message.reply({ embeds: [shopEmbed()] });

      case 'hire': {
        const id = findStaff(name);
        if (!id) return message.reply('Who do you want to hire? See the list with `!!muscle shop`.');
        const r = hire(userId, id);
        if (r.error) return message.reply(r.error);
        return message.reply(`${r.def.emoji} You hired a **${r.def.name}** for ${fmt(r.def.cost)}. Their upkeep is ${fmt(r.def.upkeep)} per day.`);
      }

      case 'fire': {
        const id = findStaff(name);
        if (!id) return message.reply('Who do you want to let go? Use `!!muscle fire <name>`.');
        const r = fire(userId, id);
        if (r.error) return message.reply(r.error);
        return message.reply(`👋 You let your **${r.def.name}** go. There are no refunds.`);
      }

      case 'collect':
      case 'claim': {
        const r = collect(userId);
        if (r.error) return message.reply(r.error);
        return message.reply(`💰 You collected **${fmt(r.amount)}** from your stash.`);
      }

      default:
        return message.reply('Usage: `!!muscle [shop | hire <name> | fire <name> | collect]`');
    }
  },
};
