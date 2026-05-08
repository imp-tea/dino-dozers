const EMPTY = 0;
const LOOSE = 1;
const PACKED = 2;

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
  unifiedColor: document.querySelector("#unifiedColor"),
};

const state = {
  width: controls.gridWidth.value,
  height: controls.gridHeight.value,
  cells: null,
  ages: null,
  damage: null,
  stress: null,
  tool: "packed",
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
}

function clearCell(i) {
  state.cells[i] = EMPTY;
  state.ages[i] = 0;
  state.damage[i] = 0;
  state.stress[i] = 0;
}

function setCell(i, kind) {
  state.cells[i] = kind;
  state.ages[i] = 0;
  state.damage[i] = 0;
  state.stress[i] = 0;
}

function seedWorld() {
  state.cells.fill(EMPTY);
  state.ages.fill(0);
  state.damage.fill(0);
  state.stress.fill(0);

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
      if (state.cells[i] !== LOOSE) continue;

      if (y < h - 1) {
        const below = index(x, y + 1);
        if (state.cells[below] === EMPTY) {
          swapCells(i, below);
          state.ages[below] = 0;
          continue;
        }
      }

      const dir = Math.random() < 0.5 ? -1 : 1;
      const moved =
        (y < h - 1 && tryMoveLoose(x, y, dir, controls.spread.value)) ||
        (y < h - 1 && tryMoveLoose(x, y, -dir, controls.spread.value)) ||
        trySideJitter(x, y, dir);

      if (!moved) {
        state.ages[i]++;
        if (state.ages[i] >= controls.settleTicks.value) {
          state.cells[i] = PACKED;
          state.ages[i] = 0;
        }
      }
    }
  }
}

function tryMoveLoose(x, y, dir, probability) {
  if (Math.random() > probability) return false;
  const nx = x + dir;
  const ny = y + 1;
  if (!inBounds(nx, ny)) return false;
  const target = index(nx, ny);
  if (state.cells[target] !== EMPTY) return false;
  swapCells(index(x, y), target);
  state.ages[target] = 0;
  return true;
}

function trySideJitter(x, y, dir) {
  if (Math.random() > controls.jitter.value) return false;
  const nx = x + dir;
  if (!inBounds(nx, y)) return false;
  const target = index(nx, y);
  if (state.cells[target] !== EMPTY) return false;
  swapCells(index(x, y), target);
  state.ages[target] = 0;
  return true;
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
  const nextWidth = Math.max(1, Math.floor(wrap.width * ratio));
  const nextHeight = Math.max(1, Math.floor(wrap.height * ratio));
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
  const threshold = controls.cohesion.value;

  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const i = index(x, y);
      const cell = state.cells[i];
      if (cell === EMPTY) continue;

      if (cell === LOOSE) {
        ctx.fillStyle = controls.unifiedColor.checked
          ? colorPacked(x, y, state.damage[i])
          : colorLoose(x, y);
      } else if (showStress) {
        ctx.fillStyle = colorStress(state.stress[i], threshold, state.damage[i]);
      } else {
        ctx.fillStyle = colorPacked(x, y, state.damage[i]);
      }
      ctx.fillRect(
        Math.floor(x * cellW),
        Math.floor(y * cellH),
        Math.ceil(cellW),
        Math.ceil(cellH),
      );
    }
  }

  drawBrushPreview(cellW, cellH);
  updateStats();
}

function colorLoose(x, y) {
  const shade = (x * 13 + y * 7 + state.tick) % 19;
  return `rgb(${178 + shade}, ${129 + Math.floor(shade * 0.45)}, ${70 + Math.floor(shade * 0.25)})`;
}

function colorPacked(x, y, damage) {
  const shade = (x * 11 + y * 5) % 16;
  const crack = Math.floor(damage * 42);
  return `rgb(${118 + shade + crack}, ${83 + Math.floor(shade * 0.35)}, ${58 - Math.min(crack, 22)})`;
}

function colorStress(stress, threshold, damage) {
  const t = Math.max(0, Math.min(stress / Math.max(threshold, 1), 1.6));
  const heat = Math.min(1, t / 1.25);
  const r = Math.floor(107 + heat * 150);
  const g = Math.floor(82 - heat * 25 + damage * 70);
  const b = Math.floor(56 - heat * 20);
  return `rgb(${r}, ${g}, ${b})`;
}

let pointerCell = null;

function drawBrushPreview(cellW, cellH) {
  if (!pointerCell) return;
  const radius = controls.brushSize.value;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.84)";
  ctx.lineWidth = Math.max(1, Math.min(cellW, cellH));
  ctx.beginPath();
  ctx.ellipse(
    (pointerCell.x + 0.5) * cellW,
    (pointerCell.y + 0.5) * cellH,
    radius * cellW,
    radius * cellH,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
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
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.width);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.height);
  pointerCell = { x, y };
  paintDisc(x, y);
}

function paintDisc(cx, cy) {
  const radius = controls.brushSize.value;
  const radiusSq = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radiusSq) continue;
      const i = index(x, y);
      if (state.tool === "erase") clearCell(i);
      if (state.tool === "loose") setCell(i, LOOSE);
      if (state.tool === "packed") setCell(i, PACKED);
    }
  }
}

function frame() {
  if (state.running) {
    for (let n = 0; n < controls.speed.value; n++) simulationStep();
  }
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
});

document.querySelector("#clear").addEventListener("click", () => {
  state.cells.fill(EMPTY);
  state.ages.fill(0);
  state.damage.fill(0);
  state.stress.fill(0);
  state.tick = 0;
});

document.querySelector("#resize").addEventListener("click", () => {
  resizeGrid(controls.gridWidth.value, controls.gridHeight.value);
});

document.querySelectorAll(".mode").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".mode").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    state.tool = button.dataset.tool;
  });
});

canvas.addEventListener("pointerdown", (event) => {
  state.painting = true;
  canvas.setPointerCapture(event.pointerId);
  paintAtEvent(event);
});

canvas.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  pointerCell = {
    x: Math.floor(((event.clientX - rect.left) / rect.width) * state.width),
    y: Math.floor(((event.clientY - rect.top) / rect.height) * state.height),
  };
  if (state.painting) paintAtEvent(event);
});

canvas.addEventListener("pointerup", (event) => {
  state.painting = false;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointerleave", () => {
  pointerCell = null;
});

resizeGrid(state.width, state.height);
requestAnimationFrame(frame);
