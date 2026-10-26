// Hand-placed realm map. Coordinates are pixels on a 1200×700 canvas.
// Geometry is fixed forever; only ownership/armies change.

const WIDTH = 1200;
const HEIGHT = 700;

/** @type {Record<string, { id: string, name: string, short: string, poly: number[][], label: number[], army: number[], neighbors: string[] }>} */
const PROVINCES = {
  frostmere: {
    id: 'frostmere',
    name: 'Frostmere',
    short: 'Frost',
    poly: [[80, 40], [280, 30], [320, 120], [260, 200], [100, 190], [40, 100]],
    label: [170, 110],
    army: [170, 145],
    neighbors: ['ironpass', 'northfen'],
  },
  northfen: {
    id: 'northfen',
    name: 'Northfen',
    short: 'N.Fen',
    poly: [[280, 30], [520, 40], [540, 140], [400, 180], [320, 120]],
    label: [400, 95],
    army: [400, 130],
    neighbors: ['frostmere', 'highcrown', 'ironpass'],
  },
  ironpass: {
    id: 'ironpass',
    name: 'Ironpass',
    short: 'Iron',
    poly: [[100, 190], [260, 200], [300, 300], [180, 340], [60, 280]],
    label: [180, 260],
    army: [180, 295],
    neighbors: ['frostmere', 'northfen', 'ashfield', 'westmarch'],
  },
  highcrown: {
    id: 'highcrown',
    name: 'Highcrown',
    short: 'Crown',
    poly: [[400, 180], [540, 140], [620, 200], [580, 300], [420, 290]],
    label: [510, 220],
    army: [510, 255],
    neighbors: ['northfen', 'goldreach', 'ashfield', 'sunbarrow'],
  },
  westmarch: {
    id: 'westmarch',
    name: 'Westmarch',
    short: 'West',
    poly: [[40, 100], [100, 190], [60, 280], [40, 420], [20, 300]],
    label: [55, 250],
    army: [70, 290],
    neighbors: ['ironpass', 'ashfield', 'lowmoor'],
  },
  ashfield: {
    id: 'ashfield',
    name: 'Ashfield',
    short: 'Ash',
    poly: [[180, 340], [300, 300], [420, 290], [440, 400], [280, 450], [160, 420]],
    label: [300, 365],
    army: [300, 400],
    neighbors: ['ironpass', 'highcrown', 'westmarch', 'sunbarrow', 'lowmoor', 'redgate'],
  },
  goldreach: {
    id: 'goldreach',
    name: 'Goldreach',
    short: 'Gold',
    poly: [[540, 140], [780, 90], [820, 200], [700, 260], [620, 200]],
    label: [700, 165],
    army: [700, 200],
    neighbors: ['highcrown', 'eastwatch', 'sunbarrow'],
  },
  sunbarrow: {
    id: 'sunbarrow',
    name: 'Sunbarrow',
    short: 'Sun',
    poly: [[420, 290], [580, 300], [700, 260], [720, 380], [560, 420], [440, 400]],
    label: [580, 340],
    army: [580, 375],
    neighbors: ['highcrown', 'goldreach', 'ashfield', 'redgate', 'southmere', 'eastwatch'],
  },
  eastwatch: {
    id: 'eastwatch',
    name: 'Eastwatch',
    short: 'East',
    poly: [[780, 90], [1120, 80], [1140, 220], [920, 280], [820, 200]],
    label: [960, 160],
    army: [960, 200],
    neighbors: ['goldreach', 'sunbarrow', 'stormcliff'],
  },
  lowmoor: {
    id: 'lowmoor',
    name: 'Lowmoor',
    short: 'Moor',
    poly: [[40, 420], [160, 420], [200, 520], [120, 620], [30, 540]],
    label: [100, 510],
    army: [110, 545],
    neighbors: ['westmarch', 'ashfield', 'redgate', 'blackshore'],
  },
  redgate: {
    id: 'redgate',
    name: 'Redgate',
    short: 'Red',
    poly: [[280, 450], [440, 400], [560, 420], [540, 540], [360, 560], [200, 520]],
    label: [400, 490],
    army: [400, 525],
    neighbors: ['ashfield', 'sunbarrow', 'lowmoor', 'southmere', 'blackshore'],
  },
  southmere: {
    id: 'southmere',
    name: 'Southmere',
    short: 'South',
    poly: [[560, 420], [720, 380], [800, 480], [700, 580], [540, 540]],
    label: [660, 480],
    army: [660, 515],
    neighbors: ['sunbarrow', 'redgate', 'stormcliff', 'blackshore'],
  },
  stormcliff: {
    id: 'stormcliff',
    name: 'Stormcliff',
    short: 'Storm',
    poly: [[720, 380], [920, 280], [1140, 220], [1100, 450], [800, 480]],
    label: [920, 370],
    army: [920, 410],
    neighbors: ['eastwatch', 'sunbarrow', 'southmere'],
  },
  blackshore: {
    id: 'blackshore',
    name: 'Blackshore',
    short: 'Black',
    poly: [[120, 620], [360, 560], [540, 540], [700, 580], [640, 680], [200, 680]],
    label: [400, 620],
    army: [400, 655],
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
    list().find((p) => p.short.toLowerCase().replace(/[^a-z0-9]/g, '') === q) ||
    list().find((p) => p.name.toLowerCase().includes(text.toLowerCase())) ||
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
