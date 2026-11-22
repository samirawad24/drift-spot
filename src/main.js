import * as THREE from 'three';
import { CAR_SPECS, createCar, stepCar } from './physics.js';
import { WORLD, WALL, PATH, TRACK, surfaceAt, startPose, drawGround, toTex, trackDistance, rng, TEX_W } from './track.js';
import { initInput, readInput, rumble, onPad, isTouchDevice, padConnected } from './input.js';
import { buildCar, poseCar } from './car-model.js';

const RENDER_H = 270;
const STEP = 1 / 120;
const PPM = TEX_W / WORLD.W;

// ---------- Renderer ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);

const scene = new THREE.Scene();
const FOG = new THREE.Color('#5d3f6e');
scene.background = FOG;
scene.fog = new THREE.Fog(FOG, 140, 430);

const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.3, 900);

function resize() {
  const w = innerWidth, h = innerHeight;
  const rh = Math.min(RENDER_H, h);
  const rw = Math.round(rh * w / h);
  renderer.setSize(rw, rh, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- Lights ----------
scene.add(new THREE.HemisphereLight('#fff0e2', '#3a2c58', 1.7));
const sun = new THREE.DirectionalLight('#ffd9b4', 2.0);
sun.position.set(-60, 80, 40);
scene.add(sun);

// ---------- Textures ----------
function pixelTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const x = c.getContext('2d');
  const bands = ['#1b1f4a', '#262357', '#352a66', '#4b3172', '#683a7a', '#8e4a7e', '#b85c78', '#dc7a6e', '#f29c62'];
  const bandH = 100 / bands.length;
  bands.forEach((col, i) => {
    x.fillStyle = col;
    x.fillRect(0, Math.floor(i * bandH), 512, Math.ceil(bandH) + 1);
    // dithered edge between bands
    if (i > 0) {
      x.fillStyle = bands[i - 1];
      const y = Math.floor(i * bandH);
      for (let px = 0; px < 512; px += 2) x.fillRect(px + (y % 2), y, 1, 1);
    }
  });
  x.fillStyle = '#f29c62';
  x.fillRect(0, 100, 512, 60);
  // Sun
  x.fillStyle = '#ffd96a';
  for (let dy = -10; dy <= 10; dy++) {
    const half = Math.floor(Math.sqrt(100 - dy * dy));
    if (dy % 3 === 2 && dy > 0) continue;
    x.fillRect(150 - half, 92 + dy, half * 2, 1);
  }
  // Mountains, two layers
  const r = rng(3);
  const ridge = (col, base, amp, step) => {
    x.fillStyle = col;
    let hgt = base;
    for (let px = 0; px < 512; px += step) {
      hgt += (r() - 0.5) * amp;
      hgt = Math.max(base - 22, Math.min(base + 6, hgt));
      x.fillRect(px, Math.floor(hgt), step, 160);
    }
  };
  ridge('#4a2f63', 100, 7, 4);
  ridge('#2f2350', 116, 6, 3);
  x.fillStyle = '#2a2047';
  x.fillRect(0, 130, 512, 30);
  const t = pixelTex(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.x = 3;
  return t;
}

const sky = new THREE.Mesh(
  new THREE.CylinderGeometry(460, 460, 240, 48, 1, true),
  new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false })
);
sky.position.y = 70;
scene.add(sky);

// Grass beyond the track area
function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = '#3f7a2c';
  x.fillRect(0, 0, 32, 32);
  const r = rng(11);
  for (let i = 0; i < 90; i++) {
    x.fillStyle = r() < 0.5 ? '#376b27' : '#4a8833';
    x.fillRect(Math.floor(r() * 32), Math.floor(r() * 32), 1, 1);
  }
  const t = pixelTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(160, 160);
  return t;
}
const outer = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshLambertMaterial({ map: grassTexture() }));
outer.rotation.x = -Math.PI / 2;
outer.position.y = -0.02;
scene.add(outer);

// Track ground with live skid marks drawn into it
const groundCanvas = document.createElement('canvas');
const gctx = drawGround(groundCanvas);
const groundTex = pixelTex(groundCanvas);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.W, WORLD.H), new THREE.MeshLambertMaterial({ map: groundTex }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// ---------- Scenery ----------
const flat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

function addWalls() {
  const seg = 4;
  const geo = new THREE.BoxGeometry(seg, 0.9, 0.5);
  const runs = [];
  for (let x = -WALL.x; x < WALL.x; x += seg) {
    runs.push([x + seg / 2, -WALL.z - 0.25, 0], [x + seg / 2, WALL.z + 0.25, 0]);
  }
  for (let z = -WALL.z; z < WALL.z; z += seg) {
    runs.push([-WALL.x - 0.25, z + seg / 2, Math.PI / 2], [WALL.x + 0.25, z + seg / 2, Math.PI / 2]);
  }
  const red = new THREE.InstancedMesh(geo, flat('#d8342c'), runs.length);
  const white = new THREE.InstancedMesh(geo, flat('#efeae0'), runs.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let nr = 0, nw = 0;
  runs.forEach(([x, z, r], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r);
    m.compose(new THREE.Vector3(x, 0.45, z), q, new THREE.Vector3(1, 1, 1));
    const k = Math.floor(i / 2);
    if (k % 2) red.setMatrixAt(nr++, m); else white.setMatrixAt(nw++, m);
  });
  red.count = nr; white.count = nw;
  scene.add(red, white);

  // Tire stacks in the corners
  const tire = new THREE.CylinderGeometry(0.45, 0.45, 0.32, 8);
  const tm = flat('#1a1a1a');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      for (let lvl = 0; lvl < 3; lvl++) {
        const t = new THREE.Mesh(tire, tm);
        const along = k * 0.95;
        const onX = k < 3;
        t.position.set(
          sx * (WALL.x - 0.8 - (onX ? along : 0)),
          0.16 + lvl * 0.32,
          sz * (WALL.z - 0.8 - (onX ? 0 : (k - 3) * 0.95 + 0.95)),
        );
        scene.add(t);
      }
    }
  }
}
addWalls();

const trees = [];
function addTrees() {
  const r = rng(42);
  const trunk = new THREE.BoxGeometry(0.5, 1.6, 0.5);
  const crownA = new THREE.ConeGeometry(2.2, 4.5, 6);
  const crownB = new THREE.ConeGeometry(1.6, 3.2, 6);
  const tMat = flat('#5a3a22');
  const cMat = [flat('#2d5e2a'), flat('#3a7232'), flat('#24502a')];
  const place = (x, z, s) => {
    const g = new THREE.Group();
    const tr = new THREE.Mesh(trunk, tMat); tr.position.y = 0.8;
    const a = new THREE.Mesh(crownA, cMat[Math.floor(r() * 3)]); a.position.y = 3.6;
    const b = new THREE.Mesh(crownB, cMat[Math.floor(r() * 3)]); b.position.y = 5.6;
    g.add(tr, a, b);
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    g.rotation.y = r() * 6;
    scene.add(g);
    return g;
  };
  // Outside the walls
  for (let i = 0; i < 160; i++) {
    const ang = r() * Math.PI * 2;
    const rad = 0.62 + r() * 0.9;
    const x = Math.cos(ang) * (WORLD.W * rad), z = Math.sin(ang) * (WORLD.H * rad);
    if (Math.abs(x) < WALL.x + 6 && Math.abs(z) < WALL.z + 6) continue;
    place(x, z, 0.8 + r() * 0.9);
  }
  // A few in the infield, away from the track
  let tries = 0;
  while (trees.length < 14 && tries++ < 600) {
    const x = (r() - 0.5) * WALL.x * 1.8, z = (r() - 0.5) * WALL.z * 1.8;
    if (trackDistance(x, z).d < TRACK.halfWidth + TRACK.curb + TRACK.runoff + 5) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 7)) continue;
    const s = 0.7 + r() * 0.5;
    place(x, z, s);
    trees.push({ x, z, r: 0.9 * s + 0.4 });
  }
}
addTrees();

function addLightPoles() {
  const pole = new THREE.BoxGeometry(0.3, 12, 0.3);
  const head = new THREE.BoxGeometry(1.6, 0.4, 0.8);
  const pm = flat('#8a8a94');
  const hm = new THREE.MeshBasicMaterial({ color: '#fff0a8' });
  for (const [x, z] of [[-WALL.x - 2, -30], [-WALL.x - 2, 30], [WALL.x + 2, -30], [WALL.x + 2, 30], [-40, -WALL.z - 2], [40, WALL.z + 2]]) {
    const p = new THREE.Mesh(pole, pm); p.position.set(x, 6, z);
    const h = new THREE.Mesh(head, hm); h.position.set(x, 12, z);
    scene.add(p, h);
  }
}
addLightPoles();

// Driver stands. You watch from the top of one.
const SPOTS = [
  { name: 'CHASE CAM', chase: true },
  { name: 'MAIN STAND', x: 0, y: 9, z: WALL.z + 5 },
  { name: 'EAST TOWER', x: WALL.x + 5, y: 11, z: 4 },
  { name: 'BACK HILL', x: -38, y: 13, z: -WALL.z - 6 },
];
const standModels = SPOTS.filter((s) => !s.chase).map((s) => {
  const g = new THREE.Group();
  const top = s.y - 1.7;
  const leg = new THREE.BoxGeometry(0.3, top, 0.3);
  const lm = flat('#7a6a5a');
  for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
    const l = new THREE.Mesh(leg, lm); l.position.set(dx, top / 2, dz); g.add(l);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.3, 4.4), flat('#a08060'));
  deck.position.y = top; g.add(deck);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.9, 4.4), flat('#d8342c'));
  rail.position.y = top + 0.6; rail.scale.set(1, 1, 1); g.add(rail);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(5, 0.25, 5), flat('#efeae0'));
  roof.position.y = top + 3.2; g.add(roof);
  g.position.set(s.x, 0, s.z);
  scene.add(g);
  return g;
});

// ---------- Car ----------
const spec = CAR_SPECS.kaze;
const pose0 = startPose();
const car = createCar(spec, pose0.x, pose0.z, pose0.h);
const carModel = buildCar();
scene.add(carModel);

const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(4.6, 2.1),
  new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false })
);
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);

function resetCar() {
  const p = startPose();
  Object.assign(car, { x: p.x, z: p.z, h: p.h, vx: 0, vz: 0, yaw: 0, steer: 0 });
  skidPrev = null;
  chaseSnap = true;
}

// ---------- Smoke ----------
function smokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 12;
  const x = c.getContext('2d');
  for (let py = 0; py < 12; py++) for (let px = 0; px < 12; px++) {
    const d = Math.hypot(px - 5.5, py - 5.5);
    if (d < 5.6) {
      x.fillStyle = d < 3 ? '#ffffff' : '#d9d4e4';
      x.fillRect(px, py, 1, 1);
    }
  }
  return pixelTex(c);
}
const smokeMap = smokeTexture();
const smoke = [];
for (let i = 0; i < 110; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeMap, transparent: true, depthWrite: false, opacity: 0 }));
  s.visible = false;
  scene.add(s);
  smoke.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1 });
}
let smokeNext = 0;
function puff(x, z, strength) {
  const p = smoke[smokeNext];
  smokeNext = (smokeNext + 1) % smoke.length;
  p.life = p.max = 0.9 + Math.random() * 0.8;
  p.vx = (Math.random() - 0.5) * 1.5 - car.vx * 0.08;
  p.vz = (Math.random() - 0.5) * 1.5 - car.vz * 0.08;
  p.vy = 0.6 + Math.random() * 0.8;
  p.size = 0.8 + strength * 0.6;
  p.s.position.set(x, 0.4, z);
  p.s.visible = true;
}
function updateSmoke(dt) {
  for (const p of smoke) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.s.visible = false; continue; }
    const k = 1 - p.life / p.max;
    p.s.position.x += p.vx * dt;
    p.s.position.y += p.vy * dt;
    p.s.position.z += p.vz * dt;
    p.vx *= 0.98; p.vz *= 0.98;
    const sz = p.size * (1 + k * 2.6);
    p.s.scale.set(sz, sz, 1);
    const near = Math.min(1, Math.max(0, (p.s.position.distanceTo(camera.position) - 3) / 7));
    p.s.material.opacity = 0.7 * (1 - k) * near;
  }
}

// ---------- Skid marks ----------
let skidPrev = null;
let groundDirty = false;
let groundTimer = 0;
function rearWheels() {
  const fx = Math.cos(car.h), fz = Math.sin(car.h);
  const rx = -fz, rz = fx;
  const bx = car.x - fx * 1.3, bz = car.z - fz * 1.3;
  return [[bx + rx * 0.8, bz + rz * 0.8], [bx - rx * 0.8, bz - rz * 0.8]];
}
function drawSkids(on, strength) {
  const now = rearWheels();
  if (on && skidPrev) {
    gctx.strokeStyle = `rgba(22, 20, 26, ${0.18 + 0.2 * strength})`;
    gctx.lineWidth = 0.3 * PPM;
    gctx.setLineDash([]);
    gctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const [ax, ay] = toTex(skidPrev[i][0], skidPrev[i][1]);
      const [bx, by] = toTex(now[i][0], now[i][1]);
      gctx.beginPath(); gctx.moveTo(ax, ay); gctx.lineTo(bx, by); gctx.stroke();
    }
    groundDirty = true;
  }
  skidPrev = on ? now : null;
}

// ---------- Collisions ----------
const CAR_R = 1.9;
function collide() {
  let hit = 0;
  const lim = [WALL.x - CAR_R + 0.6, WALL.z - CAR_R + 0.6];
  if (Math.abs(car.x) > lim[0]) {
    hit = Math.max(hit, Math.abs(car.vx));
    car.x = Math.sign(car.x) * lim[0];
    car.vx *= -0.3; car.vz *= 0.8; car.yaw *= 0.5;
  }
  if (Math.abs(car.z) > lim[1]) {
    hit = Math.max(hit, Math.abs(car.vz));
    car.z = Math.sign(car.z) * lim[1];
    car.vz *= -0.3; car.vx *= 0.8; car.yaw *= 0.5;
  }
  for (const t of trees) {
    const dx = car.x - t.x, dz = car.z - t.z;
    const d = Math.hypot(dx, dz), min = t.r + 1.4;
    if (d < min && d > 0.001) {
      const nx = dx / d, nz = dz / d;
      const vn = car.vx * nx + car.vz * nz;
      car.x = t.x + nx * min; car.z = t.z + nz * min;
      if (vn < 0) {
        hit = Math.max(hit, -vn);
        car.vx -= nx * vn * 1.3; car.vz -= nz * vn * 1.3;
        car.vx *= 0.7; car.vz *= 0.7; car.yaw *= 0.5;
      }
    }
  }
  return hit;
}

// ---------- Camera ----------
let spotIndex = 0;
const look = new THREE.Vector3(car.x, 0, car.z);
let fov = 40;
function setSpot(i) {
  spotIndex = (i + SPOTS.length) % SPOTS.length;
  standModels.forEach((m, k) => { m.visible = k !== spotIndex - 1; });
  const s = SPOTS[spotIndex];
  if (!s.chase) camera.position.set(s.x, s.y, s.z);
  chaseSnap = true;
  toast(s.name);
}

// Third person: sits behind the direction of travel, so a drifting car
// shows its side to the camera.
let chaseSnap = true;
let chaseDir = 0;
function updateChase(dt) {
  const travel = car.speed > 3 && car.forward > 0 ? Math.atan2(car.vz, car.vx) : car.h;
  if (chaseSnap) chaseDir = travel;
  let diff = travel - chaseDir;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  chaseDir += diff * (chaseSnap ? 1 : 1 - Math.exp(-dt * 3.5));
  const dist = 8 + Math.min(4, car.speed * 0.08);
  const tx = car.x - Math.cos(chaseDir) * dist;
  const tz = car.z - Math.sin(chaseDir) * dist;
  const k = chaseSnap ? 1 : 1 - Math.exp(-dt * 8);
  camera.position.x += (tx - camera.position.x) * k;
  camera.position.z += (tz - camera.position.z) * k;
  camera.position.y += (3.4 - camera.position.y) * k;
  look.set(car.x + Math.cos(chaseDir) * 3, 1, car.z + Math.sin(chaseDir) * 3);
  fov += (58 + Math.min(10, car.speed * 0.25) - fov) * (chaseSnap ? 1 : 1 - Math.exp(-dt * 3));
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.lookAt(look);
  chaseSnap = false;
}
function updateCamera(dt, snap) {
  if (SPOTS[spotIndex].chase) { updateChase(dt); return; }
  const leadX = car.x + car.vx * 0.25, leadZ = car.z + car.vz * 0.25;
  const k = snap ? 1 : 1 - Math.exp(-dt * 6);
  look.x += (leadX - look.x) * k;
  look.z += (leadZ - look.z) * k;
  look.y = 0.6;
  const dist = camera.position.distanceTo(look);
  const target = THREE.MathUtils.clamp(2 * Math.atan(9 / dist) * 180 / Math.PI, 9, 62);
  fov += (target - fov) * (snap ? 1 : 1 - Math.exp(-dt * 3));
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.lookAt(look);
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), touch: $('touch'), title: $('title'), pause: $('pause'), toast: $('toast'),
  speed: $('speed-num'), angle: $('angle'), angleNum: $('angle-num'), tag: $('input-tag'),
  padStatus: $('pad-status'), startHint: $('start-hint'),
};
let toastTimer = 0;
function toast(msg, secs = 1.6) {
  ui.toast.textContent = msg;
  ui.toast.hidden = false;
  toastTimer = secs;
}

initInput(document.body);
const touchDevice = isTouchDevice();
ui.startHint.textContent = touchDevice ? 'TAP TO START' : 'PRESS START';

onPad('connect', (name) => {
  ui.padStatus.textContent = `${name} CONNECTED`;
  if (state !== 'title') toast(`${name} CONNECTED`);
  ui.startHint.textContent = 'PRESS A OR START';
  refreshTouch();
});
onPad('disconnect', () => {
  ui.padStatus.textContent = 'Controller disconnected';
  if (state !== 'title') toast('CONTROLLER DISCONNECTED');
  refreshTouch();
});

function refreshTouch() {
  ui.touch.hidden = !(state === 'play' && touchDevice && !padConnected());
}

let state = 'title';
function startGame() {
  state = 'play';
  ui.title.hidden = true;
  ui.hud.hidden = false;
  ui.pause.hidden = true;
  setSpot(spotIndex);
  refreshTouch();
}
function pauseGame() {
  state = 'pause';
  ui.pause.hidden = false;
  menuIndex = 0;
  focusMenu();
  refreshTouch();
}
function resumeGame() {
  state = 'play';
  ui.pause.hidden = true;
  refreshTouch();
}

ui.title.addEventListener('pointerdown', () => { if (state === 'title') startGame(); });
$('pause-btn').addEventListener('click', () => (state === 'play' ? pauseGame() : resumeGame()));
$('spot-btn').addEventListener('click', () => setSpot(spotIndex + 1));

const menuButtons = [...ui.pause.querySelectorAll('button')];
let menuIndex = 0;
function focusMenu() { menuButtons.forEach((b, i) => b.classList.toggle('focus', i === menuIndex)); }
function menuAct(act) {
  if (act === 'resume') resumeGame();
  if (act === 'reset') { resetCar(); resumeGame(); }
  if (act === 'spot') { setSpot(spotIndex + 1); resumeGame(); }
}
menuButtons.forEach((b) => b.addEventListener('click', () => menuAct(b.dataset.act)));

document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pauseGame(); });

// ---------- Loop ----------
let last = performance.now();
let acc = 0;
let wasDrifting = false;
let smokeAcc = 0;
updateCamera(0, true);
setSpot(0);
ui.toast.hidden = true;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const inp = readInput(dt);

  if (state === 'title') {
    if (inp.actions.has('start') || inp.actions.has('pause')) startGame();
  } else if (state === 'pause') {
    if (inp.actions.has('pause') || inp.actions.has('back')) resumeGame();
    if (inp.actions.has('up') || inp.actions.has('gas')) { menuIndex = (menuIndex + menuButtons.length - 1) % menuButtons.length; focusMenu(); }
    if (inp.actions.has('down') || inp.actions.has('brake')) { menuIndex = (menuIndex + 1) % menuButtons.length; focusMenu(); }
    if (inp.actions.has('start')) menuAct(menuButtons[menuIndex].dataset.act);
  } else if (state === 'play') {
    if (inp.actions.has('pause')) pauseGame();
    if (inp.actions.has('spot')) setSpot(spotIndex + 1);
    if (inp.actions.has('reset')) resetCar();

    acc += dt;
    let hit = 0;
    while (acc >= STEP) {
      const surf = surfaceAt(car.x, car.z);
      stepCar(car, inp, STEP, surf);
      hit = Math.max(hit, collide());
      acc -= STEP;
    }

    // Effects
    const slide = Math.min(1, Math.abs(car.slipRear) * 2 + (car.wheelspin ? 0.5 : 0));
    const onAsphalt = surfaceAt(car.x, car.z).type === 'asphalt';
    drawSkids(car.rearSliding && onAsphalt, slide);
    if (car.rearSliding) {
      smokeAcc += dt * (12 + car.speed * 1.2) * (onAsphalt ? 1 : 0.6);
      while (smokeAcc > 1) {
        smokeAcc -= 1;
        const w = rearWheels()[Math.random() < 0.5 ? 0 : 1];
        puff(w[0], w[1], slide);
      }
    }
    if (car.drifting && !wasDrifting) rumble(0.15, 0.45, 160);
    if (hit > 4) { rumble(Math.min(1, hit / 15), 0.6, 220); }
    wasDrifting = car.drifting;

    // HUD
    const kmh = Math.round(car.speed * 3.6);
    ui.speed.textContent = String(kmh).padStart(3, '0');
    const ang = Math.round(Math.abs(car.beta) * 180 / Math.PI);
    ui.angle.classList.toggle('on', car.drifting);
    ui.angleNum.textContent = String(ang).padStart(2, '0');
    const tag = inp.source === 'pad' ? 'PAD' : inp.source === 'touch' ? 'TOUCH' : 'KEYS';
    if (ui.tag.textContent !== tag) ui.tag.textContent = tag;
  }

  updateSmoke(dt);
  groundTimer -= dt;
  if (groundDirty && groundTimer <= 0) {
    groundTex.needsUpdate = true;
    groundDirty = false;
    groundTimer = 0.05;
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) ui.toast.hidden = true;
  }

  poseCar(carModel, car);
  shadow.position.set(car.x, 0.03, car.z);
  shadow.rotation.z = -car.h;
  updateCamera(dt, false);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Expose for quick debugging in the console
window.__drift = { car, setSpot };
