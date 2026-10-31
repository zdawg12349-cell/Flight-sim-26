// Camera rig: first-person cockpit (mouse look + head motion), cabin, chase, orbit, side, tail,
// wing, tower, fly-by and an automatic cinematic director.
import * as THREE from 'three';
import { clamp, damp, lerp, DEG } from '../core/math.js';
import { settings } from '../core/settings.js';
import { AIRPORTS, toWorld } from '../world/airportData.js';

export const VIEWS = ['cockpit', 'cabin', 'chase', 'orbit', 'side', 'tail', 'wing', 'tower', 'flyby', 'cinematic'];
export const VIEW_LABELS = { cockpit: 'Cockpit', cabin: 'Passenger cabin', chase: 'Chase', orbit: 'Free orbit', side: 'Side', tail: 'Rear', wing: 'Wing', tower: 'Tower', flyby: 'Fly-by', cinematic: 'Cinematic' };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class CameraRig {
  constructor(renderer) {
    this.renderer = renderer;
    this.cam = renderer.camera;
    this.mode = 'cockpit';
    this.look = { yaw: 0, pitch: -8 * DEG };
    this.lookTarget = { yaw: 0, pitch: -8 * DEG };
    this.fov = settings.g.fov || 62;
    this.zoom = 1;
    this.orbit = { yaw: 2.6, pitch: 0.18, dist: 0 };
    this.chasePos = new THREE.Vector3();
    this.chaseInit = false;
    this.head = new THREE.Vector3();
    this.headVel = new THREE.Vector3();
    this.shake = 0;
    this.flybyPos = null;
    this.cine = { t: 0, shot: 0, mode: 'chase' };
  }

  setMode(m, ac) {
    if (!VIEWS.includes(m)) return;
    if (m === 'cabin' && !(ac && ac.model.desc.cabin)) m = 'chase';
    this.mode = m;
    this.chaseInit = false;
    this.flybyPos = null;
    if (m === 'cabin') { this.look.yaw = this.lookTarget.yaw = -80 * DEG; this.look.pitch = this.lookTarget.pitch = -8 * DEG; }
    if (m === 'cockpit') { this.look.yaw = this.lookTarget.yaw = 0; this.look.pitch = this.lookTarget.pitch = -8 * DEG; this.zoom = 1; }
    const size = ac ? ac.fm.spec.dims.length : 20;
    this.orbit.dist = Math.max(12, size * 1.25);
  }

  next(ac, dir = 1) {
    const list = VIEWS.filter((v) => v !== 'cabin' || (ac && ac.model.desc.cabin));
    const i = list.indexOf(this.mode);
    this.setMode(list[(i + dir + list.length) % list.length], ac);
  }

  resetLook() { this.lookTarget.yaw = this.mode === 'cabin' ? -80 * DEG : 0; this.lookTarget.pitch = -8 * DEG; this.zoom = 1; this.orbit.yaw = 2.6; this.orbit.pitch = 0.18; }

  handleMouse(m, buttons) {
    const sens = 0.0032 * settings.c.mouseSensitivity;
    const inside = this.mode === 'cockpit' || this.mode === 'cabin';
    if (buttons) {
      if (inside) {
        this.lookTarget.yaw = clamp(this.lookTarget.yaw - m.dx * sens, -2.7, 2.7);
        this.lookTarget.pitch = clamp(this.lookTarget.pitch - m.dy * sens, -1.2, 1.2);
      } else {
        this.orbit.yaw -= m.dx * sens;
        this.orbit.pitch = clamp(this.orbit.pitch + m.dy * sens, -1.2, 1.45);
      }
    }
    if (m.wheel) {
      if (inside) this.zoom = clamp(this.zoom * (m.wheel > 0 ? 1.08 : 0.92), 0.45, 1.35);
      else this.orbit.dist = clamp(this.orbit.dist * (m.wheel > 0 ? 1.1 : 0.9), 6, 600);
    }
  }

  update(dt, ac, env) {
    const cam = this.cam, fm = ac.fm, root = ac.root;
    const mode = this.mode === 'cinematic' ? this.cinematic(dt, ac) : this.mode;
    this.look.yaw = damp(this.look.yaw, this.lookTarget.yaw, 14, dt);
    this.look.pitch = damp(this.look.pitch, this.lookTarget.pitch, 14, dt);
    const baseFov = settings.g.fov || 62;
    let fov = baseFov;
    this.renderer.cockpitMode = mode === 'cockpit' || mode === 'cabin';
    const size = fm.spec.dims.length;
    root.updateMatrixWorld();
    if (mode === 'cockpit' || mode === 'cabin') {
      const eye = mode === 'cabin' ? ac.cockpit.cabinEye : ac.cockpit.eye;
      // head motion: spring responding to body accelerations (g-forces, bumps, buffet)
      const acc = fm.accelBody;
      const target = _v2.set(-acc.x * 0.012, -(acc.y - 1) * 0.018, acc.z * 0.01);
      const k = 60, c = 11;
      this.headVel.addScaledVector(_v.copy(target).sub(this.head).multiplyScalar(k).addScaledVector(this.headVel, -c), dt);
      this.head.addScaledVector(this.headVel, dt);
      this.head.clampLength(0, 0.06);
      // shake from stall buffet, turbulence, rough ground, engine vibration
      const buffet = (fm.stallWarn || 0) * 0.5 + (fm.onGround ? Math.min(1, fm.telemetry.gs / 40) * 0.25 * (fm.surfaceType === 'grass' ? 2 : 0.6) : 0) + fm.engines.reduce((s, e) => s + (e.vibration || 0), 0) * 0.3 + (fm.vrs || 0) * 0.6 + this.shake;
      this.shake = Math.max(0, this.shake - dt * 2);
      const t = performance.now() / 1000;
      const sx = Math.sin(t * 37) * 0.002 * buffet, sy = Math.sin(t * 43 + 1) * 0.002 * buffet;
      _v.set(eye.x - fm.cg.x + this.head.x + sx, eye.y - fm.cg.y + this.head.y + sy, eye.z - fm.cg.z + this.head.z);
      cam.position.copy(_v).applyQuaternion(root.quaternion).add(root.position);
      _e.set(this.look.pitch, this.look.yaw, 0);
      _q.setFromEuler(_e);
      cam.quaternion.copy(root.quaternion).multiply(_q);
      fov = baseFov * this.zoom;
      cam.near = 0.03;
    } else if (mode === 'chase' || mode === 'orbit') {
      const d = this.orbit.dist || size * 1.25;
      let yaw = this.orbit.yaw, pitch = this.orbit.pitch;
      if (mode === 'chase') {
        // trail the aircraft heading smoothly
        const hdg = -fm.telemetry.heading * DEG;
        yaw = hdg + Math.PI + (this.orbit.yaw - 2.6) * 1.0;
        pitch = 0.12 + (this.orbit.pitch - 0.18);
      }
      _v.set(Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d + size * 0.08, Math.cos(yaw) * Math.cos(pitch) * d);
      const desired = _v.add(root.position);
      if (mode === 'chase') {
        if (!this.chaseInit) { this.chasePos.copy(desired); this.chaseInit = true; }
        this.chasePos.lerp(desired, 1 - Math.exp(-dt * 4.5));
        cam.position.copy(this.chasePos);
      } else cam.position.copy(desired);
      const gy = ac.world.surfaceAt(cam.position.x, cam.position.z) + 1.5;
      if (cam.position.y < gy) cam.position.y = gy;
      cam.lookAt(root.position.x, root.position.y + size * 0.05, root.position.z);
    } else if (mode === 'side' || mode === 'tail' || mode === 'wing') {
      const b = fm.spec.dims.span / 2;
      if (mode === 'side') _v.set(size * 0.9, size * 0.1, -size * 0.05);
      else if (mode === 'tail') _v.set(0, size * 0.22, size * 0.95);
      else _v.set(-b * 0.95, 1.2 + fm.spec.dims.height * 0.1, size * 0.15);
      cam.position.copy(_v).applyQuaternion(root.quaternion).add(root.position);
      if (mode === 'tail') {
        _v2.set(0, 0, -size * 2).applyQuaternion(root.quaternion).add(root.position);
        cam.up.set(0, 1, 0).applyQuaternion(root.quaternion);
        cam.lookAt(_v2);
        cam.up.set(0, 1, 0);
      } else if (mode === 'wing') {
        _v2.set(0, 0, -size * 0.1).applyQuaternion(root.quaternion).add(root.position);
        cam.up.set(0, 1, 0).applyQuaternion(root.quaternion);
        cam.lookAt(_v2);
        cam.up.set(0, 1, 0);
      } else cam.lookAt(root.position);
    } else if (mode === 'tower') {
      let best = null, bd = 1e12;
      for (const ap of AIRPORTS) for (const b of ap.buildings) {
        if (b.type !== 'tower' && b.type !== 'hospital' && b.type !== 'platform') continue;
        const [x, z] = toWorld(ap, b.u, b.v);
        const d = Math.hypot(x - root.position.x, z - root.position.z);
        if (d < bd) { bd = d; best = { x, z, y: (ap.type === 'heliport' || ap.type === 'offshore' ? 0 : ap.elev) + (b.h || 40) + 2 }; }
      }
      cam.position.set(best.x, best.y, best.z);
      cam.lookAt(root.position);
      const dist = cam.position.distanceTo(root.position);
      fov = clamp(2 * Math.atan(size * 1.6 / dist) / DEG, 2, baseFov);
    } else if (mode === 'flyby') {
      const v = fm.vel.length();
      if (!this.flybyPos || this.flybyPos.distanceTo(root.position) > Math.max(400, v * 9) || v < 3 && this.flybyPos.distanceTo(root.position) > 120) {
        const ahead = _v.copy(fm.vel).setY(0).normalize();
        if (!Number.isFinite(ahead.x) || ahead.lengthSq() < 0.5) ahead.set(0, 0, -1).applyQuaternion(root.quaternion);
        this.flybyPos = root.position.clone().addScaledVector(ahead, Math.max(150, v * 5)).add(new THREE.Vector3(ahead.z * size * 1.2, size * 0.2, -ahead.x * size * 1.2));
        const gy = ac.world.surfaceAt(this.flybyPos.x, this.flybyPos.z) + 2;
        if (this.flybyPos.y < gy) this.flybyPos.y = gy;
      }
      cam.position.copy(this.flybyPos);
      cam.lookAt(root.position);
      const dist = cam.position.distanceTo(root.position);
      fov = clamp(2 * Math.atan(size * 1.8 / dist) / DEG, 8, baseFov);
    }
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (mode !== 'cockpit' && mode !== 'cabin') cam.near = 1.0;
    cam.updateMatrixWorld();
    this.effectiveMode = mode;
  }

  cinematic(dt, ac) {
    const c = this.cine;
    c.t -= dt;
    if (c.t <= 0) {
      const shots = ['chase', 'flyby', 'side', 'orbit', 'tower', 'tail', 'wing'];
      c.shot = (c.shot + 1 + Math.floor(Math.random() * 2)) % shots.length;
      c.mode = shots[c.shot];
      c.t = c.mode === 'flyby' ? 12 : 8 + Math.random() * 4;
      this.flybyPos = null; this.chaseInit = false;
      this.orbit.yaw = Math.random() * 6.28; this.orbit.pitch = 0.05 + Math.random() * 0.35;
    }
    if (c.mode === 'orbit') this.orbit.yaw += dt * 0.12;
    return c.mode;
  }

  addShake(v) { this.shake = Math.min(2, this.shake + v); }
}
