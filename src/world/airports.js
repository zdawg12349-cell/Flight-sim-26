// Builds airport scenery: runways with ICAO markings, taxiways, aprons, lighting (edge,
// threshold, approach with sequenced flashers, PAPI), signs, windsocks and buildings.
import * as THREE from 'three';
import { AIRPORTS, frame, toWorld, noseHeading, runwayEnds } from './airportData.js';
import { Batch, boxUV, flatQuad, ribbon, cyl } from '../render/geom.js';
import { asphaltTexture, concreteTexture, grassTexture, makeCanvas, toTexture } from '../render/textures.js';
import { LightSet, makeLightUniforms, LC_WHITE, LC_YELLOW, LC_GREEN, LC_RED, LC_BLUE, LC_SODIUM, LC_AMBER } from '../render/lights.js';
import { DEG, mulberry32 } from '../core/math.js';
import { LAYER_WORLD } from '../render/renderer.js';

// ---------- shared textures ----------
function facadeTexture(kind) {
  const c = makeCanvas(256, 256), x = c.getContext('2d');
  const e = makeCanvas(256, 256), y = e.getContext('2d');
  y.fillStyle = '#000'; y.fillRect(0, 0, 256, 256);
  const rnd = mulberry32(kind.length * 31);
  if (kind === 'glass') {
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#7f97ad'); g.addColorStop(0.5, '#4d6478'); g.addColorStop(1, '#2f4152');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 8; i++) { x.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.06})`; x.fillRect(rnd() * 256, 0, 20 + rnd() * 40, 256); }
    x.fillStyle = '#c8ccd0';
    for (let i = 0; i <= 8; i++) x.fillRect(i * 32 - 2, 0, 4, 256);
    x.fillRect(0, 0, 256, 6); x.fillRect(0, 126, 256, 5); x.fillRect(0, 250, 256, 6);
    for (let i = 0; i < 8; i++) for (let k = 0; k < 2; k++) {
      const v = rnd();
      y.fillStyle = v > 0.25 ? `rgba(255,${200 + rnd() * 40 | 0},${140 + rnd() * 60 | 0},${0.55 + rnd() * 0.4})` : 'rgba(0,0,0,0)';
      y.fillRect(i * 32 + 2, k * 125 + 6, 28, 118);
    }
  } else if (kind === 'office') {
    x.fillStyle = '#b9b4aa'; x.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
      x.fillStyle = '#34414f'; x.fillRect(k * 64 + 8, r * 64 + 14, 48, 34);
      x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(k * 64 + 8, r * 64 + 14, 48, 8);
      if (rnd() > 0.35) { y.fillStyle = `rgba(255,${210 + rnd() * 40 | 0},160,0.9)`; y.fillRect(k * 64 + 8, r * 64 + 14, 48, 34); }
    }
  } else if (kind === 'metal') {
    x.fillStyle = '#c3c6c8'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 64; i++) { x.fillStyle = i % 2 ? '#aeb2b5' : '#d0d3d5'; x.fillRect(i * 4, 0, 2, 256); }
  } else if (kind === 'hangardoor') {
    x.fillStyle = '#d6d8da'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 6; i++) { x.fillStyle = '#9ea4a8'; x.fillRect(i * 43, 0, 3, 256); }
    for (let i = 0; i < 128; i++) { x.fillStyle = i % 2 ? '#c5c9cc' : '#dfe1e3'; x.fillRect(0, i * 2, 256, 1); }
    x.fillStyle = '#556'; x.fillRect(0, 0, 256, 18);
    x.fillStyle = '#1d3a5f'; x.font = 'bold 13px sans-serif'; x.fillText('MAINTENANCE', 80, 13);
  } else if (kind === 'firedoor') {
    x.fillStyle = '#e8e6e0'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) {
      x.fillStyle = '#b3201b'; x.fillRect(i * 64 + 6, 70, 52, 186);
      for (let k = 0; k < 8; k++) { x.fillStyle = '#8f1813'; x.fillRect(i * 64 + 6, 80 + k * 22, 52, 2); }
      x.fillStyle = '#9fc7e6'; x.fillRect(i * 64 + 12, 90, 40, 10);
    }
    x.fillStyle = '#b3201b'; x.font = 'bold 26px sans-serif'; x.fillText('FIRE  RESCUE', 36, 50);
    y.fillStyle = 'rgba(255,240,200,0.6)'; y.fillRect(0, 60, 256, 6);
  } else if (kind === 'cargo') {
    x.fillStyle = '#8f99a2'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 64; i++) { x.fillStyle = i % 2 ? '#7f8992' : '#97a1aa'; x.fillRect(i * 4, 0, 2, 256); }
    for (let i = 0; i < 4; i++) { x.fillStyle = '#4b5156'; x.fillRect(i * 64 + 10, 150, 44, 106); x.fillStyle = '#e0b020'; x.fillRect(i * 64 + 10, 146, 44, 4); }
  } else if (kind === 'hospital') {
    x.fillStyle = '#e9e7e2'; x.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 5; r++) for (let k = 0; k < 5; k++) {
      x.fillStyle = '#3b5e74'; x.fillRect(k * 51 + 8, r * 51 + 14, 36, 26);
      if (rnd() > 0.2) { y.fillStyle = 'rgba(220,240,255,0.9)'; y.fillRect(k * 51 + 8, r * 51 + 14, 36, 26); }
    }
  } else if (kind === 'parking') {
    x.fillStyle = '#9a9894'; x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#555'; x.fillRect(0, 90, 256, 6); x.fillRect(0, 186, 256, 6);
    for (let i = 0; i < 8; i++) { x.fillStyle = `rgb(${rnd() * 200 | 0},${rnd() * 200 | 0},${rnd() * 200 | 0})`; x.fillRect(i * 32 + 6, 130, 20, 30); }
  }
  const t = toTexture(c); const te = toTexture(e);
  return { map: t, emissiveMap: te };
}

function glyphAtlas() {
  const chars = '0123456789LRC';
  const W = 64, H = 128;
  const c = makeCanvas(W * chars.length, H), x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height);
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i < chars.length; i++) {
    x.save(); x.translate(i * W + W / 2, H / 2); x.scale(1, 2.0);
    x.font = 'bold 54px Arial, Helvetica, sans-serif';
    x.fillText(chars[i], 0, 2);
    x.restore();
  }
  const t = toTexture(c, { srgb: true, repeat: false, aniso: 8 });
  return { tex: t, chars, cell: 1 / chars.length };
}

function signAtlas(signs) {
  const c = makeCanvas(1024, 1024), x = c.getContext('2d');
  signs.forEach((s, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const X = col * 256, Y = row * 64;
    x.fillStyle = s.kind === 'hold' ? '#c3161c' : s.kind === 'loc' ? '#111' : '#f2c200';
    x.fillRect(X, Y, 256, 64);
    x.fillStyle = s.kind === 'hold' ? '#fff' : s.kind === 'loc' ? '#f2c200' : '#111';
    x.font = 'bold 40px Arial, Helvetica, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(s.text, X + 128, Y + 34);
    if (s.kind === 'loc') { x.strokeStyle = '#f2c200'; x.lineWidth = 4; x.strokeRect(X + 70, Y + 6, 116, 52); }
  });
  const t = toTexture(c, { srgb: true, repeat: false, aniso: 4 });
  return t;
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const lambert = (o) => new THREE.MeshLambertMaterial(o);
  const fac = (k) => facadeTexture(k);
  const glass = fac('glass'), office = fac('office'), metal = fac('metal'), hdoor = fac('hangardoor'), fdoor = fac('firedoor'), cargo = fac('cargo'), hosp = fac('hospital'), park = fac('parking');
  const nightMats = [];
  const nm = (m) => { nightMats.push(m); return m; };
  const poly = (m, f) => { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = f; return m; };
  SHARED = {
    nightMats,
    glyphs: glyphAtlas(),
    mats: {
      runway: poly(lambert({ map: asphaltTexture([66, 67, 70]) }), -2),
      runwayGrass: poly(lambert({ map: grassTexture(), color: 0xc8dcb0 }), -2),
      taxiway: poly(lambert({ map: asphaltTexture([82, 82, 84]) }), -1),
      apron: poly(lambert({ map: concreteTexture() }), -1),
      shoulder: poly(lambert({ map: asphaltTexture([96, 94, 88]) }), -1),
      white: poly(lambert({ color: 0xeeeeea }), -4),
      yellow: poly(lambert({ color: 0xe8b818 }), -4),
      red: poly(lambert({ color: 0xc02020 }), -4),
      glyph: poly(lambert({ map: SHARED_GLYPH(), transparent: true, alphaTest: 0.4, depthWrite: false }), -4),
      glass: nm(lambert({ map: glass.map, emissiveMap: glass.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0 })),
      office: nm(lambert({ map: office.map, emissiveMap: office.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0 })),
      metal: lambert({ map: metal.map }),
      hangarDoor: lambert({ map: hdoor.map }),
      fireDoor: nm(lambert({ map: fdoor.map, emissiveMap: fdoor.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0 })),
      cargo: lambert({ map: cargo.map }),
      hospital: nm(lambert({ map: hosp.map, emissiveMap: hosp.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0 })),
      parking: poly(lambert({ map: park.map }), -1),
      concrete: lambert({ color: 0xbdb8ae }),
      roof: lambert({ color: 0x8a8d90 }),
      darkroof: lambert({ color: 0x55585c }),
      paintWhite: lambert({ color: 0xf2f2ee }),
      paintRed: lambert({ color: 0xc8261e }),
      paintOrange: lambert({ color: 0xff6a10 }),
      steel: lambert({ color: 0x6f7478 }),
      darkSteel: lambert({ color: 0x3c4044 }),
      towerGlass: nm(lambert({ color: 0x3f6b7f, emissive: 0x6fa0b0, emissiveIntensity: 0 })),
      bridge: lambert({ color: 0xa9adb1 }),
      helipad: poly(lambert({ color: 0x3f5f45 }), -3),
      deck: lambert({ color: 0x5a5e62 }),
      rigYellow: lambert({ color: 0xe0b020 }),
      grassDark: lambert({ color: 0x4f6b35 }),
      sign: null,
    },
  };
  return SHARED;
}
let GLYPH_TEX = null;
function SHARED_GLYPH() { if (!GLYPH_TEX) GLYPH_TEX = glyphAtlas().tex; return GLYPH_TEX; }

// ---------- builder ----------
export class AirportScenery {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.groups = [];
    this.lightUniforms = makeLightUniforms();
    this.windsocks = [];
    this.radars = [];
    this.lightSets = [];
    this.nightMats = shared().nightMats;
    for (const ap of AIRPORTS) this.build(ap);
  }

  build(ap) {
    const S = shared();
    const M = Object.assign({}, S.mats);
    const elev = ap.type === 'heliport' || ap.type === 'offshore' ? 0 : ap.elev;
    const group = new THREE.Group();
    group.name = ap.icao;
    group.position.set(ap.x, elev, ap.z);
    this.scene.add(group);
    this.groups.push(group);
    const f = frame(ap);
    const L = (u, v) => [u * f.fx + v * f.rx, u * f.fz + v * f.rz];
    const fhR = ap.fh * DEG;
    const ground = new Batch();
    const marks = new Batch();
    const bld = new Batch();
    const lights = new LightSet(ap.icao + '_lights');
    const signs = [];

    // --- aprons
    for (const a of ap.aprons) {
      const [cx, cz] = L(a.u, a.v);
      ground.add('apron', flatQuad(cx, 0.04, cz, a.w, a.l, fhR, 'world', 25));
    }
    // --- taxiways
    for (const t of ap.taxiways) {
      const pts = t.pts.map((p) => L(p[0], p[1]));
      for (const g of ribbon(pts, t.w + 6, 0.05, 20)) ground.add('shoulder', g);
      for (const g of ribbon(pts, t.w, 0.07, 20)) ground.add('taxiway', g);
      for (const g of ribbon(pts, 0.35, 0.1, 20)) marks.add('yellow', g);
      // edge lights (blue)
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.floor(len / 45));
        const nx = -(bz - az) / len, nz = (bx - ax) / len;
        for (let k = 0; k <= n; k++) {
          const s = k / n, x = ax + (bx - ax) * s, z = az + (bz - az) * s;
          lights.add(x + nx * (t.w / 2 + 2), 0.4, z + nz * (t.w / 2 + 2), LC_BLUE, 0.9);
          lights.add(x - nx * (t.w / 2 + 2), 0.4, z - nz * (t.w / 2 + 2), LC_BLUE, 0.9);
        }
      }
    }
    // --- runways
    for (const rw of ap.runways) this.buildRunway(ap, rw, L, ground, marks, lights, signs);
    // hold-short lines and signs where taxiways meet runways
    for (const t of ap.taxiways) {
      const last = t.pts[t.pts.length - 1];
      const first = t.pts[0];
      for (const end of [first, last]) {
        for (const rw of ap.runways) {
          const [rcx, rcz] = L(rw.u, rw.v);
          const [ex, ez] = L(end[0], end[1]);
          const r = rw.hdg * DEG, dx = Math.sin(r), dz = -Math.cos(r);
          const along = (ex - rcx) * dx + (ez - rcz) * dz;
          const across = (ex - rcx) * Math.cos(r) + (ez - rcz) * Math.sin(r);
          if (Math.abs(along) > rw.len / 2 + 30 || Math.abs(across) > rw.wid / 2 + 15) continue;
          // direction from runway outwards along the taxiway
          const other = end === last ? t.pts[t.pts.length - 2] : t.pts[1];
          const [ox, oz] = L(other[0], other[1]);
          const tl = Math.hypot(ox - ex, oz - ez);
          const tx = (ox - ex) / tl, tz = (oz - ez) / tl;
          const hold = Math.min(tl - 5, rw.wid / 2 + 45);
          const hx = ex + tx * hold, hz = ez + tz * hold;
          const hh = Math.atan2(-tz, tx) + Math.PI / 2;
          const hdg = Math.atan2(tx, -tz);
          for (let k = 0; k < 4; k++) {
            const off = (k - 1.5) * 0.9;
            marks.add('yellow', flatQuad(hx + tx * off, 0.11, hz + tz * off, 0.3, t.w, hdg + Math.PI / 2, 'unit'));
          }
          // runway hold sign (left side when facing runway)
          const sx = hx + tz * (t.w / 2 + 6) * -1, sz = hz - tx * (t.w / 2 + 6) * -1;
          signs.push({ x: sx, z: sz, hdg: hdg + Math.PI, kind: 'hold', text: `${rw.name}-${rw.recip}` });
          lights.add(hx, 0.4, hz, LC_AMBER, 0.6, [tx, 0, tz]);
        }
      }
    }
    // taxiway location signs
    for (const t of ap.taxiways) {
      if (!t.name) continue;
      const [x, z] = L(t.pts[0][0], t.pts[0][1]);
      const [x2, z2] = L(t.pts[1][0], t.pts[1][1]);
      const l = Math.hypot(x2 - x, z2 - z);
      const tx = (x2 - x) / l, tz = (z2 - z) / l;
      signs.push({ x: x + tx * 40 + tz * (t.w / 2 + 6), z: z + tz * 40 - tx * (t.w / 2 + 6), hdg: Math.atan2(tx, -tz) + Math.PI, kind: 'loc', text: t.name });
    }
    // --- gates: lead-in lines, stop bars, stand numbers
    for (const g of ap.gates) {
      const [gx, gz] = L(g.u, g.v);
      const h = noseHeading(ap, g.nose) * DEG;
      const dx = Math.sin(h), dz = -Math.cos(h);
      const back = g.ga ? 25 : 70;
      marks.add('yellow', flatQuad(gx - dx * back / 2 + dx * 8, 0.1, gz - dz * back / 2 + dz * 8, back + 16, 0.3, h, 'unit'));
      marks.add('yellow', flatQuad(gx + dx * (g.ga ? 3 : 10), 0.1, gz + dz * (g.ga ? 3 : 10), 0.5, 5, h, 'unit'));
      if (!g.ga) {
        // safety envelope (red) for jet stands
        marks.add('red', flatQuad(gx + dx * 26 + Math.cos(h) * 12, 0.1, gz + dz * 26 + Math.sin(h) * 12, 18, 0.3, h, 'unit'));
        marks.add('red', flatQuad(gx + dx * 26 - Math.cos(h) * 12, 0.1, gz + dz * 26 - Math.sin(h) * 12, 18, 0.3, h, 'unit'));
      }
      if (g.bridge) this.jetBridge(ap, g, L, bld);
    }
    // --- buildings
    for (const b of ap.buildings) this.building(ap, b, L, bld, lights, group);
    // --- helipads
    for (const hp of ap.helipads) {
      const [x, z] = L(hp.u, hp.v);
      const y = (hp.roof || 0) + 0.12;
      this.helipadMarking(marks, x, y, z, hp.roof ? 9 : 11, fhR);
      for (let k = 0; k < 12; k++) {
        const a = k / 12 * Math.PI * 2, r = hp.roof ? 10 : 12.5;
        lights.add(x + Math.cos(a) * r, y + 0.2, z + Math.sin(a) * r, hp.roof ? LC_GREEN : LC_YELLOW, 0.8);
      }
    }
    // --- apron flood lights
    for (const a of ap.aprons) {
      const corners = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, -0.5], [0, 0.5]];
      for (const [cu, cv] of corners) {
        if (a.w < 300 && Math.abs(cu) < 0.1) continue;
        const [x, z] = L(a.u + cu * (a.w + 20), a.v + cv * (a.l + 20));
        bld.addAt('steel', cyl(0.25, 0.4, 24, 6), x, 0, z);
        bld.addAt('darkSteel', new THREE.BoxGeometry(3, 0.6, 1.2), x, 24, z);
        lights.add(x, 23.6, z, LC_SODIUM, 3.2);
      }
    }
    // --- windsocks near each runway end
    for (const rw of ap.runways) {
      const e = runwayEnds(ap, rw);
      for (const [end, sgn] of [[e.a, 1], [e.b, -1]]) {
        const ex = end.x - ap.x, ez = end.z - ap.z;
        const r = rw.hdg * DEG, dx = Math.sin(r) * sgn, dz = -Math.cos(r) * sgn;
        const lx = ex + dx * 250 - Math.cos(r) * sgn * (rw.wid / 2 + 70), lz = ez + dz * 250 - Math.sin(r) * sgn * (rw.wid / 2 + 70);
        this.windsock(group, lx, lz, lights);
        break;   // one per runway is enough
      }
    }

    // --- signs mesh
    if (signs.length) {
      const tex = signAtlas(signs);
      const sm = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0 });
      this.nightMats.push(sm);
      const sb = new Batch();
      signs.forEach((s, i) => {
        const col = i % 4, row = Math.floor(i / 4);
        const box = new THREE.BoxGeometry(2.6, 0.75, 0.25);
        const uv = box.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, (col + uv.getX(k)) / 4, 1 - (row + 1 - uv.getY(k)) / 16);
        sb.addAt('sign', box, s.x, 0.85, s.z, -s.hdg);
        sb.addAt('legs', new THREE.BoxGeometry(2.2, 0.5, 0.1), s.x, 0.25, s.z, -s.hdg);
      });
      sb.build({ sign: sm, legs: M.darkSteel }, group, { layer: LAYER_WORLD });
    }
    ground.build(M, group, { receiveShadow: true, layer: LAYER_WORLD });
    marks.build(M, group, { receiveShadow: true, layer: LAYER_WORLD });
    bld.build(M, group, { receiveShadow: true, castShadow: true, layer: LAYER_WORLD, noShadow: ['glyph'] });
    const pts = lights.build(this.lightUniforms);
    pts.layers.set(LAYER_WORLD);
    group.add(pts);
    this.lightSets.push(pts);
    group.updateMatrixWorld(true);
  }

  buildRunway(ap, rw, L, ground, marks, lights, signs) {
    const S = shared();
    const [cx, cz] = L(rw.u, rw.v);
    const h = rw.hdg * DEG;
    const dx = Math.sin(h), dz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const W = rw.wid, Ln = rw.len;
    const grass = rw.surface === 'grass';
    ground.add(grass ? 'runwayGrass' : 'shoulder', flatQuad(cx, 0.06, cz, Ln + 60, W + (grass ? 0 : 14), h, 'world', 30));
    ground.add(grass ? 'runwayGrass' : 'runway', flatQuad(cx, 0.08, cz, Ln, W, h, 'world', 30));
    if (grass) {
      // white edge boards
      for (let s = -Ln / 2; s <= Ln / 2; s += 60) {
        for (const side of [-1, 1]) marks.add('white', flatQuad(cx + dx * s + rx * side * (W / 2 + 1), 0.12, cz + dz * s + rz * side * (W / 2 + 1), 3, 1, h, 'unit'));
      }
      return;
    }
    const P = (along, across) => [cx + dx * along + rx * across, cz + dz * along + rz * across];
    const stripe = (along, across, len, wid, key = 'white') => {
      const [x, z] = P(along, across);
      marks.add(key, flatQuad(x, 0.11, z, len, wid, h, 'unit'));
    };
    // edges
    stripe(0, W / 2 - 0.9, Ln, 0.9); stripe(0, -W / 2 + 0.9, Ln, 0.9);
    // for both ends: thresholds, numbers, TDZ, aiming points
    const ends = [{ sgn: 1, name: rw.name }, { sgn: -1, name: rw.recip }];
    for (const e of ends) {
      const sg = e.sgn;   // +1: threshold at along=-Ln/2 (landing towards +d)
      const A = (s) => sg * (-Ln / 2 + s);     // along coordinate measured from this threshold
      const nStr = W >= 60 ? 16 : W >= 45 ? 12 : W >= 30 ? 8 : 6;
      const sw = 1.8, gap = (W - 6 - nStr * sw) / (nStr + 1);
      for (let i = 0; i < nStr; i++) {
        let across = -W / 2 + 3 + gap + i * (sw + gap) + sw / 2;
        if (i >= nStr / 2) across += gap * 0.6; else across -= gap * 0.6;
        stripe(A(6 + 15), across * sg, 30, sw);
      }
      // threshold bar
      stripe(A(1.5), 0, 1.8, W - 2);
      // designation: letter (if any) then digits
      const num = e.name.replace(/[LRC]/, '');
      const letter = e.name.replace(/[0-9]/g, '');
      const digits = num.padStart(2, '0');
      const gw = Math.min(6.5, W / 7), gl = 18;
      let s0 = 48;
      if (letter) { this.glyph(marks, P, h, sg, A(s0 + gl / 2), 0, gw, gl, letter); s0 += gl + 6; }
      this.glyph(marks, P, h, sg, A(s0 + gl / 2), -gw * 0.62, gw, gl, digits[0]);
      this.glyph(marks, P, h, sg, A(s0 + gl / 2), gw * 0.62, gw, gl, digits[1]);
      const cStart = s0 + gl + 12;
      // aiming point
      if (Ln >= 1500) { stripe(A(400), W * 0.22 * sg, 50, W >= 45 ? 8 : 5); stripe(A(400), -W * 0.22 * sg, 50, W >= 45 ? 8 : 5); }
      // touchdown zone
      if (Ln >= 1800) {
        const pairs = [[150, 3], [300, 2], [550, 2], [700, 1], [850, 1]];
        for (const [s, k] of pairs) for (let q = 0; q < k; q++) {
          const off = W * 0.32 - q * 3.2;
          stripe(A(s), off, 22.5, 1.8); stripe(A(s), -off, 22.5, 1.8);
        }
      }
      // centreline from this end to midpoint
      for (let s = cStart; s < Ln / 2; s += 50) stripe(A(s + 15), 0, 30, W >= 45 ? 0.9 : 0.45);

      // ---- lighting for this end ----
      const thrAlong = sg * -Ln / 2;
      const towardApproach = [-dx * sg, 0, -dz * sg];
      const towardRunway = [dx * sg, 0, dz * sg];
      // threshold (green, facing approach) + end lights (red, facing runway)
      for (let a = -W / 2; a <= W / 2 + 0.1; a += 3) {
        const [x, z] = P(thrAlong - sg * 1, a);
        lights.add(x, 0.4, z, LC_GREEN, 1.4, towardApproach);
        lights.add(x, 0.4, z, LC_RED, 1.1, towardRunway);
      }
      // PAPI on the left side (as seen by landing aircraft), 300 m in
      const papiAngles = [3.5, 3.17, 2.83, 2.5];
      for (let i = 0; i < 4; i++) {
        const [x, z] = P(A(300), (-W / 2 - 15 - i * 9) * sg);
        lights.add(x, 0.8, z, LC_WHITE, 2.4, towardApproach, 0, papiAngles[i] * DEG);
      }
      // approach lighting system
      if (rw.als) {
        for (let d = 30; d <= 900; d += 30) {
          const along = thrAlong - sg * d;
          for (let q = -2; q <= 2; q++) {
            const [x, z] = P(along, q * 1.1);
            lights.add(x, 0.6 + d * 0.004, z, LC_WHITE, 1.5, towardApproach);
          }
          if (d === 300 || d === 150) {
            for (let q = -8; q <= 8; q++) { if (Math.abs(q) < 3) continue; const [x, z] = P(along, q * 1.6); lights.add(x, 0.8, z, LC_WHITE, 1.4, towardApproach); }
          }
          if (d >= 330) {
            const [x, z] = P(along, 0);
            lights.add(x, 1.4 + d * 0.004, z, [1, 1, 1], 4.0, towardApproach, (900 - d) / 900 * 0.6 + 0.01);
          }
        }
      }
    }
    // edge lights (directional, caution yellow in last 600 m)
    const n = Math.floor(Ln / 60);
    for (let i = 0; i <= n; i++) {
      const s = -Ln / 2 + i * Ln / n;
      for (const side of [-1, 1]) {
        const [x, z] = P(s, side * (W / 2 + 1.5));
        const fromA = s + Ln / 2, fromB = Ln / 2 - s;
        lights.add(x, 0.45, z, fromB < 600 ? LC_YELLOW : LC_WHITE, 1.25, [dx, 0, dz]);
        lights.add(x, 0.45, z, fromA < 600 ? LC_YELLOW : LC_WHITE, 1.25, [-dx, 0, -dz]);
      }
    }
    // centreline lights for ILS runways
    if (rw.ils) {
      for (let s = -Ln / 2 + 15; s < Ln / 2; s += 30) {
        const [x, z] = P(s, 0);
        const fromA = s + Ln / 2, fromB = Ln / 2 - s;
        const colB = fromB < 300 ? LC_RED : fromB < 900 ? ((Math.round(s / 30) & 1) ? LC_RED : LC_WHITE) : LC_WHITE;
        const colA = fromA < 300 ? LC_RED : fromA < 900 ? ((Math.round(s / 30) & 1) ? LC_RED : LC_WHITE) : LC_WHITE;
        lights.add(x, 0.14, z, colB, 0.9, [dx, 0, dz]);
        lights.add(x, 0.14, z, colA, 0.9, [-dx, 0, -dz]);
      }
    }
  }

  glyph(marks, P, h, sg, along, across, w, l, ch) {
    const G = shared().glyphs;
    const i = G.chars.indexOf(ch);
    if (i < 0) return;
    const [x, z] = P(along, across * sg);
    const u0 = i * G.cell, u1 = u0 + G.cell;
    // glyph up = landing direction; flatQuad uv order: back-left, back-right, front-right, front-left
    const hh = sg > 0 ? h : h + Math.PI;
    marks.add('glyph', flatQuad(x, 0.12, z, l, w, hh, 'custom', 1, [u0, 0, u1, 0, u1, 1, u0, 1]));
  }

  helipadMarking(marks, x, y, z, r, rot) {
    const ring = new THREE.RingGeometry(r - 0.6, r, 40).rotateX(-Math.PI / 2).translate(x, y + 0.01, z);
    marks.add('yellow', ring);
    const pad = new THREE.CircleGeometry(r + 2.5, 40).rotateX(-Math.PI / 2).translate(x, y - 0.005, z);
    marks.add('helipad', pad);
    const c = Math.cos(rot), s = Math.sin(rot);
    const H = (a, b, l, w) => marks.add('white', flatQuad(x + a * c - b * s, y + 0.02, z + a * s + b * c, l, w, rot, 'unit'));
    H(0, -2.2, 7, 1); H(0, 2.2, 7, 1); H(0, 0, 1, 4.4);
  }

  jetBridge(ap, g, L, bld) {
    const [gx, gz] = L(g.u, g.v);
    const h = noseHeading(ap, g.nose) * DEG;
    const dx = Math.sin(h), dz = -Math.cos(h);
    // terminal facade lies ahead of the nose; aircraft door is ~ 7 m behind the nose on its left
    const facadeDist = Math.abs(g.v) - 33;           // KPXR terminal half-depth 32
    const fx = gx + dx * facadeDist, fz = gz + dz * facadeDist;
    const lx = Math.cos(h), lz = Math.sin(h);        // right vector of parked aircraft
    const doorX = gx - dx * 6 - lx * 6, doorZ = gz - dz * 6 - lz * 6;
    const rotX = fx - lx * 14, rotZ = fz - lz * 14;  // rotunda near facade, left of nose
    bld.addAt('concrete', cyl(2.2, 2.2, 4.6, 12), rotX, 0, rotZ);
    bld.addAt('bridge', cyl(2.6, 2.6, 3.2, 12), rotX, 4.4, rotZ);
    const tx = doorX - rotX, tz = doorZ - rotZ, len = Math.hypot(tx, tz);
    const yaw = Math.atan2(tx, tz);
    const tube = boxUV(len, 2.9, 2.6, 4, 4).rotateZ(0).translate(0, 0, 0);
    const m = new THREE.Matrix4().makeRotationY(yaw - Math.PI / 2);
    m.setPosition(rotX + tx / 2, 4.5, rotZ + tz / 2);
    bld.add('bridge', tube, m);
    bld.addAt('darkSteel', new THREE.BoxGeometry(0.5, 4.5, 0.5), rotX + tx * 0.7, 0, rotZ + tz * 0.7);
    bld.addAt('darkSteel', new THREE.BoxGeometry(2.2, 0.8, 1.2), rotX + tx * 0.7, 0.4, rotZ + tz * 0.7);
    bld.addAt('steel', new THREE.BoxGeometry(3.2, 3.2, 3.2).translate(0, 1.6, 0), doorX - tx / len * 1.2, 3.0, doorZ - tz / len * 1.2, yaw);
  }

  windsock(group, x, z, lights) {
    const pole = new THREE.Mesh(cyl(0.08, 0.12, 7, 6), shared().mats.steel);
    pole.position.set(x, 0, z);
    group.add(pole);
    const sock = new THREE.Group();
    sock.position.set(x, 6.7, z);
    const segs = [];
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.42 - i * 0.05, 0.37 - i * 0.05, 0.8, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.4 + i * 0.8), i % 2 ? shared().mats.paintWhite : shared().mats.paintOrange);
      sock.add(seg); segs.push(seg);
    }
    sock.children.forEach((c) => { c.material.side = THREE.DoubleSide; });
    group.add(sock);
    lights.add(x, 7.3, z, LC_RED, 0.8);
    this.windsocks.push({ obj: sock, segs });
  }

  building(ap, b, L, bld, lights, group) {
    const [x, z] = L(b.u, b.v);
    const fh = ap.fh * DEG;
    const yawW = -fh + Math.PI / 2;     // building local X (w) aligned with frame u
    const front = b.front || 'L';
    const M4 = (geo, key, ox = 0, oy = 0, oz = 0, extraYaw = 0) => {
      const m = new THREE.Matrix4().makeRotationY(yawW + extraYaw);
      const p = new THREE.Vector3(ox, oy, oz).applyMatrix4(new THREE.Matrix4().makeRotationY(yawW));
      m.setPosition(x + p.x, oy, z + p.z);
      bld.add(key, geo, m);
    };
    // local coordinates: X along w (frame u), Z along d (frame v; +Z = right side 'R')
    switch (b.type) {
      case 'terminal': {
        M4(boxUV(b.w, b.h, b.d, 8, b.h / 2), 'glass');
        M4(boxUV(b.w + 12, 1.4, b.d + 14, 10, 1.4), 'roof', 0, b.h, 0);
        for (let i = 0; i < 10; i++) M4(boxUV(6, 2.5, 4, 3, 2.5), 'steel', -b.w / 2 + 40 + i * (b.w - 80) / 9, b.h + 1.4, (i % 2 ? 8 : -8));
        M4(boxUV(b.w * 0.25, 8, b.d * 0.5, 6, 4), 'office', b.w * 0.2, b.h + 1.4, 0);
        for (let i = -1; i <= 1; i += 2) for (let k = 0; k < Math.floor(b.w / 60); k++) {
          const lx = -b.w / 2 + 30 + k * 60;
          const p = new THREE.Vector3(lx, 0, i * (b.d / 2 + 1)).applyMatrix4(new THREE.Matrix4().makeRotationY(yawW));
          lights.add(x + p.x, b.h - 1, z + p.z, LC_SODIUM, 1.6);
        }
        break;
      }
      case 'tower': {
        const hgt = b.h;
        bld.addAt('concrete', cyl(2.6, 3.8, hgt - 7, 14), x, 0, z);
        bld.addAt('concrete', cyl(6.0, 4.0, 2.0, 16), x, hgt - 7, z);
        bld.addAt('towerGlass', cyl(6.2, 5.6, 4.2, 8), x, hgt - 5, z);
        bld.addAt('darkroof', cyl(5.2, 6.8, 0.9, 8), x, hgt - 0.8, z);
        bld.addAt('steel', cyl(0.12, 0.12, 6, 4), x + 1.5, hgt, z);
        bld.addAt('concrete', boxUV(14, 6, 10, 4, 3), x + 9, 0, z, -fh);
        lights.add(x + 1.5, hgt + 6.2, z, LC_RED, 1.8, null, -0.9);
        lights.add(x, hgt + 0.4, z, [0.4, 1, 0.6], 3.0, null, -0.6);
        break;
      }
      case 'firestation': {
        const fz = front === 'R' ? 1 : -1;
        M4(boxUV(b.w, b.h, b.d, b.w / 4, b.h), 'fireDoor', 0, 0, 0, fz > 0 ? 0 : Math.PI);
        M4(boxUV(b.w + 2, 0.8, b.d + 2, 6, 1), 'darkroof', 0, b.h, 0);
        M4(boxUV(5, b.h + 9, 5, 2, 4), 'paintRed', b.w / 2 - 4, 0, 0);
        M4(new THREE.BoxGeometry(b.w, 0.1, 30).translate(0, 0.05, fz * (b.d / 2 + 15)), 'concrete');
        const p = new THREE.Vector3(0, 0, fz * (b.d / 2 + 0.6)).applyMatrix4(new THREE.Matrix4().makeRotationY(yawW));
        lights.add(x + p.x, b.h - 1.5, z + p.z, LC_SODIUM, 2.0);
        break;
      }
      case 'hangar': {
        const fz = front === 'R' ? 1 : -1;
        M4(boxUV(b.w, b.h * 0.62, b.d, 6, 4), 'metal');
        const arch = new THREE.CylinderGeometry(b.w / 2, b.w / 2, b.d, 20, 1, false, -Math.PI / 2, Math.PI);
        arch.rotateX(Math.PI / 2);
        arch.scale(1, (b.h * 0.38) / (b.w / 2), 1);
        M4(arch, 'roof', 0, b.h * 0.62, 0);
        M4(boxUV(b.w * 0.92, b.h * 0.6, 0.6, b.w * 0.92, b.h * 0.6), 'hangarDoor', 0, 0, fz * (b.d / 2 + 0.31));
        break;
      }
      case 'cargo': {
        M4(boxUV(b.w, b.h, b.d, 16, b.h), 'cargo');
        M4(boxUV(b.w + 3, 0.8, b.d + 3, 10, 1), 'roof', 0, b.h, 0);
        break;
      }
      case 'office': case 'police': {
        M4(boxUV(b.w, b.h, b.d, 16, 12.8), 'office');
        M4(boxUV(b.w + 1, 0.8, b.d + 1, 10, 1), 'darkroof', 0, b.h, 0);
        if (b.type === 'police') M4(boxUV(b.w + 0.2, 1.0, b.d + 0.2, 4, 1), 'paintWhite', 0, b.h * 0.55, 0);
        if (b.h > 30) lights.add(x, b.h + 1.5, z, LC_RED, 1.4, null, -0.8);
        break;
      }
      case 'garage': {
        for (let lv = 0; lv < 4; lv++) {
          M4(boxUV(b.w, 0.6, b.d, 25, 25), 'concrete', 0, lv * 4, 0);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) M4(boxUV(1, 4, 1, 1, 1), 'concrete', sx * (b.w / 2 - 1), lv * 4, sz * (b.d / 2 - 1));
          M4(boxUV(b.w, 1.1, 0.3, 8, 1.1), 'concrete', 0, lv * 4 + 0.6, b.d / 2);
          M4(boxUV(b.w, 1.1, 0.3, 8, 1.1), 'concrete', 0, lv * 4 + 0.6, -b.d / 2);
        }
        M4(boxUV(b.w, 0.6, b.d, 25, 25), 'parking', 0, 16, 0);
        break;
      }
      case 'carpark': {
        M4(new THREE.PlaneGeometry(b.w, b.d).rotateX(-Math.PI / 2).translate(0, 0.06, 0), 'parking');
        break;
      }
      case 'fuelfarm': {
        const n = b.small ? 2 : 4, r = b.small ? 3 : 9;
        for (let i = 0; i < n; i++) {
          const ox = (i % 2) * r * 2.6 - r * 1.3, oz = Math.floor(i / 2) * r * 2.6 - (n > 2 ? r * 1.3 : 0);
          M4(cyl(r, r, r * 1.1, 18), 'paintWhite', ox, 0, oz);
          M4(new THREE.SphereGeometry(r, 18, 6, 0, Math.PI * 2, 0, Math.PI / 6).translate(0, -r * Math.cos(Math.PI / 6), 0), 'paintWhite', ox, r * 1.1 + r * Math.cos(Math.PI / 6) - 0.2, oz);
        }
        break;
      }
      case 'radar': {
        bld.addAt('steel', cyl(1.2, 2.0, 18, 8), x, 0, z);
        const ant = new THREE.Group();
        const dish = new THREE.Mesh(new THREE.BoxGeometry(9, 2.4, 0.4), shared().mats.paintWhite);
        dish.rotation.x = -0.25;
        ant.add(dish);
        ant.position.set(x, 19.5, z);
        group.add(ant);
        this.radars.push(ant);
        lights.add(x, 21.5, z, LC_RED, 1.4, null, -0.7);
        break;
      }
      case 'hospital': {
        M4(boxUV(b.w, b.h, b.d, 15, 15), 'hospital');
        M4(boxUV(b.w + 1, 0.6, b.d + 1, 10, 1), 'roof', 0, b.h, 0);
        M4(boxUV(b.w * 1.6, 14, b.d * 1.2, 15, 15), 'hospital', b.w * 0.7, 0, b.d * 0.9);
        // red crosses on facade
        M4(boxUV(8, 2.4, 0.3, 8, 2.4), 'paintRed', 0, b.h - 6, -b.d / 2 - 0.2);
        M4(boxUV(2.4, 8, 0.3, 2.4, 8), 'paintRed', 0, b.h - 9, -b.d / 2 - 0.2);
        // safety railing
        for (const sz of [-1, 1]) M4(boxUV(b.w, 1.1, 0.1, b.w, 1.1), 'steel', 0, b.h + 0.6, sz * b.d / 2);
        lights.add(x - b.w / 2, b.h + 1.5, z - b.d / 2, LC_RED, 1.4, null, -0.8);
        lights.add(x + b.w / 2, b.h + 1.5, z + b.d / 2, LC_RED, 1.4, null, -0.8);
        break;
      }
      case 'platform': {
        const top = 32;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          M4(cyl(1.8, 2.4, top + 20, 10), 'rigYellow', sx * 22, -20, sz * 16);
          for (let k = 0; k < 3; k++) M4(boxUV(44, 0.8, 0.8, 4, 1), 'rigYellow', 0, -5 + k * 12, sz * 16);
        }
        M4(boxUV(70, 5, 50, 10, 5), 'deck', 0, top - 5, 0);
        M4(boxUV(34, 9, 24, 8, 3), 'office', 12, top, -8);
        M4(boxUV(14, 5, 14, 7, 5), 'paintWhite', -18, top, 14);
        // helideck on a raised frame
        M4(cyl(0.6, 0.6, 6, 6), 'steel', -20, top, 8);
        M4(new THREE.CylinderGeometry(13, 13, 0.6, 8).translate(0, 0.3, 0), 'deck', -20, top + 5.4, 8);
        // derrick
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) M4(boxUV(0.6, 38, 0.6, 1, 4), 'steel', 22 + sx * 4, top, -14 + sz * 4, 0);
        M4(boxUV(9, 0.6, 9, 2, 2), 'steel', 22, top + 38, -14);
        // crane and flare boom
        M4(boxUV(2, 14, 2, 1, 3), 'rigYellow', 30, top, 18);
        M4(boxUV(30, 1.2, 1.2, 4, 1), 'rigYellow', 44, top + 14, 18, -0.3);
        M4(boxUV(42, 1.0, 1.0, 4, 1), 'steel', -50, top + 6, -10, 0.25);
        lights.add(-72, top + 16, -16, [1, 0.55, 0.15], 18, null, 0);
        lights.add(22, top + 39, -14, LC_RED, 2.0, null, -0.8);
        break;
      }
    }
  }

  update(dt, camera, env, weather, renderer) {
    const u = this.lightUniforms;
    u.uTime.value += dt;
    const fovScale = renderer.height / (2 * Math.tan(camera.fov * DEG / 2));
    u.uScale.value = fovScale * 0.55 * renderer.r.getPixelRatio();
    const night = env.lightsOn ? 1 : 0;
    u.uOn.value = night ? 1 : 0.0;
    u.uDay.value = env.daylight * (1 - (env.weather.visibility < 4000 ? 0.7 : 0));
    const ne = Math.max(0, 1 - Math.max(0, env.sunElevation + 2) / 8);
    for (const m of this.nightMats) m.emissiveIntensity = ne * 0.9;
    // windsocks follow the surface wind
    if (weather) {
      const w = weather.surfaceWind;
      const spd = Math.hypot(w.x, w.z);
      const yaw = Math.atan2(w.x, w.z);
      const droop = Math.max(0, 1 - spd / 7.7) * 1.2;   // fully extended at 15 kt
      for (const s of this.windsocks) {
        s.obj.rotation.set(0, yaw, 0);
        s.obj.rotateX(droop + Math.sin(u.uTime.value * 3 + s.obj.position.x) * 0.05 * Math.min(1, spd / 4));
      }
    }
    for (const r of this.radars) r.rotation.y += dt * 2.6;
  }
}
