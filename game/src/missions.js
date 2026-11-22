// NEON BAY — missions.js
// The eight story jobs. Each job is a short chain of stages with a map
// marker, a dialogue line, a timer where the job needs one, and a cash
// reward. The module owns the active mission state, the glowing objective
// marker in the world, and the advance/complete/fail transitions.

(function () {
  'use strict';

  var THREE = window.THREE;
  var CFG = window.NB.CFG;

  // Objective locations, in world coordinates. Every stage points at one of
  // these named spots so the marker, the minimap blip and the HUD agree.
  var SPOTS = {
    coralStrand: { x: -180, z: 20, label: 'Coral Strand' },
    marinaLockup: { x: -80, z: -160, label: 'Marina Row lockup' },
    pier: { x: -246, z: 0, label: 'Coral Pier' },
    sunsetStrip: { x: -40, z: 120, label: 'Sunset Strip' },
    palmCourt: { x: 80, z: -80, label: 'Palm Court' },
    marinaRow: { x: -80, z: -120, label: 'Marina Row' },
    docks: { x: 140, z: 160, label: 'The Docks' },
    docksYard: { x: 150, z: 180, label: 'Container yard' },
    casino: { x: 80, z: -120, label: 'Palm Court casino' },
    lenaSpot: { x: 40, z: 40, label: "Lena's rooftop" },
    safehouse: { x: -180, z: -60, label: 'Coral Strand safehouse' },
    clubDoor: { x: -40, z: 140, label: 'Club door' },
  };

  // Which spot each stage sends the player to, by mission id and stage index.
  var STAGE_SPOTS = {
    1: ['coralStrand', 'marinaLockup', 'marinaLockup'],
    2: ['sunsetStrip', 'pier', 'pier'],
    3: ['palmCourt', 'sunsetStrip', 'clubDoor'],
    4: ['marinaRow', 'marinaRow', 'docks'],
    5: ['docksYard', 'docksYard', 'sunsetStrip'],
    6: ['casino', 'casino', 'lenaSpot'],
    7: ['sunsetStrip', 'sunsetStrip', 'safehouse'],
    8: ['docks', 'pier', 'pier'],
  };

  // Timed stages: seconds on the clock, or 0 for untimed.
  var STAGE_TIMERS = { 2: [0, 150, 60], 7: [0, 0, 120], 8: [0, 240, 0] };

  function makeMissionState() {
    return {
      index: 0,               // 0-based into CFG.MISSIONS; 8 = story done
      stage: 0,
      active: false,
      timer: 0,
      timerMax: 0,
      completed: 0,
      earned: 0,
      holdTimer: 0,           // for "hold still in the marker" stages
      marker: null,           // THREE.Group in the scene
      markerSpot: null,
      lastObjective: '',
    };
  }

  function makeMarker() {
    var g = new THREE.Group();
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(3.2, 4.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    g.add(ring);
    var beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 2.2, 18, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.y = 9;
    g.add(beam);
    var diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.6),
      new THREE.MeshBasicMaterial({ color: 0xffd23e })
    );
    diamond.position.y = 6;
    g.add(diamond);
    g.userData.ring = ring;
    g.userData.diamond = diamond;
    return g;
  }

  function placeMarker(state, scene, spotKey) {
    if (state.marker) scene.remove(state.marker);
    var spot = SPOTS[spotKey];
    var marker = makeMarker();
    marker.position.set(spot.x, 0, spot.z);
    scene.add(marker);
    state.marker = marker;
    state.markerSpot = spot;
    return spot;
  }

  function currentDef(state) {
    return CFG.MISSIONS[state.index] || null;
  }

  function currentStageText(state) {
    var def = currentDef(state);
    if (!def) return 'Story complete — free roam Neon Bay';
    return def.stages[state.stage] ? def.stages[state.stage].text : '';
  }

  function startMission(state, scene, index) {
    var def = CFG.MISSIONS[index];
    if (!def) return false;
    state.index = index;
    state.stage = 0;
    state.active = true;
    state.holdTimer = 0;
    var spots = STAGE_SPOTS[def.id];
    placeMarker(state, scene, spots[0]);
    var timers = STAGE_TIMERS[def.id];
    state.timerMax = timers ? timers[0] : 0;
    state.timer = state.timerMax;
    // Heat arrives with the job.
    if (def.heat > 0 && window.NB.state) {
      window.NB.Police.addStars(window.NB.state.police, 0, '');
      window.NB.state.police.stars = Math.max(window.NB.state.police.stars, 0);
    }
    window.NB.HUD.showDialogue(def.giver, def.intro);
    window.NB.HUD.notify('JOB ' + def.id + ' / 8 — ' + def.title + '  •  $' + def.reward, 'mission');
    window.NB.Audio.uiBlip(880);
    return true;
  }

  function advanceStage(state, scene) {
    var def = currentDef(state);
    if (!def) return;
    state.stage++;
    state.holdTimer = 0;
    if (state.stage >= def.stages.length) {
      completeMission(state, scene);
      return;
    }
    var spots = STAGE_SPOTS[def.id];
    placeMarker(state, scene, spots[state.stage]);
    var timers = STAGE_TIMERS[def.id];
    state.timerMax = timers ? timers[state.stage] : 0;
    state.timer = state.timerMax;
    var line = window.NB.RNG.live.pick(CFG.DIALOGUE.stageDone);
    window.NB.HUD.showDialogue(def.giver, line + ' ' + def.stages[state.stage].text + '.');
    window.NB.Audio.uiBlip(660);
  }

  function completeMission(state, scene) {
    var def = currentDef(state);
    if (!def) return;
    var player = window.NB.state.player;
    player.cash += def.reward;
    state.earned += def.reward;
    state.completed++;
    state.active = false;
    if (state.marker) { scene.remove(state.marker); state.marker = null; }
    window.NB.Police.clearStars(window.NB.state.police);
    window.NB.HUD.showDialogue(def.giver, window.NB.RNG.live.pick(CFG.DIALOGUE.missionDone) + ' $' + def.reward + ' is yours.');
    window.NB.HUD.notify('JOB COMPLETE — ' + def.title + '  •  +$' + def.reward, 'mission');
    window.NB.Audio.missionDone();
    // Next job unlocks immediately; the player starts it from the HUD.
    if (state.index + 1 < CFG.MISSIONS.length) {
      state.index++;
      state.stage = 0;
    } else {
      state.index = CFG.MISSIONS.length;
      window.NB.HUD.notify('STORY COMPLETE — you run Neon Bay now. Free roam.', 'mission');
    }
    window.NB.Main.saveGame();
  }

  function failMission(state, scene, reason) {
    var def = currentDef(state);
    state.active = false;
    if (state.marker) { scene.remove(state.marker); state.marker = null; }
    window.NB.HUD.notify('JOB FAILED — ' + reason + '. Talk to Lena to retry.', 'wanted');
    window.NB.HUD.showDialogue('LENA', 'It happens. Shake it off, Rook. The job is still there when you are ready.');
  }

  // Per-frame mission logic: marker proximity, hold-still stages, timers.
  function updateMissions(state, scene, player, dt) {
    if (!state.active) return;
    var def = currentDef(state);
    if (!def) return;
    // Timer.
    if (state.timerMax > 0) {
      state.timer -= dt;
      if (state.timer <= 0) {
        failMission(state, scene, 'out of time on ' + def.title);
        return;
      }
    }
    if (!state.markerSpot) return;
    var spot = state.markerSpot;
    var d = Math.hypot(player.x - spot.x, player.z - spot.z);
    // Mission 5 stage 2 is a hold-still recovery.
    var isHold = def.id === 5 && state.stage === 1;
    if (d < 5.5) {
      if (isHold) {
        state.holdTimer += dt;
        if (state.holdTimer >= 3) advanceStage(state, scene);
      } else {
        // Mission 1 stage 1 needs a stolen car; the steal itself advances.
        if (def.id === 1 && state.stage === 0) return;
        // Mission 6 stage 2 needs the Halcyon; entering it advances.
        if (def.id === 6 && state.stage === 1) return;
        advanceStage(state, scene);
      }
    } else {
      state.holdTimer = 0;
    }
    // Spin the marker diamond so the objective reads from across the city.
    if (state.marker) {
      state.marker.userData.diamond.rotation.y += dt * 1.6;
      state.marker.userData.diamond.position.y = 6 + Math.sin(window.NB.state.time * 2) * 0.5;
    }
  }

  // Called by the steal/enter flow when the player takes a car.
  function onCarEntered(state, scene, car, stolen) {
    var def = currentDef(state);
    if (!state.active || !def) return;
    if (def.id === 1 && state.stage === 0 && stolen) {
      advanceStage(state, scene);
    }
    if (def.id === 6 && state.stage === 1 && car.defKey === 'halcyon') {
      advanceStage(state, scene);
    }
  }

  window.NB = window.NB || {};
  window.NB.Missions = {
    SPOTS: SPOTS,
    makeMissionState: makeMissionState,
    currentDef: currentDef,
    currentStageText: currentStageText,
    startMission: startMission,
    advanceStage: advanceStage,
    completeMission: completeMission,
    failMission: failMission,
    updateMissions: updateMissions,
    onCarEntered: onCarEntered,
  };
})();
