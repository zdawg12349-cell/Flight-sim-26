// Airport and heliport definitions.
// Every airport has a frame heading `fh` (true degrees). Local coordinates are (u, v):
//   u = metres along the frame heading, v = metres to the right of it.
// For fh = 90 (KPXR) this is simply u = east, v = south.
// Building fields: u,v,w (extent along u), d (extent along v), h, front ('L' = faces -v, 'R' = +v, 'B' both).
// Gate fields: nose = direction the parked aircraft points: 'L' (-v), 'R' (+v), 'F' (+u), 'B' (-u).

function conn(us, v0, v1, w = 23) { return us.map((u) => ({ w, pts: [[u, v0], [u, v1]] })); }

export const AIRPORTS = [
  {
    icao: 'KPXR', name: 'Port Aurelia International', short: 'Port Aurelia Intl', x: 0, z: 0, fh: 90, elev: 14, type: 'international',
    desc: 'Major coastal hub with two parallel runways, a crosswind runway, 16 gates, cargo, maintenance and a full rescue & fire-fighting station.',
    freq: { atis: '127.25', ground: '121.90', tower: '118.70', approach: '124.35' },
    runways: [
      { name: '09L', recip: '27R', u: 0, v: -700, hdg: 90, len: 3800, wid: 60, surface: 'asphalt', ils: true, als: true },
      { name: '09R', recip: '27L', u: 300, v: 700, hdg: 90, len: 3200, wid: 45, surface: 'asphalt', ils: true, als: true },
      { name: '15', recip: '33', u: -2900, v: 0, hdg: 150, len: 2500, wid: 45, surface: 'asphalt', ils: false, als: false },
    ],
    taxiways: [
      { w: 25, pts: [[-1900, -520], [1900, -520]], name: 'A' },
      ...conn([-1900, -1300, -600, 0, 600, 1200, 1900], -520, -668, 25),
      { w: 25, pts: [[-1300, 520], [1900, 520]], name: 'B' },
      ...conn([-1300, -700, 0, 700, 1300, 1900], 520, 676, 25),
      ...conn([-350, 100, 600], -380, -520, 25),
      ...conn([-350, 100, 600], 380, 520, 25),
      { w: 23, pts: [[-1900, -520], [-2400, -420], [-2770, -225]], name: 'C' },
      { w: 23, pts: [[-1300, 520], [-2200, 520], [-2595, 530]], name: 'D' },
      { w: 20, pts: [[-1000, -380], [-1000, -520]] },
      { w: 20, pts: [[-1700, 20], [-1700, -520]] },
    ],
    aprons: [
      { u: 125, v: 0, w: 1150, l: 760 },
      { u: -1000, v: -150, w: 560, l: 460 },
      { u: -1700, v: 150, w: 380, l: 260 },
    ],
    buildings: [
      { type: 'terminal', u: 150, v: 0, w: 820, d: 64, h: 21, front: 'B' },
      { type: 'tower', u: -560, v: 230, h: 74 },
      { type: 'firestation', u: -560, v: 380, w: 70, d: 32, h: 11, front: 'R' },
      { type: 'cargo', u: -1000, v: 150, w: 320, d: 70, h: 18, front: 'L' },
      { type: 'hangar', u: -1600, v: 340, w: 110, d: 80, h: 30, front: 'L' },
      { type: 'hangar', u: -1780, v: 340, w: 90, d: 70, h: 26, front: 'L' },
      { type: 'hangar', u: -1430, v: 340, w: 70, d: 60, h: 20, front: 'L' },
      { type: 'fuelfarm', u: -1250, v: 330 },
      { type: 'office', u: -760, v: 300, w: 90, d: 40, h: 14, front: 'L' },
      { type: 'garage', u: 900, v: 0, w: 160, d: 220, h: 16 },
      { type: 'office', u: 1110, v: -150, w: 120, d: 45, h: 34, front: 'L' },
      { type: 'office', u: 1110, v: 150, w: 110, d: 50, h: 46, front: 'R' },
      { type: 'radar', u: -2200, v: -300 },
      { type: 'carpark', u: 1080, v: 340, w: 260, d: 160 },
      { type: 'police', u: 800, v: 300, w: 40, d: 24, h: 8, front: 'R' },
    ],
    gates: [
      ...[-180, -80, 20, 120, 220, 320, 420, 520].map((u, i) => ({ u, v: -60, nose: 'R', bridge: true, name: 'A' + (i + 1) })),
      ...[-180, -80, 20, 120, 220, 320, 420, 520].map((u, i) => ({ u, v: 60, nose: 'L', bridge: true, name: 'B' + (i + 1) })),
      { u: -1150, v: -230, nose: 'R', name: 'C1', cargo: true }, { u: -1000, v: -230, nose: 'R', name: 'C2', cargo: true },
      { u: -850, v: -230, nose: 'R', name: 'C3', cargo: true },
      { u: -1790, v: 150, nose: 'B', name: 'G1', ga: true }, { u: -1690, v: 110, nose: 'L', name: 'G2', ga: true },
      { u: -1610, v: 110, nose: 'L', name: 'G3', ga: true },
    ],
    helipads: [{ u: -1850, v: 230, name: 'H1' }],
    fireStation: { u: -560, v: 410, nose: 'R' },
    policeStation: { u: 800, v: 330, nose: 'R' },
    serviceLoops: [
      [[-350, -175], [600, -175], [600, -40], [-350, -40]],
      [[-350, 175], [600, 175], [600, 40], [-350, 40]],
      [[-1250, -300], [-750, -300], [-750, 40], [-1250, 40]],
    ],
  },
  {
    icao: 'KMVL', name: 'Marlow Valley Regional', short: 'Marlow Regional', x: 6000, z: -20000, fh: 0, elev: 168, type: 'regional',
    desc: 'Regional airport among farmland and forests. Single 2,400 m runway with ILS, small terminal and fire station.',
    freq: { atis: '126.80', ground: '121.75', tower: '119.10', approach: '124.35' },
    runways: [{ name: '36', recip: '18', u: 0, v: 0, hdg: 0, len: 2400, wid: 45, surface: 'asphalt', ils: true, als: true }],
    taxiways: [
      { w: 20, pts: [[-1200, 190], [1200, 190]], name: 'A' },
      ...conn([-1200, -400, 300, 1200], 190, 24, 20),
      ...conn([-110, 140], 190, 290, 20),
    ],
    aprons: [{ u: 0, v: 380, w: 380, l: 200 }],
    buildings: [
      { type: 'terminal', u: 0, v: 520, w: 230, d: 40, h: 13, front: 'L' },
      { type: 'tower', u: 260, v: 500, h: 36 },
      { type: 'firestation', u: -270, v: 470, w: 40, d: 24, h: 9, front: 'L' },
      { type: 'hangar', u: -420, v: 470, w: 70, d: 60, h: 20, front: 'L' },
      { type: 'hangar', u: 420, v: 470, w: 60, d: 50, h: 18, front: 'L' },
      { type: 'carpark', u: 0, v: 640, w: 200, d: 110 },
      { type: 'fuelfarm', u: 380, v: 600 },
    ],
    gates: [
      { u: 110, v: 380, nose: 'R', name: '1' }, { u: 30, v: 380, nose: 'R', name: '2' },
      { u: -50, v: 380, nose: 'R', name: '3' }, { u: -130, v: 380, nose: 'R', name: '4' },
    ],
    helipads: [{ u: 220, v: 360, name: 'H1' }],
    fireStation: { u: -270, v: 445, nose: 'L' },
    policeStation: { u: 150, v: 640, nose: 'L' },
    serviceLoops: [[[150, 300], [150, 460], [-170, 460], [-170, 300]]],
  },
  {
    icao: 'KSKP', name: 'Summit Peak Airport', short: 'Summit Peak', x: 15000, z: -31000, fh: 50, elev: 1390, type: 'mountain',
    desc: 'High-altitude valley airport surrounded by peaks over 2,600 m. Thin air, gusty valley winds and a challenging approach.',
    freq: { atis: '128.45', ground: '121.60', tower: '118.25', approach: '125.05' },
    runways: [{ name: '05', recip: '23', u: 0, v: 0, hdg: 50, len: 2100, wid: 40, surface: 'asphalt', ils: false, als: true }],
    taxiways: [
      { w: 18, pts: [[-1050, 160], [1050, 160]], name: 'A' },
      ...conn([-1050, 0, 1050], 160, 21, 18),
      ...conn([-90, 90], 160, 270, 18),
    ],
    aprons: [{ u: 0, v: 360, w: 320, l: 180 }],
    buildings: [
      { type: 'terminal', u: 0, v: 520, w: 160, d: 32, h: 11, front: 'L' },
      { type: 'tower', u: -230, v: 490, h: 28 },
      { type: 'firestation', u: 230, v: 440, w: 36, d: 22, h: 8, front: 'L' },
      { type: 'hangar', u: -250, v: 380, w: 60, d: 45, h: 16, front: 'L' },
    ],
    gates: [{ u: -90, v: 380, nose: 'R', name: '1' }, { u: 0, v: 380, nose: 'R', name: '2' }, { u: 90, v: 380, nose: 'R', name: '3' }],
    helipads: [{ u: 170, v: 320, name: 'H1' }],
    fireStation: { u: 230, v: 415, nose: 'L' },
    policeStation: { u: 120, v: 560, nose: 'L' },
    serviceLoops: [[[-140, 300], [140, 300], [140, 430], [-140, 430]]],
  },
  {
    icao: 'KBRF', name: 'Birchfield Airfield', short: 'Birchfield', x: -17000, z: -7000, fh: 130, elev: 96, type: 'ga',
    desc: 'Friendly general-aviation field with a 1,050 m paved runway, a grass strip, flying-school hangars and fuel.',
    freq: { atis: '128.05', ground: '122.70', tower: '122.70', approach: '124.35' },
    runways: [
      { name: '13', recip: '31', u: 0, v: 0, hdg: 130, len: 1050, wid: 23, surface: 'asphalt', ils: false, als: false },
      { name: '04', recip: '22', u: -350, v: -380, hdg: 40, len: 680, wid: 30, surface: 'grass', ils: false, als: false },
    ],
    taxiways: [
      { w: 12, pts: [[-525, 90], [525, 90]], name: 'A' },
      ...conn([-525, 0, 525], 90, 12, 12),
      { w: 12, pts: [[-350, -40], [-350, 90]] },
      ...conn([0, 120], 90, 160, 12),
    ],
    aprons: [{ u: 60, v: 200, w: 280, l: 120 }],
    buildings: [
      { type: 'hangar', u: -40, v: 300, w: 40, d: 30, h: 10, front: 'L' },
      { type: 'hangar', u: 10, v: 300, w: 40, d: 30, h: 10, front: 'L' },
      { type: 'hangar', u: 60, v: 300, w: 34, d: 26, h: 9, front: 'L' },
      { type: 'office', u: 130, v: 285, w: 24, d: 14, h: 7, front: 'L' },
      { type: 'tower', u: 175, v: 270, h: 14 },
      { type: 'firestation', u: 220, v: 210, w: 20, d: 14, h: 6, front: 'L' },
      { type: 'fuelfarm', u: -110, v: 220, small: true },
    ],
    gates: [
      { u: -30, v: 200, nose: 'L', name: 'P1', ga: true }, { u: 10, v: 200, nose: 'L', name: 'P2', ga: true },
      { u: 50, v: 200, nose: 'L', name: 'P3', ga: true }, { u: 90, v: 200, nose: 'L', name: 'P4', ga: true },
      { u: 130, v: 200, nose: 'L', name: 'P5', ga: true },
    ],
    helipads: [{ u: 170, v: 180, name: 'H1' }],
    fireStation: { u: 220, v: 195, nose: 'L' },
    policeStation: { u: 260, v: 300, nose: 'L' },
    serviceLoops: [[[-60, 160], [160, 160], [160, 240], [-60, 240]]],
  },
  {
    icao: 'KISL', name: 'Isla Coral Airport', short: 'Isla Coral', x: -15000, z: 21000, fh: 70, elev: 6, type: 'island',
    desc: 'Island airport with a 2,200 m runway right on the shoreline. Expect sea breezes and crosswinds.',
    freq: { atis: '127.60', ground: '121.80', tower: '118.90', approach: '124.35' },
    runways: [{ name: '07', recip: '25', u: 0, v: 0, hdg: 70, len: 2200, wid: 45, surface: 'asphalt', ils: true, als: true }],
    taxiways: [
      { w: 20, pts: [[-1100, -170], [1100, -170]], name: 'A' },
      ...conn([-1100, 0, 1100], -170, -24, 20),
      ...conn([-180, 0], -170, -260, 20),
    ],
    aprons: [{ u: -100, v: -330, w: 320, l: 150 }],
    buildings: [
      { type: 'terminal', u: -100, v: -470, w: 220, d: 36, h: 12, front: 'R' },
      { type: 'tower', u: 160, v: -440, h: 30 },
      { type: 'firestation', u: 230, v: -330, w: 40, d: 22, h: 9, front: 'R' },
      { type: 'hangar', u: -390, v: -330, w: 60, d: 50, h: 16, front: 'R' },
    ],
    gates: [
      { u: -200, v: -330, nose: 'L', name: '1' }, { u: -110, v: -330, nose: 'L', name: '2' },
      { u: -20, v: -330, nose: 'L', name: '3' },
    ],
    helipads: [{ u: 120, v: -300, name: 'H1' }],
    fireStation: { u: 230, v: -305, nose: 'R' },
    policeStation: { u: 40, v: -500, nose: 'R' },
    serviceLoops: [[[-260, -270], [40, -270], [40, -400], [-260, -400]]],
  },
  {
    icao: 'HMED', name: 'Aurelia Medical Center Heliport', short: 'Medical Center', x: 11200, z: 2600, fh: 0, elev: 0, type: 'heliport',
    desc: 'Rooftop hospital helipad in downtown Port Aurelia, used for air-ambulance missions.',
    freq: { atis: '', ground: '', tower: '123.05', approach: '124.35' },
    runways: [], taxiways: [], aprons: [],
    buildings: [{ type: 'hospital', u: 0, v: 0, w: 70, d: 50, h: 42 }],
    gates: [], helipads: [{ u: 0, v: 0, name: 'ROOF', roof: 42 }],
    fireStation: { u: 220, v: 160, nose: 'B' }, policeStation: { u: -220, v: 160, nose: 'F' },
    serviceLoops: [],
  },
  {
    icao: 'OP7', name: 'Platform OP-7 (Offshore)', short: 'Offshore OP-7', x: 7000, z: 19500, fh: 30, elev: 0, type: 'offshore',
    desc: 'Offshore production platform 20 km south of Port Aurelia with an elevated helideck for crew-change flights.',
    freq: { atis: '', ground: '', tower: '129.50', approach: '124.35' },
    runways: [], taxiways: [], aprons: [],
    buildings: [{ type: 'platform', u: 0, v: 0, w: 70, d: 50, h: 32 }],
    gates: [], helipads: [{ u: -20, v: 8, name: 'DECK', roof: 38 }],
    fireStation: null, policeStation: null, serviceLoops: [],
  },
];

export const AIRPORT_BY_ID = Object.fromEntries(AIRPORTS.map((a) => [a.icao, a]));

// Frame vectors for an airport: forward f and right r in world (x, z).
export function frame(ap) {
  const r = ap.fh * Math.PI / 180;
  return { fx: Math.sin(r), fz: -Math.cos(r), rx: Math.cos(r), rz: Math.sin(r) };
}

export function toWorld(ap, u, v) {
  const f = frame(ap);
  return [ap.x + u * f.fx + v * f.rx, ap.z + u * f.fz + v * f.rz];
}

export function noseHeading(ap, nose) {
  const off = { F: 0, R: 90, B: 180, L: 270 }[nose] ?? 0;
  return (ap.fh + off + 360) % 360;
}

// Runway end geometry in world coordinates.
export function runwayEnds(ap, rw) {
  const r = rw.hdg * Math.PI / 180;
  const dx = Math.sin(r), dz = -Math.cos(r);
  const [cx, cz] = toWorld(ap, rw.u, rw.v);
  const h = rw.len / 2;
  return {
    a: { name: rw.name, x: cx - dx * h, z: cz - dz * h, hdg: rw.hdg },
    b: { name: rw.recip, x: cx + dx * h, z: cz + dz * h, hdg: (rw.hdg + 180) % 360 },
    dir: [dx, dz], cx, cz,
  };
}

export function allRunwayEnds() {
  const out = [];
  for (const ap of AIRPORTS) {
    for (const rw of ap.runways) {
      const e = runwayEnds(ap, rw);
      out.push({ ap, rw, end: e.a, other: e.b, dir: e.dir, cx: e.cx, cz: e.cz });
      out.push({ ap, rw, end: e.b, other: e.a, dir: [-e.dir[0], -e.dir[1]], cx: e.cx, cz: e.cz });
    }
  }
  return out;
}

// Static elevated platforms used for collision (rooftop helipads, offshore deck).
export function elevatedPlatforms() {
  const out = [];
  for (const ap of AIRPORTS) {
    for (const b of ap.buildings) {
      if (b.type === 'hospital' || b.type === 'platform') {
        const [x, z] = toWorld(ap, b.u, b.v);
        const top = b.type === 'platform' ? 38 : b.h;
        out.push({ x, z, hdg: ap.fh, w: b.w + 4, d: b.d + 4, top, ap: ap.icao });
      }
    }
  }
  return out;
}

// Spawn points for an airport: runway thresholds, gates, helipads.
export function spawnPoints(ap) {
  const out = [];
  for (const rw of ap.runways) {
    const e = runwayEnds(ap, rw);
    const back = 40;
    out.push({ kind: 'runway', label: `Runway ${rw.name}`, x: e.a.x + e.dir[0] * back, z: e.a.z + e.dir[1] * back, hdg: rw.hdg, rw, end: rw.name });
    out.push({ kind: 'runway', label: `Runway ${rw.recip}`, x: e.b.x - e.dir[0] * back, z: e.b.z - e.dir[1] * back, hdg: (rw.hdg + 180) % 360, rw, end: rw.recip });
  }
  for (const g of ap.gates) {
    const [x, z] = toWorld(ap, g.u, g.v);
    out.push({ kind: 'gate', label: `${g.ga ? 'Parking' : g.cargo ? 'Cargo stand' : 'Gate'} ${g.name}`, x, z, hdg: noseHeading(ap, g.nose), gate: g });
  }
  for (const h of ap.helipads) {
    const [x, z] = toWorld(ap, h.u, h.v);
    out.push({ kind: 'helipad', label: `Helipad ${h.name}`, x, z, hdg: ap.fh, roof: h.roof || 0 });
  }
  return out;
}
