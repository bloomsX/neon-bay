// NEON BAY — input.js
// Keyboard and mouse input. WASD moves and drives, E enters/steals cars and
// advances dialogue, F punches or fires, 1-7 switch weapons, Space drifts,
// R changes the radio station, P pauses, M starts the next job, Q saves.
// Mouse drag orbits the camera; the game never needs pointer lock, so it
// works the same in a screenshot harness as in a player's hands.

(function () {
  'use strict';

  var keys = {};
  var orbit = { yaw: 0, pitch: 0 };
  var dragging = false;
  var lastX = 0, lastY = 0;
  var pressed = {};   // edge-triggered keys, consumed once per frame

  function keyName(e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    return k;
  }

  function attach() {
    window.addEventListener('keydown', function (e) {
      var k = keyName(e);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) !== -1) e.preventDefault();
      if (!keys[k]) pressed[k] = true;
      keys[k] = true;
    });
    window.addEventListener('keyup', function (e) {
      keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false;
    });
    window.addEventListener('blur', function () {
      keys = {};
      dragging = false;
    });
    var canvasHolder = document.getElementById('game');
    if (canvasHolder) {
      canvasHolder.addEventListener('mousedown', function (e) {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
      });
      window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        orbit.yaw -= (e.clientX - lastX) * 0.005;
        orbit.pitch += (e.clientY - lastY) * 0.004;
        orbit.pitch = Math.max(-0.35, Math.min(0.5, orbit.pitch));
        lastX = e.clientX; lastY = e.clientY;
      });
      window.addEventListener('mouseup', function () { dragging = false; });
    }
    // Start / resume / respawn buttons (HUD-owned, wired here).
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.id) return;
      if (t.id === 'start-button') window.NB.Main.startGame();
      if (t.id === 'resume-button') window.NB.Main.togglePause();
      if (t.id === 'respawn-button') window.NB.Main.respawn();
    });
  }

  // The per-frame driving/walking input vector.
  function readDrive() {
    return {
      forward: !!(keys.w || keys.arrowup),
      back: !!(keys.s || keys.arrowdown),
      left: !!(keys.a || keys.arrowleft),
      right: !!(keys.d || keys.arrowright),
      handbrake: !!keys[' '],
      run: !!keys.shift,
    };
  }

  function wasPressed(k) {
    if (pressed[k]) { pressed[k] = false; return true; }
    return false;
  }

  function consumePressed() { pressed = {}; }

  function anyWeaponKey() {
    for (var i = 1; i <= 7; i++) {
      if (wasPressed(String(i))) return i - 1;
    }
    return -1;
  }

  window.NB = window.NB || {};
  window.NB.Input = {
    attach: attach,
    keys: keys,
    orbit: orbit,
    readDrive: readDrive,
    wasPressed: wasPressed,
    consumePressed: consumePressed,
    anyWeaponKey: anyWeaponKey,
  };
})();
