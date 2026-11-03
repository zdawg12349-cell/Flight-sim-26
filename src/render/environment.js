// Sky dome, sun/moon lighting, stars, fog and environment map driven by time of day and weather.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, DEG } from '../core/math.js';
import { settings } from '../core/settings.js';
import { LAYER_WORLD, LAYER_OWN } from './renderer.js';

const SKY_VS = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99995, p.w);
}`;

const SKY_FS = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uSunColor;
uniform vec3 uGround; uniform vec3 uFogColor; uniform float uHaze; uniform float uSunVis; uniform vec3 uMoonDir; uniform float uMoonVis;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float hp = max(h, 0.0);
  float t = pow(1.0 - hp, 5.0);
  vec3 col = mix(uZenith, uHorizon, t);
  float cs = dot(d, uSunDir);
  float mie = pow(max(cs, 0.0), 6.0) * 0.28 + pow(max(cs, 0.0), 48.0) * 0.55 + pow(max(cs,0.0), 600.0) * 1.5;
  float horizBand = exp(-abs(h) * 9.0);
  col += uGlow * (mie + horizBand * pow(max(cs * 0.5 + 0.5, 0.0), 3.0) * 0.55);
  float disk = smoothstep(0.99955, 0.99975, cs) * uSunVis;
  col += uSunColor * disk * 18.0;
  float md = dot(d, uMoonDir);
  col += vec3(0.85, 0.88, 0.95) * smoothstep(0.99965, 0.99978, md) * uMoonVis * 1.6;
  col += vec3(0.25, 0.28, 0.35) * pow(max(md, 0.0), 300.0) * uMoonVis * 0.25;
  // haze toward fog colour near horizon (visibility)
  col = mix(col, uFogColor, clamp(uHaze * exp(-hp * 6.0), 0.0, 1.0));
  if (h < 0.0) col = mix(uFogColor, uGround, smoothstep(0.0, -0.35, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const tmpC = new THREE.Color();
function c3(r, g, b) { return new THREE.Color(r, g, b); }
function mixC(a, b, t, out) { out.r = lerp(a.r, b.r, t); out.g = lerp(a.g, b.g, t); out.b = lerp(a.b, b.b, t); return out; }

const NIGHT_Z = c3(0.004, 0.007, 0.018), TWI_Z = c3(0.07, 0.11, 0.26), DAY_Z = c3(0.13, 0.30, 0.70);
const NIGHT_H = c3(0.018, 0.025, 0.045), SUNSET_H = c3(0.95, 0.52, 0.28), DAY_H = c3(0.62, 0.74, 0.90);
const OVC = c3(0.55, 0.58, 0.63);

export class Environment {
  constructor(renderer) {
    this.renderer = renderer;
    const scene = renderer.scene;
    this.scene = scene;
    this.time = 10.5;          // hours
    this.timeScale = 1;        // sim seconds per real second for the clock
    this.season = 'summer';
    this.latitude = 38;
    this.weather = { overcast: 0.1, visibility: 40000, precip: 0, precipType: 'rain', lightning: 0, cloudBase: 1500 };
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.sunElevation = 45;
    this.daylight = 1;
    this.lightsOn = false;
    this.flash = 0;

    // Sky dome
    const u = {
      uSunDir: { value: this.sunDir }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color(1, 0.95, 0.85) }, uGround: { value: new THREE.Color(0.2, 0.22, 0.2) },
      uFogColor: { value: new THREE.Color() }, uHaze: { value: 0.2 }, uSunVis: { value: 1 }, uMoonDir: { value: this.moonDir }, uMoonVis: { value: 0 },
    };
    this.skyUniforms = u;
    this.skyMat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 40, 20), this.skyMat);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.sky.layers.set(LAYER_WORLD);
    scene.add(this.sky);

    // Stars
    const n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < n; i++) {
      const z = rnd() * 1.1 - 0.1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      pos[i * 3] = Math.cos(a) * r * 900; pos[i * 3 + 1] = z * 900; pos[i * 3 + 2] = Math.sin(a) * r * 900;
      const b = 0.35 + Math.pow(rnd(), 3) * 0.9, tint = rnd();
      col[i * 3] = b * (0.85 + tint * 0.15); col[i * 3 + 1] = b * 0.9; col[i * 3 + 2] = b * (1.0 - tint * 0.1);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -999;
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // Lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.layers.enableAll();
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x4a4436, 1.0);
    this.hemi.layers.enableAll();
    scene.add(this.hemi);
    this.configureShadows();

    scene.fog = new THREE.FogExp2(0xbfd0e0, 0.00006);
    this.fogColor = scene.fog.color;

    // Environment map for PBR materials
    this.pmrem = new THREE.PMREMGenerator(renderer.r);
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), this.skyMat);
    this.envScene.add(this.envSky);
    this.envTarget = null;
    this._envKey = '';
    this._envTimer = 0;
    this.shadowHalf = 40;
    this.update(0, new THREE.Vector3(), new THREE.Vector3());
  }

  configureShadows() {
    const g = settings.g;
    const r = this.renderer.r;
    r.shadowMap.enabled = !!g.shadows;
    this.sun.castShadow = !!g.shadows;
    if (g.shadows) {
      const s = this.sun.shadow;
      if (s.map && s.mapSize.x !== g.shadowMapSize) { s.map.dispose(); s.map = null; }
      s.mapSize.set(g.shadowMapSize, g.shadowMapSize);
      s.camera.near = 1; s.camera.far = 1600;
      s.bias = -0.0004; s.normalBias = 0.04;
      s.camera.layers.enableAll();
    }
    // Shadows are needed for every pass type
    r.shadowMap.needsUpdate = true;
  }

  setTime(h) { this.time = ((h % 24) + 24) % 24; this._envKey = ''; }
  setSeason(s) { this.season = s; this._envKey = ''; }
  setWeather(w) { Object.assign(this.weather, w); this._envKey = ''; }

  computeSun() {
    const dec = { summer: 21, autumn: 0, winter: -21, spring: 4 }[this.season] * DEG;
    const lat = this.latitude * DEG;
    const H = (this.time - 12.2) * 15 * DEG;
    const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    const el = Math.asin(clamp(sinEl, -1, 1));
    const cosAz = (Math.sin(dec) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat) + 1e-9);
    let az = Math.acos(clamp(cosAz, -1, 1));
    if (H > 0) az = 2 * Math.PI - az;
    this.sunElevation = el / DEG;
    this.sunAzimuth = az / DEG;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    // Moon roughly opposite, slightly higher in the sky
    const mel = Math.asin(clamp(-sinEl * 0.8 + 0.25, -1, 1));
    const maz = az + Math.PI * 0.92;
    this.moonDir.set(Math.sin(maz) * Math.cos(mel), Math.sin(mel), -Math.cos(maz) * Math.cos(mel)).normalize();
  }

  update(dt, camPos, focus, hours = null) {
    if (hours === null) this.time = (this.time + dt * this.timeScale / 3600) % 24;
    else this.time = hours;
    this.computeSun();
    const el = this.sunElevation;
    const w = this.weather;
    const ovc = clamp(w.overcast, 0, 1);
    const u = this.skyUniforms;

    // Sky colours
    const zen = u.uZenith.value, hor = u.uHorizon.value;
    mixC(NIGHT_Z, TWI_Z, smoothstep(-15, -3, el), zen);
    mixC(zen, DAY_Z, smoothstep(-3, 25, el), zen);
    mixC(NIGHT_H, SUNSET_H, smoothstep(-13, -1, el), hor);
    mixC(hor, DAY_H, smoothstep(3, 22, el), hor);
    const dayF = smoothstep(-8, 14, el);
    this.daylight = dayF;
    const lum = 0.03 + 0.97 * dayF;
    tmpC.copy(OVC).multiplyScalar(lum * (1 - 0.35 * w.precip));
    mixC(zen, tmpC, ovc * 0.92, zen);
    mixC(hor, tmpC, ovc * 0.85, hor);
    const glow = u.uGlow.value;
    const lowSun = 1 - smoothstep(2, 30, el);
    glow.setRGB(1.0, 0.62 + 0.3 * (1 - lowSun), 0.32 + 0.5 * (1 - lowSun)).multiplyScalar((0.25 + 0.55 * lowSun) * smoothstep(-10, 0, el) * (1 - ovc * 0.85));
    u.uSunVis.value = (1 - smoothstep(0.55, 0.9, ovc)) * smoothstep(-2, 0.5, el);
    u.uMoonVis.value = (1 - smoothstep(0.4, 0.8, ovc)) * (1 - smoothstep(-6, 2, el)) * smoothstep(-0.1, 0.1, this.moonDir.y);
    u.uSunColor.value.setRGB(1.0, 0.75 + 0.2 * (1 - lowSun), 0.5 + 0.4 * (1 - lowSun));

    // Fog from visibility (Koschmieder: 2% contrast)
    const vis = clamp(w.visibility, 150, 120000);
    this.renderer.scene.fog.density = 3.2 / vis;
    const fog = this.fogColor;
    fog.copy(hor).lerp(zen, 0.12);
    if (this.flash > 0) fog.lerp(tmpC.setRGB(0.8, 0.82, 0.95), this.flash * 0.6);
    u.uFogColor.value.copy(fog);
    u.uHaze.value = clamp(1.6 - vis / 18000, 0.08, 1.0);
    u.uGround.value.setRGB(0.16, 0.18, 0.15).multiplyScalar(0.1 + 0.9 * dayF);
    const far = this.renderer.camera.far;
    this.renderer.r.setClearColor(fog);

    // Lights
    const sunUp = smoothstep(-3, 6, el);
    const sunCol = tmpC.setRGB(1.0, 0.55 + 0.42 * smoothstep(0, 28, el), 0.3 + 0.62 * smoothstep(0, 32, el));
    if (sunUp > 0.02) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = 3.1 * sunUp * (1 - 0.72 * ovc) * (1 - 0.3 * w.precip);
      this.lightDir = this.sunDir;
    } else {
      const moonUp = smoothstep(-0.05, 0.25, this.moonDir.y) * (1 - 0.8 * ovc);
      this.sun.color.setRGB(0.55, 0.65, 0.95);
      this.sun.intensity = 0.16 * moonUp;
      this.lightDir = this.moonDir.y > 0 ? this.moonDir : this.sunDir;
    }
    if (this.flash > 0) this.sun.intensity += this.flash * 2.5;
    this.hemi.color.copy(zen).lerp(hor, 0.45).multiplyScalar(1.15);
    if (dayF < 0.2) this.hemi.color.lerp(tmpC.setRGB(0.25, 0.3, 0.45), 0.5);
    this.hemi.groundColor.setRGB(0.34, 0.31, 0.25).multiplyScalar(0.12 + 0.88 * dayF);
    this.hemi.intensity = 0.16 + 1.05 * dayF * (1 - 0.25 * ovc) + ovc * 0.35 * dayF;
    this.renderer.r.toneMappingExposure = lerp(1.55, 1.0, dayF);
    this.lightsOn = el < 3 || vis < 5000 || ovc > 0.92;

    // Stars
    this.starMat.opacity = (1 - smoothstep(-14, -3, el)) * (1 - smoothstep(0.3, 0.75, ovc)) * clamp(vis / 15000, 0, 1);
    this.stars.visible = this.starMat.opacity > 0.01;

    // Follow camera
    this.sky.position.copy(camPos);
    this.sky.scale.setScalar(far * 0.9 / 1000);
    this.stars.position.copy(camPos);
    this.stars.scale.setScalar(far * 0.85 / 900);
    this.stars.rotation.y = this.time / 24 * Math.PI * 2;

    // Shadow camera around focus point, snapped to texel grid
    const ld = this.lightDir || this.sunDir;
    if (this.sun.castShadow) {
      const s = this.sun.shadow, cam = s.camera;
      const half = this.shadowHalf;
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
      cam.updateProjectionMatrix();
      const texel = (half * 2) / s.mapSize.x;
      const fx = Math.round(focus.x / texel) * texel, fy = Math.round(focus.y / texel) * texel, fz = Math.round(focus.z / texel) * texel;
      this.sunTarget.position.set(fx, fy, fz);
      this.sun.position.set(fx + ld.x * 800, fy + ld.y * 800, fz + ld.z * 800);
    } else {
      this.sunTarget.position.copy(focus);
      this.sun.position.set(focus.x + ld.x * 800, focus.y + ld.y * 800, focus.z + ld.z * 800);
    }
    this.sunTarget.updateMatrixWorld();

    // Environment map refresh when appearance changed meaningfully
    this._envTimer -= dt;
    const key = `${Math.round(el / 2)}_${Math.round(ovc * 10)}_${Math.round(w.precip * 5)}`;
    if (settings.g.envMap && (key !== this._envKey || !this.envTarget) && this._envTimer <= 0) {
      this._envKey = key; this._envTimer = 2;
      this.refreshEnvMap();
    } else if (!settings.g.envMap && this.renderer.scene.environment) {
      this.renderer.scene.environment = null;
    }
  }

  refreshEnvMap() {
    const old = this.envTarget;
    this.envSky.scale.setScalar(1);
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, 1000);
    this.renderer.scene.environment = this.envTarget.texture;
    this.renderer.scene.environmentIntensity = 0.55 + 0.3 * this.daylight;
    if (old) old.dispose();
  }

  get isNight() { return this.sunElevation < -4; }
}
