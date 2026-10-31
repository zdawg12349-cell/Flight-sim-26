// Keyboard / mouse / gamepad input with rebindable actions.
import { settings } from './settings.js';
import { bus } from './events.js';
import { clamp } from './math.js';

const EDGE_ACTIONS = new Set([
  'gear', 'flapsUp', 'flapsDown', 'parkingBrake', 'spoilers', 'reverse', 'autopilot', 'apPanel', 'engineStart', 'engineStop',
  'landingLights', 'allLights', 'cameraNext', 'cameraPrev', 'cockpitView', 'cabinView', 'chaseView', 'sideView', 'cinematicView',
  'lookReset', 'map', 'hud', 'help', 'atc', 'pause', 'menu', 'throttleFull', 'throttleIdle', 'hoist',
]);

class Input {
  constructor() {
    this.down = new Set();
    this.shift = false;
    this.index = new Map();      // binding string -> [actions]
    this.shiftKeys = new Set();  // codes that have a Shift+ binding
    this.listeners = new Map();
    this.enabled = true;
    this.capture = null;         // rebinding callback
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, dx: 0, dy: 0, wheel: 0, buttons: 0, dragging: false, moved: 0 };
    this.gamepad = { connected: false, pitch: 0, roll: 0, yaw: 0, throttle: null, throttleRate: 0, brake: 0 };
    this._gpPrev = [];
    this.rebuild();
  }

  attach(canvas) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => { this.down.clear(); this.shift = false; });
    canvas.addEventListener('mousedown', (e) => {
      this.mouse.buttons |= (1 << e.button); this.mouse.moved = 0; this.mouse.dragging = true;
      if (e.button === 1) e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      const wasClick = this.mouse.moved < 5;
      this.mouse.buttons &= ~(1 << e.button);
      if (this.mouse.buttons === 0) this.mouse.dragging = false;
      if (wasClick && e.target === canvas) bus.emit('input:click', { button: e.button, nx: this.mouse.nx, ny: this.mouse.ny });
    });
    window.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top;
      this.mouse.nx = (this.mouse.x / r.width) * 2 - 1;
      this.mouse.ny = -(this.mouse.y / r.height) * 2 + 1;
      if (this.mouse.buttons) {
        this.mouse.dx += e.movementX || 0; this.mouse.dy += e.movementY || 0;
        this.mouse.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      }
    });
    canvas.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('gamepadconnected', (e) => { this.gamepad.connected = true; bus.emit('toast', `Controller connected: ${e.gamepad.id.slice(0, 40)}`); });
    window.addEventListener('gamepaddisconnected', () => { this.gamepad.connected = false; });
  }

  rebuild() {
    this.index.clear(); this.shiftKeys.clear();
    const b = settings.c.bindings;
    for (const [action, keys] of Object.entries(b)) {
      for (const k of keys) {
        if (!this.index.has(k)) this.index.set(k, []);
        this.index.get(k).push(action);
        if (k.startsWith('Shift+')) this.shiftKeys.add(k.slice(6));
      }
    }
  }

  on(action, fn) {
    if (!this.listeners.has(action)) this.listeners.set(action, new Set());
    this.listeners.get(action).add(fn);
    return () => this.listeners.get(action).delete(fn);
  }

  _fire(action) {
    const s = this.listeners.get(action);
    if (s) for (const fn of s) fn();
    bus.emit('action', action);
  }

  _key(e, isDown) {
    if (e.key === 'Shift') this.shift = isDown;
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (this.capture && isDown) {
      e.preventDefault();
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') return;
      const cb = this.capture; this.capture = null;
      cb((e.shiftKey ? 'Shift+' : '') + e.code);
      return;
    }
    if (typing) return;
    const code = e.code;
    if (isDown) {
      if (this.down.has(code)) { this._preventIfBound(e, code); return; }  // key repeat
      this.down.add(code);
      const name = (e.shiftKey && this.shiftKeys.has(code)) ? 'Shift+' + code : code;
      const actions = this.index.get(name) || (e.shiftKey ? this.index.get(code) : null);
      if (actions) {
        e.preventDefault();
        if (this.enabled || actions.includes('menu') || actions.includes('pause')) {
          for (const a of actions) if (EDGE_ACTIONS.has(a)) this._fire(a);
        }
      }
    } else {
      this.down.delete(code);
    }
  }

  _preventIfBound(e, code) { if (this.index.has(code) || this.index.has('Shift+' + code)) e.preventDefault(); }

  held(action) {
    if (!this.enabled) return false;
    const keys = settings.c.bindings[action];
    if (!keys) return false;
    for (const k of keys) {
      if (k.startsWith('Shift+')) {
        if (this.shift && this.down.has(k.slice(6))) return true;
      } else if (this.down.has(k)) {
        if (this.shift && this.shiftKeys.has(k)) continue;
        return true;
      }
    }
    return false;
  }

  consumeMouse() {
    const m = this.mouse;
    const r = { dx: m.dx, dy: m.dy, wheel: m.wheel };
    m.dx = 0; m.dy = 0; m.wheel = 0;
    return r;
  }

  pollGamepad() {
    if (!settings.c.gamepad || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    const g = this.gamepad;
    if (!gp) { g.connected = false; return; }
    g.connected = true;
    const dz = (v) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
    const ax = gp.axes;
    if (gp.mapping === 'standard') {
      g.roll = dz(ax[0] || 0); g.pitch = dz(ax[1] || 0); g.yaw = dz(ax[2] || 0);
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      g.throttleRate = rt - lt; g.throttle = null;
      g.brake = gp.buttons[1] && gp.buttons[1].pressed ? 1 : 0;
      const map = { 0: 'gear', 2: 'flapsUp', 3: 'flapsDown', 4: 'cameraPrev', 5: 'cameraNext', 9: 'pause', 8: 'map', 12: 'spoilers', 13: 'reverse', 14: 'autopilot', 15: 'engineStart' };
      for (const [i, a] of Object.entries(map)) {
        const p = gp.buttons[i] && gp.buttons[i].pressed;
        if (p && !this._gpPrev[i]) this._fire(a);
        this._gpPrev[i] = p;
      }
    } else {
      // Generic joystick: X roll, Y pitch, axis 2 throttle, twist (3 or 5) yaw.
      g.roll = dz(ax[0] || 0); g.pitch = dz(ax[1] || 0);
      if (ax.length > 2) g.throttle = clamp((1 - (ax[2] || 0)) / 2, 0, 1);
      g.yaw = dz(ax.length > 5 ? ax[5] : (ax[3] || 0));
      g.brake = gp.buttons[1] && gp.buttons[1].pressed ? 1 : 0;
      const map = { 0: 'gear', 2: 'flapsUp', 3: 'flapsDown', 4: 'cameraNext' };
      for (const [i, a] of Object.entries(map)) {
        const p = gp.buttons[i] && gp.buttons[i].pressed;
        if (p && !this._gpPrev[i]) this._fire(a);
        this._gpPrev[i] = p;
      }
    }
  }
}

export const input = new Input();

export function keyLabel(code) {
  if (!code) return '';
  let s = code;
  const shift = s.startsWith('Shift+');
  if (shift) s = s.slice(6);
  s = s.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ').replace('Arrow', '')
    .replace('BracketLeft', '[').replace('BracketRight', ']').replace('Equal', '=').replace('Minus', '-')
    .replace('Period', '.').replace('Comma', ',').replace('Slash', '/').replace('Backquote', '`').replace('Escape', 'Esc')
    .replace('PageUp', 'PgUp').replace('PageDown', 'PgDn').replace('Space', 'Space');
  return (shift ? 'Shift+' : '') + s;
}
