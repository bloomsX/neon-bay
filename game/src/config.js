// NEON BAY — tuning, palette, city layout and content tables.
// One source of truth for world.js, render.js and the minimap: every system reads
// the same roads, blocks, districts and bounds, so the simulation, the 3D scene
// and the HUD can never drift apart. Nothing here is copied from any commercial
// game — the city, its districts, its people and its story are all invented.
//
// Layout: a 5x5 block grid on road centre lines -160..160 (pitch 64, roads 12
// wide). West is the docks, the centre is downtown, east is the beach and ocean.
export const STEP = 1 / 60;
export const SAVE_KEY = 'neon-bay.save.v1';

// --- City grid ---
export const ROAD = 12;
export const PITCH = 64;
export const CITY_HALF = 192;
export const ROAD_LINES = [-160, -96, -32, 32, 96, 160]; // road centre lines, both axes
export const BEACH_X = 192; // sand starts here
export const OCEAN_X = 238; // water starts here

/** Block (bx, bz) 0..4 -> { x0, z0, x1, z1 } in world units. */
export function blockRect(bx, bz) {
  const x0 = ROAD_LINES[bx] + ROAD / 2 + 2;
  const z0 = ROAD_LINES[bz] + ROAD / 2 + 2;
  const x1 = ROAD_LINES[bx + 1] - ROAD / 2 - 2;
  const z1 = ROAD_LINES[bz + 1] - ROAD / 2 - 2;
  return { x0, z0, x1, z1 };
}

// Downtown towers live on these four central blocks.
export const DOWNTOWN = [
  [2, 2], [2, 3], [3, 2], [3, 3],
];

/** Named districts, for the HUD: [x0, z0, x1, z1, name]. */
export const DISTRICTS = [
  [-192, -192, -96, 192, 'DOCKSIDE'],
  [-96, -192, 32, 192, 'OLD TOWN'],
  [32, -192, 160, 192, 'DOWNTOWN'],
  [160, -192, 238, 192, 'NEON BEACH'],
];
export function districtAt(x, z) {
  for (const [x0, z0, x1, z1, name] of DISTRICTS) {
    if (x >= x0 && x < x1 && z >= z0 && z < z1) return name;
  }
  return 'NEON BAY';
}

export const PLAYER = {
  walkSpeed: 6,
  runSpeed: 10.5,
  radius: 0.55,
  health: 100,
  enterRange: 4.5,
};

// --- Vehicle classes. Every car in the city is one of these; the class decides
// how it drives, so a stolen sports car really does outrun a taxi. ---
export const CAR_CLASSES = {
  sedan: { accel: 15, brake: 34, reverseAccel: 10, maxSpeed: 34, maxReverse: 9, grip: 5.5 },
  sport: { accel: 22, brake: 36, reverseAccel: 11, maxSpeed: 44, maxReverse: 10, grip: 6.5 },
  taxi: { accel: 13, brake: 34, reverseAccel: 9, maxSpeed: 31, maxReverse: 8, grip: 5.0 },
  truck: { accel: 10, brake: 30, reverseAccel: 8, maxSpeed: 27, maxReverse: 7, grip: 4.5 },
  police: { accel: 20, brake: 38, reverseAccel: 11, maxSpeed: 42, maxReverse: 10, grip: 6.0 },
};

export const CAR = {
  accel: 16,
  brake: 34,
  reverseAccel: 10,
  maxSpeed: 38,
  maxReverse: 9,
  grip: 5.5, // how fast velocity aligns to heading (arcade drift feel)
  radius: 1.6,
  trafficCount: 20,
  trafficSpeed: [8, 13],
  policeMaxSpeed: 42,
  sportChance: 0.22, // share of traffic that is a fast sports car
  taxiChance: 0.14, // share of traffic that is a taxi (stealable, slower)
};

export const PED = {
  count: 36,
  walkSpeed: [1.2, 2.2],
  fleeSpeed: 4.6,
  radius: 0.5,
};

export const WANTED = {
  maxStars: 5,
  stealHeat: 34,
  hitPedHeat: 30,
  shootHeat: 26,
  killHeat: 40,
  decayDelay: 9, // seconds with no crime and no police near before heat decays
  decayRate: 9, // heat per second while decaying
  starHeat: 25, // heat per star
  bustedHold: 2.5, // seconds a cop must stay close on foot to bust you
  roadblockStars: 4, // at this many stars the police park roadblocks ahead of you
};

export const COMBAT = {
  range: 70,
  damage: 34,
  fireInterval: 0.22,
  pedHealth: 34,
  policeCarHealth: 120,
  explosionDamage: 55, // a wrecked police car hurts anyone standing close
  explosionRadius: 7,
};

// --- The story: three missions across the city. ---
export const MISSIONS = [
  {
    id: 'pickup',
    title: 'MISI 1 — THE PICKUP',
    brief: 'Ambil paket di dermaga barat. Bawa mobil kalau mau cepat — curi saja.',
    beacon: { x: -172, z: 148 },
    reward: 300,
  },
  {
    id: 'pursuit',
    title: 'MISI 2 — HOT PURSUIT',
    brief: 'Polisi sudah mengendusmu. Kabur dan sampai ke markas timur sebelum ketangkap.',
    beacon: { x: 172, z: -148 },
    reward: 800,
    wantedOnStart: 2,
  },
  {
    id: 'drop',
    title: 'MISI 3 — THE DROP',
    brief: 'Antar paket ke Club Neon di pusat kota. Jangan sampai paketnya rusak — jangan sampai kamu ketangkap.',
    beacon: { x: 0, z: -8 },
    reward: 2500,
  },
];

// --- Side work: the taxi job. A fare flag appears on a sidewalk; drive a taxi
// (or any stolen car) to the passenger, then to their destination, for cash. ---
export const TAXI = {
  fareBase: 120,
  farePerMetre: 0.9,
  passengerWait: 45, // seconds a fare waits before walking away
  maxActive: 1,
};

export const PICKUPS = {
  cashCount: 8,
  cashValue: [50, 150],
  healthCount: 4,
  respawn: 60,
};

// --- Golden-hour palette. The whole city is graded from these. ---
export const PALETTE = {
  skyTop: '#2b1b4d',
  skyMid: '#b8455e',
  skyLow: '#ff9a3d',
  sun: '#ffd166',
  fog: '#c65a6e',
  asphalt: '#23232e',
  sidewalk: '#3a3a48',
  sand: '#e0b070',
  ocean: '#1d5f8a',
  oceanDeep: '#0d3a5c',
  building: ['#7a6a8f', '#8f6a7a', '#5f7a8f', '#9c7a5f', '#6a8f7a', '#8f8a5f', '#74628f', '#a05f6e'],
  glass: '#ffd166',
  player: '#ff2e88',
  playerCar: '#ff2e88',
  police: '#1c2733',
  taxi: '#ffc93c',
  neon: ['#ff2e88', '#2ec4ff', '#ffd94a', '#9dff3c', '#7a5cff', '#ff8a3c'],
};

export const NEON_SIGNS = [
  { text: 'CLUB NEON', color: '#ff2e88' },
  { text: 'NEON BAY', color: '#2ec4ff' },
  { text: 'SUNSET MOTEL', color: '#ffd94a' },
  { text: 'PIER 9', color: '#9dff3c' },
  { text: 'TACOS', color: '#ff8a3c' },
  { text: '24H DONUTS', color: '#7a5cff' },
];

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
