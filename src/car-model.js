// Blocky low-poly JDM-style hatchback. Forward is +x in local space.
import * as THREE from 'three';

const mats = new Map();
function mat(color) {
  if (!mats.has(color)) mats.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  return mats.get(color);
}

function box(group, w, h, d, x, y, z, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

export function buildCar({ body = '#f2f2ee', lower = '#18181c', accent = '#c8302c' } = {}) {
  const car = new THREE.Group();
  const shell = new THREE.Group();
  car.add(shell);

  // Two-tone body
  box(shell, 4.2, 0.32, 1.72, 0, 0.42, 0, lower);
  box(shell, 4.2, 0.36, 1.72, 0, 0.76, 0, body);
  // Hood slope and hatch
  box(shell, 1.2, 0.08, 1.6, 1.45, 0.97, 0, body);
  box(shell, 0.5, 0.3, 1.6, -1.95, 1.02, 0, body);
  // Cabin glass and roof
  box(shell, 2.2, 0.44, 1.5, -0.45, 1.16, 0, '#1d2633');
  box(shell, 1.9, 0.1, 1.44, -0.55, 1.42, 0, body);
  // Lights
  box(shell, 0.06, 0.14, 0.38, 2.11, 0.78, 0.56, '#fff2b0');
  box(shell, 0.06, 0.14, 0.38, 2.11, 0.78, -0.56, '#fff2b0');
  box(shell, 0.06, 0.16, 0.42, -2.11, 0.8, 0.55, '#e02424');
  box(shell, 0.06, 0.16, 0.42, -2.11, 0.8, -0.55, '#e02424');
  // Pinstripe and spoiler
  box(shell, 4.22, 0.05, 1.74, 0, 0.6, 0, accent);
  box(shell, 0.25, 0.06, 1.6, -2.0, 1.34, 0, lower);

  // Wheels: front ones sit in pivots so they can steer
  const wheelGeo = new THREE.BoxGeometry(0.64, 0.64, 0.3);
  const rimGeo = new THREE.BoxGeometry(0.34, 0.34, 0.32);
  const wheels = [];
  const spots = [[1.3, 0.8], [1.3, -0.8], [-1.3, 0.8], [-1.3, -0.8]];
  for (const [x, z] of spots) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.32, z);
    const tire = new THREE.Mesh(wheelGeo, mat('#151515'));
    const rim = new THREE.Mesh(rimGeo, mat('#b9b9c2'));
    pivot.add(tire, rim);
    car.add(pivot);
    wheels.push(pivot);
  }

  car.userData = { shell, wheels };
  return car;
}

export function poseCar(model, car) {
  model.position.set(car.x, 0, car.z);
  model.rotation.y = -car.h;
  const { shell, wheels } = model.userData;
  wheels[0].rotation.y = -car.steer;
  wheels[1].rotation.y = -car.steer;
  // Small body roll in slides
  shell.rotation.x = Math.max(-0.06, Math.min(0.06, car.yaw * car.speed * 0.0025));
}
