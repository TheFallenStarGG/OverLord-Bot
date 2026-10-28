// Provinces traced to assets/conquest/base-map.png (971×651).
// Coordinates are pixel-exact for that file. Do not change WIDTH/HEIGHT
// unless you replace the base image with a new size.

const WIDTH = 971;
const HEIGHT = 651;

/**
 * Dense polygons follow land only (stay inside the green continent).
 * label / army anchors avoid sea, big mountain ink, and river mouths.
 */
const PROVINCES = {
  frostmere: {
    id: 'frostmere',
    name: 'Frostmere',
    short: 'Frostmere',
    poly: [
      [175, 95], [250, 78], [320, 85], [355, 120], [340, 165], [290, 185],
      [220, 175], [175, 145], [160, 115],
    ],
    label: [255, 125],
    army: [255, 155],
    neighbors: ['northfen', 'ironpass'],
  },
  northfen: {
    id: 'northfen',
    name: 'Northfen',
    short: 'Northfen',
    poly: [
      [320, 85], [420, 72], [520, 80], [580, 110], [560, 160], [480, 175],
      [400, 165], [355, 120],
    ],
    label: [450, 115],
    army: [450, 145],
    neighbors: ['frostmere', 'goldreach', 'highcrown', 'ironpass'],
  },
  ironpass: {
    id: 'ironpass',
    name: 'Ironpass',
    short: 'Ironpass',
    poly: [
      [160, 115], [175, 145], [220, 175], [290, 185], [340, 165], [355, 120],
      [400, 165], [390, 230], [340, 270], [270, 280], [200, 250], [155, 190],
    ],
    label: [275, 220],
    army: [275, 250],
    neighbors: ['frostmere', 'northfen', 'highcrown', 'ashfield', 'westmarch'],
  },
  westmarch: {
    id: 'westmarch',
    name: 'Westmarch',
    short: 'Westmarch',
    poly: [
      [95, 200], [140, 170], [155, 190], [200, 250], [195, 320], [150, 360],
      [105, 340], [85, 270],
    ],
    label: [140, 265],
    army: [145, 295],
    neighbors: ['ironpass', 'ashfield', 'lowmoor'],
  },
  highcrown: {
    id: 'highcrown',
    name: 'Highcrown',
    short: 'Highcrown',
    poly: [
      [400, 165], [480, 175], [560, 160], [580, 200], [560, 255], [500, 275],
      [430, 265], [390, 230],
    ],
    label: [485, 215],
    army: [485, 245],
    neighbors: ['northfen', 'ironpass', 'goldreach', 'sunbarrow', 'ashfield'],
  },
  goldreach: {
    id: 'goldreach',
    name: 'Goldreach',
    short: 'Goldreach',
    poly: [
      [520, 80], [620, 75], [700, 100], [720, 150], [680, 185], [600, 180],
      [580, 200], [560, 160], [580, 110],
    ],
    label: [620, 130],
    army: [620, 160],
    neighbors: ['northfen', 'highcrown', 'eastwatch', 'sunbarrow'],
  },
  ashfield: {
    id: 'ashfield',
    name: 'Ashfield',
    short: 'Ashfield',
    poly: [
      [200, 250], [270, 280], [340, 270], [390, 230], [430, 265], [420, 330],
      [360, 370], [280, 380], [210, 340],
    ],
    label: [310, 320],
    army: [310, 350],
    neighbors: ['ironpass', 'highcrown', 'westmarch', 'sunbarrow', 'redgate', 'lowmoor'],
  },
  sunbarrow: {
    id: 'sunbarrow',
    name: 'Sunbarrow',
    short: 'Sunbarrow',
    poly: [
      [430, 265], [500, 275], [560, 255], [600, 180], [680, 185], [700, 250],
      [660, 310], [560, 330], [480, 320], [420, 330],
    ],
    label: [560, 275],
    army: [560, 305],
    neighbors: ['highcrown', 'goldreach', 'ashfield', 'eastwatch', 'southmere', 'redgate'],
  },
  eastwatch: {
    id: 'eastwatch',
    name: 'Eastwatch',
    short: 'Eastwatch',
    poly: [
      [700, 100], [780, 95], [850, 130], [860, 190], [800, 230], [720, 220],
      [700, 250], [680, 185], [720, 150],
    ],
    label: [780, 160],
    army: [780, 195],
    neighbors: ['goldreach', 'sunbarrow', 'stormcliff'],
  },
  lowmoor: {
    id: 'lowmoor',
    name: 'Lowmoor',
    short: 'Lowmoor',
    poly: [
      [105, 340], [150, 360], [195, 320], [210, 340], [280, 380], [270, 460],
      [200, 500], [130, 470], [100, 410],
    ],
    label: [185, 410],
    army: [190, 440],
    neighbors: ['westmarch', 'ashfield', 'redgate', 'blackshore'],
  },
  redgate: {
    id: 'redgate',
    name: 'Redgate',
    short: 'Redgate',
    poly: [
      [280, 380], [360, 370], [420, 330], [480, 320], [560, 330], [540, 400],
      [460, 450], [360, 460], [290, 430],
    ],
    label: [410, 390],
    army: [410, 420],
    neighbors: ['ashfield', 'sunbarrow', 'lowmoor', 'southmere', 'blackshore'],
  },
  southmere: {
    id: 'southmere',
    name: 'Southmere',
    short: 'Southmere',
    poly: [
      [480, 320], [560, 330], [660, 310], [720, 340], [700, 420], [600, 450],
      [540, 400],
    ],
    label: [620, 370],
    army: [620, 400],
    neighbors: ['sunbarrow', 'redgate', 'stormcliff', 'blackshore'],
  },
  stormcliff: {
    id: 'stormcliff',
    name: 'Stormcliff',
    short: 'Stormcliff',
    poly: [
      [700, 250], [720, 220], [800, 230], [860, 190], [900, 250], [880, 340],
      [800, 380], [720, 340], [660, 310],
    ],
    label: [790, 300],
    army: [790, 335],
    neighbors: ['eastwatch', 'sunbarrow', 'southmere'],
  },
  blackshore: {
    id: 'blackshore',
    name: 'Blackshore',
    short: 'Blackshore',
    poly: [
      [200, 500], [270, 460], [290, 430], [360, 460], [460, 450], [600, 450],
      [700, 420], [720, 500], [600, 560], [400, 570], [250, 550],
    ],
    label: [450, 510],
    army: [450, 540],
    neighbors: ['lowmoor', 'redgate', 'southmere'],
  },
};

// Cities (2–4 per province by size). Positions are on land near each province.
const CITY_DEFS = {
  frostmere: [
    { id: 'frostmere_haven', name: 'Frost Haven', x: 210, y: 100, tax: 25 },
    { id: 'frostmere_ridge', name: 'Ridgewatch', x: 300, y: 155, tax: 20 },
  ],
  northfen: [
    { id: 'northfen_mill', name: 'Fenmill', x: 400, y: 95, tax: 30 },
    { id: 'northfen_cross', name: 'Northcross', x: 510, y: 125, tax: 25 },
    { id: 'northfen_brook', name: 'Brookhold', x: 370, y: 145, tax: 20 },
  ],
  ironpass: [
    { id: 'ironpass_gate', name: 'Iron Gate', x: 200, y: 195, tax: 35 },
    { id: 'ironpass_forge', name: 'Forgehold', x: 320, y: 240, tax: 30 },
    { id: 'ironpass_camp', name: 'Pass Camp', x: 240, y: 255, tax: 20 },
  ],
  westmarch: [
    { id: 'westmarch_port', name: 'Westport', x: 115, y: 230, tax: 30 },
    { id: 'westmarch_cliff', name: 'Cliffside', x: 145, y: 310, tax: 20 },
  ],
  highcrown: [
    { id: 'highcrown_seat', name: 'Crownseat', x: 445, y: 195, tax: 45 },
    { id: 'highcrown_market', name: 'Highmarket', x: 530, y: 235, tax: 35 },
    { id: 'highcrown_abbey', name: 'Abbeyford', x: 420, y: 245, tax: 25 },
    { id: 'highcrown_keep', name: 'Keep of Crowns', x: 505, y: 185, tax: 40 },
  ],
  goldreach: [
    { id: 'goldreach_mint', name: 'The Mint', x: 580, y: 105, tax: 40 },
    { id: 'goldreach_harbor', name: 'Gold Harbor', x: 665, y: 145, tax: 35 },
    { id: 'goldreach_lane', name: 'Coinlane', x: 600, y: 155, tax: 25 },
  ],
  ashfield: [
    { id: 'ashfield_barn', name: 'Ashbarn', x: 260, y: 300, tax: 25 },
    { id: 'ashfield_well', name: 'Wellton', x: 350, y: 340, tax: 25 },
    { id: 'ashfield_road', name: 'Roadside', x: 280, y: 355, tax: 20 },
  ],
  sunbarrow: [
    { id: 'sunbarrow_hill', name: 'Sun Hill', x: 520, y: 255, tax: 30 },
    { id: 'sunbarrow_vale', name: 'Sunvale', x: 580, y: 295, tax: 25 },
    { id: 'sunbarrow_ford', name: 'Barrowford', x: 490, y: 300, tax: 25 },
  ],
  eastwatch: [
    { id: 'eastwatch_light', name: 'Eastlight', x: 740, y: 140, tax: 35 },
    { id: 'eastwatch_dock', name: 'Watchdock', x: 785, y: 180, tax: 30 },
  ],
  lowmoor: [
    { id: 'lowmoor_reed', name: 'Reedtown', x: 155, y: 370, tax: 20 },
    { id: 'lowmoor_bog', name: 'Bogkeep', x: 185, y: 405, tax: 20 },
  ],
  redgate: [
    { id: 'redgate_arch', name: 'The Arch', x: 380, y: 370, tax: 35 },
    { id: 'redgate_yard', name: 'Yardtown', x: 445, y: 400, tax: 30 },
    { id: 'redgate_south', name: 'Southgate', x: 360, y: 415, tax: 25 },
  ],
    southmere: [
    { id: 'southmere_bay', name: 'Southbay', x: 555, y: 365, tax: 30 },
    { id: 'southmere_ford', name: 'Mereford', x: 600, y: 395, tax: 25 },
  ],
  stormcliff: [
    { id: 'stormcliff_peak', name: 'Stormpeak', x: 715, y: 295, tax: 30 },
    { id: 'stormcliff_cove', name: 'Stormcove', x: 745, y: 325, tax: 25 },
  ],
  blackshore: [
    { id: 'blackshore_inlet', name: 'Inlet Camp', x: 355, y: 455, tax: 25 },
    { id: 'blackshore_sand', name: 'Sandholt', x: 420, y: 470, tax: 25 },
  ],
};

for (const p of Object.values(PROVINCES)) {
  p.cities = CITY_DEFS[p.id] || [
    { id: `${p.id}_a`, name: `${p.short} Town`, x: p.label[0] - 15, y: p.label[1] + 20, tax: 20 },
    { id: `${p.id}_b`, name: `${p.short} Hold`, x: p.label[0] + 15, y: p.label[1] + 28, tax: 20 },
  ];
}

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

function allCities() {
  return list().flatMap((p) => (p.cities || []).map((c) => ({ ...c, provinceId: p.id })));
}

function cityById(id) {
  return allCities().find((c) => c.id === id) || null;
}

function resolveCity(text) {
  const q = String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!q) return null;
  return (
    allCities().find((c) => c.id === q || c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === q) ||
    allCities().find((c) => c.name.toLowerCase().includes(String(text || '').toLowerCase())) ||
    null
  );
}

module.exports = {
  WIDTH,
  HEIGHT,
  PROVINCES,
  list,
  get,
  resolveName,
  areNeighbors,
  allCities,
  cityById,
  resolveCity,
};
