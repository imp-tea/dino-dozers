import { rollersaurusSvg } from "../vehicles/rollersaurus/assets.js";
import {
  ROLLERSAURUS_ART_SCALE,
} from "../vehicles/rollersaurus/config.js";
import { wreckersaurusSvg } from "../vehicles/wreckersaurus/assets.js";
import {
  WRECKERSAURUS_ART_SCALE,
  WRECKERSAURUS_HEAD_JAW_ART_SCALE,
  WRECKERSAURUS_SCALE,
  WRECKERSAURUS_TAIL_BALL_CENTER,
  WRECKERSAURUS_TAIL_BALL_RADIUS,
  WRECKERSAURUS_TAIL_CENTER,
  WRECKERSAURUS_TAIL_LENGTH,
  WRECKERSAURUS_TAIL_WIDTH,
} from "../vehicles/wreckersaurus/config.js";
import rollersaurusChassisSvg from "../vehicles/rollersaurus/chassis.svg?raw";
import rollersaurusRollerSvg from "../vehicles/rollersaurus/roller.svg?raw";
import rollersaurusWheelSvg from "../vehicles/rollersaurus/wheel.svg?raw";
import wreckersaurusBoomSvg from "../vehicles/wreckersaurus/assets/boom.svg?raw";
import wreckersaurusChassisSvg from "../vehicles/wreckersaurus/assets/chassis.svg?raw";
import wreckersaurusHeadTopSvg from "../vehicles/wreckersaurus/assets/head_top.svg?raw";
import wreckersaurusJawBottomSvg from "../vehicles/wreckersaurus/assets/jaw_bottom.svg?raw";
import wreckersaurusStickSvg from "../vehicles/wreckersaurus/assets/stick.svg?raw";
import wreckersaurusTailSvg from "../vehicles/wreckersaurus/assets/tail.svg?raw";
import wreckersaurusWheelSvg from "../vehicles/wreckersaurus/assets/wheel.svg?raw";

const ROLLERSAURUS_BASE_ART_SCALE = 0.012;
const ROLLERSAURUS_BODY_SCALE = ROLLERSAURUS_ART_SCALE / ROLLERSAURUS_BASE_ART_SCALE;

export const colliderModels = [
  createRollersaurusModel(),
  createWreckersaurusModel(),
];

function createRollersaurusModel() {
  const wheelLocal = rollersaurusSvgLocal(rollersaurusSvg.chassis.wheelConnection);
  const rollerLocal = rollersaurusSvgLocal(rollersaurusSvg.chassis.rollerConnection);

  return {
    id: "rollersaurus",
    label: "Rollersaurus",
    parts: [
      {
        id: "chassis",
        label: "Chassis",
        art: createArt(rollersaurusChassisSvg, rollersaurusSvg.chassis, ROLLERSAURUS_ART_SCALE, { x: 0, y: 0 }),
        fixtures: [
          {
            id: "chassis-lower",
            label: "Lower hull",
            shape: "polygon",
            exportMode: "rollersaurusBody",
            vertices: scaleVertices([
              [-6.6023, -1.5538],
              [-5.6048, -2.9086],
              [0.7972, -2.9533],
              [5.4424, -1.2262],
              [5.5019, 0.0988],
              [-6.2897, 0.1583],
            ], ROLLERSAURUS_BODY_SCALE),
          },
          {
            id: "chassis-upper",
            label: "Upper cab",
            shape: "polygon",
            exportMode: "rollersaurusBody",
            vertices: scaleVertices([
              [-3.3864, -6.0203],
              [-1.7487, -6.333],
              [5.9784, -4.5613],
              [6.0082, -2.9533],
              [-5.039, -2.8938],
            ], ROLLERSAURUS_BODY_SCALE),
          },
          {
            id: "rear-wheel",
            label: "Rear wheel",
            shape: "circle",
            exportMode: "circle",
            center: wheelLocal,
            radius: rollersaurusSvg.wheel.viewBox.width * ROLLERSAURUS_ART_SCALE * 0.5,
            art: createArt(rollersaurusWheelSvg, rollersaurusSvg.wheel, ROLLERSAURUS_ART_SCALE, wheelLocal),
          },
          {
            id: "front-roller",
            label: "Front roller",
            shape: "circle",
            exportMode: "circle",
            center: rollerLocal,
            radius: rollersaurusSvg.roller.viewBox.width * ROLLERSAURUS_ART_SCALE * 0.5,
            art: createArt(rollersaurusRollerSvg, rollersaurusSvg.roller, ROLLERSAURUS_ART_SCALE, rollerLocal),
          },
        ],
      },
    ],
  };
}

function createWreckersaurusModel() {
  const wheelRadius = wreckersaurusSvg.wheel.viewBox.width * WRECKERSAURUS_ART_SCALE * 0.5;
  const wheelSpacing = wheelRadius * 2;
  const boomLength = svgDistance(wreckersaurusSvg.boom.pivot, wreckersaurusSvg.boom.end) * WRECKERSAURUS_ART_SCALE;
  const stickLength = svgDistance(wreckersaurusSvg.stick.pivot, wreckersaurusSvg.stick.end) * WRECKERSAURUS_ART_SCALE;

  return {
    id: "wreckersaurus",
    label: "Wreckersaurus",
    parts: [
      {
        id: "chassis",
        label: "Chassis",
        art: createArt(wreckersaurusChassisSvg, wreckersaurusSvg.chassis, WRECKERSAURUS_ART_SCALE, sourceLocal(0.52, 2.78)),
        fixtures: [
          {
            id: "chassis-lower",
            label: "Lower hull",
            shape: "polygon",
            exportMode: "wreckSource",
            vertices: sourceVertices([
              [-2.2446, 0.0414],
              [-1.6554, -0.4412],
              [0.0434, -0.4224],
              [1.6043, -0.3786],
              [1.855, 0.1542],
              [0.0372, 0.0916],
            ]),
          },
          {
            id: "chassis-upper",
            label: "Upper body",
            shape: "polygon",
            exportMode: "wreckSource",
            vertices: sourceVertices([
              [-2.2347, 0.06],
              [1.8548, 0.1504],
              [1.9775, 1.2616],
              [0.5175, 2.8509],
              [-0.3612, 2.7928],
              [-1.5569, 1.3626],
            ]),
          },
          ...Array.from({ length: 5 }, (_, index) => {
            const center = { x: (index - 2) * wheelSpacing, y: 1.66 };
            return {
              id: `road-wheel-${index + 1}`,
              label: `Road wheel ${index + 1}`,
              shape: "circle",
              exportMode: "circle",
              center,
              radius: wheelRadius,
              art: createArt(wreckersaurusWheelSvg, wreckersaurusSvg.wheel, WRECKERSAURUS_ART_SCALE, center),
            };
          }),
        ],
      },
      {
        id: "boom",
        label: "Boom",
        art: createArt(wreckersaurusBoomSvg, {
          ...wreckersaurusSvg.boom,
          pivot: midpoint(wreckersaurusSvg.boom.pivot, wreckersaurusSvg.boom.end),
        }, WRECKERSAURUS_ART_SCALE, { x: 0, y: 0 }),
        fixtures: [
          createBoxFixture("boom-box", "Boom box", 0, 0, boomLength, 0.42 * WRECKERSAURUS_SCALE),
        ],
      },
      {
        id: "stick",
        label: "Stick",
        art: createArt(wreckersaurusStickSvg, {
          ...wreckersaurusSvg.stick,
          pivot: midpoint(wreckersaurusSvg.stick.pivot, wreckersaurusSvg.stick.end),
        }, WRECKERSAURUS_ART_SCALE, { x: 0, y: 0 }),
        fixtures: [
          createBoxFixture("stick-box", "Stick box", 0, 0, stickLength, 0.4 * WRECKERSAURUS_SCALE),
        ],
      },
      {
        id: "headTop",
        label: "Head top",
        art: createArt(wreckersaurusHeadTopSvg, wreckersaurusSvg.headTop, WRECKERSAURUS_HEAD_JAW_ART_SCALE, { x: 0, y: 0 }),
        fixtures: [
          {
            id: "head-main",
            label: "Head body",
            shape: "polygon",
            exportMode: "wreckDirt",
            vertices: dirtVertices([
              [-0.4141, -0.2131],
              [0.3313, 2.8319],
              [3.8762, 3.0955],
              [7.3666, 3.2682],
              [8.6391, -0.2494],
              [1.5947, -0.25],
            ]),
          },
          {
            id: "upper-tooth",
            label: "Upper tooth",
            shape: "polygon",
            exportMode: "wreckDirt",
            vertices: dirtVertices([
              [1.9856, -0.4858],
              [8.1119, -0.4676],
              [8.1483, -0.0222],
              [1.9856, 0.0323],
            ]),
          },
        ],
      },
      {
        id: "jawBottom",
        label: "Jaw bottom",
        art: createArt(wreckersaurusJawBottomSvg, wreckersaurusSvg.jawBottom, WRECKERSAURUS_HEAD_JAW_ART_SCALE, { x: 0, y: 0 }),
        fixtures: [
          {
            id: "jaw-main",
            label: "Jaw body",
            shape: "polygon",
            exportMode: "wreckDirt",
            vertices: dirtVertices([
              [0.212, -0.9951],
              [2.191, -0.8663],
              [8.5421, -1.1056],
              [8.1279, -2.7348],
              [0.2396, -2.9741],
              [-0.6164, -1.4646],
            ]),
          },
          {
            id: "lower-tooth",
            label: "Lower tooth",
            shape: "polygon",
            exportMode: "wreckDirt",
            vertices: dirtVertices([
              [2.688, -1.2621],
              [2.688, -0.8479],
              [8.0359, -0.7742],
              [8.0635, -1.1884],
            ]),
          },
        ],
      },
      {
        id: "tail",
        label: "Tail",
        art: createArt(wreckersaurusTailSvg, wreckersaurusSvg.tail, WRECKERSAURUS_ART_SCALE, { x: 0, y: 0 }),
        fixtures: [
          createBoxFixture("tail-beam", "Tail beam", -WRECKERSAURUS_TAIL_CENTER, 0, WRECKERSAURUS_TAIL_LENGTH, WRECKERSAURUS_TAIL_WIDTH),
          {
            id: "tail-ball",
            label: "Tail ball",
            shape: "circle",
            exportMode: "circle",
            center: { x: -WRECKERSAURUS_TAIL_BALL_CENTER, y: 0 },
            radius: WRECKERSAURUS_TAIL_BALL_RADIUS,
          },
        ],
      },
    ],
  };
}

function createArt(svg, meta, scale, anchorLocal) {
  return {
    svg: hideSvgMarkers(svg),
    viewBox: meta.viewBox,
    pivot: vec(meta.pivot),
    scale,
    anchorLocal,
  };
}

function createBoxFixture(id, label, x, y, width, height) {
  return {
    id,
    label,
    shape: "box",
    exportMode: "box",
    center: { x, y },
    width,
    height,
  };
}

function rollersaurusSvgLocal(point) {
  const pivot = rollersaurusSvg.chassis.pivot;
  return {
    x: (point.x - pivot.x) * ROLLERSAURUS_ART_SCALE,
    y: (point.y - pivot.y) * ROLLERSAURUS_ART_SCALE,
  };
}

function sourceLocal(x, y) {
  return {
    x: x * WRECKERSAURUS_SCALE,
    y: -y * WRECKERSAURUS_SCALE,
  };
}

function sourceVertices(vertices) {
  return vertices.map(([x, y]) => sourceLocal(x, y));
}

function dirtVertices(vertices) {
  return vertices.map(([x, y]) => ({ x, y: -y }));
}

function scaleVertices(vertices, scale) {
  return vertices.map(([x, y]) => ({ x: x * scale, y: y * scale }));
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
  };
}

function vec(point) {
  return { x: point.x, y: point.y };
}

function svgDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function hideSvgMarkers(svg) {
  return svg.replace(/<circle\b[^>]*inkscape:label="[^"]*(?:pivot-point|connection-point)"[^>]*\/?>/g, (tag) => {
    if (tag.includes("style=")) return tag.replace(/style="[^"]*"/, "style=\"display:none\"");
    return tag.replace(/\/?>$/, " style=\"display:none\" />");
  });
}
