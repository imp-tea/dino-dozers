import { PACKED } from "./cellTypes.js";

const CONTOUR_REBUILD_INTERVAL_TICKS = 6;
const CONTOUR_ADAPTIVE_EPSILON = 0.95;
const CONTOUR_ADAPTIVE_MIN_POINTS = 5;
const CONTOUR_CORNER_CONNECTOR_LENGTH = 1;
const CONTOUR_CORNER_CONNECTOR_MAX_ANGLE = Math.PI / 3;

export function createPackedContourCache({ state, grid }) {
  const { index, inBounds } = grid;
  let packedContourCacheTick = -CONTOUR_REBUILD_INTERVAL_TICKS;
  let isPackedContourCacheDirty = true;
  let packedContours = [];

  function markDirty() {
    isPackedContourCacheDirty = true;
  }

  function getContours() {
    updatePackedContourCache();
    return packedContours;
  }

  function clear() {
    packedContours = [];
    markDirty();
  }

  function pointKey(point) {
    return `${point.x},${point.y}`;
  }
  
  function addContourEdge(segments, start, end) {
    segments.push({ start, end });
  }
  
  function addContourCornerSegment(segments, x, y, from, to) {
    const points = {
      north: { x, y: y - 0.5 },
      east: { x: x + 0.5, y },
      south: { x, y: y + 0.5 },
      west: { x: x - 0.5, y },
    };
  
    addContourEdge(segments, points[from], points[to]);
  }
  
  function isPackedCell(x, y) {
    return inBounds(x, y) && state.cells[index(x, y)] === PACKED;
  }
  
  function countPackedCardinalNeighbors(x, y) {
    let count = 0;
    if (isPackedCell(x + 1, y)) count++;
    if (isPackedCell(x - 1, y)) count++;
    if (isPackedCell(x, y + 1)) count++;
    if (isPackedCell(x, y - 1)) count++;
    return count;
  }
  
  function isFilledContourCell(x, y) {
    if (!inBounds(x, y)) return false;
    return isPackedCell(x, y) || countPackedCardinalNeighbors(x, y) >= 3;
  }
  
  function countFilledContourCardinalNeighbors(x, y) {
    let count = 0;
    if (isFilledContourCell(x + 1, y)) count++;
    if (isFilledContourCell(x - 1, y)) count++;
    if (isFilledContourCell(x, y + 1)) count++;
    if (isFilledContourCell(x, y - 1)) count++;
    return count;
  }
  
  function isContourSolidCell(x, y) {
    if (!isFilledContourCell(x, y)) return false;
    if (!isPackedCell(x, y)) return true;
    return countFilledContourCardinalNeighbors(x, y) > 1;
  }
  
  function collectPackedContourSegments() {
    const segments = [];
  
    for (let y = 0; y <= state.height; y++) {
      for (let x = 0; x <= state.width; x++) {
        const northwest = isContourSolidCell(x - 1, y - 1);
        const northeast = isContourSolidCell(x, y - 1);
        const southeast = isContourSolidCell(x, y);
        const southwest = isContourSolidCell(x - 1, y);
        const mask =
          (northwest ? 8 : 0) |
          (northeast ? 4 : 0) |
          (southeast ? 2 : 0) |
          (southwest ? 1 : 0);
  
        switch (mask) {
          case 1:
          case 14:
            addContourCornerSegment(segments, x, y, "west", "south");
            break;
          case 2:
          case 13:
            addContourCornerSegment(segments, x, y, "south", "east");
            break;
          case 3:
          case 12:
            addContourCornerSegment(segments, x, y, "west", "east");
            break;
          case 4:
          case 11:
            addContourCornerSegment(segments, x, y, "east", "north");
            break;
          case 5:
            addContourCornerSegment(segments, x, y, "east", "north");
            addContourCornerSegment(segments, x, y, "west", "south");
            break;
          case 6:
          case 9:
            addContourCornerSegment(segments, x, y, "south", "north");
            break;
          case 7:
          case 8:
            addContourCornerSegment(segments, x, y, "north", "west");
            break;
          case 10:
            addContourCornerSegment(segments, x, y, "north", "west");
            addContourCornerSegment(segments, x, y, "south", "east");
            break;
        }
      }
    }
  
    return segments;
  }
  
  function stitchContourSegments(segments) {
    const contours = [];
    const connected = new Map();
    const used = new Uint8Array(segments.length);
  
    for (let i = 0; i < segments.length; i++) {
      for (const point of [segments[i].start, segments[i].end]) {
        const key = pointKey(point);
        const entries = connected.get(key);
        if (entries) entries.push(i);
        else connected.set(key, [i]);
      }
    }
  
    for (let i = 0; i < segments.length; i++) {
      if (used[i]) continue;
  
      const contour = [segments[i].start, segments[i].end];
      used[i] = 1;
  
      while (contour.length < segments.length + 1) {
        const first = contour[0];
        const current = contour[contour.length - 1];
        if (current.x === first.x && current.y === first.y) break;
  
        const candidates = connected.get(pointKey(current));
        const next = candidates?.find((candidate) => used[candidate] === 0);
        if (next === undefined) break;
  
        used[next] = 1;
        const segment = segments[next];
        contour.push(pointKey(segment.start) === pointKey(current) ? segment.end : segment.start);
      }
  
      if (contour.length >= 4) {
        if (pointKey(contour[0]) === pointKey(contour[contour.length - 1])) contour.pop();
        contours.push(contour);
      }
    }
  
    return contours;
  }
  
  function removeConsecutiveDuplicatePoints(points) {
    const unique = [];
  
    for (const point of points) {
      const previous = unique[unique.length - 1];
      if (previous && previous.x === point.x && previous.y === point.y) continue;
      unique.push(point);
    }
  
    if (unique.length > 1) {
      const first = unique[0];
      const last = unique[unique.length - 1];
      if (first.x === last.x && first.y === last.y) unique.pop();
    }
  
    return unique;
  }
  
  function arePointsCollinear(a, b, c) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    return Math.abs(abx * bcy - aby * bcx) < 0.0001;
  }
  
  function removeCollinearContourPoints(contour) {
    if (contour.length <= 3) return contour.slice();
  
    const simplified = [];
    for (let i = 0; i < contour.length; i++) {
      const previous = contour[(i - 1 + contour.length) % contour.length];
      const current = contour[i];
      const next = contour[(i + 1) % contour.length];
      if (arePointsCollinear(previous, current, next)) continue;
      simplified.push(current);
    }
  
    return simplified.length >= 3 ? simplified : contour.slice();
  }
  
  function squaredDistanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
  
    if (lengthSquared === 0) {
      const pointDx = point.x - start.x;
      const pointDy = point.y - start.y;
      return pointDx * pointDx + pointDy * pointDy;
    }
  
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    const projectionX = start.x + t * dx;
    const projectionY = start.y + t * dy;
    const pointDx = point.x - projectionX;
    const pointDy = point.y - projectionY;
    return pointDx * pointDx + pointDy * pointDy;
  }
  
  function simplifyContourRun(points, epsilon) {
    if (points.length <= 2) return points.slice();
  
    let farthestIndex = -1;
    let farthestDistance = 0;
    const start = points[0];
    const end = points[points.length - 1];
  
    for (let i = 1; i < points.length - 1; i++) {
      const distance = squaredDistanceToSegment(points[i], start, end);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = i;
      }
    }
  
    if (farthestDistance <= epsilon * epsilon || farthestIndex === -1) return [start, end];
  
    const left = simplifyContourRun(points.slice(0, farthestIndex + 1), epsilon);
    const right = simplifyContourRun(points.slice(farthestIndex), epsilon);
    return left.slice(0, -1).concat(right);
  }
  
  function turnMagnitude(a, b, c) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const abLength = Math.hypot(abx, aby);
    const bcLength = Math.hypot(bcx, bcy);
    if (abLength === 0 || bcLength === 0) return 0;
    return Math.abs((abx * bcy - aby * bcx) / (abLength * bcLength));
  }
  
  function isProtectedContourPoint(contour, pointIndex) {
    const previous = contour[(pointIndex - 1 + contour.length) % contour.length];
    const current = contour[pointIndex];
    const next = contour[(pointIndex + 1) % contour.length];
    const previousLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const nextLength = Math.hypot(next.x - current.x, next.y - current.y);
  
    return (
      Math.max(previousLength, nextLength) >= 1.5 &&
      Math.min(previousLength, nextLength) >= 0.95 &&
      turnMagnitude(previous, current, next) > 0.55
    );
  }
  
  function protectedContourIndexes(contour) {
    const protectedIndexes = [];
  
    for (let i = 0; i < contour.length; i++) {
      if (isProtectedContourPoint(contour, i)) protectedIndexes.push(i);
    }
  
    if (protectedIndexes.length < 2) {
      let splitIndex = 0;
      for (let i = 1; i < contour.length; i++) {
        if (contour[i].x < contour[splitIndex].x || (contour[i].x === contour[splitIndex].x && contour[i].y < contour[splitIndex].y)) {
          splitIndex = i;
        }
      }
  
      let farthestIndex = splitIndex === 0 ? 1 : 0;
      let farthestDistance = -1;
      for (let i = 0; i < contour.length; i++) {
        if (i === splitIndex) continue;
        const dx = contour[i].x - contour[splitIndex].x;
        const dy = contour[i].y - contour[splitIndex].y;
        const distance = dx * dx + dy * dy;
        if (distance > farthestDistance) {
          farthestDistance = distance;
          farthestIndex = i;
        }
      }
  
      return [splitIndex, farthestIndex].sort((a, b) => a - b);
    }
  
    return protectedIndexes;
  }
  
  function contourRunBetween(contour, startIndex, endIndex) {
    const run = [contour[startIndex]];
    let i = startIndex;
  
    while (i !== endIndex) {
      i = (i + 1) % contour.length;
      run.push(contour[i]);
    }
  
    return run;
  }
  
  function orientation(a, b, c) {
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) < 0.0001) return 0;
    return cross > 0 ? 1 : -1;
  }
  
  function isPointOnSegment(point, start, end) {
    return (
      Math.min(start.x, end.x) - 0.0001 <= point.x &&
      point.x <= Math.max(start.x, end.x) + 0.0001 &&
      Math.min(start.y, end.y) - 0.0001 <= point.y &&
      point.y <= Math.max(start.y, end.y) + 0.0001 &&
      orientation(start, end, point) === 0
    );
  }
  
  function doSegmentsIntersect(aStart, aEnd, bStart, bEnd) {
    const a1 = orientation(aStart, aEnd, bStart);
    const a2 = orientation(aStart, aEnd, bEnd);
    const b1 = orientation(bStart, bEnd, aStart);
    const b2 = orientation(bStart, bEnd, aEnd);
  
    if (a1 !== a2 && b1 !== b2) return true;
    if (a1 === 0 && isPointOnSegment(bStart, aStart, aEnd)) return true;
    if (a2 === 0 && isPointOnSegment(bEnd, aStart, aEnd)) return true;
    if (b1 === 0 && isPointOnSegment(aStart, bStart, bEnd)) return true;
    if (b2 === 0 && isPointOnSegment(aEnd, bStart, bEnd)) return true;
    return false;
  }
  
  function hasContourSelfIntersection(contour) {
    for (let i = 0; i < contour.length; i++) {
      const aStart = contour[i];
      const aEnd = contour[(i + 1) % contour.length];
  
      for (let j = i + 1; j < contour.length; j++) {
        if (j === i || j === (i + 1) % contour.length || i === (j + 1) % contour.length) continue;
        const bStart = contour[j];
        const bEnd = contour[(j + 1) % contour.length];
        if (doSegmentsIntersect(aStart, aEnd, bStart, bEnd)) return true;
      }
    }
  
    return false;
  }
  
  function adaptContourAngles(contour) {
    if (contour.length < CONTOUR_ADAPTIVE_MIN_POINTS) return contour.slice();
  
    const anchors = protectedContourIndexes(contour);
    const adapted = [];
  
    for (let i = 0; i < anchors.length; i++) {
      const startIndex = anchors[i];
      const endIndex = anchors[(i + 1) % anchors.length];
      const run = contourRunBetween(contour, startIndex, endIndex);
      const simplified = simplifyContourRun(run, CONTOUR_ADAPTIVE_EPSILON);
      adapted.push(...(i === 0 ? simplified : simplified.slice(1)));
    }
  
    const cleaned = removeCollinearContourPoints(removeConsecutiveDuplicatePoints(adapted));
    return cleaned.length >= 3 && !hasContourSelfIntersection(cleaned) ? cleaned : contour.slice();
  }
  
  function roundContourCorners(contour) {
    if (contour.length < 3 || CONTOUR_CORNER_CONNECTOR_LENGTH <= 0) return contour.slice();
  
    const rounded = [];
  
    for (let i = 0; i < contour.length; i++) {
      const previous = contour[(i - 1 + contour.length) % contour.length];
      const current = contour[i];
      const next = contour[(i + 1) % contour.length];
      const incomingX = previous.x - current.x;
      const incomingY = previous.y - current.y;
      const outgoingX = next.x - current.x;
      const outgoingY = next.y - current.y;
      const incomingLength = Math.hypot(incomingX, incomingY);
      const outgoingLength = Math.hypot(outgoingX, outgoingY);
  
      if (incomingLength < 0.0001 || outgoingLength < 0.0001 || arePointsCollinear(previous, current, next)) {
        rounded.push(current);
        continue;
      }
  
      const incomingUnit = {
        x: incomingX / incomingLength,
        y: incomingY / incomingLength,
      };
      const outgoingUnit = {
        x: outgoingX / outgoingLength,
        y: outgoingY / outgoingLength,
      };
      const turnAngle = Math.acos(Math.max(-1, Math.min(1, -(incomingUnit.x * outgoingUnit.x + incomingUnit.y * outgoingUnit.y))));
      if (turnAngle > CONTOUR_CORNER_CONNECTOR_MAX_ANGLE) {
        rounded.push(current);
        continue;
      }
  
      const connectorScale = Math.hypot(outgoingUnit.x - incomingUnit.x, outgoingUnit.y - incomingUnit.y);
  
      if (connectorScale < 0.0001) {
        rounded.push(current);
        continue;
      }
  
      const maxInset = Math.min(incomingLength, outgoingLength) * 0.75;
      const inset = Math.min(maxInset, CONTOUR_CORNER_CONNECTOR_LENGTH / connectorScale);
      if (inset < 0.0001) {
        rounded.push(current);
        continue;
      }
  
      rounded.push({
        x: current.x + incomingUnit.x * inset,
        y: current.y + incomingUnit.y * inset,
      });
      rounded.push({
        x: current.x + outgoingUnit.x * inset,
        y: current.y + outgoingUnit.y * inset,
      });
    }
  
    const cleaned = removeConsecutiveDuplicatePoints(rounded);
    return cleaned.length >= 3 && !hasContourSelfIntersection(cleaned) ? cleaned : contour.slice();
  }
  
  function rebuildPackedContours() {
    const segments = collectPackedContourSegments();
    const contours = stitchContourSegments(segments);
    packedContours = contours.map((contour) => {
      const cleaned = removeCollinearContourPoints(removeConsecutiveDuplicatePoints(contour));
      return roundContourCorners(adaptContourAngles(cleaned));
    });
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
    clear,
  };
}
