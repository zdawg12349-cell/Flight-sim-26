// Analog instruments: canvas dial faces (generated once) + 3D needles animated every frame.
import * as THREE from 'three';
import { clamp, lerp, DEG, KT, FT, FPM } from '../core/math.js';

const TAU = Math.PI * 2;
const faceCache = new Map();

function canvas(n = 256) { const c = document.createElement('canvas'); c.width = c.height = n; return c; }

function ring(x, R, w = 10) {
  const g = x.createRadialGradient(R, R, R - w, R, R, R);
  g.addColorStop(0, '#2a2c2f'); g.addColorStop(0.5, '#4a4d51'); g.addColorStop(1, '#151618');
  x.fillStyle = g; x.beginPath(); x.arc(R, R, R, 0, TAU); x.fill();
  x.fillStyle = '#0d0e10'; x.beginPath(); x.arc(R, R, R - w, 0, TAU); x.fill();
}

// angle (radians, canvas convention: 0 = up, clockwise) for value v on a dial spanning a0..a1 deg for v0..v1
function ang(v, v0, v1, a0, a1) { return (a0 + (a1 - a0) * clamp((v - v0) / (v1 - v0), -0.05, 1.05)) * DEG; }

function ticks(x, R, v0, v1, a0, a1, major, minor, labelFn, opts = {}) {
  x.save(); x.translate(R, R);
  x.strokeStyle = '#eee'; x.fillStyle = '#eee';
  for (let v = v0; v <= v1 + 1e-6; v += minor) {
    const a = ang(v, v0, v1, a0, a1);
    const isMaj = Math.abs((v - v0) / major - Math.round((v - v0) / major)) < 1e-6;
    const r0 = R * (isMaj ? 0.72 : 0.78), r1 = R * 0.86;
    x.lineWidth = isMaj ? 3 : 1.5;
    x.beginPath(); x.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0); x.lineTo(Math.sin(a) * r1, -Math.cos(a) * r1); x.stroke();
    if (isMaj && labelFn) {
      const t = labelFn(v);
      if (t !== null && t !== undefined) {
        x.font = `bold ${opts.font || R * 0.17}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
        const rl = R * (opts.labelR || 0.58);
        x.fillText(t, Math.sin(a) * rl, -Math.cos(a) * rl);
      }
    }
  }
  x.restore();
}

function arc(x, R, v0, v1, from, to, a0, a1, color, r = 0.82, w = 7) {
  x.save(); x.translate(R, R);
  x.strokeStyle = color; x.lineWidth = w;
  x.beginPath();
  x.arc(0, 0, R * r, ang(from, v0, v1, a0, a1) - Math.PI / 2, ang(to, v0, v1, a0, a1) - Math.PI / 2);
  x.stroke(); x.restore();
}

function label(x, R, text, y = 0.3, size = 0.12, color = '#ddd') {
  x.fillStyle = color; x.font = `bold ${R * size}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, R, R + R * y);
}

// Builds a dial face texture: returns { map, emissiveMap }.
function face(key, draw) {
  if (faceCache.has(key)) return faceCache.get(key);
  const c = canvas(256), x = c.getContext('2d');
  const R = 128;
  ring(x, R);
  draw(x, R);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  faceCache.set(key, t);
  return t;
}

// ---------- needle meshes ----------
let NEEDLE_MAT = null, NEEDLE_MAT_Y = null;
function needleMat(color = 0xffffff) {
  return new THREE.MeshBasicMaterial({ color });
}
function needle(len, w = 0.035, color = 0xf2f2f2, tail = 0.18) {
  const g = new THREE.Shape();
  g.moveTo(-w / 2, -len * tail); g.lineTo(w / 2, -len * tail); g.lineTo(w * 0.25, len * 0.92); g.lineTo(0, len); g.lineTo(-w * 0.25, len * 0.92); g.closePath();
  const geo = new THREE.ShapeGeometry(g);
  const m = new THREE.Mesh(geo, needleMat(color));
  return m;
}

// Gauge base: face + bezel + needles. size = diameter (m).
export function makeGauge(kind, size, cfg, mats) {
  const group = new THREE.Group();
  const R = size / 2;
  let tex, needles = [];
  const upd = [];
  const pivot = (len, w, color, z = 0.002, tail) => {
    const p = new THREE.Group(); p.position.z = z;
    const n = needle(len * R, w * R, color, tail); p.add(n); group.add(p); needles.push(p); return p;
  };
  const S = cfg.spec;
  switch (kind) {
    case 'asi': {
      const vmax = Math.ceil(((S.perf.vneKt || S.perf.maxKt || 200) * 1.15) / 20) * 20;
      const vs0 = S.perf.vs0 || 40, vfe = (S.perf.vref || 80) * 1.35, vno = (S.perf.vneKt || 160) * 0.85, vne = S.perf.vneKt || 160;
      tex = face('asi' + vmax + vne, (x, Rr) => {
        arc(x, Rr, 0, vmax, vs0, vfe, 20, 340, '#ffffff', 0.86, 5);
        arc(x, Rr, 0, vmax, vs0 * 1.08, vno, 20, 340, '#2db84a', 0.81, 7);
        arc(x, Rr, 0, vmax, vno, vne, 20, 340, '#e8c020', 0.81, 7);
        arc(x, Rr, 0, vmax, vne, vne + vmax * 0.012, 20, 340, '#e02020', 0.81, 9);
        ticks(x, Rr, 0, vmax, 20, 340, vmax > 300 ? 50 : 20, vmax > 300 ? 10 : 5, (v) => (v > 0 ? v : null));
        label(x, Rr, 'KNOTS', 0.32); label(x, Rr, 'AIRSPEED', -0.32, 0.09);
      });
      const p = pivot(0.78, 0.07, 0xffffff);
      upd.push((d) => { p.rotation.z = -ang(d.iasKt, 0, vmax, 20, 340); });
      break;
    }
    case 'alt': {
      tex = face('alt', (x, Rr) => {
        ticks(x, Rr, 0, 1000, 0, 360, 100, 20, (v) => (v < 1000 ? String(v / 100) : null), { font: Rr * 0.2 });
        label(x, Rr, 'ALT', -0.3, 0.1); label(x, Rr, '100 FT', 0.35, 0.08);
        x.fillStyle = '#000'; x.fillRect(Rr * 1.35, Rr * 0.88, Rr * 0.45, Rr * 0.24);
      });
      const p10k = pivot(0.62, 0.03, 0xdddddd, 0.001, 0.0);
      const p1k = pivot(0.55, 0.1, 0xffffff, 0.002);
      const p100 = pivot(0.82, 0.06, 0xffffff, 0.003);
      upd.push((d) => {
        const a = d.altFt;
        p100.rotation.z = -((a % 1000) / 1000) * TAU;
        p1k.rotation.z = -((a % 10000) / 10000) * TAU;
        p10k.rotation.z = -((a % 100000) / 100000) * TAU;
      });
      break;
    }
    case 'vsi': {
      const m = cfg.vsiMax || 2000;
      tex = face('vsi' + m, (x, Rr) => {
        ticks(x, Rr, -m, m, 270 + 2, 270 + 178, 500, 100, (v) => String(Math.abs(v / 1000)), {});
        label(x, Rr, 'VERTICAL SPEED', -0.25, 0.08); label(x, Rr, '1000 FPM', 0.25, 0.08);
        label(x, Rr, 'UP', -0.12, 0.08); label(x, Rr, 'DN', 0.12, 0.08);
      });
      const p = pivot(0.78, 0.07, 0xffffff);
      upd.push((d) => { p.rotation.z = -ang(d.vsFpm, -m, m, 92, 268) + Math.PI; });
      break;
    }
    case 'hdg': {
      // rotating compass card: the card itself rotates; lubber line fixed
      tex = face('hdgbase', (x, Rr) => {
        x.fillStyle = '#e09a20';
        x.beginPath(); x.moveTo(Rr, Rr * 0.1); x.lineTo(Rr - 8, Rr * 0.22); x.lineTo(Rr + 8, Rr * 0.22); x.fill();
      });
      const cardTex = face('hdgcard', (x, Rr) => {
        x.clearRect(0, 0, 256, 256);
        x.fillStyle = '#121315'; x.beginPath(); x.arc(Rr, Rr, Rr * 0.88, 0, TAU); x.fill();
        ticks(x, Rr, 0, 360, 0, 360, 30, 5, (v) => (v === 0 ? 'N' : v === 90 ? 'E' : v === 180 ? 'S' : v === 270 ? 'W' : v < 360 ? String(v / 10) : null), { font: Rr * 0.16, labelR: 0.6 });
      });
      const card = new THREE.Mesh(new THREE.CircleGeometry(R * 0.86, 40), new THREE.MeshBasicMaterial({ map: cardTex, transparent: true }));
      card.position.z = 0.0015;
      group.add(card);
      const plane = needle(R * 0.45, R * 0.35, 0xffaa22, 0.4);
      plane.position.z = 0.003; group.add(plane);
      upd.push((d) => { card.rotation.z = d.hdg * DEG; });
      break;
    }
    case 'turn': {
      tex = face('turn', (x, Rr) => {
        label(x, Rr, 'TURN COORDINATOR', -0.45, 0.08);
        x.strokeStyle = '#eee'; x.lineWidth = 3;
        for (const a of [-75, 75, -90, 90]) { x.save(); x.translate(Rr, Rr); x.rotate(a * DEG); x.beginPath(); x.moveTo(Rr * 0.62, 0); x.lineTo(Rr * 0.8, 0); x.stroke(); x.restore(); }
        label(x, Rr, 'L', 0.32, 0.12); x.fillText('R', Rr * 1.55, Rr * 1.32);
        x.fillStyle = '#ddd'; x.fillRect(Rr * 0.55, Rr * 1.5, Rr * 0.9, Rr * 0.16);
        x.fillStyle = '#111'; x.fillRect(Rr * 0.92, Rr * 1.5, Rr * 0.04, Rr * 0.16); x.fillRect(Rr * 1.04, Rr * 1.5, Rr * 0.04, Rr * 0.16);
      });
      const wing = new THREE.Group();
      const w1 = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.2, R * 0.08), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const w2 = new THREE.Mesh(new THREE.CircleGeometry(R * 0.1, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      wing.add(w1); wing.add(w2); wing.position.z = 0.002; group.add(wing);
      const ball = new THREE.Mesh(new THREE.CircleGeometry(R * 0.07, 12), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      ball.position.set(0, -R * 0.58, 0.003); group.add(ball);
      upd.push((d) => { wing.rotation.z = -clamp(d.turnRate / 3, -1.3, 1.3) * 0.35; ball.position.x = clamp(d.slip, -1, 1) * R * 0.32; });
      break;
    }
    case 'adi': {
      // horizon disc drawn with a shader (pitch offset + roll rotation), fixed aircraft symbol overlay
      const mat = new THREE.ShaderMaterial({
        uniforms: { uPitch: { value: 0 }, uRoll: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float uPitch; uniform float uRoll; varying vec2 vUv;
          void main(){
            vec2 p = vUv - 0.5; float c = cos(uRoll), s = sin(uRoll);
            vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
            float y = q.y + uPitch * 0.9;
            vec3 sky = mix(vec3(0.15,0.42,0.85), vec3(0.32,0.6,0.95), clamp(y*2.0,0.0,1.0));
            vec3 gnd = mix(vec3(0.45,0.28,0.12), vec3(0.32,0.2,0.08), clamp(-y*2.0,0.0,1.0));
            vec3 col = y > 0.0 ? sky : gnd;
            if (abs(y) < 0.006) col = vec3(1.0);
            for (int i = -8; i <= 8; i++) {
              if (i == 0) continue;
              float w = ((i / 2) * 2 == i) ? 0.12 : 0.06;
              float d = abs((q.y + uPitch * 0.9) - float(i) * 0.05);
              if (d < 0.004 && abs(q.x) < w) col = vec3(1.0);
            }
            float r = length(p);
            if (r > 0.5) discard;
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(R * 0.86, 40), mat);
      disc.position.z = 0.001;
      group.add(disc);
      tex = face('adiring', (x, Rr) => {
        x.clearRect(0, 0, 256, 256);
        ring(x, Rr, 18);
        x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(Rr, Rr, Rr * 0.86, 0, TAU); x.fill();
        x.globalCompositeOperation = 'source-over';
        x.strokeStyle = '#fff'; x.lineWidth = 3;
        for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { x.save(); x.translate(Rr, Rr); x.rotate(a * DEG); x.beginPath(); x.moveTo(0, -Rr * 0.86); x.lineTo(0, -Rr * (a % 30 === 0 ? 0.74 : 0.79)); x.stroke(); x.restore(); }
      });
      const sym = new THREE.Group();
      const bar = new THREE.MeshBasicMaterial({ color: 0xffb020 });
      const l = new THREE.Mesh(new THREE.PlaneGeometry(R * 0.38, R * 0.05), bar); l.position.x = -R * 0.3; sym.add(l);
      const r = new THREE.Mesh(new THREE.PlaneGeometry(R * 0.38, R * 0.05), bar); r.position.x = R * 0.3; sym.add(r);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(R * 0.04, 10), bar); sym.add(dot);
      sym.position.z = 0.004; group.add(sym);
      const bankPtr = needle(R * 0.12, R * 0.12, 0xffffff, 0);
      const bp = new THREE.Group(); bankPtr.position.y = R * 0.68; bp.add(bankPtr); bp.position.z = 0.003; group.add(bp);
      upd.push((d) => { mat.uniforms.uPitch.value = clamp(d.pitch / 90, -0.6, 0.6) * (d.adiFail ? 0.2 : 1); mat.uniforms.uRoll.value = d.bank * DEG * (d.adiFail ? 0.3 : 1); bp.rotation.z = d.bank * DEG; });
      group.userData.overlay = true;
      break;
    }
    case 'rpm': {
      const m = cfg.max || 3500;
      tex = face('rpm' + m + (cfg.green || ''), (x, Rr) => {
        if (cfg.green) arc(x, Rr, 0, m, cfg.green[0], cfg.green[1], 40, 320, '#2db84a', 0.81, 7);
        arc(x, Rr, 0, m, cfg.red || m * 0.8, (cfg.red || m * 0.8) + m * 0.01, 40, 320, '#e02020', 0.81, 9);
        ticks(x, Rr, 0, m, 40, 320, m / 7, m / 35, (v) => String(Math.round(v / 100)));
        label(x, Rr, 'RPM', -0.3, 0.12); label(x, Rr, 'x100', 0.3, 0.09);
      });
      const p = pivot(0.78, 0.07, 0xffffff);
      upd.push((d) => { p.rotation.z = -ang(d.engines[cfg.e || 0]?.rpm || 0, 0, m, 40, 320); });
      break;
    }
    case 'map': {
      tex = face('map', (x, Rr) => {
        arc(x, Rr, 10, 35, 15, 29, 40, 320, '#2db84a', 0.81, 7);
        ticks(x, Rr, 10, 35, 40, 320, 5, 1, (v) => String(v));
        label(x, Rr, 'MAN PRESS', -0.3, 0.09); label(x, Rr, 'IN HG', 0.3, 0.09);
      });
      const p = pivot(0.78, 0.07, 0xffffff);
      upd.push((d) => { p.rotation.z = -ang(d.engines[cfg.e || 0]?.map || 29.9, 10, 35, 40, 320); });
      break;
    }
    case 'n1': case 'n2': case 'torque': case 'np': {
      const lbl = { n1: 'N1 %', n2: 'N2 %', torque: 'TORQUE %', np: 'PROP %' }[kind];
      tex = face('pct' + kind, (x, Rr) => {
        arc(x, Rr, 0, 110, 100, 101, 30, 330, '#e02020', 0.81, 9);
        ticks(x, Rr, 0, 110, 30, 330, 20, 5, (v) => (v <= 100 ? String(v / 10) : null));
        label(x, Rr, lbl, 0.32, 0.1);
      });
      const p = pivot(0.78, 0.07, 0xffffff);
      upd.push((d) => {
        const e = d.engines[cfg.e || 0]; let v = 0;
        if (e) v = kind === 'n1' ? e.n1 : kind === 'n2' ? e.n2 : kind === 'torque' ? e.torque : e.n1;
        p.rotation.z = -ang(v * 100, 0, 110, 30, 330);
      });
      break;
    }
    case 'egt': case 'itt': {
      const m = kind === 'itt' ? 1000 : 1000;
      tex = face(kind, (x, Rr) => {
        arc(x, Rr, 0, m, 300, 800, 40, 320, '#2db84a', 0.81, 7);
        arc(x, Rr, 0, m, 850, 860, 40, 320, '#e02020', 0.81, 9);
        ticks(x, Rr, 0, m, 40, 320, 200, 50, (v) => String(v / 100));
        label(x, Rr, kind.toUpperCase() + ' °C', 0.32, 0.1);
      });
      const p = pivot(0.78, 0.07, 0xffffff);
      upd.push((d) => { p.rotation.z = -ang(d.engines[cfg.e || 0]?.egt || 0, 0, m, 40, 320); });
      break;
    }
    case 'dual': {
      // small dual-needle gauge: oil press (left) / oil temp (right), or fuel L/R
      const which = cfg.what || 'oil';
      tex = face('dual' + which, (x, Rr) => {
        x.save(); x.translate(Rr, Rr); x.strokeStyle = '#eee'; x.lineWidth = 2;
        for (let i = 0; i <= 4; i++) { const a = (-150 + i * 30) * DEG; x.beginPath(); x.moveTo(Math.sin(a) * Rr * 0.7, -Math.cos(a) * Rr * 0.7); x.lineTo(Math.sin(a) * Rr * 0.82, -Math.cos(a) * Rr * 0.82); x.stroke(); }
        for (let i = 0; i <= 4; i++) { const a = (30 + i * 30) * DEG; x.beginPath(); x.moveTo(Math.sin(a) * Rr * 0.7, -Math.cos(a) * Rr * 0.7); x.lineTo(Math.sin(a) * Rr * 0.82, -Math.cos(a) * Rr * 0.82); x.stroke(); }
        x.strokeStyle = '#2db84a'; x.lineWidth = 6;
        x.beginPath(); x.arc(0, 0, Rr * 0.86, (-130 - 90) * DEG, (-80 - 90) * DEG); x.stroke();
        x.beginPath(); x.arc(0, 0, Rr * 0.86, (40 - 90) * DEG, (110 - 90) * DEG); x.stroke();
        x.restore();
        const L = { oil: ['OIL P', 'OIL T'], fuel: ['FUEL L', 'FUEL R'], volt: ['AMP', 'VOLT'], cht: ['CHT', 'EGT'] }[which];
        label(x, Rr, L[0], 0.0, 0.12); x.fillText(L[1], Rr, Rr * 1.35);
      });
      const a = pivot(0.7, 0.08, 0xffffff), b = pivot(0.7, 0.08, 0xffffff);
      upd.push((d) => {
        const e = d.engines[cfg.e || 0] || {};
        let va = 0, vb = 0;
        if (which === 'oil') { va = clamp((e.oilP || 0) / ((e.oilPmax || 60) * 1.4), 0, 1); vb = clamp(((e.oilT || 0) - 0) / 150, 0, 1); }
        else if (which === 'fuel') { va = vb = clamp(d.fuelFrac, 0, 1); }
        else if (which === 'volt') { va = clamp(0.5 + (d.genOn ? 0.15 : -0.2), 0, 1); vb = clamp(d.volts / 32, 0, 1); }
        else if (which === 'cht') { va = clamp((e.cht || 0) / 260, 0, 1); vb = clamp((e.egt || 0) / 900, 0, 1); }
        a.rotation.z = -(-150 + va * 120) * DEG;
        b.rotation.z = -(150 - vb * 120) * DEG;
      });
      break;
    }
    case 'heliTach': {
      // dual tach: rotor (Nr) and engine/power turbine (Nf) needles
      tex = face('helitach', (x, Rr) => {
        arc(x, Rr, 0, 120, 95, 104, 30, 330, '#2db84a', 0.81, 7);
        arc(x, Rr, 0, 120, 104, 106, 30, 330, '#e02020', 0.81, 9);
        arc(x, Rr, 0, 120, 88, 90, 30, 330, '#e02020', 0.81, 9);
        ticks(x, Rr, 0, 120, 30, 330, 20, 5, (v) => (v <= 110 ? String(v) : null));
        label(x, Rr, 'ROTOR / ENG %', 0.33, 0.085);
        label(x, Rr, 'R', -0.25, 0.1, '#ffcc33');
      });
      const pE = pivot(0.82, 0.05, 0xffffff), pR = pivot(0.65, 0.08, 0xffcc33, 0.003);
      upd.push((d) => {
        pR.rotation.z = -ang(d.nr * 100, 0, 120, 30, 330);
        const e = d.engines[0];
        const ef = e ? (e.rpm && e.rpmMax ? e.rpm / e.rpmMax : e.running ? Math.max(d.nr, e.n2 * 1.0) : e.n2 * 0.5) : 0;
        pE.rotation.z = -ang(ef * 100, 0, 120, 30, 330);
      });
      break;
    }
    case 'g': {
      tex = face('gmeter', (x, Rr) => {
        arc(x, Rr, -4, 10, 7.5, 7.6, 30, 330, '#e02020', 0.81, 9);
        ticks(x, Rr, -4, 10, 30, 330, 2, 1, (v) => String(v));
        label(x, Rr, 'G', 0.32, 0.14);
      });
      const p = pivot(0.78, 0.07, 0xffffff), pmx = pivot(0.7, 0.04, 0xff8822, 0.0015);
      upd.push((d) => { p.rotation.z = -ang(d.g, -4, 10, 30, 330); pmx.rotation.z = -ang(d.maxG, -4, 10, 30, 330); });
      break;
    }
    case 'clock': {
      tex = face('clock', (x, Rr) => { ticks(x, Rr, 0, 12, 0, 360, 1, 0.2, (v) => (v > 0 && v <= 12 ? String(v) : null)); });
      const h = pivot(0.5, 0.08, 0xffffff), m = pivot(0.75, 0.05, 0xffffff), s = pivot(0.8, 0.02, 0xff4433, 0.003);
      upd.push((d) => { const t = d.clock; h.rotation.z = -((t % 12) / 12) * TAU; m.rotation.z = -((t * 60) % 60) / 60 * TAU; s.rotation.z = -((t * 3600) % 60) / 60 * TAU; });
      break;
    }
    case 'fuelflow': {
      tex = face('ff', (x, Rr) => { ticks(x, Rr, 0, 20, 40, 320, 4, 1, (v) => String(v)); label(x, Rr, 'FUEL FLOW', 0.3, 0.09); label(x, Rr, 'GPH', -0.3, 0.09); });
      const p = pivot(0.78, 0.07, 0xffffff);
      upd.push((d) => { p.rotation.z = -ang((d.engines[cfg.e || 0]?.ff || 0) * 3600 / 2.72, 0, 20, 40, 320); });
      break;
    }
    default:
      tex = face('blank', () => {});
  }
  const faceMesh = new THREE.Mesh(new THREE.CircleGeometry(R, 40), new THREE.MeshBasicMaterial({ map: tex, transparent: kind === 'adi' }));
  if (kind === 'adi') faceMesh.position.z = 0.0025;
  group.add(faceMesh);
  faceMesh.renderOrder = 1;
  // bezel
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(R * 1.0, R * 0.07, 6, 28), mats.bezel);
  group.add(bezel);
  // glass (subtle reflection)
  const glass = new THREE.Mesh(new THREE.CircleGeometry(R * 0.98, 28), mats.gaugeGlass);
  glass.position.z = 0.006;
  group.add(glass);
  for (const n of needles) n.renderOrder = 2;
  group.userData.update = (d) => { for (const f of upd) f(d); };
  group.userData.kind = kind;
  return group;
}
