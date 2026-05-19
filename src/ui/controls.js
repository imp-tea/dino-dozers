function bindRange(id, parser) {
  const input = document.querySelector(`#${id}`);
  const value = document.querySelector(`#${id}Value`);
  const sync = () => {
    value.textContent = input.value;
  };
  input.addEventListener("input", sync);
  sync();
  return {
    input,
    get value() {
      return parser(input.value);
    },
    set value(next) {
      input.value = next;
      sync();
    },
  };
}

export function getControls() {
  return {
    brushSize: bindRange("brushSize", Number),
    cohesion: bindRange("cohesion", Number),
    fatigue: bindRange("fatigue", Number),
    weight: bindRange("weight", Number),
    bridgePenalty: bindRange("bridgePenalty", Number),
    settleTicks: bindRange("settleTicks", Number),
    spread: bindRange("spread", Number),
    jitter: bindRange("jitter", Number),
    speed: bindRange("speed", Number),
    gridWidth: bindRange("gridWidth", Number),
    gridHeight: bindRange("gridHeight", Number),
    stressView: document.querySelector("#stressView"),
    damageView: document.querySelector("#damageView"),
    contourView: document.querySelector("#contourView"),
    debugView: document.querySelector("#debugView"),
    resetVehicle: document.querySelector("#resetVehicle"),
    vehicleType: document.querySelector("#vehicleType"),
    unifiedColor: document.querySelector("#unifiedColor"),
  };
}

export function isEditableTarget(target) {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
}
