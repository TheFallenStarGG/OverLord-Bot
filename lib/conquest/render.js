const { WIDTH, HEIGHT, list } = require('./provinces');

let createCanvas = null;
try {
  ({ createCanvas } = require('@napi-rs/canvas'));
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

function colorForHouse(house, houses) {
  if (!house) return '#3a3f4b';
  if (house.color) return house.color;
  const ids = Object.keys(houses || {}).sort();
  const i = Math.max(0, ids.indexOf(house.id));
  return HOUSE_PALETTE[i % HOUSE_PALETTE.length];
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

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, '#1a1520');
  bg.addColorStop(1, '#0e0c12');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Soft vignette frame
  ctx.strokeStyle = 'rgba(224, 184, 74, 0.25)';
  ctx.lineWidth = 3;
  ctx.strokeRect(12, 12, WIDTH - 24, HEIGHT - 24);

  const houses = state.houses || {};
  const ownerOf = state.owner || {};
  const armies = state.armies || {};

  // Fills
  for (const p of list()) {
    const hid = ownerOf[p.id];
    const house = hid ? houses[hid] : null;
    ctx.beginPath();
    p.poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = colorForHouse(house, houses);
    ctx.globalAlpha = house ? 0.88 : 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Borders
  for (const p of list()) {
    ctx.beginPath();
    p.poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(20, 16, 24, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240, 215, 138, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Labels + armies
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of list()) {
    const hid = ownerOf[p.id];
    const house = hid ? houses[hid] : null;

    ctx.font = '600 15px sans-serif';
    ctx.fillStyle = 'rgba(255, 248, 230, 0.95)';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 3;
    ctx.strokeText(p.short, p.label[0], p.label[1]);
    ctx.fillText(p.short, p.label[0], p.label[1]);

    const stacks = armies[p.id] || [];
    const total = stacks.reduce((s, a) => s + (a.size || 0), 0);
    if (total > 0) {
      const [ax, ay] = p.army;
      ctx.fillStyle = 'rgba(10, 8, 12, 0.75)';
      drawRoundedRect(ctx, ax - 22, ay - 11, 44, 22, 8);
      ctx.fill();
      ctx.font = '700 13px sans-serif';
      ctx.fillStyle = '#f0d78a';
      ctx.fillText(String(total), ax, ay + 1);
    } else if (!house) {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'rgba(200, 200, 210, 0.45)';
      ctx.fillText('—', p.army[0], p.army[1]);
    }
  }

  // Header bar
  ctx.fillStyle = 'rgba(10, 8, 14, 0.72)';
  ctx.fillRect(24, 20, WIDTH - 48, 44);
  ctx.font = '600 16px sans-serif';
  ctx.fillStyle = '#f0d78a';
  ctx.textAlign = 'left';
  ctx.fillText(meta.title || 'Campaign Map', 40, 42);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = 'rgba(230, 220, 200, 0.75)';
  ctx.textAlign = 'right';
  ctx.fillText(meta.subtitle || '', WIDTH - 40, 42);

  // Legend (houses)
  const entries = Object.values(houses).slice(0, 8);
  if (entries.length) {
    let lx = 40;
    const ly = HEIGHT - 28;
    ctx.textAlign = 'left';
    ctx.font = '12px sans-serif';
    for (const h of entries) {
      ctx.fillStyle = colorForHouse(h, houses);
      ctx.fillRect(lx, ly - 8, 12, 12);
      ctx.fillStyle = 'rgba(230, 220, 200, 0.85)';
      ctx.fillText(h.name, lx + 18, ly);
      lx += ctx.measureText(h.name).width + 36;
      if (lx > WIDTH - 120) break;
    }
  }

  return canvas.toBuffer('image/png');
}

module.exports = { renderMap, colorForHouse, HOUSE_PALETTE, canvasAvailable: () => Boolean(createCanvas) };
