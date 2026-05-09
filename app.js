import { Box, Chain, Circle, Vec2, WheelJoint, World } from "planck";

const EMPTY = 0;
const LOOSE = 1;
const PACKED = 2;
const MAX_LOOSE_SPEED = 8;
const LOOSE_GRAVITY = 1;
const IMPACT_BREAK_SPEED = 4;
const STRESS_VISUAL_EASE = 0.055;
const STRESS_EDGE_FADE_CELLS = 6;
const CONTOUR_REBUILD_INTERVAL_TICKS = 6;
const CONTOUR_ADAPTIVE_EPSILON = 0.95;
const CONTOUR_ADAPTIVE_MIN_POINTS = 5;
const CONTOUR_CORNER_CONNECTOR_LENGTH = 1;
const CONTOUR_CORNER_CONNECTOR_MAX_ANGLE = Math.PI / 3;
const PHYSICS_STEP_SECONDS = 1 / 60;
const VEHICLE_MOTOR_SPEED = 18;
const VEHICLE_MOTOR_TORQUE = 2400;
const VEHICLE_WHEEL_RADIUS = 2.4;
const VEHICLE_WHEEL_Y_OFFSET = 2.9;
const VEHICLE_TIRE_FRICTION = 6;
const VEHICLE_FLIP_UPWARD_IMPULSE = 430;
const VEHICLE_FLIP_SIDE_IMPULSE = 90;
const VEHICLE_FLIP_ANGULAR_IMPULSE = 520;
const PACKED_CONTOUR_FILL = "#76533a";
const PACKED_CONTOUR_STROKE = "#3f2518";

const canvas = document.querySelector("#sim");
const ctx = canvas.getContext("2d");

const controls = {
  brushSize: bindRange("brushSize", Number),
  cohesion: bindRange("cohesion", Number),
  fatigue: bindRange("fatigue", Number),
  weight: bindRange("weight", Number),
  bridgePenalty: bindRange("bridgePenalty", Number),
  settleTicks: bindRange("settleTicks", Number),
  spread: bindRange("spread", Number),
  jitter: bindRange("jitter", Number),
  speed: bindRange("speed", Number),
  gridWidth: bindRange("gridWidth", Number),
  gridHeight: bindRange("gridHeight", Number),
  stressView: document.querySelector("#stressView"),
  damageView: document.querySelector("#damageView"),
  contourView: document.querySelector("#contourView"),
  resetVehicle: document.querySelector("#resetVehicle"),
  unifiedColor: document.querySelector("#unifiedColor"),
};

let packedContourCacheTick = -CONTOUR_REBUILD_INTERVAL_TICKS;
let isPackedContourCacheDirty = true;
let isPhysicsTerrainDirty = true;
let packedContours = [];
let physicsAccumulator = 0;
let physicsTerrainBody = null;
let physicsChassisBody = null;
let physicsLeftWheelBody = null;
let physicsRightWheelBody = null;
let physicsLeftWheelJoint = null;
let physicsRightWheelJoint = null;
let isDrivingLeft = false;
let isDrivingRight = false;
let lastFrame = performance.now();

const physicsWorld = new World({
  gravity: Vec2(0, 32),
});

const state = {
  width: controls.gridWidth.value,
  height: controls.gridHeight.value,
  cells: null,
  ages: null,
  damage: null,
  stress: null,
  visualStress: null,
  vx: null,
  vy: null,
  touched: null,
  tool: "packed",
  brushShape: "circle",
  running: true,
  painting: false,
  tick: 0,
  rngFlip: false,
};

function bindRange(id, parser) {
  const input = document.querySelector(`#${id}`);
  const value = document.querySelector(`#${id}Value`);
  const sync = () => {
    value.textContent = input.value;
  };
  input.addEventListener("input", sync);
  sync();
  return {
    input,
    get value() {
      return parser(input.value);
    },
    set value(next) {
      input.value = next;
      sync();
    },
  };
}

function resizeGrid(width, height) {
  state.width = width;
  state.height = height;
  const total = width * height;
  state.cells = new Uint8Array(total);
  state.ages = new Uint16Array(total);
  state.damage = new Float32Array(total);
  state.stress = new Float32Array(total);
  state.visualStress = new Float32Array(total);
  state.vx = new Int16Array(total);
  state.vy = new Int16Array(total);
  state.touched = new Uint32Array(total);
  state.tick = 0;
  seedWorld();
}

function index(x, y) {
  return y * state.width + x;
}

function inBounds(x, y) {
  return x >= 0 && x < state.width && y >= 0 && y < state.height;
}

function swapCells(a, b) {
  const touchesPacked = state.cells[a] === PACKED || state.cells[b] === PACKED;
  const c = state.cells[a];
  state.cells[a] = state.cells[b];
  state.cells[b] = c;
  const age = state.ages[a];
  state.ages[a] = state.ages[b];
  state.ages[b] = age;
  const damage = state.damage[a];
  state.damage[a] = state.damage[b];
  state.damage[b] = damage;
  const stress = state.stress[a];
  state.stress[a] = state.stress[b];
  state.stress[b] = stress;
  const visualStress = state.visualStress[a];
  state.visualStress[a] = state.visualStress[b];
  state.visualStress[b] = visualStress;
  const vx = state.vx[a];
  state.vx[a] = state.vx[b];
  state.vx[b] = vx;
  const vy = state.vy[a];
  state.vy[a] = state.vy[b];
  state.vy[b] = vy;
  const touched = state.touched[a];
  state.touched[a] = state.touched[b];
  state.touched[b] = touched;
  if (touchesPacked) markPackedTerrainDirty();
}

function clearCell(i) {
  const wasPacked = state.cells[i] === PACKED;
  state.cells[i] = EMPTY;
  state.ages[i] = 0;
  state.damage[i] = 0;
  state.stress[i] = 0;
  state.visualStress[i] = 0;
  state.vx[i] = 0;
  state.vy[i] = 0;
  state.touched[i] = 0;
  if (wasPacked) markPackedTerrainDirty();
}

function setCell(i, kind) {
  const wasPacked = state.cells[i] === PACKED;
  state.cells[i] = kind;
  state.ages[i] = 0;
  state.damage[i] = 0;
  state.stress[i] = 0;
  state.visualStress[i] = 0;
  state.vx[i] = 0;
  state.vy[i] = 0;
  state.touched[i] = 0;
  if (wasPacked || kind === PACKED) markPackedTerrainDirty();
}

function markPackedTerrainDirty() {
  isPackedContourCacheDirty = true;
  isPhysicsTerrainDirty = true;
}

function seedWorld() {
  markPackedTerrainDirty();
  state.cells.fill(EMPTY);
  state.ages.fill(0);
  state.damage.fill(0);
  state.stress.fill(0);
  state.visualStress.fill(0);
  state.vx.fill(0);
  state.vy.fill(0);
  state.touched.fill(0);

  const w = state.width;
  const h = state.height;
  const floor = Math.floor(h * 0.78);

  for (let y = floor; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (Math.random() > 0.05) setCell(index(x, y), PACKED);
    }
  }

  const archLeft = Math.floor(w * 0.2);
  const archRight = Math.floor(w * 0.8);
  const archTop = Math.floor(h * 0.34);
  const archBottom = Math.floor(h * 0.78);

  for (let y = archTop; y < archBottom; y++) {
    for (let x = archLeft; x < archRight; x++) {
      const normalized = (x - archLeft) / (archRight - archLeft);
      const curve = Math.sin(normalized * Math.PI);
      const roof = archBottom - Math.floor(curve * h * 0.27);
      const thickness = 5 + Math.floor(curve * 5);
      const wall =
        x < archLeft + 7 ||
        x > archRight - 8 ||
        (y >= roof && y <= roof + thickness);
      if (wall && Math.random() > 0.04) setCell(index(x, y), PACKED);
    }
  }

  for (let n = 0; n < Math.floor(w * h * 0.03); n++) {
    const x = Math.floor(w * 0.38 + Math.random() * w * 0.24);
    const y = Math.floor(h * 0.03 + Math.random() * h * 0.18);
    setCell(index(x, y), LOOSE);
  }
}

function simulationStep() {
  state.tick++;
  updateLoose();
  analyzePackedClusters();
}

function updateLoose() {
  const w = state.width;
  const h = state.height;
  state.rngFlip = !state.rngFlip;

  for (let y = h - 1; y >= 0; y--) {
    const leftToRight = (y + state.tick + (state.rngFlip ? 1 : 0)) % 2 === 0;
    for (let n = 0; n < w; n++) {
      const x = leftToRight ? n : w - 1 - n;
      const i = index(x, y);
      if (state.cells[i] !== LOOSE || state.touched[i] === state.tick) continue;
      updateLooseCell(i);
    }
  }
}

function updateLooseCell(start) {
  if (state.cells[start] !== LOOSE) return;
  state.touched[start] = state.tick;
  const previousX = start % state.width;
  const previousY = Math.floor(start / state.width);
  const hadVerticalVelocity = state.vy[start] !== 0;

  if (previousY === state.height - 1 && state.vy[start] > 0) {
    state.vy[start] = 0;
  } else if (previousY < state.height - 1) {
    state.vy[start] = clampVelocity(state.vy[start] + LOOSE_GRAVITY);
  }

  let current = attemptAxisMove(start, "y", hadVerticalVelocity);
  if (current < 0 || state.cells[current] !== LOOSE) return;

  const movedVertical = current !== start;
  if (!movedVertical && state.vy[current] === 0) {
    const slid = tryRestingSlide(current);
    if (slid >= 0 && slid !== current) current = slid;
    if (slid < 0) return;

    if (current >= 0 && state.cells[current] === LOOSE) {
      const slumped = tryColumnSlump(current);
      if (slumped !== current) current = slumped;
    }

    if (
      current >= 0 &&
      state.cells[current] === LOOSE &&
      !isNeedleTop(current) &&
      shouldPackAgainstStableColumn(current)
    ) {
      setCell(current, PACKED);
      return;
    }
  }

  if (current >= 0 && state.cells[current] === LOOSE && state.vx[current] !== 0) {
    current = attemptAxisMove(current, "x", true);
    if (current < 0 || state.cells[current] !== LOOSE) return;
    applySlidingFriction(current);
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
    if (state.ages[current] >= controls.settleTicks.value) setCell(current, PACKED);
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
  state.vx[to] = state.vx[from];
  state.vy[to] = state.vy[from];
  state.touched[to] = state.tick;
  clearCell(from);
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

function attemptAxisMove(start, axis, allowCollisionSideStep) {
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
    if (state.cells[target] !== EMPTY) {
      let current = start;
      if (open !== start) current = moveLoose(start, open);

      if (axis === "y" && direction > 0 && steps <= 1) {
        state.vy[current] = 0;
        const slid = allowCollisionSideStep ? tryDiagonalFall(current) : current;
        const didSlide = slid >= 0 && slid !== current;
        if (slid >= 0) current = slid;
        if (
          allowCollisionSideStep &&
          !didSlide &&
          !isNeedleTop(current) &&
          shouldPackAgainstStableColumn(current)
        ) {
          setCell(current, PACKED);
          return -1;
        }
        return current;
      }

      exchangeMomentum(current, target, axis);

      if (axis === "y" && direction > 0) {
        state.vy[current] = 0;
        const slid = allowCollisionSideStep ? tryDiagonalFall(current) : current;
        const didSlide = slid >= 0 && slid !== current;
        if (slid >= 0) current = slid;
        if (!didSlide && !isNeedleTop(current) && shouldPackAgainstStableColumn(current)) {
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
  return y === state.height - 1 || state.cells[index(x, y + 1)] !== EMPTY;
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

function shouldPackAgainstStableColumn(i) {
  const x = i % state.width;
  const y = Math.floor(i / state.width);
  if (y >= state.height - 1) return false;
  return hasDirectPackedColumnToGround(index(x, y + 1));
}

function tryDiagonalFall(i) {
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
    if (state.cells[target] !== EMPTY) continue;
    const moved = moveLoose(i, target);
    state.vy[moved] = 0;
    if (Math.random() < controls.spread.value) state.vx[moved] = clampVelocity(state.vx[moved] + direction);
    return moved;
  }

  return i;
}

function tryRestingSlide(i) {
  if (state.vy[i] !== 0 || !hasSupport(i)) return i;
  return tryDiagonalFall(i);
}

function tryColumnSlump(i) {
  if (state.cells[i] !== LOOSE || !hasSupport(i)) return i;
  const x = i % state.width;
  const y = Math.floor(i / state.width);
  if (y >= state.height - 1) return i;
  if (!isNeedleTop(i)) return i;

  const slumpChance = Math.max(0.42, controls.jitter.value + controls.spread.value * 0.45);
  if (Math.random() > slumpChance) return i;

  const directionFirst = (x + state.tick + (state.rngFlip ? 1 : 0)) % 2 === 0 ? -1 : 1;
  for (const direction of [directionFirst, -directionFirst]) {
    const nx = x + direction;
    if (!inBounds(nx, y)) continue;
    const target = index(nx, y);
    if (state.cells[target] !== EMPTY) continue;
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

  const leftEmpty = inBounds(x - 1, y) && state.cells[index(x - 1, y)] === EMPTY;
  const rightEmpty = inBounds(x + 1, y) && state.cells[index(x + 1, y)] === EMPTY;
  if (!leftEmpty && !rightEmpty) return false;

  const hasLeftShoulder = inBounds(x - 1, y + 1) && state.cells[index(x - 1, y + 1)] !== EMPTY;
  const hasRightShoulder = inBounds(x + 1, y + 1) && state.cells[index(x + 1, y + 1)] !== EMPTY;
  return !hasLeftShoulder || !hasRightShoulder;
}

function applySlidingFriction(i) {
  if (state.vx[i] === 0 || !hasSupport(i)) return;
  const x = i % state.width;
  const y = Math.floor(i / state.width);
  const below = y < state.height - 1 ? state.cells[index(x, y + 1)] : PACKED;
  const friction = below === PACKED ? 2 : 1 + Math.round(controls.jitter.value * 4);
  state.vx[i] = reduceTowardZero(state.vx[i], friction);
}

function analyzePackedClusters() {
  state.stress.fill(0);
  const total = state.width * state.height;
  const seen = new Uint8Array(total);
  const cluster = [];
  const queue = [];

  for (let i = 0; i < total; i++) {
    if (state.cells[i] !== PACKED || seen[i]) continue;
    cluster.length = 0;
    queue.length = 0;
    queue.push(i);
    seen[i] = 1;

    for (let q = 0; q < queue.length; q++) {
      const current = queue[q];
      cluster.push(current);
      const x = current % state.width;
      const y = Math.floor(current / state.width);
      addPackedNeighbor(x - 1, y, seen, queue);
      addPackedNeighbor(x + 1, y, seen, queue);
      addPackedNeighbor(x, y - 1, seen, queue);
      addPackedNeighbor(x, y + 1, seen, queue);
    }

    processCluster(cluster);
  }
}

function addPackedNeighbor(x, y, seen, queue) {
  if (!inBounds(x, y)) return;
  const i = index(x, y);
  if (seen[i] || state.cells[i] !== PACKED) return;
  seen[i] = 1;
  queue.push(i);
}

function processCluster(cluster) {
  let grounded = false;
  const h = state.height;

  for (const i of cluster) {
    if (Math.floor(i / state.width) === h - 1) {
      grounded = true;
      break;
    }
  }

  if (!grounded) {
    for (const i of cluster) setCell(i, LOOSE);
    return;
  }

  const distances = computeSupportDistances(cluster);
  routeClusterLoad(cluster, distances);
}

function computeSupportDistances(cluster) {
  const distances = new Float32Array(state.width * state.height);
  distances.fill(Number.POSITIVE_INFINITY);
  const queue = [];
  let head = 0;

  for (const i of cluster) {
    const y = Math.floor(i / state.width);
    if (y === state.height - 1) {
      distances[i] = 0;
      queue.push(i);
    }
  }

  while (head < queue.length) {
    const current = queue[head++];
    const x = current % state.width;
    const y = Math.floor(current / state.width);
    relaxSupportNeighbor(x - 1, y, current, distances, queue);
    relaxSupportNeighbor(x + 1, y, current, distances, queue);
    relaxSupportNeighbor(x, y - 1, current, distances, queue);
    relaxSupportNeighbor(x, y + 1, current, distances, queue);
  }

  return distances;
}

function relaxSupportNeighbor(x, y, from, distances, queue) {
  if (!inBounds(x, y)) return;
  const next = index(x, y);
  if (state.cells[next] !== PACKED) return;
  const fx = from % state.width;
  const fy = Math.floor(from / state.width);
  const horizontal = y === fy && x !== fx;
  const upward = y < fy;
  const cost =
    1 +
    (horizontal ? controls.bridgePenalty.value : 0) +
    (upward ? 0.25 : 0);
  const candidate = distances[from] + cost;
  if (candidate >= distances[next]) return;
  distances[next] = candidate;
  queue.push(next);
}

function routeClusterLoad(cluster, distances) {
  const loads = new Float32Array(state.width * state.height);
  const parents = new Int32Array(state.width * state.height);
  parents.fill(-1);
  const sorted = [...cluster].sort((a, b) => distances[b] - distances[a]);

  for (const i of sorted) {
    loads[i] += controls.weight.value + looseOverburden(i);
    parents[i] = bestSupportParent(i, distances);
    const bending = bendingPenalty(i, distances);
    const bearing = bearingPenalty(i);
    state.stress[i] = (loads[i] * (1 + bending + bearing)) / supportRelief(i);

    if (parents[i] >= 0) {
      loads[parents[i]] += loads[i];
    }
  }

  for (const i of cluster) {
    const stress = state.stress[i];
    const threshold = controls.cohesion.value;
    if (stress > threshold) {
      const excess = (stress - threshold) / Math.max(threshold, 1);
      state.damage[i] += controls.fatigue.value * excess;
    } else {
      state.damage[i] *= 0.82;
    }

    if (stress > threshold * 1.35 || state.damage[i] >= 1) {
      setCell(i, LOOSE);
    }
  }
}

function looseOverburden(i) {
  const x = i % state.width;
  const y = Math.floor(i / state.width);
  let load = 0;
  for (let yy = y - 1; yy >= 0 && yy >= y - 8; yy--) {
    const above = index(x, yy);
    if (state.cells[above] === LOOSE) load += controls.weight.value * 0.55;
    if (state.cells[above] === EMPTY) break;
  }
  return load;
}

function bestSupportParent(i, distances) {
  const x = i % state.width;
  const y = Math.floor(i / state.width);
  let best = -1;
  let bestDistance = distances[i];
  const candidates = [
    [x, y + 1],
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
  ];

  for (const [nx, ny] of candidates) {
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
  const hasVerticalSupport = below === PACKED || y === state.height - 1;
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
  const neighbors = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
  ];
  for (const [nx, ny] of neighbors) {
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

  let relief = 1;
  const supports = [
    [x, y + 1, 1.7],
    [x - 1, y + 1, 0.65],
    [x + 1, y + 1, 0.65],
    [x - 1, y, 0.35],
    [x + 1, y, 0.35],
  ];

  for (const [nx, ny, value] of supports) {
    if (!inBounds(nx, ny)) continue;
    if (state.cells[index(nx, ny)] === PACKED) relief += value;
  }

  return relief;
}

function render() {
  const wrap = canvas.parentElement.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const simAspect = state.width / state.height;
  const wrapAspect = wrap.width / wrap.height;
  const cssWidth = Math.max(1, Math.floor(wrapAspect > simAspect ? wrap.height * simAspect : wrap.width));
  const cssHeight = Math.max(1, Math.floor(wrapAspect > simAspect ? wrap.height : wrap.width / simAspect));
  const nextWidth = Math.max(1, Math.floor(cssWidth * ratio));
  const nextHeight = Math.max(1, Math.floor(cssHeight * ratio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#2a2d29";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cellW = canvas.width / state.width;
  const cellH = canvas.height / state.height;
  const showStress = controls.stressView.checked;
  const showDamage = controls.damageView.checked;
  const showPackedContours = controls.contourView.checked;
  const threshold = controls.cohesion.value;
  updateVisualStress(showStress);

  drawPackedContourFill(cellW, cellH);

  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const i = index(x, y);
      const cell = state.cells[i];
      if (cell === EMPTY) continue;
      if (cell === PACKED && showPackedContours) continue;

      if (cell === LOOSE) {
        ctx.fillStyle = controls.unifiedColor.checked
          ? colorPacked(x, y)
          : colorLoose(x, y);
      } else if (showDamage) {
        ctx.fillStyle = colorDamage(x, y, state.damage[i]);
      } else if (showStress) {
        ctx.fillStyle = colorStress(x, y, state.visualStress[i], threshold);
      } else {
        ctx.fillStyle = colorPacked(x, y);
      }
      ctx.fillRect(
        Math.floor(x * cellW),
        Math.floor(y * cellH),
        Math.ceil(cellW),
        Math.ceil(cellH),
      );
    }
  }

  drawPackedContourOverlay(cellW, cellH);
  drawPhysicsVehicle(cellW, cellH);
  drawBrushPreview(cellW, cellH);
  updateStats();
}

function updateVisualStress(showStress) {
  const total = state.width * state.height;
  for (let i = 0; i < total; i++) {
    if (state.cells[i] !== PACKED) {
      state.visualStress[i] = 0;
      continue;
    }

    const target = showStress ? state.stress[i] * stressEdgeVisibility(i) : 0;
    state.visualStress[i] += (target - state.visualStress[i]) * STRESS_VISUAL_EASE;
    if (Math.abs(state.visualStress[i]) < 0.001) state.visualStress[i] = 0;
  }
}

function stressEdgeVisibility(i) {
  const x = i % state.width;
  const y = Math.floor(i / state.width);
  const distance = nearestEmptyDistance(x, y, STRESS_EDGE_FADE_CELLS);
  if (distance < 0) return 0;
  const t = Math.max(0, Math.min(1, 1 - (distance - 1) / (STRESS_EDGE_FADE_CELLS - 1)));
  return t * t * (3 - 2 * t);
}

function nearestEmptyDistance(cx, cy, radius) {
  for (let distance = 1; distance <= radius; distance++) {
    for (let dy = -distance; dy <= distance; dy++) {
      for (let dx = -distance; dx <= distance; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== distance) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!inBounds(x, y) || state.cells[index(x, y)] === EMPTY) return distance;
      }
    }
  }
  return -1;
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function addContourEdge(segments, start, end) {
  segments.push({ start, end });
}

function addContourCornerSegment(segments, x, y, from, to) {
  const points = {
    north: { x, y: y - 0.5 },
    east: { x: x + 0.5, y },
    south: { x, y: y + 0.5 },
    west: { x: x - 0.5, y },
  };

  addContourEdge(segments, points[from], points[to]);
}

function isPackedCell(x, y) {
  return inBounds(x, y) && state.cells[index(x, y)] === PACKED;
}

function countPackedCardinalNeighbors(x, y) {
  let count = 0;
  if (isPackedCell(x + 1, y)) count++;
  if (isPackedCell(x - 1, y)) count++;
  if (isPackedCell(x, y + 1)) count++;
  if (isPackedCell(x, y - 1)) count++;
  return count;
}

function isFilledContourCell(x, y) {
  if (!inBounds(x, y)) return false;
  return isPackedCell(x, y) || countPackedCardinalNeighbors(x, y) >= 3;
}

function countFilledContourCardinalNeighbors(x, y) {
  let count = 0;
  if (isFilledContourCell(x + 1, y)) count++;
  if (isFilledContourCell(x - 1, y)) count++;
  if (isFilledContourCell(x, y + 1)) count++;
  if (isFilledContourCell(x, y - 1)) count++;
  return count;
}

function isContourSolidCell(x, y) {
  if (!isFilledContourCell(x, y)) return false;
  if (!isPackedCell(x, y)) return true;
  return countFilledContourCardinalNeighbors(x, y) > 1;
}

function collectPackedContourSegments() {
  const segments = [];

  for (let y = 0; y <= state.height; y++) {
    for (let x = 0; x <= state.width; x++) {
      const northwest = isContourSolidCell(x - 1, y - 1);
      const northeast = isContourSolidCell(x, y - 1);
      const southeast = isContourSolidCell(x, y);
      const southwest = isContourSolidCell(x - 1, y);
      const mask =
        (northwest ? 8 : 0) |
        (northeast ? 4 : 0) |
        (southeast ? 2 : 0) |
        (southwest ? 1 : 0);

      switch (mask) {
        case 1:
        case 14:
          addContourCornerSegment(segments, x, y, "west", "south");
          break;
        case 2:
        case 13:
          addContourCornerSegment(segments, x, y, "south", "east");
          break;
        case 3:
        case 12:
          addContourCornerSegment(segments, x, y, "west", "east");
          break;
        case 4:
        case 11:
          addContourCornerSegment(segments, x, y, "east", "north");
          break;
        case 5:
          addContourCornerSegment(segments, x, y, "east", "north");
          addContourCornerSegment(segments, x, y, "west", "south");
          break;
        case 6:
        case 9:
          addContourCornerSegment(segments, x, y, "south", "north");
          break;
        case 7:
        case 8:
          addContourCornerSegment(segments, x, y, "north", "west");
          break;
        case 10:
          addContourCornerSegment(segments, x, y, "north", "west");
          addContourCornerSegment(segments, x, y, "south", "east");
          break;
      }
    }
  }

  return segments;
}

function stitchContourSegments(segments) {
  const contours = [];
  const connected = new Map();
  const used = new Uint8Array(segments.length);

  for (let i = 0; i < segments.length; i++) {
    for (const point of [segments[i].start, segments[i].end]) {
      const key = pointKey(point);
      const entries = connected.get(key);
      if (entries) entries.push(i);
      else connected.set(key, [i]);
    }
  }

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;

    const contour = [segments[i].start, segments[i].end];
    used[i] = 1;

    while (contour.length < segments.length + 1) {
      const first = contour[0];
      const current = contour[contour.length - 1];
      if (current.x === first.x && current.y === first.y) break;

      const candidates = connected.get(pointKey(current));
      const next = candidates?.find((candidate) => used[candidate] === 0);
      if (next === undefined) break;

      used[next] = 1;
      const segment = segments[next];
      contour.push(pointKey(segment.start) === pointKey(current) ? segment.end : segment.start);
    }

    if (contour.length >= 4) {
      if (pointKey(contour[0]) === pointKey(contour[contour.length - 1])) contour.pop();
      contours.push(contour);
    }
  }

  return contours;
}

function removeConsecutiveDuplicatePoints(points) {
  const unique = [];

  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    unique.push(point);
  }

  if (unique.length > 1) {
    const first = unique[0];
    const last = unique[unique.length - 1];
    if (first.x === last.x && first.y === last.y) unique.pop();
  }

  return unique;
}

function arePointsCollinear(a, b, c) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  return Math.abs(abx * bcy - aby * bcx) < 0.0001;
}

function removeCollinearContourPoints(contour) {
  if (contour.length <= 3) return contour.slice();

  const simplified = [];
  for (let i = 0; i < contour.length; i++) {
    const previous = contour[(i - 1 + contour.length) % contour.length];
    const current = contour[i];
    const next = contour[(i + 1) % contour.length];
    if (arePointsCollinear(previous, current, next)) continue;
    simplified.push(current);
  }

  return simplified.length >= 3 ? simplified : contour.slice();
}

function squaredDistanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    const pointDx = point.x - start.x;
    const pointDy = point.y - start.y;
    return pointDx * pointDx + pointDy * pointDy;
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const projectionX = start.x + t * dx;
  const projectionY = start.y + t * dy;
  const pointDx = point.x - projectionX;
  const pointDy = point.y - projectionY;
  return pointDx * pointDx + pointDy * pointDy;
}

function simplifyContourRun(points, epsilon) {
  if (points.length <= 2) return points.slice();

  let farthestIndex = -1;
  let farthestDistance = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = squaredDistanceToSegment(points[i], start, end);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = i;
    }
  }

  if (farthestDistance <= epsilon * epsilon || farthestIndex === -1) return [start, end];

  const left = simplifyContourRun(points.slice(0, farthestIndex + 1), epsilon);
  const right = simplifyContourRun(points.slice(farthestIndex), epsilon);
  return left.slice(0, -1).concat(right);
}

function turnMagnitude(a, b, c) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const abLength = Math.hypot(abx, aby);
  const bcLength = Math.hypot(bcx, bcy);
  if (abLength === 0 || bcLength === 0) return 0;
  return Math.abs((abx * bcy - aby * bcx) / (abLength * bcLength));
}

function isProtectedContourPoint(contour, pointIndex) {
  const previous = contour[(pointIndex - 1 + contour.length) % contour.length];
  const current = contour[pointIndex];
  const next = contour[(pointIndex + 1) % contour.length];
  const previousLength = Math.hypot(current.x - previous.x, current.y - previous.y);
  const nextLength = Math.hypot(next.x - current.x, next.y - current.y);

  return (
    Math.max(previousLength, nextLength) >= 1.5 &&
    Math.min(previousLength, nextLength) >= 0.95 &&
    turnMagnitude(previous, current, next) > 0.55
  );
}

function protectedContourIndexes(contour) {
  const protectedIndexes = [];

  for (let i = 0; i < contour.length; i++) {
    if (isProtectedContourPoint(contour, i)) protectedIndexes.push(i);
  }

  if (protectedIndexes.length < 2) {
    let splitIndex = 0;
    for (let i = 1; i < contour.length; i++) {
      if (contour[i].x < contour[splitIndex].x || (contour[i].x === contour[splitIndex].x && contour[i].y < contour[splitIndex].y)) {
        splitIndex = i;
      }
    }

    let farthestIndex = splitIndex === 0 ? 1 : 0;
    let farthestDistance = -1;
    for (let i = 0; i < contour.length; i++) {
      if (i === splitIndex) continue;
      const dx = contour[i].x - contour[splitIndex].x;
      const dy = contour[i].y - contour[splitIndex].y;
      const distance = dx * dx + dy * dy;
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = i;
      }
    }

    return [splitIndex, farthestIndex].sort((a, b) => a - b);
  }

  return protectedIndexes;
}

function contourRunBetween(contour, startIndex, endIndex) {
  const run = [contour[startIndex]];
  let i = startIndex;

  while (i !== endIndex) {
    i = (i + 1) % contour.length;
    run.push(contour[i]);
  }

  return run;
}

function orientation(a, b, c) {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(cross) < 0.0001) return 0;
  return cross > 0 ? 1 : -1;
}

function isPointOnSegment(point, start, end) {
  return (
    Math.min(start.x, end.x) - 0.0001 <= point.x &&
    point.x <= Math.max(start.x, end.x) + 0.0001 &&
    Math.min(start.y, end.y) - 0.0001 <= point.y &&
    point.y <= Math.max(start.y, end.y) + 0.0001 &&
    orientation(start, end, point) === 0
  );
}

function doSegmentsIntersect(aStart, aEnd, bStart, bEnd) {
  const a1 = orientation(aStart, aEnd, bStart);
  const a2 = orientation(aStart, aEnd, bEnd);
  const b1 = orientation(bStart, bEnd, aStart);
  const b2 = orientation(bStart, bEnd, aEnd);

  if (a1 !== a2 && b1 !== b2) return true;
  if (a1 === 0 && isPointOnSegment(bStart, aStart, aEnd)) return true;
  if (a2 === 0 && isPointOnSegment(bEnd, aStart, aEnd)) return true;
  if (b1 === 0 && isPointOnSegment(aStart, bStart, bEnd)) return true;
  if (b2 === 0 && isPointOnSegment(aEnd, bStart, bEnd)) return true;
  return false;
}

function hasContourSelfIntersection(contour) {
  for (let i = 0; i < contour.length; i++) {
    const aStart = contour[i];
    const aEnd = contour[(i + 1) % contour.length];

    for (let j = i + 1; j < contour.length; j++) {
      if (j === i || j === (i + 1) % contour.length || i === (j + 1) % contour.length) continue;
      const bStart = contour[j];
      const bEnd = contour[(j + 1) % contour.length];
      if (doSegmentsIntersect(aStart, aEnd, bStart, bEnd)) return true;
    }
  }

  return false;
}

function adaptContourAngles(contour) {
  if (contour.length < CONTOUR_ADAPTIVE_MIN_POINTS) return contour.slice();

  const anchors = protectedContourIndexes(contour);
  const adapted = [];

  for (let i = 0; i < anchors.length; i++) {
    const startIndex = anchors[i];
    const endIndex = anchors[(i + 1) % anchors.length];
    const run = contourRunBetween(contour, startIndex, endIndex);
    const simplified = simplifyContourRun(run, CONTOUR_ADAPTIVE_EPSILON);
    adapted.push(...(i === 0 ? simplified : simplified.slice(1)));
  }

  const cleaned = removeCollinearContourPoints(removeConsecutiveDuplicatePoints(adapted));
  return cleaned.length >= 3 && !hasContourSelfIntersection(cleaned) ? cleaned : contour.slice();
}

function roundContourCorners(contour) {
  if (contour.length < 3 || CONTOUR_CORNER_CONNECTOR_LENGTH <= 0) return contour.slice();

  const rounded = [];

  for (let i = 0; i < contour.length; i++) {
    const previous = contour[(i - 1 + contour.length) % contour.length];
    const current = contour[i];
    const next = contour[(i + 1) % contour.length];
    const incomingX = previous.x - current.x;
    const incomingY = previous.y - current.y;
    const outgoingX = next.x - current.x;
    const outgoingY = next.y - current.y;
    const incomingLength = Math.hypot(incomingX, incomingY);
    const outgoingLength = Math.hypot(outgoingX, outgoingY);

    if (incomingLength < 0.0001 || outgoingLength < 0.0001 || arePointsCollinear(previous, current, next)) {
      rounded.push(current);
      continue;
    }

    const incomingUnit = {
      x: incomingX / incomingLength,
      y: incomingY / incomingLength,
    };
    const outgoingUnit = {
      x: outgoingX / outgoingLength,
      y: outgoingY / outgoingLength,
    };
    const turnAngle = Math.acos(Math.max(-1, Math.min(1, -(incomingUnit.x * outgoingUnit.x + incomingUnit.y * outgoingUnit.y))));
    if (turnAngle > CONTOUR_CORNER_CONNECTOR_MAX_ANGLE) {
      rounded.push(current);
      continue;
    }

    const connectorScale = Math.hypot(outgoingUnit.x - incomingUnit.x, outgoingUnit.y - incomingUnit.y);

    if (connectorScale < 0.0001) {
      rounded.push(current);
      continue;
    }

    const maxInset = Math.min(incomingLength, outgoingLength) * 0.75;
    const inset = Math.min(maxInset, CONTOUR_CORNER_CONNECTOR_LENGTH / connectorScale);
    if (inset < 0.0001) {
      rounded.push(current);
      continue;
    }

    rounded.push({
      x: current.x + incomingUnit.x * inset,
      y: current.y + incomingUnit.y * inset,
    });
    rounded.push({
      x: current.x + outgoingUnit.x * inset,
      y: current.y + outgoingUnit.y * inset,
    });
  }

  const cleaned = removeConsecutiveDuplicatePoints(rounded);
  return cleaned.length >= 3 && !hasContourSelfIntersection(cleaned) ? cleaned : contour.slice();
}

function rebuildPackedContours() {
  const segments = collectPackedContourSegments();
  const contours = stitchContourSegments(segments);
  packedContours = contours.map((contour) => {
    const cleaned = removeCollinearContourPoints(removeConsecutiveDuplicatePoints(contour));
    return roundContourCorners(adaptContourAngles(cleaned));
  });
  packedContourCacheTick = state.tick;
  isPackedContourCacheDirty = false;
}

function updatePackedContourCache() {
  if (!isPackedContourCacheDirty && state.tick - packedContourCacheTick < CONTOUR_REBUILD_INTERVAL_TICKS) return;
  rebuildPackedContours();
}

function tracePackedContour(contour, cellW, cellH) {
  ctx.beginPath();
  ctx.moveTo(contour[0].x * cellW, contour[0].y * cellH);
  for (let i = 1; i < contour.length; i++) {
    ctx.lineTo(contour[i].x * cellW, contour[i].y * cellH);
  }
  ctx.closePath();
}

function drawPackedContourFill(cellW, cellH) {
  if (!controls.contourView.checked) return;

  updatePackedContourCache();

  ctx.save();
  ctx.fillStyle = PACKED_CONTOUR_FILL;

  for (const contour of packedContours) {
    if (contour.length < 3) continue;
    tracePackedContour(contour, cellW, cellH);
    ctx.fill("evenodd");
  }

  ctx.restore();
}

function drawPackedContourOverlay(cellW, cellH) {
  if (!controls.contourView.checked) return;

  updatePackedContourCache();

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = PACKED_CONTOUR_STROKE;
  ctx.lineWidth = Math.max(1.5, Math.min(cellW, cellH) * 0.7);
  ctx.lineJoin = "bevel";
  ctx.lineCap = "butt";

  for (const contour of packedContours) {
    if (contour.length < 3) continue;
    tracePackedContour(contour, cellW, cellH);
    ctx.stroke();
  }

  ctx.restore();
}

function rebuildPhysicsTerrain() {
  if (!isPhysicsTerrainDirty && !isPackedContourCacheDirty) return;

  updatePackedContourCache();

  if (physicsTerrainBody) physicsWorld.destroyBody(physicsTerrainBody);
  physicsTerrainBody = physicsWorld.createBody();

  for (const contour of packedContours) {
    if (contour.length < 3) continue;

    const vertices = contour.map((point) => Vec2(point.x, point.y));
    physicsTerrainBody.createFixture({
      shape: Chain(vertices, true),
      friction: 1.4,
      restitution: 0,
    });
  }

  isPhysicsTerrainDirty = false;
}

function destroyPhysicsBody(body) {
  if (body) physicsWorld.destroyBody(body);
}

function vehicleStartPosition() {
  return {
    x: Math.max(12, Math.min(state.width - 12, Math.floor(state.width * 0.4))),
    y: Math.max(10, Math.min(state.height - 10, Math.floor(state.height * 0.6))),
  };
}

function resetPhysicsVehicle() {
  destroyPhysicsBody(physicsChassisBody);
  destroyPhysicsBody(physicsLeftWheelBody);
  destroyPhysicsBody(physicsRightWheelBody);

  physicsLeftWheelJoint = null;
  physicsRightWheelJoint = null;

  const start = vehicleStartPosition();
  physicsChassisBody = physicsWorld.createDynamicBody({
    position: Vec2(start.x, start.y),
    angularDamping: 1.2,
    linearDamping: 0.08,
  });
  physicsChassisBody.createFixture({
    shape: Box(5.8, 1.15),
    density: 0.65,
    friction: 0.6,
    restitution: 0.05,
  });

  physicsLeftWheelBody = physicsWorld.createDynamicBody({
    position: Vec2(start.x - 4.2, start.y + VEHICLE_WHEEL_Y_OFFSET),
    angularDamping: 0.15,
  });
  physicsLeftWheelBody.createFixture({
    shape: Circle(VEHICLE_WHEEL_RADIUS),
    density: 1.35,
    friction: VEHICLE_TIRE_FRICTION,
    restitution: 0.02,
  });

  physicsRightWheelBody = physicsWorld.createDynamicBody({
    position: Vec2(start.x + 4.2, start.y + VEHICLE_WHEEL_Y_OFFSET),
    angularDamping: 0.15,
  });
  physicsRightWheelBody.createFixture({
    shape: Circle(VEHICLE_WHEEL_RADIUS),
    density: 1.35,
    friction: VEHICLE_TIRE_FRICTION,
    restitution: 0.02,
  });

  const jointOptions = {
    enableMotor: false,
    maxMotorTorque: VEHICLE_MOTOR_TORQUE,
    motorSpeed: 0,
    frequencyHz: 4,
    dampingRatio: 0.75,
  };

  physicsLeftWheelJoint = physicsWorld.createJoint(WheelJoint(
    jointOptions,
    physicsChassisBody,
    physicsLeftWheelBody,
    physicsLeftWheelBody.getPosition(),
    Vec2(0, 1),
  ));
  physicsRightWheelJoint = physicsWorld.createJoint(WheelJoint(
    jointOptions,
    physicsChassisBody,
    physicsRightWheelBody,
    physicsRightWheelBody.getPosition(),
    Vec2(0, 1),
  ));
}

function updateVehicleMotor() {
  const drive = Number(isDrivingRight) - Number(isDrivingLeft);
  const motorSpeed = drive * VEHICLE_MOTOR_SPEED;
  const leftGrounded = isWheelGrounded(physicsLeftWheelBody);
  const rightGrounded = isWheelGrounded(physicsRightWheelBody);
  const hasThrottle = drive !== 0;

  physicsLeftWheelJoint?.enableMotor(leftGrounded && hasThrottle);
  physicsRightWheelJoint?.enableMotor(rightGrounded && hasThrottle);
  physicsLeftWheelJoint?.setMotorSpeed(leftGrounded ? motorSpeed : 0);
  physicsRightWheelJoint?.setMotorSpeed(rightGrounded ? motorSpeed : 0);
}

function isWheelGrounded(wheelBody) {
  if (!wheelBody || !physicsTerrainBody) return false;

  for (let edge = wheelBody.getContactList(); edge; edge = edge.next) {
    if (edge.other === physicsTerrainBody && edge.contact.isTouching()) return true;
  }

  return false;
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function flipVehicleUpright() {
  if (!physicsChassisBody) return;

  const angle = normalizeAngle(physicsChassisBody.getAngle());
  const isOnBack = Math.cos(angle) < 0;
  if (!isOnBack) return;

  const sideImpulse = (Math.random() * 2 - 1) * VEHICLE_FLIP_SIDE_IMPULSE;
  const chassisCenter = physicsChassisBody.getWorldCenter();
  const rotationDirection = angle >= 0 ? -1 : 1;

  physicsChassisBody.applyLinearImpulse(Vec2(sideImpulse, -VEHICLE_FLIP_UPWARD_IMPULSE), chassisCenter, true);
  physicsChassisBody.applyAngularImpulse(rotationDirection * VEHICLE_FLIP_ANGULAR_IMPULSE, true);
  physicsLeftWheelBody?.applyLinearImpulse(Vec2(sideImpulse * 0.25, -VEHICLE_FLIP_UPWARD_IMPULSE * 0.35), physicsLeftWheelBody.getWorldCenter(), true);
  physicsRightWheelBody?.applyLinearImpulse(Vec2(sideImpulse * 0.25, -VEHICLE_FLIP_UPWARD_IMPULSE * 0.35), physicsRightWheelBody.getWorldCenter(), true);
}

function stepPhysics(delta) {
  rebuildPhysicsTerrain();
  updateVehicleMotor();

  physicsAccumulator += delta / 1000;
  let iterations = 0;
  while (physicsAccumulator >= PHYSICS_STEP_SECONDS && iterations < 5) {
    physicsWorld.step(PHYSICS_STEP_SECONDS, 8, 3);
    physicsAccumulator -= PHYSICS_STEP_SECONDS;
    iterations++;
  }

  if (physicsChassisBody && physicsChassisBody.getPosition().y > state.height + 35) {
    resetPhysicsVehicle();
  }
}

function drawPhysicsBox(body, halfWidth, halfHeight, fillStyle, strokeStyle, cellW, cellH) {
  const position = body.getPosition();
  const angle = body.getAngle();
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ];

  ctx.beginPath();
  for (let i = 0; i < corners.length; i++) {
    const [localX, localY] = corners[i];
    const worldX = position.x + localX * cos - localY * sin;
    const worldY = position.y + localX * sin + localY * cos;
    const canvasX = worldX * cellW;
    const canvasY = worldY * cellH;
    if (i === 0) ctx.moveTo(canvasX, canvasY);
    else ctx.lineTo(canvasX, canvasY);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
}

function drawPhysicsWheel(body, radius, cellW, cellH) {
  const position = body.getPosition();
  const angle = body.getAngle();
  const canvasX = position.x * cellW;
  const canvasY = position.y * cellH;
  const canvasRadius = radius * Math.min(cellW, cellH);

  ctx.beginPath();
  ctx.arc(canvasX, canvasY, canvasRadius, 0, Math.PI * 2);
  ctx.fillStyle = "#181c21";
  ctx.strokeStyle = "#f3d173";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(canvasX, canvasY);
  ctx.lineTo(canvasX + Math.cos(angle) * canvasRadius, canvasY + Math.sin(angle) * canvasRadius);
  ctx.strokeStyle = "#f8f1dc";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawPhysicsVehicle(cellW, cellH) {
  if (!physicsChassisBody || !physicsLeftWheelBody || !physicsRightWheelBody) return;

  ctx.save();
  drawPhysicsBox(physicsChassisBody, 5.8, 1.15, "#d9563f", "#ffe0a3", cellW, cellH);
  drawPhysicsWheel(physicsLeftWheelBody, VEHICLE_WHEEL_RADIUS, cellW, cellH);
  drawPhysicsWheel(physicsRightWheelBody, VEHICLE_WHEEL_RADIUS, cellW, cellH);
  ctx.restore();
}

function isEditableTarget(target) {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
}

function colorLoose(x, y) {
  const shade = (x * 13 + y * 7 + state.tick) % 19;
  return `rgb(${178 + shade}, ${129 + Math.floor(shade * 0.45)}, ${70 + Math.floor(shade * 0.25)})`;
}

function colorPacked(x, y) {
  const shade = (x * 11 + y * 5) % 16;
  return `rgb(${118 + shade}, ${83 + Math.floor(shade * 0.35)}, 58)`;
}

function colorDamage(x, y, damage) {
  const shade = (x * 11 + y * 5) % 16;
  const fracture = Math.min(1, Math.max(0, damage));
  const r = Math.floor(118 + shade + fracture * 52);
  const g = Math.floor(83 + Math.floor(shade * 0.35) - fracture * 16);
  const b = Math.floor(58 - fracture * 30);
  return `rgb(${r}, ${g}, ${b})`;
}

function colorStress(x, y, stress, threshold) {
  const shade = (x * 11 + y * 5) % 16;
  const pressure = Math.min(1, Math.max(0, stress / Math.max(threshold, 1)));
  const darken = Math.floor(pressure * 34);
  const r = Math.max(78, 118 + shade - darken);
  const g = Math.max(56, 83 + Math.floor(shade * 0.35) - Math.floor(darken * 0.72));
  const b = Math.max(39, 58 - Math.floor(darken * 0.48));
  return `rgb(${r}, ${g}, ${b})`;
}

let pointerCell = null;

function brushCells(cx, cy) {
  const size = Math.max(1, Math.round(controls.brushSize.value));
  const left = cx - Math.floor(size / 2);
  const top = cy - Math.floor(size / 2);
  const cells = [];
  const center = size / 2;
  const radiusSq = center * center;

  for (let localY = 0; localY < size; localY++) {
    for (let localX = 0; localX < size; localX++) {
      if (state.brushShape === "circle") {
        const dx = localX + 0.5 - center;
        const dy = localY + 0.5 - center;
        if (dx * dx + dy * dy > radiusSq + 0.0001) continue;
      }

      const x = left + localX;
      const y = top + localY;
      if (inBounds(x, y)) cells.push({ x, y });
    }
  }

  return cells;
}

function drawBrushPreview(cellW, cellH) {
  if (!pointerCell) return;
  const cells = brushCells(pointerCell.x, pointerCell.y);
  if (cells.length === 0) return;

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.lineWidth = Math.max(1, Math.min(cellW, cellH) * 0.35);

  for (const cell of cells) {
    const x = Math.floor(cell.x * cellW);
    const y = Math.floor(cell.y * cellH);
    const width = Math.ceil(cellW);
    const height = Math.ceil(cellH);
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, width - 1), Math.max(1, height - 1));
  }

  ctx.restore();
}

function updateStats() {
  let loose = 0;
  let packed = 0;
  let hot = 0;
  const threshold = controls.cohesion.value;
  for (let i = 0; i < state.cells.length; i++) {
    if (state.cells[i] === LOOSE) loose++;
    if (state.cells[i] === PACKED) {
      packed++;
      if (state.stress[i] > threshold) hot++;
    }
  }
  document.querySelector("#stats").textContent =
    `${packed} packed / ${loose} loose / ${hot} failing / tick ${state.tick}`;
}

function paintAtEvent(event) {
  pointerCell = cellFromEvent(event);
  if (!pointerCell) return;
  paintBrush(pointerCell.x, pointerCell.y);
}

function cellFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.width);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.height);
  return inBounds(x, y) ? { x, y } : null;
}

function paintBrush(cx, cy) {
  for (const cell of brushCells(cx, cy)) {
    const i = index(cell.x, cell.y);
    if (state.tool === "erase") clearCell(i);
    if (state.tool === "loose") setCell(i, LOOSE);
    if (state.tool === "packed") setCell(i, PACKED);
  }
}

function frame(now = performance.now()) {
  const delta = Math.min(100, now - lastFrame);
  lastFrame = now;

  if (state.running) {
    for (let n = 0; n < controls.speed.value; n++) simulationStep();
  }
  stepPhysics(delta);
  render();
  requestAnimationFrame(frame);
}

document.querySelector("#playPause").addEventListener("click", (event) => {
  state.running = !state.running;
  event.currentTarget.textContent = state.running ? "Pause" : "Play";
});

document.querySelector("#step").addEventListener("click", () => {
  simulationStep();
  render();
});

document.querySelector("#seed").addEventListener("click", () => {
  seedWorld();
  resetPhysicsVehicle();
});

document.querySelector("#clear").addEventListener("click", () => {
  state.cells.fill(EMPTY);
  state.ages.fill(0);
  state.damage.fill(0);
  state.stress.fill(0);
  state.visualStress.fill(0);
  state.vx.fill(0);
  state.vy.fill(0);
  state.touched.fill(0);
  state.tick = 0;
  packedContours = [];
  markPackedTerrainDirty();
  resetPhysicsVehicle();
});

document.querySelector("#resize").addEventListener("click", () => {
  resizeGrid(controls.gridWidth.value, controls.gridHeight.value);
  resetPhysicsVehicle();
});

controls.resetVehicle.addEventListener("click", () => {
  resetPhysicsVehicle();
});

document.querySelectorAll(".mode").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".mode").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    state.tool = button.dataset.tool;
  });
});

document.querySelectorAll(".shape").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".shape").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    state.brushShape = button.dataset.brushShape;
  });
});

canvas.addEventListener("pointerdown", (event) => {
  state.painting = true;
  canvas.setPointerCapture(event.pointerId);
  paintAtEvent(event);
});

canvas.addEventListener("pointermove", (event) => {
  pointerCell = cellFromEvent(event);
  if (state.painting) paintAtEvent(event);
});

canvas.addEventListener("pointerup", (event) => {
  state.painting = false;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointerleave", () => {
  pointerCell = null;
});

window.addEventListener("keydown", (event) => {
  if (isEditableTarget(event.target)) return;
  if (event.repeat) return;

  if (event.code === "KeyA" || event.code === "ArrowLeft") {
    isDrivingLeft = true;
    event.preventDefault();
  } else if (event.code === "KeyD" || event.code === "ArrowRight") {
    isDrivingRight = true;
    event.preventDefault();
  } else if (event.code === "KeyW" || event.code === "ArrowUp") {
    flipVehicleUpright();
    event.preventDefault();
  } else if (event.code === "KeyR") {
    resetPhysicsVehicle();
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  if (isEditableTarget(event.target)) return;

  if (event.code === "KeyA" || event.code === "ArrowLeft") {
    isDrivingLeft = false;
    event.preventDefault();
  } else if (event.code === "KeyD" || event.code === "ArrowRight") {
    isDrivingRight = false;
    event.preventDefault();
  }
});

resizeGrid(state.width, state.height);
rebuildPhysicsTerrain();
resetPhysicsVehicle();
requestAnimationFrame(frame);
