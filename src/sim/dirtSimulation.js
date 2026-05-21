import { EMPTY, LOOSE, PACKED } from "./cellTypes.js";
import { DEFAULT_MATERIAL_ID, MATERIALS } from "./materials.js";

const RIGID_LOAD_SCALE = 0.45;
const RIGID_BREAK_SPEED = 6;
const RIGID_BREAK_DAMAGE = 0.0225;
const RIGID_PRESSURE_BREAK_MASS = 0.08;
const RIGID_PRESSURE_BREAK_DAMAGE = 0.1;
const RIGID_LOOSE_KICK = 0.78;
const LOOSE_GRAVITY = 0.34;
const LOOSE_AIR_DRAG = 0.982;
const LOOSE_SURFACE_FRICTION = 0.72;
const LOOSE_RESTITUTION = 0.28;
const LOOSE_MIN_SPEED = 0.05;
const LOOSE_MAX_SPEED = 14;
const LOOSE_MAX_SWEEP_STEPS = 14;
const LOOSE_RIGID_CARRY = 0.22;
const LOOSE_RIGID_IMPACT = 0.46;
const LOOSE_RIGID_RESTITUTION = 0.5;
const LOOSE_RIGID_NEAR_SPEED = 0.14;
const LOOSE_RIGID_CARRY_LOCK_TICKS = 8;
const LOOSE_MELT_COLLISION_SKIP_TICKS = 5;
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
const PACKED_STRESS_SCALE = 4;
const STRESS_PROJECT_EPSILON = 0.001;
const STRESS_FULL_PROJECT_INTERVAL_TICKS = 30;
const LOOSE_PACK_CONTACT_TICKS = 20;
const LOOSE_SETTLE_LOCK_NEAR_RIGID_RADIUS = 3;

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
  activityGrid = null,
  updateRigidInfluenceGrid = () => {},
}) {
  const {
    index,
    inBounds,
    setCell,
    clearCell,
    isEmptyForDirt,
    isSolidForDirt,
    updateCellCounts,
  } = grid;
  const packedStress = createPackedStressModel();

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
    activityGrid?.wakeRegion(getActiveRegionSnapshot());
    updateRigidInfluenceGrid();
    updateLoose(settings);
    analyzePackedClusters(settings);
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

  function isCellActive(x, y) {
    return !activityGrid || activityGrid.isCellActive(x, y);
  }

  function forEachActiveBounds(visit) {
    if (!activityGrid) {
      visit({
        minX: 0,
        maxX: state.width - 1,
        minY: 0,
        maxY: state.height - 1,
      });
      return;
    }
    activityGrid.forEachActiveTileBounds(visit);
  }

  function applyRigidTerrainEffects(markRigidTouchedCell = () => {}) {
    forEachActiveBounds((bounds) => {
      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
          const i = index(x, y);
          if (!state.rigid[i]) continue;

          const speed = Math.hypot(state.rigidVx[i], state.rigidVy[i]);
          const load = state.rigidMass[i] * RIGID_LOAD_SCALE;

          if (y < state.height - 1) {
            const below = index(x, y + 1);
            if (state.cells[below] === PACKED) {
              markRigidTouchedCell(below);
              state.externalLoad[below] += load;
            }
          }

          if (state.rigidImpactMass[i] <= 0) continue;

          const pressure = Math.max(0, state.rigidImpactMass[i] - RIGID_PRESSURE_BREAK_MASS) * RIGID_PRESSURE_BREAK_DAMAGE;
          if (pressure > 0) fracturePackedNearRigid(x, y, pressure, state.rigidVx[i], state.rigidVy[i]);

          if (speed < RIGID_BREAK_SPEED) continue;
          const impact = (speed - RIGID_BREAK_SPEED) * RIGID_BREAK_DAMAGE * Math.max(1, state.rigidImpactMass[i]);
          fracturePackedNearRigid(x, y, impact, state.rigidVx[i], state.rigidVy[i]);
        }
      }
    });
  }

  function fracturePackedNearRigid(x, y, impact, vx, vy) {
    for (const [dx, dy] of RIGID_FRACTURE_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (!isCellActive(nx, ny)) continue;
      const i = index(nx, ny);
      if (state.cells[i] !== PACKED) continue;

      state.damage[i] += impact;
      if (state.damage[i] < 1 && impact < 0.35) continue;

      setCell(i, LOOSE);
      state.vx[i] = clampVelocity(vx * RIGID_LOOSE_KICK + dx * Math.max(0.5, impact * 1.8));
      state.vy[i] = clampVelocity(vy * RIGID_LOOSE_KICK + dy * Math.max(0.5, impact * 1.8) - Math.max(0, impact - 0.35) * 0.8);
      state.touched[i] = state.tick;
    }
  }

  function updateLoose(settings) {
    state.rngFlip = !state.rngFlip;

    forEachActiveBounds((bounds) => {
      for (let y = bounds.maxY; y >= bounds.minY; y--) {
        const leftToRight = (y + state.tick + (state.rngFlip ? 1 : 0)) % 2 === 0;
        const width = bounds.maxX - bounds.minX + 1;
        for (let n = 0; n < width; n++) {
          const x = leftToRight
            ? bounds.minX + n
            : bounds.maxX - n;
          const i = index(x, y);
          if (state.cells[i] !== LOOSE || state.touched[i] === state.tick) continue;
          updateLooseCell(i, settings);
        }
      }
    });
  }

  function updateLooseCell(start, settings) {
    if (state.cells[start] !== LOOSE) return;
    state.touched[start] = state.tick;
    const collisionsDisabled = updateLooseCollisionSkip(start);
    if (state.cells[start] !== LOOSE) return;
    if (!collisionsDisabled) {
      transferRigidMotionToLoose(start);
      if (state.rigid[start] && !isLooseSettleLocked(start) && pushLooseOutOfRigid(start) !== start) return;
    }

    const moved = tryParticleMove(start, settings);
    const current = moved >= 0 ? moved : start;
    if (current < 0 || state.cells[current] !== LOOSE) return;

    if (moved !== start) {
      state.ages[current] = 0;
      return;
    }

    state.vx[current] *= LOOSE_SURFACE_FRICTION;
    state.vy[current] = Math.min(0, state.vy[current] * LOOSE_RESTITUTION);
    if (Math.abs(state.vx[current]) < LOOSE_MIN_SPEED) state.vx[current] = 0;
    if (Math.abs(state.vy[current]) < LOOSE_MIN_SPEED) state.vy[current] = 0;
    if (isLooseSettleLocked(current)) return;

    if (updateLoosePackContact(current)) {
      setCell(current, PACKED);
      return;
    }

    if (!hasSupport(current)) return;

    state.ages[current]++;
    if (state.ages[current] >= settings.settleTicks && canLooseCellPack(current)) {
      setCell(current, PACKED);
    }
  }

  function tryParticleMove(i, settings) {
    state.vy[i] = clampVelocity(state.vy[i] + LOOSE_GRAVITY);
    state.vx[i] = clampVelocity(state.vx[i] * LOOSE_AIR_DRAG);
    state.vy[i] = clampVelocity(state.vy[i] * LOOSE_AIR_DRAG);

    const speed = Math.max(Math.abs(state.vx[i]), Math.abs(state.vy[i]));
    if (speed < 0.5) return tryFallingSandMove(i, settings);

    const swept = trySweepLooseMove(i);
    if (swept !== i) return swept;

    return tryFallingSandMove(i, settings);
  }

  function trySweepLooseMove(start) {
    let current = start;
    let currentX = current % state.width;
    let currentY = Math.floor(current / state.width);
    const vx = state.vx[current];
    const vy = state.vy[current];
    const steps = Math.min(LOOSE_MAX_SWEEP_STEPS, Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy)))));

    for (let step = 1; step <= steps; step++) {
      if (state.cells[current] !== LOOSE) return current;
      const targetX = Math.round((start % state.width) + (vx * step) / steps);
      const targetY = Math.round(Math.floor(start / state.width) + (vy * step) / steps);
      if (targetX === currentX && targetY === currentY) continue;
      if (!inBounds(targetX, targetY) || !isCellActive(targetX, targetY)) {
        collideLooseAtBoundary(current, targetX, targetY);
        return current;
      }

      const target = index(targetX, targetY);
      if (isEmptyForDirt(target)) {
        current = moveLoose(current, target);
        currentX = targetX;
        currentY = targetY;
        continue;
      }

      const slid = trySlideLooseAlongCollision(current, currentX, currentY, targetX, targetY, state.cells[target]);
      if (slid === current) {
        collideLooseWithCell(current, target, targetX - currentX, targetY - currentY);
        return current;
      }

      current = slid;
      currentX = current % state.width;
      currentY = Math.floor(current / state.width);
    }

    return current;
  }

  function trySlideLooseAlongCollision(i, x, y, targetX, targetY, targetKind) {
    const dx = Math.sign(targetX - x);
    const dy = Math.sign(targetY - y);
    const horizontal = dx !== 0 ? tryMoveLooseTo(i, x + dx, y) : -1;
    if (horizontal >= 0) {
      if (targetKind === LOOSE) {
        state.vy[horizontal] *= LOOSE_SURFACE_FRICTION;
        state.vx[horizontal] *= LOOSE_SURFACE_FRICTION;
      } else {
        state.vy[horizontal] *= -LOOSE_RESTITUTION;
        state.vx[horizontal] *= 0.88;
      }
      return horizontal;
    }

    const vertical = dy !== 0 ? tryMoveLooseTo(i, x, y + dy) : -1;
    if (vertical >= 0) {
      if (targetKind === LOOSE) {
        state.vx[vertical] *= LOOSE_SURFACE_FRICTION;
        state.vy[vertical] *= LOOSE_SURFACE_FRICTION;
      } else {
        state.vx[vertical] *= -LOOSE_RESTITUTION;
        state.vy[vertical] *= 0.88;
      }
      return vertical;
    }

    return i;
  }

  function collideLooseAtBoundary(i, targetX, targetY) {
    if (targetX < 0 || targetX >= state.width) state.vx[i] *= -LOOSE_RESTITUTION;
    if (targetY < 0 || targetY >= state.height) state.vy[i] *= -LOOSE_RESTITUTION;
    state.vx[i] = clampVelocity(state.vx[i] * LOOSE_SURFACE_FRICTION);
    state.vy[i] = clampVelocity(state.vy[i] * LOOSE_SURFACE_FRICTION);
  }

  function collideLooseWithCell(i, target, dx, dy) {
    if (state.cells[target] === LOOSE) {
      state.vx[i] = clampVelocity(state.vx[i] * LOOSE_SURFACE_FRICTION);
      state.vy[i] = clampVelocity(Math.min(state.vy[i], 0) * LOOSE_RESTITUTION);
      return;
    }

    if (dx !== 0) state.vx[i] *= -LOOSE_RESTITUTION;
    if (dy !== 0) state.vy[i] *= -LOOSE_RESTITUTION;
    state.vx[i] = clampVelocity(state.vx[i] + ((state.tick + i) % 3 - 1) * 0.08);
    state.vy[i] = clampVelocity(state.vy[i]);
  }

  function tryFallingSandMove(i, settings) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    if (y >= state.height - 1) return i;

    const below = tryMoveLooseTo(i, x, y + 1);
    if (below >= 0) return below;

    const directionFirst = (x + y + state.tick + (state.rngFlip ? 1 : 0)) % 2 === 0 ? -1 : 1;
    const diagonalA = tryMoveLooseTo(i, x + directionFirst, y + 1);
    if (diagonalA >= 0) return diagonalA;

    const diagonalB = tryMoveLooseTo(i, x - directionFirst, y + 1);
    if (diagonalB >= 0) return diagonalB;

    if (Math.random() < settings.spread * 0.2 + settings.jitter * 0.08) {
      const sideA = tryMoveLooseTo(i, x + directionFirst, y);
      if (sideA >= 0) return sideA;
      const sideB = tryMoveLooseTo(i, x - directionFirst, y);
      if (sideB >= 0) return sideB;
    }

    return i;
  }

  function tryMoveLooseTo(from, x, y) {
    if (!inBounds(x, y)) return -1;
    if (!isCellActive(x, y)) return -1;
    const target = index(x, y);
    if (!isEmptyForDirt(target)) return -1;
    return moveLoose(from, target);
  }

  function moveLoose(from, to) {
    if (from === to) return from;
    const fromKind = state.cells[from];
    const toKind = state.cells[to];
    updateCellCounts(toKind, fromKind, false);
    state.cells[to] = fromKind;
    packedStress.markCellChanged(to, toKind, fromKind);
    state.ages[to] = state.ages[from];
    state.looseSettleLocks[to] = state.looseSettleLocks[from];
    state.looseCollisionSkips[to] = state.looseCollisionSkips[from];
    state.damage[to] = state.damage[from];
    state.stress[to] = state.stress[from];
    state.visualStress[to] = state.visualStress[from];
    state.looseContactAges[to] = state.looseContactAges[from];
    state.visualX[to] = state.visualX[from];
    state.visualY[to] = state.visualY[from];
    state.vx[to] = state.vx[from];
    state.vy[to] = state.vy[from];
    state.touched[to] = state.tick;
    activityGrid?.wakeIndex(from);
    activityGrid?.wakeIndex(to);
    clearCell(from, false);
    return to;
  }

  function clampVelocity(value) {
    if (Math.abs(value) < LOOSE_MIN_SPEED) return 0;
    return Math.max(-LOOSE_MAX_SPEED, Math.min(LOOSE_MAX_SPEED, value));
  }

  function transferRigidMotionToLoose(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    let rigidVx = 0;
    let rigidVy = 0;
    let weight = 0;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const neighbor = index(nx, ny);
        if (!state.rigid[neighbor]) continue;
        const contactWeight = dy > 0 ? 1 : 0.45;
        rigidVx += state.rigidVx[neighbor] * contactWeight;
        rigidVy += state.rigidVy[neighbor] * contactWeight;
        weight += contactWeight;
      }
    }

    if (state.rigid[i]) {
      rigidVx += state.rigidVx[i] * 1.4;
      rigidVy += state.rigidVy[i] * 1.4;
      weight += 1.4;
    }

    if (weight <= 0) return;
    rigidVx /= weight;
    rigidVy /= weight;
    const speed = Math.hypot(rigidVx, rigidVy);
    if (speed < LOOSE_RIGID_NEAR_SPEED) return;

    const impulse = state.rigid[i] ? LOOSE_RIGID_IMPACT : LOOSE_RIGID_CARRY;
    state.vx[i] = clampVelocity(state.vx[i] + rigidVx * impulse * LOOSE_RIGID_RESTITUTION);
    state.vy[i] = clampVelocity(state.vy[i] + rigidVy * impulse * LOOSE_RIGID_RESTITUTION);
    state.looseSettleLocks[i] = Math.max(state.looseSettleLocks[i], LOOSE_RIGID_CARRY_LOCK_TICKS);
    activityGrid?.wakeIndex(i, 1, LOOSE_RIGID_CARRY_LOCK_TICKS);
  }

  function updateLooseCollisionSkip(i) {
    const skip = state.looseCollisionSkips[i] ?? 0;
    if (skip <= 0) return false;

    state.looseCollisionSkips[i] = skip - 1;
    if (state.looseCollisionSkips[i] > 0) {
      state.vy[i] = clampVelocity((state.vy[i] + LOOSE_GRAVITY) * LOOSE_AIR_DRAG);
      state.vx[i] = clampVelocity(state.vx[i] * LOOSE_AIR_DRAG);
      activityGrid?.wakeIndex(i, 1, state.looseCollisionSkips[i] + 1);
      return true;
    }

    if (state.rigid[i]) {
      clearCell(i);
      return true;
    }

    return false;
  }

  function markLooseCollisionDisabled(i, ticks = LOOSE_MELT_COLLISION_SKIP_TICKS) {
    if (state.cells[i] !== LOOSE) return;
    state.looseCollisionSkips[i] = Math.max(state.looseCollisionSkips[i] ?? 0, ticks);
    activityGrid?.wakeIndex(i, 1, ticks + 1);
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
      if (!isCellActive(nx, ny)) continue;
      const target = index(nx, ny);
      if (!isEmptyForDirt(target)) continue;
      const moved = moveLoose(i, target);
      state.vx[moved] = clampVelocity(state.rigidVx[i] * 0.4 * LOOSE_RIGID_RESTITUTION);
      state.vy[moved] = clampVelocity(state.rigidVy[i] * 0.4 * LOOSE_RIGID_RESTITUTION);
      return moved;
    }

    return i;
  }

  function hasSupport(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    return y === state.height - 1 || isSolidForDirt(index(x, y + 1));
  }

  function isLooseSettleLocked(i) {
    const lock = state.looseSettleLocks[i] ?? 0;
    if (lock <= 0) return false;
    if (isNearRigidInfluence(i, LOOSE_SETTLE_LOCK_NEAR_RIGID_RADIUS)) return true;
    state.looseSettleLocks[i] = lock - 1;
    return state.looseSettleLocks[i] > 0;
  }

  function isNearRigidInfluence(i, radius) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    const radiusSq = radius * radius;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radiusSq) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        if (state.rigid[index(nx, ny)] !== 0) return true;
      }
    }

    return false;
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

  function hasCardinalPackedNeighbor(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    return (
      (inBounds(x - 1, y) && state.cells[index(x - 1, y)] === PACKED) ||
      (inBounds(x + 1, y) && state.cells[index(x + 1, y)] === PACKED) ||
      (inBounds(x, y - 1) && state.cells[index(x, y - 1)] === PACKED) ||
      (inBounds(x, y + 1) && state.cells[index(x, y + 1)] === PACKED)
    );
  }

  function updateLoosePackContact(i) {
    const touchingPacked = hasCardinalPackedNeighbor(i);
    if (touchingPacked || state.looseContactAges[i] > 0) state.looseContactAges[i]++;
    return touchingPacked && state.looseContactAges[i] >= LOOSE_PACK_CONTACT_TICKS;
  }

  function canLooseCellPack(i) {
    return state.cells[i] === LOOSE && hasPackedNeighbor(i);
  }

  function analyzePackedClusters(settings) {
    packedStress.analyze(settings);
  }

  function markStressCellChanged(i, fromKind, toKind) {
    packedStress.markCellChanged(i, fromKind, toKind);
  }

  function resetStressModel() {
    packedStress.markAllDirty();
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

  function hasRigidSupport(i) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    return y < state.height - 1 && state.rigid[index(x, y + 1)] !== 0;
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

  function createPackedStressModel() {
    let coarseWidth = 0;
    let coarseHeight = 0;
    let total = 0;
    let packedCounts = new Uint16Array(0);
    let occupied = new Uint8Array(0);
    let baseSupported = new Uint8Array(0);
    let supported = new Uint8Array(0);
    let seen = new Uint32Array(0);
    let stress = new Float32Array(0);
    let loads = new Float32Array(0);
    let distances = new Float32Array(0);
    let externalLoads = new Float32Array(0);
    let looseLoads = new Float32Array(0);
    let unsupported = new Uint8Array(0);
    let previousUnsupported = new Uint8Array(0);
    let fineSupported = new Uint8Array(0);
    let dirty = new Uint8Array(0);
    let project = new Uint8Array(0);
    let seenToken = 0;
    let dirtyAll = true;
    let forceFullProjection = true;
    let lastParticleWeight = Number.NaN;
    let lastBridgePenalty = Number.NaN;
    let lastThreshold = Number.NaN;
    let lastFatigue = Number.NaN;
    let lastFullProjectionTick = -STRESS_FULL_PROJECT_INTERVAL_TICKS;
    const cluster = [];
    const queue = [];
    const dirtyList = [];
    const projectList = [];

    function analyze(settings) {
      resizeIfNeeded();
      updateSettingsProjectState(settings);
      collapseUnsupportedFinePackedCells();
      refreshCachedModel(settings.weight);
      clearSolveModel();
      buildDynamicModel();
      analyzeCoarseClusters(settings);
      updateUnsupportedProjectionState();
      projectStress(settings);
    }

    function resizeIfNeeded() {
      const nextWidth = Math.max(1, Math.ceil(state.width / PACKED_STRESS_SCALE));
      const nextHeight = Math.max(1, Math.ceil(state.height / PACKED_STRESS_SCALE));
      const nextTotal = nextWidth * nextHeight;
      if (nextWidth === coarseWidth && nextHeight === coarseHeight && nextTotal === total) return;

      coarseWidth = nextWidth;
      coarseHeight = nextHeight;
      total = nextTotal;
      packedCounts = new Uint16Array(total);
      occupied = new Uint8Array(total);
      baseSupported = new Uint8Array(total);
      supported = new Uint8Array(total);
      seen = new Uint32Array(total);
      stress = new Float32Array(total);
      loads = new Float32Array(total);
      distances = new Float32Array(total);
      externalLoads = new Float32Array(total);
      looseLoads = new Float32Array(total);
      unsupported = new Uint8Array(total);
      previousUnsupported = new Uint8Array(total);
      fineSupported = new Uint8Array(state.width * state.height);
      dirty = new Uint8Array(total);
      project = new Uint8Array(total);
      seenToken = 0;
      markAllDirty();
    }

    function collapseUnsupportedFinePackedCells() {
      const fineTotal = state.width * state.height;
      if (fineSupported.length !== fineTotal) fineSupported = new Uint8Array(fineTotal);
      fineSupported.fill(0);
      queue.length = 0;

      for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
          const i = index(x, y);
          if (state.cells[i] !== PACKED) continue;
          if (y !== state.height - 1 && !hasRigidSupport(i)) continue;
          fineSupported[i] = 1;
          queue.push(i);
        }
      }

      for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        const x = current % state.width;
        const y = Math.floor(current / state.width);
        addFineSupportNeighbor(x - 1, y);
        addFineSupportNeighbor(x + 1, y);
        addFineSupportNeighbor(x, y - 1);
        addFineSupportNeighbor(x, y + 1);
      }

      for (let i = 0; i < fineTotal; i++) {
        if (state.cells[i] !== PACKED || fineSupported[i]) continue;
        setCell(i, LOOSE);
        state.vy[i] = 1;
        state.touched[i] = state.tick;
      }
    }

    function addFineSupportNeighbor(x, y) {
      if (!inBounds(x, y)) return;
      const i = index(x, y);
      if (fineSupported[i] || state.cells[i] !== PACKED) return;
      fineSupported[i] = 1;
      queue.push(i);
    }

    function updateSettingsProjectState(settings) {
      if (
        settings.bridgePenalty !== lastBridgePenalty ||
        settings.cohesion !== lastThreshold ||
        settings.fatigue !== lastFatigue
      ) {
        forceFullProjection = true;
      }

      lastBridgePenalty = settings.bridgePenalty;
      lastThreshold = settings.cohesion;
      lastFatigue = settings.fatigue;
    }

    function refreshCachedModel(particleWeight) {
      if (particleWeight !== lastParticleWeight) {
        lastParticleWeight = particleWeight;
        markAllDirty();
      }

      if (dirtyAll) {
        for (let i = 0; i < total; i++) rebuildCoarseAggregate(i, particleWeight);
        dirty.fill(0);
        dirtyList.length = 0;
        dirtyAll = false;
        forceFullProjection = true;
        return;
      }

      for (const i of dirtyList) {
        dirty[i] = 0;
        rebuildCoarseAggregate(i, particleWeight);
        markProjectCoarseWithHalo(i);
      }
      dirtyList.length = 0;
    }

    function clearSolveModel() {
      supported.set(baseSupported);
      loads.fill(0);
      externalLoads.fill(0);
      unsupported.fill(0);
    }

    function buildDynamicModel() {
      forEachActiveBounds((bounds) => {
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
          for (let x = bounds.minX; x <= bounds.maxX; x++) {
            const i = index(x, y);
            if (state.cells[i] !== PACKED) continue;

            const ci = coarseIndexForCell(x, y);
            externalLoads[ci] += state.externalLoad[i];
            if (hasRigidSupport(i)) supported[ci] = 1;
            markProjectCoarseWithHalo(ci);
          }
        }
      });
    }

    function rebuildCoarseAggregate(ci, particleWeight) {
      const coarseX = ci % coarseWidth;
      const coarseY = Math.floor(ci / coarseWidth);
      const minX = coarseX * PACKED_STRESS_SCALE;
      const maxX = Math.min(state.width - 1, minX + PACKED_STRESS_SCALE - 1);
      const minY = coarseY * PACKED_STRESS_SCALE;
      const maxY = Math.min(state.height - 1, minY + PACKED_STRESS_SCALE - 1);

      packedCounts[ci] = 0;
      occupied[ci] = 0;
      baseSupported[ci] = 0;
      looseLoads[ci] = 0;

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const i = index(x, y);
          if (state.cells[i] !== PACKED) continue;
          packedCounts[ci]++;
          occupied[ci] = 1;
          looseLoads[ci] += looseOverburden(i, particleWeight);
          if (y === state.height - 1) baseSupported[ci] = 1;
        }
      }
    }

    function markCellChanged(i, fromKind, toKind) {
      if (fromKind === toKind) return;
      if (total === 0 || dirtyAll) {
        markAllDirty();
        return;
      }

      const x = i % state.width;
      const y = Math.floor(i / state.width);
      if (fromKind === PACKED || toKind === PACKED) markCoarseDirtyAtCell(x, y);
      if (fromKind === LOOSE || toKind === LOOSE) markOverburdenDirty(x, y);
    }

    function markOverburdenDirty(x, y) {
      const maxY = Math.min(state.height - 1, y + 8);
      for (let yy = y + 1; yy <= maxY; yy++) markCoarseDirtyAtCell(x, yy);
    }

    function markCoarseDirtyAtCell(x, y) {
      if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
      const ci = coarseIndexForCell(x, y);
      if (dirtyAll || dirty[ci]) return;
      dirty[ci] = 1;
      dirtyList.push(ci);
    }

    function markAllDirty() {
      dirtyAll = true;
      forceFullProjection = true;
      dirtyList.length = 0;
      projectList.length = 0;
    }

    function analyzeCoarseClusters(settings) {
      seenToken = seenToken === 0xffffffff ? 1 : seenToken + 1;
      if (seenToken === 1) seen.fill(0);

      for (let i = 0; i < total; i++) {
        if (!occupied[i] || seen[i] === seenToken) continue;
        cluster.length = 0;
        queue.length = 0;
        queue.push(i);
        seen[i] = seenToken;

        for (let q = 0; q < queue.length; q++) {
          const current = queue[q];
          cluster.push(current);
          const x = current % coarseWidth;
          const y = Math.floor(current / coarseWidth);
          addCoarseNeighbor(x - 1, y);
          addCoarseNeighbor(x + 1, y);
          addCoarseNeighbor(x, y - 1);
          addCoarseNeighbor(x, y + 1);
        }

        processCoarseCluster(settings);
      }
    }

    function addCoarseNeighbor(x, y) {
      if (x < 0 || x >= coarseWidth || y < 0 || y >= coarseHeight) return;
      const i = y * coarseWidth + x;
      if (!occupied[i] || seen[i] === seenToken) return;
      seen[i] = seenToken;
      queue.push(i);
    }

    function processCoarseCluster(settings) {
      let grounded = false;
      for (const i of cluster) {
        if (supported[i]) {
          grounded = true;
          break;
        }
      }

      if (!grounded) {
        for (const i of cluster) unsupported[i] = 1;
        return;
      }

      computeCoarseSupportDistances(settings.bridgePenalty);
      routeCoarseLoad(settings);
    }

    function computeCoarseSupportDistances(bridgePenalty) {
      let head = 0;
      queue.length = 0;

      for (const i of cluster) {
        distances[i] = Number.POSITIVE_INFINITY;
        if (!supported[i]) continue;
        distances[i] = 0;
        queue.push(i);
      }

      while (head < queue.length) {
        const current = queue[head++];
        const x = current % coarseWidth;
        const y = Math.floor(current / coarseWidth);
        relaxCoarseSupportNeighbor(x - 1, y, current, bridgePenalty);
        relaxCoarseSupportNeighbor(x + 1, y, current, bridgePenalty);
        relaxCoarseSupportNeighbor(x, y - 1, current, bridgePenalty);
        relaxCoarseSupportNeighbor(x, y + 1, current, bridgePenalty);
      }
    }

    function relaxCoarseSupportNeighbor(x, y, from, bridgePenalty) {
      if (x < 0 || x >= coarseWidth || y < 0 || y >= coarseHeight) return;
      const next = y * coarseWidth + x;
      if (!occupied[next]) return;
      const fx = from % coarseWidth;
      const fy = Math.floor(from / coarseWidth);
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

    function routeCoarseLoad(settings) {
      const particleWeight = settings.weight;

      for (const i of cluster) loads[i] = 0;
      cluster.sort((a, b) => distances[b] - distances[a]);

      for (const i of cluster) {
        loads[i] += packedCounts[i] * particleWeight + looseLoads[i] + externalLoads[i];
        const parent = bestCoarseSupportParent(i);
        const bending = coarseBendingPenalty(i);
        const bearing = coarseBearingPenalty(i);
        const averageLoad = loads[i] / Math.max(1, packedCounts[i]);
        const nextStress = isCoarseConfined(i)
          ? 0
          : (averageLoad * (1 + bending + bearing)) / coarseSupportRelief(i);
        if (Math.abs(stress[i] - nextStress) > STRESS_PROJECT_EPSILON) markProjectCoarseWithHalo(i);
        stress[i] = nextStress;

        if (parent >= 0) loads[parent] += loads[i];
      }
    }

    function bestCoarseSupportParent(i) {
      const x = i % coarseWidth;
      const y = Math.floor(i / coarseWidth);
      let best = -1;
      let bestDistance = distances[i];

      for (const [dx, dy] of SUPPORT_PARENT_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= coarseWidth || ny < 0 || ny >= coarseHeight) continue;
        const ni = ny * coarseWidth + nx;
        if (!occupied[ni]) continue;
        if (distances[ni] < bestDistance) {
          bestDistance = distances[ni];
          best = ni;
        }
      }

      return best;
    }

    function coarseBendingPenalty(i) {
      const x = i % coarseWidth;
      const y = Math.floor(i / coarseWidth);
      const below = y < coarseHeight - 1 ? occupied[(y + 1) * coarseWidth + x] : 0;
      const hasVerticalSupport = below || supported[i];
      if (hasVerticalSupport) return 0;

      const left = x > 0 && occupied[i - 1];
      const right = x < coarseWidth - 1 && occupied[i + 1];
      const bridge = left && right ? 0.25 : 0.7;
      return bridge + Math.min(distances[i] * 0.025, 1.4);
    }

    function coarseBearingPenalty(i) {
      const x = i % coarseWidth;
      const y = Math.floor(i / coarseWidth);
      let incoming = 0;

      for (const [dx, dy] of BEARING_NEIGHBOR_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= coarseWidth || ny < 0 || ny >= coarseHeight) continue;
        if (occupied[ny * coarseWidth + nx]) incoming++;
      }
      return incoming >= 3 ? 0.25 : 0;
    }

    function isCoarseConfined(i) {
      const x = i % coarseWidth;
      const y = Math.floor(i / coarseWidth);

      for (const [dx, dy] of SUPPORT_PARENT_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= coarseWidth || ny < 0) return false;
        if (ny >= coarseHeight) continue;
        if (!occupied[ny * coarseWidth + nx]) return false;
      }

      return true;
    }

    function coarseSupportRelief(i) {
      const x = i % coarseWidth;
      const y = Math.floor(i / coarseWidth);
      if (supported[i]) return 5 + 4 * coarseDensity(i);

      let relief = 1;
      for (const [dx, dy, value] of SUPPORT_RELIEF_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= coarseWidth || ny < 0 || ny >= coarseHeight) continue;
        if (occupied[ny * coarseWidth + nx]) relief += value;
      }

      return relief;
    }

    function projectStress(settings) {
      const threshold = settings.cohesion;
      const fatigue = settings.fatigue;
      const shouldProjectAll =
        forceFullProjection ||
        state.tick < lastFullProjectionTick ||
        state.tick - lastFullProjectionTick >= STRESS_FULL_PROJECT_INTERVAL_TICKS;

      if (shouldProjectAll) {
        projectAllStress(threshold, fatigue);
        project.fill(0);
        projectList.length = 0;
        forceFullProjection = false;
        lastFullProjectionTick = state.tick;
        return;
      }

      for (const ci of projectList) {
        project[ci] = 0;
        projectCoarseStress(ci, threshold, fatigue);
      }
      projectList.length = 0;
    }

    function projectAllStress(threshold, fatigue) {
      const fineTotal = state.width * state.height;
      for (let i = 0; i < fineTotal; i++) projectFineStress(i, threshold, fatigue);
    }

    function projectCoarseStress(ci, threshold, fatigue) {
      const coarseX = ci % coarseWidth;
      const coarseY = Math.floor(ci / coarseWidth);
      const minX = coarseX * PACKED_STRESS_SCALE;
      const maxX = Math.min(state.width - 1, minX + PACKED_STRESS_SCALE - 1);
      const minY = coarseY * PACKED_STRESS_SCALE;
      const maxY = Math.min(state.height - 1, minY + PACKED_STRESS_SCALE - 1);

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          projectFineStress(index(x, y), threshold, fatigue);
        }
      }
    }

    function projectFineStress(i, threshold, fatigue) {
      if (state.cells[i] !== PACKED) {
        state.stress[i] = 0;
        return;
      }

      const x = i % state.width;
      const y = Math.floor(i / state.width);
      const ci = coarseIndexForCell(x, y);
      if (unsupported[ci]) {
        setCell(i, LOOSE);
        return;
      }

      const exposed = isConfinedPackedCell(i) ? 0.35 : 1;
      const projectedStress = stress[ci] * exposed;
      state.stress[i] = projectedStress;

      if (projectedStress > threshold) {
        const excess = (projectedStress - threshold) / Math.max(threshold, 1);
        state.damage[i] += fatigue * excess;
      } else {
        state.damage[i] *= 0.82;
      }

      if (projectedStress > threshold * 1.35 || state.damage[i] >= 1) {
        setCell(i, LOOSE);
      }
    }

    function updateUnsupportedProjectionState() {
      for (let i = 0; i < total; i++) {
        if (unsupported[i] !== previousUnsupported[i]) markProjectCoarseWithHalo(i);
      }
      previousUnsupported.set(unsupported);
    }

    function markProjectCoarseWithHalo(ci) {
      const x = ci % coarseWidth;
      const y = Math.floor(ci / coarseWidth);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          markProjectCoarseAt(x + dx, y + dy);
        }
      }
    }

    function markProjectCoarseAt(x, y) {
      if (x < 0 || x >= coarseWidth || y < 0 || y >= coarseHeight) return;
      const ci = y * coarseWidth + x;
      if (project[ci]) return;
      project[ci] = 1;
      projectList.push(ci);
    }

    function coarseDensity(i) {
      return packedCounts[i] / (PACKED_STRESS_SCALE * PACKED_STRESS_SCALE);
    }

    function coarseIndexForCell(x, y) {
      return Math.floor(y / PACKED_STRESS_SCALE) * coarseWidth + Math.floor(x / PACKED_STRESS_SCALE);
    }

    return { analyze, markCellChanged, markAllDirty };
  }

  return {
    simulationStep,
    updateLoose,
    analyzePackedClusters,
    applyRigidTerrainEffects,
    markLooseCollisionDisabled,
    markStressCellChanged,
    resetStressModel,
  };
}
