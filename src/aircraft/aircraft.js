// Runtime aircraft: 3D model + flight model + systems + autopilot + cockpit + visual animation.
import * as THREE from 'three';
import { buildAircraftModel } from './assemble.js';
import { FlightModel } from '../sim/flight.js';
import { Systems } from '../sim/systems.js';
import { Autopilot, Assists } from '../sim/autopilot.js';
import { Cockpit } from '../cockpit/cockpit.js';
import { settings } from '../core/settings.js';
import { bus } from '../core/events.js';
import { clamp, damp, lerp, DEG, KT, FT, FPM, NM } from '../core/math.js';
import { LAYER_OWN, LAYER_WORLD } from '../render/renderer.js';
import { glowTexture } from '../render/textures.js';
import { setStartSpeed } from '../sim/engines.js';
import { AIRPORTS, runwayEnds } from '../world/airportData.js';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();

export class Aircraft {
  constructor(spec, world, weather, scene) {
    this.spec = spec;
    this.world = world;
    this.weather = weather;
    this.scene = scene;
    this.model = buildAircraftModel(spec, { detail: 1, pbr: settings.g.pbr });
    this.fm = new FlightModel(spec, this.model.desc, world, weather);
    this.systems = new Systems(spec, this.fm);
    this.ap = new Autopilot(spec, this.fm);
    this.assists = new Assists(spec, this.fm, settings);
    // visual root follows the CG; model is offset so the CG sits at the origin
    this.root = new THREE.Group();
    this.root.name = 'ownAircraft';
    this.offset = new THREE.Group();
    this.offset.position.copy(this.fm.cg).multiplyScalar(-1);
    this.offset.add(this.model.root);
    this.root.add(this.offset);
    this.cockpit = new Cockpit(this);
    this.offset.add(this.cockpit.group);
    this.offset.add(this.cockpit.cabin);
    this.model.root.traverse((o) => o.layers.set(LAYER_OWN));
    scene.add(this.root);
    this.propAngle = this.model.props.map(() => Math.random() * 6);
    this.fanAngle = this.model.fans.map(() => Math.random() * 6);
    this.rotorAngle = this.model.rotors.map(() => Math.random() * 6);
    this.tailRotorAngle = 0;
    this.wheelAngle = this.model.gear.map(() => 0);
    this.view = 'cockpit';
    this.raw = { pitch: 0, roll: 0, yaw: 0 };
    this.smoke = this.makeSmoke();
    this.landingLight = null;
    this.dest = null;
    this.data = {};
    this.time = 0;
    this.strobePhase = Math.random();
    // landing light spot (one per player aircraft, medium+ quality)
    if (settings.g.preset !== 'low') {
      const sp = new THREE.SpotLight(0xfff1dc, 0, 900, 0.32, 0.5, 1.3);
      sp.layers.enableAll();
      const tgt = new THREE.Object3D();
      sp.target = tgt;
      const lp = this.model.desc.lights.landing?.[0] || [0, 0, -2];
      sp.position.set(0, lp[1], lp[2]);
      tgt.position.set(0, lp[1] - 6, lp[2] - 60);
      this.offset.add(sp); this.offset.add(tgt);
      this.landingLight = sp;
    }
    setStartSpeed(settings.c.mode === 'simplified' ? 1.8 : 1);
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); }
    });
    if (this.smoke) { this.scene.remove(this.smoke.points); this.smoke.points.geometry.dispose(); }
  }

  // ---------------------------------------------------------- actions
  setThrottleAll(v) { this.fm.ctl.throttle = this.fm.ctl.throttle.map(() => clamp(v, 0, 1)); if (this.fm.isHeli) this.fm.ctl.collective = clamp(v, 0, 1); }
  toggleGear() {
    if (!this.spec.retract) { bus.emit('toast', 'Fixed landing gear'); return; }
    if (this.fm.onGround && this.fm.ctl.gearDown) { bus.emit('toast', 'Gear lever locked: weight on wheels'); return; }
    this.fm.ctl.gearDown = this.fm.ctl.gearDown ? 0 : 1;
    bus.emit('sound', this.fm.ctl.gearDown ? 'gear_down' : 'gear_up');
    bus.emit('toast', this.fm.ctl.gearDown ? 'Gear DOWN' : 'Gear UP');
  }
  flaps(dir) {
    if (this.fm.isHeli) return;
    const n = this.spec.aero.flaps.length - 1;
    if (n < 1) { bus.emit('toast', this.spec.aero.delta ? 'No flaps on a delta wing' : 'No flaps'); return; }
    const old = this.fm.ctl.flapIndex;
    this.fm.ctl.flapIndex = clamp(old + dir, 0, n);
    if (old !== this.fm.ctl.flapIndex) { bus.emit('sound', 'flaps_click'); bus.emit('toast', `Flaps ${this.spec.aero.flaps[this.fm.ctl.flapIndex].deg}°`); }
  }
  toggleSpoilers() { if (this.fm.isHeli) return; this.fm.ctl.spoilers = this.fm.ctl.spoilers > 0.5 ? 0 : 1; bus.emit('toast', this.fm.ctl.spoilers ? 'Speed brakes extended' : 'Speed brakes retracted'); }
  toggleReverse() {
    if (!this.spec.systems.reversers) { bus.emit('toast', 'No thrust reversers'); return; }
    if (!this.fm.onGround) { bus.emit('toast', 'Reversers only on the ground'); return; }
    this.fm.ctl.reverse = this.fm.ctl.reverse ? 0 : 1;
    if (this.fm.ctl.reverse) this.setThrottleAll(Math.min(this.fm.ctl.throttle[0], 0.05));
    bus.emit('toast', this.fm.ctl.reverse ? 'Reverse thrust armed' : 'Reverse thrust stowed');
  }
  toggleHoist() {
    if (this.model.extras.hoist) { this.fm.ctl.hoist = this.fm.ctl.hoist > 0 ? 0 : 1; bus.emit('toast', this.fm.ctl.hoist ? 'Hoist lowering' : 'Hoist raising'); }
    else if (this.model.extras.cargoHook) { this.fm.ctl.hoist = this.fm.ctl.hoist > 0 ? 0 : 1; bus.emit('toast', this.fm.ctl.hoist ? 'Cargo hook released' : 'Cargo hook armed'); }
    else if (this.model.extras.ramp) { this.fm.ctl.rampOpen = this.fm.ctl.rampOpen ? 0 : 1; }
  }
  armApproach() {
    // localizer/glideslope to the runway best aligned ahead within 40 km
    const fm = this.fm, t = fm.telemetry;
    let best = null, bs = 1e18;
    for (const ap of AIRPORTS) for (const rw of ap.runways) {
      const e = runwayEnds(ap, rw);
      for (const [end, hdg] of [[e.a, rw.hdg], [e.b, (rw.hdg + 180) % 360]]) {
        const d = Math.hypot(end.x - fm.pos.x, end.z - fm.pos.z);
        if (d > 40000) continue;
        const brg = (Math.atan2(end.x - fm.pos.x, -(end.z - fm.pos.z)) / DEG + 360) % 360;
        const ang = Math.abs(((brg - hdg + 540) % 360) - 180) + Math.abs(((t.heading - hdg + 540) % 360) - 180) * 0.5;
        const score = d + ang * 400;
        if (score < bs) { bs = score; best = { thrX: end.x, thrZ: end.z, hdg, elev: ap.elev, name: `${ap.icao} RWY ${end.name}` }; }
      }
    }
    if (!best) { bus.emit('toast', 'No ILS runway in range'); return; }
    this.ap.app = best;
    if (!this.ap.engaged) this.ap.engage(true);
    this.ap.lat = 'LOC'; this.ap.vert = 'GS'; this.ap.locCaptured = false; this.ap.gsCaptured = false;
    bus.emit('toast', `Approach armed: ${best.name}`);
  }

  // ---------------------------------------------------------- control input
  applyInput(dt, input, controlsLocked) {
    const fm = this.fm, ctl = fm.ctl;
    const rate = 2.6 * settings.c.keyboardRate;
    const inv = settings.c.invertPitch ? -1 : 1;
    const gp = input.gamepad;
    const centre = (v, k) => damp(v, 0, k, dt);
    let tp = 0, tr = 0, ty = 0;
    if (!controlsLocked) {
      if (input.held('pitchUp')) tp += 1;
      if (input.held('pitchDown')) tp -= 1;
      if (input.held('rollRight')) tr += 1;
      if (input.held('rollLeft')) tr -= 1;
      if (input.held('yawRight')) ty += 1;
      if (input.held('yawLeft')) ty -= 1;
    }
    const raw = this.raw;
    const ramp = (cur, t, r) => (t !== 0 ? clamp(cur + t * r * dt * (Math.sign(t) !== Math.sign(cur) && cur !== 0 ? 2 : 1), -1, 1) : centre(cur, fm.isHeli ? 5 : 6));
    raw.pitch = ramp(raw.pitch, tp * inv, rate * (fm.isHeli ? 0.6 : 1));
    raw.roll = ramp(raw.roll, tr, rate * (fm.isHeli ? 0.6 : 1.1));
    raw.yaw = ramp(raw.yaw, ty, rate);
    if (gp.connected && (Math.abs(gp.pitch) + Math.abs(gp.roll) + Math.abs(gp.yaw)) > 0.02) {
      raw.pitch = -gp.pitch * inv; raw.roll = gp.roll; raw.yaw = gp.yaw;
    }
    if (settings.c.mouseYoke && input.mouse.buttons === 1 && this.view !== 'cockpit') {
      raw.pitch = clamp(-input.mouse.ny * 1.4, -1, 1); raw.roll = clamp(input.mouse.nx * 1.4, -1, 1);
    }
    ctl.pitch = raw.pitch; ctl.roll = raw.roll; ctl.yaw = raw.yaw;
    // throttle / collective
    let dthr = 0;
    if (!controlsLocked) {
      if (input.held('throttleUp')) dthr += 1;
      if (input.held('throttleDown')) dthr -= 1;
    }
    if (gp.connected) dthr += gp.throttleRate;
    const thrRate = fm.isHeli ? 0.38 : 0.45;
    if (fm.isHeli) {
      ctl.collective = clamp(ctl.collective + dthr * thrRate * dt, 0, 1);
      if (gp.connected && gp.throttle !== null && Math.abs(gp.throttle - (this._lastGpThr ?? gp.throttle)) > 0.01) ctl.collective = gp.throttle;
      for (let i = 0; i < ctl.throttle.length; i++) ctl.throttle[i] = 1;
    } else {
      for (let i = 0; i < ctl.throttle.length; i++) ctl.throttle[i] = clamp(ctl.throttle[i] + dthr * thrRate * dt, 0, 1);
      if (gp.connected && gp.throttle !== null && Math.abs(gp.throttle - (this._lastGpThr ?? gp.throttle)) > 0.01) this.setThrottleAll(gp.throttle);
    }
    this._lastGpThr = gp.throttle;
    if (!controlsLocked) {
      if (input.held('trimUp')) ctl.trim = clamp(ctl.trim + dt * 0.15, -0.6, 0.6);
      if (input.held('trimDown')) ctl.trim = clamp(ctl.trim - dt * 0.15, -0.6, 0.6);
    }
    const br = (!controlsLocked && input.held('brakes')) || gp.brake > 0 ? 1 : 0;
    ctl.brakeL = br; ctl.brakeR = br;
    if (br && ctl.parking && fm.telemetry.gs > 1) ctl.parking = false;
    // assists (simplified mode) and autopilot
    if (!this.ap.engaged) this.assists.apply(dt, ctl, raw, false);
    else this.assists.apply(dt, ctl, raw, true);
    // pilot input overrides autopilot -> disconnect on significant stick input
    if (this.ap.engaged && (Math.abs(raw.pitch) > 0.5 || Math.abs(raw.roll) > 0.5)) { this.ap.engage(false); bus.emit('toast', 'Autopilot disconnected (control input)'); }
    this.ap.update(dt, ctl);
    if (fm.isHeli && fm.spec.heli.tandem) ctl.yaw = clamp(ctl.yaw, -1, 1);
  }

  // ---------------------------------------------------------- simulation step
  step(dt) {
    this.systems.update(dt, this.weather);
    this.fm.step(dt, this.systems);
    // fuel starvation stops engines
    if (this.fm.fuel <= 0.5) for (const e of this.fm.engines) if (e.running) { e.running = false; e.state = 'spooldown'; }
  }

  // ---------------------------------------------------------- visuals (per render frame)
  updateVisual(dt, alpha, env, viewMode) {
    this.time += dt;
    const fm = this.fm, M = this.model, t = this.time;
    fm.getRenderPose(alpha, _p, _q);
    this.root.position.copy(_p);
    this.root.quaternion.copy(_q);
    // control surfaces
    for (const s of Object.values(M.surfaces)) {
      let a = 0;
      if (s.type === 'aileron') a = fm.aileron * (s.side > 0 ? -1 : 1) * s.max;
      else if (s.type === 'elevator') a = -fm.elevator * s.max;
      else if (s.type === 'rudder') a = -fm.rudder * s.max * (fm.isHeli ? 0 : 1);
      else if (s.type === 'flap') a = fm.flapDeg * DEG * 1.0;
      else if (s.type === 'elevon') a = -fm.elevator * s.max * 0.8 + fm.aileron * (s.side > 0 ? -1 : 1) * s.max * 0.6;
      else if (s.type === 'ruddervator') a = (-fm.elevator - fm.rudder * (s.side > 0 ? 1 : -1)) * s.max * 0.7;
      s.pivot.quaternion.copy(s.pivot.userData.baseQuat);
      // hinge axis runs root->tip; left side axis is mirrored so flip sign for symmetric deflection
      s.pivot.rotateX(s.type === 'rudder' ? a : a * (s.side < 0 ? -1 : 1) * -1);
    }
    // landing gear: retraction, compression, steering, wheel spin
    M.gear.forEach((u, i) => {
      const d = u.def;
      const r = d.retract;
      const jam = fm.gearJamIndex === i;
      const pos = jam ? Math.min(fm.gearPos, 0.25) : fm.gearPos;
      const broken = fm.damage.gear[i] >= 1;
      if (r) { u.pivot.rotation.set(0, 0, 0); u.pivot.rotation[r.axis] = r.angle * (1 - pos); }
      if (broken) { u.pivot.rotation.x = 0.9; u.pivot.rotation.z = 0.3 * Math.sign(d.pos[0] || 1); }
      const ct = fm.contacts.find((c) => c.gear === i);
      const comp = ct ? ct.compression : 0;
      u.lower.position.y = -d.len * 0.55 + Math.min(comp, d.len * 0.4);
      if (d.steer) u.lower.rotation.y = -fm.steer;
      if (ct && ct.wow) this.wheelAngle[i] += (ct.rollSpeed || 0) / Math.max(0.1, d.r) * dt;
      else this.wheelAngle[i] = this.wheelAngle[i] * (1 - dt * 0.4);
      for (const w of u.wheels) w.rotation.x = -this.wheelAngle[i];
      for (const door of u.doors) door.rotation.z = 0;
      u.pivot.visible = !(r && pos < 0.02);
    });
    // propellers (rotation integrates simulated rpm -> always synced with sound)
    M.props.forEach((p, i) => {
      const e = fm.engines[p.engine] || fm.engines[0];
      const rpm = e ? e.visRpm : 0;
      const w = rpm / 60 * Math.PI * 2;
      this.propAngle[i] += w * dt * p.dir;
      // stroboscopic aliasing guard: show a blurred disc at speed, blades fade out
      const blur = clamp((rpm - 350) / 700, 0, 1);
      p.spin.rotation.z = -this.propAngle[i];
      p.disc.material.opacity = blur * (this.view === 'cockpit' ? 0.28 : 0.45);
      for (const b of p.blades) b.visible = blur < 0.98;
      if (blur > 0.3) p.spin.rotation.z = -(this.propAngle[i] % (Math.PI * 2)) * 0.15;
    });
    // turbofan fans
    M.fans.forEach((f, i) => {
      const e = fm.engines[f.engine] || fm.engines[i] || fm.engines[0];
      const rpm = e ? e.rpm : 0;
      this.fanAngle[i] += rpm / 60 * Math.PI * 2 * dt;
      const vis = rpm > 900 ? (this.fanAngle[i] * 0.04) : this.fanAngle[i];
      f.spin.rotation.z = -vis;
      if (f.spinner) f.spinner.rotation.z = -this.fanAngle[i] * (rpm > 900 ? 0.03 : 1);
    });
    // rotors
    if (fm.isHeli) {
      const nr = fm.nr || 0;
      const rpm = nr * fm.spec.heli.rpm;
      M.rotors.forEach((r, i) => {
        this.rotorAngle[i] += rpm / 60 * Math.PI * 2 * dt * r.dir;
        r.spin.rotation.y = this.rotorAngle[i];
        const thrust = fm.rotorThrust / (fm.mass * 9.81) / (M.rotors.length);
        const cone = clamp(thrust * 0.045, 0, 0.07) * clamp(nr * nr * 1.5, 0, 1);
        const droop = r.droop * (1 - clamp(nr * nr * 1.3, 0, 1));
        for (const b of r.blades) b.rotation.z = cone - droop;
        const blur = clamp((rpm - 90) / 120, 0, 1);
        r.disc.material.opacity = blur * 0.22;
        // disk tilt follows cyclic
        r.spin.rotation.x = -fm.a1 * 0.6;
        r.spin.rotation.z = -fm.b1 * 0.6;
      });
      this.tailRotorAngle += rpm * (fm.spec.heli.tail?.ratio || 5) / 60 * Math.PI * 2 * dt;
      M.tailRotors.forEach((tr) => { tr.spin.rotation.x = this.tailRotorAngle; tr.disc.material.opacity = clamp((rpm - 60) / 100, 0, 1) * 0.3; for (const b of tr.spin.children) if (b.geometry && b.geometry.type === 'BoxGeometry') b.visible = rpm < 250; });
    }
    // reversers (visual translating cowl)
    if (M.extras.reversers) for (const r of M.extras.reversers) r.grp.children[0].position.z = fm.reverserPos * r.len * 0.18;
    // droop nose (SST)
    if (M.extras.droopNose) {
      const target = fm.ctl.gearDown ? (fm.ctl.droop ?? 1) * 12.5 : fm.telemetry.ias < 260 * KT ? 5 : 0;
      this.droop = damp(this.droop || 0, target, 0.6, dt);
      M.extras.droopNose.rotation.x = -this.droop * DEG;
    }
    // canopy
    if (M.extras.canopy && fm.onGround && fm.engines.every((e) => !e.running)) M.extras.canopy.position.y += 0;
    // hoist
    if (M.extras.hoist) {
      const h = M.extras.hoist;
      const target = fm.ctl.hoist ? Math.min(30, Math.max(0.3, fm.telemetry.agl - 0.5)) : 0.3;
      h.length = damp(h.length, target, 0.35, dt);
      h.cable.scale.y = h.length; h.hook.position.y = -0.2 - h.length;
    }
    if (M.extras.cargoHook) M.extras.cargoHook.sling.scale.y = fm.ctl.hoist ? 8 : 0.01;
    if (M.extras.ramp) M.extras.ramp.rotation.x = damp(M.extras.ramp.rotation.x, fm.ctl.rampOpen ? 0.45 : -0.0, 1, dt);
    // lights
    const L = this.systems.lights, Lm = M.lights, powered = this.systems.powered;
    const nightK = env ? 0.35 + 0.65 * (1 - env.daylight) : 1;
    const setL = (s, on, scale = 1) => { if (!s) return; s.visible = on; s.material.opacity = nightK; s.scale.setScalar(s.userData.base || (s.userData.base = s.scale.x)); s.scale.multiplyScalar(scale); };
    setL(Lm.navL, L.nav && powered); setL(Lm.navR, L.nav && powered); setL(Lm.navTail, L.nav && powered);
    const st = (t + this.strobePhase) % 1.2;
    const strobeOn = L.strobe && powered && (st < 0.05 || (st > 0.12 && st < 0.16));
    setL(Lm.strobeL, strobeOn); setL(Lm.strobeR, strobeOn);
    const bc = (t * 1.0 + this.strobePhase) % 1;
    setL(Lm.beaconTop, L.beacon && powered && bc < 0.12); setL(Lm.beaconBottom, L.beacon && powered && ((bc + 0.5) % 1) < 0.12);
    for (const s of Lm.landing) setL(s, (L.landing || L.taxi) && powered);
    if (this.landingLight) {
      const want = (L.landing || L.taxi) && powered && env && env.daylight < 0.6;
      this.landingLight.intensity = want ? (L.landing ? 900 : 300) : 0;
      this.landingLight.visible = !!want;
    }
    // damage visuals: smoke from failed/burning engines or damaged airframe
    this.updateSmoke(dt);
    // view-dependent visibility
    const inside = viewMode === 'cockpit' || viewMode === 'cabin';
    M.exterior.visible = !inside;
    this.cockpit.group.visible = viewMode === 'cockpit' || viewMode === 'cabin';
    this.cockpit.cabin.visible = viewMode === 'cabin' || (viewMode === 'cockpit' && false);
    if (this.cockpit.glass) this.cockpit.glass.visible = viewMode === 'cockpit';
  }

  // ---------------------------------------------------------- smoke / fire particles (non-graphic, cheap)
  makeSmoke() {
    const n = 220;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), age = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('age', new THREE.BufferAttribute(age, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: glowTexture() }, uScale: { value: 400 }, uColor: { value: new THREE.Color(0.25, 0.25, 0.25) } },
      vertexShader: `attribute float age; varying float vA; uniform float uScale;
        void main(){ vA = age; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp((2.0 + age * 9.0) * uScale / max(1.0,-mv.z), 1.0, 220.0) * step(0.001, age); }`,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 uColor; varying float vA;
        void main(){ float t = texture2D(uTex, gl_PointCoord).r; float a = t * (1.0 - vA) * 0.55; if (a < 0.01) discard;
          vec3 c = mix(vec3(1.0,0.55,0.15), uColor, clamp(vA * 4.0, 0.0, 1.0)); gl_FragColor = vec4(c, a); }`,
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.layers.set(LAYER_WORLD);
    this.scene.add(pts);
    return { points: pts, pos, age, vel: new Float32Array(n * 3), n, i: 0, acc: 0 };
  }
  updateSmoke(dt) {
    const S = this.smoke, fm = this.fm;
    if (!S) return;
    const sources = [];
    const ep = this.spec.engines.pos || [];
    fm.engines.forEach((e, i) => {
      if ((e.fire && !e.extinguished) || (e.failed && e.damage > 0.3) || e.oilLeak > 0.6 || (e.failed === 'seize')) sources.push(ep[i] || [0, 0, 0]);
    });
    if (fm.damage.crashed || fm.damage.total > 0.5) sources.push([0, 0.5, 0]);
    let emit = sources.length ? 70 * dt * sources.length : 0;
    S.acc += emit;
    const fwdV = fm.vel;
    while (S.acc >= 1) {
      S.acc -= 1;
      const src = sources[Math.floor(Math.random() * sources.length)];
      _v.set(src[0] - fm.cg.x, src[1] - fm.cg.y, src[2] - fm.cg.z).applyQuaternion(fm.q).add(fm.pos);
      const k = S.i; S.i = (S.i + 1) % S.n;
      S.pos[k * 3] = _v.x + (Math.random() - 0.5); S.pos[k * 3 + 1] = _v.y; S.pos[k * 3 + 2] = _v.z + (Math.random() - 0.5);
      S.vel[k * 3] = fwdV.x * 0.15 + (Math.random() - 0.5) * 2; S.vel[k * 3 + 1] = 2 + Math.random() * 2; S.vel[k * 3 + 2] = fwdV.z * 0.15 + (Math.random() - 0.5) * 2;
      S.age[k] = 0.001;
    }
    const w = this.weather.surfaceWind || { x: 0, z: 0 };
    for (let k = 0; k < S.n; k++) {
      if (S.age[k] <= 0) continue;
      S.age[k] += dt / 6;
      if (S.age[k] >= 1) { S.age[k] = 0; continue; }
      S.pos[k * 3] += (S.vel[k * 3] + w.x * 0.6) * dt; S.pos[k * 3 + 1] += S.vel[k * 3 + 1] * dt; S.pos[k * 3 + 2] += (S.vel[k * 3 + 2] + w.z * 0.6) * dt;
    }
    S.points.geometry.attributes.position.needsUpdate = true;
    S.points.geometry.attributes.age.needsUpdate = true;
  }

  // ---------------------------------------------------------- instrument data (shared by gauges, displays, HUD, audio)
  instrumentData(env, atc) {
    const fm = this.fm, t = fm.telemetry, d = this.data, sys = this.systems;
    d.iasKt = (t.ias || 0) / KT; d.tasKt = (t.tas || 0) / KT; d.gsKt = (t.gs || 0) / KT;
    d.altFt = (fm.pos.y + (this.weather.qnh - 1013.25) * 0 ) / FT; d.aglFt = Math.max(0, (t.agl || 0) / FT);
    d.vsFpm = (t.vs || 0) / FPM; d.hdg = t.heading || 0; d.pitch = t.pitch || 0; d.bank = t.bank || 0;
    d.track = t.track || d.hdg; d.fpa = t.gs > 5 ? Math.atan2(t.vs, t.gs) / DEG : d.pitch;
    d.mach = t.mach || 0; d.g = fm.gLoad; d.maxG = fm.maxG; d.turnRate = t.turnRate || 0; d.slip = t.slip || 0;
    d.engines = fm.engines; d.engineType = this.spec.engines.type; d.nr = fm.nr || 0; d.isHeli = fm.isHeli;
    d.fuelKg = fm.fuel; d.fuelMax = this.spec.mass.fuelMax; d.fuelFrac = fm.fuel / this.spec.mass.fuelMax; d.massKg = fm.mass;
    d.flapDeg = fm.flapDeg; d.gearPos = fm.gearPos; d.retract = this.spec.retract; d.spoilers = fm.spoilerPos; d.reverse = fm.reverserPos;
    d.volts = sys.busVolts; d.genOn = sys.genOnline.some(Boolean); d.displaysOn = sys.displaysOn; d.powered = sys.powered;
    d.warnings = sys.activeWarnings(); d.warnTop = d.warnings[0] || null; d.stall = sys.warnings.get('stall')?.active;
    d.oat = t.oat ?? 15; d.x = fm.pos.x; d.z = fm.pos.z;
    const wv = this.weather.surfaceWind || { x: 0, z: 0 };
    const wind = { x: t.windX || 0, z: t.windZ || 0 };
    d.windKt = Math.hypot(wind.x, wind.z) / KT; d.windDir = (Math.atan2(-wind.x, wind.z) / DEG + 360) % 360;
    d.ap = { engaged: this.ap.engaged, lat: this.ap.lat, vert: this.ap.vert, at: this.ap.at, hdgTarget: this.ap.hdg };
    d.apState = { spd: this.ap.spd, hdg: this.ap.hdg, alt: this.ap.alt, vs: this.ap.vs };
    d.hdgBug = this.ap.available ? this.ap.hdg : null; d.altBug = this.ap.available ? this.ap.alt : null; d.spdBug = this.ap.at ? this.ap.spd : null;
    const p = this.spec.perf;
    d.vspeeds = p.vr ? { R: p.vr, REF: p.vref } : null;
    const prev = this._prevIas ?? d.iasKt; d.iasTrend = (d.iasKt - prev) / Math.max(1e-3, 1 / 60) * 0.1; this._prevIas = d.iasKt;
    d.night = env ? env.daylight < 0.35 : false;
    d.clock = env ? env.time : 12;
    d.comFreq = atc ? atc.freq : '118.70';
    d.ndRange = d.aglFt < 3000 ? 10 : d.altFt < 15000 ? 20 : 40;
    if (this.dest) { d.dest = { x: this.dest.x, z: this.dest.z, icao: this.dest.icao, dist: Math.hypot(this.dest.x - fm.pos.x, this.dest.z - fm.pos.z) }; } else d.dest = null;
    if (this.ap.app && (this.ap.lat === 'LOC' || this.ap.vert === 'GS')) d.ils = { loc: this.ap.locDev || 0, gs: this.ap.gsDev || 0 }; else d.ils = null;
    d.adiFail = fm.vacuumFail;
    return d;
  }
}
