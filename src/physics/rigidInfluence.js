import { Vec2 } from "planck";
import { EMPTY, LOOSE, PACKED } from "../sim/cellTypes.js";

const ROLLER_MIN_LINEAR_SPEED = 0.08;
const ROLLER_WINDOW_HALF_WIDTH = 3;
const ROLLER_WINDOW_HALF_HEIGHT = 3;
const ROLLER_MAX_MOVES_PER_STEP = 8;
const ROLLER_PRESSURE_WEIGHT = 1;
const ROLLER_GRAVITY_WEIGHT = 1;
const ROLLER_OUTWARD_WEIGHT = 0.25;
const ROLLER_OUTWARD_EPSILON = 0.001;
const ROLLER_ANTI_FLOW_TOLERANCE = 0.02;

export function createRigidInfluence({ state, grid, cellsPerWorldUnit = 1, applyTerrainEffects = () => {} }) {
  const {
    index,
    inBounds,
    setCell,
    clearCell,
    isEmptyForDirt,
  } = grid;
  const bodyGroups = new Map();
  let rigidVelocityMass = new Float32Array(0);
  let rigidTouchedFlags = new Uint8Array(0);
  const rigidTouchedCells = [];

  function clearBodyGroups() {
    bodyGroups.clear();
  }

  function logRollerTerrainDebug(bodies = []) {
    const rollerBodies = bodies.filter((body) => getBodyTerrainFlattenConfig(body));
    if (!rollerBodies.length) {
      console.log("[roller-debug] no roller terrain bodies found");
      return;
    }

    for (const body of rollerBodies) {
      const config = getBodyTerrainFlattenConfig(body);
      const contact = findRollerTerrainContact(body);
      const userData = body.getUserData?.();
      if (!contact) {
        console.log("[roller-debug] no packed terrain contact", {
          kind: userData?.kind,
          subtype: userData?.subtype,
          angularVelocity: body.getAngularVelocity?.(),
          linearVelocity: body.getLinearVelocity?.(),
        });
        continue;
      }

      const bounds = rollerSettleBounds(contact.point, config.depth);
      const velocity = body.getLinearVelocity?.() ?? Vec2(0, 0);
      const angularVelocity = body.getAngularVelocity?.() ?? 0;
      const active = isRollerSettleActive(body, config);
      const flow = rollerSettleFlow(contact, body, config);
      const decision = describeRollerSettleDecision(contact, bounds, flow);
      const rows = [];
      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        let row = "";
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
          row += state.cells[index(x, y)] === PACKED ? "1" : "0";
        }
        rows.push(row);
      }

      console.log([
        "[roller-debug] packed terrain contact window",
        `body=${userData?.kind ?? "unknown"}:${userData?.subtype ?? userData?.part ?? "unknown"}`,
        `contactCell=(${contact.point.x.toFixed(2)}, ${contact.point.y.toFixed(2)})`,
        `normal=(${contact.normal.x.toFixed(2)}, ${contact.normal.y.toFixed(2)})`,
        `separation=${contact.separation.toFixed(4)}`,
        `velocity=(${velocity.x.toFixed(3)}, ${velocity.y.toFixed(3)}), angularVelocity=${angularVelocity.toFixed(3)}`,
        `active=${active} (requires |vx| >= ${ROLLER_MIN_LINEAR_SPEED}, |angularVelocity| >= ${config.angularSpeed})`,
        `flow=(${flow.x.toFixed(2)}, ${flow.y.toFixed(2)}), velocityWeight=${config.velocityWeight}`,
        `bounds=x:${bounds.minX}-${bounds.maxX}, y:${bounds.minY}-${bounds.maxY}`,
        `candidate=${decision.candidate}`,
        `target=${decision.target}`,
        "legend: 0 empty/non-packed, 1 packed",
        ...rows,
      ].join("\n"));
    }
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
    if (rigidVelocityMass.length !== total) {
      rigidVelocityMass = new Float32Array(total);
      rigidTouchedFlags = new Uint8Array(total);
      rigidTouchedCells.length = 0;
    }

    clearTouchedRigidCells();

    for (const group of bodyGroups.values()) {
      if (!group.affectsTerrain) continue;
      for (const body of group.bodies) {
        rasterizeRigidBody(body, group);
        flattenPackedTerrainForBody(body);
      }
      if (group.distributeLoadToContacts) distributeGroupLoadToContactCells(group);
    }

    applyTerrainEffects(markRigidTouchedCell);
  }

  function clearTouchedRigidCells() {
    for (const i of rigidTouchedCells) {
      state.rigid[i] = 0;
      state.rigidVx[i] = 0;
      state.rigidVy[i] = 0;
      state.rigidMass[i] = 0;
      state.rigidImpactMass[i] = 0;
      state.externalLoad[i] = 0;
      rigidVelocityMass[i] = 0;
      rigidTouchedFlags[i] = 0;
    }
    rigidTouchedCells.length = 0;
  }

  function markRigidTouchedCell(i) {
    if (i < 0 || i >= rigidTouchedFlags.length || rigidTouchedFlags[i]) return;
    rigidTouchedFlags[i] = 1;
    rigidTouchedCells.push(i);
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
      for (const i of cells) {
        markRigidTouchedCell(i);
        state.rigidMass[i] += massPerCell;
      }
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

  function getBodyTerrainFlattenConfig(body) {
    const userData = body.getUserData?.();
    const angularSpeed = userData?.terrainFlattenAngularSpeed ?? 0;
    const depth = userData?.terrainFlattenDepth ?? 0;
    if (angularSpeed <= 0 || depth <= 0) return null;
    return {
      angularSpeed,
      depth: Math.max(1, Math.trunc(depth * cellsPerWorldUnit)),
      active: userData?.terrainFlattenActive === true,
      velocityWeight: Math.max(0, userData?.terrainFlattenVelocityWeight ?? 0),
    };
  }

  function flattenPackedTerrainForBody(body) {
    const config = getBodyTerrainFlattenConfig(body);
    if (!config) return;
    if (!isRollerSettleActive(body, config)) return;

    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      const shape = fixture.getShape();
      if (shape.m_radius == null) continue;
      applyRollerSettleTerrain(body, shape, config);
    }
  }

  function isRollerSettleActive(body, config) {
    if (!config.active) return false;
    const velocity = body.getLinearVelocity?.() ?? Vec2(0, 0);
    if (Math.abs(velocity.x) < ROLLER_MIN_LINEAR_SPEED) return false;
    return Math.abs(body.getAngularVelocity?.() ?? 0) >= config.angularSpeed;
  }

  function applyRollerSettleTerrain(body, shape, config) {
    const contact = findRollerTerrainContact(body);
    if (!contact) return;

    const bounds = rollerSettleBounds(contact.point, config.depth);
    const flow = rollerSettleFlow(contact, body, config);

    let moved = 0;
    while (moved < ROLLER_MAX_MOVES_PER_STEP && moveBestRollerSettleCell(bounds, contact.point, flow)) moved++;
  }

  function rollerSettleFlow(contact, body, config) {
    const pressure = normalize({
      x: -contact.normal.x,
      y: -contact.normal.y,
    });
    const velocity = body.getLinearVelocity?.() ?? Vec2(0, 0);
    const travel = normalize({ x: velocity.x, y: 0 });
    return normalize({
      x: pressure.x * ROLLER_PRESSURE_WEIGHT + travel.x * config.velocityWeight,
      y: pressure.y * ROLLER_PRESSURE_WEIGHT + ROLLER_GRAVITY_WEIGHT,
    });
  }

  function moveBestRollerSettleCell(bounds, contact, flow) {
    const candidates = collectRollerSettleCandidates(bounds, contact, flow);
    candidates.sort((a, b) => b.score - a.score);

    for (const cell of candidates) {
      const target = findRollerSettleTarget(cell, contact, flow);
      if (target < 0) continue;
      moveDirtCell(cell.i, target);
      state.vx[target] = Math.sign(target % state.width - cell.x);
      state.vy[target] = Math.sign(Math.floor(target / state.width) - cell.y);
      return true;
    }

    return false;
  }

  function describeRollerSettleDecision(contact, bounds, flow) {
    const candidates = collectRollerSettleCandidates(bounds, contact.point, flow);
    candidates.sort((a, b) => b.score - a.score);

    for (const cell of candidates) {
      const target = findRollerSettleTarget(cell, contact.point, flow);
      if (target < 0) continue;
      const tx = target % state.width;
      const ty = Math.floor(target / state.width);
      return {
        candidate: `(${cell.x}, ${cell.y}) score=${cell.score.toFixed(3)}`,
        target: `(${tx}, ${ty})`,
      };
    }

    return {
      candidate: candidates.length ? `none movable among ${candidates.length} candidates` : "none",
      target: "none",
    };
  }

  function findRollerTerrainContact(body) {
    let best = null;

    for (let edge = body.getContactList?.(); edge; edge = edge.next) {
      const contact = edge.contact;
      if (!contact?.isTouching?.()) continue;
      const fixtureA = contact.getFixtureA?.();
      const fixtureB = contact.getFixtureB?.();
      const bodyA = fixtureA?.getBody?.();
      const bodyB = fixtureB?.getBody?.();
      const rollerIsA = bodyA === body;
      const rollerIsB = bodyB === body;
      if (!rollerIsA && !rollerIsB) continue;

      const otherFixture = rollerIsA ? fixtureB : fixtureA;
      if (!isTerrainFixture(otherFixture)) continue;

      const manifold = contact.getWorldManifold?.(null);
      if (!manifold?.pointCount) continue;

      const normalSign = rollerIsA ? -1 : 1;
      const normal = normalize({
        x: manifold.normal.x * normalSign,
        y: manifold.normal.y * normalSign,
      });

      for (let i = 0; i < manifold.pointCount; i++) {
        const point = worldToCellPoint(manifold.points[i]);
        const separation = manifold.separations?.[i] ?? 0;
        if (best && separation >= best.separation) continue;
        best = {
          point,
          normal,
          separation,
        };
      }
    }

    return best;
  }

  function isTerrainFixture(fixture) {
    const fixtureData = fixture?.getUserData?.();
    const bodyData = fixture?.getBody?.()?.getUserData?.();
    return fixtureData?.kind === "packed-terrain" || bodyData?.kind === "packed-terrain";
  }

  function rollerSettleBounds(contact, depth) {
    return {
      minX: Math.max(0, Math.floor(contact.x) - ROLLER_WINDOW_HALF_WIDTH),
      maxX: Math.min(state.width - 1, Math.floor(contact.x) + ROLLER_WINDOW_HALF_WIDTH),
      minY: Math.max(0, Math.floor(contact.y) - ROLLER_WINDOW_HALF_HEIGHT),
      maxY: Math.min(state.height - 1, Math.floor(contact.y) + ROLLER_WINDOW_HALF_HEIGHT),
    };
  }

  function collectRollerSettleCandidates(bounds, contact, flow) {
    const candidates = [];
    const reverseFlow = { x: -flow.x, y: -flow.y };

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const i = index(x, y);
        if (!isRollerMovableDirt(i)) continue;
        const rel = {
          x: x + 0.5 - contact.x,
          y: y + 0.5 - contact.y,
        };
        candidates.push({
          i,
          x,
          y,
          score: dot(rel, reverseFlow) * 2 + length(rel) * 0.25,
        });
      }
    }

    return candidates;
  }

  function findRollerSettleTarget(cell, contact, flow) {
    let best = -1;
    let bestScore = -Infinity;
    const fromRel = {
      x: cell.x + 0.5 - contact.x,
      y: cell.y + 0.5 - contact.y,
    };
    const fromDistance = length(fromRel);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        if (!inBounds(nx, ny)) continue;
        const target = index(nx, ny);
        if (state.cells[target] !== EMPTY) continue;

        const move = normalize({ x: dx, y: dy });
        const toRel = {
          x: nx + 0.5 - contact.x,
          y: ny + 0.5 - contact.y,
        };
        const outwardGain = length(toRel) - fromDistance;
        const flowScore = dot(move, flow);
        if (outwardGain <= ROLLER_OUTWARD_EPSILON) continue;
        if (flowScore < -ROLLER_ANTI_FLOW_TOLERANCE) continue;

        const score = flowScore + outwardGain * ROLLER_OUTWARD_WEIGHT;
        if (score > bestScore) {
          bestScore = score;
          best = target;
        }
      }
    }

    return best;
  }

  function isRollerMovableDirt(i) {
    return state.cells[i] === PACKED || state.cells[i] === LOOSE;
  }

  function moveDirtCell(from, to) {
    const kind = state.cells[from];
    const ages = state.ages[from];
    const looseContactAges = state.looseContactAges[from];
    const damage = state.damage[from];
    const stress = state.stress[from];
    const visualStress = state.visualStress[from];
    const stressVisibility = state.stressVisibility[from];
    const visualX = state.visualX[from];
    const visualY = state.visualY[from];
    const vx = state.vx[from];
    const vy = state.vy[from];

    setCell(to, kind);
    state.ages[to] = ages;
    state.looseContactAges[to] = looseContactAges;
    state.damage[to] = damage;
    state.stress[to] = stress;
    state.visualStress[to] = visualStress;
    state.stressVisibility[to] = stressVisibility;
    state.visualX[to] = visualX;
    state.visualY[to] = visualY;
    state.vx[to] = vx;
    state.vy[to] = vy;
    clearCell(from, false);
    state.touched[to] = state.tick;
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
    const vertices = localVertices.map((vertex) => worldToCellPoint(body.getWorldPoint(vertex)));
    const bounds = polygonBounds(vertices, 1);

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        if (!isPointInPolygon(x + 0.5, y + 0.5, vertices)) continue;
        addPackedContactCell(cells, x, y);
      }
    }
  }

  function collectPackedContactCellsForCircle(cells, body, shape) {
    const center = worldToCellPoint(shape.m_p ? body.getWorldPoint(shape.m_p) : body.getPosition());
    const radius = shape.m_radius * cellsPerWorldUnit;
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

    const vertices = localVertices.map((vertex) => worldToCellPoint(body.getWorldPoint(vertex)));
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
    const center = worldToCellPoint(shape.m_p ? body.getWorldPoint(shape.m_p) : body.getPosition());
    const radius = shape.m_radius * cellsPerWorldUnit;

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

  function dot(a, b) {
    return a.x * b.x + a.y * b.y;
  }

  function length(v) {
    return Math.hypot(v.x, v.y);
  }

  function normalize(v) {
    const value = length(v);
    if (value === 0) return { x: 0, y: 0 };
    return {
      x: v.x / value,
      y: v.y / value,
    };
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
    markRigidTouchedCell(i);
    const velocity = body.getLinearVelocityFromWorldPoint(cellToWorldPoint(x + 0.5, y + 0.5));
    const previousVelocityMass = rigidVelocityMass[i];
    const nextVelocityMass = previousVelocityMass + cellMass;

    state.rigid[i] = 1;
    state.rigidVx[i] = (state.rigidVx[i] * previousVelocityMass + velocity.x * cellsPerWorldUnit * cellMass) / nextVelocityMass;
    state.rigidVy[i] = (state.rigidVy[i] * previousVelocityMass + velocity.y * cellsPerWorldUnit * cellMass) / nextVelocityMass;
    state.rigidMass[i] += terrainCellMass;
    state.rigidImpactMass[i] += impactCellMass;
    rigidVelocityMass[i] = nextVelocityMass;
  }

  function worldToCellPoint(point) {
    return {
      x: point.x * cellsPerWorldUnit,
      y: point.y * cellsPerWorldUnit,
    };
  }

  function cellToWorldPoint(x, y) {
    return Vec2(x / cellsPerWorldUnit, y / cellsPerWorldUnit);
  }

  return {
    clearBodyGroups,
    registerBodyGroup,
    update,
    logRollerTerrainDebug,
  };
}
