// NEON BAY — tuned constants. All distances in metres, all speeds in m/s,
// all money in dollars. One place for every number the designers tune.
export const CFG = {
  seed: 1337,
  // City grid: 5 x 5 blocks, 72 m pitch, 56 m blocks, 16 m roads.
  blockPitch: 72,
  blockSize: 56,
  roadHalf: 8,
  cityHalf: 180,
  // West edge: beach strip then ocean.
  beachWest: -204,
  oceanWest: -204,
  // Playable clamp for the player.
  boundXMin: -200,
  boundXMax: 180,
  boundZMin: -180,
  boundZMax: 180,

  // Player on foot.
  walkSpeed: 4.5,
  runSpeed: 7.5,
  playerRadius: 0.6,
  playerHealth: 100,
  healthRegen: 2,
  healthRegenDelay: 10,

  // Cars: max speed, acceleration, brake, turn rate (rad/s at low speed).
  carClasses: {
    compact: { top: 26, accel: 11, brake: 14, turn: 2.4, price: 0 },
    sedan: { top: 31, accel: 12, brake: 15, turn: 2.2, price: 0 },
    sport: { top: 42, accel: 16, brake: 18, turn: 2.6, price: 0 },
    truck: { top: 23, accel: 8, brake: 12, turn: 1.8, price: 0 },
    police: { top: 38, accel: 15, brake: 18, turn: 2.6, price: 0 },
    taxi: { top: 31, accel: 12, brake: 15, turn: 2.2, price: 0 },
  },
  trafficCount: 20,
  parkedCount: 8,
  pedCount: 36,
  maxPolice: 5,

  // Wanted: heat 0..500, stars = heat / 100.
  heatMax: 500,
  heatPerStar: 100,
  stealHeat: 40,
  shotHeat: 15,
  pedShotHeat: 25,
  wreckHeat: 40,
  heatDecay: 3,
  heatDecayDelay: 5,
  bustedHold: 3,
  bustedFine: 500,
  wastedFine: 250,
  ramDamage: 8,
  ramCooldown: 1,

  // Combat.
  pistolRange: 60,
  pistolCooldown: 0.35,
  pistolDamage: 34,
  carHealth: 100,

  // Missions.
  missions: [
    {
      id: 'pickup',
      title: 'Misi 1 — Pengambilan',
      brief: 'Ambil paket di dermaga barat. Curi mobil biar cepat sampai.',
      pay: 300,
      beacon: [-150, 150],
    },
    {
      id: 'pursuit',
      title: 'Misi 2 — Pengejaran',
      brief: 'Polisi sudah menciummu. Kabur dan capai markas di timur kota.',
      pay: 800,
      beacon: [172, -148],
      startHeat: 200,
    },
    {
      id: 'drop',
      title: 'Misi 3 — Pengantaran',
      brief: 'Antar paket ke Club Neon di pusat kota. Jangan sampai ketangkap.',
      pay: 2500,
      beacon: [36, -24],
    },
  ],
  beaconRadius: 7,

  // Taxi.
  taxiBaseFare: 40,
  taxiPerMetre: 0.5,

  // Pickups.
  cashPickupValue: 50,
  healthPickupValue: 30,
  pickupRespawn: 60,
  pickupRadius: 3,

  // Camera.
  camFootDist: 7,
  camFootHeight: 3.2,
  camCarDist: 10.5,
  camCarHeight: 4.2,
  camFov: 60,
  camFovFast: 70,

  // Simulation.
  step: 1 / 60,
  maxStepsPerFrame: 8,

  // Screenshots and gates.
  shotWidth: 1280,
  shotHeight: 720,
  shotMaxBytes: 262144,

  saveKey: 'neonbay-save-v1',
};
