// Additional jets: very light personal jet, long-range business jet, jet trainer.
import { tube, gaWindows, airlinerWindshield, wing, winglet, hstab, vfin, vtail, tipLights, glazing, PIc as PI } from './common.js';

const gl = (yAttach, r, groundY) => yAttach - r - groundY;

// ------------------------------------------------------------------ Vireo VLJ-1 (single engine on top, V-tail)
export function personalJet() {
  const G = -1.55;
  const st = [
    [-4.6, 0.01, 0.01, -0.12, 2], [-4.3, 0.22, 0.2, -0.1, 2], [-3.6, 0.48, 0.45, -0.04, 2], [-2.6, 0.7, 0.72, 0.02, 2], [-1.6, 0.8, 0.86, 0.05, 2.2],
    [0.4, 0.8, 0.86, 0.05, 2.2], [1.8, 0.62, 0.72, 0.12, 2], [3.2, 0.36, 0.48, 0.25, 2], [4.4, 0.16, 0.24, 0.35, 2], [4.85, 0.06, 0.08, 0.4, 2],
  ];
  const W = wing({ root: [0.3, -0.5, -1.0], span: 5.6, cRoot: 1.9, cTip: 0.85, sweep: 4, dihedral: 5.5, tRoot: 0.15, tTip: 0.12, flaps: [[0.5, 3.4]], ailerons: [3.7, 5.4], flapMax: 40 });
  return {
    fuselage: { stations: st, rings: 60, segs: 30 },
    livery: { base: '#f6f6f4', belly: '#3d4752', stripes: [{ color: '#d9381e', th: -0.32, wth: 0.06, z0: -4.6, z1: 4.8, slope: 0.02 }], title: 'VIREO', titleColor: '#3d4752', titleSize: 30, titleZ: 0.6, reg: 'N50VJ', regZ: 2.6, tail: '#3d4752', logo: 'wing', logoColor: '#d9381e', wing: '#f0f0ee', engine: '#e6e7e8', radius: 0.82 },
    cockpitWindows: glazing('vlj'),
    wings: [W],
    tails: [
      vtail({ root: [0.1, 0.42, 3.15], span: 2.0, c0: 1.15, c1: 0.62, sweep: 28, dihedral: 36 }),
    ],
    engines: [{ kind: 'turbofan', pos: [0, 0.98, 1.55], r: 0.37, len: 2.3, fanBlades: 20, longCowl: true }],
    gear: [
      { name: 'nose', pos: [0, -0.62, -3.15], len: gl(-0.62, 0.2, G), wheels: 1, r: 0.2, w: 0.12, steer: true, retract: { axis: 'x', angle: 1.6 }, doors: true },
      { name: 'mainL', pos: [-1.65, -0.45, 0.15], len: gl(-0.45, 0.26, G), wheels: 1, r: 0.26, w: 0.14, retract: { axis: 'z', angle: 1.55 }, doors: true, doorSide: -1 },
      { name: 'mainR', pos: [1.65, -0.45, 0.15], len: gl(-0.45, 0.26, G), wheels: 1, r: 0.26, w: 0.14, retract: { axis: 'z', angle: -1.55 }, doors: true, doorSide: 1 },
    ],
    lights: { ...tipLights(W), tail: [0, 0.4, 4.85], beaconTop: [0, 1.4, 2.6], beaconBottom: [0, -0.8, 0.0], landing: [[-0.4, -0.5, -3.4], [0.4, -0.5, -3.4]] },
    custom({ addStatic, THREE }) {
      // engine pylon fairing blending the nacelle into the fuselage spine
      addStatic('body2', new THREE.BoxGeometry(0.34, 0.5, 1.8).translate(0, 0.72, 2.4));
    },
    cockpit: { eye: [-0.34, 0.3, -1.85], layout: 'vlj_glass', seats: 2 },
    cabin: { z0: -1.4, z1: 0.6, rows: 2, abreast: [1, 1], aisle: 0.25, eye: [0.25, 0.15, 0.6], floorY: -0.62 },
    groundY: G,
  };
}

// ------------------------------------------------------------------ Stratos G-750 long-range business jet
export function bizJet() {
  const zN = -14.2, zT = 16.2, w = 1.36, h = 1.42, G = -2.55;
  const st = tube({ zN, zT, w, h, nose: 5.4, tail: 8.2, noseY: -0.3, upsweep: 1.0, tipW: 0.1 });
  const W = wing({ root: [0.3, -0.95, -3.2], span: 13.4, cRoot: 6.6, cKink: 3.9, kink: 0.28, cTip: 1.35, sweep: 36, sweepIn: 30, dihedral: 3, tRoot: 0.13, tTip: 0.09, flaps: [[0.8, 6.0]], ailerons: [6.6, 12.4], flapMax: 39 });
  return {
    fuselage: { stations: st, rings: 80, segs: 32 },
    livery: { base: '#ffffff', belly: '#2b3138', stripes: [{ color: '#2b3138', th: -0.42, wth: 0.18, z0: -10, z1: 16.2, slope: 0.03 }, { color: '#b38a3e', th: -0.28, wth: 0.025, z0: -8, z1: 16.2, slope: 0.03 }], title: 'STRATOS', titleColor: '#2b3138', titleSize: 40, titleScaleX: 1.6, titleZ: -1.5, reg: 'N750SG', windows: { th: 0.08, z0: -8.2, z1: 6.0, pitch: 1.15, w: 0.52, h: 0.62 }, doors: [{ z: -10.1, w: 0.9, h: 1.7, sides: [-1] }], tail: '#2b3138', logo: 'star', logoColor: '#b38a3e', wing: '#e4e6e8', engine: '#f2f2f2', radius: 1.4 },
    cockpitWindows: glazing('bizjet'),
    wings: [W],
    tails: [
      vfin({ root: [0, 1.15, 9.6], h: 4.0, c0: 4.8, c1: 2.6, sweep: 44 }),
      hstab({ root: [0, 5.05, 12.9], span: 4.8, c0: 2.4, c1: 1.1, sweep: 34, dihedral: -2 }),
      winglet({ on: W, h: 1.55, c1: 0.5, sweep: 42, cant: 12 }),
    ],
    engines: [
      { kind: 'turbofan', pos: [-2.05, 0.6, 7.2], r: 0.74, len: 3.7, fanBlades: 24, longCowl: true, reverser: true },
      { kind: 'turbofan', pos: [2.05, 0.6, 7.2], r: 0.74, len: 3.7, fanBlades: 24, longCowl: true, reverser: true },
    ],
    gear: [
      { name: 'nose', pos: [0, -1.0, -11.0], len: gl(-1.0, 0.28, G), wheels: 2, r: 0.28, w: 0.16, track: 0.32, steer: true, retract: { axis: 'x', angle: 1.6 }, doors: true },
      { name: 'mainL', pos: [-2.15, -1.0, 2.5], len: gl(-1.0, 0.44, G), wheels: 2, r: 0.44, w: 0.22, track: 0.5, retract: { axis: 'z', angle: 1.55 }, doors: true, doorSide: -1 },
      { name: 'mainR', pos: [2.15, -1.0, 2.5], len: gl(-1.0, 0.44, G), wheels: 2, r: 0.44, w: 0.22, track: 0.5, retract: { axis: 'z', angle: -1.55 }, doors: true, doorSide: 1 },
    ],
    lights: { ...tipLights(W), tail: [0, 5.1, 16.1], beaconTop: [0, 5.3, 13.4], beaconBottom: [0, -1.42, 0.0], landing: [[-1.5, -1.0, -2.7], [1.5, -1.0, -2.7]] },
    custom({ addStatic, THREE }) {
      for (const s of [-1, 1]) addStatic('engine', new THREE.BoxGeometry(1.0, 0.24, 1.8).translate(s * 1.4, 0.6, 8.8));
    },
    cockpit: { eye: [-0.5, 0.4, -10.6], layout: 'bizjet_glass', seats: 2 },
    cabin: { z0: -8.4, z1: 6.0, rows: 7, abreast: [1, 1], aisle: 0.5, eye: [0.5, 0.15, -2.0], floorY: -0.85, club: true },
    groundY: G,
  };
}

// ------------------------------------------------------------------ Falke JT-2 tandem jet trainer
export function jetTrainer() {
  const G = -1.95;
  const st = [
    [-6.0, 0.01, 0.01, -0.05, 2], [-5.6, 0.14, 0.15, -0.04, 2], [-4.6, 0.36, 0.4, 0.0, 2], [-3.4, 0.52, 0.62, 0.08, 2.2], [-1.8, 0.62, 0.78, 0.12, 2.5],
    [0.0, 0.66, 0.8, 0.1, 2.6], [2.0, 0.62, 0.7, 0.12, 2.4], [4.0, 0.46, 0.52, 0.16, 2.2], [5.4, 0.36, 0.38, 0.18, 2], [5.9, 0.34, 0.34, 0.18, 2],
  ];
  const W = wing({ root: [0.4, -0.38, -0.9], span: 4.4, cRoot: 2.65, cTip: 0.95, sweep: 27, dihedral: 2, tRoot: 0.1, tTip: 0.09, flaps: [[0.4, 2.3]], ailerons: [2.6, 4.2], flapMax: 50, camber: 0.012 });
  return {
    fuselage: { stations: st, rings: 64, segs: 28 },
    bodies: [
      // side intakes
      { stations: [[-2.2, 0.01, 0.01, 0, 2], [-1.9, 0.3, 0.38, 0, 2.6], [0.5, 0.34, 0.42, 0, 2.6], [2.2, 0.01, 0.01, 0, 2]], pos: [0.62, 0.05, 0], mirror: true, material: 'body' === 'x' ? 'body' : 'body2' },
    ],
    livery: { base: '#f3f3f1', belly: '#c8102e', stripes: [{ color: '#c8102e', th: 0.15, wth: 0.3, z0: -6, z1: -3.6 }, { color: '#1e2a44', th: -0.5, wth: 0.12 }], title: 'FALKE', titleColor: '#1e2a44', titleSize: 30, titleZ: 0.4, reg: 'JT-201', regZ: 3.0, tail: '#c8102e', logo: 'star', logoColor: '#fff', wing: '#f1f1ef', engine: '#d8d8d8', radius: 0.75 },
    cockpitWindows: [],   // bubble canopy is a separate transparent part
    wings: [W],
    tails: [
      vfin({ root: [0, 0.65, 2.7], h: 2.25, c0: 2.4, c1: 0.95, sweep: 42 }),
      hstab({ root: [0.3, 0.12, 3.75], span: 2.2, c0: 1.5, c1: 0.7, sweep: 30, dihedral: -9, allMoving: true }),
    ],
    engines: [],
    gear: [
      { name: 'nose', pos: [0, -0.6, -3.9], len: gl(-0.6, 0.23, G), wheels: 1, r: 0.23, w: 0.13, steer: true, retract: { axis: 'x', angle: 1.6 }, doors: true },
      { name: 'mainL', pos: [-1.75, -0.45, 1.05], len: gl(-0.45, 0.3, G), wheels: 1, r: 0.3, w: 0.16, retract: { axis: 'z', angle: 1.55 }, doors: true, doorSide: -1 },
      { name: 'mainR', pos: [1.75, -0.45, 1.05], len: gl(-0.45, 0.3, G), wheels: 1, r: 0.3, w: 0.16, retract: { axis: 'z', angle: -1.55 }, doors: true, doorSide: 1 },
    ],
    lights: { ...tipLights(W), tail: [0, 2.85, 4.4], beaconTop: [0, 0.9, 1.2], beaconBottom: [0, -0.7, 0.5], landing: [[-0.3, -0.6, -3.7], [0.3, -0.6, -3.7]] },
    custom({ out, mats, addStatic, outer, THREE }) {
      // tandem bubble canopy (transparent, hinged)
      const c = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
      c.scale(0.56, 0.62, 2.0);
      const canopy = new THREE.Mesh(c, mats.glass);
      canopy.position.set(0, 0.62, -2.7);
      canopy.renderOrder = 6;
      outer.add(canopy);
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.035, 6, 20, Math.PI).scale(1, 1.1, 1), mats.darkMetal);
      frame.position.set(0, 0.62, -2.4);
      outer.add(frame);
      out.extras.canopy = canopy;
      // exhaust nozzle
      addStatic('exhaust', new THREE.CylinderGeometry(0.3, 0.34, 0.5, 18, 1, true).rotateX(Math.PI / 2).translate(0, 0.18, 6.05));
      // intake faces
      for (const s of [-1, 1]) addStatic('fanDisc', new THREE.CircleGeometry(0.28, 14).rotateY(Math.PI).translate(s * 0.62, 0.05, -1.88));
      // pitot boom
      addStatic('chrome', new THREE.CylinderGeometry(0.02, 0.03, 0.9, 6).rotateX(Math.PI / 2).translate(0, -0.05, -6.4));
    },
    cockpit: { eye: [0, 0.82, -3.05], layout: 'fighter', seats: 1, hud: true },
    cabin: null,
    groundY: G,
  };
}
