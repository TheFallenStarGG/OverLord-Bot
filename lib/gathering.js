const { getUser, markDirty, recordQuest, fmt } = require('./economy');
const { FISH, ORE, GEAR_LUCK, GATHER_COOLDOWN_MS, rollLoot } = require('./items');
const { mult, bonus } = require('./modifiers');
const { perk } = require('./petData');
const { weatherBonus, weatherMult, current: currentWeather } = require('./weather');

const CONFIG = {
  fish: { table: FISH, slot: 'rod', cooldownKey: 'lastFish', boostKey: 'netLeft', intro: '🎣 You cast your line…', verb: 'caught', mishap: 'A crack of thunder spooked the fish and a wave snapped your line. You caught nothing this time!' },
  mine: { table: ORE, slot: 'pick', cooldownKey: 'lastMine', boostKey: 'dynamiteLeft', intro: '⛏️ You swing your pickaxe…', verb: 'dug up', mishap: 'The tunnel rumbled and you had to run. You found nothing this time!' },
};

async function runGather(message, kind) {
  const cfg = CONFIG[kind];
  const u = getUser(message.author.id);
  const now = Date.now();
  const weather = currentWeather();

  // Server events like Fishing Frenzy shorten the cooldown, and the weather can lengthen it
  const readyAt = (u[cfg.cooldownKey] ?? 0) + GATHER_COOLDOWN_MS * mult(`${kind}Cooldown`) * weatherMult(`${kind}Cooldown`);
  if (now < readyAt) {
    return message.reply(`⏳ Give it a rest! You can ${kind === 'fish' ? 'fish' : 'mine'} again <t:${Math.ceil(readyAt / 1000)}:R>.`);
  }
  u[cfg.cooldownKey] = now;

  // Bad weather can ruin a trip (the cooldown still counts)
  if (Math.random() < weatherBonus(`${kind}Mishap`)) {
    markDirty();
    return message.reply(`${cfg.intro}\n${weather.def.emoji} ${cfg.mishap}\n-# ${weather.def.name} · \`!!forecast\``);
  }

  // Your gear, any Lucky Charm, server events, and the weather change your odds of rare finds
  const luck = Math.max(
    -0.5,
    GEAR_LUCK[u.gear[cfg.slot]] + ((u.effects.luckUntil ?? 0) > now ? 0.5 : 0) + bonus(`${kind}Luck`) + weatherBonus(`${kind}Luck`) + perk(u, 'luck')
  );

  // A Fishing Net or Dynamite makes you roll twice
  let rolls = 1;
  if ((u.effects[cfg.boostKey] ?? 0) > 0) {
    rolls = 2;
    u.effects[cfg.boostKey]--;
  }

  const found = Array.from({ length: rolls }, () => rollLoot(cfg.table, luck));
  for (const item of found) u.inventory[item.id] = (u.inventory[item.id] ?? 0) + 1;

  recordQuest(message.author.id, kind);
  markDirty();

  const lines = found.map((f) => `${f.emoji} **${f.name}** (worth ${fmt(f.value)})`);
  const best = Math.max(...found.map((f) => f.value));
  const affected = weather.def.fx[`${kind}Luck`] || weather.def.fx[`${kind}Cooldown`];
  const weatherNote = affected ? `\n-# ${weather.def.emoji} ${weather.def.name} is affecting your ${kind === 'fish' ? 'fishing' : 'mining'} · \`!!forecast\`` : '';
  await message.reply(
    `${cfg.intro}\nYou ${cfg.verb}: ${lines.join(' and ')}${rolls === 2 ? ' (rolled twice!)' : ''}` +
    `${best >= 300 ? '\n🎉 **What a find!**' : ''}\n-# Sell your haul with \`!!sell all\`${weatherNote}`
  );
}

module.exports = { runGather };
