import * as THREE from 'three';

export const ARENA = {
  halfWidth: 420,   // x range the paddles/ball can travel within
  wallX: 460,       // side wall position
  baselineZ: 520,   // z distance of each paddle's home line from center
  fieldLength: 1100,
};

function checkerTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const tiles = 8;
  const tile = size / tiles;
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#0d1420' : '#121b2c';
      ctx.fillRect(x * tile, y * tile, tile, tile);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 12);
  return tex;
}

export function buildScene() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x050810, 900, 4000);
  scene.background = new THREE.Color(0x050810);

  // Floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA.wallX * 2, ARENA.fieldLength + 200),
    new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Side walls (neon-edged)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0a1120, roughness: 0.6 });
  [-1, 1].forEach((side) => {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(20, 90, ARENA.fieldLength + 200),
      wallMat
    );
    wall.position.set(side * ARENA.wallX, 40, 0);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);

    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(2, 4, ARENA.fieldLength + 200),
      new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff3d6e : 0x00f0c0 })
    );
    stripe.position.set(side * (ARENA.wallX - 9), 86, 0);
    scene.add(stripe);
  });

  // Center line
  const centerLine = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA.wallX * 2, 4),
    new THREE.MeshBasicMaterial({ color: 0x223046, transparent: true, opacity: 0.7 })
  );
  centerLine.rotation.x = -Math.PI / 2;
  centerLine.position.y = 0.2;
  scene.add(centerLine);

  // Lights
  const hemi = new THREE.HemisphereLight(0x8fb0ff, 0x0a0a12, 0.55);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(150, 500, 300);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -600;
  key.shadow.camera.right = 600;
  key.shadow.camera.top = 600;
  key.shadow.camera.bottom = -600;
  key.shadow.camera.far = 2000;
  scene.add(key);

  const rim = new THREE.PointLight(0x00f0c0, 0.6, 1400);
  rim.position.set(0, 200, ARENA.baselineZ + 100);
  scene.add(rim);

  const rim2 = new THREE.PointLight(0xff3d6e, 0.6, 1400);
  rim2.position.set(0, 200, -ARENA.baselineZ - 100);
  scene.add(rim2);

  return scene;
}

export function buildRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);
  return renderer;
}

const BASE_VFOV = 62;       // degrees. Tuned for a landscape desktop view
const BASE_ASPECT = 16 / 9; // reference aspect the 62° figure was tuned for
const MAX_VFOV = 110;       // clamp so extremely narrow screens don't fisheye

// Vertical FOV only controls how *tall* the view is, horizontal FOV falls
// out of vFOV * aspect. On a portrait phone (aspect ~0.46) a fixed 62°
// vertical FOV collapses the horizontal view to a third of what a desktop
// landscape window sees, which reads as "zoomed in". This widens the
// vertical FOV as aspect narrows so the horizontal field stays close to
// what it is on a normal desktop window, capped to avoid a fisheye look
// on very narrow screens.
export function fitCameraFov(camera) {
  camera.aspect = window.innerWidth / window.innerHeight;
  if (camera.aspect >= BASE_ASPECT) {
    camera.fov = BASE_VFOV;
  } else {
    const halfBaseV = THREE.MathUtils.degToRad(BASE_VFOV) / 2;
    const halfBaseH = Math.atan(Math.tan(halfBaseV) * BASE_ASPECT);
    const neededHalfV = Math.atan(Math.tan(halfBaseH) / camera.aspect);
    camera.fov = Math.min(MAX_VFOV, THREE.MathUtils.radToDeg(neededHalfV) * 2);
  }
  camera.updateProjectionMatrix();
}

export function buildCamera() {
  const camera = new THREE.PerspectiveCamera(
    BASE_VFOV,
    window.innerWidth / window.innerHeight,
    0.1,
    5000
  );
  camera.position.set(0, 520, ARENA.baselineZ + 480);
  fitCameraFov(camera);
  camera.lookAt(0, 40, 0);
  return camera;
}
