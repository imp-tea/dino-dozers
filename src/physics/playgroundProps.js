import { Box, Circle, Vec2 } from "planck";

export function createPlaygroundProps({ world, cellsPerWorldUnit = 1 }) {
  const bodies = [];

  function reset(state) {
    destroy();

    const worldWidth = state.width / cellsPerWorldUnit;
    const terrainTop = Math.floor(state.height * 2 / 3) / cellsPerWorldUnit;

    createBoxStack(worldWidth * 0.62, terrainTop - 0.75);
    createBallPile(worldWidth * 0.76, terrainTop - 7.5);
    createStaticRamp(worldWidth * 0.84, terrainTop - 1.2, 18, 0.8, -0.34, "#6fb6ff");
    createStaticRamp(worldWidth * 0.92, terrainTop - 6.4, 13, 0.8, 0.24, "#76d08b");
    createStaticLedge(worldWidth * 0.72, terrainTop - 13.2, 16, 0.65);
  }

  function createBoxStack(baseX, baseY) {
    const size = 1.35;
    const gap = 0.08;
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 4; column++) {
        const offset = row % 2 ? size * 0.5 : 0;
        const x = baseX + column * (size + gap) + offset;
        const y = baseY - row * (size + gap);
        const body = world.createDynamicBody({
          position: Vec2(x, y),
          angle: (column - 1.5) * 0.015,
          angularDamping: 0.06,
          linearDamping: 0.02,
        });
        body.createFixture({
          shape: Box(size * 0.5, size * 0.5),
          density: 0.7,
          friction: 0.74,
          restitution: 0.05,
        });
        body.setUserData({ kind: "playground-prop", shape: "box", color: "#d7a04b" });
        bodies.push(body);
      }
    }
  }

  function createBallPile(baseX, baseY) {
    const radii = [0.78, 0.92, 0.68, 0.84, 0.74, 1.05, 0.64];
    for (let i = 0; i < radii.length; i++) {
      const radius = radii[i];
      const x = baseX + (i % 3) * 2.1 - 2.1;
      const y = baseY - Math.floor(i / 3) * 1.9;
      const body = world.createDynamicBody({
        position: Vec2(x, y),
        angularDamping: 0.04,
        linearDamping: 0.01,
        bullet: true,
      });
      body.createFixture({
        shape: Circle(radius),
        density: 0.62,
        friction: 0.48,
        restitution: 0.42,
      });
      body.setUserData({ kind: "playground-prop", shape: "ball", color: i % 2 ? "#e06d6d" : "#e8c85a" });
      bodies.push(body);
    }
  }

  function createStaticRamp(x, y, length, thickness, angle, color) {
    const body = world.createBody({
      position: Vec2(x, y),
      angle,
    });
    body.createFixture({
      shape: Box(length * 0.5, thickness * 0.5),
      friction: 0.9,
      restitution: 0.02,
    });
    body.setUserData({ kind: "playground-prop", shape: "ramp", color });
    bodies.push(body);
  }

  function createStaticLedge(x, y, length, thickness) {
    const body = world.createBody({
      position: Vec2(x, y),
      angle: 0,
    });
    body.createFixture({
      shape: Box(length * 0.5, thickness * 0.5),
      friction: 0.88,
      restitution: 0.04,
    });
    body.setUserData({ kind: "playground-prop", shape: "ledge", color: "#c58dff" });
    bodies.push(body);
  }

  function draw(ctx, { cellW, cellH }) {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    for (const body of bodies) {
      const data = body.getUserData?.() ?? {};
      ctx.fillStyle = data.color ?? "#d7a04b";
      ctx.strokeStyle = "rgba(36, 28, 24, 0.72)";
      ctx.lineWidth = Math.max(1, Math.min(cellW, cellH) * 0.14);

      for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
        const shape = fixture.getShape();
        if (shape.m_vertices?.length) drawPolygon(ctx, body, shape, cellW, cellH);
        else if (shape.m_radius != null) drawCircle(ctx, body, shape, cellW, cellH);
      }
    }

    ctx.restore();
  }

  function getBodies() {
    return bodies;
  }

  function destroy() {
    while (bodies.length) {
      const body = bodies.pop();
      if (body) world.destroyBody(body);
    }
  }

  return {
    reset,
    draw,
    getBodies,
    destroy,
  };
}

function drawPolygon(ctx, body, shape, cellW, cellH) {
  const vertices = shape.m_vertices.map((vertex) => body.getWorldPoint(vertex));
  if (vertices.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(vertices[0].x * cellW, vertices[0].y * cellH);
  for (let i = 1; i < vertices.length; i++) {
    ctx.lineTo(vertices[i].x * cellW, vertices[i].y * cellH);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawCircle(ctx, body, shape, cellW, cellH) {
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

  const angle = body.getAngle();
  ctx.beginPath();
  ctx.moveTo(center.x * cellW, center.y * cellH);
  ctx.lineTo(
    (center.x + Math.cos(angle) * radius * 0.78) * cellW,
    (center.y + Math.sin(angle) * radius * 0.78) * cellH,
  );
  ctx.stroke();
}
