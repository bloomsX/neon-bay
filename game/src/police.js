// NEON BAY — police.js
// The wanted system and the Neon Bay PD. Stars rise when the player steals,
// shoots or rams police; they fall when the player stays out of sight.
// Police units chase, ram, flank and — at three stars and up — set
// roadblocks, while a helicopter with a searchlight orbits from three stars.

(function () {
  'use strict';

  var THREE = window.THREE;
  var CFG = window.NB.CFG;

  function makePoliceState() {
    return {
      stars: 0,
      hiddenTimer: 0,       // seconds since any unit last saw the player
      decayTimer: 0,
      units: [],            // police car objects (NB.Vehicles cars)
      heli: null,           // helicopter object or null
      heliAngle: 0,
      lastSeenX: 0, lastSeenZ: 0,
      bustedTimer: 0,
      roadblock: null,      // {x, z, angle, cars[]} while active
      sirenPhase: 0,
    };
  }

  function addStars(state, n, reason) {
    var before = state.stars;
    state.stars = Math.max(0, Math.min(CFG.WANTED.maxStars, state.stars + n));
    state.hiddenTimer = 0;
    state.decayTimer = 0;
    if (state.stars > before) {
      window.NB.HUD.notify('WANTED LEVEL ' + state.stars + ' — ' + (reason || 'NBPD alerted'), 'wanted');
      window.NB.Audio.sirenBurst();
    }
    return state.stars;
  }

  function clearStars(state) {
    state.stars = 0;
    state.hiddenTimer = 0;
    state.decayTimer = 0;
  }

  // Spawn the number of pursuit units the current star level calls for.
  function ensureUnits(state, scene, player) {
    var want = CFG.WANTED.unitsPerStar[state.stars] || 0;
    while (state.units.length < want) {
      var a = window.NB.RNG.live.range(0, Math.PI * 2);
      var d = 55 + window.NB.RNG.live.range(0, 30);
      var x = player.x + Math.sin(a) * d;
      var z = player.z + Math.cos(a) * d;
      // Keep spawns on a road so units do not appear inside buildings.
      var world = window.NB.state.world;
      x = world.nearestRoad(x).coord + window.NB.RNG.live.range(-3, 3);
      z = world.nearestRoad(z).coord + window.NB.RNG.live.range(-3, 3);
      var car = window.NB.Vehicles.makeCar('interceptor', x, z, Math.atan2(player.x - x, player.z - z), { police: true });
      car.tactic = 'chase';
      car.tacticTimer = window.NB.RNG.live.range(2, 5);
      scene.add(car.mesh);
      state.units.push(car);
    }
    // Remove surplus units when the heat drops.
    while (state.units.length > want) {
      var gone = state.units.pop();
      scene.remove(gone.mesh);
    }
  }

  function ensureHeli(state, scene, player) {
    var want = state.stars >= CFG.WANTED.heliAtStars;
    if (want && !state.heli) {
      var mesh = window.NB.Vehicles.makeHelicopterMesh();
      scene.add(mesh);
      state.heli = {
        mesh: mesh, x: player.x + 20, z: player.z - 20, y: CFG.POLICE.heliHeight,
        angle: 0, rotorSpin: 0,
      };
      window.NB.HUD.notify('NBPD HELICOPTER AIRBORNE — spotlight on you', 'wanted');
    } else if (!want && state.heli) {
      scene.remove(state.heli.mesh);
      state.heli = null;
    }
  }

  // A roadblock: two interceptor cars parked across the road ahead of the
  // player, plus a flare of brake lights. Only while heat is 3+.
  function ensureRoadblock(state, scene, player) {
    var want = state.stars >= CFG.WANTED.roadblockAtStars;
    if (!want) {
      if (state.roadblock) {
        state.roadblock.cars.forEach(function (c) { scene.remove(c.mesh); });
        state.roadblock = null;
      }
      return;
    }
    var world = window.NB.state.world;
    if (!state.roadblock) {
      var ahead = CFG.POLICE.roadblockAhead;
      var fx = Math.sin(player.angle), fz = Math.cos(player.angle);
      var bx = player.x + fx * ahead, bz = player.z + fz * ahead;
      var horizontal = Math.abs(fx) > Math.abs(fz);
      var cars = [];
      [-6, 6].forEach(function (off) {
        var cx = horizontal ? bx : bx + off;
        var cz = horizontal ? bz + off : bz;
        var car = window.NB.Vehicles.makeCar('interceptor', cx, cz, player.angle + Math.PI / 2, { police: true });
        car.speed = 0;
        scene.add(car.mesh);
        cars.push(car);
      });
      state.roadblock = { x: bx, z: bz, angle: player.angle, cars: cars, timer: 0 };
      window.NB.HUD.notify('NBPD ROADBLOCK AHEAD — break through or go around', 'wanted');
    }
  }

  // One police car, one tactic. Tactics rotate every few seconds:
  // chase (straight at the player), ram (overshoot then hit the flank),
  // flank (hold an offset and squeeze the player toward the kerb).
  function updateUnit(car, player, dt, time) {
    car.tacticTimer -= dt;
    if (car.tacticTimer <= 0) {
      car.tacticTimer = window.NB.RNG.live.range(3, 6);
      var roll = window.NB.RNG.live.next();
      var dist = Math.hypot(player.x - car.x, player.z - car.z);
      if (dist < CFG.POLICE.ramRange) car.tactic = 'ram';
      else if (roll < 0.45) car.tactic = 'chase';
      else if (roll < 0.75) car.tactic = 'flank';
      else car.tactic = 'ram';
    }
    var stars = window.NB.state.police.stars;
    var topSpeed = CFG.WANTED.chaseSpeed[stars] || 30;
    var tx = player.x, tz = player.z;
    if (car.tactic === 'flank') {
      var side = car === window.NB.state.police.units[0] ? 1 : -1;
      var px = Math.sin(player.angle), pz = Math.cos(player.angle);
      tx = player.x + (-pz * side * 8) + px * 6;
      tz = player.z + (px * side * 8) + pz * 6;
    } else if (car.tactic === 'ram') {
      tx = player.x + Math.sin(player.angle) * (player.speed || 0) * 0.6;
      tz = player.z + Math.cos(player.angle) * (player.speed || 0) * 0.6;
    }
    var dx = tx - car.x, dz = tz - car.z;
    var dist = Math.hypot(dx, dz) || 0.001;
    var wantAngle = Math.atan2(dx, dz);
    var diff = wantAngle - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    var steerRate = 2.6;
    car.angle += Math.max(-steerRate * dt, Math.min(steerRate * dt, diff));
    var closing = Math.abs(diff) < 0.6;
    var targetSpeed = closing ? topSpeed : topSpeed * 0.55;
    if (dist < 4) targetSpeed = topSpeed * 0.4; // ease off right at contact
    // While staging a screenshot, hold a loose ring instead of piling into
    // the player's car and covering it.
    if (window.NB.state.shotFreeze && dist < 12) targetSpeed = Math.min(targetSpeed, 6);
    car.speed += (targetSpeed - car.speed) * Math.min(1, dt * 1.6);
    car.x += Math.sin(car.angle) * car.speed * dt;
    car.z += Math.cos(car.angle) * car.speed * dt;
    var world = window.NB.state.world;
    var hit = world.collideCircle(car.x, car.z, 1.9);
    if (hit) {
      car.speed *= 0.4;
      car.angle += 0.6; // bounce off the wall and keep hunting
      var cl = world.clamp(car.x, car.z, 6);
      car.x = cl.x; car.z = cl.z;
    }
    window.NB.Vehicles.syncCarMesh(car, dt, false);
    void time;
    return dist;
  }

  function updateHeli(state, player, dt, time) {
    var heli = state.heli;
    if (!heli) return;
    state.heliAngle += dt * 0.35;
    var orbit = CFG.POLICE.heliOrbit;
    heli.x = player.x + Math.sin(state.heliAngle) * orbit;
    heli.z = player.z + Math.cos(state.heliAngle) * orbit;
    // Staged shots fly the helicopter lower so it is in frame.
    var height = heli.shotHeight || CFG.POLICE.heliHeight;
    heli.y = height + Math.sin(time * 0.8) * 1.5;
    heli.mesh.position.set(heli.x, heli.y, heli.z);
    heli.mesh.rotation.y = Math.atan2(player.x - heli.x, player.z - heli.z);
    heli.rotorSpin += dt * 28;
    heli.mesh.userData.rotor.rotation.y = heli.rotorSpin;
    heli.mesh.userData.rotor2.rotation.y = heli.rotorSpin;
    // Spotlight tracks the player; beacon blinks.
    var spot = heli.mesh.userData.spot;
    if (spot) {
      spot.target.position.set(player.x - heli.x, -heli.y, player.z - heli.z);
      spot.target.updateMatrixWorld();
    }
    var beacon = heli.mesh.userData.beacon;
    if (beacon) beacon.material.color.setHex(Math.floor(time * 2) % 2 === 0 ? 0xff2e3d : 0x550000);
    // The helicopter keeps the player "seen" — no hiding under it.
    state.hiddenTimer = 0;
  }

  // Main per-frame police update. Returns 'busted' when an officer catches
  // the player on foot, otherwise null.
  function updatePolice(state, scene, player, dt, time) {
    if (state.stars <= 0) {
      ensureUnits(state, scene, player);
      ensureHeli(state, scene, player);
      ensureRoadblock(state, scene, player);
      return null;
    }
    ensureUnits(state, scene, player);
    ensureHeli(state, scene, player);
    ensureRoadblock(state, scene, player);
    updateHeli(state, player, dt, time);

    var nearest = Infinity;
    state.units.forEach(function (car) {
      // While staging a screenshot the units hold their staged positions
      // (lights still flashing) so the composition never collapses.
      var d;
      if (window.NB.state.shotFreeze) {
        window.NB.Vehicles.syncCarMesh(car, dt, false);
        d = Math.hypot(car.x - player.x, car.z - player.z);
      } else {
        d = updateUnit(car, player, dt, time);
      }
      if (d < nearest) nearest = d;
      // A police car slamming the player's car damages it and adds heat.
      if (player.inCar && d < 3.4 && Math.abs(car.speed) > 6) {
        var pc = player.car;
        if (pc) pc.condition = Math.max(0, pc.condition - 2.5 * dt * 10);
        if (player.car && player.car.condition <= 0) {
          window.NB.HUD.notify('Your car is wrecked — get out and run', 'wanted');
        }
      }
    });

    // Out of sight: the nearest unit is far and the helicopter is gone.
    var seen = nearest < 70 || state.heli !== null;
    if (seen) {
      state.hiddenTimer = 0;
      state.decayTimer = 0;
      state.lastSeenX = player.x;
      state.lastSeenZ = player.z;
    } else {
      state.hiddenTimer += dt;
      if (state.hiddenTimer > CFG.WANTED.decayDelay) {
        state.decayTimer += dt;
        if (state.decayTimer > CFG.WANTED.decayStep) {
          state.decayTimer = 0;
          state.stars = Math.max(0, state.stars - 1);
          window.NB.HUD.notify('Heat dropping — ' + state.stars + ' star' + (state.stars === 1 ? '' : 's') + ' left', 'info');
        }
      }
    }

    // Busted: on foot, an officer touches the player while heat is high.
    if (!player.inCar && nearest < 2.2 && state.stars >= 2) {
      state.bustedTimer += dt;
      if (state.bustedTimer > 1.2) return 'busted';
    } else {
      state.bustedTimer = 0;
    }
    return null;
  }

  window.NB = window.NB || {};
  window.NB.Police = {
    makePoliceState: makePoliceState,
    addStars: addStars,
    clearStars: clearStars,
    updatePolice: updatePolice,
  };
})();
