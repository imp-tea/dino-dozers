import { Vec2 } from "planck";
import { EMPTY, LOOSE, PACKED } from "../sim/cellTypes.js";

const ROLLER_MIN_LINEAR_SPEED = 0.08;
const ROLLER_WINDOW_HALF_WIDTH = 10;
const ROLLER_WINDOW_HALF_HEIGHT = 3;
const ROLLER_MAX_START_HORIZONTAL_DISTANCE = 3;
const ROLLER_MAX_MOVES_PER_STEP = 3;
const ROLLER_CHAIN_MAX_PATH_LENGTH = 16;
const ROLLER_CHAIN_RESISTANCE = 0.16;
const ROLLER_PRESSURE_WEIGHT = 1;
const ROLLER_GRAVITY_WEIGHT = 1;
const ROLLER_OUTWARD_WEIGHT = 0.25;
const ROLLER_OUTWARD_EPSILON = 0.001;
const ROLLER_ANTI_FLOW_TOLERANCE = 0.02;
const ROLLER_JAGGED_SURFACE_EMPTY_NEIGHBORS = 3;
const ROLLER_JAGGED_SURFACE_FILLED_NEIGHBORS = 3;
const ROLLER_JAGGED_SURFACE_PENALTY = 5;
const ROLLER_ORPHAN_SCAN_HEIGHT = 16;
const ROLLER_ORPHAN_SCAN_HORIZONTAL_HALO = 1;
const CARDINAL_OFFSETS = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

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
      if (target >= 0) {
        const touchedCells = [cell.i, target];
        const moved = moveDirtCell(cell.i, target);
        state.vx[moved] = Math.sign(moved % state.width - cell.x);
        state.vy[moved] = Math.sign(Math.floor(moved / state.width) - cell.y);
        cleanupRollerOrphanedPackedCells(touchedCells);
        return true;
      }

      const chain = findRollerSettleChainPath(cell, contact, flow);
      if (!chain) continue;
      shiftRollerSettleChain(chain);
      return true;
    }

    return false;
  }

  function describeRollerSettleDecision(contact, bounds, flow) {
    const candidates = collectRollerSettleCandidates(bounds, contact.point, flow);
    candidates.sort((a, b) => b.score - a.score);

    for (const cell of candidates) {
      const target = findRollerSettleTarget(cell, contact.point, flow);
      if (target >= 0) {
        const tx = target % state.width;
        const ty = Math.floor(target / state.width);
        return {
          candidate: `(${cell.x}, ${cell.y}) score=${cell.score.toFixed(3)}`,
          target: `(${tx}, ${ty})`,
        };
      }

      const chain = findRollerSettleChainPath(cell, contact.point, flow);
      if (chain) {
        const destination = chain[chain.length - 1];
        const tx = destination % state.width;
        const ty = Math.floor(destination / state.width);
        return {
          candidate: `(${cell.x}, ${cell.y}) score=${cell.score.toFixed(3)}`,
          target: `chain length=${chain.length - 1} to (${tx}, ${ty})`,
        };
      }
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
        if (best && point.y >= best.point.y) continue;
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
        if (Math.abs(rel.x) > ROLLER_MAX_START_HORIZONTAL_DISTANCE) continue;
        candidates.push({
          i,
          x,
          y,
          score: dot(rel, reverseFlow) * 2 - length(rel) * 0.25,
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

        const score =
          flowScore +
          outwardGain * ROLLER_OUTWARD_WEIGHT -
          rollerJaggedSurfacePenaltyForPath([cell.i, target]);
        if (score > bestScore) {
          bestScore = score;
          best = target;
        }
      }
    }

    return best;
  }

  function findRollerSettleChainPath(cell, contact, flow) {
    let bestPath = null;
    let bestScore = -Infinity;
    const startRel = {
      x: cell.x + 0.5 - contact.x,
      y: cell.y + 0.5 - contact.y,
    };
    const startDistance = length(startRel);
    const bestScores = new Map([[cell.i, 0]]);
    const search = [{
      i: cell.i,
      x: cell.x,
      y: cell.y,
      distance: startDistance,
      score: 0,
      path: [cell.i],
    }];

    while (search.length) {
      const node = search.pop();
      const depth = node.path.length - 1;
      if (depth >= ROLLER_CHAIN_MAX_PATH_LENGTH) continue;

      for (const next of collectRollerSettleMoves(node, contact, flow, startDistance)) {
        if (node.path.includes(next.i)) continue;
        const nextDepth = depth + 1;
        const resistance = nextDepth > 1 ? ROLLER_CHAIN_RESISTANCE : 0;
        const score = node.score + next.score - resistance;
        const path = [...node.path, next.i];

        if (state.cells[next.i] === EMPTY) {
          if (nextDepth < 2) continue;
          const finalScore = score - rollerJaggedSurfacePenaltyForPath(path);
          if (finalScore > bestScore) {
            bestScore = finalScore;
            bestPath = path;
          }
          continue;
        }

        if (!isRollerMovableDirt(next.i)) continue;
        const previousScore = bestScores.get(next.i);
        if (previousScore != null && previousScore >= score) continue;
        bestScores.set(next.i, score);
        search.push({
          i: next.i,
          x: next.x,
          y: next.y,
          distance: next.distance,
          score,
          path,
        });
      }
    }

    return bestPath;
  }

  function collectRollerSettleMoves(node, contact, flow, startDistance) {
    const moves = [];

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = node.x + dx;
        const ny = node.y + dy;
        if (!inBounds(nx, ny)) continue;

        const move = normalize({ x: dx, y: dy });
        const toRel = {
          x: nx + 0.5 - contact.x,
          y: ny + 0.5 - contact.y,
        };
        const distance = length(toRel);
        const outwardGain = distance - node.distance;
        const totalOutwardGain = distance - startDistance;
        const flowScore = dot(move, flow);
        if (outwardGain <= ROLLER_OUTWARD_EPSILON) continue;
        if (totalOutwardGain <= ROLLER_OUTWARD_EPSILON) continue;
        if (flowScore < -ROLLER_ANTI_FLOW_TOLERANCE) continue;

        moves.push({
          i: index(nx, ny),
          x: nx,
          y: ny,
          distance,
          score: flowScore + outwardGain * ROLLER_OUTWARD_WEIGHT,
        });
      }
    }

    moves.sort((a, b) => b.score - a.score);
    return moves;
  }

  function rollerJaggedSurfacePenaltyForPath(path) {
    const finalKinds = rollerFinalKindsForPath(path);
    const checkCells = collectRollerJaggedCheckCells(path);
    let jaggedCount = 0;

    for (const i of checkCells) {
      const kind = getRollerFinalKind(i, finalKinds);
      if (kind === PACKED && countEmptyCardinalNeighbors(i, finalKinds) === ROLLER_JAGGED_SURFACE_EMPTY_NEIGHBORS) {
        jaggedCount++;
      } else if (kind === EMPTY && countFilledCardinalNeighbors(i, finalKinds) === ROLLER_JAGGED_SURFACE_FILLED_NEIGHBORS) {
        jaggedCount++;
      }
    }

    return jaggedCount * ROLLER_JAGGED_SURFACE_PENALTY;
  }

  function rollerFinalKindsForPath(path) {
    const finalKinds = new Map([[path[0], EMPTY]]);
    for (let p = 1; p < path.length; p++) {
      finalKinds.set(path[p], state.cells[path[p - 1]]);
    }
    return finalKinds;
  }

  function collectRollerJaggedCheckCells(path) {
    const seen = new Set();
    const cells = [];

    for (const i of path) {
      addRollerJaggedCheckCell(i, seen, cells);
      const x = i % state.width;
      const y = Math.floor(i / state.width);
      for (const [dx, dy] of CARDINAL_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        addRollerJaggedCheckCell(index(nx, ny), seen, cells);
      }
    }

    return cells;
  }

  function addRollerJaggedCheckCell(i, seen, cells) {
    if (seen.has(i)) return;
    seen.add(i);
    cells.push(i);
  }

  function countEmptyCardinalNeighbors(i, finalKinds) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    let emptyNeighbors = 0;

    for (const [dx, dy] of CARDINAL_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (getRollerFinalKind(index(nx, ny), finalKinds) === EMPTY) emptyNeighbors++;
    }

    return emptyNeighbors;
  }

  function countFilledCardinalNeighbors(i, finalKinds) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    let filledNeighbors = 0;

    for (const [dx, dy] of CARDINAL_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (getRollerFinalKind(index(nx, ny), finalKinds) !== EMPTY) filledNeighbors++;
    }

    return filledNeighbors;
  }

  function getRollerFinalKind(i, finalKinds) {
    return finalKinds.get(i) ?? state.cells[i];
  }

  function shiftRollerSettleChain(path) {
    const touchedCells = [...path];

    for (let p = path.length - 2; p >= 0; p--) {
      const from = path[p];
      const to = path[p + 1];
      const fromX = from % state.width;
      const fromY = Math.floor(from / state.width);
      const moved = moveDirtCell(from, to);
      state.vx[moved] = Math.sign(moved % state.width - fromX);
      state.vy[moved] = Math.sign(Math.floor(moved / state.width) - fromY);
    }

    cleanupRollerOrphanedPackedCells(touchedCells);
  }

  function isRollerMovableDirt(i) {
    return state.cells[i] === PACKED || state.cells[i] === LOOSE;
  }

  function cleanupRollerOrphanedPackedCells(touchedCells) {
    const candidates = collectRollerOrphanCheckCells(touchedCells);

    for (const i of candidates) {
      if (state.cells[i] !== PACKED) continue;
      if (hasCardinalDirtNeighbor(i)) continue;
      setCell(i, LOOSE);
      state.vx[i] = 0;
      state.vy[i] = 1;
      state.touched[i] = state.tick;
    }
  }

  function collectRollerOrphanCheckCells(touchedCells) {
    const seen = new Set();
    const cells = [];

    for (const touched of touchedCells) {
      const x = touched % state.width;
      const y = Math.floor(touched / state.width);
      const minX = Math.max(0, x - ROLLER_ORPHAN_SCAN_HORIZONTAL_HALO);
      const maxX = Math.min(state.width - 1, x + ROLLER_ORPHAN_SCAN_HORIZONTAL_HALO);
      const minY = Math.max(0, y - ROLLER_ORPHAN_SCAN_HEIGHT);
      const maxY = Math.min(state.height - 1, y + ROLLER_ORPHAN_SCAN_HEIGHT);

      for (let yy = maxY; yy >= minY; yy--) {
        for (let xx = minX; xx <= maxX; xx++) {
          const i = index(xx, yy);
          if (seen.has(i)) continue;
          seen.add(i);
          cells.push(i);
        }
      }
    }

    return cells;
  }

  function hasCardinalDirtNeighbor(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);

    for (const [dx, dy] of CARDINAL_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (state.cells[index(nx, ny)] !== EMPTY) return true;
    }

    return false;
  }

  function moveDirtCell(from, to) {
    const kind = state.cells[from];
    const ages = state.ages[from];
    const looseContactAges = kind === LOOSE ? state.looseContactAges[from] : 0;
    const looseSettleLock = kind === LOOSE ? state.looseSettleLocks[from] : 0;
    const damage = kind === PACKED ? state.damage[from] : 0;
    const stress = kind === PACKED ? state.stress[from] : 0;
    const visualStress = kind === PACKED ? state.visualStress[from] : 0;
    const stressVisibility = kind === PACKED ? state.stressVisibility[from] : 0;
    const visualX = state.visualX[from];
    const visualY = state.visualY[from];
    const vx = state.vx[from];
    const vy = state.vy[from];

    setCell(to, kind);
    state.ages[to] = ages;
    state.looseContactAges[to] = looseContactAges;
    state.looseSettleLocks[to] = looseSettleLock;
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
    return to;
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
