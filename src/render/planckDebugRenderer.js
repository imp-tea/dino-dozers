export function drawPlanckDebugView(ctx, world, { cellW, cellH }) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, Math.min(cellW, cellH) * 0.12);

  for (let body = world.getBodyList(); body; body = body.getNext()) {
    const dynamic = body.isDynamic?.() ?? body.getType?.() === "dynamic";
    ctx.strokeStyle = dynamic ? "rgba(255, 95, 180, 0.95)" : "rgba(72, 220, 255, 0.9)";
    ctx.fillStyle = dynamic ? "rgba(255, 95, 180, 0.12)" : "rgba(72, 220, 255, 0.08)";

    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      drawFixture(ctx, body, fixture.getShape(), cellW, cellH);
    }
  }

  ctx.restore();
}

function drawFixture(ctx, body, shape, cellW, cellH) {
  if (shape.m_vertices?.length) {
    drawVertexShape(ctx, body, shape, cellW, cellH);
    return;
  }

  if (shape.m_radius != null) {
    drawCircleShape(ctx, body, shape, cellW, cellH);
    return;
  }

  if (shape.m_vertex1 && shape.m_vertex2) {
    drawSegment(ctx, body.getWorldPoint(shape.m_vertex1), body.getWorldPoint(shape.m_vertex2), cellW, cellH);
  }
}

function drawVertexShape(ctx, body, shape, cellW, cellH) {
  const vertices = shape.m_vertices.map((vertex) => body.getWorldPoint(vertex));
  if (vertices.length < 2) return;

  ctx.beginPath();
  moveToWorld(ctx, vertices[0], cellW, cellH);
  for (let i = 1; i < vertices.length; i++) lineToWorld(ctx, vertices[i], cellW, cellH);

  const closed = shape.m_type === "polygon" || shape.m_isLoop === true;
  if (closed) {
    ctx.closePath();
    ctx.fill();
  }
  ctx.stroke();

  for (const vertex of vertices) {
    drawPoint(ctx, vertex, cellW, cellH);
  }
}

function drawCircleShape(ctx, body, shape, cellW, cellH) {
  const center = shape.m_p ? body.getWorldPoint(shape.m_p) : body.getPosition();
  const radius = shape.m_radius;

  ctx.beginPath();
  ctx.ellipse(
    center.x * cellW,
    center.y * cellH,
    radius * cellW,
    radius * cellH,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.stroke();
  drawPoint(ctx, center, cellW, cellH);
}

function drawSegment(ctx, a, b, cellW, cellH) {
  ctx.beginPath();
  moveToWorld(ctx, a, cellW, cellH);
  lineToWorld(ctx, b, cellW, cellH);
  ctx.stroke();
  drawPoint(ctx, a, cellW, cellH);
  drawPoint(ctx, b, cellW, cellH);
}

function drawPoint(ctx, point, cellW, cellH) {
  const radius = Math.max(1.5, Math.min(cellW, cellH) * 0.18);
  ctx.beginPath();
  ctx.arc(point.x * cellW, point.y * cellH, radius, 0, Math.PI * 2);
  ctx.fill();
}

function moveToWorld(ctx, point, cellW, cellH) {
  ctx.moveTo(point.x * cellW, point.y * cellH);
}

function lineToWorld(ctx, point, cellW, cellH) {
  ctx.lineTo(point.x * cellW, point.y * cellH);
}
