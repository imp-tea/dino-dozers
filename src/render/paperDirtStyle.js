const PAPER_TILE_SIZE = 96;
const PAPER_TEXTURE_ALPHA = 0.24;
const PACKED_OUTLINE = "rgba(55, 32, 20, 0.62)";
const PACKED_SHADOW = "rgba(48, 29, 19, 0.22)";
const PACKED_HIGHLIGHT = "rgba(255, 220, 154, 0.18)";
const LOOSE_OUTLINE = "rgba(74, 44, 20, 0.5)";
const DAMAGE_DARK = "rgba(54, 28, 16, 0.82)";
const DAMAGE_LIGHT = "rgba(245, 188, 106, 0.56)";

export const PACKED_COLOR_CHANNELS = Array.from({ length: 16 }, (_, shade) => ({
  r: 125 + shade,
  g: 86 + Math.floor(shade * 0.42),
  b: 55 + Math.floor(shade * 0.18),
}));

export const PACKED_COLORS = PACKED_COLOR_CHANNELS.map(({ r, g, b }) => `rgb(${r}, ${g}, ${b})`);

export const LOOSE_COLORS = Array.from({ length: 19 }, (_, shade) => {
  return `rgb(${181 + shade}, ${127 + Math.floor(shade * 0.5)}, ${64 + Math.floor(shade * 0.28)})`;
});

export function createPaperDirtStyle(ctx) {
  let pattern = null;

  function paperPattern() {
    if (pattern) return pattern;

    const canvas = document.createElement("canvas");
    canvas.width = PAPER_TILE_SIZE;
    canvas.height = PAPER_TILE_SIZE;
    const texture = canvas.getContext("2d");
    texture.fillStyle = "#9a6740";
    texture.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const grain = noise(x, y) * 34 + noise(x * 0.25, y * 1.8 + 17) * 16;
        const warm = Math.floor(120 + grain);
        texture.fillStyle = `rgba(${warm + 35}, ${Math.floor(warm * 0.78)}, ${Math.floor(warm * 0.45)}, 0.28)`;
        texture.fillRect(x, y, 1, 1);
      }
    }

    texture.globalAlpha = 0.32;
    for (let i = 0; i < 165; i++) {
      const x = seeded(i, 4) * canvas.width;
      const y = seeded(i, 9) * canvas.height;
      const length = 4 + seeded(i, 15) * 18;
      texture.strokeStyle = seeded(i, 21) > 0.52 ? "#c99458" : "#6d4429";
      texture.lineWidth = seeded(i, 26) > 0.78 ? 1.4 : 0.7;
      texture.beginPath();
      texture.moveTo(x, y);
      texture.lineTo(x + length, y + seeded(i, 32) * 3 - 1.5);
      texture.stroke();
    }
    texture.globalAlpha = 1;

    pattern = ctx.createPattern(canvas, "repeat");
    return pattern;
  }

  function fillPaperTexture(width, height, alpha = PAPER_TEXTURE_ALPHA) {
    const texture = paperPattern();
    if (!texture) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = texture;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  return {
    fillPaperTexture,
  };
}

export function colorLoose(x, y, tick) {
  const shade = (x * 13 + y * 7 + tick) % LOOSE_COLORS.length;
  return LOOSE_COLORS[shade];
}

export function colorPacked(x, y) {
  const shade = (x * 11 + y * 5) % PACKED_COLORS.length;
  return PACKED_COLORS[shade];
}

export function colorDamage(x, y, damage) {
  const shade = (x * 11 + y * 5) % PACKED_COLOR_CHANNELS.length;
  const color = PACKED_COLOR_CHANNELS[shade];
  const fracture = Math.min(1, Math.max(0, damage));
  const r = Math.floor(color.r + fracture * 44);
  const g = Math.floor(color.g - fracture * 14);
  const b = Math.floor(color.b - fracture * 28);
  return `rgb(${r}, ${g}, ${b})`;
}

export function colorStress(x, y, stress, threshold) {
  const shade = (x * 11 + y * 5) % PACKED_COLOR_CHANNELS.length;
  const color = PACKED_COLOR_CHANNELS[shade];
  const pressure = Math.min(1, Math.max(0, stress / Math.max(threshold, 1)));
  const glow = Math.floor(pressure * 86);
  const r = Math.min(210, color.r + glow);
  const g = Math.min(135, color.g + Math.floor(glow * 0.32));
  const b = Math.max(35, color.b - Math.floor(glow * 0.42));
  return `rgb(${r}, ${g}, ${b})`;
}

export function drawPackedCellPaper(ctx, x, y, cellW, cellH, fillStyle) {
  const px = Math.floor(x * cellW);
  const py = Math.floor(y * cellH);
  const width = Math.ceil(cellW);
  const height = Math.ceil(cellH);

  ctx.fillStyle = fillStyle;
  ctx.fillRect(px, py, width, height);

  ctx.fillStyle = PACKED_SHADOW;
  ctx.fillRect(px, py + Math.max(1, height - Math.ceil(cellH * 0.22)), width, Math.ceil(cellH * 0.22));
  ctx.fillStyle = PACKED_HIGHLIGHT;
  ctx.fillRect(px, py, width, Math.max(1, Math.ceil(cellH * 0.18)));

  if (cellW >= 4 && cellH >= 4) {
    const fleckCount = 1 + ((x * 5 + y * 3) % 3);
    ctx.fillStyle = "rgba(71, 43, 24, 0.24)";
    for (let n = 0; n < fleckCount; n++) {
      const fx = px + seeded(x * 97 + y * 31 + n, 2) * width;
      const fy = py + seeded(x * 47 + y * 83 + n, 6) * height;
      ctx.fillRect(Math.floor(fx), Math.floor(fy), 1, 1);
    }

    ctx.strokeStyle = "rgba(237, 177, 101, 0.16)";
    ctx.lineWidth = Math.max(0.75, Math.min(cellW, cellH) * 0.055);
    for (let n = 0; n < 2; n++) {
      const fy = py + seeded(x * 41 + y * 29 + n, 12) * height;
      const start = px + seeded(x * 17 + y * 53 + n, 24) * width * 0.35;
      const end = start + width * (0.28 + seeded(x * 71 + y * 11 + n, 31) * 0.45);
      ctx.beginPath();
      ctx.moveTo(start, fy);
      ctx.lineTo(Math.min(px + width, end), fy + seeded(x * 13 + y * 67 + n, 44) * 1.5 - 0.75);
      ctx.stroke();
    }
  }
}

export function drawLoosePaperChunk(ctx, x, y, cellW, cellH, fillStyle) {
  const insetX = Math.max(0.5, cellW * 0.08);
  const insetY = Math.max(0.5, cellH * 0.08);
  const px = x * cellW + insetX;
  const py = y * cellH + insetY;
  const width = Math.max(1, cellW - insetX * 2);
  const height = Math.max(1, cellH - insetY * 2);

  ctx.fillStyle = fillStyle;
  roundedRect(ctx, px, py, width, height, Math.min(width, height) * 0.25);
  ctx.fill();

  ctx.strokeStyle = LOOSE_OUTLINE;
  ctx.lineWidth = Math.max(1, Math.min(cellW, cellH) * 0.08);
  ctx.stroke();
}

export function drawStressMark(ctx, x, y, cellW, cellH, stress, threshold) {
  const pressure = Math.min(1, Math.max(0, stress / Math.max(threshold, 1)));
  if (pressure <= 0.06) return;

  const px = x * cellW;
  const py = y * cellH;
  const cx = px + cellW * 0.5;
  const cy = py + cellH * 0.5;
  const angle = ((x * 29 + y * 17) % 9 - 4) * 0.12;
  const length = Math.max(cellW, cellH) * (0.42 + pressure * 0.5);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.strokeStyle = `rgba(255, ${Math.floor(176 - pressure * 48)}, 54, ${0.16 + pressure * 0.48})`;
  ctx.lineWidth = Math.max(1, Math.min(cellW, cellH) * (0.08 + pressure * 0.1));
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-length * 0.5, 0);
  ctx.quadraticCurveTo(0, -cellH * 0.14, length * 0.5, 0);
  ctx.stroke();
  ctx.restore();
}

export function drawDamageTear(ctx, x, y, cellW, cellH, damage) {
  const fracture = Math.min(1, Math.max(0, damage));
  if (fracture <= 0.045) return;

  const px = x * cellW;
  const py = y * cellH;
  const startX = px + seeded(x * 61 + y * 19, 3) * cellW;
  const startY = py + seeded(x * 23 + y * 71, 7) * cellH;
  const angle = seeded(x * 11 + y * 89, 13) * Math.PI * 2;
  const segments = 2 + Math.floor(fracture * 3);
  const step = Math.min(cellW, cellH) * (0.22 + fracture * 0.15);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = DAMAGE_LIGHT;
  ctx.lineWidth = Math.max(1, Math.min(cellW, cellH) * 0.12);
  traceTear(ctx, startX, startY, angle, segments, step, x, y);
  ctx.stroke();

  ctx.strokeStyle = DAMAGE_DARK;
  ctx.lineWidth = Math.max(1, Math.min(cellW, cellH) * 0.075);
  traceTear(ctx, startX, startY, angle, segments, step, x + 17, y + 5);
  ctx.stroke();
  ctx.restore();
}

export function strokePackedPaperEdge(ctx, cellW, cellH) {
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = PACKED_OUTLINE;
  ctx.lineWidth = Math.max(1.5, Math.min(cellW, cellH) * 0.7);
  ctx.lineJoin = "bevel";
  ctx.lineCap = "butt";
}

function traceTear(ctx, startX, startY, angle, segments, step, sx, sy) {
  let x = startX;
  let y = startY;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let n = 0; n < segments; n++) {
    const bend = (seeded(sx * 31 + sy * 43 + n, 18) - 0.5) * 1.25;
    x += Math.cos(angle + bend) * step;
    y += Math.sin(angle + bend) * step;
    ctx.lineTo(x, y);
  }
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function noise(x, y) {
  return seeded(Math.floor(x * 23), Math.floor(y * 41)) - 0.5;
}

function seeded(a, b) {
  const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}
