// Car physics. Pure math, no DOM, so it can be tested in Node.
// World plane uses (x, z). Heading h: forward = (cos h, sin h).
// Positive steer, yaw rate and lateral speed all mean "to the car's right".

export const CAR_SPECS = {
  kaze: {
    name: 'KAZE K86',
    mass: 1000,
    a: 1.15,            // center of mass to front axle (m)
    b: 1.2,             // center of mass to rear axle (m)
    mu: 1.05,           // tire grip on asphalt
    peakSlip: 0.13,     // slip angle (rad) where grip peaks
    slideGrip: 0.86,    // grip left once the tire is fully sliding
    power: 85000,       // W
    maxDrive: 7400,     // N at the rear wheels
    brakeForce: 9500,
    reverseForce: 3800,
    maxSteer: 0.72,     // rad, about 41 degrees of lock
    steerRate: 5.0,     // rad/s
    drag: 0.55,
    rolling: 14,
    handbrakeGrip: 0.3,
    assist: 1.0,        // spin-out helper strength
  },
};

const G = 9.81;

export function createCar(spec, x = 0, z = 0, h = 0) {
  return {
    spec,
    x, z, h,
    vx: 0, vz: 0,
    yaw: 0,             // yaw rate (rad/s)
    steer: 0,           // current front wheel angle (rad)
    throttle: 0,
    // telemetry for effects and HUD
    speed: 0,
    forward: 0,
    beta: 0,            // body slip angle (rad)
    slipRear: 0,
    rearSliding: false,
    drifting: false,
    wheelspin: false,
  };
}

function tireCurve(slip, peak, slide) {
  const s = Math.abs(slip);
  let f;
  if (s <= peak) f = s / peak;
  else f = 1 - (1 - slide) * Math.min(1, (s - peak) / 0.45);
  return Math.sign(slip) * f;
}

// input: { steer -1..1, throttle 0..1, brake 0..1, handbrake bool }
// surface: { grip multiplier, drag extra }
export function stepCar(car, input, dt, surface = { grip: 1, roll: 1 }) {
  const s = car.spec;
  const L = s.a + s.b;
  const ch = Math.cos(car.h), sh = Math.sin(car.h);
  const fx = ch, fz = sh;      // forward
  const rx = -sh, rz = ch;     // right

  let u = car.vx * fx + car.vz * fz;   // forward speed
  let w = car.vx * rx + car.vz * rz;   // lateral speed (right +)
  const speed = Math.hypot(u, w);
  const beta = speed > 1 ? Math.atan2(w, Math.abs(u)) : 0;

  // Steering. Full lock is allowed while sliding, less at speed while gripping.
  let lockScale = 1;
  if (Math.abs(beta) < 0.15) lockScale = 1 - 0.6 * Math.min(1, speed / 38);
  const targetSteer = input.steer * s.maxSteer * lockScale;
  const ds = targetSteer - car.steer;
  const maxDs = s.steerRate * dt;
  car.steer += Math.max(-maxDs, Math.min(maxDs, ds));
  const d = car.steer;

  const mu = s.mu * surface.grip;
  const Fzf = s.mass * G * s.b / L;
  const Fzr = s.mass * G * s.a / L;
  const capF = mu * Fzf;
  const capR = mu * Fzr;

  // Longitudinal force at the rear wheels
  let drive = 0;
  if (input.throttle > 0 && u > -1) {
    drive = input.throttle * Math.min(s.maxDrive, s.power / Math.max(Math.abs(u), 1));
  }
  let brakeF = 0;
  if (input.brake > 0) {
    if (u > 0.8) brakeF = -input.brake * s.brakeForce;
    else if (u > -9) drive = -input.brake * s.reverseForce; // reverse
  }
  let latFactorR = 1;
  let spin = false;
  const util = Math.abs(drive) / capR;
  if (util >= 1) {
    drive = Math.sign(drive) * capR * 0.92;
    latFactorR = 0.55;
    spin = true;
  } else {
    latFactorR = Math.sqrt(1 - 0.5 * util * util);
  }
  let hbF = 0;
  if (input.handbrake) {
    latFactorR = Math.min(latFactorR, s.handbrakeGrip);
    if (Math.abs(u) > 0.3) hbF = -Math.sign(u) * capR * 0.55;
    else hbF = -u * s.mass * 4;
  }

  // Lateral tire forces
  const denom = Math.max(Math.abs(u), 2.5);
  const sgn = u >= 0 ? 1 : -1;
  const slipF = Math.atan2(w + car.yaw * s.a, denom) - d * sgn;
  const slipR = Math.atan2(w - car.yaw * s.b, denom);
  const Fyf = -tireCurve(slipF, s.peakSlip, s.slideGrip) * capF;
  const Fyr = -tireCurve(slipR, s.peakSlip, s.slideGrip) * capR * latFactorR;

  // Resistances
  const roll = s.rolling * surface.roll;
  const Fdrag = -s.drag * u * Math.abs(u) - roll * u;

  let Fx = drive + brakeF + hbF + Fdrag - Fyf * Math.sin(d);
  let Fy = Fyr + Fyf * Math.cos(d) - roll * w * 0.5;

  const I = s.mass * s.a * s.b * 1.1;
  let torque = s.a * Fyf * Math.cos(d) - s.b * Fyr;

  // Spin-out helper: resists rotation past about 50 degrees of body slip
  if (s.assist > 0 && speed > 3) {
    // In a drift, beta and yaw have opposite signs. Past about 45 degrees,
    // push back against further rotation.
    const over = Math.abs(beta) - 0.75;
    if (over > 0 && Math.sign(car.yaw) !== Math.sign(beta)) {
      torque -= car.yaw * I * over * 6 * s.assist;
    }
    // Countersteer helps the car straighten, like a skilled driver's hands
    if (Math.abs(beta) > 0.2 && Math.sign(d) === Math.sign(beta)) {
      torque += d * I * 1.6 * s.assist;
    }
    torque -= car.yaw * I * 0.5 * s.assist;
  }

  // Integrate
  const ax = (Fx * fx + Fy * rx) / s.mass;
  const az = (Fx * fz + Fy * rz) / s.mass;
  car.vx += ax * dt;
  car.vz += az * dt;
  car.yaw += (torque / I) * dt;

  // Low speed: blend toward simple rolling-wheel motion so the car stays calm
  const newU = car.vx * fx + car.vz * fz;
  if (speed < 3) {
    const k = 1 - speed / 3;
    const kinYaw = newU * Math.tan(d) / L;
    car.yaw += (kinYaw - car.yaw) * Math.min(1, k * 12 * dt);
    const newW = car.vx * rx + car.vz * rz;
    const damp = Math.min(1, k * 10 * dt);
    car.vx -= rx * newW * damp;
    car.vz -= rz * newW * damp;
    if (speed < 0.15 && input.throttle === 0 && input.brake === 0) {
      car.vx = 0; car.vz = 0; car.yaw = 0;
    }
  }

  car.h += car.yaw * dt;
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  // Telemetry
  car.speed = speed;
  car.forward = u;
  car.beta = beta;
  car.slipRear = slipR;
  car.wheelspin = spin && speed < 25;
  car.rearSliding = speed > 2.5 && (Math.abs(slipR) > 0.2 || (input.handbrake && speed > 3) || spin);
  car.drifting = speed > 6 && Math.abs(beta) > 0.26 && u > 0;
  return car;
}
