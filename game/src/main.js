// NEON BAY — main.js
// Game loop, state machine and wiring. Owns the global state object, builds
// the scene, steps the player (on foot and in the car), combat, stealing,
// prompts, the save file and the menu / playing / paused / wasted states.
// Every other module is called from here; nothing else drives the frame.

(function () {
  'use strict';

  var CFG = window.NB.CFG;
  var THREE = window.THREE;

  var state = null;
  var renderer = null;
  var clock = { last: 0 };
  var tracer = null;      // fading shot tracer line
  var tracerLife = 0;
  var muzzle = null;
  var lastSave = 0;

  function makeState() {
    return {
      mode: 'menu',           // menu | playing | paused | wasted
      time: 0,
      seed: 20261122,
      scene: null, camera: null, world: null,
      player: {
        x: 0, z: 20, angle: 0, vx: 0, vz: 0, speed: 0,
        health: CFG.PLAYER.health, armour: 0, cash: 250,
        weaponIndex: 0, inCar: false, car: null,
        lastShot: 0, punchTimer: 0,
      },
      playerMesh: null,
      cars: [],               // all cars in the scene (player + parked)
      traffic: [],
      peds: [],
      police: window.NB.Police.makePoliceState(),
      missions: window.NB.Missions.makeMissionState(),
      radio: 0,
      orbit: window.NB.Input.orbit,
      shotName: '',
      frames: 0,
      fpsSamples: [],
    };
  }

  // ------------------------------------------------------------------- init
  function init() {
    state = makeState();
    window.NB.state = state;
    var container = document.getElementById('game');
    var scene = new THREE.Scene();
    state.scene = scene;
    state.world = window.NB.buildWorld(scene, state.seed);
    state.camera = window.NB.Render.createCamera();
    renderer = window.NB.Render.createRenderer(container);
    window.__renderer = renderer; // debug hook for the fps/stability tools
    window.NB.Render.createLights(scene, state.world);
    window.NB.HUD.buildHUD();
    window.NB.Input.attach();

    // Rook on foot.
    state.playerMesh = window.NB.Peds.makePlayerMesh();
    state.playerMesh.position.set(state.player.x, 0, state.player.z);
    scene.add(state.playerMesh);

    // The player's Comet S, parked on Coral Strand.
    var comet = window.NB.Vehicles.makeCar('comet', -8, 20, 0, { isPlayer: true });
    scene.add(comet.mesh);
    state.cars.push(comet);

    // Parked cars to steal around the city (mission 1 lives on these).
    var rng = window.NB.RNG.makeRng(state.seed + 7);
    var parkedDefs = ['sedan', 'coupe', 'taxi', 'van', 'sedan', 'coupe'];
    var parkedSpots = [
      [-176, 44, 0], [-160, -8, Math.PI / 2], [0, -44, 0], [84, -40, Math.PI],
      [-44, 84, Math.PI / 2], [120, 40, 0], [40, 120, Math.PI / 2], [-120, 160, 0],
    ];
    parkedSpots.forEach(function (s, i) {
      var car = window.NB.Vehicles.makeCar(parkedDefs[i % parkedDefs.length], s[0], s[1], s[2], { parked: true });
      scene.add(car.mesh);
      state.cars.push(car);
    });
    // The Halcyon GT outside the Palm Court casino (mission 6).
    var halcyon = window.NB.Vehicles.makeCar('halcyon', 80, -112, Math.PI / 2, { parked: true });
    scene.add(halcyon.mesh);
    state.cars.push(halcyon);
    void rng;

    // Traffic and pedestrians.
    state.traffic = window.NB.Vehicles.spawnTraffic(scene, state.world, window.NB.RNG.makeRng(state.seed + 11), CFG.PERF.maxTraffic);
    state.traffic.forEach(function (c) { state.cars.push(c); });
    state.peds = window.NB.Peds.spawnPeds(scene, state.world, window.NB.RNG.makeRng(state.seed + 13), CFG.PERF.maxPeds);

    // Tracer line for gunfire, hidden until a shot is fired.
    var tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    tracer = new THREE.Line(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe94a, transparent: true, opacity: 0 }));
    scene.add(tracer);
    muzzle = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0 })
    );
    scene.add(muzzle);

    window.addEventListener('resize', function () {
      window.NB.Render.resize(renderer, state.camera);
    });

    loadGame();
    window.NB.HUD.showScreen('start');
    window.NB.HUD.updateHUD(state, 0);

    // Shot mode: skip the menu and stage the requested frame.
    var shot = window.NB.Shots.shotName();
    if (shot) {
      window.NB.Audio.ensure();
      window.NB.Shots.applyShot(state, shot);
    }

    clock.last = performance.now();
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------- state flow
  function startGame() {
    window.NB.Audio.start();
    window.NB.Audio.uiBlip(880);
    if (state.mode === 'menu' && !state.missions.active && state.missions.index < CFG.MISSIONS.length) {
      window.NB.Missions.startMission(state.missions, state.scene, state.missions.index);
    }
    state.mode = 'playing';
    window.NB.HUD.showScreen('none');
    window.NB.HUD.notify('Welcome back to Neon Bay, Rook.', 'info');
  }

  function togglePause() {
    if (state.mode === 'playing') {
      state.mode = 'paused';
      window.NB.HUD.showScreen('pause');
      saveGame();
    } else if (state.mode === 'paused') {
      state.mode = 'playing';
      window.NB.HUD.showScreen('none');
    }
  }

  function wasted(reason) {
    if (state.mode === 'wasted') return;
    state.mode = 'wasted';
    state.player.cash = Math.max(0, state.player.cash - 200);
    state.player.health = 0;
    window.NB.Police.clearStars(state.police);
    if (state.missions.active) window.NB.Missions.failMission(state.missions, state.scene, reason || 'wasted');
    var el = document.getElementById('wasted-reason');
    if (el) el.textContent = reason || 'NBPD has you. The run ends here.';
    window.NB.HUD.showScreen('wasted');
    window.NB.Audio.crash();
    saveGame();
  }

  function respawn() {
    state.player.health = 100;
    state.player.armour = 0;
    state.player.x = -180; state.player.z = -60; state.player.angle = 0;
    state.player.speed = 0;
    if (state.player.car) { state.scene.remove(state.player.car.mesh); state.player.car = null; }
    state.player.inCar = false;
    state.playerMesh.visible = true;
    state.playerMesh.position.set(state.player.x, 0, state.player.z);
    state.mode = 'playing';
    window.NB.HUD.showScreen('none');
    window.NB.HUD.notify('You wake up at the Coral Strand safehouse. $200 hospital fee.', 'info');
    saveGame();
  }

  // -------------------------------------------------------------- save/load
  function saveGame() {
    try {
      var data = {
        cash: state.player.cash,
        missionIndex: state.missions.index,
        completed: state.missions.completed,
        earned: state.missions.earned,
        health: state.player.health,
        armour: state.player.armour,
        x: state.player.x, z: state.player.z,
        radio: state.radio,
      };
      localStorage.setItem(CFG.SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* storage may be unavailable; the game still runs */ }
  }

  function loadGame() {
    try {
      var raw = localStorage.getItem(CFG.SAVE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (typeof data.cash === 'number') state.player.cash = data.cash;
      if (typeof data.missionIndex === 'number') state.missions.index = Math.min(data.missionIndex, CFG.MISSIONS.length);
      if (typeof data.completed === 'number') state.missions.completed = data.completed;
      if (typeof data.earned === 'number') state.missions.earned = data.earned;
      if (typeof data.health === 'number') state.player.health = data.health;
      if (typeof data.armour === 'number') state.player.armour = data.armour;
      if (typeof data.x === 'number') state.player.x = data.x;
      if (typeof data.z === 'number') state.player.z = data.z;
      if (typeof data.radio === 'number') state.radio = data.radio;
      state.playerMesh.position.set(state.player.x, 0, state.player.z);
    } catch (e) { /* a corrupt save is ignored, the game starts fresh */ }
  }

  // ----------------------------------------------------------- player on foot
  function updateOnFoot(dt) {
    var p = state.player;
    var input = window.NB.Input.readDrive();
    var speed = input.run ? CFG.PLAYER.runSpeed : CFG.PLAYER.walkSpeed;
    var mx = 0, mz = 0;
    if (input.forward) { mx += Math.sin(p.angle); mz += Math.cos(p.angle); }
    if (input.back) { mx -= Math.sin(p.angle); mz -= Math.cos(p.angle); }
    if (input.left) p.angle += 2.6 * dt;
    if (input.right) p.angle -= 2.6 * dt;
    // Strafe with A/D while moving is handled by turning; Q/E are reserved.
    var moving = mx !== 0 || mz !== 0;
    var nx = p.x + mx * speed * dt;
    var nz = p.z + mz * speed * dt;
    var hit = state.world.collideCircle(nx, nz, CFG.PLAYER.radius);
    if (!hit) { p.x = nx; p.z = nz; }
    else {
      if (!state.world.collideCircle(nx, p.z, CFG.PLAYER.radius)) p.x = nx;
      else if (!state.world.collideCircle(p.x, nz, CFG.PLAYER.radius)) p.z = nz;
    }
    var cl = state.world.clamp(p.x, p.z, 4);
    p.x = cl.x; p.z = cl.z;
    p.vx = mx * speed; p.vz = mz * speed;
    p.speed = moving ? speed : 0;
    state.playerMesh.position.set(p.x, 0, p.z);
    state.playerMesh.rotation.y = p.angle;
    // Walk-cycle arm swing.
    var swing = moving ? Math.sin(state.time * 9) * 0.55 : 0;
    state.playerMesh.userData.armL.rotation.x = swing;
    state.playerMesh.userData.armR.rotation.x = -swing;
    // Punch animation.
    if (p.punchTimer > 0) {
      p.punchTimer -= dt;
      state.playerMesh.userData.armR.rotation.x = -1.4;
    }
  }

  // -------------------------------------------------------------- car access
  function tryEnterCar() {
    var p = state.player;
    var car = window.NB.Vehicles.nearestCar(state.cars, p.x, p.z, 4.5);
    if (!car || car.isTraffic) return;
    var stolen = !car.isPlayer && car.parked;
    p.car = car;
    p.inCar = true;
    p.speed = 0;
    car.isPlayer = true;
    car.parked = false;
    state.playerMesh.visible = false;
    window.NB.Audio.uiBlip(520);
    if (stolen) {
      car.stolen = true;
      window.NB.Police.addStars(state.police, 1, 'car stolen');
      window.NB.HUD.notify('You stole the ' + car.def.name + ' — NBPD alerted', 'wanted');
      window.NB.HUD.showDialogue('MINA', 'Nice. That plate is already flagged, so drive like you stole it. Because you did.');
    } else {
      window.NB.HUD.notify('In the ' + car.def.name, 'info');
    }
    window.NB.Missions.onCarEntered(state.missions, state.scene, car, stolen);
  }

  function exitCar() {
    var p = state.player;
    if (!p.car) return;
    var car = p.car;
    p.x = car.x + Math.sin(car.angle + Math.PI / 2) * 3;
    p.z = car.z + Math.cos(car.angle + Math.PI / 2) * 3;
    p.angle = car.angle;
    p.speed = 0;
    p.inCar = false;
    p.car = null;
    state.playerMesh.visible = true;
    state.playerMesh.position.set(p.x, 0, p.z);
    window.NB.Audio.uiBlip(440);
  }

  // ------------------------------------------------------------------ combat
  function fireWeapon() {
    var p = state.player;
    var now = state.time;
    var w = CFG.WEAPONS[p.weaponIndex];
    if (now - p.lastShot < w.rate) return;
    p.lastShot = now;
    if (w.id === 'fists' || w.id === 'bat') {
      p.punchTimer = 0.35;
      window.NB.Audio.uiBlip(180);
      // Melee hits the nearest pedestrian or police car in front.
      var best = null, bd = w.range;
      state.peds.forEach(function (ped) {
        var d = Math.hypot(ped.x - p.x, ped.z - p.z);
        if (d < bd) { bd = d; best = ped; }
      });
      if (best) {
        best.x += Math.sin(p.angle) * 2;
        best.z += Math.cos(p.angle) * 2;
        window.NB.Police.addStars(state.police, 1, 'assault on the street');
        window.NB.HUD.notify('That was loud. NBPD is coming.', 'wanted');
      }
      return;
    }
    // Ranged: hitscan toward facing, tracer line, damage to the first car or
    // pedestrian inside a narrow cone.
    window.NB.Audio.gunshot();
    var ox = p.x, oz = p.z;
    var oy = p.inCar ? 1.4 : 1.5;
    var dx = Math.sin(p.angle), dz = Math.cos(p.angle);
    var endX = ox + dx * w.range, endZ = oz + dz * w.range;
    var hitCar = null, hitD = w.range;
    state.cars.forEach(function (car) {
      if (car === p.car) return;
      var cx = car.x - ox, cz = car.z - oz;
      var along = cx * dx + cz * dz;
      if (along < 2 || along > w.range) return;
      var perp = Math.abs(cx * dz - cz * dx);
      if (perp < 2.4 && along < hitD) { hitD = along; hitCar = car; }
    });
    if (hitCar) {
      endX = ox + dx * hitD; endZ = oz + dz * hitD;
      hitCar.condition -= w.damage;
      window.NB.Audio.crash();
      if (hitCar.isPolice) window.NB.Police.addStars(state.police, 1, 'fired on NBPD');
      if (hitCar.condition <= 0) {
        state.scene.remove(hitCar.mesh);
        state.cars = state.cars.filter(function (c) { return c !== hitCar; });
        state.police.units = state.police.units.filter(function (c) { return c !== hitCar; });
        window.NB.HUD.notify('Unit disabled. That will cost you stars.', 'wanted');
      }
    }
    var pos = tracer.geometry.attributes.position.array;
    pos[0] = ox; pos[1] = oy; pos[2] = oz;
    pos[3] = endX; pos[4] = oy; pos[5] = endZ;
    tracer.geometry.attributes.position.needsUpdate = true;
    tracer.material.opacity = 0.95;
    tracerLife = 0.12;
    muzzle.position.set(ox + dx * 1.2, oy, oz + dz * 1.2);
    muzzle.material.opacity = 0.9;
    if (!p.inCar) window.NB.Police.addStars(state.police, 1, 'shots fired');
  }

  // ------------------------------------------------------------- per-frame
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.max(0, Math.min(0.05, (now - clock.last) / 1000 || 0.016));
    clock.last = now;
    if (state.mode === 'paused' || state.mode === 'menu') {
      // Menu still renders the city behind the start screen.
      state.time += dt * 0.2;
      renderer.render(state.scene, state.camera);
      return;
    }
    if (state.mode === 'wasted') {
      renderer.render(state.scene, state.camera);
      return;
    }
    state.time += dt;
    state.frames++;
    var p = state.player;

    // Edge-triggered keys.
    if (window.NB.Input.wasPressed('p') || window.NB.Input.wasPressed('escape')) { togglePause(); return; }
    if (window.NB.Input.wasPressed('m')) {
      var def = window.NB.Missions.currentDef(state.missions);
      if (def && !state.missions.active) window.NB.Missions.startMission(state.missions, state.scene, state.missions.index);
    }
    if (window.NB.Input.wasPressed('r')) {
      state.radio = (state.radio + 1) % CFG.RADIO.length;
      window.NB.HUD.notify('RADIO — ' + CFG.RADIO[state.radio].name + ' — ' + CFG.RADIO[state.radio].genre, 'info');
      window.NB.Audio.uiBlip(740);
    }
    if (window.NB.Input.wasPressed('q')) saveGame();
    var wi = window.NB.Input.anyWeaponKey();
    if (wi >= 0) {
      p.weaponIndex = wi;
      window.NB.Peds.setPlayerWeapon(state.playerMesh, CFG.WEAPONS[wi]);
      window.NB.Audio.uiBlip(600 + wi * 60);
    }
    if (window.NB.Input.wasPressed('e')) {
      if (window.NB.HUD && state.missions.active) window.NB.HUD.hideDialogue();
      if (p.inCar) exitCar();
      else tryEnterCar();
    }
    if (window.NB.Input.wasPressed('f') || window.NB.Input.keys.f) fireWeapon();

    // Movement. In shot mode the staged player car holds its speed and
    // position so the composed frame does not drift during capture.
    if (p.inCar && p.car) {
      if (!state.shotFreeze) window.NB.Vehicles.driveCar(p.car, window.NB.Input.readDrive(), dt, state.world);
      p.x = p.car.x; p.z = p.car.z; p.angle = p.car.angle; p.speed = p.car.speed;
      if (Math.abs(p.car.speed) > 40) window.NB.Police.addStars(state.police, 0, '');
      if (p.car.condition <= 0) {
        window.NB.HUD.notify('Your car is wrecked — get out and run', 'wanted');
        exitCar();
      }
    } else {
      updateOnFoot(dt);
    }

    // World systems.
    window.NB.Vehicles.updateTraffic(state.traffic, state.world, p.car, dt);
    window.NB.Peds.updatePeds(state.peds, state.world, p, state.police.stars, dt, state.time);
    window.NB.Missions.updateMissions(state.missions, state.scene, p, dt);
    var busted = window.NB.Police.updatePolice(state.police, state.scene, p, dt, state.time);
    if (busted === 'busted') { wasted('NBPD caught you on foot. Busted.'); return; }

    // Police ramming the player on foot hurts (not while staging a shot).
    if (!p.inCar && !state.shotFreeze) {
      state.police.units.forEach(function (u) {
        if (Math.hypot(u.x - p.x, u.z - p.z) < 2.4 && Math.abs(u.speed) > 8) {
          p.health -= 18 * dt * 5;
          window.NB.Audio.crash();
        }
      });
    }
    // Slow health regen when the heat is off.
    if (state.police.stars === 0 && p.health > 0 && p.health < 100) p.health = Math.min(100, p.health + 2 * dt);

    if (p.health <= 0) { wasted('You got caught in the crossfire. WASTED.'); return; }

    // Audio follows the game.
    var speedNorm = p.inCar && p.car ? Math.abs(p.car.speed) / p.car.def.topSpeed : 0;
    window.NB.Audio.setEngine(speedNorm, p.inCar);
    window.NB.Audio.setSiren(state.police.stars);

    // Context prompt: nearest car to enter.
    if (!p.inCar) {
      var near = window.NB.Vehicles.nearestCar(state.cars, p.x, p.z, 4.5);
      if (near && !near.isTraffic) {
        window.NB.HUD.setPrompt(near.parked ? 'E — STEAL ' + near.def.name.toUpperCase() : 'E — ENTER ' + near.def.name.toUpperCase());
      } else {
        window.NB.HUD.setPrompt('');
      }
    } else {
      window.NB.HUD.setPrompt('E — EXIT CAR    SPACE — DRIFT');
    }

    // Tracer fade.
    if (tracerLife > 0) {
      tracerLife -= dt;
      tracer.material.opacity = Math.max(0, tracerLife / 0.12) * 0.95;
      muzzle.material.opacity = Math.max(0, tracerLife / 0.12) * 0.9;
    }

    // Camera + HUD.
    window.NB.Render.updateCamera(state.camera, p, state.orbit, dt, p.inCar);
    window.NB.HUD.updateHUD(state, dt);

    // Autosave every 30 seconds of play.
    if (state.time - lastSave > 30) { lastSave = state.time; saveGame(); }

    // Shot readiness is frame-based, not clock-based, so a slow software
    // renderer still signals the harness after a settled number of frames.
    if (state.shotName && state.frames >= 30 && !window.__shotReady) {
      window.__shotReady = true;
    }

    renderer.render(state.scene, state.camera);
    window.NB.Input.consumePressed();
  }

  // Expose the internals the input handlers and the harness need.
  window.NB = window.NB || {};
  window.NB.Main = {
    init: init,
    startGame: startGame,
    togglePause: togglePause,
    respawn: respawn,
    wasted: wasted,
    saveGame: saveGame,
    loadGame: loadGame,
    getState: function () { return state; },
  };

  // Boot when the DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
