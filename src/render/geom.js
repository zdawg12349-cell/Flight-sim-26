// Geometry helpers: batching/merging by material, boxes with metric UVs, ribbons, lathe profiles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();

function normalize(g) {
  if (g.index) g = g.toNonIndexed();
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  return g;
}

export class Batch {
  constructor() { this.parts = new Map(); }
  add(key, geo, matrix = null) {
    let g = normalize(geo);
    if (matrix) g.applyMatrix4(matrix);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return this;
  }
  addAt(key, geo, x, y, z, ry = 0, rx = 0, rz = 0, s = 1) {
    _m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));
    return this.add(key, geo, _m);
  }
  build(materials, parent, opts = {}) {
    const meshes = [];
    for (const [key, list] of this.parts) {
      const mat = materials[key];
      if (!mat) { console.warn('Batch: missing material', key); continue; }
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!g) continue;
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = key;
      mesh.castShadow = !!opts.castShadow && !(opts.noShadow && opts.noShadow.includes(key));
      mesh.receiveShadow = opts.receiveShadow !== false;
      if (opts.layer !== undefined) mesh.layers.set(opts.layer);
      if (opts.renderOrder) mesh.renderOrder = opts.renderOrder;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.parts.clear();
    return meshes;
  }
}

// Box with UVs in metres / uvScale (so textures repeat according to real size). Origin at base centre.
export function boxUV(w, h, d, su = 4, sv = 4) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    if (ny > 0.5) uv.setXY(i, x / su, z / sv);
    else if (nx > 0.5) uv.setXY(i, z / su, y / sv);
    else uv.setXY(i, x / su, y / sv);
  }
  return g;
}

// Flat quad in XZ plane centred at (cx,cz) with length along heading angle (radians, 0=north).
export function flatQuad(cx, y, cz, len, wid, hdgRad, uvMode = 'world', uvScale = 20, uv = null) {
  const dx = Math.sin(hdgRad), dz = -Math.cos(hdgRad);
  const rx = Math.cos(hdgRad), rz = Math.sin(hdgRad);
  const hl = len / 2, hw = wid / 2;
  const p = [
    [cx - dx * hl - rx * hw, cz - dz * hl - rz * hw],
    [cx - dx * hl + rx * hw, cz - dz * hl + rz * hw],
    [cx + dx * hl + rx * hw, cz + dz * hl + rz * hw],
    [cx + dx * hl - rx * hw, cz + dz * hl - rz * hw],
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([p[0][0], y, p[0][1], p[1][0], y, p[1][1], p[2][0], y, p[2][1], p[3][0], y, p[3][1]], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  let uvs;
  if (uv) uvs = uv;
  else if (uvMode === 'world') uvs = p.flatMap((q) => [q[0] / uvScale, q[1] / uvScale]);
  else uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

// Flat ribbon along a polyline with round joints (for taxiways and lines).
export function ribbon(pts, width, y, uvScale = 20) {
  const geos = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const hdg = Math.atan2(bx - ax, -(bz - az));
    geos.push(flatQuad((ax + bx) / 2, y, (az + bz) / 2, len, width, hdg, 'world', uvScale));
  }
  for (let i = 0; i < pts.length; i++) {
    const c = new THREE.CircleGeometry(width / 2, 14).rotateX(-Math.PI / 2).translate(pts[i][0], y, pts[i][1]);
    const p = c.attributes.position, uv = c.attributes.uv;
    for (let k = 0; k < p.count; k++) uv.setXY(k, p.getX(k) / uvScale, p.getZ(k) / uvScale);
    geos.push(c);
  }
  return geos;
}

export function cyl(rTop, rBot, h, seg = 12, open = false) {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open).translate(0, h / 2, 0);
}

export { mergeGeometries };
