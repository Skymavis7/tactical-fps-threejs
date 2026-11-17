// Combat: one ray, one answer. Both the player and the bots shoot through fire(), so a
// hit means the same thing whoever pulled the trigger. It raycasts the world and every
// registered body part, stops shots in smoke, draws the tracer and the impact, and hands
// the hit back to the caller, which owns health and scoring. No per-frame allocation.
import * as THREE from 'three';

export function createCombat(scene, world, effects, onHit) {
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const hitMeshes = [];

  function registerTarget(mesh, owner, part) {
    mesh.userData.combat = { owner, part };
    hitMeshes.push(mesh);
  }

  function unregisterTarget(mesh) {
    const index = hitMeshes.indexOf(mesh);
    if (index !== -1) hitMeshes.splice(index, 1);
    delete mesh.userData.combat;
  }

  // A shot from `from` along `direction` with this weapon. Returns the hit record or null.
  function fire(from, direction, weapon, attacker) {
    origin.copy(from);
    dir.copy(direction).normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(origin, dir);
    raycaster.far = weapon.range;
    const targets = world.shootables.concat(hitMeshes);
    const hits = raycaster.intersectObjects(targets, false);
    let hit = hits[0] || null;
    let end = hit ? hit.point : origin.clone().addScaledVector(dir, weapon.range);
    // Smoke swallows a shot at the cloud's edge.
    const smokeAt = effects.smokeHit(origin, end);
    if (smokeAt) {
      effects.impact(smokeAt, 'smoke');
      effects.tracer(origin, smokeAt);
      return { kind: 'smoke', point: smokeAt, distance: origin.distanceTo(smokeAt) };
    }
    if (hit) {
      effects.tracer(origin, hit.point);
      const tag = hit.object.userData.combat;
      if (tag) {
        const record = {
          kind: tag.owner.kind,
          owner: tag.owner,
          part: tag.part,
          point: hit.point,
          distance: hit.distance,
          damage: weapon.damage * (tag.part === 'head' ? weapon.headMult : 1),
        };
        effects.impact(hit.point, tag.part === 'head' ? 'head' : 'body');
        onHit(record, attacker);
        return record;
      }
      effects.impact(hit.point, 'world');
      return { kind: 'world', point: hit.point, distance: hit.distance };
    }
    effects.tracer(origin, end);
    return null;
  }

  // Does a clear line run from a to b? Used for bot vision and explosion falloff.
  function hasLineOfSight(a, b) {
    dir.copy(b).sub(a);
    const distance = dir.length();
    if (distance < 0.01) return true;
    dir.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(a, dir);
    raycaster.far = distance - 0.05;
    const hits = raycaster.intersectObjects(world.shootables, false);
    if (hits.length) return false;
    return !effects.smokeHit(a, b);
  }

  return { registerTarget, unregisterTarget, fire, hasLineOfSight };
}
