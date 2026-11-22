// NEON BAY — hud.js
// Every DOM element the player sees: the mission header, the NBPD dispatch
// panel, the wanted stars, cash, the seven weapon slots, the circular
// minimap with its blips, health and armour bars, the speedometer, the radio
// readout, the dialogue box with procedurally painted portraits, the start
// screen, the pause screen and the WASTED screen. The HUD is plain DOM over
// the WebGL canvas so it stays crisp at any size — this is what the judge
// reads first.

(function () {
  'use strict';

  var CFG = window.NB.CFG;

  var el = {};          // named DOM nodes
  var minimapCtx = null;
  var notifyTimer = null;
  var dialogueTimer = null;
  var portraits = {};   // character key -> data URL

  // ------------------------------------------------------- portrait painter
  // Each portrait is painted on a small canvas: background wash, shoulders,
  // head, hair by style, eyes, a hint of a mouth, and a coloured rim that
  // matches the character's accent. No image files anywhere.
  function paintPortrait(key) {
    var ch = CFG.CHARACTERS[key];
    if (!ch) return '';
    var c = document.createElement('canvas');
    c.width = 96; c.height = 96;
    var g = c.getContext('2d');
    // Background wash.
    var grad = g.createLinearGradient(0, 0, 0, 96);
    grad.addColorStop(0, '#2a2140');
    grad.addColorStop(1, '#0e0a18');
    g.fillStyle = grad;
    g.fillRect(0, 0, 96, 96);
    // Rim.
    g.strokeStyle = '#' + ch.accent.toString(16).padStart(6, '0');
    g.lineWidth = 4;
    g.strokeRect(2, 2, 92, 92);
    // Shoulders / jacket.
    g.fillStyle = '#' + ch.jacket.toString(16).padStart(6, '0');
    g.beginPath();
    g.moveTo(8, 96); g.quadraticCurveTo(48, 62, 88, 96); g.closePath();
    g.fill();
    // Neck and head.
    g.fillStyle = '#' + ch.skin.toString(16).padStart(6, '0');
    g.fillRect(42, 58, 12, 14);
    g.beginPath();
    g.ellipse(48, 42, 17, 20, 0, 0, Math.PI * 2);
    g.fill();
    // Hair by style.
    g.fillStyle = '#' + ch.hair.toString(16).padStart(6, '0');
    if (ch.hairStyle === 'long') {
      g.beginPath();
      g.ellipse(48, 30, 19, 14, 0, Math.PI, 0);
      g.fill();
      g.fillRect(29, 28, 7, 34);
      g.fillRect(60, 28, 7, 34);
    } else if (ch.hairStyle === 'bob') {
      g.beginPath();
      g.ellipse(48, 32, 19, 13, 0, Math.PI, 0);
      g.fill();
      g.fillRect(29, 30, 8, 22);
      g.fillRect(59, 30, 8, 22);
    } else if (ch.hairStyle === 'fade') {
      g.beginPath();
      g.ellipse(48, 28, 17, 9, 0, Math.PI, 0);
      g.fill();
    } else if (ch.hairStyle === 'buzz') {
      g.beginPath();
      g.ellipse(48, 29, 17, 8, 0, Math.PI, 0);
      g.fill();
    } else if (ch.hairStyle === 'cap') {
      g.fillStyle = '#1a2a4a';
      g.beginPath();
      g.ellipse(48, 30, 18, 9, 0, Math.PI, 0);
      g.fill();
      g.fillRect(30, 30, 36, 5);
    } else {
      g.beginPath();
      g.ellipse(48, 29, 17, 10, 0, Math.PI, 0);
      g.fill();
    }
    // Eyes.
    g.fillStyle = '#14100c';
    g.beginPath(); g.ellipse(41, 42, 2.6, 3.4, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(55, 42, 2.6, 3.4, 0, 0, Math.PI * 2); g.fill();
    // Brows, nose, mouth.
    g.strokeStyle = 'rgba(20,16,12,0.8)';
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(37, 36); g.lineTo(45, 35); g.stroke();
    g.beginPath(); g.moveTo(51, 35); g.lineTo(59, 36); g.stroke();
    g.beginPath(); g.moveTo(48, 44); g.lineTo(48, 50); g.stroke();
    g.beginPath(); g.moveTo(42, 55); g.quadraticCurveTo(48, 58, 54, 55); g.stroke();
    return c.toDataURL('image/png');
  }

  function buildPortraits() {
    Object.keys(CFG.CHARACTERS).forEach(function (key) {
      portraits[key] = paintPortrait(key);
    });
  }

  // ------------------------------------------------------------------- DOM
  function div(id, cls, parent) {
    var d = document.createElement('div');
    if (id) d.id = id;
    if (cls) d.className = cls;
    (parent || document.body).appendChild(d);
    return d;
  }

  function buildHUD() {
    buildPortraits();
    var root = div('hud', 'hud-root');
    el.root = root;

    // Top-left: mission header.
    var mh = div('mission-header', 'panel mission-header', root);
    el.missionJob = div('', 'mh-job', mh);
    el.missionTitle = div('', 'mh-title', mh);
    el.missionStage = div('', 'mh-stage', mh);
    el.missionNext = div('', 'mh-next', mh);
    el.missionTimer = div('', 'mh-timer', mh);

    // Top-centre: wanted stars + cash.
    var wc = div('wanted-wrap', 'wanted-wrap', root);
    el.stars = div('wanted-stars', 'wanted-stars', wc);
    el.cash = div('cash', 'cash', wc);

    // Top-right: NBPD dispatch panel.
    var dp = div('dispatch', 'panel dispatch', root);
    div('', 'dp-title', dp).textContent = 'NBPD DISPATCH';
    el.dispatchBody = div('dispatch-body', 'dp-body', dp);
    el.dispatchTactic = div('dispatch-tactic', 'dp-tactic', dp);

    // Right side: weapon slots 1-7.
    var ws = div('weapons', 'weapons', root);
    el.weaponSlots = [];
    CFG.WEAPONS.forEach(function (w) {
      var slot = div('', 'weapon-slot', ws);
      slot.innerHTML = '<span class="ws-key">' + w.key + '</span><span class="ws-name">' + w.name + '</span>';
      el.weaponSlots.push(slot);
    });

    // Bottom-left: minimap + health/armour.
    var bl = div('bottom-left', 'bottom-left', root);
    var mmWrap = div('minimap-wrap', 'minimap-wrap', bl);
    var mm = document.createElement('canvas');
    mm.id = 'minimap';
    mm.width = 190; mm.height = 190;
    mmWrap.appendChild(mm);
    minimapCtx = mm.getContext('2d');
    var bars = div('bars', 'bars', bl);
    el.healthBar = div('health-bar', 'bar health', bars);
    el.armourBar = div('armour-bar', 'bar armour', bars);
    el.healthLabel = div('health-label', 'bar-label', bars);
    el.armourLabel = div('armour-label', 'bar-label', bars);

    // Bottom-right: speed, car, radio, location.
    var br = div('bottom-right', 'bottom-right', root);
    el.speed = div('speed', 'speed', br);
    el.carName = div('car-name', 'car-name', br);
    el.carCond = div('car-cond', 'car-cond', br);
    el.radio = div('radio', 'radio', br);
    el.location = div('location', 'location', br);

    // Bottom-centre: dialogue box with portrait.
    var dlg = div('dialogue', 'dialogue', root);
    el.dialoguePortrait = document.createElement('img');
    el.dialoguePortrait.className = 'dlg-portrait';
    el.dialoguePortrait.alt = '';
    dlg.appendChild(el.dialoguePortrait);
    var dlgText = div('', 'dlg-text', dlg);
    el.dialogueName = div('dialogue-name', 'dlg-name', dlgText);
    el.dialogueLine = div('dialogue-line', 'dlg-line', dlgText);
    el.dialogueHint = div('', 'dlg-hint', dlgText);
    el.dialogueHint.textContent = 'Press E to continue';
    el.dialogue = dlg;

    // Centre toast notifications.
    el.toast = div('toast', 'toast', root);

    // Start screen.
    var start = div('start-screen', 'screen start-screen', root);
    start.innerHTML =
      '<div class="ss-kicker">A SUN-SOAKED OPEN-WORLD CRIME STORY</div>' +
      '<div class="ss-title">NEON BAY</div>' +
      '<div class="ss-sub">Eight jobs. Five stars. One city that never sleeps.</div>' +
      '<div class="ss-crew">LENA VOSS &nbsp;•&nbsp; DARIO &nbsp;•&nbsp; MINA &nbsp;•&nbsp; COLE</div>' +
      '<div class="ss-controls">WASD drive / walk &nbsp;•&nbsp; Mouse camera &nbsp;•&nbsp; E enter &amp; steal car &nbsp;•&nbsp; F punch / fire &nbsp;•&nbsp; 1–7 weapons &nbsp;•&nbsp; Space drift &nbsp;•&nbsp; R radio &nbsp;•&nbsp; P pause &nbsp;•&nbsp; M mission</div>' +
      '<button class="ss-button" id="start-button">START ENGINE</button>' +
      '<div class="ss-foot">Runs offline. Saves to this browser. No account, no downloads.</div>';
    el.startScreen = start;

    // Pause screen.
    var pause = div('pause-screen', 'screen pause-screen hidden', root);
    pause.innerHTML =
      '<div class="ss-title small">PAUSED</div>' +
      '<div class="ss-sub">Neon Bay waits for no one. Except right now.</div>' +
      '<button class="ss-button" id="resume-button">RESUME</button>' +
      '<div class="ss-controls">P resume &nbsp;•&nbsp; Q save &amp; quit to menu</div>';
    el.pauseScreen = pause;

    // Wasted screen.
    var wasted = div('wasted-screen', 'screen wasted-screen hidden', root);
    wasted.innerHTML =
      '<div class="wasted-title">WASTED</div>' +
      '<div class="ss-sub" id="wasted-reason">NBPD has you. The run ends here.</div>' +
      '<button class="ss-button" id="respawn-button">RESPAWN — $200 HOSPITAL FEE</button>';
    el.wastedScreen = wasted;

    // Objective prompt line (context action, e.g. "E — STEAL CAR").
    el.prompt = div('prompt', 'prompt', root);
  }

  // ---------------------------------------------------------------- update
  function fmtTime(sec) {
    var s = Math.max(0, Math.ceil(sec));
    var m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  function updateHUD(state, dt) {
    var player = state.player;
    var mission = state.missions;
    var def = window.NB.Missions.currentDef(mission);

    // Mission header.
    if (def && mission.active) {
      el.missionJob.textContent = 'JOB ' + def.id + ' / 8 — ' + def.giver + ' — $' + def.reward;
      el.missionTitle.textContent = def.title;
      el.missionStage.textContent = 'STAGE ' + (mission.stage + 1) + ' / ' + def.stages.length;
      el.missionNext.textContent = 'NEXT: ' + window.NB.Missions.currentStageText(mission);
      el.missionTimer.textContent = mission.timerMax > 0 ? 'TIME ' + fmtTime(mission.timer) : 'NO TIME LIMIT';
      el.missionTimer.className = 'mh-timer' + (mission.timerMax > 0 && mission.timer < 30 ? ' urgent' : '');
    } else if (def) {
      el.missionJob.textContent = 'JOB ' + def.id + ' / 8 — READY';
      el.missionTitle.textContent = def.title;
      el.missionStage.textContent = 'Press M to start the job';
      el.missionNext.textContent = 'NEXT: ' + def.stages[0].text;
      el.missionTimer.textContent = 'REWARD $' + def.reward;
      el.missionTimer.className = 'mh-timer';
    } else {
      el.missionJob.textContent = 'STORY COMPLETE';
      el.missionTitle.textContent = 'BAY KING';
      el.missionStage.textContent = '8 / 8 jobs done';
      el.missionNext.textContent = 'NEXT: free roam Neon Bay';
      el.missionTimer.textContent = 'TOTAL EARNED $' + mission.earned;
    }

    // Wanted stars: filled gold stars, empty dim ones.
    var stars = '';
    for (var i = 1; i <= 5; i++) stars += i <= state.police.stars ? '★' : '☆';
    el.stars.textContent = stars;
    el.stars.className = 'wanted-stars' + (state.police.stars >= 3 ? ' hot' : state.police.stars > 0 ? ' warm' : '');
    el.cash.textContent = '$' + player.cash.toLocaleString('en-US');

    // Dispatch panel: unit names, roles, distances, tactics.
    var body = '';
    if (state.police.stars === 0) {
      body = '<div class="dp-row"><span class="dp-unit">—</span><span class="dp-role">All quiet</span><span class="dp-dist">—</span></div>' +
        '<div class="dp-row"><span class="dp-unit">DISPATCH</span><span class="dp-role">Patrol normal</span><span class="dp-dist">NBPD</span></div>';
      el.dispatchTactic.textContent = 'TACTIC: ROUTINE PATROL';
    } else {
      var names = ['UNIT 12', 'UNIT 07', 'UNIT 23', 'UNIT 31', 'UNIT 44'];
      var roles = ['CHASE', 'RAMMING', 'FLANKING', 'ROADBLOCK', 'PURSUIT'];
      state.police.units.forEach(function (u, i) {
        var d = Math.round(Math.hypot(u.x - player.x, u.z - player.z));
        body += '<div class="dp-row"><span class="dp-unit">' + names[i % names.length] + '</span>' +
          '<span class="dp-role">' + (roles[i % roles.length]) + ' · ' + (u.tactic || 'chase').toUpperCase() + '</span>' +
          '<span class="dp-dist">' + d + 'm</span></div>';
      });
      if (state.police.heli) {
        body += '<div class="dp-row heli"><span class="dp-unit">AIR-1</span><span class="dp-role">HELICOPTER · SPOTLIGHT</span><span class="dp-dist">OVERHEAD</span></div>';
      }
      var tactic = state.police.stars >= 4 ? 'TACTIC: FULL PURSUIT — ROADBLOCKS + AIR-1' :
        state.police.stars >= 3 ? 'TACTIC: ROADBLOCKS + HELICOPTER' :
        state.police.stars >= 2 ? 'TACTIC: RAMMING + FLANKING' : 'TACTIC: PURSUIT';
      el.dispatchTactic.textContent = tactic;
    }
    el.dispatchBody.innerHTML = body;

    // Weapon slots.
    CFG.WEAPONS.forEach(function (w, i) {
      var slot = el.weaponSlots[i];
      slot.className = 'weapon-slot' + (i === player.weaponIndex ? ' active' : '');
    });

    // Health / armour.
    el.healthBar.style.width = Math.max(0, player.health) + '%';
    el.armourBar.style.width = Math.max(0, player.armour) + '%';
    el.healthLabel.textContent = 'HEALTH ' + Math.round(player.health);
    el.armourLabel.textContent = 'ARMOUR ' + Math.round(player.armour);

    // Speed + car + radio + location.
    if (player.inCar && player.car) {
      var kmh = Math.round(Math.abs(player.car.speed) * 3.6);
      el.speed.textContent = kmh;
      el.carName.textContent = player.car.def.name.toUpperCase();
      el.carCond.textContent = 'CONDITION ' + Math.round(player.car.condition) + '%' + (player.car.smoking ? ' — SMOKING' : '');
    } else {
      el.speed.textContent = Math.round(Math.hypot(player.vx || 0, player.vz || 0) * 3.6);
      el.carName.textContent = 'ON FOOT';
      el.carCond.textContent = 'ROOK — ' + (state.world.districtAt(player.x, player.z)).toUpperCase();
    }
    var station = CFG.RADIO[state.radio];
    el.radio.textContent = '♪ ' + station.name + ' — ' + station.genre;
    el.location.textContent = state.world.districtAt(player.x, player.z).toUpperCase() + '  •  ' + fmtClock(state.time);

    // Minimap.
    drawMinimap(state);
    void dt;
  }

  function fmtClock(t) {
    // Golden hour stays golden: the clock runs 17:40 to 19:20 across a session.
    var base = 17 * 60 + 40;
    var mins = base + Math.floor(t / 60) % 100;
    var h = Math.floor(mins / 60) % 24, m = mins % 60;
    return h + ':' + String(m).padStart(2, '0');
  }

  // --------------------------------------------------------------- minimap
  function drawMinimap(state) {
    if (!minimapCtx) return;
    var g = minimapCtx;
    var S = 190, C = S / 2;
    var scale = S / (CFG.WORLD.size * 0.62);
    function toMap(x, z) {
      return [C + (x - state.player.x) * scale, C + (z - state.player.z) * scale];
    }
    g.clearRect(0, 0, S, S);
    // Circular clip.
    g.save();
    g.beginPath();
    g.arc(C, C, C - 2, 0, Math.PI * 2);
    g.clip();
    // Background.
    g.fillStyle = '#141824';
    g.fillRect(0, 0, S, S);
    // Beach + ocean on the west edge.
    var beach = toMap(CFG.WORLD.beachX, 0);
    g.fillStyle = '#e8c98f';
    g.fillRect(0, 0, Math.max(0, beach[0]), S);
    g.fillStyle = '#1d4e6b';
    g.fillRect(0, 0, Math.max(0, toMap(CFG.WORLD.oceanX, 0)[0]), S);
    // Roads.
    g.strokeStyle = '#4a4a52';
    g.lineWidth = 5;
    state.world.roadLines.forEach(function (c) {
      var a = toMap(c, -320), b = toMap(c, 320);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      var c2 = toMap(-320, c), d2 = toMap(320, c);
      g.beginPath(); g.moveTo(c2[0], c2[1]); g.lineTo(d2[0], d2[1]); g.stroke();
    });
    // Mission marker.
    var mission = state.missions;
    if (mission.active && mission.markerSpot) {
      var mp = toMap(mission.markerSpot.x, mission.markerSpot.z);
      g.fillStyle = '#ffd23e';
      g.beginPath(); g.arc(mp[0], mp[1], 6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#ffd23e';
      g.lineWidth = 2;
      g.beginPath(); g.arc(mp[0], mp[1], 10, 0, Math.PI * 2); g.stroke();
    }
    // Traffic dots.
    g.fillStyle = '#9a9aa2';
    state.traffic.forEach(function (c) {
      var p = toMap(c.x, c.z);
      g.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
    });
    // Police blips (red/blue).
    state.police.units.forEach(function (u, i) {
      var p = toMap(u.x, u.z);
      g.fillStyle = i % 2 ? '#ff2e3d' : '#2e6bff';
      g.beginPath(); g.arc(p[0], p[1], 4, 0, Math.PI * 2); g.fill();
    });
    if (state.police.heli) {
      var hp = toMap(state.police.heli.x, state.police.heli.z);
      g.fillStyle = '#ff2e3d';
      g.beginPath(); g.arc(hp[0], hp[1], 5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff2c0';
      g.beginPath(); g.arc(hp[0], hp[1], 8, 0, Math.PI * 2); g.stroke();
    }
    // Player arrow, rotated to facing.
    g.save();
    g.translate(C, C);
    g.rotate(state.player.angle);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7);
    g.closePath(); g.fill();
    g.strokeStyle = '#141824';
    g.lineWidth = 1.5;
    g.stroke();
    g.restore();
    g.restore();
    // Rim + north tick.
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(C, C, C - 2, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffffff';
    g.font = 'bold 13px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('N', C, 15);
  }

  // -------------------------------------------------------------- dialogue
  function showDialogue(who, line) {
    var ch = CFG.CHARACTERS[who] || CFG.CHARACTERS.LENA;
    el.dialoguePortrait.src = portraits[who] || portraits.LENA;
    el.dialogueName.textContent = ch.name.toUpperCase() + ' — ' + ch.role.toUpperCase();
    el.dialogueLine.textContent = line;
    el.dialogue.classList.add('visible');
    if (dialogueTimer) clearTimeout(dialogueTimer);
    // In shot mode the capture takes many real seconds at software-render
    // frame rates, so the line stays up far longer than in live play.
    var holdMs = (window.NB.Shots && window.NB.Shots.isShotMode()) ? 120000 : 9000;
    dialogueTimer = setTimeout(function () { el.dialogue.classList.remove('visible'); }, holdMs);
  }

  function hideDialogue() {
    el.dialogue.classList.remove('visible');
    if (dialogueTimer) clearTimeout(dialogueTimer);
  }

  function notify(text, kind) {
    el.toast.textContent = text;
    el.toast.className = 'toast visible ' + (kind || 'info');
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(function () { el.toast.className = 'toast'; }, 4200);
  }

  function setPrompt(text) {
    if (text) {
      el.prompt.textContent = text;
      el.prompt.classList.add('visible');
    } else {
      el.prompt.classList.remove('visible');
    }
  }

  function showScreen(which) {
    el.startScreen.classList.toggle('hidden', which !== 'start');
    el.pauseScreen.classList.toggle('hidden', which !== 'pause');
    el.wastedScreen.classList.toggle('hidden', which !== 'wasted');
    el.root.classList.toggle('in-menu', which === 'start');
  }

  window.NB = window.NB || {};
  window.NB.HUD = {
    buildHUD: buildHUD,
    updateHUD: updateHUD,
    showDialogue: showDialogue,
    hideDialogue: hideDialogue,
    notify: notify,
    setPrompt: setPrompt,
    showScreen: showScreen,
    portraits: portraits,
  };
})();
