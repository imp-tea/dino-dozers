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
} from "./paperDirtStyle.js";

const STRESS_VISUAL_EASE = 0.055;

export function createDirtRenderer({ state, grid, controls, ctx, statsElement, statsCache }) {
  const { index } = grid;
  const paperStyle = createPaperDirtStyle(ctx);
  let visualStressActive = false;

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
          if (Math.min(cellW, cellH) < 4) drawTinyCell(ctx, drawX, drawY, cellW, cellH, fillStyle);
          else drawLoosePaperChunk(ctx, drawX, drawY, cellW, cellH, fillStyle);
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
    const outerContours = Array.isArray(contours) ? contours : contours.outer;
    const holeContours = Array.isArray(contours) ? [] : contours.holes;
    updateVisualStress(showStress);

    ctx.save();
    for (const contour of outerContours) {
      if (contour.length < 3) continue;
      tracePackedContour(ctx, contour, cellW, cellH);
      ctx.fillStyle = "#805739";
      ctx.fill();

      ctx.save();
      tracePackedContour(ctx, contour, cellW, cellH);
      ctx.clip("evenodd");
      paperStyle.fillPaperTexture(ctx.canvas.width, ctx.canvas.height, 0.24);
      ctx.restore();
    }

    ctx.fillStyle = "#2a2d29";
    for (const contour of holeContours) {
      if (contour.length < 3) continue;
      tracePackedContour(ctx, contour, cellW, cellH);
      ctx.fill();
    }
    ctx.restore();

    if (!showDamage && !showStress) return;

    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const i = index(x, y);
        if (state.cells[i] !== PACKED) continue;
        if (showStress && state.stressVisibility[i] <= 0) continue;
        if (showDamage) drawDamageTear(ctx, x, y, cellW, cellH, state.damage[i]);
        else drawStressMark(ctx, x, y, cellW, cellH, state.visualStress[i], threshold);
      }
    }
  }

  function drawPackedContourOverlay() {}

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
    if (!showStress) {
      if (!visualStressActive) return;
      state.visualStress.fill(0);
      visualStressActive = false;
      return;
    }

    visualStressActive = true;
    const total = state.width * state.height;
    for (let i = 0; i < total; i++) {
      if (state.cells[i] !== PACKED) {
        state.visualStress[i] = 0;
        continue;
      }

      const target = state.stressVisibility[i] > 0 ? state.stress[i] * state.stressVisibility[i] : 0;
      state.visualStress[i] += (target - state.visualStress[i]) * STRESS_VISUAL_EASE;
      if (Math.abs(state.visualStress[i]) < 0.001) state.visualStress[i] = 0;
    }
  }

  return {
    drawCells,
    drawPackedContourFill,
    drawPackedContourOverlay,
    drawBrushPreview,
    updateStats,
  };
}

function drawTinyCell(ctx, x, y, cellW, cellH, fillStyle) {
  ctx.fillStyle = fillStyle;
  ctx.fillRect(Math.floor(x * cellW), Math.floor(y * cellH), Math.ceil(cellW), Math.ceil(cellH));
}

function tracePackedContour(ctx, contour, cellW, cellH) {
  ctx.beginPath();
  ctx.moveTo(contour[0].x * cellW, contour[0].y * cellH);
  for (let i = 1; i < contour.length; i++) {
    ctx.lineTo(contour[i].x * cellW, contour[i].y * cellH);
  }
  ctx.closePath();
}
