// NEON BAY — shots.js
// Deterministic shot staging for the four screenshots. `?shot=cover`,
// `?shot=drive`, `?shot=chase` or `?shot=mission` puts the game in a fixed,
// seeded state — fixed player and police positions, a fixed mission stage,
// fixed dialogue — renders a few frames, then sets window.__shotReady so a
// capture harness knows the frame is settled. Nothing here is random at
// capture time: the same shot name always produces the same frame.

(function () {
  'use strict';

  var CFG = window.NB.CFG;

  function shotName() {
    try {
      var q = new URLSearchParams(window.location.search);
      return q.get('shot') || '';
    } catch (e) {
      return '';
    }
  }

  function isShotMode() { return shotName() !== ''; }

  // Put a police unit at a fixed offset from the player.
  function placeUnit(state, dx, dz, tactic) {
    var car = window.NB.Vehicles.makeCar('interceptor',
      state.player.x + dx, state.player.z + dz,
      Math.atan2(-dx, -dz), { police: true });
    car.tactic = tactic || 'chase';
    car.tacticTimer = 4;
    car.speed = 30;
    state.scene.add(car.mesh);
    state.police.units.push(car);
    return car;
  }

  function placeTrafficNear(state, list) {
    list.forEach(function (spec, i) {
      var car = state.traffic[i % state.traffic.length];
      if (!car) return;
      car.x = state.player.x + spec[0];
      car.z = state.player.z + spec[1];
      car.angle = spec[2];
      car.speed = spec[3] || 10;
      window.NB.Vehicles.syncCarMesh(car, 0, false);
    });
  }

  function placePedsNear(state, list) {
    list.forEach(function (spec, i) {
      var ped = state.peds[i % state.peds.length];
      if (!ped) return;
      ped.x = state.player.x + spec[0];
      ped.z = state.player.z + spec[1];
      ped.targetX = ped.x + spec[2];
      ped.targetZ = ped.z + spec[3];
      ped.mesh.position.set(ped.x, 0, ped.z);
    });
  }

  function setHeli(state) {
    if (state.police.heli) return;
    var mesh = window.NB.Vehicles.makeHelicopterMesh();
    state.scene.add(mesh);
    state.police.heli = {
      mesh: mesh, x: state.player.x + 18, z: state.player.z - 14,
      y: 15, angle: 0, rotorSpin: 0, shotHeight: 15,
    };
    // Ahead of the player so the helicopter is in frame, not overhead.
    state.police.heliAngle = 4.71;
  }

  function putPlayerInCar(state, defKey, x, z, angle, speed) {
    var car = window.NB.Vehicles.makeCar(defKey, x, z, angle, { isPlayer: true });
    car.speed = speed || 0;
    state.scene.add(car.mesh);
    state.player.car = car;
    state.player.inCar = true;
    state.player.x = x; state.player.z = z; state.player.angle = angle;
    state.player.speed = car.speed;
    state.playerMesh.visible = false;
    return car;
  }

  function startJob(state, index, stage) {
    window.NB.Missions.startMission(state.missions, state.scene, index);
    // Jump to the requested stage by advancing through the earlier ones.
    for (var i = 0; i < stage; i++) {
      window.NB.Missions.advanceStage(state.missions, state.scene);
    }
  }

  function applyShot(state, name) {
    var player = state.player;
    // Clear any live police/heli first so the shot is fully deterministic.
    state.police.units.forEach(function (u) { state.scene.remove(u.mesh); });
    state.police.units = [];
    if (state.police.heli) { state.scene.remove(state.police.heli.mesh); state.police.heli = null; }
    if (state.police.roadblock) {
      state.police.roadblock.cars.forEach(function (c) { state.scene.remove(c.mesh); });
      state.police.roadblock = null;
    }
    // Remove the player's starter car if one exists, then rebuild per shot.
    if (player.car) { state.scene.remove(player.car.mesh); player.car = null; }
    player.inCar = false;
    state.playerMesh.visible = true;

    if (name === 'cover') {
      // JOB 7 The Getaway, 5 stars, helicopter, roadblock ahead — facing
      // west down Sunset Strip (the z = 80 road) into the sunset.
      putPlayerInCar(state, 'comet', -40, 80, -Math.PI / 2, 34);
      startJob(state, 6, 2);
      state.police.stars = 5;
      placeUnit(state, -26, -14, 'ram');
      placeUnit(state, -30, 14, 'flank');
      placeUnit(state, 20, -14, 'chase');
      placeUnit(state, 24, 12, 'ram');
      setHeli(state);
      // Roadblock parked across the Strip ahead of the player (to the west).
      var rb1 = window.NB.Vehicles.makeCar('interceptor', -95, 72, 0, { police: true });
      var rb2 = window.NB.Vehicles.makeCar('interceptor', -95, 88, 0, { police: true });
      state.scene.add(rb1.mesh); state.scene.add(rb2.mesh);
      state.police.roadblock = { x: -95, z: 80, angle: -Math.PI / 2, cars: [rb1, rb2], timer: 0 };
      placeTrafficNear(state, [[-40, 3, -Math.PI / 2, 12], [34, -3, Math.PI / 2, 10], [-60, -3, -Math.PI / 2, 14]]);
      placePedsNear(state, [[-14, 10, 10, 0], [12, -10, -8, 0], [-24, 12, 6, 0], [18, 10, -6, 0]]);
      player.cash = 48250;
      player.health = 82;
      player.armour = 60;
      player.weaponIndex = 5;
      window.NB.HUD.showDialogue('LENA', 'Four stars, a helicopter, and half the department behind us. Drive, Rook. Just drive.');
      window.NB.HUD.notify('JOB 7 / 8 — THE GETAWAY  •  5 STARS  •  AIR-1 OVERHEAD', 'mission');
    } else if (name === 'drive') {
      // Street driving on Sunset Strip: traffic, pedestrians, no heat.
      putPlayerInCar(state, 'comet', 0, 40, 0, 22);
      startJob(state, 0, 1);
      state.police.stars = 0;
      placeTrafficNear(state, [[-4, 34, 0, 12], [4, -28, Math.PI, 11], [-3, 62, 0, 13], [5, 84, 0, 9]]);
      placePedsNear(state, [[-11, 18, 8, 0], [11, 44, -8, 0], [-11, -6, 6, 0], [11, -20, -6, 0], [-11, 70, 10, 0]]);
      player.cash = 1250;
      player.health = 100;
      player.armour = 25;
      player.weaponIndex = 2;
      window.NB.HUD.showDialogue('DARIO', 'Nice and easy through the Strip. Traffic is light, the sun is doing its thing. Enjoy it.');
      window.NB.HUD.notify('JOB 1 / 8 — FIRST WHEELS  •  DRIVE TO MARINA ROW', 'mission');
    } else if (name === 'chase') {
      // Close pursuit: 3 stars, helicopter, two units on the bumper —
      // heading east along Marina Row (z = -80 is a road).
      putPlayerInCar(state, 'comet', -40, -80, Math.PI / 2, 38);
      startJob(state, 1, 1);
      state.police.stars = 3;
      placeUnit(state, -14, 10, 'ram');
      placeUnit(state, -20, -8, 'chase');
      placeUnit(state, -8, -18, 'flank');
      setHeli(state);
      placeTrafficNear(state, [[-44, 4, Math.PI / 2, 12], [48, -4, -Math.PI / 2, 10]]);
      placePedsNear(state, [[-12, 10, 8, 0], [14, -10, -8, 0]]);
      player.cash = 8750;
      player.health = 74;
      player.armour = 40;
      player.weaponIndex = 3;
      window.NB.HUD.showDialogue('DARIO', 'They are right on you! Lose them at the pier — do NOT stop!');
      window.NB.HUD.notify('JOB 2 / 8 — SUNSET RUN  •  3 STARS  •  AIR-1 OVERHEAD', 'wanted');
    } else if (name === 'mission') {
      // On foot at the Docks, recovering the stash, 3-star heat. The
      // player stands back from the marker so it reads at a glance.
      player.x = 150; player.z = 166; player.angle = 0;
      player.inCar = false;
      player.speed = 0;
      state.playerMesh.visible = true;
      state.playerMesh.position.set(player.x, 0, player.z);
      state.playerMesh.rotation.y = player.angle;
      startJob(state, 4, 1);
      state.police.stars = 3;
      placeUnit(state, 26, -18, 'chase');
      placeUnit(state, -22, -26, 'flank');
      setHeli(state);
      placePedsNear(state, [[8, 10, -6, 0], [-9, 14, 6, 0], [14, -8, -8, 0]]);
      player.cash = 15400;
      player.health = 68;
      player.armour = 55;
      player.weaponIndex = 4;
      window.NB.HUD.showDialogue('COLE', 'Stash is in the container right there. Hold still, grab it, and we are gone. Three stars and counting.');
      window.NB.HUD.notify('JOB 5 / 8 — HARBOR LIGHTS  •  HOLD IN THE MARKER', 'mission');
    } else {
      return false;
    }

    // Snap the camera behind the player so the first rendered frame is the
    // composed one, not a fly-in.
    var cam = state.camera;
    var dist = player.inCar ? 13 : 9;
    var behind = player.angle + Math.PI;
    cam.position.set(
      player.x + Math.sin(behind) * dist,
      player.inCar ? 5.6 : 4.6,
      player.z + Math.cos(behind) * dist
    );
    cam.lookAt(player.x, 2.2, player.z);
    state.mode = 'playing';
    window.NB.HUD.showScreen('none');
    state.shotName = name;
    state.frames = 0;
    // Freeze the staged composition: the player car holds its speed, the
    // police keep hunting, but the player is never rammed out of frame.
    state.shotFreeze = true;
    return true;
  }

  window.NB = window.NB || {};
  window.NB.Shots = {
    shotName: shotName,
    isShotMode: isShotMode,
    applyShot: applyShot,
  };
})();
