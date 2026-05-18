export function createCanvasLayout({ canvas, canvasWrap, state }) {
  const layout = {
    dirty: true,
    ratio: 0,
    gridWidth: 0,
    gridHeight: 0,
    cellW: 1,
    cellH: 1,
  };

  function markDirty() {
    layout.dirty = true;
  }

  function sync() {
    const ratio = window.devicePixelRatio || 1;
    if (
      !layout.dirty &&
      layout.ratio === ratio &&
      layout.gridWidth === state.width &&
      layout.gridHeight === state.height
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

    layout.dirty = false;
    layout.ratio = ratio;
    layout.gridWidth = state.width;
    layout.gridHeight = state.height;
    layout.cellW = canvas.width / state.width;
    layout.cellH = canvas.height / state.height;
  }

  return {
    layout,
    markDirty,
    sync,
  };
}
