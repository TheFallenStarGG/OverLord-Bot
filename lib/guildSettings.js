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

  // ----- Custom shop titles (dashboard) -----
  if (changes.titleUpsert && typeof changes.titleUpsert === 'object') {
    const t = changes.titleUpsert;
    const name = String(t.name || '').trim().slice(0, 64);
    const price = Math.floor(Number(t.price));
    const emoji = String(t.emoji || '🏷️').trim().slice(0, 32) || '🏷️';
    const desc = String(t.desc || '').trim().slice(0, 200);
    let id = String(t.id || '').trim().slice(0, 48);
    if (!name) throw new Error('Title needs a name');
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) throw new Error('Bad title price');
    if (!id) {
      id =
        'title_custom_' +
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')
          .slice(0, 40);
    }
    if (!/^title_custom_[a-z0-9_]{1,40}$/.test(id)) throw new Error('Bad title id');

    let roleId = t.roleId == null || t.roleId === '' ? null : String(t.roleId);
    if (roleId) {
      if (!ID.test(roleId)) throw new Error('Bad title role');
      const role = guild.roles.cache.get(roleId);
      if (!role) throw new Error('That title role no longer exists');
      if (role.managed || role.id === guild.id) throw new Error("Can't link that role to a title");
      const me = guild.members.me ?? (await guild.members.fetchMe());
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw new Error('I need Manage Roles to link roles to titles');
      }
      if (role.position >= me.roles.highest.position) {
        throw new Error('Title role must be below my highest role');
      }
    }

    ops.push({
      run: () => {
        settings.setCustomTitle(id, {
          name,
          emoji,
          price,
          roleId,
          desc:
            desc ||
            (roleId
              ? 'Server title. Buying it equips the name and grants the linked role.'
              : 'Server title shown on !!rank.'),
        });
        return `Title **${name}** saved (\`${id}\`)`;
      },
    });
  }

  if (typeof changes.titleRemove === 'string' && changes.titleRemove) {
    const id = String(changes.titleRemove).trim();
    ops.push({
      run: () => {
        const existing = settings.getCustomTitles()[id];
        if (!existing) throw new Error('No custom title with that id');
        settings.removeCustomTitle(id);
        return `Removed title **${existing.name}**`;
      },
    });
  }

  // ----- Reaction role panels (dashboard) -----
  if (changes.rrDelete && typeof changes.rrDelete === 'string') {
    const messageId = String(changes.rrDelete).trim();
    if (!ID.test(messageId)) throw new Error('Bad panel id');
    ops.push({
      run: async () => {
        const rr = require('./reactionRoles');
        const panel = rr.getPanel(messageId);
        if (!panel) throw new Error('No panel with that id');
        const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
        const msg =
          channel?.isTextBased() ? await channel.messages.fetch(messageId).catch(() => null) : null;
        rr.deletePanel(messageId);
        if (msg) await msg.delete().catch(() => {});
        return 'Role panel deleted';
      },
    });
  }

  if (changes.rrPublish && typeof changes.rrPublish === 'object') {
    const p = changes.rrPublish;
    const mode = String(p.mode || '');
    const rr = require('./reactionRoles');
    if (!rr.MODES.includes(mode)) throw new Error('Mode must be buttons, dropdown, or reactions');
    const channel = textTarget(guild, p.channelId, 'Role panel channel');
    const title = String(p.title || 'Pick your roles').trim().slice(0, 100);
    const description = String(p.description || '').trim().slice(0, 1000);
    const exclusive = Boolean(p.exclusive);
    const color = Number.isFinite(Number(p.color)) ? Number(p.color) : 0x5865f2;
    const rolesIn = Array.isArray(p.roles) ? p.roles : [];
    if (!rolesIn.length) throw new Error('Add at least one role');
    if (rolesIn.length > (rr.MAX_ROLES[mode] || 20)) {
      throw new Error(`Too many roles for ${mode} mode`);
    }

    const roles = [];
    for (const row of rolesIn) {
      const roleId = String(row.roleId || '');
      if (!ID.test(roleId)) throw new Error('Bad role on panel');
      const role = guild.roles.cache.get(roleId);
      if (!role) throw new Error('A panel role no longer exists');
      const problem = await rr.roleProblem(guild, role);
      if (problem) throw new Error(`Can't use @${role.name}: ${problem}`);
      const userProb = rr.userRoleProblem(member, role);
      if (userProb) throw new Error(`Can't use @${role.name}: ${userProb}`);
      let emoji = String(row.emoji || '').trim();
      if (mode === 'reactions' && !emoji) throw new Error('Reaction mode needs an emoji per role');
      if (!emoji) emoji = '🔘';
      roles.push({
        roleId,
        emoji,
        description: String(row.description || role.name).trim().slice(0, 80),
      });
    }

    ops.push({
      run: async () => {
        const message = await rr.publishPanel(
          guild,
          channel,
          { mode, exclusive, title, description, color, roles },
          userId
        );
        return `Role panel posted in #${channel.name}`;
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
