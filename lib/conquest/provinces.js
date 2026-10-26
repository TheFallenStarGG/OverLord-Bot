// Hand-placed provinces aligned to assets/conquest/base-map.png (1200×700).
// Geometry is fixed; only ownership/armies change at runtime.

const WIDTH = 1200;
const HEIGHT = 700;

/**
 * Polygons are clockwise, denser points for smoother borders.
 * label/army anchors sit on land only (not sea/lakes).
 */
const PROVINCES = {
  frostmere: {
    id: 'frostmere',
    name: 'Frostmere',
    short: 'Frostmere',
    poly: [
      [70, 50], [150, 42], [230, 48], [270, 90], [255, 150], [200, 175],
      [130, 170], [75, 140], [55, 95],
    ],
    label: [160, 105],
    army: [160, 135],
    neighbors: ['northfen', 'ironpass'],
  },
  northfen: {
    id: 'northfen',
    name: 'Northfen',
    short: 'Northfen',
    poly: [
      [230, 48], [340, 40], [450, 50], [500, 95], [470, 150], [380, 165],
      [300, 145], [270, 90],
    ],
    label: [370, 95],
    army: [370, 125],
    neighbors: ['frostmere', 'highcrown', 'ironpass', 'goldreach'],
  },
  ironpass: {
    id: 'ironpass',
    name: 'Ironpass',
    short: 'Ironpass',
    poly: [
      [75, 140], [130, 170], [200, 175], [255, 150], [300, 145], [320, 220],
      [280, 280], [200, 300], [120, 270], [70, 210],
    ],
    label: [190, 230],
    army: [190, 260],
    neighbors: ['frostmere', 'northfen', 'highcrown', 'ashfield', 'westmarch'],
  },
  highcrown: {
    id: 'highcrown',
    name: 'Highcrown',
    short: 'Highcrown',
    poly: [
      [300, 145], [380, 165], [470, 150], [520, 190], [500, 260], [420, 280],
      [340, 260], [320, 220],
    ],
    label: [410, 210],
    army: [410, 245],
    neighbors: ['northfen', 'ironpass', 'goldreach', 'sunbarrow', 'ashfield'],
  },
  westmarch: {
    id: 'westmarch',
    name: 'Westmarch',
    short: 'Westmarch',
    poly: [
      [40, 120], [70, 140], [70, 210], [120, 270], [110, 360], [60, 400],
      [35, 320], [30, 200],
    ],
    label: [70, 260],
    army: [75, 295],
    neighbors: ['ironpass', 'ashfield', 'lowmoor'],
  },
  ashfield: {
    id: 'ashfield',
    name: 'Ashfield',
    short: 'Ashfield',
    poly: [
      [120, 270], [200, 300], [280, 280], [340, 260], [380, 320], [360, 400],
      [280, 430], [180, 410], [130, 350],
    ],
    label: [250, 345],
    army: [250, 380],
    neighbors: ['ironpass', 'highcrown', 'westmarch', 'sunbarrow', 'redgate', 'lowmoor'],
  },
  goldreach: {
    id: 'goldreach',
    name: 'Goldreach',
    short: 'Goldreach',
    poly: [
      [450, 50], [580, 45], [680, 70], [700, 130], [650, 180], [560, 175],
      [520, 190], [470, 150], [500, 95],
    ],
    label: [590, 110],
    army: [590, 145],
    neighbors: ['northfen', 'highcrown', 'eastwatch', 'sunbarrow'],
  },
  sunbarrow: {
    id: 'sunbarrow',
    name: 'Sunbarrow',
    short: 'Sunbarrow',
    poly: [
      [340, 260], [420, 280], [500, 260], [560, 175], [650, 180], [680, 260],
      [640, 340], [540, 370], [440, 360], [380, 320],
    ],
    label: [520, 300],
    army: [520, 335],
    neighbors: ['highcrown', 'goldreach', 'ashfield', 'eastwatch', 'southmere', 'redgate'],
  },
  eastwatch: {
    id: 'eastwatch',
    name: 'Eastwatch',
    short: 'Eastwatch',
    poly: [
      [680, 70], [820, 60], [960, 90], [1020, 160], [960, 230], [820, 250],
      [700, 200], [700, 130],
    ],
    label: [860, 145],
    army: [860, 180],
    neighbors: ['goldreach', 'sunbarrow', 'stormcliff'],
  },
  lowmoor: {
    id: 'lowmoor',
    name: 'Lowmoor',
    short: 'Lowmoor',
    poly: [
      [60, 400], [110, 360], [130, 350], [180, 410], [200, 500], [140, 580],
      [70, 560], [45, 480],
    ],
    label: [120, 470],
    army: [125, 505],
    neighbors: ['westmarch', 'ashfield', 'redgate', 'blackshore'],
  },
  redgate: {
    id: 'redgate',
    name: 'Redgate',
    short: 'Redgate',
    poly: [
      [180, 410], [280, 430], [360, 400], [440, 360], [540, 370], [520, 470],
      [420, 520], [300, 530], [200, 500],
    ],
    label: [360, 450],
    army: [360, 485],
    neighbors: ['ashfield', 'sunbarrow', 'lowmoor', 'southmere', 'blackshore'],
  },
  southmere: {
    id: 'southmere',
    name: 'Southmere',
    short: 'Southmere',
    poly: [
      [440, 360], [540, 370], [640, 340], [720, 380], [700, 480], [600, 520],
      [520, 470],
    ],
    label: [600, 430],
    army: [600, 465],
    neighbors: ['sunbarrow', 'redgate', 'stormcliff', 'blackshore'],
  },
  stormcliff: {
    id: 'stormcliff',
    name: 'Stormcliff',
    short: 'Stormcliff',
    poly: [
      [700, 200], [820, 250], [960, 230], [1080, 280], [1060, 400], [900, 450],
      [780, 430], [720, 380], [680, 260],
    ],
    label: [880, 340],
    army: [880, 375],
    neighbors: ['eastwatch', 'sunbarrow', 'southmere'],
  },
  blackshore: {
    id: 'blackshore',
    name: 'Blackshore',
    short: 'Blackshore',
    poly: [
      [140, 580], [200, 500], [300, 530], [420, 520], [600, 520], [700, 480],
      [720, 580], [600, 650], [320, 660], [180, 640],
    ],
    label: [420, 580],
    army: [420, 615],
    neighbors: ['lowmoor', 'redgate', 'southmere'],
  },
};

const list = () => Object.values(PROVINCES);
const get = (id) => PROVINCES[id] || null;

function resolveName(text) {
  const q = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!q) return null;
  if (PROVINCES[q]) return PROVINCES[q];
  return (
    list().find((p) => p.id === q || p.name.toLowerCase().replace(/[^a-z0-9]/g, '') === q) ||
    list().find((p) => p.name.toLowerCase().includes(String(text || '').toLowerCase())) ||
    null
  );
}

function areNeighbors(a, b) {
  const p = get(a);
  return Boolean(p && p.neighbors.includes(b));
}

module.exports = {
  WIDTH,
  HEIGHT,
  PROVINCES,
  list,
  get,
  resolveName,
  areNeighbors,
};
