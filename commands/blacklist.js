const blacklist = require('../lib/blacklist');
const banNotice = require('../lib/banNotice');
const { logging } = require('../lib/logging');

const ID = /^\d{17,20}$/;
const idOf = (t) => (String(t ?? '').match(/^<@!?(\d{17,20})>$/) ?? String(t ?? '').match(/^(\d{17,20})$/))?.[1] ?? null;

const USAGE = [
  '**Ban:** `!!bl add user <@user | id | username> [reason]` (or reply to their message with `!!bl add user [reason]`)',
  '`!!bl add server <id | "server name" | here> [reason]`',
  '**Unban:** `!!bl remove user|server <id | name>`',
  '**Look up IDs:** `!!bl find <name>` · **See bans:** `!!bl list`',
].join('\n');

// Splits the command into words but keeps "quoted names" together
function tokenize(text) {
  const out = [];
  const re = /["“”]([^"“”]+)["“”]|(\S+)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1] ?? m[2]);
  return out;
}

// People the bot has seen since it last started (exact matches first, then partial)
function searchUsers(client, query) {
  const q = query.toLowerCase().replace(/^@/, '');
  const exact = new Map();
  const partial = new Map();
  const check = (user, names) => {
    const lower = names.filter(Boolean).map((n) => n.toLowerCase());
    if (lower.includes(q)) exact.set(user.id, user);
    else if (lower.some((n) => n.includes(q))) partial.set(user.id, user);
  };
  for (const u of client.users.cache.values()) if (!u.bot) check(u, [u.username, u.globalName]);
  for (const g of client.guilds.cache.values()) {
    for (const m of g.members.cache.values()) if (!m.user.bot) check(m.user, [m.displayName, m.user.username, m.user.globalName]);
  }
  return [...(exact.size ? exact : partial).values()];
}

function searchGuilds(client, query) {
  const q = query.toLowerCase();
  const all = [...client.guilds.cache.values()];
  const exact = all.filter((g) => g.name.toLowerCase() === q);
  return exact.length ? exact : all.filter((g) => g.name.toLowerCase().includes(q));
}

async function resolveUser(message, tokens) {
  const client = message.client;
  const first = tokens[0];

  const id = idOf(first);
  if (id) return { id, name: client.users.cache.get(id)?.username ?? id, rest: tokens.slice(1) };

  // Replying to someone's message bans that message's author
  if (message.reference?.messageId) {
    const ref = await message.fetchReference().catch(() => null);
    if (ref) {
      if (ref.author.bot) return { error: 'That message was sent by a bot.' };
      return { id: ref.author.id, name: ref.author.username, rest: tokens };
    }
  }

  if (!first) return { error: 'Tell me who: a mention, an ID, a username, or reply to one of their messages.' };

  const hits = searchUsers(client, first);
  if (hits.length === 1) return { id: hits[0].id, name: hits[0].username, rest: tokens.slice(1) };
  if (hits.length > 1) {
    const list = hits.slice(0, 8).map((u) => `• ${u.username} (\`${u.id}\`)`).join('\n');
    return { error: `Several people match **${first}**. Use an ID from this list:\n${list}` };
  }
  return { error: `I haven't seen anyone called **${first}**. Try replying to one of their messages instead, or use their ID.` };
}

function resolveGuild(message, tokens) {
  const client = message.client;
  const first = tokens[0];
  if (!first) return { error: 'Tell me which server: an ID, its name (in "quotes" if it has spaces), or `here`.' };

  if (/^(here|this)$/i.test(first)) {
    if (!message.guild) return { error: "You aren't in a server right now." };
    return { id: message.guild.id, name: message.guild.name, rest: tokens.slice(1) };
  }
  if (ID.test(first)) return { id: first, name: client.guilds.cache.get(first)?.name ?? first, rest: tokens.slice(1) };

  const hits = searchGuilds(client, first);
  if (hits.length === 1) return { id: hits[0].id, name: hits[0].name, rest: tokens.slice(1) };
  if (hits.length > 1) {
    const list = hits.slice(0, 8).map((g) => `• ${g.name} (\`${g.id}\`)`).join('\n');
    return { error: `Several servers match **${first}**. Use an ID from this list:\n${list}` };
  }
  return { error: `I'm not in a server called **${first}**.` };
}

// For unbanning: an ID, a mention, or the name saved when they were banned
function resolveBlocked(type, token) {
  const id = idOf(token);
  if (id) return { id };
  const q = String(token ?? '').toLowerCase();
  if (!q) return { error: 'Tell me who to unban (an ID, or a name from `!!bl list`).' };
  const { users, guilds } = blacklist.list();
  const entries = type === 'user' ? users : guilds;
  const hits = entries.filter(([, e]) => String(e.name ?? '').toLowerCase().includes(q));
  if (hits.length === 1) return { id: hits[0][0] };
  if (hits.length > 1) return { error: `Several bans match **${token}**:\n${hits.slice(0, 8).map(([id, e]) => `• ${e.name} (\`${id}\`)`).join('\n')}` };
  return { error: `Nobody on the ${type} ban list matches **${token}**.` };
}

module.exports = {
  name: '!!blacklist',
  aliases: ['!!bl'],
  usage: '!!blacklist <add|remove|find|list> [user|server] [who] [reason]',
  description: 'Owner only. Blocks a user or a whole server from using the bot. Works with IDs, names, mentions, or by replying to a message.',
  access: 'owner',

  async run(message, arg, ctx) {
    if (!ctx.isOwner) return;
    const client = message.client;
    const tokens = tokenize(ctx.rawArg);
    const act = (tokens.shift() ?? 'list').toLowerCase();

    if (act === 'list') {
      const { users, guilds } = blacklist.list();
      const row = ([id, e]) => `${e.name ? `**${e.name}** ` : ''}\`${id}\` — ${e.reason}`;
      const text = [
        `**Blocked users (${users.length})**`,
        users.length ? users.slice(0, 25).map(row).join('\n') : 'None',
        '',
        `**Blocked servers (${guilds.length})**`,
        guilds.length ? guilds.slice(0, 25).map(row).join('\n') : 'None',
      ].join('\n');
      return message.reply(text.slice(0, 1900));
    }

    if (act === 'find') {
      const q = tokens.join(' ').trim();
      if (!q) return message.reply('Usage: `!!bl find <name>`');
      const users = searchUsers(client, q).slice(0, 10);
      const guilds = searchGuilds(client, q).slice(0, 10);
      const text = [
        `**Users matching "${q}"**`,
        users.length ? users.map((u) => `• ${u.username} · \`${u.id}\``).join('\n') : 'None',
        '',
        `**Servers matching "${q}"**`,
        guilds.length ? guilds.map((g) => `• ${g.name} · \`${g.id}\` · ${g.memberCount} members`).join('\n') : 'None',
      ].join('\n');
      return message.reply(text.slice(0, 1900));
    }

    const rawType = (tokens.shift() ?? '').toLowerCase();
    const type = rawType === 'guild' ? 'server' : rawType;
    if (!['add', 'remove'].includes(act) || !['user', 'server'].includes(type)) return message.reply(USAGE);

    // ----- Unban -----
    if (act === 'remove') {
      const found = resolveBlocked(type, tokens[0]);
      if (found.error) return message.reply(found.error);
      const had = type === 'user' ? blacklist.unblockUser(found.id) : blacklist.unblockGuild(found.id);
      if (had) logging('warn', `${type === 'user' ? 'User' : 'Server'} un-blacklisted`, found.id);
      return message.reply(had ? `✅ Removed \`${found.id}\` from the blacklist.` : `\`${found.id}\` wasn't on the blacklist.`);
    }

    // ----- Ban -----
    if (type === 'user') {
      const target = await resolveUser(message, tokens);
      if (target.error) return message.reply(target.error);
      if (target.id === process.env.OWNER_ID || target.id === client.user.id) return message.reply("I won't block the owner or myself.");

      const reason = target.rest.join(' ').slice(0, 200) || 'No reason given';
      blacklist.blockUser(target.id, reason, message.author.id, target.name);
      logging('warn', 'User blacklisted', `${target.name} (${target.id}) · ${reason}`);

      const dmed = await banNotice.dmBannedUser(client, target.id, reason);
      return message.reply(
        `🚫 Blocked **${target.name}** (\`${target.id}\`). ${dmed ? 'I sent them the ban DM.' : "I couldn't DM them (their DMs are closed)."}`
      );
    }

    const target = resolveGuild(message, tokens);
    if (target.error) return message.reply(target.error);

    const reason = target.rest.join(' ').slice(0, 200) || 'No reason given';
    blacklist.blockGuild(target.id, reason, message.author.id, target.name);
    logging('warn', 'Server blacklisted', `${target.name} (${target.id}) · ${reason}`);

    const guild = client.guilds.cache.get(target.id);
    // Reply first, because if this is the server you're in, I can't talk here after leaving
    await message
      .reply(`🚫 Blocked server **${target.name}** (\`${target.id}\`).${guild ? ' I\'m posting the ban notice and leaving now.' : ' I will leave it if I am ever added again.'}`)
      .catch(() => {});
    if (guild) await banNotice.noticeAndLeave(guild, reason);
  },
};
