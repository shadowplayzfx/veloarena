import * as THREE from 'three';

interface Particle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

const MAX_PARTICLES = 360;

export class ParticleSystem {
  private mesh: THREE.InstancedMesh;
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshBasicMaterial;
  private particles: Particle[] = [];
  private cursor = 0;

  private dummy = new THREE.Object3D();
  private zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene) {
    this.geo = new THREE.OctahedronGeometry(0.28, 0);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, MAX_PARTICLES);
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        color: new THREE.Color(0xffffff),
      });
      this.mesh.setMatrixAt(i, this.zeroMat);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  public emit(
    pos: { x: number; y: number; z: number },
    vel: { x: number; y: number; z: number },
    colorHex: string | number,
    size = 1.0,
    maxLife = 0.45
  ): void {
    const p = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;

    p.active = true;
    p.pos.set(pos.x, pos.y, pos.z);
    p.vel.set(vel.x, vel.y, vel.z);
    p.life = maxLife;
    p.maxLife = maxLife;
    p.size = size;
    p.color.set(colorHex);
  }

  public emitExplosion(center: { x: number; y: number; z: number }, colorA: string, colorB: string, count = 75): void {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 10 + Math.random() * 28;
      this.emit(
        center,
        {
          x: Math.sin(phi) * Math.cos(theta) * speed,
          y: Math.abs(Math.cos(phi)) * speed * 0.8 + 4,
          z: Math.sin(phi) * Math.sin(theta) * speed,
        },
        i % 2 === 0 ? colorA : colorB,
        1.4 + Math.random() * 1.4,
        0.9 + Math.random() * 0.7
      );
    }
  }

  public update(dt: number): void {
    let anyActive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) {
        this.mesh.setMatrixAt(i, this.zeroMat);
        continue;
      }
      anyActive = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.mesh.setMatrixAt(i, this.zeroMat);
        continue;
      }

      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(0.95);
      const t = p.life / p.maxLife;
      const s = p.size * t;

      this.dummy.position.copy(p.pos);
      this.dummy.rotation.set(p.life * 6, p.life * 4, 0);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, p.color);
    }

    if (anyActive) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}
