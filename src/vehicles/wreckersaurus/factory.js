import {
  Box,
  Circle,
  DistanceJoint,
  Polygon,
  RevoluteJoint,
  Vec2,
  WheelJoint,
} from "planck";
import { createWreckersaurusImages, wreckersaurusSvg } from "./assets.js";
import {
  WRECKERSAURUS_ARM_SERVO,
  WRECKERSAURUS_ARM_SPEED,
  WRECKERSAURUS_ART_SCALE,
  WRECKERSAURUS_CHASSIS_DENSITY,
  WRECKERSAURUS_COLLISION_GROUP,
  WRECKERSAURUS_DIRECT_HEAD_TURN_SPEED,
  WRECKERSAURUS_DIRECT_TARGET_SPEED,
  WRECKERSAURUS_DRIVE_SPEED,
  WRECKERSAURUS_FACING_LEFT,
  WRECKERSAURUS_FACING_RIGHT,
  WRECKERSAURUS_FLIP_ANGULAR_IMPULSE,
  WRECKERSAURUS_FLIP_SIDE_IMPULSE,
  WRECKERSAURUS_FLIP_UPWARD_IMPULSE,
  WRECKERSAURUS_GAMEPAD_DEADZONE,
  WRECKERSAURUS_HEAD_JAW_ART_SCALE,
  WRECKERSAURUS_JAW_CLOSED_ANGLE,
  WRECKERSAURUS_JAW_OPEN_ANGLE,
  WRECKERSAURUS_MOTOR_TORQUE,
  WRECKERSAURUS_SCALE,
  WRECKERSAURUS_SUSPENSION_DAMPING,
  WRECKERSAURUS_SUSPENSION_FREQUENCY,
  WRECKERSAURUS_TREAD_LINK_FREQUENCY,
  WRECKERSAURUS_WHEEL_DENSITY,
  WRECKERSAURUS_WHEEL_FRICTION,
} from "./config.js";

export function createWreckersaurusVehicle({ world, ctx, input }) {
  const physicsWorld = world;
  const { activeKeys, pointerArmControl, joypad } = input;
  const wreckersaurusImages = createWreckersaurusImages();
  let activeVehicle = null;
  let sharedWheelSpeed = 0;
  let desiredDrive = 0;

  function create({ position, facing = WRECKERSAURUS_FACING_RIGHT, savedState = {} }) {
    activeVehicle = createWreckersaurus(position, facing, savedState);
    return activeVehicle;
  }

  function destroy() {
    destroyWreckersaurus(activeVehicle);
    activeVehicle = null;
  }

  function reset(position) {
    destroyWreckersaurus(activeVehicle);
    activeVehicle = createWreckersaurus(position, WRECKERSAURUS_FACING_RIGHT);
    sharedWheelSpeed = 0;
    desiredDrive = 0;
    pointerArmControl.deltaLocal = Vec2(0, 0);
  }

  function step(dt) {
    updateActiveVehicleMotor(dt);
  }

  function draw(_ctx, viewport) {
    drawActiveVehicle(viewport.cellW, viewport.cellH);
  }

  function addPointerArmDelta(dx, dy, cellW, cellH) {
    if (!activeVehicle) return false;
    const precision = getPrecisionScale();
    const worldDelta = Vec2(
      (dx / Math.max(1, cellW)) * precision,
      (dy / Math.max(1, cellH)) * precision,
    );
    const localDelta = rotateVec(worldDelta, -activeVehicle.chassis.getAngle());
    pointerArmControl.deltaLocal = Vec2(
      pointerArmControl.deltaLocal.x + localDelta.x,
      pointerArmControl.deltaLocal.y + localDelta.y,
    );
    pointerArmControl.lastInputAt = performance.now();
    return true;
  }

  function isOutOfBounds(height) {
    return !!activeVehicle?.chassis && activeVehicle.chassis.getPosition().y > height + 35;
  }

  function captureState() {
    if (!activeVehicle) return null;
    return {
      angle: activeVehicle.chassis.getAngle(),
      drivePhase: activeVehicle.drivePhase,
      arm: captureFlippedArmState(activeVehicle.arm),
      tail: {
        offset: activeVehicle.tail.offset,
        velocity: activeVehicle.tail.velocity,
      },
    };
  }

  function destroyPhysicsBody(body) {
    if (body) physicsWorld.destroyBody(body);
  }

  function createWreckersaurus(position, facing = WRECKERSAURUS_FACING_RIGHT, savedState = {}) {
    const direction = facing === WRECKERSAURUS_FACING_LEFT ? WRECKERSAURUS_FACING_LEFT : WRECKERSAURUS_FACING_RIGHT;
    const chassis = physicsWorld.createDynamicBody({
      type: "dynamic",
      position,
      angle: savedState.angle ?? 0,
      angularDamping: 0.85,
      linearDamping: 0.12,
      bullet: true,
    });
    chassis.setUserData({ kind: "wreckersaurus", part: "chassis" });
  
    chassis.createFixture({
      shape: Polygon(mirrorSourceVertices([
        Vec2(-2.72, -0.5),
        Vec2(-2.24, -0.82),
        Vec2(2.36, -0.82),
        Vec2(2.82, -0.5),
        Vec2(2.58, 0.58),
        Vec2(-2.52, 0.64),
      ], direction)),
      density: WRECKERSAURUS_CHASSIS_DENSITY,
      friction: 0.75,
      restitution: 0,
      filterGroupIndex: WRECKERSAURUS_COLLISION_GROUP,
    });
    chassis.createFixture({
      shape: Polygon(mirrorSourceVertices([
        Vec2(-2.1, 0.52),
        Vec2(2.25, 0.5),
        Vec2(2.38, 1.18),
        Vec2(1.2, 2.74),
        Vec2(-0.8, 3.16),
        Vec2(-2.06, 1.46),
      ], direction)),
      density: WRECKERSAURUS_CHASSIS_DENSITY * 0.16,
      friction: 0.7,
      restitution: 0,
      filterGroupIndex: WRECKERSAURUS_COLLISION_GROUP,
    });
  
    const wheels = [];
    const wheelJoints = [];
    const linkJoints = [];
    const radius = 0.38 * WRECKERSAURUS_SCALE;
  
    for (const local of makeTreadLoop(direction)) {
      const wheel = physicsWorld.createDynamicBody({
        position: chassis.getWorldPoint(local),
        angularDamping: 0.12,
        linearDamping: 0.05,
        bullet: true,
      });
      wheel.setUserData({ kind: "wreckersaurus", part: "wheel" });
      wheel.createFixture({
        shape: Circle(radius),
        density: WRECKERSAURUS_WHEEL_DENSITY,
        friction: WRECKERSAURUS_WHEEL_FRICTION,
        restitution: 0,
        filterGroupIndex: WRECKERSAURUS_COLLISION_GROUP,
      });
      wheels.push({ body: wheel, local, radius });
  
      wheelJoints.push(physicsWorld.createJoint(WheelJoint({
        enableMotor: true,
        motorSpeed: 0,
        maxMotorTorque: WRECKERSAURUS_MOTOR_TORQUE,
        frequencyHz: WRECKERSAURUS_SUSPENSION_FREQUENCY,
        dampingRatio: WRECKERSAURUS_SUSPENSION_DAMPING,
      }, chassis, wheel, wheel.getPosition(), Vec2(0, 1))));
    }
  
    for (let i = 0; i < wheels.length; i++) {
      const a = wheels[i].body;
      const b = wheels[(i + 1) % wheels.length].body;
      const length = vecDistance(a.getPosition(), b.getPosition());
      linkJoints.push(physicsWorld.createJoint(DistanceJoint({
        frequencyHz: WRECKERSAURUS_TREAD_LINK_FREQUENCY,
        dampingRatio: 0.85,
        collideConnected: false,
        length,
      }, a, b, a.getPosition(), b.getPosition())));
    }
  
    return {
      facing: direction,
      chassis,
      wheels,
      wheelJoints,
      linkJoints,
      arm: createWreckersaurusArm(chassis, direction, savedState.arm),
      tail: createWreckersaurusTail(chassis, direction, savedState.tail),
      chassisArtPivotLocal: sourceLocal(0.52, 2.78, direction),
      radius,
      drivePhase: savedState.drivePhase ?? 0,
    };
  }

  function normalizeAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  function createWreckersaurusArm(chassis, facing = WRECKERSAURUS_FACING_RIGHT, savedState = {}) {
    const boomLength = svgDistance(wreckersaurusSvg.boom.pivot, wreckersaurusSvg.boom.end) * WRECKERSAURUS_ART_SCALE;
    const stickLength = svgDistance(wreckersaurusSvg.stick.pivot, wreckersaurusSvg.stick.end) * WRECKERSAURUS_ART_SCALE;
    const headLength = (wreckersaurusSvg.headTop.viewBox.width - wreckersaurusSvg.headTop.pivot.x - 18) * WRECKERSAURUS_HEAD_JAW_ART_SCALE;
    const targetPose = savedState?.targetPose ?? orientArmPoseForFacing({
      boomAngle: -1.05,
      stickAngle: 1.22,
      headAngle: 0.5,
      jawAngle: WRECKERSAURUS_JAW_CLOSED_ANGLE,
    }, facing);
    const arm = {
      chassis,
      facing,
      baseLocal: sourceLocal(0.97, 2.33, facing),
      boomLength,
      stickLength,
      headLength,
      headTipOffset: Vec2(headLength * 0.9 * facing, 0.56 * WRECKERSAURUS_SCALE),
      boomWidth: 0.42 * WRECKERSAURUS_SCALE,
      stickWidth: 0.4 * WRECKERSAURUS_SCALE,
      jawOpenAngle: WRECKERSAURUS_JAW_OPEN_ANGLE * facing,
      jawClosedAngle: WRECKERSAURUS_JAW_CLOSED_ANGLE * facing,
      forwardLimits: createArmLimits(WRECKERSAURUS_FACING_RIGHT),
      limits: createArmLimits(facing),
      motorTorque: {
        boomAngle: 18000,
        stickAngle: 14500,
        headAngle: 8200,
        jawAngle: 5200,
      },
      targetWorld: null,
      directTargetLocal: null,
      desiredHeadAbs: null,
      directLimit: false,
      targetPose,
    };
  
    const initialPoints = getArmLocalPointsForPose(arm, arm.targetPose);
    const boomBody = createArmSegmentBody(
      chassis,
      segmentCenter(initialPoints.base, initialPoints.elbow),
      arm.targetPose.boomAngle,
      arm.boomLength,
      arm.boomWidth,
      0.2,
      "boom",
    );
    const stickBody = createArmSegmentBody(
      chassis,
      segmentCenter(initialPoints.elbow, initialPoints.wrist),
      initialPoints.stickAbs,
      arm.stickLength,
      arm.stickWidth,
      0.18,
      "stick",
    );
    const headTopBody = createHeadBody(chassis, initialPoints.wrist, initialPoints.headAbs, facing, headLength);
    const jawBottomBody = createJawBody(chassis, initialPoints.wrist, initialPoints.headAbs + arm.targetPose.jawAngle, facing, headLength);
  
    arm.bodies = {
      boom: boomBody,
      stick: stickBody,
      headTop: headTopBody,
      jawBottom: jawBottomBody,
    };
    arm.joints = {
      boomAngle: createArmJoint(chassis, boomBody, chassis.getWorldPoint(initialPoints.base), arm.limits.boomAngle, arm.motorTorque.boomAngle),
      stickAngle: createArmJoint(boomBody, stickBody, chassis.getWorldPoint(initialPoints.elbow), arm.limits.stickAngle, arm.motorTorque.stickAngle),
      headAngle: createArmJoint(stickBody, headTopBody, chassis.getWorldPoint(initialPoints.wrist), arm.limits.headAngle, arm.motorTorque.headAngle),
      jawAngle: createArmJoint(headTopBody, jawBottomBody, chassis.getWorldPoint(initialPoints.wrist), arm.limits.jawAngle, arm.motorTorque.jawAngle),
    };
  
    arm.workspaceSample = sampleArmWorkspace(arm, 0.06);
    arm.workspaceBounds = getWorkspaceBounds(arm.workspaceSample);
    arm.directTargetLocal = savedState?.directTargetLocal
      ? Vec2(savedState.directTargetLocal.x, savedState.directTargetLocal.y)
      : Vec2(initialPoints.wrist.x, initialPoints.wrist.y);
    arm.desiredHeadAbs = savedState?.desiredHeadAbs ?? initialPoints.headAbs;
    arm.targetWorld = chassis.getWorldPoint(arm.directTargetLocal);
  
    return arm;
  }

  function createArmLimits(facing) {
    const rightLimits = {
      boomAngle: [-2.05, 0.65],
      stickAngle: [-1.42, 2.72],
      headAngle: [-1.05, 1.45],
      jawAngle: [-0.28, 0.58],
    };
  
    if (facing === WRECKERSAURUS_FACING_RIGHT) return rightLimits;
    return Object.fromEntries(Object.entries(rightLimits).map(([key, [min, max]]) => [
      key,
      [-max, -min],
    ]));
  }

  function orientArmPoseForFacing(pose, facing) {
    return {
      boomAngle: pose.boomAngle * facing,
      stickAngle: pose.stickAngle * facing,
      headAngle: pose.headAngle * facing,
      jawAngle: pose.jawAngle * facing,
    };
  }

  function createWreckersaurusTail(chassis, facing = WRECKERSAURUS_FACING_RIGHT, savedState = {}) {
    return {
      chassis,
      facing,
      localPivot: sourceLocal(-1.84, 0.72, facing),
      baseAngle: Math.PI / 4,
      offset: savedState?.offset ?? 0,
      velocity: savedState?.velocity ?? 0,
    };
  }

  function createArmSegmentBody(chassis, centerLocal, angleLocal, length, width, density, part) {
    const body = physicsWorld.createDynamicBody({
      position: chassis.getWorldPoint(centerLocal),
      angle: chassis.getAngle() + angleLocal,
      angularDamping: 1.8,
      linearDamping: 0.35,
      bullet: true,
    });
    body.setUserData({ kind: "wreckersaurus", part });
    body.createFixture({
      shape: Box(length * 0.5, width * 0.5),
      density: density * 0.75,
      friction: 0.85,
      restitution: 0,
      filterGroupIndex: WRECKERSAURUS_COLLISION_GROUP,
    });
    return body;
  }

  function createHeadBody(chassis, wristLocal, angleLocal, facing, headLength) {
    const body = physicsWorld.createDynamicBody({
      position: chassis.getWorldPoint(wristLocal),
      angle: chassis.getAngle() + angleLocal,
      angularDamping: 5.2,
      linearDamping: 0.82,
      bullet: true,
    });
    body.setUserData({ kind: "wreckersaurus", part: "headTop" });
    body.createFixture({
      shape: Polygon(getHeadTopLocalVertices(headLength, facing)),
      density: 0.035,
      friction: 0.92,
      restitution: 0.01,
      filterGroupIndex: WRECKERSAURUS_COLLISION_GROUP,
    });
    return body;
  }

  function createJawBody(chassis, wristLocal, angleLocal, facing, headLength) {
    const body = physicsWorld.createDynamicBody({
      position: chassis.getWorldPoint(wristLocal),
      angle: chassis.getAngle() + angleLocal,
      angularDamping: 5.8,
      linearDamping: 0.88,
      bullet: true,
    });
    body.setUserData({ kind: "wreckersaurus", part: "jawBottom" });
    body.createFixture({
      shape: Polygon(getJawBottomLocalVertices(headLength, facing)),
      density: 0.03,
      friction: 0.95,
      restitution: 0.01,
      filterGroupIndex: WRECKERSAURUS_COLLISION_GROUP,
    });
    return body;
  }

  function getHeadTopLocalVertices(length, facing = WRECKERSAURUS_FACING_RIGHT) {
    return mirrorDirtVertices([
      Vec2(-0.06 * WRECKERSAURUS_SCALE, -0.24 * WRECKERSAURUS_SCALE),
      Vec2(0.38 * WRECKERSAURUS_SCALE, 0.92 * WRECKERSAURUS_SCALE),
      Vec2(length * 0.58, 1.18 * WRECKERSAURUS_SCALE),
      Vec2(length, 0.44 * WRECKERSAURUS_SCALE),
      Vec2(length * 0.95, -0.22 * WRECKERSAURUS_SCALE),
      Vec2(0.42 * WRECKERSAURUS_SCALE, -0.44 * WRECKERSAURUS_SCALE),
    ], facing);
  }

  function getJawBottomLocalVertices(length, facing = WRECKERSAURUS_FACING_RIGHT) {
    return mirrorDirtVertices([
      Vec2(-0.05 * WRECKERSAURUS_SCALE, 0.12 * WRECKERSAURUS_SCALE),
      Vec2(0.58 * WRECKERSAURUS_SCALE, 0.22 * WRECKERSAURUS_SCALE),
      Vec2(length, -0.42 * WRECKERSAURUS_SCALE),
      Vec2(length * 0.92, -1.3 * WRECKERSAURUS_SCALE),
      Vec2(0.48 * WRECKERSAURUS_SCALE, -1.12 * WRECKERSAURUS_SCALE),
      Vec2(-0.08 * WRECKERSAURUS_SCALE, -0.16 * WRECKERSAURUS_SCALE),
    ], facing);
  }

  function createArmJoint(parent, child, anchorWorld, limits, maxMotorTorque) {
    return physicsWorld.createJoint(RevoluteJoint({
      referenceAngle: 0,
      enableLimit: true,
      lowerAngle: limits[0],
      upperAngle: limits[1],
      enableMotor: true,
      motorSpeed: 0,
      maxMotorTorque,
      collideConnected: false,
    }, parent, child, anchorWorld));
  }

  function sourceLocal(x, y, facing = WRECKERSAURUS_FACING_RIGHT) {
    return Vec2(x * WRECKERSAURUS_SCALE * facing, -y * WRECKERSAURUS_SCALE);
  }

  function mirrorSourceVertices(vertices, facing) {
    const converted = vertices.map((vertex) => sourceLocal(vertex.x, vertex.y, facing));
    return facing === WRECKERSAURUS_FACING_RIGHT ? converted : converted.reverse();
  }

  function mirrorDirtVertices(vertices, facing) {
    const converted = vertices.map((vertex) => Vec2(vertex.x * facing, -vertex.y));
    return facing === WRECKERSAURUS_FACING_RIGHT ? converted : converted.reverse();
  }

  function makeTreadLoop(facing = WRECKERSAURUS_FACING_RIGHT) {
    const points = [];
    const halfLength = 2.45;
    const topY = -0.34;
    const bottomY = -1.16;
    const endRadius = (topY - bottomY) * 0.5;
    const centerY = (topY + bottomY) * 0.5;
  
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      points.push(sourceLocal(-halfLength + t * halfLength * 2, bottomY, facing));
    }
  
    for (let i = 2; i <= 4; i += 2) {
      const theta = -Math.PI / 2 + (i / 5) * Math.PI;
      points.push(sourceLocal(halfLength + Math.cos(theta) * endRadius, centerY + Math.sin(theta) * endRadius, facing));
    }
  
    for (let i = 1; i < 7; i++) {
      const t = i / 6;
      points.push(sourceLocal(halfLength - t * halfLength * 2, topY, facing));
    }
  
    for (let i = 2; i <= 4; i += 2) {
      const theta = Math.PI / 2 + (i / 5) * Math.PI;
      points.push(sourceLocal(-halfLength + Math.cos(theta) * endRadius, centerY + Math.sin(theta) * endRadius, facing));
    }
  
    return points;
  }

  function segmentCenter(a, b) {
    return Vec2((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
  }

  function svgDistance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function svgPivotAngle(a, b) {
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  function vecDistance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function updateActiveVehicleMotor(dt) {
    if (!activeVehicle) return;
  
    pollJoypad();
    desiredDrive = getDriveInput();
    const targetSpeed = desiredDrive * WRECKERSAURUS_DRIVE_SPEED;
    const driveSign = Math.sign(targetSpeed);
  
    if (driveSign === 0) {
      sharedWheelSpeed *= Math.pow(0.025, dt);
    } else {
      sharedWheelSpeed += (targetSpeed - sharedWheelSpeed) * Math.min(1, dt * 3.8);
      const signedSpeeds = activeVehicle.wheels.map((wheel) => wheel.body.getAngularVelocity() * driveSign);
      const slowest = Math.min(...signedSpeeds);
      const lockedLimit = Math.max(0, slowest + 2.2);
      const signedTarget = Math.abs(sharedWheelSpeed);
      if (signedTarget > lockedLimit) sharedWheelSpeed = driveSign * lockedLimit;
    }
  
    for (const joint of activeVehicle.wheelJoints) {
      joint.setMotorSpeed(sharedWheelSpeed);
      joint.setMaxMotorTorque(WRECKERSAURUS_MOTOR_TORQUE);
    }
  
    const averageSpin = activeVehicle.wheels.reduce((sum, wheel) => sum + wheel.body.getAngularVelocity(), 0) / activeVehicle.wheels.length;
    activeVehicle.drivePhase += averageSpin * activeVehicle.radius * dt * 1.15;
    updateArm(dt);
    updateTail(dt);
  }

  function getDriveInput() {
    if (joypad.active && Math.abs(joypad.drive) > 0) return joypad.drive;
    const keyboardRight = activeKeys.has("KeyD") || activeKeys.has("ArrowRight");
    const keyboardLeft = activeKeys.has("KeyA") || activeKeys.has("ArrowLeft");
    return Number(keyboardRight) - Number(keyboardLeft);
  }

  function updateArm(dt) {
    const arm = activeVehicle?.arm;
    if (!arm) return;
  
    ensureDirectArmTarget(arm);
    clampDesiredHeadAbsToCurrentPose(arm);
    updateDirectHeadTarget(arm, dt);
  
    const jawAngle = joypad.jawOpen ? arm.jawOpenAngle : arm.jawClosedAngle;
    const blockedByInput = moveDirectArmTarget(arm, dt, jawAngle);
    const solved = solveDirectArmPose(arm, arm.directTargetLocal, jawAngle);
  
    if (solved) {
      arm.targetPose = solved;
      clampDesiredHeadAbsToPose(arm, arm.targetPose);
      arm.directLimit = blockedByInput;
    } else {
      arm.targetPose = { ...arm.targetPose, jawAngle };
      clampDesiredHeadAbsToCurrentPose(arm);
      arm.directLimit = true;
    }
  
    driveArmJoints(arm, arm.targetPose);
    arm.targetWorld = arm.chassis.getWorldPoint(arm.directTargetLocal);
  }

  function ensureDirectArmTarget(arm) {
    if (arm.directTargetLocal && arm.desiredHeadAbs != null) return;
  
    const points = getArmLocalPoints(arm);
    arm.directTargetLocal = Vec2(points.wrist.x, points.wrist.y);
    arm.desiredHeadAbs = clampHeadAbsToPoseLimits(arm, points.headAbs, getArmJointAngles(arm));
    arm.targetWorld = arm.chassis.getWorldPoint(arm.directTargetLocal);
  }

  function updateDirectHeadTarget(arm, dt) {
    const headTurn = getCombinedHeadTurn();
    if (!headTurn) return;
    arm.desiredHeadAbs = clampHeadAbsToPoseLimits(
      arm,
      normalizeAngle(arm.desiredHeadAbs + headTurn * WRECKERSAURUS_DIRECT_HEAD_TURN_SPEED * getPrecisionScale() * dt),
      getArmJointAngles(arm),
    );
  }

  function moveDirectArmTarget(arm, dt, jawAngle) {
    const keyboardVector = getKeyboardArmVector();
    const armX = keyboardVector.x + joypad.armX;
    const armY = keyboardVector.y + joypad.armY;
    const stickMagnitude = Math.hypot(armX, armY);
    const pointerDelta = pointerArmControl.deltaLocal;
    pointerArmControl.deltaLocal = Vec2(0, 0);
  
    if (stickMagnitude <= 0 && Math.hypot(pointerDelta.x, pointerDelta.y) <= 0) return false;
  
    const scale = Math.min(1, stickMagnitude);
    const worldDelta = Vec2(
      stickMagnitude > 0 ? (armX / stickMagnitude) * scale * WRECKERSAURUS_DIRECT_TARGET_SPEED * getPrecisionScale() * dt : 0,
      stickMagnitude > 0 ? (armY / stickMagnitude) * scale * WRECKERSAURUS_DIRECT_TARGET_SPEED * getPrecisionScale() * dt : 0,
    );
    const stickDelta = rotateVec(worldDelta, -activeVehicle.chassis.getAngle());
    const dx = stickDelta.x + pointerDelta.x;
    const dy = stickDelta.y + pointerDelta.y;
    const current = arm.directTargetLocal;
    const fullMove = Vec2(current.x + dx, current.y + dy);
  
    if (trySetDirectArmTarget(arm, fullMove, jawAngle)) return false;
  
    const xOnly = Vec2(current.x + dx, current.y);
    const yOnly = Vec2(current.x, current.y + dy);
    const first = Math.abs(dx) >= Math.abs(dy) ? xOnly : yOnly;
    const second = first === xOnly ? yOnly : xOnly;
  
    if (trySetDirectArmTarget(arm, first, jawAngle)) return false;
    if (trySetDirectArmTarget(arm, second, jawAngle)) return false;
    return true;
  }

  function getKeyboardArmVector() {
    let x = 0;
    let y = 0;
    if (activeKeys.has("KeyJ")) x -= 1;
    if (activeKeys.has("KeyL")) x += 1;
    if (activeKeys.has("KeyI") || activeKeys.has("KeyW")) y -= 1;
    if (activeKeys.has("KeyK") || activeKeys.has("KeyS")) y += 1;
    const magnitude = Math.hypot(x, y);
    if (magnitude <= 1) return Vec2(x, y);
    return Vec2(x / magnitude, y / magnitude);
  }

  function trySetDirectArmTarget(arm, targetLocal, jawAngle) {
    const clamped = clampArmTargetToWorkspace(arm, targetLocal);
    const solved = solveDirectArmPose(arm, clamped, jawAngle);
    if (!solved) return false;
    arm.directTargetLocal = clamped;
    arm.targetPose = solved;
    clampDesiredHeadAbsToPose(arm, solved);
    arm.directLimit = false;
    return true;
  }

  function clampDesiredHeadAbsToCurrentPose(arm) {
    arm.desiredHeadAbs = clampHeadAbsToPoseLimits(arm, arm.desiredHeadAbs, getArmJointAngles(arm));
  }

  function clampDesiredHeadAbsToPose(arm, pose) {
    arm.desiredHeadAbs = clampHeadAbsToPoseLimits(arm, arm.desiredHeadAbs, pose);
  }

  function clampHeadAbsToPoseLimits(arm, targetHeadAbs, pose) {
    const stickAbs = normalizeAngle(pose.boomAngle + pose.stickAngle);
    const [headMin, headMax] = arm.limits.headAngle;
    const localHead = clamp(normalizeAngle(targetHeadAbs - stickAbs), headMin, headMax);
    return normalizeAngle(stickAbs + localHead);
  }

  function clampArmTargetToWorkspace(arm, targetLocal) {
    const bounds = arm.workspaceBounds;
    if (!bounds) return targetLocal;
    return Vec2(
      clamp(targetLocal.x, bounds.minX, bounds.maxX),
      clamp(targetLocal.y, bounds.minY, bounds.maxY),
    );
  }

  function solveDirectArmPose(arm, targetLocal, jawAngle) {
    return findBestArmPose(arm, targetLocal, {
      headAbs: arm.desiredHeadAbs,
      jawAngle,
    });
  }

  function getCombinedHeadTurn() {
    return joypad.headTurn +
      (activeKeys.has("KeyQ") ? -1 : 0) +
      (activeKeys.has("KeyE") ? 1 : 0);
  }

  function getPrecisionScale() {
    return activeKeys.has("ShiftLeft") || activeKeys.has("ShiftRight") ? 0.35 : 1;
  }

  function driveArmJoints(arm, pose) {
    driveArmJoint(arm, "boomAngle", pose.boomAngle);
    driveArmJoint(arm, "stickAngle", pose.stickAngle);
    driveArmJoint(arm, "headAngle", pose.headAngle);
    driveArmJoint(arm, "jawAngle", pose.jawAngle);
  }

  function driveArmJoint(arm, key, target) {
    const joint = arm.joints[key];
    const servo = WRECKERSAURUS_ARM_SERVO[key];
    const error = normalizeAngle(target - joint.getJointAngle());
    const damping = joint.getJointSpeed() * servo.damping;
    const maxSpeed = WRECKERSAURUS_ARM_SPEED * servo.speedScale;
    const motorSpeed = clamp(error * WRECKERSAURUS_ARM_SPEED * servo.gain - damping, -maxSpeed, maxSpeed);
    joint.setMaxMotorTorque(arm.motorTorque[key]);
    joint.setMotorSpeed(Math.abs(error) < 0.01 ? 0 : motorSpeed);
  }

  function findBestArmPose(arm, wristLocal, options = {}) {
    const candidates = findArmIKCandidates(arm, wristLocal, options);
    return candidates[0]?.pose ?? null;
  }

  function findArmIKCandidates(arm, wristLocal, options = {}) {
    const current = getArmJointAngles(arm);
    const candidates = [];
    const desiredHeadAbs = options.headAbs ?? normalizeAngle(current.boomAngle + current.stickAngle + current.headAngle);
    const desiredHeadForward = normalizeAngle(desiredHeadAbs * arm.facing);
    const jawAngleForward = clamp(
      (options.jawAngle ?? current.jawAngle ?? arm.jawClosedAngle) * arm.facing,
      arm.forwardLimits.jawAngle[0],
      arm.forwardLimits.jawAngle[1],
    );
    const dx = (wristLocal.x - arm.baseLocal.x) * arm.facing;
    const dy = wristLocal.y - arm.baseLocal.y;
    const l1 = arm.boomLength;
    const l2 = arm.stickLength;
    const distance = Math.hypot(dx, dy);
    const minReach = Math.abs(l1 - l2) + 0.04 * WRECKERSAURUS_SCALE;
    const maxReach = l1 + l2 - 0.04 * WRECKERSAURUS_SCALE;
    if (distance < minReach || distance > maxReach) return candidates;
  
    const theta = Math.atan2(dy, dx);
    const elbowMagnitude = Math.acos(clamp((distance * distance - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1));
    for (const stickAngle of [elbowMagnitude, -elbowMagnitude]) {
      const boomAngle = normalizeAngle(theta - Math.atan2(l2 * Math.sin(stickAngle), l1 + l2 * Math.cos(stickAngle)));
      const stickAngleLocal = normalizeAngle(stickAngle);
      const idealHeadAngle = normalizeAngle(desiredHeadForward - boomAngle - stickAngleLocal);
      const headAngle = clamp(idealHeadAngle, arm.forwardLimits.headAngle[0], arm.forwardLimits.headAngle[1]);
      const pose = orientArmPoseForFacing({
        boomAngle,
        stickAngle: stickAngleLocal,
        headAngle,
        jawAngle: jawAngleForward,
      }, arm.facing);
      if (!isArmPoseValid(arm, pose)) continue;
      candidates.push({
        pose,
        score: scoreArmCandidate(arm, pose, current, desiredHeadAbs),
      });
    }
  
    candidates.sort((a, b) => a.score - b.score);
    return candidates;
  }

  function isArmPoseValid(arm, pose) {
    if (!isArmPoseWithinLimits(arm, pose, 0)) return false;
    const points = getArmLocalPointsForPose(arm, pose);
    if (points.wrist.x * arm.facing < -2.6 * WRECKERSAURUS_SCALE || points.tip.x * arm.facing < -2.8 * WRECKERSAURUS_SCALE) return false;
    if (vecDistance(points.wrist, points.base) < 0.42 * WRECKERSAURUS_SCALE) return false;
    return true;
  }

  function isArmPoseWithinLimits(arm, pose, margin = 0) {
    return Object.entries(arm.limits).every(([key, [min, max]]) => (
      pose[key] >= min + margin && pose[key] <= max - margin
    ));
  }

  function scoreArmCandidate(arm, pose, current, desiredHeadAbs) {
    const headAbs = normalizeAngle(pose.boomAngle + pose.stickAngle + pose.headAngle);
    const continuity =
      angleDelta(pose.boomAngle, current.boomAngle) * 1.1 +
      angleDelta(pose.stickAngle, current.stickAngle) * 0.85 +
      angleDelta(pose.headAngle, current.headAngle) * 0.42 +
      angleDelta(pose.jawAngle, current.jawAngle) * 0.18;
    const orientation = angleDelta(headAbs, desiredHeadAbs) * 0.9;
    const speed =
      Math.abs(arm.joints.boomAngle.getJointSpeed()) * 0.018 +
      Math.abs(arm.joints.stickAngle.getJointSpeed()) * 0.014 +
      Math.abs(arm.joints.headAngle.getJointSpeed()) * 0.008 +
      Math.abs(arm.joints.jawAngle.getJointSpeed()) * 0.006;
    const limitPenalty = Object.entries(arm.limits).reduce((sum, [key, [min, max]]) => {
      const clearance = Math.min(pose[key] - min, max - pose[key]);
      return sum + Math.max(0, 0.18 - clearance) * 1.8;
    }, 0);
  
    return continuity + orientation + speed + limitPenalty;
  }

  function sampleArmWorkspace(arm, step = 0.3) {
    const samples = [];
    const [boomMin, boomMax] = arm.limits.boomAngle;
    const [stickMin, stickMax] = arm.limits.stickAngle;
  
    for (let boomAngle = boomMin; boomAngle <= boomMax; boomAngle += step) {
      for (let stickAngle = stickMin; stickAngle <= stickMax; stickAngle += step) {
        const pose = { boomAngle, stickAngle, headAngle: arm.targetPose.headAngle, jawAngle: arm.jawClosedAngle };
        if (isArmPoseValid(arm, pose)) samples.push(getArmLocalPointsForPose(arm, pose).wrist);
      }
    }
  
    return samples;
  }

  function getWorkspaceBounds(samples) {
    if (!samples.length) return null;
    return samples.reduce((bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }), {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
    });
  }

  function rotateVec(v, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return Vec2(v.x * c - v.y * s, v.x * s + v.y * c);
  }

  function angleDelta(a, b) {
    return Math.abs(normalizeAngle(a - b));
  }

  function updateTail(dt) {
    const tail = activeVehicle?.tail;
    if (!tail) return;
  
    const driveTarget = clamp(-sharedWheelSpeed * 0.012 - activeVehicle.chassis.getAngularVelocity() * 0.035, -0.18, 0.18);
    const spring = (driveTarget - tail.offset) * 42;
    const damping = tail.velocity * 8.5;
    tail.velocity += (spring - damping) * dt;
    tail.offset = clamp(tail.offset + tail.velocity * dt, -0.26, 0.26);
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
      joypad.active = false;
      joypad.lastAButton = false;
      joypad.lastYButton = false;
      return;
    }
  
    joypad.connected = true;
    joypad.index = gamepad.index;
    const leftX = applyStickDeadzone(gamepad.axes[0] ?? 0);
    const rightX = applyStickDeadzone(gamepad.axes[2] ?? 0);
    const rightY = applyStickDeadzone(gamepad.axes[3] ?? 0);
    const aPressed = isGamepadButtonPressed(gamepad.buttons[0]);
    const yPressed = isGamepadButtonPressed(gamepad.buttons[3]);
    const leftBumper = isGamepadButtonPressed(gamepad.buttons[4]);
    const rightBumper = isGamepadButtonPressed(gamepad.buttons[5]);
  
    if (aPressed && !joypad.lastAButton) joypad.jawOpen = !joypad.jawOpen;
    if (yPressed && !joypad.lastYButton) flipWreckersaurusFacing();
  
    joypad.lastAButton = aPressed;
    joypad.lastYButton = yPressed;
    joypad.drive = leftX;
    joypad.armX = rightX;
    joypad.armY = rightY;
    joypad.headTurn = (leftBumper ? -1 : 0) + (rightBumper ? 1 : 0);
    joypad.active = (
      Math.abs(leftX) > 0 ||
      Math.abs(rightX) > 0 ||
      Math.abs(rightY) > 0 ||
      aPressed ||
      yPressed ||
      leftBumper ||
      rightBumper
    );
  }

  function applyStickDeadzone(value) {
    const magnitude = Math.abs(value);
    if (magnitude < WRECKERSAURUS_GAMEPAD_DEADZONE) return 0;
    return Math.sign(value) * ((magnitude - WRECKERSAURUS_GAMEPAD_DEADZONE) / (1 - WRECKERSAURUS_GAMEPAD_DEADZONE));
  }

  function isGamepadButtonPressed(button) {
    return Boolean(button && (button.pressed || button.value > 0.5));
  }

  function flipActiveVehicleUpright() {
    if (!activeVehicle) return;
  
    const angle = normalizeAngle(activeVehicle.chassis.getAngle());
    const isOnBack = Math.cos(angle) < 0;
    if (!isOnBack) return;
  
    const sideImpulse = (Math.random() * 2 - 1) * WRECKERSAURUS_FLIP_SIDE_IMPULSE;
    const chassisCenter = activeVehicle.chassis.getWorldCenter();
    const rotationDirection = angle >= 0 ? -1 : 1;
  
    activeVehicle.chassis.applyLinearImpulse(Vec2(sideImpulse, -WRECKERSAURUS_FLIP_UPWARD_IMPULSE), chassisCenter, true);
    activeVehicle.chassis.applyAngularImpulse(rotationDirection * WRECKERSAURUS_FLIP_ANGULAR_IMPULSE, true);
    for (const body of getActiveVehicleBodies()) {
      if (body === activeVehicle.chassis) continue;
      body.applyLinearImpulse(Vec2(sideImpulse * 0.12, -WRECKERSAURUS_FLIP_UPWARD_IMPULSE * 0.18), body.getWorldCenter(), true);
    }
  }

  function drawActiveVehicle(cellW, cellH) {
    if (!activeVehicle) return;
  
    ctx.save();
    drawTreadBelt(cellW, cellH);
    drawWreckersaurusWheels(cellW, cellH);
    drawWreckersaurusTail(cellW, cellH);
    drawWreckersaurusStick(cellW, cellH);
    drawWreckersaurusBoom(cellW, cellH);
    drawWreckersaurusChassis(cellW, cellH);
    drawWreckersaurusHeadTop(cellW, cellH);
    drawWreckersaurusJawBottom(cellW, cellH);
    drawArmTarget(cellW, cellH);
    ctx.restore();
  }

  function getArmLocalPoints(arm) {
    if (!arm.bodies) return getArmLocalPointsForPose(arm, arm.targetPose);
    const points = getArmWorldPoints(arm);
    return {
      base: activeVehicle.chassis.getLocalPoint(points.base),
      elbow: activeVehicle.chassis.getLocalPoint(points.elbow),
      wrist: activeVehicle.chassis.getLocalPoint(points.wrist),
      tip: activeVehicle.chassis.getLocalPoint(points.tip),
      headAbs: normalizeAngle(arm.bodies.headTop.getAngle() - activeVehicle.chassis.getAngle()),
      jawAbs: normalizeAngle(arm.bodies.jawBottom.getAngle() - activeVehicle.chassis.getAngle()),
      jawAngle: arm.joints.jawAngle.getJointAngle(),
      stickAbs: normalizeAngle(arm.bodies.stick.getAngle() - activeVehicle.chassis.getAngle()),
    };
  }

  function getArmWorldPoints(arm) {
    return {
      base: arm.chassis.getWorldPoint(arm.baseLocal),
      elbow: arm.bodies.boom.getWorldPoint(Vec2(arm.boomLength * 0.5 * arm.facing, 0)),
      wrist: arm.bodies.stick.getWorldPoint(Vec2(arm.stickLength * 0.5 * arm.facing, 0)),
      tip: arm.bodies.headTop.getWorldPoint(arm.headTipOffset),
    };
  }

  function getArmLocalPointsForPose(arm, pose) {
    const boomAbs = pose.boomAngle;
    const stickAbs = pose.boomAngle + pose.stickAngle;
    const headAbs = stickAbs + pose.headAngle;
    const base = Vec2(arm.baseLocal.x, arm.baseLocal.y);
    const elbow = Vec2(
      base.x + Math.cos(boomAbs) * arm.boomLength * arm.facing,
      base.y + Math.sin(boomAbs) * arm.boomLength * arm.facing,
    );
    const wrist = Vec2(
      elbow.x + Math.cos(stickAbs) * arm.stickLength * arm.facing,
      elbow.y + Math.sin(stickAbs) * arm.stickLength * arm.facing,
    );
    const tipOffset = rotateVec(arm.headTipOffset, headAbs);
    const tip = Vec2(wrist.x + tipOffset.x, wrist.y + tipOffset.y);
    return { base, elbow, wrist, tip, headAbs, jawAbs: headAbs + pose.jawAngle, stickAbs };
  }

  function getArmJointAngles(arm) {
    if (!arm.joints) return arm.targetPose;
    return {
      boomAngle: arm.joints.boomAngle.getJointAngle(),
      stickAngle: arm.joints.stickAngle.getJointAngle(),
      headAngle: arm.joints.headAngle.getJointAngle(),
      jawAngle: arm.joints.jawAngle.getJointAngle(),
    };
  }

  function drawTreadBelt(cellW, cellH) {
    const points = activeVehicle.wheels.map((wheel) => worldToCanvasPoint(wheel.body.getPosition(), cellW, cellH));
    if (points.length < 3) return;
  
    const unit = Math.min(cellW, cellH);
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#171d20";
    ctx.lineWidth = activeVehicle.radius * unit * 1.72;
    traceClosed(points);
    ctx.stroke();
  
    ctx.strokeStyle = "#3a4241";
    ctx.lineWidth = activeVehicle.radius * unit * 0.78;
    traceClosed(points);
    ctx.stroke();
  
    const phase = ((activeVehicle.drivePhase * unit) % 24 + 24) % 24;
    ctx.strokeStyle = "rgba(223, 218, 187, 0.75)";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 14]);
    ctx.lineDashOffset = -phase;
    traceClosed(points);
    ctx.stroke();
    ctx.restore();
  }

  function drawWreckersaurusWheels(cellW, cellH) {
    const unit = Math.min(cellW, cellH);
    ctx.save();
    for (const wheel of activeVehicle.wheels) {
      const center = worldToCanvasPoint(wheel.body.getPosition(), cellW, cellH);
      const radius = wheel.radius * unit;
      ctx.fillStyle = "#323937";
      ctx.strokeStyle = "#111719";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
  
      ctx.strokeStyle = "#d8c886";
      ctx.lineWidth = 2;
      const angle = wheel.body.getAngle();
      line(center.x, center.y, center.x + Math.cos(angle) * radius * 0.72, center.y + Math.sin(angle) * radius * 0.72);
    }
    ctx.restore();
  }

  function drawWreckersaurusChassis(cellW, cellH) {
    drawSvgAtAnchor(
      wreckersaurusImages.chassis,
      activeVehicle.chassis.getWorldPoint(activeVehicle.chassisArtPivotLocal),
      activeVehicle.chassis.getAngle(),
      wreckersaurusSvg.chassis.pivot,
      WRECKERSAURUS_ART_SCALE,
      activeVehicle.facing,
      cellW,
      cellH,
    );
  }

  function drawWreckersaurusTail(cellW, cellH) {
    const tail = activeVehicle.tail;
    const localAngle = tail.baseAngle + tail.offset;
    drawSvgAtAnchor(
      wreckersaurusImages.tail,
      activeVehicle.chassis.getWorldPoint(tail.localPivot),
      activeVehicle.chassis.getAngle() + localAngle * activeVehicle.facing,
      wreckersaurusSvg.tail.pivot,
      WRECKERSAURUS_ART_SCALE,
      activeVehicle.facing,
      cellW,
      cellH,
    );
  }

  function drawWreckersaurusBoom(cellW, cellH) {
    const arm = activeVehicle.arm;
    const points = getArmLocalPoints(arm);
    ctx.save();
    drawHydraulics(points, cellW, cellH);
    drawSvgBodyBetweenPivots(arm.bodies.boom, wreckersaurusImages.boom, wreckersaurusSvg.boom, arm.facing, cellW, cellH);
    ctx.restore();
  }

  function drawWreckersaurusStick(cellW, cellH) {
    const arm = activeVehicle.arm;
    drawSvgBodyBetweenPivots(arm.bodies.stick, wreckersaurusImages.stick, wreckersaurusSvg.stick, arm.facing, cellW, cellH);
  }

  function drawWreckersaurusHeadTop(cellW, cellH) {
    const arm = activeVehicle.arm;
    drawSvgBodyAtPivot(arm.bodies.headTop, wreckersaurusImages.headTop, wreckersaurusSvg.headTop, WRECKERSAURUS_HEAD_JAW_ART_SCALE, arm.facing, cellW, cellH);
  }

  function drawWreckersaurusJawBottom(cellW, cellH) {
    const arm = activeVehicle.arm;
    drawSvgBodyAtPivot(arm.bodies.jawBottom, wreckersaurusImages.jawBottom, wreckersaurusSvg.jawBottom, WRECKERSAURUS_HEAD_JAW_ART_SCALE, arm.facing, cellW, cellH);
  }

  function drawHydraulics(points, cellW, cellH) {
    const unit = Math.min(cellW, cellH);
    ctx.save();
    ctx.strokeStyle = "#343733";
    ctx.lineWidth = Math.max(2, unit * 0.8);
    drawLocalLine(offsetLocal(points.base, -0.2, -0.08), offsetLocal(points.elbow, -0.45, -0.15), cellW, cellH);
    drawLocalLine(offsetLocal(points.elbow, 0.2, -0.2), offsetLocal(points.wrist, -0.28, -0.12), cellW, cellH);
    ctx.strokeStyle = "#c7b16e";
    ctx.lineWidth = Math.max(1, unit * 0.32);
    drawLocalLine(offsetLocal(points.base, -0.2, -0.08), offsetLocal(points.elbow, -0.45, -0.15), cellW, cellH);
    drawLocalLine(offsetLocal(points.elbow, 0.2, -0.2), offsetLocal(points.wrist, -0.28, -0.12), cellW, cellH);
    ctx.restore();
  }

  function drawSvgBodyBetweenPivots(body, imageAsset, svg, facing, cellW, cellH) {
    const anchor = segmentCenter(svg.pivot, svg.end);
    const assetAngle = svgPivotAngle(svg.pivot, svg.end);
    const angle = facing === WRECKERSAURUS_FACING_RIGHT ? body.getAngle() - assetAngle : body.getAngle() + assetAngle;
    drawSvgAtAnchor(imageAsset, body.getPosition(), angle, anchor, WRECKERSAURUS_ART_SCALE, facing, cellW, cellH);
  }

  function drawSvgBodyAtPivot(body, imageAsset, svg, scale, facing, cellW, cellH) {
    drawSvgAtAnchor(imageAsset, body.getPosition(), body.getAngle(), svg.pivot, scale, facing, cellW, cellH);
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

  function drawArmTarget(cellW, cellH) {
    const arm = activeVehicle.arm;
    if (!arm.directTargetLocal) return;
    arm.targetWorld = arm.chassis.getWorldPoint(arm.directTargetLocal);
    const point = worldToCanvasPoint(arm.targetWorld, cellW, cellH);
    const radius = 0.2 * Math.min(cellW, cellH) * WRECKERSAURUS_SCALE;
    ctx.save();
    ctx.strokeStyle = arm.directLimit ? "#bb2f2f" : "#d3952c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    line(point.x - radius * 0.6, point.y, point.x + radius * 0.6, point.y);
    line(point.x, point.y - radius * 0.6, point.x, point.y + radius * 0.6);
    ctx.restore();
  }

  function localToCanvas(local, cellW, cellH) {
    return worldToCanvasPoint(activeVehicle.chassis.getWorldPoint(local), cellW, cellH);
  }

  function offsetLocal(point, x, y) {
    return Vec2(point.x + x * WRECKERSAURUS_SCALE * activeVehicle.facing, point.y - y * WRECKERSAURUS_SCALE);
  }

  function drawLocalLine(a, b, cellW, cellH) {
    const start = localToCanvas(a, cellW, cellH);
    const end = localToCanvas(b, cellW, cellH);
    line(start.x, start.y, end.x, end.y);
  }

  function worldToCanvasPoint(point, cellW, cellH) {
    return {
      x: point.x * cellW,
      y: point.y * cellH,
    };
  }

  function traceClosed(points) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
  }

  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function getActiveVehicleBodies() {
    if (!activeVehicle) return [];
    return [
      activeVehicle.chassis,
      ...activeVehicle.wheels.map((wheel) => wheel.body),
      ...Object.values(activeVehicle.arm.bodies),
    ];
  }

  function destroyWreckersaurus(wreckersaurus) {
    if (!wreckersaurus) return;

    [
      ...Object.values(wreckersaurus.arm.joints),
      ...wreckersaurus.wheelJoints,
      ...wreckersaurus.linkJoints,
    ].forEach((joint) => {
      if (joint) physicsWorld.destroyJoint(joint);
    });

    [
      ...Object.values(wreckersaurus.arm.bodies),
      ...wreckersaurus.wheels.map((wheel) => wheel.body),
      wreckersaurus.chassis,
    ].forEach(destroyPhysicsBody);
  }

  function flipWreckersaurusFacing() {
    if (!activeVehicle) return;
  
    const previous = activeVehicle;
    const currentPosition = previous.chassis.getPosition();
    const nextState = {
      angle: previous.chassis.getAngle(),
      drivePhase: previous.drivePhase,
      arm: captureFlippedArmState(previous.arm),
      tail: {
        offset: previous.tail.offset,
        velocity: 0,
      },
    };
  
    destroyWreckersaurus(previous);
    activeVehicle = createWreckersaurus(Vec2(currentPosition.x, currentPosition.y), -previous.facing, nextState);
    sharedWheelSpeed = 0;
    desiredDrive = 0;
    pointerArmControl.deltaLocal = Vec2(0, 0);
  }

  function captureFlippedArmState(arm) {
    const points = getArmLocalPoints(arm);
    const directTargetLocal = arm.directTargetLocal ?? points.wrist;
    const desiredHeadAbs = arm.desiredHeadAbs ?? points.headAbs;
  
    return {
      targetPose: flipArmPose(getArmJointAngles(arm)),
      directTargetLocal: Vec2(-directTargetLocal.x, directTargetLocal.y),
      desiredHeadAbs: -desiredHeadAbs,
    };
  }

  function flipArmPose(pose) {
    return {
      boomAngle: -pose.boomAngle,
      stickAngle: -pose.stickAngle,
      headAngle: -pose.headAngle,
      jawAngle: -pose.jawAngle,
    };
  }

  return {
    create,
    destroy,
    getBodies: getActiveVehicleBodies,
    step,
    draw,
    reset,
    captureState,
    flipFacing: flipWreckersaurusFacing,
    flipUpright: flipActiveVehicleUpright,
    addPointerArmDelta,
    isOutOfBounds,
    getActiveVehicle: () => activeVehicle,
  };
}
