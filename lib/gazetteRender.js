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
const M = 48; // outer margin
const INK = '#1a1a1a';
const MUTED = '#444444';
const RULE = '#222222';
const PHOTO = '#d0d0d0';
const PAPER = '#f7f4ec';

const PAPER_PATH = path.join(__dirname, '..', 'assets', 'gazette', 'paper.png');

/** Fixed slots — do not freehand these; everything is measured from these boxes. */
const LAYOUT = {
  issueY: 36,
  mastheadY: 70,
  mastheadH: 88,
  rule1Y: 168,
  // Lead row
  leadX: M,
  leadY: 180,
  leadW: 420,
  leadH: 320,
  leadPhotoX: M + 420 + 24,
  leadPhotoY: 180,
  leadPhotoW: W - M - (M + 420 + 24),
  leadPhotoH: 280,
  rule2Y: 520,
  // Second row
  secPhotoX: M,
  secPhotoY: 536,
  secPhotoW: 280,
  secPhotoH: 220,
  secX: M + 280 + 24,
  secY: 536,
  secW: W - M - (M + 280 + 24),
  secH: 220,
  rule3Y: 776,
  // Three columns
  colY: 792,
  colH: 360,
  colGap: 20,
};

function colWidth() {
  const inner = W - 2 * M;
  return (inner - 2 * LAYOUT.colGap) / 3;
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxWidth && last.length > 0) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

function drawRuledLine(ctx, y) {
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(M, y);
  ctx.lineTo(W - M, y);
  ctx.stroke();
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(M, y + 3);
  ctx.lineTo(W - M, y + 3);
  ctx.stroke();
}

function drawPhotoBox(ctx, x, y, w, h) {
  ctx.fillStyle = PHOTO;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#b0b0b0';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function fillTextBlock(ctx, text, x, y, w, h, font, lineHeight, color) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const maxLines = Math.max(1, Math.floor(h / lineHeight));
  const lines = wrapLines(ctx, text, w, maxLines);
  let cy = y;
  for (const ln of lines) {
    ctx.fillText(ln, x, cy);
    cy += lineHeight;
  }
  return cy;
}

/**
 * @param {object} edition - { date, editorial, sections: [{ name, value }] }
 * @returns {Promise<Buffer|null>}
 */
async function renderGazetteImage(edition) {
  if (!createCanvas) return null;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  // Background
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

  // Outer double border (like the mockup frame)
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, W - 40, H - 40);
  ctx.lineWidth = 0.75;
  ctx.strokeRect(24, 24, W - 48, H - 48);

  const date = edition.date || '';
  const sections = edition.sections || [];
  const editorial =
    edition.editorial ||
    'The Overlord was too busy ruling to write an editorial today.';

  // --- ISSUE line ---
  ctx.fillStyle = MUTED;
  ctx.font = '600 11px serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`ISSUE · ${String(date).toUpperCase()}`, M, LAYOUT.issueY);
  ctx.textAlign = 'right';
  ctx.fillText('NEWS', W - M, LAYOUT.issueY);

  // thin rules under issue
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(M, LAYOUT.issueY + 16);
  ctx.lineTo(W - M, LAYOUT.issueY + 16);
  ctx.stroke();

  // --- MASTHEAD ---
  ctx.fillStyle = INK;
  ctx.font = '700 72px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GAZETTE', W / 2, LAYOUT.mastheadY + LAYOUT.mastheadH / 2 - 4);

  ctx.font = '600 14px serif';
  ctx.fillStyle = MUTED;
  ctx.fillText("THE OVERLORD'S DAILY", W / 2, LAYOUT.mastheadY + LAYOUT.mastheadH - 8);

  drawRuledLine(ctx, LAYOUT.rule1Y);

  // --- LEAD (left text, right photo) ---
  const leadTitle = sections[0]?.name?.replace(/^[^\w]+/, '').trim() || 'Front page';
  const leadBody = [editorial, sections[0]?.value].filter(Boolean).join(' · ');

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.font = '700 26px serif';
  const titleLines = wrapLines(ctx, leadTitle.toUpperCase(), LAYOUT.leadW, 3);
  let ty = LAYOUT.leadY;
  for (const ln of titleLines) {
    ctx.fillText(ln, LAYOUT.leadX, ty);
    ty += 30;
  }
  ty += 6;
  ctx.fillStyle = MUTED;
  ctx.font = '12px serif';
  ctx.fillText(date, LAYOUT.leadX, ty);
  ty += 22;
  fillTextBlock(
    ctx,
    leadBody,
    LAYOUT.leadX,
    ty,
    LAYOUT.leadW,
    LAYOUT.leadY + LAYOUT.leadH - ty,
    '15px serif',
    20,
    INK
  );

  drawPhotoBox(ctx, LAYOUT.leadPhotoX, LAYOUT.leadPhotoY, LAYOUT.leadPhotoW, LAYOUT.leadPhotoH);

  drawRuledLine(ctx, LAYOUT.rule2Y);

  // --- SECOND ROW (photo left, story right) ---
  drawPhotoBox(ctx, LAYOUT.secPhotoX, LAYOUT.secPhotoY, LAYOUT.secPhotoW, LAYOUT.secPhotoH);

  const sec = sections[1] || { name: 'Realm notes', value: 'No secondary story today.' };
  ctx.fillStyle = INK;
  ctx.font = '700 22px serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let sy = LAYOUT.secY;
  for (const ln of wrapLines(ctx, String(sec.name).replace(/^[^\w]+/, '').toUpperCase(), LAYOUT.secW, 3)) {
    ctx.fillText(ln, LAYOUT.secX, sy);
    sy += 26;
  }
  sy += 4;
  ctx.fillStyle = MUTED;
  ctx.font = '12px serif';
  ctx.fillText(date, LAYOUT.secX, sy);
  sy += 20;
  fillTextBlock(
    ctx,
    sec.value,
    LAYOUT.secX,
    sy,
    LAYOUT.secW,
    LAYOUT.secY + LAYOUT.secH - sy,
    '14px serif',
    18,
    INK
  );

  drawRuledLine(ctx, LAYOUT.rule3Y);

  // --- THREE COLUMNS ---
  const cw = colWidth();
  const colStories = [
    sections[2] || { name: 'Briefs', value: '—' },
    sections[3] || { name: 'Briefs', value: '—' },
    sections[4] || sections[2] || { name: 'Briefs', value: '—' },
  ];

  for (let i = 0; i < 3; i++) {
    const x = M + i * (cw + LAYOUT.colGap);
    const story = colStories[i];
    ctx.fillStyle = INK;
    ctx.font = '700 16px serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let cy = LAYOUT.colY;
    for (const ln of wrapLines(ctx, String(story.name).replace(/^[^\w]+/, ''), cw, 2)) {
      ctx.fillText(ln, x, cy);
      cy += 20;
    }
    cy += 8;
    fillTextBlock(
      ctx,
      story.value,
      x,
      cy,
      cw,
      LAYOUT.colY + LAYOUT.colH - cy,
      '13px serif',
      17,
      INK
    );
  }

  // Footer line
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
  ctx.fillText('The Overlord\'s Gazette · Printed daily at 00:05 UTC', W / 2, H - 22);

  return canvas.toBuffer('image/png');
}

module.exports = {
  renderGazetteImage,
  LAYOUT,
  W,
  H,
  canvasAvailable: () => Boolean(createCanvas),
};
