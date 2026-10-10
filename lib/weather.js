const { EmbedBuilder } = require('discord.js');
const { FILES } = require('../config');
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
    emoji: '☀️', name: 'Clear skies', hours: [4, 8], fx: {},
    desc: 'Calm and bright. Nothing special — for now.',
    notable: false,
  },
  cloudy: {
    emoji: '⛅', name: 'Overcast', hours: [3, 7], fx: {},
    desc: 'Grey ceiling. Business as usual.',
    notable: false,
  },
  rain: {
    emoji: '🌧️', name: 'Rain', hours: [3, 6],
    fx: { fishLuck: 0.3, fishCooldown: 1.15 },
    desc: 'Good fishing weather, slightly slower casts.',
    notable: true,
  },
  thunderstorm: {
    emoji: '⛈️', name: 'Thunderstorm', hours: [2, 5],
    fx: { fishLuck: 0.5, fishMishap: 0.08, mineCooldown: 1.2 },
    desc: 'Dangerous seas, great rare fish. Mining is sluggish.',
    notable: true,
  },
  fog: {
    emoji: '🌫️', name: 'Fog', hours: [3, 6],
    fx: { robChance: 0.12 },
    desc: 'Perfect cover. Robberies and hired thieves succeed more often.',
    notable: true,
  },
  heatwave: {
    emoji: '🔥', name: 'Heatwave', hours: [3, 6],
    fx: { mineLuck: -0.15, mineCooldown: 1.25, fishCooldown: 1.1 },
    desc: 'The ground bakes. Mining is harder and slower.',
    notable: true,
  },
  snow: {
    emoji: '❄️', name: 'Snow', hours: [3, 7],
    fx: { fishCooldown: 1.2, mineCooldown: 1.2, robChance: -0.05 },
    desc: 'Everything takes longer. Even thieves move carefully.',
    notable: true,
  },
  // NEW
  bloodmoon: {
    emoji: '🩸', name: 'Blood Moon', hours: [2, 4],
    fx: { robChance: 0.18, fishLuck: 0.2, mineLuck: 0.2 },
    desc: 'The sky turns red. Crime and rare finds both rise.',
    notable: true,
  },
  aurora: {
    emoji: '🌌', name: 'Aurora', hours: [2, 5],
    fx: { fishLuck: 0.45, mineLuck: 0.45 },
    desc: 'Lights in the sky. Extraordinary luck for gatherers.',
    notable: true,
  },
  sandstorm: {
    emoji: '🏜️', name: 'Sandstorm', hours: [2, 5],
    fx: { mineLuck: 0.35, fishLuck: -0.1, fishCooldown: 1.25 },
    desc: 'Ores uncover in the grit. Fishing suffers.',
    notable: true,
  },
  monsoon: {
    emoji: '🌊', name: 'Monsoon', hours: [3, 6],
    fx: { fishLuck: 0.55, fishMishap: 0.12, robChance: 0.05 },
    desc: 'Floods bring monsters of the deep — and wash out roads for thieves.',
    notable: true,
  },
  eclipse: {
    emoji: '🌑', name: 'Eclipse', hours: [1, 3],
    fx: { robChance: 0.2, mineLuck: 0.25, fishLuck: 0.25 },
    desc: 'A rare darkening. Short, chaotic, and very profitable if you move fast.',
    notable: true,
  },
  rainbow: {
    emoji: '🌈', name: 'Rainbow', hours: [1, 3],
    fx: { fishLuck: 0.4, mineLuck: 0.4 },
    desc: 'Lucky skies! +40% luck for fishing and mining.',
    notable: true,
  },
};

// What can follow what (the numbers are weights)
const NEXT = {
  clear: { clear: 2, cloudy: 3, rain: 2, fog: 1, heatwave: 1, rainbow: 1, aurora: 1 },
  cloudy: { clear: 2, cloudy: 2, rain: 3, thunderstorm: 1, fog: 2, snow: 1 },
  rain: { cloudy: 2, rain: 2, thunderstorm: 2, monsoon: 1, clear: 1, fog: 1 },
  thunderstorm: { rain: 3, cloudy: 2, clear: 1, monsoon: 1 },
  fog: { cloudy: 2, fog: 2, clear: 1, rain: 1, bloodmoon: 1 },
  heatwave: { clear: 2, heatwave: 2, cloudy: 2, sandstorm: 2 },
  snow: { cloudy: 3, snow: 2, clear: 1, fog: 1 },
  bloodmoon: { fog: 2, clear: 2, eclipse: 1, cloudy: 1 },
  aurora: { clear: 3, cloudy: 2, snow: 1, rainbow: 1 },
  sandstorm: { heatwave: 2, clear: 2, cloudy: 2, sandstorm: 1 },
  monsoon: { rain: 3, thunderstorm: 2, cloudy: 2 },
  eclipse: { bloodmoon: 1, clear: 2, fog: 2, cloudy: 1 },
  rainbow: { clear: 4, cloudy: 2, rain: 1 },
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
