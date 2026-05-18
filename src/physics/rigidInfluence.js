import { Vec2 } from "planck";

export function createRigidInfluence({ state, grid, applyTerrainEffects = () => {} }) {
  const { index } = grid;
  const bodyGroups = new Map();

  function clearBodyGroups() {
    bodyGroups.clear();
  }

  function registerBodyGroup({
    id,
    kind,
    bodies,
    dynamic = true,
    massScale = 1,
    damageScale = 1,
    affectsTerrain = true,
  }) {
    if (!id || !bodies?.length) return;
    bodyGroups.set(id, {
      id,
      kind,
      bodies,
      dynamic,
      massScale,
      damageScale,
      affectsTerrain,
    });
  }

  function update() {
    state.rigid.fill(0);
    state.rigidVx.fill(0);
    state.rigidVy.fill(0);
    state.rigidMass.fill(0);
    state.externalLoad.fill(0);

    for (const group of bodyGroups.values()) {
      if (!group.affectsTerrain) continue;
      for (const body of group.bodies) {
        rasterizeRigidBody(body, group);
      }
    }

    applyTerrainEffects();
  }

  function rasterizeRigidBody(body, group) {
    if (!body) return;

    const fixtures = [];
    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      fixtures.push(fixture);
    }
    if (!fixtures.length) return;

    const massShare = (Math.max(0.01, body.getMass()) * group.massScale) / fixtures.length;
    for (const fixture of fixtures) {
      const shape = fixture.getShape();
      if (shape.m_vertices) {
        rasterizeRigidPolygon(body, shape.m_vertices, massShare, group.damageScale);
      } else if (shape.m_radius != null) {
        rasterizeRigidCircleShape(body, shape, massShare, group.damageScale);
      }
    }
  }

  function rasterizeRigidPolygon(body, localVertices, massShare, damageScale) {
    if (!localVertices?.length) return;

    const vertices = localVertices.map((vertex) => body.getWorldPoint(vertex));
    const bounds = polygonBounds(vertices, 1);
    const area = Math.max(1, polygonArea(vertices));
    const cellMass = (massShare / area) * damageScale;

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        if (!isPointInPolygon(x + 0.5, y + 0.5, vertices)) continue;
        markRigidCell(x, y, body, cellMass);
      }
    }
  }

  function rasterizeRigidCircleShape(body, shape, massShare, damageScale) {
    const center = shape.m_p ? body.getWorldPoint(shape.m_p) : body.getPosition();
    const radius = shape.m_radius;

    const minX = Math.max(0, Math.floor(center.x - radius - 1));
    const maxX = Math.min(state.width - 1, Math.ceil(center.x + radius + 1));
    const minY = Math.max(0, Math.floor(center.y - radius - 1));
    const maxY = Math.min(state.height - 1, Math.ceil(center.y + radius + 1));
    const radiusSq = radius * radius;
    const area = Math.max(1, Math.PI * radiusSq);
    const cellMass = (massShare / area) * damageScale;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - center.x;
        const dy = y + 0.5 - center.y;
        if (dx * dx + dy * dy > radiusSq) continue;
        markRigidCell(x, y, body, cellMass);
      }
    }
  }

  function polygonBounds(vertices, padding = 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const vertex of vertices) {
      minX = Math.min(minX, vertex.x);
      maxX = Math.max(maxX, vertex.x);
      minY = Math.min(minY, vertex.y);
      maxY = Math.max(maxY, vertex.y);
    }

    return {
      minX: Math.max(0, Math.floor(minX - padding)),
      maxX: Math.min(state.width - 1, Math.ceil(maxX + padding)),
      minY: Math.max(0, Math.floor(minY - padding)),
      maxY: Math.min(state.height - 1, Math.ceil(maxY + padding)),
    };
  }

  function polygonArea(vertices) {
    let sum = 0;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) * 0.5;
  }

  function isPointInPolygon(x, y, vertices) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const a = vertices[i];
      const b = vertices[j];
      const crosses = (a.y > y) !== (b.y > y);
      if (!crosses) continue;
      const edgeX = ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
      if (x < edgeX) inside = !inside;
    }
    return inside;
  }

  function markRigidCell(x, y, body, cellMass) {
    const i = index(x, y);
    const velocity = body.getLinearVelocityFromWorldPoint(Vec2(x + 0.5, y + 0.5));
    const previousMass = state.rigidMass[i];
    const nextMass = previousMass + cellMass;

    state.rigid[i] = 1;
    state.rigidVx[i] = (state.rigidVx[i] * previousMass + velocity.x * cellMass) / nextMass;
    state.rigidVy[i] = (state.rigidVy[i] * previousMass + velocity.y * cellMass) / nextMass;
    state.rigidMass[i] = nextMass;
  }

  return {
    clearBodyGroups,
    registerBodyGroup,
    update,
  };
}
