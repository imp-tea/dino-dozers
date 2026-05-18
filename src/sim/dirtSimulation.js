import { EMPTY, LOOSE, PACKED } from "./cellTypes.js";
import { DEFAULT_MATERIAL_ID, MATERIALS } from "./materials.js";

const MAX_LOOSE_SPEED = 8;
const LOOSE_GRAVITY = 1;
const IMPACT_BREAK_SPEED = 4;
const RIGID_LOAD_SCALE = 0.18;
const RIGID_BREAK_SPEED = 6;
const RIGID_BREAK_DAMAGE = 0.0225;
const RIGID_LOOSE_KICK = 0.45;
const RIGID_FRACTURE_OFFSETS = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const SUPPORT_PARENT_OFFSETS = [
  [0, 1],
  [-1, 0],
  [1, 0],
  [0, -1],
];
const BEARING_NEIGHBOR_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
];
const SUPPORT_RELIEF_OFFSETS = [
  [0, 1, 1.7],
  [-1, 1, 0.65],
  [1, 1, 0.65],
  [-1, 0, 0.35],
  [1, 0, 0.35],
];

const DEFAULT_SETTINGS = {
  cohesion: 80,
  fatigue: 0.8,
  weight: 1,
  bridgePenalty: 0.4,
  settleTicks: 5,
  spread: 0,
  jitter: 0.1,
  materialId: DEFAULT_MATERIAL_ID,
};

export function createDirtSimulation({
  state,
  grid,
  getSettings = () => DEFAULT_SETTINGS,
  updateRigidInfluenceGrid = () => {},
}) {
  const {
    index,
    inBounds,
    setCell,
    clearCell,
    isEmptyForDirt,
    isSolidForDirt,
  } = grid;

  function getSettingsSnapshot() {
    const settings = {
      ...DEFAULT_SETTINGS,
      ...getSettings(),
    };
    return {
      ...settings,
      material: MATERIALS[settings.materialId] ?? MATERIALS[DEFAULT_MATERIAL_ID],
    };
  }

  function simulationStep() {
    const settings = getSettingsSnapshot();
    state.tick++;
    updateRigidInfluenceGrid();
    updateLoose(settings);
    analyzePackedClusters(settings);
  }

  function applyRigidTerrainEffects() {
    const total = state.width * state.height;
    for (let i = 0; i < total; i++) {
      if (!state.rigid[i]) continue;

      const x = i % state.width;
      const y = Math.floor(i / state.width);
      const speed = Math.hypot(state.rigidVx[i], state.rigidVy[i]);
      const load = state.rigidMass[i] * RIGID_LOAD_SCALE;

      if (y < state.height - 1) {
        const below = index(x, y + 1);
        if (state.cells[below] === PACKED) state.externalLoad[below] += load;
      }

      if (state.rigidImpactMass[i] <= 0) continue;
      if (speed < RIGID_BREAK_SPEED) continue;
      const impact = (speed - RIGID_BREAK_SPEED) * RIGID_BREAK_DAMAGE * Math.max(1, state.rigidImpactMass[i]);
      fracturePackedNearRigid(x, y, impact, state.rigidVx[i], state.rigidVy[i]);
    }
  }

  function fracturePackedNearRigid(x, y, impact, vx, vy) {
    for (const [dx, dy] of RIGID_FRACTURE_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const i = index(nx, ny);
      if (state.cells[i] !== PACKED) continue;

      state.damage[i] += impact;
      if (state.damage[i] < 1 && impact < 0.35) continue;

      setCell(i, LOOSE);
      state.vx[i] = clampVelocity(vx * RIGID_LOOSE_KICK);
      state.vy[i] = clampVelocity(Math.max(0, vy * RIGID_LOOSE_KICK));
      state.touched[i] = state.tick;
    }
  }

  function updateLoose(settings) {
    const w = state.width;
    const h = state.height;
    state.rngFlip = !state.rngFlip;

    for (let y = h - 1; y >= 0; y--) {
      const leftToRight = (y + state.tick + (state.rngFlip ? 1 : 0)) % 2 === 0;
      for (let n = 0; n < w; n++) {
        const x = leftToRight ? n : w - 1 - n;
        const i = index(x, y);
        if (state.cells[i] !== LOOSE || state.touched[i] === state.tick) continue;
        updateLooseCell(i, settings);
      }
    }
  }

  function updateLooseCell(start, settings) {
    if (state.cells[start] !== LOOSE) return;
    state.touched[start] = state.tick;
    if (state.rigid[start] && pushLooseOutOfRigid(start) !== start) return;

    const previousX = start % state.width;
    const previousY = Math.floor(start / state.width);
    const hadVerticalVelocity = state.vy[start] !== 0;

    if (previousY === state.height - 1 && state.vy[start] > 0) {
      state.vy[start] = 0;
    } else if (previousY < state.height - 1) {
      state.vy[start] = clampVelocity(state.vy[start] + LOOSE_GRAVITY);
    }

    let current = attemptAxisMove(start, "y", hadVerticalVelocity, settings);
    if (current < 0 || state.cells[current] !== LOOSE) return;

    const movedVertical = current !== start;
    if (!movedVertical && state.vy[current] === 0) {
      const slid = tryRestingSlide(current, settings);
      if (slid >= 0 && slid !== current) current = slid;
      if (slid < 0) return;

      if (current >= 0 && state.cells[current] === LOOSE) {
        const slumped = tryColumnSlump(current, settings);
        if (slumped !== current) current = slumped;
      }

      if (
        current >= 0 &&
        state.cells[current] === LOOSE &&
        !isNeedleTop(current) &&
        canLooseCellPack(current) &&
        shouldPackAgainstStableColumn(current)
      ) {
        setCell(current, PACKED);
        return;
      }
    }

    if (current >= 0 && state.cells[current] === LOOSE && state.vx[current] !== 0) {
      current = attemptAxisMove(current, "x", true, settings);
      if (current < 0 || state.cells[current] !== LOOSE) return;
      applySlidingFriction(current, settings);
    }

    state.vx[current] = dampVelocity(state.vx[current]);
    state.vy[current] = dampVelocity(state.vy[current]);

    const nextX = current % state.width;
    const nextY = Math.floor(current / state.width);
    const isResting =
      nextX === previousX &&
      nextY === previousY &&
      state.vx[current] === 0 &&
      state.vy[current] === 0 &&
      hasSupport(current);

    if (isResting && isNeedleTop(current)) {
      state.ages[current] = 0;
    } else if (isResting) {
      state.ages[current]++;
      if (state.ages[current] >= settings.settleTicks && canLooseCellPack(current)) setCell(current, PACKED);
    } else {
      state.ages[current] = 0;
    }
  }

  function moveLoose(from, to) {
    if (from === to) return from;
    state.cells[to] = state.cells[from];
    state.ages[to] = state.ages[from];
    state.damage[to] = state.damage[from];
    state.stress[to] = state.stress[from];
    state.visualStress[to] = state.visualStress[from];
    state.visualX[to] = state.visualX[from];
    state.visualY[to] = state.visualY[from];
    state.vx[to] = state.vx[from];
    state.vy[to] = state.vy[from];
    state.touched[to] = state.tick;
    clearCell(from, false);
    return to;
  }

  function clampVelocity(value) {
    return Math.max(-MAX_LOOSE_SPEED, Math.min(MAX_LOOSE_SPEED, Math.trunc(value)));
  }

  function quantizeVelocity(value) {
    return clampVelocity(Math.trunc(value));
  }

  function reduceTowardZero(value, amount = 1) {
    if (value === 0) return 0;
    const next = Math.abs(value) - amount;
    return next <= 0 ? 0 : Math.sign(value) * next;
  }

  function dampVelocity(value) {
    return reduceTowardZero(value, 1);
  }

  function cellMass(i) {
    return state.cells[i] === PACKED ? 3 : 1;
  }

  function exchangeMomentum(a, b, axis) {
    if (b < 0 || state.cells[b] === EMPTY) return;
    const av = axis === "x" ? state.vx[a] : state.vy[a];
    const bv = axis === "x" ? state.vx[b] : state.vy[b];
    const massA = cellMass(a);
    const massB = cellMass(b);
    const totalMass = massA + massB;
    const nextA = ((massA - massB) * av + 2 * massB * bv) / totalMass;
    const nextB = ((massB - massA) * bv + 2 * massA * av) / totalMass;

    if (axis === "x") {
      state.vx[a] = quantizeVelocity(nextA);
      state.vx[b] = quantizeVelocity(nextB);
    } else {
      state.vy[a] = quantizeVelocity(nextA);
      state.vy[b] = quantizeVelocity(nextB);
    }

    if (
      state.cells[b] === PACKED &&
      Math.abs(av) + Math.abs(bv) >= IMPACT_BREAK_SPEED &&
      !hasDirectPackedColumnToGround(b)
    ) {
      setCell(b, LOOSE);
      if (axis === "x") state.vx[b] = quantizeVelocity(nextB);
      else state.vy[b] = Math.max(0, quantizeVelocity(nextB));
      state.touched[b] = state.tick;
    }
  }

  function collideLooseWithRigid(i, rigidCell, axis) {
    const rigidVelocity = axis === "x" ? state.rigidVx[rigidCell] : state.rigidVy[rigidCell];
    const kick = quantizeVelocity(rigidVelocity * 0.35);

    if (axis === "x") {
      state.vx[i] = kick;
      state.vy[i] = reduceTowardZero(state.vy[i]);
    } else {
      state.vy[i] = Math.min(0, kick);
      state.vx[i] = quantizeVelocity(state.rigidVx[rigidCell] * 0.25);
    }
  }

  function pushLooseOutOfRigid(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    const preferredY = state.rigidVy[i] > 0 ? -1 : 1;
    const candidates = [
      [x, y + preferredY],
      [x - 1, y],
      [x + 1, y],
      [x, y - preferredY],
      [x - 1, y + preferredY],
      [x + 1, y + preferredY],
    ];

    for (const [nx, ny] of candidates) {
      if (!inBounds(nx, ny)) continue;
      const target = index(nx, ny);
      if (!isEmptyForDirt(target)) continue;
      const moved = moveLoose(i, target);
      state.vx[moved] = quantizeVelocity(state.rigidVx[i] * 0.4);
      state.vy[moved] = quantizeVelocity(state.rigidVy[i] * 0.4);
      return moved;
    }

    return i;
  }

  function attemptAxisMove(start, axis, allowCollisionSideStep, settings) {
    const velocity = axis === "x" ? state.vx[start] : state.vy[start];
    if (velocity === 0 || state.cells[start] !== LOOSE) return start;

    const steps = Math.abs(velocity);
    const direction = Math.sign(velocity);
    const startX = start % state.width;
    const startY = Math.floor(start / state.width);
    let openX = startX;
    let openY = startY;
    let open = start;

    for (let step = 1; step <= steps; step++) {
      const nx = axis === "x" ? startX + step * direction : startX;
      const ny = axis === "y" ? startY + step * direction : startY;

      if (!inBounds(nx, ny)) {
        let current = start;
        if (open !== start) current = moveLoose(start, open);
        if (axis === "x") state.vx[current] = 0;
        else state.vy[current] = 0;
        return current;
      }

      const target = index(nx, ny);
      if (!isEmptyForDirt(target)) {
        let current = start;
        if (open !== start) current = moveLoose(start, open);

        if (axis === "y" && direction > 0 && steps <= 1) {
          state.vy[current] = 0;
          const slid = allowCollisionSideStep ? tryDiagonalFall(current, settings) : current;
          const didSlide = slid >= 0 && slid !== current;
          if (slid >= 0) current = slid;
          if (
            allowCollisionSideStep &&
            !didSlide &&
            !isNeedleTop(current) &&
            canLooseCellPack(current) &&
            shouldPackAgainstStableColumn(current)
          ) {
            setCell(current, PACKED);
            return -1;
          }
          return current;
        }

        if (state.rigid[target]) collideLooseWithRigid(current, target, axis);
        else exchangeMomentum(current, target, axis);

        if (axis === "y" && direction > 0) {
          state.vy[current] = 0;
          const slid = allowCollisionSideStep ? tryDiagonalFall(current, settings) : current;
          const didSlide = slid >= 0 && slid !== current;
          if (slid >= 0) current = slid;
          if (!didSlide && !isNeedleTop(current) && canLooseCellPack(current) && shouldPackAgainstStableColumn(current)) {
            setCell(current, PACKED);
            return -1;
          }
          return current;
        }

        if (axis === "x") {
          state.vx[current] = reduceTowardZero(state.vx[current]);
          if (state.cells[target] !== EMPTY) state.vx[target] = reduceTowardZero(state.vx[target]);
        }

        return current;
      }

      openX = nx;
      openY = ny;
      open = index(openX, openY);
    }

    return moveLoose(start, open);
  }

  function hasSupport(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    return y === state.height - 1 || isSolidForDirt(index(x, y + 1));
  }

  function hasDirectPackedColumnToGround(i) {
    if (i < 0 || state.cells[i] !== PACKED) return false;
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    for (let yy = y; yy < state.height; yy++) {
      if (state.cells[index(x, yy)] !== PACKED) return false;
    }
    return true;
  }

  function hasPackedNeighbor(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        if (state.cells[index(nx, ny)] === PACKED) return true;
      }
    }
    return false;
  }

  function canLooseCellPack(i) {
    return state.cells[i] === LOOSE && hasPackedNeighbor(i);
  }

  function shouldPackAgainstStableColumn(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    if (y >= state.height - 1) return false;
    return hasDirectPackedColumnToGround(index(x, y + 1));
  }

  function tryDiagonalFall(i, settings) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    if (y >= state.height - 1) return i;

    const directionFirst = (x + y + state.tick + (state.rngFlip ? 1 : 0)) % 2 === 0 ? -1 : 1;
    const options = [directionFirst, -directionFirst];

    for (const direction of options) {
      const nx = x + direction;
      const ny = y + 1;
      if (!inBounds(nx, ny)) continue;
      const target = index(nx, ny);
      if (!isEmptyForDirt(target)) continue;
      const moved = moveLoose(i, target);
      state.vy[moved] = 0;
      if (Math.random() < settings.spread) state.vx[moved] = clampVelocity(state.vx[moved] + direction);
      return moved;
    }

    return i;
  }

  function tryRestingSlide(i, settings) {
    if (state.vy[i] !== 0 || !hasSupport(i)) return i;
    return tryDiagonalFall(i, settings);
  }

  function tryColumnSlump(i, settings) {
    if (state.cells[i] !== LOOSE || !hasSupport(i)) return i;
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    if (y >= state.height - 1) return i;
    if (!isNeedleTop(i)) return i;

    const slumpChance = Math.max(0.42, settings.jitter + settings.spread * 0.45);
    if (Math.random() > slumpChance) return i;

    const directionFirst = (x + state.tick + (state.rngFlip ? 1 : 0)) % 2 === 0 ? -1 : 1;
    for (const direction of [directionFirst, -directionFirst]) {
      const nx = x + direction;
      if (!inBounds(nx, y)) continue;
      const target = index(nx, y);
      if (!isEmptyForDirt(target)) continue;
      const moved = moveLoose(i, target);
      state.vx[moved] = direction;
      state.ages[moved] = 0;
      return moved;
    }

    return i;
  }

  function isNeedleTop(i) {
    if (state.cells[i] !== LOOSE || !hasSupport(i)) return false;
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    if (y >= state.height - 1) return false;

    const leftEmpty = inBounds(x - 1, y) && isEmptyForDirt(index(x - 1, y));
    const rightEmpty = inBounds(x + 1, y) && isEmptyForDirt(index(x + 1, y));
    if (!leftEmpty && !rightEmpty) return false;

    const hasLeftShoulder = inBounds(x - 1, y + 1) && isSolidForDirt(index(x - 1, y + 1));
    const hasRightShoulder = inBounds(x + 1, y + 1) && isSolidForDirt(index(x + 1, y + 1));
    return !hasLeftShoulder || !hasRightShoulder;
  }

  function applySlidingFriction(i, settings) {
    if (state.vx[i] === 0 || !hasSupport(i)) return;
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    const below = y < state.height - 1 ? index(x, y + 1) : -1;
    const friction =
      below < 0 || state.cells[below] === PACKED || state.rigid[below]
        ? 2
        : 1 + Math.round(settings.jitter * 4);
    state.vx[i] = reduceTowardZero(state.vx[i], friction);
  }

  function analyzePackedClusters(settings) {
    state.stress.fill(0);
    const total = state.width * state.height;
    const seen = state.clusterSeen;
    const cluster = state.clusterCells;
    const queue = state.clusterQueue;

    state.clusterSeenToken = state.clusterSeenToken === 0xffffffff ? 1 : state.clusterSeenToken + 1;
    if (state.clusterSeenToken === 1) seen.fill(0);
    const seenToken = state.clusterSeenToken;

    for (let i = 0; i < total; i++) {
      if (state.cells[i] !== PACKED || seen[i] === seenToken) continue;
      cluster.length = 0;
      queue.length = 0;
      queue.push(i);
      seen[i] = seenToken;

      for (let q = 0; q < queue.length; q++) {
        const current = queue[q];
        cluster.push(current);
        const x = current % state.width;
        const y = Math.floor(current / state.width);
        addPackedNeighbor(x - 1, y, seen, seenToken, queue);
        addPackedNeighbor(x + 1, y, seen, seenToken, queue);
        addPackedNeighbor(x, y - 1, seen, seenToken, queue);
        addPackedNeighbor(x, y + 1, seen, seenToken, queue);
      }

      processCluster(cluster, settings);
    }
  }

  function addPackedNeighbor(x, y, seen, seenToken, queue) {
    if (!inBounds(x, y)) return;
    const i = index(x, y);
    if (seen[i] === seenToken || state.cells[i] !== PACKED) return;
    seen[i] = seenToken;
    queue.push(i);
  }

  function hasRigidSupport(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    return y < state.height - 1 && state.rigid[index(x, y + 1)] !== 0;
  }

  function processCluster(cluster, settings) {
    let grounded = false;
    const h = state.height;

    for (const i of cluster) {
      if (Math.floor(i / state.width) === h - 1 || hasRigidSupport(i)) {
        grounded = true;
        break;
      }
    }

    if (!grounded) {
      for (const i of cluster) setCell(i, LOOSE);
      return;
    }

    const distances = computeSupportDistances(cluster, settings.bridgePenalty);
    routeClusterLoad(cluster, distances, settings);
  }

  function computeSupportDistances(cluster, bridgePenalty) {
    const distances = state.supportDistances;
    const queue = state.supportQueue;
    let head = 0;

    queue.length = 0;
    for (const i of cluster) distances[i] = Number.POSITIVE_INFINITY;

    for (const i of cluster) {
      const y = Math.floor(i / state.width);
      if (y === state.height - 1 || hasRigidSupport(i)) {
        distances[i] = 0;
        queue.push(i);
      }
    }

    while (head < queue.length) {
      const current = queue[head++];
      const x = current % state.width;
      const y = Math.floor(current / state.width);
      relaxSupportNeighbor(x - 1, y, current, distances, bridgePenalty, queue);
      relaxSupportNeighbor(x + 1, y, current, distances, bridgePenalty, queue);
      relaxSupportNeighbor(x, y - 1, current, distances, bridgePenalty, queue);
      relaxSupportNeighbor(x, y + 1, current, distances, bridgePenalty, queue);
    }

    return distances;
  }

  function relaxSupportNeighbor(x, y, from, distances, bridgePenalty, queue) {
    if (!inBounds(x, y)) return;
    const next = index(x, y);
    if (state.cells[next] !== PACKED) return;
    const fx = from % state.width;
    const fy = Math.floor(from / state.width);
    const horizontal = y === fy && x !== fx;
    const upward = y < fy;
    const cost =
      1 +
      (horizontal ? bridgePenalty : 0) +
      (upward ? 0.25 : 0);
    const candidate = distances[from] + cost;
    if (candidate >= distances[next]) return;
    distances[next] = candidate;
    queue.push(next);
  }

  function routeClusterLoad(cluster, distances, settings) {
    const loads = state.supportLoads;
    const particleWeight = settings.weight;
    const threshold = settings.cohesion;
    const fatigue = settings.fatigue;

    for (const i of cluster) loads[i] = 0;
    cluster.sort((a, b) => distances[b] - distances[a]);

    for (const i of cluster) {
      loads[i] += particleWeight + looseOverburden(i, particleWeight) + state.externalLoad[i];
      const parent = bestSupportParent(i, distances);
      const bending = bendingPenalty(i, distances);
      const bearing = bearingPenalty(i);
      state.stress[i] = (loads[i] * (1 + bending + bearing)) / supportRelief(i);

      if (parent >= 0) {
        loads[parent] += loads[i];
      }
    }

    for (const i of cluster) {
      const stress = state.stress[i];
      if (stress > threshold) {
        const excess = (stress - threshold) / Math.max(threshold, 1);
        state.damage[i] += fatigue * excess;
      } else {
        state.damage[i] *= 0.82;
      }

      if (stress > threshold * 1.35 || state.damage[i] >= 1) {
        setCell(i, LOOSE);
      }
    }
  }

  function looseOverburden(i, particleWeight) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    let load = 0;
    for (let yy = y - 1; yy >= 0 && yy >= y - 8; yy--) {
      const above = index(x, yy);
      if (state.cells[above] === LOOSE) load += particleWeight * 0.55;
      if (state.cells[above] === EMPTY) break;
    }
    return load;
  }

  function bestSupportParent(i, distances) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    let best = -1;
    let bestDistance = distances[i];

    for (const [dx, dy] of SUPPORT_PARENT_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = index(nx, ny);
      if (state.cells[ni] !== PACKED) continue;
      if (distances[ni] < bestDistance) {
        bestDistance = distances[ni];
        best = ni;
      }
    }

    return best;
  }

  function bendingPenalty(i, distances) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    const below = inBounds(x, y + 1) ? state.cells[index(x, y + 1)] : EMPTY;
    const hasVerticalSupport = below === PACKED || hasRigidSupport(i) || y === state.height - 1;
    if (hasVerticalSupport) return 0;

    const left = inBounds(x - 1, y) && state.cells[index(x - 1, y)] === PACKED;
    const right = inBounds(x + 1, y) && state.cells[index(x + 1, y)] === PACKED;
    const bridge = left && right ? 0.25 : 0.7;
    return bridge + Math.min(distances[i] * 0.025, 1.4);
  }

  function bearingPenalty(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    let incoming = 0;

    for (const [dx, dy] of BEARING_NEIGHBOR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = index(nx, ny);
      if (state.cells[ni] === PACKED) incoming++;
    }
    return incoming >= 3 ? 0.25 : 0;
  }

  function supportRelief(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    if (y === state.height - 1) return 9;
    if (hasRigidSupport(i)) return 5;

    let relief = 1;

    for (const [dx, dy, value] of SUPPORT_RELIEF_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const support = index(nx, ny);
      if (state.cells[support] === PACKED || state.rigid[support]) relief += value;
    }

    return relief;
  }

  return {
    simulationStep,
    updateLoose,
    analyzePackedClusters,
    applyRigidTerrainEffects,
  };
}
