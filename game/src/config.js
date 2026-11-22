// NEON BAY — config.js
// Every tunable constant, name, palette entry and mission definition for the
// game lives here. Nothing in this file reaches outside the game itself:
// no network addresses, no external assets, only numbers, strings and lists
// that the other modules read through window.NB.CFG.

(function () {
  'use strict';

  var CFG = {};

  // ---------------------------------------------------------------- identity
  CFG.GAME_TITLE = 'NEON BAY';
  CFG.GAME_TAGLINE = 'A sun-soaked open-world crime story';
  CFG.VERSION = '4.0.0';
  CFG.SAVE_KEY = 'neon-bay-save-v4';

  // ------------------------------------------------------------------ world
  CFG.WORLD = {
    size: 640,            // playable square, half-extent 320
    roadSpacing: 80,      // distance between parallel roads
    roadWidth: 14,
    blockSize: 66,
    roadCount: 5,         // roads per axis: -160, -80, 0, 80, 160
    beachX: -216,         // sand starts here (west edge)
    oceanX: -252,         // water starts here
    sunAzimuthDeg: 192,   // low sun over the ocean, golden hour (west)
    sunElevationDeg: 14,
    fogNear: 180,
    fogFar: 620,
    gravity: 30,
  };

  // ------------------------------------------------------------ sunset palette
  CFG.PALETTE = {
    skyTop: 0x2b3a6e,      // dusk violet high up
    skyMid: 0xff8c5a,      // orange band at the horizon
    skyLow: 0xffc46b,      // warm gold right above the sea
    sunCore: 0xfff2c0,
    sunHalo: 0xff9a3d,
    fog: 0xe8906a,
    ocean: 0x1d4e6b,
    oceanDeep: 0x123a52,
    sand: 0xe8c98f,
    sandWet: 0xc9a06a,
    asphalt: 0x33343a,
    asphaltLine: 0xf2e6a0,
    sidewalk: 0x9a938a,
    grass: 0x4f7a4a,
    buildingGlass: 0xffd27a,
    buildingRoof: 0x4a3f55,
    palmTrunk: 0x7a5a3c,
    palmLeaf: 0x2f8f4e,
    neonPink: 0xff4fa3,
    neonCyan: 0x35e0ff,
    neonAmber: 0xffb02e,
    policeBlue: 0x2e6bff,
    policeRed: 0xff2e3d,
    heliBody: 0x20242e,
  };

  // --------------------------------------------------------------- districts
  CFG.DISTRICTS = [
    { name: 'Coral Strand', x: -200, z: 0, r: 90, blurb: 'Beachfront bars and boardwalk lights' },
    { name: 'Marina Row', x: -80, z: -160, r: 90, blurb: 'Yachts, bait shops and quiet money' },
    { name: 'Palm Court', x: 80, z: -80, r: 90, blurb: 'Hotels, casinos and valet lines' },
    { name: 'The Docks', x: 120, z: 160, r: 100, blurb: 'Containers, cranes and no questions' },
    { name: 'Sunset Strip', x: -40, z: 120, r: 100, blurb: 'Neon, clubs and the loudest mile in town' },
  ];

  // -------------------------------------------------------------- characters
  CFG.CHARACTERS = {
    ROOK: {
      name: 'Rook', role: 'Wheelman', skin: 0xc98d64, hair: 0x1c1410,
      hairStyle: 'short', jacket: 0x3a3f4a, accent: 0xffb02e,
      bio: 'New in Neon Bay. Fast hands, faster car, no record yet.',
    },
    LENA: {
      name: 'Lena Voss', role: 'Fixer', skin: 0xe8b98a, hair: 0x2a1a12,
      hairStyle: 'long', jacket: 0x7a1f3d, accent: 0xff4fa3,
      bio: 'Runs the jobs in Neon Bay. Never raises her voice. Never pays late.',
    },
    DARIO: {
      name: 'Dario', role: 'Getaway Driver', skin: 0x8a5a34, hair: 0x0f0c0a,
      hairStyle: 'fade', jacket: 0x1f4d3a, accent: 0x35e0ff,
      bio: 'Knows every alley, every shortcut, every cop shift change.',
    },
    MINA: {
      name: 'Mina', role: 'Hacker', skin: 0xf0c8a0, hair: 0x4a2a6e,
      hairStyle: 'bob', jacket: 0x2a2a4a, accent: 0xb98cff,
      bio: 'Cameras, alarms, dispatch chatter. If it beeps, Mina owns it.',
    },
    COLE: {
      name: 'Cole', role: 'Muscle', skin: 0xd9a075, hair: 0x3a2a1a,
      hairStyle: 'buzz', jacket: 0x4a2a1a, accent: 0xff6a3d,
      bio: 'Opens doors. Sometimes the doors are people.',
    },
    OFFICER: {
      name: 'NBPD Officer', role: 'Neon Bay PD', skin: 0xc98d64, hair: 0x14100c,
      hairStyle: 'cap', jacket: 0x1a2a4a, accent: 0x2e6bff,
      bio: 'Neon Bay Police Department. Badges, sirens and long memories.',
    },
  };

  // ------------------------------------------------------------------- cars
  CFG.CARS = {
    comet: {
      name: 'Comet S', topSpeed: 46, accel: 26, brake: 42, grip: 0.92,
      body: 0xd93a4a, roof: 0x8f1f2e, trim: 0x222222,
      desc: 'Your ride. Quick, loud, paid for in cash.',
    },
    halcyon: {
      name: 'Halcyon GT', topSpeed: 58, accel: 32, brake: 48, grip: 0.95,
      body: 0xf2c230, roof: 0x1a1a1a, trim: 0x111111,
      desc: 'Gold coupe. Belongs to a man who should not own nice things.',
    },
    interceptor: {
      name: 'Interceptor', topSpeed: 52, accel: 30, brake: 46, grip: 0.94,
      body: 0x101418, roof: 0x101418, trim: 0xffffff,
      desc: 'NBPD pursuit unit. Black, white doors, no mercy.',
    },
    sedan: {
      name: 'Marlin Sedan', topSpeed: 34, accel: 16, brake: 30, grip: 0.9,
      body: 0x4a6a8a, roof: 0x3a5570, trim: 0x222222, desc: 'City traffic.',
    },
    taxi: {
      name: 'Bay Cab', topSpeed: 36, accel: 17, brake: 30, grip: 0.9,
      body: 0xf2c230, roof: 0xf2c230, trim: 0x222222, desc: 'City traffic.',
    },
    van: {
      name: 'Dock Van', topSpeed: 30, accel: 13, brake: 26, grip: 0.88,
      body: 0x8a8a86, roof: 0x77776f, trim: 0x222222, desc: 'City traffic.',
    },
    coupe: {
      name: 'Sunset Coupe', topSpeed: 40, accel: 20, brake: 34, grip: 0.91,
      body: 0x7a3a8a, roof: 0x5a2a6a, trim: 0x222222, desc: 'City traffic.',
    },
  };

  // Traffic paint pool, picked by seeded random at spawn time.
  CFG.TRAFFIC_PAINTS = [0x4a6a8a, 0x8a4a4a, 0x4a8a5a, 0x9a9a92, 0x2a2a30, 0x7a3a8a, 0xc0c0b8, 0x3a5a7a];

  // ---------------------------------------------------------------- weapons
  CFG.WEAPONS = [
    { key: '1', id: 'fists', name: 'FISTS', damage: 12, range: 2.2, rate: 0.45, auto: false, color: 0xd9a075 },
    { key: '2', id: 'bat', name: 'BAT', damage: 22, range: 2.6, rate: 0.6, auto: false, color: 0x8a5a34 },
    { key: '3', id: 'pistol', name: 'PISTOL', damage: 26, range: 55, rate: 0.32, auto: false, color: 0x333333 },
    { key: '4', id: 'smg', name: 'SMG', damage: 16, range: 48, rate: 0.09, auto: true, color: 0x222831 },
    { key: '5', id: 'shotgun', name: 'SHOTGUN', damage: 60, range: 22, rate: 0.9, auto: false, color: 0x5a2a1a },
    { key: '6', id: 'rifle', name: 'RIFLE', damage: 42, range: 90, rate: 0.14, auto: true, color: 0x2a3a2a },
    { key: '7', id: 'rpg', name: 'RPG', damage: 150, range: 70, rate: 1.6, auto: false, color: 0x4a4a2a },
  ];

  // ------------------------------------------------------------------- radio
  CFG.RADIO = [
    { name: 'BAY FM 88.1', genre: 'Sunset Pop', tempo: 112, root: 220 },
    { name: 'PALM 94.6', genre: 'Coast Rock', tempo: 128, root: 196 },
    { name: 'NEON 101.3', genre: 'Night Drive', tempo: 96, root: 174 },
    { name: 'DOCK 107.9', genre: 'Bass Line', tempo: 140, root: 146 },
  ];

  // ------------------------------------------------------------------ wanted
  CFG.WANTED = {
    maxStars: 5,
    decayDelay: 14,       // seconds fully out of sight before stars fall
    decayStep: 6,         // seconds per star lost while hidden
    heliAtStars: 3,
    roadblockAtStars: 3,
    unitsPerStar: [0, 1, 2, 3, 4, 5],
    chaseSpeed: [0, 30, 34, 38, 42, 46],
  };

  // --------------------------------------------------------------- police AI
  CFG.POLICE = {
    ramRange: 26,         // inside this, units ram instead of chase
    flankRange: 60,       // flankers hold an offset inside this band
    roadblockAhead: 55,   // roadblock parks this far ahead of the player
    sirenPitch: [660, 880],
    heliHeight: 42,
    heliOrbit: 26,
  };

  // ---------------------------------------------------------------- missions
  // Stages are short imperative objectives. `heat` is the wanted level the
  // job sets when its key stage begins. `reward` is cash on completion.
  CFG.MISSIONS = [
    {
      id: 1, title: 'First Wheels', giver: 'LENA', reward: 500, heat: 1,
      intro: 'Rook. You need wheels before you need friends. Take a car off Coral Strand and bring it to the lockup on Marina Row. Quietly.',
      stages: [
        { text: 'Steal a car on Coral Strand', hint: 'Walk up to a parked car and press E' },
        { text: 'Drive to the lockup on Marina Row', hint: 'Follow the yellow marker on the minimap' },
        { text: 'Park inside the lockup bay', hint: 'Stop inside the glowing ring' },
      ],
    },
    {
      id: 2, title: 'Sunset Run', giver: 'DARIO', reward: 900, heat: 2,
      intro: 'NBPD has your plate, kid. Outrun them to the end of the pier and lose them in the crowd. Do not stop. Do not look back.',
      stages: [
        { text: 'Get in a car and hit the Strip', hint: 'Any car. Yours is fastest' },
        { text: 'Reach the pier at Coral Strand', hint: 'Stay on the road, use the drift' },
        { text: 'Lose the heat at the pier', hint: 'Stay out of sight until the stars drop' },
      ],
    },
    {
      id: 3, title: 'The Drop', giver: 'LENA', reward: 1200, heat: 2,
      intro: 'A package is waiting in Palm Court. Pick it up, keep your head down, and drop it at the Sunset Strip. Two stars if you are sloppy.',
      stages: [
        { text: 'Pick up the package in Palm Court', hint: 'Walk into the glowing marker' },
        { text: 'Carry it to Sunset Strip', hint: 'On foot or by car, your call' },
        { text: 'Hand it off at the club door', hint: 'Cole is waiting. Do not keep him waiting' },
      ],
    },
    {
      id: 4, title: 'Courier Run', giver: 'MINA', reward: 1600, heat: 3,
      intro: 'I am driving the decoy. You escort me through the roadblock on Marina Row. If a unit gets close, you deal with it. Loud is fine.',
      stages: [
        { text: 'Meet Mina at Marina Row', hint: 'Her van is the grey one with the dent' },
        { text: 'Escort the van through the roadblock', hint: 'Ram the blockers or draw them off' },
        { text: 'Clear the road to the Docks', hint: 'Keep the van moving' },
      ],
    },
    {
      id: 5, title: 'Harbor Lights', giver: 'COLE', reward: 2200, heat: 3,
      intro: 'Stash is in a container at the Docks. NBPD is already sniffing around. Get in, grab it, get out. Bring the van if you can.',
      stages: [
        { text: 'Reach the container yard', hint: 'East side of the Docks' },
        { text: 'Recover the stash', hint: 'Hold still inside the marker for three seconds' },
        { text: 'Escape the Docks with the stash', hint: 'Three stars. Drive like you mean it' },
      ],
    },
    {
      id: 6, title: 'High Roller', giver: 'LENA', reward: 3500, heat: 3,
      intro: 'The Halcyon GT. Gold, loud, parked outside the Palm Court casino like its owner is untouchable. Prove him wrong. Bring it to me.',
      stages: [
        { text: 'Reach the casino on Palm Court', hint: 'The gold coupe is out front' },
        { text: 'Steal the Halcyon GT', hint: 'Press E. Expect alarms' },
        { text: 'Deliver the Halcyon GT to Lena', hint: 'Do not scratch it. Much.' },
      ],
    },
    {
      id: 7, title: 'The Getaway', giver: 'DARIO', reward: 5000, heat: 4,
      intro: 'Four stars, a helicopter, and half the department behind us. This is the one they tell stories about. Drive, Rook. Just drive.',
      stages: [
        { text: 'Outrun the first wave on Sunset Strip', hint: 'The helicopter is already up' },
        { text: 'Break through the roadblock', hint: 'Full speed. Do not brake' },
        { text: 'Reach the safehouse in Coral Strand', hint: 'Lose the tail before you park' },
      ],
    },
    {
      id: 8, title: 'Bay King', giver: 'LENA', reward: 10000, heat: 5,
      intro: 'Every unit in the city is coming for you. Five stars. One run from the Docks to the pier, and Neon Bay is yours. Make it count.',
      stages: [
        { text: 'Start the run at the Docks', hint: 'The whole city is watching' },
        { text: 'Survive the five-star chase', hint: 'Helicopter, roadblocks, everything' },
        { text: 'Reach the pier and end the chase', hint: 'Park at the end of the pier. Breathe' },
      ],
    },
  ];

  CFG.DIALOGUE = {
    missionStart: [
      'Job is live. Watch the marker, watch the clock.',
      'No heroics. Get in, get out, get paid.',
    ],
    stageDone: [
      'Good. Next step is on your map.',
      'Clean. Keep it moving.',
    ],
    missionDone: [
      'Paid. You are getting good at this, Rook.',
      'That is how you run Neon Bay.',
    ],
    busted: 'NBPD has you. The run ends here.',
    wasted: 'That is Neon Bay for you. Up. Again.',
  };

  // ------------------------------------------------------------- performance
  CFG.PERF = {
    maxTraffic: 12,
    maxPeds: 16,
    maxPolice: 5,
    shadowMap: 1024,
    pixelRatioCap: 1.5,
    targetFps: 60,
  };

  // ------------------------------------------------------------ camera / keys
  CFG.CAMERA = { distance: 11, height: 5.2, lookHeight: 2.2, fov: 62, lerp: 6 };
  CFG.PLAYER = { walkSpeed: 7, runSpeed: 11, radius: 0.9, health: 100, armour: 0 };

  window.NB = window.NB || {};
  window.NB.CFG = CFG;
})();
