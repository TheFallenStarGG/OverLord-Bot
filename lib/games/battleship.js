const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { registerModule, endGame, privateReply, settlePvp } = require('./common');
const { fmt } = require('../economy');

// Ships for each board size: [name, length]
const FLEETS = {
  10: [['Carrier', 5], ['Battleship', 4], ['Cruiser', 3], ['Submarine', 3], ['Destroyer', 2]],
  8: [['Battleship', 4], ['Cruiser', 3], ['Submarine', 3], ['Destroyer', 2]],
};

const WATER = '🟦';
const MISS = '⚪';
const HIT = '💥';
const SUNK = '🟥';
const SHIP = '🟩';

// Rows are letters (🇦 🇧 ...) and columns are numbers (1️⃣ 2️⃣ ...)
const letterEmoji = (i) => String.fromCodePoint(0x1f1e6 + i);
const numberEmoji = (i) => (i < 9 ? `${i + 1}\uFE0F\u20E3` : '🔟');

const coordName = (cell, size) => `${String.fromCharCode(65 + Math.floor(cell / size))}${(cell % size) + 1}`;

// "C4" or "4C" -> board position (or null if it isn't on the board)
function parseCoord(text, size) {
  const t = text.trim().toUpperCase().replace(/\s+/g, '');
  let letter;
  let number;
  let m = /^([A-Z])(\d{1,2})$/.exec(t);
  if (m) {
    [, letter, number] = m;
  } else if ((m = /^(\d{1,2})([A-Z])$/.exec(t))) {
    [, number, letter] = m;
  } else {
    return null;
  }
  const row = letter.charCodeAt(0) - 65;
  const col = Number(number) - 1;
  if (row < 0 || row >= size || col < 0 || col >= size) return null;
  return row * size + col;
}

// ---------- Fleets ----------

const newFleet = (size) => ({ ships: FLEETS[size].map(([name, len]) => ({ name, len, cells: [] })) });
const fleetPlaced = (fleet) => fleet.ships.every((s) => s.cells.length === s.len);
const orientation = (ship) => (ship.cells.length > 1 && ship.cells[1] === ship.cells[0] + 1 ? 'H' : 'V');

// shots = a Map of board position -> true (hit) or false (miss)
const isSunk = (ship, shots) => ship.cells.length > 0 && ship.cells.every((c) => shots.get(c) === true);

function shipsLeft(game, defender) {
  const shots = game.shots[1 - defender];
  return game.fleets[defender].ships.filter((s) => !isSunk(s, shots)).length;
}

const fleetDestroyed = (game, defender) => shipsLeft(game, defender) === 0;

// Places every ship at random
function randomFleet(fleet, size) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const used = new Set();
    let ok = true;

    for (const ship of fleet.ships) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const horizontal = Math.random() < 0.5;
        const r = Math.floor(Math.random() * (horizontal ? size : size - ship.len + 1));
        const c = Math.floor(Math.random() * (horizontal ? size - ship.len + 1 : size));
        const cells = Array.from({ length: ship.len }, (_, k) => (horizontal ? r * size + c + k : (r + k) * size + c));
        if (cells.some((x) => used.has(x))) continue;
        cells.forEach((x) => used.add(x));
        ship.cells = cells;
        placed = true;
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return;
  }
}

// "B3 H" -> the squares that ship would cover (or an error message)
function parsePlacement(text, size, ship) {
  const m = /^\s*([a-z])\s*(\d{1,2})\s*([a-z]+)\s*$/i.exec(text);
  if (!m) return { error: `${ship.name}: use a start square and a direction, like \`B3 H\`.` };

  const row = m[1].toUpperCase().charCodeAt(0) - 65;
  const col = Number(m[2]) - 1;
  const dir = m[3][0].toLowerCase();
  const horizontal = dir === 'h' || dir === 'r';
  const vertical = dir === 'v' || dir === 'd';

  if (!horizontal && !vertical) return { error: `${ship.name}: the direction must be H (right) or V (down).` };
  if (row < 0 || row >= size || col < 0 || col >= size) {
    return { error: `${ship.name}: ${m[1].toUpperCase()}${m[2]} is outside the board.` };
  }

  const cells = [];
  for (let k = 0; k < ship.len; k++) {
    const r = row + (vertical ? k : 0);
    const c = col + (horizontal ? k : 0);
    if (r >= size || c >= size) return { error: `${ship.name} doesn't fit there, because it would run off the board.` };
    cells.push(r * size + c);
  }
  return { cells };
}

// ---------- Drawing boards ----------

// The waters of one player. reveal = also show their unhit ships (private view / end of game).
function boardText(game, defender, reveal) {
  const size = game.size;
  const shots = game.shots[1 - defender]; // shots fired at this player
  const shipAt = new Map();
  for (const ship of game.fleets[defender].ships) for (const c of ship.cells) shipAt.set(c, ship);

  const lines = ['⬛' + Array.from({ length: size }, (_, i) => numberEmoji(i)).join('')];
  for (let r = 0; r < size; r++) {
    let line = letterEmoji(r);
    for (let c = 0; c < size; c++) {
      const cell = r * size + c;
      const ship = shipAt.get(cell);
      if (shots.has(cell)) {
        if (!shots.get(cell)) line += MISS;
        else line += isSunk(ship, shots) ? SUNK : HIT;
      } else {
        line += reveal && ship ? SHIP : WATER;
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}

const tag = (game, i) => (game.players[i] === 'bot' ? '🤖 **Bot**' : `<@${game.players[i]}>`);

const title = (game) =>
  `🚢 **Battleship**${game.size ? ` — ${game.size}×${game.size}` : ''}${game.solo ? ' — solo practice' : ''}` +
  `${game.bet ? ` — bet: **${fmt(game.bet)}**` : ''}`;

// ---------- Shooting ----------

function fire(game, attacker, cell) {
  const defender = 1 - attacker;
  const shots = game.shots[attacker];
  const ship = game.fleets[defender].ships.find((s) => s.cells.includes(cell));
  shots.set(cell, Boolean(ship));

  const who = game.names[attacker];
  const label = `**${coordName(cell, game.size)}**`;
  if (!ship) return `${who} fired at ${label}: miss.`;
  if (isSunk(ship, shots)) return `${who} fired at ${label}: 💥 hit and **sunk the ${ship.name}!**`;
  return `${who} fired at ${label}: 💥 hit!`;
}

// The bot hunts in a checkerboard pattern, then finishes off any ship it has found
function botPickCell(game) {
  const size = game.size;
  const shots = game.shots[1]; // the bot's shots at the player
  const sunkCells = new Set(game.fleets[0].ships.filter((s) => isSunk(s, shots)).flatMap((s) => s.cells));
  const liveHits = [...shots].filter(([cell, hit]) => hit && !sunkCells.has(cell)).map(([cell]) => cell);

  const open = (cell) => cell >= 0 && cell < size * size && !shots.has(cell);
  const sameRow = (a, b) => Math.floor(a / size) === Math.floor(b / size);
  const pick = (cells) => cells[Math.floor(Math.random() * cells.length)];

  if (liveHits.length) {
    const candidates = new Set();

    // Two hits next to each other: keep going along that line
    for (const h of liveHits) {
      if (liveHits.includes(h + 1) && sameRow(h, h + 1)) {
        let left = h;
        while (liveHits.includes(left - 1) && sameRow(left, left - 1)) left--;
        let right = h + 1;
        while (liveHits.includes(right + 1) && sameRow(right, right + 1)) right++;
        if (sameRow(left, left - 1) && open(left - 1)) candidates.add(left - 1);
        if (sameRow(right, right + 1) && open(right + 1)) candidates.add(right + 1);
      }
      if (liveHits.includes(h + size)) {
        let top = h;
        while (liveHits.includes(top - size)) top -= size;
        let bottom = h + size;
        while (liveHits.includes(bottom + size)) bottom += size;
        if (open(top - size)) candidates.add(top - size);
        if (open(bottom + size)) candidates.add(bottom + size);
      }
    }

    // Otherwise try the squares around each hit
    if (!candidates.size) {
      for (const h of liveHits) {
        if (sameRow(h, h - 1) && open(h - 1)) candidates.add(h - 1);
        if (sameRow(h, h + 1) && open(h + 1)) candidates.add(h + 1);
        if (open(h - size)) candidates.add(h - size);
        if (open(h + size)) candidates.add(h + size);
      }
    }
    if (candidates.size) return pick([...candidates]);
  }

  const free = Array.from({ length: size * size }, (_, i) => i).filter(open);
  const checkerboard = free.filter((c) => (Math.floor(c / size) + (c % size)) % 2 === 0);
  return pick(checkerboard.length ? checkerboard : free);
}

// ---------- Private fleet panel (setup) ----------

function setupPanel(game, me, note = '') {
  const fleet = game.fleets[me];
  const locked = game.ready[me] || game.phase !== 'setup';

  const lines = [
    '🛠️ **Your fleet** — only you can see this',
    boardText(game, me, true),
    '',
    ...fleet.ships.map((s) =>
      s.cells.length
        ? `✅ ${s.name} (${s.len}) — ${coordName(s.cells[0], game.size)} ${orientation(s)}`
        : `⬜ ${s.name} (${s.len}) — not placed`
    ),
  ];
  if (!locked) {
    lines.push(
      '',
      '-# Press **Place ships** and type each ship\'s first square and direction, like `B3 H`. **H** goes right, **V** goes down. Leave a ship blank to leave it unplaced.'
    );
  }
  if (note) lines.push('', note);
  if (locked) lines.push('', `✅ **Fleet locked in!**${game.phase === 'setup' ? ' Waiting for your opponent…' : ''}`);

  const id = (action) => `game:bs:${game.id}:${action}`;
  const components = locked
    ? []
    : [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(id('place')).setLabel('Place ships').setEmoji('🛠️').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(id('random')).setLabel('Random').setEmoji('🎲').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(id('clear')).setLabel('Clear').setEmoji('🧹').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(id('ready'))
            .setLabel('Ready')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!fleetPlaced(fleet))
        ),
      ];

  return { content: lines.join('\n'), components };
}

function placeModal(game, me) {
  const modal = new ModalBuilder().setCustomId(`game:bs:${game.id}:placeSubmit`).setTitle('Place your ships');

  game.fleets[me].ships.forEach((ship, i) => {
    const input = new TextInputBuilder()
      .setCustomId(`ship${i}`)
      .setLabel(`${ship.name} (${ship.len} squares)`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Start square + H or V, like B3 H')
      .setRequired(false)
      .setMaxLength(12);
    if (ship.cells.length) input.setValue(`${coordName(ship.cells[0], game.size)} ${orientation(ship)}`);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });
  return modal;
}

function fireModal(game) {
  const last = `${String.fromCharCode(64 + game.size)}${game.size}`;
  return new ModalBuilder()
    .setCustomId(`game:bs:${game.id}:fireSubmit`)
    .setTitle('Fire!')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('coord')
          .setLabel('Which square? (like C4)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(`A1 to ${last}`)
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(3)
      )
    );
}

// ---------- Game flow ----------

function makeGame({ players, names, bet, solo, phase }) {
  return {
    type: 'bs',
    players,
    names,
    bet,
    solo,
    phase, // 'prompt' (solo question) -> 'size' -> 'setup' -> 'battle' -> 'over'
    votes: [null, null],
    size: null,
    fleets: [],
    shots: [new Map(), new Map()], // shots[i] = shots fired BY player i
    ready: [false, false],
    turn: 0,
    log: [],
    over: false,
    result: null,
  };
}

function startSetup(game, size) {
  game.size = size;
  game.phase = 'setup';
  game.fleets = [newFleet(size), newFleet(size)];
  if (game.solo) {
    randomFleet(game.fleets[1], size);
    game.ready[1] = true;
  }
}

function startBattle(game) {
  game.phase = 'battle';
  game.turn = Math.random() < 0.5 ? 0 : 1;

  // In a solo game you always shoot next, so if the bot wins the coin toss it fires first
  if (game.solo && game.turn === 1) {
    game.turn = 0;
    game.log.push(`The bot goes first. ${fire(game, 1, botPickCell(game))}`);
  }
}

async function finish(interaction, game, winnerIdx, line) {
  game.phase = 'over';
  game.over = true;
  if (game.solo) {
    game.result = `${line}\n${winnerIdx === 0 ? '🏆 You win! (Solo games are practice, so no coins change hands.)' : '🤖 The bot wins this one. Practice makes perfect!'}`;
  } else {
    game.result = `${line}\n${settlePvp(game, winnerIdx)}`;
  }
  endGame(game);
  return interaction.update(battleship.render(game));
}

const battleship = {
  type: 'bs',

  create(challenge) {
    return makeGame({
      players: [challenge.challenger.id, challenge.opponent.id],
      names: [challenge.challenger.username, challenge.opponent.username],
      bet: challenge.bet,
      solo: false,
      phase: 'size',
    });
  },

  // Used when no opponent is given: asks if you want to play against the bot
  createSolo(user) {
    return makeGame({ players: [user.id, 'bot'], names: [user.username, 'Bot'], bet: 0, solo: true, phase: 'prompt' });
  },

  render(game) {
    const id = (action, extra) => `game:bs:${game.id}:${action}${extra ? `:${extra}` : ''}`;
    const button = (action, label, style, emoji, extra) => {
      const b = new ButtonBuilder().setCustomId(id(action, extra)).setLabel(label).setStyle(style);
      if (emoji) b.setEmoji(emoji);
      return b;
    };
    const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
    const players = `${tag(game, 0)} vs ${tag(game, 1)}`;

    if (game.phase === 'prompt') {
      return {
        content: `${title(game)}\nWant to play a solo practice round against me? No coins are at stake.`,
        components: [
          row(
            button('solo', 'Play solo', ButtonStyle.Success, '🤖'),
            button('cancel', 'Cancel', ButtonStyle.Secondary, '❌')
          ),
        ],
      };
    }

    if (game.phase === 'size') {
      const vote = (i) => (game.votes[i] ? `**${game.votes[i]}×${game.votes[i]}** ✅` : 'not picked yet');
      const lines = [
        title(game),
        players,
        '',
        game.solo ? 'Pick a board size:' : 'Both players pick a board size. The game starts when you choose the same one!',
        ...(game.solo ? [] : [`• ${tag(game, 0)}: ${vote(0)}`, `• ${tag(game, 1)}: ${vote(1)}`]),
      ];
      if (game.votes[0] && game.votes[1] && game.votes[0] !== game.votes[1]) {
        lines.push('', '⚠️ You picked different sizes. Pick the same one to continue!');
      }
      return {
        content: lines.join('\n'),
        components: [
          row(
            button('size', '10×10', ButtonStyle.Primary, null, '10'),
            button('size', '8×8', ButtonStyle.Primary, null, '8'),
            button('cancel', 'Cancel', ButtonStyle.Secondary, '❌')
          ),
        ],
      };
    }

    if (game.phase === 'setup') {
      const status = (i) => (game.ready[i] ? '✅ Ready' : '⏳ Placing ships…');
      return {
        content: [
          title(game),
          players,
          '',
          '**Place your fleet!** Press the button to arrange your ships in private. Nobody else can see them.',
          `• ${tag(game, 0)}: ${status(0)}`,
          `• ${tag(game, 1)}: ${status(1)}`,
        ].join('\n'),
        components: [
          row(
            button('open', 'Set up my fleet', ButtonStyle.Primary, '🛠️'),
            button('cancel', 'Cancel game', ButtonStyle.Secondary, '❌')
          ),
        ],
      };
    }

    if (game.phase === 'battle') {
      const left = (def) => `${shipsLeft(game, def)} ship${shipsLeft(game, def) === 1 ? '' : 's'} left`;
      return {
        content: [
          title(game),
          players,
          '',
          `**${game.names[0]}'s shots** — ${game.names[1]} has ${left(1)}`,
          boardText(game, 1, false),
          '',
          `**${game.names[1]}'s shots** — ${game.names[0]} has ${left(0)}`,
          boardText(game, 0, false),
          '-# 🟦 water · ⚪ miss · 💥 hit · 🟥 sunk ship',
          '',
          ...game.log.slice(-3).map((l) => `> ${l}`),
          '',
          `🎯 ${tag(game, game.turn)}'s turn. Press **Fire** and type a square like \`C4\`.`,
        ].join('\n'),
        components: [
          row(
            button('fire', 'Fire', ButtonStyle.Danger, '🎯'),
            button('fleet', 'My fleet', ButtonStyle.Primary, '🚢'),
            button('forfeit', 'Forfeit', ButtonStyle.Secondary, '🏳️')
          ),
        ],
      };
    }

    // Game over: reveal both fleets
    return {
      content: [
        title(game),
        players,
        '',
        `**${game.names[0]}'s fleet**`,
        boardText(game, 0, true),
        '',
        `**${game.names[1]}'s fleet**`,
        boardText(game, 1, true),
        '-# 🟩 unhit ship · 💥 hit · 🟥 sunk · ⚪ miss',
        '',
        ...game.log.slice(-2).map((l) => `> ${l}`),
        '',
        game.result,
      ].join('\n'),
      components: [],
    };
  },

  async handleButton(interaction, game, action, arg) {
    const me = game.players.indexOf(interaction.user.id);
    if (me === -1) return privateReply(interaction, "You're not in this game.");

    const phase = game.phase;
    const myName = game.names[me];

    // Cancel (before the battle starts)
    if (action === 'cancel' && ['prompt', 'size', 'setup'].includes(phase)) {
      game.over = true;
      endGame(game);
      return interaction.update({ content: `🚫 **${myName}** cancelled the game.`, components: [] });
    }

    // Solo question
    if (action === 'solo' && phase === 'prompt') {
      game.phase = 'size';
      return interaction.update(battleship.render(game));
    }

    // Board size votes
    if (action === 'size' && phase === 'size') {
      game.votes[me] = Number(arg);
      if (game.solo) game.votes[1] = game.votes[0];

      if (game.votes[0] && game.votes[0] === game.votes[1]) startSetup(game, game.votes[0]);
      return interaction.update(battleship.render(game));
    }

    // Setup: open your private fleet panel
    if (action === 'open' && phase === 'setup') {
      return interaction.reply({ ...setupPanel(game, me), flags: MessageFlags.Ephemeral });
    }

    // Setup actions (only before you're ready)
    if (['place', 'random', 'clear', 'ready', 'placeSubmit'].includes(action)) {
      if (phase !== 'setup') return privateReply(interaction, 'Ship placement is over.');
      if (game.ready[me]) return privateReply(interaction, 'Your fleet is already locked in.');
      const fleet = game.fleets[me];

      // Works whether this came from a button or from the pop-up form
      const respond = (payload) =>
        interaction.isFromMessage?.() || interaction.isButton()
          ? interaction.update(payload)
          : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });

      if (action === 'place') return interaction.showModal(placeModal(game, me));

      if (action === 'random') {
        randomFleet(fleet, game.size);
        return respond(setupPanel(game, me));
      }

      if (action === 'clear') {
        fleet.ships.forEach((s) => (s.cells = []));
        return respond(setupPanel(game, me));
      }

      if (action === 'placeSubmit') {
        const errors = [];
        const used = new Map(); // square -> ship name
        const placements = fleet.ships.map((ship, i) => {
          const text = interaction.fields.getTextInputValue(`ship${i}`).trim();
          if (!text) return [];

          const result = parsePlacement(text, game.size, ship);
          if (result.error) {
            errors.push(`❌ ${result.error}`);
            return [];
          }
          const clash = result.cells.find((c) => used.has(c));
          if (clash !== undefined) {
            errors.push(`❌ ${ship.name} overlaps the ${used.get(clash)}.`);
            return [];
          }
          result.cells.forEach((c) => used.set(c, ship.name));
          return result.cells;
        });

        // If anything was wrong, nothing changes and you're told why
        if (errors.length) return respond(setupPanel(game, me, `**Nothing was changed:**\n${errors.join('\n')}`));

        fleet.ships.forEach((s, i) => (s.cells = placements[i]));
        return respond(setupPanel(game, me));
      }

      if (action === 'ready') {
        if (!fleetPlaced(fleet)) return respond(setupPanel(game, me, '⚠️ Place every ship first.'));

        game.ready[me] = true;
        if (game.ready[0] && game.ready[1]) startBattle(game);

        await interaction.update(setupPanel(game, me));
        await game.message?.edit(battleship.render(game)).catch(() => {});
        return;
      }
    }

    // Battle
    if (phase === 'battle') {
      if (action === 'fleet') {
        return privateReply(
          interaction,
          `🚢 **Your fleet** (${shipsLeft(game, me)} ship${shipsLeft(game, me) === 1 ? '' : 's'} left)\n` +
            `${boardText(game, me, true)}\n-# 🟩 your ship · 💥 hit · 🟥 sunk · ⚪ enemy miss · 🟦 water`
        );
      }

      if (action === 'forfeit') {
        return finish(interaction, game, 1 - me, `🏳️ **${myName}** forfeited!`);
      }

      if (action === 'fire') {
        if (me !== game.turn) return privateReply(interaction, "It's not your turn!");
        return interaction.showModal(fireModal(game));
      }

      if (action === 'fireSubmit') {
        if (me !== game.turn) return privateReply(interaction, "It's not your turn anymore!");

        const cell = parseCoord(interaction.fields.getTextInputValue('coord'), game.size);
        if (cell === null) {
          return privateReply(interaction, `That isn't a square on the board. Use a letter and number like \`C4\` (A1 to ${String.fromCharCode(64 + game.size)}${game.size}).`);
        }
        if (game.shots[me].has(cell)) {
          return privateReply(interaction, `You already fired at **${coordName(cell, game.size)}**. Pick another square!`);
        }

        game.log.push(fire(game, me, cell));
        if (fleetDestroyed(game, 1 - me)) {
          return finish(interaction, game, me, `🎉 **${myName}** sank the whole fleet!`);
        }

        if (game.solo) {
          game.log.push(fire(game, 1, botPickCell(game)));
          if (fleetDestroyed(game, 0)) return finish(interaction, game, 1, '🤖 The bot sank your whole fleet!');
        } else {
          game.turn = 1 - me;
        }
        return interaction.update(battleship.render(game));
      }
    }

    return privateReply(interaction, "You can't do that right now.");
  },

  async onExpire(game) {
    if (game.phase === 'battle') {
      // Whoever's turn it was forfeits (in solo games that's always you)
      const idle = game.solo ? 0 : game.turn;
      game.phase = 'over';
      game.over = true;
      const line = `⌛ **${game.names[idle]}** ran out of time and forfeits.`;
      game.result = game.solo ? `${line}\n🤖 The bot wins this one.` : `${line}\n${settlePvp(game, 1 - idle)}`;
      await game.message?.edit(battleship.render(game)).catch(() => {});
      return;
    }

    // Timed out before the battle: nothing was at stake
    await game.message
      ?.edit({ content: '⌛ The Battleship game timed out. No coins changed hands.', components: [] })
      .catch(() => {});
  },
};

registerModule('bs', battleship);
module.exports = battleship;
