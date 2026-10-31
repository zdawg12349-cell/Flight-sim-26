// Training lessons: beginner-friendly guided steps with automatic completion checks.
import { KT, FT, FPM } from '../core/math.js';

const S = (text, check = null, extra = {}) => ({ text, check, ...extra });

export const LESSONS = [
  {
    id: 'tour', title: '1. Cockpit tour', aircraft: 'skylark', spawn: { airport: 'KBRF', kind: 'runway', name: '13' }, weather: 'clear', time: 10, running: true,
    desc: 'Learn what every instrument in a classic cockpit tells you.',
    steps: [
      S('Welcome to the Skylark S-172 cockpit! Hold the RIGHT or LEFT mouse button and drag to look around. Press Space to re-centre your view. Click "Next" to continue.'),
      S('Top-left: the AIRSPEED INDICATOR (knots). The green arc is the normal operating range, the white arc is where flaps may be used, the red line is the never-exceed speed.', null, { highlight: 'asi' }),
      S('Top-centre: the ATTITUDE INDICATOR (artificial horizon). Blue is sky, brown is ground. The orange symbol is your aircraft: it shows pitch and bank.', null, { highlight: 'adi' }),
      S('Top-right: the ALTIMETER. The long needle shows hundreds of feet, the short needle thousands.', null, { highlight: 'alt' }),
      S('Bottom-left: the TURN COORDINATOR. The little aeroplane shows turn rate; keep the ball centred with the rudder (Q/E) for a coordinated turn.', null, { highlight: 'turn' }),
      S('Bottom-centre: the HEADING INDICATOR shows your compass heading. Bottom-right: the VERTICAL SPEED INDICATOR shows climb or descent rate.', null, { highlight: 'hdg' }),
      S('To the right: the TACHOMETER (engine RPM) and the small engine gauges: fuel, oil pressure/temperature, cylinder head & exhaust temperature, volts.', null, { highlight: 'rpm' }),
      S('Below: the switch row (battery, avionics, fuel pump, lights…). You can click switches and levers. The push-pull knobs are throttle (black) and mixture (red).'),
      S('Tour complete! Try the "First take-off" lesson next.'),
    ],
  },
  {
    id: 'takeoff', title: '2. First take-off', aircraft: 'skylark', spawn: { airport: 'KBRF', kind: 'runway', name: '13' }, weather: 'clear', time: 9, running: true,
    desc: 'Line up, apply power, rotate and climb out.',
    steps: [
      S('You are lined up on runway 13 with the engine running. First release the parking brake: press Shift+B (or tap B).', (ac) => !ac.fm.ctl.parking),
      S('Apply full power: hold R (or PageUp) until the throttle is fully in.', (ac) => ac.fm.ctl.throttle[0] > 0.95),
      S('Keep the nose on the centreline with the rudder: Q (left) and E (right). Watch the airspeed build up…', (ac) => ac.fm.telemetry.ias > 50 * KT),
      S('At 55 knots gently pull back (S or Down arrow) to raise the nose about 8°.', (ac) => !ac.fm.onGround && ac.fm.telemetry.agl > 3),
      S('You are flying! Hold about 75 knots: if the speed drops, lower the nose slightly; if it rises, raise it.', (ac) => ac.fm.telemetry.agl > 150),
      S('Climb to 1,000 ft above the ground. Simplified mode trims for you automatically when you release the controls.', (ac) => ac.fm.telemetry.agl > 300),
      S('Excellent take-off! Reduce power a little (F) to about 75% and level off. Lesson complete.'),
    ],
  },
  {
    id: 'turns', title: '3. Turns & climbs', aircraft: 'skylark', spawn: { air: true, airport: 'KBRF', alt: 2500, speed: 95 }, weather: 'clear', time: 11, running: true,
    desc: 'Coordinated turns, level flight and controlled descents.',
    steps: [
      S('You are cruising at 2,500 ft. Roll into a gentle left turn: press A until the bank is about 20°, then release.', (ac) => ac.fm.telemetry.bank < -15),
      S('Turns need a little back-pressure to hold altitude. Keep the altimeter steady while you turn through 90°.', (ac, st) => { st.h0 = st.h0 ?? ac.fm.telemetry.heading; const d = Math.abs(((ac.fm.telemetry.heading - st.h0 + 540) % 360) - 180); return d > 80; }),
      S('Roll back to wings level with D.', (ac) => Math.abs(ac.fm.telemetry.bank) < 5),
      S('Now descend: reduce power (F) to about 50% and let the nose drop gently. Descend 500 ft.', (ac, st) => { st.a0 = st.a0 ?? ac.fm.telemetry.alt; return ac.fm.telemetry.alt < st.a0 - 150; }),
      S('Add power back (R) and level off. Lesson complete — you can now fly the aircraft precisely.'),
    ],
  },
  {
    id: 'landing', title: '4. Approach & landing', aircraft: 'skylark', spawn: { challenge: { airport: 'KBRF', runway: '13', dist: 3 } }, weather: 'clear', time: 16, running: true,
    desc: 'Final approach, flaps, the PAPI lights and the flare.',
    steps: [
      S('You are on a 3-mile final to runway 13. Extend flaps one step with ] (right bracket).', (ac) => ac.fm.ctl.flapIndex >= 1),
      S('Fly about 65–70 knots. The 4 PAPI lights left of the runway show your glide path: 2 white + 2 red is perfect.', (ac) => ac.fm.telemetry.agl < 180),
      S('Add full flaps (] twice more) and keep the runway threshold steady in your windshield.', (ac) => ac.fm.ctl.flapIndex >= 3 || ac.fm.telemetry.agl < 60),
      S('At about 20 ft reduce power to idle (Shift+F) and gently raise the nose to flare.', (ac) => ac.fm.onGround),
      S('Touchdown! Hold B to brake to a stop.', (ac) => ac.fm.onGround && ac.fm.telemetry.gs < 2),
      S('Well done. Your landing score is shown in the results.'),
    ],
  },
  {
    id: 'hover', title: '5. Helicopter hover', aircraft: 'r145', spawn: { airport: 'KPXR', kind: 'helipad', name: 'H1' }, weather: 'clear', time: 10, running: true,
    desc: 'Collective, cyclic and pedals: the art of hovering.',
    steps: [
      S('The rotors are turning. The COLLECTIVE (R/F, PageUp/PageDown) changes the pitch of all blades = lift. Raise it slowly until the helicopter lifts off.', (ac) => ac.fm.telemetry.agl > 1.5),
      S('Climb to a 5 m hover. The CYCLIC (W/A/S/D) tilts the rotor disc: small inputs only! Stability assist is on in simplified mode.', (ac) => ac.fm.telemetry.agl > 4),
      S('Hold a steady hover for 10 seconds: keep groundspeed below 3 knots.', (ac, st, dt) => { const ok = ac.fm.telemetry.gs < 1.6 && ac.fm.telemetry.agl > 2; st.t = ok ? (st.t || 0) + dt : 0; return st.t > 10; }),
      S('The PEDALS (Q/E) control the tail rotor: turn 90° on the spot.', (ac, st) => { st.h0 = st.h0 ?? ac.fm.telemetry.heading; return Math.abs(((ac.fm.telemetry.heading - st.h0 + 540) % 360) - 180) > 80; }),
      S('Now land: lower the collective gently (F) until the skids touch.', (ac) => ac.fm.onGround && ac.fm.telemetry.agl < 0.5),
      S('Perfect! You have mastered the hover.'),
    ],
  },
  {
    id: 'engfail', title: '6. Engine failure drill', aircraft: 'skylark', spawn: { air: true, airport: 'KBRF', alt: 3000, speed: 95 }, weather: 'fair', time: 13, running: true, failure: { type: 'flameout', after: 15 },
    desc: 'What to do when the engine quits: glide, choose a field, land.',
    steps: [
      S('Cruise for a moment. In about 15 seconds your instructor will cut the engine…', (ac) => ac.fm.engines[0].failed),
      S('ENGINE FAILURE! Pitch for best glide: about 68 knots. Do not stretch the glide.', (ac) => Math.abs(ac.fm.telemetry.ias / KT - 68) < 8),
      S('Turn towards Birchfield airfield (look at the moving map: press M) or pick a large flat field. Try a restart with I if you have altitude.', (ac) => ac.fm.telemetry.agl < 300),
      S('Plan to touch down at the slowest safe speed, flaps as required, wings level.', (ac) => ac.fm.onGround),
      S('You are down. Emergency services will be on their way — well done for keeping control.'),
    ],
  },
];
