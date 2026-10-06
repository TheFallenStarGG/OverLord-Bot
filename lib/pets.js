const { EmbedBuilder } = require('discord.js');
const { getUser, spendCoins, markDirty, fmt } = require('./economy');
const { FISH, findItem } = require('./items');
const { removeItem } = require('./inventory');
const { SPECIES, PERK_TEXT, MAX_LEVEL, EVOLVE_LEVEL, levelOf, xpFor, isEvolved, hungerNow, looks, perkValue } = require('./petData');

const ADOPT_COST = 1500;
const PLAY_COOLDOWN_MS = 60 * 60 * 1000;
const NAME_PATTERN = /^[\p{L}\p{N} '\-_.!]{1,20}$/u;
const PLAY_LINES = [
  '{n} chases its own tail for ten whole minutes.',
  '{n} fetches a stick and looks incredibly proud.',
  '{n} zooms around the room and knocks something over.',
  '{n} rolls over and demands belly rubs.',
  '{n} stares at you, then does a tiny dance.',
];

const bar = (percent) => {
  const n = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return '█'.repeat(n) + '░'.repeat(10 - n);
};

function rollSpecies() {
  const total = Object.values(SPECIES).reduce((sum, d) => sum + d.weight, 0);
  let r = Math.random() * total;
  for (const [id, d] of Object.entries(SPECIES)) {
    r -= d.weight;
    if (r < 0) return id;
  }
  return 'dog';
}

// Text about level-ups and evolving after a pet gains XP
function growthNote(pet, levelBefore, evolvedBefore) {
  const notes = [];
  const level = levelOf(pet);
  if (level > levelBefore) notes.push(`⬆️ **${pet.name}** reached level **${level}**!`);
  if (!evolvedBefore && isEvolved(pet)) notes.push(`✨ **${pet.name}** evolved into a **${looks(pet).name}**! Its perks are 50% stronger!`);
  return notes.join('\n');
}

function adopt(userId) {
  const u = getUser(userId);
  if (u.pet) return { error: 'You already have a pet! Release it first with `!!pet release confirm` if you want a different one.' };
  if (!spendCoins(userId, ADOPT_COST)) return { error: `Adopting a pet costs **${fmt(ADOPT_COST)}** and you only have **${fmt(u.coins)}**.` };

  const id = rollSpecies();
  u.pet = { species: id, name: SPECIES[id].name, xp: 0, hunger: 60, hungerAt: Date.now(), lastPlay: 0 };
  markDirty();
  return { pet: u.pet };
}

function feed(userId, name, amountText) {
  const u = getUser(userId);
  const pet = u.pet;
  if (!pet) return { error: "You don't have a pet yet. Adopt one with `!!pet adopt`." };

  let fish;
  if (name) {
    const found = findItem(name);
    fish = found && FISH.find((f) => f.id === found.id);
    if (!fish) return { error: `Pets only eat fish, and "${name}" isn't one. Catch some with \`!!fish\`!` };
  } else {
    // With no fish named, it eats the cheapest fish you have
    fish = [...FISH].sort((a, b) => a.value - b.value).find((f) => (u.inventory[f.id] ?? 0) > 0);
    if (!fish) return { error: "You don't have any fish to feed. Catch some with `!!fish` first!" };
  }

  const have = u.inventory[fish.id] ?? 0;
  if (!have) return { error: `You don't have any ${fish.name}.` };

  const wanted = amountText === 'all' ? have : parseInt(amountText ?? '1', 10) || 1;
  const n = Math.max(1, Math.min(wanted, have, 50));
  const hungerEach = Math.min(50, 10 + Math.round(fish.value / 8));
  const xpEach = Math.max(5, Math.round(fish.value / 2));

  const levelBefore = levelOf(pet);
  const evolvedBefore = isEvolved(pet);

  removeItem(u, fish.id, n);
  pet.hunger = Math.min(100, hungerNow(pet) + hungerEach * n);
  pet.hungerAt = Date.now();
  pet.xp += xpEach * n;
  markDirty();

  const note = growthNote(pet, levelBefore, evolvedBefore);
  return {
    text:
      `${fish.emoji} You fed **${pet.name}** ${n}× ${fish.name}. ${looks(pet).emoji} It gobbles it up!\n` +
      `🍖 Hunger: **${Math.round(pet.hunger)}%** · ✨ +${xpEach * n} XP${note ? `\n${note}` : ''}`,
  };
}

function play(userId) {
  const u = getUser(userId);
  const pet = u.pet;
  if (!pet) return { error: "You don't have a pet yet. Adopt one with `!!pet adopt`." };
  if (hungerNow(pet) <= 0) return { error: `**${pet.name}** is too hungry to play. Feed it some fish first!` };

  const now = Date.now();
  const readyAt = (pet.lastPlay ?? 0) + PLAY_COOLDOWN_MS;
  if (now < readyAt) return { error: `**${pet.name}** is tired. You can play again <t:${Math.ceil(readyAt / 1000)}:R>.` };

  const levelBefore = levelOf(pet);
  const evolvedBefore = isEvolved(pet);
  pet.lastPlay = now;
  pet.xp += 10;

  let found = 0;
  if (Math.random() < 0.2) {
    found = 10 + Math.floor(Math.random() * 31);
    u.coins += found;
  }
  markDirty();

  const line = PLAY_LINES[Math.floor(Math.random() * PLAY_LINES.length)].replace('{n}', `**${pet.name}**`);
  const note = growthNote(pet, levelBefore, evolvedBefore);
  return { text: `${looks(pet).emoji} ${line}${found ? ` It dug up **${fmt(found)}**!` : ''}\n✨ +10 XP${note ? `\n${note}` : ''}` };
}

function rename(userId, rawName) {
  const u = getUser(userId);
  if (!u.pet) return { error: "You don't have a pet yet. Adopt one with `!!pet adopt`." };
  const name = rawName.replace(/\s+/g, ' ').trim();
  if (!NAME_PATTERN.test(name)) return { error: 'Pet names can be 1 to 20 letters, numbers, spaces, or simple punctuation (like `Mr. Whiskers`).' };
  u.pet.name = name;
  markDirty();
  return { text: `${looks(u.pet).emoji} Your pet is now called **${name}**!` };
}

function release(userId) {
  const u = getUser(userId);
  if (!u.pet) return { error: "You don't have a pet to release." };
  const { name } = u.pet;
  delete u.pet;
  markDirty();
  return { text: `👋 You said goodbye to **${name}**. It runs off into the sunset...` };
}

function petEmbed(u, ownerName, headline) {
  const pet = u.pet;
  const species = SPECIES[pet.species];
  const look = looks(pet);
  const level = levelOf(pet);
  const hunger = Math.round(hungerNow(pet));

  const base = xpFor(level);
  const next = xpFor(level + 1);
  const xpLine = level >= MAX_LEVEL ? '⭐ Max level!' : `${bar(((pet.xp - base) / (next - base)) * 100)}\n${pet.xp - base} / ${next - base} XP`;
  const mood = hunger <= 0 ? '😢 Starving. Its perks are **off** until you feed it!' : hunger < 25 ? '😟 Getting hungry' : '😊 Happy and well fed';

  const perks = Object.keys(species.perks)
    .map((k) => {
      const line = PERK_TEXT[k](perkValue(pet, k));
      return hunger <= 0 ? `• ~~${line}~~` : `• ${line}`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(species.color)
    .setTitle(`${look.emoji} ${pet.name}`)
    .setDescription(`${headline ? `${headline}\n\n` : ''}${species.rarity} ${look.name}${isEvolved(pet) ? ' · ✨ Evolved' : ''}\nOwner: ${ownerName}`)
    .addFields(
      { name: `⭐ Level ${level}`, value: xpLine, inline: true },
      { name: '🍖 Hunger', value: `${bar(hunger)}\n${hunger}% · ${mood}`, inline: true },
      { name: '🎁 Perks', value: perks }
    );
  if (!isEvolved(pet)) embed.addFields({ name: '✨ Evolution', value: `Evolves into the **${species.evolved.name}** at level ${EVOLVE_LEVEL}, with perks 50% stronger.` });
  return embed.setFooter({ text: 'Feed it fish from !!fish with !!pet feed' });
}

function speciesEmbed() {
  const total = Object.values(SPECIES).reduce((sum, d) => sum + d.weight, 0);
  const lines = Object.values(SPECIES).map((d) => {
    const perks = Object.entries(d.perks).map(([k, [start]]) => PERK_TEXT[k](start)).join(', ');
    return `${d.emoji} **${d.name}** → ${d.evolved.emoji} ${d.evolved.name}\n${d.rarity} (${Math.round((d.weight / total) * 100)}%) · starts at ${perks}`;
  });
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🐾 Pets you can adopt')
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: `Adopting costs ${ADOPT_COST.toLocaleString('en-US')} coins and picks a random pet. Perks grow with level.` });
}

module.exports = { ADOPT_COST, adopt, feed, play, rename, release, petEmbed, speciesEmbed };
