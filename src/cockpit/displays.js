// Glass cockpit displays rendered to canvas textures: PFD, ND, EICAS, MFD, helicopter engine page, HUD.
// Each display redraws at a limited rate (graphics setting) and uploads one texture.
import * as THREE from 'three';
import { clamp, DEG, KT, FT, FPM, NM, wrap360, angDiffDeg, pad } from '../core/math.js';
import { AIRPORTS, runwayEnds } from '../world/airportData.js';

const TAU = Math.PI * 2;
const C = {
  sky: '#1f6fd0', gnd: '#7a4a1e', white: '#f2f2f2', green: '#3ee06a', cyan: '#3fd6ff', magenta: '#ff4fe4', amber: '#ffb020', red: '#ff3b30', grey: '#8a9099', dark: '#0b0d10', tape: '#3a3f47',
};

export class Display {
  constructor(kind, res, opts = {}) {
    this.kind = kind;
    this.opts = opts;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = res;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.anisotropy = 4;
    this.res = res;
    this.timer = Math.random() * 0.1;
    this.interval = 0.05;
    this.material = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false, transparent: kind === 'hud', depthWrite: kind !== 'hud', blending: kind === 'hud' ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.on = true;
  }
  update(dt, d, hz) {
    this.timer -= dt;
    if (this.timer > 0) return false;
    this.timer = 1 / Math.max(2, hz * (this.kind === 'pfd' || this.kind === 'hud' ? 1 : 0.5));
    const x = this.ctx, S = this.res;
    x.save();
    x.scale(S / 512, S / 512);
    if (!d.displaysOn && this.kind !== 'hud') {
      x.fillStyle = '#020304'; x.fillRect(0, 0, 512, 512);
    } else {
      try { this['draw_' + this.kind](x, d); } catch (e) { console.error('display', this.kind, e); }
    }
    x.restore();
    this.tex.needsUpdate = true;
    return true;
  }

  // ------------------------------------------------------------ PFD
  draw_pfd(x, d) {
    x.fillStyle = C.dark; x.fillRect(0, 0, 512, 512);
    const cx = 256, cy = 225;
    // attitude
    x.save();
    x.beginPath(); x.rect(96, 52, 320, 330); x.clip();
    x.translate(cx, cy);
    x.rotate(-d.bank * DEG);
    const ppd = 6.2;    // pixels per degree pitch
    const off = d.pitch * ppd;
    x.fillStyle = C.sky; x.fillRect(-500, -900 + off, 1000, 900);
    x.fillStyle = C.gnd; x.fillRect(-500, off, 1000, 900);
    x.strokeStyle = C.white; x.lineWidth = 2;
    x.beginPath(); x.moveTo(-500, off); x.lineTo(500, off); x.stroke();
    x.fillStyle = C.white; x.font = 'bold 14px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let p = -90; p <= 90; p += 2.5) {
      if (p === 0) continue;
      const y = off - p * ppd;
      if (Math.abs(y) > 170) continue;
      const w = p % 10 === 0 ? 60 : p % 5 === 0 ? 32 : 16;
      x.beginPath(); x.moveTo(-w, y); x.lineTo(w, y); x.stroke();
      if (p % 10 === 0) { x.fillText(String(Math.abs(p)), -w - 16, y); x.fillText(String(Math.abs(p)), w + 16, y); }
    }
    x.restore();
    // roll scale
    x.save(); x.translate(cx, cy);
    x.strokeStyle = C.white; x.lineWidth = 2;
    x.beginPath(); x.arc(0, 0, 150, (-150) * DEG, (-30) * DEG); x.stroke();
    for (const a of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
      x.save(); x.rotate(a * DEG); x.beginPath(); x.moveTo(0, -150); x.lineTo(0, a % 30 === 0 ? -166 : -158); x.stroke(); x.restore();
    }
    x.fillStyle = C.white; x.beginPath(); x.moveTo(0, -150); x.lineTo(-7, -162); x.lineTo(7, -162); x.fill();
    x.rotate(-d.bank * DEG);
    x.fillStyle = C.amber; x.beginPath(); x.moveTo(0, -148); x.lineTo(-8, -134); x.lineTo(8, -134); x.fill();
    // slip indicator
    x.fillRect(-8 + d.slip * 18, -131, 16, 4);
    x.restore();
    // aircraft symbol
    x.fillStyle = C.amber; x.strokeStyle = '#000'; x.lineWidth = 1.5;
    x.fillRect(cx - 95, cy - 4, 60, 8); x.strokeRect(cx - 95, cy - 4, 60, 8);
    x.fillRect(cx + 35, cy - 4, 60, 8); x.strokeRect(cx + 35, cy - 4, 60, 8);
    x.fillRect(cx - 5, cy - 5, 10, 10);
    // flight director
    if (d.ap && d.ap.engaged) {
      x.strokeStyle = C.magenta; x.lineWidth = 3;
      const fdx = clamp(angDiffDeg(d.hdg, d.ap.hdgTarget ?? d.hdg) * 3, -80, 80), fdy = clamp((d.ap.pitchTarget ?? d.pitch) - d.pitch, -15, 15) * -ppd;
      x.beginPath(); x.moveTo(cx + fdx, cy - 70); x.lineTo(cx + fdx, cy + 70); x.stroke();
      x.beginPath(); x.moveTo(cx - 70, cy + fdy); x.lineTo(cx + 70, cy + fdy); x.stroke();
    }
    // flight path vector
    const fpvY = cy + (d.pitch - d.fpa) * ppd, fpvX = cx + clamp(angDiffDeg(d.hdg, d.track), -20, 20) * ppd;
    x.strokeStyle = C.green; x.lineWidth = 2;
    x.beginPath(); x.arc(fpvX, fpvY, 7, 0, TAU); x.stroke();
    x.beginPath(); x.moveTo(fpvX - 18, fpvY); x.lineTo(fpvX - 7, fpvY); x.moveTo(fpvX + 7, fpvY); x.lineTo(fpvX + 18, fpvY); x.moveTo(fpvX, fpvY - 7); x.lineTo(fpvX, fpvY - 14); x.stroke();
    // speed tape
    this.tape(x, 18, 52, 70, 330, d.iasKt, 10, 1, d.spdBug, d.vspeeds, true, d.iasTrend);
    // altitude tape
    this.tape(x, 424, 52, 70, 330, d.altFt, 100, 0, d.altBug, null, false, null);
    // VSI
    x.fillStyle = C.tape; x.fillRect(496, 90, 14, 260);
    const vy = 220 - clamp(d.vsFpm / 6000, -1, 1) * 120;
    x.strokeStyle = C.white; x.lineWidth = 3; x.beginPath(); x.moveTo(496, 220); x.lineTo(510, vy); x.stroke();
    x.fillStyle = C.white; x.font = 'bold 13px Arial'; x.textAlign = 'right';
    if (Math.abs(d.vsFpm) > 200) x.fillText(String(Math.round(d.vsFpm / 50) * 50), 510, d.vsFpm > 0 ? 82 : 362);
    // heading rose (bottom)
    this.headingStrip(x, 96, 400, 320, 48, d.hdg, d.hdgBug);
    // FMA
    x.fillStyle = '#000'; x.fillRect(96, 6, 320, 40);
    x.strokeStyle = '#555'; x.strokeRect(96, 6, 320, 40);
    x.font = 'bold 15px Arial'; x.textAlign = 'center';
    const ap = d.ap || {};
    x.fillStyle = C.green;
    x.fillText(ap.engaged && ap.at ? 'SPD' : '', 140, 26);
    x.fillText(ap.engaged ? ap.lat : '', 220, 26);
    x.fillText(ap.engaged ? ap.vert : '', 300, 26);
    x.fillStyle = ap.engaged ? C.green : C.grey;
    x.fillText(ap.engaged ? 'AP1' : 'AP OFF', 380, 26);
    // mach / ground speed
    x.textAlign = 'left'; x.fillStyle = C.white; x.font = 'bold 15px Arial';
    if (d.mach > 0.4) x.fillText('M ' + d.mach.toFixed(3).slice(1), 18, 400);
    x.fillText('GS ' + Math.round(d.gsKt), 18, 420);
    // radio altitude
    if (d.aglFt < 2500) { x.textAlign = 'center'; x.font = 'bold 22px Arial'; x.fillStyle = d.aglFt < 200 ? C.amber : C.white; x.fillText(String(Math.round(d.aglFt)), cx, 365); }
    // ILS deviation
    if (d.ils) {
      x.fillStyle = C.magenta;
      const gy = cy + clamp(d.ils.gs / 60, -1, 1) * 110, lx = cx + clamp(d.ils.loc / 300, -1, 1) * 110;
      x.beginPath(); x.moveTo(410, gy); x.lineTo(402, gy - 7); x.lineTo(394, gy); x.lineTo(402, gy + 7); x.fill();
      x.beginPath(); x.moveTo(lx, 384); x.lineTo(lx - 7, 376); x.lineTo(lx, 368); x.lineTo(lx + 7, 376); x.fill();
    }
    // stall warning band
    if (d.stall) { x.fillStyle = C.red; x.font = 'bold 26px Arial'; x.textAlign = 'center'; x.fillText('STALL', cx, 120); }
    if (d.warnTop) { x.fillStyle = d.warnTop.level === 'warning' ? C.red : C.amber; x.font = 'bold 20px Arial'; x.textAlign = 'center'; x.fillText(d.warnTop.text, cx, 340); }
  }

  tape(x, X, Y, W, H, value, step, decimals, bug, vsp, left, trend) {
    x.save();
    x.fillStyle = C.tape; x.fillRect(X, Y, W, H);
    x.beginPath(); x.rect(X, Y, W, H); x.clip();
    const cy = Y + H / 2;
    const pps = left ? 4.0 : 0.45;       // px per unit
    x.strokeStyle = C.white; x.fillStyle = C.white; x.lineWidth = 2; x.font = 'bold 15px Arial';
    x.textAlign = left ? 'right' : 'left'; x.textBaseline = 'middle';
    const range = H / 2 / pps;
    const s0 = Math.floor((value - range) / step) * step;
    for (let v = s0; v <= value + range; v += step) {
      if (left && v < 0) continue;
      const y = cy - (v - value) * pps;
      const major = left ? v % (step * 2) === 0 : v % (step * 5) === 0;
      if (left) { x.beginPath(); x.moveTo(X + W - (major ? 14 : 8), y); x.lineTo(X + W, y); x.stroke(); if (major) x.fillText(String(v), X + W - 18, y); }
      else { x.beginPath(); x.moveTo(X, y); x.lineTo(X + (major ? 14 : 8), y); x.stroke(); if (major) x.fillText(String(v), X + 18, y); }
    }
    if (vsp) {
      x.fillStyle = C.green; x.font = 'bold 12px Arial';
      for (const [k, v] of Object.entries(vsp)) { const y = cy - (v - value) * pps; x.fillText(k, X + W - 4, y); }
    }
    if (bug !== null && bug !== undefined) {
      const y = clamp(cy - (bug - value) * pps, Y + 4, Y + H - 4);
      x.fillStyle = C.magenta;
      if (left) { x.fillRect(X + W - 6, y - 8, 6, 16); } else { x.fillRect(X, y - 8, 6, 16); }
    }
    if (trend) {
      x.strokeStyle = C.green; x.lineWidth = 3;
      x.beginPath(); x.moveTo(X + W - 3, cy); x.lineTo(X + W - 3, cy - clamp(trend * 10, -150, 150) * pps); x.stroke();
    }
    x.restore();
    // readout box
    x.fillStyle = '#000'; x.strokeStyle = C.white; x.lineWidth = 2;
    x.fillRect(X - 2, cy - 17, W + 4, 34); x.strokeRect(X - 2, cy - 17, W + 4, 34);
    x.fillStyle = C.white; x.font = 'bold 21px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(Math.round(value)), X + W / 2, cy + 1);
    if (bug !== null && bug !== undefined) {
      x.fillStyle = C.magenta; x.font = 'bold 15px Arial';
      x.fillText(String(Math.round(bug)), X + W / 2, Y - 14 + (left ? 0 : 0));
    }
  }

  headingStrip(x, X, Y, W, H, hdg, bug) {
    x.save();
    x.fillStyle = C.tape; x.fillRect(X, Y, W, H);
    x.beginPath(); x.rect(X, Y, W, H); x.clip();
    const cx = X + W / 2, ppd = 4.2;
    x.strokeStyle = C.white; x.fillStyle = C.white; x.lineWidth = 2; x.font = 'bold 15px Arial'; x.textAlign = 'center'; x.textBaseline = 'top';
    for (let a = Math.floor(hdg - 40); a <= hdg + 40; a++) {
      if (a % 5) continue;
      const px = cx + (a - hdg) * ppd;
      x.beginPath(); x.moveTo(px, Y); x.lineTo(px, Y + (a % 10 ? 7 : 13)); x.stroke();
      if (a % 30 === 0) { const v = wrap360(a); x.fillText(v === 0 ? 'N' : v === 90 ? 'E' : v === 180 ? 'S' : v === 270 ? 'W' : String(v / 10), px, Y + 16); }
    }
    if (bug !== null && bug !== undefined) { const px = cx + angDiffDeg(hdg, bug) * ppd; x.fillStyle = C.magenta; x.fillRect(px - 6, Y, 12, 6); }
    x.restore();
    x.fillStyle = '#000'; x.strokeStyle = C.white; x.fillRect(cx - 28, Y - 26, 56, 24); x.strokeRect(cx - 28, Y - 26, 56, 24);
    x.fillStyle = C.white; x.font = 'bold 18px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(pad(wrap360(Math.round(hdg)) || 360, 3), cx, Y - 13);
  }

  // ------------------------------------------------------------ Navigation display / moving map
  draw_nd(x, d) {
    x.fillStyle = C.dark; x.fillRect(0, 0, 512, 512);
    const cx = 256, cy = 400, R = 330;
    const rangeNm = d.ndRange || 20;
    const ppm = R / (rangeNm * NM);
    // map: airports & runways (heading-up)
    x.save();
    x.beginPath(); x.rect(0, 40, 512, 472); x.clip();
    x.translate(cx, cy);
    x.rotate(-d.hdg * DEG);
    for (const ap of AIRPORTS) {
      const dx = (ap.x - d.x) * ppm, dz = (ap.z - d.z) * ppm;
      if (dx * dx + dz * dz > (R * 1.4) ** 2) continue;
      x.strokeStyle = C.cyan; x.lineWidth = 3;
      for (const rw of ap.runways) {
        const e = runwayEnds(ap, rw);
        x.beginPath(); x.moveTo((e.a.x - d.x) * ppm, (e.a.z - d.z) * ppm); x.lineTo((e.b.x - d.x) * ppm, (e.b.z - d.z) * ppm); x.stroke();
      }
      x.save(); x.translate(dx, dz); x.rotate(d.hdg * DEG);
      x.strokeStyle = C.cyan; x.lineWidth = 1.5; x.beginPath(); x.arc(0, 0, 7, 0, TAU); x.stroke();
      x.fillStyle = C.cyan; x.font = 'bold 15px Arial'; x.textAlign = 'left'; x.fillText(ap.icao, 11, -4);
      x.restore();
    }
    // route line to destination
    if (d.dest) {
      x.strokeStyle = C.magenta; x.lineWidth = 3;
      x.beginPath(); x.moveTo(0, 0); x.lineTo((d.dest.x - d.x) * ppm, (d.dest.z - d.z) * ppm); x.stroke();
    }
    x.restore();
    // compass arc
    x.save(); x.translate(cx, cy);
    x.strokeStyle = C.white; x.lineWidth = 2;
    x.beginPath(); x.arc(0, 0, R, -Math.PI / 2 - 0.85, -Math.PI / 2 + 0.85); x.stroke();
    x.setLineDash([6, 8]); x.beginPath(); x.arc(0, 0, R / 2, -Math.PI / 2 - 0.85, -Math.PI / 2 + 0.85); x.stroke(); x.setLineDash([]);
    x.fillStyle = C.white; x.font = 'bold 16px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 5) {
      const rel = angDiffDeg(d.hdg, a);
      if (Math.abs(rel) > 50) continue;
      x.save(); x.rotate(rel * DEG);
      x.beginPath(); x.moveTo(0, -R); x.lineTo(0, -R + (a % 10 ? 8 : 15)); x.stroke();
      if (a % 30 === 0) x.fillText(String(a / 10), 0, -R + 30);
      x.restore();
    }
    // heading bug
    if (d.hdgBug !== null && d.hdgBug !== undefined) { x.save(); x.rotate(angDiffDeg(d.hdg, d.hdgBug) * DEG); x.fillStyle = C.magenta; x.fillRect(-8, -R - 10, 16, 10); x.restore(); }
    // track line
    x.save(); x.rotate(angDiffDeg(d.hdg, d.track) * DEG); x.strokeStyle = C.green; x.setLineDash([10, 8]); x.beginPath(); x.moveTo(0, -18); x.lineTo(0, -R); x.stroke(); x.restore();
    // own aircraft
    x.strokeStyle = C.white; x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, -16); x.lineTo(0, 22); x.moveTo(-16, 0); x.lineTo(16, 0); x.moveTo(-7, 18); x.lineTo(7, 18); x.stroke();
    x.restore();
    // header data
    x.fillStyle = C.white; x.font = 'bold 17px Arial'; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    x.fillText(`GS ${Math.round(d.gsKt)}  TAS ${Math.round(d.tasKt)}`, 12, 26);
    // wind arrow
    if (d.windKt > 1) {
      x.fillText(`${pad(Math.round(d.windDir), 3)}°/${Math.round(d.windKt)}`, 12, 50);
      x.save(); x.translate(40, 82); x.rotate((d.windDir + 180 - d.hdg) * DEG);
      x.strokeStyle = C.white; x.lineWidth = 3; x.beginPath(); x.moveTo(0, -16); x.lineTo(0, 16); x.moveTo(-6, 9); x.lineTo(0, 16); x.lineTo(6, 9); x.stroke(); x.restore();
    }
    x.textAlign = 'right';
    if (d.dest) {
      x.fillStyle = C.magenta; x.fillText(d.dest.icao, 500, 26);
      x.fillStyle = C.white; x.fillText(`${(d.dest.dist / NM).toFixed(1)} NM`, 500, 48);
      const eta = d.gsKt > 20 ? d.dest.dist / NM / d.gsKt * 60 : 0;
      x.fillText(eta ? `${Math.floor(eta)}:${pad(Math.round((eta % 1) * 60), 2)}` : '--:--', 500, 70);
    }
    x.fillStyle = C.cyan; x.textAlign = 'left'; x.fillText(`${rangeNm} NM`, 12, 500);
    x.fillStyle = C.green; x.textAlign = 'center'; x.fillText(pad(wrap360(Math.round(d.hdg)) || 360, 3) + ' MAG', 256, 26);
  }

  // ------------------------------------------------------------ Engine indication & crew alerting
  draw_eicas(x, d) {
    x.fillStyle = C.dark; x.fillRect(0, 0, 512, 512);
    const n = d.engines.length;
    const type = d.engineType;
    const cols = Math.min(n, 4);
    const w = 300 / cols;
    for (let i = 0; i < cols; i++) {
      const e = d.engines[i];
      const ex = 20 + w * i + w / 2;
      if (type === 'turbofan') {
        this.arcGauge(x, ex, 70, w * 0.4, e.n1 * 100, 0, 110, 'N1', e.n1 * 100, 100);
        this.arcGauge(x, ex, 180, w * 0.4, e.egt, 0, 1000, 'EGT', e.egt, 900);
        x.fillStyle = C.white; x.font = 'bold 15px Arial'; x.textAlign = 'center';
        x.fillText('N2 ' + (e.n2 * 100).toFixed(1), ex, 255);
        x.fillText('FF ' + (e.ff * 3600).toFixed(0), ex, 275);
        if (e.ab > 0.5) { x.fillStyle = C.amber; x.fillText('REHEAT', ex, 295); }
      } else if (type === 'turboprop') {
        this.arcGauge(x, ex, 70, w * 0.4, e.torque * 100, 0, 120, 'TQ', e.torque * 100, 100);
        this.arcGauge(x, ex, 180, w * 0.4, e.egt, 0, 1000, 'ITT', e.egt, 800);
        x.fillStyle = C.white; x.font = 'bold 15px Arial'; x.textAlign = 'center';
        x.fillText('NP ' + Math.round(e.rpm), ex, 255);
        x.fillText('NG ' + (e.n2 * 100).toFixed(1), ex, 275);
      } else if (type === 'turboshaft') {
        this.arcGauge(x, ex, 70, w * 0.4, e.torque * 100, 0, 120, 'TQ', e.torque * 100, 100);
        this.arcGauge(x, ex, 180, w * 0.4, e.egt, 0, 1000, 'TOT', e.egt, 850);
        x.fillStyle = C.white; x.font = 'bold 15px Arial'; x.textAlign = 'center';
        x.fillText('NG ' + (e.n1 * 100).toFixed(1), ex, 255);
      } else {
        this.arcGauge(x, ex, 70, w * 0.4, e.rpm, 0, 3000, 'RPM', e.rpm, 2700);
        this.arcGauge(x, ex, 180, w * 0.4, e.map || 0, 10, 35, 'MAP', e.map || 0, 32);
      }
      x.fillStyle = e.oilP < (e.oilPmax || 60) * 0.3 && e.running ? C.amber : C.white;
      x.font = 'bold 14px Arial'; x.textAlign = 'center';
      x.fillText(`OIL ${Math.round(e.oilP)}  ${Math.round(e.oilT)}°`, ex, 315);
      if (e.fire && !e.extinguished) { x.fillStyle = C.red; x.fillRect(ex - w * 0.42, 325, w * 0.84, 22); x.fillStyle = '#fff'; x.fillText('FIRE', ex, 341); }
      else if (e.failed && !e.running) { x.fillStyle = C.amber; x.fillText('FAIL', ex, 341); }
      else if (e.state === 'cranking' || e.state === 'lightoff') { x.fillStyle = C.green; x.fillText(e.state === 'cranking' ? 'START' : 'IGN', ex, 341); }
    }
    if (d.isHeli) {
      x.fillStyle = C.white; x.font = 'bold 18px Arial'; x.textAlign = 'center';
      x.fillStyle = d.nr < 0.92 || d.nr > 1.06 ? C.red : C.green;
      x.fillText(`NR ${(d.nr * 100).toFixed(0)}%`, 160, 380);
    }
    // fuel, config
    x.fillStyle = C.white; x.font = 'bold 16px Arial'; x.textAlign = 'left';
    x.fillText(`FUEL ${Math.round(d.fuelKg)} KG`, 20, 410);
    x.fillText(`GW ${(d.massKg / 1000).toFixed(1)} T`, 20, 432);
    if (!d.isHeli) {
      x.fillText(`FLAPS ${Math.round(d.flapDeg)}`, 20, 456);
      if (d.retract) {
        const gc = d.gearPos > 0.99 ? C.green : d.gearPos < 0.01 ? C.grey : C.amber;
        x.fillStyle = gc; x.fillText(d.gearPos > 0.99 ? 'GEAR DOWN' : d.gearPos < 0.01 ? 'GEAR UP' : 'GEAR TRANSIT', 20, 480);
      }
      if (d.spoilers > 0.1) { x.fillStyle = C.cyan; x.fillText('SPD BRK', 160, 456); }
      if (d.reverse > 0.1) { x.fillStyle = C.green; x.fillText('REV', 160, 480); }
    }
    // alerts list
    x.font = 'bold 16px Arial'; x.textAlign = 'left';
    let y = 30;
    for (const w of d.warnings.slice(0, 14)) {
      x.fillStyle = w.level === 'warning' ? C.red : C.amber;
      x.fillText(w.text, 330, y);
      y += 24;
    }
    x.strokeStyle = '#444'; x.beginPath(); x.moveTo(320, 10); x.lineTo(320, 500); x.stroke();
  }

  arcGauge(x, cx, cy, r, v, v0, v1, label, readout, red) {
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.0;
    const t = clamp((v - v0) / (v1 - v0), 0, 1.05);
    x.strokeStyle = '#555'; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, r, a0, a1); x.stroke();
    const tr = clamp((red - v0) / (v1 - v0), 0, 1);
    x.strokeStyle = C.red; x.lineWidth = 4; x.beginPath(); x.arc(cx, cy, r, a0 + (a1 - a0) * tr, a1); x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.18)'; x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, r - 2, a0, a0 + (a1 - a0) * t); x.closePath(); x.fill();
    const a = a0 + (a1 - a0) * t;
    x.strokeStyle = v > red ? C.red : C.white; x.lineWidth = 3; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); x.stroke();
    x.fillStyle = v > red ? C.red : C.white; x.font = 'bold 16px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(readout >= 100 ? Math.round(readout) : readout.toFixed(1), cx + r * 0.35, cy + r * 0.55);
    x.fillStyle = C.cyan; x.font = 'bold 13px Arial'; x.fillText(label, cx - r * 0.45, cy + r * 0.55);
  }

  // ------------------------------------------------------------ GA multi-function display (map + engine strip)
  draw_mfd(x, d) {
    // reuse ND map in the right part, engine strip on the left
    this.draw_nd(x, { ...d, ndRange: d.ndRange || 10 });
    x.fillStyle = 'rgba(8,10,12,0.92)'; x.fillRect(0, 90, 120, 422);
    const e = d.engines[0] || {};
    const bar = (y, label, v, v0, v1, txt, red) => {
      x.fillStyle = C.cyan; x.font = 'bold 13px Arial'; x.textAlign = 'left'; x.fillText(label, 8, y);
      x.fillStyle = '#333'; x.fillRect(8, y + 6, 104, 10);
      const t = clamp((v - v0) / (v1 - v0), 0, 1);
      x.fillStyle = red && v > red ? C.red : C.green; x.fillRect(8, y + 6, 104 * t, 10);
      x.fillStyle = C.white; x.textAlign = 'right'; x.fillText(txt, 112, y);
    };
    bar(110, 'RPM', e.rpm || 0, 0, 2800, String(Math.round(e.rpm || 0)), 2700);
    bar(150, 'MAP', e.map || 0, 10, 32, (e.map || 0).toFixed(1));
    bar(190, 'FFLOW', (e.ff || 0) * 3600 / 2.72, 0, 25, ((e.ff || 0) * 3600 / 2.72).toFixed(1));
    bar(230, 'OIL P', e.oilP || 0, 0, 100, String(Math.round(e.oilP || 0)));
    bar(270, 'OIL T', e.oilT || 0, 0, 140, String(Math.round(e.oilT || 0)), 120);
    bar(310, 'EGT', e.egt || 0, 0, 900, String(Math.round(e.egt || 0)));
    bar(350, 'CHT', e.cht || 0, 0, 260, String(Math.round(e.cht || 0)), 230);
    bar(390, 'FUEL', d.fuelKg, 0, d.fuelMax, String(Math.round(d.fuelKg / 0.72 / 3.785)) + ' gal');
    bar(430, 'VOLTS', d.volts, 0, 32, d.volts.toFixed(1));
    x.fillStyle = C.white; x.font = 'bold 13px Arial'; x.textAlign = 'left'; x.fillText(`OAT ${Math.round(d.oat)}°C`, 8, 480);
  }

  // ------------------------------------------------------------ HUD (green symbology on transparent combiner)
  draw_hud(x, d) {
    x.clearRect(0, 0, 512, 512);
    x.fillStyle = 'rgba(0,0,0,1)'; x.fillRect(0, 0, 512, 512);
    const g = '#48ff7a';
    x.strokeStyle = g; x.fillStyle = g; x.lineWidth = 2.5; x.font = 'bold 18px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const cx = 256, cy = 256, ppd = 9;
    x.save(); x.translate(cx, cy); x.rotate(-d.bank * DEG);
    for (let p = -30; p <= 30; p += 5) {
      const y = (d.pitch - p) * ppd;
      if (Math.abs(y) > 230) continue;
      if (p === 0) { x.beginPath(); x.moveTo(-230, y); x.lineTo(-40, y); x.moveTo(40, y); x.lineTo(230, y); x.stroke(); continue; }
      x.setLineDash(p < 0 ? [10, 8] : []);
      x.beginPath(); x.moveTo(-90, y); x.lineTo(-35, y); x.lineTo(-35, y + (p > 0 ? 8 : -8)); x.moveTo(90, y); x.lineTo(35, y); x.lineTo(35, y + (p > 0 ? 8 : -8)); x.stroke();
      x.setLineDash([]);
      x.fillText(String(p), -110, y); x.fillText(String(p), 110, y);
    }
    x.restore();
    // FPV
    const fx = cx + clamp(angDiffDeg(d.hdg, d.track), -15, 15) * ppd, fy = cy + (d.pitch - d.fpa) * ppd;
    x.beginPath(); x.arc(fx, fy, 9, 0, TAU); x.moveTo(fx - 24, fy); x.lineTo(fx - 9, fy); x.moveTo(fx + 9, fy); x.lineTo(fx + 24, fy); x.moveTo(fx, fy - 9); x.lineTo(fx, fy - 18); x.stroke();
    // boresight
    x.beginPath(); x.moveTo(cx - 12, cy); x.lineTo(cx - 4, cy); x.moveTo(cx + 4, cy); x.lineTo(cx + 12, cy); x.moveTo(cx, cy - 8); x.lineTo(cx, cy - 3); x.stroke();
    // speed / altitude boxes
    x.strokeRect(30, cy - 18, 84, 36); x.strokeRect(398, cy - 18, 90, 36);
    x.font = 'bold 22px Arial';
    x.fillText(String(Math.round(d.iasKt)), 72, cy); x.fillText(String(Math.round(d.altFt)), 443, cy);
    x.font = 'bold 16px Arial';
    x.fillText('G ' + d.g.toFixed(1), 72, cy + 40); x.fillText('M ' + d.mach.toFixed(2), 72, cy + 62);
    x.fillText(Math.round(d.vsFpm) + ' VS', 443, cy + 40);
    if (d.aglFt < 1500) x.fillText(Math.round(d.aglFt) + ' R', 443, cy + 62);
    // heading tape top
    for (let a = Math.floor(d.hdg - 25); a <= d.hdg + 25; a++) {
      if (a % 5) continue;
      const px = cx + (a - d.hdg) * 8;
      x.beginPath(); x.moveTo(px, 20); x.lineTo(px, a % 10 ? 28 : 34); x.stroke();
      if (a % 10 === 0) x.fillText(pad(wrap360(a) / 10, 2), px, 48);
    }
    x.beginPath(); x.moveTo(cx, 16); x.lineTo(cx - 6, 6); x.lineTo(cx + 6, 6); x.closePath(); x.fill();
    if (d.stall) { x.font = 'bold 30px Arial'; x.fillText('AOA', cx, cy + 120); }
  }

  // ------------------------------------------------------------ CDU / FMS (route legs page)
  draw_cdu(x, d) {
    x.fillStyle = '#040506'; x.fillRect(0, 0, 512, 512);
    x.textBaseline = 'middle';
    const row = (i) => 70 + i * 52;
    x.font = 'bold 34px monospace'; x.fillStyle = C.white; x.textAlign = 'center';
    x.fillText(d.ap && d.ap.engaged ? 'ACT RTE 1 LEGS' : 'RTE 1 LEGS', 256, 30);
    x.textAlign = 'right'; x.font = '26px monospace'; x.fillText('1/2', 500, 30);
    x.textAlign = 'left';
    const dest = d.dest;
    const distNm = dest ? dest.dist / 1852 : 0;
    const ete = dest && d.gsKt > 30 ? distNm / d.gsKt * 60 : null;
    const lines = [];
    if (dest) {
      const brg = (Math.atan2(dest.x - d.x, -(dest.z - d.z)) * 180 / Math.PI + 360) % 360;
      lines.push(['DIRECT', `${String(Math.round(brg)).padStart(3, '0')}°`, C.white]);
      lines.push([dest.icao || 'DEST', `${distNm.toFixed(1)}NM`, C.magenta]);
      lines.push(['ETE', ete != null ? `${Math.floor(ete / 60)}+${String(Math.round(ete % 60)).padStart(2, '0')}` : '----', C.green]);
    } else {
      lines.push(['NO ROUTE', '', C.amber]);
      lines.push(['', '', C.white]);
      lines.push(['', '', C.white]);
    }
    const cruise = d.apState ? d.apState.alt : 0;
    lines.push(['CRZ ALT', cruise >= 18000 ? 'FL' + Math.round(cruise / 100) : String(Math.round(cruise)), C.cyan]);
    lines.push(['FUEL', `${(d.fuelKg / 1000).toFixed(1)}T`, C.white]);
    lines.push(['GW', `${(d.massKg / 1000).toFixed(1)}T`, C.white]);
    lines.push(['SPD/MACH', d.mach > 0.5 ? '.' + Math.round(d.mach * 100) : String(Math.round(d.iasKt)), C.green]);
    lines.forEach(([l, r, col], i) => {
      x.font = '22px monospace'; x.fillStyle = C.grey; x.fillText(l, 18, row(i) - 14);
      x.font = 'bold 34px monospace'; x.fillStyle = col; x.textAlign = 'right'; x.fillText(r, 494, row(i) + 10); x.textAlign = 'left';
    });
    x.fillStyle = C.white; x.font = 'bold 28px monospace';
    x.fillText('<INDEX', 14, 480); x.textAlign = 'right'; x.fillText('ROUTE>', 498, 480); x.textAlign = 'left';
  }

  // ------------------------------------------------------------ standby instrument (small, always powered)
  draw_standby(x, d) {
    x.fillStyle = C.dark; x.fillRect(0, 0, 512, 512);
    x.save(); x.beginPath(); x.rect(60, 60, 392, 392); x.clip();
    x.translate(256, 256); x.rotate(-d.bank * DEG);
    const off = d.pitch * 8;
    x.fillStyle = C.sky; x.fillRect(-400, -800 + off, 800, 800);
    x.fillStyle = C.gnd; x.fillRect(-400, off, 800, 800);
    x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.moveTo(-400, off); x.lineTo(400, off); x.stroke();
    x.restore();
    x.fillStyle = C.amber; x.fillRect(150, 250, 80, 12); x.fillRect(282, 250, 80, 12);
    x.fillStyle = '#fff'; x.font = 'bold 44px Arial'; x.textAlign = 'center';
    x.fillText(String(Math.round(d.iasKt)), 256, 120); x.fillText(String(Math.round(d.altFt)), 256, 430);
  }
}
