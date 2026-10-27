const fs = require('fs');
const path = require('path');

let createCanvas = null;
let loadImage = null;
try {
  const c = require('@napi-rs/canvas');
  createCanvas = c.createCanvas;
  loadImage = c.loadImage;
} catch {
  createCanvas = null;
}

const W = 900;
const H = 1100;
const M = 44;
const INK = '#1c1914';
const MUTED = '#5c5346';
const RULE = '#2a241c';
const PAPER = '#f4efe4';
const PAPER_PATH = path.join(__dirname, '..', 'assets', 'gazette', 'paper.png');

function clean(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[🪙💰]/g, ' coins')
    .replace(/[█░▓]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrap(ctx, text, maxW, maxLines) {
  const words = clean(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW) line = t;
    else {
      if (line) lines.push(line);
      line = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1] || '';
    while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

function rule(ctx, y) {
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(M, y);
  ctx.lineTo(W - M, y);
  ctx.stroke();
}

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
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function block(ctx, text, x, y, maxW, maxH, font, lh, color) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lines = wrap(ctx, text, maxW, Math.max(1, Math.floor(maxH / lh)));
  let cy = y;
  for (const ln of lines) {
    ctx.fillText(ln, x, cy);
    cy += lh;
  }
  return cy;
}

async function renderGazetteImage(edition, media = {}) {
  if (!createCanvas) return null;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  if (fs.existsSync(PAPER_PATH)) {
    try {
      ctx.drawImage(await loadImage(PAPER_PATH), 0, 0, W, H);
    } catch {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, W, H);
    }
  } else {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.strokeStyle = RULE;
  ctx.lineWidth = 2;
  ctx.strokeRect(14, 14, W - 28, H - 28);

  const date = clean(edition.date || '');
  const sections = (edition.sections || []).map((s) => ({
    name: clean(String(s.name || '').replace(/^[^\w]+/, '')),
    value: clean(s.value),
  }));
  const editorial = clean(edition.editorial || 'No editorial today.');

  // Header
  ctx.fillStyle = MUTED;
  ctx.font = '600 11px serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('ISSUE · ' + date.toUpperCase(), M, 34);
  ctx.textAlign = 'right';
  ctx.fillText('NEWS', W - M, 34);
  rule(ctx, 48);

  ctx.fillStyle = INK;
  ctx.font = '700 56px serif';
  ctx.textAlign = 'center';
  ctx.fillText('GAZETTE', W / 2, 88);
  ctx.font = '600 12px serif';
  ctx.fillStyle = MUTED;
  ctx.fillText("THE OVERLORD'S DAILY", W / 2, 118);
  rule(ctx, 132);

  // Lead + avatar
  const lead = sections[0] || { name: 'Richest in the realm', value: '' };
  const avW = 200;
  const avH = 200;
  const avX = W - M - avW;
  const textW = avX - M - 16;
  let y = 148;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.font = '700 22px serif';
  for (const ln of wrap(ctx, lead.name.toUpperCase(), textW, 2)) {
    ctx.fillText(ln, M, y);
    y += 26;
  }
  ctx.fillStyle = MUTED;
  ctx.font = '11px serif';
  ctx.fillText(date, M, y);
  y += 16;
  const leadText = [editorial, lead.value].filter(Boolean).join(' ');
  block(ctx, leadText, M, y, textW, 148 + avH - y - 8, '13px serif', 17, INK);

  const av = await img(media.richestAvatarUrl);
  cover(ctx, av, avX, 148, avW, avH - 28);
  ctx.fillStyle = INK;
  ctx.font = '600 12px serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(media.richestName || 'Richest').slice(0, 22), avX + avW / 2, 148 + avH - 10);

  y = 148 + avH + 12;
  rule(ctx, y);
  y += 12;

  // Map + next story side by side
  const mapW = 280;
  const mapH = 200;
  const mapBuf = await img(media.mapImage);
  cover(ctx, mapBuf, M, y, mapW, mapH);

  const side = sections.find((s, i) => i > 0) || { name: 'Notes', value: 'Quiet day.' };
  const sx = M + mapW + 16;
  const sw = W - M - sx;
  let sy = y;
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = '700 16px serif';
  for (const ln of wrap(ctx, side.name.toUpperCase(), sw, 2)) {
    ctx.fillText(ln, sx, sy);
    sy += 20;
  }
  sy += 4;
  block(ctx, side.value, sx, sy, sw, y + mapH - sy, '12px serif', 16, INK);

  y += mapH + 12;
  rule(ctx, y);
  y += 10;

  // Remaining sections in a tight grid (no giant empty footer)
  const used = new Set([lead, side]);
  const rest = sections.filter((s) => !used.has(s));
  while (rest.length < 3) rest.push({ name: '—', value: '' });
  const cols = rest.slice(0, 3);
  const gap = 14;
  const cw = (W - 2 * M - 2 * gap) / 3;
  const colH = H - 40 - y;

  for (let i = 0; i < 3; i++) {
    const x = M + i * (cw + gap);
    let cy = y;
    ctx.fillStyle = INK;
    ctx.font = '700 12px serif';
    ctx.textAlign = 'left';
    for (const ln of wrap(ctx, cols[i].name, cw, 2)) {
      ctx.fillText(ln, x, cy);
      cy += 15;
    }
    cy += 4;
    block(ctx, cols[i].value || '—', x, cy, cw, colH - (cy - y), '11px serif', 14, INK);
  }

  ctx.font = '10px serif';
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  ctx.fillText("The Overlord's Gazette · 00:05 UTC", W / 2, H - 22);

  return canvas.toBuffer('image/png');
}

module.exports = {
  renderGazetteImage,
  canvasAvailable: () => Boolean(createCanvas),
};
