// Quadtree level-of-detail terrain built from World.heightAt().
// Distant terrain uses large, coarse chunks; nearby terrain uses small, dense chunks.
import * as THREE from 'three';
import { WORLD_HALF, WORLD_SIZE } from './worldgen.js';
import { settings } from '../core/settings.js';
import { terrainDetailTexture } from '../render/textures.js';
import { LAYER_WORLD } from '../render/renderer.js';
import { quality } from '../perf/monitor.js';

const SEG = 32;
const MAX_LEVEL = 7;           // 81920 / 2^7 = 640 m leaves (20 m vertex spacing)
const VPS = SEG + 1;

function buildIndex() {
  const idx = [];
  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * VPS + i, b = a + 1, c = a + VPS, d = c + 1;
      // alternate diagonals for nicer shading
      if ((i + j) & 1) { idx.push(a, c, b, b, c, d); } else { idx.push(a, c, d, a, d, b); }
    }
  }
  // skirts: edge vertex k has skirt vertex base + k
  const base = VPS * VPS;
  const edge = [];
  for (let i = 0; i < SEG; i++) edge.push([i, i + 1]);                                   // north edge (j=0)
  for (let j = 0; j < SEG; j++) edge.push([j * VPS + SEG, (j + 1) * VPS + SEG]);         // east edge
  for (let i = SEG; i > 0; i--) edge.push([SEG * VPS + i, SEG * VPS + i - 1]);           // south edge
  for (let j = SEG; j > 0; j--) edge.push([j * VPS, (j - 1) * VPS]);                     // west edge
  const skirtOf = new Map();
  let s = 0;
  const skirtIdx = (v) => { if (!skirtOf.has(v)) skirtOf.set(v, base + s++); return skirtOf.get(v); };
  for (const [a, b] of edge) {
    const sa = skirtIdx(a), sb = skirtIdx(b);
    idx.push(a, sa, b, b, sa, sb);
  }
  return { index: idx, skirtVerts: [...skirtOf.entries()].sort((p, q) => p[1] - q[1]).map((p) => p[0]) };
}

export class Terrain {
  constructor(world, scene, colormap) {
    this.world = world;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    const { index, skirtVerts } = buildIndex();
    this.indexAttr = new THREE.Uint16BufferAttribute(index, 1);
    this.skirtVerts = skirtVerts;
    this.nodes = new Map();
    this.queue = [];
    this.frameId = 0;
    this.visibleCount = 0;
    this.uniforms = {
      uDetail: { value: terrainDetailTexture() },
      uLights: { value: colormap.lightTexture },
      uNight: { value: 0 },
      uSnowLine: { value: 2300 },
      uWet: { value: 0 },
    };
    this.material = this.makeMaterial(colormap.texture);
    this.lodFactor = 1.0;
    // Build the 4 level-1 roots synchronously so the world is always covered.
    for (let iz = 0; iz < 2; iz++) for (let ix = 0; ix < 2; ix++) this.ensure(1, ix, iz, true);
    this.buildOuterRing();
  }

  makeMaterial(colormap) {
    const mat = new THREE.MeshLambertMaterial({ map: colormap });
    const U = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vNY;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvNY = normal.y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; varying float vNY;
          uniform sampler2D uDetail; uniform sampler2D uLights; uniform float uNight; uniform float uSnowLine; uniform float uWet;`)
        .replace('#include <map_fragment>', `
          vec3 cm = texture2D(map, vMapUv).rgb;
          float vd = length(vViewPosition);
          vec3 d1 = texture2D(uDetail, vWPos.xz / 38.0).rgb;
          vec3 d2 = texture2D(uDetail, vWPos.xz / 410.0).rgb;
          float near = 1.0 - smoothstep(700.0, 7000.0, vd);
          float detail = mix(1.0, 0.72 + 0.56 * d1.r, near) * (0.86 + 0.28 * d2.g);
          vec3 col = cm * detail;
          float rock = smoothstep(0.84, 0.66, vNY);
          col = mix(col, vec3(0.40, 0.38, 0.35) * (0.78 + 0.44 * d1.g), rock * 0.85);
          float snow = smoothstep(uSnowLine, uSnowLine + 180.0, vWPos.y + (d2.r - 0.5) * 260.0) * smoothstep(0.5, 0.78, vNY);
          col = mix(col, vec3(0.90, 0.92, 0.96), snow);
          col *= 1.0 - uWet * 0.18;
          diffuseColor.rgb *= col;
        `)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float lm = texture2D(uLights, vMapUv).r;
          float sparkle = step(0.6, texture2D(uDetail, vWPos.xz / 22.0).b);
          totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * lm * uNight * (0.25 + sparkle * 1.6);
        `);
    };
    mat.customProgramCacheKey = () => 'terrain_v1';
    return mat;
  }

  key(l, ix, iz) { return (l << 24) | (ix << 12) | iz; }

  ensure(level, ix, iz, sync = false) {
    const k = this.key(level, ix, iz);
    let n = this.nodes.get(k);
    if (!n) {
      const size = WORLD_SIZE / (1 << level);
      n = { level, ix, iz, size, cx: -WORLD_HALF + (ix + 0.5) * size, cz: -WORLD_HALF + (iz + 0.5) * size, mesh: null, queued: false, used: 0, hmin: 0, hmax: 0 };
      this.nodes.set(k, n);
    }
    if (!n.mesh && sync) this.buildNode(n);
    return n;
  }

  buildNode(n) {
    const w = this.world;
    const step = n.size / SEG;
    const x0 = n.cx - n.size / 2, z0 = n.cz - n.size / 2;
    // heights with 1-sample border for normals
    const B = VPS + 2;
    const hs = new Float32Array(B * B);
    let hmin = 1e9, hmax = -1e9;
    for (let j = 0; j < B; j++) {
      const z = z0 + (j - 1) * step;
      for (let i = 0; i < B; i++) {
        const h = w.heightAt(x0 + (i - 1) * step, z);
        hs[j * B + i] = h;
      }
    }
    const nv = VPS * VPS + this.skirtVerts.length;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    for (let j = 0; j < VPS; j++) {
      for (let i = 0; i < VPS; i++) {
        const v = j * VPS + i;
        const h = hs[(j + 1) * B + i + 1];
        if (h < hmin) hmin = h; if (h > hmax) hmax = h;
        const lx = (i - SEG / 2) * step, lz = (j - SEG / 2) * step;
        pos[v * 3] = lx; pos[v * 3 + 1] = h; pos[v * 3 + 2] = lz;
        const hl = hs[(j + 1) * B + i], hr = hs[(j + 1) * B + i + 2], hd = hs[j * B + i + 1], hu = hs[(j + 2) * B + i + 1];
        let nx = hl - hr, ny = 2 * step, nz = hd - hu;
        const l = Math.hypot(nx, ny, nz);
        nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
        uv[v * 2] = (x0 + i * step + WORLD_HALF) / WORLD_SIZE;
        uv[v * 2 + 1] = 1 - (z0 + j * step + WORLD_HALF) / WORLD_SIZE;
      }
    }
    const drop = step * 1.5 + 4;
    this.skirtVerts.forEach((src, k) => {
      const v = VPS * VPS + k;
      pos[v * 3] = pos[src * 3]; pos[v * 3 + 1] = pos[src * 3 + 1] - drop; pos[v * 3 + 2] = pos[src * 3 + 2];
      nor[v * 3] = nor[src * 3]; nor[v * 3 + 1] = nor[src * 3 + 1]; nor[v * 3 + 2] = nor[src * 3 + 2];
      uv[v * 2] = uv[src * 2]; uv[v * 2 + 1] = uv[src * 2 + 1];
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(this.indexAttr);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-n.size / 2, hmin - drop, -n.size / 2), new THREE.Vector3(n.size / 2, hmax, n.size / 2));
    g.boundingSphere = new THREE.Sphere();
    g.boundingBox.getBoundingSphere(g.boundingSphere);
    const m = new THREE.Mesh(g, this.material);
    m.position.set(n.cx, 0, n.cz);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.receiveShadow = true;
    m.visible = false;
    m.layers.set(LAYER_WORLD);
    this.group.add(m);
    n.mesh = m; n.hmin = hmin; n.hmax = hmax; n.queued = false;
  }

  buildOuterRing() {
    // Large low-detail tiles surrounding the world square so the horizon is never empty.
    const size = WORLD_SIZE / 2;
    for (let iz = -1; iz <= 2; iz++) {
      for (let ix = -1; ix <= 2; ix++) {
        if (ix >= 0 && ix <= 1 && iz >= 0 && iz <= 1) continue;
        const n = { level: 1, ix, iz, size, cx: -WORLD_HALF + (ix + 0.5) * size, cz: -WORLD_HALF + (iz + 0.5) * size, mesh: null };
        this.buildNode(n);
        n.mesh.visible = true;
      }
    }
  }

  dispose(n) {
    if (!n.mesh) return;
    this.group.remove(n.mesh);
    n.mesh.geometry.dispose();
    n.mesh = null;
  }

  update(camPos, aglM) {
    this.frameId++;
    const f = this.frameId;
    const detail = (settings.g.terrainDetail || 1) * this.lodFactor * quality.lodK;
    const K = 1.55 * detail;
    const camX = camPos.x, camY = camPos.y, camZ = camPos.z;
    const maxLevel = aglM > 4000 ? MAX_LEVEL - 2 : aglM > 1500 ? MAX_LEVEL - 1 : MAX_LEVEL;
    const want = [];
    let shown = 0;
    const visit = (n) => {
      n.used = f;
      // distance from camera to chunk box (3D)
      const dx = Math.max(0, Math.abs(camX - n.cx) - n.size / 2);
      const dz = Math.max(0, Math.abs(camZ - n.cz) - n.size / 2);
      const dy = Math.max(0, camY - n.hmax, n.hmin - camY);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const split = n.level < maxLevel && d < n.size * K;
      if (split) {
        const l = n.level + 1, bx = n.ix * 2, bz = n.iz * 2;
        const kids = [this.ensure(l, bx, bz), this.ensure(l, bx + 1, bz), this.ensure(l, bx, bz + 1), this.ensure(l, bx + 1, bz + 1)];
        let ready = true;
        for (const k of kids) {
          if (!k.mesh) { ready = false; k.used = f; if (!k.queued) { k.queued = true; k.prio = d; want.push(k); } }
        }
        if (ready) { for (const k of kids) visit(k); return; }
      }
      if (n.mesh) { n.mesh.visible = true; n.shownFrame = f; shown++; }
    };
    for (let iz = 0; iz < 2; iz++) for (let ix = 0; ix < 2; ix++) visit(this.ensure(1, ix, iz));
    // hide meshes not shown this frame
    for (const n of this.nodes.values()) {
      if (n.mesh && n.shownFrame !== f) n.mesh.visible = false;
    }
    this.visibleCount = shown;
    // queue management: closest first, time-budgeted building
    for (const k of want) this.queue.push(k);
    if (this.queue.length) {
      this.queue.sort((a, b) => a.prio - b.prio);
      const t0 = performance.now();
      const budget = this.loading ? 40 : 2.5;
      while (this.queue.length && performance.now() - t0 < budget) {
        const n = this.queue.shift();
        if (!n.mesh && n.used >= f - 2) this.buildNode(n); else n.queued = false;
      }
      // drop stale requests
      if (this.queue.length > 64) { for (const n of this.queue.splice(64)) n.queued = false; }
    }
    // evict unused chunks occasionally
    if ((f & 127) === 0 && this.nodes.size > 500) {
      for (const [k, n] of this.nodes) {
        if (n.level > 2 && f - n.used > 600) { this.dispose(n); this.nodes.delete(k); }
      }
    }
    return this.queue.length;
  }

  // Build all chunks needed for a position immediately (used during loading).
  async preload(camPos, agl, onProgress) {
    this.loading = true;
    for (let i = 0; i < 40; i++) {
      const pending = this.update(camPos, agl);
      onProgress && onProgress(Math.min(1, i / 12));
      if (!pending) break;
      await new Promise((r) => setTimeout(r, 0));
    }
    this.loading = false;
  }
}
