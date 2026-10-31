// Weather: wind (with boundary-layer profile, veer, gusts), turbulence, presets, clouds,
// precipitation and lightning. Physics queries windAt(); visuals are updated per frame.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, noise2, fbm, mulberry32, DEG, KT, FT } from '../core/math.js';
import { settings } from '../core/settings.js';
import { cloudPuffTexture, noiseTexture } from '../render/textures.js';
import { LAYER_WORLD } from '../render/renderer.js';
import { bus } from '../core/events.js';
import { quality } from '../perf/monitor.js';

export const WEATHER_PRESETS = {
  clear: { label: 'Clear skies', cover: 0.04, base: 1600, thick: 600, vis: 70000, windDir: 270, wind: 5, gust: 0, turb: 0.05, precip: 0, type: 'rain', temp: 19, qnh: 1019 },
  fair: { label: 'Fair weather cumulus', cover: 0.28, base: 1200, thick: 900, vis: 50000, windDir: 250, wind: 8, gust: 12, turb: 0.15, precip: 0, type: 'rain', temp: 21, qnh: 1015 },
  scattered: { label: 'Scattered clouds', cover: 0.45, base: 1000, thick: 1100, vis: 40000, windDir: 230, wind: 10, gust: 16, turb: 0.22, precip: 0, type: 'rain', temp: 17, qnh: 1012 },
  broken: { label: 'Broken clouds', cover: 0.68, base: 800, thick: 1200, vis: 28000, windDir: 220, wind: 12, gust: 18, turb: 0.28, precip: 0, type: 'rain', temp: 14, qnh: 1008 },
  overcast: { label: 'Overcast', cover: 0.95, base: 650, thick: 1400, vis: 14000, windDir: 200, wind: 12, gust: 18, turb: 0.25, precip: 0.0, type: 'rain', temp: 11, qnh: 1004 },
  rain: { label: 'Rain', cover: 1.0, base: 450, thick: 2200, vis: 5000, windDir: 200, wind: 15, gust: 24, turb: 0.38, precip: 0.7, type: 'rain', temp: 10, qnh: 999 },
  storm: { label: 'Thunderstorms', cover: 1.0, base: 500, thick: 5000, vis: 3000, windDir: 230, wind: 22, gust: 38, turb: 0.75, precip: 1.0, type: 'rain', temp: 16, qnh: 994, lightning: true },
  snow: { label: 'Snow', cover: 1.0, base: 500, thick: 1800, vis: 2500, windDir: 330, wind: 10, gust: 16, turb: 0.25, precip: 0.75, type: 'snow', temp: -5, qnh: 1010 },
  fog: { label: 'Fog', cover: 0.2, base: 80, thick: 150, vis: 500, windDir: 180, wind: 2, gust: 0, turb: 0.02, precip: 0, type: 'rain', temp: 8, qnh: 1021 },
  crosswind: { label: 'Gusty crosswind', cover: 0.3, base: 1300, thick: 900, vis: 45000, windDir: 0, wind: 22, gust: 34, turb: 0.5, precip: 0, type: 'rain', temp: 15, qnh: 1006 },
};

const PUFF_VS = /* glsl */`
attribute vec4 aOffset;   // xyz world, w size
attribute vec2 aShade;    // x: vertical shade (0 bottom..1 top), y: rotation
uniform float uFade; uniform vec3 uCam;
varying vec2 vUv; varying float vShade; varying float vAlpha;
#include <fog_pars_vertex>
void main(){
  vUv = uv;
  vShade = aShade.x;
  vec3 c = aOffset.xyz;
  vec4 mvC = viewMatrix * vec4(c, 1.0);
  float r = aShade.y;
  vec2 p = position.xy;
  p = vec2(cos(r) * p.x - sin(r) * p.y, sin(r) * p.x + cos(r) * p.y) * aOffset.w;
  vec4 mvPosition = mvC + vec4(p, 0.0, 0.0);
  gl_Position = projectionMatrix * mvPosition;
  float d = length(c - uCam);
  vAlpha = (1.0 - smoothstep(uFade * 0.75, uFade, d)) * smoothstep(aOffset.w * 0.4, aOffset.w * 1.4, d);
  #include <fog_vertex>
}`;
const PUFF_FS = /* glsl */`
uniform sampler2D uTex; uniform vec3 uTop; uniform vec3 uBottom; uniform float uDensity;
varying vec2 vUv; varying float vShade; varying float vAlpha;
#include <fog_pars_fragment>
void main(){
  vec4 t = texture2D(uTex, vUv);
  float a = t.a * vAlpha * uDensity;
  if (a < 0.02) discard;
  vec3 col = mix(uBottom, uTop, clamp(vShade * 0.7 + t.g * 0.45, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}`;

const DECK_FS = /* glsl */`
uniform sampler2D uNoise; uniform vec3 uTop; uniform vec3 uBottom; uniform float uCover; uniform float uTime; uniform float uBelow;
varying vec3 vW;
#include <fog_pars_fragment>
void main(){
  vec2 p = vW.xz;
  float n = texture2D(uNoise, p / 9000.0 + uTime * 0.0004).r * 0.6 + texture2D(uNoise, p / 2300.0 - uTime * 0.0007).g * 0.4;
  float a = smoothstep(1.0 - uCover - 0.15, 1.0 - uCover + 0.25, n);
  vec3 col = mix(uTop, uBottom, uBelow) * (0.85 + 0.25 * n);
  gl_FragColor = vec4(col, a * 0.96);
  #include <fog_fragment>
}`;

export class Weather {
  constructor(scene, env) {
    this.scene = scene; this.env = env;
    this.preset = 'clear';
    this.state = { ...WEATHER_PRESETS.clear };
    this.windDir = 270; this.windKt = 5; this.gustKt = 0; this.turb = 0.05;
    this.tempOffset = 4; this.qnh = 1013.25;
    this.precip = 0; this.precipType = 'rain'; this.wetness = 0; this.snowCover = 0;
    this.visibility = 50000; this.cover = 0; this.cloudBase = 1500; this.cloudThick = 600;
    this.inCloud = 0;
    this.surfaceWind = new THREE.Vector3();
    this.turbRates = new THREE.Vector3();
    this.gustState = 0; this.gustTarget = 0; this.gustTimer = 0;
    this.lightning = false; this.flashTimer = 5;
    this.time = 0;
    this.seed = 1;
    this.cloudGroup = new THREE.Group();
    scene.add(this.cloudGroup);
    this.puffCap = 0;
    this.buildDeck();
    this.buildPrecip();
    this.set('clear');
  }

  set(name, overrides = {}) {
    const p = { ...(WEATHER_PRESETS[name] || WEATHER_PRESETS.clear), ...overrides };
    this.preset = name;
    this.state = p;
    this.windDir = p.windDir; this.windKt = p.wind; this.gustKt = Math.max(p.wind, p.gust || 0); this.turb = p.turb;
    this.tempOffset = p.temp - 15; this.qnh = p.qnh;
    this.precip = p.precip; this.precipType = p.type;
    this.visibility = p.vis; this.cover = p.cover; this.cloudBase = p.base; this.cloudThick = p.thick;
    this.lightning = !!p.lightning;
    this.wetness = p.precip > 0 && p.type === 'rain' ? clamp(p.precip * 1.2, 0, 1) : (p.vis < 1000 ? 0.2 : 0);
    this.snowCover = p.type === 'snow' ? clamp(p.precip * 1.1, 0, 1) : 0;
    this.seed = Math.floor(Math.random() * 1000);
    this.rebuildClouds = true;
    this.env.setWeather({ overcast: clamp((p.cover - 0.45) / 0.5, 0, 1), visibility: p.vis, precip: p.precip, precipType: p.type, cloudBase: p.base, lightning: this.lightning });
    bus.emit('weather', this.describe());
  }

  setCustom(o) {
    this.windDir = o.windDir ?? this.windDir; this.windKt = o.wind ?? this.windKt; this.gustKt = Math.max(this.windKt, o.gust ?? this.gustKt);
    this.turb = o.turb ?? this.turb;
    if (o.vis) { this.visibility = o.vis; this.env.setWeather({ visibility: o.vis }); }
    bus.emit('weather', this.describe());
  }

  describe() {
    return { preset: this.preset, label: this.state.label, windDir: this.windDir, windKt: this.windKt, gustKt: this.gustKt, vis: this.visibility, cover: this.cover, base: this.cloudBase, temp: this.tempOffset + 15, qnh: this.qnh, precip: this.precip, type: this.precipType };
  }

  // METAR-style string for ATIS.
  metar(icao) {
    const d = this.describe();
    const w = `${String(Math.round(d.windDir / 10) * 10).padStart(3, '0')}${String(Math.round(d.windKt)).padStart(2, '0')}${d.gustKt > d.windKt + 4 ? 'G' + Math.round(d.gustKt) : ''}KT`;
    const vis = d.vis >= 10000 ? '9999' : String(Math.round(d.vis / 100) * 100).padStart(4, '0');
    const wx = d.precip > 0 ? (d.type === 'snow' ? (d.precip > 0.6 ? '+SN' : 'SN') : this.lightning ? 'TSRA' : d.precip > 0.6 ? '+RA' : 'RA') : d.vis < 1000 ? 'FG' : '';
    const cov = d.cover < 0.1 ? 'SKC' : `${d.cover < 0.3 ? 'FEW' : d.cover < 0.55 ? 'SCT' : d.cover < 0.88 ? 'BKN' : 'OVC'}${String(Math.round(d.base / FT / 100)).padStart(3, '0')}`;
    const t = Math.round(d.temp);
    return `${icao} ${w} ${vis} ${wx} ${cov} ${t < 0 ? 'M' + -t : t}/${t - 3 < 0 ? 'M' + (3 - t) : t - 3} Q${Math.round(d.qnh)}`.replace(/\s+/g, ' ');
  }

  // Wind vector (m/s, direction the air moves) at a world position, including gusts & turbulence.
  windAt(pos, t, out, agl = 100) {
    const h = Math.max(0.5, agl);
    const prof = clamp(Math.log(h / 0.08) / Math.log(10 / 0.08), 0.35, 1.0) * (1 + 0.45 * smoothstep(10, 1500, h));
    const veer = 18 * smoothstep(10, 1200, h);
    const spd = (this.windKt + (this.gustKt - this.windKt) * this.gustState) * KT * prof;
    const dir = (this.windDir + veer + 6 * noise2(t * 0.05, 3.7)) * DEG;
    // wind FROM dir -> air moves toward dir+180
    out.set(-Math.sin(dir) * spd, 0, Math.cos(dir) * spd);
    // turbulence (spatially varying, so faster aircraft feel higher frequencies)
    const ti = this.turbIntensity(pos, h);
    if (ti > 0.001) {
      const L = 140;
      const x = pos.x / L, z = pos.z / L, y = pos.y / L;
      const s = ti * (1.2 + this.windKt * 0.06);
      out.x += s * noise2(x + t * 0.15, z + 11.3);
      out.z += s * noise2(z - t * 0.13, x + 7.1);
      out.y += s * 0.8 * noise2(x + y + t * 0.2, z - 5.5);
      this.turbRates.set(
        s * 0.6 * noise2(x * 2.3 + t * 0.9, z * 2.1),
        s * 0.5 * noise2(z * 2.2 - t * 0.8, x * 1.9 + 4.4),
        s * 0.4 * noise2(x * 1.7 + 9.1, z * 1.6 + t * 0.7),
      );
    } else this.turbRates.set(0, 0, 0);
    return out;
  }

  turbIntensity(pos, agl) {
    let ti = this.turb;
    ti += this.turb * 0.8 * (1 - smoothstep(30, 600, agl)) * smoothstep(3, 12, this.windKt);   // mechanical
    ti += this.inCloud * 0.25 + (this.lightning ? 0.3 : 0);
    if (pos.y > 900 && agl < 900) ti += 0.15 * smoothstep(8, 25, this.windKt);                 // mountain rotor
    return ti * (1 - smoothstep(this.cloudBase + this.cloudThick + 1500, this.cloudBase + this.cloudThick + 4000, pos.y) * 0.6);
  }

  // ---------------------------------------------------------- per-frame update (visuals + gust process)
  update(dt, camPos, world) {
    this.time += dt;
    // gust process: random bursts toward gust speed
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = 2 + Math.random() * 7;
      this.gustTarget = this.gustKt > this.windKt + 2 ? (Math.random() < 0.45 ? 0.5 + Math.random() * 0.5 : Math.random() * 0.25) : 0;
    }
    this.gustState += (this.gustTarget - this.gustState) * (1 - Math.exp(-dt * (this.gustTarget > this.gustState ? 1.5 : 0.6)));
    const dir = this.windDir * DEG, spd = (this.windKt + (this.gustKt - this.windKt) * this.gustState) * KT;
    this.surfaceWind.set(-Math.sin(dir) * spd, 0, Math.cos(dir) * spd);
    // in-cloud factor for the camera (fog whiteout)
    const top = this.cloudBase + this.cloudThick;
    let ic = 0;
    if (this.cover > 0.05 && camPos.y > this.cloudBase && camPos.y < top) {
      const n = fbm(camPos.x / 3500 + this.seed, camPos.z / 3500, 2) * 0.5 + 0.5;
      ic = smoothstep(1 - this.cover - 0.05, 1 - this.cover + 0.15, n) * smoothstep(this.cloudBase, this.cloudBase + 60, camPos.y) * (1 - smoothstep(top - 80, top, camPos.y));
      if (this.cover > 0.85) ic = Math.max(ic, smoothstep(this.cloudBase, this.cloudBase + 50, camPos.y) * (1 - smoothstep(top - 60, top, camPos.y)));
    }
    this.inCloud += (ic - this.inCloud) * (1 - Math.exp(-dt * 2.5));
    const visEff = lerp(this.visibility, 60, this.inCloud);
    this.env.weather.visibility = visEff;
    // lightning
    if (this.lightning) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flashTimer = 4 + Math.random() * 14;
        this.env.flash = 1;
        const dist = 1500 + Math.random() * 9000;
        setTimeout(() => bus.emit('sound', Math.random() < 0.5 ? 'thunder1' : 'thunder2'), dist / 343 * 1000 * 0.4);
      }
    }
    this.env.flash = Math.max(0, this.env.flash - dt * (this.env.flash > 0.5 ? 6 : 2.5)) * (Math.random() < 0.08 && this.env.flash > 0.2 ? 1.4 : 1);
    this.updateClouds(dt, camPos);
    this.updatePrecip(dt, camPos);
  }

  // ---------------------------------------------------------- clouds
  buildDeck() {
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uNoise: { value: null }, uTop: { value: new THREE.Color(1, 1, 1) }, uBottom: { value: new THREE.Color(0.5, 0.52, 0.56) }, uCover: { value: 0 }, uTime: { value: 0 }, uBelow: { value: 1 } }]);
    u.uNoise.value = noiseTexture();
    const m = new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      vertexShader: `varying vec3 vW;\n#include <fog_pars_vertex>\nvoid main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}`,
      fragmentShader: DECK_FS,
    });
    this.deck = new THREE.Mesh(new THREE.PlaneGeometry(160000, 160000).rotateX(-Math.PI / 2), m);
    this.deck.frustumCulled = false;
    this.deck.renderOrder = 3;
    this.deck.layers.set(LAYER_WORLD);
    this.scene.add(this.deck);
    this.deckTop = this.deck.clone();
    this.deckTop.material = m.clone(); this.deckTop.material.uniforms = THREE.UniformsUtils.clone(u); this.deckTop.material.uniforms.uNoise.value = u.uNoise.value;
    this.scene.add(this.deckTop);
  }

  ensurePuffs(cap) {
    if (this.puffs && this.puffCap >= cap) return;
    if (this.puffs) { this.cloudGroup.remove(this.puffs); this.puffs.geometry.dispose(); }
    this.puffCap = cap;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aShade = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.aOffset.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aOffset', this.aOffset); g.setAttribute('aShade', this.aShade);
    g.instanceCount = 0;
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: null }, uTop: { value: new THREE.Color(1, 1, 1) }, uBottom: { value: new THREE.Color(0.6, 0.62, 0.66) }, uDensity: { value: 1 }, uFade: { value: 30000 }, uCam: { value: new THREE.Vector3() } }]);
    u.uTex.value = cloudPuffTexture();
    this.puffMat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: PUFF_VS, fragmentShader: PUFF_FS, transparent: true, depthWrite: false, fog: true });
    this.puffs = new THREE.Mesh(g, this.puffMat);
    this.puffs.frustumCulled = false;
    this.puffs.renderOrder = 4;
    this.puffs.layers.set(LAYER_WORLD);
    this.cloudGroup.add(this.puffs);
    this.puffList = [];
  }

  generatePuffs(camPos) {
    const cap = Math.round(settings.g.cloudPuffs * quality.cloudK);
    this.ensurePuffs(settings.g.cloudPuffs);
    const list = [];
    const cover = this.cover;
    if (cover < 0.02 || cover > 0.97) { this.puffList = list; return; }
    const cell = 1400;
    const R = Math.min(settings.g.drawDistance * 0.8, 28000);
    const cx0 = Math.floor((camPos.x - R) / cell), cx1 = Math.floor((camPos.x + R) / cell);
    const cz0 = Math.floor((camPos.z - R) / cell), cz1 = Math.floor((camPos.z + R) / cell);
    const base = this.cloudBase, thick = Math.min(this.cloudThick, 1600);
    const cells = [];
    for (let iz = cz0; iz <= cz1; iz++) for (let ix = cx0; ix <= cx1; ix++) {
      const x = (ix + 0.5) * cell, z = (iz + 0.5) * cell;
      const d = Math.hypot(x - camPos.x, z - camPos.z);
      if (d > R) continue;
      const n = fbm(x / 3500 + this.seed, z / 3500, 2) * 0.5 + 0.5;
      if (n < 1 - cover - 0.05) continue;
      cells.push({ ix, iz, x, z, d, n });
    }
    cells.sort((a, b) => a.d - b.d);
    for (const c of cells) {
      const rnd = mulberry32((c.ix * 73856093) ^ (c.iz * 19349663) ^ this.seed);
      const nClusters = 1 + Math.floor(rnd() * 2);
      for (let k = 0; k < nClusters; k++) {
        const ccx = c.x + (rnd() - 0.5) * cell * 0.8, ccz = c.z + (rnd() - 0.5) * cell * 0.8;
        const size = 250 + rnd() * 450 * (0.6 + cover);
        const far = c.d > R * 0.55;
        const puffs = far ? 4 : 9 + Math.floor(rnd() * 10);
        const hgt = thick * (0.35 + rnd() * 0.65);
        for (let p = 0; p < puffs; p++) {
          if (list.length >= cap) break;
          const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * size;
          const up = rnd();
          const y = base + up * hgt * (1 - r / size * 0.6);
          const s = (far ? 2.2 : 1) * (size * (0.55 + rnd() * 0.5)) * (1 - up * 0.35);
          list.push([ccx + Math.cos(a) * r, y + s * 0.25, ccz + Math.sin(a) * r * 0.8, s, up, rnd() * 6.28]);
        }
      }
      if (list.length >= cap) break;
    }
    this.puffList = list;
    this.lastCloudPos = camPos.clone();
  }

  updateClouds(dt, camPos) {
    if (quality.cloudK !== this.lastCloudK) { this.lastCloudK = quality.cloudK; this.rebuildClouds = true; }
    if (this.rebuildClouds || !this.lastCloudPos || this.lastCloudPos.distanceTo(camPos) > 2500) { this.generatePuffs(camPos); this.rebuildClouds = false; this.sortTimer = 0; }
    // drift with wind
    const drift = this.surfaceWind.clone().multiplyScalar(dt * 1.6);
    // sort back-to-front occasionally (cheap for ~1-2k puffs)
    this.sortTimer = (this.sortTimer || 0) - dt;
    const L = this.puffList || [];
    for (const p of L) { p[0] += drift.x; p[2] += drift.z; }
    if (this.puffs) {
      if (this.sortTimer <= 0) {
        this.sortTimer = 0.4;
        for (const p of L) p[6] = (p[0] - camPos.x) ** 2 + (p[1] - camPos.y) ** 2 + (p[2] - camPos.z) ** 2;
        L.sort((a, b) => b[6] - a[6]);
      }
      const o = this.aOffset.array, s = this.aShade.array;
      for (let i = 0; i < L.length; i++) {
        const p = L[i];
        o[i * 4] = p[0]; o[i * 4 + 1] = p[1]; o[i * 4 + 2] = p[2]; o[i * 4 + 3] = p[3];
        s[i * 2] = p[4]; s[i * 2 + 1] = p[5];
      }
      this.aOffset.needsUpdate = true; this.aShade.needsUpdate = true;
      this.puffs.geometry.instanceCount = L.length;
      const u = this.puffMat.uniforms;
      u.uCam.value.copy(camPos);
      u.uFade.value = Math.min(settings.g.drawDistance * 0.85, 30000);
      const env = this.env;
      const sunK = Math.max(0.05, env.daylight);
      u.uTop.value.copy(env.sun.color).multiplyScalar(0.55 * sunK + 0.15).add(env.hemi.color.clone().multiplyScalar(0.5));
      u.uBottom.value.copy(env.hemi.color).multiplyScalar(0.55 * (1 - 0.3 * this.cover)).addScalar(0.02);
      u.uDensity.value = 0.95;
    }
    // overcast deck
    const deckCover = clamp((this.cover - 0.55) / 0.4, 0, 1);
    this.deck.visible = deckCover > 0.01;
    this.deckTop.visible = deckCover > 0.01 && this.cloudThick > 150;
    if (this.deck.visible) {
      const env = this.env;
      this.deck.position.set(Math.round(camPos.x / 1000) * 1000, this.cloudBase, Math.round(camPos.z / 1000) * 1000);
      this.deckTop.position.set(this.deck.position.x, this.cloudBase + Math.min(this.cloudThick, 2500), this.deck.position.z);
      for (const [m, below] of [[this.deck, 1], [this.deckTop, 0]]) {
        const u = m.material.uniforms;
        u.uCover.value = clamp(this.cover * 1.02, 0, 1); u.uTime.value = this.time;
        u.uTop.value.copy(env.sun.color).multiplyScalar(0.4 * env.daylight + 0.1).add(env.hemi.color.clone().multiplyScalar(0.6));
        u.uBottom.value.copy(env.hemi.color).multiplyScalar(0.45 * (1 - 0.35 * this.precip));
        u.uBelow.value = camPos.y < m.position.y ? 1 : 0.1;
      }
    }
  }

  // ---------------------------------------------------------- precipitation (GPU animated)
  buildPrecip() {
    const n = 12000;
    const pos = new Float32Array(n * 2 * 3), seed = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      for (let k = 0; k < 2; k++) {
        pos[(i * 2 + k) * 3] = x; pos[(i * 2 + k) * 3 + 1] = y; pos[(i * 2 + k) * 3 + 2] = z;
        seed[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(seed, 1));
    const u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(0, -9, 0) }, uBox: { value: 60 }, uLen: { value: 0.06 }, uColor: { value: new THREE.Color(0.7, 0.75, 0.82) }, uAlpha: { value: 0.35 } };
    this.precipMat = new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false,
      vertexShader: `attribute float aEnd; uniform float uTime; uniform vec3 uCam; uniform vec3 uVel; uniform float uBox; uniform float uLen; varying float vA;
        void main(){
          vec3 p = position * uBox + uVel * uTime;
          p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
          p -= uVel * uLen * aEnd;
          vA = 1.0 - aEnd * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = 3.0;
          vA *= smoothstep(uBox * 0.5, uBox * 0.15, length(mv.xyz));
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(uColor, uAlpha * vA); }`,
    });
    this.rain = new THREE.LineSegments(g, this.precipMat);
    this.rain.frustumCulled = false;
    this.rain.layers.set(LAYER_WORLD);
    this.rain.renderOrder = 12;
    this.scene.add(this.rain);
    // snow as points
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) sp[i] = Math.random();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snowMat = new THREE.ShaderMaterial({
      uniforms: { uTime: u.uTime, uCam: u.uCam, uVel: { value: new THREE.Vector3(0, -1.2, 0) }, uBox: { value: 50 }, uAlpha: { value: 0.8 } },
      transparent: true, depthWrite: false,
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform vec3 uVel; uniform float uBox; varying float vA;
        void main(){
          vec3 p = position * uBox + uVel * uTime;
          p.x += sin(uTime * 0.8 + position.y * 40.0) * 0.6; p.z += cos(uTime * 0.7 + position.x * 40.0) * 0.6;
          p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(60.0 / max(1.0, -mv.z), 1.0, 7.0);
          vA = smoothstep(uBox * 0.5, uBox * 0.1, length(mv.xyz));
        }`,
      fragmentShader: `uniform float uAlpha; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; if (dot(c,c) > 0.25) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, uAlpha * vA); }`,
    });
    this.snow = new THREE.Points(sg, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.layers.set(LAYER_WORLD);
    this.snow.renderOrder = 12;
    this.scene.add(this.snow);
  }

  updatePrecip(dt, camPos) {
    const below = camPos.y < this.cloudBase + 200;
    const amount = this.precip * (below ? 1 : 0);
    const cap = settings.g.precipCount;
    const count = Math.floor(cap * amount);
    this.precipMat.uniforms.uTime.value = this.time;
    this.precipMat.uniforms.uCam.value.copy(camPos);
    const w = this.surfaceWind;
    if (this.precipType === 'rain') {
      this.rain.visible = count > 0; this.snow.visible = false;
      this.rain.geometry.setDrawRange(0, count * 2);
      this.precipMat.uniforms.uVel.value.set(w.x * 0.8 - (this.camVel?.x || 0) * 0.0, -10.5, w.z * 0.8);
      this.precipMat.uniforms.uAlpha.value = 0.22 + 0.25 * this.precip;
      const day = this.env.daylight;
      this.precipMat.uniforms.uColor.value.setRGB(0.55 + 0.25 * day, 0.6 + 0.25 * day, 0.68 + 0.22 * day);
    } else {
      this.snow.visible = count > 0; this.rain.visible = false;
      this.snow.geometry.setDrawRange(0, count);
      this.snowMat.uniforms.uVel.value.set(w.x * 0.9, -1.3, w.z * 0.9);
    }
  }
}
