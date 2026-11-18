// Input — keyboard + mouse state, pointer lock, and the "pressed this frame"
// edge detection the game loop consumes. No DOM work happens here; the HUD
// reads the same state through the exported object.

export const input = {
  keys: new Set(),
  // mouse deltas accumulated since the last consume
  dx: 0,
  dy: 0,
  mouseDown: false,
  mouseClicked: false, // set on mousedown, cleared by consumeClick()
  locked: false,
  // edge-triggered keys: key -> true until consumed
  pressed: new Set(),

  down(code) { return this.keys.has(code); },
  consumeClick() {
    const c = this.mouseClicked;
    this.mouseClicked = false;
    return c;
  },
  consumePress(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  },
  consumeLook() {
    const d = { dx: this.dx, dy: this.dy };
    this.dx = 0; this.dy = 0;
    return d;
  },
};

export function bindInput(canvas, onLockChange) {
  const el = canvas;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    input.pressed.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
  });
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.mouseDown = false;
  });
  el.addEventListener('click', () => {
    if (!input.locked) el.requestPointerLock?.();
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === el;
    onLockChange?.(input.locked);
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.dx += e.movementX;
    input.dy += e.movementY;
  });
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !input.locked) return;
    input.mouseDown = true;
    input.mouseClicked = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.mouseDown = false;
  });
}
