// WebGL renderer wrapper: adaptive resolution, two-pass cockpit rendering, layers.
import * as THREE from 'three';
import { settings } from '../core/settings.js';

export const LAYER_WORLD = 0;
export const LAYER_OWN = 1;     // own aircraft exterior + cockpit + cabin (drawn in second pass in cockpit views)

export class Renderer {
  constructor(container) {
    this.container = container;
    const g = settings.g;
    const canvas = document.createElement('canvas');
    canvas.id = 'gl';
    container.appendChild(canvas);
    this.canvas = canvas;
    let r;
    const opts = { canvas, antialias: !!g.antialias, powerPreference: 'high-performance', stencil: false, alpha: false, preserveDrawingBuffer: false };
    try {
      r = new THREE.WebGLRenderer(opts);
    } catch (e) {
      console.warn('WebGL init with requested options failed, retrying with defaults', e);
      r = new THREE.WebGLRenderer({ canvas });
    }
    this.r = r;
    this.webgl2 = r.capabilities.isWebGL2;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = !!g.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    r.autoClear = false;
    r.info.autoReset = false;
    r.sortObjects = true;

    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.camera = new THREE.PerspectiveCamera(g.fov || 62, 1, 1, g.drawDistance || 36000);
    this.camera.layers.enableAll();
    this.scale = g.renderScale || 1;
    this.width = 1; this.height = 1;
    this.cockpitMode = false;
    this.ownFar = 400;
    this.nearWorld = 1.0;
    this.shadowEvery = 1;
    this._frame = 0;
    this.stats = { calls: 0, triangles: 0, textures: 0, geometries: 0 };
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get maxPixelRatio() { return Math.min(window.devicePixelRatio || 1, settings.g.maxPixelRatio || 1); }

  setScale(s) {
    s = Math.max(0.35, Math.min(1, s));
    if (Math.abs(s - this.scale) < 0.01) return;
    this.scale = s;
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.width = w; this.height = h;
    this.r.setPixelRatio(this.maxPixelRatio * this.scale);
    this.r.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get internalResolution() {
    const pr = this.r.getPixelRatio();
    return [Math.round(this.width * pr), Math.round(this.height * pr)];
  }

  // Render the frame. In cockpit/cabin views the own aircraft is drawn in a
  // second pass with a tight near plane so the cockpit has full depth precision.
  render(scene = this.scene, camera = this.camera) {
    const r = this.r;
    r.info.reset();
    this._frame++;
    if (r.shadowMap.enabled) r.shadowMap.needsUpdate = (this._frame % this.shadowEvery) === 0;
    r.clear(true, true, false);
    if (this.cockpitMode) {
      const far = camera.far, near = camera.near;
      camera.near = this.nearWorld; camera.updateProjectionMatrix();
      camera.layers.set(LAYER_WORLD);
      r.render(scene, camera);
      r.shadowMap.needsUpdate = false;
      r.clearDepth();
      camera.near = 0.03; camera.far = this.ownFar; camera.updateProjectionMatrix();
      camera.layers.set(LAYER_OWN);
      r.render(scene, camera);
      camera.near = near; camera.far = far; camera.updateProjectionMatrix();
      camera.layers.enableAll();
    } else {
      camera.layers.enableAll();
      r.render(scene, camera);
    }
    const i = r.info;
    this.stats.calls = i.render.calls; this.stats.triangles = i.render.triangles;
    this.stats.textures = i.memory.textures; this.stats.geometries = i.memory.geometries;
  }

  // Simple render for menu / previews (single pass).
  renderSimple(scene, camera) {
    const r = this.r;
    r.info.reset();
    r.clear(true, true, false);
    r.render(scene, camera);
    this.stats.calls = r.info.render.calls; this.stats.triangles = r.info.render.triangles;
  }
}
