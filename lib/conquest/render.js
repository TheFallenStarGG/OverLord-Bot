const fs = require('fs');
const path = require('path');
const { WIDTH, HEIGHT, list } = require('./provinces');

let createCanvas = null;
let loadImage = null;
try {
  const canvas = require('@napi-rs/canvas');
  createCanvas = canvas.createCanvas;
  loadImage = canvas.loadImage;
} catch {
  createCanvas = null;
}

const HOUSE_PALETTE = [
  '#8b2942',
  '#2f5d8c',
  '#3d7a4a',
  '#8a6b2f',
  '#5c3d7a',
  '#2f7a7a',
  '#7a3d2f',
  '#4a5568',
];

const BASE_PATH = path.join(__dirname, '..', '..', 'assets', 'conquest', 'base-map.png');

function colorForHouse(house, houses) {
  if (!house) return null;
  if (house.color) return house.color;
  const ids = Object.keys(houses || {}).sort();
  const i = Math.max(0, ids.indexOf(house.id));
  return HOUSE_PALETTE[i % HOUSE_PALETTE.length];
}

function hexToRgba(hex, a) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * @returns {Promise<Buffer|null>}
 */
async function renderMap(state, meta = {}) {
  if (!createCanvas) return null;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // --- Base vintage map ---
  if (loadImage && fs.existsSync(BASE_PATH)) {
    try {
      const img = await loadImage(BASE_PATH);
      ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
    } catch {
      drawFallbackBackground(ctx);
    }
  } else {
    drawFallbackBackground(ctx);
  }

  const houses = state.houses || {};
  const ownerOf = state.owner || {};
  const armies = state.armies || {};

  // --- Ownership tints (semi-transparent so terrain still reads) ---
  for (const p of list()) {
    const hid = ownerOf[p.id];
    const house = hid ? houses[hid] : null;
    const col = colorForHouse(house, houses);
    if (!col) continue;

    ctx.beginPath();
    p.poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = hexToRgba(col, 0.38);
    ctx.fill();
  }

  // --- Soft borders ---
  for (const p of list()) {
    ctx.beginPath();
    p.poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(60, 40, 20, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // --- Labels + armies (land anchors only) ---
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of list()) {
    ctx.font = '600 13px serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 248, 230, 0.85)';
    ctx.fillStyle = 'rgba(40, 28, 16, 0.92)';
    ctx.strokeText(p.short, p.label[0], p.label[1]);
    ctx.fillText(p.short, p.label[0], p.label[1]);

    const stacks = armies[p.id] || [];
    const total = stacks.reduce((s, a) => s + (a.size || 0), 0);
    if (total > 0) {
      const [ax, ay] = p.army;
      ctx.fillStyle = 'rgba(30, 22, 14, 0.8)';
      drawRoundedRect(ctx, ax - 20, ay - 10, 40, 20, 7);
      ctx.fill();
      ctx.font = '700 12px sans-serif';
      ctx.fillStyle = '#f0d78a';
      ctx.fillText(String(total), ax, ay + 1);
    }
  }

  // --- Header strip ---
  ctx.fillStyle = 'rgba(35, 28, 20, 0.72)';
  ctx.fillRect(20, 16, WIDTH - 40, 40);
  ctx.font = '600 15px serif';
  ctx.fillStyle = '#f0d78a';
  ctx.textAlign = 'left';
  ctx.fillText(meta.title || "The Overlord's Realm", 36, 38);
  ctx.font = '12px serif';
  ctx.fillStyle = 'rgba(240, 230, 210, 0.8)';
  ctx.textAlign = 'right';
  ctx.fillText(meta.subtitle || '', WIDTH - 36, 38);

  // House legend
  const entries = Object.values(houses).slice(0, 8);
  if (entries.length) {
    let lx = 36;
    const ly = HEIGHT - 22;
    ctx.textAlign = 'left';
    ctx.font = '11px serif';
    for (const h of entries) {
      const c = colorForHouse(h, houses) || '#888';
      ctx.fillStyle = c;
      ctx.fillRect(lx, ly - 7, 10, 10);
      ctx.fillStyle = 'rgba(30, 22, 14, 0.9)';
      ctx.fillText(h.name, lx + 14, ly);
      lx += ctx.measureText(h.name).width + 28;
      if (lx > WIDTH - 100) break;
    }
  }

  return canvas.toBuffer('image/png');
}

function drawFallbackBackground(ctx) {
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, '#d4c4a8');
  bg.addColorStop(1, '#c4b396');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = 'rgba(90, 70, 40, 0.5)';
  ctx.font = '16px serif';
  ctx.textAlign = 'center';
  ctx.fillText('Missing assets/conquest/base-map.png — using plain background', WIDTH / 2, HEIGHT / 2);
}

module.exports = {
  renderMap,
  colorForHouse,
  HOUSE_PALETTE,
  canvasAvailable: () => Boolean(createCanvas),
};
