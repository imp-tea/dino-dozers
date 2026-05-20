import { Vec2, World } from "planck";
import { createRigidInfluence } from "./physics/rigidInfluence.js";
import { createPhysicsTerrain } from "./physics/terrain.js";
import { createInputState } from "./input/inputState.js";
import { createCamera } from "./render/camera.js";
import { createCanvasLayout } from "./render/canvasLayout.js";
import { createDirtRenderer } from "./render/dirtRenderer.js";
import { drawPlanckDebugView } from "./render/planckDebugRenderer.js";
import { EMPTY, LOOSE, PACKED } from "./sim/cellTypes.js";
import { createActivityGrid } from "./sim/activityGrid.js";
import { createDirtSimulation } from "./sim/dirtSimulation.js";
import { createGrid, createGridState } from "./sim/grid.js";
import { createPackedContourCache } from "./sim/packedContours.js";
import { getControls, isEditableTarget } from "./ui/controls.js";
import { createVehicleManager } from "./vehicles/vehicleManager.js";
import { VEHICLE_TYPES } from "./vehicles/vehicleTypes.js";
import { ROLLERSAURUS_FRACTURE_LOAD_MULTIPLIER } from "./vehicles/rollersaurus/config.js";
import { createRollersaurusVehicle } from "./vehicles/rollersaurus/factory.js";
import { WRECKERSAURUS_FRACTURE_LOAD_MULTIPLIER } from "./vehicles/wreckersaurus/config.js";
import { createWreckersaurusVehicle } from "./vehicles/wreckersaurus/factory.js";

const PHYSICS_STEP_SECONDS = 1 / 60;
const DIRT_STEP_SECONDS = 1 / 30;
const DIRT_MAX_FRAME_SLICES = 3;
const CELLS_PER_WORLD_UNIT = 2;
const STRESS_SURFACE_BAND_CELLS = 4;
const VEHICLE_CONTROL_CODES = new Set([
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
  "Space",
]);
const CONTINUOUS_KEY_CODES = new Set([
  ...VEHICLE_CONTROL_CODES,
  "ShiftLeft",
  "ShiftRight",
]);

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

const statsCache = {
  dirty: true,
  tick: -1,
  threshold: Number.NaN,
};

const controls = getControls();

let physicsAccumulator = 0;
let dirtAccumulator = 0;
let canvasResizeObserver = null;
let lastFrame = performance.now();
let stressVisibilityDirty = true;

const { activeKeys, pointerArmControl, joypad } = createInputState();
let activeVehicleType = VEHICLE_TYPES.ROLLERSAURUS;

const physicsWorld = new World({
  gravity: Vec2(0, 32),
});
const vehicleManager = createVehicleManager();
setActiveVehicleType(activeVehicleType);

const state = createGridState({
  width: controls.gridWidth.value,
  height: controls.gridHeight.value,
});
const {
  layout: canvasLayout,
  markDirty: markCanvasLayoutDirty,
  sync: syncCanvasLayout,
} = createCanvasLayout({
  canvas,
  canvasWrap,
  state,
});
const camera = createCamera({
  canvas,
  layout: canvasLayout,
  state,
});
const activityGrid = createActivityGrid({ state });
let markStressCellChanged = () => {};

const grid = createGrid(state, {
  markCanvasLayoutDirty,
  markStatsDirty,
  markPackedTerrainDirty,
  markCellActive: (i) => activityGrid.wakeIndex(i),
  onCellKindChanged: (i, fromKind, toKind) => markStressCellChanged(i, fromKind, toKind),
  onResize: () => {
    activityGrid.resize();
    seedWorld();
  },
});

const {
  resizeGrid,
  index,
  inBounds,
  setCell,
  clearCell,
  resetCellCounts,
  settleDirtVisualPositions,
} = grid;
const dirtRenderer = createDirtRenderer({
  state,
  grid,
  controls,
  ctx,
  statsElement,
  statsCache,
});

const dirtSimulation = createDirtSimulation({
  state,
  grid,
  getSettings: getSimulationSettings,
  getActiveRegion: getActiveVehicleRegion,
  activityGrid,
  updateRigidInfluenceGrid,
});
markStressCellChanged = dirtSimulation.markStressCellChanged;
const { simulationStep } = dirtSimulation;
const packedContourCache = createPackedContourCache({ state, grid });
const physicsTerrain = createPhysicsTerrain({
  world: physicsWorld,
  contours: packedContourCache,
  cellsPerWorldUnit: CELLS_PER_WORLD_UNIT,
});
const rigidInfluence = createRigidInfluence({
  state,
  grid,
  cellsPerWorldUnit: CELLS_PER_WORLD_UNIT,
  applyTerrainEffects: (markRigidTouchedCell) => dirtSimulation.applyRigidTerrainEffects(markRigidTouchedCell),
});

function markStatsDirty() {
  statsCache.dirty = true;
}

function resetHotStatsCache() {
  statsCache.hot = null;
  statsCache.hotTick = -1;
}

function getSimulationSettings() {
  return {
    cohesion: controls.cohesion.value,
    fatigue: controls.fatigue.value,
    weight: controls.weight.value,
    bridgePenalty: controls.bridgePenalty.value,
    settleTicks: controls.settleTicks.value,
    spread: controls.spread.value,
    jitter: controls.jitter.value,
  };
}

function dirtTweenProgress() {
  if (!state.running) return 1;
  const t = Math.max(0, Math.min(1, dirtAccumulator / DIRT_STEP_SECONDS));
  return t * t * (3 - 2 * t);
}

function markPackedTerrainDirty() {
  packedContourCache.markDirty();
  physicsTerrain.markDirty();
  stressVisibilityDirty = true;
}

function rebuildStressVisibilityIfDirty() {
  if (!stressVisibilityDirty) return;
  rebuildStressVisibility();
  stressVisibilityDirty = false;
}

function rebuildStressVisibility() {
  state.stressVisibility.fill(0);
  const queue = [];
  const w = state.width;
  const h = state.height;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = index(x, y);
      if (state.cells[i] !== PACKED || !isStressSurfaceCell(x, y)) continue;
      state.stressVisibility[i] = 1;
      queue.push(i);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const nextVisibility = state.stressVisibility[current] - 1 / STRESS_SURFACE_BAND_CELLS;
    if (nextVisibility <= 0) continue;

    const x = current % w;
    const y = Math.floor(current / w);
    spreadStressVisibility(queue, x - 1, y, nextVisibility);
    spreadStressVisibility(queue, x + 1, y, nextVisibility);
    spreadStressVisibility(queue, x, y - 1, nextVisibility);
    spreadStressVisibility(queue, x, y + 1, nextVisibility);
  }
}

function isStressSurfaceCell(x, y) {
  return (
    isStressExposedNeighbor(x - 1, y) ||
    isStressExposedNeighbor(x + 1, y) ||
    isStressExposedNeighbor(x, y - 1) ||
    isStressExposedNeighbor(x, y + 1)
  );
}

function isStressExposedNeighbor(x, y) {
  if (!inBounds(x, y)) return true;
  const i = index(x, y);
  return state.cells[i] === EMPTY || state.rigid[i] !== 0;
}

function spreadStressVisibility(queue, x, y, visibility) {
  if (!inBounds(x, y)) return;
  const i = index(x, y);
  if (state.cells[i] !== PACKED || state.stressVisibility[i] >= visibility) return;
  state.stressVisibility[i] = visibility;
  queue.push(i);
}

function seedWorld() {
  markPackedTerrainDirty();
  markStatsDirty();
  resetHotStatsCache();
  dirtAccumulator = 0;
  state.cells.fill(EMPTY);
  dirtSimulation.resetStressModel();
  resetCellCounts();
  state.ages.fill(0);
  state.looseContactAges.fill(0);
  state.looseSettleLocks.fill(0);
  state.damage.fill(0);
  state.stress.fill(0);
  state.visualStress.fill(0);
  state.stressVisibility.fill(0);
  settleDirtVisualPositions();
  state.rigid.fill(0);
  state.rigidVx.fill(0);
  state.rigidVy.fill(0);
  state.rigidMass.fill(0);
  state.rigidImpactMass.fill(0);
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
  stressVisibilityDirty = true;
}

function updateRigidInfluenceGrid() {
  rigidInfluence.clearBodyGroups();
  rigidInfluence.registerBodyGroup({
    id: "active-vehicle",
    kind: "vehicle",
    bodies: vehicleManager.getActiveVehicleBodies(),
    dynamic: true,
    massScale: 1,
    damageScale: getActiveVehicleFractureLoadMultiplier(),
    affectsTerrain: true,
    distributeLoadToContacts: true,
    contactPart: "wheel",
  });
  rigidInfluence.update();
}

function getActiveVehicleFractureLoadMultiplier() {
  return activeVehicleType === VEHICLE_TYPES.ROLLERSAURUS
    ? ROLLERSAURUS_FRACTURE_LOAD_MULTIPLIER
    : WRECKERSAURUS_FRACTURE_LOAD_MULTIPLIER;
}

function render(delta = 0) {
  syncCanvasLayout();
  camera.update(delta / 1000, getActiveVehicleCameraTarget());

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#2a2d29";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cellW = canvasLayout.cellW;
  const cellH = canvasLayout.cellH;
  const worldCellW = cellW * CELLS_PER_WORLD_UNIT;
  const worldCellH = cellH * CELLS_PER_WORLD_UNIT;
  const dirtTween = dirtTweenProgress();
  const visibleBounds = camera.visibleCellBounds(2);

  const packedContours = packedContourCache.getRenderContours();
  rebuildStressVisibilityIfDirty();
  ctx.save();
  camera.applyTransform(ctx);
  dirtRenderer.drawPackedContourFill(packedContours, cellW, cellH, visibleBounds);
  dirtRenderer.drawCells({ cellW, cellH, dirtTween, visibleBounds });
  dirtRenderer.drawPackedContourOverlay(packedContours, cellW, cellH);
  drawActiveVehicle(worldCellW, worldCellH);
  if (controls.debugView.checked) {
    drawPlanckDebugView(ctx, physicsWorld, { cellW: worldCellW, cellH: worldCellH });
    drawActivityTileDebug(cellW, cellH, visibleBounds);
  }
  dirtRenderer.drawBrushPreview(pointerCell, forEachBrushCell, cellW, cellH);
  ctx.restore();
  dirtRenderer.updateStats();
}

function drawActivityTileDebug(cellW, cellH, visibleBounds) {
  const tiles = activityGrid.getTiles();
  const minTx = Math.max(0, Math.floor(visibleBounds.minX / tiles.tileSize));
  const maxTx = Math.min(tiles.columns - 1, Math.floor(visibleBounds.maxX / tiles.tileSize));
  const minTy = Math.max(0, Math.floor(visibleBounds.minY / tiles.tileSize));
  const maxTy = Math.min(tiles.rows - 1, Math.floor(visibleBounds.maxY / tiles.tileSize));

  ctx.save();
  ctx.lineWidth = Math.max(1, Math.min(cellW, cellH) * 0.25);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const tileIndex = ty * tiles.columns + tx;
      const x = tx * tiles.tileSize;
      const y = ty * tiles.tileSize;
      const width = Math.min(tiles.tileSize, state.width - x);
      const height = Math.min(tiles.tileSize, state.height - y);
      const active = tiles.activeUntil[tileIndex] >= state.tick;
      ctx.fillStyle = active ? "rgba(51, 187, 144, 0.12)" : "rgba(255, 255, 255, 0.025)";
      ctx.strokeStyle = active ? "rgba(62, 230, 172, 0.55)" : "rgba(255, 255, 255, 0.10)";
      ctx.fillRect(x * cellW, y * cellH, width * cellW, height * cellH);
      ctx.strokeRect(x * cellW + 0.5, y * cellH + 0.5, width * cellW - 1, height * cellH - 1);
    }
  }
  ctx.restore();
}

function getActiveVehicleCameraTarget() {
  return getActiveVehicleCellPosition() ?? { x: state.width * 0.5, y: state.height * 0.5 };
}

function getActiveVehicleCellPosition() {
  const activeVehicle = vehicleManager.getActiveVehicle()?.getActiveVehicle?.();
  const position = activeVehicle?.chassis?.getWorldCenter?.() ?? activeVehicle?.chassis?.getPosition?.();
  if (!position) return null;
  return {
    x: position.x * CELLS_PER_WORLD_UNIT,
    y: position.y * CELLS_PER_WORLD_UNIT,
  };
}

function getActiveVehicleRegion() {
  const center = getActiveVehicleCellPosition();
  if (!center) return null;

  const width = Math.max(1, Math.round(controls.activeRegionWidth.value));
  const height = Math.max(1, Math.round(controls.activeRegionHeight.value));
  const x = axisBounds(center.x, width, state.width);
  const y = axisBounds(center.y, height, state.height);
  return {
    minX: x.min,
    maxX: x.max,
    minY: y.min,
    maxY: y.max,
  };
}

function axisBounds(center, size, limit) {
  const clampedSize = Math.max(1, Math.min(size, limit));
  let min = Math.floor(center - clampedSize / 2);
  let max = min + clampedSize - 1;

  if (min < 0) {
    max -= min;
    min = 0;
  }
  if (max >= limit) {
    min -= max - limit + 1;
    max = limit - 1;
  }

  return {
    min: Math.max(0, min),
    max: Math.min(limit - 1, max),
  };
}

function followActiveVehicle({ immediate = false } = {}) {
  camera.follow(getActiveVehicleCameraTarget(), { immediate });
}

function rebuildPhysicsTerrain() {
  physicsTerrain.rebuildIfDirty();
}

function vehicleStartPosition() {
  const worldWidth = state.width / CELLS_PER_WORLD_UNIT;
  const worldHeight = state.height / CELLS_PER_WORLD_UNIT;
  const terrainTop = Math.floor(worldHeight * 2 / 3);
  const vehicleClearance = 6.2;
  const vehicleMargin = 18;
  const topMargin = 10;
  return {
    x: Math.max(vehicleMargin, Math.min(worldWidth - vehicleMargin, Math.floor(worldWidth * 0.36))),
    y: Math.max(topMargin, Math.min(worldHeight - topMargin, Math.floor(terrainTop - vehicleClearance))),
  };
}

function resetActiveVehicle() {
  const start = vehicleStartPosition();
  vehicleManager.reset(Vec2(start.x, start.y));
  followActiveVehicle({ immediate: true });
}

function setActiveVehicleType(type) {
  activeVehicleType = type === VEHICLE_TYPES.WRECKERSAURUS
    ? VEHICLE_TYPES.WRECKERSAURUS
    : VEHICLE_TYPES.ROLLERSAURUS;
  vehicleManager.clearActiveVehicle();
  vehicleManager.setActiveVehicle(createActiveVehicle());
}

function createActiveVehicle() {
  const options = {
    world: physicsWorld,
    ctx,
    input: {
      activeKeys,
      pointerArmControl,
      joypad,
    },
  };

  if (activeVehicleType === VEHICLE_TYPES.WRECKERSAURUS) {
    return createWreckersaurusVehicle(options);
  }

  return createRollersaurusVehicle(options);
}

function stepPhysics(delta) {
  rebuildPhysicsTerrain();

  physicsAccumulator += delta / 1000;
  let iterations = 0;
  while (physicsAccumulator >= PHYSICS_STEP_SECONDS && iterations < 5) {
    vehicleManager.step(PHYSICS_STEP_SECONDS);
    physicsWorld.step(PHYSICS_STEP_SECONDS, 8, 3);
    vehicleManager.afterPhysicsStep(PHYSICS_STEP_SECONDS);
    physicsAccumulator -= PHYSICS_STEP_SECONDS;
    iterations++;
  }

  if (vehicleManager.getActiveVehicle()?.isOutOfBounds(state.height / CELLS_PER_WORLD_UNIT)) {
    resetActiveVehicle();
  }
}

function drawActiveVehicle(cellW, cellH) {
  vehicleManager.draw(ctx, { cellW, cellH });
}

let pointerCell = null;
const cameraPan = {
  active: false,
  pointerId: null,
  lastX: 0,
  lastY: 0,
};

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

function paintAtEvent(event) {
  pointerCell = cellFromEvent(event);
  if (!pointerCell) return;
  paintBrush(pointerCell.x, pointerCell.y);
}

function beginPointerArmControl(event) {
  followActiveVehicle();
  pointerArmControl.active = true;
  pointerArmControl.lastX = event.clientX;
  pointerArmControl.lastY = event.clientY;
  pointerArmControl.lastInputAt = performance.now();
  canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function movePointerArmControl(event) {
  const vehicle = vehicleManager.getActiveVehicle();
  if (!vehicle) return;

  const dx = event.clientX - pointerArmControl.lastX;
  const dy = event.clientY - pointerArmControl.lastY;
  pointerArmControl.lastX = event.clientX;
  pointerArmControl.lastY = event.clientY;

  vehicle.addPointerArmDelta(
    dx,
    dy,
    canvasLayout.cellW * CELLS_PER_WORLD_UNIT * camera.currentZoom(),
    canvasLayout.cellH * CELLS_PER_WORLD_UNIT * camera.currentZoom(),
  );
  event.preventDefault();
}

function endPointerArmControl(event) {
  if (!pointerArmControl.active) return;
  pointerArmControl.active = false;
  pointerArmControl.lastInputAt = performance.now();
  if (event?.pointerId != null) canvas.releasePointerCapture?.(event.pointerId);
  event?.preventDefault();
}

function beginCameraPan(event) {
  cameraPan.active = true;
  cameraPan.pointerId = event.pointerId;
  cameraPan.lastX = event.clientX;
  cameraPan.lastY = event.clientY;
  canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function moveCameraPan(event) {
  if (!cameraPan.active || event.pointerId !== cameraPan.pointerId) return;

  const dx = event.clientX - cameraPan.lastX;
  const dy = event.clientY - cameraPan.lastY;
  cameraPan.lastX = event.clientX;
  cameraPan.lastY = event.clientY;
  camera.panByCssDelta(dx, dy);
  pointerCell = null;
  event.preventDefault();
}

function endCameraPan(event) {
  if (!cameraPan.active || (event?.pointerId != null && event.pointerId !== cameraPan.pointerId)) return;

  cameraPan.active = false;
  cameraPan.pointerId = null;
  if (event?.pointerId != null) canvas.releasePointerCapture?.(event.pointerId);
  event?.preventDefault();
}

function cellFromEvent(event) {
  const { x, y } = camera.eventToCell(event);
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

  stepPhysics(delta);
  stepDirt(delta);
  if (isVehicleControlActive()) followActiveVehicle();
  render(delta);
  requestAnimationFrame(frame);
}

function isVehicleControlActive() {
  if (pointerArmControl.active || joypad.active) return true;
  for (const code of VEHICLE_CONTROL_CODES) {
    if (activeKeys.has(code)) return true;
  }
  return false;
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
  resetActiveVehicle();
});

clearButton.addEventListener("click", () => {
  state.cells.fill(EMPTY);
  dirtSimulation.resetStressModel();
  resetCellCounts();
  state.ages.fill(0);
  state.looseContactAges.fill(0);
  state.looseSettleLocks.fill(0);
  state.damage.fill(0);
  state.stress.fill(0);
  state.visualStress.fill(0);
  state.stressVisibility.fill(0);
  settleDirtVisualPositions();
  state.rigid.fill(0);
  state.rigidVx.fill(0);
  state.rigidVy.fill(0);
  state.rigidMass.fill(0);
  state.rigidImpactMass.fill(0);
  state.externalLoad.fill(0);
  state.vx.fill(0);
  state.vy.fill(0);
  state.touched.fill(0);
  state.tick = 0;
  dirtAccumulator = 0;
  packedContourCache.clear();
  activityGrid.wakeAll();
  markPackedTerrainDirty();
  markStatsDirty();
  resetHotStatsCache();
  resetActiveVehicle();
});

resizeButton.addEventListener("click", () => {
  resizeGrid(controls.gridWidth.value, controls.gridHeight.value);
  resetActiveVehicle();
});

controls.resetVehicle.addEventListener("click", () => {
  resetActiveVehicle();
});

controls.vehicleType.addEventListener("change", () => {
  setActiveVehicleType(controls.vehicleType.value);
  resetActiveVehicle();
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
  if (event.button === 1) {
    beginCameraPan(event);
    return;
  }
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
  if (cameraPan.active) {
    moveCameraPan(event);
    return;
  }
  if (pointerArmControl.active) {
    movePointerArmControl(event);
    return;
  }
  pointerCell = cellFromEvent(event);
  if (state.painting) paintAtEvent(event);
});

canvas.addEventListener("pointerup", (event) => {
  if (cameraPan.active) {
    endCameraPan(event);
    return;
  }
  if (pointerArmControl.active) {
    endPointerArmControl(event);
    return;
  }
  state.painting = false;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointercancel", (event) => {
  endCameraPan(event);
  endPointerArmControl(event);
  state.painting = false;
});

canvas.addEventListener("pointerleave", () => {
  pointerCell = null;
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

canvas.addEventListener("auxclick", (event) => {
  if (event.button === 1) event.preventDefault();
});

canvas.addEventListener("wheel", (event) => {
  camera.zoomAtEvent(event);
  pointerCell = cellFromEvent(event);
  event.preventDefault();
}, { passive: false });

window.addEventListener("keydown", (event) => {
  if (isEditableTarget(event.target)) return;

  if (CONTINUOUS_KEY_CODES.has(event.code)) {
    activeKeys.add(event.code);
    if (VEHICLE_CONTROL_CODES.has(event.code)) followActiveVehicle();
    event.preventDefault();
  }

  if (event.repeat) return;

  if (event.code === "ArrowUp" || event.code === "KeyU") {
    followActiveVehicle();
    vehicleManager.getActiveVehicle()?.flipUpright();
    event.preventDefault();
  } else if (event.code === "KeyF") {
    followActiveVehicle();
    vehicleManager.getActiveVehicle()?.flipFacing();
    event.preventDefault();
  } else if (event.code === "KeyR") {
    resetActiveVehicle();
    event.preventDefault();
  } else if (event.code === "KeyP") {
    rigidInfluence.logRollerTerrainDebug(vehicleManager.getActiveVehicleBodies());
    event.preventDefault();
  } else if (event.code === "Space" && activeVehicleType === VEHICLE_TYPES.WRECKERSAURUS) {
    followActiveVehicle();
    joypad.jawOpen = !joypad.jawOpen;
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  if (isEditableTarget(event.target)) return;

  activeKeys.delete(event.code);
  if (
    event.code === "KeyA" ||
    event.code === "ArrowLeft" ||
    event.code === "KeyD" ||
    event.code === "ArrowRight" ||
    event.code === "Space"
  ) {
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
  joypad.flattenActive = false;
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
resetActiveVehicle();
requestAnimationFrame(frame);
