// Effects: pooled tracers, impact sparks, smoke clouds and explosions. Everything is
// created once and reused, so the hot loop allocates nothing. Smoke also answers the
// combat question "does this line cross a cloud?" — a cloud blocks sight and shots.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function radialTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(200,205,210,0.55)');
  gradient.addColorStop(0.6, 'rgba(160,168,175,0.32)');
  gradient.addColorStop(1, 'rgba(160,168,175,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createEffects(scene) {
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lamp), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const tracers = [];
  for (let i = 0; i < 16; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerNext = 0;

  const impactMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const impacts = [];
  for (let i = 0; i < 12; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), impactMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    impacts.push({ mesh, life: 0 });
  }
  let impactNext = 0;

  const smokeTex = radialTexture();
  const smokes = [];
  for (let i = 0; i < 4; i += 1) {
    const group = new THREE.Group();
    const sprites = [];
    for (let j = 0; j < 6; j += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false }));
      sprite.scale.set(3, 3, 1);
      group.add(sprite);
      sprites.push(sprite);
    }
    group.visible = false;
    scene.add(group);
    smokes.push({ group, sprites, center: new THREE.Vector3(), radius: 4.5, life: 0, duration: 0, active: false, seed: i * 1.7 });
  }
  let smokeNext = 0;

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 26, 1.4);
  scene.add(flashLight);
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  blast.visible = false;
  scene.add(blast);
  let blastLife = 0;

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  function tracer(from, to) {
    const item = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % tracers.length;
    const distance = from.distanceTo(to);
    item.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    item.mesh.lookAt(to);
    item.mesh.scale.set(1, 1, Math.max(0.1, distance));
    item.mesh.visible = true;
    item.mesh.material.opacity = 0.85;
    item.life = 0.07;
  }

  function impact(point, kind) {
    const item = impacts[impactNext];
    impactNext = (impactNext + 1) % impacts.length;
    item.mesh.position.copy(point);
    item.mesh.material.color.set(kind === 'head' ? PALETTE.danger : kind === 'smoke' ? '#9aa5ad' : PALETTE.accent);
    item.mesh.scale.setScalar(kind === 'head' ? 1.8 : 1);
    item.mesh.visible = true;
    item.mesh.material.opacity = 0.9;
    item.life = 0.16;
  }

  function addSmoke(center, duration, radius = 4.5) {
    const cloud = smokes[smokeNext];
    smokeNext = (smokeNext + 1) % smokes.length;
    cloud.center.copy(center);
    cloud.radius = radius;
    cloud.duration = duration;
    cloud.life = duration;
    cloud.active = true;
    cloud.group.position.copy(center);
    cloud.group.visible = true;
    cloud.sprites.forEach((sprite, j) => {
      const angle = cloud.seed + (j / cloud.sprites.length) * Math.PI * 2;
      sprite.position.set(Math.cos(angle) * radius * 0.45, 0.6 + (j % 3) * 0.9, Math.sin(angle) * radius * 0.45);
    });
  }

  function explosion(point) {
    flashLight.position.copy(point);
    flashLight.position.y += 1;
    flashLight.intensity = 260;
    blast.position.copy(point);
    blast.visible = true;
    blastLife = 0.35;
  }

  // Segment-sphere test against active clouds. Returns the entry point or null.
  function smokeHit(a, b) {
    for (const cloud of smokes) {
      if (!cloud.active) continue;
      tmp.copy(b).sub(a);
      const length = tmp.length();
      if (length < 0.001) continue;
      tmp.normalize();
      tmp2.copy(cloud.center).sub(a);
      const along = tmp2.dot(tmp);
      if (along < 0 || along > length) continue;
      const perp = Math.sqrt(Math.max(0, tmp2.lengthSq() - along * along));
      if (perp < cloud.radius * 0.8) {
        const entry = along - Math.sqrt(Math.max(0, (cloud.radius * 0.8) ** 2 - perp * perp));
        return a.clone().addScaledVector(tmp, Math.max(0, entry));
      }
    }
    return null;
  }

  function step(dt) {
    for (const item of tracers) {
      if (item.life <= 0) continue;
      item.life -= dt;
      if (item.life <= 0) item.mesh.visible = false;
      else item.mesh.material.opacity = Math.max(0, item.life / 0.07) * 0.85;
    }
    for (const item of impacts) {
      if (item.life <= 0) continue;
      item.life -= dt;
      if (item.life <= 0) item.mesh.visible = false;
      else {
        item.mesh.scale.multiplyScalar(1 + dt * 6);
        item.mesh.material.opacity = Math.max(0, item.life / 0.16) * 0.9;
      }
    }
    for (const cloud of smokes) {
      if (!cloud.active) continue;
      cloud.life -= dt;
      if (cloud.life <= 0) {
        cloud.active = false;
        cloud.group.visible = false;
        continue;
      }
      const age = cloud.duration - cloud.life;
      const grow = Math.min(1, age / 2);
      const fade = Math.min(1, cloud.life / 2);
      cloud.sprites.forEach((sprite) => {
        sprite.scale.set(3 + grow * 3.4, 3 + grow * 3.4, 1);
        sprite.material.opacity = 0.5 * grow * fade;
      });
    }
    if (blastLife > 0) {
      blastLife -= dt;
      const t = Math.max(0, blastLife / 0.35);
      blast.scale.setScalar(1 + (1 - t) * 7);
      blast.material.opacity = t * 0.85;
      flashLight.intensity = 260 * t;
      if (blastLife <= 0) {
        blast.visible = false;
        flashLight.intensity = 0;
      }
    }
  }

  return { tracer, impact, addSmoke, explosion, smokeHit, step };
}
