// Modern glass flight deck details: full-width glareshield hood with the flight control panel and
// EFIS control panels, a centre pedestal (thrust levers, flap and speed-brake gates, twin CDUs, radio
// panels), a backlit overhead panel, side consoles and crew seats.
//
// Performance: fine detail (hundreds of buttons, keys, labels and gates) is painted once into
// canvas textures - a colour map plus a matching glow (emissive) map - so the whole deck costs only
// a few dozen draw calls. Night lighting is done by raising the emissive intensity of those glow
// maps; no real lights are added to the scene.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Display } from './displays.js';
import { clamp, DEG } from '../core/math.js';

// ------------------------------------------------------------------ canvas painting helpers
function pair(w, h, draw) {
  const a = document.createElement('canvas'); a.width = w; a.height = h;
  const b = document.createElement('canvas'); b.width = w; b.height = h;
  const cb = a.getContext('2d'), cg = b.getContext('2d');
  cg.fillStyle = '#000'; cg.fillRect(0, 0, w, h);
  draw(cb, cg, w, h);
  const map = new THREE.CanvasTexture(a); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const glow = new THREE.CanvasTexture(b); glow.colorSpace = THREE.SRGBColorSpace; glow.anisotropy = 8;
  return { map, glow };
}

// deterministic pseudo-random so the panels look the same every flight
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function grain(x, w, h, base, n = 2500, seed = 7) {
  x.fillStyle = base; x.fillRect(0, 0, w, h);
  const r = rng(seed);
  for (let i = 0; i < n; i++) { x.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)'; x.fillRect(r() * w, r() * h, 2, 2); }
}

function screw(x, cx, cy, r = 4) {
  x.fillStyle = '#5c646e'; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#2a2f35'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(cx - r * 0.7, cy); x.lineTo(cx + r * 0.7, cy); x.stroke();
}

function knobDraw(x, cx, cy, r) {
  const g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#5a6068'); g.addColorStop(1, '#15181b');
  x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#0a0b0c'; x.lineWidth = 2; x.stroke();
  x.strokeStyle = '#c9ced4'; x.lineWidth = 2; x.beginPath(); x.moveTo(cx, cy - r * 0.2); x.lineTo(cx, cy - r * 0.85); x.stroke();
}

// push button with backlit legend; lit === 'on' | 'fault' | null shows a dim annunciator bar
function pushButton(b, g, x0, y0, s, label, lit) {
  b.fillStyle = '#16191d'; b.fillRect(x0, y0, s, s);
  b.strokeStyle = '#07080a'; b.lineWidth = 2; b.strokeRect(x0 + 1, y0 + 1, s - 2, s - 2);
  b.fillStyle = '#23282e'; b.fillRect(x0 + 4, y0 + 4, s - 8, s - 8);
  const words = label.split(' ');
  const fs = Math.max(9, Math.floor(s * 0.2));
  for (const ctx of [b, g]) {
    ctx.font = `bold ${fs}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = ctx === b ? '#8f99a4' : '#cfe6ff';
    words.slice(0, 2).forEach((w2, i) => ctx.fillText(w2, x0 + s / 2, y0 + s * (words.length > 1 ? 0.3 + i * 0.22 : 0.38)));
  }
  if (lit) {
    const col = lit === 'fault' ? '#ffb020' : lit === 'on' ? '#5aff7a' : '#ffffff';
    g.fillStyle = col; g.globalAlpha = 0.55; g.fillRect(x0 + s * 0.2, y0 + s * 0.72, s * 0.6, s * 0.12); g.globalAlpha = 1;
    b.fillStyle = '#2d3238'; b.fillRect(x0 + s * 0.2, y0 + s * 0.72, s * 0.6, s * 0.12);
  }
}

// ------------------------------------------------------------------ overhead panel texture
const OVH_MODULES = [
  ['ELECTRICAL', ['BATT 1', 'BATT 2', 'GEN 1', 'GEN 2', 'APU GEN', 'EXT PWR']],
  ['HYDRAULIC', ['SYS 1', 'SYS 2', 'SYS 3', 'PTU']],
  ['FUEL', ['L PUMP', 'R PUMP', 'X FEED', 'CTR PUMP']],
  ['AIR COND', ['PACK 1', 'PACK 2', 'BLEED 1', 'BLEED 2', 'APU BLEED', 'RECIRC']],
  ['ANTI ICE', ['WING', 'ENG 1', 'ENG 2', 'WSHLD', 'PROBES']],
  ['ENGINE', ['START 1', 'START 2', 'IGN A', 'IGN B', 'AUTO RELIT']],
  ['FIRE PROT', ['ENG 1', 'APU', 'ENG 2', 'TEST', 'CARGO']],
  ['EXT LIGHTS', ['NAV', 'BEACON', 'STROBE', 'LOGO', 'WING', 'TAXI']],
  ['PRESSURIZ', ['MODE', 'DUMP', 'LDG ELEV', 'MAN']],
  ['OXYGEN', ['CREW', 'PAX', 'TMR RESET']],
  ['WIPERS', ['LEFT', 'RIGHT', 'RAIN RPL']],
  ['SIGNS', ['SEAT BELT', 'NO SMOKE', 'EMER LT', 'CALLS']],
];

function overheadTexture(seed) {
  return pair(1024, 1024, (b, g, W, H) => {
    grain(b, W, H, '#363e48', 4000, seed);
    const r = rng(seed + 3);
    const cols = 4, rows = 3, pad = 14;
    const cw = (W - pad * (cols + 1)) / cols, ch = (H - 60 - pad * (rows + 1)) / rows;
    OVH_MODULES.forEach(([title, btns], k) => {
      const cx = pad + (k % cols) * (cw + pad), cy = 50 + pad + Math.floor(k / cols) * (ch + pad);
      b.fillStyle = '#2e353e'; b.fillRect(cx, cy, cw, ch);
      b.strokeStyle = '#1b2026'; b.lineWidth = 3; b.strokeRect(cx, cy, cw, ch);
      // white module outline + title (backlit)
      for (const ctx of [b, g]) {
        ctx.strokeStyle = ctx === b ? '#7d8792' : 'rgba(170,205,255,0.55)'; ctx.lineWidth = 2;
        ctx.strokeRect(cx + 8, cy + 26, cw - 16, ch - 34);
        ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = ctx === b ? '#aeb8c3' : '#d8ecff';
        ctx.fillText(title, cx + cw / 2, cy + 14);
      }
      const n = btns.length, per = n > 4 ? 3 : 2;
      const s = Math.min(70, (cw - 40) / per - 14);
      btns.forEach((lbl, i) => {
        const col = i % per, row = Math.floor(i / per);
        const bx = cx + 20 + col * ((cw - 40) / per) + ((cw - 40) / per - s) / 2;
        const by = cy + 40 + row * (s + 18);
        if (by + s > cy + ch - 6) return;
        const roll = r();
        pushButton(b, g, bx, by, s, lbl, roll < 0.12 ? 'fault' : roll < 0.45 ? 'on' : null);
      });
      // a rotary selector in some modules
      if (k % 3 === 1) knobDraw(b, cx + cw - 34, cy + ch - 34, 16);
      screw(b, cx + 6, cy + 6); screw(b, cx + cw - 6, cy + 6); screw(b, cx + 6, cy + ch - 6); screw(b, cx + cw - 6, cy + ch - 6);
    });
    for (const ctx of [b, g]) {
      ctx.font = 'bold 24px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = ctx === b ? '#9aa4ae' : '#bcd8ff';
      ctx.fillText('OVERHEAD PANEL', W / 2, 26);
    }
  });
}

// ------------------------------------------------------------------ pedestal top texture
// canvas y: 0 = forward end, H = aft end. Returns the CDU screen rectangles (in canvas px).
function pedestalTexture(levers) {
  const out = { cdu: [] };
  out.tex = pair(512, 1280, (b, g, W, H) => {
    grain(b, W, H, '#2b3139', 3000, 11);
    const lab = (ctx, t, x, y, size = 18, col) => { ctx.font = `bold ${size}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col; ctx.fillText(t, x, y); };
    const both = (t, x, y, size, cb = '#9aa4ae', cg = '#d6eaff') => { lab(b, t, x, y, size, cb); lab(g, t, x, y, size, cg); };
    // --- thrust quadrant (0..430)
    b.fillStyle = '#20252b'; b.fillRect(20, 20, W - 40, 400);
    const slots = levers;
    for (let i = 0; i < slots; i++) {
      const x = W / 2 - 60 + (120 / Math.max(1, slots - 1)) * i - (slots === 1 ? -60 : 0);
      b.fillStyle = '#07080a'; b.fillRect(x - 7, 60, 14, 320);
    }
    ['TO/GA', 'FLX MCT', 'CL', 'IDLE', 'REV'].forEach((t, i) => both(t, W / 2 + 120, 80 + i * 70, 16));
    // speed brake gate (left) and flap gate (right)
    b.fillStyle = '#07080a'; b.fillRect(56, 70, 12, 300); b.fillRect(W - 68, 70, 12, 300);
    ['RET', '1/2', 'FULL'].forEach((t, i) => both(t, 100, 90 + i * 130, 15));
    ['0', '1', '2', '3', 'FULL'].forEach((t, i) => both(t, W - 110, 90 + i * 68, 15));
    both('SPD BRK', 62, 400, 14); both('FLAPS', W - 62, 400, 14);
    // --- twin CDUs (450..900)
    for (let k = 0; k < 2; k++) {
      const x0 = 18 + k * (W / 2), w = W / 2 - 36, y0 = 450, h = 450;
      b.fillStyle = '#1b1f24'; b.fillRect(x0, y0, w, h);
      b.strokeStyle = '#0a0c0e'; b.lineWidth = 3; b.strokeRect(x0, y0, w, h);
      const sx = x0 + 34, sw = w - 68, sy = y0 + 14, sh = 170;
      b.fillStyle = '#020304'; b.fillRect(sx, sy, sw, sh);
      out.cdu.push({ x: sx, y: sy, w: sw, h: sh });
      // line select keys
      for (let i = 0; i < 6; i++) {
        for (const lx of [x0 + 8, x0 + w - 26]) { b.fillStyle = '#3a4048'; b.fillRect(lx, sy + 12 + i * 26, 18, 14); }
      }
      // function keys
      const fk = ['INIT', 'RTE', 'DEP', 'LEGS', 'HOLD', 'PROG', 'MENU', 'EXEC'];
      fk.forEach((t, i) => {
        const kx = x0 + 12 + (i % 4) * ((w - 24) / 4), ky = y0 + 196 + Math.floor(i / 4) * 34;
        b.fillStyle = '#2c3239'; b.fillRect(kx, ky, (w - 24) / 4 - 6, 26);
        lab(b, t, kx + ((w - 24) / 4 - 6) / 2, ky + 13, 13, '#c8d0d8'); lab(g, t, kx + ((w - 24) / 4 - 6) / 2, ky + 13, 13, '#e0f0ff');
        if (t === 'EXEC') { g.fillStyle = 'rgba(80,255,120,0.6)'; g.fillRect(kx + 6, ky + 2, (w - 24) / 4 - 18, 4); }
      });
      // alpha + numeric keypad
      const keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      keys.forEach((t, i) => {
        const kx = x0 + 96 + (i % 5) * 26, ky = y0 + 272 + Math.floor(i / 5) * 28;
        b.fillStyle = '#2c3239'; b.fillRect(kx, ky, 22, 22);
        lab(b, t, kx + 11, ky + 11, 13, '#c8d0d8'); lab(g, t, kx + 11, ky + 11, 13, '#e0f0ff');
      });
      '123456789.0-'.split('').forEach((t, i) => {
        const kx = x0 + 14 + (i % 3) * 26, ky = y0 + 272 + Math.floor(i / 3) * 34;
        b.fillStyle = '#2c3239'; b.fillRect(kx, ky, 22, 26);
        lab(b, t, kx + 11, ky + 13, 14, '#c8d0d8'); lab(g, t, kx + 11, ky + 13, 14, '#e0f0ff');
      });
    }
    // --- radio management panels + transponder + trim (920..1280)
    for (let k = 0; k < 2; k++) {
      const x0 = 18 + k * (W / 2), w = W / 2 - 36, y0 = 925;
      b.fillStyle = '#1d2227'; b.fillRect(x0, y0, w, 150);
      b.fillStyle = '#060707'; b.fillRect(x0 + 12, y0 + 16, w / 2 - 18, 40); b.fillRect(x0 + w / 2 + 6, y0 + 16, w / 2 - 18, 40);
      for (const ctx of [b, g]) {
        ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = ctx === b ? '#3a2a10' : '#ffb84a';
        ctx.fillText(k ? '121.50' : '118.70', x0 + w / 4 + 3, y0 + 37);
        ctx.fillText(k ? '123.45' : '124.35', x0 + w * 0.75 - 3, y0 + 37);
      }
      both(k ? 'VHF 2' : 'VHF 1', x0 + w / 2, y0 + 75, 14);
      knobDraw(b, x0 + w / 2, y0 + 112, 22);
      ['VHF1', 'VHF2', 'HF', 'NAV'].forEach((t, i) => { const bx = x0 + 10 + i * 30 + (i > 1 ? w - 140 : 0); b.fillStyle = '#2c3239'; b.fillRect(bx, y0 + 100, 26, 22); lab(g, t, bx + 13, y0 + 111, 10, '#d6eaff'); lab(b, t, bx + 13, y0 + 111, 10, '#aab3bd'); });
    }
    b.fillStyle = '#1d2227'; b.fillRect(18, 1090, W - 36, 170);
    b.fillStyle = '#060707'; b.fillRect(40, 1110, 150, 44);
    for (const ctx of [b, g]) { ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = ctx === b ? '#103a10' : '#62ff7a'; ctx.fillText('7000', 115, 1133); }
    both('XPDR / TCAS', 115, 1175, 14);
    knobDraw(b, 300, 1150, 26); both('RUD TRIM', 300, 1195, 13);
    b.fillStyle = '#7a1414'; b.fillRect(380, 1112, 90, 50); both('PARK BRK', 425, 1185, 13);
    both('AILERON TRIM', 300, 1238, 12);
  });
  return out;
}

// ------------------------------------------------------------------ EFIS control panel texture
function efisTexture() {
  return pair(512, 128, (b, g, W, H) => {
    grain(b, W, H, '#262c33', 600, 21);
    b.strokeStyle = '#0d0f12'; b.lineWidth = 4; b.strokeRect(2, 2, W - 4, H - 4);
    knobDraw(b, 60, 64, 34);
    knobDraw(b, W - 60, 64, 34);
    b.fillStyle = '#050607'; b.fillRect(110, 18, 110, 40);
    for (const ctx of [b, g]) {
      ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = ctx === b ? '#3a2a10' : '#ffb84a'; ctx.fillText('29.92', 165, 38);
      ctx.font = 'bold 15px Arial'; ctx.fillStyle = ctx === b ? '#9aa4ae' : '#d6eaff';
      ctx.fillText('BARO', 60, 112); ctx.fillText('RANGE', W - 60, 112); ctx.fillText('MINS', 165, 80);
    }
    ['MAP', 'PLAN', 'TFC', 'TERR', 'WXR', 'FPV'].forEach((t, i) => {
      const x = 240 + (i % 3) * 56, y = 20 + Math.floor(i / 3) * 50;
      b.fillStyle = '#16191d'; b.fillRect(x, y, 48, 38);
      b.font = 'bold 14px Arial'; b.textAlign = 'center'; b.fillStyle = '#8f99a4'; b.fillText(t, x + 24, y + 16);
      g.font = 'bold 14px Arial'; g.textAlign = 'center'; g.fillStyle = '#d6eaff'; g.fillText(t, x + 24, y + 16);
      if (i % 2 === 0) { g.fillStyle = 'rgba(90,255,120,0.6)'; g.fillRect(x + 12, y + 28, 24, 4); }
    });
  });
}

// ------------------------------------------------------------------ geometry helpers
function extrudeX(points, x0, x1) {
  // points: [[fwd, up], ...] profile in the (forward, up) plane, extruded along +x from x0 to x1
  const s = new THREE.Shape();
  points.forEach(([f, u], i) => (i ? s.lineTo(f, u) : s.moveTo(f, u)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: x1 - x0, bevelEnabled: false, curveSegments: 6 });
  g.rotateY(Math.PI / 2);      // extrusion axis -> +x, shape "forward" -> -z
  g.translate(x0, 0, 0);
  return g;
}

function toNonIndexed(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  return g;
}

// Collects static geometry per material and merges it into one mesh per material.
class StaticBatch {
  constructor() { this.parts = new Map(); }
  add(mat, geo, pos = null, rot = null) {
    const g = toNonIndexed(geo);
    if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
    if (pos) g.translate(pos.x, pos.y, pos.z);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
  }
  build(parent) {
    for (const [mat, list] of this.parts) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!g) continue;
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.name = 'deckStatic';
      parent.add(m);
    }
    this.parts.clear();
  }
}

// ------------------------------------------------------------------ the deck builder
export function buildModernDeck(ck) {
  const eye = ck.eye, L = ck.layout, P = L.panel, C = L.controls, fm = ck.ac.fm, spec = ck.spec, sys = ck.ac.systems;
  const gap = L.seatGap || 1.0;
  const cxW = eye.x + P.cx;                       // aircraft centreline (world x of the panel centre)
  const tilt = P.tilt * DEG;
  // panel top edge in cockpit coordinates
  const topY = eye.y + P.top - P.h / 2 + (P.h / 2) * Math.cos(tilt);
  const topZ = eye.z - P.dist - (P.h / 2) * Math.sin(tilt);
  const batch = new StaticBatch();
  const M = ck.M;
  const mats = ck.mats;
  const glowMat = (tex, color, base = '#ffffff', rough = 0.7) => {
    const m = new M({ map: tex.map, emissiveMap: tex.glow, emissive: new THREE.Color(color), emissiveIntensity: 0.3, roughness: rough, metalness: 0.1, color: new THREE.Color(base) });
    ck.glowMats.push(m);
    return m;
  };
  const hoodMat = new M({ color: new THREE.Color(L.glare.color || '#1c2026'), roughness: 0.92, metalness: 0.05 });

  // ---- glareshield hood: lip face towards the crew, rounded nose, long flat top
  const depth = L.glare.depth + 0.12;
  const hood = extrudeX([
    [-0.035, -0.012], [-0.035, 0.034], [-0.02, 0.05], [0.04, 0.058], [depth * 0.6, 0.05], [depth, 0.03], [depth, -0.05], [0.0, -0.05],
  ], cxW - P.w / 2 - 0.05, cxW + P.w / 2 + 0.05);
  batch.add(hoodMat, hood, new THREE.Vector3(0, topY, topZ));
  // blue LED strip under the lip (the cool glow seen in modern decks at night)
  const led = new THREE.MeshBasicMaterial({ color: 0x3f7dff });
  ck.ledMat = led;
  batch.add(led, new THREE.BoxGeometry(P.w + 0.06, 0.004, 0.006), new THREE.Vector3(cxW, topY - 0.014, topZ + 0.034));
  // EFIS control panels above each PFD (one shared texture)
  const efis = glowMat(efisTexture(), '#cfe4ff');
  const ew = 0.2, eh = 0.05;
  for (const sx of [eye.x - 0.02, eye.x + (eye.x < 0 ? gap : -gap) + 0.02]) {
    const pl = new THREE.PlaneGeometry(ew, eh);
    batch.add(efis, pl, new THREE.Vector3(sx, topY + 0.011, topZ + 0.036), new THREE.Euler(-0.12, 0, 0));
  }

  // ---- centre pedestal
  const pedW = 0.36, pedL = 0.92;
  const pedFrontZ = eye.z - P.dist + 0.16, pedBackZ = pedFrontZ + pedL;
  const pedZ = (pedFrontZ + pedBackZ) / 2;
  const pedTopFront = eye.y - 0.5, pedTopBack = eye.y - 0.58;
  const slope = Math.atan2(pedTopFront - pedTopBack, pedL);
  const pedY = (pedTopFront + pedTopBack) / 2;
  const nLevers = C.levers || fm.engines.length || 2;
  const ped = pedestalTexture(nLevers);
  const pedMat = glowMat(ped.tex, '#d6eaff', '#ffffff', 0.8);
  const topGeo = new THREE.PlaneGeometry(pedW, pedL).rotateX(-Math.PI / 2);
  batch.add(pedMat, topGeo, new THREE.Vector3(cxW, pedY + 0.001, pedZ), new THREE.Euler(slope, 0, 0));
  const floorY = ck.floorY;
  const bodyH = pedY - floorY;
  batch.add(mats.dark, new THREE.BoxGeometry(pedW, bodyH, pedL), new THREE.Vector3(cxW, floorY + bodyH / 2 - 0.004, pedZ));
  // forward riser joining the main panel (lower centre panel)
  const riserH = (eye.y + P.top - P.h) - floorY;
  if (riserH > 0.05) batch.add(mats.dark, new THREE.BoxGeometry(pedW * 1.1, riserH, 0.2), new THREE.Vector3(cxW, floorY + riserH / 2, eye.z - P.dist + 0.06));
  // CDU screens: two planes sharing one display canvas
  const cdu = new Display('cdu', 256);
  cdu.interval = 0.5;
  ck.displays.push(cdu);
  const cduGeos = [];
  const cw = 512, chh = 1280;
  for (const r of ped.cdu) {
    const w = r.w / cw * pedW, h = r.h / chh * pedL;
    const cx2 = (r.x + r.w / 2) / cw * pedW - pedW / 2;
    const cz = (r.y + r.h / 2) / chh * pedL - pedL / 2;
    const g = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2);
    g.translate(cx2, 0.003, cz);
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(slope));
    g.translate(cxW, pedY, pedZ);
    cduGeos.push(toNonIndexed(g));
  }
  const cduMesh = new THREE.Mesh(mergeGeometries(cduGeos, false), cdu.material);
  ck.group.add(cduMesh);
  ck.addTip(cduMesh, 'Control display units (FMS): route, distance and time to destination, fuel and weight');
  // pedestal surface height at a given local z (from pedestal centre, + = aft)
  const surfY = (lz) => pedY - lz * Math.tan(slope);
  const lzOf = (canvasY) => canvasY / chh * pedL - pedL / 2;

  // thrust levers
  ck.throttleLevers = [];
  const pivotLz = lzOf(230);
  for (let i = 0; i < nLevers; i++) {
    const lx = (nLevers === 1 ? 0 : (-60 + (120 / (nLevers - 1)) * i)) / cw * pedW;
    const lv = new THREE.Group();
    lv.position.set(cxW + lx, surfY(pivotLz), pedZ + pivotLz);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.018).translate(0, 0.08, 0), mats.metal);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.034, 0.036).translate(0, 0.17, 0), mats.black);
    lv.add(arm); lv.add(grip);
    if (C.reversers !== false && spec.systems && spec.systems.reversers) {
      const rev = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.012).translate(0, 0.12, 0.016), mats.metal);
      lv.add(rev);
      ck.anim.push(() => { rev.rotation.x = fm.reverserPos * -0.9; });
    }
    ck.group.add(lv);
    ck.throttleLevers.push(lv);
    ck.addClick(grip, 'Thrust lever ' + (i + 1), `Thrust lever ${i + 1}: R/F (or PgUp/PgDn) moves all levers. Click: idle / full`, () => { const t = fm.ctl.throttle[i] > 0.5 ? 0 : 1; ck.ac.setThrottleAll(t); });
    ck.anim.push(() => { lv.rotation.x = -0.7 + (fm.ctl.throttle[i] ?? 0) * 1.15; });
  }
  // speed brake (left) and flap lever (right)
  if (C.speedbrake) {
    const lv = new THREE.Group();
    lv.position.set(cxW + (62 / cw - 0.5) * pedW, surfY(lzOf(220)), pedZ + lzOf(220));
    lv.add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.11, 0.014).translate(0, 0.055, 0), mats.metal));
    const k = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.02, 0.03).translate(0, 0.12, 0), mats.dark);
    lv.add(k); ck.group.add(lv);
    ck.addClick(k, 'Speed brake', 'Speed brake / ground spoilers ( / key )', () => ck.ac.toggleSpoilers());
    ck.anim.push(() => { lv.rotation.x = 0.55 - fm.ctl.spoilers * 1.0; });
  }
  if (spec.aero && spec.aero.flaps.length > 1) {
    const lv = new THREE.Group();
    lv.position.set(cxW + (0.5 - 62 / cw) * pedW, surfY(lzOf(220)), pedZ + lzOf(220));
    lv.add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.11, 0.014).translate(0, 0.055, 0), mats.metal));
    const k = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.024, 0.03).translate(0, 0.12, 0), mats.knobWhite);
    lv.add(k); ck.group.add(lv);
    ck.addClick(k, 'Flap lever', 'Flap lever: [ / ] keys. Click to extend one step, right-click to retract', (b) => ck.ac.flaps(b === 2 ? -1 : 1));
    const nf = spec.aero.flaps.length - 1;
    ck.anim.push(() => { lv.rotation.x = -0.6 + (fm.ctl.flapIndex / nf) * 1.15; });
  }
  // parking brake handle (clickable, lit when set)
  {
    const pz = lzOf(1137);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.016, 0.03), new M({ color: 0x8a1a1a, roughness: 0.5, emissive: 0xff2010, emissiveIntensity: 0 }));
    h.position.set(cxW + (425 / cw - 0.5) * pedW, surfY(pz) + 0.01, pedZ + pz);
    ck.group.add(h);
    ck.addClick(h, 'Parking brake', 'Parking brake (Shift+B)', () => { fm.ctl.parking = !fm.ctl.parking; });
    ck.anim.push(() => { h.material.emissiveIntensity = fm.ctl.parking ? 0.6 : 0; h.position.y = surfY(pz) + (fm.ctl.parking ? 0.018 : 0.008); });
  }

  // ---- overhead panel (sloping down towards the windshield)
  const ovW = Math.min(0.96, gap * 0.88), ovL = 0.95;
  const ovFrontZ = eye.z - 0.68, ovBackZ = ovFrontZ + ovL;
  const ovFrontY = eye.y + 0.25, ovBackY = eye.y + 0.45;
  const sh = ck.ac.model.shape;
  // keep it inside the fuselage: limit by the roof height at the panel
  const roof = Math.min(sh.topY(ovFrontZ), sh.topY(ovBackZ)) - 0.06;
  const dy = Math.max(0, Math.max(ovFrontY, ovBackY) - roof);
  const oSlope = Math.atan2(ovBackY - ovFrontY, ovL);
  const ovMat = glowMat(overheadTexture(5), '#bcd8ff', '#ffffff', 0.85);
  const ovGeo = new THREE.PlaneGeometry(ovW, ovL).rotateX(Math.PI / 2);   // facing down
  batch.add(ovMat, ovGeo, new THREE.Vector3(cxW, (ovFrontY + ovBackY) / 2 - dy, (ovFrontZ + ovBackZ) / 2), new THREE.Euler(-oSlope, 0, 0));
  batch.add(mats.dark, new THREE.BoxGeometry(ovW + 0.04, 0.05, ovL + 0.02), new THREE.Vector3(cxW, (ovFrontY + ovBackY) / 2 - dy + 0.027, (ovFrontZ + ovBackZ) / 2), new THREE.Euler(-oSlope, 0, 0));
  // interactive switches as backlit push buttons, in rows on the aft half of the overhead (local +y
  // runs aft and up along the panel surface, local +z points down towards the crew)
  const ovY = (z) => ovFrontY - dy + (z - ovFrontZ) * Math.tan(oSlope);
  const og = new THREE.Group();
  const ogZ = ovFrontZ + ovL * 0.52;
  og.position.set(cxW, ovY(ogZ) - 0.003, ogZ);
  og.rotation.x = Math.PI / 2 - oSlope;
  ck.group.add(og);
  ck.overhead = og;
  const list = ck.switchList();
  const cols = Math.min(8, list.length);
  const bw = Math.min(0.085, (ovW - 0.06) / cols - 0.008);
  list.forEach(([lbl, tip, get, set], i) => {
    const x = -ovW / 2 + 0.04 + (i % cols) * (bw + 0.008) + bw / 2;
    const y = Math.floor(i / cols) * 0.045;
    ck.button(og, x, y, bw, 0.034, lbl, tip, () => set(!get()), '#1f252c', get);
  });
  fm.engines.forEach((e, i) => ck.button(og, -ovW / 2 + 0.06 + i * 0.09, 0.115, 0.08, 0.034, 'START ' + (i + 1), `Engine ${i + 1} start (I = auto start all)`, () => { sys.battery = true; sys.ignition = true; sys.fuelPumps = true; e.fuelCutoff = false; e.requestStart(); }, '#1d2a1d', () => e.state === 'cranking' || e.state === 'lightoff'));
  // dark backing plate behind the interactive rows
  const plate = new THREE.Mesh(new THREE.BoxGeometry(ovW - 0.02, 0.2, 0.006), mats.dark);
  plate.position.set(0, 0.07, -0.002);
  og.add(plate);

  // ---- side consoles with tiller (outboard of each pilot)
  const conMat = new M({ color: 0x252b32, roughness: 0.8 });
  for (const sx of [eye.x, eye.x + (eye.x < 0 ? gap : -gap)]) {
    const out = Math.sign(sx - cxW) || -1;
    const x = sx + out * 0.36;
    batch.add(conMat, new THREE.BoxGeometry(0.2, 0.09, 0.8), new THREE.Vector3(x, eye.y - 0.6, eye.z - 0.1));
    batch.add(conMat, new THREE.BoxGeometry(0.06, eye.y - 0.65 - floorY, 0.8), new THREE.Vector3(x + out * 0.07, floorY + (eye.y - 0.65 - floorY) / 2, eye.z - 0.1));
    batch.add(mats.black, new THREE.CylinderGeometry(0.05, 0.05, 0.015, 18), new THREE.Vector3(x, eye.y - 0.548, eye.z - 0.32));
    batch.add(mats.metal, new THREE.CylinderGeometry(0.008, 0.008, 0.04, 8), new THREE.Vector3(x + 0.035, eye.y - 0.53, eye.z - 0.32));
  }

  // ---- crew seats (merged: cushions + shells)
  const seatMat = new M({ color: 0x5b6169, roughness: 0.98 });            // sheepskin-style covers
  const shellMat = new M({ color: 0x23272c, roughness: 0.6, metalness: 0.2 });
  for (const sx of [eye.x, eye.x + (eye.x < 0 ? gap : -gap)]) {
    const z = eye.z + 0.3, fy = floorY;
    batch.add(seatMat, new THREE.BoxGeometry(0.48, 0.1, 0.48), new THREE.Vector3(sx, fy + 0.46, z));
    batch.add(seatMat, new THREE.BoxGeometry(0.46, 0.66, 0.1), new THREE.Vector3(sx, fy + 0.86, z + 0.27), new THREE.Euler(-0.14, 0, 0));
    batch.add(seatMat, new THREE.BoxGeometry(0.28, 0.2, 0.1), new THREE.Vector3(sx, fy + 1.3, z + 0.33), new THREE.Euler(-0.08, 0, 0));
    batch.add(shellMat, new THREE.BoxGeometry(0.5, 0.72, 0.06), new THREE.Vector3(sx, fy + 0.86, z + 0.33), new THREE.Euler(-0.14, 0, 0));
    for (const s of [-1, 1]) batch.add(shellMat, new THREE.BoxGeometry(0.06, 0.05, 0.36), new THREE.Vector3(sx + s * 0.27, fy + 0.66, z + 0.04));
    batch.add(shellMat, new THREE.BoxGeometry(0.34, 0.4, 0.34), new THREE.Vector3(sx, fy + 0.2, z));
  }

  batch.build(ck.group);
}
