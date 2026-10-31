// Sea and lake surfaces with animated normals, Fresnel sky reflection and sun glint.
import * as THREE from 'three';
import { noiseTexture } from '../render/textures.js';
import { LAYER_WORLD } from '../render/renderer.js';

const VS = /* glsl */`
#include <common>
#include <fog_pars_vertex>
varying vec3 vWPos;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FS = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise; uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunI;
uniform vec3 uSky; uniform vec3 uHorizon; uniform vec3 uDeep; uniform vec3 uShallow; uniform float uRough; uniform float uDetail;
varying vec3 vWPos;
void main(){
  vec3 V = cameraPosition - vWPos;
  float dist = length(V); V /= dist;
  vec2 p = vWPos.xz;
  vec2 n1 = texture2D(uNoise, p / 95.0 + vec2(uTime * 0.012, uTime * 0.007)).rg - 0.5;
  vec2 n2 = texture2D(uNoise, p / 31.0 - vec2(uTime * 0.02, -uTime * 0.016)).rg - 0.5;
  vec2 n3 = texture2D(uNoise, p / 520.0 + vec2(uTime * 0.004, 0.0)).rg - 0.5;
  float fade = 1.0 - smoothstep(300.0, 9000.0, dist);
  vec2 slope = (n1 * 0.9 + n2 * 0.5 * uDetail) * uRough * (0.35 + 0.65 * fade) + n3 * 0.25;
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uSky, smoothstep(0.0, 0.45, R.y));
  vec3 water = mix(uDeep, uShallow, 0.25 + 0.25 * n3.x);
  vec3 col = mix(water, sky, fres);
  float spec = pow(max(dot(R, uSunDir), 0.0), 220.0) * 6.0 + pow(max(dot(R, uSunDir), 0.0), 18.0) * 0.12;
  col += uSunColor * spec * uSunI;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Water {
  constructor(scene, world, env) {
    this.env = env;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uNoise: { value: noiseTexture() }, uTime: { value: 0 }, uSunDir: { value: env.sunDir }, uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSunI: { value: 1 }, uSky: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color(0.02, 0.07, 0.11) }, uShallow: { value: new THREE.Color(0.05, 0.16, 0.19) }, uRough: { value: 0.6 }, uDetail: { value: 1 },
    }]);
    this.uniforms.uNoise.value = noiseTexture();
    this.uniforms.uSunDir.value = env.sunDir;
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, fog: true });
    // Sea: big plane following the camera (snapped)
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(240000, 240000, 1, 1).rotateX(-Math.PI / 2), this.material);
    sea.position.y = 0;
    sea.layers.set(LAYER_WORLD);
    sea.frustumCulled = false;
    sea.renderOrder = -5;
    scene.add(sea);
    this.sea = sea;
    this.lakes = [];
    for (const l of world.lakes) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(l.r * 1.45, 48).rotateX(-Math.PI / 2), this.material);
      m.position.set(l.x, l.level, l.z);
      m.layers.set(LAYER_WORLD);
      scene.add(m);
      this.lakes.push(m);
    }
  }

  update(dt, camPos, windSpeed) {
    const u = this.uniforms;
    u.uTime.value += dt;
    this.sea.position.x = Math.round(camPos.x / 1000) * 1000;
    this.sea.position.z = Math.round(camPos.z / 1000) * 1000;
    const env = this.env;
    u.uSky.value.copy(env.skyUniforms.uZenith.value);
    u.uHorizon.value.copy(env.fogColor);
    u.uSunColor.value.copy(env.sun.color);
    u.uSunI.value = env.sunElevation > -2 ? env.sun.intensity / 3 : 0.0;
    u.uRough.value = 0.35 + Math.min(1.2, windSpeed / 18);
    const d = env.daylight;
    u.uDeep.value.setRGB(0.012 + 0.02 * d, 0.03 + 0.05 * d, 0.05 + 0.07 * d);
    u.uShallow.value.setRGB(0.02 + 0.05 * d, 0.05 + 0.11 * d, 0.07 + 0.12 * d);
  }
}
