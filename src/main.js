import { Vec2, World } from "planck";
import { createRigidInfluence } from "./physics/rigidInfluence.js";
import { createPhysicsTerrain } from "./physics/terrain.js";
import { createInputState } from "./input/inputState.js";
import { createCanvasLayout } from "./render/canvasLayout.js";
import { createDirtRenderer } from "./render/dirtRenderer.js";
import { EMPTY, LOOSE, PACKED } from "./sim/cellTypes.js";
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
const PACKED_CONTOUR_FILL = "#76533a";
const PACKED_CONTOUR_STROKE = "#3f2518";

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

const grid = createGrid(state, {
  markCanvasLayoutDirty,
  markStatsDirty,
  markPackedTerrainDirty,
  onResize: seedWorld,
});

const {
  resizeGrid,
  index,
  inBounds,
  setCell,
  clearCell,
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
  updateRigidInfluenceGrid,
});
const { simulationStep } = dirtSimulation;
const packedContourCache = createPackedContourCache({ state, grid });
const physicsTerrain = createPhysicsTerrain({
  world: physicsWorld,
  contours: packedContourCache,
});
const rigidInfluence = createRigidInfluence({
  state,
  grid,
  applyTerrainEffects: () => dirtSimulation.applyRigidTerrainEffects(),
});

function markStatsDirty() {
  statsCache.dirty = true;
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

function render() {
  syncCanvasLayout();

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#2a2d29";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cellW = canvasLayout.cellW;
  const cellH = canvasLayout.cellH;
  const dirtTween = dirtTweenProgress();

  drawPackedContourFill(cellW, cellH);
  dirtRenderer.drawCells({ cellW, cellH, dirtTween });
  drawPackedContourOverlay(cellW, cellH);
  drawActiveVehicle(cellW, cellH);
  dirtRenderer.drawBrushPreview(pointerCell, forEachBrushCell, cellW, cellH);
  dirtRenderer.updateStats();
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

  const contours = packedContourCache.getContours();

  ctx.save();
  ctx.fillStyle = PACKED_CONTOUR_FILL;

  for (const contour of contours) {
    if (contour.length < 3) continue;
    tracePackedContour(contour, cellW, cellH);
    ctx.fill("evenodd");
  }

  ctx.restore();
}

function drawPackedContourOverlay(cellW, cellH) {
  if (!controls.contourView.checked) return;

  const contours = packedContourCache.getContours();

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = PACKED_CONTOUR_STROKE;
  ctx.lineWidth = Math.max(1.5, Math.min(cellW, cellH) * 0.7);
  ctx.lineJoin = "bevel";
  ctx.lineCap = "butt";

  for (const contour of contours) {
    if (contour.length < 3) continue;
    tracePackedContour(contour, cellW, cellH);
    ctx.stroke();
  }

  ctx.restore();
}

function rebuildPhysicsTerrain() {
  physicsTerrain.rebuildIfDirty();
}

function vehicleStartPosition() {
  const terrainTop = Math.floor(state.height * 2 / 3);
  const vehicleClearance = 6.2;
  return {
    x: Math.max(18, Math.min(state.width - 18, Math.floor(state.width * 0.36))),
    y: Math.max(10, Math.min(state.height - 10, Math.floor(terrainTop - vehicleClearance))),
  };
}

function resetActiveVehicle() {
  const start = vehicleStartPosition();
  vehicleManager.reset(Vec2(start.x, start.y));
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
    physicsAccumulator -= PHYSICS_STEP_SECONDS;
    iterations++;
  }

  if (vehicleManager.getActiveVehicle()?.isOutOfBounds(state.height)) {
    resetActiveVehicle();
  }
}

function drawActiveVehicle(cellW, cellH) {
  vehicleManager.draw(ctx, { cellW, cellH });
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
  const vehicle = vehicleManager.getActiveVehicle();
  if (!vehicle) return;

  const dx = event.clientX - pointerArmControl.lastX;
  const dy = event.clientY - pointerArmControl.lastY;
  pointerArmControl.lastX = event.clientX;
  pointerArmControl.lastY = event.clientY;

  vehicle.addPointerArmDelta(dx, dy, canvasLayout.cellW, canvasLayout.cellH);
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
  resetActiveVehicle();
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
  state.rigidImpactMass.fill(0);
  state.externalLoad.fill(0);
  state.vx.fill(0);
  state.vy.fill(0);
  state.touched.fill(0);
  state.tick = 0;
  dirtAccumulator = 0;
  packedContourCache.clear();
  markPackedTerrainDirty();
  markStatsDirty();
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

  if (event.repeat) return;

  if (event.code === "ArrowUp" || event.code === "KeyU") {
    vehicleManager.getActiveVehicle()?.flipUpright();
    event.preventDefault();
  } else if (event.code === "KeyF") {
    vehicleManager.getActiveVehicle()?.flipFacing();
    event.preventDefault();
  } else if (event.code === "KeyR") {
    resetActiveVehicle();
    event.preventDefault();
  } else if (event.code === "Space") {
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
    event.code === "ArrowRight"
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
