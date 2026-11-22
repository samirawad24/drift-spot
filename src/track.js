// Track layout, surface lookup and the pixel ground texture.

export const WORLD = { W: 180, H: 130 };   // playable area in meters (x, z)
export const WALL = { x: WORLD.W / 2 - 3, z: WORLD.H / 2 - 3 };

// Closed loop, clockwise when seen from the main driver stand (south side).
const CONTROL = [
  [-62, 22], [-30, 36], [10, 36], [42, 40], [66, 26], [68, -2],
  [50, -14], [24, -6], [8, -20], [22, -38], [-10, -44], [-46, -36],
  [-66, -14],
];

export const TRACK = {
  halfWidth: 7.5,
  curb: 1.3,
  runoff: 4,
};

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function buildPath(ctrl, perSeg = 40) {
  const pts = [];
  const n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg;
      pts.push({ x: catmull(p0[0], p1[0], p2[0], p3[0], t), z: catmull(p0[1], p1[1], p2[1], p3[1], t) });
    }
  }
  return pts;
}

export const PATH = buildPath(CONTROL);

// Distance from a point to the track centerline
export function trackDistance(x, z) {
  let best = Infinity, bestI = 0;
  const n = PATH.length;
  for (let i = 0; i < n; i++) {
    const a = PATH[i], b = PATH[(i + 1) % n];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t - x, pz = a.z + dz * t - z;
    const d2 = px * px + pz * pz;
    if (d2 < best) { best = d2; bestI = i; }
  }
  return { d: Math.sqrt(best), i: bestI };
}

export function surfaceAt(x, z) {
  const { d } = trackDistance(x, z);
  if (d <= TRACK.halfWidth + TRACK.curb) return { type: 'asphalt', grip: 1, roll: 1 };
  if (d <= TRACK.halfWidth + TRACK.curb + TRACK.runoff) return { type: 'dirt', grip: 0.75, roll: 4 };
  return { type: 'grass', grip: 0.6, roll: 7 };
}

export function startPose() {
  const i = 20;
  const a = PATH[i], b = PATH[i + 1];
  return { x: a.x, z: a.z, h: Math.atan2(b.z - a.z, b.x - a.x), i };
}

// Seeded random so scenery is the same every load
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Ground texture ----------
export const TEX_W = 1024;
export const TEX_H = Math.round(TEX_W * WORLD.H / WORLD.W);
const PPM = TEX_W / WORLD.W; // pixels per meter

export function toTex(x, z) {
  return [(x + WORLD.W / 2) * PPM, (z + WORLD.H / 2) * PPM];
}

function strokePath(ctx, widthM, color, dash) {
  ctx.beginPath();
  PATH.forEach((p, i) => {
    const [px, py] = toTex(p.x, p.z);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.lineWidth = widthM * PPM;
  ctx.strokeStyle = color;
  ctx.setLineDash(dash || []);
  ctx.lineCap = dash ? 'butt' : 'round';
  ctx.stroke();
}

export function drawGround(canvas) {
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.fillStyle = '#3f7a2c';
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  const hw = TRACK.halfWidth, c = TRACK.curb, r = TRACK.runoff;
  strokePath(ctx, (hw + c + r) * 2, '#a5875a');
  strokePath(ctx, (hw + c) * 2, '#e8e4d8');
  const dash = 2.2 * PPM;
  strokePath(ctx, (hw + c) * 2, '#c8302c', [dash, dash]);
  strokePath(ctx, hw * 2, '#4b4b55');
  strokePath(ctx, hw * 2 - 0.5 * PPM, '#55555f');

  // Start line, checkered, across the track at the start pose
  const s = startPose();
  const [sx, sy] = toTex(s.x, s.z);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(s.h);
  const cell = 0.75 * PPM;
  const rows = Math.ceil((hw * 2 * PPM) / cell);
  for (let j = 0; j < rows; j++) {
    for (let k = 0; k < 2; k++) {
      ctx.fillStyle = (j + k) % 2 ? '#111' : '#f4f4f4';
      ctx.fillRect(k * cell - cell, -hw * PPM + j * cell, cell, cell);
    }
  }
  ctx.restore();

  // Pixel noise for an 8-bit texture feel
  const img = ctx.getImageData(0, 0, TEX_W, TEX_H);
  const d = img.data;
  const rand = rng(7);
  for (let i = 0; i < d.length; i += 4) {
    const n = rand();
    if (n < 0.12) {
      const k = n < 0.06 ? -10 : 8;
      d[i] = Math.max(0, Math.min(255, d[i] + k));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + k));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + k));
    }
  }
  ctx.putImageData(img, 0, 0);
  return ctx;
}
