// City layout solver.
//
// Places every city marker + name + troop badge row so that, by construction:
//   - the marker is on land, inside its OWN province, and well away from the
//     coast and from province borders,
//   - no city (marker, name or troop badges) overlaps another city, any
//     province title (+ owner subtitle), the header or the legend,
//   - the troop row is ALWAYS reserved, so it can never collide later no matter
//     how many troops or houses are in a city.
//
// It works on the same pixel partition the renderer paints (territory.js), so
// "in the correct province" means exactly what the player sees.

const MARKER_R = 6; // marker half-size incl. outline
const NAME_H = 12;
const TROOP_H = 12;
const TROOP_W = 56; // room for two badges side by side
const PAD = 3; // minimum gap between any two footprints
const MIN_CITY_GAP = 34; // marker-to-marker minimum distance

function rectsOverlap(a, b, pad) {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

/** Distance (px) from each pixel to the nearest province outline / coast. */
function buildEdgeDistance(owner, W, H) {
  const N = W * H;
  const D = new Float32Array(N);
  const INF = 1e9;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = owner[i];
      if (o < 0) { D[i] = 0; continue; }
      const edge =
        x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
        owner[i - 1] !== o || owner[i + 1] !== o ||
        owner[i - W] !== o || owner[i + W] !== o;
      D[i] = edge ? 0 : INF;
    }
  }
  const R2 = Math.SQRT2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let d = D[i];
      if (d === 0) continue;
      if (x > 0) d = Math.min(d, D[i - 1] + 1);
      if (y > 0) {
        d = Math.min(d, D[i - W] + 1);
        if (x > 0) d = Math.min(d, D[i - W - 1] + R2);
        if (x < W - 1) d = Math.min(d, D[i - W + 1] + R2);
      }
      D[i] = d;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let d = D[i];
      if (d === 0) continue;
      if (x < W - 1) d = Math.min(d, D[i + 1] + 1);
      if (y < H - 1) {
        d = Math.min(d, D[i + W] + 1);
        if (x < W - 1) d = Math.min(d, D[i + W + 1] + R2);
        if (x > 0) d = Math.min(d, D[i + W - 1] + R2);
      }
      D[i] = d;
    }
  }
  return D;
}

/** 1 where the pixel belongs to the LARGEST connected piece of its province. */
function buildMainBody(owner, W, H, N) {
  const comp = new Int32Array(W * H).fill(-1);
  const body = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const best = new Array(N).fill(null); // { id, size }
  let nextId = 0;
  const sizes = [];
  for (let s = 0; s < W * H; s++) {
    if (owner[s] < 0 || comp[s] >= 0) continue;
    const o = owner[s];
    const id = nextId++;
    let sp = 0, size = 0;
    stack[sp++] = s;
    comp[s] = id;
    while (sp) {
      const i = stack[--sp];
      size++;
      const x = i % W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1];
      for (const j of nb) {
        if (j >= 0 && comp[j] < 0 && owner[j] === o) { comp[j] = id; stack[sp++] = j; }
      }
    }
    sizes[id] = size;
    if (!best[o] || size > best[o].size) best[o] = { id, size };
  }
  for (let i = 0; i < W * H; i++) {
    const o = owner[i];
    if (o >= 0 && best[o] && comp[i] === best[o].id) body[i] = 1;
  }
  return body;
}

function buildLandSum(land, W, H) {
  const S = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += land[y * W + x] ? 1 : 0;
      S[(y + 1) * (W + 1) + (x + 1)] = S[y * (W + 1) + (x + 1)] + row;
    }
  }
  return S;
}

function landFraction(S, W, H, r) {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(H, Math.ceil(r.y + r.h));
  const area = r.w * r.h;
  if (x1 <= x0 || y1 <= y0 || area <= 0) return 0;
  const sum =
    S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0];
  return sum / area;
}

/** The four ways a city can be drawn. Rects are relative to the marker centre. */
function arrangements(nameW) {
  const nw = nameW + 4;
  const tw = TROOP_W;
  return [
    // name above the marker, troop badges below it
    { key: 'above', pen: 0, name: { x: -nw / 2, y: -MARKER_R - NAME_H - 1, w: nw, h: NAME_H }, troop: { x: -tw / 2, y: MARKER_R + 1, w: tw, h: TROOP_H } },
    // name and troops both below
    { key: 'below', pen: 1, name: { x: -nw / 2, y: MARKER_R + 1, w: nw, h: NAME_H }, troop: { x: -tw / 2, y: MARKER_R + 1 + NAME_H, w: tw, h: TROOP_H } },
    // name to the right, troops under the name
    { key: 'right', pen: 3, name: { x: MARKER_R + 2, y: -NAME_H / 2, w: nw, h: NAME_H }, troop: { x: MARKER_R + 2 + (nw - tw) / 2, y: NAME_H / 2, w: tw, h: TROOP_H } },
    // name to the left, troops under the name
    { key: 'left', pen: 3, name: { x: -MARKER_R - 2 - nw, y: -NAME_H / 2, w: nw, h: NAME_H }, troop: { x: -MARKER_R - 2 - nw + (nw - tw) / 2, y: NAME_H / 2, w: tw, h: TROOP_H } },
  ];
}

function shift(r, x, y) {
  return { x: r.x + x, y: r.y + y, w: r.w, h: r.h };
}

/**
 * @param {object} o
 *  owner: Int16Array (province index per pixel, -1 = sea), land: Uint8Array
 *  W,H, provinces: [{ id, label:[x,y], short, cities:[{id,name,x,y}] }]
 *  measure(text, fontCss) -> width in px
 *  reserved: extra rects (header, legend)
 * @returns {{ pos: Record<string,{x,y,arr,name,troop,stage}>, warnings: string[] }}
 */
function layoutCities(o) {
  const { owner, land, W, H, provinces, measure } = o;
  const N = provinces.length;
  const D = buildEdgeDistance(owner, W, H);
  const body = buildMainBody(owner, W, H, N);
  const S = buildLandSum(land, W, H);

  const fixed = [...(o.reserved || [])];
  // Province titles + the (always reserved) owner subtitle line beneath them.
  for (const p of provinces) {
    const tw = measure(p.short, '600 12px serif');
    const sw = 132;
    const w = Math.max(tw + 8, sw);
    fixed.push({ x: p.label[0] - w / 2, y: p.label[1] - 9, w, h: 9 + 14 + 9 });
  }

  const placed = []; // rects of cities already placed
  const markers = []; // {x,y}
  const pos = {};
  const warnings = [];

  // Stages relax land/margin requirements ONLY if the strict ones cannot be met.
  const STAGES = [
    { margin: 13, landFrac: 0.97, name: 'strict' },
    { margin: 11, landFrac: 0.85, name: 'relaxed-labels' },
    { margin: 9, landFrac: 0.6, name: 'tight' },
    { margin: 7, landFrac: 0, name: 'last-resort' },
  ];

  const collides = (rects) => {
    for (const r of rects) {
      for (const f of fixed) if (rectsOverlap(r, f, PAD)) return true;
      for (const q of placed) if (rectsOverlap(r, q, PAD)) return true;
    }
    return false;
  };

  provinces.forEach((p, pi) => {
    // bounding box of this province for the whole-province fallback search
    let minX = W, maxX = 0, minY = H, maxY = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (owner[y * W + x] === pi) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    for (const c of p.cities || []) {
      const nameW = measure(c.name, '600 8px serif');
      const arrs = arrangements(nameW);
      const hx = c.x != null ? c.x : p.label[0];
      const hy = c.y != null ? c.y : p.label[1] + 25;
      let chosen = null;

      for (const st of STAGES) {
        for (const window of [{ r: 70 }, { r: 0 }]) {
          const x0 = window.r ? Math.max(minX, Math.floor(hx - window.r)) : minX;
          const x1 = window.r ? Math.min(maxX, Math.ceil(hx + window.r)) : maxX;
          const y0 = window.r ? Math.max(minY, Math.floor(hy - window.r)) : minY;
          const y1 = window.r ? Math.min(maxY, Math.ceil(hy + window.r)) : maxY;
          let best = null;
          for (let y = y0; y <= y1; y += 2) {
            for (let x = x0; x <= x1; x += 2) {
              const i = y * W + x;
              if (owner[i] !== pi || !body[i] || D[i] < st.margin) continue;
              let tooClose = false;
              for (const m of markers) {
                if ((m.x - x) ** 2 + (m.y - y) ** 2 < MIN_CITY_GAP * MIN_CITY_GAP) { tooClose = true; break; }
              }
              if (tooClose) continue;
              const mk = { x: x - MARKER_R, y: y - MARKER_R, w: MARKER_R * 2, h: MARKER_R * 2 };
              if (collides([mk])) continue;
              for (const a of arrs) {
                const nr = shift(a.name, x, y);
                const tr = shift(a.troop, x, y);
                if (nr.x < 4 || tr.x < 4 || nr.x + nr.w > W - 4 || tr.x + tr.w > W - 4) continue;
                if (nr.y < 4 || tr.y < 4 || nr.y + nr.h > H - 4 || tr.y + tr.h > H - 4) continue;
                if (collides([nr, tr])) continue;
                // the city's own pieces must not overlap each other
                if (rectsOverlap(nr, mk, 0) || rectsOverlap(tr, mk, 0)) continue;
                if (st.landFrac > 0 &&
                  (landFraction(S, W, H, nr) < st.landFrac || landFraction(S, W, H, tr) < st.landFrac)) continue;
                const cost =
                  Math.hypot(x - hx, y - hy) - 0.6 * Math.min(D[i], 22) + a.pen * 2;
                if (!best || cost < best.cost) best = { cost, x, y, a, nr, tr };
              }
            }
          }
          if (best) { chosen = { ...best, stage: st.name }; break; }
        }
        if (chosen) break;
      }

      if (!chosen) {
        warnings.push(`${c.id}: no valid spot found, using hint (${hx},${hy})`);
        const a = arrs[0];
        chosen = { x: hx, y: hy, a, nr: shift(a.name, hx, hy), tr: shift(a.troop, hx, hy), stage: 'failed' };
      } else if (chosen.stage !== 'strict') {
        warnings.push(`${c.id}: placed with "${chosen.stage}" rules`);
      }

      placed.push({ x: chosen.x - MARKER_R, y: chosen.y - MARKER_R, w: MARKER_R * 2, h: MARKER_R * 2 }, chosen.nr, chosen.tr);
      markers.push({ x: chosen.x, y: chosen.y });
      pos[c.id] = { x: chosen.x, y: chosen.y, arr: chosen.a.key, name: chosen.nr, troop: chosen.tr, stage: chosen.stage };
    }
  });

  return { pos, warnings, fixed };
}

module.exports = { layoutCities, rectsOverlap, TROOP_W, TROOP_H, NAME_H, MARKER_R };
