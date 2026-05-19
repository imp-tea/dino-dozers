import { PACKED } from "./cellTypes.js";

const CONTOUR_REBUILD_INTERVAL_TICKS = 8;

export function createPackedContourCache({ state, grid }) {
  const { index, inBounds } = grid;
  let packedContourCacheTick = -CONTOUR_REBUILD_INTERVAL_TICKS;
  let isPackedContourCacheDirty = true;
  let packedContours = [];
  let holeContours = [];

  function markDirty() {
    isPackedContourCacheDirty = true;
  }

  function getContours() {
    updatePackedContourCache();
    return packedContours;
  }

  function getRenderContours() {
    updatePackedContourCache();
    return {
      outer: packedContours,
      holes: holeContours,
    };
  }

  function clear() {
    packedContours = [];
    holeContours = [];
    markDirty();
  }

  function isPackedCell(x, y) {
    return inBounds(x, y) && state.cells[index(x, y)] === PACKED;
  }

  function pointKey(x, y) {
    return `${x},${y}`;
  }

  function addEdge(edges, edgesByStart, sx, sy, ex, ey, cellX, cellY) {
    const edge = {
      start: { x: sx, y: sy },
      end: { x: ex, y: ey },
      point: { x: (sx + ex) * 0.5, y: (sy + ey) * 0.5 },
      used: false,
    };
    edges.push(edge);

    const key = pointKey(sx, sy);
    const bucket = edgesByStart.get(key);
    if (bucket) bucket.push(edge);
    else edgesByStart.set(key, [edge]);
  }

  function collectBoundaryEdges(outsideEmpty) {
    const edges = [];
    const edgesByStart = new Map();
    const holeEdges = [];
    const holeEdgesByStart = new Map();

    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (!isPackedCell(x, y)) continue;

        addBoundaryEdgeForNeighbor(outsideEmpty, edges, edgesByStart, holeEdges, holeEdgesByStart, x, y, x, y - 1, x, y, x + 1, y);
        addBoundaryEdgeForNeighbor(outsideEmpty, edges, edgesByStart, holeEdges, holeEdgesByStart, x, y, x + 1, y, x + 1, y, x + 1, y + 1);
        addBoundaryEdgeForNeighbor(outsideEmpty, edges, edgesByStart, holeEdges, holeEdgesByStart, x, y, x, y + 1, x + 1, y + 1, x, y + 1);
        addBoundaryEdgeForNeighbor(outsideEmpty, edges, edgesByStart, holeEdges, holeEdgesByStart, x, y, x - 1, y, x, y + 1, x, y);
      }
    }

    return { edges, edgesByStart, holeEdges, holeEdgesByStart };
  }

  function addBoundaryEdgeForNeighbor(
    outsideEmpty,
    edges,
    edgesByStart,
    holeEdges,
    holeEdgesByStart,
    cellX,
    cellY,
    neighborX,
    neighborY,
    sx,
    sy,
    ex,
    ey,
  ) {
    if (isPackedCell(neighborX, neighborY)) return;
    const target = isOutsideEmpty(outsideEmpty, neighborX, neighborY)
      ? { edges, edgesByStart }
      : { edges: holeEdges, edgesByStart: holeEdgesByStart };
    addEdge(target.edges, target.edgesByStart, sx, sy, ex, ey, cellX, cellY);
  }

  function stitchBoundaryEdges(edges, edgesByStart) {
    const contours = [];

    for (const firstEdge of edges) {
      if (firstEdge.used) continue;

      firstEdge.used = true;
      const contour = [firstEdge.point];
      let current = firstEdge.end;

      while (contour.length <= edges.length + 1) {
        if (current.x === firstEdge.start.x && current.y === firstEdge.start.y) break;

        const candidates = edgesByStart.get(pointKey(current.x, current.y));
        const next = candidates?.find((edge) => !edge.used);
        if (!next) break;

        next.used = true;
        pushUniquePoint(contour, next.point);
        current = next.end;
      }

      if (contour.length >= 3) contours.push(removeDuplicateClosingPoint(contour));
    }

    return contours.filter((contour) => contour.length >= 3);
  }

  function pushUniquePoint(points, point) {
    const previous = points[points.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) return;
    points.push(point);
  }

  function removeDuplicateClosingPoint(contour) {
    const first = contour[0];
    const last = contour[contour.length - 1];
    if (first && last && first.x === last.x && first.y === last.y) contour.pop();
    return contour;
  }

  function classifyOutsideEmpty() {
    const outsideEmpty = new Uint8Array(state.width * state.height);
    const queue = [];

    for (let x = 0; x < state.width; x++) {
      addOutsideSeed(outsideEmpty, queue, x, 0);
      addOutsideSeed(outsideEmpty, queue, x, state.height - 1);
    }

    for (let y = 1; y < state.height - 1; y++) {
      addOutsideSeed(outsideEmpty, queue, 0, y);
      addOutsideSeed(outsideEmpty, queue, state.width - 1, y);
    }

    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      const x = current % state.width;
      const y = Math.floor(current / state.width);
      addOutsideSeed(outsideEmpty, queue, x + 1, y);
      addOutsideSeed(outsideEmpty, queue, x - 1, y);
      addOutsideSeed(outsideEmpty, queue, x, y + 1);
      addOutsideSeed(outsideEmpty, queue, x, y - 1);
    }

    return outsideEmpty;
  }

  function addOutsideSeed(outsideEmpty, queue, x, y) {
    if (!inBounds(x, y)) return;
    const i = index(x, y);
    if (outsideEmpty[i] || state.cells[i] === PACKED) return;
    outsideEmpty[i] = 1;
    queue.push(i);
  }

  function isOutsideEmpty(outsideEmpty, x, y) {
    if (!inBounds(x, y)) return true;
    const i = index(x, y);
    return state.cells[i] !== PACKED && outsideEmpty[i] === 1;
  }

  function rebuildPackedContours() {
    const outsideEmpty = classifyOutsideEmpty();
    const { edges, edgesByStart, holeEdges, holeEdgesByStart } = collectBoundaryEdges(outsideEmpty);
    packedContours = stitchBoundaryEdges(edges, edgesByStart);
    holeContours = stitchBoundaryEdges(holeEdges, holeEdgesByStart);
    packedContourCacheTick = state.tick;
    isPackedContourCacheDirty = false;
  }

  function updatePackedContourCache() {
    if (!isPackedContourCacheDirty && state.tick - packedContourCacheTick < CONTOUR_REBUILD_INTERVAL_TICKS) return;
    rebuildPackedContours();
  }

  return {
    markDirty,
    getContours,
    getRenderContours,
    clear,
  };
}
