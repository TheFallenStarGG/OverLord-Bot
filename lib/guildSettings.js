const { PermissionFlagsBits } = require('discord.js');
const storage = require('./storage');
const blacklist = require('./blacklist');
const access = require('./commandAccess');
const settings = require('./serverSettings');

// Applies a server's settings from the website dashboard. Same options as the !!settings command.
// The bot checks Manage Server itself, so the website can never grant permission on its own.

const ID = /^\d{17,20}$/;
const NEED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
const MAX_IGNORED = 50;
const MAX_GAMES = 10;

// Text channels and categories can both carry a rule
const isRuleable = (c) => Boolean(c && (c.type === 4 || (c.isTextBased() && !c.isThread())));

function textTarget(guild, id, label) {
  const c = guild.channels.cache.get(String(id));
  if (!c || !c.isTextBased() || c.isThread()) throw new Error(`${label}: pick a text channel`);
  const perms = c.permissionsFor(guild.members.me);
  if (!perms?.has(NEED)) throw new Error(`${label}: I need View Channel, Send Messages and Embed Links in #${c.name}`);
  return c;
}

async function apply(client, commands, guildId, userId, changes) {
  if (!ID.test(String(guildId)) || !ID.test(String(userId))) throw new Error('Bad request');
  if (blacklist.isUserBlocked(userId) || blacklist.isGuildBlocked(guildId)) throw new Error('You or that server are blocked from using the bot');

  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error("I'm not in that server");
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new Error("You're not in that server");
  if (guild.ownerId !== userId && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error('You need the Manage Server permission in that server');
  }
  if (!changes || typeof changes !== 'object') throw new Error('Nothing to change');

  // Check everything first, so a bad value never leaves a half-saved change
  const ops = [];

  const bool = (key, label, fn) => {
    if (typeof changes[key] !== 'boolean') return;
    ops.push({ run: () => { fn(changes[key]); return `${label} ${changes[key] ? 'on' : 'off'}`; } });
  };
  bool('gambling', 'Gambling', settings.setGambling);
  bool('rob', 'Robbing', settings.setRob);
  bool('website', 'Website listing', settings.setWebsiteOn);

  const channelSettings = [
    ['events', 'Events channel', (c) => settings.setChannel(guildId, c.id), () => settings.clearChannel(guildId)],
    ['levels', 'Level-ups channel', (c) => settings.setLevelChannelId(c.id), () => settings.setLevelChannelId(null)],
  ];
  for (const [key, label, set, clearIt] of channelSettings) {
    if (!(key in changes)) continue;
    if (changes[key] === null) {
      ops.push({ run: () => { clearIt(); return `${label} off`; } });
      continue;
    }
    const c = textTarget(guild, changes[key], label);
    ops.push({ run: () => { set(c); return `${label} → #${c.name}`; } });
  }

  if ('board' in changes) {
    const board = require('./realmBoard');
    if (changes.board === null) {
      ops.push({ run: () => { board.clearBoardChannel(); return 'Realm board off'; } });
    } else {
      const c = textTarget(guild, changes.board, 'Realm board');
      ops.push({
        run: async () => {
          board.setBoardChannel(c.id);
          const r = await board.refreshBoard(client);
          return r.ok ? `Realm board → #${c.name}` : `Realm board saved, but I couldn't post yet (${r.reason})`;
        },
      });
    }
  }

  if (changes.commands && typeof changes.commands === 'object') {
    const picks = [];
    for (const [name, on] of Object.entries(changes.commands)) {
      if (typeof on !== 'boolean') throw new Error('Bad command list');
      const cmd = commands.get('!!' + String(name).toLowerCase());
      if (!cmd || cmd.access !== 'free') throw new Error(`There is no command called !!${name}`);
      if (access.isProtected(cmd)) throw new Error(`!!${name} can't be turned off, so you can always manage the bot`);
      picks.push([cmd, on]);
    }
    if (picks.length) {
      ops.push({
        run: () => {
          for (const [cmd, on] of picks) access.setCommandEnabled(cmd, on);
          return `${picks.length} command${picks.length === 1 ? '' : 's'} updated`;
        },
      });
    }
  }

  if (Array.isArray(changes.ignored)) {
    if (changes.ignored.length > MAX_IGNORED) throw new Error(`You can ignore up to ${MAX_IGNORED} channels`);
    const chans = changes.ignored.map((id) => {
      const c = guild.channels.cache.get(String(id));
      if (!isRuleable(c)) throw new Error("One of the ignored channels doesn't exist anymore");
      return c;
    });
    ops.push({
      run: () => {
        const want = new Set(chans.map((c) => c.id));
        access.pruneMissing(guild);
        for (const id of access.ignoredChannels()) if (!want.has(id)) access.setChannelIgnored(id, false);
        for (const id of want) access.setChannelIgnored(id, true);
        return `${want.size} ignored channel${want.size === 1 ? '' : 's'}`;
      },
    });
  }

  if (Array.isArray(changes.games)) {
    if (changes.games.length > MAX_GAMES) throw new Error(`You can pick up to ${MAX_GAMES} games channels`);
    const chans = changes.games.map((id) => {
      const c = guild.channels.cache.get(String(id));
      if (!isRuleable(c)) throw new Error("One of the games channels doesn't exist anymore");
      return c;
    });
    ops.push({
      run: () => {
        access.clearGameChannels();
        for (const c of chans) access.addGameChannel(c.id);
        return chans.length ? `Games only in ${chans.length} channel${chans.length === 1 ? '' : 's'}` : 'Games work everywhere';
      },
    });
  }

  if (!ops.length) return 'Nothing to change';

  const lines = await storage.runIn(guildId, async () => {
    const out = [];
    for (const op of ops) out.push(await op.run());
    return out;
  });
  await storage.flush(); // write to the database now so the dashboard shows the new values
  return lines.join(' · ');
}

module.exports = { apply };
