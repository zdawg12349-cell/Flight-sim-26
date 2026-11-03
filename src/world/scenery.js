// Instanced vegetation and buildings streamed around the camera.
// Near trees are 3D meshes, far trees are cheap crossed billboards; buildings are
// grouped in 1 km tiles so whole tiles can be culled and dropped with distance.
import * as THREE from 'three';
import { LC } from './worldgen.js';
import { mulberry32, hashStr, clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { makeCanvas } from '../render/textures.js';
import { LAYER_WORLD } from '../render/renderer.js';
import { quality } from '../perf/monitor.js';

function colorGeometry(geo, color) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  const lin = color.map((v) => Math.pow(v, 2.2));   // authored in sRGB, vertex colours are linear
  for (let i = 0; i < n; i++) { c[i * 3] = lin[0]; c[i * 3 + 1] = lin[1]; c[i * 3 + 2] = lin[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

function merge(geos) {
  // minimal merge (non-indexed) of geometries with position/normal/color
  let total = 0;
  const parts = geos.map((g) => { const gg = g.index ? g.toNonIndexed() : g; total += gg.attributes.position.count; return gg; });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

function coniferGeometry() {
  const trunk = colorGeometry(new THREE.CylinderGeometry(0.18, 0.26, 2.2, 5).translate(0, 1.1, 0), [0.32, 0.22, 0.14]);
  const c1 = colorGeometry(new THREE.ConeGeometry(2.4, 5.0, 7).translate(0, 4.0, 0), [0.15, 0.30, 0.16]);
  const c2 = colorGeometry(new THREE.ConeGeometry(1.8, 4.2, 7).translate(0, 6.6, 0), [0.17, 0.33, 0.18]);
  const c3 = colorGeometry(new THREE.ConeGeometry(1.1, 3.2, 6).translate(0, 8.9, 0), [0.19, 0.36, 0.19]);
  const g = merge([trunk, c1, c2, c3]);
  g.computeBoundingSphere();
  return g;
}

function deciduousGeometry() {
  const trunk = colorGeometry(new THREE.CylinderGeometry(0.2, 0.32, 3.2, 5).translate(0, 1.6, 0), [0.35, 0.25, 0.16]);
  const crown = new THREE.IcosahedronGeometry(2.8, 1);
  const p = crown.attributes.position;
  const rnd = mulberry32(3);
  for (let i = 0; i < p.count; i++) {
    const k = 0.85 + rnd() * 0.3;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k);
  }
  crown.computeVertexNormals();
  crown.translate(0, 5.6, 0);
  colorGeometry(crown, [0.26, 0.40, 0.17]);
  const g = merge([trunk, crown]);
  g.computeBoundingSphere();
  return g;
}

function billboardTexture() {
  const S = 128, c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  // conifer silhouette left half, deciduous right half
  ctx.fillStyle = '#4a3020'; ctx.fillRect(S * 0.24, S * 0.78, S * 0.04, S * 0.22); ctx.fillRect(S * 0.74, S * 0.72, S * 0.04, S * 0.28);
  const rnd = mulberry32(17);
  for (let i = 0; i < 260; i++) {
    const y = rnd(), w = (1 - y) * 0.22 + 0.02;
    ctx.fillStyle = `rgb(${30 + rnd() * 25 | 0},${62 + rnd() * 35 | 0},${32 + rnd() * 18 | 0})`;
    ctx.beginPath(); ctx.arc(S * (0.26 + (rnd() - 0.5) * w * 2), S * (0.05 + y * 0.75), S * (0.015 + rnd() * 0.03), 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.2;
    ctx.fillStyle = `rgb(${50 + rnd() * 30 | 0},${80 + rnd() * 40 | 0},${30 + rnd() * 20 | 0})`;
    ctx.beginPath(); ctx.arc(S * (0.76 + Math.cos(a) * r), S * (0.42 + Math.sin(a) * r * 1.1), S * (0.02 + rnd() * 0.035), 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function billboardGeometry() {
  // two crossed quads; uv.x in [0,0.5] = conifer, the instance chooses via uv offset attribute
  const g = new THREE.BufferGeometry();
  const w = 3.2, h = 10;
  const pos = [-w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0, 0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w];
  const uv = [0, 0, 0.5, 0, 0.5, 1, 0, 1, 0, 0, 0.5, 0, 0.5, 1, 0, 1];
  const nor = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

// Building facade shader: procedural windows + night lights on a Lambert material.
function makeBuildingMaterial(uniforms, roofy = false) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: roofy });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying float vSeed;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wpp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vWP = wpp.xyz; vWN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying float vSeed; uniform float uNight;')
      .replace('#include <map_fragment>', `
        float vert = 1.0 - step(0.6, abs(vWN.y));
        vec2 t = normalize(vec2(-vWN.z, vWN.x) + 1e-5);
        float u = dot(vWP.xz, t);
        float flH = ${roofy ? '2.9' : '3.4'};
        float wy = fract(vWP.y / flH), wx = fract(u / 2.9);
        float win = step(0.18, wx) * step(wx, 0.82) * step(0.28, wy) * step(wy, 0.86) * vert * step(1.5, vWP.y - 0.0);
        ${roofy ? 'win *= step(0.5, fract(u / 5.8));' : ''}
        vec3 glass = vec3(0.16, 0.2, 0.26) + 0.08 * vSeed;
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.85);
        diffuseColor.rgb *= mix(0.62, 1.0, vert);
        vec2 cell = floor(vec2(u / 2.9, vWP.y / flH));
        float lit = step(0.55 - uNight * 0.1, fract(sin(dot(cell, vec2(41.3, 289.1)) + vSeed * 91.7) * 15731.7));
        vec3 winLight = mix(vec3(1.0, 0.78, 0.45), vec3(0.8, 0.9, 1.0), step(0.7, fract(vSeed * 7.3)));
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += winLight * win * lit * uNight * 1.4;`);
  };
  m.customProgramCacheKey = () => roofy ? 'bld_house' : 'bld_tower';
  return m;
}

function houseGeometry() {
  // 1x1x1 box body + gable roof (scaled per instance)
  const body = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const roof = new THREE.BufferGeometry();
  const v = [-0.55, 1, -0.55, 0.55, 1, -0.55, 0, 1.45, -0.55, -0.55, 1, 0.55, 0.55, 1, 0.55, 0, 1.45, 0.55];
  roof.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  roof.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4]);
  roof.computeVertexNormals();
  const b = body.toNonIndexed(); const r = roof.toNonIndexed();
  colorGeometry(b, [1, 1, 1]); colorGeometry(r, [0.45, 0.22, 0.17]);
  return merge([b, r]);
}

export class Scenery {
  constructor(world, scene, env) {
    this.world = world; this.scene = scene; this.env = env;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.uniforms = { uNight: { value: 0 } };
    const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.treeMat = treeMat;
    this.capacity = { near: 16000, far: 30000 };
    this.conifers = new THREE.InstancedMesh(coniferGeometry(), treeMat, this.capacity.near);
    this.deciduous = new THREE.InstancedMesh(deciduousGeometry(), treeMat, this.capacity.near);
    const bbMat = new THREE.MeshLambertMaterial({ map: billboardTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
    bbMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_INSTANCING\n vMapUv.x += step(0.5, fract(instanceMatrix[3].x * 0.137)) * 0.5;\n#endif');
    };
    this.farTrees = new THREE.InstancedMesh(billboardGeometry(), bbMat, this.capacity.far);
    for (const m of [this.conifers, this.deciduous, this.farTrees]) {
      m.count = 0; m.frustumCulled = false; m.layers.set(LAYER_WORLD);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    this.conifers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity.near * 3), 3);
    this.deciduous.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity.near * 3), 3);
    this.treeCenter = new THREE.Vector2(1e9, 1e9);
    this.treeJob = null;

    this.bldMat = makeBuildingMaterial(this.uniforms, false);
    this.houseMat = makeBuildingMaterial(this.uniforms, true);
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.houseGeo = houseGeometry();
    this.tiles = new Map();
    this.tileSize = 1000;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  // ---------- trees ----------
  *treeGenerator(cx, cz) {
    const g = settings.g;
    const w = this.world;
    const dens = g.treeDensity * Math.sqrt(quality.treeK);
    const nearR = Math.min(1500, 650 + 600 * dens) * quality.treeK, farR = g.treeRadius * quality.treeK;
    const out = { con: [], dec: [], far: [] };
    const nearStep = 19 / Math.sqrt(Math.max(0.2, dens)), farStep = 42 / Math.sqrt(Math.max(0.2, dens));
    let t0 = performance.now();
    const scan = function* (R0, R, step, near) {
      const x0 = Math.floor((cx - R) / step) * step, z0 = Math.floor((cz - R) / step) * step;
      for (let z = z0; z <= cz + R; z += step) {
        for (let x = x0; x <= cx + R; x += step) {
          const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
          if (d2 > R * R || d2 < R0 * R0) continue;
          const seed = (Math.imul(Math.round(x / step), 73856093) ^ Math.imul(Math.round(z / step), 19349663)) >>> 0;
          const r = mulberry32(seed);
          const px = x + (r() - 0.5) * step * 0.9, pz = z + (r() - 0.5) * step * 0.9;
          const lc = w.landclassAt(px, pz);
          let p = 0;
          if (lc === LC.FOREST) p = 0.85; else if (lc === LC.SUBURB) p = 0.14; else if (lc === LC.GRASS) p = 0.07; else if (lc === LC.FARM) p = 0.02; else if (lc === LC.AIRPORT) p = 0.0;
          if (r() > p) continue;
          if (w.airportWeight(px, pz) > 0.02) continue;
          const h = w.heightAt(px, pz);
          if (h < 0.8) continue;
          const sc = 0.7 + r() * 0.65;
          const conifer = h > 600 ? r() < 0.85 : r() < 0.38;
          const item = [px, h, pz, sc, r() * 6.283, conifer ? 1 : 0, r()];
          if (near) (conifer ? out.con : out.dec).push(item); else out.far.push(item);
        }
        if (performance.now() - t0 > 2.5) { yield null; t0 = performance.now(); }
      }
    };
    yield* scan(0, nearR, nearStep, true);
    yield* scan(nearR - 30, farR, farStep, false);
    return out;
  }

  applyTrees(out) {
    const fill = (mesh, list, cap, colored) => {
      const n = Math.min(cap, list.length);
      for (let i = 0; i < n; i++) {
        const it = list[i];
        this._p.set(it[0], it[1] - 0.2, it[2]);
        this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, it[4]);
        this._s.set(it[3], it[3] * (0.85 + it[6] * 0.4), it[3]);
        this._m.compose(this._p, this._q, this._s);
        mesh.setMatrixAt(i, this._m);
        if (colored) {
          const v = 0.8 + it[6] * 0.4;
          this._c.setRGB(v * (0.9 + it[6] * 0.2), v, v * 0.9, THREE.SRGBColorSpace);
          mesh.setColorAt(i, this._c);
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (colored && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    fill(this.conifers, out.con, this.capacity.near, true);
    fill(this.deciduous, out.dec, this.capacity.near, true);
    fill(this.farTrees, out.far, this.capacity.far, false);
  }

  // ---------- buildings ----------
  buildTile(tx, tz) {
    const w = this.world, S = this.tileSize;
    const x0 = tx * S, z0 = tz * S;
    const rnd = mulberry32(hashStr(`b${tx},${tz}`));
    const towers = [], houses = [];
    const step = 46;
    for (let z = z0 + step / 2; z < z0 + S; z += step) {
      for (let x = x0 + step / 2; x < x0 + S; x += step) {
        const lc = w.landclassAt(x, z);
        if (lc !== LC.URBAN && lc !== LC.SUBURB && lc !== LC.FARM) continue;
        if (lc === LC.FARM && rnd() > 0.012) continue;
        if (lc === LC.SUBURB && rnd() < 0.3) continue;
        if (w.airportWeight(x, z) > 0.05) continue;
        const { town, dist } = w.nearestTown(x, z);
        const px = x + (rnd() - 0.5) * 14, pz = z + (rnd() - 0.5) * 14;
        const h0 = w.heightAt(px, pz);
        if (h0 < 0.6) continue;
        const rot = (town ? Math.round(rnd() * 0.2 * 10) / 10 : rnd() * 3) + (town ? (hashStr(town.name) % 7) * 0.12 : 0);
        if (lc === LC.URBAN) {
          const centre = town ? Math.max(0, 1 - dist / (town.r * 0.6)) : 0;
          const tall = town ? town.tall : 0.1;
          let hgt = 8 + rnd() * 14 + Math.pow(centre, 2.2) * tall * (60 + rnd() * 120);
          if (rnd() < 0.08 * tall) hgt *= 1.5;
          const fw = 18 + rnd() * 18, fd = 16 + rnd() * 18;
          const shade = 0.62 + rnd() * 0.32;
          const tint = rnd();
          towers.push([px, h0 - 1, pz, fw, hgt, fd, rot, shade * (tint < 0.3 ? 1.05 : 0.95), shade, shade * (tint > 0.7 ? 1.08 : 0.92)]);
        } else {
          const n = lc === LC.FARM ? 2 : (rnd() < 0.75 ? 2 : 1);
          for (let k = 0; k < n; k++) {
            const hx = px + (k ? 18 : 0), hz = pz + (k ? (rnd() - 0.5) * 12 : 0);
            const hh = w.heightAt(hx, hz);
            const big = lc === LC.FARM && k === 1;
            const fw = big ? 22 : 9 + rnd() * 5, fd = big ? 14 : 8 + rnd() * 4, hgt = big ? 7 : 3.2 + rnd() * 3;
            const pale = 0.75 + rnd() * 0.25;
            houses.push([hx, hh - 0.6, hz, fw, hgt, fd, rot + (k ? 0.1 : 0), pale, pale * (0.92 + rnd() * 0.08), pale * (0.82 + rnd() * 0.12)]);
          }
        }
      }
    }
    const make = (list, geo, mat) => {
      if (!list.length) return null;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((b, i) => {
        this._p.set(b[0], b[1], b[2]);
        this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, b[6]);
        this._s.set(b[3], b[4], b[5]);
        this._m.compose(this._p, this._q, this._s);
        m.setMatrixAt(i, this._m);
        m.setColorAt(i, this._c.setRGB(b[7], b[8], b[9], THREE.SRGBColorSpace));
      });
      m.computeBoundingSphere();
      m.layers.set(LAYER_WORLD);
      m.receiveShadow = false; m.castShadow = false;
      this.group.add(m);
      return m;
    };
    return { towers: make(towers, this.boxGeo, this.bldMat), houses: make(houses, this.houseGeo, this.houseMat), cx: x0 + S / 2, cz: z0 + S / 2, count: towers.length + houses.length };
  }

  update(dt, camPos) {
    const g = settings.g;
    this.uniforms.uNight.value = 1 - Math.min(1, Math.max(0, (this.env.sunElevation + 2) / 8));
    // trees: regenerate when the camera moved far enough
    const d = Math.hypot(camPos.x - this.treeCenter.x, camPos.z - this.treeCenter.y);
    if (quality.treeK !== this.lastTreeK) { this.lastTreeK = quality.treeK; this.treeCenter.set(1e9, 1e9); }
    if (!this.treeJob && d > Math.max(220, g.treeRadius * 0.12)) {
      this.treeCenter.set(camPos.x, camPos.z);
      this.treeJob = this.treeGenerator(camPos.x, camPos.z);
    }
    if (this.treeJob) {
      const r = this.treeJob.next();
      if (r.done) { this.applyTrees(r.value); this.treeJob = null; }
    }
    // building tiles
    const S = this.tileSize, R = g.buildingRadius * quality.buildK;
    const tx0 = Math.floor((camPos.x - R) / S), tx1 = Math.floor((camPos.x + R) / S);
    const tz0 = Math.floor((camPos.z - R) / S), tz1 = Math.floor((camPos.z + R) / S);
    let built = 0;
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = tx * 100000 + tz;
        let t = this.tiles.get(key);
        const cx = (tx + 0.5) * S, cz = (tz + 0.5) * S;
        const dist = Math.hypot(cx - camPos.x, cz - camPos.z);
        if (!t) {
          if (dist > R || built >= 1) continue;
          t = this.buildTile(tx, tz); built++;
          this.tiles.set(key, t);
        }
        t.seen = performance.now();
        const vis = dist < R;
        // houses are small: limit to 60% of radius
        if (t.towers) t.towers.visible = vis;
        if (t.houses) t.houses.visible = dist < R * 0.6;
      }
    }
    // hide tiles outside the scan window
    if ((this._k = (this._k || 0) + 1) % 60 === 0) {
      const now = performance.now();
      for (const [k, t] of this.tiles) {
        if (now - t.seen > 1500) {
          if (t.towers) t.towers.visible = false;
          if (t.houses) t.houses.visible = false;
        }
      }
    }
  }

  // Force-generate trees and nearby tiles synchronously (loading screen).
  preload(camPos) {
    this.treeCenter.set(camPos.x, camPos.z);
    const job = this.treeGenerator(camPos.x, camPos.z);
    let r;
    do { r = job.next(); } while (!r.done);
    this.applyTrees(r.value);
    const S = this.tileSize, R = Math.min(settings.g.buildingRadius, 6000);
    for (let tz = Math.floor((camPos.z - R) / S); tz <= Math.floor((camPos.z + R) / S); tz++) {
      for (let tx = Math.floor((camPos.x - R) / S); tx <= Math.floor((camPos.x + R) / S); tx++) {
        const key = tx * 100000 + tz;
        if (!this.tiles.has(key)) this.tiles.set(key, this.buildTile(tx, tz));
      }
    }
  }
}
