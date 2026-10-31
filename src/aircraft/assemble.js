// Assembles a full three.js aircraft from a model description (see models.js).
import * as THREE from 'three';
import {
  FuselageShape, loftGeometry, wingGeometry, hingePivot, latheZ, turbofanGeometry, fanGroup,
  propellerGroup, rotorGroup, tailRotorGroup, gearUnit, liveryCanvas, tailTexture,
} from './modeler.js';
import { glowTexture } from '../render/textures.js';
import { mergeGeometries } from '../render/geom.js';

function makeMaterials(desc, pbr) {
  const L = desc.livery || {};
  const shape = desc._shape;
  const livery = liveryCanvas(shape, { ...L, cockpit: desc.cockpitWindows ? desc.cockpitWindows.map((w) => w.poly) : [], radius: L.radius || shape.at(shape.zNose + shape.length * 0.5).w });
  const tail = tailTexture(L);
  const Std = (o) => {
    if (pbr) return new THREE.MeshStandardMaterial(o);
    const l = {};
    for (const k of ['color', 'map', 'transparent', 'opacity', 'side', 'depthWrite']) if (o[k] !== undefined) l[k] = o[k];
    return new THREE.MeshLambertMaterial(l);
  };
  const col = (c) => new THREE.Color(c);
  return {
    body: Std({ map: livery, roughness: 0.36, metalness: 0.12 }),
    body2: Std({ color: col(L.base || '#f2f2f0'), roughness: 0.4, metalness: 0.1 }),
    wing: Std({ color: col(L.wing || '#d9dbdd'), roughness: 0.42, metalness: 0.25 }),
    tail: Std({ map: tail, roughness: 0.38, metalness: 0.1 }),
    engine: Std({ color: col(L.engine || '#d0d3d6'), roughness: 0.3, metalness: 0.55 }),
    engineAccent: Std({ color: col(L.engineAccent || L.engine || '#c8cbce'), roughness: 0.32, metalness: 0.4 }),
    darkMetal: Std({ color: col('#3a3d41'), roughness: 0.45, metalness: 0.6 }),
    chrome: Std({ color: col('#d6dade'), roughness: 0.15, metalness: 0.95 }),
    gear: Std({ color: col(L.gear || '#c3c6ca'), roughness: 0.4, metalness: 0.5 }),
    tire: Std({ color: col('#1b1b1c'), roughness: 0.92, metalness: 0 }),
    hub: Std({ color: col('#a8acb0'), roughness: 0.3, metalness: 0.7 }),
    prop: Std({ color: col(L.prop || '#1e1f20'), roughness: 0.5, metalness: 0.3 }),
    spinner: Std({ color: col(L.spinner || '#ececec'), roughness: 0.25, metalness: 0.4 }),
    rotor: Std({ color: col(L.rotor || '#2b2d30'), roughness: 0.55, metalness: 0.25 }),
    stripe: Std({ color: col('#e8c020'), roughness: 0.5 }),
    fanDisc: Std({ color: col('#121315'), roughness: 0.6, metalness: 0.2 }),
    white: Std({ color: col('#f0f0ee'), roughness: 0.4, metalness: 0.05 }),
    black: Std({ color: col('#151515'), roughness: 0.7 }),
    red: Std({ color: col('#c41e1e'), roughness: 0.45 }),
    orange: Std({ color: col('#ff6a10'), roughness: 0.45 }),
    accent: Std({ color: col(L.accent || L.titleColor || '#1d3e72'), roughness: 0.4, metalness: 0.15 }),
    glass: Std({ color: col('#1c2a33'), roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }),
    exhaust: Std({ color: col('#4b4038'), roughness: 0.6, metalness: 0.7 }),
  };
}

function sprite(color, size) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  s.renderOrder = 20;
  return s;
}

export function buildAircraftModel(spec, opts = {}) {
  const detail = opts.detail ?? 1;
  const pbr = opts.pbr ?? true;
  const desc = spec.model();
  const shape = new FuselageShape(desc.fuselage.stations);
  desc._shape = shape;
  if (typeof desc.cockpitWindows === 'function') desc.cockpitWindows = desc.cockpitWindows(shape, desc.cockpit.eye);
  const mats = makeMaterials(desc, pbr);
  const root = new THREE.Group();
  root.name = spec.id;
  const exterior = new THREE.Group();     // hidden from the cockpit (encloses the eye)
  const outer = new THREE.Group();        // always visible (wings, engines, gear...)
  root.add(exterior); root.add(outer);
  const out = {
    root, exterior, outer, mats, shape, desc, surfaces: {}, flaps: [], spoilers: [], props: [], fans: [], rotors: [], tailRotors: [],
    gear: [], lights: {}, anims: [], extras: {}, statics: [],
  };
  const statics = new Map();   // material key -> geometries (merged at the end)
  const addStatic = (key, geo, parentKey = 'outer') => {
    const k = parentKey + ':' + key;
    if (!statics.has(k)) statics.set(k, []);
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    statics.get(k).push(g);
  };
  out.addStatic = addStatic;

  // ---------- fuselage ----------
  const F = desc.fuselage;
  const fus = new THREE.Mesh(loftGeometry(shape, Math.round((F.rings || 72) * detail), Math.round((F.segs || 32) * Math.max(0.6, detail))), mats.body);
  fus.castShadow = true; fus.receiveShadow = true;
  exterior.add(fus);
  out.fuselage = fus;
  for (const b of desc.bodies || []) {
    const s = new FuselageShape(b.stations);
    const g = loftGeometry(s, Math.round((b.rings || 24) * detail), Math.round((b.segs || 20) * Math.max(0.6, detail)));
    if (b.pos) g.translate(...b.pos);
    if (b.rot) g.rotateY(b.rot);
    if (b.mirror) {
      const g2 = g.clone();
      g2.scale(-1, 1, 1);
      // fix winding after mirror
      const idx = g2.index; if (idx) { for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i); idx.setX(i, idx.getX(i + 2)); idx.setX(i + 2, t); } }
      g2.computeVertexNormals();
      addStatic(b.material || 'body2', g2, b.exterior ? 'exterior' : 'outer');
    }
    addStatic(b.material || 'body2', g, b.exterior ? 'exterior' : 'outer');
  }

  // ---------- lifting surfaces ----------
  const surfaceMat = (s) => mats[s.material || 'wing'];
  const buildSurface = (wd) => {
    const sides = wd.mirror === false ? [1] : [1, -1];
    for (const side of sides) {
      const wg = wingGeometry({ ...wd, detail }, side);
      for (const g of wg.fixed) addStatic(wd.material || 'wing', g, wd.exterior ? 'exterior' : 'outer');
      for (const s of wg.surfaces) {
        const geo = s.geos.length > 1 ? mergeGeometries(s.geos) : s.geos[0];
        const { pivot, mesh } = hingePivot(geo, s.hingeA, s.hingeB, surfaceMat(wd));
        mesh.castShadow = true;
        outer.add(pivot);
        const nm = s.name + (sides.length > 1 ? (side > 0 ? 'R' : 'L') : '');
        const entry = { pivot, type: s.type, side, name: nm, max: (s.max ?? (wd.surfaces.find((q) => q.name === s.name).max ?? 20)) * Math.PI / 180 };
        // hinge axis runs root->tip; for left side the axis direction flips, so invert sign to keep "positive = trailing edge down"
        entry.sign = side;
        if (wd.vertical) entry.sign = 1;
        out.surfaces[nm] = entry;
        if (s.type === 'flap') out.flaps.push(entry);
        if (s.type === 'spoiler') out.spoilers.push(entry);
      }
    }
  };
  for (const w of desc.wings || []) buildSurface(w);
  for (const t of desc.tails || []) buildSurface(t);

  // ---------- engines ----------
  for (const e of desc.engines || []) {
    if (e.kind === 'turbofan') {
      const tg = turbofanGeometry({ ...e, seg: Math.round(28 * Math.max(0.6, detail)) });
      const grp = new THREE.Group();
      grp.position.set(...e.pos);
      if (e.yaw) grp.rotation.y = e.yaw;
      if (e.pitch) grp.rotation.x = e.pitch;
      const shell = new THREE.Mesh(tg.shell, mats.engine);
      if (e.flatBottom) shell.scale.set(1, 0.9, 1);
      shell.castShadow = true;
      grp.add(shell);
      const core = new THREE.Mesh(tg.core, mats.engineAccent); grp.add(core);
      const plug = new THREE.Mesh(tg.plug, mats.exhaust); grp.add(plug);
      const fan = fanGroup(tg.fanR, e.fanBlades || 22, e.r * 0.5, mats.darkMetal, mats.spinner, mats.fanDisc);
      fan.group.position.z = tg.fanZ;
      grp.add(fan.group);
      outer.add(grp);
      out.fans.push({ spin: fan.blades, spinner: fan.spinner, engine: e.engine ?? out.fans.length, group: grp });
      if (e.pylon) {
        const p = e.pylon;
        const pg = new THREE.BoxGeometry(p.w || e.r * 0.25, p.h, p.len);
        pg.translate(e.pos[0], e.pos[1] + e.r * 0.85 * (p.down ? -1 : 1) + (p.down ? -p.h / 2 : p.h / 2), e.pos[2] + (p.z || e.len * 0.45));
        if (p.sweepBack) {
          const pp = pg.attributes.position;
          for (let i = 0; i < pp.count; i++) if (pp.getY(i) > e.pos[1] + e.r) pp.setZ(i, pp.getZ(i) + p.sweepBack);
        }
        addStatic('engine', pg);
      }
      if (e.reverser) out.extras.reversers = (out.extras.reversers || []).concat([{ grp, len: e.len, r: e.r }]);
    } else if (e.kind === 'nacelle') {
      // turboprop / piston nacelle: lathe body
      const L = e.len, R = e.r;
      const prof = e.profile || [[R * 0.55, 0], [R * 0.95, L * 0.08], [R, L * 0.25], [R * 0.95, L * 0.6], [R * 0.6, L * 0.92], [R * 0.2, L]];
      const g = latheZ(prof, Math.round(20 * Math.max(0.6, detail)));
      if (e.squash) g.scale(e.squash[0], e.squash[1], 1);
      g.translate(...e.pos);
      addStatic(e.material || 'engine', g);
      if (e.exhaust) {
        for (const ex of e.exhaust) addStatic('exhaust', new THREE.CylinderGeometry(ex[3], ex[3], 0.5, 8).rotateX(Math.PI / 2).translate(ex[0], ex[1], ex[2]));
      }
      if (e.intake) addStatic('darkMetal', new THREE.BoxGeometry(e.intake[3], e.intake[4], 0.6).translate(e.intake[0], e.intake[1], e.intake[2]));
    } else if (e.kind === 'radial') {
      const g = latheZ([[e.r * 0.82, 0], [e.r, 0.12], [e.r, e.len * 0.6], [e.r * 0.92, e.len]], 24);
      g.translate(...e.pos);
      addStatic(e.material || 'engine', g);
      // visible cylinders inside cowl
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2;
        addStatic('darkMetal', new THREE.CylinderGeometry(0.07, 0.08, e.r * 0.62, 8).rotateZ(Math.PI / 2).rotateZ(a).translate(e.pos[0] + Math.cos(a) * e.r * 0.42, e.pos[1] + Math.sin(a) * e.r * 0.42, e.pos[2] + 0.18));
      }
      addStatic('fanDisc', new THREE.CircleGeometry(e.r * 0.9, 20).rotateY(Math.PI).translate(e.pos[0], e.pos[1], e.pos[2] + 0.35));
    }
  }

  // ---------- props & rotors ----------
  for (const p of desc.props || []) {
    const pg = propellerGroup({ ...p }, mats);
    outer.add(pg.group);
    pg.engine = p.engine ?? out.props.length;
    out.props.push(pg);
  }
  for (const r of desc.rotors || []) {
    const rg = rotorGroup(r, mats);
    outer.add(rg.group);
    rg.index = out.rotors.length;
    out.rotors.push(rg);
  }
  for (const t of desc.tailRotors || []) {
    const tg = tailRotorGroup(t, mats);
    outer.add(tg.group);
    out.tailRotors.push(tg);
  }
  if (desc.fenestron) {
    const f = desc.fenestron;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(f.radius * 1.05, f.radius * 0.12, 8, 24).rotateY(Math.PI / 2), mats.body2);
    ring.position.set(...f.pos);
    outer.add(ring);
    const tg = tailRotorGroup({ pos: f.pos, radius: f.radius, blades: 10, chord: f.radius * 0.22 }, mats);
    outer.add(tg.group);
    out.tailRotors.push(tg);
  }

  // ---------- landing gear ----------
  for (const gd of desc.gear || []) {
    const u = gearUnit(gd, mats);
    u.pivot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    outer.add(u.pivot);
    out.gear.push(u);
  }
  if (desc.skids) {
    const s = desc.skids;
    for (const side of [-1, 1]) {
      const tube = new THREE.CylinderGeometry(s.r, s.r, s.z1 - s.z0, 10).rotateX(Math.PI / 2).translate(side * s.x, s.y, (s.z0 + s.z1) / 2);
      addStatic('gear', tube);
      const tipF = new THREE.TorusGeometry(0.25, s.r, 6, 10, Math.PI / 2).rotateY(Math.PI / 2).translate(side * s.x, s.y + 0.25, s.z0);
      addStatic('gear', tipF);
      for (const cz of s.cross) {
        const h = s.attachY - s.y;
        const leg = new THREE.CylinderGeometry(s.r * 0.9, s.r * 0.9, Math.hypot(h, s.x - s.ax), 8);
        const ang = Math.atan2(s.x - s.ax, h);
        leg.rotateZ(side * ang).translate(side * (s.x + s.ax) / 2, s.y + h / 2, cz);
        addStatic('gear', leg);
      }
    }
    for (const cz of s.cross) addStatic('gear', new THREE.CylinderGeometry(s.r * 0.9, s.r * 0.9, s.ax * 2, 8).rotateZ(Math.PI / 2).translate(0, s.attachY, cz));
  }

  // ---------- lights ----------
  const Lg = desc.lights || {};
  const addLight = (name, pos, color, size) => {
    if (!pos) return;
    const s = sprite(color, size);
    s.position.set(...pos);
    outer.add(s);
    out.lights[name] = s;
  };
  addLight('navL', Lg.navL, 0xff2a1a, 0.7);
  addLight('navR', Lg.navR, 0x2aff5a, 0.7);
  addLight('navTail', Lg.tail, 0xffffff, 0.55);
  addLight('strobeL', Lg.strobeL || Lg.navL, 0xffffff, 1.6);
  addLight('strobeR', Lg.strobeR || Lg.navR, 0xffffff, 1.6);
  addLight('beaconTop', Lg.beaconTop, 0xff2010, 0.9);
  addLight('beaconBottom', Lg.beaconBottom, 0xff2010, 0.9);
  for (const k of ['strobeL', 'strobeR', 'beaconTop', 'beaconBottom']) if (out.lights[k]) out.lights[k].visible = false;
  out.lights.landing = [];
  for (const p of Lg.landing || []) {
    const s = sprite(0xfff4e0, 1.4);
    s.visible = false;
    s.position.set(...p);
    outer.add(s);
    out.lights.landing.push(s);
  }

  // ---------- custom parts ----------
  if (desc.custom) desc.custom({ out, mats, shape, addStatic, outer, exterior, detail, THREE });

  // ---------- merge statics ----------
  for (const [k, list] of statics) {
    const [parentKey, key] = k.split(':');
    const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!g) continue;
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats[key] || mats.body2);
    m.castShadow = true; m.receiveShadow = true;
    m.name = 'static_' + key;
    (parentKey === 'exterior' ? exterior : outer).add(m);
    out.statics.push(m);
  }
  root.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(root);
  out.bounds = box;
  desc._bounds = box;
  return out;
}

// A cheap single/few-draw-call static version for parked aircraft (gear down, props still).
export function buildStaticAircraft(spec, opts = {}) {
  const full = buildAircraftModel(spec, { detail: opts.detail ?? 0.45, pbr: opts.pbr ?? false });
  const byMat = new Map();
  full.root.updateMatrixWorld(true);
  full.root.traverse((o) => {
    if (!o.isMesh || o.material.transparent) return;
    if (o.material.map && o.material.map.image && o.material !== full.mats.body && o.material !== full.mats.tail) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const group = new THREE.Group();
  for (const [mat, list] of byMat) {
    const g = mergeGeometries(list, false);
    if (!g) continue;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  group.userData.bounds = full.bounds;
  return group;
}
