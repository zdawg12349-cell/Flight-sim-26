# Flight Sim 26

A 3D flight simulator that runs in the browser, built on WebGL2 and three.js. It has 21 original
aircraft, first-person cockpits, a 6-DOF flight model, helicopter rotor aerodynamics, real
engine recordings, weather, day and night, emergencies with a rescue response that drives to the
aircraft, missions, training and replays.

> All aircraft, airports, vehicles and the world are original designs. Nothing is copied from
> a commercial simulator. Engine sounds are GPL-2.0 recordings from FlightGear projects (see
> [ATTRIBUTION.md](ATTRIBUTION.md)).

## Starting it

**Easiest:** open `index.html` in Chrome, Edge or Firefox (double-click it). The repository ships a
prebuilt bundle (`dist/flightsim.js`) and an embedded sound pack, so you need no server and no
install, and it works from `file://`.

Optionally, run a local server:

```bash
node tools/serve.js
```

Then open http://localhost:8080/.

To rebuild after editing the sources in `src/`:

```bash
npm install
```

```bash
npm run build
```

`npm run dev` rebuilds on every change. The audio pack is only rebuilt with
`python3 -I tools/build_audio.py <folder with the cloned sound repositories>` (needs numpy,
scipy, soundfile, imageio-ffmpeg).

## Controls (default, all rebindable in Settings → Controls)

| Action | Keys |
|---|---|
| Pitch / roll | W S / A D or arrow keys (mouse yoke optional) |
| Rudder / pedals | Q E |
| Throttle (collective in helicopters) | R / F (hold), Shift+R full, Shift+F idle |
| Flaps | [ ] (or 5 / 6) · Gear: G · Spoilers: / · Reversers: T |
| Brakes | B (hold) · Parking brake: Shift+B |
| Trim | Home / End |
| Engine auto-start / shutdown | I / Shift+I |
| Autopilot | Z (master), Shift+Z (panel). In the cockpit you can also click the MCP buttons and scroll its knobs |
| Lights | L landing, Shift+L nav/beacon/strobe |
| Views | V cockpit · 2 cabin · 3 chase · 4 side · 7 cinematic · C / Shift+C cycle · Space reset look |
| Look around | Drag the mouse (cockpit), scroll to zoom |
| ATC radio | Y or ` · Map: M · Help: H · Flight info: U · Pause: P · Menu: Esc |
| Rescue hoist / cargo hook | K |

A gamepad is supported. Simplified mode (the default) adds auto-rudder, auto-trim, stall
protection and helicopter stability augmentation. Advanced mode gives raw controls.

## What's in it

**Fleet (21 aircraft, each with its own 3D model, cockpit, engines, sound profile and handling)**

| Category | Aircraft |
|---|---|
| Passenger (8) | C-19 Commuter (twin turboprop), RT-72 (regional turboprop), RJ-90 (regional jet), M-738 (narrow-body), T-3 (classic tri-jet with flight engineer panel), M-787W (wide-body), A-740 (quad-jet jumbo with upper deck), SST-2 (supersonic with droop nose and afterburners) |
| Jets (3) | Vireo VLJ (single-engine personal jet with a V-tail), G-750 (business jet with HUD), JT-2 (tandem jet trainer) |
| Helicopters (5) | H-22 (light piston, 2 seats), H-139 (passenger twin with retractable gear), U-205 (utility with a teetering rotor), R-145 (rescue with fenestron, hoist and searchlight), HL-47 (heavy-lift tandem rotor with ramp and cargo hook) |
| General aviation (5) | Skylark (high-wing trainer), Zephyr (composite with glass cockpit and side-yoke), DuoMax (light twin), BushHawk (radial taildragger), Swallow (aerobatic biplane) |

**Flight model.** Fixed 120 Hz rigid-body integration with interpolation. Lift, drag,
induced drag, Mach drag rise, flaps and spoilers, ground effect, stall with break and buffet,
P-factor and slipstream, weight and balance (fuel and payload move the CG), gyroscopic
inertia, crosswind, gusts and turbulence. Propeller slipstream over the tail (momentum
theory) keeps the elevator and rudder effective at low speed. Spring-damper gear has load
shares computed from the CG, tyre friction, braking, nose-wheel and tailwheel steering, and
stick-slip static friction. Taildraggers rest in their three-point attitude, can ground-loop
and nose over, and there is scrape and crash detection. Helicopters
use blade-element plus momentum rotor theory, ground effect, vortex ring state, a governor
and freewheel unit, autorotation, rotor inertia, tail rotor or fenestron or tandem rotors,
and dynamic rollover through the gear contacts.

**Engines.** Turbofan (N1/N2 spool dynamics, start sequence, reversers, afterburner),
turboprop, piston (propeller torque balance and governor), turboshaft and piston helicopter
engines. Each models EGT/ITT, oil pressure and temperature, and fuel flow.

**Systems.** Battery and generators, bus voltage, hydraulics, fuel tanks and fuel leaks,
pitot icing, lights, master caution and warning, GPWS call-outs, altitude alerter, fire
detection and extinguishers. The autopilot has HDG, NAV, LOC/GS approach, ALT, V/S,
autothrottle and helicopter hover hold.

**Cockpits.** You sit at the pilot's eye point with mouse look and g-force head motion. The
modern airliner and business-jet decks (RT-72, RJ-90, M-738, M-787W, A-740, G-750) have:

- a row of five large glass displays (PFD, MFD, EICAS, MFD, PFD)
- a full-width glareshield with a lit flight control panel, EFIS panels and a blue LED strip
- a centre pedestal with thrust levers, flap and speed-brake gates, twin CDUs showing a live
  FMS page, and radio and transponder panels
- a backlit overhead panel, side consoles with tillers, and crew seats

The classic T-3, the SST, the GA aircraft and the helicopters keep period-appropriate analog
or mixed panels. Common to all cockpits:

- clickable controls: MCP buttons, scrollable knobs, overhead switches, levers and handles
- animated yokes, sticks, cyclic and collective, and pedals
- a HUD on some jets
- window openings ray-projected from the pilot's eye onto the fuselage
- tooltips that explain every instrument

At night the panels glow through emissive light maps instead of real lights, so lighting the
cockpit adds no render cost. A passenger cabin view is available too. The cockpit is only
built the first time you look inside, so flying from the outside views never pays for it.
Settings → Gameplay → Start view lets you start in the chase camera.

**Audio.** Layered real recordings with RPM-dependent pitch and throttle-dependent gain,
start-up and shutdown, spool, propeller blade-pass and fan buzz-saw synthesis, rotor slap
that responds to load, and separate interior and exterior mixes with filtering. It also has
distance attenuation, Doppler, wind, rain, tyres, gear and flap motors, reversers, stall and
gear horns, an APU, warnings and sirens. Voices are persistent and updated at 30 Hz, so no
nodes are created per frame. Sound and spinning parts both read the same simulated engine
state, so they stay in sync.

**World.** An 82 × 82 km procedural island region with hills, mountains, forests, fields,
lakes, a river, roads and towns. Terrain is quadtree LOD with instanced trees and buildings.
There are 7 airports and heliports: an international hub, a regional airport, a mountain
strip, a GA field with a grass runway, an island airport, a hospital rooftop helipad and an
offshore platform. They have ICAO runway markings, edge, centreline and approach lights,
PAPI, taxiway signs, terminals, jet bridges, hangars, a control tower, windsocks and moving
ground vehicles.

**Weather and time.** Ten presets plus custom wind: clear, cumulus, broken, overcast, rain,
thunderstorms with lightning, snow, fog and gusty crosswind. Wind, gusts and turbulence
affect handling, and rain and snow reduce runway friction. Day and night run on a real sun
and moon cycle with sunrise and sunset colours, stars, runway and city lights, and aircraft
landing and strobe lights.

**Emergencies.** Engine flameout or fire, oil-pressure loss, partial power, hydraulic or
electrical failure, gear jam, fuel leak, pitot icing, tail-rotor failure, governor failure,
and engine-out on twins. You set how often they happen, from off to often, or schedule them
in missions and challenges. Each has real consequences, warnings, checklists and relight
attempts. After an emergency landing or a crash, fire trucks, an ambulance and police drive
from the airport fire station, or arrive by road, and position around the aircraft. They
flash their lights, sound sirens, spray water or foam, place cones and deploy evacuation
slides, and the flight ends with an emergency report.

**Gameplay.** Free flight, 12 missions (passenger, airport-to-airport, helicopter rescue,
offshore, heavy lift), 10 landing challenges, 6 training lessons, landing scoring (vertical
speed, centreline, touchdown zone, bank, speed), an ATC radio with optional speech, a moving
map, a flight log with charts, and full flight replay.

**Performance.** Graphics presets Low, Medium, High and Ultra. Auto-quality adapts
resolution, tree, building and cloud density, LOD distance and shadow refresh. It degrades
distant scenery first and the cockpit and aircraft last. A frame-time monitor shows FPS,
draw calls and triangles. The renderer uses instancing, merged static geometry, frustum
culling and a two-pass cockpit render. Low is aimed at integrated graphics such as Intel
UHD 620 and Chromebooks, at roughly 720p.

## Project layout

```
index.html            entry page (loads assets/audio/audiopack.js + dist/flightsim.js)
src/core/             maths, events, settings (localStorage), input (keyboard/mouse/gamepad)
src/render/           renderer, sky/sun/moon/fog environment, camera rig, lights, textures
src/world/            airport data, terrain generator + LOD, water, scenery, airports, vehicles
src/weather/          weather presets, wind/turbulence field, clouds, rain/snow, lightning
src/aircraft/         procedural modeler, 21 aircraft models, catalog (performance data), Aircraft
src/sim/              atmosphere, engines, flight & rotor model, systems, autopilot, surfaces
src/cockpit/          gauges, glass displays, per-aircraft layouts, cockpit builder
src/audio/            audio engine + per-aircraft sound profiles
src/gameplay/         emergencies, rescue, landing evaluation, missions, training, ATC, flight log
src/ui/               menus, dialogs, HUD, map, replay bar
src/perf/             performance monitor and adaptive quality
tools/                audio pack builder, static server
tests/                headless physics tests and browser feature / screenshot tests
```

## Tests

```bash
node tests/physics-test.mjs skylark
```

This runs a headless take-off and climb. Swap `skylark` for `m738` (airliner), `bushhawk`
(taildragger), `h22` (hover and climb), `cg` (CG check for all aircraft), `ground` (every
helicopter parked with the rotor turning) or `warnings` (no false cautions on any of the 21
aircraft at spawn). `npm test` runs the quick set.

```bash
node tests/feature-test.js test-output
```

This drives the real app in headless Chromium through 15 scenarios: boot, menus, cold-and-dark
start, throttle, RPM, propeller and audio response, keyboard take-off, camera views, jet
spool-up, helicopter lift-off, a scripted landing and its score, an engine fire through
emergency landing to rescue, replay and log, HUD panels, missions and training, graphics
presets, settings persistence across a reload, and spawning every aircraft. It writes
screenshots and `report.json`. The browser tests need Playwright with a Chromium browser.

## Honest limitations

- Everything is procedural. The models have far fewer polygons and much simpler textures
  than a commercial simulator, and cockpits are simplified, with only the main controls
  interactive rather than every switch.
- The flight model is a coefficient-based physics model tuned to sensible published numbers
  (take-off distances, climb rates, hover power). It is not a certified engineering model.
- ATC is a scripted text and voice system, and there is no AI air traffic.
- The world is one 82 km region, not the whole Earth.
- Real-time performance was tuned for low-end GPUs but tested only under software
  rendering (SwiftShader) in CI. Expect to use the Low preset on very weak hardware.

## Licence

The code is MIT (see [LICENSE](LICENSE)). The bundled sound recordings are GPL-2.0. See
[ATTRIBUTION.md](ATTRIBUTION.md) for every source file and its licence.
