// Engine sound profiles. Each layer is a looping recording whose playback rate and gain are
// functions of the simulated engine state (N1/N2/RPM/rotor speed), so sound is always in sync
// with the instruments and the spinning propellers/fans/rotors.
//
// layer: { clip, where: 'ext'|'int', p: param, rate: [[x,r]...], gain: [[x,g]...], pos: 'front'|'rear'|'any' }
// params: n1, n2, rpm (fraction of max), nr (rotor), load (power fraction), start (cranking 0..1), thrust

const T = (...pts) => pts;

function turbofan(c) {
  // c: { ext: [idle, low, mid, high], int: [idle, mid, high], whine, roar, rear, startWhine }
  const L = [];
  const bands = [[0.0, 0.21, 0.42], [0.3, 0.45, 0.65], [0.5, 0.7, 0.88], [0.75, 0.95, 1.1]];
  c.ext.forEach((clip, i) => {
    if (!clip) return;
    const [a, b, d] = bands[i];
    L.push({ clip, where: 'ext', p: i === 0 ? 'n2' : 'n1', pos: 'any',
      rate: i === 0 ? T([0, 0.05], [0.3, 0.45], [0.6, 0.92], [1.0, 1.2]) : T([a, 0.82], [b, 1.0], [d, 1.12]),
      gain: i === 0 ? T([0, 0], [0.12, 0.25], [0.6, 0.95], [0.75, 0.7], [0.9, 0.35], [1.05, 0.2]) : T([a, 0], [b, 1], [d, i === 3 ? 1.05 : 0.15]) });
  });
  (c.int || []).forEach((clip, i) => {
    if (!clip) return;
    const [a, b, d] = [[0, 0.21, 0.5], [0.35, 0.65, 0.9], [0.7, 0.95, 1.1]][i];
    L.push({ clip, where: 'int', p: i === 0 ? 'n2' : 'n1', rate: i === 0 ? T([0, 0.05], [0.6, 0.95], [1.0, 1.15]) : T([a, 0.85], [b, 1.0], [d, 1.12]), gain: i === 0 ? T([0, 0], [0.15, 0.3], [0.6, 0.9], [0.8, 0.6], [1.05, 0.4]) : T([a, 0], [b, 0.9], [d, i === 2 ? 1.0 : 0.25]) });
  });
  if (c.whine) L.push({ clip: c.whine, where: 'ext', p: 'n2', pos: 'front', rate: T([0, 0.02], [0.25, 0.4], [0.6, 0.85], [1.0, 1.3]), gain: T([0, 0], [0.08, 0.35], [0.6, 0.7], [1.0, 0.6]) });
  if (c.whineInt) L.push({ clip: c.whineInt, where: 'int', p: 'n2', rate: T([0, 0.05], [0.6, 0.9], [1.0, 1.25]), gain: T([0, 0], [0.1, 0.3], [0.6, 0.55], [1.0, 0.6]) });
  if (c.roar) L.push({ clip: c.roar, where: 'ext', p: 'thrust', pos: 'rear', rate: T([0, 0.8], [1, 1.08]), gain: T([0, 0], [0.35, 0.15], [0.7, 0.75], [1.0, 1.25]) });
  if (c.rear) L.push({ clip: c.rear, where: 'ext', p: 'n1', pos: 'rear', rate: T([0.2, 0.9], [1, 1.15]), gain: T([0, 0], [0.22, 0.4], [0.6, 0.3], [1, 0.2]) });
  if (c.starter) L.push({ clip: c.starter, where: 'both', p: 'start', rate: T([0, 0.6], [1, 1.2]), gain: T([0, 0], [0.05, 0.6], [1, 0.8]) });
  return L;
}

function turboprop(c) {
  return [
    { clip: c.drone, where: 'ext', p: 'rpm', pos: 'any', rate: T([0, 0.1], [0.5, 0.7], [0.75, 0.88], [1.0, 1.05]), gain: T([0, 0], [0.2, 0.25], [0.6, 0.7], [1.0, 1.0]) },
    { clip: c.prop, where: 'ext', p: 'load', pos: 'front', rate: T([0, 0.85], [1, 1.1]), gain: T([0, 0.05], [0.3, 0.35], [1, 1.1]) },
    { clip: c.turbine, where: 'ext', p: 'n2', pos: 'any', rate: T([0, 0.05], [0.3, 0.45], [0.65, 0.95], [1.05, 1.25]), gain: T([0, 0], [0.1, 0.35], [0.65, 0.55], [1.0, 0.45]) },
    { clip: c.inside, where: 'int', p: 'rpm', rate: T([0, 0.1], [0.7, 0.85], [1.0, 1.05]), gain: T([0, 0], [0.25, 0.35], [0.7, 0.75], [1, 1.0]) },
    { clip: c.turbine, where: 'int', p: 'n2', rate: T([0, 0.05], [0.65, 0.95], [1.05, 1.25]), gain: T([0, 0], [0.12, 0.25], [0.65, 0.3], [1, 0.25]) },
    { clip: 'h_starter', where: 'both', p: 'start', rate: T([0, 0.6], [1, 1.2]), gain: T([0, 0], [0.05, 0.5], [1, 0.6]) },
  ];
}

function piston(c) {
  return [
    { clip: c.idle, where: 'ext', p: 'rpm', pos: 'any', rate: T([0, 0.05], [0.12, 0.4], [0.3, 0.95], [0.6, 1.6]), gain: T([0, 0], [0.08, 0.8], [0.35, 0.9], [0.6, 0.15], [0.8, 0]) },
    { clip: c.run, where: 'ext', p: 'rpm', pos: 'any', rate: T([0.25, c.runLow ?? 0.55], [0.85, c.runMid ?? 0.95], [1.1, c.runHigh ?? 1.15]), gain: T([0.2, 0], [0.45, 0.5], [0.8, 0.9], [1.1, 1.1]) },
    { clip: c.load || c.run, where: 'ext', p: 'load', pos: 'front', rate: T([0, 0.9], [1, 1.02]), gain: T([0, 0], [0.4, 0.15], [1, 0.45]) },
    { clip: c.idle, where: 'int', p: 'rpm', rate: T([0, 0.05], [0.12, 0.4], [0.3, 0.95], [0.6, 1.6]), gain: T([0, 0], [0.08, 0.7], [0.35, 0.8], [0.6, 0.15], [0.8, 0]) },
    { clip: c.run, where: 'int', p: 'rpm', rate: T([0.25, c.runLow ?? 0.55], [0.85, c.runMid ?? 0.95], [1.1, c.runHigh ?? 1.15]), gain: T([0.2, 0], [0.45, 0.5], [0.8, 0.85], [1.1, 1.0]) },
  ];
}

function heli(c) {
  const L = [];
  if (c.turbine) {
    L.push({ clip: c.turbine, where: 'ext', p: 'n2', pos: 'any', rate: T([0, 0.05], [0.3, 0.5], [0.62, 0.78], [1.0, 1.08]), gain: T([0, 0], [0.1, 0.4], [0.62, 0.6], [1, 0.8]) });
    L.push({ clip: c.turbineInt || c.turbine, where: 'int', p: 'n2', rate: T([0, 0.05], [0.3, 0.5], [0.62, 0.78], [1.0, 1.08]), gain: T([0, 0], [0.1, 0.35], [0.62, 0.5], [1, 0.7]) });
  }
  if (c.piston) {
    L.push({ clip: c.piston, where: 'ext', p: 'rpm', pos: 'any', rate: T([0.05, 0.2], [0.4, 0.55], [1.0, 1.02]), gain: T([0, 0], [0.1, 0.5], [1, 0.9]) });
    L.push({ clip: c.pistonIdle || c.piston, where: 'int', p: 'rpm', rate: T([0.05, 0.25], [0.4, 0.75], [1.0, 1.5]), gain: T([0, 0], [0.1, 0.6], [0.6, 0.5], [1, 0.3]) });
    L.push({ clip: c.piston, where: 'int', p: 'rpm', rate: T([0.4, 0.55], [1.0, 1.02]), gain: T([0.3, 0], [0.7, 0.5], [1, 0.8]) });
  }
  L.push({ clip: c.rotor, where: 'ext', p: 'nr', pos: 'any', rate: T([0, 0.15], [1, 1.0], [1.15, 1.12]), gain: T([0, 0], [0.25, 0.25], [1, 1.0]) });
  if (c.rotorBass) L.push({ clip: c.rotorBass, where: 'ext', p: 'nr', pos: 'any', rate: T([0, 0.15], [1, 1.0], [1.15, 1.12]), gain: T([0, 0], [0.3, 0.2], [1, 0.8]) });
  L.push({ clip: c.rotorInt || c.rotor, where: 'int', p: 'nr', rate: T([0, 0.15], [1, 1.0], [1.15, 1.12]), gain: T([0, 0], [0.25, 0.3], [1, 1.0]) });
  if (c.slap) L.push({ clip: c.slap, where: 'both', p: 'slap', rate: T([0, 0.92], [1, 1.02]), gain: T([0, 0], [0.3, 0.25], [1, 1.0]), nrRate: true });
  if (c.tail) L.push({ clip: c.tail, where: 'ext', p: 'nr', pos: 'rear', rate: T([0, 0.15], [1, c.tailRate || 1.0]), gain: T([0, 0], [0.5, 0.15], [1, 0.45]) });
  L.push({ clip: 'h_starter', where: 'both', p: 'start', rate: T([0, 0.6], [1, 1.2]), gain: T([0, 0], [0.05, 0.5], [1, 0.6]) });
  return L;
}

export const PROFILES = {
  // turboprops
  tprop_commuter: { layers: turboprop({ drone: 'tprop_drone', prop: 'tprop_1', turbine: 'uh1_turbine', inside: 'tprop_drone' }), synth: { prop: true }, extInside: 0.55, lpInside: 1500, extGain: 1.0 },
  tprop_regional: { layers: turboprop({ drone: 'prop_drone', prop: 'tprop_1', turbine: 'hturb_out', inside: 'tprop_drone' }), synth: { prop: true }, extInside: 0.4, lpInside: 1100, extGain: 1.0 },
  // turbofans
  jet_cf34: { layers: turbofan({ ext: ['cf34_whine', 'bj_drone', 'bj_thrust', null], int: ['cf34_inside', 'bj_int', null], roar: 'jt8_roar', whine: 'bj_hiwhine', rear: 'bj_ext' }), synth: { buzz: 0.4 }, extInside: 0.22, lpInside: 900, extGain: 1.0 },
  jet_cfm: { layers: turbofan({ ext: ['cfm_x1', 'cfm_x2', 'cfm_x3', 'cfm_x4'], int: ['cfm_i1', 'cfm_i3', 'cfm_i4'], roar: 'hbf_x_roar', whine: 'hbf_x_whistle' }), synth: { buzz: 0.7 }, extInside: 0.18, lpInside: 800, extGain: 1.0 },
  jet_jt8: { layers: turbofan({ ext: ['jt8_idle', 'jt8_jet', 'jt8_set', 'jt8_roar'], int: ['jt8_drone', 'bj_int', null], whine: 'jt8_whine', roar: 'jt8_roar', rear: 'jt8_jet' }), synth: { buzz: 0.25 }, extInside: 0.3, lpInside: 900, extGain: 1.15 },
  jet_hbf: { layers: turbofan({ ext: ['hbf_x_idle', 'hbf_x_spool', 'hbf_x_spool', 'hbf_x_roar'], int: ['hbf_i_idle', 'hbf_i_spool', 'hbf_i_growl'], whine: 'hbf_x_whistle', rear: 'hbf_x_rear' }), synth: { buzz: 0.9 }, extInside: 0.15, lpInside: 700, extGain: 1.05 },
  jet_trent: { layers: turbofan({ ext: ['trent_2', 'trent_1', 'hbf_x_spool', 'hbf_x_roar'], int: ['hbf_i_idle', 'hbf_i_spool', 'hbf_i_growl'], whine: 'hbf_x_whistle', rear: 'hbf_x_rear' }), synth: { buzz: 0.8 }, extInside: 0.15, lpInside: 700, extGain: 1.1 },
  jet_sst: { layers: turbofan({ ext: ['jt8_idle', 'jt8_jet', 'jt8_set', 'jt8_roar'], int: ['jt8_drone', 'bj_int', 'hbf_i_growl'], whine: 'turbojet_fan', roar: 'jt8_roar' }), synth: { ab: true }, extInside: 0.22, lpInside: 800, extGain: 1.25 },
  jet_vlj: { layers: turbofan({ ext: ['bj_hiwhine', 'turbojet_fan', 'bj_ext', null], int: ['bj_int', 'bj_int', null], whine: 'bj_hiwhine' }), synth: {}, extInside: 0.35, lpInside: 1200, extGain: 0.85 },
  jet_biz: { layers: turbofan({ ext: ['bj_turbine', 'bj_whine', 'bj_drone', 'bj_thrust'], int: ['bj_int', 'cf34_inside', null], whine: 'bj_hiwhine', rear: 'bj_ext' }), synth: { buzz: 0.3 }, extInside: 0.18, lpInside: 900, extGain: 1.0 },
  jet_trainer: { layers: turbofan({ ext: ['turbojet_fan', 'jt8_whine', 'jt8_jet', 'jt8_roar'], int: ['bj_int', 'jt8_drone', 'hbf_i_growl'], whine: 'jt8_whine', roar: 'jt8_roar' }), synth: {}, extInside: 0.45, lpInside: 1400, extGain: 1.1 },
  // helicopters
  heli_light: { layers: heli({ piston: 'pist_run', pistonIdle: 'pist_idle', rotor: 'rotor_2blade', rotorInt: 'rotor_2blade', slap: 'uh1_flap', tail: 'tail_rotor', tailRate: 1.3 }), synth: {}, extInside: 0.7, lpInside: 2200, extGain: 1.0 },
  heli_twin: { layers: heli({ turbine: 'hturb_out', turbineInt: 'hturb_in', rotor: 'h145_rotor', rotorInt: 'h145_rotor_in', slap: 'blade_vortex', tail: 'tail_rotor', tailRate: 1.1 }), synth: {}, extInside: 0.35, lpInside: 1300, extGain: 1.0 },
  heli_utility: { layers: heli({ turbine: 'uh1_turbine', turbineInt: 'hturb_in', rotor: 'uh1_flap', rotorBass: 'hrotor_outb', rotorInt: 'uh1_inside', slap: 'uh1_flap', tail: 'tail_rotor' }), synth: {}, extInside: 0.6, lpInside: 1800, extGain: 1.15 },
  heli_rescue: { layers: heli({ turbine: 'hturb_out', turbineInt: 'hturb_in', rotor: 'hrotor_out', rotorBass: 'hrotor_outb', rotorInt: 'hrotor_in', slap: 'blade_vortex', tail: 'tail_rotor', tailRate: 1.6 }), synth: {}, extInside: 0.4, lpInside: 1500, extGain: 1.0 },
  heli_heavy: { layers: heli({ turbine: 'hturb_out', turbineInt: 'hturb_in', rotor: 'hrotor_outb', rotorBass: 'uh1_flap', rotorInt: 'hrotor_inb', slap: 'uh1_flap' }), synth: {}, extInside: 0.55, lpInside: 1200, extGain: 1.25, rotorRate: 0.7 },
  // pistons
  piston_trainer: { layers: piston({ idle: 'pist_idle', run: 'pist_run' }), synth: { prop: true }, extInside: 0.85, lpInside: 2600, extGain: 1.0 },
  piston_composite: { layers: piston({ idle: 'pist_idle', run: 'pist_run', runLow: 0.5, runMid: 0.88, runHigh: 1.05 }), synth: { prop: true }, extInside: 0.75, lpInside: 2200, extGain: 1.0 },
  piston_twin: { layers: piston({ idle: 'pist_idle', run: 'pist_run', runLow: 0.5, runMid: 0.9, runHigh: 1.08, load: 'prop_drone' }), synth: { prop: true }, extInside: 0.7, lpInside: 2000, extGain: 1.0 },
  piston_radial: { layers: piston({ idle: 'radial', run: 'radial', runLow: 0.55, runMid: 0.95, runHigh: 1.12, load: 'prop_drone' }), synth: { prop: true }, extInside: 0.85, lpInside: 2400, extGain: 1.1 },
  piston_aero: { layers: piston({ idle: 'pist_idle', run: 'pist_run', runLow: 0.6, runMid: 1.05, runHigh: 1.22 }), synth: { prop: true }, extInside: 0.95, lpInside: 3200, extGain: 1.1 },
};

export const COMMON_CLIPS = ['wind_in', 'wind_out', 'wind_hi', 'rumble', 'tires_roll', 'touchdown', 'squeal', 'gear_motor', 'gear_down', 'gear_up', 'flaps_motor', 'flaps_hyd', 'flaps_click', 'reverser', 'rain', 'rain_shield', 'thunder1', 'thunder2', 'crash', 'damage', 'stall_horn', 'ap_disc', 'alt_alert', 'chime', 'gear_horn', 'click', 'lever', 'apu_run', 'h_starter', 'pist_start', 'pist_crank', 'pist_cut', 'cfm_start', 'lowrpm_horn', 'avionics', 'gyro'];
