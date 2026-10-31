// Minimal synchronous event bus used to decouple systems (UI, audio, gameplay).
class Bus {
  constructor() { this.map = new Map(); }
  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, new Set());
    this.map.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) { const s = this.map.get(evt); if (s) s.delete(fn); }
  emit(evt, data) {
    const s = this.map.get(evt);
    if (!s) return;
    for (const fn of s) {
      try { fn(data); } catch (e) { console.error('[bus]', evt, e); }
    }
  }
}
export const bus = new Bus();
