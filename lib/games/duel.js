const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { registerModule, startGame, endGame, privateReply, isBusy } = require('./common');
const { getUser, transferUpTo, recordQuest, betError, markDirty, fmt } = require('../economy');
const { recordRanked } = require('../ranked');
const { duelBountyResult } = require('../bounty');
const { removeItem } = require('../inventory');
const { CLASSES, ARENAS } = require('../combat/classes');
const { resolveRound } = require('../combat/engine');
const { ensureProfile, playerGear, standardGear, BATTLE_ITEMS, TITLES, recordDuelStats } = require('../combat/gear');
const { logging } = require('../logging');

const ROUND_MS = 90 * 1000; // time to choose each round
const MAX_MISSES = 2; // missed rounds in a row before you forfeit

const pendingOptions = new Map(); // "challenger:opponent" -> options from !!duel
const rematches = new Map(); // finished game id -> who wants a rematch

const bar = (hp, max) => {
  const filled = Math.max(0, Math.ceil((Math.max(hp, 0) / max) * 10));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
};
const energyBar = (e) => '⚡'.repeat(e) + '▫️'.repeat(5 - e);

function statusText(f) {
  const s = [];
  if (f.statuses.poison) s.push(`☠️${f.statuses.poison.turns}`);
  if (f.statuses.burn) s.push(`🔥${f.statuses.burn.turns}`);
  if (f.stun > 0) s.push('💫');
  if (f.shield > 0) s.push(`🛡️${f.shield}`);
  if (f.adrenaline) s.push('💢');
  if (f.roar) s.push('📣');
  return s.join(' ');
}

const pickArena = () => ARENAS[Math.floor(Math.random() * ARENAS.length)];

function newGame({ players, names, bet = 0, ranked = false, fair = false, bestOf = 1, noDraw = false, onFinish = null }) {
  return {
    type: 'duel',
    players,
    names,
    bet,
    ranked,
    fair: ranked || fair, // equal gear for everyone
    bestOf,
    noDraw,
    onFinish,
    phase: 'class', // class -> round -> over
    picks: [null, null], // classes
    fighters: [],
    arena: null,
    round: 1,
    gameNo: 1,
    series: [0, 0],
    roundPicks: [null, null],
    cheerers: new Set(),
    crowd: [0, 0],
    misses: [0, 0],
    log: [],
    roundTimer: null,
    over: false,
    result: null,
  };
}

function makeFighter(userId, name, classId, fair) {
  const u = ensureProfile(getUser(userId));
  const cls = CLASSES[classId];
  const gear = fair ? standardGear() : playerGear(u);
  const items = fair ? [] : u.loadout.items.filter((id) => BATTLE_ITEMS[id]).slice(0, 3);
  return {
    id: userId, name, cls, classId,
    hpMax: cls.hp, hp: cls.hp, energy: 1, shield: 0, stun: 0,
    statuses: { poison: null, burn: null },
    adrenaline: false, roar: false,
    weapon: gear.weapon, armor: gear.armor,
    items, slotUsed: items.map(() => false),
    damageDealt: 0, moves: {},
  };
}

function resetFighters(game) {
  for (const f of game.fighters) {
    Object.assign(f, { hp: f.hpMax, energy: 1, shield: 0, stun: 0, adrenaline: false, roar: false, statuses: { poison: null, burn: null } });
  }
  game.round = 1;
  game.crowd = [0, 0];
  game.misses = [0, 0];
}

function resetRoundPicks(game) {
  game.roundPicks = game.fighters.map((f) => (f.stun > 0 ? { kind: 'stunned' } : null));
  game.cheerers = new Set();
}

function startRoundTimer(game) {
  clearTimeout(game.roundTimer);
  game.roundTimer = setTimeout(() => {
    timeoutRound(game).catch((err) => logging('error', 'Duel round timeout failed', err));
  }, ROUND_MS);
}

function nextRound(game) {
  resetRoundPicks(game);
  startRoundTimer(game);
  // If both fighters are stunned there's nothing to wait for
  if (game.roundPicks[0] && game.roundPicks[1]) {
    setTimeout(() => playRound(game).catch((err) => logging('error', 'Duel round failed', err)), 1500);
  }
}

function beginGame(game) {
  game.fighters = [0, 1].map((i) => makeFighter(game.players[i], game.names[i], game.picks[i], game.fair));
  game.arena = pickArena();
  game.phase = 'round';
  game.round = 1;
  game.log = [`The fight begins in the **${game.arena.name}**!`];
  nextRound(game);
}

// What a button code means for a fighter ("attack", "sp0", "item1"...)
function parsePick(f, code) {
  if (['attack', 'defend', 'feint'].includes(code)) return { kind: code };
  if (code.startsWith('sp')) {
    const s = f.cls.specials[Number(code.slice(2))];
    if (!s) return { error: 'Unknown move.' };
    if (f.energy < s.cost) return { error: `${s.name} needs ${s.cost}⚡ and you have ${f.energy}.` };
    return { kind: 'special', id: s.id };
  }
  if (code.startsWith('item')) {
    const slot = Number(code.slice(4));
    const itemId = f.items[slot];
    if (!itemId || f.slotUsed[slot]) return { error: 'That item slot is empty.' };
    if ((getUser(f.id).inventory[itemId] ?? 0) < 1) return { error: "You don't have that item anymore." };
    return { kind: 'item', id: itemId, slot };
  }
  return { error: 'Unknown move.' };
}

function pickLabel(f, pick) {
  if (pick.kind === 'special') return f.cls.specials.find((s) => s.id === pick.id).name;
  if (pick.kind === 'item') return BATTLE_ITEMS[pick.id].name;
  if (pick.kind === 'stunned') return 'Stunned';
  return pick.kind[0].toUpperCase() + pick.kind.slice(1);
}

// The private panel where you choose your move
function actionPanel(game, idx, note = '') {
  const f = game.fighters[idx];
  const foe = game.fighters[1 - idx];
  const picked = game.roundPicks[idx];

  const lines = [
    `**Round ${game.round}** — choose your move!`,
    `You: ❤️ **${f.hp}/${f.hpMax}** · ${energyBar(f.energy)} ${statusText(f)}`,
    `${foe.name}: ❤️ **${foe.hp}/${foe.hpMax}** · ${energyBar(foe.energy)} ${statusText(foe)}`,
    '-# Defend beats Attack · Attack beats Feint · Feint beats Defend',
  ];
  if (note) lines.push('', note);
  if (picked) {
    lines.push('', picked.kind === 'stunned' ? '💫 You are stunned and lose this turn!' : `✅ Locked in: **${pickLabel(f, picked)}**. Waiting for your opponent…`);
  }

  const id = (a) => `game:duel:${game.id}:act:${a}`;
  const button = (a, label, style, emoji, disabled = false) =>
    new ButtonBuilder().setCustomId(id(a)).setLabel(label).setStyle(style).setEmoji(emoji).setDisabled(disabled);
  const locked = Boolean(picked);

  const rows = [
    new ActionRowBuilder().addComponents(
      button('attack', 'Attack', ButtonStyle.Danger, '⚔️', locked),
      button('defend', 'Defend', ButtonStyle.Primary, '🛡️', locked),
      button('feint', 'Feint', ButtonStyle.Secondary, '🎭', locked)
    ),
    new ActionRowBuilder().addComponents(
      f.cls.specials.map((s, k) => button(`sp${k}`, `${s.name} (${s.cost}⚡)`, ButtonStyle.Success, s.emoji, locked || f.energy < s.cost))
    ),
  ];
  if (f.items.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        f.items.map((itemId, k) =>
          button(`item${k}`, BATTLE_ITEMS[itemId].name, ButtonStyle.Secondary, BATTLE_ITEMS[itemId].emoji, locked || f.slotUsed[k])
        )
      )
    );
  }
  return { content: lines.join('\n'), components: rows };
}

// ---------- Playing rounds ----------

async function playRound(game) {
  if (game.phase !== 'round') return;
  clearTimeout(game.roundTimer);

  const { lines, dead } = resolveRound(game);

  // Items are used up when they're used
  game.roundPicks.forEach((pick, i) => {
    if (pick.kind !== 'item') return;
    const f = game.fighters[i];
    removeItem(getUser(f.id), pick.id);
    f.slotUsed[pick.slot] = true;
    markDirty();
  });

  game.log = lines;
  game.round++;
  game.misses = game.misses.map((m, i) => (game.roundPicks[i]?.auto ? m : 0));

  if (dead[0] || dead[1]) {
    let winner = null;
    if (dead[0] && dead[1]) {
      const [a, b] = game.fighters;
      winner = a.hp > b.hp ? 0 : b.hp > a.hp ? 1 : null;
    } else {
      winner = dead[0] ? 1 : 0;
    }
    return afterGame(game, winner);
  }

  nextRound(game);
  await game.message?.edit(duel.render(game)).catch(() => {});
}

async function timeoutRound(game) {
  if (game.phase !== 'round') return;
  for (const i of [0, 1]) {
    if (game.roundPicks[i]) continue;
    game.roundPicks[i] = { kind: 'defend', auto: true };
    game.misses[i]++;
    if (game.misses[i] >= MAX_MISSES) {
      game.log = [`⌛ **${game.names[i]}** stopped responding and forfeits.`];
      return finishMatch(game, 1 - i);
    }
  }
  await playRound(game);
}

// One game of the match is over (a best-of-3 can have several)
async function afterGame(game, winner) {
  if (winner !== null) game.series[winner]++;
  const need = Math.ceil(game.bestOf / 2);

  if (game.series[0] >= need || game.series[1] >= need) {
    return finishMatch(game, game.series[0] > game.series[1] ? 0 : 1);
  }
  if (winner === null && game.bestOf === 1 && !game.noDraw) return finishMatch(game, null);

  game.gameNo++;
  game.log.push(
    winner === null
      ? '🤝 Double KO! The game is replayed.'
      : `🏆 **${game.names[winner]}** takes the game! Score: ${game.series[0]}–${game.series[1]}`
  );
  resetFighters(game);
  game.arena = pickArena();
  nextRound(game);
  await game.message?.edit(duel.render(game)).catch(() => {});
}

async function finishMatch(game, winnerIdx) {
  clearTimeout(game.roundTimer);
  game.phase = 'over';
  game.over = true;

  const lines = [];
  let titleLines = [];
  if (winnerIdx === null) {
    lines.push("🤝 **It's a draw!** No coins or ratings change.");
  } else {
    const winner = game.players[winnerIdx];
    const loser = game.players[1 - winnerIdx];
    const moved = game.bet ? transferUpTo(loser, winner, game.bet) : 0;
    lines.push(`🏆 <@${winner}> **wins the duel!**${moved ? ` They take **${fmt(moved)}** from <@${loser}>.` : ''}`);

    recordQuest(winner, 'win');
    if (game.ranked) recordRanked('duel', winner, loser);
    const bountyNote = game.onFinish ? null : duelBountyResult(winner, loser);
    if (bountyNote) lines.push(bountyNote);

    for (const i of [0, 1]) {
      const f = game.fighters[i];
      const unlocked = recordDuelStats(game.players[i], { won: i === winnerIdx, damage: f.damageDealt, moves: f.moves });
      titleLines = titleLines.concat(unlocked.map((id) => `🏷️ <@${game.players[i]}> unlocked **${TITLES[id].name}**! (equip with \`!!loadout title\`)`));
    }
  }
  game.result = [...lines, ...titleLines].join('\n');

  if (!game.onFinish) {
    rematches.set(game.id, { players: game.players, names: game.names, bet: game.bet, ranked: game.ranked, bestOf: game.bestOf, votes: new Set(), at: Date.now() });
    if (rematches.size > 50) rematches.delete(rematches.keys().next().value);
  }
  endGame(game);
  await game.message?.edit(duel.render(game)).catch(() => {});
  game.onFinish?.(winnerIdx === null ? null : game.players[winnerIdx], game);
}

// ---------- The duel module ----------

const duel = {
  type: 'duel',

  // !!duel stores its options (ranked, best of 3) here before sending the challenge
  setOptions(challengerId, opponentId, options) {
    pendingOptions.set(`${challengerId}:${opponentId}`, { ...options, at: Date.now() });
  },

  create(challenge) {
    const key = `${challenge.challenger.id}:${challenge.opponent.id}`;
    const saved = pendingOptions.get(key);
    pendingOptions.delete(key);
    const options = saved && Date.now() - saved.at < 5 * 60 * 1000 ? saved : {};

    return newGame({
      players: [challenge.challenger.id, challenge.opponent.id],
      names: [challenge.challenger.username, challenge.opponent.username],
      bet: challenge.bet,
      ranked: Boolean(options.ranked),
      bestOf: options.bestOf ?? 1,
    });
  },

  // Used by tournaments
  createMatch: newGame,

  render(game) {
    const id = (action, extra) => `game:duel:${game.id}:${action}${extra === undefined ? '' : `:${extra}`}`;
    const button = (customId, label, style, emoji) => {
      const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
      if (emoji) b.setEmoji(emoji);
      return b;
    };
    const tags = [
      game.ranked && '🏅 Ranked',
      game.fair && !game.ranked && '⚖️ Equal gear',
      game.bet > 0 && fmt(game.bet),
      game.bestOf > 1 && `Best of ${game.bestOf}`,
    ].filter(Boolean).join(' · ');

    const embed = new EmbedBuilder().setTitle(`⚔️ ${game.names[0]} vs ${game.names[1]}`);

    // Choosing classes
    if (game.phase === 'class') {
      embed
        .setColor(0x5865f2)
        .setDescription(
          `${tags ? `*${tags}*\n` : ''}**Pick your class!** Your choice stays secret until you've both chosen.\n` +
          [0, 1].map((i) => `• <@${game.players[i]}>: ${game.picks[i] ? '✅ Locked in' : '⏳ Choosing…'}`).join('\n')
        )
        .addFields(
          Object.values(CLASSES).map((c) => ({
            name: `${c.emoji} ${c.name} · ${c.hp} HP`,
            value: `${c.blurb}\n${c.specials.map((s) => `${s.emoji} **${s.name}** (${s.cost}⚡): ${s.desc}`).join('\n')}`,
          }))
        );
      return {
        content: '',
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(
            Object.entries(CLASSES).map(([cid, c]) => button(id('class', cid), c.name, ButtonStyle.Primary, c.emoji))
          ),
          new ActionRowBuilder().addComponents(button(id('cancel'), 'Cancel', ButtonStyle.Secondary, '❌')),
        ],
      };
    }

    const card = (i) => {
      const f = game.fighters[i];
      return {
        name: `${f.cls.emoji} ${f.name}`,
        value:
          `${bar(f.hp, f.hpMax)}\n❤️ **${Math.max(f.hp, 0)}/${f.hpMax}**\n${energyBar(f.energy)}\n${statusText(f) || '—'}\n` +
          `-# ${f.weapon.emoji} ${f.weapon.name}${f.armor.reduce ? ` · 🛡️ ${f.armor.name}` : ''}`,
        inline: true,
      };
    };

    // Over
    if (game.phase === 'over') {
      embed
        .setColor(0xf1c40f)
        .setDescription(`${game.log.map((l) => `> ${l}`).join('\n')}\n\n${game.result}`)
        .addFields(card(0), card(1));
      return {
        content: '',
        embeds: [embed],
        components: game.onFinish ? [] : [new ActionRowBuilder().addComponents(button(`rematch:duel:${game.id}`, 'Rematch', ButtonStyle.Primary, '🔁'))],
      };
    }

    // Fighting
    const waiting = [0, 1].filter((i) => !game.roundPicks[i]).map((i) => game.names[i]);
    const need = game.arena.cheerNeed;
    embed
      .setColor(0xe74c3c)
      .setDescription(
        `${tags ? `*${tags}*\n` : ''}${game.arena.emoji} **${game.arena.name}**: ${game.arena.desc}\n\n` +
        `${game.log.map((l) => `> ${l}`).join('\n')}\n\n` +
        (waiting.length ? `⏳ Waiting for: **${waiting.join('** and **')}**` : '⚔️ Resolving…')
      )
      .addFields(card(0), card(1))
      .setFooter({
        text:
          `Round ${game.round}${game.bestOf > 1 ? ` · Game ${game.gameNo} · Score ${game.series[0]}–${game.series[1]}` : ''}` +
          ` · 📣 Crowd: ${game.crowd[0]}/${need} vs ${game.crowd[1]}/${need}`,
      });

    return {
      content: '',
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          button(id('open'), 'Choose action', ButtonStyle.Primary, '🎯'),
          button(id('cheer', 0), `Cheer ${game.names[0].slice(0, 15)}`, ButtonStyle.Secondary, '📣'),
          button(id('cheer', 1), `Cheer ${game.names[1].slice(0, 15)}`, ButtonStyle.Secondary, '📣'),
          button(id('forfeit'), 'Forfeit', ButtonStyle.Secondary, '🏳️')
        ),
      ],
    };
  },

  async handleButton(interaction, game, action, arg) {
    const me = game.players.indexOf(interaction.user.id);

    // Spectators can cheer
    if (action === 'cheer') {
      if (game.phase !== 'round') return privateReply(interaction, 'The crowd only cheers during a fight!');
      if (me !== -1) return privateReply(interaction, "You can't cheer for yourself! Let the crowd do that. 😄");
      if (game.cheerers.has(interaction.user.id)) return privateReply(interaction, 'You already cheered this round!');

      const target = Number(arg);
      game.cheerers.add(interaction.user.id);
      game.crowd[target]++;
      if (game.crowd[target] >= game.arena.cheerNeed) {
        game.crowd[target] = 0;
        game.fighters[target].roar = true;
        game.log.push(`📣 The crowd roars for **${game.names[target]}**! (+20% damage on their next hit)`);
      }
      return interaction.update(duel.render(game));
    }

    if (me === -1) return privateReply(interaction, "You're not in this duel. You can cheer for a fighter though! 📣");

    // Cancel before the fight starts
    if (action === 'cancel' && game.phase === 'class') {
      endGame(game);
      return interaction.update({ content: `🚫 **${game.names[me]}** cancelled the duel.`, embeds: [], components: [] });
    }

    // Class picks
    if (action === 'class' && game.phase === 'class') {
      if (!CLASSES[arg]) return;
      if (game.picks[me]) return privateReply(interaction, 'You already locked in your class!');
      game.picks[me] = arg;
      if (game.picks[0] && game.picks[1]) beginGame(game);
      return interaction.update(duel.render(game));
    }

    if (game.phase !== 'round') return privateReply(interaction, "You can't do that right now.");

    // Open your private move panel
    if (action === 'open') {
      return interaction.reply({ ...actionPanel(game, me), flags: MessageFlags.Ephemeral });
    }

    // Lock in a move
    if (action === 'act') {
      if (game.roundPicks[me]) return interaction.update(actionPanel(game, me));

      const pick = parsePick(game.fighters[me], arg);
      if (pick.error) return interaction.update(actionPanel(game, me, `⚠️ ${pick.error}`));

      game.roundPicks[me] = pick;
      game.misses[me] = 0;
      await interaction.update(actionPanel(game, me));

      if (game.roundPicks[0] && game.roundPicks[1]) await playRound(game);
      else await game.message?.edit(duel.render(game)).catch(() => {});
      return;
    }

    if (action === 'forfeit') {
      await interaction.deferUpdate();
      game.log = [`🏳️ **${game.names[me]}** forfeited!`];
      return finishMatch(game, 1 - me);
    }
  },

  // No clicks for 5 minutes: whoever hasn't moved forfeits
  async onExpire(game) {
    if (game.phase === 'class') {
      await game.message?.edit({ content: '⌛ The duel timed out. No coins changed hands.', embeds: [], components: [] }).catch(() => {});
      return;
    }
    if (game.phase !== 'round') return;
    const idle = [0, 1].filter((i) => !game.roundPicks[i]);
    game.log = [idle.length === 2 ? '⌛ Nobody moved in time.' : `⌛ **${game.names[idle[0]]}** ran out of time and forfeits.`];
    await finishMatch(game, idle.length === 1 ? 1 - idle[0] : null);
  },
};

// Rematch button on a finished duel
async function handleRematch(interaction) {
  const gameId = interaction.customId.split(':')[2];
  const data = rematches.get(gameId);
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (!data || Date.now() - data.at > 10 * 60 * 1000) return reply('This rematch offer has expired. Start a new duel!');
  if (!data.players.includes(interaction.user.id)) return reply("You weren't in this duel.");

  data.votes.add(interaction.user.id);
  if (data.votes.size < 2) return reply('🔁 Rematch requested! Waiting for your opponent to press it too.');

  rematches.delete(gameId);
  if (data.players.some(isBusy)) return reply('One of you is already in another game.');
  if (data.players.some((p) => betError(p, data.bet, { allowZero: true }))) return reply('One of you can no longer afford the bet.');

  const game = newGame(data);
  game.message = interaction.message;
  startGame(game);
  await interaction.update(duel.render(game));
}

registerModule('duel', duel);
module.exports = duel;
module.exports.handleRematch = handleRematch;
