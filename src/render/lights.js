// GPU point-sprite lights: runway/taxiway/approach lights, PAPI, beacons, vehicle light bars.
// One draw call per light set; directional fixtures fade with viewing angle; PAPI colours
// are computed per-vertex from the viewer's elevation angle; flashers use a phase attribute.
import * as THREE from 'three';
import { glowTexture } from './textures.js';

const VS = /* glsl */`
attribute vec3 color; attribute float size; attribute vec3 dir; attribute float flash; attribute float papi;
uniform float uTime; uniform float uScale; uniform float uOn; uniform float uDay;
varying vec3 vColor; varying float vAlpha;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  vec3 toCam = cameraPosition - wp.xyz;
  float dist = length(toCam);
  vec3 c = color;
  float a = 1.0;
  if (dot(dir, dir) > 0.01) a *= smoothstep(-0.15, 0.35, dot(normalize(dir), toCam / dist));
  if (papi > 0.0) {
    float ang = atan(toCam.y, length(toCam.xz));
    c = ang > papi ? vec3(1.0, 0.95, 0.9) : vec3(1.0, 0.08, 0.04);
  }
  if (flash > 0.0) {
    float ph = fract(uTime * 1.9 - flash);
    a *= step(ph, 0.07) * 1.8;
  } else if (flash < 0.0) {
    float ph = fract(uTime * (-flash));
    a *= 0.15 + 0.85 * step(ph, 0.5);
  }
  vColor = c;
  vAlpha = a * mix(uOn, 1.0, step(0.5, abs(flash))) * (1.0 - uDay * 0.75);
  float px = size * uScale / max(-mv.z, 1.0);
  gl_PointSize = clamp(px, 1.4, 64.0) * (0.6 + 0.4 * a);
  vAlpha *= clamp(px / 1.4, 0.35, 1.0);
}`;

const FS = /* glsl */`
uniform sampler2D uTex;
varying vec3 vColor; varying float vAlpha;
void main(){
  float t = texture2D(uTex, gl_PointCoord).r;
  if (vAlpha * t < 0.01) discard;
  gl_FragColor = vec4(vColor * t * vAlpha * 1.6, 1.0);
}`;

export class LightSet {
  constructor(name = 'lights') {
    this.pos = []; this.col = []; this.size = []; this.dir = []; this.flash = []; this.papi = [];
    this.name = name;
    this.points = null;
  }
  add(x, y, z, color, size = 1, dir = null, flash = 0, papi = 0) {
    this.pos.push(x, y, z);
    this.col.push(color[0], color[1], color[2]);
    this.size.push(size);
    if (dir) this.dir.push(dir[0], dir[1], dir[2]); else this.dir.push(0, 0, 0);
    this.flash.push(flash);
    this.papi.push(papi);
  }
  get count() { return this.size.length; }
  build(uniforms) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(this.size, 1));
    g.setAttribute('dir', new THREE.Float32BufferAttribute(this.dir, 3));
    g.setAttribute('flash', new THREE.Float32BufferAttribute(this.flash, 1));
    g.setAttribute('papi', new THREE.Float32BufferAttribute(this.papi, 1));
    g.computeBoundingSphere();
    const m = new THREE.ShaderMaterial({
      uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.name = this.name;
    this.points.renderOrder = 10;
    return this.points;
  }
}

export function makeLightUniforms() {
  return {
    uTime: { value: 0 }, uScale: { value: 600 }, uOn: { value: 1 }, uDay: { value: 0 }, uTex: { value: glowTexture() },
  };
}

export const LC_WHITE = [1.0, 0.95, 0.85];
export const LC_YELLOW = [1.0, 0.8, 0.35];
export const LC_GREEN = [0.25, 1.0, 0.45];
export const LC_RED = [1.0, 0.12, 0.08];
export const LC_BLUE = [0.25, 0.4, 1.0];
export const LC_AMBER = [1.0, 0.6, 0.15];
export const LC_SODIUM = [1.0, 0.72, 0.4];
