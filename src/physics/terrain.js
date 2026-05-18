import { Chain, Vec2 } from "planck";

export function createPhysicsTerrain({ world, contours }) {
  let dirty = true;
  let terrainBody = null;

  function markDirty() {
    dirty = true;
  }

  function rebuildIfDirty() {
    if (!dirty) return;

    if (terrainBody) world.destroyBody(terrainBody);
    terrainBody = world.createBody();

    for (const contour of contours.getContours()) {
      if (contour.length < 3) continue;

      const vertices = contour.map((point) => Vec2(point.x, point.y));
      terrainBody.createFixture({
        shape: Chain(vertices, true),
        friction: 1.4,
        restitution: 0,
      });
    }

    dirty = false;
  }

  function destroy() {
    if (!terrainBody) return;
    world.destroyBody(terrainBody);
    terrainBody = null;
    dirty = true;
  }

  return {
    markDirty,
    rebuildIfDirty,
    destroy,
  };
}
