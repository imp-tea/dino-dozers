import { Vec2 } from "planck";
import { PACKED } from "../sim/cellTypes.js";

export function createRigidInfluence({ state, grid, applyTerrainEffects = () => {} }) {
  const { index } = grid;
  const bodyGroups = new Map();
  let rigidVelocityMass = new Float32Array(0);

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
    distributeLoadToContacts = false,
    contactPart = null,
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
      distributeLoadToContacts,
      contactPart,
    });
  }

  function update() {
    const total = state.width * state.height;
    if (rigidVelocityMass.length !== total) rigidVelocityMass = new Float32Array(total);

    state.rigid.fill(0);
    state.rigidVx.fill(0);
    state.rigidVy.fill(0);
    state.rigidMass.fill(0);
    state.rigidImpactMass.fill(0);
    state.externalLoad.fill(0);
    rigidVelocityMass.fill(0);

    for (const group of bodyGroups.values()) {
      if (!group.affectsTerrain) continue;
      for (const body of group.bodies) {
        rasterizeRigidBody(body, group);
      }
      if (group.distributeLoadToContacts) distributeGroupLoadToContactCells(group);
    }

    applyTerrainEffects();
  }

  function distributeGroupLoadToContactCells(group) {
    const totalMass = group.bodies.reduce((sum, body) => sum + Math.max(0, body?.getMass?.() ?? 0), 0);
    if (totalMass <= 0) return;

    const contactCellsByBody = group.bodies
      .filter((body) => {
        const userData = body?.getUserData?.();
        return body && (!group.contactPart || userData?.part === group.contactPart);
      })
      .map((body) => ({
        body,
        cells: findPackedContactCells(body),
      }))
      .filter((entry) => entry.cells.length > 0);

    if (!contactCellsByBody.length) return;

    const massPerBody = (totalMass * group.massScale) / contactCellsByBody.length;
    for (const { body, cells } of contactCellsByBody) {
      const contactLoadScale = getBodyTerrainContactLoadScale(body);
      const massPerCell = (massPerBody * contactLoadScale) / cells.length;
      for (const i of cells) state.rigidMass[i] += massPerCell;
    }
  }

  function rasterizeRigidBody(body, group) {
    if (!body) return;

    const fixtures = [];
    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      fixtures.push(fixture);
    }
    if (!fixtures.length) return;

    const bodyTerrainLoadScale = getBodyTerrainLoadScale(body);
    const bodyTerrainImpactScale = getBodyTerrainImpactScale(body);
    const massShare = (Math.max(0.01, body.getMass()) * group.massScale) / fixtures.length;
    const terrainMassShare = massShare * bodyTerrainLoadScale;
    const impactMassShare = massShare * group.damageScale * bodyTerrainImpactScale;
    for (const fixture of fixtures) {
      const shape = fixture.getShape();
      if (shape.m_vertices) {
        rasterizeRigidPolygon(body, shape.m_vertices, massShare, terrainMassShare, impactMassShare);
      } else if (shape.m_radius != null) {
        rasterizeRigidCircleShape(body, shape, massShare, terrainMassShare, impactMassShare);
      }
    }
  }

  function getBodyTerrainLoadScale(body) {
    const userData = body.getUserData?.();
    return userData?.terrainLoadScale ?? 1;
  }

  function getBodyTerrainContactLoadScale(body) {
    const userData = body.getUserData?.();
    return userData?.terrainContactLoadScale ?? getBodyTerrainLoadScale(body);
  }

  function getBodyTerrainImpactScale(body) {
    const userData = body.getUserData?.();
    return userData?.terrainDamageScale ?? 1;
  }

  function findPackedContactCells(body) {
    const cells = new Set();
    if (!body) return [];

    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      const shape = fixture.getShape();
      if (shape.m_vertices) {
        collectPackedContactCellsForPolygon(cells, body, shape.m_vertices);
      } else if (shape.m_radius != null) {
        collectPackedContactCellsForCircle(cells, body, shape);
      }
    }

    return Array.from(cells);
  }

  function collectPackedContactCellsForPolygon(cells, body, localVertices) {
    if (!localVertices?.length) return;
    const vertices = localVertices.map((vertex) => body.getWorldPoint(vertex));
    const bounds = polygonBounds(vertices, 1);

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        if (!isPointInPolygon(x + 0.5, y + 0.5, vertices)) continue;
        addPackedContactCell(cells, x, y);
      }
    }
  }

  function collectPackedContactCellsForCircle(cells, body, shape) {
    const center = shape.m_p ? body.getWorldPoint(shape.m_p) : body.getPosition();
    const radius = shape.m_radius;
    const minX = Math.max(0, Math.floor(center.x - radius - 1));
    const maxX = Math.min(state.width - 1, Math.ceil(center.x + radius + 1));
    const minY = Math.max(0, Math.floor(center.y - radius - 1));
    const maxY = Math.min(state.height - 1, Math.ceil(center.y + radius + 1));
    const radiusSq = radius * radius;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - center.x;
        const dy = y + 0.5 - center.y;
        if (dx * dx + dy * dy > radiusSq) continue;
        addPackedContactCell(cells, x, y);
      }
    }
  }

  function addPackedContactCell(cells, x, y) {
    if (y >= state.height - 1) return;
    const below = index(x, y + 1);
    if (state.cells[below] !== PACKED) return;
    cells.add(index(x, y));
  }

  function rasterizeRigidPolygon(body, localVertices, massShare, terrainMassShare, impactMassShare) {
    if (!localVertices?.length) return;

    const vertices = localVertices.map((vertex) => body.getWorldPoint(vertex));
    const bounds = polygonBounds(vertices, 1);
    const area = Math.max(1, polygonArea(vertices));
    const cellMass = massShare / area;
    const terrainCellMass = terrainMassShare / area;
    const impactCellMass = impactMassShare / area;

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        if (!isPointInPolygon(x + 0.5, y + 0.5, vertices)) continue;
        markRigidCell(x, y, body, cellMass, terrainCellMass, impactCellMass);
      }
    }
  }

  function rasterizeRigidCircleShape(body, shape, massShare, terrainMassShare, impactMassShare) {
    const center = shape.m_p ? body.getWorldPoint(shape.m_p) : body.getPosition();
    const radius = shape.m_radius;

    const minX = Math.max(0, Math.floor(center.x - radius - 1));
    const maxX = Math.min(state.width - 1, Math.ceil(center.x + radius + 1));
    const minY = Math.max(0, Math.floor(center.y - radius - 1));
    const maxY = Math.min(state.height - 1, Math.ceil(center.y + radius + 1));
    const radiusSq = radius * radius;
    const area = Math.max(1, Math.PI * radiusSq);
    const cellMass = massShare / area;
    const terrainCellMass = terrainMassShare / area;
    const impactCellMass = impactMassShare / area;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - center.x;
        const dy = y + 0.5 - center.y;
        if (dx * dx + dy * dy > radiusSq) continue;
        markRigidCell(x, y, body, cellMass, terrainCellMass, impactCellMass);
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

  function markRigidCell(x, y, body, cellMass, terrainCellMass, impactCellMass) {
    const i = index(x, y);
    const velocity = body.getLinearVelocityFromWorldPoint(Vec2(x + 0.5, y + 0.5));
    const previousVelocityMass = rigidVelocityMass[i];
    const nextVelocityMass = previousVelocityMass + cellMass;

    state.rigid[i] = 1;
    state.rigidVx[i] = (state.rigidVx[i] * previousVelocityMass + velocity.x * cellMass) / nextVelocityMass;
    state.rigidVy[i] = (state.rigidVy[i] * previousVelocityMass + velocity.y * cellMass) / nextVelocityMass;
    state.rigidMass[i] += terrainCellMass;
    state.rigidImpactMass[i] += impactCellMass;
    rigidVelocityMass[i] = nextVelocityMass;
  }

  return {
    clearBodyGroups,
    registerBodyGroup,
    update,
  };
}
