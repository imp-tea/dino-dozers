import { EMPTY, LOOSE, PACKED } from "../sim/cellTypes.js";

const STRESS_VISUAL_EASE = 0.055;
const STRESS_EDGE_FADE_CELLS = 6;
const PACKED_COLOR_CHANNELS = Array.from({ length: 16 }, (_, shade) => ({
  r: 118 + shade,
  g: 83 + Math.floor(shade * 0.35),
  b: 58,
}));
const PACKED_COLORS = PACKED_COLOR_CHANNELS.map(({ r, g, b }) => `rgb(${r}, ${g}, ${b})`);
const LOOSE_COLORS = Array.from({ length: 19 }, (_, shade) => {
  return `rgb(${178 + shade}, ${129 + Math.floor(shade * 0.45)}, ${70 + Math.floor(shade * 0.25)})`;
});

export function createDirtRenderer({ state, grid, controls, ctx, statsElement, statsCache }) {
  const { index, inBounds } = grid;

  function drawCells({ cellW, cellH, dirtTween }) {
    const showStress = controls.stressView.checked;
    const showDamage = controls.damageView.checked;
    const showPackedContours = controls.contourView.checked;
    const threshold = controls.cohesion.value;
    updateVisualStress(showStress);

    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const i = index(x, y);
        const cell = state.cells[i];
        if (cell === EMPTY) continue;
        if (cell === PACKED && showPackedContours) continue;

        if (cell === LOOSE) {
          ctx.fillStyle = controls.unifiedColor.checked
            ? colorPacked(x, y)
            : colorLoose(x, y, state.tick);
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
  }

  function drawBrushPreview(pointerCell, forEachBrushCell, cellW, cellH) {
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

  return {
    drawCells,
    drawBrushPreview,
    updateStats,
  };
}

export function colorLoose(x, y, tick) {
  const shade = (x * 13 + y * 7 + tick) % 19;
  return LOOSE_COLORS[shade];
}

export function colorPacked(x, y) {
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
