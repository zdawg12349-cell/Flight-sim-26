// General aviation: high-wing trainer, composite low-wing single, light twin, radial bush plane, aerobatic biplane.
import { gaWindows, wing, hstab, vfin, tipLights, glazing, PIc as PI } from './common.js';

const gl = (yAttach, r, groundY) => yAttach - r - groundY;

function strut(addStatic, THREE, a, b, r = 0.035) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  // align Y axis with segment
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  g.applyQuaternion(q);
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  g.scale(1, 1, 1);
  // flatten into an aerofoil-ish strut
  addStatic('wing', g);
}

// ------------------------------------------------------------------ Skylark S-172 high-wing trainer
export function trainer() {
  const G = -1.42;
  const st = [
    [-2.55, 0.12, 0.12, 0.05, 2], [-2.45, 0.3, 0.3, 0.05, 2.2], [-2.1, 0.42, 0.42, 0.06, 2.6], [-1.4, 0.5, 0.52, 0.08, 3], [-0.9, 0.55, 0.66, 0.12, 3.2],
    [0.4, 0.56, 0.7, 0.1, 3.2], [1.4, 0.44, 0.58, 0.12, 3], [3.0, 0.24, 0.36, 0.2, 2.6], [4.6, 0.11, 0.2, 0.28, 2.2], [5.5, 0.05, 0.12, 0.32, 2],
  ];
  const W = { root: [0.25, 0.86, -0.95], camber: 0.04, material: 'wing', twist1: 3,
    panels: [{ span: 2.4, c0: 1.63, c1: 1.63, sweep: 0, dihedral: 1.7, t0: 0.15, t1: 0.15 }, { span: 2.85, c0: 1.63, c1: 1.13, sweep: 1.5, dihedral: 1.7, t0: 0.15, t1: 0.12 }],
    surfaces: [{ name: 'flap0', type: 'flap', s0: 0.03, s1: 0.48, cf: 0.3, max: 30 }, { name: 'aileron', type: 'aileron', s0: 0.52, s1: 0.95, cf: 0.27, max: 20 }] };
  return {
    fuselage: { stations: st, rings: 52, segs: 28 },
    livery: { base: '#f7f7f5', stripes: [{ color: '#1f4e8c', th: -0.42, wth: 0.09, slope: 0.012 }, { color: '#d4a017', th: -0.55, wth: 0.04, slope: 0.012 }], reg: 'N172SK', regZ: 2.2, regSize: 30, tail: '#f7f7f5', tailStripe: '#1f4e8c', wing: '#f4f4f2', radius: 0.62, res: [1024, 512] },
    cockpitWindows: glazing('gaHigh'),
    wings: [W],
    tails: [
      hstab({ root: [0.05, 0.1, 4.45], span: 1.75, c0: 1.25, c1: 0.85, sweep: 5, dihedral: 0, t: 0.09, cf: 0.4 }),
      vfin({ root: [0, 0.22, 4.15], h: 1.45, c0: 1.55, c1: 0.62, sweep: 38, cf: 0.4, material: 'body2' }),
    ],
    engines: [],
    props: [{ pos: [0, 0.05, -2.62], diam: 1.93, blades: 2, spinnerR: 0.14, spinnerLen: 0.3, dir: 1, engine: 0, chord: 0.15 }],
    gear: [
      { name: 'nose', pos: [0, -0.4, -1.8], len: gl(-0.4, 0.19, G), wheels: 1, r: 0.19, w: 0.12, steer: true, fairing: true, strutR: 0.035 },
      { name: 'mainL', pos: [-0.55, -0.55, 0.05], len: 0.0, wheels: 1, r: 0.22, w: 0.13, fairing: true, offsetX: -0.6, strutR: 0.03, noStrut: true },
      { name: 'mainR', pos: [0.55, -0.55, 0.05], len: 0.0, wheels: 1, r: 0.22, w: 0.13, fairing: true, offsetX: 0.6, strutR: 0.03, noStrut: true },
    ].map((g) => (g.name.startsWith('main') ? { ...g, len: gl(-0.55, 0.22, G) } : g)),
    lights: { ...tipLights(W, 0.0), tail: [0, 1.6, 5.15], beaconTop: [0, 1.7, 4.9], landing: [[-1.2, 0.86, -0.95]] },
    custom({ addStatic, THREE }) {
      for (const s of [-1, 1]) {
        strut(addStatic, THREE, [s * 0.55, -0.42, -0.25], [s * 2.6, 0.86, -0.55], 0.04);
        // spring-steel main gear leg
        strut(addStatic, THREE, [s * 0.55, -0.55, 0.05], [s * 1.15, G + 0.22, 0.05], 0.035);
      }
      // engine cowl details: air intakes + exhaust
      addStatic('darkMetal', new THREE.BoxGeometry(0.16, 0.08, 0.05).translate(-0.18, -0.12, -2.48));
      addStatic('darkMetal', new THREE.BoxGeometry(0.16, 0.08, 0.05).translate(0.18, -0.12, -2.48));
      addStatic('exhaust', new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6).translate(0.12, -0.4, -1.9));
    },
    cockpit: { eye: [-0.27, 0.42, -0.25], layout: 'ga_analog', seats: 2 },
    cabin: null,
    groundY: G,
  };
}

// ------------------------------------------------------------------ Zephyr Z-22 composite low-wing single (glass cockpit)
export function composite() {
  const G = -1.48;
  const st = [
    [-2.6, 0.13, 0.13, -0.02, 2], [-2.45, 0.3, 0.3, -0.02, 2], [-2.0, 0.44, 0.44, 0.0, 2.2], [-1.2, 0.58, 0.62, 0.05, 2.4], [-0.3, 0.62, 0.7, 0.08, 2.5],
    [0.8, 0.6, 0.66, 0.1, 2.4], [2.0, 0.42, 0.5, 0.14, 2.2], [3.6, 0.22, 0.3, 0.2, 2], [5.2, 0.07, 0.12, 0.25, 2],
  ];
  const W = wing({ root: [0.3, -0.42, -0.75], span: 5.6, cRoot: 1.6, cTip: 0.78, sweep: 2, dihedral: 4.5, tRoot: 0.15, tTip: 0.12, flaps: [[0.35, 3.2]], ailerons: [3.5, 5.4], flapMax: 32, camber: 0.035 });
  return {
    fuselage: { stations: st, rings: 56, segs: 30 },
    livery: { base: '#fbfbfa', stripes: [{ color: '#8a1c2b', th: -0.25, wth: 0.05, slope: 0.02 }, { color: '#9aa2ab', th: -0.36, wth: 0.12, slope: 0.02 }], title: 'ZEPHYR', titleColor: '#8a1c2b', titleSize: 28, titleZ: 2.2, titleTh: 0.0, reg: 'N22ZP', regZ: 3.4, regSize: 26, tail: '#fbfbfa', logo: 'wing', logoColor: '#8a1c2b', wing: '#fbfbfa', spinner: '#f5f5f5', radius: 0.65, res: [1024, 512] },
    cockpitWindows: glazing('gaLow'),
    wings: [W],
    tails: [
      hstab({ root: [0.05, 0.12, 4.35], span: 1.95, c0: 1.0, c1: 0.62, sweep: 6, dihedral: 3, t: 0.09 }),
      vfin({ root: [0, 0.32, 4.05], h: 1.3, c0: 1.3, c1: 0.6, sweep: 35, material: 'body2' }),
    ],
    props: [{ pos: [0, -0.02, -2.68], diam: 1.98, blades: 3, spinnerR: 0.17, spinnerLen: 0.42, dir: 1, engine: 0, chord: 0.14 }],
    gear: [
      { name: 'nose', pos: [0, -0.42, -1.75], len: gl(-0.42, 0.18, G), wheels: 1, r: 0.18, w: 0.12, steer: true, fairing: true, strutR: 0.035 },
      { name: 'mainL', pos: [-1.35, -0.5, 0.25], len: gl(-0.5, 0.22, G), wheels: 1, r: 0.22, w: 0.13, fairing: true, strutR: 0.04 },
      { name: 'mainR', pos: [1.35, -0.5, 0.25], len: gl(-0.5, 0.22, G), wheels: 1, r: 0.22, w: 0.13, fairing: true, strutR: 0.04 },
    ],
    lights: { ...tipLights(W), tail: [0, 1.5, 5.1], beaconTop: [0, 1.62, 4.8], landing: [[-0.2, -0.25, -2.45], [0.2, -0.25, -2.45]] },
    custom({ addStatic, THREE }) {
      addStatic('exhaust', new THREE.CylinderGeometry(0.035, 0.035, 0.25, 6).rotateX(0.4).translate(0.25, -0.4, -1.5));
      addStatic('darkMetal', new THREE.BoxGeometry(0.42, 0.1, 0.05).translate(0, -0.18, -2.52));
    },
    cockpit: { eye: [-0.29, 0.38, 0.0], layout: 'ga_glass', seats: 2 },
    cabin: null,
    groundY: G,
  };
}

// ------------------------------------------------------------------ Duomax D-58 light twin
export function lightTwin() {
  const G = -1.55;
  const st = [
    [-3.6, 0.01, 0.01, -0.12, 2], [-3.4, 0.2, 0.18, -0.1, 2], [-2.8, 0.42, 0.4, -0.05, 2.2], [-1.9, 0.6, 0.62, 0.02, 2.5], [-0.8, 0.64, 0.7, 0.06, 2.6],
    [0.8, 0.62, 0.68, 0.08, 2.5], [2.2, 0.42, 0.5, 0.14, 2.2], [3.8, 0.22, 0.3, 0.22, 2], [5.4, 0.07, 0.12, 0.28, 2],
  ];
  const W = wing({ root: [0.3, -0.45, -1.05], span: 5.45, cRoot: 2.1, cTip: 1.0, sweep: 2, dihedral: 6, tRoot: 0.15, tTip: 0.12, flaps: [[0.4, 3.4]], ailerons: [3.6, 5.3], flapMax: 30, camber: 0.03 });
  return {
    fuselage: { stations: st, rings: 60, segs: 30 },
    livery: { base: '#f8f8f6', stripes: [{ color: '#14457a', th: -0.18, wth: 0.12, slope: 0.015 }, { color: '#e07a1a', th: -0.32, wth: 0.04, slope: 0.015 }], reg: 'N58DX', regZ: 3.2, regSize: 28, title: 'DUOMAX', titleColor: '#14457a', titleSize: 26, titleZ: -3.2, titleTh: 0.0, tail: '#14457a', logo: 'text', logoText: 'D', wing: '#f8f8f6', engine: '#f8f8f6', radius: 0.66, res: [1024, 512] },
    cockpitWindows: glazing('gaLow'),
    wings: [W],
    tails: [
      hstab({ root: [0.05, 0.15, 4.5], span: 2.05, c0: 1.2, c1: 0.7, sweep: 8, dihedral: 0, t: 0.09 }),
      vfin({ root: [0, 0.35, 3.9], h: 1.55, c0: 1.6, c1: 0.7, sweep: 34, material: 'tail' }),
    ],
    engines: [
      { kind: 'nacelle', pos: [-2.05, -0.15, -2.2], len: 3.4, r: 0.4, squash: [0.9, 1.0], exhaust: [[-2.25, -0.35, -1.0, 0.04]] },
      { kind: 'nacelle', pos: [2.05, -0.15, -2.2], len: 3.4, r: 0.4, squash: [0.9, 1.0], exhaust: [[2.25, -0.35, -1.0, 0.04]] },
    ],
    props: [
      { pos: [-2.05, -0.1, -2.32], diam: 1.98, blades: 3, spinnerR: 0.16, spinnerLen: 0.38, dir: 1, engine: 0 },
      { pos: [2.05, -0.1, -2.32], diam: 1.98, blades: 3, spinnerR: 0.16, spinnerLen: 0.38, dir: 1, engine: 1 },
    ],
    gear: [
      { name: 'nose', pos: [0, -0.45, -2.6], len: gl(-0.45, 0.18, G), wheels: 1, r: 0.18, w: 0.12, steer: true, retract: { axis: 'x', angle: -1.55 }, doors: true, strutR: 0.04 },
      { name: 'mainL', pos: [-2.05, -0.45, 0.05], len: gl(-0.45, 0.25, G), wheels: 1, r: 0.25, w: 0.15, retract: { axis: 'x', angle: -1.55 }, doors: true, strutR: 0.05 },
      { name: 'mainR', pos: [2.05, -0.45, 0.05], len: gl(-0.45, 0.25, G), wheels: 1, r: 0.25, w: 0.15, retract: { axis: 'x', angle: -1.55 }, doors: true, strutR: 0.05 },
    ],
    lights: { ...tipLights(W), tail: [0, 1.95, 5.2], beaconTop: [0, 1.95, 4.6], beaconBottom: [0, -0.68, 0.0], landing: [[-1.4, -0.45, -1.1], [1.4, -0.45, -1.1]] },
    cockpit: { eye: [-0.3, 0.38, -0.9], layout: 'twin_analog', seats: 2 },
    cabin: { z0: -0.3, z1: 1.6, rows: 2, abreast: [1, 1], aisle: 0.3, eye: [0.28, 0.12, 1.4], floorY: -0.55, club: true },
    groundY: G,
  };
}

// ------------------------------------------------------------------ Bushhawk B-2 radial-engine bush plane (taildragger)
export function bushPlane() {
  const G = -1.62;
  const st = [
    [-2.85, 0.52, 0.52, 0.0, 2], [-2.4, 0.62, 0.64, 0.02, 2.2], [-1.6, 0.62, 0.74, 0.06, 3], [-0.6, 0.64, 0.82, 0.1, 3.4], [1.0, 0.6, 0.78, 0.1, 3.4],
    [2.6, 0.4, 0.56, 0.16, 3], [4.6, 0.2, 0.34, 0.26, 2.4], [6.3, 0.06, 0.14, 0.34, 2],
  ];
  const W = { root: [0.3, 0.98, -0.85], camber: 0.045, material: 'wing', twist1: 2,
    panels: [{ span: 7.0, c0: 1.6, c1: 1.55, sweep: 0, dihedral: 1.5, t0: 0.16, t1: 0.14 }],
    surfaces: [{ name: 'flap0', type: 'flap', s0: 0.04, s1: 0.58, cf: 0.25, max: 45 }, { name: 'aileron', type: 'aileron', s0: 0.6, s1: 0.96, cf: 0.25, max: 18 }] };
  return {
    fuselage: { stations: st, rings: 56, segs: 28 },
    livery: { base: '#f2c230', belly: '#f2c230', stripes: [{ color: '#1c1c1c', th: -0.2, wth: 0.06 }, { color: '#1c1c1c', th: -0.32, wth: 0.02 }], title: 'BUSHHAWK', titleColor: '#1c1c1c', titleSize: 30, titleZ: 0.9, titleTh: 0.05, reg: 'C-FBHK', regZ: 3.4, regSize: 30, tail: '#f2c230', tailStripe: '#1c1c1c', wing: '#f2c230', engine: '#2b2b2b', radius: 0.75, res: [1024, 512] },
    cockpitWindows: glazing('gaHighRoof'),
    wings: [W],
    tails: [
      hstab({ root: [0.05, 0.25, 5.3], span: 2.45, c0: 1.25, c1: 0.9, sweep: 6, dihedral: 0, t: 0.09 }),
      vfin({ root: [0, 0.4, 5.0], h: 1.6, c0: 1.4, c1: 0.8, sweep: 22, cf: 0.42 }),
    ],
    engines: [{ kind: 'radial', pos: [0, 0.0, -2.95], r: 0.68, len: 0.9, material: 'engine' }],
    props: [{ pos: [0, 0.0, -3.08], diam: 2.59, blades: 2, spinnerR: 0.17, spinnerLen: 0.3, dir: 1, engine: 0, chord: 0.2 }],
    gear: [
      { name: 'mainL', pos: [-0.5, -0.6, -1.0], len: gl(-0.6, 0.38, G), wheels: 1, r: 0.38, w: 0.24, offsetX: -0.8, strutR: 0.04, noStrut: true },
      { name: 'mainR', pos: [0.5, -0.6, -1.0], len: gl(-0.6, 0.38, G), wheels: 1, r: 0.38, w: 0.24, offsetX: 0.8, strutR: 0.04, noStrut: true },
      { name: 'tail', pos: [0, 0.05, 5.85], len: 0.18, wheels: 1, r: 0.11, w: 0.07, steer: true, strutR: 0.025 },
    ],
    lights: { ...tipLights(W, 0.0), tail: [0, 2.05, 6.0], beaconTop: [0, 1.65, 1.0], landing: [[-1.5, 0.95, -0.85]] },
    custom({ addStatic, THREE }) {
      for (const s of [-1, 1]) {
        strut(addStatic, THREE, [s * 0.62, -0.55, -0.6], [s * 2.9, 0.95, -0.55], 0.045);
        strut(addStatic, THREE, [s * 0.62, -0.55, -0.2], [s * 2.9, 0.95, 0.4], 0.045);
        strut(addStatic, THREE, [s * 0.5, -0.6, -1.0], [s * 1.3, G + 0.38, -1.0], 0.045);
        strut(addStatic, THREE, [s * 0.5, -0.6, -0.4], [s * 1.3, G + 0.38, -1.0], 0.035);
      }
      addStatic('exhaust', new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8).rotateX(0.3).translate(0.4, -0.55, -1.8));
    },
    cockpit: { eye: [-0.3, 0.48, -0.45], layout: 'bush_analog', seats: 2 },
    cabin: { z0: 0.3, z1: 1.8, rows: 2, abreast: [1, 1], aisle: 0.2, eye: [0.3, 0.15, 1.6], floorY: -0.6, bench: true },
    groundY: G,
    taildragger: true,
  };
}

// ------------------------------------------------------------------ Swallow SB-1 aerobatic biplane
export function biplane() {
  const G = -1.22;
  const st = [
    [-1.85, 0.36, 0.36, 0.0, 2], [-1.6, 0.44, 0.46, 0.0, 2.2], [-1.0, 0.45, 0.55, 0.04, 2.8], [0.2, 0.42, 0.55, 0.06, 3], [1.4, 0.3, 0.44, 0.1, 2.6],
    [2.8, 0.14, 0.26, 0.2, 2.2], [3.9, 0.05, 0.1, 0.26, 2],
  ];
  const up = { root: [0.0, 0.78, -1.25], camber: 0.0, material: 'wing', twist1: 0,
    panels: [{ span: 3.05, c0: 1.0, c1: 0.95, sweep: 9, dihedral: 0, t0: 0.12, t1: 0.12 }],
    surfaces: [{ name: 'aileron', type: 'aileron', s0: 0.15, s1: 0.95, cf: 0.25, max: 25 }] };
  const lo = { root: [0.2, -0.38, -0.75], camber: 0.0, material: 'wing', twist1: 0,
    panels: [{ span: 2.85, c0: 0.95, c1: 0.9, sweep: 0, dihedral: 2.5, t0: 0.12, t1: 0.12 }],
    surfaces: [{ name: 'aileronLower', type: 'aileron', s0: 0.15, s1: 0.95, cf: 0.25, max: 25 }] };
  return {
    fuselage: { stations: st, rings: 48, segs: 28 },
    livery: { base: '#d62d20', belly: '#fafafa', stripes: [{ color: '#fafafa', th: -0.1, wth: 0.18, z0: -1.8, z1: 3.9, slope: 0.03 }, { color: '#111', th: -0.22, wth: 0.04, z0: -1.8, z1: 3.9, slope: 0.03 }], reg: 'N2SB', regZ: 2.1, regSize: 30, regColor: '#fff', tail: '#d62d20', logo: 'star', logoColor: '#fff', wing: '#d62d20', engine: '#d62d20', spinner: '#fafafa', radius: 0.5, res: [1024, 512] },
    cockpitWindows: [],
    wings: [up, lo],
    tails: [
      hstab({ root: [0.02, 0.15, 3.35], span: 1.15, c0: 0.75, c1: 0.55, sweep: 10, dihedral: 0, t: 0.08, cf: 0.45 }),
      vfin({ root: [0, 0.25, 3.3], h: 1.0, c0: 0.8, c1: 0.5, sweep: 20, cf: 0.5, material: 'tail' }),
    ],
    props: [{ pos: [0, 0.0, -1.92], diam: 1.93, blades: 2, spinnerR: 0.14, spinnerLen: 0.3, dir: 1, engine: 0, chord: 0.16 }],
    gear: [
      { name: 'mainL', pos: [-0.3, -0.45, -1.0], len: gl(-0.45, 0.22, G), wheels: 1, r: 0.22, w: 0.12, offsetX: -0.55, fairing: true, strutR: 0.03, noStrut: true },
      { name: 'mainR', pos: [0.3, -0.45, -1.0], len: gl(-0.45, 0.22, G), wheels: 1, r: 0.22, w: 0.12, offsetX: 0.55, fairing: true, strutR: 0.03, noStrut: true },
      { name: 'tail', pos: [0, 0.0, 3.7], len: 0.15, wheels: 1, r: 0.07, w: 0.05, steer: true, strutR: 0.02 },
    ],
    lights: { navL: [-3.1, 0.82, -0.85], navR: [3.1, 0.82, -0.85], tail: [0, 1.25, 3.9], beaconTop: [0, 0.95, 0.2], landing: [] },
    custom({ out, mats, addStatic, outer, THREE }) {
      // interplane I-struts and cabane struts
      for (const s of [-1, 1]) {
        strut(addStatic, THREE, [s * 2.45, -0.27, -0.55], [s * 2.45, 0.78, -0.75], 0.03);
        strut(addStatic, THREE, [s * 2.45, -0.27, 0.1], [s * 2.45, 0.78, 0.0], 0.03);
        strut(addStatic, THREE, [s * 0.3, 0.42, -1.1], [s * 0.45, 0.78, -1.1], 0.025);
        strut(addStatic, THREE, [s * 0.3, 0.4, -0.55], [s * 0.45, 0.78, -0.4], 0.025);
        strut(addStatic, THREE, [s * 0.3, -0.45, -0.75], [s * 0.85, G + 0.22, -1.0], 0.03);
        // flying wires
        strut(addStatic, THREE, [s * 0.4, -0.35, -0.7], [s * 2.4, 0.75, -0.7], 0.006);
        strut(addStatic, THREE, [s * 0.4, 0.75, -0.7], [s * 2.4, -0.3, -0.7], 0.006);
      }
      // bubble canopy over the rear seat
      const c = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      c.scale(0.38, 0.38, 0.85);
      const canopy = new THREE.Mesh(c, mats.glass);
      canopy.position.set(0, 0.5, 0.05);
      outer.add(canopy);
      out.extras.canopy = canopy;
    },
    cockpit: { eye: [0, 0.78, 0.15], layout: 'aerobatic', seats: 1 },
    cabin: null,
    groundY: G,
    taildragger: true,
  };
}
