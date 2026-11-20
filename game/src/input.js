// Keyboard + mouse input. Held keys steer; one-shot presses (enter car, shoot,
// pause, mute, restart) queue as bit flags and are taken once, so a press between
// frames is never lost and never counted twice. Mouse drag orbits the camera;
// click fires the weapon. Pointer lock is deliberately NOT used: it breaks
// headless play-testing and screenshot staging, and drag-orbit plays better in
// a browser window anyway.
//
// The input layer also stamps every keydown with performance.now() so the
// performance harness can measure true input latency (keydown -> the sim reacts).
export const ACTION_ENTER = 1;
export const ACTION_SHOOT = 2;
export const ACTION_PAUSE = 4;
export const ACTION_MUTE = 8;
export const ACTION_CONFIRM = 16;

// One table for every binding: action keys are edge-triggered, movement keys held.
const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  enter: ['KeyE'],
  shoot: ['KeyF'],
  pause: ['KeyP', 'Escape'],
  mute: ['KeyM'],
  confirm: ['Space', 'Enter'],
};

const EDGE_ACTIONS = [
  ['enter', ACTION_ENTER],
  ['shoot', ACTION_SHOOT],
  ['pause', ACTION_PAUSE],
  ['mute', ACTION_MUTE],
  ['confirm', ACTION_CONFIRM],
];

const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function buildLookup() {
  const lookup = new Map();
  for (const [name, codes] of Object.entries(BINDINGS)) {
    for (const code of codes) lookup.set(code, name);
  }
  return lookup;
}
const LOOKUP = buildLookup();
const EDGE_MAP = new Map(EDGE_ACTIONS);

export function createInput(canvas) {
  const keys = new Set();
  let actions = 0;
  let dragX = 0;
  let dragY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  // Stamps the last keydown (code + time) for the latency probe in tools/fps.mjs.
  let lastKey = { code: '', at: 0 };

  window.addEventListener('keydown', (event) => {
    lastKey = { code: event.code, at: performance.now() };
    if (event.repeat) return;
    const name = LOOKUP.get(event.code);
    if (!name) return;
    if (EDGE_MAP.has(name)) {
      actions |= EDGE_MAP.get(name);
    } else {
      keys.add(event.code);
    }
    if (PREVENT_DEFAULT.has(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    if (event.button === 0) actions |= ACTION_SHOOT;
  });
  window.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    dragX += event.clientX - lastX;
    dragY += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });
  // Losing the pointer mid-drag must not leave the camera spinning.
  window.addEventListener('pointercancel', () => {
    dragging = false;
  });

  function held(name) {
    for (const code of BINDINGS[name]) {
      if (keys.has(code)) return true;
    }
    return false;
  }

  return {
    /** -1..1 forward/back, -1..1 left/right, run held. */
    move() {
      return {
        fwd: (held('forward') ? 1 : 0) - (held('back') ? 1 : 0),
        strafe: (held('right') ? 1 : 0) - (held('left') ? 1 : 0),
        run: held('run'),
      };
    },
    /** Mouse drag delta since the last call, in pixels. */
    takeDrag() {
      const d = { x: dragX, y: dragY };
      dragX = 0;
      dragY = 0;
      return d;
    },
    /** One-shot action flags queued since the last call (consumed). */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** True while any movement key is held — used for the idle detector. */
    anyMovementHeld() {
      return held('forward') || held('back') || held('left') || held('right');
    },
    /** Last keydown stamp, for input-latency measurement. */
    lastKey() {
      return lastKey;
    },
  };
}
