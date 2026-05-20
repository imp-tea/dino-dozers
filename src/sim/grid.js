import { EMPTY, LOOSE, PACKED } from "./cellTypes.js";

const noop = () => {};

export function createGridState({ width, height }) {
  return {
    width,
    height,
    cells: null,
    ages: null,
    looseContactAges: null,
    looseSettleLocks: null,
    damage: null,
    stress: null,
    visualStress: null,
    stressVisibility: null,
    visualX: null,
    visualY: null,
    rigid: null,
    rigidVx: null,
    rigidVy: null,
    rigidMass: null,
    rigidImpactMass: null,
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
    looseCount: 0,
    packedCount: 0,
    tool: "packed",
    brushShape: "circle",
    running: true,
    painting: false,
    tick: 0,
    rngFlip: false,
  };
}

export function createGrid(state, callbacks = {}) {
  const markCanvasLayoutDirty = callbacks.markCanvasLayoutDirty ?? noop;
  const markStatsDirty = callbacks.markStatsDirty ?? noop;
  const markPackedTerrainDirty = callbacks.markPackedTerrainDirty ?? noop;
  const markCellActive = callbacks.markCellActive ?? noop;
  const onCellKindChanged = callbacks.onCellKindChanged ?? noop;
  const onResize = callbacks.onResize ?? noop;

  function resizeGrid(width, height) {
    state.width = width;
    state.height = height;
    const total = width * height;
    state.cells = new Uint8Array(total);
    state.ages = new Uint16Array(total);
    state.looseContactAges = new Uint16Array(total);
    state.looseSettleLocks = new Uint16Array(total);
    state.damage = new Float32Array(total);
    state.stress = new Float32Array(total);
    state.visualStress = new Float32Array(total);
    state.stressVisibility = new Float32Array(total);
    state.visualX = new Float32Array(total);
    state.visualY = new Float32Array(total);
    state.rigid = new Uint8Array(total);
    state.rigidVx = new Float32Array(total);
    state.rigidVy = new Float32Array(total);
    state.rigidMass = new Float32Array(total);
    state.rigidImpactMass = new Float32Array(total);
    state.externalLoad = new Float32Array(total);
    state.vx = new Int16Array(total);
    state.vy = new Int16Array(total);
    state.touched = new Uint32Array(total);
    state.clusterSeen = new Uint32Array(total);
    state.clusterSeenToken = 0;
    state.supportDistances = new Float32Array(total);
    state.supportLoads = new Float32Array(total);
    resetCellCounts();
    state.tick = 0;
    markCanvasLayoutDirty();
    markStatsDirty();
    onResize();
  }

  function resetCellVisualPosition(i) {
    state.visualX[i] = i % state.width;
    state.visualY[i] = Math.floor(i / state.width);
  }

  function settleDirtVisualPositions() {
    const total = state.width * state.height;
    for (let i = 0; i < total; i++) resetCellVisualPosition(i);
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

  function resetCellCounts() {
    state.looseCount = 0;
    state.packedCount = 0;
  }

  function updateCellCounts(fromKind, toKind, shouldMarkStats = true) {
    if (fromKind === toKind) return;
    if (fromKind === LOOSE) state.looseCount--;
    else if (fromKind === PACKED) state.packedCount--;

    if (toKind === LOOSE) state.looseCount++;
    else if (toKind === PACKED) state.packedCount++;

    if (shouldMarkStats) markStatsDirty();
  }

  function clearCell(i, shouldMarkStats = true) {
    const fromKind = state.cells[i];
    const wasPacked = fromKind === PACKED;
    updateCellCounts(fromKind, EMPTY, shouldMarkStats);
    state.cells[i] = EMPTY;
    state.ages[i] = 0;
    state.looseContactAges[i] = 0;
    state.looseSettleLocks[i] = 0;
    state.damage[i] = 0;
    state.stress[i] = 0;
    state.visualStress[i] = 0;
    state.stressVisibility[i] = 0;
    state.vx[i] = 0;
    state.vy[i] = 0;
    state.touched[i] = 0;
    resetCellVisualPosition(i);
    markCellActive(i);
    if (fromKind !== EMPTY) onCellKindChanged(i, fromKind, EMPTY);
    if (wasPacked) markPackedTerrainDirty();
  }

  function setCell(i, kind) {
    const fromKind = state.cells[i];
    const wasPacked = fromKind === PACKED;
    updateCellCounts(fromKind, kind);
    state.cells[i] = kind;
    state.ages[i] = 0;
    state.looseContactAges[i] = 0;
    state.looseSettleLocks[i] = 0;
    state.damage[i] = 0;
    state.stress[i] = 0;
    state.visualStress[i] = 0;
    state.stressVisibility[i] = 0;
    state.vx[i] = 0;
    state.vy[i] = 0;
    state.touched[i] = 0;
    resetCellVisualPosition(i);
    markCellActive(i);
    if (fromKind !== kind) onCellKindChanged(i, fromKind, kind);
    if (wasPacked || kind === PACKED) markPackedTerrainDirty();
  }

  return {
    resizeGrid,
    index,
    inBounds,
    setCell,
    clearCell,
    resetCellCounts,
    resetCellVisualPosition,
    settleDirtVisualPositions,
    isEmptyForDirt,
    isSolidForDirt,
    updateCellCounts,
  };
}
