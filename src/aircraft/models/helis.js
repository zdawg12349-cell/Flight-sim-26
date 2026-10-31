// Helicopter model descriptions: light piston, twin passenger, utility, rescue (fenestron + hoist), tandem heavy-lift.
import { heliWindows, hstab, vfin, glazing, PIc as PI } from './common.js';

function boom(z0, z1, y0, y1, r0, r1) {
  return { stations: [[z0, r0, r0 * 1.1, y0, 2], [(z0 + z1) / 2, (r0 + r1) / 2, (r0 + r1) / 2 * 1.05, (y0 + y1) / 2, 2], [z1, r1, r1, y1, 2]], pos: [0, 0, 0], material: 'body' };
}

// ------------------------------------------------------------------ Hummingbird H-22 light piston helicopter
export function lightHeli() {
  const G = -1.12;
  const st = [
    [-1.75, 0.01, 0.01, -0.05, 2], [-1.6, 0.34, 0.38, -0.02, 2], [-1.2, 0.58, 0.66, 0.02, 2], [-0.5, 0.68, 0.76, 0.05, 2.2], [0.4, 0.66, 0.74, 0.06, 2.4],
    [0.9, 0.5, 0.6, 0.12, 2.2], [1.25, 0.24, 0.3, 0.32, 2], [1.5, 0.15, 0.18, 0.42, 2],
  ];
  return {
    fuselage: { stations: st, rings: 48, segs: 30 },
    bodies: [
      { stations: [[1.3, 0.16, 0.18, 0.42, 2], [3.5, 0.11, 0.12, 0.62, 2], [5.9, 0.07, 0.08, 0.82, 2]], material: 'body2' },
      { stations: [[0.3, 0.01, 0.01, 0, 2], [0.5, 0.38, 0.3, 0, 3], [1.6, 0.34, 0.28, 0, 3], [1.9, 0.01, 0.01, 0.05, 2]], pos: [0, 0.75, 0], material: 'darkMetal' },
    ],
    livery: { base: '#c41f2c', belly: '#f2f2f0', stripes: [{ color: '#f2f2f0', th: -0.35, wth: 0.12 }], title: 'H-22', titleColor: '#fff', titleSize: 34, titleZ: 0.2, titleTh: -0.25, reg: 'N22HB', regZ: 0.7, regTh: 0.35, tail: '#c41f2c', rotor: '#2a2a2a', radius: 0.7, res: [1024, 512] },
    cockpitWindows: glazing('heliBubble'),
    tails: [
      vfin({ root: [0, 0.6, 5.6], h: 0.75, c0: 0.62, c1: 0.38, sweep: 30, noRudder: true, material: 'body2' }),
      { root: [0, 0.6, 5.65], dir: [0, -1, 0], up: [-1, 0, 0], mirror: false, vertical: true, panels: [{ span: 0.45, c0: 0.5, c1: 0.32, sweep: -25, dihedral: 0, t0: 0.1, t1: 0.1 }], surfaces: [], camber: 0, material: 'body2' },
      { root: [0.05, 0.72, 5.0], panels: [{ span: 0.65, c0: 0.4, c1: 0.32, sweep: 0, dihedral: 0, t0: 0.1, t1: 0.1 }], surfaces: [], camber: 0, material: 'body2' },
    ],
    rotors: [{ pos: [0, 1.55, 0.15], radius: 5.03, blades: 2, chord: 0.26, mastH: 0.75, hubR: 0.18, dir: 1, droop: 0.06, tipStripe: false }],
    tailRotors: [{ pos: [-0.16, 0.85, 5.95], radius: 0.74, blades: 2, chord: 0.12 }],
    skids: { y: G + 0.05, x: 0.95, z0: -1.25, z1: 1.35, r: 0.04, attachY: -0.5, ax: 0.45, cross: [-0.6, 0.85] },
    lights: { navL: [-0.66, 0.05, 0.3], navR: [0.66, 0.05, 0.3], tail: [0, 1.35, 5.9], beaconTop: [0, 0.85, 1.1], landing: [[0, -0.5, -1.4]] },
    cockpit: { eye: [0.32, 0.3, -0.55], layout: 'heli_light', seats: 2 },
    cabin: null,
    groundY: G,
  };
}

// ------------------------------------------------------------------ Halcyon H-139 twin-turbine passenger helicopter
export function passengerHeli() {
  const G = -1.85;
  const st = [
    [-4.4, 0.01, 0.01, -0.35, 2], [-4.1, 0.35, 0.32, -0.28, 2], [-3.4, 0.78, 0.82, -0.08, 2], [-2.5, 1.02, 1.08, 0.02, 2.4], [-1.0, 1.1, 1.18, 0.05, 2.8],
    [2.2, 1.1, 1.18, 0.05, 2.8], [3.4, 0.82, 0.9, 0.25, 2.4], [4.4, 0.4, 0.46, 0.55, 2], [4.8, 0.3, 0.34, 0.65, 2],
  ];
  return {
    fuselage: { stations: st, rings: 64, segs: 32 },
    bodies: [
      { stations: [[4.6, 0.32, 0.36, 0.65, 2], [7.0, 0.24, 0.3, 0.95, 2], [9.4, 0.16, 0.22, 1.2, 2]], material: 'body' },
      { stations: [[-1.4, 0.01, 0.01, 0, 2], [-0.9, 0.62, 0.42, 0, 3], [2.4, 0.66, 0.44, 0, 3], [3.4, 0.01, 0.01, 0.1, 2]], pos: [0, 1.2, 0], material: 'body2' },
      { stations: [[-0.4, 0.01, 0.01, 0, 2], [0.0, 0.32, 0.36, 0, 2.5], [1.6, 0.32, 0.36, 0, 2.5], [2.0, 0.01, 0.01, 0, 2]], pos: [1.08, -0.72, 0], mirror: true, material: 'body2' },
    ],
    livery: { base: '#1d2733', belly: '#e9ebed', stripes: [{ color: '#c9a04a', th: -0.3, wth: 0.05 }, { color: '#e9ebed', th: -0.5, wth: 0.18 }], title: 'HALCYON', titleColor: '#c9a04a', titleSize: 40, titleZ: -0.8, titleTh: 0.25, reg: 'N139HL', regZ: 3.0, windows: { th: 0.08, z0: -0.6, z1: 2.0, pitch: 0.9, w: 0.6, h: 0.55 }, tail: '#1d2733', logo: 'wing', logoColor: '#c9a04a', rotor: '#2b2d30', radius: 1.1, res: [1024, 512] },
    cockpitWindows: glazing('heliGlass'),
    tails: [
      vfin({ root: [0, 1.05, 8.4], h: 1.6, c0: 1.3, c1: 0.85, sweep: 35, noRudder: true, material: 'body' }),
      { root: [0.15, 1.0, 7.3], panels: [{ span: 1.4, c0: 0.6, c1: 0.5, sweep: 5, dihedral: 0, t0: 0.12, t1: 0.12 }], surfaces: [], camber: 0, material: 'body' },
    ],
    rotors: [{ pos: [0, 2.35, 0.25], radius: 6.9, blades: 5, chord: 0.6, mastH: 0.7, hubR: 0.42, dir: 1, droop: 0.05, cap: true }],
    tailRotors: [{ pos: [-0.38, 2.15, 9.45], radius: 1.35, blades: 4, chord: 0.22 }],
    gear: [
      { name: 'nose', pos: [0, -0.9, -3.0], len: 0.95 - 0.21 + (G + 1.85) * -1 + 0.0, wheels: 2, r: 0.21, w: 0.12, track: 0.3, steer: true, retract: { axis: 'x', angle: -1.55 }, doors: true },
      { name: 'mainL', pos: [-1.25, -0.95, 0.8], len: 0.9 - 0.3 + 0.0, wheels: 1, r: 0.3, w: 0.16, retract: { axis: 'z', angle: 1.4 }, doors: false },
      { name: 'mainR', pos: [1.25, -0.95, 0.8], len: 0.9 - 0.3 + 0.0, wheels: 1, r: 0.3, w: 0.16, retract: { axis: 'z', angle: -1.4 }, doors: false },
    ],
    lights: { navL: [-1.1, -0.2, 1.2], navR: [1.1, -0.2, 1.2], tail: [0, 2.7, 9.6], beaconTop: [0, 1.75, 2.7], beaconBottom: [0, -1.15, 0.5], landing: [[-0.3, -1.0, -2.7], [0.3, -1.0, -2.7]] },
    cockpit: { eye: [0.48, 0.38, -2.55], layout: 'heli_glass', seats: 2 },
    cabin: { z0: -1.4, z1: 2.3, rows: 4, abreast: [2, 2], aisle: 0.1, eye: [0.5, 0.12, 1.8], floorY: -0.85 },
    groundY: G,
  };
}

// ------------------------------------------------------------------ Workhorse U-205 utility helicopter (2-blade, skids)
export function utilityHeli() {
  const G = -1.6;
  const st = [
    [-4.1, 0.01, 0.01, -0.3, 2], [-3.85, 0.42, 0.4, -0.25, 2], [-3.2, 0.92, 0.96, -0.06, 2.4], [-2.2, 1.18, 1.16, 0.02, 3], [1.8, 1.2, 1.16, 0.02, 3.2],
    [2.6, 0.82, 0.9, 0.28, 2.4], [3.4, 0.38, 0.45, 0.6, 2], [3.7, 0.32, 0.36, 0.65, 2],
  ];
  return {
    fuselage: { stations: st, rings: 60, segs: 32 },
    bodies: [
      { stations: [[3.6, 0.34, 0.38, 0.65, 2], [6.5, 0.24, 0.28, 0.8, 2], [9.0, 0.17, 0.2, 0.95, 2]], material: 'body' },
      { stations: [[-1.0, 0.01, 0.01, 0, 2], [-0.6, 0.55, 0.42, 0, 3], [2.8, 0.55, 0.46, 0, 3], [3.6, 0.01, 0.01, 0.1, 2]], pos: [0, 1.15, 0], material: 'body' },
    ],
    livery: { base: '#4b5a3a', belly: '#3e4a31', stripes: [{ color: '#e4e0cc', th: 0.25, wth: 0.05 }], title: 'WORKHORSE', titleColor: '#e4e0cc', titleSize: 38, titleZ: 0.0, titleTh: 0.3, reg: 'N205WH', regZ: 5.2, regTh: 0.0, regColor: '#e4e0cc', tail: '#4b5a3a', logo: 'star', logoColor: '#e4e0cc', rotor: '#2a2a2a', radius: 1.18, res: [1024, 512] },
    cockpitWindows: glazing('heliUtility'),
    tails: [
      vfin({ root: [0, 0.95, 8.0], h: 1.5, c0: 1.2, c1: 0.7, sweep: 42, noRudder: true, material: 'body' }),
      { root: [0.15, 0.9, 6.1], panels: [{ span: 1.35, c0: 0.55, c1: 0.42, sweep: 0, dihedral: 0, t0: 0.12, t1: 0.12 }], surfaces: [], camber: 0, material: 'body' },
    ],
    rotors: [{ pos: [0, 2.15, 0.1], radius: 7.3, blades: 2, chord: 0.53, mastH: 0.85, hubR: 0.3, dir: 1, droop: 0.07 }],
    tailRotors: [{ pos: [-0.3, 2.0, 9.3], radius: 1.3, blades: 2, chord: 0.2 }],
    skids: { y: G + 0.05, x: 1.28, z0: -2.0, z1: 1.9, r: 0.055, attachY: -0.9, ax: 0.7, cross: [-1.0, 1.0] },
    lights: { navL: [-1.2, 0.2, -0.5], navR: [1.2, 0.2, -0.5], tail: [0, 2.4, 9.3], beaconTop: [0, 1.7, 2.6], beaconBottom: [0, -1.1, 0.5], landing: [[0, -1.0, -3.2]] },
    custom({ out, mats, THREE }) {
      // stabiliser (fly) bar perpendicular to the blades
      const r = out.rotors[0];
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 6).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), mats.darkMetal);
      bar.position.y = -0.15;
      for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.25, 8).rotateX(Math.PI / 2), mats.darkMetal); w.position.set(0, 0, s * 1.3); bar.add(w); }
      r.spin.add(bar);
    },
    cockpit: { eye: [0.55, 0.42, -2.35], layout: 'heli_utility', seats: 2 },
    cabin: { z0: -1.4, z1: 1.8, rows: 3, abreast: [2, 2], aisle: 0.2, eye: [0.6, 0.15, 1.5], floorY: -0.95, bench: true },
    groundY: G,
  };
}

// ------------------------------------------------------------------ Guardian R-145 rescue helicopter (fenestron, hoist)
export function rescueHeli() {
  const G = -1.55;
  const st = [
    [-3.75, 0.01, 0.01, -0.3, 2], [-3.5, 0.36, 0.34, -0.25, 2], [-2.9, 0.78, 0.84, -0.06, 2.2], [-2.0, 0.9, 0.98, 0.02, 2.6], [1.4, 0.9, 0.98, 0.04, 2.8],
    [2.1, 0.74, 0.86, 0.22, 2.4], [2.8, 0.42, 0.5, 0.55, 2], [3.1, 0.36, 0.4, 0.62, 2],
  ];
  return {
    fuselage: { stations: st, rings: 60, segs: 32 },
    bodies: [
      { stations: [[3.0, 0.38, 0.42, 0.62, 2], [5.8, 0.28, 0.32, 0.9, 2], [8.0, 0.22, 0.26, 1.05, 2]], material: 'body' },
      { stations: [[-1.2, 0.01, 0.01, 0, 2], [-0.8, 0.5, 0.36, 0, 3], [2.0, 0.52, 0.38, 0, 3], [2.8, 0.01, 0.01, 0.1, 2]], pos: [0, 1.08, 0], material: 'body2' },
    ],
    livery: { base: '#f4f4f2', belly: '#d42222', stripes: [{ color: '#d42222', th: -0.15, wth: 0.42 }, { color: '#f6c400', th: -0.45, wth: 0.06 }], title: 'RESCUE', titleColor: '#d42222', titleSize: 46, titleZ: -0.9, titleTh: 0.45, reg: 'N145GR', regZ: 4.0, regTh: 0.1, tail: '#d42222', logo: 'cross', logoColor: '#fff', rotor: '#2a2a2a', radius: 0.95, res: [1024, 512] },
    cockpitWindows: glazing('heliGlass'),
    tails: [
      vfin({ root: [0, 0.75, 7.4], h: 1.55, c0: 1.5, c1: 0.85, sweep: 38, noRudder: true, material: 'body' }),
      { root: [0.2, 0.95, 6.3], panels: [{ span: 1.25, c0: 0.62, c1: 0.55, sweep: 0, dihedral: 0, t0: 0.12, t1: 0.12 }], surfaces: [], camber: 0, material: 'body' },
    ],
    rotors: [{ pos: [0, 1.95, 0.0], radius: 5.5, blades: 4, chord: 0.33, mastH: 0.6, hubR: 0.32, dir: 1, droop: 0.05, cap: true }],
    fenestron: { pos: [0, 1.2, 7.85], radius: 0.55 },
    skids: { y: G + 0.05, x: 1.1, z0: -1.9, z1: 1.6, r: 0.05, attachY: -0.85, ax: 0.6, cross: [-0.9, 0.9] },
    lights: { navL: [-0.9, 0.3, 0.8], navR: [0.9, 0.3, 0.8], tail: [0, 2.0, 8.2], beaconTop: [0, 1.5, 2.2], beaconBottom: [0, -1.0, 0.3], landing: [[0, -1.0, -2.6]] },
    custom({ out, mats, outer, THREE }) {
      // rescue hoist: arm above right door, cable + hook (animated)
      const arm = new THREE.Group();
      arm.position.set(1.0, 0.95, -0.6);
      arm.add(new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.16, 0.18).translate(0.32, 0, 0), mats.darkMetal));
      arm.add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.34, 10).translate(0.7, -0.05, 0), mats.red));
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1, 4).translate(0, -0.5, 0), mats.black);
      cable.position.set(0.7, -0.2, 0);
      cable.scale.y = 0.3;
      arm.add(cable);
      const hook = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mats.orange);
      hook.position.set(0.7, -0.5, 0);
      arm.add(hook);
      outer.add(arm);
      out.extras.hoist = { arm, cable, hook, length: 0.3 };
      // searchlight under the nose
      const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.22, 10).rotateX(Math.PI / 2), mats.darkMetal);
      sl.position.set(0.35, -0.95, -2.2);
      outer.add(sl);
    },
    cockpit: { eye: [0.42, 0.36, -2.05], layout: 'heli_rescue', seats: 2 },
    cabin: { z0: -0.9, z1: 1.4, rows: 2, abreast: [2, 1], aisle: 0.2, eye: [-0.5, 0.15, 1.2], floorY: -0.82, medical: true },
    groundY: G,
  };
}

// ------------------------------------------------------------------ Titan HL-47 tandem-rotor heavy lift helicopter
export function heavyHeli() {
  const G = -2.35;
  const st = [
    [-7.9, 0.01, 0.01, -0.5, 2], [-7.6, 0.7, 0.62, -0.42, 2.2], [-6.9, 1.4, 1.35, -0.18, 3], [-6.0, 1.7, 1.75, 0.0, 4], [5.0, 1.75, 1.85, 0.05, 4.5],
    [6.4, 1.7, 1.75, 0.2, 4], [7.5, 1.5, 1.4, 0.45, 3], [7.75, 1.3, 1.05, 0.6, 3],
  ];
  return {
    fuselage: { stations: st, rings: 60, segs: 32 },
    bodies: [
      // aft rotor pylon
      { stations: [[2.4, 0.01, 0.01, 0, 2], [3.4, 0.55, 1.2, 0, 3], [6.8, 0.6, 1.45, 0.3, 3], [7.8, 0.4, 0.9, 0.5, 2.5]], pos: [0, 2.3, 0], material: 'body' },
      // forward pylon
      { stations: [[-7.0, 0.01, 0.01, 0, 2], [-6.4, 0.6, 0.4, 0, 3], [-4.6, 0.6, 0.45, 0, 3], [-3.6, 0.01, 0.01, 0, 2]], pos: [0, 1.85, 0], material: 'body' },
      // side fuel pods
      { stations: [[-3.6, 0.01, 0.01, 0, 2], [-3.0, 0.42, 0.62, 0, 2.6], [3.6, 0.42, 0.62, 0, 2.6], [4.2, 0.01, 0.01, 0, 2]], pos: [1.92, -1.05, 0], mirror: true, material: 'body' },
      // engine pods on the aft pylon
      { stations: [[2.6, 0.01, 0.01, 0, 2], [3.0, 0.48, 0.48, 0, 2], [5.6, 0.5, 0.5, 0, 2], [6.0, 0.35, 0.35, 0, 2]], pos: [1.15, 2.6, 0.6], mirror: true, material: 'engine' },
    ],
    livery: { base: '#5a6247', belly: '#4b523b', stripes: [{ color: '#2c3021', th: -0.6, wth: 0.05 }], title: 'TITAN', titleColor: '#d7d3bf', titleSize: 56, titleZ: -3.8, titleTh: 0.3, reg: 'N47HL', regZ: 4.5, regColor: '#d7d3bf', windows: { th: 0.25, z0: -4.0, z1: 4.5, pitch: 1.3, w: 0.36, h: 0.36 }, tail: '#5a6247', rotor: '#2c2c2c', radius: 1.75, res: [1024, 512] },
    cockpitWindows: glazing('heliHeavy'),
    tails: [],
    rotors: [
      { pos: [0, 3.0, -5.85], radius: 9.15, blades: 3, chord: 0.81, mastH: 0.8, hubR: 0.5, dir: 1, droop: 0.06, tipStripe: true, tilt: -0.05 },
      { pos: [0, 4.2, 6.1], radius: 9.15, blades: 3, chord: 0.81, mastH: 0.8, hubR: 0.5, dir: -1, droop: 0.06, tipStripe: true, tilt: -0.03 },
    ],
    gear: [
      { name: 'frontL', pos: [-1.6, -1.55, -4.6], len: 0.8 - 0.42 + 0.0, wheels: 2, r: 0.42, w: 0.24, track: 0.5 },
      { name: 'frontR', pos: [1.6, -1.55, -4.6], len: 0.8 - 0.42 + 0.0, wheels: 2, r: 0.42, w: 0.24, track: 0.5 },
      { name: 'rearL', pos: [-1.7, -1.55, 3.6], len: 0.8 - 0.42, wheels: 1, r: 0.42, w: 0.26, steer: true },
      { name: 'rearR', pos: [1.7, -1.55, 3.6], len: 0.8 - 0.42, wheels: 1, r: 0.42, w: 0.26, steer: true },
    ],
    lights: { navL: [-2.0, -0.6, 0.0], navR: [2.0, -0.6, 0.0], tail: [0, 3.0, 8.4], beaconTop: [0, 3.5, 0.0], beaconBottom: [0, -1.9, 0.5], landing: [[-0.6, -1.7, -6.5], [0.6, -1.7, -6.5]] },
    custom({ out, mats, outer, THREE, addStatic }) {
      // rear loading ramp (animated) and cargo hook
      const ramp = new THREE.Group();
      ramp.position.set(0, -1.6, 7.0);
      ramp.add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 2.6).translate(0, 0, 1.3), mats.body2));
      outer.add(ramp);
      out.extras.ramp = ramp;
      const hook = new THREE.Group();
      hook.position.set(0, -1.85, 0.2);
      hook.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mats.darkMetal));
      const sling = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 4).translate(0, -0.5, 0), mats.black);
      sling.scale.y = 0.01;
      hook.add(sling);
      outer.add(hook);
      out.extras.cargoHook = { hook, sling };
      // small rear horizontal stub fins around the aft pylon
      addStatic('body', new THREE.BoxGeometry(2.6, 0.08, 0.7).translate(0, 2.6, 7.4));
    },
    cockpit: { eye: [0.55, 0.42, -6.3], layout: 'heli_heavy', seats: 2 },
    cabin: { z0: -5.0, z1: 6.5, rows: 10, abreast: [1, 1], aisle: 1.6, eye: [0, 0.2, 5.8], floorY: -1.5, bench: true, cargo: true },
    groundY: G,
  };
}
