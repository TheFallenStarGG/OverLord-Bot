const { PermissionFlagsBits } = require('discord.js');
const { data, saveNow } = require('./world');
const { currentGuild } = require('./storage');

const MAX_IGNORED = 50;
const MAX_GAME_CHANNELS = 10;

// These can never be turned off, so an admin can't lock themselves out of setup
const PROTECTED = new Set(['settings', 'help', 'tutorial', 'deletedata', 'invite', 'support']);

// Commands that count as "games" for the games-channel rule
const GAME_COMMANDS = new Set([
  'tictactoe', 'connect4', 'battleship', 'blackjack', 'minesweeper', 'wordle', 'slots', 'gamble',
  'heist', 'crash', 'roulette', 'higherlower', 'hangman', 'liarsdice', 'duel', 'lottery',
]);

const shortName = (command) => String(command?.name ?? command).replace(/^!!/, '').toLowerCase();

// Saved per server inside the world data, next to the other server settings
function rules() {
  const s = (data.settings ??= {});
  s.disabledCommands ??= {};
  s.disabledChannels ??= {};
  s.gameChannels ??= [];
  return s;
}

// A channel, its category, or (for threads) its parent channel can all carry a rule
const chain = (channel) => [channel?.id, channel?.parentId, channel?.parent?.parentId].filter(Boolean);

// ---------- Commands ----------

const isProtected = (command) => PROTECTED.has(shortName(command));

function isDisabled(command) {
  if (!currentGuild()) return false; // DMs have no server rules
  const name = shortName(command);
  return !PROTECTED.has(name) && Boolean(rules().disabledCommands[name]);
}

function setCommandEnabled(command, on) {
  const key = shortName(command);
  if (on) delete rules().disabledCommands[key];
  else rules().disabledCommands[key] = true;
  saveNow();
}

const disabledCommands = () => Object.keys(rules().disabledCommands);

// ---------- Ignored channels ----------

function isChannelIgnored(channel) {
  if (!currentGuild() || !channel) return false;
  const ignored = rules().disabledChannels;
  return chain(channel).some((id) => ignored[id]);
}

// Returns false if the list is full
function setChannelIgnored(id, on) {
  const ignored = rules().disabledChannels;
  if (on) {
    if (!ignored[id] && Object.keys(ignored).length >= MAX_IGNORED) return false;
    ignored[id] = true;
  } else {
    delete ignored[id];
  }
  saveNow();
  return true;
}

const ignoredChannels = () => Object.keys(rules().disabledChannels);

// ---------- Games-only channels ----------

const gameChannels = () => [...rules().gameChannels];

// Returns false if the list is full
function addGameChannel(id) {
  const list = rules().gameChannels;
  if (list.includes(id)) return true;
  if (list.length >= MAX_GAME_CHANNELS) return false;
  list.push(id);
  saveNow();
  return true;
}

function removeGameChannel(id) {
  const s = rules();
  s.gameChannels = s.gameChannels.filter((c) => c !== id);
  saveNow();
}

function clearGameChannels() {
  rules().gameChannels = [];
  saveNow();
}

// Drops channels that no longer exist (deleted channels or categories)
function pruneMissing(guild) {
  const s = rules();
  let changed = false;
  for (const id of Object.keys(s.disabledChannels)) {
    if (!guild.channels.cache.has(id)) {
      delete s.disabledChannels[id];
      changed = true;
    }
  }
  const kept = s.gameChannels.filter((id) => guild.channels.cache.has(id));
  if (kept.length !== s.gameChannels.length) {
    s.gameChannels = kept;
    changed = true;
  }
  if (changed) saveNow();
}

// ---------- The check used before every command ----------

/**
 * Returns { ok: true } or { ok: false, reply } (reply is null when the bot should stay silent).
 * The bot owner is never limited. Admins (Manage Server) skip the channel rules so they can always
 * test and fix things, but a turned-off command is off for them too until they turn it back on.
 */
function check(message, command, isOwner) {
  if (isOwner || !message.guild) return { ok: true };

  const name = shortName(command);
  const s = rules();

  if (!PROTECTED.has(name) && s.disabledCommands[name]) {
    return { ok: false, reply: `🚫 \`!!${name}\` is turned off in this server.` };
  }

  const isAdmin = Boolean(message.member?.permissions?.has(PermissionFlagsBits.ManageGuild));
  if (isAdmin) return { ok: true };

  const channel = message.channel ?? { id: message.channelId };
  const ids = chain(channel);

  if (ids.some((id) => s.disabledChannels[id])) return { ok: false, reply: null };

  if (GAME_COMMANDS.has(name) && s.gameChannels.length && !ids.some((id) => s.gameChannels.includes(id))) {
    return { ok: false, reply: `🎮 Games only work in ${s.gameChannels.map((id) => `<#${id}>`).join(', ')}.` };
  }

  return { ok: true };
}

module.exports = {
  isProtected,
  isDisabled,
  setCommandEnabled,
  disabledCommands,
  isChannelIgnored,
  setChannelIgnored,
  ignoredChannels,
  gameChannels,
  addGameChannel,
  removeGameChannel,
  clearGameChannels,
  pruneMissing,
  check,
};
