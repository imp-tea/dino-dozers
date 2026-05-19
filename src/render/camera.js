const MIN_ZOOM = 0.55;
const MAX_ZOOM = 4.2;
const CENTER_SMOOTHING = 8.5;
const ZOOM_SMOOTHING = 10.5;
const WHEEL_ZOOM_RATE = 0.0014;

export function createCamera({ canvas, layout, state }) {
  const camera = {
    centerX: state.width * 0.5,
    centerY: state.height * 0.5,
    targetX: state.width * 0.5,
    targetY: state.height * 0.5,
    zoom: 1,
    targetZoom: 1,
    following: true,
  };

  function applyTransform(ctx) {
    ctx.translate(canvas.width * 0.5, canvas.height * 0.5);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.centerX * layout.cellW, -camera.centerY * layout.cellH);
  }

  function update(dt, followTarget = null) {
    syncBounds();

    if (camera.following && followTarget) {
      const target = clampCenter(followTarget.x, followTarget.y, camera.targetZoom);
      camera.targetX = target.x;
      camera.targetY = target.y;
    }

    const centerT = dt > 0 ? 1 - Math.exp(-CENTER_SMOOTHING * dt) : 1;
    const zoomT = dt > 0 ? 1 - Math.exp(-ZOOM_SMOOTHING * dt) : 1;
    camera.zoom += (camera.targetZoom - camera.zoom) * zoomT;
    camera.centerX += (camera.targetX - camera.centerX) * centerT;
    camera.centerY += (camera.targetY - camera.centerY) * centerT;
  }

  function follow(target = null, { immediate = false } = {}) {
    camera.following = true;
    if (!target) return;

    const next = clampCenter(target.x, target.y, camera.targetZoom);
    camera.targetX = next.x;
    camera.targetY = next.y;

    if (immediate) {
      camera.centerX = next.x;
      camera.centerY = next.y;
      camera.zoom = camera.targetZoom;
    }
  }

  function stopFollowing() {
    camera.following = false;
  }

  function panByCssDelta(dx, dy) {
    stopFollowing();
    const scale = cssToCanvasScale();
    const next = clampCenter(
      camera.targetX - (dx * scale.x) / Math.max(1, layout.cellW * camera.targetZoom),
      camera.targetY - (dy * scale.y) / Math.max(1, layout.cellH * camera.targetZoom),
      camera.targetZoom,
    );
    camera.targetX = next.x;
    camera.targetY = next.y;
  }

  function zoomAtEvent(event) {
    const nextZoom = clamp(camera.targetZoom * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE), MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === camera.targetZoom) return;

    if (!camera.following) {
      const point = eventToCanvasPoint(event);
      const anchorX = camera.targetX + (point.x - canvas.width * 0.5) / Math.max(1, layout.cellW * camera.targetZoom);
      const anchorY = camera.targetY + (point.y - canvas.height * 0.5) / Math.max(1, layout.cellH * camera.targetZoom);
      camera.targetX = anchorX - (point.x - canvas.width * 0.5) / Math.max(1, layout.cellW * nextZoom);
      camera.targetY = anchorY - (point.y - canvas.height * 0.5) / Math.max(1, layout.cellH * nextZoom);
    }

    camera.targetZoom = nextZoom;
    const nextCenter = clampCenter(camera.targetX, camera.targetY, camera.targetZoom);
    camera.targetX = nextCenter.x;
    camera.targetY = nextCenter.y;
  }

  function eventToCell(event) {
    const point = eventToCanvasPoint(event);
    return {
      x: Math.floor(camera.centerX + (point.x - canvas.width * 0.5) / Math.max(1, layout.cellW * camera.zoom)),
      y: Math.floor(camera.centerY + (point.y - canvas.height * 0.5) / Math.max(1, layout.cellH * camera.zoom)),
    };
  }

  function visibleCellBounds(padding = 1) {
    const halfCellsX = canvas.width / Math.max(1, layout.cellW * camera.zoom) * 0.5;
    const halfCellsY = canvas.height / Math.max(1, layout.cellH * camera.zoom) * 0.5;
    return {
      minX: clamp(Math.floor(camera.centerX - halfCellsX) - padding, 0, Math.max(0, state.width - 1)),
      maxX: clamp(Math.ceil(camera.centerX + halfCellsX) + padding, 0, Math.max(0, state.width - 1)),
      minY: clamp(Math.floor(camera.centerY - halfCellsY) - padding, 0, Math.max(0, state.height - 1)),
      maxY: clamp(Math.ceil(camera.centerY + halfCellsY) + padding, 0, Math.max(0, state.height - 1)),
    };
  }

  function currentZoom() {
    return camera.zoom;
  }

  function syncBounds() {
    camera.targetZoom = clamp(camera.targetZoom, MIN_ZOOM, MAX_ZOOM);
    camera.zoom = clamp(camera.zoom, MIN_ZOOM, MAX_ZOOM);

    const target = clampCenter(camera.targetX, camera.targetY, camera.targetZoom);
    camera.targetX = target.x;
    camera.targetY = target.y;

    const current = clampCenter(camera.centerX, camera.centerY, camera.zoom);
    camera.centerX = current.x;
    camera.centerY = current.y;
  }

  function clampCenter(x, y) {
    return {
      x: clamp(x, 0, state.width),
      y: clamp(y, 0, state.height),
    };
  }

  function eventToCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const scale = cssToCanvasScale(rect);
    return {
      x: (event.clientX - rect.left) * scale.x,
      y: (event.clientY - rect.top) * scale.y,
    };
  }

  function cssToCanvasScale(rect = canvas.getBoundingClientRect()) {
    return {
      x: canvas.width / Math.max(1, rect.width),
      y: canvas.height / Math.max(1, rect.height),
    };
  }

  return {
    applyTransform,
    currentZoom,
    eventToCell,
    follow,
    panByCssDelta,
    update,
    visibleCellBounds,
    zoomAtEvent,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
