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
const H = 1250;
const M = 48;
const INK = '#1c1914';
const MUTED = '#5c5346';
const RULE = '#2a241c';
const PAPER = '#f4efe4';
const PAPER_PATH = path.join(__dirname, '..', 'assets', 'gazette', 'paper.png');

function cleanMarkdown(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[█░▓▒]/g, '|')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = cleanMarkdown(text).split(' ').filter(Boolean);
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
    lines[maxLines - 1] = last + (last.endsWith('…') ? '' : '…');
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

function framePhoto(ctx, x, y, w, h) {
  ctx.strokeStyle = '#9a9080';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

async function safeImage(src) {
  if (!loadImage || !src) return null;
  try {
    if (Buffer.isBuffer(src)) return await loadImage(src);
    if (typeof src === 'string' && (src.startsWith('http') || fs.existsSync(src))) {
      return await loadImage(src);
    }
  } catch {
    return null;
  }
  return null;
}

function drawCover(ctx, img, x, y, w, h) {
  if (!img) {
    ctx.fillStyle = '#ddd6c8';
    ctx.fillRect(x, y, w, h);
    return;
  }
  const iw = img.width;
  const ih = img.height;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

/**
 * @param {object} edition
 * @param {{ mapImage?: Buffer|null, richestAvatarUrl?: string|null, richestName?: string|null }} media
 */
async function renderGazetteImage(edition, media = {}) {
  if (!createCanvas) return null;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  if (loadImage && fs.existsSync(PAPER_PATH)) {
    try {
      const paper = await loadImage(PAPER_PATH);
      ctx.drawImage(paper, 0, 0, W, H);
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
  ctx.strokeRect(16, 16, W - 32, H - 32);
  ctx.lineWidth = 0.7;
  ctx.strokeRect(20, 20, W - 40, H - 40);

  const date = String(edition.date || '');
  // Sections are already username-resolved by compose()
  const sections = (edition.sections || []).map((s) => ({
    name: cleanMarkdown(String(s.name || '').replace(/^[^\w]+/, '')),
    value: cleanMarkdown(s.value),
  }));
  const editorial = cleanMarkdown(
    edition.editorial || 'The Overlord was too busy ruling to write an editorial today.'
  );

  // Header
  ctx.fillStyle = MUTED;
  ctx.font = '600 11px serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(`ISSUE · ${date.toUpperCase()}`, M, 38);
  ctx.textAlign = 'right';
  ctx.fillText('NEWS', W - M, 38);
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(M, 52);
  ctx.lineTo(W - M, 52);
  ctx.stroke();

  // Masthead
  ctx.fillStyle = INK;
  ctx.font = '700 64px serif';
  ctx.textAlign = 'center';
  ctx.fillText('GAZETTE', W / 2, 98);
  ctx.font = '600 12px serif';
  ctx.fillStyle = MUTED;
  ctx.fillText("THE OVERLORD'S DAILY", W / 2, 136);
  drawDoubleRule(ctx, 156);

  // --- LEAD: text left + richest avatar right ---
  const lead = sections[0] || { name: 'Richest in the realm', value: '' };
  const textColW = 430;
  const photoX = M + textColW + 20;
  const photoW = W - M - photoX;
  const photoH = 260;
  const leadY = 172;

  let y = leadY;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.font = '700 24px serif';
  for (const ln of wrapLines(ctx, lead.name.toUpperCase(), textColW, 3)) {
    ctx.fillText(ln, M, y);
    y += 28;
  }
  y += 4;
  ctx.fillStyle = MUTED;
  ctx.font = '12px serif';
  ctx.fillText(date, M, y);
  y += 20;

  const leadStory = [editorial, lead.value].filter(Boolean).join(' ');
  drawParagraph(ctx, leadStory, M, y, textColW, leadY + photoH + 40 - y, '14px serif', 19, INK);

  // Richest portrait
  const av = await safeImage(media.richestAvatarUrl);
  drawCover(ctx, av, photoX, leadY, photoW, photoH - 36);
  framePhoto(ctx, photoX, leadY, photoW, photoH - 36);
  ctx.fillStyle = INK;
  ctx.font = '600 13px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const richLabel = media.richestName || lead.value.split(' with')[0] || 'Richest';
  ctx.fillText(String(richLabel).slice(0, 28), photoX + photoW / 2, leadY + photoH - 14);

  let row2Y = leadY + photoH + 24;
  drawDoubleRule(ctx, row2Y);
  row2Y += 16;

  // --- ROW 2: campaign map left + second story right ---
  const mapW = 300;
  const mapH = 240;
  const mapImg = await safeImage(media.mapImage);
  drawCover(ctx, mapImg, M, row2Y, mapW, mapH);
  framePhoto(ctx, M, row2Y, mapW, mapH);
  if (!mapImg) {
    ctx.fillStyle = MUTED;
    ctx.font = '12px serif';
    ctx.textAlign = 'center';
    ctx.fillText('Campaign map', M + mapW / 2, row2Y + mapH / 2);
  }

  const sec = sections[1] || sections[2] || { name: 'Realm notes', value: 'A quiet day in the realm.' };
  const secX = M + mapW + 20;
  const secW = W - M - secX;
  let sy = row2Y;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.font = '700 18px serif';
  for (const ln of wrapLines(ctx, sec.name.toUpperCase(), secW, 2)) {
    ctx.fillText(ln, secX, sy);
    sy += 22;
  }
  sy += 4;
  ctx.fillStyle = MUTED;
  ctx.font = '11px serif';
  ctx.fillText(date, secX, sy);
  sy += 18;
  drawParagraph(ctx, sec.value, secX, sy, secW, row2Y + mapH - sy, '13px serif', 17, INK);

  let row3Y = row2Y + mapH + 20;
  drawDoubleRule(ctx, row3Y);
  row3Y += 14;

  // --- Three columns: remaining sections (same coverage as old embed) ---
  const rest = sections.slice(1).filter((s) => s !== sec);
  // Prefer distinct stories: gain, loss, active, headlines, realm state
  const picks = [];
  for (const s of sections) {
    if (s === lead) continue;
    if (picks.length >= 3) break;
    if (!picks.includes(s)) picks.push(s);
  }
  while (picks.length < 3) picks.push({ name: 'Brief', value: '—' });

  const gap = 16;
  const colW = (W - 2 * M - 2 * gap) / 3;
  for (let i = 0; i < 3; i++) {
    const x = M + i * (colW + gap);
    let cy = row3Y;
    ctx.fillStyle = INK;
    ctx.font = '700 13px serif';
    ctx.textAlign = 'left';
    for (const ln of wrapLines(ctx, picks[i].name, colW, 2)) {
      ctx.fillText(ln, x, cy);
      cy += 16;
    }
    cy += 6;
    drawParagraph(ctx, picks[i].value, x, cy, colW, H - 48 - cy, '12px serif', 15, INK);
  }

  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(M, H - 36);
  ctx.lineTo(W - M, H - 36);
  ctx.stroke();
  ctx.font = '11px serif';
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText("The Overlord's Gazette · Daily at 00:05 UTC", W / 2, H - 22);

  return canvas.toBuffer('image/png');
}

module.exports = {
  renderGazetteImage,
  canvasAvailable: () => Boolean(createCanvas),
};
