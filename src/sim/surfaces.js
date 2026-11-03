// Runway / taxiway / apron lookup in world coordinates (surface type, friction, runway identification).
import { AIRPORTS, toWorld, runwayEnds } from '../world/airportData.js';

class Surfaces {
  constructor() {
    this.runways = [];
    this.taxis = [];
    this.aprons = [];
    for (const ap of AIRPORTS) {
      for (const rw of ap.runways) {
        const e = runwayEnds(ap, rw);
        this.runways.push({ ap, rw, cx: e.cx, cz: e.cz, dx: e.dir[0], dz: e.dir[1], hl: rw.len / 2, hw: rw.wid / 2, grass: rw.surface === 'grass', ends: e, elev: ap.elev });
      }
      const fr = ap.fh * Math.PI / 180;
      for (const a of ap.aprons) {
        const [cx, cz] = toWorld(ap, a.u, a.v);
        this.aprons.push({ cx, cz, dx: Math.sin(fr), dz: -Math.cos(fr), hl: a.w / 2, hw: a.l / 2 });
      }
      for (const t of ap.taxiways) {
        const pts = t.pts.map((p) => toWorld(ap, p[0], p[1]));
        for (let i = 0; i < pts.length - 1; i++) this.taxis.push({ a: pts[i], b: pts[i + 1], hw: t.w / 2 + 3 });
      }
    }
  }
  // Returns the runway (with local coordinates) under a point, or null.
  runwayAt(x, z, margin = 0) {
    for (const r of this.runways) {
      const ox = x - r.cx, oz = z - r.cz;
      const along = ox * r.dx + oz * r.dz;
      const across = -ox * r.dz + oz * r.dx;          // positive to the right of the runway heading
      if (Math.abs(along) <= r.hl + margin && Math.abs(across) <= r.hw + margin) return { r, along, across };
    }
    return null;
  }
  // 'runway' | 'taxiway' | 'apron' | 'grass'
  typeAt(x, z) {
    const rw = this.runwayAt(x, z, 2);
    if (rw) return rw.r.grass ? 'grass' : 'runway';
    for (const a of this.aprons) {
      const ox = x - a.cx, oz = z - a.cz;
      if (Math.abs(ox * a.dx + oz * a.dz) <= a.hl && Math.abs(ox * a.dz - oz * a.dx) <= a.hw) return 'apron';
    }
    for (const t of this.taxis) {
      const [ax, az] = t.a, [bx, bz] = t.b;
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const s = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const qx = ax + dx * s - x, qz = az + dz * s - z;
      if (qx * qx + qz * qz <= t.hw * t.hw) return 'taxiway';
    }
    return 'grass';
  }
}

export const surfaces = new Surfaces();

export function frictionFor(type, wetness = 0, snow = 0) {
  let mu = type === 'grass' ? 0.42 : 0.82;
  let roll = type === 'grass' ? 0.055 : 0.016;
  mu *= 1 - 0.38 * wetness - 0.55 * snow;
  roll += snow * 0.02;
  return { mu: Math.max(0.12, mu), roll };
}
