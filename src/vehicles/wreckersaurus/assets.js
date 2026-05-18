import { Vec2 } from "planck";
import boomSvg from "./assets/boom.svg?raw";
import chassisSvg from "./assets/chassis.svg?raw";
import headTopSvg from "./assets/head_top.svg?raw";
import jawBottomSvg from "./assets/jaw_bottom.svg?raw";
import stickSvg from "./assets/stick.svg?raw";
import tailSvg from "./assets/tail.svg?raw";

const wreckersaurusSvgSources = {
  boom: boomSvg,
  chassis: chassisSvg,
  headTop: headTopSvg,
  jawBottom: jawBottomSvg,
  stick: stickSvg,
  tail: tailSvg,
};

export const wreckersaurusSvg = {
  chassis: {
    viewBox: { width: 426.82097, height: 340.82208 },
    pivot: Vec2(236.6112, 57.62656),
  },
  boom: {
    viewBox: { width: 333.5395, height: 96.427896 },
    pivot: Vec2(45.4245129294211, 58.82864074727431),
    end: Vec2(297.2951131711393, 59.348611535867065),
  },
  stick: {
    viewBox: { width: 306.4821, height: 93.074541 },
    pivot: Vec2(39.42127534470046, 40.65460805369406),
    end: Vec2(282.2326913485542, 39.58668016199704),
  },
  headTop: {
    viewBox: { width: 364.81359, height: 189.71103 },
    pivot: Vec2(32.98793999999998, 137.32751000000002),
  },
  jawBottom: {
    viewBox: { width: 369.43248, height: 170.07074 },
    pivot: Vec2(32.16271999999998, 42.527180000000016),
  },
  tail: {
    viewBox: { width: 703.45694, height: 272.80054 },
    pivot: Vec2(688.4090006070649, 144.29343079847774),
  },
};

export function createWreckersaurusImages() {
  return Object.fromEntries(Object.entries(wreckersaurusSvgSources).map(([key, svg]) => {
    const image = new Image();
    const asset = {
      image,
      loaded: false,
    };
    image.onload = () => {
      asset.loaded = true;
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(hideSvgPivotMarkers(svg))}`;
    return [key, asset];
  }));
}

function hideSvgPivotMarkers(svg) {
  return svg.replace(/<circle\b[^>]*inkscape:label="[^"]*pivot-point"[^>]*\/?>/g, (tag) => {
    if (tag.includes("style=")) return tag.replace(/style="[^"]*"/, "style=\"display:none\"");
    return tag.replace(/\/?>$/, " style=\"display:none\" />");
  });
}
