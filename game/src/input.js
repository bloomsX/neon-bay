// NEON BAY — keyboard and mouse input. Keys are held state; actions are
// edge-triggered (a keydown fires once, never on repeat), and the simulation
// consumes each action on its first substep so a slow frame can never fire
// one twice. A click only shoots when the press barely moved (a drag orbits
// the camera instead).
export function createInput(canvas) {
  const keys = { up: false, down: false, left: false, right: false, run: false };
  const actions = { steal: false, fire: false, pause: false, mute: false, confirm: false };
  const look = { dx: 0, dy: 0 };
  let lastDragAt = 0;
  let dragging = false;
  let downX = 0;
  let downY = 0;
  let downAt = 0;
  let moved = 0;

  const keyMap = {
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    ShiftLeft: 'run', ShiftRight: 'run',
  };

  function onKeyDown(e) {
    const k = keyMap[e.code];
    if (k) {
      keys[k] = true;
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyE') actions.steal = true;
    else if (e.code === 'KeyF') actions.fire = true;
    else if (e.code === 'KeyP' || e.code === 'Escape') actions.pause = true;
    else if (e.code === 'KeyM') actions.mute = true;
    else if (e.code === 'Enter' || e.code === 'Space') actions.confirm = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  }

  function onKeyUp(e) {
    const k = keyMap[e.code];
    if (k) keys[k] = false;
  }

  function onPointerDown(e) {
    dragging = true;
    moved = 0;
    downX = e.clientX;
    downY = e.clientY;
    downAt = performance.now();
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    moved += Math.abs(dx) + Math.abs(dy);
    look.dx += dx;
    look.dy += dy;
    lastDragAt = performance.now();
  }

  function onPointerUp(e) {
    dragging = false;
    const dt = performance.now() - downAt;
    if (moved < 6 && dt < 400) actions.fire = true;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', () => { dragging = false; });

  return {
    keys, actions, look,
    get lastDragAt() { return lastDragAt; },
    get dragging() { return dragging; },
  };
}
