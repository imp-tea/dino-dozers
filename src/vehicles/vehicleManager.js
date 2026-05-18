export function createVehicleManager() {
  let activeVehicle = null;

  function setActiveVehicle(vehicle) {
    activeVehicle = vehicle;
  }

  function getActiveVehicle() {
    return activeVehicle;
  }

  function clearActiveVehicle() {
    activeVehicle?.destroy?.();
    activeVehicle = null;
  }

  function getActiveVehicleBodies() {
    return activeVehicle?.getBodies?.() ?? [];
  }

  function step(dt) {
    activeVehicle?.step?.(dt);
  }

  function draw(ctx, viewport) {
    activeVehicle?.draw?.(ctx, viewport);
  }

  function reset(position) {
    activeVehicle?.reset?.(position);
  }

  return {
    setActiveVehicle,
    getActiveVehicle,
    clearActiveVehicle,
    getActiveVehicleBodies,
    step,
    draw,
    reset,
  };
}
