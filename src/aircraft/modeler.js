// Procedural aircraft modelling primitives.
// Body axes: +X right, +Y up, -Z forward (nose). Units: metres.
import * as THREE from 'three';
import { clamp, lerp } from '../core/math.js';

const TAU = Math.PI * 2;

// ---------- interpolation ----------
function catmull(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

// Fuselage stations: [z, halfWidth, halfHeight, yCentre, exponent]
export class FuselageShape {
  constructor(stations) {
    this.st = stations.slice().sort((a, b) => a[0] - b[0]);
    this.zNose = this.st[0][0];
    this.zTail = this.st[this.st.length - 1][0];
    this.length = this.zTail - this.zNose;
  }
  at(z) {
    const s = this.st, n = s.length;
    if (z <= s[0][0]) return { w: s[0][1], h: s[0][2], y: s[0][3], e: s[0][4] };
    if (z >= s[n - 1][0]) return { w: s[n - 1][1], h: s[n - 1][2], y: s[n - 1][3], e: s[n - 1][4] };
    let i = 0;
    while (i < n - 2 && z > s[i + 1][0]) i++;
    const a = s[Math.max(0, i - 1)], b = s[i], c = s[i + 1], d = s[Math.min(n - 1, i + 2)];
    const t = (z - b[0]) / (c[0] - b[0]);
    const f = (k) => Math.max(0, catmull(a[k], b[k], c[k], d[k], t));
    return { w: f(1), h: f(2), y: catmull(a[3], b[3], c[3], d[3], t), e: Math.max(1.2, f(4)) };
  }
  // Surface point for angle th (0 = bottom, PI/2 = right side, PI = top).
  point(z, th, out = new THREE.Vector3(), inset = 0) {
    const s = this.at(z);
    const sn = Math.sin(th), cs = Math.cos(th);
    const p = 2 / s.e;
    const x = Math.sign(sn) * Math.pow(Math.abs(sn), p) * Math.max(0, s.w - inset);
    const y = s.y - Math.sign(cs) * Math.pow(Math.abs(cs), p) * Math.max(0, s.h - inset);
    return out.set(x, y, z);
  }
  // Top/bottom/side helpers
  topY(z) { const s = this.at(z); return s.y + s.h; }
  bottomY(z) { const s = this.at(z); return s.y - s.h; }
}

// Lofted fuselage geometry. uv.x = along (0 nose .. 1 tail), uv.y = th / 2PI.
export function loftGeometry(shape, rings = 72, segs = 32, zFrom = null, zTo = null, inset = 0, invert = false) {
  const z0 = zFrom ?? shape.zNose, z1 = zTo ?? shape.zTail;
  const pos = [], uv = [], idx = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    // denser rings near the ends
    let t = i / rings;
    if (zFrom === null && zTo === null) t = 0.5 - 0.5 * Math.cos(t * Math.PI) * 0.35 + (t - 0.5) * 0.65;
    t = clamp(t, 0, 1);
    const z = lerp(z0, z1, t);
    for (let j = 0; j <= segs; j++) {
      const th = j / segs * TAU;
      shape.point(z, th, p, inset);
      pos.push(p.x, p.y, p.z);
      uv.push((z - shape.zNose) / shape.length, j / segs);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j, b = a + 1, c = a + segs + 1, d = c + 1;
      if (invert) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld seam normals (j = 0 and j = segs share positions)
  const n = g.attributes.normal;
  for (let i = 0; i <= rings; i++) {
    const a = i * (segs + 1), b = a + segs;
    const nx = (n.getX(a) + n.getX(b)) / 2, ny = (n.getY(a) + n.getY(b)) / 2, nz = (n.getZ(a) + n.getZ(b)) / 2;
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / l, ny / l, nz / l); n.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return g;
}

// ---------- airfoils ----------
function naca(xc, t, m, p) {
  const yt = 5 * t * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
  let yc = 0;
  if (m > 0) yc = xc < p ? m / (p * p) * (2 * p * xc - xc * xc) : m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * xc - xc * xc);
  return [yc + yt, yc - yt];
}

// Closed loop for chord range [a,b] (upper a->b, lower b->a). Returns [[xc, y], ...].
export function airfoilLoop(a, b, t, m = 0.02, p = 0.4, n = 12) {
  const loop = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const xc = a + (b - a) * (a === 0 ? (1 - Math.cos(s * Math.PI / 2)) : s);
    loop.push([xc, naca(xc, t, m, p)[0]]);
  }
  for (let i = n; i >= 0; i--) {
    const s = i / n;
    const xc = a + (b - a) * (a === 0 ? (1 - Math.cos(s * Math.PI / 2)) : s);
    const y = naca(xc, t, m, p)[1];
    if (i === n || i === 0) {
      // avoid duplicating trailing/leading points when the loop is closed by the surface
      if ((i === n && b >= 0.999) || (i === 0 && a <= 0.001)) continue;
    }
    loop.push([xc, y]);
  }
  return loop;
}

// ---------- wings ----------
// def: { root:[x,y,z], span:{dir:[x,y,z], up:[x,y,z]}, panels:[{span, c0, c1, sweep, dihedral, t0, t1, twist}],
//        surfaces:[{name, type, s0, s1, cf}], camber, mirror, detail }
// Returns { fixed: BufferGeometry[], surfaces: [{name, type, geometry, hingeA, hingeB}], stations }
export function wingGeometry(def, side = 1) {
  const n = Math.max(6, Math.round((def.detail ?? 1) * 12));
  const m = def.camber ?? 0.02;
  const dir0 = new THREE.Vector3(...(def.dir || [1, 0, 0]));
  const up0 = new THREE.Vector3(...(def.up || [0, 1, 0]));
  if (side < 0) dir0.x *= -1, up0.x *= -1;
  const root = new THREE.Vector3(...def.root);
  if (side < 0) root.x *= -1;
  // station list along total span
  const total = def.panels.reduce((s, p) => s + p.span, 0);
  const cuts = new Set([0, total]);
  let acc = 0;
  for (const p of def.panels) { acc += p.span; cuts.add(+acc.toFixed(4)); }
  for (const s of def.surfaces || []) { cuts.add(+(s.s0 * total).toFixed(4)); cuts.add(+(s.s1 * total).toFixed(4)); }
  const sList = [...cuts].sort((a, b) => a - b);
  // evaluate a station at span distance s
  const station = (s) => {
    let le = root.clone(), rem = s, pi = 0, base = 0;
    for (pi = 0; pi < def.panels.length; pi++) {
      const p = def.panels[pi];
      const d = Math.min(rem, p.span);
      const dih = (p.dihedral || 0) * Math.PI / 180;
      const sw = (p.sweep || 0) * Math.PI / 180;
      const dir = dir0.clone().multiplyScalar(Math.cos(dih)).addScaledVector(up0, Math.sin(dih));
      le.addScaledVector(dir, d);
      le.z += d * Math.tan(sw);
      if (rem <= p.span + 1e-6) { base = d / p.span; break; }
      rem -= p.span;
    }
    pi = Math.min(pi, def.panels.length - 1);
    const p = def.panels[pi];
    const c = lerp(p.c0, p.c1, base), t = lerp(p.t0, p.t1 ?? p.t0, base);
    const dih = (p.dihedral || 0) * Math.PI / 180;
    const up = up0.clone().multiplyScalar(Math.cos(dih)).addScaledVector(dir0, -Math.sin(dih));
    const twist = ((def.twist0 || 0) + (def.twist1 || 0) * s / total) * Math.PI / 180;
    return { le, c, t, up, twist };
  };
  const map = (st, xc, y, out) => {
    // twist about quarter chord in the (z, up) plane; positive twist = nose down (washout)
    const dz = (xc - 0.25) * st.c, dy = y * st.c;
    const ct = Math.cos(st.twist), sn = Math.sin(st.twist);
    const z = dz * ct + dy * sn, yy = -dz * sn + dy * ct;
    out.copy(st.le).addScaledVector(st.up, yy);
    out.z += 0.25 * st.c + z;
    return out;
  };
  const surfAt = (s) => (def.surfaces || []).find((q) => s >= q.s0 * total - 1e-4 && s <= q.s1 * total + 1e-4);
  const fixed = [], surfaces = [];
  const tmp = new THREE.Vector3();
  const stripGeo = (s0, s1, a, b) => {
    const A = station(s0), B = station(s1);
    const la = airfoilLoop(a, b, A.t, m, 0.4, n), lb = airfoilLoop(a, b, B.t, m, 0.4, n);
    const L = la.length;
    const pos = [], idx = [];
    for (const [xc, y] of la) { map(A, xc, y, tmp); pos.push(tmp.x, tmp.y, tmp.z); }
    for (const [xc, y] of lb) { map(B, xc, y, tmp); pos.push(tmp.x, tmp.y, tmp.z); }
    for (let i = 0; i < L; i++) {
      const i2 = (i + 1) % L;
      const q = [i, i2, L + i, L + i2];
      if (side < 0) idx.push(q[0], q[2], q[1], q[1], q[2], q[3]); else idx.push(q[0], q[1], q[2], q[1], q[3], q[2]);
    }
    // end caps
    const capA = pos.length / 3; let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < L; i++) { cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; }
    pos.push(cx / L, cy / L, cz / L);
    const capB = pos.length / 3; cx = cy = cz = 0;
    for (let i = L; i < 2 * L; i++) { cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; }
    pos.push(cx / L, cy / L, cz / L);
    for (let i = 0; i < L; i++) {
      const i2 = (i + 1) % L;
      if (side < 0) { idx.push(capA, i2, i); idx.push(capB, L + i, L + i2); } else { idx.push(capA, i, i2); idx.push(capB, L + i2, L + i); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const ng = g.toNonIndexed();
    ng.computeVertexNormals();
    return { g: ng, A, B };
  };
  for (let i = 0; i < sList.length - 1; i++) {
    const s0 = sList[i], s1 = sList[i + 1];
    if (s1 - s0 < 1e-3) continue;
    const surf = surfAt((s0 + s1) / 2);
    const cf = surf ? surf.cf : 0;
    fixed.push(stripGeo(s0, s1, 0, 1 - cf).g);
    if (surf) {
      const { g, A, B } = stripGeo(s0, s1, 1 - cf, 1);
      const ha = map(A, 1 - cf, naca(1 - cf, A.t, m, 0.4).reduce((x, y) => (x + y) / 2), new THREE.Vector3());
      const hb = map(B, 1 - cf, naca(1 - cf, B.t, m, 0.4).reduce((x, y) => (x + y) / 2), new THREE.Vector3());
      surfaces.push({ name: surf.name, type: surf.type, geometry: g, hingeA: ha, hingeB: hb, s0, s1 });
    }
  }
  // merge adjacent pieces of the same surface
  const merged = new Map();
  for (const s of surfaces) {
    if (!merged.has(s.name)) merged.set(s.name, { ...s, geos: [s.geometry] });
    else { const m2 = merged.get(s.name); m2.geos.push(s.geometry); m2.hingeB = s.hingeB; }
  }
  return { fixed, surfaces: [...merged.values()], station, total };
}

// Wrap control-surface geometry into a hinge pivot so rotating about local X deflects it.
export function hingePivot(geo, a, b, material) {
  const axis = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis);
  const inv = new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)).invert();
  geo.applyMatrix4(inv);
  const mesh = new THREE.Mesh(geo, material);
  const pivot = new THREE.Group();
  pivot.position.copy(a);
  pivot.quaternion.copy(q);
  pivot.userData.baseQuat = q.clone();
  pivot.add(mesh);
  return { pivot, mesh };
}

// ---------- lathe helpers ----------
// profile: [[r, z], ...] from front to back; axis along -Z forward.
export function latheZ(profile, segs = 24, phase = 0) {
  const pts = profile.map(([r, z]) => new THREE.Vector2(Math.max(0.0001, r), z));
  const g = new THREE.LatheGeometry(pts, segs, phase);
  // LatheGeometry revolves around Y: map (x, y, z) -> (x, z?, ...) so that profile z becomes body z.
  g.rotateX(Math.PI / 2);
  // after rotateX(+90): original y (profile z) -> z. Fix normals orientation by checking first face later if needed.
  return g;
}

// Turbofan nacelle (front lip at z = 0, extends aft to +len). Returns { shell, core, fanZ }.
export function turbofanGeometry(d) {
  const R = d.r, L = d.len, seg = d.seg || 28;
  const ri = R * 0.86;
  const outer = [
    [ri * 0.98, 0.0], [R * 0.97, L * 0.04], [R, L * 0.15], [R * 0.99, L * 0.45], [R * 0.9, L * 0.75], [R * 0.78, L * (d.longCowl ? 0.98 : 0.86)],
  ];
  const inner = [[R * 0.74, L * (d.longCowl ? 0.98 : 0.86)], [ri * 0.95, L * 0.4], [ri * 0.96, L * 0.12], [ri * 0.92, L * 0.02], [ri * 0.98, 0.0]];
  const shell = latheZ([...outer, ...inner], seg);
  const coreL = d.coreLen ?? L * 0.4;
  const core = latheZ([[0.001, L * 0.6], [R * 0.6, L * 0.62], [R * 0.62, L * 0.86], [R * 0.48, L * 0.86 + coreL], [R * 0.3, L * 0.86 + coreL]], seg);
  const plug = latheZ([[R * 0.3, L * 0.86 + coreL], [R * 0.24, L * 0.86 + coreL + R * 0.25], [0.001, L * 0.86 + coreL + R * 0.75]], 16);
  return { shell, core, plug, fanZ: L * 0.16, fanR: ri * 0.94 };
}

export function fanGroup(radius, blades, spinnerLen, matBlade, matSpinner, matDisc) {
  const g = new THREE.Group();
  const bl = new THREE.Group();
  const bgeo = new THREE.BoxGeometry(radius * 0.18, radius * 0.86, radius * 0.04).translate(0, radius * 0.52, 0);
  for (let i = 0; i < blades; i++) {
    const m = new THREE.Mesh(bgeo, matBlade);
    m.rotation.z = i / blades * TAU;
    m.rotation.y = 0.55;
    bl.add(m);
  }
  g.add(bl);
  const sp = new THREE.Mesh(latheZ([[0.001, -spinnerLen], [radius * 0.18, -spinnerLen * 0.5], [radius * 0.26, 0], [radius * 0.26, 0.05]], 16), matSpinner);
  g.add(sp);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), matDisc);
  disc.position.z = 0.15;
  disc.rotation.y = Math.PI;
  g.add(disc);
  return { group: g, blades: bl, spinner: sp };
}

// ---------- propellers ----------
let PROP_DISC_TEX = null;
export function propDiscTexture() {
  if (PROP_DISC_TEX) return PROP_DISC_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 64);
  g.addColorStop(0, 'rgba(40,40,40,0.0)'); g.addColorStop(0.2, 'rgba(40,40,40,0.35)');
  g.addColorStop(0.75, 'rgba(50,50,50,0.26)'); g.addColorStop(0.93, 'rgba(200,180,60,0.16)'); g.addColorStop(1, 'rgba(30,30,30,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  PROP_DISC_TEX = new THREE.CanvasTexture(c);
  PROP_DISC_TEX.colorSpace = THREE.SRGBColorSpace;
  return PROP_DISC_TEX;
}

export function bladeGeometry(R, chord, rootR, twist = 0.7, tipColor = true) {
  // Lofted flat blade along +Y with chord along X and twist about Y.
  const n = 8, pos = [], idx = [], col = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, r = rootR + (R - rootR) * t;
    const c = chord * (0.55 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.08))) * (t > 0.92 ? (1 - (t - 0.92) / 0.08 * 0.6) : 1);
    const a = twist * (1 - t) + 0.12;
    const th = c * 0.12;
    const ca = Math.cos(a), sa = Math.sin(a);
    const pts = [[-c * 0.35, 0], [0, th], [c * 0.65, 0], [0, -th * 0.4]];
    for (const [px, pz] of pts) pos.push(px * ca - pz * sa, r, px * sa + pz * ca);
  }
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) {
    const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = a + 4, d = b + 4;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed(); ng.computeVertexNormals();
  return ng;
}

export function propellerGroup(d, mats) {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  g.add(spin);
  const R = d.diam / 2;
  const bgeo = bladeGeometry(R, d.chord || R * 0.16, d.spinnerR * 0.8, 0.8);
  for (let i = 0; i < d.blades; i++) {
    const b = new THREE.Mesh(bgeo, mats.prop);
    b.rotation.z = i / d.blades * TAU;
    spin.add(b);
  }
  const spinner = new THREE.Mesh(latheZ([[0.001, -d.spinnerLen], [d.spinnerR * 0.55, -d.spinnerLen * 0.7], [d.spinnerR * 0.92, -d.spinnerLen * 0.3], [d.spinnerR, 0], [d.spinnerR, 0.08]], 18), mats.spinner);
  spin.add(spinner);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 40), new THREE.MeshBasicMaterial({ map: propDiscTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0 }));
  disc.position.z = 0.02;
  disc.renderOrder = 5;
  g.add(disc);
  g.position.set(...d.pos);
  if (d.tilt) g.rotation.x = d.tilt;
  return { group: g, spin, disc, blades: spin.children.filter((c) => c !== spinner), dir: d.dir || 1, radius: R };
}

// ---------- rotors ----------
export function rotorGroup(d, mats) {
  const g = new THREE.Group();
  g.position.set(...d.pos);
  if (d.tilt) g.rotation.x = d.tilt;
  if (d.tiltZ) g.rotation.z = d.tiltZ;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(d.mastR || 0.09, (d.mastR || 0.09) * 1.3, d.mastH || 0.6, 10).translate(0, -(d.mastH || 0.6) / 2, 0), mats.darkMetal);
  g.add(mast);
  const spin = new THREE.Group();
  g.add(spin);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(d.hubR || 0.3, (d.hubR || 0.3) * 0.8, 0.22, 12), mats.darkMetal);
  spin.add(hub);
  const blades = [];
  const R = d.radius, c = d.chord;
  const bgeo = new THREE.BoxGeometry(R - (d.hubR || 0.3), 0.045 * c / 0.4, c);
  const bp = bgeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    // airfoil-ish taper: thinner trailing edge
    const z = bp.getZ(i);
    if (z > 0) bp.setY(i, bp.getY(i) * 0.35);
  }
  bgeo.computeVertexNormals();
  bgeo.translate((R + (d.hubR || 0.3)) / 2, 0, 0);
  for (let i = 0; i < d.blades; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = i / d.blades * TAU;
    const flap = new THREE.Group();
    flap.position.x = (d.hubR || 0.3) * 0.6;
    const blade = new THREE.Mesh(bgeo, mats.rotor);
    blade.position.x = -(d.hubR || 0.3) * 0.6;
    if (d.tipStripe) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05 * c / 0.4, c * 1.01).translate(R - 0.25, 0, 0), mats.stripe || mats.white);
      tip.position.x = -(d.hubR || 0.3) * 0.6;
      flap.add(tip);
    }
    flap.add(blade);
    arm.add(flap);
    spin.add(arm);
    blades.push(flap);
  }
  if (d.cap) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(d.hubR * 0.9, 12, 6, 0, TAU, 0, Math.PI / 2), mats.darkMetal);
    cap.position.y = 0.1;
    spin.add(cap);
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x202020, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  disc.renderOrder = 5;
  g.add(disc);
  return { group: g, spin, blades, disc, dir: d.dir || 1, radius: R, droop: d.droop ?? 0.04 };
}

export function tailRotorGroup(d, mats) {
  const g = new THREE.Group();
  g.position.set(...d.pos);
  const spin = new THREE.Group();
  g.add(spin);
  const R = d.radius;
  const bgeo = new THREE.BoxGeometry(0.03, R * 0.9, d.chord || R * 0.18).translate(0, R * 0.55, 0);
  for (let i = 0; i < d.blades; i++) {
    const b = new THREE.Mesh(bgeo, mats.rotor);
    b.rotation.x = i / d.blades * TAU;
    spin.add(b);
  }
  spin.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.12, R * 0.12, 0.12, 10).rotateZ(Math.PI / 2), mats.darkMetal));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 28).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x202020, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  g.add(disc);
  if (d.side) g.position.x = d.pos[0];
  return { group: g, spin, disc, radius: R };
}

// ---------- landing gear ----------
// def: { name, pos:[x,y,z], len, wheels, r, w, track, bogie, retract:{axis:'x'|'z', angle}, steer, fairing, doors }
export function gearUnit(d, mats) {
  const pivot = new THREE.Group();
  pivot.position.set(...d.pos);
  const upper = new THREE.Group();
  pivot.add(upper);
  const sr = d.strutR || Math.max(0.05, d.r * 0.22);
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(sr, sr, d.len * 0.7, 10).translate(0, -d.len * 0.35, 0), mats.gear);
  if (!d.noStrut) upper.add(strut);
  const lower = new THREE.Group();      // compresses (moves along y) and steers (rotates about y)
  lower.position.y = -d.len * 0.55;
  upper.add(lower);
  const oleo = new THREE.Mesh(new THREE.CylinderGeometry(sr * 0.7, sr * 0.7, d.len * 0.5, 10).translate(0, -d.len * 0.2, 0), mats.chrome);
  if (!d.noStrut) lower.add(oleo);
  const axle = new THREE.Group();
  axle.position.y = -d.len * 0.45;
  lower.add(axle);
  const wheels = [];
  const tireGeo = new THREE.CylinderGeometry(d.r, d.r, d.w, 20, 1).rotateZ(Math.PI / 2);
  const p = tireGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    // round the tyre shoulders
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rr = Math.hypot(y, z);
    if (rr > d.r * 0.5) { const k = 1 - 0.12 * Math.pow(Math.abs(x) / (d.w / 2), 4); p.setY(i, y * k); p.setZ(i, z * k); }
  }
  tireGeo.computeVertexNormals();
  const hubGeo = new THREE.CylinderGeometry(d.r * 0.55, d.r * 0.55, d.w * 1.02, 14).rotateZ(Math.PI / 2);
  const addWheel = (x, z) => {
    const w = new THREE.Group();
    w.position.set(x, 0, z);
    const tire = new THREE.Mesh(tireGeo, mats.tire);
    const hub = new THREE.Mesh(hubGeo, mats.hub);
    w.add(tire); w.add(hub);
    axle.add(w);
    wheels.push(w);
  };
  const n = d.wheels || 1;
  if (d.bogie) {
    const bl = d.bogie;
    axle.add(new THREE.Mesh(new THREE.BoxGeometry(sr * 1.2, sr * 1.2, bl * 1.1), mats.gear));
    const rows = n / 2;
    for (let r = 0; r < rows; r++) {
      const z = rows === 1 ? 0 : -bl / 2 + r * bl / (rows - 1);
      addWheel(-d.track / 2, z); addWheel(d.track / 2, z);
    }
    axle.add(new THREE.Mesh(new THREE.CylinderGeometry(sr * 0.5, sr * 0.5, d.track + d.w, 8).rotateZ(Math.PI / 2), mats.gear));
  } else if (n === 2) {
    addWheel(-d.track / 2, 0); addWheel(d.track / 2, 0);
    axle.add(new THREE.Mesh(new THREE.CylinderGeometry(sr * 0.5, sr * 0.5, d.track, 8).rotateZ(Math.PI / 2), mats.gear));
  } else {
    addWheel(d.offsetX || 0, 0);
  }
  if (d.fairing) {
    const fg = new THREE.SphereGeometry(1, 16, 8).scale(d.w * 1.15, d.r * 1.02, d.r * 2.1);
    const fp = fg.attributes.position;
    for (let i = 0; i < fp.count; i++) if (fp.getZ(i) > 0) fp.setZ(i, fp.getZ(i) * 1.35);   // teardrop tail
    fg.computeVertexNormals();
    const f = new THREE.Mesh(fg, mats.body2 || mats.white);
    f.position.y = d.r * 0.15;
    axle.add(f);
  }
  // torque link / side brace
  const brace = new THREE.Mesh(new THREE.BoxGeometry(sr * 0.5, d.len * 0.5, sr * 0.5).translate(0, -d.len * 0.25, 0), mats.gear);
  brace.position.z = sr * 2.5; brace.rotation.x = 0.35;
  if (!d.noStrut && d.len > 0.4) upper.add(brace);
  const doors = [];
  if (d.doors) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, d.len * 0.8, d.r * 2.2).translate(0, -d.len * 0.4, 0), mats.body2 || mats.white);
    door.position.x = (d.doorSide || 1) * (sr + 0.12);
    upper.add(door);
    doors.push(door);
  }
  return { pivot, upper, lower, axle, wheels, doors, def: d, compression: 0 };
}

// ---------- livery texture ----------
// Canvas mapping: x = along fuselage (nose..tail), y = th/2PI with canvas flipped.
export function liveryCanvas(shape, L) {
  const W = L.res?.[0] || 2048, H = L.res?.[1] || 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const X = (z) => (z - shape.zNose) / shape.length * W;
  const Y = (th) => (1 - th / TAU) * H;
  // base
  x.fillStyle = L.base || '#f4f4f2'; x.fillRect(0, 0, W, H);
  // belly
  if (L.belly) {
    x.fillStyle = L.belly;
    x.fillRect(0, Y(0.62), W, H - Y(0.62)); x.fillRect(0, 0, W, Y(TAU - 0.62));
  }
  // cheatline / stripes on both sides (th around PI/2 and 3PI/2)
  for (const s of L.stripes || []) {
    x.fillStyle = s.color;
    for (const side of [1, -1]) {
      const thC = side > 0 ? Math.PI / 2 + s.th : TAU - Math.PI / 2 - s.th;
      const y0 = Y(thC + s.wth / 2), y1 = Y(thC - s.wth / 2);
      x.save();
      x.beginPath();
      const z0 = s.z0 ?? shape.zNose, z1 = s.z1 ?? shape.zTail;
      const sl = s.slope || 0;
      x.moveTo(X(z0), Math.min(y0, y1)); x.lineTo(X(z1), Math.min(y0, y1) - sl * side * H);
      x.lineTo(X(z1), Math.max(y0, y1) - sl * side * H); x.lineTo(X(z0), Math.max(y0, y1));
      x.closePath(); x.fill();
      x.restore();
    }
  }
  // tail sweep colour block
  if (L.tailBlock) {
    x.fillStyle = L.tailBlock.color;
    const z0 = L.tailBlock.z0;
    x.beginPath();
    x.moveTo(X(z0), Y(Math.PI + 0.01)); x.lineTo(X(shape.zTail), Y(Math.PI * 0.45)); x.lineTo(X(shape.zTail), Y(Math.PI * 1.55)); x.closePath();
    x.globalAlpha = 0.95; x.fill(); x.globalAlpha = 1;
  }
  // passenger windows
  const wnd = L.windows;
  if (wnd) {
    x.fillStyle = wnd.color || '#1a2229';
    for (const side of [1, -1]) {
      for (const row of wnd.rows || [{ th: wnd.th, z0: wnd.z0, z1: wnd.z1 }]) {
        const th = side > 0 ? Math.PI / 2 + row.th : TAU - Math.PI / 2 - row.th;
        const cy = Y(th);
        const hpx = (wnd.h / (2 * Math.PI * (L.radius || 2))) * H;
        const wpx = wnd.w / shape.length * W;
        for (let z = row.z0; z <= row.z1; z += wnd.pitch) {
          if (wnd.skip && wnd.skip.some(([a, b]) => z > a && z < b)) continue;
          const px = X(z);
          x.beginPath();
          if (x.roundRect) x.roundRect(px - wpx / 2, cy - hpx / 2, wpx, hpx, Math.min(wpx, hpx) * 0.45); else x.rect(px - wpx / 2, cy - hpx / 2, wpx, hpx);
          x.fill();
        }
      }
    }
  }
  // doors (outlines)
  x.strokeStyle = 'rgba(60,60,60,0.55)'; x.lineWidth = 2;
  for (const d of L.doors || []) {
    for (const side of (d.sides || [1, -1])) {
      const th = side > 0 ? Math.PI / 2 + (d.th || 0) : TAU - Math.PI / 2 - (d.th || 0);
      const hpx = (d.h / (2 * Math.PI * (L.radius || 2))) * H, wpx = d.w / shape.length * W;
      const px = X(d.z), cy = Y(th);
      x.beginPath();
      if (x.roundRect) x.roundRect(px - wpx / 2, cy - hpx / 2, wpx, hpx, 6); else x.rect(px - wpx / 2, cy - hpx / 2, wpx, hpx);
      x.stroke();
    }
  }
  // cockpit windows (dark painted, exterior)
  x.fillStyle = L.glassColor || '#14202a';
  for (const w of L.cockpit || []) {
    x.beginPath();
    w.forEach(([z, th], i) => { const px = X(z), py = Y(th); i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.closePath(); x.fill();
  }
  // titles
  if (L.title) {
    x.fillStyle = L.titleColor || '#1d3e72';
    x.font = `bold ${L.titleSize || 46}px Arial, Helvetica, sans-serif`;
    x.textBaseline = 'middle';
    const zt = L.titleZ ?? (shape.zNose + shape.length * 0.32);
    const th = L.titleTh ?? 0.42;
    sideText(L.title, zt, th, L.titleScaleX || 1);
  }
  if (L.reg) {
    x.fillStyle = L.regColor || '#222';
    x.font = `bold ${L.regSize || 26}px Arial, Helvetica, sans-serif`;
    x.textBaseline = 'middle';
    sideText(L.reg, L.regZ ?? (shape.zTail - shape.length * 0.16), L.regTh ?? 0.2, 1);
  }
  // Text readable from outside on both sides (z = nose-side start of the text).
  function sideText(text, zStart, th, sx) {
    const wpx = x.measureText(text).width * sx;
    // right side: canvas +x is the viewer's left -> mirror horizontally, anchor at tail end
    x.save(); x.translate(X(zStart) + wpx, Y(Math.PI / 2 + th)); x.scale(-sx, 1); x.fillText(text, 0, 0); x.restore();
    // left side: canvas up is surface down -> flip vertically
    x.save(); x.translate(X(zStart), Y(TAU - Math.PI / 2 - th)); x.scale(sx, -1); x.fillText(text, 0, 0); x.restore();
  }
  // panel lines
  x.strokeStyle = 'rgba(0,0,0,0.07)'; x.lineWidth = 1;
  for (let z = shape.zNose; z < shape.zTail; z += L.panelPitch || 1.6) { x.beginPath(); x.moveTo(X(z), 0); x.lineTo(X(z), H); x.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Simple decal-ish logo texture for tails.
export function tailTexture(L) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = L.tail || L.base || '#fff'; x.fillRect(0, 0, 256, 256);
  if (L.tailStripe) { x.fillStyle = L.tailStripe; x.fillRect(0, 150, 256, 40); }
  if (L.logo) {
    x.fillStyle = L.logoColor || '#fff';
    x.beginPath();
    if (L.logo === 'circle') { x.arc(128, 110, 52, 0, TAU); x.fill(); x.fillStyle = L.tail; x.beginPath(); x.arc(140, 100, 40, 0, TAU); x.fill(); }
    else if (L.logo === 'wing') { x.moveTo(40, 160); x.quadraticCurveTo(128, 30, 220, 70); x.quadraticCurveTo(140, 90, 40, 160); x.fill(); }
    else if (L.logo === 'star') { for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2, r = i % 2 ? 26 : 62; x.lineTo(128 + Math.cos(a) * r, 110 + Math.sin(a) * r); } x.fill(); }
    else if (L.logo === 'cross') { x.fillRect(108, 50, 40, 120); x.fillRect(68, 90, 120, 40); }
    else if (L.logo === 'text') { x.font = 'bold 80px Arial'; x.textAlign = 'center'; x.fillText(L.logoText || 'A', 128, 135); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
