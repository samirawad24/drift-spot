// Keyboard, touch and gamepad input merged into one control state.

const keys = new Set();
const pressedOnce = new Set();
const touch = { steer: 0, gas: false, brake: false, hand: false, active: false };
let lastSource = 'keys';
let padIndex = null;
let padName = '';
let keyThrottle = 0;
let keyBrake = 0;
const listeners = { connect: [], disconnect: [] };

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'gas', KeyW: 'gas',
  ArrowDown: 'brake', KeyS: 'brake',
  Space: 'hand', ShiftLeft: 'hand',
  KeyC: 'spot', KeyR: 'reset', KeyP: 'pause', Escape: 'pause', Enter: 'start',
};

export function initInput(root) {
  addEventListener('keydown', (e) => {
    const a = KEYMAP[e.code];
    if (!a) return;
    e.preventDefault();
    if (!keys.has(a)) pressedOnce.add(a);
    keys.add(a);
    lastSource = 'keys';
  });
  addEventListener('keyup', (e) => {
    const a = KEYMAP[e.code];
    if (a) keys.delete(a);
  });
  addEventListener('blur', () => keys.clear());

  addEventListener('gamepadconnected', (e) => {
    padIndex = e.gamepad.index;
    padName = cleanPadName(e.gamepad.id);
    lastSource = 'pad';
    listeners.connect.forEach((f) => f(padName));
  });
  addEventListener('gamepaddisconnected', (e) => {
    if (e.gamepad.index === padIndex) {
      padIndex = null;
      lastSource = isTouchDevice() ? 'touch' : 'keys';
      listeners.disconnect.forEach((f) => f());
    }
  });

  initTouch(root);
}

export function onPad(event, fn) { listeners[event].push(fn); }

export function isTouchDevice() {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

function cleanPadName(id) {
  const s = id.toLowerCase();
  if (s.includes('xbox') || s.includes('xinput')) return 'XBOX CONTROLLER';
  if (s.includes('dualsense') || s.includes('dualshock') || s.includes('054c') || s.includes('playstation')) return 'PLAYSTATION CONTROLLER';
  if (s.includes('pro controller') || s.includes('057e')) return 'SWITCH PRO CONTROLLER';
  return 'CONTROLLER';
}

function getPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  if (padIndex !== null && pads[padIndex]) return pads[padIndex];
  for (const p of pads) {
    if (p && p.connected) {
      padIndex = p.index;
      padName = cleanPadName(p.id);
      listeners.connect.forEach((f) => f(padName));
      return p;
    }
  }
  return null;
}

const padPrev = [];
function padEdge(p, i) {
  const now = !!(p.buttons[i] && p.buttons[i].pressed);
  const was = !!padPrev[i];
  padPrev[i] = now;
  return now && !was;
}

function btnVal(p, i) {
  const b = p.buttons[i];
  if (!b) return 0;
  return typeof b.value === 'number' ? Math.max(b.value, b.pressed ? 1 : 0) : (b.pressed ? 1 : 0);
}

// Call once per frame. Returns analog controls plus one-shot actions.
export function readInput(dt) {
  const out = { steer: 0, throttle: 0, brake: 0, handbrake: false, actions: new Set(), source: lastSource };

  // Keyboard
  const kl = keys.has('left'), kr = keys.has('right');
  const kSteer = (kr ? 1 : 0) - (kl ? 1 : 0);
  keyThrottle = keys.has('gas') ? Math.min(1, keyThrottle + dt * 5) : 0;
  keyBrake = keys.has('brake') ? Math.min(1, keyBrake + dt * 6) : 0;
  for (const a of pressedOnce) out.actions.add(a);
  pressedOnce.clear();

  // Gamepad (standard mapping)
  const p = getPad();
  let pSteer = 0, pGas = 0, pBrake = 0, pHand = false;
  if (p) {
    const ax = p.axes[0] || 0;
    const dz = 0.12;
    pSteer = Math.abs(ax) < dz ? 0 : Math.sign(ax) * (Math.abs(ax) - dz) / (1 - dz);
    pSteer = Math.sign(pSteer) * Math.pow(Math.abs(pSteer), 1.3);
    if (p.buttons[14] && p.buttons[14].pressed) pSteer = -1;
    if (p.buttons[15] && p.buttons[15].pressed) pSteer = 1;
    pGas = btnVal(p, 7);
    pBrake = btnVal(p, 6);
    pHand = btnVal(p, 0) > 0.5 || btnVal(p, 5) > 0.5;
    if (padEdge(p, 9)) out.actions.add('pause');
    if (padEdge(p, 8)) out.actions.add('reset');
    if (padEdge(p, 3)) out.actions.add('spot');
    if (padEdge(p, 0)) out.actions.add('start');
    if (padEdge(p, 1)) out.actions.add('back');
    if (padEdge(p, 12)) out.actions.add('up');
    if (padEdge(p, 13)) out.actions.add('down');
    if (Math.abs(pSteer) > 0.3 || pGas > 0.1 || pBrake > 0.1 || pHand) lastSource = 'pad';
  }

  if (touch.active && (touch.gas || touch.brake || touch.hand || touch.steer !== 0)) lastSource = 'touch';

  out.steer = clamp(kSteer + pSteer + touch.steer, -1, 1);
  out.throttle = clamp(keyThrottle + pGas + (touch.gas ? 1 : 0), 0, 1);
  out.brake = clamp(keyBrake + pBrake + (touch.brake ? 1 : 0), 0, 1);
  out.handbrake = keys.has('hand') || pHand || touch.hand;
  out.source = lastSource;
  return out;
}

export function padConnected() { return padIndex !== null; }
export function currentPadName() { return padName; }

export function rumble(strong, weak, ms) {
  const p = getPad();
  if (p && p.vibrationActuator && p.vibrationActuator.playEffect) {
    p.vibrationActuator.playEffect('dual-rumble', {
      duration: ms, strongMagnitude: strong, weakMagnitude: weak,
    }).catch(() => {});
  } else if (lastSource === 'touch' && navigator.vibrate && strong > 0.5) {
    navigator.vibrate(Math.min(ms, 60));
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// ---------- Touch controls ----------
function initTouch(root) {
  const zone = root.querySelector('#steer-zone');
  const knob = root.querySelector('#steer-knob');
  const base = root.querySelector('#steer-base');
  let steerId = null, originX = 0;
  const RANGE = 70;

  zone.addEventListener('pointerdown', (e) => {
    if (steerId !== null) return;
    steerId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    originX = e.clientX;
    touch.active = true;
    base.style.left = `${e.clientX}px`;
    base.style.top = `${e.clientY}px`;
    base.classList.add('on');
    knob.style.transform = 'translate(-50%, -50%)';
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== steerId) return;
    const dx = clamp(e.clientX - originX, -RANGE, RANGE);
    touch.steer = dx / RANGE;
    knob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
  });
  const end = (e) => {
    if (e.pointerId !== steerId) return;
    steerId = null;
    touch.steer = 0;
    base.classList.remove('on');
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);

  const bind = (id, field) => {
    const el = root.querySelector(id);
    const on = (e) => { e.preventDefault(); touch[field] = true; touch.active = true; el.classList.add('down'); el.setPointerCapture(e.pointerId); };
    const off = () => { touch[field] = false; el.classList.remove('down'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
  };
  bind('#btn-gas', 'gas');
  bind('#btn-brake', 'brake');
  bind('#btn-hand', 'hand');
}
