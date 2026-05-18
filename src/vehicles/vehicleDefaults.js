export const DEFAULT_FACING_SWAP_MAX_LINEAR_SPEED = 1.25;
export const DEFAULT_FACING_SWAP_MAX_ANGULAR_SPEED = 0.75;
export const DEFAULT_WHEEL_TERRAIN_CONTACT_LOAD_SCALE = 10;

export function createWheelTerrainUserData({
  kind,
  subtype = null,
  terrainContactLoadScale = DEFAULT_WHEEL_TERRAIN_CONTACT_LOAD_SCALE,
  ...extra
}) {
  return {
    kind,
    part: "wheel",
    subtype,
    terrainDamageScale: 0,
    terrainLoadScale: 0,
    terrainContactLoadScale,
    ...extra,
  };
}

export function canSwapVehicleFacing(vehicle, {
  maxLinearSpeed = DEFAULT_FACING_SWAP_MAX_LINEAR_SPEED,
  maxAngularSpeed = DEFAULT_FACING_SWAP_MAX_ANGULAR_SPEED,
} = {}) {
  const bodies = [
    vehicle?.chassis,
    ...(vehicle?.wheels?.map((wheel) => wheel.body) ?? []),
  ].filter(Boolean);
  if (!bodies.length) return false;

  const maxBodyLinearSpeed = bodies.reduce((maxSpeed, body) => {
    const velocity = body.getLinearVelocity();
    return Math.max(maxSpeed, Math.hypot(velocity.x, velocity.y));
  }, 0);
  const chassisAngularSpeed = Math.abs(vehicle.chassis?.getAngularVelocity?.() ?? 0);

  return maxBodyLinearSpeed <= maxLinearSpeed && chassisAngularSpeed <= maxAngularSpeed;
}
