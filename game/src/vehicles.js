// NEON BAY — vehicles.js
// Car and helicopter factories, arcade driving physics with drift and
// collisions, traffic that cruises the road grid, and entering/exiting cars
// (including stealing). Every car is built from boxes and cylinders so the
// whole fleet is procedural — no model files, no outside assets.

(function () {
  'use strict';

  var THREE = window.THREE;
  var CFG = window.NB.CFG;

  // ------------------------------------------------------------------ build
  function makeWheel(radius, width) {
    var w = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, width, 12),
      new THREE.MeshLambertMaterial({ color: 0x141414 })
    );
    w.rotation.z = Math.PI / 2;
    var hub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, width + 0.06, 8),
      new THREE.MeshLambertMaterial({ color: 0x9a9a9a })
    );
    hub.rotation.z = Math.PI / 2;
    w.add(hub);
    return w;
  }

  // A low-poly car: body, cabin, wheels, headlights, taillights. `def` is a
  // CFG.CARS entry. `opts.police` adds the light bar; `opts.taxi` the sign.
  function makeCarMesh(def, opts) {
    opts = opts || {};
    var g = new THREE.Group();
    var bodyMat = new THREE.MeshLambertMaterial({ color: def.body });
    var trimMat = new THREE.MeshLambertMaterial({ color: def.trim });
    var glassMat = new THREE.MeshLambertMaterial({ color: 0x1a2a3a });

    var body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.4), bodyMat);
    body.position.y = 0.62;
    body.castShadow = true;
    g.add(body);
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), glassMat);
    cabin.position.set(0, 1.18, -0.2);
    cabin.castShadow = true;
    g.add(cabin);
    var roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 2.0), new THREE.MeshLambertMaterial({ color: def.roof }));
    roof.position.set(0, 1.5, -0.2);
    g.add(roof);
    // Bumpers.
    [-2.25, 2.25].forEach(function (z) {
      var b = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.22, 0.25), trimMat);
      b.position.set(0, 0.42, z);
      g.add(b);
    });
    // Wheels.
    var wheels = [];
    [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]].forEach(function (p) {
      var w = makeWheel(0.38, 0.3);
      w.position.set(p[0], 0.38, p[1]);
      g.add(w);
      wheels.push(w);
    });
    // Headlights and taillights.
    var headMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
    [-0.7, 0.7].forEach(function (x) {
      var h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), headMat);
      h.position.set(x, 0.72, 2.22);
      g.add(h);
      var t = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), new THREE.MeshBasicMaterial({ color: 0xff2e3d }));
      t.position.set(x, 0.72, -2.22);
      g.add(t);
    });
    if (opts.police) {
      var bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.4), new THREE.MeshLambertMaterial({ color: 0x222222 }));
      bar.position.set(0, 1.62, -0.2);
      g.add(bar);
      var blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.42), new THREE.MeshBasicMaterial({ color: CFG.PALETTE.policeBlue }));
      blue.position.set(-0.3, 1.62, -0.2);
      g.add(blue);
      var red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.42), new THREE.MeshBasicMaterial({ color: CFG.PALETTE.policeRed }));
      red.position.set(0.3, 1.62, -0.2);
      g.add(red);
      g.userData.lightBlue = blue;
      g.userData.lightRed = red;
      // White doors read as a police car from any distance.
      var doorMat = new THREE.MeshLambertMaterial({ color: 0xf0f0f0 });
      [-1.01, 1.01].forEach(function (x) {
        var door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 1.6), doorMat);
        door.position.set(x, 0.7, 0);
        g.add(door);
      });
    }
    if (opts.taxi) {
      var sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.4), new THREE.MeshBasicMaterial({ color: 0xffe94a }));
      sign.position.set(0, 1.66, -0.2);
      g.add(sign);
    }
    g.userData.wheels = wheels;
    return g;
  }

  function makeHelicopterMesh() {
    var g = new THREE.Group();
    var bodyMat = new THREE.MeshLambertMaterial({ color: CFG.PALETTE.heliBody });
    var body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 5.2), bodyMat);
    body.castShadow = true;
    g.add(body);
    var glass = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, 1.6), new THREE.MeshLambertMaterial({ color: 0x2a4a6a }));
    glass.position.set(0, 0.2, 2.0);
    g.add(glass);
    var tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 4.6), bodyMat);
    tail.position.set(0, 0.3, -4.4);
    g.add(tail);
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 1.2), bodyMat);
    fin.position.set(0, 1.0, -6.4);
    g.add(fin);
    var rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.5), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    rotor.position.y = 1.1;
    g.add(rotor);
    var rotor2 = rotor.clone();
    rotor2.rotation.y = Math.PI / 2;
    g.add(rotor2);
    g.userData.rotor = rotor;
    g.userData.rotor2 = rotor2;
    // Searchlight cone, aimed down.
    var spot = new THREE.SpotLight(0xfff2c0, 900, 120, 0.32, 0.5, 1.2);
    spot.position.set(0, -0.6, 0);
    var spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, -40, 0);
    g.add(spotTarget);
    spot.target = spotTarget;
    g.add(spot);
    g.userData.spot = spot;
    // A visible searchlight beam so the spotlight reads in a still frame.
    var beam = new THREE.Mesh(
      new THREE.ConeGeometry(4.5, 24, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.y = -12;
    g.add(beam);
    // Blinking beacon.
    var beacon = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2e3d }));
    beacon.position.set(0, -0.9, -1);
    g.add(beacon);
    g.userData.beacon = beacon;
    return g;
  }

  // ------------------------------------------------------------------ state
  function makeCar(defKey, x, z, angle, opts) {
    opts = opts || {};
    var def = CFG.CARS[defKey];
    var mesh = makeCarMesh(def, opts);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = angle;
    return {
      kind: 'car', defKey: defKey, def: def, mesh: mesh,
      x: x, z: z, angle: angle, speed: 0,
      steer: 0, condition: 100, isPlayer: !!opts.isPlayer,
      isPolice: !!opts.police, isTraffic: !!opts.traffic,
      route: opts.route || null, routeIdx: 0, routeSpeed: opts.routeSpeed || 12,
      color: def.body, parked: !!opts.parked, stolen: false,
      flashTimer: 0, brakeLight: false,
    };
  }

  // ------------------------------------------------------- arcade driving
  // Simple and forgiving: throttle accelerates, steering scales with speed,
  // handbrake (Space) cuts grip for a drift, walls push the car out.
  function driveCar(car, input, dt, world) {
    var def = car.def;
    var throttle = 0;
    if (input.forward) throttle += 1;
    if (input.back) throttle -= 0.7;
    var targetSteer = 0;
    if (input.left) targetSteer += 1;
    if (input.right) targetSteer -= 1;
    car.steer += (targetSteer - car.steer) * Math.min(1, dt * 8);

    var drifting = input.handbrake && Math.abs(car.speed) > 8;
    var grip = drifting ? def.grip * 0.45 : def.grip;

    if (throttle > 0) car.speed += def.accel * throttle * dt;
    else if (throttle < 0) car.speed += def.brake * throttle * dt;
    else {
      // Rolling drag.
      car.speed -= car.speed * 0.9 * dt;
      if (Math.abs(car.speed) < 0.2) car.speed = 0;
    }
    car.speed = Math.max(-def.topSpeed * 0.45, Math.min(def.topSpeed, car.speed));

    // Steering: sharper at low speed, planted at high speed, loose in drift.
    var steerAuthority = 1.9 * (1 - Math.min(0.55, Math.abs(car.speed) / def.topSpeed * 0.55));
    car.angle += car.steer * steerAuthority * (car.speed / def.topSpeed) * dt * (car.speed >= 0 ? 1 : -1) * grip * 1.6;

    var nx = car.x + Math.sin(car.angle) * car.speed * dt;
    var nz = car.z + Math.cos(car.angle) * car.speed * dt;
    var hit = world.collideCircle(nx, nz, 1.9);
    if (hit) {
      // Slide along the wall instead of sticking: kill the into-wall part.
      var px = car.x, pz = car.z;
      if (!world.collideCircle(nx, pz, 1.9)) { car.x = nx; }
      else if (!world.collideCircle(px, nz, 1.9)) { car.z = nz; }
      car.speed *= 0.55;
      car.condition = Math.max(0, car.condition - Math.abs(car.speed) * 0.12);
      car.flashTimer = 0.25;
    } else {
      car.x = nx; car.z = nz;
    }
    var clamped = world.clamp(car.x, car.z, 6);
    car.x = clamped.x; car.z = clamped.z;

    // Smoke puff flag when the car is badly damaged.
    car.smoking = car.condition < 35;
    syncCarMesh(car, dt, drifting);
  }

  function syncCarMesh(car, dt, drifting) {
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.angle;
    var spin = car.speed * dt * 2.4;
    (car.mesh.userData.wheels || []).forEach(function (w, i) {
      w.rotation.x += spin;
      // Front wheels steer visually.
      if (i < 2) w.rotation.y = car.steer * 0.4;
    });
    if (drifting) car.mesh.rotation.z = car.steer * 0.06;
    else car.mesh.rotation.z *= 0.8;
    if (car.isPolice) {
      car.flashTimer -= dt;
      var on = Math.floor(window.NB.state.time * 6) % 2 === 0;
      var blue = car.mesh.userData.lightBlue, red = car.mesh.userData.lightRed;
      if (blue) blue.material.color.setHex(on ? 0x2e6bff : 0x0a1a4a);
      if (red) red.material.color.setHex(on ? 0x4a0a12 : 0xff2e3d);
    }
  }

  // ------------------------------------------------------------ traffic AI
  // Traffic cars cruise the road grid: pick a road, drive to its end, turn
  // onto a perpendicular road, repeat. They brake for the car ahead.
  function spawnTraffic(scene, world, rng, count) {
    var cars = [];
    var keys = ['sedan', 'taxi', 'van', 'coupe'];
    for (var i = 0; i < count; i++) {
      var road = rng.pick(world.roadLines);
      var along = rng.range(-200, 200);
      var horizontal = rng.chance(0.5);
      var x = horizontal ? along : road + rng.pick([-3.5, 3.5]);
      var z = horizontal ? road + rng.pick([-3.5, 3.5]) : along;
      var angle = horizontal ? (rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : (rng.chance(0.5) ? 0 : Math.PI);
      var key = rng.pick(keys);
      var car = makeCar(key, x, z, angle, { traffic: true, routeSpeed: rng.range(9, 15) });
      // Repaint a few traffic cars from the paint pool for variety.
      if (rng.chance(0.4)) {
        var paint = rng.pick(CFG.TRAFFIC_PAINTS);
        car.mesh.children.forEach(function (child) {
          if (child.geometry && child.geometry.type === 'BoxGeometry' && child.position.y === 0.62) {
            child.material = new THREE.MeshLambertMaterial({ color: paint });
          }
        });
        car.color = paint;
      }
      car.speed = car.routeSpeed;
      scene.add(car.mesh);
      cars.push(car);
    }
    return cars;
  }

  function updateTraffic(cars, world, playerCar, dt) {
    cars.forEach(function (car) {
      // Brake if the player car is right ahead.
      var ahead = 0;
      if (playerCar) {
        var dx = playerCar.x - car.x, dz = playerCar.z - car.z;
        var dist = Math.sqrt(dx * dx + dz * dz);
        var fwd = Math.sin(car.angle) * dx + Math.cos(car.angle) * dz;
        if (dist < 14 && fwd > 0) ahead = 1;
      }
      var target = ahead ? 0 : car.routeSpeed;
      car.speed += (target - car.speed) * Math.min(1, dt * 2);
      var nx = car.x + Math.sin(car.angle) * car.speed * dt;
      var nz = car.z + Math.cos(car.angle) * car.speed * dt;
      // At the edge of the grid, turn onto a perpendicular road.
      if (Math.abs(nx) > 230 || Math.abs(nz) > 230) {
        car.angle += Math.PI / 2 * (window.NB.RNG.live.chance(0.5) ? 1 : -1);
        var cl = world.clamp(car.x, car.z, 30);
        car.x = cl.x; car.z = cl.z;
      } else {
        car.x = nx; car.z = nz;
      }
      // Nudge onto the nearest lane so traffic stays on roads.
      var rx = world.nearestRoad(car.x), rz = world.nearestRoad(car.z);
      if (Math.abs(Math.sin(car.angle)) > 0.7) {
        car.z += (rz.coord - car.z) * Math.min(1, dt * 0.8);
      } else {
        car.x += (rx.coord - car.x) * Math.min(1, dt * 0.8);
      }
      syncCarMesh(car, dt, false);
    });
  }

  // ------------------------------------------------------- enter / exit car
  function nearestCar(cars, x, z, maxDist) {
    var best = null, bd = maxDist;
    cars.forEach(function (c) {
      var d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    });
    return best;
  }

  window.NB = window.NB || {};
  window.NB.Vehicles = {
    makeCarMesh: makeCarMesh,
    makeHelicopterMesh: makeHelicopterMesh,
    makeCar: makeCar,
    driveCar: driveCar,
    syncCarMesh: syncCarMesh,
    spawnTraffic: spawnTraffic,
    updateTraffic: updateTraffic,
    nearestCar: nearestCar,
  };
})();
