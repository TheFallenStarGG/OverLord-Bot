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
const H = 1200;
const M = 52;
const INK = '#1c1914';
const MUTED = '#5c5346';
const RULE = '#2a241c';
const PAPER = '#f4efe4';
const PAPER_PATH = path.join(__dirname, '..', 'assets', 'gazette', 'paper.png');

/** Strip Discord / markdown so the page never shows <@id>, **, or tofu boxes */
function clean(text) {
  return String(text || '')
    .replace(/<@!?\d+>/g, 'someone')
    .replace(/<@&\d+>/g, 'a role')
    .replace(/<#\d+>/g, 'a channel')
    .replace(/<t:\d+:[a-zA-Z]>/g, '')
    .replace(/<a?:\w+:\d+>/g, '') // custom emoji
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') // many unicode emoji
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[█░▓▒]/g, '')
    .replace(/[🪙💰👑🎯🔥🌍📰📈💎]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(text) {
  return clean(text)
    .replace(/^[^A-Za-z0-9]+/, '')
    .trim() || 'News';
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = clean(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) line = test;
    else {
      if (line) lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.length) {
    let last = lines[maxLines - 1] || '';
    while (last.length && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

function drawDoubleRule(ctx, y) {
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(M, y);
  ctx.lineTo(W - M, y);
  ctx.stroke();
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(M, y + 3);
  ctx.lineTo(W - M, y + 3);
  ctx.stroke();
}

function drawParagraph(ctx, text, x, y, maxW, maxH, font, lh, color) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const maxLines = Math.max(1, Math.floor(maxH / lh));
  const lines = wrapLines(ctx, text, maxW, maxLines);
  let cy = y;
  for (const ln of lines) {
    ctx.fillText(ln, x, cy);
    cy += lh;
  }
  return cy;
}

/**
 * Layout (no empty photo cubes — text only, like a dense front page):
 *
 *  ISSUE · DATE                    NEWS
 *  ============== GAZETTE ==============
 *  LEAD HEADLINE (full width)
 *  lead body...
 *  ------------------------------------
 *  | col story 1 | col story 2 |
 *  ------------------------------------
 *  | brief | brief | brief |
 */
async function renderGazetteImage(edition) {
  if (!createCanvas) return null;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  if (loadImage && fs.existsSync(PAPER_PATH)) {
    try {
      const img = await loadImage(PAPER_PATH);
      ctx.drawImage(img, 0, 0, W, H);
    } catch {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, W, H);
    }
  } else {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
  }

  // Frame
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, W - 36, H - 36);
  ctx.lineWidth = 0.7;
  ctx.strokeRect(22, 22, W - 44, H - 44);

  const date = clean(edition.date || '');
  const sections = (edition.sections || []).map((s) => ({
    name: cleanTitle(s.name),
    value: clean(s.value),
  }));
  const editorial = clean(
    edition.editorial || 'The Overlord had nothing worth printing today.'
  );

  // Header
  ctx.fillStyle = MUTED;
  ctx.font = '600 11px serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(`ISSUE · ${date.toUpperCase() || 'TODAY'}`, M, 40);
  ctx.textAlign = 'right';
  ctx.fillText('NEWS', W - M, 40);

  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(M, 54);
  ctx.lineTo(W - M, 54);
  ctx.stroke();

  // Masthead
  ctx.fillStyle = INK;
  ctx.font = '700 68px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GAZETTE', W / 2, 100);
  ctx.font = '600 13px serif';
  ctx.fillStyle = MUTED;
  ctx.fillText("THE OVERLORD'S DAILY", W / 2, 142);

  drawDoubleRule(ctx, 162);

  // Lead — full width, no grey box
  const lead = sections[0] || { name: 'Realm report', value: '' };
  const leadTitle = lead.name.toUpperCase();
  const leadBody = [editorial, lead.value].filter(Boolean).join(' ');

  let y = 180;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.font = '700 28px serif';
  for (const ln of wrapLines(ctx, leadTitle, W - 2 * M, 3)) {
    ctx.fillText(ln, M, y);
    y += 32;
  }
  y += 4;
  ctx.fillStyle = MUTED;
  ctx.font = '12px serif';
  ctx.fillText(date, M, y);
  y += 22;
  y = drawParagraph(ctx, leadBody, M, y, W - 2 * M, 200, '15px serif', 21, INK);

  y = Math.max(y + 16, 420);
  drawDoubleRule(ctx, y);
  y += 18;

  // Two feature columns (no photos)
  const half = (W - 2 * M - 28) / 2;
  const feat = [sections[1], sections[2]].map(
    (s, i) => s || { name: i === 0 ? 'Markets' : 'Activity', value: 'Quiet day.' }
  );
  const featBottom = y + 210;

  for (let i = 0; i < 2; i++) {
    const x = M + i * (half + 28);
    let cy = y;
    ctx.fillStyle = INK;
    ctx.font = '700 18px serif';
    ctx.textAlign = 'left';
    for (const ln of wrapLines(ctx, feat[i].name.toUpperCase(), half, 2)) {
      ctx.fillText(ln, x, cy);
      cy += 22;
    }
    cy += 4;
    ctx.fillStyle = MUTED;
    ctx.font = '11px serif';
    ctx.fillText(date, x, cy);
    cy += 18;
    drawParagraph(ctx, feat[i].value, x, cy, half, featBottom - cy, '13px serif', 18, INK);
  }

  y = featBottom + 12;
  drawDoubleRule(ctx, y);
  y += 16;

  // Three briefs
  const gap = 18;
  const colW = (W - 2 * M - 2 * gap) / 3;
  const briefs = [sections[3], sections[4], sections[5] || sections[0]].map(
    (s, i) => s || { name: 'Brief', value: '—' }
  );

  for (let i = 0; i < 3; i++) {
    const x = M + i * (colW + gap);
    let cy = y;
    ctx.fillStyle = INK;
    ctx.font = '700 14px serif';
    for (const ln of wrapLines(ctx, briefs[i].name, colW, 2)) {
      ctx.fillText(ln, x, cy);
      cy += 18;
    }
    cy += 6;
    drawParagraph(ctx, briefs[i].value, x, cy, colW, H - 50 - cy, '12px serif', 16, INK);
  }

  // Footer
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(M, H - 38);
  ctx.lineTo(W - M, H - 38);
  ctx.stroke();
  ctx.font = '11px serif';
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText("The Overlord's Gazette · Daily at 00:05 UTC", W / 2, H - 24);

  return canvas.toBuffer('image/png');
}

module.exports = {
  renderGazetteImage,
  clean,
  canvasAvailable: () => Boolean(createCanvas),
};
