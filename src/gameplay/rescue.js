// Emergency response after an emergency landing (or crash): fire trucks, police and an ambulance are
// dispatched from the nearest airport fire / police station, drive to the aircraft with lights and
// sirens, position themselves around it and perform (non-graphic) response activity.
// Also: everyday airport service traffic.
import * as THREE from 'three';
import { buildVehicle, buildPerson, VehicleDriver } from '../world/vehicles.js';
import { AIRPORTS, toWorld, noseHeading } from '../world/airportData.js';
import { bus } from '../core/events.js';
import { clamp, DEG, lerp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { LAYER_WORLD } from '../render/renderer.js';
import { glowTexture } from '../render/textures.js';

const _v = new THREE.Vector3();

function nearestAirport(x, z, needFire = true) {
  let best = null, bd = 1e12;
  for (const ap of AIRPORTS) {
    if (needFire && !ap.fireStation) continue;
    const d = Math.hypot(ap.x - x, ap.z - z);
    if (d < bd) { bd = d; best = ap; }
  }
  return { ap: best, dist: bd };
}

// Water / foam spray from turrets: GPU particles along a ballistic arc.
function makeSpray() {
  const n = 600;
  const g = new THREE.BufferGeometry();
  const seed = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { seed[i * 3] = Math.random(); seed[i * 3 + 1] = Math.random(); seed[i * 3 + 2] = Math.random(); }
  g.setAttribute('position', new THREE.BufferAttribute(seed, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uStart: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, 0, -1) }, uSpeed: { value: 24 }, uTex: { value: glowTexture() }, uOn: { value: 0 } },
    vertexShader: `uniform float uTime; uniform vec3 uStart; uniform vec3 uDir; uniform float uSpeed; uniform float uOn; varying float vA;
      void main(){
        float life = 1.8;
        float t = mod(uTime + position.x * life, life);
        vec3 v = normalize(uDir + (position - 0.5) * 0.08) * uSpeed;
        vec3 p = uStart + v * t + vec3(0.0, -4.9 * t * t, 0.0);
        vA = (1.0 - t / life) * uOn;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((6.0 + t * 30.0) * 30.0 / max(1.0, -mv.z), 1.0, 90.0);
      }`,
    fragmentShader: `uniform sampler2D uTex; varying float vA; void main(){ float a = texture2D(uTex, gl_PointCoord).r * vA * 0.5; if (a < 0.01) discard; gl_FragColor = vec4(0.92, 0.95, 1.0, a); }`,
    transparent: true, depthWrite: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.layers.set(LAYER_WORLD);
  return p;
}

export class RescueResponse {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.active = false;
    this.units = [];
    this.people = [];
    this.props = [];
    this.time = 0;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  clear() {
    for (const u of this.units) this.group.remove(u.v.root);
    for (const p of this.people) this.group.remove(p.root);
    for (const p of this.props) this.group.remove(p);
    this.units = []; this.people = []; this.props = [];
    this.active = false; this.completed = false;
  }

  dispatch(ac, reason) {
    if (this.active) return;
    this.clear();
    this.active = true; this.time = 0; this.reason = reason; this.completed = false;
    const fm = ac.fm;
    const ax = fm.pos.x, az = fm.pos.z;
    const hdg = fm.telemetry.heading * DEG;
    this.target = { x: ax, z: az, hdg, span: fm.spec.dims.span, len: fm.spec.dims.length, heli: fm.isHeli, airliner: fm.spec.cat === 'airliner' && fm.spec.pax > 30 };
    const { ap, dist } = nearestAirport(ax, az);
    const onField = ap && dist < 6500;
    this.airport = onField ? ap : null;
    const fireStart = onField ? toWorld(ap, ap.fireStation.u, ap.fireStation.v) : null;
    const polStart = onField && ap.policeStation ? toWorld(ap, ap.policeStation.u, ap.policeStation.v) : fireStart;
    const fireH = onField ? noseHeading(ap, ap.fireStation.nose) * DEG : 0;
    // off-airport: units arrive from the direction of the nearest town / road
    const offStart = (k) => {
      const a = Math.atan2(ap ? ap.x - ax : 1, ap ? -(ap.z - az) : 0) + (k - 1) * 0.12;
      return [ax + Math.sin(a) * (650 + k * 40), az - Math.cos(a) * (650 + k * 40)];
    };
    // positions around the aircraft (aircraft frame -> world)
    const R = Math.max(this.target.span, this.target.len) / 2;
    const toW = (sx, sz) => {
      const c = Math.cos(hdg), s = Math.sin(hdg);
      // body frame: x right, z back; heading rotates body -z to (sin h, -cos h)
      return [ax + sx * c - sz * s, az + sx * s + sz * c];
    };
    const plan = [
      { kind: 'fire', at: toW(-(this.target.span / 2 + 9), -this.target.len * 0.15), face: [ax, az], delay: 0 },
      { kind: 'fire', at: toW(this.target.span / 2 + 9, -this.target.len * 0.15), face: [ax, az], delay: 2.5 },
      { kind: 'fire', at: toW(0, -(this.target.len / 2 + 16)), face: [ax, az], delay: 5 },
      { kind: 'ambulance', at: toW(-(this.target.span / 2 + 18), -this.target.len * 0.45), face: null, delay: 9 },
      { kind: 'police', at: toW(-(R + 30), this.target.len * 0.2), face: null, delay: 4 },
      { kind: 'police', at: toW(R + 30, -this.target.len * 0.35), face: null, delay: 7 },
    ];
    if (this.target.heli || fm.spec.mass.mtow < 6000) plan.splice(2, 1);
    plan.forEach((p, k) => {
      const v = buildVehicle(p.kind);
      const drv = new VehicleDriver(v, this.world, { maxSpeed: p.kind === 'fire' ? 22 : p.kind === 'police' ? 26 : 20, accel: p.kind === 'fire' ? 2.6 : 3.5, lights: true });
      let start;
      if (onField) {
        start = p.kind === 'police' ? polStart : fireStart;
        start = [start[0] + Math.sin(fireH) * (k * 9), start[1] - Math.cos(fireH) * (k * 9)];
      } else start = offStart(k);
      const h0 = onField ? fireH : Math.atan2(ax - start[0], -(az - start[1]));
      drv.place(start[0], start[1], h0);
      // path: leave station, then head to an approach point and the final position
      const ex = start[0] + Math.sin(h0) * 40, ez = start[1] - Math.cos(h0) * 40;
      const appX = p.at[0] + (p.at[0] - ax) * 0.6, appZ = p.at[1] + (p.at[1] - az) * 0.6;
      const finalH = p.face ? Math.atan2(p.face[0] - p.at[0], -(p.face[1] - p.at[1])) : Math.atan2(p.at[0] - ax, -(p.at[1] - az)) + Math.PI / 2;
      drv.setPath([[ex, ez], [appX, appZ], p.at], finalH);
      drv.delay = p.delay;
      this.group.add(v.root);
      const unit = { v, drv, kind: p.kind, arrived: false, acted: false, at: p.at };
      if (p.kind === 'fire') { unit.spray = makeSpray(); this.group.add(unit.spray); }
      this.units.push(unit);
    });
    this.fire = fm.engines.some((e) => e.fire && !e.extinguished) || fm.damage.crashed || fm.damage.total > 0.45;
    this.hadFire = this.fire; this.sprayTime = 0; this.extinguishedAt = null;
    bus.emit('rescue:dispatched', { onField, airport: onField ? ap.icao : null, units: this.units.length, reason });
  }

  update(dt, ac, audio) {
    if (!this.active) return;
    this.time += dt;
    const fm = ac.fm;
    let arrived = 0;
    const sirens = [];
    for (const u of this.units) {
      if (u.drv.delay > 0) { u.drv.delay -= dt; u.drv.sync(); sirens.push({ pos: u.v.root.position, on: false, kind: u.kind }); continue; }
      u.drv.update(dt);
      if (u.drv.arrived && !u.arrived) { u.arrived = true; u.arrivedAt = this.time; this.onArrive(u, ac); }
      if (u.arrived) arrived++;
      sirens.push({ pos: u.v.root.position, on: !u.arrived || this.time - (u.arrivedAt || 0) < 3, kind: u.kind });
      if (u.spray) {
        const m = u.spray.material.uniforms;
        m.uTime.value = this.time;
        const sprayOn = u.arrived && (this.fire || this.time - u.arrivedAt < 12) && this.time - u.arrivedAt < 45;
        m.uOn.value = sprayOn ? Math.min(1, (this.time - u.arrivedAt) / 1.5) : Math.max(0, m.uOn.value - dt);
        if (u.v.turret) {
          u.v.turret.getWorldPosition(_v);
          m.uStart.value.copy(_v).add(new THREE.Vector3(0, 0.4, 0));
          const tx = fm.pos.x - _v.x, tz = fm.pos.z - _v.z, d = Math.max(5, Math.hypot(tx, tz));
          const loft = clamp(4.9 * d / (m.uSpeed.value ** 2), 0.08, 0.6);
          m.uDir.value.set(tx / d, loft + 0.08, tz / d).normalize();
          const yaw = Math.atan2(tx, tz) + u.v.root.rotation.y;
          u.v.turret.rotation.y = -Math.atan2(Math.sin(yaw), Math.cos(yaw)) + Math.PI;
        }
      }
    }
    audio && audio.setSirens(sirens);
    // fire suppression: sustained water / foam on the aircraft puts out engine and crash fires
    const spraying = this.units.filter((u) => u.spray && u.spray.material.uniforms.uOn.value > 0.6).length;
    if (this.fire && spraying) {
      this.sprayTime = (this.sprayTime || 0) + dt * spraying;
      if (this.sprayTime > 14) {
        for (const e of fm.engines) if (e.fire) { e.fire = false; e.extinguished = true; }
        fm.damage.fireOut = true;
        this.fire = false;
        this.extinguishedAt = this.time;
        bus.emit('toast', 'Fire extinguished');
      }
    }
    // people animation
    for (const p of this.people) {
      p.t = (p.t || 0) + dt;
      if (p.target) {
        const dx = p.target[0] - p.root.position.x, dz = p.target[1] - p.root.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.6) {
          const sp = p.speed || 1.6;
          p.root.position.x += dx / d * sp * dt; p.root.position.z += dz / d * sp * dt;
          p.root.rotation.y = Math.atan2(dx, dz);
          p.legs[0].rotation.x = Math.sin(p.t * 8) * 0.5; p.legs[1].rotation.x = -Math.sin(p.t * 8) * 0.5;
        } else {
          p.legs[0].rotation.x = p.legs[1].rotation.x = 0;
          if (p.next) { p.target = p.next.shift() || null; if (!p.next.length) p.next = null; }
        }
        p.root.position.y = this.world.surfaceAt(p.root.position.x, p.root.position.z);
      }
    }
    // slides inflating
    for (const s of this.props) if (s.userData.inflate !== undefined) { s.userData.inflate = Math.min(1, s.userData.inflate + dt / 3); s.scale.set(1, s.userData.inflate, 1); }
    if (!this.completed && arrived === this.units.length && this.time > 20 && this.time - Math.max(...this.units.map((u) => u.arrivedAt || 0)) > 18) {
      this.completed = true;
      const firstArrival = Math.min(...this.units.map((u) => u.arrivedAt || 999));
      bus.emit('rescue:complete', { responseTime: firstArrival, units: this.units.length, airport: this.airport ? this.airport.icao : null, fire: this.hadFire, extinguished: this.extinguishedAt != null ? this.extinguishedAt - firstArrival : null });
    }
  }

  onArrive(u, ac) {
    const fm = ac.fm;
    const P = u.v.root.position;
    const crew = u.kind === 'fire' ? 3 : u.kind === 'police' ? 2 : 2;
    const color = u.kind === 'fire' ? 0x9a7a2a : u.kind === 'police' ? 0x1a2a6a : 0x2a8a3a;
    for (let i = 0; i < crew; i++) {
      const p = buildPerson(color);
      p.root.position.set(P.x + (i - 1) * 1.2, P.y, P.z + 2);
      const ang = Math.random() * Math.PI * 2;
      if (u.kind === 'fire') p.target = [fm.pos.x + Math.cos(ang) * (this.target.span / 2 + 3), fm.pos.z + Math.sin(ang) * (this.target.len / 3 + 3)];
      else if (u.kind === 'ambulance') { p.target = [fm.pos.x + Math.cos(ang) * 6, fm.pos.z + Math.sin(ang) * 6]; p.next = [[P.x + 2, P.z]]; }
      else { const a2 = Math.atan2(P.z - fm.pos.z, P.x - fm.pos.x) + (i - 0.5) * 0.4; const rr = Math.hypot(P.x - fm.pos.x, P.z - fm.pos.z) - 4; p.target = [fm.pos.x + Math.cos(a2) * rr, fm.pos.z + Math.sin(a2) * rr]; }
      p.speed = u.kind === 'police' ? 1.3 : 2.2;
      this.group.add(p.root);
      this.people.push(p);
    }
    if (u.kind === 'police') {
      // traffic cones forming a perimeter arc
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.55, 8).translate(0, 0.27, 0), new THREE.MeshLambertMaterial({ color: 0xff6a00 }));
      const R = Math.hypot(P.x - fm.pos.x, P.z - fm.pos.z) - 6;
      const a0 = Math.atan2(P.z - fm.pos.z, P.x - fm.pos.x);
      for (let k = -4; k <= 4; k++) {
        const c = cone.clone(); const a = a0 + k * 0.06;
        c.position.set(fm.pos.x + Math.cos(a) * R, 0, fm.pos.z + Math.sin(a) * R);
        c.position.y = this.world.surfaceAt(c.position.x, c.position.z);
        c.layers.set(LAYER_WORLD);
        this.group.add(c); this.props.push(c);
      }
    }
    if (u.kind === 'ambulance' && this.target.airliner && !this.slides) {
      // evacuation slides + passengers walking to an assembly point (upwind, away from the aircraft)
      this.slides = true;
      const hdg = this.target.hdg;
      const doorZ = [-this.target.len * 0.38, this.target.len * 0.05, this.target.len * 0.33];
      const assembly = [fm.pos.x - Math.cos(hdg) * (this.target.span / 2 + 70), fm.pos.z - Math.sin(hdg) * (this.target.span / 2 + 70)];
      const slideMat = new THREE.MeshLambertMaterial({ color: 0xf2c500 });
      for (const side of [-1, 1]) for (const dz of doorZ) {
        const slide = new THREE.Group();
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 7).translate(0, 0, 3.5), slideMat);
        m.rotation.x = 0.42;
        slide.add(m);
        const bx = fm.pos.x + Math.cos(hdg) * side * 2.2 - Math.sin(hdg) * dz;
        const bz = fm.pos.z + Math.sin(hdg) * side * 2.2 + Math.cos(hdg) * dz;
        slide.position.set(bx, this.world.surfaceAt(bx, bz) + 3.0, bz);
        slide.rotation.y = -hdg + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        slide.userData.inflate = 0;
        slide.traverse((o) => o.layers.set(LAYER_WORLD));
        this.group.add(slide); this.props.push(slide);
      }
      const n = settings.g.preset === 'low' ? 18 : 40;
      for (let i = 0; i < n; i++) {
        const p = buildPerson([0x6a6a8a, 0x8a5a4a, 0x4a6a5a, 0x9a8a6a, 0x3a4a6a][i % 5]);
        const side = i % 2 ? 1 : -1, dz = doorZ[i % 3];
        const sx = fm.pos.x + Math.cos(hdg) * side * 9 - Math.sin(hdg) * dz;
        const sz = fm.pos.z + Math.sin(hdg) * side * 9 + Math.cos(hdg) * dz;
        p.root.position.set(sx, this.world.surfaceAt(sx, sz), sz);
        p.root.visible = false;
        p.delay = 3 + i * 0.6;
        p.target = [assembly[0] + (Math.random() - 0.5) * 18, assembly[1] + (Math.random() - 0.5) * 18];
        p.speed = 1.4 + Math.random() * 0.6;
        this.group.add(p.root); this.people.push(p);
        const show = () => { p.root.visible = true; };
        setTimeout(show, p.delay * 1000);
      }
    }
  }
}

// ------------------------------------------------------------------ airport service traffic
export class AirportTraffic {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.vehicles = [];
    const kinds = ['tug', 'fuel', 'catering', 'bus', 'followme', 'stairs', 'tug', 'fuel'];
    const max = settings.g.groundVehicles;
    let k = 0;
    for (const ap of AIRPORTS) {
      for (const loop of ap.serviceLoops) {
        const per = ap.type === 'international' ? 4 : 2;
        for (let i = 0; i < per && this.vehicles.length < max; i++) {
          const v = buildVehicle(kinds[k++ % kinds.length], { merge: true });
          const drv = new VehicleDriver(v, world, { maxSpeed: 7 + Math.random() * 4, accel: 1.5, loop: true, lights: true });
          const pts = loop.map((p) => toWorld(ap, p[0], p[1]));
          const off = (i / per) * pts.length;
          const rot = pts.slice(Math.floor(off)).concat(pts.slice(0, Math.floor(off)));
          drv.place(rot[0][0], rot[0][1], Math.atan2(rot[1][0] - rot[0][0], -(rot[1][1] - rot[0][1])));
          drv.setPath(rot.slice(1).concat([rot[0]]));
          scene.add(v.root);
          this.vehicles.push({ v, drv, ap });
        }
      }
    }
  }
  update(dt, camPos) {
    for (const t of this.vehicles) {
      const d = Math.hypot(t.ap.x - camPos.x, t.ap.z - camPos.z);
      const vis = d < 9000;
      t.v.root.visible = vis;
      if (vis) t.drv.update(dt);
    }
  }
}
