import { Vec2 } from "planck";

export function createInputState() {
  return {
    activeKeys: new Set(),
    pointerArmControl: {
      active: false,
      lastX: 0,
      lastY: 0,
      deltaLocal: Vec2(0, 0),
      lastInputAt: 0,
    },
    joypad: {
      supported: typeof navigator !== "undefined" && typeof navigator.getGamepads === "function",
      connected: false,
      index: null,
      drive: 0,
      armX: 0,
      armY: 0,
      headTurn: 0,
      jawOpen: false,
      tailRaise: false,
      flattenActive: false,
      lastAButton: false,
      lastYButton: false,
      active: false,
    },
  };
}
