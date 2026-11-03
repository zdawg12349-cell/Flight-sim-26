// FPS / frame-time monitoring and adaptive quality. When frame time exceeds the target,
// distant/expensive scenery is reduced first (trees, clouds, terrain detail, shadow updates),
// render resolution is lowered only after that. The cockpit and own aircraft are never degraded.
import { settings } from '../core/settings.js';
import { bus } from '../core/events.js';

export const quality = { treeK: 1, buildK: 1, cloudK: 1, lodK: 1, shadowEvery: 1, scaleK: 1, level: 0 };

const LEVELS = [
  { treeK: 1, buildK: 1, cloudK: 1, lodK: 1, shadowEvery: 1, scaleK: 1 },
  { treeK: 0.8, buildK: 1, cloudK: 0.8, lodK: 1, shadowEvery: 1, scaleK: 1 },
  { treeK: 0.7, buildK: 0.75, cloudK: 0.7, lodK: 0.85, shadowEvery: 1, scaleK: 1 },
  { treeK: 0.6, buildK: 0.7, cloudK: 0.6, lodK: 0.8, shadowEvery: 2, scaleK: 1 },
  { treeK: 0.55, buildK: 0.65, cloudK: 0.55, lodK: 0.75, shadowEvery: 2, scaleK: 0.9 },
  { treeK: 0.45, buildK: 0.55, cloudK: 0.45, lodK: 0.7, shadowEvery: 3, scaleK: 0.82 },
  { treeK: 0.35, buildK: 0.5, cloudK: 0.35, lodK: 0.65, shadowEvery: 4, scaleK: 0.74 },
  { treeK: 0.3, buildK: 0.45, cloudK: 0.3, lodK: 0.6, shadowEvery: 6, scaleK: 0.66 },
];

export class PerfMonitor {
  constructor(renderer, el) {
    this.r = renderer;
    this.el = el;
    this.frames = 0; this.acc = 0; this.worst = 0; this.sum = 0;
    this.fps = 0; this.ms = 0; this.p95 = 0;
    this.samples = [];
    this.slowSecs = 0; this.fastSecs = 0;
    this.level = 0;
    this.apply();
  }
  reset() { this.level = 0; this.slowSecs = 0; this.fastSecs = 0; this.apply(); }
  apply() {
    const L = LEVELS[this.level];
    Object.assign(quality, L, { level: this.level });
    this.r.shadowEvery = L.shadowEvery;
    const g = settings.g;
    this.r.setScale(Math.max(g.minRenderScale || 0.5, (g.renderScale || 1) * L.scaleK));
  }
  frame(dt, active) {
    if (dt > 0.5) return;            // tab was hidden
    this.frames++; this.acc += dt; this.sum += dt;
    this.samples.push(dt);
    if (dt > this.worst) this.worst = dt;
    if (this.acc >= 1) {
      this.fps = Math.round(this.frames / this.acc);
      this.ms = this.sum / this.frames * 1000;
      this.samples.sort((a, b) => a - b);
      this.p95 = this.samples[Math.floor(this.samples.length * 0.95)] * 1000;
      this.samples.length = 0;
      const target = 1000 / (settings.g.targetFps || 60);
      if (settings.g.autoQuality && active) {
        if (this.ms > target * 1.12) { this.slowSecs++; this.fastSecs = 0; }
        else if (this.ms < target * 0.8) { this.fastSecs++; this.slowSecs = 0; }
        else { this.slowSecs = Math.max(0, this.slowSecs - 1); this.fastSecs = 0; }
        if (this.slowSecs >= 2 && this.level < LEVELS.length - 1) { this.level++; this.slowSecs = 0; this.apply(); bus.emit('perf:level', this.level); }
        if (this.fastSecs >= 8 && this.level > 0) { this.level--; this.fastSecs = 0; this.apply(); bus.emit('perf:level', this.level); }
      }
      if (this.el && settings.g.showFps) {
        const s = this.r.stats;
        const [w, h] = this.r.internalResolution;
        this.el.textContent = `${this.fps} FPS  ${this.ms.toFixed(1)} ms (p95 ${this.p95.toFixed(1)})  ·  ${s.calls} draws  ·  ${(s.triangles / 1000).toFixed(0)}k tris  ·  ${w}×${h}  ·  Q${this.level}`;
        this.el.style.display = '';
      } else if (this.el) this.el.style.display = 'none';
      this.frames = 0; this.acc = 0; this.sum = 0; this.worst = 0;
    }
  }
}
