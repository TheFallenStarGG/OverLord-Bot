const { EmbedBuilder } = require('discord.js');
const { FILES } = require('../config');
const { readJson, writeJson } = require('./storage');
const { logEvent } = require('./world');
const { scoped, writeJson } = require('./storage');

const HOUR = 60 * 60 * 1000;
const SLOTS = 5; // periods planned ahead, including the current one
const LOCKED = 2; // the current and next period are certain; later ones can still change

// fx keys: fishLuck / mineLuck (added to your luck), fishCooldown / mineCooldown (multiply the wait),
// fishMishap (chance a cast is lost), robChance (added to robbery and thief success).
// hours = how long it lasts (min, max). notable ones are announced in the events channel.
const WEATHER = {
  clear: {
    emoji: '☀️', name: 'Clear skies', hours: [2, 4], fx: {},
    desc: 'A calm, pleasant day. Nothing special happens.',
  },
  cloudy: {
    emoji: '⛅', name: 'Overcast', hours: [1, 3], fx: {},
    desc: 'Grey but gentle. Everything works as normal.',
  },
  rain: {
    emoji: '🌧️', name: 'Rain', hours: [1, 3], fx: { fishLuck: 0.3, mineCooldown: 1.15 },
    desc: '🎣 Fish bite better (+30% luck for rare catches).\n⛏️ Mining takes 15% longer.',
  },
  storm: {
    emoji: '⛈️', name: 'Thunderstorm', hours: [1, 2], notable: true,
    fx: { fishLuck: 0.7, fishCooldown: 1.5, fishMishap: 0.15, robChance: -0.08 },
    desc: '🎣 Rare fish surface (+70% luck), but fishing takes 50% longer and 15% of casts are lost to the waves.\n🦹 Thieves stay indoors: robberies are 8% less likely to succeed.',
  },
  fog: {
    emoji: '🌫️', name: 'Thick fog', hours: [1, 3], notable: true,
    fx: { robChance: 0.12, fishLuck: -0.15 },
    desc: '🦹 Perfect cover: robberies are 12% more likely to succeed.\n🎣 Fish are harder to spot (-15% luck).',
  },
  heat: {
    emoji: '🔥', name: 'Heatwave', hours: [1, 3], notable: true,
    fx: { mineCooldown: 1.4, mineLuck: -0.2, robChance: -0.05 },
    desc: '⛏️ Mining takes 40% longer and ore is harder to find (-20% luck).\n🦹 Nobody wants to scheme in this heat: robberies are 5% less likely to succeed.',
  },
  snow: {
    emoji: '❄️', name: 'Snowfall', hours: [1, 3], notable: true,
    fx: { mineLuck: 0.35, fishCooldown: 1.3 },
    desc: '⛏️ Frozen veins crack open (+35% luck for rare ores).\n🎣 Fishing takes 30% longer.',
  },
  rainbow: {
    emoji: '🌈', name: 'Rainbow', hours: [0.5, 1], notable: true,
    fx: { fishLuck: 0.4, mineLuck: 0.4 },
    desc: '✨ Lucky skies! +40% luck for both fishing and mining.',
  },
};

// What can follow what (the numbers are weights)
const NEXT = {
  clear: { clear: 3, cloudy: 4, rain: 1, heat: 1, fog: 1 },
  cloudy: { clear: 3, cloudy: 2, rain: 3, fog: 2, snow: 1 },
  rain: { cloudy: 3, rain: 2, storm: 2, clear: 2, fog: 1, rainbow: 1 },
  storm: { rain: 4, cloudy: 3, clear: 1, rainbow: 1 },
  fog: { cloudy: 3, clear: 3, rain: 1, fog: 1 },
  heat: { clear: 3, cloudy: 2, storm: 2, heat: 1 },
  snow: { cloudy: 3, snow: 2, clear: 2, fog: 1 },
  rainbow: { clear: 4, cloudy: 2 },
};

const data = scoped(FILES.weather, (d) => {
  d.queue ??= []; // [{ id, start, end, locked }]
  d.announced ??= 0; // start time of the last period that was announced
});
const save = () => writeJson(FILES.weather, data);

function pickWeighted(weights) {
  const entries = Object.entries(weights);
  let roll = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [id, w] of entries) {
    roll -= w;
    if (roll < 0) return id;
  }
  return entries[0][0];
}

// A random length in quarter hours
function duration(id) {
  const [min, max] = WEATHER[id].hours;
  return (Math.round((min + Math.random() * (max - min)) * 4) / 4) * HOUR;
}

// Drops periods that are over and plans new ones. The weather depends only on the clock,
// so restarting the bot never changes it.
function ensure() {
  const now = Date.now();
  let changed = false;

  while (data.queue.length && data.queue[0].end <= now) {
    data.queue.shift();
    changed = true;
  }
  while (data.queue.length < SLOTS) {
    const last = data.queue[data.queue.length - 1];
    const prev = last && NEXT[last.id] ? last.id : 'clear';
    const id = pickWeighted(NEXT[prev]);
    const start = last ? last.end : now;
    data.queue.push({ id, start, end: start + duration(id), locked: false });
    changed = true;
  }

  // The first time a period moves into the near window, the forecast sometimes changes
  data.queue.forEach((p, i) => {
    if (i < LOCKED && !p.locked) {
      p.locked = true;
      if (i > 0 && Math.random() < 0.3) p.id = pickWeighted(NEXT[data.queue[i - 1].id] ?? NEXT.clear);
      changed = true;
    }
  });

  if (changed) save();
}

function current() {
  ensure();
  const p = data.queue[0];
  return { id: p.id, def: WEATHER[p.id] ?? WEATHER.clear, start: p.start, until: p.end };
}

// The periods after the current one. sure = false means the forecast may still change.
function forecast() {
  ensure();
  return data.queue.slice(1).map((p) => ({ id: p.id, def: WEATHER[p.id] ?? WEATHER.clear, start: p.start, end: p.end, sure: p.locked }));
}

const weatherMult = (key) => current().def.fx[key] ?? 1;
const weatherBonus = (key) => current().def.fx[key] ?? 0;

// Returns the current weather once, when it has just changed to something worth announcing
function claimAnnouncement() {
  const w = current();
  if (data.announced === w.start) return null;
  data.announced = w.start;
  save();
  if (!w.def.notable || Date.now() - w.start > 10 * 60 * 1000) return null;
  logEvent(`${w.def.emoji} **${w.def.name}** rolled over the realm.`);
  return w;
}

const unix = (ms) => Math.floor(ms / 1000);

function announceEmbed(w) {
  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`${w.def.emoji} ${w.def.name} has arrived`)
    .setDescription(`${w.def.desc}\n\nIt lasts until <t:${unix(w.until)}:t>. See what is next with \`!!forecast\`.`);
}

function forecastEmbed() {
  const now = current();
  const lines = forecast().map(
    (p) => `<t:${unix(p.start)}:t> ${p.def.emoji} **${p.def.name}**${p.sure ? '' : ' _(may change)_'}`
  );
  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`${now.def.emoji} ${now.def.name}`)
    .setDescription(`${now.def.desc}\n\nChanges <t:${unix(now.until)}:R>.`)
    .addFields({ name: '🔭 Forecast', value: lines.join('\n') })
    .setFooter({ text: 'Weather affects !!fish, !!mine, !!rob, hired thieves, and some stocks' });
}

module.exports = { WEATHER, current, forecast, weatherMult, weatherBonus, claimAnnouncement, announceEmbed, forecastEmbed };
