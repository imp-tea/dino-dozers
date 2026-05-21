const DEFAULT_TILE_SIZE = 24;
const DEFAULT_WAKE_TICKS = 8;
const DEFAULT_WAKE_PADDING_TILES = 1;

export function createActivityGrid({
  state,
  tileSize = DEFAULT_TILE_SIZE,
  wakeTicks = DEFAULT_WAKE_TICKS,
  wakePaddingTiles = DEFAULT_WAKE_PADDING_TILES,
} = {}) {
  let columns = 0;
  let rows = 0;
  let activeUntil = new Uint32Array(0);

  function resize() {
    columns = Math.max(1, Math.ceil(state.width / tileSize));
    rows = Math.max(1, Math.ceil(state.height / tileSize));
    activeUntil = new Uint32Array(columns * rows);
  }

  function tileIndex(tx, ty) {
    return ty * columns + tx;
  }

  function wakeTile(tx, ty, padding = wakePaddingTiles, ticks = wakeTicks) {
    if (!activeUntil.length) resize();
    const minX = Math.max(0, tx - padding);
    const maxX = Math.min(columns - 1, tx + padding);
    const minY = Math.max(0, ty - padding);
    const maxY = Math.min(rows - 1, ty + padding);
    const until = state.tick + ticks;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = tileIndex(x, y);
        if (activeUntil[i] < until) activeUntil[i] = until;
      }
    }
  }

  function wakeCell(x, y, padding = wakePaddingTiles, ticks = wakeTicks) {
    if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
    wakeTile(Math.floor(x / tileSize), Math.floor(y / tileSize), padding, ticks);
  }

  function wakeIndex(i, padding = wakePaddingTiles, ticks = wakeTicks) {
    wakeCell(i % state.width, Math.floor(i / state.width), padding, ticks);
  }

  function wakeRegion(region, padding = wakePaddingTiles, ticks = wakeTicks) {
    if (!region) return;
    if (!activeUntil.length) resize();
    const minTileX = Math.max(0, Math.floor(region.minX / tileSize));
    const maxTileX = Math.min(columns - 1, Math.floor(region.maxX / tileSize));
    const minTileY = Math.max(0, Math.floor(region.minY / tileSize));
    const maxTileY = Math.min(rows - 1, Math.floor(region.maxY / tileSize));

    for (let y = minTileY; y <= maxTileY; y++) {
      for (let x = minTileX; x <= maxTileX; x++) {
        wakeTile(x, y, padding, ticks);
      }
    }
  }

  function wakeAll(ticks = wakeTicks) {
    if (!activeUntil.length) resize();
    activeUntil.fill(state.tick + ticks);
  }

  function isActiveTileIndex(i) {
    return activeUntil[i] >= state.tick;
  }

  function isCellActive(x, y) {
    if (x < 0 || x >= state.width || y < 0 || y >= state.height) return false;
    if (!activeUntil.length) resize();
    const tx = Math.floor(x / tileSize);
    const ty = Math.floor(y / tileSize);
    return isActiveTileIndex(tileIndex(tx, ty));
  }

  function forEachActiveTileBounds(visit, { haloCells = 0 } = {}) {
    if (!activeUntil.length) resize();
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < columns; tx++) {
        const i = tileIndex(tx, ty);
        if (!isActiveTileIndex(i)) continue;
        const minX = Math.max(0, tx * tileSize - haloCells);
        const maxX = Math.min(state.width - 1, (tx + 1) * tileSize - 1 + haloCells);
        const minY = Math.max(0, ty * tileSize - haloCells);
        const maxY = Math.min(state.height - 1, (ty + 1) * tileSize - 1 + haloCells);
        visit({ tx, ty, minX, maxX, minY, maxY });
      }
    }
  }

  function getTiles() {
    if (!activeUntil.length) resize();
    return {
      columns,
      rows,
      tileSize,
      activeUntil,
    };
  }

  resize();

  return {
    resize,
    wakeCell,
    wakeIndex,
    wakeRegion,
    wakeAll,
    isCellActive,
    forEachActiveTileBounds,
    getTiles,
  };
}
