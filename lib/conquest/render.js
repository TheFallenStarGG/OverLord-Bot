const fs = require('fs');
const path = require('path');
const { WIDTH, HEIGHT, list } = require('./provinces');
const { buildTerritory } = require('./territory');
const { layoutCities } = require('./layout');

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

// Areas no city text may ever touch.
const HEADER_RECT = { x: 16, y: 12, w: WIDTH - 32, h: 34 };
const LEGEND_RECT = { x: 0, y: HEIGHT - 30, w: WIDTH, h: 30 };
const SUBTITLE_MAX_W = 128; // owner line under a province title (reserved by the layout)

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

function readableOn(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1c160e' : '#ffffff';
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

function fitText(ctx, text, maxW) {
  let t = String(text);
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function troopLabel(n) {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
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

// The partition and city layout only depend on the base PNG, so build once.
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
      const t = buildTerritory(data, WIDTH, HEIGHT, list());

      // Solve every city's position from the BASE image's land + the province
      // partition: on land, inside its own province, clear of every title.
      const measure = (text, font) => {
        cx.font = font;
        return cx.measureText(text).width;
      };
      const lay = layoutCities({
        owner: t.owner,
        land: t.land,
        W: WIDTH,
        H: HEIGHT,
        provinces: list(),
        measure,
        reserved: [HEADER_RECT, LEGEND_RECT],
      });
      t.cityPos = lay.pos;
      if (lay.warnings.length) {
        console.warn(`[conquest] city layout notes:\n  ${lay.warnings.join('\n  ')}`);
      }
      return t;
    })().catch((err) => {
      console.error('[conquest] territory build failed:', err);
      return null;
    });
  }
  return territoryPromise;
}

function cityPoint(t, c) {
  const p = t?.cityPos?.[c.id];
  return p ? { x: p.x, y: p.y } : { x: c.x, y: c.y };
}

/**
 * Draws tints + borders straight from the pixel partition, so provinces tile
 * the land exactly: shared borders, no overlap, no gaps, exact coastline.
 */
function paintTerritory(ctx, t, state) {
  const houses = state.houses || {};
  const cityOwner = state.cityOwner || {};
  const provinces = list();

  const citySeeds = provinces.map((p) =>
    (p.cities || [])
      .filter((c) => c.x != null && c.y != null)
      .map((c) => {
        const hid = cityOwner[c.id];
        const house = hid ? houses[hid] : null;
        const col = house ? colorForHouse(house, houses) : null;
        const pt = cityPoint(t, c);
        return { x: pt.x, y: pt.y, rgb: col ? hexToRgb(col) : null };
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
      tint = bestRgb; // null if nearest city is neutral -> blank land
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

/** Small coloured number badges (one per house present), centred in `rect`. */
function drawTroopBadges(ctx, rect, stacks, houses) {
  const rows = stacks
    .filter((a) => a.size > 0)
    .slice()
    .sort((a, b) => b.size - a.size)
    .slice(0, 2);
  if (!rows.length) return;

  ctx.font = '700 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const PH = 11;
  const GAP = 2;
  const items = rows.map((a) => {
    const label = troopLabel(a.size);
    return { a, label, w: Math.ceil(ctx.measureText(label).width) + 7 };
  });
  const total = items.reduce((s, it) => s + it.w, 0) + GAP * (items.length - 1);
  let x = rect.x + (rect.w - total) / 2;
  const y = rect.y + (rect.h - PH) / 2;

  for (const it of items) {
    const col = colorForHouse(houses[it.a.houseId], houses) || '#6b6b6b';
    drawRoundedRect(ctx, x, y, it.w, PH, 4);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(20, 16, 12, 0.9)';
    ctx.stroke();
    ctx.fillStyle = readableOn(col);
    ctx.fillText(it.label, x + it.w / 2, y + PH / 2 + 0.5);
    x += it.w + GAP;
  }
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
  const armies = state.armies || {};

  const territory = await getTerritory();
  if (territory) paintTerritory(ctx, territory, state);

  // --- Cities: marker, name, troop badges (positions come from the layout) ---
  const cityOwner = state.cityOwner || {};
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const p of list()) {
    for (const c of p.cities || []) {
      const slot = territory?.cityPos?.[c.id];
      const x = slot ? slot.x : c.x;
      const y = slot ? slot.y : c.y;
      if (x == null || y == null) continue;

      const ch = cityOwner[c.id] ? houses[cityOwner[c.id]] : null;
      const col = ch ? colorForHouse(ch, houses) : '#d5cbb8';

      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(28, 22, 14, 0.92)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();

      if (slot) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '600 8px serif';
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255, 250, 235, 0.9)';
        ctx.fillStyle = 'rgba(35, 28, 18, 0.88)';
        const nx = slot.name.x + slot.name.w / 2;
        const ny = slot.name.y + slot.name.h / 2;
        ctx.strokeText(c.name, nx, ny);
        ctx.fillText(c.name, nx, ny);

        drawTroopBadges(ctx, slot.troop, armies[c.id] || [], houses);
      }
    }
  }

  // Province title always; owner subtitle ONLY if one house holds every city
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of list()) {
    const cities = p.cities || [];
    const owners = cities.map((c) => cityOwner[c.id] || null);
    const held = owners.filter(Boolean);
    const unique = [...new Set(held)];
    const allSame = unique.length === 1 && held.length === cities.length && cities.length > 0;

    ctx.font = '600 12px serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 250, 235, 0.9)';
    ctx.fillStyle = 'rgba(45, 32, 18, 0.92)';
    ctx.strokeText(p.short, p.label[0], p.label[1]);
    ctx.fillText(p.short, p.label[0], p.label[1]);

    if (allSame) {
      ctx.font = '10px serif';
      const status = fitText(ctx, houses[unique[0]]?.name || 'Held', SUBTITLE_MAX_W);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 250, 235, 0.85)';
      ctx.fillStyle = 'rgba(45, 32, 18, 0.9)';
      ctx.strokeText(status, p.label[0], p.label[1] + 14);
      ctx.fillText(status, p.label[0], p.label[1] + 14);
    }
  }

  // Header
  ctx.fillStyle = 'rgba(35, 28, 20, 0.7)';
  ctx.fillRect(HEADER_RECT.x, HEADER_RECT.y, HEADER_RECT.w, HEADER_RECT.h);
  ctx.font = '600 14px serif';
  ctx.fillStyle = '#f0d78a';
  ctx.textAlign = 'left';
  ctx.fillText(meta.title || "The Overlord's Realm", 28, 32);
  ctx.font = '11px serif';
  ctx.fillStyle = 'rgba(240, 230, 210, 0.85)';
  ctx.textAlign = 'right';
  ctx.fillText(meta.subtitle || '', WIDTH - 28, 32);

  // Legend — active houses only; never two Shadow Courts
  const ownerOf = state.owner || {};
  const hasFoot = (id) =>
    Object.values(ownerOf).includes(id) ||
    Object.values(cityOwner).includes(id) ||
    Object.values(armies).some((arr) => (arr || []).some((a) => a.houseId === id && a.size > 0));

  const filtered = Object.values(houses).filter((h) => {
    if (!h?.id) return false;
    // Only the real AI id may represent Shadow Court
    if (h.id === 'ai_shadow' || h.ai === true) {
      return h.id === 'ai_shadow' && hasFoot(h.id);
    }
    const name = String(h.name || '').toLowerCase();
    if (name === 'the shadow court') return false; // ghost AI name, drop
    const score = h.score || 0;
    return score > 0 || hasFoot(h.id);
  });

  // Dedupe by name (keep highest score / prefer ai_shadow)
  const byName = new Map();
  for (const h of filtered) {
    const key = String(h.name || h.id).toLowerCase();
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, h);
      continue;
    }
    if (h.id === 'ai_shadow') byName.set(key, h);
    else if (prev.id !== 'ai_shadow' && (h.score || 0) > (prev.score || 0)) byName.set(key, h);
  }
  const entries = [...byName.values()]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 8);
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
