const { BATTLE_ITEMS } = require('./gear');

const MAX_ENERGY = 5;
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// One attack roll, including crits and any buffs
function hit(f, mult = 1) {
  let dmg = rand(f.cls.atk[0], f.cls.atk[1]) + f.weapon.bonus;
  const crit = Math.random() < f.cls.crit + f.weapon.crit;
  if (crit) dmg = Math.round(dmg * 1.5);
  dmg = Math.round(dmg * mult);
  if (f.adrenaline) dmg = Math.round(dmg * 1.5);
  if (f.roar) dmg = Math.round(dmg * 1.2);
  return { dmg, crit };
}

// Works out what a fighter is trying to do this round
function plan(f, pick, arena) {
  const p = {
    kind: pick.kind, id: pick.id, label: '', dmg: 0, trueDmg: 0, crit: false, miss: false,
    attack: false, feint: false, pierce: false, defends: false, evades: false,
    heal: 0, shield: 0, lifesteal: 0, cleanse: false, gainEnergy: 0, apply: null,
  };
  const special = pick.kind === 'special' ? f.cls.specials.find((s) => s.id === pick.id) : null;
  if (special) f.energy = Math.max(0, f.energy - special.cost);
  const set = (h) => Object.assign(p, { dmg: h.dmg, crit: h.crit });

  switch (pick.kind) {
    case 'stunned':
      p.label = 'is stunned and loses the turn';
      break;
    case 'defend':
      p.defends = true;
      p.label = 'raises their guard';
      break;
    case 'feint':
      set(hit(f, 0.7));
      p.feint = true;
      p.pierce = true;
      p.label = 'feints';
      break;
    case 'attack':
      p.attack = true;
      p.label = `attacks with their ${f.weapon.name}`;
      if (f.weapon.type === 'hammer' && Math.random() < 0.15) p.miss = true;
      else set(hit(f));
      break;
    case 'special':
      p.attack = true;
      p.label = `uses ${special.emoji} **${special.name}**`;
      switch (pick.id) {
        case 'power': set(hit(f, 1.8)); break;
        case 'wall': p.attack = false; p.defends = true; p.shield = 20; break;
        case 'backstab': set(hit(f, 1.5)); p.pierce = true; break;
        case 'poison': p.dmg = 5; p.apply = { poison: { turns: 3, dmg: 5 } }; break;
        case 'fireball': set(hit(f, 1.7)); p.apply = { burn: { turns: 2, dmg: 5 } }; break;
        case 'frost': set(hit(f, 0.9)); p.apply = { stun: true }; break;
        case 'smite': set(hit(f, 1.5)); p.lifesteal = 0.5; break;
        case 'heal': p.attack = false; p.heal = Math.round(30 * arena.healMult); p.cleanse = true; break;
      }
      break;
    case 'item': {
      const item = BATTLE_ITEMS[pick.id];
      p.label = `uses ${item.emoji} **${item.name}**`;
      if (pick.id === 'potion') p.heal = Math.round(35 * arena.healMult);
      if (pick.id === 'smoke') p.evades = true;
      if (pick.id === 'bomb') p.trueDmg = 30;
      if (pick.id === 'antidote') p.cleanse = true;
      if (pick.id === 'adrenaline') {
        f.adrenaline = true;
        p.gainEnergy = 2;
      }
      break;
    }
  }

  // Buffs are used up by the next damaging move
  if (p.attack || p.feint) {
    f.adrenaline = false;
    f.roar = false;
  }
  return p;
}

// Both fighters act at the same time. Returns the play-by-play and who fell.
// Defend beats Attack, Attack beats Feint, Feint beats Defend.
function resolveRound(game) {
  const { fighters, arena } = game;
  const plans = fighters.map((f, i) => plan(f, game.roundPicks[i], arena));
  const lines = [];
  const damage = [0, 0];
  const heal = [0, 0];
  const energy = [0, 0];
  const newStatus = [{}, {}];

  fighters.forEach((f, i) => {
    const j = 1 - i;
    const p = plans[i];
    const t = plans[j];
    const foe = fighters[j];

    const move = p.kind === 'special' || p.kind === 'item' ? p.id : p.kind;
    f.moves[move] = (f.moves[move] ?? 0) + 1;

    let text = `${f.cls.emoji} **${f.name}** ${p.label}`;
    const notes = [];

    if (p.heal) {
      heal[i] += p.heal;
      text += ` and heals **${p.heal}**`;
    }
    if (p.shield) {
      f.shield += p.shield;
      text += ` (+${p.shield} shield)`;
    }
    if (p.cleanse) {
      f.statuses.poison = null;
      f.statuses.burn = null;
    }
    energy[i] += p.gainEnergy;

    let dealt = 0;
    if (p.miss) {
      notes.push('but misses completely!');
    } else if (p.dmg > 0 || p.trueDmg > 0) {
      if (t.evades) {
        notes.push('but the target vanished in smoke!');
      } else {
        let dmg = p.dmg;
        if (dmg > 0) {
          if (t.defends && !p.pierce) {
            dmg = Math.round(dmg * (f.weapon.type === 'bow' && p.kind === 'attack' ? 0.75 : 0.5));
            energy[j] += arena.guardEnergy;
            notes.push('🛡️ blocked');
          } else if (t.defends && p.feint) {
            energy[j] -= 1;
            notes.push('🎭 broke their guard');
          }
          if (p.attack && t.feint) {
            dmg = Math.round(dmg * 1.25);
            notes.push('⚡ punished the feint');
          }
          dmg = Math.max(1, dmg - foe.armor.reduce);
        }
        dmg += p.trueDmg;

        if (foe.shield > 0 && dmg > 0) {
          const soaked = Math.min(foe.shield, dmg);
          foe.shield -= soaked;
          dmg -= soaked;
          notes.push(`🛡️ ${soaked} soaked`);
        }

        dealt = dmg;
        damage[j] += dmg;
        f.damageDealt += dmg;
        if (p.crit) notes.unshift('💥 CRIT');

        if (dmg > 0 && p.apply) {
          if (p.apply.poison) newStatus[j].poison = p.apply.poison;
          if (p.apply.burn) newStatus[j].burn = p.apply.burn;
          if (p.apply.stun && !t.defends) newStatus[j].stun = true;
        }
        if (p.lifesteal && dealt > 0) heal[i] += Math.round(dealt * p.lifesteal);
      }
    }

    lines.push(`${text}${dealt ? ` → **${dealt}** damage` : ''}${notes.length ? ` (${notes.join(', ')})` : ''}`);
  });

  // Everything lands at once
  fighters.forEach((f, i) => {
    f.hp = Math.min(f.hpMax, f.hp - damage[i] + heal[i]);
    f.energy = Math.max(0, Math.min(MAX_ENERGY, f.energy + energy[i]));
  });

  // Poison and burn tick
  fighters.forEach((f) => {
    for (const [key, icon] of [['poison', '☠️'], ['burn', '🔥']]) {
      const s = f.statuses[key];
      if (!s) continue;
      f.hp -= s.dmg;
      lines.push(`${icon} **${f.name}** takes **${s.dmg}** ${key} damage.`);
      s.turns--;
      if (s.turns <= 0) f.statuses[key] = null;
    }
  });

  // New effects start next round
  fighters.forEach((f, i) => {
    if (newStatus[i].poison) f.statuses.poison = { ...newStatus[i].poison };
    if (newStatus[i].burn) f.statuses.burn = { ...newStatus[i].burn };
    if (plans[i].kind === 'stunned') f.stun = Math.max(0, f.stun - 1);
    if (newStatus[i].stun) {
      f.stun = 1;
      lines.push(`💫 **${f.name}** is stunned!`);
    }
  });

  arena.end?.(game, lines);
  fighters.forEach((f) => (f.energy = Math.min(MAX_ENERGY, f.energy + 1)));

  return { lines, dead: fighters.map((f) => f.hp <= 0) };
}

module.exports = { resolveRound };
