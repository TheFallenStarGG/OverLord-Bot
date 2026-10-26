const fs = require('fs');
const path = require('path');
const { WIDTH, HEIGHT, list } = require('./provinces');
const { buildTerritory } = require('./territory');

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

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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

  ctx.fillStyle = 'rgba(210, 180, 120, 0.04)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

// The partition only depends on the base PNG, so build it once and reuse it.
let baseImagePromise = null;
let territoryPromise = null;

function loadBase() {
  if (!baseImagePromise) {
    baseImagePromise = (async () => {
      if (!loadImage || !fs.existsSync(BASE_PATH)) return null;
      try {
        return await loadImage(BASE_PATH);
      } catch {
        return null;
      }
    })();
  }
  return baseImagePromise;
}

function getTerritory() {
  if (!territoryPromise) {
    territoryPromise = (async () => {
      const img = await loadBase();
      if (!img) return null;
      const c = createCanvas(WIDTH, HEIGHT);
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0, WIDTH, HEIGHT);
      const data = cx.getImageData(0, 0, WIDTH, HEIGHT).data;
      return buildTerritory(data, WIDTH, HEIGHT, list());
    })().catch((err) => {
      console.error('[conquest] territory build failed:', err);
      return null;
    });
  }
  return territoryPromise;
}

/**
 * Draws tints + borders straight from the pixel partition, so provinces tile
 * the land exactly: shared borders, no overlap, no gaps, exact coastline.
 */
function paintTerritory(ctx, t, state) {
  const houses = state.houses || {};
  const ownerOf = state.owner || {};
  const provinces = list();

  const tints = provinces.map((p) => {
    const hid = ownerOf[p.id];
    const house = hid ? houses[hid] : null;
    const col = colorForHouse(house, houses);
    return col ? hexToRgb(col) : null;
  });

  const layer = createCanvas(WIDTH, HEIGHT);
  const lctx = layer.getContext('2d');
  const img = lctx.createImageData(WIDTH, HEIGHT);
  const px = img.data;
  const INK = [55, 40, 22];

  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const o = t.owner[i];
    if (o < 0) continue;
    const tint = tints[o];
    const o4 = i * 4;
    if (t.border[i]) {
      // Dark ink line; claimed provinces get their house colour mixed in.
      let r = INK[0], g = INK[1], b = INK[2], a = 150;
      if (tint) {
        r = Math.round(INK[0] * 0.45 + tint[0] * 0.55);
        g = Math.round(INK[1] * 0.45 + tint[1] * 0.55);
        b = Math.round(INK[2] * 0.45 + tint[2] * 0.55);
        a = 190;
      }
      px[o4] = r; px[o4 + 1] = g; px[o4 + 2] = b; px[o4 + 3] = a;
    } else if (tint) {
      px[o4] = tint[0]; px[o4 + 1] = tint[1]; px[o4 + 2] = tint[2]; px[o4 + 3] = 87; // ~0.34
    }
  }
  lctx.putImageData(img, 0, 0);
  ctx.drawImage(layer, 0, 0);
}

async function renderMap(state, meta = {}) {
  if (!createCanvas) return null;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const baseImg = await loadBase();
  if (baseImg) {
    ctx.drawImage(baseImg, 0, 0, WIDTH, HEIGHT);
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

  const territory = await getTerritory();
  if (territory) paintTerritory(ctx, territory, state);

  // Labels + armies (anchors are on land in provinces.js)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of list()) {
    const hid = ownerOf[p.id];
    const house = hid ? houses[hid] : null;

    ctx.font = '600 12px serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 250, 235, 0.9)';
    ctx.fillStyle = 'rgba(45, 32, 18, 0.92)';
    ctx.strokeText(p.short, p.label[0], p.label[1]);
    ctx.fillText(p.short, p.label[0], p.label[1]);

    const ownerLine = house ? house.name : 'Neutral';
    ctx.font = '10px serif';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255, 250, 235, 0.85)';
    ctx.fillStyle = house ? 'rgba(45, 32, 18, 0.88)' : 'rgba(80, 70, 55, 0.75)';
    ctx.strokeText(ownerLine, p.label[0], p.label[1] + 14);
    ctx.fillText(ownerLine, p.label[0], p.label[1] + 14);

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
