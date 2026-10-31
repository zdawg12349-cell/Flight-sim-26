// Ground vehicle models (extruded side profiles with real cab windows, wheels, light bars) and a
// kinematic bicycle-model driver for following paths. Used for airport service traffic and the
// emergency response (ARFF fire trucks, police cars, ambulance).
import * as THREE from 'three';
import { glowTexture, makeCanvas } from '../render/textures.js';
import { clamp, damp, lerp } from '../core/math.js';
import { LAYER_WORLD } from '../render/renderer.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const matCache = new Map();
function mat(key, make) { if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); }
const lam = (c) => mat('l' + c, () => new THREE.MeshLambertMaterial({ color: c }));
const std = (c, r = 0.45, m = 0.2) => mat(`s${c}_${r}_${m}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }));

function sideTexture(kind) {
  return mat('tex' + kind, () => {
    const c = makeCanvas(512, 128), x = c.getContext('2d');
    if (kind === 'police') {
      x.fillStyle = '#f4f4f4'; x.fillRect(0, 0, 512, 128);
      x.fillStyle = '#1736a8'; x.fillRect(0, 70, 512, 28);
      x.fillStyle = '#d8b21a'; x.fillRect(0, 98, 512, 6);
      x.fillStyle = '#1736a8'; x.font = 'bold 44px Arial'; x.textAlign = 'center'; x.fillText('POLICE', 256, 56);
    } else if (kind === 'ambulance') {
      x.fillStyle = '#f7f7f2'; x.fillRect(0, 0, 512, 128);
      for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#1d6b2e' : '#f2d21a'; x.fillRect(i * 32, 84, 32, 22); }
      x.fillStyle = '#c41a1a'; x.font = 'bold 40px Arial'; x.textAlign = 'center'; x.fillText('AMBULANCE', 256, 58);
    } else if (kind === 'fire') {
      x.fillStyle = '#c8181a'; x.fillRect(0, 0, 512, 128);
      x.fillStyle = '#e8e8e0'; x.fillRect(0, 88, 512, 10);
      x.fillStyle = '#f0c010'; x.fillRect(0, 100, 512, 8);
      for (let i = 0; i < 4; i++) { x.fillStyle = '#a81214'; x.fillRect(40 + i * 110, 14, 96, 66); x.strokeStyle = '#7e0e10'; for (let k = 0; k < 8; k++) { x.beginPath(); x.moveTo(40 + i * 110, 20 + k * 8); x.lineTo(136 + i * 110, 20 + k * 8); x.stroke(); } }
      x.fillStyle = '#fff'; x.font = 'bold 22px Arial'; x.fillText('AIRPORT RESCUE', 160, 122);
    } else if (kind === 'followme') {
      x.fillStyle = '#f2c200'; x.fillRect(0, 0, 512, 128);
      for (let i = 0; i < 32; i++) { x.fillStyle = i % 2 ? '#111' : '#f2c200'; x.fillRect(i * 16, 96, 16, 16); }
      x.fillStyle = '#111'; x.font = 'bold 42px Arial'; x.textAlign = 'center'; x.fillText('FOLLOW ME', 256, 64);
    } else {
      x.fillStyle = kind; x.fillRect(0, 0, 512, 128);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  });
}

// Extrude a side silhouette (points in [x along length, y up]) across the width.
function extrudeSide(pts, width, bevel = 0.04) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);  // shape -x (front) -> -z, width along x
  // planar uv for side decals: u along length, v along height
  const p = g.attributes.position, uv = g.attributes.uv;
  let minZ = 1e9, maxZ = -1e9, maxY = 0;
  for (let i = 0; i < p.count; i++) { minZ = Math.min(minZ, p.getZ(i)); maxZ = Math.max(maxZ, p.getZ(i)); maxY = Math.max(maxY, p.getY(i)); }
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getZ(i) - minZ) / (maxZ - minZ), p.getY(i) / maxY);
  return g;
}

function wheel(r, w, m) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2), lam(0x151515));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w * 1.02, 10).rotateZ(Math.PI / 2), m || std(0xb8bcc0, 0.3, 0.7));
  g.add(tire); g.add(hub);
  return g;
}

function glow(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  s.scale.setScalar(size);
  return s;
}

function lightBar(width, colors) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, 0.28), lam(0x222222)));
  const lamps = [];
  const n = colors.length;
  for (let i = 0; i < n; i++) {
    const c = colors[i];
    const lens = new THREE.Mesh(new THREE.BoxGeometry(width / n * 0.86, 0.1, 0.24), new THREE.MeshBasicMaterial({ color: c }));
    lens.position.set(-width / 2 + width / n * (i + 0.5), 0.08, 0);
    g.add(lens);
    const gl = glow(c, 2.4);
    gl.position.copy(lens.position).add(new THREE.Vector3(0, 0.05, 0));
    g.add(gl);
    lamps.push({ lens, glow: gl, color: new THREE.Color(c), phase: i / n });
  }
  return { group: g, lamps };
}

const GLASS = () => std(0x10161c, 0.08, 0.9);

// ------------------------------------------------------------------ vehicle builders
export function buildVehicle(kind, opts = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const wheels = [];
  let lamps = [];
  let turret = null;
  let length = 4.6;
  const addWheels = (zs, r, w, track) => {
    for (const z of zs) for (const s of [-1, 1]) {
      const wh = wheel(r, w); wh.position.set(s * track / 2, r, z); body.add(wh); wheels.push({ obj: wh, r });
    }
  };
  if (kind === 'fire') {
    // ARFF crash tender: 3 axles, big cab, tank body, roof & bumper turrets
    length = 11.5;
    const W = 2.9;
    const prof = [[-5.75, 0.75], [-5.75, 2.2], [-5.2, 3.15], [-3.3, 3.25], [-3.3, 3.45], [5.75, 3.45], [5.75, 0.75]];
    const g = extrudeSide(prof, W, 0.08);
    const m = new THREE.MeshStandardMaterial({ map: sideTexture('fire'), roughness: 0.4, metalness: 0.2 });
    body.add(new THREE.Mesh(g, m));
    // windscreen + side windows (dark glass)
    const ws = extrudeSide([[-5.68, 2.3], [-5.18, 3.08], [-3.4, 3.15], [-3.4, 2.3]], W + 0.04, 0.02);
    body.add(new THREE.Mesh(ws, GLASS()));
    // compartments / bumper / chassis
    body.add(new THREE.Mesh(new THREE.BoxGeometry(W * 0.98, 0.35, 11.2).translate(0, 0.6, 0), lam(0x333333)));
    body.add(new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.3, 0.3).translate(0, 0.9, -5.85), std(0xc0c4c8, 0.3, 0.8)));
    // roof turret
    turret = new THREE.Group();
    turret.position.set(0, 3.5, -3.6);
    turret.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.35, 10).translate(0, 0.17, 0), std(0xd0d4d8, 0.3, 0.8)));
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 1.4, 8).rotateX(Math.PI / 2).translate(0, 0.38, -0.6), std(0xd0d4d8, 0.3, 0.8));
    turret.add(nozzle);
    body.add(turret);
    const bumperTurret = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.7, 8).rotateX(Math.PI / 2).translate(0, 1.05, -6.1), std(0xd0d4d8, 0.3, 0.8));
    body.add(bumperTurret);
    // light bar on cab + rear beacons
    const lb = lightBar(2.0, [0xff2020, 0xffffff, 0xff2020, 0xffffff, 0xff2020]);
    lb.group.position.set(0, 3.32, -4.4); body.add(lb.group); lamps = lb.lamps;
    for (const s of [-1, 1]) { const b = glow(0xff3010, 1.4); b.position.set(s * 1.3, 3.55, 5.6); body.add(b); lamps.push({ glow: b, color: new THREE.Color(0xff3010), phase: s > 0 ? 0.5 : 0 }); }
    addWheels([-3.9, 1.6, 3.7], 0.68, 0.55, W - 0.25);
    // ladder / hose reels detail
    body.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 3.0).translate(1.0, 3.65, 1.5), lam(0x8a8e92)));
  } else if (kind === 'police') {
    length = 4.9;
    const W = 1.85;
    const prof = [[-2.45, 0.32], [-2.45, 0.72], [-2.3, 0.86], [-1.2, 0.95], [-0.55, 1.42], [0.75, 1.45], [1.6, 0.98], [2.4, 0.92], [2.45, 0.32]];
    const m = new THREE.MeshStandardMaterial({ map: sideTexture('police'), roughness: 0.35, metalness: 0.3 });
    body.add(new THREE.Mesh(extrudeSide(prof, W, 0.08), m));
    body.add(new THREE.Mesh(extrudeSide([[-1.12, 0.98], [-0.55, 1.38], [0.72, 1.41], [1.5, 1.0]], W + 0.03, 0.02), GLASS()));
    body.add(new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.12, 0.2).translate(0, 0.45, -2.48), lam(0x111111)));
    const lb = lightBar(1.3, [0xff2020, 0xff2020, 0x2040ff, 0x2040ff]);
    lb.group.position.set(0, 1.5, 0.1); body.add(lb.group); lamps = lb.lamps;
    addWheels([-1.45, 1.45], 0.34, 0.24, W - 0.15);
    for (const s of [-1, 1]) { const h = glow(0xfff4dd, 0.6); h.position.set(s * 0.65, 0.72, -2.5); body.add(h); }
  } else if (kind === 'ambulance') {
    length = 6.4;
    const W = 2.2;
    const prof = [[-3.2, 0.42], [-3.2, 1.05], [-2.9, 1.25], [-2.1, 2.0], [-1.5, 2.15], [-1.5, 2.75], [3.2, 2.75], [3.2, 0.42]];
    const m = new THREE.MeshStandardMaterial({ map: sideTexture('ambulance'), roughness: 0.4, metalness: 0.15 });
    body.add(new THREE.Mesh(extrudeSide(prof, W, 0.07), m));
    body.add(new THREE.Mesh(extrudeSide([[-2.85, 1.3], [-2.1, 1.95], [-1.6, 2.05], [-1.6, 1.3]], W + 0.03, 0.02), GLASS()));
    const lb = lightBar(1.6, [0x2040ff, 0xffffff, 0x2040ff]);
    lb.group.position.set(0, 2.22, -1.8); body.add(lb.group); lamps = lb.lamps;
    for (const s of [-1, 1]) for (const z of [-1.2, 3.1]) { const b = glow(0xff2020, 0.9); b.position.set(s * 1.05, 2.72, z); body.add(b); lamps.push({ glow: b, color: new THREE.Color(0xff2020), phase: (s + 1) / 4 + (z > 0 ? 0.5 : 0) }); }
    addWheels([-1.9, 2.0], 0.4, 0.28, W - 0.2);
  } else if (kind === 'tug') {
    length = 2.6;
    body.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 2.4).translate(0, 0.55, 0), lam(0xd8a010)));
    body.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.1).translate(0, 1.3, 0.3), lam(0x333333)));
    body.add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 1.0).translate(0, 1.75, 0.6), lam(0xd8a010)));
    addWheels([-0.8, 0.8], 0.28, 0.2, 1.3);
    const b = glow(0xffa020, 0.7); b.position.set(0, 1.85, 0.6); body.add(b); lamps.push({ glow: b, color: new THREE.Color(0xffa020), phase: 0 });
    // baggage carts
    for (let k = 0; k < 3; k++) {
      const cart = new THREE.Group(); cart.position.z = 2.8 + k * 2.6;
      cart.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.15, 2.1).translate(0, 0.45, 0), lam(0x555b60)));
      cart.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.9).translate(0, 0.95, 0), lam([0x3b6ea8, 0x8a3b3b, 0x4f7f4f][k])));
      for (const s of [-1, 1]) for (const z of [-0.7, 0.7]) { const wh = wheel(0.18, 0.12); wh.position.set(s * 0.65, 0.18, z); cart.add(wh); }
      body.add(cart);
    }
  } else if (kind === 'fuel') {
    length = 9;
    const prof = [[-4.5, 0.6], [-4.5, 2.0], [-4.0, 2.7], [-3.0, 2.75], [-3.0, 1.0], [4.5, 1.0], [4.5, 0.6]];
    body.add(new THREE.Mesh(extrudeSide(prof, 2.4, 0.06), lam(0xe8e8e2)));
    body.add(new THREE.Mesh(extrudeSide([[-4.45, 2.05], [-3.98, 2.62], [-3.1, 2.65], [-3.1, 2.05]], 2.44, 0.02), GLASS()));
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 7.0, 18).rotateX(Math.PI / 2).translate(0, 2.1, 1.0), std(0xd8dadc, 0.35, 0.6));
    tank.scale.set(1, 0.9, 1); body.add(tank);
    addWheels([-3.4, 2.4, 3.6], 0.5, 0.4, 2.1);
    const b = glow(0xffa020, 0.8); b.position.set(0, 2.85, -3.5); body.add(b); lamps.push({ glow: b, color: new THREE.Color(0xffa020), phase: 0.3 });
  } else if (kind === 'catering') {
    length = 8;
    body.add(new THREE.Mesh(extrudeSide([[-4, 0.6], [-4, 2.0], [-3.5, 2.6], [-2.5, 2.6], [-2.5, 1.0], [4, 1.0], [4, 0.6]], 2.4, 0.06), lam(0xf0f0ec)));
    body.add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.3, 5.8).translate(0, 2.3, 1.0), lam(0xe5e5e0)));
    body.add(new THREE.Mesh(extrudeSide([[-3.95, 2.05], [-3.48, 2.5], [-2.6, 2.5], [-2.6, 2.05]], 2.44, 0.02), GLASS()));
    addWheels([-2.9, 2.9], 0.45, 0.35, 2.1);
  } else if (kind === 'bus') {
    length = 13;
    body.add(new THREE.Mesh(extrudeSide([[-6.5, 0.4], [-6.5, 2.8], [6.5, 2.8], [6.5, 0.4]], 2.8, 0.12), lam(0x2e6fb0)));
    body.add(new THREE.Mesh(new THREE.BoxGeometry(2.84, 1.0, 12.2).translate(0, 1.85, 0), GLASS()));
    addWheels([-4.5, 4.5], 0.5, 0.35, 2.4);
  } else if (kind === 'followme') {
    length = 4.5;
    const prof = [[-2.25, 0.32], [-2.25, 0.8], [-1.0, 0.92], [-0.5, 1.5], [1.4, 1.52], [2.2, 1.45], [2.25, 0.32]];
    body.add(new THREE.Mesh(extrudeSide(prof, 1.85, 0.08), new THREE.MeshStandardMaterial({ map: sideTexture('followme'), roughness: 0.4 })));
    body.add(new THREE.Mesh(extrudeSide([[-0.95, 0.95], [-0.5, 1.45], [1.3, 1.47], [1.3, 0.95]], 1.88, 0.02), GLASS()));
    addWheels([-1.4, 1.4], 0.34, 0.24, 1.7);
    const b = glow(0xffa020, 0.8); b.position.set(0, 1.62, 0.2); body.add(b); lamps.push({ glow: b, color: new THREE.Color(0xffa020), phase: 0 });
  } else if (kind === 'stairs') {
    length = 7;
    body.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 6).translate(0, 0.8, 0), lam(0xeaeaea)));
    const st = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 6.5).translate(0, 0, -3.25), lam(0xb0b4b8));
    st.position.set(0, 1.3, 2.6); st.rotation.x = 0.42; body.add(st);
    addWheels([-2.2, 2.2], 0.42, 0.3, 2.0);
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } o.layers.set(LAYER_WORLD); });
  const out = { root, body, wheels, lamps, turret, length, kind };
  if (opts.merge) mergeVehicle(out);
  return out;
}

// Merge all static meshes of a vehicle by material (wheels included) -> a few draw calls.
function mergeVehicle(v) {
  v.root.updateMatrixWorld(true);
  const keep = new Set();
  for (const l of v.lamps) { if (l.lens) keep.add(l.lens); }
  if (v.turret) v.turret.traverse((o) => keep.add(o));
  const groups = new Map();
  const remove = [];
  v.body.traverse((o) => {
    if (!o.isMesh || keep.has(o) || o.material.transparent) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const m = new THREE.Matrix4().copy(v.body.matrixWorld).invert().multiply(o.matrixWorld);
    g.applyMatrix4(m);
    if (!groups.has(o.material)) groups.set(o.material, []);
    groups.get(o.material).push(g);
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  for (const [mat, list] of groups) {
    const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.layers.set(LAYER_WORLD);
    v.body.add(mesh);
  }
  v.wheels = [];
}

// ------------------------------------------------------------------ simple people (non-graphic responders, passengers)
const PERSON_GEO = (() => {
  const torso = new THREE.CylinderGeometry(0.2, 0.17, 0.62, 8).translate(0, 1.16, 0);
  const head = new THREE.SphereGeometry(0.12, 8, 6).translate(0, 1.6, 0);
  return { torso, head, leg: new THREE.BoxGeometry(0.12, 0.82, 0.14).translate(0, -0.41, 0) };
})();
export function buildPerson(color = 0xd8a020) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(PERSON_GEO.torso, lam(color)));
  g.add(new THREE.Mesh(PERSON_GEO.head, lam(0xd8b090)));
  const legs = [];
  for (const s of [-1, 1]) { const l = new THREE.Mesh(PERSON_GEO.leg, lam(0x22262c)); l.position.set(s * 0.09, 0.85, 0); g.add(l); legs.push(l); }
  g.traverse((o) => { o.layers.set(LAYER_WORLD); if (o.isMesh) o.castShadow = true; });
  return { root: g, legs, phase: Math.random() * 6 };
}

// ------------------------------------------------------------------ kinematic driver
export class VehicleDriver {
  constructor(v, world, opts = {}) {
    this.v = v; this.world = world;
    this.pos = new THREE.Vector3(); this.heading = 0; this.speed = 0; this.steer = 0;
    this.path = []; this.pi = 0;
    this.maxSpeed = opts.maxSpeed ?? 20;
    this.accel = opts.accel ?? 3.0;
    this.wheelBase = Math.max(2.5, v.length * 0.6);
    this.arrived = false;
    this.finalHeading = null;
    this.loop = !!opts.loop;
    this.lightsOn = !!opts.lights;
    this.t = Math.random() * 10;
    this.wheelAngle = 0;
  }
  place(x, z, hdg) { this.pos.set(x, this.world.surfaceAt(x, z), z); this.heading = hdg; this.sync(); }
  setPath(pts, finalHeading = null) { this.path = pts.map((p) => new THREE.Vector3(p[0], 0, p[1])); this.pi = 0; this.arrived = false; this.finalHeading = finalHeading; }
  update(dt) {
    this.t += dt;
    if (this.path.length && !this.arrived) {
      const tgt = this.path[this.pi];
      const dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const last = this.pi === this.path.length - 1;
      if (d < (last ? 1.2 : Math.max(4, this.speed * 1.2))) {
        if (last) { if (this.loop) { this.pi = 0; } else { this.arrived = true; } }
        else this.pi++;
      }
      const want = Math.atan2(dx, -dz);
      let err = want - this.heading;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      this.steer = damp(this.steer, clamp(err * 1.6, -0.6, 0.6), 4, dt);
      // speed planning: slow down for turns and before the final stop
      const turnLimit = this.maxSpeed * clamp(1 - Math.abs(err) / 1.6, 0.25, 1);
      const stopLimit = last ? Math.sqrt(2 * this.accel * 0.8 * Math.max(0, d - 1)) : this.maxSpeed;
      const target = Math.min(turnLimit, stopLimit, this.maxSpeed);
      this.speed = this.speed < target ? Math.min(target, this.speed + this.accel * dt) : Math.max(target, this.speed - this.accel * 1.6 * dt);
    } else {
      this.speed = Math.max(0, this.speed - this.accel * 2 * dt);
      if (this.arrived && this.finalHeading !== null && this.speed < 0.5) {
        let err = this.finalHeading - this.heading; err = Math.atan2(Math.sin(err), Math.cos(err));
        this.heading += clamp(err, -dt * 0.6, dt * 0.6);
      }
    }
    // bicycle model
    this.heading += this.speed / this.wheelBase * Math.tan(this.steer) * dt;
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += -Math.cos(this.heading) * this.speed * dt;
    this.pos.y = this.world.surfaceAt(this.pos.x, this.pos.z);
    this.wheelAngle += this.speed * dt;
    this.sync();
  }
  sync() {
    const v = this.v;
    v.root.position.copy(this.pos);
    v.root.rotation.set(0, -this.heading, 0);
    for (const w of v.wheels) w.obj.rotation.x = -this.wheelAngle / w.r;
    // light bar animation: alternating flashes
    const on = this.lightsOn;
    for (const l of v.lamps) {
      const ph = (this.t * 2.6 + l.phase) % 1;
      const lit = on && ph < 0.5;
      if (l.glow) { l.glow.visible = lit; }
      if (l.lens) l.lens.material.color.copy(l.color).multiplyScalar(lit ? 1.4 : 0.25);
    }
  }
}
