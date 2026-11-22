// NEON BAY — pedestrians.js
// Walking citizens for the sidewalks. They wander between road crossings,
// stop at corners, and flee when a car barrels at them or the wanted level
// climbs. Built from boxes and spheres, with a small palette of outfits so
// the crowd reads as a crowd, not a clone army.

(function () {
  'use strict';

  var THREE = window.THREE;
  var CFG = window.NB.CFG;

  var SKINS = [0xc98d64, 0xe8b98a, 0x8a5a34, 0xf0c8a0, 0x6a4a2a, 0xd9a075];
  var SHIRTS = [0xd93a4a, 0x35e0ff, 0xffb02e, 0x7a3a8a, 0x4a8a5a, 0xf0f0f0, 0x2a2a30, 0xff4fa3];
  var PANTS = [0x2a2a3a, 0x4a3a2a, 0x3a4a5a, 0x1a1a1a, 0x6a6a72];

  function makePedMesh(rng) {
    var g = new THREE.Group();
    var skin = rng.pick(SKINS);
    var shirt = rng.pick(SHIRTS);
    var pants = rng.pick(PANTS);
    var legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.8, 0.26), new THREE.MeshLambertMaterial({ color: pants }));
    legs.position.y = 0.4;
    g.add(legs);
    var torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.62, 0.3), new THREE.MeshLambertMaterial({ color: shirt }));
    torso.position.y = 1.11;
    torso.castShadow = true;
    g.add(torso);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), new THREE.MeshLambertMaterial({ color: skin }));
    head.position.y = 1.68;
    head.castShadow = true;
    g.add(head);
    // Hair cap.
    var hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshLambertMaterial({ color: rng.pick([0x1c1410, 0x2a1a12, 0x4a2a6e, 0x0f0c0a, 0x8a6a3a]) })
    );
    hair.position.y = 1.72;
    g.add(hair);
    // Arms swing while walking.
    var armMat = new THREE.MeshLambertMaterial({ color: skin });
    var armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.13), armMat);
    armL.position.set(-0.36, 1.12, 0);
    g.add(armL);
    var armR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.13), armMat);
    armR.position.set(0.36, 1.12, 0);
    g.add(armR);
    g.userData.armL = armL;
    g.userData.armR = armR;
    return g;
  }

  function spawnPeds(scene, world, rng, count) {
    var peds = [];
    for (var i = 0; i < count; i++) {
      var road = rng.pick(world.roadLines);
      var along = rng.range(-200, 200);
      var horizontal = rng.chance(0.5);
      var x = horizontal ? along : road + rng.pick([-9.5, 9.5]);
      var z = horizontal ? road + rng.pick([-9.5, 9.5]) : along;
      var mesh = makePedMesh(rng);
      mesh.position.set(x, 0, z);
      scene.add(mesh);
      peds.push({
        mesh: mesh, x: x, z: z,
        angle: rng.range(0, Math.PI * 2),
        speed: rng.range(1.2, 2.6),
        targetX: x, targetZ: z,
        wait: rng.range(0, 3),
        fleeing: false,
        walkPhase: rng.range(0, Math.PI * 2),
      });
    }
    return peds;
  }

  // Pick a fresh sidewalk destination near the pedestrian.
  function retarget(ped, world, rng) {
    var road = rng.pick(world.roadLines);
    var along = rng.range(-200, 200);
    if (rng.chance(0.5)) {
      ped.targetX = along;
      ped.targetZ = road + rng.pick([-9.5, 9.5]);
    } else {
      ped.targetX = road + rng.pick([-9.5, 9.5]);
      ped.targetZ = along;
    }
    ped.wait = 0;
  }

  function updatePeds(peds, world, player, wanted, dt, time) {
    peds.forEach(function (ped) {
      // Flee: a fast car close by, or high heat on the street.
      var pd = Math.hypot(player.x - ped.x, player.z - ped.z);
      var danger = (player.inCar && Math.abs(player.speed || 0) > 14 && pd < 12) || (wanted >= 3 && pd < 18);
      if (danger && !ped.fleeing) {
        ped.fleeing = true;
        var away = Math.atan2(ped.x - player.x, ped.z - player.z);
        ped.targetX = ped.x + Math.sin(away) * 40;
        ped.targetZ = ped.z + Math.cos(away) * 40;
        ped.speed = 5.2;
      }
      if (ped.wait > 0) {
        ped.wait -= dt;
        if (ped.wait <= 0) retarget(ped, world, window.NB.RNG.live);
      } else {
        var dx = ped.targetX - ped.x, dz = ped.targetZ - ped.z;
        var dist = Math.hypot(dx, dz);
        if (dist < 1.5) {
          if (ped.fleeing) { ped.fleeing = false; ped.speed = 1.8; }
          ped.wait = window.NB.RNG.live.range(1, 5);
        } else {
          var wantAngle = Math.atan2(dx, dz);
          var diff = wantAngle - ped.angle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          ped.angle += Math.max(-3 * dt, Math.min(3 * dt, diff));
          ped.x += Math.sin(ped.angle) * ped.speed * dt;
          ped.z += Math.cos(ped.angle) * ped.speed * dt;
          ped.walkPhase += dt * ped.speed * 3.2;
        }
      }
      var cl = world.clamp(ped.x, ped.z, 8);
      ped.x = cl.x; ped.z = cl.z;
      ped.mesh.position.set(ped.x, 0, ped.z);
      ped.mesh.rotation.y = ped.angle;
      // Walk-cycle arm swing and a small bob.
      var swing = Math.sin(ped.walkPhase) * 0.5;
      ped.mesh.userData.armL.rotation.x = swing;
      ped.mesh.userData.armR.rotation.x = -swing;
      ped.mesh.position.y = Math.abs(Math.sin(ped.walkPhase)) * 0.05;
      void time;
    });
  }

  // The player on foot, built the same way as a pedestrian but with Rook's
  // look: dark jacket, amber accent, and a visible held weapon.
  function makePlayerMesh() {
    var g = new THREE.Group();
    var skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
    var jacket = new THREE.MeshLambertMaterial({ color: 0x3a3f4a });
    var legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.8, 0.28), new THREE.MeshLambertMaterial({ color: 0x2a2a3a }));
    legs.position.y = 0.4;
    g.add(legs);
    var torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.64, 0.32), jacket);
    torso.position.y = 1.12;
    torso.castShadow = true;
    g.add(torso);
    // Amber stripe across the jacket so Rook is findable in a crowd.
    var stripe = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.34), new THREE.MeshBasicMaterial({ color: 0xffb02e }));
    stripe.position.y = 1.28;
    g.add(stripe);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), skin);
    head.position.y = 1.7;
    head.castShadow = true;
    g.add(head);
    var hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      new THREE.MeshLambertMaterial({ color: 0x1c1410 })
    );
    hair.position.y = 1.74;
    g.add(hair);
    var armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.56, 0.14), skin);
    armL.position.set(-0.38, 1.12, 0);
    g.add(armL);
    var armR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.56, 0.14), skin);
    armR.position.set(0.38, 1.12, 0);
    g.add(armR);
    // Held weapon prop, swapped by hud/weapon changes.
    var weapon = new THREE.Group();
    weapon.position.set(0.38, 0.95, 0.25);
    g.add(weapon);
    g.userData.armL = armL;
    g.userData.armR = armR;
    g.userData.weapon = weapon;
    return g;
  }

  // Swap the visible weapon prop in Rook's hand.
  function setPlayerWeapon(mesh, weaponDef) {
    var holder = mesh.userData.weapon;
    while (holder.children.length) holder.remove(holder.children[0]);
    if (!weaponDef || weaponDef.id === 'fists') return;
    var mat = new THREE.MeshLambertMaterial({ color: weaponDef.color });
    var prop;
    if (weaponDef.id === 'bat') {
      prop = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.9, 8), new THREE.MeshLambertMaterial({ color: 0x8a5a34 }));
      prop.rotation.x = 0.5;
    } else if (weaponDef.id === 'rpg') {
      prop = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 8), mat);
      prop.rotation.x = Math.PI / 2;
    } else if (weaponDef.id === 'shotgun') {
      prop = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.9), mat);
      prop.rotation.x = Math.PI / 2;
    } else {
      prop = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.45), mat);
      prop.rotation.x = Math.PI / 2;
    }
    holder.add(prop);
  }

  window.NB = window.NB || {};
  window.NB.Peds = {
    makePedMesh: makePedMesh,
    spawnPeds: spawnPeds,
    updatePeds: updatePeds,
    makePlayerMesh: makePlayerMesh,
    setPlayerWeapon: setPlayerWeapon,
  };
  void CFG;
})();
