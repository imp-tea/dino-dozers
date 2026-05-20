import { Chain, Vec2 } from "planck";

export function createPhysicsTerrain({ world, contours, cellsPerWorldUnit = 1 }) {
  let dirty = true;
  let terrainBody = null;
  const cellToWorldScale = 1 / cellsPerWorldUnit;

  function markDirty() {
    dirty = true;
  }

  function rebuildIfDirty() {
    if (!dirty) return;

    if (terrainBody) world.destroyBody(terrainBody);
    terrainBody = world.createBody();
    terrainBody.setUserData({ kind: "packed-terrain" });

    for (const contour of contours.getContours()) {
      if (contour.length < 3) continue;

      const vertices = contour.map((point) => Vec2(point.x * cellToWorldScale, point.y * cellToWorldScale));
      const fixture = terrainBody.createFixture({
        shape: Chain(vertices, true),
        friction: 1.8,
        restitution: 0,
      });
      fixture.setUserData({ kind: "packed-terrain" });
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
