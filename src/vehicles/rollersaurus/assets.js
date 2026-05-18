import { Vec2 } from "planck";
import chassisSvg from "./chassis.svg?raw";
import rollerSvg from "./roller.svg?raw";
import wheelSvg from "./wheel.svg?raw";

const rollersaurusSvgSources = {
  chassis: chassisSvg,
  roller: rollerSvg,
  wheel: wheelSvg,
};

export const rollersaurusSvg = {
  chassis: {
    viewBox: { width: 1224.0836, height: 627.91895 },
    wheelConnection: Vec2(321.12753, 554.85516),
    rollerConnection: Vec2(921.45276, 501.68323),
  },
  roller: {
    viewBox: { width: 407.37304, height: 407.37293 },
    pivot: Vec2(203.68652, 203.686465),
  },
  wheel: {
    viewBox: { width: 314.21459, height: 311.52515 },
    pivot: Vec2(157.107295, 155.762575),
  },
};

rollersaurusSvg.chassis.pivot = Vec2(
  (rollersaurusSvg.chassis.wheelConnection.x + rollersaurusSvg.chassis.rollerConnection.x) * 0.5,
  (rollersaurusSvg.chassis.wheelConnection.y + rollersaurusSvg.chassis.rollerConnection.y) * 0.5,
);

export function createRollersaurusImages() {
  return Object.fromEntries(Object.entries(rollersaurusSvgSources).map(([key, svg]) => {
    const image = new Image();
    const asset = {
      image,
      loaded: false,
    };
    image.onload = () => {
      asset.loaded = true;
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(hideSvgConnectionMarkers(svg))}`;
    return [key, asset];
  }));
}

function hideSvgConnectionMarkers(svg) {
  return svg.replace(/<circle\b[^>]*inkscape:label="[^"]*connection-point"[^>]*\/?>/g, (tag) => {
    if (tag.includes("style=")) return tag.replace(/style="[^"]*"/, "style=\"display:none\"");
    return tag.replace(/\/?>$/, " style=\"display:none\" />");
  });
}
