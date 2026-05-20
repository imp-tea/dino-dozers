import {
  Circle,
  Polygon,
  Vec2,
  WheelJoint,
} from "planck";
import { canSwapVehicleFacing, createWheelTerrainUserData } from "../vehicleDefaults.js";
import { createRollersaurusImages, rollersaurusSvg } from "./assets.js";
import {
  ROLLERSAURUS_ART_SCALE,
  ROLLERSAURUS_CHASSIS_DENSITY,
  ROLLERSAURUS_COLLISION_GROUP,
  ROLLERSAURUS_DRIVE_SPEED,
  ROLLERSAURUS_FACING_LEFT,
  ROLLERSAURUS_FACING_RIGHT,
  ROLLERSAURUS_FLATTEN_CHASSIS_FORWARD_FACTOR,
  ROLLERSAURUS_FLATTEN_CONTACT_GRAVITY_SCALE,
  ROLLERSAURUS_FLATTEN_DRIVE_SPEED,
  ROLLERSAURUS_FLATTEN_MAX_LINEAR_SPEED,
  ROLLERSAURUS_FLATTEN_MIN_FORWARD_SPEED,
  ROLLERSAURUS_FLATTEN_SUSPENSION_DAMPING,
  ROLLERSAURUS_FLATTEN_SUSPENSION_FREQUENCY,
  ROLLERSAURUS_FLATTEN_TARGET_FORWARD_SPEED,
  ROLLERSAURUS_FLIP_ANGULAR_IMPULSE,
  ROLLERSAURUS_FLIP_SIDE_IMPULSE,
  ROLLERSAURUS_FLIP_UPWARD_IMPULSE,
  ROLLERSAURUS_GAMEPAD_DEADZONE,
  ROLLERSAURUS_FLATTEN_MOTOR_TORQUE,
  ROLLERSAURUS_MOTOR_TORQUE,
  ROLLERSAURUS_ROLLER_DENSITY,
  ROLLERSAURUS_ROLLER_FLATTEN_ANGULAR_SPEED,
  ROLLERSAURUS_ROLLER_FLATTEN_DEPTH,
  ROLLERSAURUS_ROLLER_FLATTEN_VELOCITY_WEIGHT,
  ROLLERSAURUS_ROLLER_FRICTION,
  ROLLERSAURUS_SUSPENSION_DAMPING,
  ROLLERSAURUS_SUSPENSION_FREQUENCY,
  ROLLERSAURUS_WHEEL_DENSITY,
  ROLLERSAURUS_WHEEL_FRICTION,
} from "./config.js";

const ROLLERSAURUS_BASE_ART_SCALE = 0.012;
const ROLLERSAURUS_BODY_SCALE = ROLLERSAURUS_ART_SCALE / ROLLERSAURUS_BASE_ART_SCALE;

export function createRollersaurusVehicle({ world, ctx, input }) {
  const physicsWorld = world;
  const { activeKeys, joypad } = input;
  const rollersaurusImages = createRollersaurusImages();
  let activeVehicle = null;
  let sharedWheelSpeed = 0;
  let desiredDrive = 0;
  let flattenModeActive = false;

  function create({ position, facing = ROLLERSAURUS_FACING_RIGHT, savedState = {} }) {
    activeVehicle = createRollersaurus(position, facing, savedState);
    return activeVehicle;
  }

  function destroy() {
    destroyRollersaurus(activeVehicle);
    activeVehicle = null;
  }

  function reset(position) {
    destroyRollersaurus(activeVehicle);
    activeVehicle = createRollersaurus(position, ROLLERSAURUS_FACING_RIGHT);
    sharedWheelSpeed = 0;
    desiredDrive = 0;
    flattenModeActive = false;
  }

  function step(dt) {
    updateActiveVehicleMotor(dt);
  }

  function afterPhysicsStep() {
    restoreFlattenForwardMomentum();
  }

  function draw(_ctx, viewport) {
    drawActiveVehicle(viewport.cellW, viewport.cellH);
  }

  function addPointerArmDelta() {
    return false;
  }

  function isOutOfBounds(height) {
    return !!activeVehicle?.chassis && activeVehicle.chassis.getPosition().y > height + 35;
  }

  function captureState() {
    if (!activeVehicle) return null;
    return {
      angle: activeVehicle.chassis.getAngle(),
    };
  }

  function createRollersaurus(position, facing = ROLLERSAURUS_FACING_RIGHT, savedState = {}) {
    const direction = facing === ROLLERSAURUS_FACING_LEFT ? ROLLERSAURUS_FACING_LEFT : ROLLERSAURUS_FACING_RIGHT;
    const chassis = physicsWorld.createDynamicBody({
      type: "dynamic",
      position,
      angle: savedState.angle ?? 0,
      angularDamping: 0.78,
      linearDamping: 0.1,
      bullet: true,
    });
    chassis.setUserData({ kind: "rollersaurus", part: "chassis" });

    chassis.createFixture({
      shape: Polygon(mirrorVertices([
        Vec2(-6.6023, -1.5538),
        Vec2(-5.6048, -2.9086),
        Vec2(0.7972, -2.9533),
        Vec2(5.4424, -1.2262),
        Vec2(5.5019, 0.0988),
        Vec2(-6.2897, 0.1583),
      ], direction).map(scaleBodyVertex)),
      density: ROLLERSAURUS_CHASSIS_DENSITY,
      friction: 0.78,
      restitution: 0,
      filterGroupIndex: ROLLERSAURUS_COLLISION_GROUP,
    });
    chassis.createFixture({
      shape: Polygon(mirrorVertices([
        Vec2(-3.3864, -6.0203),
        Vec2(-1.7487, -6.333),
        Vec2(5.9784, -4.5613),
        Vec2(6.0082, -2.9533),
        Vec2(-5.039, -2.8938),
      ], direction).map(scaleBodyVertex)),
      density: ROLLERSAURUS_CHASSIS_DENSITY * 0.55,
      friction: 0.72,
      restitution: 0,
      filterGroupIndex: ROLLERSAURUS_COLLISION_GROUP,
    });

    const wheelLocal = svgLocal(rollersaurusSvg.chassis.wheelConnection, direction);
    const rollerLocal = svgLocal(rollersaurusSvg.chassis.rollerConnection, direction);
    const wheels = [
      createWheelAssembly({
        chassis,
        local: wheelLocal,
        radius: rollersaurusSvg.wheel.viewBox.width * ROLLERSAURUS_ART_SCALE * 0.5,
        density: ROLLERSAURUS_WHEEL_DENSITY,
        friction: ROLLERSAURUS_WHEEL_FRICTION,
        imageKey: "wheel",
        part: "wheel",
        terrainContactLoadScale: 5.5,
      }),
      createWheelAssembly({
        chassis,
        local: rollerLocal,
        radius: rollersaurusSvg.roller.viewBox.width * ROLLERSAURUS_ART_SCALE * 0.5,
        density: ROLLERSAURUS_ROLLER_DENSITY,
        friction: ROLLERSAURUS_ROLLER_FRICTION,
        imageKey: "roller",
        part: "wheel",
        subtype: "roller",
        terrainContactLoadScale: 8.5,
        terrainFlattenAngularSpeed: ROLLERSAURUS_ROLLER_FLATTEN_ANGULAR_SPEED,
        terrainFlattenDepth: ROLLERSAURUS_ROLLER_FLATTEN_DEPTH,
        terrainFlattenVelocityWeight: ROLLERSAURUS_ROLLER_FLATTEN_VELOCITY_WEIGHT,
        terrainFlattenActive: false,
      }),
    ];

    return {
      facing: direction,
      chassis,
      wheels,
      wheelJoints: wheels.map((wheel) => wheel.joint),
      chassisArtPivotLocal: Vec2(0, 0),
    };
  }

  function createWheelAssembly({
    chassis,
    local,
    radius,
    density,
    friction,
    imageKey,
    part,
    subtype = null,
    terrainContactLoadScale,
    terrainFlattenAngularSpeed = 0,
    terrainFlattenDepth = 0,
    terrainFlattenVelocityWeight = 0,
    terrainFlattenActive = false,
  }) {
    const body = physicsWorld.createDynamicBody({
      position: chassis.getWorldPoint(local),
      angularDamping: 0.08,
      linearDamping: 0.04,
      bullet: true,
    });
    body.setUserData(createWheelTerrainUserData({
      kind: "rollersaurus",
      subtype,
      terrainContactLoadScale,
      terrainFlattenAngularSpeed,
      terrainFlattenDepth,
      terrainFlattenVelocityWeight,
      terrainFlattenActive,
      part,
    }));
    body.createFixture({
      shape: Circle(radius),
      density,
      friction,
      restitution: 0,
      filterGroupIndex: ROLLERSAURUS_COLLISION_GROUP,
    });
    const joint = physicsWorld.createJoint(WheelJoint({
      enableMotor: true,
      motorSpeed: 0,
      maxMotorTorque: ROLLERSAURUS_MOTOR_TORQUE,
      frequencyHz: ROLLERSAURUS_SUSPENSION_FREQUENCY,
      dampingRatio: ROLLERSAURUS_SUSPENSION_DAMPING,
    }, chassis, body, body.getPosition(), Vec2(0, 1)));

    return {
      body,
      local,
      radius,
      imageKey,
      subtype,
      joint,
    };
  }

  function svgLocal(point, facing) {
    const pivot = rollersaurusSvg.chassis.pivot;
    return Vec2(
      (point.x - pivot.x) * ROLLERSAURUS_ART_SCALE * facing,
      (point.y - pivot.y) * ROLLERSAURUS_ART_SCALE,
    );
  }

  function mirrorVertices(vertices, facing) {
    const converted = vertices.map((vertex) => Vec2(vertex.x * facing, vertex.y));
    return facing === ROLLERSAURUS_FACING_RIGHT ? converted : converted.reverse();
  }

  function scaleBodyVertex(vertex) {
    return Vec2(vertex.x * ROLLERSAURUS_BODY_SCALE, vertex.y * ROLLERSAURUS_BODY_SCALE);
  }

  function updateActiveVehicleMotor(dt) {
    if (!activeVehicle) return;

    pollJoypad();
    flattenModeActive = isFlattenModeActive();
    updateRollerFlattenMode(flattenModeActive);
    desiredDrive = getDriveInput();
    const maxDriveSpeed = flattenModeActive ? ROLLERSAURUS_FLATTEN_DRIVE_SPEED : ROLLERSAURUS_DRIVE_SPEED;
    const targetSpeed = desiredDrive * maxDriveSpeed;
    const driveSign = Math.sign(targetSpeed);

    if (driveSign === 0) {
      sharedWheelSpeed *= Math.pow(0.03, dt);
    } else {
      sharedWheelSpeed += (targetSpeed - sharedWheelSpeed) * Math.min(1, dt * 3.6);
      sharedWheelSpeed = clamp(sharedWheelSpeed, -maxDriveSpeed, maxDriveSpeed);
      const signedSpeeds = activeVehicle.wheels.map((wheel) => wheel.body.getAngularVelocity() * driveSign);
      const slowest = Math.min(...signedSpeeds);
      const lockedLimit = Math.max(0, slowest + 2.5);
      const signedTarget = Math.abs(sharedWheelSpeed);
      if (signedTarget > lockedLimit) sharedWheelSpeed = driveSign * lockedLimit;
    }

    const motorTorque = flattenModeActive ? ROLLERSAURUS_FLATTEN_MOTOR_TORQUE : ROLLERSAURUS_MOTOR_TORQUE;
    for (const joint of activeVehicle.wheelJoints) {
      joint.setMotorSpeed(sharedWheelSpeed);
      joint.setMaxMotorTorque(motorTorque);
    }

    if (flattenModeActive) {
      limitFlattenModeSpeed();
      applyRollerContactBias();
    }
  }

  function isFlattenModeActive() {
    return activeKeys.has("Space") || joypad.flattenActive;
  }

  function updateRollerFlattenMode(active) {
    for (const wheel of activeVehicle.wheels) {
      const isRoller = wheel.subtype === "roller";
      const userData = wheel.body.getUserData?.();
      if (isRoller && userData) userData.terrainFlattenActive = active;
      wheel.joint.setSpringFrequencyHz(
        active && isRoller
          ? ROLLERSAURUS_FLATTEN_SUSPENSION_FREQUENCY
          : ROLLERSAURUS_SUSPENSION_FREQUENCY,
      );
      wheel.joint.setSpringDampingRatio(
        active && isRoller
          ? ROLLERSAURUS_FLATTEN_SUSPENSION_DAMPING
          : ROLLERSAURUS_SUSPENSION_DAMPING,
      );
    }
  }

  function limitFlattenModeSpeed() {
    for (const body of [activeVehicle.chassis, ...activeVehicle.wheels.map((wheel) => wheel.body)]) {
      const velocity = body.getLinearVelocity();
      if (Math.abs(velocity.x) <= ROLLERSAURUS_FLATTEN_MAX_LINEAR_SPEED) continue;
      body.setLinearVelocity(Vec2(
        Math.sign(velocity.x) * ROLLERSAURUS_FLATTEN_MAX_LINEAR_SPEED,
        velocity.y,
      ));
    }
  }

  function applyRollerContactBias() {
    const roller = activeVehicle.wheels.find((wheel) => wheel.subtype === "roller");
    if (!roller) return;
    const mass = roller.body.getMass?.() ?? 0;
    if (mass <= 0) return;
    roller.body.applyForceToCenter(Vec2(0, mass * 32 * ROLLERSAURUS_FLATTEN_CONTACT_GRAVITY_SCALE), true);
  }

  function restoreFlattenForwardMomentum() {
    if (!activeVehicle || !flattenModeActive) return;
    const direction = Math.sign(desiredDrive);
    if (direction === 0) return;

    const roller = activeVehicle.wheels.find((wheel) => wheel.subtype === "roller");
    if (roller) enforceMinimumForwardSpeed(roller.body, direction, 1);
    enforceMinimumForwardSpeed(activeVehicle.chassis, direction, ROLLERSAURUS_FLATTEN_CHASSIS_FORWARD_FACTOR);
  }

  function enforceMinimumForwardSpeed(body, direction, strength) {
    const velocity = body.getLinearVelocity();
    const forwardSpeed = velocity.x * direction;
    const minForwardSpeed = ROLLERSAURUS_FLATTEN_MIN_FORWARD_SPEED * strength;
    if (forwardSpeed >= minForwardSpeed) return;

    const targetForwardSpeed = Math.min(
      ROLLERSAURUS_FLATTEN_TARGET_FORWARD_SPEED * strength,
      ROLLERSAURUS_FLATTEN_MAX_LINEAR_SPEED,
    );
    body.setLinearVelocity(Vec2(direction * targetForwardSpeed, velocity.y));
  }

  function getDriveInput() {
    if (joypad.active && Math.abs(joypad.drive) > 0) return joypad.drive;
    const keyboardRight = activeKeys.has("KeyD") || activeKeys.has("ArrowRight");
    const keyboardLeft = activeKeys.has("KeyA") || activeKeys.has("ArrowLeft");
    return Number(keyboardRight) - Number(keyboardLeft);
  }

  function pollJoypad() {
    if (!joypad.supported) return;

    const gamepads = navigator.getGamepads?.();
    const gamepad = joypad.index != null && gamepads?.[joypad.index]?.connected
      ? gamepads[joypad.index]
      : Array.from(gamepads ?? []).find((candidate) => candidate?.connected);

    if (!gamepad) {
      joypad.connected = false;
      joypad.index = null;
      joypad.drive = 0;
      joypad.armX = 0;
      joypad.armY = 0;
      joypad.headTurn = 0;
      joypad.flattenActive = false;
      joypad.active = false;
      joypad.lastAButton = false;
      joypad.lastYButton = false;
      return;
    }

    joypad.connected = true;
    joypad.index = gamepad.index;
    const leftX = applyStickDeadzone(gamepad.axes[0] ?? 0);
    const aPressed = isGamepadButtonPressed(gamepad.buttons[0]);
    const yPressed = isGamepadButtonPressed(gamepad.buttons[3]);

    if (yPressed && !joypad.lastYButton) flipRollersaurusFacing();

    joypad.lastAButton = aPressed;
    joypad.lastYButton = yPressed;
    joypad.drive = leftX;
    joypad.armX = 0;
    joypad.armY = 0;
    joypad.headTurn = 0;
    joypad.flattenActive = aPressed;
    joypad.active = Math.abs(leftX) > 0 || aPressed || yPressed;
  }

  function applyStickDeadzone(value) {
    const magnitude = Math.abs(value);
    if (magnitude < ROLLERSAURUS_GAMEPAD_DEADZONE) return 0;
    return Math.sign(value) * ((magnitude - ROLLERSAURUS_GAMEPAD_DEADZONE) / (1 - ROLLERSAURUS_GAMEPAD_DEADZONE));
  }

  function isGamepadButtonPressed(button) {
    return Boolean(button && (button.pressed || button.value > 0.5));
  }

  function flipActiveVehicleUpright() {
    if (!activeVehicle) return;

    const angle = normalizeAngle(activeVehicle.chassis.getAngle());
    const isOnBack = Math.cos(angle) < 0;
    if (!isOnBack) return;

    const sideImpulse = (Math.random() * 2 - 1) * ROLLERSAURUS_FLIP_SIDE_IMPULSE;
    const chassisCenter = activeVehicle.chassis.getWorldCenter();
    const rotationDirection = angle >= 0 ? -1 : 1;

    activeVehicle.chassis.applyLinearImpulse(Vec2(sideImpulse, -ROLLERSAURUS_FLIP_UPWARD_IMPULSE), chassisCenter, true);
    activeVehicle.chassis.applyAngularImpulse(rotationDirection * ROLLERSAURUS_FLIP_ANGULAR_IMPULSE, true);
    for (const wheel of activeVehicle.wheels) {
      wheel.body.applyLinearImpulse(Vec2(sideImpulse * 0.16, -ROLLERSAURUS_FLIP_UPWARD_IMPULSE * 0.18), wheel.body.getWorldCenter(), true);
    }
  }

  function flipRollersaurusFacing() {
    if (!activeVehicle || !canSwapVehicleFacing(activeVehicle)) return false;

    const previous = activeVehicle;
    const currentPosition = previous.chassis.getPosition();
    const nextState = {
      angle: previous.chassis.getAngle(),
    };

    destroyRollersaurus(previous);
    activeVehicle = createRollersaurus(Vec2(currentPosition.x, currentPosition.y), -previous.facing, nextState);
    sharedWheelSpeed = 0;
    desiredDrive = 0;
    flattenModeActive = false;
    return true;
  }

  function drawActiveVehicle(cellW, cellH) {
    if (!activeVehicle) return;

    ctx.save();
    drawRollersaurusWheels(cellW, cellH, (wheel) => wheel.subtype === "roller");
    drawRollersaurusChassis(cellW, cellH);
    drawRollersaurusWheels(cellW, cellH, (wheel) => wheel.subtype !== "roller");
    ctx.restore();
  }

  function drawRollersaurusChassis(cellW, cellH) {
    drawSvgAtAnchor(
      rollersaurusImages.chassis,
      activeVehicle.chassis.getWorldPoint(activeVehicle.chassisArtPivotLocal),
      activeVehicle.chassis.getAngle(),
      rollersaurusSvg.chassis.pivot,
      ROLLERSAURUS_ART_SCALE,
      activeVehicle.facing,
      cellW,
      cellH,
    );
  }

  function drawRollersaurusWheels(cellW, cellH, shouldDraw = () => true) {
    for (const wheel of activeVehicle.wheels) {
      if (!shouldDraw(wheel)) continue;
      const svg = rollersaurusSvg[wheel.imageKey];
      drawSvgAtAnchor(
        rollersaurusImages[wheel.imageKey],
        wheel.body.getPosition(),
        wheel.body.getAngle(),
        svg.pivot,
        ROLLERSAURUS_ART_SCALE,
        activeVehicle.facing,
        cellW,
        cellH,
      );
    }
  }

  function drawSvgAtAnchor(imageAsset, anchorWorld, angle, anchorSvg, scale, scaleXSign, cellW, cellH) {
    if (!imageAsset.loaded) return;

    const unit = Math.min(cellW, cellH);
    const anchor = worldToCanvasPoint(anchorWorld, cellW, cellH);
    ctx.save();
    ctx.translate(anchor.x, anchor.y);
    ctx.rotate(angle);
    ctx.scale(unit * scale * scaleXSign, unit * scale);
    ctx.drawImage(imageAsset.image, -anchorSvg.x, -anchorSvg.y);
    ctx.restore();
  }

  function worldToCanvasPoint(point, cellW, cellH) {
    return {
      x: point.x * cellW,
      y: point.y * cellH,
    };
  }

  function normalizeAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getActiveVehicleBodies() {
    if (!activeVehicle) return [];
    return [
      activeVehicle.chassis,
      ...activeVehicle.wheels.map((wheel) => wheel.body),
    ];
  }

  function destroyPhysicsBody(body) {
    if (body) physicsWorld.destroyBody(body);
  }

  function destroyRollersaurus(rollersaurus) {
    if (!rollersaurus) return;

    rollersaurus.wheelJoints.forEach((joint) => {
      if (joint) physicsWorld.destroyJoint(joint);
    });

    [
      ...rollersaurus.wheels.map((wheel) => wheel.body),
      rollersaurus.chassis,
    ].forEach(destroyPhysicsBody);
  }

  return {
    create,
    destroy,
    getBodies: getActiveVehicleBodies,
    step,
    afterPhysicsStep,
    draw,
    reset,
    captureState,
    flipFacing: flipRollersaurusFacing,
    flipUpright: flipActiveVehicleUpright,
    addPointerArmDelta,
    isOutOfBounds,
    getActiveVehicle: () => activeVehicle,
  };
}
