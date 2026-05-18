import {
  Box,
  Chain,
  Circle,
  DistanceJoint,
  Polygon,
  RevoluteJoint,
  Vec2,
  WheelJoint,
  World,
} from "planck";
import boomSvg from "./excavator_images/boom.svg?raw";
import chassisSvg from "./excavator_images/chassis.svg?raw";
import headTopSvg from "./excavator_images/head_top.svg?raw";
import jawBottomSvg from "./excavator_images/jaw_bottom.svg?raw";
import stickSvg from "./excavator_images/stick.svg?raw";
import tailSvg from "./excavator_images/tail.svg?raw";

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
const DIRT_STEP_SECONDS = 1 / 30;
const DIRT_MAX_FRAME_SLICES = 3;
const VEHICLE_MOTOR_SPEED = 24;
const VEHICLE_MOTOR_TORQUE = 5200;
const VEHICLE_WHEEL_RADIUS = 2.4;
const VEHICLE_WHEEL_Y_OFFSET = 2.9;
const VEHICLE_TIRE_FRICTION = 11;
const VEHICLE_FLIP_UPWARD_IMPULSE = 430;
const VEHICLE_FLIP_SIDE_IMPULSE = 90;
const VEHICLE_FLIP_ANGULAR_IMPULSE = 520;
const VEHICLE_CHASSIS_HALF_WIDTH = 5.8;
const VEHICLE_CHASSIS_HALF_HEIGHT = 1.15;
const VEHICLE_CHASSIS_DENSITY = 0.9;
const VEHICLE_WHEEL_DENSITY = 1.8;
const VEHICLE_SUSPENSION_FREQUENCY = 6.5;
const VEHICLE_SUSPENSION_DAMPING = 0.9;
const VEHICLE_LOAD_SCALE = 0.18;
const VEHICLE_BREAK_SPEED = 6;
const VEHICLE_BREAK_DAMAGE = 0.0225;
const VEHICLE_LOOSE_KICK = 0.45;
const EXCAVATOR_SCALE = 2.25;
const EXCAVATOR_SOURCE_ART_SCALE = 0.0118;
const EXCAVATOR_ART_SCALE = EXCAVATOR_SOURCE_ART_SCALE * EXCAVATOR_SCALE;
const EXCAVATOR_HEAD_JAW_ART_SCALE = EXCAVATOR_ART_SCALE;
const EXCAVATOR_DRIVE_SPEED = 20;
const EXCAVATOR_MOTOR_TORQUE = 980;
const EXCAVATOR_WHEEL_FRICTION = 9.5;
const EXCAVATOR_SUSPENSION_FREQUENCY = 7.4;
const EXCAVATOR_SUSPENSION_DAMPING = 0.74;
const EXCAVATOR_TREAD_LINK_FREQUENCY = 18;
const EXCAVATOR_CHASSIS_DENSITY = 0.82;
const EXCAVATOR_WHEEL_DENSITY = 1.2;
const EXCAVATOR_ARM_SPEED = 2.7;
const EXCAVATOR_DIRECT_TARGET_SPEED = 9.2;
const EXCAVATOR_DIRECT_HEAD_TURN_SPEED = 1.45;
const EXCAVATOR_JAW_OPEN_ANGLE = 0.48;
const EXCAVATOR_JAW_CLOSED_ANGLE = -0.2;
const EXCAVATOR_COLLISION_GROUP = -3;
const EXCAVATOR_FACING_RIGHT = 1;
const EXCAVATOR_FACING_LEFT = -1;
const EXCAVATOR_GAMEPAD_DEADZONE = 0.14;
const EXCAVATOR_FLIP_UPWARD_IMPULSE = 780;
const EXCAVATOR_FLIP_SIDE_IMPULSE = 120;
const EXCAVATOR_FLIP_ANGULAR_IMPULSE = 900;
const EXCAVATOR_FRACTURE_LOAD_MULTIPLIER = 0.78;
const EXCAVATOR_ARM_SERVO = {
  boomAngle: { gain: 3.1, damping: 0.28, speedScale: 1 },
  stickAngle: { gain: 2.8, damping: 0.34, speedScale: 1.02 },
  headAngle: { gain: 1.55, damping: 0.72, speedScale: 0.7 },
  jawAngle: { gain: 1.45, damping: 0.68, speedScale: 0.82 },
};
const PACKED_CONTOUR_FILL = "#76533a";
const PACKED_CONTOUR_STROKE = "#3f2518";
const VEHICLE_FRACTURE_OFFSETS = [
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
const PACKED_COLOR_CHANNELS = Array.from({ length: 16 }, (_, shade) => ({
  r: 118 + shade,
  g: 83 + Math.floor(shade * 0.35),
  b: 58,
}));
const PACKED_COLORS = PACKED_COLOR_CHANNELS.map(({ r, g, b }) => `rgb(${r}, ${g}, ${b})`);
const LOOSE_COLORS = Array.from({ length: 19 }, (_, shade) => {
  return `rgb(${178 + shade}, ${129 + Math.floor(shade * 0.45)}, ${70 + Math.floor(shade * 0.25)})`;
});

const excavatorSvgSources = {
  boom: boomSvg,
  chassis: chassisSvg,
  headTop: headTopSvg,
  jawBottom: jawBottomSvg,
  stick: stickSvg,
  tail: tailSvg,
};

const excavatorSvg = {
  chassis: {
    viewBox: { width: 426.82097, height: 340.82208 },
    pivot: Vec2(236.6112, 57.62656),
  },
  boom: {
    viewBox: { width: 333.5395, height: 96.427896 },
    pivot: Vec2(45.4245129294211, 58.82864074727431),
    end: Vec2(297.2951131711393, 59.348611535867065),
  },
  stick: {
    viewBox: { width: 306.4821, height: 93.074541 },
    pivot: Vec2(39.42127534470046, 40.65460805369406),
    end: Vec2(282.2326913485542, 39.58668016199704),
  },
  headTop: {
    viewBox: { width: 364.81359, height: 189.71103 },
    pivot: Vec2(32.98793999999998, 137.32751000000002),
  },
  jawBottom: {
    viewBox: { width: 369.43248, height: 170.07074 },
    pivot: Vec2(32.16271999999998, 42.527180000000016),
  },
  tail: {
    viewBox: { width: 703.45694, height: 272.80054 },
    pivot: Vec2(688.4090006070649, 144.29343079847774),
  },
};

const canvas = document.querySelector("#sim");
const ctx = canvas.getContext("2d");
const canvasWrap = canvas.parentElement;
const statsElement = document.querySelector("#stats");
const playPauseButton = document.querySelector("#playPause");
const stepButton = document.querySelector("#step");
const seedButton = document.querySelector("#seed");
const clearButton = document.querySelector("#clear");
const resizeButton = document.querySelector("#resize");
const modeButtons = Array.from(document.querySelectorAll(".mode"));
const shapeButtons = Array.from(document.querySelectorAll(".shape"));
const excavatorImages = createExcavatorImages();

const canvasLayout = {
  dirty: true,
  ratio: 0,
  gridWidth: 0,
  gridHeight: 0,
  cellW: 1,
  cellH: 1,
};

const statsCache = {
  dirty: true,
  tick: -1,
  threshold: Number.NaN,
};

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
let dirtAccumulator = 0;
let physicsTerrainBody = null;
let physicsExcavator = null;
let sharedWheelSpeed = 0;
let isDrivingLeft = false;
let isDrivingRight = false;
let desiredDrive = 0;
let canvasResizeObserver = null;
let lastFrame = performance.now();

const activeKeys = new Set();
const pointerArmControl = {
  active: false,
  lastX: 0,
  lastY: 0,
  deltaLocal: Vec2(0, 0),
  lastInputAt: 0,
};
const joypad = {
  supported: typeof navigator !== "undefined" && typeof navigator.getGamepads === "function",
  connected: false,
  index: null,
  drive: 0,
  armX: 0,
  armY: 0,
  headTurn: 0,
  jawOpen: false,
  lastAButton: false,
  lastYButton: false,
  active: false,
};

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
  visualX: null,
  visualY: null,
  rigid: null,
  rigidVx: null,
  rigidVy: null,
  rigidMass: null,
  externalLoad: null,
  vx: null,
  vy: null,
  touched: null,
  clusterSeen: null,
  clusterSeenToken: 0,
  clusterCells: [],
  clusterQueue: [],
  supportDistances: null,
  supportLoads: null,
  supportQueue: [],
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

function markCanvasLayoutDirty() {
  canvasLayout.dirty = true;
}

function syncCanvasLayout() {
  const ratio = window.devicePixelRatio || 1;
  if (
    !canvasLayout.dirty &&
    canvasLayout.ratio === ratio &&
    canvasLayout.gridWidth === state.width &&
    canvasLayout.gridHeight === state.height
  ) {
    return;
  }

  const wrap = canvasWrap.getBoundingClientRect();
  const simAspect = state.width / state.height;
  const wrapAspect = wrap.width / wrap.height;
  const cssWidth = Math.max(1, Math.floor(wrapAspect > simAspect ? wrap.height * simAspect : wrap.width));
  const cssHeight = Math.max(1, Math.floor(wrapAspect > simAspect ? wrap.height : wrap.width / simAspect));
  const nextWidth = Math.max(1, Math.floor(cssWidth * ratio));
  const nextHeight = Math.max(1, Math.floor(cssHeight * ratio));

  const cssWidthValue = `${cssWidth}px`;
  const cssHeightValue = `${cssHeight}px`;
  if (canvas.style.width !== cssWidthValue) canvas.style.width = cssWidthValue;
  if (canvas.style.height !== cssHeightValue) canvas.style.height = cssHeightValue;
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  canvasLayout.dirty = false;
  canvasLayout.ratio = ratio;
  canvasLayout.gridWidth = state.width;
  canvasLayout.gridHeight = state.height;
  canvasLayout.cellW = canvas.width / state.width;
  canvasLayout.cellH = canvas.height / state.height;
}

function markStatsDirty() {
  statsCache.dirty = true;
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
  state.visualX = new Float32Array(total);
  state.visualY = new Float32Array(total);
  state.rigid = new Uint8Array(total);
  state.rigidVx = new Float32Array(total);
  state.rigidVy = new Float32Array(total);
  state.rigidMass = new Float32Array(total);
  state.externalLoad = new Float32Array(total);
  state.vx = new Int16Array(total);
  state.vy = new Int16Array(total);
  state.touched = new Uint32Array(total);
  state.clusterSeen = new Uint32Array(total);
  state.clusterSeenToken = 0;
  state.supportDistances = new Float32Array(total);
  state.supportLoads = new Float32Array(total);
  state.tick = 0;
  markCanvasLayoutDirty();
  markStatsDirty();
  seedWorld();
}

function resetCellVisualPosition(i) {
  state.visualX[i] = i % state.width;
  state.visualY[i] = Math.floor(i / state.width);
}

function settleDirtVisualPositions() {
  const total = state.width * state.height;
  for (let i = 0; i < total; i++) resetCellVisualPosition(i);
}

function dirtTweenProgress() {
  if (!state.running) return 1;
  const t = Math.max(0, Math.min(1, dirtAccumulator / DIRT_STEP_SECONDS));
  return t * t * (3 - 2 * t);
}

function index(x, y) {
  return y * state.width + x;
}

function inBounds(x, y) {
  return x >= 0 && x < state.width && y >= 0 && y < state.height;
}

function isEmptyForDirt(i) {
  return state.cells[i] === EMPTY && state.rigid[i] === 0;
}

function isSolidForDirt(i) {
  return state.cells[i] !== EMPTY || state.rigid[i] !== 0;
}

function clearCell(i, shouldMarkStats = true) {
  const wasPacked = state.cells[i] === PACKED;
  state.cells[i] = EMPTY;
  state.ages[i] = 0;
  state.damage[i] = 0;
  state.stress[i] = 0;
  state.visualStress[i] = 0;
  state.vx[i] = 0;
  state.vy[i] = 0;
  state.touched[i] = 0;
  resetCellVisualPosition(i);
  if (shouldMarkStats) markStatsDirty();
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
  resetCellVisualPosition(i);
  markStatsDirty();
  if (wasPacked || kind === PACKED) markPackedTerrainDirty();
}

function markPackedTerrainDirty() {
  isPackedContourCacheDirty = true;
  isPhysicsTerrainDirty = true;
}

function seedWorld() {
  markPackedTerrainDirty();
  markStatsDirty();
  dirtAccumulator = 0;
  state.cells.fill(EMPTY);
  state.ages.fill(0);
  state.damage.fill(0);
  state.stress.fill(0);
  state.visualStress.fill(0);
  settleDirtVisualPositions();
  state.rigid.fill(0);
  state.rigidVx.fill(0);
  state.rigidVy.fill(0);
  state.rigidMass.fill(0);
  state.externalLoad.fill(0);
  state.vx.fill(0);
  state.vy.fill(0);
  state.touched.fill(0);

  const w = state.width;
  const h = state.height;
  const floor = Math.floor(h * 2 / 3);

  for (let y = floor; y < h; y++) {
    for (let x = 0; x < w; x++) {
      setCell(index(x, y), PACKED);
    }
  }
}

function simulationStep() {
  state.tick++;
  updateVehicleGridInfluence();
  updateLoose();
  analyzePackedClusters();
}

function updateVehicleGridInfluence() {
  state.rigid.fill(0);
  state.rigidVx.fill(0);
  state.rigidVy.fill(0);
  state.rigidMass.fill(0);
  state.externalLoad.fill(0);

  for (const body of getExcavatorBodies()) {
    rasterizeVehicleBody(body);
  }
  applyVehicleTerrainEffects();
}

function rasterizeVehicleBody(body) {
  if (!body) return;

  const fixtures = [];
  for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
    fixtures.push(fixture);
  }
  if (!fixtures.length) return;

  const massShare = Math.max(0.01, body.getMass()) / fixtures.length;
  for (const fixture of fixtures) {
    const shape = fixture.getShape();
    if (shape.m_vertices) {
      rasterizeVehiclePolygon(body, shape.m_vertices, massShare);
    } else if (shape.m_radius != null) {
      rasterizeVehicleCircleShape(body, shape, massShare);
    }
  }
}

function rasterizeVehiclePolygon(body, localVertices, massShare) {
  if (!localVertices?.length) return;

  const vertices = localVertices.map((vertex) => body.getWorldPoint(vertex));
  const bounds = polygonBounds(vertices, 1);
  const area = Math.max(1, polygonArea(vertices));
  const cellMass = (massShare / area) * EXCAVATOR_FRACTURE_LOAD_MULTIPLIER;

  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (!isPointInPolygon(x + 0.5, y + 0.5, vertices)) continue;
      markVehicleCell(x, y, body, cellMass);
    }
  }
}

function rasterizeVehicleCircleShape(body, shape, massShare) {
  const center = shape.m_p ? body.getWorldPoint(shape.m_p) : body.getPosition();
  const radius = shape.m_radius;

  const minX = Math.max(0, Math.floor(center.x - radius - 1));
  const maxX = Math.min(state.width - 1, Math.ceil(center.x + radius + 1));
  const minY = Math.max(0, Math.floor(center.y - radius - 1));
  const maxY = Math.min(state.height - 1, Math.ceil(center.y + radius + 1));
  const radiusSq = radius * radius;
  const area = Math.max(1, Math.PI * radiusSq);
  const cellMass = (massShare / area) * EXCAVATOR_FRACTURE_LOAD_MULTIPLIER;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - center.x;
      const dy = y + 0.5 - center.y;
      if (dx * dx + dy * dy > radiusSq) continue;
      markVehicleCell(x, y, body, cellMass);
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

function markVehicleCell(x, y, body, cellMass) {
  const i = index(x, y);
  const velocity = body.getLinearVelocityFromWorldPoint(Vec2(x + 0.5, y + 0.5));
  const previousMass = state.rigidMass[i];
  const nextMass = previousMass + cellMass;

  state.rigid[i] = 1;
  state.rigidVx[i] = (state.rigidVx[i] * previousMass + velocity.x * cellMass) / nextMass;
  state.rigidVy[i] = (state.rigidVy[i] * previousMass + velocity.y * cellMass) / nextMass;
  state.rigidMass[i] = nextMass;
}

function applyVehicleTerrainEffects() {
  const total = state.width * state.height;
  for (let i = 0; i < total; i++) {
    if (!state.rigid[i]) continue;

    const x = i % state.width;
    const y = Math.floor(i / state.width);
    const speed = Math.hypot(state.rigidVx[i], state.rigidVy[i]);
    const load = state.rigidMass[i] * VEHICLE_LOAD_SCALE;

    if (y < state.height - 1) {
      const below = index(x, y + 1);
      if (state.cells[below] === PACKED) state.externalLoad[below] += load;
    }

    if (speed < VEHICLE_BREAK_SPEED) continue;
    const impact = (speed - VEHICLE_BREAK_SPEED) * VEHICLE_BREAK_DAMAGE * Math.max(1, state.rigidMass[i]);
    fracturePackedNearVehicle(x, y, impact, state.rigidVx[i], state.rigidVy[i]);
  }
}

function fracturePackedNearVehicle(x, y, impact, vx, vy) {
  for (const [dx, dy] of VEHICLE_FRACTURE_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny)) continue;
    const i = index(nx, ny);
    if (state.cells[i] !== PACKED) continue;

    state.damage[i] += impact;
    if (state.damage[i] < 1 && impact < 0.35) continue;

    setCell(i, LOOSE);
    state.vx[i] = clampVelocity(vx * VEHICLE_LOOSE_KICK);
    state.vy[i] = clampVelocity(Math.max(0, vy * VEHICLE_LOOSE_KICK));
    state.touched[i] = state.tick;
  }
}

function updateLoose() {
  const w = state.width;
  const h = state.height;
  const settings = {
    settleTicks: controls.settleTicks.value,
    spread: controls.spread.value,
    jitter: controls.jitter.value,
  };
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
  if (state.rigid[start] && pushLooseOutOfVehicle(start) !== start) return;

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

function collideLooseWithVehicle(i, vehicleCell, axis) {
  const vehicleVelocity = axis === "x" ? state.rigidVx[vehicleCell] : state.rigidVy[vehicleCell];
  const kick = quantizeVelocity(vehicleVelocity * 0.35);

  if (axis === "x") {
    state.vx[i] = kick;
    state.vy[i] = reduceTowardZero(state.vy[i]);
  } else {
    state.vy[i] = Math.min(0, kick);
    state.vx[i] = quantizeVelocity(state.rigidVx[vehicleCell] * 0.25);
  }
}

function pushLooseOutOfVehicle(i) {
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

      if (state.rigid[target]) collideLooseWithVehicle(current, target, axis);
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

function analyzePackedClusters() {
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

    processCluster(cluster);
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

function processCluster(cluster) {
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

  const distances = computeSupportDistances(cluster, controls.bridgePenalty.value);
  routeClusterLoad(cluster, distances);
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

function routeClusterLoad(cluster, distances) {
  const loads = state.supportLoads;
  const particleWeight = controls.weight.value;
  const threshold = controls.cohesion.value;
  const fatigue = controls.fatigue.value;

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

function render() {
  syncCanvasLayout();

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#2a2d29";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cellW = canvasLayout.cellW;
  const cellH = canvasLayout.cellH;
  const showStress = controls.stressView.checked;
  const showDamage = controls.damageView.checked;
  const showPackedContours = controls.contourView.checked;
  const threshold = controls.cohesion.value;
  const dirtTween = dirtTweenProgress();
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
        const drawX = state.visualX[i] + (x - state.visualX[i]) * dirtTween;
        const drawY = state.visualY[i] + (y - state.visualY[i]) * dirtTween;
        ctx.fillRect(
          drawX * cellW,
          drawY * cellH,
          Math.ceil(cellW),
          Math.ceil(cellH),
        );
        continue;
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
  const terrainTop = Math.floor(state.height * 2 / 3);
  const vehicleClearance = 6.2;
  return {
    x: Math.max(18, Math.min(state.width - 18, Math.floor(state.width * 0.36))),
    y: Math.max(10, Math.min(state.height - 10, Math.floor(terrainTop - vehicleClearance))),
  };
}

function resetPhysicsVehicle() {
  destroyExcavator(physicsExcavator);
  const start = vehicleStartPosition();
  physicsExcavator = createExcavator(Vec2(start.x, start.y), EXCAVATOR_FACING_RIGHT);
  sharedWheelSpeed = 0;
  desiredDrive = 0;
  pointerArmControl.deltaLocal = Vec2(0, 0);
}

function createExcavator(position, facing = EXCAVATOR_FACING_RIGHT, savedState = {}) {
  const direction = facing === EXCAVATOR_FACING_LEFT ? EXCAVATOR_FACING_LEFT : EXCAVATOR_FACING_RIGHT;
  const chassis = physicsWorld.createDynamicBody({
    type: "dynamic",
    position,
    angle: savedState.angle ?? 0,
    angularDamping: 0.85,
    linearDamping: 0.12,
    bullet: true,
  });
  chassis.setUserData({ kind: "excavator", part: "chassis" });

  chassis.createFixture({
    shape: Polygon(mirrorSourceVertices([
      Vec2(-2.72, -0.5),
      Vec2(-2.24, -0.82),
      Vec2(2.36, -0.82),
      Vec2(2.82, -0.5),
      Vec2(2.58, 0.58),
      Vec2(-2.52, 0.64),
    ], direction)),
    density: EXCAVATOR_CHASSIS_DENSITY,
    friction: 0.75,
    restitution: 0,
    filterGroupIndex: EXCAVATOR_COLLISION_GROUP,
  });
  chassis.createFixture({
    shape: Polygon(mirrorSourceVertices([
      Vec2(-2.1, 0.52),
      Vec2(2.25, 0.5),
      Vec2(2.38, 1.18),
      Vec2(1.2, 2.74),
      Vec2(-0.8, 3.16),
      Vec2(-2.06, 1.46),
    ], direction)),
    density: EXCAVATOR_CHASSIS_DENSITY * 0.16,
    friction: 0.7,
    restitution: 0,
    filterGroupIndex: EXCAVATOR_COLLISION_GROUP,
  });

  const wheels = [];
  const wheelJoints = [];
  const linkJoints = [];
  const radius = 0.38 * EXCAVATOR_SCALE;

  for (const local of makeTreadLoop(direction)) {
    const wheel = physicsWorld.createDynamicBody({
      position: chassis.getWorldPoint(local),
      angularDamping: 0.12,
      linearDamping: 0.05,
      bullet: true,
    });
    wheel.setUserData({ kind: "excavator", part: "wheel" });
    wheel.createFixture({
      shape: Circle(radius),
      density: EXCAVATOR_WHEEL_DENSITY,
      friction: EXCAVATOR_WHEEL_FRICTION,
      restitution: 0,
      filterGroupIndex: EXCAVATOR_COLLISION_GROUP,
    });
    wheels.push({ body: wheel, local, radius });

    wheelJoints.push(physicsWorld.createJoint(WheelJoint({
      enableMotor: true,
      motorSpeed: 0,
      maxMotorTorque: EXCAVATOR_MOTOR_TORQUE,
      frequencyHz: EXCAVATOR_SUSPENSION_FREQUENCY,
      dampingRatio: EXCAVATOR_SUSPENSION_DAMPING,
    }, chassis, wheel, wheel.getPosition(), Vec2(0, 1))));
  }

  for (let i = 0; i < wheels.length; i++) {
    const a = wheels[i].body;
    const b = wheels[(i + 1) % wheels.length].body;
    const length = vecDistance(a.getPosition(), b.getPosition());
    linkJoints.push(physicsWorld.createJoint(DistanceJoint({
      frequencyHz: EXCAVATOR_TREAD_LINK_FREQUENCY,
      dampingRatio: 0.85,
      collideConnected: false,
      length,
    }, a, b, a.getPosition(), b.getPosition())));
  }

  return {
    facing: direction,
    chassis,
    wheels,
    wheelJoints,
    linkJoints,
    arm: createExcavatorArm(chassis, direction, savedState.arm),
    tail: createExcavatorTail(chassis, direction, savedState.tail),
    chassisArtPivotLocal: sourceLocal(0.52, 2.78, direction),
    radius,
    drivePhase: savedState.drivePhase ?? 0,
  };
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function createExcavatorArm(chassis, facing = EXCAVATOR_FACING_RIGHT, savedState = {}) {
  const boomLength = svgDistance(excavatorSvg.boom.pivot, excavatorSvg.boom.end) * EXCAVATOR_ART_SCALE;
  const stickLength = svgDistance(excavatorSvg.stick.pivot, excavatorSvg.stick.end) * EXCAVATOR_ART_SCALE;
  const headLength = (excavatorSvg.headTop.viewBox.width - excavatorSvg.headTop.pivot.x - 18) * EXCAVATOR_HEAD_JAW_ART_SCALE;
  const targetPose = savedState?.targetPose ?? orientArmPoseForFacing({
    boomAngle: -1.05,
    stickAngle: 1.22,
    headAngle: 0.5,
    jawAngle: EXCAVATOR_JAW_CLOSED_ANGLE,
  }, facing);
  const arm = {
    chassis,
    facing,
    baseLocal: sourceLocal(0.97, 2.33, facing),
    boomLength,
    stickLength,
    headLength,
    headTipOffset: Vec2(headLength * 0.9 * facing, 0.56 * EXCAVATOR_SCALE),
    boomWidth: 0.42 * EXCAVATOR_SCALE,
    stickWidth: 0.4 * EXCAVATOR_SCALE,
    jawOpenAngle: EXCAVATOR_JAW_OPEN_ANGLE * facing,
    jawClosedAngle: EXCAVATOR_JAW_CLOSED_ANGLE * facing,
    forwardLimits: createArmLimits(EXCAVATOR_FACING_RIGHT),
    limits: createArmLimits(facing),
    motorTorque: {
      boomAngle: 18000,
      stickAngle: 14500,
      headAngle: 8200,
      jawAngle: 5200,
    },
    targetWorld: null,
    directTargetLocal: null,
    desiredHeadAbs: null,
    directLimit: false,
    targetPose,
  };

  const initialPoints = getArmLocalPointsForPose(arm, arm.targetPose);
  const boomBody = createArmSegmentBody(
    chassis,
    segmentCenter(initialPoints.base, initialPoints.elbow),
    arm.targetPose.boomAngle,
    arm.boomLength,
    arm.boomWidth,
    0.2,
    "boom",
  );
  const stickBody = createArmSegmentBody(
    chassis,
    segmentCenter(initialPoints.elbow, initialPoints.wrist),
    initialPoints.stickAbs,
    arm.stickLength,
    arm.stickWidth,
    0.18,
    "stick",
  );
  const headTopBody = createHeadBody(chassis, initialPoints.wrist, initialPoints.headAbs, facing, headLength);
  const jawBottomBody = createJawBody(chassis, initialPoints.wrist, initialPoints.headAbs + arm.targetPose.jawAngle, facing, headLength);

  arm.bodies = {
    boom: boomBody,
    stick: stickBody,
    headTop: headTopBody,
    jawBottom: jawBottomBody,
  };
  arm.joints = {
    boomAngle: createArmJoint(chassis, boomBody, chassis.getWorldPoint(initialPoints.base), arm.limits.boomAngle, arm.motorTorque.boomAngle),
    stickAngle: createArmJoint(boomBody, stickBody, chassis.getWorldPoint(initialPoints.elbow), arm.limits.stickAngle, arm.motorTorque.stickAngle),
    headAngle: createArmJoint(stickBody, headTopBody, chassis.getWorldPoint(initialPoints.wrist), arm.limits.headAngle, arm.motorTorque.headAngle),
    jawAngle: createArmJoint(headTopBody, jawBottomBody, chassis.getWorldPoint(initialPoints.wrist), arm.limits.jawAngle, arm.motorTorque.jawAngle),
  };

  arm.workspaceSample = sampleArmWorkspace(arm, 0.06);
  arm.workspaceBounds = getWorkspaceBounds(arm.workspaceSample);
  arm.directTargetLocal = savedState?.directTargetLocal
    ? Vec2(savedState.directTargetLocal.x, savedState.directTargetLocal.y)
    : Vec2(initialPoints.wrist.x, initialPoints.wrist.y);
  arm.desiredHeadAbs = savedState?.desiredHeadAbs ?? initialPoints.headAbs;
  arm.targetWorld = chassis.getWorldPoint(arm.directTargetLocal);

  return arm;
}

function createArmLimits(facing) {
  const rightLimits = {
    boomAngle: [-2.05, 0.65],
    stickAngle: [-1.42, 2.72],
    headAngle: [-1.05, 1.45],
    jawAngle: [-0.28, 0.58],
  };

  if (facing === EXCAVATOR_FACING_RIGHT) return rightLimits;
  return Object.fromEntries(Object.entries(rightLimits).map(([key, [min, max]]) => [
    key,
    [-max, -min],
  ]));
}

function orientArmPoseForFacing(pose, facing) {
  return {
    boomAngle: pose.boomAngle * facing,
    stickAngle: pose.stickAngle * facing,
    headAngle: pose.headAngle * facing,
    jawAngle: pose.jawAngle * facing,
  };
}

function createExcavatorTail(chassis, facing = EXCAVATOR_FACING_RIGHT, savedState = {}) {
  return {
    chassis,
    facing,
    localPivot: sourceLocal(-1.84, 0.72, facing),
    baseAngle: Math.PI / 4,
    offset: savedState?.offset ?? 0,
    velocity: savedState?.velocity ?? 0,
  };
}

function createArmSegmentBody(chassis, centerLocal, angleLocal, length, width, density, part) {
  const body = physicsWorld.createDynamicBody({
    position: chassis.getWorldPoint(centerLocal),
    angle: chassis.getAngle() + angleLocal,
    angularDamping: 1.8,
    linearDamping: 0.35,
    bullet: true,
  });
  body.setUserData({ kind: "excavator", part });
  body.createFixture({
    shape: Box(length * 0.5, width * 0.5),
    density: density * 0.75,
    friction: 0.85,
    restitution: 0,
    filterGroupIndex: EXCAVATOR_COLLISION_GROUP,
  });
  return body;
}

function createHeadBody(chassis, wristLocal, angleLocal, facing, headLength) {
  const body = physicsWorld.createDynamicBody({
    position: chassis.getWorldPoint(wristLocal),
    angle: chassis.getAngle() + angleLocal,
    angularDamping: 5.2,
    linearDamping: 0.82,
    bullet: true,
  });
  body.setUserData({ kind: "excavator", part: "headTop" });
  body.createFixture({
    shape: Polygon(getHeadTopLocalVertices(headLength, facing)),
    density: 0.035,
    friction: 0.92,
    restitution: 0.01,
    filterGroupIndex: EXCAVATOR_COLLISION_GROUP,
  });
  return body;
}

function createJawBody(chassis, wristLocal, angleLocal, facing, headLength) {
  const body = physicsWorld.createDynamicBody({
    position: chassis.getWorldPoint(wristLocal),
    angle: chassis.getAngle() + angleLocal,
    angularDamping: 5.8,
    linearDamping: 0.88,
    bullet: true,
  });
  body.setUserData({ kind: "excavator", part: "jawBottom" });
  body.createFixture({
    shape: Polygon(getJawBottomLocalVertices(headLength, facing)),
    density: 0.03,
    friction: 0.95,
    restitution: 0.01,
    filterGroupIndex: EXCAVATOR_COLLISION_GROUP,
  });
  return body;
}

function getHeadTopLocalVertices(length, facing = EXCAVATOR_FACING_RIGHT) {
  return mirrorDirtVertices([
    Vec2(-0.06 * EXCAVATOR_SCALE, -0.24 * EXCAVATOR_SCALE),
    Vec2(0.38 * EXCAVATOR_SCALE, 0.92 * EXCAVATOR_SCALE),
    Vec2(length * 0.58, 1.18 * EXCAVATOR_SCALE),
    Vec2(length, 0.44 * EXCAVATOR_SCALE),
    Vec2(length * 0.95, -0.22 * EXCAVATOR_SCALE),
    Vec2(0.42 * EXCAVATOR_SCALE, -0.44 * EXCAVATOR_SCALE),
  ], facing);
}

function getJawBottomLocalVertices(length, facing = EXCAVATOR_FACING_RIGHT) {
  return mirrorDirtVertices([
    Vec2(-0.05 * EXCAVATOR_SCALE, 0.12 * EXCAVATOR_SCALE),
    Vec2(0.58 * EXCAVATOR_SCALE, 0.22 * EXCAVATOR_SCALE),
    Vec2(length, -0.42 * EXCAVATOR_SCALE),
    Vec2(length * 0.92, -1.3 * EXCAVATOR_SCALE),
    Vec2(0.48 * EXCAVATOR_SCALE, -1.12 * EXCAVATOR_SCALE),
    Vec2(-0.08 * EXCAVATOR_SCALE, -0.16 * EXCAVATOR_SCALE),
  ], facing);
}

function createArmJoint(parent, child, anchorWorld, limits, maxMotorTorque) {
  return physicsWorld.createJoint(RevoluteJoint({
    referenceAngle: 0,
    enableLimit: true,
    lowerAngle: limits[0],
    upperAngle: limits[1],
    enableMotor: true,
    motorSpeed: 0,
    maxMotorTorque,
    collideConnected: false,
  }, parent, child, anchorWorld));
}

function sourceLocal(x, y, facing = EXCAVATOR_FACING_RIGHT) {
  return Vec2(x * EXCAVATOR_SCALE * facing, -y * EXCAVATOR_SCALE);
}

function mirrorSourceVertices(vertices, facing) {
  const converted = vertices.map((vertex) => sourceLocal(vertex.x, vertex.y, facing));
  return facing === EXCAVATOR_FACING_RIGHT ? converted : converted.reverse();
}

function mirrorDirtVertices(vertices, facing) {
  const converted = vertices.map((vertex) => Vec2(vertex.x * facing, -vertex.y));
  return facing === EXCAVATOR_FACING_RIGHT ? converted : converted.reverse();
}

function makeTreadLoop(facing = EXCAVATOR_FACING_RIGHT) {
  const points = [];
  const halfLength = 2.45;
  const topY = -0.34;
  const bottomY = -1.16;
  const endRadius = (topY - bottomY) * 0.5;
  const centerY = (topY + bottomY) * 0.5;

  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    points.push(sourceLocal(-halfLength + t * halfLength * 2, bottomY, facing));
  }

  for (let i = 2; i <= 4; i += 2) {
    const theta = -Math.PI / 2 + (i / 5) * Math.PI;
    points.push(sourceLocal(halfLength + Math.cos(theta) * endRadius, centerY + Math.sin(theta) * endRadius, facing));
  }

  for (let i = 1; i < 7; i++) {
    const t = i / 6;
    points.push(sourceLocal(halfLength - t * halfLength * 2, topY, facing));
  }

  for (let i = 2; i <= 4; i += 2) {
    const theta = Math.PI / 2 + (i / 5) * Math.PI;
    points.push(sourceLocal(-halfLength + Math.cos(theta) * endRadius, centerY + Math.sin(theta) * endRadius, facing));
  }

  return points;
}

function segmentCenter(a, b) {
  return Vec2((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
}

function svgDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function svgPivotAngle(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function vecDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updateVehicleMotor(dt) {
  if (!physicsExcavator) return;

  pollJoypad();
  desiredDrive = getDriveInput();
  const targetSpeed = desiredDrive * EXCAVATOR_DRIVE_SPEED;
  const driveSign = Math.sign(targetSpeed);

  if (driveSign === 0) {
    sharedWheelSpeed *= Math.pow(0.025, dt);
  } else {
    sharedWheelSpeed += (targetSpeed - sharedWheelSpeed) * Math.min(1, dt * 3.8);
    const signedSpeeds = physicsExcavator.wheels.map((wheel) => wheel.body.getAngularVelocity() * driveSign);
    const slowest = Math.min(...signedSpeeds);
    const lockedLimit = Math.max(0, slowest + 2.2);
    const signedTarget = Math.abs(sharedWheelSpeed);
    if (signedTarget > lockedLimit) sharedWheelSpeed = driveSign * lockedLimit;
  }

  for (const joint of physicsExcavator.wheelJoints) {
    joint.setMotorSpeed(sharedWheelSpeed);
    joint.setMaxMotorTorque(EXCAVATOR_MOTOR_TORQUE);
  }

  const averageSpin = physicsExcavator.wheels.reduce((sum, wheel) => sum + wheel.body.getAngularVelocity(), 0) / physicsExcavator.wheels.length;
  physicsExcavator.drivePhase += averageSpin * physicsExcavator.radius * dt * 1.15;
  updateArm(dt);
  updateTail(dt);
}

function getDriveInput() {
  if (joypad.active && Math.abs(joypad.drive) > 0) return joypad.drive;
  return Number(isDrivingRight) - Number(isDrivingLeft);
}

function updateArm(dt) {
  const arm = physicsExcavator?.arm;
  if (!arm) return;

  ensureDirectArmTarget(arm);
  clampDesiredHeadAbsToCurrentPose(arm);
  updateDirectHeadTarget(arm, dt);

  const jawAngle = joypad.jawOpen ? arm.jawOpenAngle : arm.jawClosedAngle;
  const blockedByInput = moveDirectArmTarget(arm, dt, jawAngle);
  const solved = solveDirectArmPose(arm, arm.directTargetLocal, jawAngle);

  if (solved) {
    arm.targetPose = solved;
    clampDesiredHeadAbsToPose(arm, arm.targetPose);
    arm.directLimit = blockedByInput;
  } else {
    arm.targetPose = { ...arm.targetPose, jawAngle };
    clampDesiredHeadAbsToCurrentPose(arm);
    arm.directLimit = true;
  }

  driveArmJoints(arm, arm.targetPose);
  arm.targetWorld = arm.chassis.getWorldPoint(arm.directTargetLocal);
}

function ensureDirectArmTarget(arm) {
  if (arm.directTargetLocal && arm.desiredHeadAbs != null) return;

  const points = getArmLocalPoints(arm);
  arm.directTargetLocal = Vec2(points.wrist.x, points.wrist.y);
  arm.desiredHeadAbs = clampHeadAbsToPoseLimits(arm, points.headAbs, getArmJointAngles(arm));
  arm.targetWorld = arm.chassis.getWorldPoint(arm.directTargetLocal);
}

function updateDirectHeadTarget(arm, dt) {
  const headTurn = getCombinedHeadTurn();
  if (!headTurn) return;
  arm.desiredHeadAbs = clampHeadAbsToPoseLimits(
    arm,
    normalizeAngle(arm.desiredHeadAbs + headTurn * EXCAVATOR_DIRECT_HEAD_TURN_SPEED * getPrecisionScale() * dt),
    getArmJointAngles(arm),
  );
}

function moveDirectArmTarget(arm, dt, jawAngle) {
  const keyboardVector = getKeyboardArmVector();
  const armX = keyboardVector.x + joypad.armX;
  const armY = keyboardVector.y + joypad.armY;
  const stickMagnitude = Math.hypot(armX, armY);
  const pointerDelta = pointerArmControl.deltaLocal;
  pointerArmControl.deltaLocal = Vec2(0, 0);

  if (stickMagnitude <= 0 && Math.hypot(pointerDelta.x, pointerDelta.y) <= 0) return false;

  const scale = Math.min(1, stickMagnitude);
  const worldDelta = Vec2(
    stickMagnitude > 0 ? (armX / stickMagnitude) * scale * EXCAVATOR_DIRECT_TARGET_SPEED * getPrecisionScale() * dt : 0,
    stickMagnitude > 0 ? (armY / stickMagnitude) * scale * EXCAVATOR_DIRECT_TARGET_SPEED * getPrecisionScale() * dt : 0,
  );
  const stickDelta = rotateVec(worldDelta, -physicsExcavator.chassis.getAngle());
  const dx = stickDelta.x + pointerDelta.x;
  const dy = stickDelta.y + pointerDelta.y;
  const current = arm.directTargetLocal;
  const fullMove = Vec2(current.x + dx, current.y + dy);

  if (trySetDirectArmTarget(arm, fullMove, jawAngle)) return false;

  const xOnly = Vec2(current.x + dx, current.y);
  const yOnly = Vec2(current.x, current.y + dy);
  const first = Math.abs(dx) >= Math.abs(dy) ? xOnly : yOnly;
  const second = first === xOnly ? yOnly : xOnly;

  if (trySetDirectArmTarget(arm, first, jawAngle)) return false;
  if (trySetDirectArmTarget(arm, second, jawAngle)) return false;
  return true;
}

function getKeyboardArmVector() {
  let x = 0;
  let y = 0;
  if (activeKeys.has("KeyJ")) x -= 1;
  if (activeKeys.has("KeyL")) x += 1;
  if (activeKeys.has("KeyI") || activeKeys.has("KeyW")) y -= 1;
  if (activeKeys.has("KeyK") || activeKeys.has("KeyS")) y += 1;
  const magnitude = Math.hypot(x, y);
  if (magnitude <= 1) return Vec2(x, y);
  return Vec2(x / magnitude, y / magnitude);
}

function trySetDirectArmTarget(arm, targetLocal, jawAngle) {
  const clamped = clampArmTargetToWorkspace(arm, targetLocal);
  const solved = solveDirectArmPose(arm, clamped, jawAngle);
  if (!solved) return false;
  arm.directTargetLocal = clamped;
  arm.targetPose = solved;
  clampDesiredHeadAbsToPose(arm, solved);
  arm.directLimit = false;
  return true;
}

function clampDesiredHeadAbsToCurrentPose(arm) {
  arm.desiredHeadAbs = clampHeadAbsToPoseLimits(arm, arm.desiredHeadAbs, getArmJointAngles(arm));
}

function clampDesiredHeadAbsToPose(arm, pose) {
  arm.desiredHeadAbs = clampHeadAbsToPoseLimits(arm, arm.desiredHeadAbs, pose);
}

function clampHeadAbsToPoseLimits(arm, targetHeadAbs, pose) {
  const stickAbs = normalizeAngle(pose.boomAngle + pose.stickAngle);
  const [headMin, headMax] = arm.limits.headAngle;
  const localHead = clamp(normalizeAngle(targetHeadAbs - stickAbs), headMin, headMax);
  return normalizeAngle(stickAbs + localHead);
}

function clampArmTargetToWorkspace(arm, targetLocal) {
  const bounds = arm.workspaceBounds;
  if (!bounds) return targetLocal;
  return Vec2(
    clamp(targetLocal.x, bounds.minX, bounds.maxX),
    clamp(targetLocal.y, bounds.minY, bounds.maxY),
  );
}

function solveDirectArmPose(arm, targetLocal, jawAngle) {
  return findBestArmPose(arm, targetLocal, {
    headAbs: arm.desiredHeadAbs,
    jawAngle,
  });
}

function getCombinedHeadTurn() {
  return joypad.headTurn +
    (activeKeys.has("KeyQ") ? -1 : 0) +
    (activeKeys.has("KeyE") ? 1 : 0);
}

function getPrecisionScale() {
  return activeKeys.has("ShiftLeft") || activeKeys.has("ShiftRight") ? 0.35 : 1;
}

function driveArmJoints(arm, pose) {
  driveArmJoint(arm, "boomAngle", pose.boomAngle);
  driveArmJoint(arm, "stickAngle", pose.stickAngle);
  driveArmJoint(arm, "headAngle", pose.headAngle);
  driveArmJoint(arm, "jawAngle", pose.jawAngle);
}

function driveArmJoint(arm, key, target) {
  const joint = arm.joints[key];
  const servo = EXCAVATOR_ARM_SERVO[key];
  const error = normalizeAngle(target - joint.getJointAngle());
  const damping = joint.getJointSpeed() * servo.damping;
  const maxSpeed = EXCAVATOR_ARM_SPEED * servo.speedScale;
  const motorSpeed = clamp(error * EXCAVATOR_ARM_SPEED * servo.gain - damping, -maxSpeed, maxSpeed);
  joint.setMaxMotorTorque(arm.motorTorque[key]);
  joint.setMotorSpeed(Math.abs(error) < 0.01 ? 0 : motorSpeed);
}

function findBestArmPose(arm, wristLocal, options = {}) {
  const candidates = findArmIKCandidates(arm, wristLocal, options);
  return candidates[0]?.pose ?? null;
}

function findArmIKCandidates(arm, wristLocal, options = {}) {
  const current = getArmJointAngles(arm);
  const candidates = [];
  const desiredHeadAbs = options.headAbs ?? normalizeAngle(current.boomAngle + current.stickAngle + current.headAngle);
  const desiredHeadForward = normalizeAngle(desiredHeadAbs * arm.facing);
  const jawAngleForward = clamp(
    (options.jawAngle ?? current.jawAngle ?? arm.jawClosedAngle) * arm.facing,
    arm.forwardLimits.jawAngle[0],
    arm.forwardLimits.jawAngle[1],
  );
  const dx = (wristLocal.x - arm.baseLocal.x) * arm.facing;
  const dy = wristLocal.y - arm.baseLocal.y;
  const l1 = arm.boomLength;
  const l2 = arm.stickLength;
  const distance = Math.hypot(dx, dy);
  const minReach = Math.abs(l1 - l2) + 0.04 * EXCAVATOR_SCALE;
  const maxReach = l1 + l2 - 0.04 * EXCAVATOR_SCALE;
  if (distance < minReach || distance > maxReach) return candidates;

  const theta = Math.atan2(dy, dx);
  const elbowMagnitude = Math.acos(clamp((distance * distance - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1));
  for (const stickAngle of [elbowMagnitude, -elbowMagnitude]) {
    const boomAngle = normalizeAngle(theta - Math.atan2(l2 * Math.sin(stickAngle), l1 + l2 * Math.cos(stickAngle)));
    const stickAngleLocal = normalizeAngle(stickAngle);
    const idealHeadAngle = normalizeAngle(desiredHeadForward - boomAngle - stickAngleLocal);
    const headAngle = clamp(idealHeadAngle, arm.forwardLimits.headAngle[0], arm.forwardLimits.headAngle[1]);
    const pose = orientArmPoseForFacing({
      boomAngle,
      stickAngle: stickAngleLocal,
      headAngle,
      jawAngle: jawAngleForward,
    }, arm.facing);
    if (!isArmPoseValid(arm, pose)) continue;
    candidates.push({
      pose,
      score: scoreArmCandidate(arm, pose, current, desiredHeadAbs),
    });
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates;
}

function isArmPoseValid(arm, pose) {
  if (!isArmPoseWithinLimits(arm, pose, 0)) return false;
  const points = getArmLocalPointsForPose(arm, pose);
  if (points.wrist.x * arm.facing < -2.6 * EXCAVATOR_SCALE || points.tip.x * arm.facing < -2.8 * EXCAVATOR_SCALE) return false;
  if (vecDistance(points.wrist, points.base) < 0.42 * EXCAVATOR_SCALE) return false;
  return true;
}

function isArmPoseWithinLimits(arm, pose, margin = 0) {
  return Object.entries(arm.limits).every(([key, [min, max]]) => (
    pose[key] >= min + margin && pose[key] <= max - margin
  ));
}

function scoreArmCandidate(arm, pose, current, desiredHeadAbs) {
  const headAbs = normalizeAngle(pose.boomAngle + pose.stickAngle + pose.headAngle);
  const continuity =
    angleDelta(pose.boomAngle, current.boomAngle) * 1.1 +
    angleDelta(pose.stickAngle, current.stickAngle) * 0.85 +
    angleDelta(pose.headAngle, current.headAngle) * 0.42 +
    angleDelta(pose.jawAngle, current.jawAngle) * 0.18;
  const orientation = angleDelta(headAbs, desiredHeadAbs) * 0.9;
  const speed =
    Math.abs(arm.joints.boomAngle.getJointSpeed()) * 0.018 +
    Math.abs(arm.joints.stickAngle.getJointSpeed()) * 0.014 +
    Math.abs(arm.joints.headAngle.getJointSpeed()) * 0.008 +
    Math.abs(arm.joints.jawAngle.getJointSpeed()) * 0.006;
  const limitPenalty = Object.entries(arm.limits).reduce((sum, [key, [min, max]]) => {
    const clearance = Math.min(pose[key] - min, max - pose[key]);
    return sum + Math.max(0, 0.18 - clearance) * 1.8;
  }, 0);

  return continuity + orientation + speed + limitPenalty;
}

function sampleArmWorkspace(arm, step = 0.3) {
  const samples = [];
  const [boomMin, boomMax] = arm.limits.boomAngle;
  const [stickMin, stickMax] = arm.limits.stickAngle;

  for (let boomAngle = boomMin; boomAngle <= boomMax; boomAngle += step) {
    for (let stickAngle = stickMin; stickAngle <= stickMax; stickAngle += step) {
      const pose = { boomAngle, stickAngle, headAngle: arm.targetPose.headAngle, jawAngle: arm.jawClosedAngle };
      if (isArmPoseValid(arm, pose)) samples.push(getArmLocalPointsForPose(arm, pose).wrist);
    }
  }

  return samples;
}

function getWorkspaceBounds(samples) {
  if (!samples.length) return null;
  return samples.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxY: Math.max(bounds.maxY, point.y),
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  });
}

function rotateVec(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return Vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

function angleDelta(a, b) {
  return Math.abs(normalizeAngle(a - b));
}

function updateTail(dt) {
  const tail = physicsExcavator?.tail;
  if (!tail) return;

  const driveTarget = clamp(-sharedWheelSpeed * 0.012 - physicsExcavator.chassis.getAngularVelocity() * 0.035, -0.18, 0.18);
  const spring = (driveTarget - tail.offset) * 42;
  const damping = tail.velocity * 8.5;
  tail.velocity += (spring - damping) * dt;
  tail.offset = clamp(tail.offset + tail.velocity * dt, -0.26, 0.26);
}

function pollJoypad() {
  if (!joypad.supported) return;

  const gamepads = navigator.getGamepads?.();
  const gamepad = joypad.index != null && gamepads?.[joypad.index]?.connected
    ? gamepads[joypad.index]
    : Array.from(gamepads ?? []).find((candidate) => candidate?.connected);

  if (!gamepad) {
    joypad.connected = false;
    joypad.index = null;
    joypad.drive = 0;
    joypad.armX = 0;
    joypad.armY = 0;
    joypad.headTurn = 0;
    joypad.active = false;
    joypad.lastAButton = false;
    joypad.lastYButton = false;
    return;
  }

  joypad.connected = true;
  joypad.index = gamepad.index;
  const leftX = applyStickDeadzone(gamepad.axes[0] ?? 0);
  const rightX = applyStickDeadzone(gamepad.axes[2] ?? 0);
  const rightY = applyStickDeadzone(gamepad.axes[3] ?? 0);
  const aPressed = isGamepadButtonPressed(gamepad.buttons[0]);
  const yPressed = isGamepadButtonPressed(gamepad.buttons[3]);
  const leftBumper = isGamepadButtonPressed(gamepad.buttons[4]);
  const rightBumper = isGamepadButtonPressed(gamepad.buttons[5]);

  if (aPressed && !joypad.lastAButton) joypad.jawOpen = !joypad.jawOpen;
  if (yPressed && !joypad.lastYButton) flipExcavatorFacing();

  joypad.lastAButton = aPressed;
  joypad.lastYButton = yPressed;
  joypad.drive = leftX;
  joypad.armX = rightX;
  joypad.armY = rightY;
  joypad.headTurn = (leftBumper ? -1 : 0) + (rightBumper ? 1 : 0);
  joypad.active = (
    Math.abs(leftX) > 0 ||
    Math.abs(rightX) > 0 ||
    Math.abs(rightY) > 0 ||
    aPressed ||
    yPressed ||
    leftBumper ||
    rightBumper
  );
}

function applyStickDeadzone(value) {
  const magnitude = Math.abs(value);
  if (magnitude < EXCAVATOR_GAMEPAD_DEADZONE) return 0;
  return Math.sign(value) * ((magnitude - EXCAVATOR_GAMEPAD_DEADZONE) / (1 - EXCAVATOR_GAMEPAD_DEADZONE));
}

function isGamepadButtonPressed(button) {
  return Boolean(button && (button.pressed || button.value > 0.5));
}

function flipVehicleUpright() {
  if (!physicsExcavator) return;

  const angle = normalizeAngle(physicsExcavator.chassis.getAngle());
  const isOnBack = Math.cos(angle) < 0;
  if (!isOnBack) return;

  const sideImpulse = (Math.random() * 2 - 1) * EXCAVATOR_FLIP_SIDE_IMPULSE;
  const chassisCenter = physicsExcavator.chassis.getWorldCenter();
  const rotationDirection = angle >= 0 ? -1 : 1;

  physicsExcavator.chassis.applyLinearImpulse(Vec2(sideImpulse, -EXCAVATOR_FLIP_UPWARD_IMPULSE), chassisCenter, true);
  physicsExcavator.chassis.applyAngularImpulse(rotationDirection * EXCAVATOR_FLIP_ANGULAR_IMPULSE, true);
  for (const body of getExcavatorBodies()) {
    if (body === physicsExcavator.chassis) continue;
    body.applyLinearImpulse(Vec2(sideImpulse * 0.12, -EXCAVATOR_FLIP_UPWARD_IMPULSE * 0.18), body.getWorldCenter(), true);
  }
}

function stepPhysics(delta) {
  rebuildPhysicsTerrain();

  physicsAccumulator += delta / 1000;
  let iterations = 0;
  while (physicsAccumulator >= PHYSICS_STEP_SECONDS && iterations < 5) {
    updateVehicleMotor(PHYSICS_STEP_SECONDS);
    physicsWorld.step(PHYSICS_STEP_SECONDS, 8, 3);
    physicsAccumulator -= PHYSICS_STEP_SECONDS;
    iterations++;
  }

  if (physicsExcavator?.chassis && physicsExcavator.chassis.getPosition().y > state.height + 35) {
    resetPhysicsVehicle();
  }
}

function drawPhysicsVehicle(cellW, cellH) {
  if (!physicsExcavator) return;

  ctx.save();
  drawTreadBelt(cellW, cellH);
  drawExcavatorWheels(cellW, cellH);
  drawExcavatorTail(cellW, cellH);
  drawExcavatorStick(cellW, cellH);
  drawExcavatorBoom(cellW, cellH);
  drawExcavatorChassis(cellW, cellH);
  drawExcavatorHeadTop(cellW, cellH);
  drawExcavatorJawBottom(cellW, cellH);
  drawArmTarget(cellW, cellH);
  ctx.restore();
}

function getArmLocalPoints(arm) {
  if (!arm.bodies) return getArmLocalPointsForPose(arm, arm.targetPose);
  const points = getArmWorldPoints(arm);
  return {
    base: physicsExcavator.chassis.getLocalPoint(points.base),
    elbow: physicsExcavator.chassis.getLocalPoint(points.elbow),
    wrist: physicsExcavator.chassis.getLocalPoint(points.wrist),
    tip: physicsExcavator.chassis.getLocalPoint(points.tip),
    headAbs: normalizeAngle(arm.bodies.headTop.getAngle() - physicsExcavator.chassis.getAngle()),
    jawAbs: normalizeAngle(arm.bodies.jawBottom.getAngle() - physicsExcavator.chassis.getAngle()),
    jawAngle: arm.joints.jawAngle.getJointAngle(),
    stickAbs: normalizeAngle(arm.bodies.stick.getAngle() - physicsExcavator.chassis.getAngle()),
  };
}

function getArmWorldPoints(arm) {
  return {
    base: arm.chassis.getWorldPoint(arm.baseLocal),
    elbow: arm.bodies.boom.getWorldPoint(Vec2(arm.boomLength * 0.5 * arm.facing, 0)),
    wrist: arm.bodies.stick.getWorldPoint(Vec2(arm.stickLength * 0.5 * arm.facing, 0)),
    tip: arm.bodies.headTop.getWorldPoint(arm.headTipOffset),
  };
}

function getArmLocalPointsForPose(arm, pose) {
  const boomAbs = pose.boomAngle;
  const stickAbs = pose.boomAngle + pose.stickAngle;
  const headAbs = stickAbs + pose.headAngle;
  const base = Vec2(arm.baseLocal.x, arm.baseLocal.y);
  const elbow = Vec2(
    base.x + Math.cos(boomAbs) * arm.boomLength * arm.facing,
    base.y + Math.sin(boomAbs) * arm.boomLength * arm.facing,
  );
  const wrist = Vec2(
    elbow.x + Math.cos(stickAbs) * arm.stickLength * arm.facing,
    elbow.y + Math.sin(stickAbs) * arm.stickLength * arm.facing,
  );
  const tipOffset = rotateVec(arm.headTipOffset, headAbs);
  const tip = Vec2(wrist.x + tipOffset.x, wrist.y + tipOffset.y);
  return { base, elbow, wrist, tip, headAbs, jawAbs: headAbs + pose.jawAngle, stickAbs };
}

function getArmJointAngles(arm) {
  if (!arm.joints) return arm.targetPose;
  return {
    boomAngle: arm.joints.boomAngle.getJointAngle(),
    stickAngle: arm.joints.stickAngle.getJointAngle(),
    headAngle: arm.joints.headAngle.getJointAngle(),
    jawAngle: arm.joints.jawAngle.getJointAngle(),
  };
}

function drawTreadBelt(cellW, cellH) {
  const points = physicsExcavator.wheels.map((wheel) => worldToCanvasPoint(wheel.body.getPosition(), cellW, cellH));
  if (points.length < 3) return;

  const unit = Math.min(cellW, cellH);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#171d20";
  ctx.lineWidth = physicsExcavator.radius * unit * 1.72;
  traceClosed(points);
  ctx.stroke();

  ctx.strokeStyle = "#3a4241";
  ctx.lineWidth = physicsExcavator.radius * unit * 0.78;
  traceClosed(points);
  ctx.stroke();

  const phase = ((physicsExcavator.drivePhase * unit) % 24 + 24) % 24;
  ctx.strokeStyle = "rgba(223, 218, 187, 0.75)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 14]);
  ctx.lineDashOffset = -phase;
  traceClosed(points);
  ctx.stroke();
  ctx.restore();
}

function drawExcavatorWheels(cellW, cellH) {
  const unit = Math.min(cellW, cellH);
  ctx.save();
  for (const wheel of physicsExcavator.wheels) {
    const center = worldToCanvasPoint(wheel.body.getPosition(), cellW, cellH);
    const radius = wheel.radius * unit;
    ctx.fillStyle = "#323937";
    ctx.strokeStyle = "#111719";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "#d8c886";
    ctx.lineWidth = 2;
    const angle = wheel.body.getAngle();
    line(center.x, center.y, center.x + Math.cos(angle) * radius * 0.72, center.y + Math.sin(angle) * radius * 0.72);
  }
  ctx.restore();
}

function drawExcavatorChassis(cellW, cellH) {
  drawSvgAtAnchor(
    excavatorImages.chassis,
    physicsExcavator.chassis.getWorldPoint(physicsExcavator.chassisArtPivotLocal),
    physicsExcavator.chassis.getAngle(),
    excavatorSvg.chassis.pivot,
    EXCAVATOR_ART_SCALE,
    physicsExcavator.facing,
    cellW,
    cellH,
  );
}

function drawExcavatorTail(cellW, cellH) {
  const tail = physicsExcavator.tail;
  const localAngle = tail.baseAngle + tail.offset;
  drawSvgAtAnchor(
    excavatorImages.tail,
    physicsExcavator.chassis.getWorldPoint(tail.localPivot),
    physicsExcavator.chassis.getAngle() + localAngle * physicsExcavator.facing,
    excavatorSvg.tail.pivot,
    EXCAVATOR_ART_SCALE,
    physicsExcavator.facing,
    cellW,
    cellH,
  );
}

function drawExcavatorBoom(cellW, cellH) {
  const arm = physicsExcavator.arm;
  const points = getArmLocalPoints(arm);
  ctx.save();
  drawHydraulics(points, cellW, cellH);
  drawSvgBodyBetweenPivots(arm.bodies.boom, excavatorImages.boom, excavatorSvg.boom, arm.facing, cellW, cellH);
  ctx.restore();
}

function drawExcavatorStick(cellW, cellH) {
  const arm = physicsExcavator.arm;
  drawSvgBodyBetweenPivots(arm.bodies.stick, excavatorImages.stick, excavatorSvg.stick, arm.facing, cellW, cellH);
}

function drawExcavatorHeadTop(cellW, cellH) {
  const arm = physicsExcavator.arm;
  drawSvgBodyAtPivot(arm.bodies.headTop, excavatorImages.headTop, excavatorSvg.headTop, EXCAVATOR_HEAD_JAW_ART_SCALE, arm.facing, cellW, cellH);
}

function drawExcavatorJawBottom(cellW, cellH) {
  const arm = physicsExcavator.arm;
  drawSvgBodyAtPivot(arm.bodies.jawBottom, excavatorImages.jawBottom, excavatorSvg.jawBottom, EXCAVATOR_HEAD_JAW_ART_SCALE, arm.facing, cellW, cellH);
}

function drawHydraulics(points, cellW, cellH) {
  const unit = Math.min(cellW, cellH);
  ctx.save();
  ctx.strokeStyle = "#343733";
  ctx.lineWidth = Math.max(2, unit * 0.8);
  drawLocalLine(offsetLocal(points.base, -0.2, -0.08), offsetLocal(points.elbow, -0.45, -0.15), cellW, cellH);
  drawLocalLine(offsetLocal(points.elbow, 0.2, -0.2), offsetLocal(points.wrist, -0.28, -0.12), cellW, cellH);
  ctx.strokeStyle = "#c7b16e";
  ctx.lineWidth = Math.max(1, unit * 0.32);
  drawLocalLine(offsetLocal(points.base, -0.2, -0.08), offsetLocal(points.elbow, -0.45, -0.15), cellW, cellH);
  drawLocalLine(offsetLocal(points.elbow, 0.2, -0.2), offsetLocal(points.wrist, -0.28, -0.12), cellW, cellH);
  ctx.restore();
}

function drawSvgBodyBetweenPivots(body, imageAsset, svg, facing, cellW, cellH) {
  const anchor = segmentCenter(svg.pivot, svg.end);
  const assetAngle = svgPivotAngle(svg.pivot, svg.end);
  const angle = facing === EXCAVATOR_FACING_RIGHT ? body.getAngle() - assetAngle : body.getAngle() + assetAngle;
  drawSvgAtAnchor(imageAsset, body.getPosition(), angle, anchor, EXCAVATOR_ART_SCALE, facing, cellW, cellH);
}

function drawSvgBodyAtPivot(body, imageAsset, svg, scale, facing, cellW, cellH) {
  drawSvgAtAnchor(imageAsset, body.getPosition(), body.getAngle(), svg.pivot, scale, facing, cellW, cellH);
}

function drawSvgAtAnchor(imageAsset, anchorWorld, angle, anchorSvg, scale, scaleXSign, cellW, cellH) {
  if (!imageAsset.loaded) return;

  const unit = Math.min(cellW, cellH);
  const anchor = worldToCanvasPoint(anchorWorld, cellW, cellH);
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(angle);
  ctx.scale(unit * scale * scaleXSign, unit * scale);
  ctx.drawImage(imageAsset.image, -anchorSvg.x, -anchorSvg.y);
  ctx.restore();
}

function drawArmTarget(cellW, cellH) {
  const arm = physicsExcavator.arm;
  if (!arm.directTargetLocal) return;
  arm.targetWorld = arm.chassis.getWorldPoint(arm.directTargetLocal);
  const point = worldToCanvasPoint(arm.targetWorld, cellW, cellH);
  const radius = 0.2 * Math.min(cellW, cellH) * EXCAVATOR_SCALE;
  ctx.save();
  ctx.strokeStyle = arm.directLimit ? "#bb2f2f" : "#d3952c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  line(point.x - radius * 0.6, point.y, point.x + radius * 0.6, point.y);
  line(point.x, point.y - radius * 0.6, point.x, point.y + radius * 0.6);
  ctx.restore();
}

function localToCanvas(local, cellW, cellH) {
  return worldToCanvasPoint(physicsExcavator.chassis.getWorldPoint(local), cellW, cellH);
}

function offsetLocal(point, x, y) {
  return Vec2(point.x + x * EXCAVATOR_SCALE * physicsExcavator.facing, point.y - y * EXCAVATOR_SCALE);
}

function drawLocalLine(a, b, cellW, cellH) {
  const start = localToCanvas(a, cellW, cellH);
  const end = localToCanvas(b, cellW, cellH);
  line(start.x, start.y, end.x, end.y);
}

function worldToCanvasPoint(point, cellW, cellH) {
  return {
    x: point.x * cellW,
    y: point.y * cellH,
  };
}

function traceClosed(points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

function line(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function getExcavatorBodies() {
  if (!physicsExcavator) return [];
  return [
    physicsExcavator.chassis,
    ...physicsExcavator.wheels.map((wheel) => wheel.body),
    ...Object.values(physicsExcavator.arm.bodies),
  ];
}

function destroyExcavator(excavator) {
  if (!excavator) return;

  [
    ...Object.values(excavator.arm.joints),
    ...excavator.wheelJoints,
    ...excavator.linkJoints,
  ].forEach((joint) => {
    if (joint) physicsWorld.destroyJoint(joint);
  });

  [
    ...Object.values(excavator.arm.bodies),
    ...excavator.wheels.map((wheel) => wheel.body),
    excavator.chassis,
  ].forEach(destroyPhysicsBody);
}

function flipExcavatorFacing() {
  if (!physicsExcavator) return;

  const previous = physicsExcavator;
  const currentPosition = previous.chassis.getPosition();
  const nextState = {
    angle: previous.chassis.getAngle(),
    drivePhase: previous.drivePhase,
    arm: captureFlippedArmState(previous.arm),
    tail: {
      offset: previous.tail.offset,
      velocity: 0,
    },
  };

  destroyExcavator(previous);
  physicsExcavator = createExcavator(Vec2(currentPosition.x, currentPosition.y), -previous.facing, nextState);
  sharedWheelSpeed = 0;
  desiredDrive = 0;
  pointerArmControl.deltaLocal = Vec2(0, 0);
}

function captureFlippedArmState(arm) {
  const points = getArmLocalPoints(arm);
  const directTargetLocal = arm.directTargetLocal ?? points.wrist;
  const desiredHeadAbs = arm.desiredHeadAbs ?? points.headAbs;

  return {
    targetPose: flipArmPose(getArmJointAngles(arm)),
    directTargetLocal: Vec2(-directTargetLocal.x, directTargetLocal.y),
    desiredHeadAbs: -desiredHeadAbs,
  };
}

function flipArmPose(pose) {
  return {
    boomAngle: -pose.boomAngle,
    stickAngle: -pose.stickAngle,
    headAngle: -pose.headAngle,
    jawAngle: -pose.jawAngle,
  };
}

function createExcavatorImages() {
  return Object.fromEntries(Object.entries(excavatorSvgSources).map(([key, svg]) => {
    const image = new Image();
    const asset = {
      image,
      loaded: false,
    };
    image.onload = () => {
      asset.loaded = true;
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(hideSvgPivotMarkers(svg))}`;
    return [key, asset];
  }));
}

function hideSvgPivotMarkers(svg) {
  return svg.replace(/<circle\b[^>]*inkscape:label="[^"]*pivot-point"[^>]*\/?>/g, (tag) => {
    if (tag.includes("style=")) return tag.replace(/style="[^"]*"/, "style=\"display:none\"");
    return tag.replace(/\/?>$/, " style=\"display:none\" />");
  });
}

function isEditableTarget(target) {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
}

function colorLoose(x, y) {
  const shade = (x * 13 + y * 7 + state.tick) % 19;
  return LOOSE_COLORS[shade];
}

function colorPacked(x, y) {
  const shade = (x * 11 + y * 5) % 16;
  return PACKED_COLORS[shade];
}

function colorDamage(x, y, damage) {
  const shade = (x * 11 + y * 5) % 16;
  const color = PACKED_COLOR_CHANNELS[shade];
  const fracture = Math.min(1, Math.max(0, damage));
  const r = Math.floor(color.r + fracture * 52);
  const g = Math.floor(color.g - fracture * 16);
  const b = Math.floor(color.b - fracture * 30);
  return `rgb(${r}, ${g}, ${b})`;
}

function colorStress(x, y, stress, threshold) {
  const shade = (x * 11 + y * 5) % 16;
  const color = PACKED_COLOR_CHANNELS[shade];
  const pressure = Math.min(1, Math.max(0, stress / Math.max(threshold, 1)));
  const darken = Math.floor(pressure * 34);
  const r = Math.max(78, color.r - darken);
  const g = Math.max(56, color.g - Math.floor(darken * 0.72));
  const b = Math.max(39, color.b - Math.floor(darken * 0.48));
  return `rgb(${r}, ${g}, ${b})`;
}

let pointerCell = null;

function forEachBrushCell(cx, cy, visit) {
  const size = Math.max(1, Math.round(controls.brushSize.value));
  const left = cx - Math.floor(size / 2);
  const top = cy - Math.floor(size / 2);
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
      if (inBounds(x, y)) visit(x, y);
    }
  }
}

function drawBrushPreview(cellW, cellH) {
  if (!pointerCell) return;

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.lineWidth = Math.max(1, Math.min(cellW, cellH) * 0.35);

  forEachBrushCell(pointerCell.x, pointerCell.y, (cellX, cellY) => {
    const x = Math.floor(cellX * cellW);
    const y = Math.floor(cellY * cellH);
    const width = Math.ceil(cellW);
    const height = Math.ceil(cellH);
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, width - 1), Math.max(1, height - 1));
  });

  ctx.restore();
}

function updateStats() {
  const threshold = controls.cohesion.value;
  if (!statsCache.dirty && statsCache.tick === state.tick && statsCache.threshold === threshold) return;

  let loose = 0;
  let packed = 0;
  let hot = 0;
  for (let i = 0; i < state.cells.length; i++) {
    if (state.cells[i] === LOOSE) loose++;
    if (state.cells[i] === PACKED) {
      packed++;
      if (state.stress[i] > threshold) hot++;
    }
  }
  statsElement.textContent = `${packed} packed / ${loose} loose / ${hot} failing / tick ${state.tick}`;
  statsCache.dirty = false;
  statsCache.tick = state.tick;
  statsCache.threshold = threshold;
}

function paintAtEvent(event) {
  pointerCell = cellFromEvent(event);
  if (!pointerCell) return;
  paintBrush(pointerCell.x, pointerCell.y);
}

function beginPointerArmControl(event) {
  pointerArmControl.active = true;
  pointerArmControl.lastX = event.clientX;
  pointerArmControl.lastY = event.clientY;
  pointerArmControl.lastInputAt = performance.now();
  canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function movePointerArmControl(event) {
  if (!physicsExcavator) return;

  const dx = event.clientX - pointerArmControl.lastX;
  const dy = event.clientY - pointerArmControl.lastY;
  pointerArmControl.lastX = event.clientX;
  pointerArmControl.lastY = event.clientY;

  const precision = getPrecisionScale();
  const worldDelta = Vec2(
    (dx / Math.max(1, canvasLayout.cellW)) * precision,
    (dy / Math.max(1, canvasLayout.cellH)) * precision,
  );
  const localDelta = rotateVec(worldDelta, -physicsExcavator.chassis.getAngle());
  pointerArmControl.deltaLocal = Vec2(
    pointerArmControl.deltaLocal.x + localDelta.x,
    pointerArmControl.deltaLocal.y + localDelta.y,
  );
  pointerArmControl.lastInputAt = performance.now();
  event.preventDefault();
}

function endPointerArmControl(event) {
  if (!pointerArmControl.active) return;
  pointerArmControl.active = false;
  pointerArmControl.lastInputAt = performance.now();
  if (event?.pointerId != null) canvas.releasePointerCapture?.(event.pointerId);
  event?.preventDefault();
}

function cellFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.width);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.height);
  return inBounds(x, y) ? { x, y } : null;
}

function paintBrush(cx, cy) {
  forEachBrushCell(cx, cy, (x, y) => {
    const i = index(x, y);
    if (state.tool === "erase") clearCell(i);
    if (state.tool === "loose") setCell(i, LOOSE);
    if (state.tool === "packed") setCell(i, PACKED);
  });
}

function runDirtTicks(tickCount) {
  if (tickCount <= 0) return;
  settleDirtVisualPositions();
  for (let n = 0; n < tickCount; n++) simulationStep();
}

function stepDirt(delta) {
  if (!state.running) {
    dirtAccumulator = DIRT_STEP_SECONDS;
    return;
  }

  dirtAccumulator += delta / 1000;
  let slices = 0;
  while (dirtAccumulator >= DIRT_STEP_SECONDS && slices < DIRT_MAX_FRAME_SLICES) {
    runDirtTicks(controls.speed.value);
    dirtAccumulator -= DIRT_STEP_SECONDS;
    slices++;
  }

  if (dirtAccumulator >= DIRT_STEP_SECONDS) dirtAccumulator = DIRT_STEP_SECONDS;
}

function frame(now = performance.now()) {
  const delta = Math.min(100, now - lastFrame);
  lastFrame = now;

  stepDirt(delta);
  stepPhysics(delta);
  render();
  requestAnimationFrame(frame);
}

playPauseButton.addEventListener("click", (event) => {
  state.running = !state.running;
  event.currentTarget.textContent = state.running ? "Pause" : "Play";
});

stepButton.addEventListener("click", () => {
  runDirtTicks(1);
  dirtAccumulator = 0;
  render();
});

seedButton.addEventListener("click", () => {
  seedWorld();
  resetPhysicsVehicle();
});

clearButton.addEventListener("click", () => {
  state.cells.fill(EMPTY);
  state.ages.fill(0);
  state.damage.fill(0);
  state.stress.fill(0);
  state.visualStress.fill(0);
  settleDirtVisualPositions();
  state.rigid.fill(0);
  state.rigidVx.fill(0);
  state.rigidVy.fill(0);
  state.rigidMass.fill(0);
  state.externalLoad.fill(0);
  state.vx.fill(0);
  state.vy.fill(0);
  state.touched.fill(0);
  state.tick = 0;
  dirtAccumulator = 0;
  packedContours = [];
  markPackedTerrainDirty();
  markStatsDirty();
  resetPhysicsVehicle();
});

resizeButton.addEventListener("click", () => {
  resizeGrid(controls.gridWidth.value, controls.gridHeight.value);
  resetPhysicsVehicle();
});

controls.resetVehicle.addEventListener("click", () => {
  resetPhysicsVehicle();
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    modeButtons.forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    state.tool = button.dataset.tool;
  });
});

shapeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    shapeButtons.forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    state.brushShape = button.dataset.brushShape;
  });
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.button === 2) {
    beginPointerArmControl(event);
    return;
  }
  if (event.button !== 0) return;
  state.painting = true;
  canvas.setPointerCapture(event.pointerId);
  paintAtEvent(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (pointerArmControl.active) {
    movePointerArmControl(event);
    return;
  }
  pointerCell = cellFromEvent(event);
  if (state.painting) paintAtEvent(event);
});

canvas.addEventListener("pointerup", (event) => {
  if (pointerArmControl.active) {
    endPointerArmControl(event);
    return;
  }
  state.painting = false;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointercancel", (event) => {
  endPointerArmControl(event);
  state.painting = false;
});

canvas.addEventListener("pointerleave", () => {
  pointerCell = null;
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

window.addEventListener("keydown", (event) => {
  if (isEditableTarget(event.target)) return;

  const continuousCodes = new Set([
    "KeyA",
    "KeyD",
    "ArrowLeft",
    "ArrowRight",
    "KeyI",
    "KeyJ",
    "KeyK",
    "KeyL",
    "KeyQ",
    "KeyE",
    "KeyW",
    "KeyS",
    "ShiftLeft",
    "ShiftRight",
  ]);
  if (continuousCodes.has(event.code)) {
    activeKeys.add(event.code);
    event.preventDefault();
  }

  if (event.code === "KeyA" || event.code === "ArrowLeft") {
    isDrivingLeft = true;
    event.preventDefault();
  } else if (event.code === "KeyD" || event.code === "ArrowRight") {
    isDrivingRight = true;
    event.preventDefault();
  }

  if (event.repeat) return;

  if (event.code === "ArrowUp" || event.code === "KeyU") {
    flipVehicleUpright();
    event.preventDefault();
  } else if (event.code === "KeyF") {
    flipExcavatorFacing();
    event.preventDefault();
  } else if (event.code === "KeyR") {
    resetPhysicsVehicle();
    event.preventDefault();
  } else if (event.code === "Space") {
    joypad.jawOpen = !joypad.jawOpen;
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  if (isEditableTarget(event.target)) return;

  activeKeys.delete(event.code);
  if (event.code === "KeyA" || event.code === "ArrowLeft") {
    isDrivingLeft = false;
    event.preventDefault();
  } else if (event.code === "KeyD" || event.code === "ArrowRight") {
    isDrivingRight = false;
    event.preventDefault();
  }
});

window.addEventListener("gamepadconnected", (event) => {
  joypad.index = event.gamepad.index;
  joypad.connected = true;
});

window.addEventListener("gamepaddisconnected", (event) => {
  if (joypad.index !== event.gamepad.index) return;
  joypad.index = null;
  joypad.connected = false;
  joypad.drive = 0;
  joypad.armX = 0;
  joypad.armY = 0;
  joypad.headTurn = 0;
  joypad.active = false;
});

if ("ResizeObserver" in window) {
  canvasResizeObserver = new ResizeObserver(markCanvasLayoutDirty);
  canvasResizeObserver.observe(canvasWrap);
} else {
  window.addEventListener("resize", markCanvasLayoutDirty);
}

resizeGrid(state.width, state.height);
rebuildPhysicsTerrain();
resetPhysicsVehicle();
requestAnimationFrame(frame);
