import * as THREE from 'three';
import { ARENA } from './scene.js';

export const PADDLE_SIZE = { w: 190, h: 130, d: 26 };
export const BALL_RADIUS = 28;

export class Paddle {
  constructor(scene, { z, color }) {
    this.z = z;
    this.x = 0;
    this.targetX = 0;
    this.speed = 620; // units/sec, max
    this.accel = 4200; // easing toward target velocity

    const geo = new THREE.BoxGeometry(PADDLE_SIZE.w, PADDLE_SIZE.h, PADDLE_SIZE.d);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.25,
      roughness: 0.35,
      metalness: 0.15,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(0, PADDLE_SIZE.h / 2, z);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.vx = 0;
  }

  /** dir in [-1, 0, 1] */
  step(dt, dir) {
    const desired = dir * this.speed;
    const diff = desired - this.vx;
    const maxDelta = this.accel * dt;
    this.vx += Math.max(-maxDelta, Math.min(maxDelta, diff));
    this.x += this.vx * dt;
    const limit = ARENA.halfWidth - PADDLE_SIZE.w / 2;
    this.x = Math.max(-limit, Math.min(limit, this.x));
    this.mesh.position.x = this.x;
  }

  setX(x) {
    this.x = x;
    this.mesh.position.x = x;
  }

  flashHit(color) {
    const orig = this.mesh.material.emissiveIntensity;
    this.mesh.material.emissiveIntensity = 1.0;
    setTimeout(() => {
      this.mesh.material.emissiveIntensity = orig;
    }, 120);
  }

  aabb() {
    return {
      minX: this.x - PADDLE_SIZE.w / 2,
      maxX: this.x + PADDLE_SIZE.w / 2,
      minZ: this.z - PADDLE_SIZE.d / 2 - BALL_RADIUS,
      maxZ: this.z + PADDLE_SIZE.d / 2 + BALL_RADIUS,
    };
  }
}

export class Ball {
  constructor(scene) {
    const geo = new THREE.SphereGeometry(BALL_RADIUS, 24, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfff2c0,
      emissive: 0xff8a00,
      emissiveIntensity: 0.5,
      roughness: 0.3,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.x = 0;
    this.y = PADDLE_SIZE.h / 2;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.carriedBy = null; // 'p1' | 'p2' | null (null = flying)
    this.sync();
  }

  sync() {
    this.mesh.position.set(this.x, this.y, this.z);
  }
}
