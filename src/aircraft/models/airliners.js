// Passenger aircraft model descriptions (original designs inspired by aircraft classes).
import { tube, airlinerWindshield, gaWindows, wing, winglet, hstab, vfin, airlinerGear, tipLights, glazing, PIc as PI } from './common.js';
import { FuselageShape, loftGeometry } from '../modeler.js';

const gl = (yAttach, r, groundY) => yAttach - r - groundY;

// ------------------------------------------------------------------ C-19 commuter (19 seats, twin turboprop, T-tail)
export function commuter() {
  const zN = -8.4, zT = 9.2, w = 0.84, h = 0.98, G = -2.05;
  const st = tube({ zN, zT, w, h, nose: 4.6, tail: 6.0, noseY: -0.22, upsweep: 0.6, tipW: 0.12 });
  return {
    fuselage: { stations: st, rings: 64, segs: 28 },
    livery: { base: '#f5f6f4', belly: '#d9dcde', stripes: [{ color: '#0f7c86', th: -0.05, wth: 0.16 }, { color: '#1e3d5c', th: -0.22, wth: 0.07 }], title: 'COASTLINE', titleColor: '#0f5c66', titleSize: 40, reg: 'N19CX', windows: { th: 0.12, z0: -3.0, z1: 4.4, pitch: 0.78, w: 0.32, h: 0.42 }, doors: [{ z: 5.3, w: 0.75, h: 1.4, th: -0.05, sides: [-1] }, { z: -3.9, w: 0.6, h: 1.0, sides: [1] }], tail: '#0f7c86', logo: 'wing', logoColor: '#fff', wing: '#e8eaec', engine: '#f2f2f0', radius: 0.9 },
    cockpitWindows: glazing('commuter'),
    wings: [wing({ root: [0.3, -0.62, -1.7], span: 8.55, cRoot: 2.75, cTip: 1.05, sweep: 3, dihedral: 6, tRoot: 0.16, tTip: 0.12, flaps: [[0.6, 4.6]], ailerons: [5.0, 8.3], flapMax: 35 })],
    tails: [
      vfin({ root: [0, 0.65, 6.0], h: 2.7, c0: 2.6, c1: 1.6, sweep: 32 }),
      hstab({ root: [0, 3.25, 7.25], span: 3.0, c0: 1.55, c1: 0.85, sweep: 16, dihedral: 0 }),
      { root: [0.4, 0.5, 7.0], panels: [{ span: 0.9, c0: 0.8, c1: 0.5, sweep: 20, dihedral: 0, t0: 0.08, t1: 0.08 }], surfaces: [], camber: 0, material: 'body2' },
    ],
    engines: [
      { kind: 'nacelle', pos: [-2.55, -0.55, -3.0], len: 4.9, r: 0.42, squash: [0.9, 1.15], exhaust: [[-2.95, -0.35, -1.6, 0.13], [-2.15, -0.35, -1.6, 0.13]] },
      { kind: 'nacelle', pos: [2.55, -0.55, -3.0], len: 4.9, r: 0.42, squash: [0.9, 1.15], exhaust: [[2.95, -0.35, -1.6, 0.13], [2.15, -0.35, -1.6, 0.13]] },
    ],
    props: [
      { pos: [-2.55, -0.5, -3.1], diam: 2.78, blades: 4, spinnerR: 0.24, spinnerLen: 0.55, dir: 1, engine: 0 },
      { pos: [2.55, -0.5, -3.1], diam: 2.78, blades: 4, spinnerR: 0.24, spinnerLen: 0.55, dir: 1, engine: 1 },
    ],
    gear: [
      { name: 'nose', pos: [0, -0.85, -6.3], len: gl(-0.85, 0.26, G), wheels: 2, r: 0.26, w: 0.16, track: 0.3, steer: true, retract: { axis: 'x', angle: 1.6 }, doors: true },
      { name: 'mainL', pos: [-2.55, -0.85, -0.6], len: gl(-0.85, 0.36, G), wheels: 2, r: 0.36, w: 0.2, track: 0.42, retract: { axis: 'x', angle: 1.55 }, doors: false },
      { name: 'mainR', pos: [2.55, -0.85, -0.6], len: gl(-0.85, 0.36, G), wheels: 2, r: 0.36, w: 0.2, track: 0.42, retract: { axis: 'x', angle: 1.55 }, doors: false },
    ],
    lights: { navL: [-8.75, 0.3, -0.7], navR: [8.75, 0.3, -0.7], tail: [0, 3.3, 8.6], beaconTop: [0, 3.55, 7.6], beaconBottom: [0, -0.98, 0.5], landing: [[-1.2, -0.6, -1.9], [1.2, -0.6, -1.9]] },
    cockpit: { eye: [-0.36, 0.3, -5.0], layout: 'turboprop', seats: 2 },
    cabin: { z0: -4.0, z1: 4.6, rows: 9, abreast: [1, 2], aisle: 0.1, eye: [0.45, 0.05, 1.2], floorY: -0.75 },
    groundY: G,
  };
}

// ------------------------------------------------------------------ RT-72 regional turboprop (high wing)
export function regionalTurboprop() {
  const zN = -12.4, zT = 14.8, w = 1.42, h = 1.45, G = -2.6;
  const st = tube({ zN, zT, w, h, nose: 4.2, tail: 8.5, noseY: -0.35, upsweep: 1.25, tipW: 0.18 });
  return {
    fuselage: { stations: st, rings: 72, segs: 30 },
    bodies: [
      { stations: [[-1.8, 0.01, 0.01, 0, 2], [-1.0, 0.35, 0.45, 0, 2], [1.6, 0.45, 0.55, 0, 2], [3.4, 0.01, 0.01, 0.05, 2]], pos: [1.25, -0.95, 0.6], mirror: true, material: 'body2', exterior: false },
      { stations: [[-2.6, 0.01, 0.01, 0, 2], [-1.2, 0.6, 0.35, 0, 2.5], [2.6, 0.6, 0.3, 0, 2.5], [3.8, 0.01, 0.01, 0, 2]], pos: [0, 1.35, -0.5], material: 'body2' },
    ],
    livery: { base: '#fbfbfa', belly: '#e1e4e6', stripes: [{ color: '#1c4f9c', th: -0.2, wth: 0.1, slope: 0.0 }, { color: '#f28a1a', th: -0.32, wth: 0.05 }], tailBlock: { color: '#1c4f9c', z0: 8.5 }, title: 'AURELIA REGIONAL', titleColor: '#1c4f9c', titleSize: 44, reg: 'N724AR', windows: { th: 0.1, z0: -6.5, z1: 7.6, pitch: 0.76, w: 0.32, h: 0.44 }, doors: [{ z: 9.2, w: 0.8, h: 1.7, sides: [-1] }, { z: -7.6, w: 1.2, h: 1.4, sides: [1] }], tail: '#1c4f9c', logo: 'circle', logoColor: '#f28a1a', wing: '#e6e8ea', engine: '#f0f0ee', radius: 1.45 },
    cockpitWindows: glazing('regional'),
    wings: [wing({ root: [0.4, 1.38, -1.6], span: 13.1, cRoot: 2.6, cTip: 1.45, sweep: 2.5, dihedral: 0, tRoot: 0.18, tTip: 0.13, flaps: [[0.7, 7.4]], ailerons: [7.8, 12.6], camber: 0.03, flapMax: 33 })],
    tails: [
      vfin({ root: [0, 1.0, 9.5], h: 4.6, c0: 4.2, c1: 2.2, sweep: 34 }),
      hstab({ root: [0, 5.55, 12.35], span: 3.7, c0: 1.75, c1: 0.95, sweep: 12, dihedral: 0 }),
    ],
    engines: [
      { kind: 'nacelle', pos: [-4.1, 0.95, -2.8], len: 5.6, r: 0.55, squash: [0.85, 1.25], exhaust: [[-4.1, 0.55, 0.9, 0.17]] },
      { kind: 'nacelle', pos: [4.1, 0.95, -2.8], len: 5.6, r: 0.55, squash: [0.85, 1.25], exhaust: [[4.1, 0.55, 0.9, 0.17]] },
    ],
    props: [
      { pos: [-4.1, 1.0, -2.95], diam: 3.93, blades: 6, spinnerR: 0.32, spinnerLen: 0.75, dir: 1, engine: 0, chord: 0.24 },
      { pos: [4.1, 1.0, -2.95], diam: 3.93, blades: 6, spinnerR: 0.32, spinnerLen: 0.75, dir: 1, engine: 1, chord: 0.24 },
    ],
    gear: [
      { name: 'nose', pos: [0, -1.1, -10.6], len: gl(-1.1, 0.33, G), wheels: 2, r: 0.33, w: 0.18, track: 0.38, steer: true, retract: { axis: 'x', angle: 1.6 }, doors: true },
      { name: 'mainL', pos: [-1.55, -1.1, 0.7], len: gl(-1.1, 0.45, G), wheels: 2, r: 0.45, w: 0.24, track: 0.5, retract: { axis: 'z', angle: 1.2 }, doors: false },
      { name: 'mainR', pos: [1.55, -1.1, 0.7], len: gl(-1.1, 0.45, G), wheels: 2, r: 0.45, w: 0.24, track: 0.5, retract: { axis: 'z', angle: -1.2 }, doors: false },
    ],
    lights: { navL: [-13.5, 1.4, -0.5], navR: [13.5, 1.4, -0.5], tail: [0, 5.7, 14.4], beaconTop: [0, 5.9, 12.4], beaconBottom: [0, -1.45, 0.0], landing: [[-1.5, 1.2, -1.7], [1.5, 1.2, -1.7]] },
    cockpit: { eye: [-0.5, 0.42, -9.0], layout: 'regional_glass', seats: 2 },
    cabin: { z0: -6.8, z1: 8.0, rows: 18, abreast: [2, 2], aisle: 0.48, eye: [0.85, 0.12, 2.0], floorY: -0.95 },
    groundY: G,
  };
}

// ------------------------------------------------------------------ RJ-90 regional jet (rear engines, T-tail)
export function regionalJet() {
  const zN = -17.2, zT = 19.0, w = 1.34, h = 1.36, G = -2.75;
  const st = tube({ zN, zT, w, h, nose: 5.0, tail: 8.0, noseY: -0.3, upsweep: 1.0 });
  const W = wing({ root: [0.3, -0.98, -3.2], span: 12.0, cRoot: 4.8, cKink: 3.0, kink: 0.3, cTip: 1.15, sweep: 26, dihedral: 3, tRoot: 0.13, tTip: 0.1, flaps: [[0.8, 7.0]], ailerons: [7.6, 11.4], flapMax: 45 });
  return {
    fuselage: { stations: st, rings: 80, segs: 30 },
    livery: { base: '#f7f7f6', belly: '#c9ced3', stripes: [{ color: '#c4202a', th: -0.16, wth: 0.08 }, { color: '#2a2f38', th: -0.26, wth: 0.03 }], tailBlock: { color: '#2a2f38', z0: 10.5 }, title: 'ARCUS CONNECT', titleColor: '#2a2f38', titleSize: 48, reg: 'N908RJ', windows: { th: 0.12, z0: -11.0, z1: 9.5, pitch: 0.51, w: 0.24, h: 0.34 }, doors: [{ z: -12.6, w: 0.85, h: 1.6, sides: [-1] }, { z: -12.2, w: 0.7, h: 1.2, sides: [1] }, { z: 10.6, w: 0.6, h: 1.0, sides: [1, -1] }], tail: '#2a2f38', logo: 'star', logoColor: '#c4202a', wing: '#d8dbde', engine: '#eeeeec', radius: 1.35 },
    cockpitWindows: glazing('regional'),
    wings: [W],
    tails: [
      vfin({ root: [0, 1.05, 13.0], h: 4.2, c0: 4.6, c1: 2.6, sweep: 40 }),
      hstab({ root: [0, 5.15, 16.3], span: 4.3, c0: 2.4, c1: 1.15, sweep: 32, dihedral: -2 }),
      winglet({ on: W, h: 1.25, c1: 0.5, sweep: 38, cant: 10 }),
    ],
    engines: [
      { kind: 'turbofan', pos: [-2.3, 0.75, 8.6], r: 0.72, len: 3.4, fanBlades: 24, pylon: null, reverser: true },
      { kind: 'turbofan', pos: [2.3, 0.75, 8.6], r: 0.72, len: 3.4, fanBlades: 24, pylon: null, reverser: true },
    ],
    gear: airlinerGear({ yAttach: -0.95, zNose: -14.2, noseLen: gl(-0.95, 0.33, G), noseR: 0.33, xMain: 2.3, zMain: 0.6, mainLen: gl(-0.95, 0.5, G), mainR: 0.5 }),
    lights: { ...tipLights(W), tail: [0, 5.2, 18.8], beaconTop: [0, 1.36, 2.0], beaconBottom: [0, -1.36, 0.0], landing: [[-1.6, -1.0, -2.2], [1.6, -1.0, -2.2]] },
    custom({ out, mats, addStatic, THREE }) {
      // pylons from fuselage to rear engines
      for (const s of [-1, 1]) addStatic('engine', new THREE.BoxGeometry(1.2, 0.22, 1.9).translate(s * 1.6, 0.75, 10.4));
    },
    cockpit: { eye: [-0.52, 0.4, -13.7], layout: 'rj_glass', seats: 2 },
    cabin: { z0: -11.4, z1: 9.6, rows: 22, abreast: [2, 2], aisle: 0.48, eye: [0.8, 0.15, 0.0], floorY: -0.88 },
    groundY: G,
  };
}

// ------------------------------------------------------------------ M-738 narrow-body twin jet
export function narrowbody() {
  const zN = -17.9, zT = 21.6, w = 1.88, h = 2.0, G = -3.3;
  const st = tube({ zN, zT, w, h, nose: 6.2, tail: 9.5, noseY: -0.55, upsweep: 1.55, tipW: 0.25, tipH: 0.35 });
  const W = wing({ root: [0.5, -1.35, -4.6], span: 16.9, cRoot: 7.3, cKink: 4.3, kink: 0.32, cTip: 1.25, sweep: 25, sweepIn: 26, dihedral: 6, tRoot: 0.15, tTip: 0.1, flaps: [[1.0, 5.4], [5.6, 11.0]], ailerons: [11.6, 15.6], flapMax: 40 });
  return {
    fuselage: { stations: st, rings: 90, segs: 34 },
    livery: { base: '#fdfdfc', belly: '#1b2f57', stripes: [{ color: '#1b2f57', th: -0.36, wth: 0.12, z0: -12, z1: 21.6, slope: 0.0 }, { color: '#e3a823', th: -0.27, wth: 0.04, z0: -10, z1: 21.6 }], tailBlock: { color: '#1b2f57', z0: 13.2 }, title: 'MERIDIAN', titleColor: '#1b2f57', titleSize: 64, titleScaleX: 1.25, reg: 'N738MD', windows: { th: 0.14, z0: -13.0, z1: 15.0, pitch: 0.51, w: 0.26, h: 0.37, skip: [[-0.2, 1.1]] }, doors: [{ z: -13.7, w: 0.95, h: 1.9, sides: [1, -1] }, { z: 16.0, w: 0.85, h: 1.85, sides: [1, -1] }, { z: 0.45, w: 0.55, h: 1.0, sides: [1, -1] }], tail: '#1b2f57', logo: 'wing', logoColor: '#e3a823', wing: '#d6d9dc', engine: '#e9eaeb', engineAccent: '#b8bcc0', radius: 2.0, accent: '#1b2f57' },
    cockpitWindows: glazing('airliner'),
    wings: [W],
    tails: [
      vfin({ root: [0, 1.6, 14.4], h: 6.0, c0: 5.6, c1: 1.6, sweep: 35 }),
      hstab({ root: [0.4, 0.55, 17.5], span: 6.4, c0: 3.7, c1: 1.15, sweep: 30, dihedral: 7 }),
      winglet({ on: W, h: 2.4, c1: 0.45, sweep: 38, cant: 15 }),
    ],
    engines: [
      { kind: 'turbofan', pos: [-4.95, -2.05, -7.9], r: 1.03, len: 4.1, fanBlades: 24, flatBottom: true, pylon: { h: 0.8, len: 3.8, z: 2.8, sweepBack: 0.8 }, reverser: true },
      { kind: 'turbofan', pos: [4.95, -2.05, -7.9], r: 1.03, len: 4.1, fanBlades: 24, flatBottom: true, pylon: { h: 0.8, len: 3.8, z: 2.8, sweepBack: 0.8 }, reverser: true },
    ],
    gear: airlinerGear({ yAttach: -1.55, zNose: -14.6, noseLen: gl(-1.55, 0.35, G), noseR: 0.35, xMain: 2.86, zMain: 1.2, mainLen: gl(-1.55, 0.56, G), mainR: 0.56, doors: false }),
    lights: { ...tipLights(W), tail: [0, 0.5, 21.4], beaconTop: [0, 2.0, 0.0], beaconBottom: [0, -2.0, 2.0], landing: [[-2.4, -1.4, -3.3], [2.4, -1.4, -3.3]] },
    cockpit: { eye: [-0.54, 0.62, -13.75], layout: 'nb_glass', seats: 2 },
    cabin: { z0: -12.6, z1: 15.2, rows: 30, abreast: [3, 3], aisle: 0.5, eye: [1.2, 0.22, 2.5], floorY: -1.25 },
    groundY: G,
  };
}

// ------------------------------------------------------------------ T-3 tri-jet (three rear engines, T-tail, classic)
export function trijet() {
  const zN = -21.2, zT = 25.6, w = 1.88, h = 2.05, G = -3.55;
  const st = tube({ zN, zT, w, h, nose: 6.0, tail: 10.5, noseY: -0.55, upsweep: 1.3, tipW: 0.6, tipH: 0.6 });
  return {
    fuselage: { stations: st, rings: 96, segs: 34 },
    livery: { base: '#cfd3d6', belly: '#b9bec2', stripes: [{ color: '#c99a2e', th: -0.08, wth: 0.12, z0: -21, z1: 22 }, { color: '#7a3b12', th: -0.2, wth: 0.05, z0: -21, z1: 22 }], title: 'ORION AIRWAYS', titleColor: '#7a3b12', titleSize: 56, reg: 'N727OR', windows: { th: 0.08, z0: -16.0, z1: 16.0, pitch: 0.51, w: 0.24, h: 0.34 }, doors: [{ z: -16.6, w: 0.9, h: 1.8, sides: [1, -1] }], tail: '#c99a2e', logo: 'star', logoColor: '#7a3b12', wing: '#c3c7cb', engine: '#d4d7da', radius: 2.0, panelPitch: 1.1 },
    cockpitWindows: glazing('airliner'),
    wings: [wing({ root: [0.5, -1.4, -4.4], span: 16.0, cRoot: 7.2, cKink: 4.4, kink: 0.3, cTip: 1.9, sweep: 32, dihedral: 3, tRoot: 0.13, tTip: 0.09, flaps: [[0.9, 5.0], [5.2, 10.2]], ailerons: [10.8, 15.4], flapMax: 40 })],
    tails: [
      vfin({ root: [0, 1.75, 16.8], h: 6.3, c0: 6.4, c1: 3.2, sweep: 45 }),
      hstab({ root: [0, 8.0, 22.9], span: 5.4, c0: 3.3, c1: 1.5, sweep: 35, dihedral: -3 }),
    ],
    engines: [
      { kind: 'turbofan', pos: [-2.4, 0.9, 16.0], r: 0.78, len: 4.6, fanBlades: 20, longCowl: true, reverser: true },
      { kind: 'turbofan', pos: [2.4, 0.9, 16.0], r: 0.78, len: 4.6, fanBlades: 20, longCowl: true, reverser: true },
    ],
    gear: airlinerGear({ yAttach: -1.6, zNose: -17.0, noseLen: gl(-1.6, 0.36, G), noseR: 0.36, xMain: 2.85, zMain: 1.4, mainLen: gl(-1.6, 0.58, G), mainR: 0.58 }),
    lights: { navL: [-16.4, -0.5, 5.7], navR: [16.4, -0.5, 5.7], tail: [0, 2.0, 25.6], beaconTop: [0, 2.05, 2.0], beaconBottom: [0, -2.05, 1.5], landing: [[-2.5, -1.5, -3.6], [2.5, -1.5, -3.6]] },
    custom({ addStatic, THREE, mats, out }) {
      for (const s of [-1, 1]) addStatic('engine', new THREE.BoxGeometry(1.1, 0.25, 2.2).translate(s * 1.7, 0.9, 18.0));
      // centre engine S-duct intake at the base of the fin and exhaust in the tail cone
      const intake = new THREE.CylinderGeometry(0.62, 0.72, 2.4, 20, 1, true).rotateX(Math.PI / 2).translate(0, 2.65, 16.0);
      addStatic('engine', intake);
      addStatic('fanDisc', new THREE.CircleGeometry(0.6, 20).rotateY(Math.PI).translate(0, 2.65, 15.5));
      addStatic('exhaust', new THREE.CylinderGeometry(0.55, 0.6, 0.8, 18, 1, true).rotateX(Math.PI / 2).translate(0, 1.3, 25.4));
      // aft airstair (ventral) outline
      addStatic('darkMetal', new THREE.BoxGeometry(0.9, 0.05, 2.6).translate(0, -1.2, 22.4));
    },
    cockpit: { eye: [-0.55, 0.6, -17.0], layout: 'classic_3crew', seats: 3 },
    cabin: { z0: -16.0, z1: 16.0, rows: 30, abreast: [3, 3], aisle: 0.5, eye: [1.2, 0.2, 1.0], floorY: -1.25 },
    groundY: G,
  };
}

// ------------------------------------------------------------------ M-787W wide-body twin
export function widebody() {
  const zN = -28.6, zT = 34.2, w = 2.9, h = 2.98, G = -5.1;
  const st = tube({ zN, zT, w, h, nose: 9.0, tail: 15.0, noseY: -0.8, upsweep: 2.2, tipW: 0.35, tipH: 0.5 });
  return {
    fuselage: { stations: st, rings: 110, segs: 40 },
    livery: { base: '#fdfdfd', belly: '#e9ecef', stripes: [{ color: '#103a73', th: -0.5, wth: 0.22, z0: 4, z1: 34.2, slope: 0.08 }, { color: '#2fa6dd', th: -0.3, wth: 0.05, z0: 8, z1: 34.2, slope: 0.08 }], tailBlock: { color: '#103a73', z0: 22 }, title: 'PACIFICA', titleColor: '#103a73', titleSize: 84, titleScaleX: 1.3, reg: 'N789PC', windows: { th: 0.18, z0: -21.0, z1: 25.5, pitch: 0.53, w: 0.3, h: 0.5, skip: [[-11.6, -10.2], [4.6, 6.0], [17.0, 18.4]] }, doors: [{ z: -22.2, w: 1.07, h: 1.95 }, { z: -10.9, w: 1.07, h: 1.95 }, { z: 5.3, w: 1.07, h: 1.95 }, { z: 17.7, w: 1.07, h: 1.95 }, { z: 26.5, w: 1.07, h: 1.95 }], tail: '#103a73', logo: 'wing', logoColor: '#2fa6dd', wing: '#dfe2e5', engine: '#f2f3f4', engineAccent: '#b9bdc1', radius: 2.95 },
    cockpitWindows: glazing('airliner'),
    wings: [wing({ root: [0.8, -2.05, -8.2], span: 26.8, cRoot: 11.8, cKink: 6.8, kink: 0.32, cTip: 1.8, sweep: 32, sweepIn: 30, dihedral: 6.5, tRoot: 0.15, tTip: 0.09, flaps: [[1.5, 8.5], [9.0, 17.0]], ailerons: [17.8, 25.8], flapMax: 35, raked: { span: 3.4, c: 0.6, sweep: 48 }, twist: 3.5 })],
    tails: [
      vfin({ root: [0, 2.4, 24.6], h: 9.0, c0: 8.4, c1: 3.0, sweep: 40 }),
      hstab({ root: [0.6, 0.9, 28.8], span: 9.6, c0: 5.4, c1: 1.7, sweep: 34, dihedral: 7 }),
    ],
    engines: [
      { kind: 'turbofan', pos: [-9.75, -3.25, -13.5], r: 1.78, len: 6.8, fanBlades: 18, pylon: { h: 1.2, len: 5.5, z: 4.2, sweepBack: 1.0 }, reverser: true },
      { kind: 'turbofan', pos: [9.75, -3.25, -13.5], r: 1.78, len: 6.8, fanBlades: 18, pylon: { h: 1.2, len: 5.5, z: 4.2, sweepBack: 1.0 }, reverser: true },
    ],
    gear: airlinerGear({ yAttach: -2.4, zNose: -23.0, noseLen: gl(-2.4, 0.55, G), noseR: 0.55, xMain: 4.9, zMain: 2.8, mainLen: gl(-2.4, 0.66, G), mainR: 0.66, mainWheels: 4, bogie: 2.5 }),
    lights: { navL: [-30.6, 1.4, 11.2], navR: [30.6, 1.4, 11.2], tail: [0, 1.2, 34.0], beaconTop: [0, 2.98, 0.0], beaconBottom: [0, -2.98, 2.0], landing: [[-3.6, -2.0, -6.6], [3.6, -2.0, -6.6]] },
    cockpit: { eye: [-0.62, 0.95, -22.6], layout: 'wb_glass', seats: 2 },
    cabin: { z0: -21.0, z1: 25.0, rows: 40, abreast: [3, 3, 3], aisle: 0.5, eye: [2.0, 0.4, 0.0], floorY: -1.6 },
    groundY: G,
  };
}

// ------------------------------------------------------------------ A-740 jumbo quad-jet with upper deck
export function jumbo() {
  const zN = -31.2, zT = 39.5, w = 3.25, h = 3.4, G = -6.2;
  const st = tube({ zN, zT, w, h, nose: 10.0, tail: 17.0, noseY: -1.1, upsweep: 2.6, tipW: 0.4, tipH: 0.5, hump: { z0: -26.5, z1: -9.0, dh: 2.5 } });
  const W = wing({ root: [0.9, -2.3, -12.2], span: 30.8, cRoot: 14.8, cKink: 8.8, kink: 0.3, cTip: 3.9, sweep: 37.5, sweepIn: 36, dihedral: 7, tRoot: 0.13, tTip: 0.08, flaps: [[1.5, 9.0], [9.4, 19.5]], ailerons: [20.2, 30.0], flapMax: 30, twist: 3 });
  return {
    fuselage: { stations: st, rings: 120, segs: 40 },
    livery: { base: '#fafafa', belly: '#9aa3ad', stripes: [{ color: '#b0182c', th: -0.22, wth: 0.12, z0: -31, z1: 39 }, { color: '#16284f', th: -0.38, wth: 0.12, z0: -31, z1: 39 }], tailBlock: { color: '#16284f', z0: 26 }, title: 'ATLAS INTERNATIONAL', titleColor: '#16284f', titleSize: 66, titleTh: 0.5, titleZ: -12, reg: 'N740AT', windows: { th: 0.12, z0: -25.0, z1: 30.0, pitch: 0.53, w: 0.28, h: 0.42, skip: [[-20.6, -19.0], [-9.0, -7.6], [3.4, 4.8], [15.0, 16.4]], rows: [{ th: 0.12, z0: -25, z1: 30 }, { th: 0.86, z0: -22.5, z1: -10 }] }, doors: [{ z: -24.0, w: 1.07, h: 1.95 }, { z: -19.8, w: 1.07, h: 1.95 }, { z: -8.3, w: 1.07, h: 1.95 }, { z: 4.1, w: 1.07, h: 1.95 }, { z: 15.7, w: 1.07, h: 1.95 }], tail: '#16284f', logo: 'circle', logoColor: '#b0182c', wing: '#d8dbde', engine: '#ececec', engineAccent: '#b6babe', radius: 3.3 },
    cockpitWindows: glazing('airliner'),
    wings: [W],
    tails: [
      vfin({ root: [0, 2.6, 28.8], h: 10.0, c0: 10.0, c1: 3.4, sweep: 45 }),
      hstab({ root: [0.6, 1.0, 33.0], span: 10.8, c0: 6.4, c1: 2.0, sweep: 37, dihedral: 7 }),
      winglet({ on: W, h: 1.8, c1: 1.0, sweep: 50, cant: 28 }),
    ],
    engines: [
      { kind: 'turbofan', pos: [-12.0, -3.65, -16.4], r: 1.42, len: 6.1, fanBlades: 38, pylon: { h: 0.9, len: 4.5, z: 3.6, sweepBack: 1.0 }, reverser: true, engine: 0 },
      { kind: 'turbofan', pos: [-21.0, -2.55, -8.6], r: 1.42, len: 6.1, fanBlades: 38, pylon: { h: 0.8, len: 4.4, z: 3.6, sweepBack: 1.0 }, reverser: true, engine: 1 },
      { kind: 'turbofan', pos: [12.0, -3.65, -16.4], r: 1.42, len: 6.1, fanBlades: 38, pylon: { h: 0.9, len: 4.5, z: 3.6, sweepBack: 1.0 }, reverser: true, engine: 2 },
      { kind: 'turbofan', pos: [21.0, -2.55, -8.6], r: 1.42, len: 6.1, fanBlades: 38, pylon: { h: 0.8, len: 4.4, z: 3.6, sweepBack: 1.0 }, reverser: true, engine: 3 },
    ],
    gear: airlinerGear({ yAttach: -2.6, zNose: -25.3, noseLen: gl(-2.6, 0.62, G), noseR: 0.62, xMain: 5.7, zMain: 0.4, mainLen: gl(-2.6, 0.62, G), mainR: 0.62, mainWheels: 4, bogie: 1.5, bodyGear: { x: 1.85, z: 3.6 } }),
    lights: { ...tipLights(W), tail: [0, 1.4, 39.3], beaconTop: [0, 5.9, -14.0], beaconBottom: [0, -3.4, 2.0], landing: [[-4.0, -2.4, -10.1], [4.0, -2.4, -10.1]] },
    cockpit: { eye: [-0.6, 3.0, -24.8], layout: 'jumbo_glass', seats: 2 },
    cabin: { z0: -22.0, z1: 30.0, rows: 46, abreast: [3, 4, 3], aisle: 0.5, eye: [2.3, 0.4, 2.0], floorY: -1.7 },
    groundY: G,
  };
}

// ------------------------------------------------------------------ SST-2 supersonic transport (ogival delta, droop nose)
export function supersonic() {
  const zN = -32.0, zT = 29.7, w = 1.45, h = 1.62, G = -4.7;
  // slender body with long pointed nose (nose section is drawn separately so it can droop)
  const st = [
    [-25.0, 1.12, 1.25, -0.06, 2], [-23.0, 1.32, 1.48, -0.02, 2], [-20.0, 1.45, 1.62, 0, 2], [20.0, 1.45, 1.62, 0, 2],
    [24.0, 1.25, 1.35, 0.15, 2], [27.0, 0.85, 0.9, 0.3, 2], [29.7, 0.12, 0.12, 0.5, 2],
  ];
  return {
    fuselage: { stations: st, rings: 90, segs: 30 },
    livery: { base: '#fbfbfb', belly: '#f0f0f0', stripes: [{ color: '#20345c', th: 0.08, wth: 0.05 }, { color: '#c8a24a', th: 0.0, wth: 0.02 }], title: 'AURORA', titleColor: '#20345c', titleSize: 54, titleScaleX: 1.4, reg: 'N2SSTA', windows: { th: 0.18, z0: -17.0, z1: 16.0, pitch: 0.55, w: 0.16, h: 0.24 }, doors: [{ z: -21.0, w: 0.8, h: 1.6 }, { z: 1.0, w: 0.7, h: 1.4, sides: [-1] }], tail: '#fbfbfb', tailStripe: '#20345c', logo: 'text', logoText: 'A', logoColor: '#20345c', wing: '#f4f4f4', engine: '#e8e8e8', radius: 1.5 },
    cockpitWindows: glazing('sst'),
    wings: [{
      root: [0.6, -1.0, -16.5], camber: 0.0, material: 'wing', twist1: 1.5,
      panels: [
        { span: 1.9, c0: 37.0, c1: 30.0, sweep: 78, dihedral: -1, t0: 0.035, t1: 0.033 },
        { span: 4.0, c0: 30.0, c1: 19.5, sweep: 62, dihedral: -1, t0: 0.033, t1: 0.03 },
        { span: 6.2, c0: 19.5, c1: 3.2, sweep: 52, dihedral: -2, t0: 0.03, t1: 0.03 },
      ],
      surfaces: [
        { name: 'elevonIn', type: 'elevon', s0: 0.17, s1: 0.45, cf: 0.12, max: 25 },
        { name: 'elevonMid', type: 'elevon', s0: 0.46, s1: 0.72, cf: 0.14, max: 25 },
        { name: 'elevonOut', type: 'elevon', s0: 0.73, s1: 0.98, cf: 0.22, max: 25 },
      ],
    }],
    tails: [vfin({ root: [0, 1.4, 19.0], h: 8.0, c0: 10.5, c1: 2.6, sweep: 52, cf: 0.28 })],
    engines: [],
    gear: [
      { name: 'nose', pos: [0, -1.4, -15.0], len: gl(-1.4, 0.45, G), wheels: 2, r: 0.45, w: 0.24, track: 0.6, steer: true, retract: { axis: 'x', angle: 1.6 }, doors: true },
      { name: 'mainL', pos: [-3.85, -1.75, 3.5], len: gl(-1.75, 0.58, G), wheels: 4, r: 0.58, w: 0.3, track: 0.75, bogie: 1.4, retract: { axis: 'z', angle: 1.55 }, doors: true, doorSide: -1 },
      { name: 'mainR', pos: [3.85, -1.75, 3.5], len: gl(-1.75, 0.58, G), wheels: 4, r: 0.58, w: 0.3, track: 0.75, bogie: 1.4, retract: { axis: 'z', angle: -1.55 }, doors: true, doorSide: 1 },
    ],
    lights: { navL: [-13.1, -1.6, 15.2], navR: [13.1, -1.6, 15.2], tail: [0, 1.0, 29.7], beaconTop: [0, 1.62, -2.0], beaconBottom: [0, -1.62, -6.0], landing: [[-1.2, -1.5, -10.0], [1.2, -1.5, -10.0]] },
    custom({ out, mats, addStatic, outer, exterior, THREE, shape }) {
      // engine nacelle boxes (paired) under the wing
      for (const s of [-1, 1]) {
        const g = new THREE.BoxGeometry(2.6, 1.15, 13.5);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { if (p.getZ(i) < 0) { p.setY(i, p.getY(i) * (p.getY(i) < 0 ? 1.0 : 0.6)); } }
        g.computeVertexNormals();
        g.translate(s * 4.35, -2.05, 13.8);
        addStatic('engine', g);
        for (const k of [-0.65, 0.65]) {
          addStatic('fanDisc', new THREE.PlaneGeometry(1.15, 0.85).rotateY(Math.PI).translate(s * 4.35 + k, -2.1, 7.03));
          addStatic('exhaust', new THREE.CylinderGeometry(0.5, 0.56, 1.4, 16, 1, true).rotateX(Math.PI / 2).translate(s * 4.35 + k, -2.05, 21.2));
        }
      }
      // droop nose + visor (animated)
      const nose = new THREE.Group();
      nose.position.set(0, -0.6, -25.0);
      const noseShape = [[-7.0, 0.02, 0.02, -0.45, 2], [-6.0, 0.25, 0.25, -0.38, 2], [-3.5, 0.62, 0.68, -0.2, 2], [-1.2, 0.98, 1.1, -0.05, 2], [0.02, 1.12, 1.25, 0.54, 2]];
      const ns = new FuselageShape(noseShape);
      const ng = loftGeometry(ns, 30, 24);
      const nm = new THREE.Mesh(ng, mats.body2);
      nm.position.y = 0.6;
      nose.add(nm);
      const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 2.0, 6).rotateX(Math.PI / 2), mats.chrome);
      probe.position.set(0, 0.15, -7.8);
      nose.add(probe);
      outer.add(nose);
      out.extras.droopNose = nose;
    },
    cockpit: { eye: [-0.5, 0.55, -23.0], layout: 'sst_classic', seats: 3 },
    cabin: { z0: -19.0, z1: 16.0, rows: 25, abreast: [2, 2], aisle: 0.45, eye: [0.75, 0.15, -3.0], floorY: -1.0 },
    groundY: G,
  };
}
