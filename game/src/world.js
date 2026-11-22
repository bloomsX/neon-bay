// NEON BAY — world.js
// Builds the whole city with three.js: the sunset sky and sun, the ocean and
// the beach, the road grid, the buildings with lit windows, the palms, the
// streetlights, the props and the mission markers. It also owns the collision
// list (building footprints) and the helpers that answer "which district am
// I in?" and "where is the nearest road?".

(function () {
  'use strict';

  var THREE = window.THREE;
  var CFG = window.NB.CFG;

  // A canvas texture of lit windows, painted once and reused by every
  // building so the city glows at golden hour without a light per window.
  function makeWindowTexture(rng, warm) {
    var c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = warm ? '#3a3348' : '#2e3442';
    g.fillRect(0, 0, 128, 256);
    var cols = 6, rows = 14;
    var cw = 128 / cols, ch = 256 / rows;
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var lit = rng.chance(0.55);
        if (lit) {
          var gold = rng.chance(0.7);
          g.fillStyle = gold ? '#ffd27a' : (rng.chance(0.5) ? '#9adfff' : '#ff9a5a');
          g.globalAlpha = 0.55 + rng.next() * 0.45;
        } else {
          g.fillStyle = '#141824';
          g.globalAlpha = 1;
        }
        g.fillRect(x * cw + 3, y * ch + 4, cw - 6, ch - 8);
      }
    }
    g.globalAlpha = 1;
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Asphalt with a dashed centre line, painted once and repeated along
  // every road — one texture replaces hundreds of little dash meshes.
  function makeRoadTexture() {
    var c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#46474f';
    g.fillRect(0, 0, 64, 128);
    g.fillStyle = '#f2e6a0';
    g.fillRect(30, 14, 4, 44);
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 10);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function makeNeonTexture(text, color) {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    var g = c.getContext('2d');
    g.fillStyle = '#14081c';
    g.fillRect(0, 0, 512, 96);
    g.font = 'bold 54px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 22;
    g.fillStyle = color;
    g.fillText(text, 256, 52);
    g.shadowBlur = 6;
    g.fillStyle = '#ffffff';
    g.fillText(text, 256, 52);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function buildWorld(scene, seed) {
    var rng = window.NB.RNG.makeRng(seed);
    var W = CFG.WORLD;
    var world = {
      colliders: [],        // {x, z, hw, hd} axis-aligned building footprints
      roadLines: [],        // road centre coordinates per axis
      palms: [],
      streetlights: [],
      beacons: {},          // named mission markers, filled by missions.js
      districtSigns: [],
      pier: null,
      rng: rng,
    };

    // ------------------------------------------------------------ sky + sun
    var skyCanvas = document.createElement('canvas');
    skyCanvas.width = 4; skyCanvas.height = 512;
    var sg = skyCanvas.getContext('2d');
    var grad = sg.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, '#2b3a6e');
    grad.addColorStop(0.35, '#7a4a8a');
    grad.addColorStop(0.62, '#ff7a4d');
    grad.addColorStop(0.8, '#ffc46b');
    grad.addColorStop(1.0, '#ffe9a8');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 4, 512);
    var skyTex = new THREE.CanvasTexture(skyCanvas);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
    );
    scene.add(sky);

    var sunDir = new THREE.Vector3(
      Math.cos(W.sunElevationDeg * Math.PI / 180) * Math.cos(W.sunAzimuthDeg * Math.PI / 180),
      Math.sin(W.sunElevationDeg * Math.PI / 180),
      Math.cos(W.sunElevationDeg * Math.PI / 180) * Math.sin(W.sunAzimuthDeg * Math.PI / 180)
    );
    var sun = new THREE.Mesh(
      new THREE.CircleGeometry(46, 32),
      new THREE.MeshBasicMaterial({ color: CFG.PALETTE.sunCore, fog: false })
    );
    sun.position.copy(sunDir).multiplyScalar(820);
    sun.lookAt(0, 0, 0);
    scene.add(sun);
    var halo = new THREE.Mesh(
      new THREE.CircleGeometry(90, 32),
      new THREE.MeshBasicMaterial({ color: CFG.PALETTE.sunHalo, transparent: true, opacity: 0.28, fog: false })
    );
    halo.position.copy(sunDir).multiplyScalar(815);
    halo.lookAt(0, 0, 0);
    scene.add(halo);
    world.sunDir = sunDir;

    scene.fog = new THREE.Fog(CFG.PALETTE.fog, W.fogNear, W.fogFar);

    // ------------------------------------------------------------ ground
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(W.size * 2.4, W.size * 2.4),
      new THREE.MeshLambertMaterial({ color: 0x7d7668 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    scene.add(ground);

    // Beach sand strip on the west edge, then the ocean beyond it.
    var sand = new THREE.Mesh(
      new THREE.PlaneGeometry(70, W.size * 1.4),
      new THREE.MeshLambertMaterial({ color: CFG.PALETTE.sand })
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(W.beachX - 18, 0.0, 0);
    scene.add(sand);
    var wetSand = new THREE.Mesh(
      new THREE.PlaneGeometry(10, W.size * 1.4),
      new THREE.MeshLambertMaterial({ color: CFG.PALETTE.sandWet })
    );
    wetSand.rotation.x = -Math.PI / 2;
    wetSand.position.set(W.oceanX + 6, 0.02, 0);
    scene.add(wetSand);
    var ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(420, W.size * 1.6),
      new THREE.MeshLambertMaterial({ color: CFG.PALETTE.ocean, transparent: true, opacity: 0.94 })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(W.oceanX - 200, 0.05, 0);
    scene.add(ocean);
    world.ocean = ocean;

    // Sun glitter: a long bright strip on the water pointing at the sun.
    var glitter = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 300),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.35 })
    );
    glitter.rotation.x = -Math.PI / 2;
    glitter.position.set(W.oceanX - 60, 0.08, 0);
    scene.add(glitter);
    world.glitter = glitter;

    // ---------------------------------------------------------------- roads
    var roadTex = makeRoadTexture();
    var roadTexEW = makeRoadTexture();
    roadTexEW.rotation = Math.PI / 2;
    roadTexEW.center.set(0.5, 0.5);
    var roadMatNS = new THREE.MeshLambertMaterial({ map: roadTex });
    var roadMatEW = new THREE.MeshLambertMaterial({ map: roadTexEW });
    var walkMat = new THREE.MeshLambertMaterial({ color: CFG.PALETTE.sidewalk });
    var roadCoords = [];
    for (var i = 0; i < W.roadCount; i++) roadCoords.push(-160 + i * W.roadSpacing);
    world.roadLines = roadCoords;
    var half = W.size / 2;
    roadCoords.forEach(function (c) {
      var ns = new THREE.Mesh(new THREE.PlaneGeometry(W.roadWidth, W.size), roadMatNS);
      ns.rotation.x = -Math.PI / 2;
      ns.position.set(c, 0.06, 0);
      scene.add(ns);
      var ew = new THREE.Mesh(new THREE.PlaneGeometry(W.size, W.roadWidth), roadMatEW);
      ew.rotation.x = -Math.PI / 2;
      ew.position.set(0, 0.06, c);
      scene.add(ew);
      // Sidewalks flanking each road.
      [-1, 1].forEach(function (s) {
        var swNS = new THREE.Mesh(new THREE.PlaneGeometry(4, W.size), walkMat);
        swNS.rotation.x = -Math.PI / 2;
        swNS.position.set(c + s * (W.roadWidth / 2 + 2), 0.04, 0);
        scene.add(swNS);
        var swEW = new THREE.Mesh(new THREE.PlaneGeometry(W.size, 4), walkMat);
        swEW.rotation.x = -Math.PI / 2;
        swEW.position.set(0, 0.04, c + s * (W.roadWidth / 2 + 2));
        scene.add(swEW);
      });
    });

    // -------------------------------------------------------------- buildings
    var winTexA = makeWindowTexture(rng, true);
    var winTexB = makeWindowTexture(rng, false);
    var roofMat = new THREE.MeshLambertMaterial({ color: CFG.PALETTE.buildingRoof });
    var sideColors = [0x8a6a7a, 0x6a7a8a, 0x9a7a5a, 0x7a6a9a, 0x5a7a6a, 0xb08a6a, 0x8a8a7a];
    var blockCenters = [];
    for (var bx = 0; bx < W.roadCount - 1; bx++) {
      for (var bz = 0; bz < W.roadCount - 1; bz++) {
        var cx = -160 + bx * W.roadSpacing + W.roadSpacing / 2;
        var cz = -160 + bz * W.roadSpacing + W.roadSpacing / 2;
        if (cx < -180) continue; // keep the beach clear
        blockCenters.push({ x: cx, z: cz });
      }
    }
    blockCenters.forEach(function (bc, bi) {
      var n = rng.int(1, 3);
      for (var k = 0; k < n; k++) {
        var w = rng.range(14, 26), d = rng.range(14, 26);
        var h = rng.pick([rng.range(9, 16), rng.range(16, 30), rng.range(30, 58)]);
        var ox = rng.range(-16, 16), oz = rng.range(-16, 16);
        var x = bc.x + ox, z = bc.z + oz;
        var side = new THREE.MeshLambertMaterial({ color: rng.pick(sideColors) });
        var winTex = rng.chance(0.5) ? winTexA : winTexB;
        var win = new THREE.MeshLambertMaterial({
          map: winTex,
          emissive: 0xffffff, emissiveMap: winTex,
          emissiveIntensity: 0.85,
        });
        // One material for the whole box (one draw call) plus a thin roof
        // slab so the top reads as a roof, not windows.
        var b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), win);
        b.position.set(x, h / 2, z);
        scene.add(b);
        var slab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6), roofMat);
        slab.position.set(x, h + 0.25, z);
        scene.add(slab);
        void side;
        world.colliders.push({ x: x, z: z, hw: w / 2 + 0.4, hd: d / 2 + 0.4 });
        // Rooftop beacon light on the tallest towers.
        if (h > 34) {
          var beacon = new THREE.Mesh(
            new THREE.SphereGeometry(0.7, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xff2e3d })
          );
          beacon.position.set(x, h + 0.8, z);
          scene.add(beacon);
        }
        // A few buildings get a neon sign facing the street.
        if (rng.chance(0.22)) {
          var signText = rng.pick(['NEON BAY', 'PALM COURT', 'SUNSET', 'MARINA', 'CORAL', 'BAY CLUB', 'HOTEL LUX', 'DOCK 9']);
          var signColor = rng.pick(['#ff4fa3', '#35e0ff', '#ffb02e', '#b98cff']);
          var sign = new THREE.Mesh(
            new THREE.PlaneGeometry(16, 3),
            new THREE.MeshBasicMaterial({ map: makeNeonTexture(signText, signColor), transparent: true })
          );
          sign.position.set(x, Math.min(h - 2, 14), z + d / 2 + 0.15);
          scene.add(sign);
        }
      }
      void bi;
    });

    // ------------------------------------------------------------- the pier
    var pier = new THREE.Group();
    var pierDeck = new THREE.Mesh(
      new THREE.BoxGeometry(70, 1.2, 10),
      new THREE.MeshLambertMaterial({ color: 0x8a6a4a })
    );
    pierDeck.position.set(-252, 0.6, 0);
    pier.add(pierDeck);
    for (var p = 0; p < 8; p++) {
      var post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 3, 6),
        new THREE.MeshLambertMaterial({ color: 0x5a4632 })
      );
      post.position.set(-222 - p * 8, -0.6, p % 2 === 0 ? 4.4 : -4.4);
      pier.add(post);
    }
    var pierSign = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 3.4),
      new THREE.MeshBasicMaterial({ map: makeNeonTexture('CORAL PIER', '#35e0ff'), transparent: true })
    );
    pierSign.position.set(-222, 7, 0);
    pier.add(pierSign);
    scene.add(pier);
    world.pier = pier;

    // ---------------------------------------------------------------- palms
    // Instanced: one trunk draw call and one leaf draw call for every palm
    // in the city, instead of seven meshes per tree.
    var trunkMat = new THREE.MeshLambertMaterial({ color: CFG.PALETTE.palmTrunk });
    var leafMat = new THREE.MeshLambertMaterial({ color: CFG.PALETTE.palmLeaf });
    var palmSpots = [];
    roadCoords.forEach(function (c) {
      for (var d = -220; d <= 220; d += 40) {
        if (rng.chance(0.5)) palmSpots.push([c + 11, d + rng.range(-6, 6)]);
        if (rng.chance(0.5)) palmSpots.push([d + rng.range(-6, 6), c + 11]);
      }
    });
    for (var s = 0; s < 14; s++) palmSpots.push([rng.range(-212, -196), rng.range(-220, 220)]);
    var trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 7, 6);
    var trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
    var leafGeo = new THREE.ConeGeometry(1.1, 4.4, 4);
    var leaves = new THREE.InstancedMesh(leafGeo, leafMat, palmSpots.length * 6);
    var m4 = new THREE.Matrix4();
    var q = new THREE.Quaternion();
    var eul = new THREE.Euler();
    var v3 = new THREE.Vector3();
    var sc = new THREE.Vector3(1, 1, 1);
    palmSpots.forEach(function (spot, pi) {
      eul.set(0, 0, rng.range(-0.08, 0.08));
      q.setFromEuler(eul);
      m4.compose(v3.set(spot[0], 3.5, spot[1]), q, sc);
      trunks.setMatrixAt(pi, m4);
      for (var l = 0; l < 6; l++) {
        var a = (l / 6) * Math.PI * 2;
        eul.set(-Math.sin(a) * 1.1, 0, Math.cos(a) * 1.1);
        q.setFromEuler(eul);
        m4.compose(v3.set(spot[0] + Math.cos(a) * 1.6, 7.2, spot[1] + Math.sin(a) * 1.6), q, sc);
        leaves.setMatrixAt(pi * 6 + l, m4);
      }
    });
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    scene.add(trunks);
    scene.add(leaves);
    world.palmCount = palmSpots.length;

    // ---------------------------------------------------------- streetlights
    // Instanced poles and lamps: two draw calls for the whole city.
    var poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });
    var lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    var lightSpots = [];
    roadCoords.forEach(function (c) {
      for (var d2 = -200; d2 <= 200; d2 += 80) lightSpots.push([c + 8.5, d2]);
    });
    var poleGeo = new THREE.CylinderGeometry(0.18, 0.22, 7, 6);
    var poles = new THREE.InstancedMesh(poleGeo, poleMat, lightSpots.length);
    var lampGeo = new THREE.SphereGeometry(0.55, 8, 8);
    var lamps = new THREE.InstancedMesh(lampGeo, lampMat, lightSpots.length);
    lightSpots.forEach(function (spot, li) {
      m4.compose(v3.set(spot[0], 3.5, spot[1]), q.setFromEuler(eul.set(0, 0, 0)), sc);
      poles.setMatrixAt(li, m4);
      m4.compose(v3.set(spot[0], 7.1, spot[1]), q, sc);
      lamps.setMatrixAt(li, m4);
    });
    poles.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    scene.add(poles);
    scene.add(lamps);
    world.streetlights = lightSpots;

    // -------------------------------------------------------------- props
    // Crates and containers at the Docks, benches on the beach, a billboard
    // over Sunset Strip — small dressing that reads at a glance.
    var crateMat = new THREE.MeshLambertMaterial({ color: 0x7a5a2a });
    var crateMat2 = new THREE.MeshLambertMaterial({ color: 0x2a5a7a });
    for (var cr = 0; cr < 18; cr++) {
      var crate = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), rng.chance(0.5) ? crateMat : crateMat2);
      crate.position.set(rng.range(90, 190), 1.5, rng.range(120, 200));
      crate.rotation.y = rng.range(0, Math.PI);
      scene.add(crate);
      world.colliders.push({ x: crate.position.x, z: crate.position.z, hw: 1.8, hd: 1.8 });
    }
    var billboard = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 9),
      new THREE.MeshBasicMaterial({ map: makeNeonTexture('NEON BAY  •  SUNSET STRIP', '#ff4fa3'), transparent: true })
    );
    billboard.position.set(-40, 16, 108);
    scene.add(billboard);
    var bbPole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 12, 6), poleMat);
    bbPole.position.set(-40, 6, 108);
    scene.add(bbPole);

    // ------------------------------------------------------ district helpers
    world.districtAt = function (x, z) {
      var best = CFG.DISTRICTS[0], bestD = Infinity;
      CFG.DISTRICTS.forEach(function (d) {
        var dd = (x - d.x) * (x - d.x) + (z - d.z) * (z - d.z);
        if (dd < bestD) { bestD = dd; best = d; }
      });
      return best.name;
    };
    world.nearestRoad = function (v) {
      var best = roadCoords[0], bd = Infinity;
      roadCoords.forEach(function (c) {
        var dd = Math.abs(v - c);
        if (dd < bd) { bd = dd; best = c; }
      });
      return { coord: best, dist: bd };
    };
    world.onRoad = function (x, z) {
      return world.nearestRoad(x).dist < W.roadWidth / 2 + 1 ||
        world.nearestRoad(z).dist < W.roadWidth / 2 + 1;
    };
    // Push a circle out of every building footprint. Returns true on hit.
    world.collideCircle = function (x, z, r) {
      for (var i = 0; i < world.colliders.length; i++) {
        var c = world.colliders[i];
        var dx = x - c.x, dz = z - c.z;
        if (Math.abs(dx) < c.hw + r && Math.abs(dz) < c.hd + r) return c;
      }
      return null;
    };
    // Clamp a position inside the playable square, beach included.
    world.clamp = function (x, z, margin) {
      var m = margin || 4;
      var lim = half - m;
      return {
        x: Math.max(-lim - 60, Math.min(lim, x)),
        z: Math.max(-lim, Math.min(lim, z)),
      };
    };

    return world;
  }

  window.NB = window.NB || {};
  window.NB.buildWorld = buildWorld;
})();
