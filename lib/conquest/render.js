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
  const cityOwner = state.cityOwner || {};
  const provinces = list();

  // Per-province cities with owner tint (null = neutral city → no fill from that seed)
  const citySeeds = provinces.map((p) =>
    (p.cities || [])
      .filter((c) => c.x != null && c.y != null)
      .map((c) => {
        const hid = cityOwner[c.id];
        const house = hid ? houses[hid] : null;
        const col = house ? colorForHouse(house, houses) : null;
        return {
          x: c.x,
          y: c.y,
          rgb: col ? hexToRgb(col) : null,
        };
      })
  );

  const layer = createCanvas(WIDTH, HEIGHT);
  const lctx = layer.getContext('2d');
  const img = lctx.createImageData(WIDTH, HEIGHT);
  const px = img.data;
  const INK = [55, 40, 22];

  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const o = t.owner[i];
    if (o < 0) continue;

    const seeds = citySeeds[o] || [];
    let tint = null;
    if (seeds.length) {
      const x = i % WIDTH;
      const y = (i / WIDTH) | 0;
      let best = Infinity;
      let bestRgb = null;
      for (const s of seeds) {
        const dx = x - s.x;
        const dy = y - s.y;
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          bestRgb = s.rgb;
        }
      }
      tint = bestRgb; // null if nearest city is neutral → blank land
    }

    const o4 = i * 4;
    if (t.border[i]) {
      let r = INK[0],
        g = INK[1],
        b = INK[2],
        a = 150;
      if (tint) {
        r = Math.round(INK[0] * 0.45 + tint[0] * 0.55);
        g = Math.round(INK[1] * 0.45 + tint[1] * 0.55);
        b = Math.round(INK[2] * 0.45 + tint[2] * 0.55);
        a = 190;
      }
      px[o4] = r;
      px[o4 + 1] = g;
      px[o4 + 2] = b;
      px[o4 + 3] = a;
    } else if (tint) {
      px[o4] = tint[0];
      px[o4 + 1] = tint[1];
      px[o4 + 2] = tint[2];
      px[o4 + 3] = 87;
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

  // --- Cities (dots only under labels; names offset if near province title) ---
  const cityOwner = state.cityOwner || {};
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const p of list()) {
    const [lx, ly] = p.label;
    for (const c of p.cities || []) {
      if (c.x == null || c.y == null) continue;
      const ch = cityOwner[c.id] ? houses[cityOwner[c.id]] : null;
      const col = ch ? colorForHouse(ch, houses) : '#d5cbb8';

      ctx.beginPath();
      ctx.arc(c.x, c.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(28, 22, 14, 0.92)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();

      // Skip city caption if it would sit on the province name
      const distLabel = Math.hypot(c.x - lx, c.y - ly);
      if (distLabel < 36) continue;

      let ty = c.y + 12;
      if (ty > ly - 6 && ty < ly + 22 && Math.abs(c.x - lx) < 50) ty = c.y - 12;

      ctx.font = '600 8px serif';
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 250, 235, 0.9)';
      ctx.fillStyle = 'rgba(35, 28, 18, 0.88)';
      ctx.strokeText(c.name, c.x, ty);
      ctx.fillText(c.name, c.x, ty);
    }
  }

  // --- Province status + army readout ---
  for (const p of list()) {
    const cities = p.cities || [];
    const owners = cities.map((c) => cityOwner[c.id] || null);
    const held = owners.filter(Boolean);
    const unique = [...new Set(held)];
    const allSame = unique.length === 1 && held.length === cities.length;
    const contested = unique.length >= 2;
    const partial = unique.length === 1 && held.length > 0 && held.length < cities.length;

    let status;
    let statusColor = 'rgba(80, 70, 55, 0.8)';
    if (allSame) {
      status = houses[unique[0]]?.name || 'Held';
      statusColor = 'rgba(45, 32, 18, 0.9)';
    } else if (contested) {
      status = 'Under siege';
      statusColor = 'rgba(120, 40, 30, 0.92)';
    } else if (partial) {
      status = houses[unique[0]]?.name ? `${houses[unique[0]].name}…` : 'Contested';
      statusColor = 'rgba(45, 32, 18, 0.85)';
    } else {
      status = 'Neutral';
    }

    ctx.font = '600 12px serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 250, 235, 0.9)';
    ctx.fillStyle = 'rgba(45, 32, 18, 0.92)';
    ctx.strokeText(p.short, p.label[0], p.label[1]);
    ctx.fillText(p.short, p.label[0], p.label[1]);

    ctx.font = '10px serif';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255, 250, 235, 0.85)';
    ctx.fillStyle = statusColor;
    ctx.strokeText(status, p.label[0], p.label[1] + 14);
    ctx.fillText(status, p.label[0], p.label[1] + 14);

    // Army badge: when contested/partial show split; else one total for controller
    const stacks = armies[p.id] || [];
    if (!stacks.length) continue;

    const [ax, ay] = p.army;
    let badge;
    if (contested || partial) {
      const parts = stacks
        .slice()
        .sort((a, b) => b.size - a.size)
        .slice(0, 2)
        .map((a) => a.size);
      badge = parts.length === 1 ? String(parts[0]) : parts.join('/');
    } else {
      badge = String(stacks.reduce((s, a) => s + (a.size || 0), 0));
    }

    const bw = Math.max(28, badge.length * 7 + 12);
    ctx.fillStyle = contested
      ? 'rgba(90, 28, 22, 0.88)'
      : 'rgba(30, 22, 14, 0.82)';
    drawRoundedRect(ctx, ax - bw / 2, ay - 9, bw, 18, 6);
    ctx.fill();
    ctx.font = '700 11px sans-serif';
    ctx.fillStyle = contested ? '#f0b090' : '#f0d78a';
    ctx.fillText(badge, ax, ay + 1);
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
