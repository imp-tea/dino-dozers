import { EMPTY, LOOSE, PACKED } from "./cellTypes.js";
import { DEFAULT_MATERIAL_ID, MATERIALS } from "./materials.js";

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
  getActiveRegion = null,
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

  let activeRegionForRigidEffects = null;

  function simulationStep() {
    const settings = getSettingsSnapshot();
    const activeRegion = getActiveRegionSnapshot();
    state.tick++;
    activeRegionForRigidEffects = activeRegion;
    try {
      updateRigidInfluenceGrid();
    } finally {
      activeRegionForRigidEffects = null;
    }
    updateLoose(settings, activeRegion);
    analyzePackedClusters(settings, activeRegion);
  }

  function getActiveRegionSnapshot() {
    const region = getActiveRegion?.();
    const fullRegion = {
      minX: 0,
      maxX: state.width - 1,
      minY: 0,
      maxY: state.height - 1,
    };
    if (!region) return fullRegion;

    const minX = Math.max(0, Math.min(state.width - 1, Math.floor(region.minX)));
    const maxX = Math.max(0, Math.min(state.width - 1, Math.floor(region.maxX)));
    const minY = Math.max(0, Math.min(state.height - 1, Math.floor(region.minY)));
    const maxY = Math.max(0, Math.min(state.height - 1, Math.floor(region.maxY)));
    return {
      minX: Math.min(minX, maxX),
      maxX: Math.max(minX, maxX),
      minY: Math.min(minY, maxY),
      maxY: Math.max(minY, maxY),
    };
  }

  function isInActiveRegion(x, y, activeRegion) {
    return x >= activeRegion.minX &&
      x <= activeRegion.maxX &&
      y >= activeRegion.minY &&
      y <= activeRegion.maxY;
  }

  function applyRigidTerrainEffects(activeRegion = activeRegionForRigidEffects ?? getActiveRegionSnapshot()) {
    for (let y = activeRegion.minY; y <= activeRegion.maxY; y++) {
      for (let x = activeRegion.minX; x <= activeRegion.maxX; x++) {
        const i = index(x, y);
        if (!state.rigid[i]) continue;

        const speed = Math.hypot(state.rigidVx[i], state.rigidVy[i]);
        const load = state.rigidMass[i] * RIGID_LOAD_SCALE;

        if (y < activeRegion.maxY) {
          const below = index(x, y + 1);
          if (state.cells[below] === PACKED) state.externalLoad[below] += load;
        }

        if (state.rigidImpactMass[i] <= 0) continue;
        if (speed < RIGID_BREAK_SPEED) continue;
        const impact = (speed - RIGID_BREAK_SPEED) * RIGID_BREAK_DAMAGE * Math.max(1, state.rigidImpactMass[i]);
        fracturePackedNearRigid(x, y, impact, state.rigidVx[i], state.rigidVy[i], activeRegion);
      }
    }
  }

  function fracturePackedNearRigid(x, y, impact, vx, vy, activeRegion) {
    for (const [dx, dy] of RIGID_FRACTURE_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (!isInActiveRegion(nx, ny, activeRegion)) continue;
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

  function updateLoose(settings, activeRegion = getActiveRegionSnapshot()) {
    state.rngFlip = !state.rngFlip;

    for (let y = activeRegion.maxY; y >= activeRegion.minY; y--) {
      const leftToRight = (y + state.tick + (state.rngFlip ? 1 : 0)) % 2 === 0;
      const width = activeRegion.maxX - activeRegion.minX + 1;
      for (let n = 0; n < width; n++) {
        const x = leftToRight
          ? activeRegion.minX + n
          : activeRegion.maxX - n;
        const i = index(x, y);
        if (state.cells[i] !== LOOSE || state.touched[i] === state.tick) continue;
        updateLooseCell(i, settings, activeRegion);
      }
    }
  }

  function updateLooseCell(start, settings, activeRegion) {
    if (state.cells[start] !== LOOSE) return;
    state.touched[start] = state.tick;
    if (state.rigid[start] && pushLooseOutOfRigid(start, activeRegion) !== start) return;

    const moved = tryFallingSandMove(start, settings, activeRegion);
    const current = moved >= 0 ? moved : start;
    if (current < 0 || state.cells[current] !== LOOSE) return;

    if (moved !== start) {
      state.ages[current] = 0;
      return;
    }

    state.vx[current] = 0;
    state.vy[current] = 0;
    if (!hasSupport(current)) return;

    state.ages[current]++;
    if (state.ages[current] >= settings.settleTicks && canLooseCellPack(current)) {
      setCell(current, PACKED);
    }
  }

  function tryFallingSandMove(i, settings, activeRegion) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    if (y >= state.height - 1) return i;

    const below = tryMoveLooseTo(i, x, y + 1, activeRegion);
    if (below >= 0) return below;

    const directionFirst = (x + y + state.tick + (state.rngFlip ? 1 : 0)) % 2 === 0 ? -1 : 1;
    const diagonalA = tryMoveLooseTo(i, x + directionFirst, y + 1, activeRegion);
    if (diagonalA >= 0) return diagonalA;

    const diagonalB = tryMoveLooseTo(i, x - directionFirst, y + 1, activeRegion);
    if (diagonalB >= 0) return diagonalB;

    if (Math.random() < settings.spread * 0.2 + settings.jitter * 0.08) {
      const sideA = tryMoveLooseTo(i, x + directionFirst, y, activeRegion);
      if (sideA >= 0) return sideA;
      const sideB = tryMoveLooseTo(i, x - directionFirst, y, activeRegion);
      if (sideB >= 0) return sideB;
    }

    return i;
  }

  function tryMoveLooseTo(from, x, y, activeRegion) {
    if (!inBounds(x, y)) return -1;
    if (!isInActiveRegion(x, y, activeRegion)) return -1;
    const target = index(x, y);
    if (!isEmptyForDirt(target)) return -1;
    return moveLoose(from, target);
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
    return Math.max(-8, Math.min(8, Math.trunc(value)));
  }

  function pushLooseOutOfRigid(i, activeRegion) {
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
      if (!isInActiveRegion(nx, ny, activeRegion)) continue;
      const target = index(nx, ny);
      if (!isEmptyForDirt(target)) continue;
      const moved = moveLoose(i, target);
      state.vx[moved] = clampVelocity(state.rigidVx[i] * 0.4);
      state.vy[moved] = clampVelocity(state.rigidVy[i] * 0.4);
      return moved;
    }

    return i;
  }

  function hasSupport(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    return y === state.height - 1 || isSolidForDirt(index(x, y + 1));
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

  function analyzePackedClusters(settings, activeRegion = getActiveRegionSnapshot()) {
    clearActiveRegionStress(activeRegion);
    const seen = state.clusterSeen;
    const cluster = state.clusterCells;
    const queue = state.clusterQueue;

    state.clusterSeenToken = state.clusterSeenToken === 0xffffffff ? 1 : state.clusterSeenToken + 1;
    if (state.clusterSeenToken === 1) seen.fill(0);
    const seenToken = state.clusterSeenToken;

    for (let y = activeRegion.minY; y <= activeRegion.maxY; y++) {
      for (let x = activeRegion.minX; x <= activeRegion.maxX; x++) {
        const i = index(x, y);
        if (state.cells[i] !== PACKED || seen[i] === seenToken) continue;
        cluster.length = 0;
        queue.length = 0;
        queue.push(i);
        seen[i] = seenToken;

        for (let q = 0; q < queue.length; q++) {
          const current = queue[q];
          cluster.push(current);
          const cx = current % state.width;
          const cy = Math.floor(current / state.width);
          addPackedNeighbor(cx - 1, cy, seen, seenToken, queue, activeRegion);
          addPackedNeighbor(cx + 1, cy, seen, seenToken, queue, activeRegion);
          addPackedNeighbor(cx, cy - 1, seen, seenToken, queue, activeRegion);
          addPackedNeighbor(cx, cy + 1, seen, seenToken, queue, activeRegion);
        }

        processCluster(cluster, settings, activeRegion);
      }
    }
  }

  function clearActiveRegionStress(activeRegion) {
    for (let y = activeRegion.minY; y <= activeRegion.maxY; y++) {
      for (let x = activeRegion.minX; x <= activeRegion.maxX; x++) {
        state.stress[index(x, y)] = 0;
      }
    }
  }

  function addPackedNeighbor(x, y, seen, seenToken, queue, activeRegion) {
    if (!inBounds(x, y)) return;
    if (!isInActiveRegion(x, y, activeRegion)) return;
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

  function processCluster(cluster, settings, activeRegion) {
    let grounded = false;

    for (const i of cluster) {
      if (hasClusterSupport(i, activeRegion)) {
        grounded = true;
        break;
      }
    }

    if (!grounded) {
      for (const i of cluster) setCell(i, LOOSE);
      return;
    }

    const distances = computeSupportDistances(cluster, settings.bridgePenalty, activeRegion);
    routeClusterLoad(cluster, distances, settings, activeRegion);
  }

  function hasClusterSupport(i, activeRegion) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    if (y === state.height - 1 || hasRigidSupport(i)) return true;

    for (const [dx, dy] of SUPPORT_PARENT_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (isInActiveRegion(nx, ny, activeRegion)) continue;
      if (state.cells[index(nx, ny)] === PACKED) return true;
    }

    return false;
  }

  function computeSupportDistances(cluster, bridgePenalty, activeRegion) {
    const distances = state.supportDistances;
    const queue = state.supportQueue;
    let head = 0;

    queue.length = 0;
    for (const i of cluster) distances[i] = Number.POSITIVE_INFINITY;

    for (const i of cluster) {
      if (hasClusterSupport(i, activeRegion)) {
        distances[i] = 0;
        queue.push(i);
      }
    }

    while (head < queue.length) {
      const current = queue[head++];
      const x = current % state.width;
      const y = Math.floor(current / state.width);
      relaxSupportNeighbor(x - 1, y, current, distances, bridgePenalty, queue, activeRegion);
      relaxSupportNeighbor(x + 1, y, current, distances, bridgePenalty, queue, activeRegion);
      relaxSupportNeighbor(x, y - 1, current, distances, bridgePenalty, queue, activeRegion);
      relaxSupportNeighbor(x, y + 1, current, distances, bridgePenalty, queue, activeRegion);
    }

    return distances;
  }

  function relaxSupportNeighbor(x, y, from, distances, bridgePenalty, queue, activeRegion) {
    if (!inBounds(x, y)) return;
    if (!isInActiveRegion(x, y, activeRegion)) return;
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

  function routeClusterLoad(cluster, distances, settings, activeRegion) {
    const loads = state.supportLoads;
    const particleWeight = settings.weight;
    const threshold = settings.cohesion;
    const fatigue = settings.fatigue;

    for (const i of cluster) loads[i] = 0;
    cluster.sort((a, b) => distances[b] - distances[a]);

    for (const i of cluster) {
      loads[i] += particleWeight + looseOverburden(i, particleWeight) + state.externalLoad[i];
      const parent = bestSupportParent(i, distances, activeRegion);
      const bending = bendingPenalty(i, distances);
      const bearing = bearingPenalty(i);
      state.stress[i] = isConfinedPackedCell(i)
        ? 0
        : (loads[i] * (1 + bending + bearing)) / supportRelief(i);

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

  function isConfinedPackedCell(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);

    for (const [dx, dy] of SUPPORT_PARENT_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) {
        if (ny >= state.height) continue;
        return false;
      }

      const neighbor = index(nx, ny);
      if (state.cells[neighbor] !== PACKED && state.rigid[neighbor] === 0) return false;
    }

    return true;
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

  function bestSupportParent(i, distances, activeRegion) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    let best = -1;
    let bestDistance = distances[i];

    for (const [dx, dy] of SUPPORT_PARENT_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (!isInActiveRegion(nx, ny, activeRegion)) continue;
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
