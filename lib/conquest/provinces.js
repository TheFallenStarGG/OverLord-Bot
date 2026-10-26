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
    { id: 'frostmere_haven', name: 'Frost Haven', x: 230, y: 110, tax: 25 },
    { id: 'frostmere_ridge', name: 'Ridgewatch', x: 280, y: 150, tax: 20 },
  ],
  northfen: [
    { id: 'northfen_mill', name: 'Fenmill', x: 420, y: 100, tax: 30 },
    { id: 'northfen_cross', name: 'Northcross', x: 480, y: 140, tax: 25 },
    { id: 'northfen_brook', name: 'Brookhold', x: 390, y: 130, tax: 20 },
  ],
  ironpass: [
    { id: 'ironpass_gate', name: 'Iron Gate', x: 250, y: 210, tax: 35 },
    { id: 'ironpass_forge', name: 'Forgehold', x: 300, y: 250, tax: 30 },
    { id: 'ironpass_camp', name: 'Pass Camp', x: 220, y: 240, tax: 20 },
  ],
  westmarch: [
    { id: 'westmarch_port', name: 'Westport', x: 125, y: 250, tax: 30 },
    { id: 'westmarch_cliff', name: 'Cliffside', x: 155, y: 300, tax: 20 },
  ],
  highcrown: [
    { id: 'highcrown_seat', name: 'Crownseat', x: 470, y: 205, tax: 45 },
    { id: 'highcrown_market', name: 'Highmarket', x: 510, y: 240, tax: 35 },
    { id: 'highcrown_abbey', name: 'Abbeyford', x: 440, y: 235, tax: 25 },
    { id: 'highcrown_keep', name: 'Keep of Crowns', x: 500, y: 195, tax: 40 },
  ],
  goldreach: [
    { id: 'goldreach_mint', name: 'The Mint', x: 600, y: 120, tax: 40 },
    { id: 'goldreach_harbor', name: 'Gold Harbor', x: 650, y: 150, tax: 35 },
    { id: 'goldreach_lane', name: 'Coinlane', x: 580, y: 145, tax: 25 },
  ],
  ashfield: [
    { id: 'ashfield_barn', name: 'Ashbarn', x: 290, y: 310, tax: 25 },
    { id: 'ashfield_well', name: 'Wellton', x: 340, y: 340, tax: 25 },
    { id: 'ashfield_road', name: 'Roadside', x: 260, y: 335, tax: 20 },
  ],
  sunbarrow: [
    { id: 'sunbarrow_hill', name: 'Sun Hill', x: 540, y: 270, tax: 30 },
    { id: 'sunbarrow_vale', name: 'Sunvale', x: 590, y: 300, tax: 25 },
    { id: 'sunbarrow_ford', name: 'Barrowford', x: 510, y: 295, tax: 25 },
  ],
  eastwatch: [
    { id: 'eastwatch_light', name: 'Eastlight', x: 760, y: 150, tax: 35 },
    { id: 'eastwatch_dock', name: 'Watchdock', x: 800, y: 185, tax: 30 },
  ],
  lowmoor: [
    { id: 'lowmoor_reed', name: 'Reedtown', x: 170, y: 400, tax: 20 },
    { id: 'lowmoor_bog', name: 'Bogkeep', x: 210, y: 440, tax: 20 },
  ],
  redgate: [
    { id: 'redgate_arch', name: 'The Arch', x: 390, y: 380, tax: 35 },
    { id: 'redgate_yard', name: 'Yardtown', x: 440, y: 410, tax: 30 },
    { id: 'redgate_south', name: 'Southgate', x: 370, y: 420, tax: 25 },
  ],
  southmere: [
    { id: 'southmere_bay', name: 'Southbay', x: 600, y: 360, tax: 30 },
    { id: 'southmere_pier', name: 'Pierhold', x: 650, y: 390, tax: 25 },
  ],
  stormcliff: [
    { id: 'stormcliff_spire', name: 'Stormspire', x: 780, y: 290, tax: 35 },
    { id: 'stormcliff_cove', name: 'Stormcove', x: 820, y: 330, tax: 30 },
    { id: 'stormcliff_ridge', name: 'Cliffridge', x: 750, y: 320, tax: 25 },
  ],
  blackshore: [
    { id: 'blackshore_docks', name: 'Black Docks', x: 420, y: 500, tax: 30 },
    { id: 'blackshore_sand', name: 'Sandholt', x: 500, y: 530, tax: 25 },
    { id: 'blackshore_inlet', name: 'Inlet Camp', x: 360, y: 520, tax: 20 },
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
