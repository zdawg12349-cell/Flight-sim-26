// Persistent settings (graphics, audio, controls, gameplay) stored in localStorage.
import { bus } from './events.js';

const KEY = 'fs26.settings.v1';

export const GRAPHICS_PRESETS = {
  low: {
    label: 'Low', renderScale: 0.72, maxRenderScale: 0.85, minRenderScale: 0.5, antialias: false,
    shadows: false, shadowMapSize: 0, cockpitShadows: false, drawDistance: 24000, terrainDetail: 0.55,
    treeDensity: 0.35, treeRadius: 1700, buildingRadius: 5500, cloudPuffs: 320, precipCount: 1400,
    displayRes: 256, displayHz: 8, envMap: false, pbr: false, water: 0, parkedAircraft: 4, groundVehicles: 6,
    maxPixelRatio: 1, colormapSize: 1024,
  },
  medium: {
    label: 'Medium', renderScale: 0.9, maxRenderScale: 1.0, minRenderScale: 0.6, antialias: false,
    shadows: true, shadowMapSize: 1024, cockpitShadows: false, drawDistance: 36000, terrainDetail: 0.8,
    treeDensity: 0.6, treeRadius: 2800, buildingRadius: 8500, cloudPuffs: 700, precipCount: 3200,
    displayRes: 384, displayHz: 12, envMap: true, pbr: true, water: 1, parkedAircraft: 8, groundVehicles: 12,
    maxPixelRatio: 1, colormapSize: 2048,
  },
  high: {
    label: 'High', renderScale: 1.0, maxRenderScale: 1.0, minRenderScale: 0.7, antialias: true,
    shadows: true, shadowMapSize: 2048, cockpitShadows: true, drawDistance: 50000, terrainDetail: 1.0,
    treeDensity: 1.0, treeRadius: 4200, buildingRadius: 13000, cloudPuffs: 1200, precipCount: 6000,
    displayRes: 512, displayHz: 20, envMap: true, pbr: true, water: 2, parkedAircraft: 14, groundVehicles: 20,
    maxPixelRatio: 1.5, colormapSize: 2048,
  },
  ultra: {
    label: 'Ultra', renderScale: 1.0, maxRenderScale: 1.0, minRenderScale: 0.75, antialias: true,
    shadows: true, shadowMapSize: 4096, cockpitShadows: true, drawDistance: 65000, terrainDetail: 1.25,
    treeDensity: 1.3, treeRadius: 6000, buildingRadius: 18000, cloudPuffs: 2000, precipCount: 10000,
    displayRes: 512, displayHz: 30, envMap: true, pbr: true, water: 2, parkedAircraft: 20, groundVehicles: 28,
    maxPixelRatio: 2, colormapSize: 4096,
  },
};

export const DEFAULT_BINDINGS = {
  pitchDown: ['KeyW', 'ArrowUp'],
  pitchUp: ['KeyS', 'ArrowDown'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ', 'Numpad0'],
  yawRight: ['KeyE', 'NumpadEnter'],
  throttleUp: ['KeyR', 'PageUp', 'Equal', 'NumpadAdd'],
  throttleDown: ['KeyF', 'PageDown', 'Minus', 'NumpadSubtract'],
  throttleFull: ['Shift+KeyR'],
  throttleIdle: ['Shift+KeyF'],
  trimUp: ['Home', 'Numpad1'],
  trimDown: ['End', 'Numpad7'],
  gear: ['KeyG'],
  flapsUp: ['BracketLeft', 'Digit5'],
  flapsDown: ['BracketRight', 'Digit6'],
  brakes: ['KeyB', 'Period'],
  parkingBrake: ['Shift+KeyB'],
  spoilers: ['Slash'],
  reverse: ['KeyT'],
  autopilot: ['KeyZ'],
  apPanel: ['Shift+KeyZ'],
  engineStart: ['KeyI'],
  engineStop: ['Shift+KeyI'],
  landingLights: ['KeyL'],
  allLights: ['Shift+KeyL'],
  cameraNext: ['KeyC'],
  cameraPrev: ['Shift+KeyC'],
  cockpitView: ['KeyV', 'Digit1'],
  cabinView: ['Digit2'],
  chaseView: ['Digit3'],
  sideView: ['Digit4'],
  cinematicView: ['Digit7'],
  lookReset: ['Space'],
  map: ['KeyM'],
  hud: ['KeyU'],
  help: ['KeyH'],
  atc: ['Backquote', 'KeyY'],
  pause: ['KeyP'],
  menu: ['Escape'],
  hoist: ['KeyK'],
};

export const ACTION_LABELS = {
  pitchDown: 'Pitch down (push)', pitchUp: 'Pitch up (pull)', rollLeft: 'Roll left', rollRight: 'Roll right',
  yawLeft: 'Rudder / pedal left', yawRight: 'Rudder / pedal right', throttleUp: 'Throttle / collective up',
  throttleDown: 'Throttle / collective down', throttleFull: 'Throttle full', throttleIdle: 'Throttle idle',
  trimUp: 'Elevator trim nose up', trimDown: 'Elevator trim nose down', gear: 'Landing gear toggle',
  flapsUp: 'Flaps retract one step', flapsDown: 'Flaps extend one step', brakes: 'Wheel brakes (hold)',
  parkingBrake: 'Parking brake', spoilers: 'Speed brakes / spoilers', reverse: 'Thrust reversers',
  autopilot: 'Autopilot master', apPanel: 'Autopilot panel', engineStart: 'Engine auto-start',
  engineStop: 'Engine shutdown', landingLights: 'Landing lights', allLights: 'Nav / beacon / strobe lights',
  cameraNext: 'Next camera', cameraPrev: 'Previous camera', cockpitView: 'Cockpit view', cabinView: 'Cabin view',
  chaseView: 'Chase view', sideView: 'Side view', cinematicView: 'Cinematic view', lookReset: 'Reset view',
  map: 'Moving map', hud: 'Flight info overlay', help: 'Controls help', atc: 'ATC radio panel', pause: 'Pause',
  menu: 'Menu', hoist: 'Rescue hoist / cargo hook',
};

function defaults() {
  return {
    version: 1,
    graphics: { preset: 'medium', autoQuality: true, targetFps: 60, fov: 64, showFps: true, ...GRAPHICS_PRESETS.medium },
    audio: { master: 0.8, engine: 0.9, environment: 0.7, cockpit: 0.8, ui: 0.6, atcVoice: true, gpws: true, muted: false },
    controls: {
      mode: 'simplified', invertPitch: false, mouseSensitivity: 1.0, mouseYoke: false, keyboardRate: 1.0,
      bindings: JSON.parse(JSON.stringify(DEFAULT_BINDINGS)), gamepad: true,
    },
    gameplay: {
      emergencyFrequency: 'rare', units: 'aviation', hud: true, trainingHints: true, crashDetection: true,
      startEnginesRunning: true, atcText: true,
      assists: { autoRudder: true, autoTrim: true, stallProtection: true, heliStability: true, autoMixture: true },
    },
    last: { aircraft: 'skylark', airport: 'KPXR', spawn: 'runway', weather: 'clear', time: 10.5, season: 'summer' },
    aircraftPrefs: {},
  };
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(over)) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      deepMerge(base[k], v);
    } else if (v !== undefined) base[k] = v;
  }
  return base;
}

function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function safeSet(key, val) { try { localStorage.setItem(key, val); return true; } catch (e) { return false; } }

class Settings {
  constructor() {
    this.data = defaults();
    const raw = safeGet(KEY);
    if (raw) {
      try { deepMerge(this.data, JSON.parse(raw)); } catch (e) { console.warn('settings parse failed', e); }
    }
    // Make sure newly added default bindings exist.
    for (const [a, keys] of Object.entries(DEFAULT_BINDINGS)) {
      if (!this.data.controls.bindings[a]) this.data.controls.bindings[a] = keys.slice();
    }
    this._t = 0;
  }
  get g() { return this.data.graphics; }
  get a() { return this.data.audio; }
  get c() { return this.data.controls; }
  get p() { return this.data.gameplay; }
  applyPreset(name) {
    const p = GRAPHICS_PRESETS[name];
    if (!p) return;
    Object.assign(this.data.graphics, p, { preset: name });
    this.save();
    bus.emit('settings:graphics', this.data.graphics);
  }
  save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => safeSet(KEY, JSON.stringify(this.data)), 150);
  }
  saveNow() { clearTimeout(this._t); return safeSet(KEY, JSON.stringify(this.data)); }
  reset() { this.data = defaults(); this.saveNow(); bus.emit('settings:graphics', this.data.graphics); bus.emit('settings:audio', this.data.audio); }
  resetBindings() { this.data.controls.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)); this.save(); }
  aircraftPref(id) {
    if (!this.data.aircraftPrefs[id]) this.data.aircraftPrefs[id] = { fuel: 0.6, payload: 0.7, livery: 0 };
    return this.data.aircraftPrefs[id];
  }
}

export const settings = new Settings();
export { safeGet, safeSet };
