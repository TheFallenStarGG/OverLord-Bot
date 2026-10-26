// Pixel-exact province partition built from the base map's own land/sea shape.
// Every land pixel belongs to exactly ONE province, so borders can never
// overlap or leave gaps, and the outer edge IS the coastline of the base PNG.

function erode(src, W, H) {
  const out = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (src[i] && src[i - 1] && src[i + 1] && src[i - W] && src[i + W]) out[i] = 1;
    }
  }
  return out;
}

function dilate(src, W, H) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (
        src[i] ||
        (x > 0 && src[i - 1]) ||
        (x < W - 1 && src[i + 1]) ||
        (y > 0 && src[i - W]) ||
        (y < H - 1 && src[i + W])
      ) out[i] = 1;
    }
  }
  return out;
}

function open(src, W, H, n) {
  let m = src;
  for (let k = 0; k < n; k++) m = erode(m, W, H);
  for (let k = 0; k < n; k++) m = dilate(m, W, H);
  return m;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** true = land. Sea is whatever colour-wise sea-like area touches the image edge. */
function buildLandMask(rgba, W, H, provinces) {
  // Calibrate "what does land look like in this image" from the label anchors.
  const fs = [], hs = [];
  for (const p of provinces) {
    const x = Math.round(p.label[0]), y = Math.round(p.label[1]) - 24;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const i = (py * W + px) * 4;
        fs.push(rgba[i + 1] - rgba[i + 2]);
        hs.push(rgba[i + 1] - rgba[i]);
      }
    }
  }
  const fThr = Math.max(18, median(fs) - 12); // land is "greener" than blue-ish water
  const hThr = Math.min(-4, median(hs) - 7); // parchment / frame is redder than land

  let seaish = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    if (g - b < fThr || g - r < hThr) seaish[i] = 1;
  }
  seaish = open(seaish, W, H, 2); // cut thin leaks (rivers, mountain ink touching the coast)

  // Flood-fill the sea from every edge pixel.
  const sea = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let qh = 0, qt = 0;
  const push = (i) => { if (seaish[i] && !sea[i]) { sea[i] = 1; queue[qt++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (i >= W) push(i - W);
    if (i < W * (H - 1)) push(i + W);
  }

  let land = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) land[i] = sea[i] ? 0 : 1;
  land = open(land, W, H, 2); // drop specks and the decorative frame
  return land;
}

function buildTerritory(rgba, W, H, provinces) {
  const land = buildLandMask(rgba, W, H, provinces);
  const N = provinces.length;

  // How many hand-drawn polygons cover each pixel (they overlap / leave holes).
  const cover = new Uint8Array(W * H);
  const first = new Int16Array(W * H).fill(-1);
  provinces.forEach((p, idx) => {
    let minX = W, maxX = 0, minY = H, maxY = 0;
    for (const [x, y] of p.poly) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
      for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(W - 1, Math.ceil(maxX)); x++) {
        if (pointInPoly(x + 0.5, y + 0.5, p.poly)) {
          const i = y * W + x;
          if (cover[i] < 255) cover[i]++;
          if (first[i] < 0) first[i] = idx;
        }
      }
    }
  });

  // Seeds: land covered by exactly one polygon, plus a disc around each label.
  const owner = new Int16Array(W * H).fill(-1);
  const queue = new Int32Array(W * H);
  let qh = 0, qt = 0;
  for (let i = 0; i < W * H; i++) {
    if (land[i] && cover[i] === 1) { owner[i] = first[i]; queue[qt++] = i; }
  }
  provinces.forEach((p, idx) => {
    const R = 9;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const x = Math.round(p.label[0]) + dx, y = Math.round(p.label[1]) + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (land[i] && owner[i] < 0) { owner[i] = idx; queue[qt++] = i; }
      }
    }
  });

  // Grow all seeds across land at the same speed: overlaps get split down the
  // middle, holes get filled, nothing can cross water.
  while (qh < qt) {
    const i = queue[qh++];
    const o = owner[i];
    const x = i % W;
    const tryI = (j) => { if (land[j] && owner[j] < 0) { owner[j] = o; queue[qt++] = j; } };
    if (x > 0) tryI(i - 1);
    if (x < W - 1) tryI(i + 1);
    if (i >= W) tryI(i - W);
    if (i < W * (H - 1)) tryI(i + W);
  }

  // Islands no seed could reach: give each whole island to the nearest province.
  const seen = new Uint8Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!land[s] || owner[s] >= 0 || seen[s]) continue;
    const comp = [s]; seen[s] = 1;
    let sx = 0, sy = 0;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % W, y = (i / W) | 0;
      sx += x; sy += y;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) if (j >= 0 && land[j] && owner[j] < 0 && !seen[j]) { seen[j] = 1; comp.push(j); }
    }
    const cx = sx / comp.length, cy = sy / comp.length;
    let best = 0, bd = Infinity;
    provinces.forEach((p, idx) => {
      const d = (p.label[0] - cx) ** 2 + (p.label[1] - cy) ** 2;
      if (d < bd) { bd = d; best = idx; }
    });
    for (const i of comp) owner[i] = best;
  }

  // Smooth the stair-stepped borders (labels only change; the coast never does).
  for (let pass = 0; pass < 3; pass++) {
    const next = owner.slice();
    const counts = new Int16Array(N);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (owner[i] < 0) continue;
        counts.fill(0);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const o = owner[i + dy * W + dx];
          if (o >= 0) counts[o]++;
        }
        let best = owner[i], bc = counts[best];
        for (let k = 0; k < N; k++) if (counts[k] > bc) { bc = counts[k]; best = k; }
        next[i] = best;
      }
    }
    owner.set(next);
  }

  // Border pixels: land pixels touching a land pixel of a different province.
  const border = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = owner[i];
      if (o < 0) continue;
      const r = x < W - 1 ? owner[i + 1] : -1;
      const d = y < H - 1 ? owner[i + W] : -1;
      if (r >= 0 && r !== o) { border[i] = 1; border[i + 1] = 1; }
      if (d >= 0 && d !== o) { border[i] = 1; border[i + W] = 1; }
    }
  }

  return { owner, border, land, ids: provinces.map((p) => p.id) };
}

module.exports = { buildTerritory };
