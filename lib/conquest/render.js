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
  if (house.color && /^#[0-9a-fA-F]{6}$/.test(house.color)) return house.color;
  const ids = Object.keys(houses || {}).sort();
  const i = Math.max(0, ids.indexOf(house.id));
  return HOUSE_PALETTE[i % HOUSE_PALETTE.length];
}

function hexToRgba(hex, a) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Catmull-Rom style smooth path through polygon points (closed). */
function smoothProvincePath(ctx, poly) {
  const pts = poly;
  if (pts.length < 3) return;
  const n = pts.length;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
  }
  ctx.closePath();
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

/** Light ink wash so the finished map feels a bit richer than the raw PNG. */
function paintAtmosphere(ctx) {
  // Soft vignette
  const g = ctx.createRadialGradient(
    WIDTH / 2,
    HEIGHT / 2,
    Math.min(WIDTH, HEIGHT) * 0.25,
    WIDTH / 2,
    HEIGHT / 2,
    Math.max(WIDTH, HEIGHT) * 0.7
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(40, 30, 15, 0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Warm paper grade
  ctx.fillStyle = 'rgba(210, 180, 120, 0.04)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

async function renderMap(state, meta = {}) {
  if (!createCanvas) return null;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (loadImage && fs.existsSync(BASE_PATH)) {
    try {
      const img = await loadImage(BASE_PATH);
      ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
    } catch {
      ctx.fillStyle = '#d4c4a8';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  } else {
    ctx.fillStyle = '#d4c4a8';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#5a4630';
    ctx.font = '14px serif';
    ctx.textAlign = 'center';
    ctx.fillText('Missing assets/conquest/base-map.png', WIDTH / 2, HEIGHT / 2);
  }

  paintAtmosphere(ctx);

  const houses = state.houses || {};
  const ownerOf = state.owner || {};
  const armies = state.armies || {};

  // Ownership tints — smooth paths, faint, clipped to province shape
  for (const p of list()) {
    const hid = ownerOf[p.id];
    const house = hid ? houses[hid] : null;
    const col = colorForHouse(house, houses);
    if (!col) continue;

    smoothProvincePath(ctx, p.poly);
    ctx.fillStyle = hexToRgba(col, 0.34);
    ctx.fill();

    // Crisp inner edge so tint reads as “filled region”, not jagged bars
    smoothProvincePath(ctx, p.poly);
    ctx.strokeStyle = hexToRgba(col, 0.55);
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }

  // Labels + armies (anchors are on land in provinces.js)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of list()) {
    ctx.font = '600 12px serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 250, 235, 0.9)';
    ctx.fillStyle = 'rgba(45, 32, 18, 0.92)';
    ctx.strokeText(p.short, p.label[0], p.label[1]);
    ctx.fillText(p.short, p.label[0], p.label[1]);

    const total = (armies[p.id] || []).reduce((s, a) => s + (a.size || 0), 0);
    if (total > 0) {
      const [ax, ay] = p.army;
      ctx.fillStyle = 'rgba(30, 22, 14, 0.82)';
      drawRoundedRect(ctx, ax - 18, ay - 9, 36, 18, 6);
      ctx.fill();
      ctx.font = '700 11px sans-serif';
      ctx.fillStyle = '#f0d78a';
      ctx.fillText(String(total), ax, ay + 1);
    }
  }

  // Header
  ctx.fillStyle = 'rgba(35, 28, 20, 0.7)';
  ctx.fillRect(16, 12, WIDTH - 32, 34);
  ctx.font = '600 14px serif';
  ctx.fillStyle = '#f0d78a';
  ctx.textAlign = 'left';
  ctx.fillText(meta.title || "The Overlord's Realm", 28, 32);
  ctx.font = '11px serif';
  ctx.fillStyle = 'rgba(240, 230, 210, 0.85)';
  ctx.textAlign = 'right';
  ctx.fillText(meta.subtitle || '', WIDTH - 28, 32);

  // Legend
  const entries = Object.values(houses).slice(0, 8);
  if (entries.length) {
    let lx = 28;
    const ly = HEIGHT - 16;
    ctx.textAlign = 'left';
    ctx.font = '11px serif';
    for (const h of entries) {
      const c = colorForHouse(h, houses) || '#888';
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(lx, ly - 7, 10, 10);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(30, 22, 14, 0.9)';
      ctx.fillText(h.name, lx + 14, ly);
      lx += ctx.measureText(h.name).width + 26;
      if (lx > WIDTH - 80) break;
    }
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  renderMap,
  colorForHouse,
  HOUSE_PALETTE,
  canvasAvailable: () => Boolean(createCanvas),
};
