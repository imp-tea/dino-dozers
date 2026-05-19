import { EMPTY, LOOSE, PACKED } from "../sim/cellTypes.js";
import {
  colorDamage,
  colorLoose,
  colorPacked,
  colorStress,
  createPaperDirtStyle,
  drawDamageTear,
  drawLoosePaperChunk,
  drawPackedCellPaper,
  drawStressMark,
  strokePackedPaperEdge,
} from "./paperDirtStyle.js";

const STRESS_VISUAL_EASE = 0.055;
const STRESS_EDGE_FADE_CELLS = 4;

export function createDirtRenderer({ state, grid, controls, ctx, statsElement, statsCache }) {
  const { index, inBounds } = grid;
  const paperStyle = createPaperDirtStyle(ctx);

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
          const fillStyle = controls.unifiedColor.checked
            ? colorPacked(x, y)
            : colorLoose(x, y, state.tick);
          const drawX = state.visualX[i] + (x - state.visualX[i]) * dirtTween;
          const drawY = state.visualY[i] + (y - state.visualY[i]) * dirtTween;
          drawLoosePaperChunk(ctx, drawX, drawY, cellW, cellH, fillStyle);
          continue;
        } else if (showDamage) {
          drawPackedCellPaper(ctx, x, y, cellW, cellH, colorDamage(x, y, state.damage[i]));
          drawDamageTear(ctx, x, y, cellW, cellH, state.damage[i]);
          continue;
        } else if (showStress) {
          drawPackedCellPaper(ctx, x, y, cellW, cellH, colorStress(x, y, state.visualStress[i], threshold));
          drawStressMark(ctx, x, y, cellW, cellH, state.visualStress[i], threshold);
          continue;
        } else {
          drawPackedCellPaper(ctx, x, y, cellW, cellH, colorPacked(x, y));
          if (state.damage[i] > 0.1) drawDamageTear(ctx, x, y, cellW, cellH, state.damage[i] * 0.45);
          if (state.visualStress[i] > 0) drawStressMark(ctx, x, y, cellW, cellH, state.visualStress[i] * 0.6, threshold);
          continue;
        }
      }
    }
  }

  function drawPackedContourFill(contours, cellW, cellH) {
    if (!controls.contourView.checked) return;

    const showStress = controls.stressView.checked;
    const showDamage = controls.damageView.checked;
    const threshold = controls.cohesion.value;
    updateVisualStress(showStress);

    ctx.save();
    for (const contour of contours) {
      if (contour.length < 3) continue;
      tracePackedContour(ctx, contour, cellW, cellH);
      ctx.fillStyle = "#805739";
      ctx.fill("evenodd");

      ctx.save();
      tracePackedContour(ctx, contour, cellW, cellH);
      ctx.clip("evenodd");
      paperStyle.fillPaperTexture(ctx.canvas.width, ctx.canvas.height, 0.24);
      ctx.restore();
    }
    ctx.restore();

    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const i = index(x, y);
        if (state.cells[i] !== PACKED) continue;
        if (showDamage) {
          drawDamageTear(ctx, x, y, cellW, cellH, state.damage[i]);
        } else if (showStress) {
          drawStressMark(ctx, x, y, cellW, cellH, state.visualStress[i], threshold);
        } else {
          if (state.damage[i] > 0.1) drawDamageTear(ctx, x, y, cellW, cellH, state.damage[i] * 0.45);
          if (state.visualStress[i] > 0) drawStressMark(ctx, x, y, cellW, cellH, state.visualStress[i] * 0.6, threshold);
        }
      }
    }
  }

  function drawPackedContourOverlay(contours, cellW, cellH) {
    if (!controls.contourView.checked) return;

    ctx.save();
    strokePackedPaperEdge(ctx, cellW, cellH);

    for (const contour of contours) {
      if (contour.length < 3) continue;
      tracePackedContour(ctx, contour, cellW, cellH);
      ctx.stroke();
    }

    ctx.restore();
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
    drawPackedContourFill,
    drawPackedContourOverlay,
    drawBrushPreview,
    updateStats,
  };
}

function tracePackedContour(ctx, contour, cellW, cellH) {
  ctx.beginPath();
  ctx.moveTo(contour[0].x * cellW, contour[0].y * cellH);
  for (let i = 1; i < contour.length; i++) {
    ctx.lineTo(contour[i].x * cellW, contour[i].y * cellH);
  }
  ctx.closePath();
}
