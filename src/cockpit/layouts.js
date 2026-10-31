// Cockpit layout descriptions (one per aircraft family / aircraft). Positions are relative to the
// pilot's eye point: x right, y up; panel items are placed on the panel plane in panel-local metres.
//
// Gauge kinds: asi alt vsi hdg turn adi rpm map n1 n2 egt itt torque np dual heliTach g clock fuelflow
// Display kinds: pfd nd eicas mfd hud standby

const six = (x0, y0, s, gap = 0.012) => [
  { g: 'asi', x: x0, y: y0, s }, { g: 'adi', x: x0 + s + gap, y: y0, s }, { g: 'alt', x: x0 + 2 * (s + gap), y: y0, s },
  { g: 'turn', x: x0, y: y0 - s - gap, s }, { g: 'hdg', x: x0 + s + gap, y: y0 - s - gap, s }, { g: 'vsi', x: x0 + 2 * (s + gap), y: y0 - s - gap, s },
];

export const LAYOUTS = {
  // ---------------------------------------------------------------- general aviation
  ga_analog: {
    panel: { w: 1.12, h: 0.36, dist: 0.66, top: -0.09, tilt: 10, color: '#2d2f33', cx: 0.27 },
    glare: { depth: 0.12, color: '#1a1b1d' },
    items: [
      ...six(-0.13, 0.08, 0.085),
      { g: 'rpm', x: 0.17, y: -0.05, s: 0.075, max: 3000, green: [2100, 2700], red: 2700 },
      { g: 'dual', x: 0.33, y: 0.09, s: 0.06, what: 'fuel' }, { g: 'dual', x: 0.33, y: 0.02, s: 0.06, what: 'oil' }, { g: 'dual', x: 0.33, y: -0.05, s: 0.06, what: 'cht' },
      { g: 'dual', x: 0.33, y: -0.12, s: 0.06, what: 'volt' },
      { d: 'radio', x: 0.13, y: 0.075, w: 0.16, h: 0.12 },
      { g: 'clock', x: 0.47, y: 0.07, s: 0.06 },
    ],
    controls: { yoke: 'yoke', yokes: 2, throttle: 'knobs', flaps: 'switch', gear: null, switches: 'ga', key: true },
    seatGap: 0.54, interior: '#b8ad9c', floorDrop: 1.02,
  },
  bush_analog: {
    panel: { w: 1.05, h: 0.32, dist: 0.64, top: -0.11, tilt: 4, color: '#3b3a36', cx: 0.3 },
    glare: { depth: 0.12, color: '#22211f' },
    items: [
      ...six(-0.12, 0.07, 0.08),
      { g: 'rpm', x: 0.16, y: -0.04, s: 0.08, max: 2600, green: [1800, 2300], red: 2300 }, { g: 'map', x: 0.16, y: 0.06, s: 0.08 },
      { g: 'dual', x: 0.29, y: 0.07, s: 0.06, what: 'oil' }, { g: 'dual', x: 0.29, y: 0.0, s: 0.06, what: 'cht' }, { g: 'dual', x: 0.29, y: -0.07, s: 0.06, what: 'fuel' },
      { g: 'clock', x: 0.41, y: 0.06, s: 0.055 },
    ],
    controls: { yoke: 'yoke', yokes: 1, throttle: 'quadrant3', flaps: 'lever', gear: null, switches: 'ga', key: false },
    seatGap: 0.6, interior: '#6f6a5c', floorDrop: 1.0,
  },
  aerobatic: {
    panel: { w: 0.55, h: 0.22, dist: 0.6, top: -0.17, tilt: 6, color: '#202124', cx: 0 },
    glare: { depth: 0.06, color: '#18191b' },
    items: [
      { g: 'asi', x: -0.16, y: 0.04, s: 0.08 }, { g: 'g', x: -0.06, y: 0.04, s: 0.08 }, { g: 'alt', x: 0.04, y: 0.04, s: 0.08 }, { g: 'vsi', x: 0.14, y: 0.04, s: 0.08 },
      { g: 'rpm', x: -0.11, y: -0.05, s: 0.07, max: 3000, red: 2700 }, { g: 'map', x: -0.02, y: -0.05, s: 0.07 }, { g: 'dual', x: 0.07, y: -0.05, s: 0.06, what: 'oil' }, { g: 'dual', x: 0.16, y: -0.05, s: 0.06, what: 'fuel' },
    ],
    controls: { yoke: 'stick', yokes: 1, throttle: 'sideQuadrant', flaps: null, gear: null, switches: 'mini', key: false },
    seatGap: 0, interior: '#2a2a2a', floorDrop: 0.95, open: true,
  },
  ga_glass: {
    panel: { w: 1.15, h: 0.34, dist: 0.62, top: -0.08, tilt: 12, color: '#1c1d20', cx: 0.29 },
    glare: { depth: 0.16, color: '#121314' },
    items: [
      { d: 'pfd', x: -0.0, y: 0.0, w: 0.25, h: 0.19 }, { d: 'mfd', x: 0.56, y: 0.0, w: 0.25, h: 0.19 },
      { d: 'standby', x: 0.28, y: 0.06, w: 0.07, h: 0.07 }, { d: 'radio', x: 0.28, y: -0.06, w: 0.12, h: 0.09 },
    ],
    controls: { yoke: 'sideyoke', yokes: 2, throttle: 'single', flaps: 'switch', gear: null, switches: 'ga', key: false },
    seatGap: 0.58, interior: '#d8d4cc', floorDrop: 0.98,
  },
  twin_analog: {
    panel: { w: 1.18, h: 0.38, dist: 0.66, top: -0.09, tilt: 10, color: '#2b2c2f', cx: 0.3 },
    glare: { depth: 0.18, color: '#18191b' },
    items: [
      ...six(-0.14, 0.08, 0.082),
      { g: 'rpm', x: 0.18, y: 0.08, s: 0.07, max: 3000, green: [2100, 2700], red: 2700, e: 0 }, { g: 'rpm', x: 0.26, y: 0.08, s: 0.07, max: 3000, green: [2100, 2700], red: 2700, e: 1 },
      { g: 'map', x: 0.18, y: 0.0, s: 0.07, e: 0 }, { g: 'map', x: 0.26, y: 0.0, s: 0.07, e: 1 },
      { g: 'fuelflow', x: 0.18, y: -0.08, s: 0.07, e: 0 }, { g: 'fuelflow', x: 0.26, y: -0.08, s: 0.07, e: 1 },
      { g: 'dual', x: 0.36, y: 0.08, s: 0.055, what: 'oil', e: 0 }, { g: 'dual', x: 0.42, y: 0.08, s: 0.055, what: 'oil', e: 1 },
      { g: 'dual', x: 0.36, y: 0.01, s: 0.055, what: 'fuel' }, { g: 'dual', x: 0.42, y: 0.01, s: 0.055, what: 'volt' },
      { d: 'radio', x: 0.39, y: -0.08, w: 0.13, h: 0.08 },
    ],
    controls: { yoke: 'yoke', yokes: 2, throttle: 'quadrant6', flaps: 'switch', gear: 'lever', switches: 'ga', key: false },
    seatGap: 0.58, interior: '#9a8e7c', floorDrop: 1.0,
  },
  // ---------------------------------------------------------------- turboprops / jets
  turboprop: {
    panel: { w: 1.36, h: 0.4, dist: 0.7, top: -0.1, tilt: 12, color: '#2e3136', cx: 0.36 },
    glare: { depth: 0.22, color: '#18191b', mcp: true },
    items: [
      { d: 'pfd', x: -0.02, y: 0.03, w: 0.17, h: 0.17 }, { d: 'nd', x: -0.02, y: -0.15, w: 0.17, h: 0.12 },
      { g: 'torque', x: 0.25, y: 0.09, s: 0.065, e: 0 }, { g: 'torque', x: 0.33, y: 0.09, s: 0.065, e: 1 },
      { g: 'itt', x: 0.25, y: 0.02, s: 0.065, e: 0 }, { g: 'itt', x: 0.33, y: 0.02, s: 0.065, e: 1 },
      { g: 'np', x: 0.25, y: -0.05, s: 0.065, e: 0 }, { g: 'np', x: 0.33, y: -0.05, s: 0.065, e: 1 },
      { g: 'dual', x: 0.42, y: 0.08, s: 0.055, what: 'oil', e: 0 }, { g: 'dual', x: 0.48, y: 0.08, s: 0.055, what: 'oil', e: 1 },
      { g: 'dual', x: 0.45, y: 0.01, s: 0.055, what: 'fuel' },
      { d: 'pfd', x: 0.72, y: 0.03, w: 0.17, h: 0.17 }, { d: 'nd', x: 0.72, y: -0.15, w: 0.17, h: 0.12 },
    ],
    controls: { yoke: 'yoke', yokes: 2, throttle: 'pedestal', levers: 2, condition: true, flaps: 'pedestal', gear: 'lever', switches: 'overheadSmall' },
    seatGap: 0.72, interior: '#5a5f66', floorDrop: 1.05,
  },
  regional_glass: {
    panel: { w: 1.7, h: 0.4, dist: 0.74, top: -0.1, tilt: 12, color: '#3a4049', cx: 0.5 },
    glare: { depth: 0.26, color: '#22262b', mcp: true },
    items: [
      { d: 'pfd', x: -0.03, y: 0.0, w: 0.2, h: 0.2 }, { d: 'nd', x: 0.2, y: 0.0, w: 0.2, h: 0.2 }, { d: 'eicas', x: 0.5, y: 0.0, w: 0.2, h: 0.2 },
      { d: 'nd', x: 0.8, y: 0.0, w: 0.2, h: 0.2 }, { d: 'pfd', x: 1.03, y: 0.0, w: 0.2, h: 0.2 },
      { d: 'standby', x: 0.5, y: -0.15, w: 0.07, h: 0.07 },
    ],
    controls: { yoke: 'yoke', yokes: 2, throttle: 'pedestal', levers: 2, condition: true, flaps: 'pedestal', gear: 'lever', switches: 'overhead' },
    seatGap: 1.0, interior: '#6c727a', floorDrop: 1.08,
  },
  rj_glass: {
    panel: { w: 1.75, h: 0.42, dist: 0.74, top: -0.1, tilt: 13, color: '#30353c', cx: 0.52 },
    glare: { depth: 0.26, color: '#1e2226', mcp: true },
    items: [
      { d: 'pfd', x: -0.03, y: 0.0, w: 0.19, h: 0.22 }, { d: 'nd', x: 0.18, y: 0.0, w: 0.19, h: 0.22 },
      { d: 'eicas', x: 0.52, y: 0.02, w: 0.2, h: 0.2 }, { d: 'eicas', x: 0.52, y: -0.2, w: 0.18, h: 0.14, page: 'sys' },
      { d: 'nd', x: 0.86, y: 0.0, w: 0.19, h: 0.22 }, { d: 'pfd', x: 1.07, y: 0.0, w: 0.19, h: 0.22 },
    ],
    controls: { yoke: 'yoke', yokes: 2, throttle: 'pedestal', levers: 2, flaps: 'pedestal', gear: 'lever', switches: 'overhead', speedbrake: true },
    seatGap: 1.04, interior: '#5c636c', floorDrop: 1.08,
  },
  nb_glass: {
    panel: { w: 1.9, h: 0.44, dist: 0.76, top: -0.1, tilt: 14, color: '#3b4149', cx: 0.54 },
    glare: { depth: 0.3, color: '#23272c', mcp: true },
    items: [
      { d: 'pfd', x: -0.04, y: 0.0, w: 0.21, h: 0.21 }, { d: 'nd', x: 0.2, y: 0.0, w: 0.21, h: 0.21 },
      { d: 'eicas', x: 0.54, y: 0.02, w: 0.22, h: 0.22 }, { d: 'eicas', x: 0.54, y: -0.21, w: 0.2, h: 0.16, page: 'sys' },
      { d: 'nd', x: 0.88, y: 0.0, w: 0.21, h: 0.21 }, { d: 'pfd', x: 1.12, y: 0.0, w: 0.21, h: 0.21 },
      { d: 'standby', x: 0.37, y: 0.05, w: 0.06, h: 0.06 },
    ],
    controls: { yoke: 'yoke', yokes: 2, throttle: 'pedestal', levers: 2, flaps: 'pedestal', gear: 'lever', switches: 'overhead', speedbrake: true, fireHandles: true },
    seatGap: 1.08, interior: '#69707a', floorDrop: 1.1,
  },
  classic_3crew: {
    panel: { w: 1.85, h: 0.46, dist: 0.76, top: -0.1, tilt: 12, color: '#3c4a3e', cx: 0.55 },
    glare: { depth: 0.28, color: '#232a24', mcp: true },
    items: [
      ...six(-0.13, 0.1, 0.09, 0.012),
      { g: 'clock', x: -0.24, y: 0.1, s: 0.06 },
      { g: 'n1', x: 0.43, y: 0.12, s: 0.07, e: 0 }, { g: 'n1', x: 0.52, y: 0.12, s: 0.07, e: 1 }, { g: 'n1', x: 0.61, y: 0.12, s: 0.07, e: 2 },
      { g: 'egt', x: 0.43, y: 0.04, s: 0.07, e: 0 }, { g: 'egt', x: 0.52, y: 0.04, s: 0.07, e: 1 }, { g: 'egt', x: 0.61, y: 0.04, s: 0.07, e: 2 },
      { g: 'n2', x: 0.43, y: -0.04, s: 0.07, e: 0 }, { g: 'n2', x: 0.52, y: -0.04, s: 0.07, e: 1 }, { g: 'n2', x: 0.61, y: -0.04, s: 0.07, e: 2 },
      { g: 'fuelflow', x: 0.43, y: -0.12, s: 0.07, e: 0 }, { g: 'fuelflow', x: 0.52, y: -0.12, s: 0.07, e: 1 }, { g: 'fuelflow', x: 0.61, y: -0.12, s: 0.07, e: 2 },
      ...six(0.88, 0.1, 0.09, 0.012),
    ],
    controls: { yoke: 'yoke', yokes: 2, throttle: 'pedestal', levers: 3, flaps: 'pedestal', gear: 'lever', switches: 'overhead', speedbrake: true, fireHandles: true, engineer: true },
    seatGap: 1.1, interior: '#56685a', floorDrop: 1.1,
  },
  wb_glass: {
    panel: { w: 2.1, h: 0.42, dist: 0.8, top: -0.1, tilt: 14, color: '#2a2e33', cx: 0.62 },
    glare: { depth: 0.32, color: '#1a1d20', mcp: true, hud: true },
    items: [
      { d: 'pfd', x: -0.05, y: 0.0, w: 0.27, h: 0.2 }, { d: 'nd', x: 0.25, y: 0.0, w: 0.27, h: 0.2 },
      { d: 'eicas', x: 0.62, y: 0.0, w: 0.27, h: 0.2 },
      { d: 'nd', x: 0.99, y: 0.0, w: 0.27, h: 0.2 }, { d: 'pfd', x: 1.29, y: 0.0, w: 0.27, h: 0.2 },
    ],
    controls: { yoke: 'yoke', yokes: 2, throttle: 'pedestal', levers: 2, flaps: 'pedestal', gear: 'lever', switches: 'overhead', speedbrake: true, fireHandles: true },
    seatGap: 1.24, interior: '#5d636b', floorDrop: 1.12,
  },
  jumbo_glass: {
    panel: { w: 2.0, h: 0.44, dist: 0.78, top: -0.1, tilt: 13, color: '#3b4048', cx: 0.6 },
    glare: { depth: 0.3, color: '#22262b', mcp: true },
    items: [
      { d: 'pfd', x: -0.05, y: 0.0, w: 0.21, h: 0.21 }, { d: 'nd', x: 0.19, y: 0.0, w: 0.21, h: 0.21 },
      { d: 'eicas', x: 0.6, y: 0.03, w: 0.22, h: 0.22 }, { d: 'eicas', x: 0.6, y: -0.2, w: 0.2, h: 0.16, page: 'sys' },
      { d: 'nd', x: 1.01, y: 0.0, w: 0.21, h: 0.21 }, { d: 'pfd', x: 1.25, y: 0.0, w: 0.21, h: 0.21 },
    ],
    controls: { yoke: 'yoke', yokes: 2, throttle: 'pedestal', levers: 4, flaps: 'pedestal', gear: 'lever', switches: 'overhead', speedbrake: true, fireHandles: true },
    seatGap: 1.2, interior: '#6c727b', floorDrop: 1.12,
  },
  sst_classic: {
    panel: { w: 1.5, h: 0.44, dist: 0.7, top: -0.12, tilt: 10, color: '#2f3640', cx: 0.5 },
    glare: { depth: 0.2, color: '#1d2228', mcp: true },
    items: [
      ...six(-0.12, 0.09, 0.08, 0.012),
      { g: 'n1', x: 0.34, y: 0.11, s: 0.06, e: 0 }, { g: 'n1', x: 0.41, y: 0.11, s: 0.06, e: 1 }, { g: 'n1', x: 0.48, y: 0.11, s: 0.06, e: 2 }, { g: 'n1', x: 0.55, y: 0.11, s: 0.06, e: 3 },
      { g: 'egt', x: 0.34, y: 0.04, s: 0.06, e: 0 }, { g: 'egt', x: 0.41, y: 0.04, s: 0.06, e: 1 }, { g: 'egt', x: 0.48, y: 0.04, s: 0.06, e: 2 }, { g: 'egt', x: 0.55, y: 0.04, s: 0.06, e: 3 },
      { d: 'eicas', x: 0.45, y: -0.12, w: 0.2, h: 0.14 },
      ...six(0.76, 0.09, 0.08, 0.012),
    ],
    controls: { yoke: 'yoke', yokes: 2, throttle: 'pedestal', levers: 4, flaps: null, gear: 'lever', switches: 'overhead', fireHandles: true, droop: true },
    seatGap: 1.0, interior: '#5b6370', floorDrop: 1.02,
  },
  vlj_glass: {
    panel: { w: 1.22, h: 0.34, dist: 0.62, top: -0.08, tilt: 14, color: '#1b1c1f', cx: 0.34 },
    glare: { depth: 0.18, color: '#111214', mcp: true },
    items: [
      { d: 'pfd', x: 0.0, y: 0.0, w: 0.27, h: 0.18 }, { d: 'mfd', x: 0.34, y: 0.0, w: 0.27, h: 0.18 }, { d: 'eicas', x: 0.68, y: 0.0, w: 0.27, h: 0.18 },
    ],
    controls: { yoke: 'sideyoke', yokes: 2, throttle: 'single', flaps: 'lever', gear: 'lever', switches: 'ga' },
    seatGap: 0.68, interior: '#cfc8bb', floorDrop: 0.98,
  },
  bizjet_glass: {
    panel: { w: 1.7, h: 0.42, dist: 0.74, top: -0.1, tilt: 14, color: '#262a2f', cx: 0.5 },
    glare: { depth: 0.26, color: '#191b1e', mcp: true, hud: true },
    items: [
      { d: 'pfd', x: -0.03, y: 0.0, w: 0.25, h: 0.2 }, { d: 'nd', x: 0.25, y: 0.0, w: 0.25, h: 0.2 }, { d: 'eicas', x: 0.75, y: 0.0, w: 0.25, h: 0.2 },
      { d: 'pfd', x: 1.03, y: 0.0, w: 0.25, h: 0.2 },
    ],
    controls: { yoke: 'yoke', yokes: 2, throttle: 'pedestal', levers: 2, flaps: 'pedestal', gear: 'lever', switches: 'overhead', speedbrake: true, fireHandles: true },
    seatGap: 1.0, interior: '#d0c7b8', floorDrop: 1.05,
  },
  fighter: {
    panel: { w: 0.62, h: 0.3, dist: 0.62, top: -0.16, tilt: 8, color: '#2c3034', cx: 0 },
    glare: { depth: 0.12, color: '#1a1c1f', hud: true },
    items: [
      { d: 'pfd', x: -0.16, y: -0.02, w: 0.15, h: 0.15 }, { d: 'eicas', x: 0.16, y: -0.02, w: 0.15, h: 0.15 },
      { g: 'asi', x: -0.02, y: 0.06, s: 0.06 }, { g: 'alt', x: 0.05, y: 0.06, s: 0.06 }, { g: 'g', x: -0.02, y: -0.02, s: 0.06 }, { g: 'n1', x: 0.05, y: -0.02, s: 0.06 },
      { g: 'egt', x: 0.015, y: -0.1, s: 0.06 },
    ],
    controls: { yoke: 'stick', yokes: 1, throttle: 'sideQuadrant', flaps: 'switch', gear: 'lever', switches: 'mini' },
    seatGap: 0, interior: '#30343a', floorDrop: 0.95, open: true,
  },
  // ---------------------------------------------------------------- helicopters
  heli_light: {
    panel: { w: 0.5, h: 0.28, dist: 0.62, top: -0.2, tilt: 25, color: '#202124', cx: -0.32, pod: true },
    glare: null,
    items: [
      { g: 'asi', x: -0.11, y: 0.06, s: 0.072 }, { g: 'heliTach', x: -0.03, y: 0.06, s: 0.072 }, { g: 'alt', x: 0.05, y: 0.06, s: 0.072 }, { g: 'adi', x: 0.13, y: 0.06, s: 0.072 },
      { g: 'map', x: -0.11, y: -0.025, s: 0.065 }, { g: 'vsi', x: -0.03, y: -0.025, s: 0.065 }, { g: 'hdg', x: 0.05, y: -0.025, s: 0.065 }, { g: 'dual', x: 0.13, y: -0.025, s: 0.06, what: 'oil' },
      { g: 'dual', x: -0.07, y: -0.1, s: 0.055, what: 'fuel' }, { g: 'dual', x: 0.09, y: -0.1, s: 0.055, what: 'cht' },
    ],
    controls: { yoke: 'cyclic', yokes: 2, throttle: 'collective', flaps: null, gear: null, switches: 'heli' },
    seatGap: 0.62, interior: '#8a8a88', floorDrop: 0.95,
  },
  heli_glass: {
    panel: { w: 1.4, h: 0.36, dist: 0.7, top: -0.15, tilt: 18, color: '#25282c', cx: -0.48 },
    glare: { depth: 0.2, color: '#17191b', mcp: true },
    items: [
      { d: 'pfd', x: -0.0, y: 0.0, w: 0.2, h: 0.2 }, { d: 'eicas', x: 0.24, y: 0.0, w: 0.2, h: 0.2 }, { d: 'nd', x: 0.72, y: 0.0, w: 0.2, h: 0.2 }, { d: 'pfd', x: 0.96, y: 0.0, w: 0.2, h: 0.2 },
      { d: 'standby', x: 0.48, y: 0.05, w: 0.07, h: 0.07 },
    ],
    controls: { yoke: 'cyclic', yokes: 2, throttle: 'collective', flaps: null, gear: 'lever', switches: 'overheadSmall' },
    seatGap: 0.96, interior: '#53585e', floorDrop: 1.0,
  },
  heli_utility: {
    panel: { w: 1.25, h: 0.36, dist: 0.7, top: -0.18, tilt: 16, color: '#1f2322', cx: -0.55 },
    glare: { depth: 0.18, color: '#141716' },
    items: [
      { g: 'asi', x: -0.08, y: 0.08, s: 0.085 }, { g: 'adi', x: 0.02, y: 0.08, s: 0.095 }, { g: 'alt', x: 0.12, y: 0.08, s: 0.085 },
      { g: 'heliTach', x: -0.08, y: -0.02, s: 0.085 }, { g: 'hdg', x: 0.02, y: -0.02, s: 0.085 }, { g: 'vsi', x: 0.12, y: -0.02, s: 0.085 },
      { g: 'torque', x: 0.26, y: 0.08, s: 0.075 }, { g: 'egt', x: 0.26, y: -0.01, s: 0.075 }, { g: 'n1', x: 0.35, y: 0.08, s: 0.075 }, { g: 'dual', x: 0.35, y: -0.01, s: 0.065, what: 'oil' },
      { g: 'dual', x: 0.44, y: 0.08, s: 0.065, what: 'fuel' }, { g: 'clock', x: 0.44, y: -0.01, s: 0.06 },
      { g: 'asi', x: 0.95, y: 0.08, s: 0.085 }, { g: 'adi', x: 1.05, y: 0.08, s: 0.095 }, { g: 'alt', x: 1.15, y: 0.08, s: 0.085 },
    ],
    controls: { yoke: 'cyclic', yokes: 2, throttle: 'collective', flaps: null, gear: null, switches: 'heli' },
    seatGap: 1.1, interior: '#3e4642', floorDrop: 1.0,
  },
  heli_rescue: {
    panel: { w: 1.1, h: 0.34, dist: 0.66, top: -0.16, tilt: 18, color: '#24272b', cx: -0.42 },
    glare: { depth: 0.16, color: '#16181a', mcp: true },
    items: [
      { d: 'pfd', x: 0.0, y: 0.0, w: 0.19, h: 0.19 }, { d: 'eicas', x: 0.42, y: 0.0, w: 0.19, h: 0.19 }, { d: 'nd', x: 0.84, y: 0.0, w: 0.19, h: 0.19 },
      { d: 'standby', x: 0.21, y: 0.05, w: 0.06, h: 0.06 },
    ],
    controls: { yoke: 'cyclic', yokes: 2, throttle: 'collective', flaps: null, gear: null, switches: 'heli', hoist: true },
    seatGap: 0.84, interior: '#5a5f63', floorDrop: 0.98,
  },
  heli_heavy: {
    panel: { w: 1.5, h: 0.4, dist: 0.74, top: -0.16, tilt: 14, color: '#2b302c', cx: -0.55 },
    glare: { depth: 0.22, color: '#1b1f1c', mcp: true },
    items: [
      { d: 'pfd', x: 0.0, y: 0.02, w: 0.19, h: 0.19 }, { d: 'nd', x: 0.22, y: 0.02, w: 0.19, h: 0.19 },
      { d: 'eicas', x: 0.55, y: 0.02, w: 0.2, h: 0.2 },
      { g: 'heliTach', x: 0.55, y: -0.16, s: 0.08 },
      { d: 'nd', x: 0.88, y: 0.02, w: 0.19, h: 0.19 }, { d: 'pfd', x: 1.1, y: 0.02, w: 0.19, h: 0.19 },
    ],
    controls: { yoke: 'cyclic', yokes: 2, throttle: 'collective', flaps: null, gear: null, switches: 'overheadSmall', cargoHook: true },
    seatGap: 1.1, interior: '#4a524c', floorDrop: 1.05,
  },
};
