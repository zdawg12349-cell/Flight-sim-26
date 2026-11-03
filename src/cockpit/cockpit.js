// Builds the first-person cockpit for an aircraft: interior shell with real window openings cut
// from the fuselage shape, instrument panel (analog gauges + glass displays), glareshield/MCP,
// overhead panel, yokes/sticks/cyclic/collective, throttle quadrant, pedals, seats, switches,
// and the passenger cabin. Every interactive control is registered for mouse picking.
import * as THREE from 'three';
import { loftGeometry } from '../aircraft/modeler.js';
import { makeGauge } from './gauges.js';
import { Display } from './displays.js';
import { LAYOUTS } from './layouts.js';
import { settings } from '../core/settings.js';
import { clamp, damp, DEG, KT, FT, FPM, lerp } from '../core/math.js';
import { LAYER_OWN } from '../render/renderer.js';
import { buildModernDeck } from './flightdeck.js';

const TAU = Math.PI * 2;

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Alpha mask for the cockpit shell: windows transparent (black), structure white.
function windowMask(shape, windows, inverse = false) {
  return canvasTex(1024, 512, (x, W, H) => {
    x.fillStyle = inverse ? '#000' : '#fff'; x.fillRect(0, 0, W, H);
    x.fillStyle = inverse ? '#fff' : '#000';
    const X = (z) => (z - shape.zNose) / shape.length * W, Y = (th) => (1 - th / TAU) * H;
    for (const w of windows) {
      x.beginPath();
      w.poly.forEach(([z, th], i) => (i ? x.lineTo(X(z), Y(th)) : x.moveTo(X(z), Y(th))));
      x.closePath(); x.fill();
    }
  }, false);
}

function panelTexture(color) {
  return canvasTex(256, 256, (x, W, H) => {
    const c = new THREE.Color(color);
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#' + c.clone().multiplyScalar(1.35).getHexString()); g.addColorStop(1, '#' + c.clone().multiplyScalar(1.05).getHexString());
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 3000; i++) { x.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},255,0.025)`; x.fillRect(Math.random() * W, Math.random() * H, 1, 1); }
    x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 2; x.strokeRect(2, 2, W - 4, H - 4);
  });
}

function labelTex(text, w = 256, h = 64, bg = '#1c1e21', fg = '#e8e8e8', size = 26) {
  return canvasTex(w, h, (x) => {
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.fillStyle = fg; x.font = `bold ${size}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, w / 2, h / 2);
  });
}

export class Cockpit {
  constructor(aircraft) {
    this.ac = aircraft;
    const spec = aircraft.spec, desc = aircraft.model.desc;
    this.spec = spec; this.desc = desc;
    this.layout = LAYOUTS[desc.cockpit.layout] || LAYOUTS.ga_analog;
    this.eye = new THREE.Vector3(...desc.cockpit.eye);
    // jump seat: behind and between the two pilots, framing the whole flight deck
    this.jumpEye = new THREE.Vector3(this.eye.x + (this.layout.panel.cx || 0), this.eye.y + 0.14, this.eye.z + 1.05);
    this.group = new THREE.Group();
    this.group.name = 'cockpit';
    this.cabin = new THREE.Group();
    this.cabin.name = 'cabin';
    this.gauges = [];
    this.displays = [];
    this.clickables = [];
    this.anim = [];          // per-frame animation callbacks
    this.lightMats = [];     // annunciator materials toggled by state
    this.faceMats = [];
    const pbr = settings.g.pbr;
    // Low preset uses Lambert shading: drop the PBR-only parameters so no warnings are logged
    const M = pbr ? THREE.MeshStandardMaterial : class extends THREE.MeshLambertMaterial {
      constructor(p = {}) { const q = { ...p }; delete q.roughness; delete q.metalness; delete q.envMapIntensity; super(q); }
    };
    this.M = M;
    this.glowMats = [];      // backlit panel textures (emissive glow maps), brightened at night
    this.modern = !!this.layout.modern;
    const L = this.layout;
    this.mats = {
      interior: new M({ color: new THREE.Color(L.interior || '#7a7f86'), roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide }),
      panel: new M({ map: panelTexture(L.panel.color), roughness: 0.75, metalness: 0.1 }),
      glare: new M({ color: new THREE.Color(L.glare ? L.glare.color : '#1a1a1a'), roughness: 0.95 }),
      dark: new M({ color: 0x1b1c1e, roughness: 0.7, metalness: 0.2 }),
      metal: new M({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 }),
      black: new M({ color: 0x0c0c0d, roughness: 0.6 }),
      seat: new M({ color: new THREE.Color(spec.cat === 'airliner' ? '#2c3a52' : spec.cat === 'heli' ? '#3b3b3b' : '#5a4636'), roughness: 0.95 }),
      knobWhite: new M({ color: 0xeeeeee, roughness: 0.5 }),
      knobRed: new M({ color: 0xc81e1e, roughness: 0.5 }),
      knobBlue: new M({ color: 0x2850c8, roughness: 0.5 }),
      floor: new M({ color: 0x2b2c2e, roughness: 1 }),
      bezel: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.4, metalness: 0.6 }),
      gaugeGlass: new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.05, metalness: 1.0, transparent: true, opacity: 0.12, depthWrite: false }),
      screenFrame: new M({ color: 0x141517, roughness: 0.5, metalness: 0.3 }),
    };
    this.buildShell();
    this.buildPanel();
    this.buildControls();
    if (this.modern) {
      buildModernDeck(this);
      if (this.layout.controls.fireHandles) this.fireHandles();
    } else this.buildSeats();
    if (desc.cabin) this.buildCabin();
    // Soft fill so the interior never goes pitch black. It lives on the own-aircraft layer only, so
    // it brightens the cockpit pass but never the outside world. Night panel lighting is done with
    // emissive glow maps instead of point lights (no extra per-pixel lighting cost, no shader
    // recompiles when switching between inside and outside views).
    this.fill = new THREE.AmbientLight(0xd8e0ea, 0.35);
    this.group.add(this.fill);
    this.group.traverse((o) => { o.layers.set(LAYER_OWN); if (o.isMesh) { o.receiveShadow = settings.g.cockpitShadows; o.castShadow = false; } });
    this.cabin.traverse((o) => o.layers.set(LAYER_OWN));
  }

  // ------------------------------------------------------------ shell & windows
  buildShell() {
    const sh = this.ac.model.shape, desc = this.desc, eye = this.eye;
    const L = this.layout;
    const z0 = Math.max(sh.zNose + 0.05, eye.z - 3.0);
    const z1 = Math.min(sh.zTail, eye.z + (desc.cabin && !L.open ? 1.3 : 1.5));
    const windows = desc.cockpitWindows || [];
    if (!L.open && windows.length) {
      const geo = loftGeometry(sh, 36, 40, z0, z1, 0.035, true);
      // remap uv to full-fuselage space for the mask (loftGeometry already uses global u)
      const mask = windowMask(sh, windows, false);
      const mat = this.mats.interior.clone();
      mat.alphaMap = mask; mat.alphaTest = 0.5; mat.side = THREE.DoubleSide; mat.transparent = false;
      // darker window frames: emulate with a second slightly inset dark shell around edges
      const shell = new THREE.Mesh(geo, mat);
      shell.name = 'shell';
      this.group.add(shell);
      // glass panes
      const gmask = windowMask(sh, windows, true);
      const glass = new THREE.Mesh(loftGeometry(sh, 36, 40, z0, z1, 0.03, true), new THREE.MeshStandardMaterial({
        color: 0x9fb4c4, roughness: 0.02, metalness: 0.0, transparent: true, opacity: 0.1, alphaMap: gmask, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.5,
      }));
      glass.renderOrder = 8;
      glass.name = 'glass';
      this.group.add(glass);
      this.glass = glass;
      // bulkhead behind the crew
      if (desc.cabin || this.spec.cat === 'airliner') {
        const s = sh.at(z1 - 0.05);
        const bulk = new THREE.Mesh(new THREE.PlaneGeometry(s.w * 2, s.h * 2), this.mats.interior);
        bulk.position.set(0, s.y, z1 - 0.06);
        this.group.add(bulk);
        const door = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.85), this.mats.dark);
        door.position.set(0.15, s.y - s.h + 1.05, z1 - 0.07);
        this.group.add(door);
      }
    } else {
      // open / canopy cockpit tub (lower half of the fuselage)
      const geo = loftGeometry(sh, 24, 32, z0 + 0.4, Math.min(sh.zTail, eye.z + 1.2), 0.03, true);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > eye.y - 0.42) pos.setY(i, eye.y - 0.42);
      geo.computeVertexNormals();
      this.group.add(new THREE.Mesh(geo, this.mats.interior));
      // canopy rails
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.6), this.mats.dark);
        rail.position.set(s * 0.33, eye.y - 0.4, eye.z - 0.2);
        this.group.add(rail);
      }
    }
    // floor
    const fy = eye.y - (L.floorDrop || 1.0);
    const fw = Math.max(0.5, sh.at(eye.z).w * 1.7);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, 3.2).rotateX(-Math.PI / 2), this.mats.floor);
    floor.position.set(0, fy, eye.z - 0.9);
    this.group.add(floor);
    this.floorY = fy;
  }

  // Place helper: panel-local coordinates -> group object
  panelFrame() {
    const P = this.layout.panel, eye = this.eye;
    const f = new THREE.Group();
    const cy = P.top - P.h / 2;
    f.position.set(eye.x + P.cx, eye.y + cy, eye.z - P.dist);
    f.rotation.x = -P.tilt * DEG;
    this.group.add(f);
    return f;
  }

  // ------------------------------------------------------------ panel, gauges, displays
  buildPanel() {
    const L = this.layout, P = L.panel;
    const frame = this.panelFrame();
    this.frame = frame;
    // panel body
    const body = new THREE.Mesh(new THREE.BoxGeometry(P.w, P.h, 0.06), this.mats.panel);
    body.position.z = -0.032;
    frame.add(body);
    // lower knee panel
    const knee = new THREE.Mesh(new THREE.BoxGeometry(P.w * 0.98, 0.22, 0.05), this.mats.dark);
    knee.position.set(0, -P.h / 2 - 0.1, -0.06);
    knee.rotation.x = 0.35;
    frame.add(knee);
    // glareshield
    if (L.glare && this.modern) {
      // hood itself is built by the flight deck module; the flight control panel sits on its lip
      if (L.glare.mcp && this.ac.ap.available) this.buildMCP(frame, P, true);
      this.buildMasterLights(frame, P);
      if (L.glare.hud && this.ac.model.desc.cockpit) this.buildHUD();
    } else if (L.glare) {
      const g = L.glare;
      const gs = new THREE.Mesh(new THREE.BoxGeometry(P.w + 0.04, 0.035, g.depth), this.mats.glare);
      gs.position.set(0, P.h / 2 + 0.015, -g.depth / 2 + 0.05);
      gs.rotation.x = P.tilt * DEG;
      frame.add(gs);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(P.w + 0.04, 0.04, 0.03), this.mats.glare);
      lip.position.set(0, P.h / 2 + 0.0, 0.04);
      frame.add(lip);
      if (g.mcp && this.ac.ap.available) this.buildMCP(frame, P);
      this.buildMasterLights(frame, P);
      if (g.hud && this.ac.model.desc.cockpit) this.buildHUD();
    } else {
      this.buildMasterLights(frame, P);
    }
    if (this.desc.cockpit.hud) this.buildHUD();
    // instruments
    const hz = settings.g.displayHz, res = settings.g.displayRes;
    const shared = {};
    for (const it of L.items) {
      const px = it.x - P.cx;   // item x is relative to the pilot; frame is at panel centre
      if (it.g) {
        const g = makeGauge(it.g, it.s, { ...it, spec: this.spec }, this.mats);
        g.position.set(px, it.y, 0.002);
        frame.add(g);
        this.gauges.push(g);
        g.traverse((o) => { if (o.material && o.material.isMeshBasicMaterial) this.faceMats.push(o.material); });
        this.addTip(g, this.gaugeTip(it.g));
      } else if (it.d) {
        let disp;
        const key = it.d + (it.page || '');
        if (it.d === 'radio') disp = this.radioDisplay(it);
        else if (shared[key] && it.d !== 'nd') disp = shared[key];
        else { disp = new Display(it.d, it.d === 'standby' ? Math.min(256, res) : res, { page: it.page }); shared[key] = disp; this.displays.push(disp); }
        const bez = new THREE.Mesh(new THREE.BoxGeometry(it.w + 0.025, it.h + 0.025, 0.02), this.mats.screenFrame);
        bez.position.set(px, it.y, -0.004);
        frame.add(bez);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(it.w, it.h), disp.material);
        scr.position.set(px, it.y, 0.0075);
        frame.add(scr);
        this.addTip(scr, { pfd: 'Primary flight display: attitude, speed & altitude tapes, heading, autopilot modes', nd: 'Navigation display: moving map, heading, route to destination, wind', eicas: 'Engine indication & crew alerting: engine gauges, fuel, configuration, warnings', mfd: 'Multi-function display: moving map + engine monitoring', standby: 'Standby attitude / airspeed / altitude', radio: 'COM/NAV radio: active ATC frequency' }[it.d]);
      }
    }
    // annunciator / gear lights strip under glareshield
  }

  radioDisplay(it) {
    const d = new Display('pfd', 128);
    d.draw_pfd = (x, data) => {
      x.fillStyle = '#0a0a0a'; x.fillRect(0, 0, 512, 512);
      x.fillStyle = '#ff9a2a'; x.font = 'bold 120px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(data.comFreq || '118.70', 256, 180);
      x.font = 'bold 70px monospace'; x.fillStyle = '#7ad'; x.fillText('NAV ' + (data.navFreq || '110.30'), 256, 360);
    };
    d.interval = 0.5;
    this.displays.push(d);
    return d;
  }

  gaugeTip(kind) {
    return {
      asi: 'Airspeed indicator (knots). White arc: flap range, green: normal, yellow: caution, red line: never exceed',
      alt: 'Altimeter: long needle 100 ft, short needle 1,000 ft, thin 10,000 ft',
      vsi: 'Vertical speed indicator (thousands of feet per minute)',
      hdg: 'Heading indicator (directional gyro)',
      turn: 'Turn coordinator: standard-rate turn marks; keep the ball centred with rudder',
      adi: 'Attitude indicator (artificial horizon): pitch and bank',
      rpm: 'Engine tachometer (RPM)', map: 'Manifold pressure (inches of mercury)',
      n1: 'N1 fan speed (%)', n2: 'N2 core speed (%)', egt: 'Exhaust gas temperature (°C)', itt: 'Inter-turbine temperature (°C)',
      torque: 'Engine torque (%)', np: 'Propeller RPM (%)', dual: 'Engine / fuel / electrical monitoring', heliTach: 'Dual tachometer: rotor RPM (yellow) and engine RPM; keep both in the green',
      g: 'G-meter (load factor) with maximum-g needle', clock: 'Clock', fuelflow: 'Fuel flow',
    }[kind] || 'Instrument';
  }

  addTip(obj, tip) { obj.traverse((o) => { if (o.isMesh) o.userData.tip = tip; }); }

  addClick(mesh, name, tip, onClick, onWheel) {
    mesh.userData.click = { name, onClick, onWheel };
    mesh.userData.tip = tip;
    this.clickables.push(mesh);
    return mesh;
  }

  button(parent, x, y, w, h, text, tip, onClick, color = '#2a2d31', lit = null) {
    const tex = labelTex(text, 128, 64, color, '#f2f2f2', 30);
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0x000000, roughness: 0.6 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), mat);
    m.position.set(x, y, 0.006);
    parent.add(m);
    this.addClick(m, text, tip, onClick);
    if (lit) this.anim.push(() => { const on = lit(); mat.emissive.setHex(on ? 0x55ff88 : 0x000000); mat.emissiveIntensity = on ? 0.9 : 0; });
    return m;
  }

  toggleSwitch(parent, x, y, label, tip, get, set) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.008), this.mats.dark);
    base.position.set(x, y, 0.004);
    parent.add(base);
    const lever = new THREE.Group();
    lever.position.set(x, y, 0.008);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.004, 0.024, 6).translate(0, 0.012, 0), this.mats.metal);
    lever.add(stick);
    parent.add(lever);
    const lt = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.014), new THREE.MeshBasicMaterial({ map: labelTex(label, 128, 36, '#00000000', '#e6e6e6', 22), transparent: true }));
    lt.position.set(x, y - 0.03, 0.005);
    parent.add(lt);
    this.addClick(base, label, tip, () => set(!get()));
    this.addClick(stick, label, tip, () => set(!get()));
    this.anim.push(() => { lever.rotation.x = get() ? -0.55 : 0.55; });
  }

  knob(parent, x, y, r, label, tip, onWheel, onClick) {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, 0.014, 16).rotateX(Math.PI / 2), this.mats.dark);
    k.position.set(x, y, 0.012);
    parent.add(k);
    this.addClick(k, label, tip, onClick || (() => onWheel(1)), onWheel);
    return k;
  }

  // ------------------------------------------------------------ autopilot mode control panel
  buildMCP(frame, P, onHood = false) {
    const ap = this.ac.ap;
    const g = new THREE.Group();
    let w = this.spec.cat === 'heli' ? Math.min(0.5, P.w * 0.42) : Math.min(0.9, P.w * 0.62);
    const h = 0.07;
    if (onHood) {
      // modern deck: mounted on the glareshield lip, between the two EFIS control panels
      w = Math.min(0.9, (this.layout.seatGap || 1) - 0.3);
      const tilt = P.tilt * DEG, eye = this.eye;
      const topY = eye.y + P.top - P.h / 2 + (P.h / 2) * Math.cos(tilt);
      const topZ = eye.z - P.dist - (P.h / 2) * Math.sin(tilt);
      g.position.set(eye.x + P.cx, topY + 0.012, topZ + 0.05);
      g.rotation.x = -0.12;
      this.group.add(g);
    } else {
      // sits on the glareshield, centred between the pilots, face tilted towards the crew
      g.position.set(0, P.h / 2 + 0.03, 0.05);
      g.rotation.x = 0.55;
      frame.add(g);
    }
    g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), this.mats.dark));
    const face = new THREE.Group(); face.position.z = 0.016; g.add(face);
    // digital window
    const disp = new Display('pfd', 256);
    disp.draw_pfd = (x, d) => {
      x.fillStyle = '#050607'; x.fillRect(0, 0, 512, 512);
      x.fillStyle = '#ffb84a'; x.font = 'bold 120px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
      const a = d.apState || {};
      x.fillText(String(Math.round(a.spd ?? 0)).padStart(3, '0'), 64, 256);
      x.fillText(String(Math.round(a.hdg ?? 0)).padStart(3, '0'), 190, 256);
      x.fillText(String(Math.round((a.alt ?? 0) / 100) * 100).padStart(5, '0'), 330, 256);
      x.fillText((a.vs >= 0 ? '+' : '') + Math.round((a.vs ?? 0) / 100) * 100, 460, 256);
      x.font = 'bold 60px Arial'; x.fillStyle = '#9aa';
      x.fillText('SPD', 64, 110); x.fillText('HDG', 190, 110); x.fillText('ALT', 330, 110); x.fillText('V/S', 460, 110);
    };
    this.displays.push(disp);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.55, h * 0.55), disp.material);
    scr.position.set(-w * 0.18, h * 0.12, 0.001);
    face.add(scr);
    const bx = w * 0.17, bw = w * 0.07, bh = h * 0.28;
    const mode = (k, m) => () => ap.setMode(k, m);
    const btns = [
      ['AP', 'Autopilot master on/off', () => ap.engage(), () => ap.engaged],
      ['HDG', 'Heading select mode', mode('lat', 'HDG'), () => ap.engaged && ap.lat === 'HDG'],
      ['NAV', 'Navigate to destination', mode('lat', 'NAV'), () => ap.engaged && ap.lat === 'NAV'],
      ['APP', 'Approach: localizer + glideslope', () => this.ac.armApproach(), () => ap.engaged && ap.lat === 'LOC'],
      ['ALT', 'Altitude hold', mode('vert', 'ALT'), () => ap.engaged && ap.vert === 'ALT'],
      ['V/S', 'Vertical speed mode', mode('vert', 'VS'), () => ap.engaged && ap.vert === 'VS'],
      ['A/T', 'Autothrottle (speed hold)', mode('at'), () => ap.engaged && ap.at],
    ];
    if (this.spec.cat === 'heli') btns.splice(2, 2, ['HOVR', 'Hover hold', mode('hover'), () => ap.engaged && ap.hover]);
    btns.forEach(([t, tip, fn, lit], i) => this.button(face, bx + (i % 4) * (bw + 0.006) - w * 0.04, (i < 4 ? 0.016 : -0.016), bw, bh, t, tip, fn, '#2a2d31', lit));
    const kx = -w * 0.18;
    this.knob(face, kx - w * 0.2, -h * 0.28, 0.011, 'SPD', 'Selected speed (scroll)', (d) => { ap.spd = clamp(ap.spd - d * 5, 40, 600); });
    this.knob(face, kx - w * 0.07, -h * 0.28, 0.011, 'HDG', 'Selected heading (scroll)', (d) => { ap.hdg = ((ap.hdg - d * 5) % 360 + 360) % 360; });
    this.knob(face, kx + w * 0.07, -h * 0.28, 0.011, 'ALT', 'Selected altitude (scroll)', (d) => { ap.alt = clamp(ap.alt - d * 500, 0, 60000); });
    this.knob(face, kx + w * 0.2, -h * 0.28, 0.011, 'V/S', 'Selected vertical speed (scroll)', (d) => { ap.vs = clamp(ap.vs - d * 100, -6000, 6000); });
  }

  buildMasterLights(frame, P) {
    const sys = this.ac.systems;
    const mk = (x, text, color, isWarn) => {
      const tex = labelTex(text, 128, 64, color, '#fff', 24);
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.4 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.025, 0.015), mat);
      m.position.set(x, P.h / 2 - 0.02, 0.012);
      frame.add(m);
      this.addClick(m, text, `${text}: press to acknowledge`, () => sys.ackMaster());
      this.anim.push((t) => {
        const on = isWarn ? sys.masterWarning : sys.masterCaution;
        mat.emissiveIntensity = on ? (Math.sin(t * 9) > 0 ? 1.6 : 0.5) : 0;
      });
    };
    const px = -P.cx;
    mk(px - 0.21, 'WARNING', '#6b0c0c', true);
    mk(px - 0.155, 'CAUTION', '#6b4a0c', false);
    // gear position lights
    if (this.spec.retract) {
      const fm = this.ac.fm;
      for (let i = 0; i < 3; i++) {
        const mat = new THREE.MeshBasicMaterial({ color: 0x113311 });
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12), mat);
        m.position.set(px + 0.2 + i * 0.022, -P.h / 2 + 0.03, 0.006);
        frame.add(m);
        this.anim.push(() => {
          const down = fm.gearPos > 0.99, transit = fm.gearPos > 0.01 && fm.gearPos < 0.99;
          mat.color.setHex(down && this.ac.systems.powered ? 0x22ff44 : transit && this.ac.systems.powered ? 0xff2a20 : 0x0d1a0d);
        });
      }
    }
  }

  buildHUD() {
    if (this.hud) return;
    const d = new Display('hud', 512);
    this.displays.push(d);
    const eye = this.eye;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), d.material);
    m.position.set(eye.x, eye.y - 0.02, eye.z - 0.5);
    m.renderOrder = 9;
    this.group.add(m);
    this.hud = m;
    this.hudDisplay = d;
  }

  // ------------------------------------------------------------ controls
  buildControls() {
    const C = this.layout.controls, eye = this.eye, fm = this.ac.fm, spec = this.spec;
    const seats = C.yokes || 1;
    const gap = this.layout.seatGap || 0;
    const seatXs = seats === 2 ? [eye.x, eye.x + (eye.x < 0 ? gap : -gap)] : [eye.x];
    const fy = this.floorY;
    // yokes / sticks
    for (const sx of seatXs) {
      if (C.yoke === 'yoke') this.yoke(sx);
      else if (C.yoke === 'sideyoke') this.sideYoke(sx, sx === eye.x);
      else if (C.yoke === 'stick') this.stick(sx);
      else if (C.yoke === 'cyclic') this.cyclic(sx);
      this.pedals(sx);
      if (C.throttle === 'collective') this.collective(sx);
    }
    // throttles
    const P = this.layout.panel;
    const cx = seats === 2 ? (seatXs[0] + seatXs[1]) / 2 : eye.x;
    if (C.throttle === 'pedestal' && !this.modern) this.pedestal(cx, C);
    else if (C.throttle === 'knobs' || C.throttle === 'single' || C.throttle === 'quadrant3' || C.throttle === 'quadrant6') this.gaThrottle(cx, C);
    else if (C.throttle === 'sideQuadrant') this.sideQuadrant(eye.x - 0.28);
    // gear lever
    if (C.gear === 'lever' && spec.retract) this.gearLever(C);
    // switches (the modern deck builds its own overhead panel)
    if (!this.modern) {
      this.switchPanel(C.switches);
      if (C.fireHandles) this.fireHandles();
    }
    if (C.engineer) this.engineerPanel();
  }

  yoke(sx) {
    const P = this.layout.panel, eye = this.eye, L = this.layout;
    const big = this.spec.cat === 'airliner' || this.spec.cat === 'jet';
    // wheel centre relative to the eye: roughly 30 degrees below the line of sight, ~0.5 m ahead
    // (GA: the shaft enters the panel below the six-pack, as in a real trainer)
    const wy = eye.y - (this.modern ? 0.42 : big ? 0.33 : 0.36), wz = eye.z - (big ? 0.5 : 0.45);
    const col = new THREE.Group();
    col.position.set(sx, wy, wz);
    this.group.add(col);
    if (big) {
      // Boeing-style control column rising from the floor
      const fy = eye.y - (L.floorDrop || 1.05);
      const h = wy - fy;
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, h, 10).translate(0, -h / 2, -0.04), this.mats.dark);
      column.rotation.x = -0.12;
      col.add(column);
      const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.12, 12).translate(0, -h + 0.06, -0.04), this.mats.black);
      col.add(boot);
    } else {
      // GA-style shaft coming out of the instrument panel
      const len = Math.max(0.12, P.dist - (eye.z - wz) + 0.02);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, len, 8).rotateX(Math.PI / 2).translate(0, 0, -len / 2), this.mats.metal);
      col.add(shaft);
    }
    const wheel = new THREE.Group();
    col.add(wheel);
    const yokeW = big ? 0.36 : 0.3;
    const horn = new THREE.Mesh(new THREE.TorusGeometry(yokeW / 2, 0.016, 8, 24, Math.PI * 0.9).rotateZ(Math.PI * 1.05), this.mats.dark);
    wheel.add(horn);
    for (const sgn of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.12, 8), this.mats.black);
      grip.position.set(sgn * yokeW / 2, 0.03, 0);
      wheel.add(grip);
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8), new THREE.MeshBasicMaterial({ color: 0xc8302a }));
      btn.position.set(sgn * yokeW / 2, 0.095, 0);
      wheel.add(btn);
    }
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.035), this.mats.dark);
    wheel.add(hub);
    const fm = this.ac.fm;
    this.addTip(col, 'Control yoke: pull/push = pitch (W/S or arrows), turn = roll (A/D)');
    this.anim.push(() => {
      wheel.rotation.z = -fm.aileron * 0.7;
      col.position.z = wz + fm.elevator * 0.07;
    });
  }

  sideYoke(sx, left) {
    const eye = this.eye, fm = this.ac.fm;
    const g = new THREE.Group();
    const side = left ? -1 : 1;
    g.position.set(sx + side * 0.36, eye.y - 0.42, eye.z - 0.35);
    this.group.add(g);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.22).translate(0, 0, -0.05), this.mats.dark));
    const handle = new THREE.Group(); handle.position.z = 0.07; g.add(handle);
    handle.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.04), this.mats.black));
    this.addTip(g, 'Side yoke: pull/push pitch, rotate for roll');
    this.anim.push(() => { handle.rotation.z = -fm.aileron * 0.5; handle.position.z = 0.07 + fm.elevator * 0.04; });
  }

  stick(sx) {
    const eye = this.eye, fm = this.ac.fm;
    const piv = new THREE.Group();
    piv.position.set(sx, this.floorY + 0.05, eye.z - 0.38);
    this.group.add(piv);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.5, 8).translate(0, 0.25, 0), this.mats.dark);
    piv.add(s);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.11, 10).translate(0, 0.55, 0), this.mats.black);
    piv.add(grip);
    this.addTip(piv, 'Control stick: pitch and roll');
    this.anim.push(() => { piv.rotation.x = -fm.elevator * 0.28; piv.rotation.z = -fm.aileron * 0.28; });
  }

  cyclic(sx) {
    const eye = this.eye, fm = this.ac.fm;
    const piv = new THREE.Group();
    piv.position.set(sx, this.floorY + 0.05, eye.z - 0.42);
    this.group.add(piv);
    piv.add(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.62, 8).translate(0, 0.31, 0).rotateX(-0.25), this.mats.dark));
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.02, 0.13, 10).translate(0, 0.66, -0.17), this.mats.black);
    piv.add(grip);
    this.addTip(piv, 'Cyclic: tilts the rotor disc (pitch/roll) - W/S, A/D');
    this.anim.push(() => { piv.rotation.x = -fm.ctl.pitch * 0.18; piv.rotation.z = -fm.ctl.roll * 0.18; });
  }

  collective(sx) {
    const eye = this.eye, fm = this.ac.fm;
    const piv = new THREE.Group();
    piv.position.set(sx - 0.3, this.floorY + 0.25, eye.z - 0.05);
    this.group.add(piv);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.62, 8).rotateX(Math.PI / 2).translate(0, 0, -0.3), this.mats.dark);
    piv.add(lever);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.15, 10).rotateX(Math.PI / 2).translate(0, 0, -0.62), this.mats.black);
    piv.add(grip);
    this.addTip(piv, 'Collective: raises blade pitch on all rotor blades (R/F or PgUp/PgDn). Twist grip throttle is governed automatically');
    this.anim.push(() => { piv.rotation.x = 0.08 + fm.collectivePos * 0.42; grip.rotation.z = fm.engines.some((e) => e.running) ? 0.6 : 0; });
  }

  pedals(sx) {
    const eye = this.eye, fm = this.ac.fm, fy = this.floorY;
    const P = this.layout.panel;
    for (const s of [-1, 1]) {
      const ped = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.02), this.mats.metal);
      const base = new THREE.Vector3(sx + s * 0.1, fy + 0.12, eye.z - P.dist - 0.05);
      ped.position.copy(base);
      ped.rotation.x = -0.6;
      this.group.add(ped);
      this.anim.push(() => { ped.position.z = base.z + fm.rudder * s * -0.05; });
    }
  }

  pedestal(cx, C) {
    const eye = this.eye, fm = this.ac.fm, P = this.layout.panel;
    const g = new THREE.Group();
    const top = eye.y - 0.55;
    g.position.set(cx, top, eye.z - 0.25);
    this.group.add(g);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.7).translate(0, -0.25, 0), this.mats.dark);
    g.add(body);
    const n = C.levers || 2;
    const spacing = 0.26 / n;
    this.throttleLevers = [];
    for (let i = 0; i < n; i++) {
      const lv = new THREE.Group();
      lv.position.set(-0.13 + spacing * (i + 0.5) - 0.04, 0.0, -0.05);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.17, 0.02).translate(0, 0.085, 0), this.mats.metal);
      const knobm = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.03, 0.03).translate(0, 0.18, 0), this.mats.black);
      lv.add(arm); lv.add(knobm);
      g.add(lv);
      this.throttleLevers.push(lv);
      this.addClick(knobm, 'Thrust lever ' + (i + 1), `Thrust lever ${i + 1}: R/F (or PgUp/PgDn) to move all levers. Click: idle / full`, () => { const t = fm.ctl.throttle[i] > 0.5 ? 0 : 1; this.ac.setThrottleAll(t); });
      this.anim.push(() => { lv.rotation.x = -0.75 + (fm.ctl.throttle[i] ?? 0) * 1.25; });
      if (spec_hasReverse(this.spec)) {
        const rev = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.06, 0.012).translate(0, 0.13, 0.015), this.mats.metal);
        lv.add(rev);
        this.anim.push(() => { rev.rotation.x = fm.reverserPos * -0.9; });
      }
    }
    // condition levers (turboprops)
    if (C.condition) {
      for (let i = 0; i < n; i++) {
        const lv = new THREE.Group(); lv.position.set(0.06 + i * 0.03, 0, -0.05);
        lv.add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.13, 0.015).translate(0, 0.065, 0), this.mats.metal));
        lv.add(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 10).rotateZ(Math.PI / 2).translate(0, 0.14, 0), this.mats.knobBlue));
        g.add(lv);
        this.anim.push(() => { lv.rotation.x = fm.engines[i] && !fm.engines[i].fuelCutoff ? 0.35 : -0.6; });
      }
    }
    // flap lever
    if (C.flaps === 'pedestal' && this.spec.aero && this.spec.aero.flaps.length > 1) {
      const lv = new THREE.Group(); lv.position.set(0.12, 0, 0.12);
      lv.add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.015).translate(0, 0.06, 0), this.mats.metal));
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.03).translate(0, 0.13, 0), this.mats.knobWhite);
      lv.add(knob);
      g.add(lv);
      this.addClick(knob, 'Flap lever', 'Flap lever: [ / ] keys. Click to extend one step, right-click to retract', (b) => this.ac.flaps(b === 2 ? -1 : 1));
      const nf = this.spec.aero.flaps.length - 1;
      this.anim.push(() => { lv.rotation.x = -0.6 + (fm.ctl.flapIndex / nf) * 1.1; });
    }
    // speed brake lever
    if (C.speedbrake) {
      const lv = new THREE.Group(); lv.position.set(-0.13, 0, 0.1);
      lv.add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.015).translate(0, 0.06, 0), this.mats.metal));
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.022, 0.03).translate(0, 0.13, 0), this.mats.dark);
      lv.add(knob); g.add(lv);
      this.addClick(knob, 'Speed brake', 'Speed brake / ground spoilers ( / key )', () => this.ac.toggleSpoilers());
      this.anim.push(() => { lv.rotation.x = 0.5 - fm.ctl.spoilers * 0.9; });
    }
    // parking brake
    const pb = this.button(g, 0.0, -0.02, 0.06, 0.025, 'PARK', 'Parking brake (Shift+B)', () => { fm.ctl.parking = !fm.ctl.parking; }, '#3a1a1a', () => fm.ctl.parking);
    pb.position.set(0.0, 0.01, 0.3); pb.rotation.x = -Math.PI / 2;
  }

  gaThrottle(cx, C) {
    const P = this.layout.panel, eye = this.eye, fm = this.ac.fm;
    const frame = this.frame;
    const n = fm.engines.length;
    if (C.throttle === 'knobs') {
      // push-pull throttle & mixture knobs on the lower panel
      const knobs = [['THROTTLE', this.mats.black, (v) => fm.ctl.throttle[0]], ['MIXTURE', this.mats.knobRed, () => fm.ctl.mixture]];
      knobs.forEach(([name, mat, get], i) => {
        const k = new THREE.Group();
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6).rotateX(Math.PI / 2).translate(0, 0, 0.06), this.mats.metal);
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.025, 12).rotateX(Math.PI / 2).translate(0, 0, 0.12), mat);
        k.add(rod); k.add(head);
        const x0 = (0.08 + i * 0.07) - P.cx, y0 = -P.h / 2 + 0.035;
        k.position.set(x0, y0, -0.06);
        frame.add(k);
        this.addClick(head, name, name === 'THROTTLE' ? 'Throttle (push in = more power): R/F or PgUp/PgDn' : 'Mixture: red knob, pull to lean / cut off', () => { if (name === 'MIXTURE') fm.ctl.mixture = fm.ctl.mixture > 0.5 ? 0.0 : 1; else this.ac.setThrottleAll(fm.ctl.throttle[0] > 0.5 ? 0 : 1); });
        this.anim.push(() => { k.position.z = -0.06 + (1 - get()) * 0.07 - 0.02; });
      });
      return;
    }
    // quadrant levers mounted under the panel centre
    const g = new THREE.Group();
    g.position.set(cx + (C.throttle === 'single' ? 0.25 : 0), eye.y - 0.52, eye.z - P.dist + 0.12);
    this.group.add(g);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(C.throttle === 'quadrant6' ? 0.24 : 0.14, 0.06, 0.16), this.mats.dark));
    const levers = [];
    if (C.throttle === 'single') levers.push(['Power', this.mats.black, () => fm.ctl.throttle[0]]);
    else if (C.throttle === 'quadrant3') { levers.push(['Throttle', this.mats.black, () => fm.ctl.throttle[0]], ['Prop', this.mats.knobBlue, () => fm.ctl.propLever], ['Mixture', this.mats.knobRed, () => fm.ctl.mixture]); }
    else { for (let i = 0; i < n; i++) levers.push(['Throttle ' + (i + 1), this.mats.black, () => fm.ctl.throttle[i]]); for (let i = 0; i < n; i++) levers.push(['Prop ' + (i + 1), this.mats.knobBlue, () => fm.ctl.propLever]); for (let i = 0; i < n; i++) levers.push(['Mixture ' + (i + 1), this.mats.knobRed, () => fm.ctl.mixture]); }
    levers.forEach(([name, mat, get], i) => {
      const lv = new THREE.Group();
      lv.position.set(-((levers.length - 1) * 0.035) / 2 + i * 0.035, 0.03, 0);
      lv.add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.012).translate(0, 0.06, 0), this.mats.metal));
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.025, 0.025).translate(0, 0.125, 0), mat);
      lv.add(knob); g.add(lv);
      this.addClick(knob, name, `${name} lever`, () => { if (name.startsWith('Mixture')) fm.ctl.mixture = fm.ctl.mixture > 0.5 ? 0 : 1; else if (name.startsWith('Prop')) fm.ctl.propLever = fm.ctl.propLever > 0.5 ? 0.3 : 1; else this.ac.setThrottleAll(fm.ctl.throttle[0] > 0.5 ? 0 : 1); });
      this.anim.push(() => { lv.rotation.x = -0.7 + get() * 1.2; });
    });
    if (C.flaps === 'lever' && this.spec.aero.flaps.length > 1) {
      const lv = new THREE.Group(); lv.position.set(0.12, 0.03, 0.02);
      lv.add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.1, 0.012).translate(0, 0.05, 0), this.mats.metal));
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.02).translate(0, 0.105, 0), this.mats.knobWhite);
      lv.add(knob); g.add(lv);
      this.addClick(knob, 'Flaps', 'Flap lever ([ / ])', (b) => this.ac.flaps(b === 2 ? -1 : 1));
      const nf = this.spec.aero.flaps.length - 1;
      this.anim.push(() => { lv.rotation.x = -0.6 + fm.ctl.flapIndex / nf * 1.1; });
    }
  }

  sideQuadrant(x) {
    const eye = this.eye, fm = this.ac.fm;
    const g = new THREE.Group();
    g.position.set(x, eye.y - 0.5, eye.z - 0.2);
    this.group.add(g);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.3), this.mats.dark));
    const lv = new THREE.Group(); g.add(lv);
    lv.add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.014).translate(0, 0.06, 0), this.mats.metal));
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.05).translate(0, 0.13, 0), this.mats.black);
    lv.add(knob);
    this.addClick(knob, 'Throttle', 'Throttle (R/F)', () => this.ac.setThrottleAll(fm.ctl.throttle[0] > 0.5 ? 0 : 1));
    this.anim.push(() => { lv.position.z = 0.1 - (fm.ctl.throttle[0] || 0) * 0.2; });
  }

  gearLever(C) {
    const P = this.layout.panel, frame = this.frame, fm = this.ac.fm;
    const g = new THREE.Group();
    const x = (this.spec.cat === 'airliner' || this.spec.cat === 'jet') ? (P.cx + 0.12) - P.cx : 0.22 - P.cx;
    g.position.set(x, -P.h / 2 + 0.06, 0.01);
    frame.add(g);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.01), this.mats.dark));
    const lv = new THREE.Group(); g.add(lv);
    lv.add(new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.07).translate(0, 0, 0.035), this.mats.metal));
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 14), this.mats.knobWhite);
    wheel.position.z = 0.072; wheel.rotation.x = Math.PI / 2;
    lv.add(wheel);
    this.addClick(wheel, 'Landing gear', 'Landing gear lever (G)', () => this.ac.toggleGear());
    this.anim.push(() => { lv.position.y = fm.ctl.gearDown ? -0.03 : 0.03; });
  }

  // [label, tooltip, get, set] for every interactive systems switch of this aircraft
  switchList() {
    const sys = this.ac.systems;
    const L = sys.lights;
    const list = [
      ['BATT', 'Battery master', () => sys.battery, (v) => { sys.battery = v; }],
      ['AVION', 'Avionics master', () => sys.avionics, (v) => { sys.avionics = v; }],
      ['FUEL P', 'Fuel pump', () => sys.fuelPumps, (v) => { sys.fuelPumps = v; }],
      ['IGN', 'Ignition / magnetos', () => sys.ignition, (v) => { sys.ignition = v; }],
      ['BCN', 'Beacon light', () => L.beacon, (v) => { L.beacon = v; }],
      ['NAV', 'Navigation lights', () => L.nav, (v) => { L.nav = v; }],
      ['STRB', 'Strobe lights', () => L.strobe, (v) => { L.strobe = v; }],
      ['LAND', 'Landing lights (L)', () => L.landing, (v) => { L.landing = v; }],
      ['TAXI', 'Taxi light', () => L.taxi, (v) => { L.taxi = v; }],
      ['PITOT', 'Pitot heat (prevents airspeed icing)', () => sys.pitotHeat, (v) => { sys.pitotHeat = v; }],
      ['ANTI-ICE', 'Engine & wing anti-ice', () => sys.antiIce, (v) => { sys.antiIce = v; }],
    ];
    if (this.spec.systems.apu) list.push(['APU', 'Auxiliary power unit start/stop', () => sys.apu.running || sys.apu.starting, (v) => { sys.apu.starting = v; if (!v) { sys.apu.running = false; } sys.apuGen = v; }]);
    if (this.spec.systems.searchlight) list.push(['SRCH', 'Searchlight', () => L.searchlight, (v) => { L.searchlight = v; }]);
    return list;
  }

  switchPanel(kind) {
    const P = this.layout.panel, frame = this.frame, sys = this.ac.systems, fm = this.ac.fm, ac = this.ac;
    const list = this.switchList();
    if (kind === 'overhead' || kind === 'overheadSmall') {
      // overhead panel on the ceiling
      const eye = this.eye;
      const g = new THREE.Group();
      const ow = kind === 'overhead' ? 0.62 : 0.42;
      g.position.set(eye.x + (this.layout.seatGap || 0) / 2 * Math.sign(-eye.x || 1), eye.y + 0.36, eye.z - 0.25);
      g.rotation.x = Math.PI / 2 - 0.5;
      this.group.add(g);
      const back = new THREE.Mesh(new THREE.BoxGeometry(ow, 0.36, 0.03), this.mats.panel);
      back.position.z = -0.02;
      g.add(back);
      const cols = kind === 'overhead' ? 7 : 6;
      list.forEach(([lbl, tip, get, set], i) => this.toggleSwitch(g, -ow / 2 + 0.06 + (i % cols) * (ow - 0.1) / (cols - 1), 0.11 - Math.floor(i / cols) * 0.09, lbl, tip, get, set));
      // start buttons
      fm.engines.forEach((e, i) => this.button(g, -ow / 2 + 0.07 + i * 0.075, -0.13, 0.06, 0.028, 'START ' + (i + 1), `Engine ${i + 1} start (I = auto start all)`, () => { sys.battery = true; sys.ignition = true; sys.fuelPumps = true; e.fuelCutoff = false; e.requestStart(); }, '#1d2a1d', () => e.state === 'cranking' || e.state === 'lightoff'));
      this.overhead = g;
    } else {
      // row along the lower left panel
      const n = kind === 'mini' ? 6 : list.length;
      const x0 = -P.w / 2 + 0.05;
      for (let i = 0; i < n; i++) {
        const [lbl, tip, get, set] = list[i];
        this.toggleSwitch(frame, x0 + i * 0.05, -P.h / 2 + 0.04, lbl, tip, get, set);
      }
      // start button / key
      this.button(frame, x0 + n * 0.05 + 0.02, -P.h / 2 + 0.04, 0.05, 0.028, 'START', 'Engine start (I key runs the full auto-start)', () => { sys.battery = true; sys.ignition = true; sys.fuelPumps = true; for (const e of fm.engines) { e.fuelCutoff = false; e.requestStart(); } }, '#26301f', () => fm.engines.some((e) => e.state === 'cranking'));
      if (this.spec.cat === 'heli' && this.layout.controls.hoist) this.button(frame, x0 + n * 0.05 + 0.08, -P.h / 2 + 0.04, 0.05, 0.028, 'HOIST', 'Rescue hoist up/down (K)', () => ac.toggleHoist(), '#302a1a', () => fm.ctl.hoist > 0);
    }
  }

  fireHandles() {
    const P = this.layout.panel, frame = this.frame, sys = this.ac.systems, fm = this.ac.fm;
    const n = fm.engines.length;
    for (let i = 0; i < n; i++) {
      const tex = labelTex('FIRE ' + (i + 1), 128, 48, '#5a0c0c', '#fff', 22);
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xff2010, emissiveIntensity: 0 });
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.018, 0.025), mat);
      if (this.modern && this.overhead) {
        // modern deck: fire handles in a row on the overhead panel
        h.geometry = new THREE.BoxGeometry(0.06, 0.03, 0.022);
        h.position.set(0.25 - i * 0.07, 0.115, 0.012);
        this.overhead.add(h);
      } else {
        h.position.set(-0.08 + i * 0.055 + (n === 4 ? -0.03 : 0), P.h / 2 + 0.035, 0.08);
        frame.add(h);
      }
      this.addClick(h, 'Fire handle ' + (i + 1), `Engine ${i + 1} fire handle: shuts the engine down and discharges the extinguisher`, () => sys.pullFireHandle(i));
      const z0 = h.position.z;
      this.anim.push((t) => { const e = fm.engines[i]; mat.emissiveIntensity = e.fire && !e.extinguished ? (Math.sin(t * 10) > 0 ? 1.5 : 0.6) : 0; h.position.z = z0 + (e.fuelCutoff && e.fire === false && e.failed === 'fire' ? 0.02 : 0); });
    }
  }

  engineerPanel() {
    // flight engineer station on the right side wall (classic trijet): extra engine gauges
    const eye = this.eye;
    const g = new THREE.Group();
    g.position.set(eye.x + 1.55, eye.y - 0.1, eye.z + 0.6);
    g.rotation.y = -Math.PI / 2;
    this.group.add(g);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.04), this.mats.panel));
    const n = this.ac.fm.engines.length;
    for (let i = 0; i < n; i++) {
      for (const [k, y] of [['dual', 0.15], ['egt', 0.0], ['fuelflow', -0.15]]) {
        const gg = makeGauge(k, 0.08, { e: i, what: 'oil', spec: this.spec }, this.mats);
        gg.position.set(-0.3 + i * 0.12, y, 0.025);
        g.add(gg); this.gauges.push(gg);
      }
    }
  }

  buildSeats() {
    const eye = this.eye, fy = this.floorY;
    const gap = this.layout.seatGap || 0;
    const xs = gap ? [eye.x, eye.x + (eye.x < 0 ? gap : -gap)] : [eye.x];
    for (const x of xs) {
      const s = new THREE.Group();
      s.position.set(x, fy, eye.z + 0.25);
      s.add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.46).translate(0, 0.38, 0), this.mats.seat));
      s.add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.7, 0.1).translate(0, 0.75, 0.24).rotateX(-0.12), this.mats.seat));
      s.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.09).translate(0, 1.18, 0.28), this.mats.seat));
      s.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.33, 0.3).translate(0, 0.16, 0), this.mats.dark));
      this.group.add(s);
    }
  }

  // ------------------------------------------------------------ passenger cabin
  buildCabin() {
    const c = this.desc.cabin, sh = this.ac.model.shape;
    const z0 = c.z0, z1 = c.z1;
    const L = this.desc.livery;
    // interior shell with window holes matching the exterior livery
    const mask = canvasTex(1024, 512, (x, W, H) => {
      x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#000';
      const X = (z) => (z - sh.zNose) / sh.length * W, Y = (th) => (1 - th / TAU) * H;
      const wnd = L.windows;
      if (wnd) {
        for (const side of [1, -1]) for (const row of wnd.rows || [{ th: wnd.th, z0: wnd.z0, z1: wnd.z1 }]) {
          const th = side > 0 ? Math.PI / 2 + row.th : TAU - Math.PI / 2 - row.th;
          const hpx = (wnd.h / (TAU * (L.radius || 2))) * H * 0.85, wpx = wnd.w / sh.length * W * 0.85;
          for (let z = row.z0; z <= row.z1; z += wnd.pitch) {
            if (wnd.skip && wnd.skip.some(([a, b]) => z > a && z < b)) continue;
            x.beginPath();
            if (x.roundRect) x.roundRect(X(z) - wpx / 2, Y(th) - hpx / 2, wpx, hpx, wpx * 0.4); else x.rect(X(z) - wpx / 2, Y(th) - hpx / 2, wpx, hpx);
            x.fill();
          }
        }
      }
    }, false);
    const wallMat = new this.M({ color: 0xe8e4dc, roughness: 0.9, side: THREE.DoubleSide, alphaMap: mask, alphaTest: 0.5 });
    const shell = new THREE.Mesh(loftGeometry(sh, 40, 36, z0 - 0.5, z1 + 0.5, 0.06, true), wallMat);
    this.cabin.add(shell);
    const s0 = sh.at((z0 + z1) / 2);
    const floorY = s0.y + (c.floorY ?? -s0.h * 0.6);
    const fw = s0.w * 1.8;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, z1 - z0 + 1).rotateX(-Math.PI / 2), new this.M({ color: 0x3a4660, roughness: 1 }));
    floor.position.set(0, floorY, (z0 + z1) / 2);
    this.cabin.add(floor);
    // seats (instanced)
    const seatGeo = new THREE.BoxGeometry(0.46, 0.1, 0.45).translate(0, 0.42, 0);
    const backGeo = new THREE.BoxGeometry(0.46, 0.72, 0.09).translate(0, 0.82, 0.22);
    const abreast = c.abreast;
    const total = abreast.reduce((a, b) => a + b, 0);
    const rows = c.rows;
    const pitch = (z1 - z0) / rows;
    const seatMat = new this.M({ color: c.medical ? 0x6a7d8a : this.spec.cat === 'airliner' ? 0x26365a : 0x4a4a4a, roughness: 0.95 });
    const seats = new THREE.InstancedMesh(seatGeo, seatMat, rows * total);
    const backs = new THREE.InstancedMesh(backGeo, seatMat, rows * total);
    const m = new THREE.Matrix4();
    let k = 0;
    const seatW = 0.5, aisle = c.aisle;
    const blockW = abreast.map((n) => n * seatW);
    const width = blockW.reduce((a, b) => a + b, 0) + aisle * (abreast.length - 1);
    for (let r = 0; r < rows; r++) {
      const z = z0 + pitch * (r + 0.5);
      let x = -width / 2;
      abreast.forEach((n, bi) => {
        for (let i = 0; i < n; i++) {
          m.makeTranslation(x + seatW * (i + 0.5), floorY, z);
          if (c.bench) m.multiply(new THREE.Matrix4().makeRotationY(bi === 0 ? Math.PI / 2 : -Math.PI / 2));
          seats.setMatrixAt(k, m); backs.setMatrixAt(k, m); k++;
        }
        x += blockW[bi] + aisle;
      });
    }
    seats.count = backs.count = k;
    this.cabin.add(seats); this.cabin.add(backs);
    // overhead bins & ceiling light strip
    if (this.spec.cat === 'airliner') {
      for (const s of [-1, 1]) {
        const bin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, z1 - z0), new this.M({ color: 0xf0eee8, roughness: 0.8 }));
        bin.position.set(s * (s0.w - 0.45), s0.y + s0.h * 0.45, (z0 + z1) / 2);
        bin.rotation.z = s * 0.35;
        this.cabin.add(bin);
      }
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.25, z1 - z0).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff4e0 }));
      strip.position.set(0, s0.y + s0.h * 0.82, (z0 + z1) / 2);
      this.cabin.add(strip);
      this.cabinStrip = strip;
    }
    this.cabinEye = new THREE.Vector3(...c.eye);
  }

  // ------------------------------------------------------------ per-frame update
  update(dt, data, t) {
    const hz = settings.g.displayHz;
    for (const g of this.gauges) g.userData.update(data);
    // round-robin display redraw: at most 2 canvas uploads per frame
    // (start index rotates so that no screen is starved when the budget runs out)
    let budget = 2;
    const n = this.displays.length;
    this.rr = ((this.rr || 0) + 1) % Math.max(1, n);
    for (let k = 0; k < n; k++) {
      const d = this.displays[(this.rr + k) % n];
      if (budget > 0) { if (d.update(dt, data, hz)) budget--; } else d.timer -= dt;
    }
    for (const f of this.anim) f(t);
    // instrument lighting: dim faces slightly at night with the panel light knob
    const night = data.night;
    const panel = this.ac.systems.lights.panel;
    const lum = night ? 0.25 + 0.75 * panel * (this.ac.systems.powered ? 1 : 0.2) : 1;
    for (const m of this.faceMats) { if (m.color) m.color.setScalar(lum); }
    // backlit panels: faint by day, glowing at night (panel light knob, needs electrical power)
    const pw = this.ac.systems.powered ? 1 : 0;
    const glow = (night ? 0.35 + 0.85 * panel : 0.22) * pw;
    for (const m of this.glowMats) m.emissiveIntensity = glow;
    if (this.ledMat) this.ledMat.color.setHex(pw ? (night ? 0x4d8dff : 0x26447e) : 0x0a0e16);
    this.fill.intensity = 0.06 + 0.32 * (data.night ? 0.1 : 1) + (night ? 0.08 * panel * pw : 0);
  }
}

function spec_hasReverse(spec) { return !!(spec.systems && spec.systems.reversers); }
