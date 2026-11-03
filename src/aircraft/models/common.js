// Shared helpers for aircraft model descriptions.
const PI = Math.PI;

// Tube fuselage with nose and tail cone. Returns station list [z, w, h, y, e].
export function tube(o) {
  const { zN, zT, w, h, nose, tail } = o;
  const ny = o.noseY ?? -h * 0.18;          // nose tip height relative to centre line
  const up = o.upsweep ?? h * 0.55;         // tail cone upsweep
  const tipW = o.tipW ?? 0.08, tipH = o.tipH ?? tipW;
  const e = o.e ?? 2;
  const n = nose, t = tail;
  const st = [
    [zN, 0.01, 0.01, ny, 2],
    [zN + n * 0.04, w * 0.26, h * 0.24, ny * 0.85, 2],
    [zN + n * 0.14, w * 0.5, h * 0.48, ny * 0.6, 2],
    [zN + n * 0.32, w * 0.74, h * 0.72, ny * 0.32, 2],
    [zN + n * 0.56, w * 0.9, h * 0.9, ny * 0.12, e],
    [zN + n * 0.8, w * 0.98, h * 0.98, ny * 0.02, e],
    [zN + n, w, h, 0, e],
    [zT - t, w, h, 0, e],
    [zT - t * 0.72, w * 0.88, h * 0.84, up * 0.18, e],
    [zT - t * 0.45, w * 0.64, h * 0.56, up * 0.48, 2],
    [zT - t * 0.18, w * 0.34, h * 0.3, up * 0.82, 2],
    [zT, tipW, tipH, up, 2],
  ];
  if (o.hump) {
    // raise the top of the forward fuselage (upper deck)
    const { z0, z1, dh } = o.hump;
    for (const s of st) {
      if (s[0] >= z0 && s[0] <= z1 + 6) {
        const k = s[0] <= z1 ? 1 : 1 - (s[0] - z1) / 6;
        const kk = s[0] < z0 + 4 ? (s[0] - z0) / 4 : 1;
        const d = dh * Math.max(0, Math.min(k, kk));
        s[2] += d / 2; s[3] += d / 2;
      }
    }
    // extra stations to shape the hump
    st.push([z1, w, h + dh / 2, dh / 2, e]);
    st.push([z1 + 3, w, h + dh * 0.3, dh * 0.3, e]);
    st.push([z0 + 4, w * 0.95, h * 0.95 + dh * 0.45, dh * 0.42 + ny * 0.05, e]);
  }
  return st.sort((a, b) => a[0] - b[0]);
}

// Airliner-style cockpit windows (polygons in [z, theta]); zW = windscreen base z, len = depth.
// zW = z of the windscreen lower edge (front), d1 = depth of the front panes along z.
export function airlinerWindshield(zW, d1 = 0.6, sideLen = 1.3, o = {}) {
  const low = o.low ?? 0.95, sLow = o.sideLow ?? 1.3, sTop = o.sideTop ?? 0.52, mid = o.mid ?? 0.05;
  const mir = (poly) => poly.map(([z, th]) => [z, 2 * PI - th]);
  const fR = [[zW, PI - low], [zW, PI - mid], [zW + d1, PI - mid], [zW + d1, PI - low + 0.14]];
  const z1 = zW + d1 + 0.07, z2 = z1 + sideLen * 0.5, z3 = z2 + 0.07, z4 = z3 + sideLen * 0.45;
  const s1R = [[z1, PI - sLow], [z1, PI - sTop], [z2, PI - sTop - 0.04], [z2, PI - sLow + 0.03]];
  const s2R = [[z3, PI - sLow + 0.05], [z3, PI - sTop - 0.06], [z4, PI - sTop - 0.12], [z4, PI - sLow + 0.12]];
  const list = [fR, mir(fR), s1R, mir(s1R)];
  if (!o.noSecond) list.push(s2R, mir(s2R));
  return list.map((poly) => ({ poly }));
}

// Light aircraft cabin glazing: windscreen, door windows, rear windows.
export function gaWindows(z0, z1, z2, z3, o = {}) {
  const top = o.top ?? 0.35, low = o.low ?? 1.05, sideLow = o.sideLow ?? 1.25, sideTop = o.sideTop ?? 0.45;
  const ws = [[z0, PI - low], [z1, PI - top], [z1, PI + top], [z0, PI + low]];
  const dR = [[z1 + 0.06, PI - sideLow], [z1 + 0.06, PI - sideTop - 0.05], [z2, PI - sideTop], [z2, PI - sideLow]];
  const dL = [[z1 + 0.06, PI + sideLow], [z2, PI + sideLow], [z2, PI + sideTop], [z1 + 0.06, PI + sideTop + 0.05]];
  const out = [{ poly: ws }, { poly: dR }, { poly: dL }];
  if (z3 > z2) {
    out.push({ poly: [[z2 + 0.08, PI - sideLow + 0.08], [z2 + 0.08, PI - sideTop], [z3, PI - sideTop - 0.1], [z3 - 0.1, PI - sideLow + 0.25]] });
    out.push({ poly: [[z2 + 0.08, PI + sideLow - 0.08], [z3 - 0.1, PI + sideLow - 0.25], [z3, PI + sideTop + 0.1], [z2 + 0.08, PI + sideTop]] });
  }
  if (o.roof) out.push({ poly: [[z1 + 0.1, PI - 0.25], [z1 + 0.6, PI - 0.25], [z1 + 0.6, PI + 0.25], [z1 + 0.1, PI + 0.25]] });
  return out;
}

// Helicopter glazing: big windscreen + chin windows + side doors.
export function heliWindows(zN, zWs, zDoor0, zDoor1, o = {}) {
  const out = [];
  const side = o.side ?? 1.45;            // how far round the sides the windscreen wraps
  out.push({ poly: [[zN + 0.04, PI - side], [zWs, PI - 0.22], [zWs, PI + 0.22], [zN + 0.04, PI + side]] });
  if (o.chin !== false) {
    const c0 = o.chinLow ?? 0.45;
    out.push({ poly: [[zN + 0.1, PI - side - 0.06], [zN + 0.1, c0], [zWs - 0.15, c0 + 0.25], [zWs - 0.15, PI - side - 0.12]] });
    out.push({ poly: [[zN + 0.1, PI + side + 0.06], [zWs - 0.15, PI + side + 0.12], [zWs - 0.15, 2 * PI - c0 - 0.25], [zN + 0.1, 2 * PI - c0]] });
  }
  const sl = o.sideLow ?? 1.62, st = o.sideTop ?? 0.32;
  out.push({ poly: [[zWs + 0.05, PI - sl], [zWs + 0.05, PI - st], [zDoor0, PI - st - 0.02], [zDoor0, PI - sl - 0.08]] });
  out.push({ poly: [[zWs + 0.05, PI + sl], [zDoor0, PI + sl + 0.08], [zDoor0, PI + st + 0.02], [zWs + 0.05, PI + st]] });
  if (zDoor1 > zDoor0) {
    out.push({ poly: [[zDoor0 + 0.1, PI - 1.35], [zDoor0 + 0.1, PI - 0.42], [zDoor1, PI - 0.44], [zDoor1, PI - 1.35]] });
    out.push({ poly: [[zDoor0 + 0.1, PI + 1.35], [zDoor1, PI + 1.35], [zDoor1, PI + 0.44], [zDoor0 + 0.1, PI + 0.42]] });
  }
  if (o.roof) out.push({ poly: [[zWs + 0.02, PI - 0.18], [zWs + 0.55, PI - 0.18], [zWs + 0.55, PI + 0.18], [zWs + 0.02, PI + 0.18]] });
  return out;
}

// Standard main wing definition helper.
export function wing(o) {
  const panels = [];
  if (o.kink) {
    panels.push({ span: o.span * o.kink, c0: o.cRoot, c1: o.cKink, sweep: o.sweepIn ?? o.sweep * 0.7, dihedral: o.dihedral, t0: o.tRoot, t1: (o.tRoot + o.tTip) / 2 });
    panels.push({ span: o.span * (1 - o.kink), c0: o.cKink, c1: o.cTip, sweep: o.sweep, dihedral: o.dihedral, t0: (o.tRoot + o.tTip) / 2, t1: o.tTip });
  } else {
    panels.push({ span: o.span, c0: o.cRoot, c1: o.cTip, sweep: o.sweep, dihedral: o.dihedral, t0: o.tRoot, t1: o.tTip });
  }
  if (o.raked) panels.push({ span: o.raked.span, c0: o.cTip, c1: o.raked.c, sweep: o.raked.sweep, dihedral: o.dihedral, t0: o.tTip, t1: o.tTip });
  const total = panels.reduce((s, p) => s + p.span, 0);
  const surfaces = [];
  const fr = (x) => x / total;
  if (o.flaps) o.flaps.forEach((f, i) => surfaces.push({ name: 'flap' + i, type: 'flap', s0: fr(f[0]), s1: fr(f[1]), cf: f[2] ?? 0.28, max: o.flapMax ?? 40 }));
  if (o.ailerons) surfaces.push({ name: 'aileron', type: 'aileron', s0: fr(o.ailerons[0]), s1: fr(o.ailerons[1]), cf: o.ailerons[2] ?? 0.25, max: 20 });
  if (o.elevons) o.elevons.forEach((f, i) => surfaces.push({ name: 'elevon' + i, type: 'elevon', s0: fr(f[0]), s1: fr(f[1]), cf: f[2] ?? 0.2, max: 25 }));
  return {
    root: o.root, panels, surfaces, camber: o.camber ?? 0.025, material: o.material || 'wing', twist1: o.twist ?? 2.5,
  };
}

// Leading-edge position and chord at the tip of a wing definition.
export function tipOf(w) {
  let x = w.root[0], y = w.root[1], z = w.root[2], c = 0;
  for (const p of w.panels) {
    const d = (p.dihedral || 0) * PI / 180;
    x += p.span * Math.cos(d); y += p.span * Math.sin(d); z += p.span * Math.tan((p.sweep || 0) * PI / 180);
    c = p.c1;
  }
  return { x, y, z, c };
}

export function winglet(o) {
  // vertical-ish surface at wingtip; o.on = wing definition it attaches to
  const t = tipOf(o.on);
  const c = Math.cos(o.cant * PI / 180), s = Math.sin(o.cant * PI / 180);
  const c0 = o.c0 ?? t.c * 0.95;
  return {
    root: [t.x - 0.02, t.y, t.z + (t.c - c0) * 0.8], dir: [s, c, 0], up: [-c, s, 0],
    panels: [{ span: o.h, c0, c1: o.c1, sweep: o.sweep, dihedral: 0, t0: 0.08, t1: 0.08 }], surfaces: [], camber: 0.0, material: o.material || 'wing',
  };
}

// Nav light positions at the wing tips.
export function tipLights(w, dy = 0.05) {
  const t = tipOf(w);
  return { navL: [-t.x - 0.1, t.y + dy, t.z + t.c * 0.35], navR: [t.x + 0.1, t.y + dy, t.z + t.c * 0.35] };
}

export function hstab(o) {
  return {
    root: o.root, panels: [{ span: o.span, c0: o.c0, c1: o.c1, sweep: o.sweep, dihedral: o.dihedral || 0, t0: o.t || 0.1, t1: o.t || 0.1 }],
    surfaces: o.allMoving ? [{ name: 'stab', type: 'elevator', s0: 0, s1: 1, cf: 1, max: 15 }] : [{ name: 'elevator', type: 'elevator', s0: o.e0 ?? 0.05, s1: o.e1 ?? 0.98, cf: o.cf ?? 0.33, max: 25 }],
    camber: 0, material: o.material || 'wing',
  };
}

export function vfin(o) {
  return {
    root: o.root, dir: [0, 1, 0], up: [-1, 0, 0], mirror: false, vertical: true,
    panels: [{ span: o.h, c0: o.c0, c1: o.c1, sweep: o.sweep, dihedral: 0, t0: o.t || 0.1, t1: o.t || 0.1 }],
    surfaces: o.noRudder ? [] : [{ name: 'rudder', type: 'rudder', s0: o.r0 ?? 0.04, s1: o.r1 ?? 0.95, cf: o.cf ?? 0.3, max: 30 }],
    camber: 0, material: o.material || 'tail',
  };
}

export function vtail(o) {
  const c = Math.cos(o.dihedral * PI / 180), s = Math.sin(o.dihedral * PI / 180);
  return {
    root: o.root, dir: [c, s, 0], up: [-s, c, 0],
    panels: [{ span: o.span, c0: o.c0, c1: o.c1, sweep: o.sweep, dihedral: 0, t0: 0.1, t1: 0.1 }],
    surfaces: [{ name: 'ruddervator', type: 'ruddervator', s0: 0.05, s1: 0.95, cf: 0.35, max: 25 }], camber: 0, material: o.material || 'tail',
  };
}

// Tricycle airliner gear (retractable). Returns gear defs.
export function airlinerGear(o) {
  const g = [];
  g.push({ name: 'nose', pos: [0, o.yAttach, o.zNose], len: o.noseLen, wheels: 2, r: o.noseR, w: o.noseR * 0.6, track: o.noseR * 1.1, steer: true, retract: { axis: 'x', angle: 1.6 }, doors: true });
  for (const side of [-1, 1]) {
    const def = { name: side < 0 ? 'mainL' : 'mainR', pos: [side * o.xMain, o.yAttachMain ?? o.yAttach, o.zMain], len: o.mainLen, wheels: o.mainWheels || 2, r: o.mainR, w: o.mainR * 0.55, track: o.mainR * 1.25, retract: { axis: 'z', angle: side * -1.55 }, doors: o.doors ?? true, doorSide: side, bogie: o.bogie };
    g.push(def);
  }
  if (o.bodyGear) {
    for (const side of [-1, 1]) g.push({ name: side < 0 ? 'bodyL' : 'bodyR', pos: [side * o.bodyGear.x, o.yAttach, o.bodyGear.z], len: o.mainLen, wheels: 4, r: o.mainR, w: o.mainR * 0.55, track: o.mainR * 1.25, bogie: o.bogie, retract: { axis: 'x', angle: -1.5 }, doors: true });
  }
  return g;
}

export const PIc = PI;

// ---------------------------------------------------------------- cockpit glazing from the pilot's view
// Windows are specified as angular rectangles seen from the pilot's eye (azimuth +right, elevation +up,
// degrees) and ray-projected onto the fuselage surface, returning polygons in (z, theta) fuselage space
// that are used both for the exterior painted glass and the cut-outs of the cockpit interior shell.
function projectDir(shape, eye, az, el) {
  const P = hitPoint(shape, eye, az, el);
  const s = shape.at(P[2]);
  const sx = Math.sign(P[0]) * Math.pow(Math.min(1, Math.abs(P[0]) / Math.max(1e-3, s.w)), s.e / 2);
  const cy = -Math.sign(P[1] - s.y) * Math.pow(Math.min(1, Math.abs(P[1] - s.y) / Math.max(1e-3, s.h)), s.e / 2);
  let th = Math.atan2(sx, cy);
  if (th < 0) th += 2 * PI;
  return [P[2], th];
}

function hitPoint(shape, eye, az, el) {
  const a = az * PI / 180, e = el * PI / 180;
  const dx = Math.sin(a) * Math.cos(e), dy = Math.sin(e), dz = -Math.cos(a) * Math.cos(e);
  let t0 = 0, t1 = 0, P = [eye[0], eye[1], eye[2]];
  const inside = (x, y, z) => {
    if (z < shape.zNose || z > shape.zTail) return false;
    const s = shape.at(z);
    if (s.w < 0.02 || s.h < 0.02) return false;
    return Math.pow(Math.abs(x) / s.w, s.e) + Math.pow(Math.abs(y - s.y) / s.h, s.e) < 1;
  };
  for (let t = 0.02; t < 12; t += 0.03) {
    if (!inside(eye[0] + dx * t, eye[1] + dy * t, eye[2] + dz * t)) { t1 = t; break; }
    t0 = t;
  }
  if (!t1) t1 = 12;
  for (let k = 0; k < 12; k++) { const m = (t0 + t1) / 2; if (inside(eye[0] + dx * m, eye[1] + dy * m, eye[2] + dz * m)) t0 = m; else t1 = m; }
  const t = (t0 + t1) / 2;
  P = [eye[0] + dx * t, eye[1] + dy * t, Math.max(shape.zNose, Math.min(shape.zTail, eye[2] + dz * t))];
  return P;
}

// Azimuth (from a left-seat eye) at which the line of sight meets the fuselage at x = -halfPost,
// i.e. the inner edge of a windscreen that ends at a centre post.
function azToCentre(shape, eye, el, halfPost) {
  let lo = -10, hi = 75;
  for (let k = 0; k < 24; k++) {
    const m = (lo + hi) / 2;
    if (hitPoint(shape, eye, m, el)[0] < -halfPost) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

function projectRect(shape, eye, r) {
  const [a0, a1r] = r.az, [e0, e1] = r.el;
  const a1 = a1r;
  const tp = (r.taper || 0) * (a1 - a0) / 2;
  const corners = [[a0, e0], [a1, e0], [a1 - tp, e1], [a0 + tp, e1]];
  if (r.post !== undefined && eye[0] < 0) {
    // inner edge runs up the centre post
    corners[1][0] = azToCentre(shape, eye, e0, r.post);
    corners[2][0] = azToCentre(shape, eye, e1, r.post);
  }
  const poly = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
    const n = 10;
    for (let k = 0; k < n; k++) {
      const s = k / n;
      poly.push(projectDir(shape, eye, ax + (bx - ax) * s, ay + (by - ay) * s));
    }
  }
  // keep theta continuous (windows crossing the top centreline straddle PI, never 0/2PI)
  return poly;
}

const GLAZING = {
  gaHigh: [{ c: true, az: [-58, 58], el: [-13, 20], taper: 0.1 }, { az: [-118, -62], el: [-34, 22] }, { az: [-152, -124], el: [-18, 15] }],
  gaHighRoof: [{ c: true, az: [-58, 58], el: [-13, 20], taper: 0.1 }, { az: [-118, -62], el: [-34, 22] }, { az: [-152, -124], el: [-18, 15] }, { c: true, az: [-22, 22], el: [40, 70] }],
  gaLow: [{ c: true, az: [-58, 58], el: [-12, 25], taper: 0.12 }, { az: [-120, -62], el: [-22, 32] }, { az: [-152, -126], el: [-12, 18] }],
  vlj: [{ c: true, az: [-58, 58], el: [-11, 22], taper: 0.15 }, { az: [-112, -63], el: [-18, 24] }, { az: [-150, -118], el: [-10, 14] }],
  commuter: [{ az: [-46, -3], el: [-12, 16], taper: 0.08, post: 0.035 }, { az: [-95, -50], el: [-18, 12] }],
  airliner: [{ az: [-37, -2], el: [-15, 17], taper: 0.1, post: 0.04 }, { az: [-72, -41], el: [-16, 13] }, { az: [-104, -76], el: [-13, 9] }],
  regional: [{ az: [-40, -2], el: [-15, 16], taper: 0.08, post: 0.04 }, { az: [-75, -44], el: [-17, 12] }, { az: [-104, -79], el: [-13, 9] }],
  bizjet: [{ az: [-40, -2], el: [-13, 17], taper: 0.1, post: 0.035 }, { az: [-82, -44], el: [-16, 12] }],
  sst: [{ az: [-24, -2], el: [-8, 9], post: 0.05 }, { az: [-62, -28], el: [-10, 8] }],
  heliBubble: [{ c: true, az: [-82, 82], el: [-62, 42], taper: 0.25 }, { az: [-142, -86], el: [-48, 30] }],
  heliGlass: [{ c: true, az: [-62, 62], el: [-24, 28], taper: 0.12 }, { c: true, az: [-38, 38], el: [-68, -30] }, { az: [-128, -66], el: [-42, 22] }],
  heliUtility: [{ c: true, az: [-64, 64], el: [-24, 30], taper: 0.12 }, { c: true, az: [-40, 40], el: [-70, -30] }, { az: [-130, -68], el: [-44, 24] }, { c: true, az: [-26, 26], el: [36, 62] }],
  heliHeavy: [{ az: [-50, -3], el: [-28, 22], post: 0.04 }, { az: [-100, -54], el: [-36, 16] }, { az: [-40, -6], el: [-66, -33] }],
};

// Returns a function (shape, eye) -> [{poly}] used by the assembler once the fuselage exists.
export function glazing(kind) {
  return (shape, eye) => {
    const out = [];
    const eyeL = [-Math.abs(eye[0]), eye[1], eye[2]];
    const eyeC = [0, eye[1], eye[2]];
    for (const r of GLAZING[kind] || []) {
      if (r.c) out.push({ poly: projectRect(shape, eyeC, r) });
      else {
        const p = projectRect(shape, eyeL, r);
        out.push({ poly: p });
        out.push({ poly: p.map(([z, th]) => [z, 2 * PI - th]) });
      }
    }
    return out;
  };
}
