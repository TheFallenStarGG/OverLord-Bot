const MAX_LEVEL = 20;
const EVOLVE_LEVEL = 10;
const EVOLVE_BONUS = 1.5; // evolved pets have 50% stronger perks
const HUNGER_PER_HOUR = 4; // a full pet gets hungry after about a day

const pct = (v) => `${Math.round(v * 1000) / 10}%`;

const PERK_TEXT = {
  work: (v) => `+${pct(v)} \`!!work\` pay`,
  daily: (v) => `+${pct(v)} \`!!daily\` reward`,
  xp: (v) => `+${pct(v)} chat XP`,
  sell: (v) => `+${pct(v)} when selling fish and ores`,
  luck: (v) => `+${v.toFixed(2)} luck when fishing and mining`,
  boss: (v) => `+${pct(v)} boss damage`,
};

// perks: type -> [starting value, extra per level]
const SPECIES = {
  dog: { emoji: '🐶', name: 'Dog', rarity: 'Common', weight: 28, color: 0x95a5a6, evolved: { emoji: '🐕‍🦺', name: 'Guard Dog' }, perks: { work: [0.02, 0.005] } },
  cat: { emoji: '🐱', name: 'Cat', rarity: 'Common', weight: 28, color: 0x95a5a6, evolved: { emoji: '🐈‍⬛', name: 'Shadow Cat' }, perks: { luck: [0.03, 0.015] } },
  rabbit: { emoji: '🐰', name: 'Rabbit', rarity: 'Common', weight: 14, color: 0x95a5a6, evolved: { emoji: '🐇', name: 'Swift Hare' }, perks: { xp: [0.02, 0.006] } },
  fox: { emoji: '🦊', name: 'Fox', rarity: 'Rare', weight: 14, color: 0x3498db, evolved: { emoji: '🦊', name: 'Nine-Tailed Fox' }, perks: { sell: [0.02, 0.006] } },
  owl: { emoji: '🦉', name: 'Owl', rarity: 'Rare', weight: 11, color: 0x3498db, evolved: { emoji: '🦉', name: 'Elder Owl' }, perks: { daily: [0.05, 0.02] } },
  wolf: { emoji: '🐺', name: 'Wolf', rarity: 'Epic', weight: 4, color: 0x9b59b6, evolved: { emoji: '🐺', name: 'Dire Wolf' }, perks: { boss: [0.03, 0.01] } },
  dragon: {
    emoji: '🐲', name: 'Dragon', rarity: 'Legendary', weight: 1, color: 0xf1c40f, evolved: { emoji: '🐉', name: 'Ancient Dragon' },
    perks: { work: [0.015, 0.004], luck: [0.03, 0.01], xp: [0.015, 0.004], sell: [0.015, 0.004], boss: [0.02, 0.006] },
  },
};

const levelOf = (pet) => Math.min(MAX_LEVEL, 1 + Math.floor(Math.sqrt(pet.xp / 25)));
const xpFor = (level) => 25 * (level - 1) ** 2; // total XP needed to reach a level
const isEvolved = (pet) => levelOf(pet) >= EVOLVE_LEVEL;

// Hunger drops over time. It's worked out when needed, so nothing has to run in the background.
const hungerNow = (pet) => Math.max(0, pet.hunger - ((Date.now() - pet.hungerAt) / 3600000) * HUNGER_PER_HOUR);

const looks = (pet) => {
  const s = SPECIES[pet.species];
  return isEvolved(pet) ? s.evolved : { emoji: s.emoji, name: s.name };
};

function perkValue(pet, key) {
  const p = SPECIES[pet.species]?.perks[key];
  if (!p) return 0;
  return (p[0] + p[1] * (levelOf(pet) - 1)) * (isEvolved(pet) ? EVOLVE_BONUS : 1);
}

// The bonus a user's pet gives right now (0 if they have no pet, or it's starving)
function perk(u, key) {
  const pet = u.pet;
  if (!pet || hungerNow(pet) <= 0) return 0;
  return perkValue(pet, key);
}

module.exports = { MAX_LEVEL, EVOLVE_LEVEL, SPECIES, PERK_TEXT, levelOf, xpFor, isEvolved, hungerNow, looks, perkValue, perk };
