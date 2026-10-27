const fs = require('fs');
const path = require('path');

let createCanvas = null;
let loadImage = null;
let GlobalFonts = null;
try {
  const c = require('@napi-rs/canvas');
  createCanvas = c.createCanvas;
  loadImage = c.loadImage;
  GlobalFonts = c.GlobalFonts;
} catch {
  createCanvas = null;
}

// Every font file in assets/fonts/ is registered and used as a fallback for characters the main font lacks
const FALLBACKS = [];
try {
  const dir = path.join(__dirname, '..', 'assets', 'fonts');
  if (GlobalFonts && fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).sort()) {
      if (!/\.(ttf|otf|ttc)$/i.test(f)) continue;
      const alias = `GzFallback${FALLBACKS.length}`;
      if (GlobalFonts.registerFromPath(path.join(dir, f), alias)) FALLBACKS.push(alias);
    }
    console.log(`Gazette fonts loaded: ${FALLBACKS.length}`);
  }
} catch (err) {
  console.log('Gazette fonts failed to load:', err.message || err);
}

const W = 900;
const MAX_H = 2400;
const M = 40;
const CW = W - 2 * M;
const GAP = 26;
const INK = '#1c1914';
const MUTED = '#5c5346';
const RULE = '#2a241c';
const PAPER = '#f4efe4';
const GREEN = '#2f6b2f';
const RED = '#8b2a1f';
const F = 'serif';
const PAPER_PATH = path.join(__dirname, '..', 'assets', 'gazette', 'paper.png');

const STACK = [F, ...FALLBACKS.map((n) => `"${n}"`)].join(', ');
const font = (weight, size, italic = false) => `${italic ? 'italic ' : ''}${weight} ${size}px ${STACK}`;

// ---- Box detection: draws a character and checks whether it came out as a missing-glyph box ----
let probeCtx = null;
let tofu = null;
const glyphCache = new Map();

function inkOf(ch) {
  probeCtx.clearRect(0, 0, 40, 40);
  probeCtx.font = `24px ${STACK}`;
  probeCtx.fillStyle = '#000';
  probeCtx.textBaseline = 'top';
  probeCtx.fillText(ch, 4, 4);
  const d = probeCtx.getImageData(0, 0, 40, 40).data;
  let ink = 0;
  let hash = 0;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i]) {
      ink++;
      hash = (Math.imul(hash, 31) + i + d[i]) | 0;
    }
  }
  return { ink, key: `${ink}:${hash}` };
}

function glyphOk(ch) {
  if (glyphCache.has(ch)) return glyphCache.get(ch);
  let ok = true;
  try {
    if (!probeCtx) {
      probeCtx = createCanvas(40, 40).getContext('2d');
      tofu = inkOf('\u{10FFFD}'); // an unassigned character, so it always draws the missing-glyph box
    }
    const { ink, key } = inkOf(ch);
    const blankIsFine = /[\p{Z}\p{Cc}\p{Cf}\p{M}]/u.test(ch);
    ok = (ink > 0 || blankIsFine) && !(tofu.ink > 0 && key === tofu.key);
  } catch {
    ok = true;
  }
  glyphCache.set(ch, ok);
  return ok;
}

// Keeps characters that can be drawn, swaps the rest for a plain-letter equivalent (NFKC), or drops them
function fixGlyphs(text) {
  if (!/[^\x00-\x7F]/.test(text)) return text;
  let out = '';
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128 || glyphOk(ch)) {
      out += ch;
      continue;
    }
    const alt = ch.normalize('NFKC');
    if (alt !== ch && [...alt].every((c) => c.charCodeAt(0) < 128 || glyphOk(c))) out += alt;
  }
  if (!/[\p{L}\p{N}]/u.test(out) && /[\p{L}\p{N}]/u.test(text)) return '?';
  return out;
}
const num = (n) => Number(n || 0).toLocaleString('en-US');

// Turns any bot text into plain, printable text (no mentions, emoji, markdown or raw IDs)
function clean(text) {
  const t = String(text ?? '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/<t:\d+(?::[a-zA-Z])?>/g, '')
    .replace(/<@&\d+>/g, 'a role')
    .replace(/<#\d+>/g, 'a channel')
    .replace(/<@!?\d+>/g, 'someone')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s*[🪙💰]\uFE0F?/gu, ' coins')
    .replace(/[█░▓▒]/g, '')
    .replace(/\u2212/g, '-')
    .replace(/[\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}\uFFFD]/gu, '')
    .replace(/\p{M}{3,}/gu, (m) => [...m].slice(0, 2).join(''))
    .replace(/\b\d{15,}\b/g, 'someone')
    .replace(/\b(coins)(\s+coins)+\b/gi, '$1');
  return fixGlyphs(t).replace(/\s+/g, ' ').trim();
}

function wrapAll(ctx, text, maxW) {
  const words = clean(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (let word of words) {
    while (ctx.measureText(word).width > maxW) {
      let cut = word.length - 1;
      while (cut > 1 && ctx.measureText(word.slice(0, cut)).width > maxW) cut--;
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width <= maxW) line = t;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function ellipsize(ctx, text, maxW) {
  let t = text;
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.replace(/\s+$/, '') + '…';
}

// Draws (or just measures) a wrapped paragraph. Returns its height.
function para(ctx, text, x, y, w, o, draw) {
  ctx.font = o.font;
  let lines = wrapAll(ctx, text, w);
  if (o.max && lines.length > o.max) {
    lines = lines.slice(0, o.max);
    let last = lines[o.max - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > w) last = last.slice(0, -1);
    lines[o.max - 1] = last.replace(/[\s.,;:]+$/, '') + '…';
  }
  if (draw) {
    ctx.fillStyle = o.color || INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * o.lh));
  }
  return lines.length * o.lh;
}

function rule(ctx, y, x1 = M, x2 = W - M, width = 1.25) {
  ctx.strokeStyle = RULE;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

const dbl = (ctx, y) => {
  rule(ctx, y, M, W - M, 2);
  rule(ctx, y + 4, M, W - M, 0.75);
};

async function img(src) {
  if (!loadImage || !src) return null;
  try {
    return await loadImage(src);
  } catch {
    return null;
  }
}

function cover(ctx, image, x, y, w, h) {
  if (!image) {
    ctx.fillStyle = '#e0d8c8';
    ctx.fillRect(x, y, w, h);
    return;
  }
  const s = Math.max(w / image.width, h / image.height);
  const sw = w / s;
  const sh = h / s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
  ctx.restore();
  ctx.strokeStyle = '#9a9080';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function heading(ctx, title, x, y, w, draw) {
  if (draw) {
    ctx.font = font(700, 13);
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(clean(title).toUpperCase(), x, y);
    rule(ctx, y + 19, x, x + w, 1);
  }
  return 28;
}

// rows: [{ left, right?, color?, sub? }]
function drawRows(ctx, rows, x, y, w, draw) {
  let h = 0;
  for (const r of rows) {
    const right = clean(r.right || '');
    ctx.font = font(700, 12);
    const rw = right ? ctx.measureText(right).width + 10 : 0;
    ctx.font = font(400, 13);
    const left = ellipsize(ctx, clean(r.left), w - rw);
    if (draw) {
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillStyle = INK;
      ctx.font = font(400, 13);
      ctx.fillText(left, x, y + h);
      if (right) {
        ctx.textAlign = 'right';
        ctx.font = font(700, 12);
        ctx.fillStyle = r.color || INK;
        ctx.fillText(right, x + w, y + h + 1);
        ctx.textAlign = 'left';
      }
    }
    h += 18;
    if (r.sub) h += para(ctx, r.sub, x, y + h - 2, w, { font: font(400, 11, true), lh: 14, color: MUTED, max: 2 }, draw) + 3;
  }
  return h;
}

const listBox = (title, rows, empty) => (ctx, x, y, w, draw) => {
  let h = heading(ctx, title, x, y, w, draw);
  if (!rows.length) return h + para(ctx, empty, x, y + h, w, { font: font(400, 12, true), lh: 16, color: MUTED }, draw);
  return h + drawRows(ctx, rows, x, y + h, w, draw) + 2;
};

const textBox = (title, items, empty, bullets = false) => (ctx, x, y, w, draw) => {
  let h = heading(ctx, title, x, y, w, draw);
  if (!items.length) return h + para(ctx, empty, x, y + h, w, { font: font(400, 12, true), lh: 16, color: MUTED }, draw);
  for (const t of items) {
    h += para(ctx, (bullets ? '• ' : '') + t, x, y + h, w, { font: font(400, 13), lh: 17, color: INK }, draw) + 6;
  }
  return h;
};

function realmBox(e) {
  const r = e.realm || {};
  const rows = [];
  rows.push(['Throne', r.throne ? `${r.throne}${r.throneUntil ? ' (until ' + r.throneUntil + ')' : ''}` : 'Empty. Fill the Rebellion meter to bring the Overlord back.']);
  rows.push(['Bounty', r.bounty ? `${r.bounty.name} is marked for ${num(r.bounty.reward)} coins` : 'None right now']);
  rows.push(['Rebellion', null]);
  if (r.effects?.length) rows.push(['In effect', r.effects.join(', ')]);
  if (e.campaign) rows.push(['Campaign', `This server holds ${e.campaign.held} of ${e.campaign.total} provinces (turn ${e.campaign.turn}).`]);
  return (ctx, x, y, w, draw) => {
    let h = heading(ctx, 'State of the realm', x, y, w, draw);
    const LW = 84;
    for (const [label, value] of rows) {
      if (draw) {
        ctx.font = font(700, 12);
        ctx.fillStyle = INK;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(label, x, y + h + 1);
      }
      if (label === 'Rebellion') {
        if (r.raid) {
          h += para(ctx, 'The Overlord walks among us!', x + LW, y + h, w - LW, { font: font(700, 13), lh: 17, color: RED }, draw) + 6;
        } else {
          const pct = Math.max(0, Math.min(100, r.rebellionPct ?? 0));
          const bw = Math.min(160, w - LW - 56);
          if (draw) {
            ctx.strokeStyle = RULE;
            ctx.lineWidth = 1;
            ctx.strokeRect(x + LW + 0.5, y + h + 2.5, bw, 11);
            ctx.fillStyle = INK;
            ctx.fillRect(x + LW + 2, y + h + 4, Math.max(0, (bw - 3) * (pct / 100)), 8);
            ctx.font = font(600, 12);
            ctx.textAlign = 'left';
            ctx.fillText(`${pct}%`, x + LW + bw + 8, y + h + 1);
          }
          h += 22;
        }
      } else {
        h += para(ctx, value, x + LW, y + h, w - LW, { font: font(400, 13), lh: 17, color: INK }, draw) + 6;
      }
    }
    return h;
  };
}

function weatherBox(wx) {
  return (ctx, x, y, w, draw) => {
    let h = heading(ctx, 'Weather desk', x, y, w, draw);
    if (draw) {
      ctx.font = font(700, 16);
      ctx.fillStyle = INK;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(clean(wx.name), x, y + h);
    }
    h += 22;
    h += para(ctx, wx.desc || '', x, y + h, w, { font: font(400, 12, true), lh: 16, color: MUTED }, draw) + 6;
    const rows = (wx.next || []).map((n) => ({ left: 'Then ' + n.name, right: n.at }));
    if (rows.length) h += drawRows(ctx, rows, x, y + h, w, draw);
    return h;
  };
}

function headlinesBlock(items) {
  return (ctx, x, y, w, draw) => {
    const h = heading(ctx, 'Headlines from the realm', x, y, w, draw);
    if (!items.length) {
      return h + para(ctx, 'A quiet day in the realm. The Overlord is not amused.', x, y + h, w, { font: font(400, 13, true), lh: 17, color: MUTED }, draw);
    }
    const half = Math.ceil(items.length / 2);
    const colW = (w - 24) / 2;
    const run = (list, cx) => {
      let ch = 0;
      for (const t of list) ch += para(ctx, '• ' + t, cx, y + h + ch, colW, { font: font(400, 12.5), lh: 16, color: INK, max: 3 }, draw) + 5;
      return ch;
    };
    const a = run(items.slice(0, half), x);
    const b = run(items.slice(half), x + colW + 24);
    return h + Math.max(a, b);
  };
}

function columns(n) {
  const w = (CW - (n - 1) * GAP) / n;
  return Array.from({ length: n }, (_, i) => ({ x: M + i * (w + GAP), w }));
}

// Measures every column first, so they all end up the same height, then draws them with dividers
function row(ctx, y, defs) {
  const h = Math.max(...defs.map((d) => d.fn(ctx, d.x, y, d.w, false)));
  defs.forEach((d, i) => {
    d.fn(ctx, d.x, y, d.w, true);
    if (i > 0) {
      ctx.strokeStyle = RULE;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(d.x - GAP / 2, y);
      ctx.lineTo(d.x - GAP / 2, y + h);
      ctx.stroke();
    }
  });
  return h;
}

const cols = (ctx, y, fns) => row(ctx, y, columns(fns.length).map((c, i) => ({ ...c, fn: fns[i] })));

function strip(ctx, y, cells) {
  const h = 56;
  const cw = CW / cells.length;
  cells.forEach(([value, label], i) => {
    const cx = M + i * cw + cw / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = font(700, 26);
    ctx.fillStyle = INK;
    ctx.fillText(String(value), cx, y + 2);
    ctx.font = font(600, 10);
    ctx.fillStyle = MUTED;
    ctx.fillText(label.toUpperCase(), cx, y + 37);
    if (i > 0) {
      ctx.strokeStyle = RULE;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(M + i * cw, y + 4);
      ctx.lineTo(M + i * cw, y + h - 4);
      ctx.stroke();
    }
  });
  return h;
}

async function renderGazetteImage(edition, media = {}) {
  if (!createCanvas) return null;
  const e = edition || {};
  const tmp = createCanvas(W, MAX_H);
  const ctx = tmp.getContext('2d');
  const date = clean(e.date || '');
  let y = 22;
  const next = (h) => {
    y += h + 8;
    rule(ctx, y);
    y += 11;
  };

  // ---- Masthead ----
  ctx.font = font(600, 11);
  ctx.fillStyle = MUTED;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(`ISSUE${e.issue ? ' NO. ' + e.issue : ''} · ${date.toUpperCase()}`, M, y);
  ctx.textAlign = 'right';
  ctx.fillText('PRICE: ONE COIN', W - M, y);
  y += 20;
  rule(ctx, y);
  y += 10;
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.font = font(700, 64);
  ctx.fillText('GAZETTE', W / 2, y);
  y += 74;
  ctx.font = font(600, 12);
  ctx.fillStyle = MUTED;
  ctx.fillText("THE OVERLORD'S DAILY", W / 2, y);
  y += 22;
  dbl(ctx, y);
  y += 18;

  // ---- Lead story (+ avatar of the richest player) ----
  const av = media.richestAvatarUrl ? await img(media.richestAvatarUrl) : null;
  const AV = 190;
  const leadW = av ? CW - AV - 20 : CW;
  const first = (e.sections || [])[0];
  const leadTitle = clean(String(first?.name || 'Richest in the realm').replace(/^[^\p{L}\p{N}]+/u, '')).toUpperCase();
  const body = clean(e.editorial || first?.value || 'Nothing on the wire today.');
  ctx.font = font(700, 24);
  const titleLines = wrapAll(ctx, leadTitle, leadW);
  let textH = titleLines.length * 28 + 20;
  textH += para(ctx, body, M, 0, leadW, { font: font(400, 14), lh: 20, color: INK }, false);
  const blockH = Math.max(textH, av ? AV + 24 : 0);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.font = font(700, 24);
  let ty = y;
  for (const ln of titleLines) {
    ctx.fillText(ln, M, ty);
    ty += 28;
  }
  ctx.font = font(400, 11, true);
  ctx.fillStyle = MUTED;
  ctx.fillText(date, M, ty);
  ty += 20;
  para(ctx, body, M, ty, leadW, { font: font(400, 14), lh: 20, color: INK }, true);
  if (av) {
    cover(ctx, av, W - M - AV, y, AV, AV);
    ctx.font = font(600, 12);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.fillText(ellipsize(ctx, clean(media.richestName || 'Richest'), AV), W - M - AV / 2, y + AV + 6);
  }
  next(blockH);

  // ---- By the numbers ----
  const cells = [];
  if (e.numbers) {
    cells.push([num(e.numbers.players), 'Mortals in the realm']);
    cells.push([num(e.numbers.coins), 'Coins in circulation']);
    if (e.numbers.topLevel) cells.push([String(e.numbers.topLevel), 'Highest level']);
  }
  if (e.campaign) cells.push([`${e.campaign.held}/${e.campaign.total}`, 'Provinces held']);
  else if (e.realm && !e.realm.raid) cells.push([`${e.realm.rebellionPct ?? 0}%`, 'Rebellion']);
  if (cells.length >= 2) next(strip(ctx, y, cells));

  // ---- Map + state of the realm ----
  const mapImg = media.mapImage ? await img(media.mapImage) : null;
  const realm = realmBox(e);
  if (mapImg) {
    const mapW = 300;
    const realmW = CW - mapW - GAP;
    const mapH = Math.max(200, Math.min(290, realm(ctx, 0, 0, realmW, false)));
    const mapFn = (c, x, yy, w, draw) => {
      if (draw) cover(c, mapImg, x, yy, w, mapH);
      return mapH;
    };
    next(row(ctx, y, [{ x: M, w: mapW, fn: mapFn }, { x: M + mapW + GAP, w: realmW, fn: realm }]));
  } else {
    next(row(ctx, y, [{ x: M, w: CW, fn: realm }]));
  }

  // ---- Rich list + market ----
  const pair = [];
  if (e.rich?.length) {
    pair.push(listBox('The rich list', e.rich.map((r, i) => ({ left: `${i + 1}. ${r.name}`, right: `${num(r.coins)} coins` })), ''));
  }
  if (e.market) {
    const rows = [];
    for (const s of e.market.up || []) rows.push({ left: s.name, right: `+${(s.pct * 100).toFixed(1)}%`, color: GREEN, sub: `now ${num(s.price)} coins` });
    for (const s of e.market.down || []) rows.push({ left: s.name, right: `${(s.pct * 100).toFixed(1)}%`, color: RED, sub: `now ${num(s.price)} coins` });
    const newsLine = (e.market.news || []).map(clean).filter(Boolean)[0];
    if (newsLine) rows.push({ left: 'Wire', sub: newsLine });
    pair.push(listBox('Market report', rows, 'The exchange is closed. No trades reported.'));
  }
  if (pair.length) next(cols(ctx, y, pair));

  // ---- Weather + scoreboard + season ----
  const trio = [];
  if (e.weather) trio.push(weatherBox(e.weather));
  if (e.daily || e.rich) {
    const d = e.daily || {};
    const rows = [];
    if (d.gain) rows.push({ left: d.gain.name, sub: `Biggest gain · +${num(d.gain.delta)} coins`, color: GREEN });
    if (d.loss) rows.push({ left: d.loss.name, sub: `Biggest loss · -${num(d.loss.delta)} coins`, color: RED });
    if (d.active) rows.push({ left: d.active.name, sub: `Most active · +${num(d.active.xp)} XP` });
    trio.push(listBox('Daily scoreboard', rows, 'Daily tallies start with tomorrow\'s edition.'));
  }
  const sw = [];
  if (e.season) {
    sw.push(`Season ${e.season.number} ends in ${e.season.days} day${e.season.days === 1 ? '' : 's'}.`);
    if (e.season.leaders?.length) sw.push('Leading: ' + e.season.leaders.map((l) => `${l.name} (${num(l.score)})`).join(', '));
  }
  if (e.war) sw.push(`Server War: ${num(e.war.score)} points from ${e.war.players} player${e.war.players === 1 ? '' : 's'}${e.war.wins ? `, ${e.war.wins} past win${e.war.wins === 1 ? '' : 's'}` : ''}.`);
  if (sw.length) trio.push(textBox('Season and war', sw, ''));
  if (trio.length) next(cols(ctx, y, trio));

  // ---- Headlines ----
  const heads = (e.headlines || []).map(clean).filter(Boolean).slice(0, 8);
  if (e.numbers || heads.length) next(row(ctx, y, [{ x: M, w: CW, fn: headlinesBlock(heads) }]));

  // ---- Older editions that were saved before the new layout: print their sections ----
  if (!e.numbers && (e.sections || []).length > 1) {
    const rest = e.sections.slice(1, 4).map((s) => textBox(clean(s.name), [clean(s.value)], ''));
    next(cols(ctx, y, rest));
  }

  // ---- Classifieds, decree, tip ----
  const tail = [];
  if (e.classifieds?.length) tail.push(textBox('Classifieds', e.classifieds, '', true));
  if (e.quote) tail.push(textBox('Decree of the day', [e.quote], ''));
  if (e.tip) tail.push(textBox('Overlord\'s tip', [e.tip], ''));
  if (tail.length) y += cols(ctx, y, tail) + 10;

  // ---- Footer ----
  rule(ctx, y);
  y += 8;
  ctx.font = font(400, 10);
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`The Overlord's Gazette · Printed daily at 00:05 UTC${e.issue ? ' · Issue ' + e.issue : ''}`, W / 2, y);
  y += 30;

  // ---- Final page: paper, double border, content ----
  const H = Math.min(MAX_H, Math.ceil(y));
  const out = createCanvas(W, H);
  const o = out.getContext('2d');
  let painted = false;
  if (fs.existsSync(PAPER_PATH)) {
    try {
      o.drawImage(await loadImage(PAPER_PATH), 0, 0, W, H);
      painted = true;
    } catch {
      painted = false;
    }
  }
  if (!painted) {
    o.fillStyle = PAPER;
    o.fillRect(0, 0, W, H);
  }
  o.strokeStyle = RULE;
  o.lineWidth = 2;
  o.strokeRect(12, 12, W - 24, H - 24);
  o.lineWidth = 0.75;
  o.strokeRect(17, 17, W - 34, H - 34);
  o.drawImage(tmp, 0, 0, W, H, 0, 0, W, H);
  return out.toBuffer('image/png');
}

module.exports = {
  renderGazetteImage,
  canvasAvailable: () => Boolean(createCanvas),
};
