import { colliderModels } from "./colliderEditorData.js";
import { WRECKERSAURUS_SCALE } from "../vehicles/wreckersaurus/config.js";

const canvas = document.querySelector("#editorCanvas");
const ctx = canvas.getContext("2d");
const vehicleSelect = document.querySelector("#vehicleSelect");
const partSelect = document.querySelector("#partSelect");
const fixtureSelect = document.querySelector("#fixtureSelect");
const resetViewButton = document.querySelector("#resetView");
const selectionSummary = document.querySelector("#selectionSummary");
const shapeControls = document.querySelector("#shapeControls");
const patchOutput = document.querySelector("#patchOutput");
const copyPatchButton = document.querySelector("#copyPatch");
const logPatchButton = document.querySelector("#logPatch");

const HANDLE_RADIUS_PX = 7;
const MIN_SIZE = 0.05;
const images = new Map();
const view = {
  scale: 72,
  offsetX: 0,
  offsetY: 0,
};
const state = {
  vehicleId: colliderModels[0].id,
  partId: colliderModels[0].parts[0].id,
  fixtureId: colliderModels[0].parts[0].fixtures[0].id,
  drag: null,
};

init();

function init() {
  populateVehicleSelect();
  syncPartSelect();
  syncFixtureSelect();
  setCanvasSize();
  fitSelectedPart();
  updateControls();
  updatePatchOutput();
  requestAnimationFrame(draw);

  vehicleSelect.addEventListener("change", () => {
    state.vehicleId = vehicleSelect.value;
    state.partId = getVehicle().parts[0].id;
    state.fixtureId = getPart().fixtures[0].id;
    syncPartSelect();
    syncFixtureSelect();
    fitSelectedPart();
    updateControls();
    updatePatchOutput();
  });

  partSelect.addEventListener("change", () => {
    state.partId = partSelect.value;
    state.fixtureId = getPart().fixtures[0].id;
    syncFixtureSelect();
    fitSelectedPart();
    updateControls();
    updatePatchOutput();
  });

  fixtureSelect.addEventListener("change", () => {
    state.fixtureId = fixtureSelect.value;
    updateControls();
    updatePatchOutput();
  });

  resetViewButton.addEventListener("click", fitSelectedPart);
  copyPatchButton.addEventListener("click", copyPatch);
  logPatchButton.addEventListener("click", () => console.log(JSON.parse(patchOutput.value)));
  window.addEventListener("resize", () => {
    setCanvasSize();
    fitSelectedPart();
  });

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("wheel", onWheel, { passive: false });
}

function populateVehicleSelect() {
  vehicleSelect.replaceChildren(...colliderModels.map((model) => option(model.id, model.label)));
  vehicleSelect.value = state.vehicleId;
}

function syncPartSelect() {
  const vehicle = getVehicle();
  partSelect.replaceChildren(...vehicle.parts.map((part) => option(part.id, part.label)));
  partSelect.value = state.partId;
}

function syncFixtureSelect() {
  const part = getPart();
  fixtureSelect.replaceChildren(...part.fixtures.map((fixture) => option(fixture.id, fixture.label)));
  fixtureSelect.value = state.fixtureId;
}

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function getVehicle() {
  return colliderModels.find((model) => model.id === state.vehicleId);
}

function getPart() {
  return getVehicle().parts.find((part) => part.id === state.partId);
}

function getFixture() {
  return getPart().fixtures.find((fixture) => fixture.id === state.fixtureId);
}

function setCanvasSize() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function canvasCssSize() {
  const ratio = window.devicePixelRatio || 1;
  return {
    width: canvas.width / ratio,
    height: canvas.height / ratio,
  };
}

function fitSelectedPart() {
  const bounds = getPartBounds(getPart());
  const size = canvasCssSize();
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  view.scale = Math.min(size.width / width, size.height / height) * 0.72;
  view.offsetX = size.width * 0.5 - ((bounds.minX + bounds.maxX) * 0.5) * view.scale;
  view.offsetY = size.height * 0.5 - ((bounds.minY + bounds.maxY) * 0.5) * view.scale;
}

function getPartBounds(part) {
  const points = [];
  if (part.art) pushArtBounds(points, part.art);
  for (const fixture of part.fixtures) {
    if (fixture.art) pushArtBounds(points, fixture.art);
    if (fixture.shape === "polygon") points.push(...fixture.vertices);
    if (fixture.shape === "circle") {
      points.push(
        { x: fixture.center.x - fixture.radius, y: fixture.center.y - fixture.radius },
        { x: fixture.center.x + fixture.radius, y: fixture.center.y + fixture.radius },
      );
    }
    if (fixture.shape === "box") {
      points.push(...boxCorners(fixture));
    }
  }
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function pushArtBounds(points, art) {
  const left = art.anchorLocal.x - art.pivot.x * art.scale;
  const top = art.anchorLocal.y - art.pivot.y * art.scale;
  points.push(
    { x: left, y: top },
    { x: left + art.viewBox.width * art.scale, y: top + art.viewBox.height * art.scale },
  );
}

function draw() {
  const ratio = window.devicePixelRatio || 1;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const size = canvasCssSize();
  ctx.clearRect(0, 0, size.width, size.height);
  drawGrid(size);

  const part = getPart();
  drawArt(part.art, 0.58);
  for (const fixture of part.fixtures) {
    if (fixture.art) drawArt(fixture.art, 0.38);
  }
  for (const fixture of part.fixtures) drawFixture(fixture, fixture.id === state.fixtureId);
  drawOrigin();
  requestAnimationFrame(draw);
}

function drawGrid(size) {
  ctx.save();
  ctx.fillStyle = "#252925";
  ctx.fillRect(0, 0, size.width, size.height);
  const step = Math.max(12, view.scale);
  const startX = positiveModulo(view.offsetX, step);
  const startY = positiveModulo(view.offsetY, step);
  ctx.strokeStyle = "rgba(255, 253, 248, 0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startX; x < size.width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size.height);
  }
  for (let y = startY; y < size.height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(size.width, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawArt(art, alpha) {
  if (!art) return;
  const image = getImage(art.svg);
  if (!image.complete) return;
  const topLeft = worldToScreen({
    x: art.anchorLocal.x - art.pivot.x * art.scale,
    y: art.anchorLocal.y - art.pivot.y * art.scale,
  });
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    image,
    topLeft.x,
    topLeft.y,
    art.viewBox.width * art.scale * view.scale,
    art.viewBox.height * art.scale * view.scale,
  );
  ctx.restore();
}

function getImage(svg) {
  if (images.has(svg)) return images.get(svg);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  images.set(svg, image);
  return image;
}

function drawFixture(fixture, selected) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.strokeStyle = selected ? "#ff66b3" : "rgba(255, 255, 255, 0.72)";
  ctx.fillStyle = selected ? "rgba(255, 102, 179, 0.14)" : "rgba(255, 255, 255, 0.08)";
  if (fixture.shape === "polygon") drawPolygon(fixture);
  if (fixture.shape === "circle") drawCircle(fixture);
  if (fixture.shape === "box") drawBox(fixture);
  if (selected) drawHandles(fixture);
  ctx.restore();
}

function drawPolygon(fixture) {
  if (!fixture.vertices.length) return;
  ctx.beginPath();
  const first = worldToScreen(fixture.vertices[0]);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < fixture.vertices.length; i++) {
    const point = worldToScreen(fixture.vertices[i]);
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawCircle(fixture) {
  const center = worldToScreen(fixture.center);
  ctx.beginPath();
  ctx.arc(center.x, center.y, fixture.radius * view.scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawBox(fixture) {
  const corners = boxCorners(fixture).map(worldToScreen);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawHandles(fixture) {
  const handles = getHandles(fixture);
  for (const handle of handles) {
    const point = worldToScreen(handle.point);
    ctx.beginPath();
    ctx.fillStyle = handle.kind === "center" ? "#18756d" : "#fffcf5";
    ctx.strokeStyle = "#ff66b3";
    ctx.lineWidth = 2;
    ctx.arc(point.x, point.y, HANDLE_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawOrigin() {
  const origin = worldToScreen({ x: 0, y: 0 });
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(origin.x - 9, origin.y);
  ctx.lineTo(origin.x + 9, origin.y);
  ctx.moveTo(origin.x, origin.y - 9);
  ctx.lineTo(origin.x, origin.y + 9);
  ctx.stroke();
  ctx.restore();
}

function boxCorners(fixture) {
  const halfW = fixture.width * 0.5;
  const halfH = fixture.height * 0.5;
  return [
    { x: fixture.center.x - halfW, y: fixture.center.y - halfH },
    { x: fixture.center.x + halfW, y: fixture.center.y - halfH },
    { x: fixture.center.x + halfW, y: fixture.center.y + halfH },
    { x: fixture.center.x - halfW, y: fixture.center.y + halfH },
  ];
}

function getHandles(fixture) {
  if (fixture.shape === "polygon") {
    return fixture.vertices.map((point, index) => ({ kind: "vertex", index, point }));
  }
  if (fixture.shape === "circle") {
    return [
      { kind: "center", point: fixture.center },
      { kind: "radius", point: { x: fixture.center.x + fixture.radius, y: fixture.center.y } },
    ];
  }
  if (fixture.shape === "box") {
    return [
      { kind: "center", point: fixture.center },
      ...boxCorners(fixture).map((point, index) => ({ kind: "corner", index, point })),
    ];
  }
  return [];
}

function onPointerDown(event) {
  canvas.setPointerCapture(event.pointerId);
  const screen = eventToScreen(event);
  const selected = getFixture();
  const hit = getHandles(selected)
    .map((handle) => ({ handle, screen: worldToScreen(handle.point) }))
    .find(({ screen: point }) => distance(point, screen) <= HANDLE_RADIUS_PX + 4);
  if (hit) {
    state.drag = {
      kind: "handle",
      handle: hit.handle,
      fixture: selected,
      startWorld: screenToWorld(screen),
      original: structuredClone(stripFixtureRuntime(selected)),
    };
    return;
  }

  const fixture = getFixtureAtScreen(screen);
  if (fixture && fixture.id !== state.fixtureId) {
    state.fixtureId = fixture.id;
    fixtureSelect.value = fixture.id;
    updateControls();
    updatePatchOutput();
  }

  state.drag = {
    kind: "pan",
    startScreen: screen,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
  };
}

function onPointerMove(event) {
  if (!state.drag) return;
  const screen = eventToScreen(event);
  if (state.drag.kind === "pan") {
    view.offsetX = state.drag.offsetX + screen.x - state.drag.startScreen.x;
    view.offsetY = state.drag.offsetY + screen.y - state.drag.startScreen.y;
    return;
  }

  const world = screenToWorld(screen);
  editFixtureFromDrag(state.drag.fixture, state.drag.handle, world, state.drag.original);
  updateControls();
  updatePatchOutput();
}

function endDrag() {
  state.drag = null;
}

function onWheel(event) {
  event.preventDefault();
  const screen = eventToScreen(event);
  const before = screenToWorld(screen);
  const factor = event.deltaY < 0 ? 1.1 : 0.9;
  view.scale = clamp(view.scale * factor, 8, 360);
  const after = worldToScreen(before);
  view.offsetX += screen.x - after.x;
  view.offsetY += screen.y - after.y;
}

function editFixtureFromDrag(fixture, handle, world, original) {
  if (fixture.shape === "polygon" && handle.kind === "vertex") {
    fixture.vertices[handle.index] = roundPoint(world);
  }
  if (fixture.shape === "circle" && handle.kind === "center") {
    fixture.center = roundPoint(world);
  }
  if (fixture.shape === "circle" && handle.kind === "radius") {
    fixture.radius = roundNumber(Math.max(MIN_SIZE, Math.hypot(world.x - original.center.x, world.y - original.center.y)));
  }
  if (fixture.shape === "box" && handle.kind === "center") {
    fixture.center = roundPoint(world);
  }
  if (fixture.shape === "box" && handle.kind === "corner") {
    const opposite = boxCorners(original)[(handle.index + 2) % 4];
    const minX = Math.min(opposite.x, world.x);
    const maxX = Math.max(opposite.x, world.x);
    const minY = Math.min(opposite.y, world.y);
    const maxY = Math.max(opposite.y, world.y);
    fixture.center = roundPoint({ x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5 });
    fixture.width = roundNumber(Math.max(MIN_SIZE, maxX - minX));
    fixture.height = roundNumber(Math.max(MIN_SIZE, maxY - minY));
  }
}

function getFixtureAtScreen(screen) {
  const part = getPart();
  for (let i = part.fixtures.length - 1; i >= 0; i--) {
    const fixture = part.fixtures[i];
    if (fixtureContainsScreenPoint(fixture, screen)) return fixture;
  }
  return null;
}

function fixtureContainsScreenPoint(fixture, screen) {
  const world = screenToWorld(screen);
  if (fixture.shape === "circle") return Math.hypot(world.x - fixture.center.x, world.y - fixture.center.y) <= fixture.radius;
  if (fixture.shape === "box") {
    return Math.abs(world.x - fixture.center.x) <= fixture.width * 0.5
      && Math.abs(world.y - fixture.center.y) <= fixture.height * 0.5;
  }
  if (fixture.shape === "polygon") return pointInPolygon(world, fixture.vertices);
  return false;
}

function pointInPolygon(point, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && (point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

function updateControls() {
  const fixture = getFixture();
  selectionSummary.textContent = `${getVehicle().label} / ${getPart().label} / ${fixture.label}`;
  shapeControls.replaceChildren();
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = getHint(fixture);
  shapeControls.append(hint);
  const grid = document.createElement("div");
  grid.className = "control-grid";
  if (fixture.shape === "circle") {
    grid.append(
      numberInput("Center X", fixture.center.x, (value) => { fixture.center.x = value; }),
      numberInput("Center Y", fixture.center.y, (value) => { fixture.center.y = value; }),
      numberInput("Radius", fixture.radius, (value) => { fixture.radius = Math.max(MIN_SIZE, value); }),
    );
  } else if (fixture.shape === "box") {
    grid.append(
      numberInput("Center X", fixture.center.x, (value) => { fixture.center.x = value; }),
      numberInput("Center Y", fixture.center.y, (value) => { fixture.center.y = value; }),
      numberInput("Width", fixture.width, (value) => { fixture.width = Math.max(MIN_SIZE, value); }),
      numberInput("Height", fixture.height, (value) => { fixture.height = Math.max(MIN_SIZE, value); }),
    );
  } else {
    fixture.vertices.forEach((vertex, index) => {
      grid.append(
        numberInput(`V${index + 1} X`, vertex.x, (value) => { vertex.x = value; }),
        numberInput(`V${index + 1} Y`, vertex.y, (value) => { vertex.y = value; }),
      );
    });
  }
  shapeControls.append(grid);
}

function numberInput(label, value, onChange) {
  const wrapper = document.createElement("label");
  const span = document.createElement("span");
  const input = document.createElement("input");
  span.textContent = label;
  input.type = "number";
  input.step = "0.01";
  input.value = roundNumber(value).toFixed(2);
  input.addEventListener("change", () => {
    onChange(roundNumber(Number(input.value) || 0));
    updateControls();
    updatePatchOutput();
  });
  wrapper.append(span, input);
  return wrapper;
}

function getHint(fixture) {
  if (fixture.shape === "polygon") return "Drag white handles to move vertices. Click another shape to select it. Mouse wheel zooms, empty-space drag pans.";
  if (fixture.shape === "circle") return "Drag the green center to move the circle, or the white edge handle to change radius.";
  return "Drag the green center to move the box, or a white corner to resize it.";
}

function updatePatchOutput() {
  patchOutput.value = JSON.stringify(createPatch(), null, 2);
}

function createPatch() {
  const fixture = getFixture();
  return {
    vehicle: state.vehicleId,
    part: state.partId,
    fixture: fixture.id,
    label: fixture.label,
    shape: fixture.shape,
    exportMode: fixture.exportMode,
    data: exportFixtureData(fixture),
  };
}

function exportFixtureData(fixture) {
  if (fixture.shape === "circle") {
    return {
      center: roundPoint(fixture.center),
      radius: roundNumber(fixture.radius),
    };
  }
  if (fixture.shape === "box") {
    return {
      center: roundPoint(fixture.center),
      width: roundNumber(fixture.width),
      height: roundNumber(fixture.height),
      planck: `Box(${roundNumber(fixture.width * 0.5)}, ${roundNumber(fixture.height * 0.5)}, Vec2(${roundNumber(fixture.center.x)}, ${roundNumber(fixture.center.y)}), 0)`,
    };
  }

  const vertices = fixture.vertices.map((vertex) => exportVertex(vertex, fixture.exportMode));
  return {
    vertices,
    planck: `Polygon([\n${vertices.map((vertex) => `  Vec2(${vertex.x}, ${vertex.y})`).join(",\n")}\n])`,
  };
}

function exportVertex(vertex, mode) {
  if (mode === "wreckSource") {
    return roundPoint({
      x: vertex.x / WRECKERSAURUS_SCALE,
      y: -vertex.y / WRECKERSAURUS_SCALE,
    });
  }
  if (mode === "wreckDirt") {
    return roundPoint({
      x: vertex.x,
      y: -vertex.y,
    });
  }
  if (mode === "rollersaurusBody") {
    return roundPoint({
      x: vertex.x / (0.015 / 0.012),
      y: vertex.y / (0.015 / 0.012),
    });
  }
  return roundPoint(vertex);
}

async function copyPatch() {
  await navigator.clipboard.writeText(patchOutput.value);
  copyPatchButton.textContent = "Copied";
  setTimeout(() => {
    copyPatchButton.textContent = "Copy Patch";
  }, 900);
}

function eventToScreen(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function screenToWorld(point) {
  return {
    x: (point.x - view.offsetX) / view.scale,
    y: (point.y - view.offsetY) / view.scale,
  };
}

function worldToScreen(point) {
  return {
    x: point.x * view.scale + view.offsetX,
    y: point.y * view.scale + view.offsetY,
  };
}

function stripFixtureRuntime(fixture) {
  return {
    shape: fixture.shape,
    center: fixture.center ? { ...fixture.center } : null,
    radius: fixture.radius,
    width: fixture.width,
    height: fixture.height,
    vertices: fixture.vertices?.map((vertex) => ({ ...vertex })) ?? null,
  };
}

function roundPoint(point) {
  return {
    x: roundNumber(point.x),
    y: roundNumber(point.y),
  };
}

function roundNumber(value) {
  return Number(value.toFixed(4));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}
