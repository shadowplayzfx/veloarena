import RAPIER from '@dimforge/rapier3d-compat';
import { ARENA_BOUNDS, BOOST_PADS, CAR_MAP, FFA_ARENA_BOUNDS, FFA_BOOST_PADS } from './constants.ts';
import type {
  ArenaId,
  BoostPadState,
  BotDebugSnapshot,
  BotDifficulty,
  CarCustomization,
  CarStateSnapshot,
  MatchEvent,
  MatchPhase,
  MatchStateSnapshot,
  PartyGameMode,
  PlayerInput,
  Quat,
  Team,
  Vec3,
} from './types.ts';

/**
 * Single centralized physics tuning configuration for Velocity Arena.
 * Controls suspension, tire grip/slip, torque, boost, aero drag, collisions & demolitions.
 */
export const PHYSICS_CONFIG = {
  gravity: -19.6,
  carDensity: 19.5,
  comLowerOffset: -0.24,
  suspension: {
    restLength: 0.66,
    travelMax: 0.24,
    spring: 4600,
    damper: 410,
  },
  tires: {
    grip: 1580,
    rearDriftGrip: 240,
    slipThreshold: 5.5,
    slipFalloff: 0.42,
  },
  engine: {
    driveForce: 3750,
    brakeForce: 5400,
    reverseForce: 2650,
    maxDriveSpeed: 31,
    maxReverseSpeed: 19,
    torqueFalloffMin: 0.22,
    rollingDrag: 115,
  },
  boost: {
    boostForce: 4850,
    consumptionPerSec: 32,
    practiceConsumptionPerSec: 18,
    regenPerSec: 4.5,
    maxBoostSpeed: 46,
    supersonicSpeed: 33,
  },
  steering: {
    maxSteerAngle: 0.44,
    speedReductionFactor: 0.45,
    yawTorque: 1680,
    driftYawMultiplier: 1.52,
  },
  aero: {
    highSpeedDragCoeff: 0.22,
    dragStartSpeed: 22,
    maxCarSpeed: 52,
    wallAdhesionForce: 1950,
    wallMinSpeed: 9.5,
  },
  collisions: {
    bumpImpulse: 1250,
    minBumpRelSpeed: 7.5,
    demoSpeedThreshold: 33.0,
    demoRespawnSeconds: 3.0,
  },
  ball: {
    transferImpulse: 14.5,
    maxPopImpulse: 540,
    spinTransferFactor: 0.55,
    maxBallSpeed: 68,
  },
} as const;

let rapierReadyPromise: Promise<void> | null = null;

export function ensureRapierReady(): Promise<void> {
  if (!rapierReadyPromise) {
    rapierReadyPromise = RAPIER.init();
  }
  return rapierReadyPromise;
}

export interface CarActorConfig {
  id: string;
  name: string;
  team: Team;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  customization: CarCustomization;
  connected?: boolean;
}

interface InternalCar {
  config: CarActorConfig;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  boost: number;
  isBoosting: boolean;
  isGrounded: boolean;
  isSupersonic: boolean;
  steerAngle: number;
  wheelSpin: number;
  throttle: number;
  wheelTravel: [number, number, number, number];
  driftIntensity: number;
  brakeHeat: number;
  isBraking: boolean;
  isReversing: boolean;
  demolishedTimer: number;
  respawnFade: number;
  lastJumpPressed: boolean;
  doubleJumpWindow: number;
  hasDoubleJump: boolean;
  flipTimer: number;
  bumpCooldown: number;
  botDebug?: BotDebugSnapshot;
  goals: number;
  shots: number;
  saves: number;
  ackSeq: number;
  input: PlayerInput;
  spawnPos: Vec3;
  spawnYaw: number;
}

function yawToQuat(yaw: number): Quat {
  const half = yaw * 0.5;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

function rotateVecByQuat(v: Vec3, q: Quat): Vec3 {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function len(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export class PhysicsSimulation {
  world: RAPIER.World;
  ballBody: RAPIER.RigidBody;
  ballCollider: RAPIER.Collider;
  cars: Map<string, InternalCar> = new Map();
  boostPads: BoostPadState[] = [];

  arenaId: ArenaId;
  gameMode: PartyGameMode;
  matchDuration: number;
  isPractice: boolean;

  phase: MatchPhase = 'countdown';
  countdownTimer = 3.0;
  lastCountdownInt = 4;
  timeRemaining: number;
  isOvertime = false;
  goalCelebrationTimer = 0;

  blueScore = 0;
  orangeScore = 0;
  emeraldScore = 0;
  lastGoalTeam: Team | null = null;
  lastGoalScorer: string | null = null;
  lastGoalSpeedKmh = 0;

  lastTouchPlayerId: string | null = null;
  lastTouchTeam: Team | null = null;
  lastTouchTime = 0;
  shotCreditCooldown = 0;
  ballImpactCooldown = 0;

  tick = 0;
  events: MatchEvent[] = [];

  constructor(options: {
    arenaId: ArenaId;
    matchDuration: number;
    isPractice?: boolean;
    gameMode?: PartyGameMode;
  }) {
    this.arenaId = options.arenaId;
    this.gameMode = options.gameMode ?? 'team_2v1';
    this.matchDuration = options.matchDuration;
    this.isPractice = Boolean(options.isPractice);
    this.timeRemaining = options.matchDuration;

    this.world = new RAPIER.World({ x: 0, y: PHYSICS_CONFIG.gravity, z: 0 });
    this.world.timestep = 1 / 60;

    if (this.gameMode === 'ffa') {
      this.buildFfaArenaColliders();
    } else {
      this.buildArenaColliders();
    }

    // Create Ball
    const ballDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, ARENA_BOUNDS.BALL_RADIUS + 0.05, 0)
      .setLinearDamping(0.05)
      .setAngularDamping(0.16)
      .setGravityScale(0.68)
      .setCcdEnabled(true);
    this.ballBody = this.world.createRigidBody(ballDesc);

    const ballColDesc = RAPIER.ColliderDesc.ball(ARENA_BOUNDS.BALL_RADIUS)
      .setDensity(0.85)
      .setRestitution(0.79)
      .setFriction(0.45);
    this.ballCollider = this.world.createCollider(ballColDesc, this.ballBody);

    const padList = this.gameMode === 'ffa' ? FFA_BOOST_PADS : BOOST_PADS;
    this.boostPads = padList.map((p) => ({
      id: p.id,
      x: p.x,
      z: p.z,
      isLarge: p.isLarge,
      active: true,
      cooldown: 0,
    }));

    if (this.isPractice) {
      this.phase = 'playing';
      this.countdownTimer = 0;
    }
  }

  private createStaticBox(
    hx: number,
    hy: number,
    hz: number,
    tx: number,
    ty: number,
    tz: number,
    rotEuler?: { x: number; y: number; z: number },
    restitution = 0.65,
    friction = 0.4
  ) {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(tx, ty, tz)
      .setRestitution(restitution)
      .setFriction(friction);

    if (rotEuler) {
      const cx = Math.cos(rotEuler.x * 0.5);
      const sx = Math.sin(rotEuler.x * 0.5);
      const cy = Math.cos(rotEuler.y * 0.5);
      const sy = Math.sin(rotEuler.y * 0.5);
      const cz = Math.cos(rotEuler.z * 0.5);
      const sz = Math.sin(rotEuler.z * 0.5);
      desc.setRotation({
        w: cx * cy * cz + sx * sy * sz,
        x: sx * cy * cz - cx * sy * sz,
        y: cx * sy * cz + sx * cy * sz,
        z: cx * cy * sz - sx * sy * cz,
      });
    }

    this.world.createCollider(desc);
  }

  private buildArenaColliders() {
    const hw = ARENA_BOUNDS.HALF_WIDTH;
    const hl = ARENA_BOUNDS.HALF_LENGTH;
    const h = ARENA_BOUNDS.HEIGHT;
    const gw = ARENA_BOUNDS.GOAL_HALF_WIDTH;
    const gh = ARENA_BOUNDS.GOAL_HEIGHT;
    const gd = ARENA_BOUNDS.GOAL_DEPTH;

    // Main floor
    this.createStaticBox(hw + 4, 1.0, hl + gd + 4, 0, -1.0, 0, undefined, 0.55, 0.5);

    // Ceiling
    this.createStaticBox(hw + 4, 1.0, hl + gd + 4, 0, h + 1.0, 0, undefined, 0.6, 0.2);

    // Left & Right side walls
    this.createStaticBox(1.0, h * 0.5 + 2, hl + 2, -hw - 1.0, h * 0.5, 0, undefined, 0.72, 0.2);
    this.createStaticBox(1.0, h * 0.5 + 2, hl + 2, hw + 1.0, h * 0.5, 0, undefined, 0.72, 0.2);

    const sideSegmentHalfW = (hw - gw) * 0.5;
    const sideSegmentCenterX = gw + sideSegmentHalfW;
    const upperWallHalfH = (h - gh) * 0.5;
    const upperWallCenterY = gh + upperWallHalfH;

    for (const sign of [-1, 1]) {
      const zWall = sign * (hl + 1.0);
      this.createStaticBox(sideSegmentHalfW, h * 0.5 + 1, 1.0, -sideSegmentCenterX, h * 0.5, zWall, undefined, 0.72, 0.2);
      this.createStaticBox(sideSegmentHalfW, h * 0.5 + 1, 1.0, sideSegmentCenterX, h * 0.5, zWall, undefined, 0.72, 0.2);
      this.createStaticBox(gw + 0.5, upperWallHalfH + 1, 1.0, 0, upperWallCenterY, zWall, undefined, 0.72, 0.2);

      const zBack = sign * (hl + gd + 1.0);
      const zMid = sign * (hl + gd * 0.5);
      this.createStaticBox(gw + 1.0, gh * 0.5 + 1, 1.0, 0, gh * 0.5, zBack, undefined, 0.35, 0.6);
      this.createStaticBox(0.8, gh * 0.5 + 1, gd * 0.5 + 0.5, -gw - 0.8, gh * 0.5, zMid, undefined, 0.4, 0.5);
      this.createStaticBox(0.8, gh * 0.5 + 1, gd * 0.5 + 0.5, gw + 0.8, gh * 0.5, zMid, undefined, 0.4, 0.5);
      this.createStaticBox(gw + 1.0, 0.8, gd * 0.5 + 0.5, 0, gh + 0.8, zMid, undefined, 0.4, 0.5);
    }

    const corner = ARENA_BOUNDS.CORNER_SIZE;
    const cornerHyp = Math.sqrt(corner * corner * 2) * 0.5 + 1.2;
    const corners = [
      { x: -hw + corner * 0.5, z: -hl + corner * 0.5, ry: Math.PI * 0.25 },
      { x: hw - corner * 0.5, z: -hl + corner * 0.5, ry: -Math.PI * 0.25 },
      { x: -hw + corner * 0.5, z: hl - corner * 0.5, ry: -Math.PI * 0.25 },
      { x: hw - corner * 0.5, z: hl - corner * 0.5, ry: Math.PI * 0.25 },
    ];
    for (const c of corners) {
      this.createStaticBox(cornerHyp, h * 0.5, 1.0, c.x, h * 0.5, c.z, { x: 0, y: c.ry, z: 0 }, 0.74, 0.2);
    }

    // Curved-feel lower wall transitions
    this.createStaticBox(1.9, 0.42, hl - corner, -hw + 0.65, 0.45, 0, { x: 0, y: 0, z: -0.52 }, 0.6, 0.42);
    this.createStaticBox(1.9, 0.42, hl - corner, hw - 0.65, 0.45, 0, { x: 0, y: 0, z: 0.52 }, 0.6, 0.42);
  }

  private buildFfaArenaColliders() {
    const A = FFA_ARENA_BOUNDS.APOTHEM;
    const h = FFA_ARENA_BOUNDS.HEIGHT;
    const gw = FFA_ARENA_BOUNDS.GOAL_HALF_WIDTH;
    const gh = FFA_ARENA_BOUNDS.GOAL_HEIGHT;
    const gd = FFA_ARENA_BOUNDS.GOAL_DEPTH;
    const sideHalfLen = A / Math.sqrt(3);

    this.createStaticBox(A + gd + 14, 1.0, A + gd + 14, 0, -1.0, 0, undefined, 0.55, 0.5);
    this.createStaticBox(A + gd + 14, 1.0, A + gd + 14, 0, h + 1.0, 0, undefined, 0.6, 0.2);

    const placeRotatedBox = (
      theta: number,
      hx: number,
      hy: number,
      hz: number,
      lx: number,
      ly: number,
      lz: number,
      restitution = 0.72,
      friction = 0.2
    ) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const wx = lx * cosT + lz * sinT;
      const wz = -lx * sinT + lz * cosT;
      this.createStaticBox(hx, hy, hz, wx, ly, wz, { x: 0, y: theta, z: 0 }, restitution, friction);
    };

    const goalAngles = [
      FFA_ARENA_BOUNDS.GOAL_ANGLES.blue,
      FFA_ARENA_BOUNDS.GOAL_ANGLES.orange,
      FFA_ARENA_BOUNDS.GOAL_ANGLES.emerald,
    ];

    for (let i = 0; i < 6; i++) {
      const theta = (i * Math.PI) / 3;
      const isGoalSide = goalAngles.some((ga) => Math.abs(ga - theta) < 0.05);

      if (!isGoalSide) {
        placeRotatedBox(theta, sideHalfLen + 1.5, h * 0.5 + 1, 1.0, 0, h * 0.5, A + 1.0);
      } else {
        const segHalf = (sideHalfLen - gw) * 0.5;
        const segCenterX = gw + segHalf;
        const upperHalfH = (h - gh) * 0.5;
        const upperCenterY = gh + upperHalfH;

        placeRotatedBox(theta, segHalf + 0.8, h * 0.5 + 1, 1.0, -segCenterX, h * 0.5, A + 1.0);
        placeRotatedBox(theta, segHalf + 0.8, h * 0.5 + 1, 1.0, segCenterX, h * 0.5, A + 1.0);
        placeRotatedBox(theta, gw + 0.6, upperHalfH + 1, 1.0, 0, upperCenterY, A + 1.0);

        const zBack = A + gd + 1.0;
        const zMid = A + gd * 0.5;
        placeRotatedBox(theta, gw + 1.0, gh * 0.5 + 1, 1.0, 0, gh * 0.5, zBack, 0.35, 0.6);
        placeRotatedBox(theta, 0.8, gh * 0.5 + 1, gd * 0.5 + 0.5, -gw - 0.8, gh * 0.5, zMid, 0.4, 0.5);
        placeRotatedBox(theta, 0.8, gh * 0.5 + 1, gd * 0.5 + 0.5, gw + 0.8, gh * 0.5, zMid, 0.4, 0.5);
        placeRotatedBox(theta, gw + 1.0, 0.8, gd * 0.5 + 0.5, 0, gh + 0.8, zMid, 0.4, 0.5);
      }
    }
  }

  public addCar(config: CarActorConfig, slotIndex: number, totalOnTeam: number): void {
    const carDef = CAR_MAP[config.customization.carId] ?? CAR_MAP.striker;
    const spawn = this.computeSpawn(config.team, slotIndex, totalOnTeam);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.pos.x, spawn.pos.y, spawn.pos.z)
      .setRotation(yawToQuat(spawn.yaw))
      .setLinearDamping(0.08)
      .setAngularDamping(2.8)
      .setCcdEnabled(true);

    const body = this.world.createRigidBody(bodyDesc);

    const hx = carDef.dimensions.width * 0.48;
    const hy = carDef.dimensions.height * 0.44;
    const hz = carDef.dimensions.length * 0.48;

    const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setDensity(PHYSICS_CONFIG.carDensity)
      .setRestitution(0.24)
      .setFriction(0.16);

    const collider = this.world.createCollider(colliderDesc, body);

    this.cars.set(config.id, {
      config: { ...config, connected: config.connected ?? true },
      body,
      collider,
      boost: this.isPractice ? 100 : 33,
      isBoosting: false,
      isGrounded: true,
      isSupersonic: false,
      steerAngle: 0,
      wheelSpin: 0,
      throttle: 0,
      wheelTravel: [0.45, 0.45, 0.45, 0.45],
      driftIntensity: 0,
      brakeHeat: 0,
      isBraking: false,
      isReversing: false,
      demolishedTimer: 0,
      respawnFade: 0,
      lastJumpPressed: false,
      doubleJumpWindow: 0,
      hasDoubleJump: false,
      flipTimer: 0,
      bumpCooldown: 0,
      goals: 0,
      shots: 0,
      saves: 0,
      ackSeq: 0,
      input: { seq: 0, throttle: 0, steer: 0, jump: false, boost: false, powerslide: false },
      spawnPos: spawn.pos,
      spawnYaw: spawn.yaw,
    });
  }

  public removeCar(id: string): void {
    const car = this.cars.get(id);
    if (!car) return;
    this.world.removeRigidBody(car.body);
    this.cars.delete(id);
  }

  public updateCarCustomization(id: string, customization: CarCustomization): void {
    const car = this.cars.get(id);
    if (car) {
      car.config.customization = customization;
    }
  }

  public setCarConnected(id: string, connected: boolean): void {
    const car = this.cars.get(id);
    if (car) {
      car.config.connected = connected;
    }
  }

  public setBotDebug(id: string, debug: BotDebugSnapshot | undefined): void {
    const car = this.cars.get(id);
    if (car) {
      car.botDebug = debug;
    }
  }

  public teleportCarToSafety(id: string, targetPos?: Vec3): void {
    const car = this.cars.get(id);
    if (!car || car.demolishedTimer > 0) return;
    const p = targetPos ?? car.spawnPos;
    const yaw = Math.atan2(p.x, p.z);
    car.body.setTranslation({ x: p.x, y: Math.max(0.9, p.y), z: p.z }, true);
    car.body.setRotation(yawToQuat(yaw), true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    car.respawnFade = 1.0;
    this.events.push({ type: 'teleport', pos: { x: p.x, y: p.y, z: p.z } });
  }

  private computeSpawn(team: Team, slotIndex: number, totalOnTeam: number): { pos: Vec3; yaw: number } {
    if (this.gameMode === 'ffa') {
      const angle =
        team === 'blue'
          ? FFA_ARENA_BOUNDS.GOAL_ANGLES.blue
          : team === 'orange'
            ? FFA_ARENA_BOUNDS.GOAL_ANGLES.orange
            : FFA_ARENA_BOUNDS.GOAL_ANGLES.emerald;
      const dist = 28;
      const px = Math.sin(angle) * dist;
      const pz = Math.cos(angle) * dist;
      return {
        pos: { x: px, y: 0.72, z: pz },
        yaw: Math.atan2(px, pz),
      };
    }

    const dir = team === 'blue' ? 1 : -1;
    const presets =
      totalOnTeam <= 1
        ? [{ x: 0, z: 28 }]
        : totalOnTeam === 2
          ? [
              { x: -13, z: 24 },
              { x: 13, z: 24 },
            ]
          : [
              { x: -13, z: 22 },
              { x: 13, z: 22 },
              { x: 0, z: 34 },
              { x: -18, z: 28 },
              { x: 18, z: 28 },
            ];
    const p = presets[slotIndex % presets.length];
    const px = p.x * (team === 'blue' ? 1 : -1);
    const pz = p.z * dir;
    const yaw = Math.atan2(px, pz);
    return {
      pos: { x: px, y: 0.72, z: pz },
      yaw,
    };
  }

  public setInput(id: string, input: PlayerInput): void {
    const car = this.cars.get(id);
    if (!car) return;
    car.input = input;
    if (typeof input.seq === 'number' && input.seq > car.ackSeq) {
      car.ackSeq = input.seq;
    }
    if (input.reset && car.demolishedTimer <= 0) {
      if (this.isPractice) {
        this.resetKickoff(true);
      } else {
        this.resetSingleCar(car);
      }
      car.input.reset = false;
    }
  }

  private resetSingleCar(car: InternalCar): void {
    const t = car.body.translation();
    car.body.setTranslation({ x: t.x, y: Math.max(t.y, 1.0), z: t.z }, true);
    car.body.setRotation(yawToQuat(car.spawnYaw), true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    car.respawnFade = 0.8;
  }

  public resetKickoff(keepScore = true): void {
    if (!keepScore) {
      this.blueScore = 0;
      this.orangeScore = 0;
      this.emeraldScore = 0;
      this.timeRemaining = this.matchDuration;
      this.isOvertime = false;
      this.lastGoalTeam = null;
      this.lastGoalScorer = null;
      for (const car of this.cars.values()) {
        car.goals = 0;
        car.shots = 0;
        car.saves = 0;
      }
    }

    this.ballBody.setTranslation({ x: 0, y: ARENA_BOUNDS.BALL_RADIUS + 0.08, z: 0 }, true);
    this.ballBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lastTouchPlayerId = null;
    this.lastTouchTeam = null;

    for (const pad of this.boostPads) {
      pad.active = true;
      pad.cooldown = 0;
    }

    const teams: Team[] = ['blue', 'orange', 'emerald'];
    for (const t of teams) {
      const teamCars = Array.from(this.cars.values()).filter((c) => c.config.team === t);
      teamCars.forEach((c, idx) => {
        const s = this.computeSpawn(t, idx, teamCars.length);
        c.spawnPos = s.pos;
        c.spawnYaw = s.yaw;
        c.body.setTranslation(s.pos, true);
        c.body.setRotation(yawToQuat(s.yaw), true);
        c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        c.boost = this.isPractice ? 100 : 33;
        c.isBoosting = false;
        c.doubleJumpWindow = 0;
        c.hasDoubleJump = false;
        c.demolishedTimer = 0;
        c.respawnFade = 0;
        c.brakeHeat = 0;
        c.driftIntensity = 0;
      });
    }

    if (this.isPractice) {
      this.phase = 'playing';
      this.countdownTimer = 0;
    } else {
      this.phase = 'countdown';
      this.countdownTimer = 3.0;
      this.lastCountdownInt = 4;
    }
  }

  public step(dt = 1 / 60): MatchEvent[] {
    this.events = [];
    this.tick++;

    if (this.shotCreditCooldown > 0) this.shotCreditCooldown -= dt;
    if (this.ballImpactCooldown > 0) this.ballImpactCooldown -= dt;

    if (this.phase === 'finished') {
      return this.events;
    }

    if (this.phase === 'countdown') {
      this.countdownTimer -= dt;
      const ceilVal = Math.max(0, Math.ceil(this.countdownTimer));
      if (ceilVal < this.lastCountdownInt && ceilVal >= 1) {
        this.lastCountdownInt = ceilVal;
        this.events.push({ type: 'countdown', countdown: ceilVal });
      }
      if (this.countdownTimer <= 0) {
        this.phase = 'playing';
        this.countdownTimer = 0;
        this.events.push({ type: 'kickoff' });
      }
      this.world.step();
      return this.events;
    }

    if (this.phase === 'goal_scored') {
      this.goalCelebrationTimer -= dt;
      this.stepVehicles(dt, false);
      this.world.step();
      if (this.goalCelebrationTimer <= 0) {
        if (this.isOvertime) {
          this.phase = 'finished';
          this.events.push({ type: 'match_end' });
        } else {
          this.resetKickoff(true);
        }
      }
      return this.events;
    }

    if (!this.isPractice) {
      if (!this.isOvertime) {
        this.timeRemaining = Math.max(0, this.timeRemaining - dt);
        if (this.timeRemaining <= 0) {
          const ballVel = this.ballBody.linvel();
          const ballPos = this.ballBody.translation();
          if (ballPos.y <= ARENA_BOUNDS.BALL_RADIUS + 0.45 || Math.abs(ballVel.y) < 1.2) {
            const isTie =
              this.gameMode === 'ffa'
                ? (() => {
                    const scores = [this.blueScore, this.orangeScore, this.emeraldScore];
                    const maxS = Math.max(...scores);
                    return scores.filter((s) => s === maxS).length > 1;
                  })()
                : this.blueScore === this.orangeScore;
            if (isTie) {
              this.isOvertime = true;
              this.resetKickoff(true);
            } else {
              this.phase = 'finished';
              this.events.push({ type: 'match_end' });
              return this.events;
            }
          }
        }
      }
    }

    for (const pad of this.boostPads) {
      if (!pad.active) {
        pad.cooldown -= dt;
        if (pad.cooldown <= 0) {
          pad.active = true;
          pad.cooldown = 0;
        }
      }
    }

    this.stepVehicles(dt, true);
    this.world.step();
    this.handleCarToCarCollisions(dt);
    this.handleBallCarInteractions(dt);
    this.checkGoalDetection();

    return this.events;
  }

  private stepVehicles(dt: number, allowControl: boolean): void {
    const cfg = PHYSICS_CONFIG;

    for (const car of this.cars.values()) {
      if (car.bumpCooldown > 0) car.bumpCooldown = Math.max(0, car.bumpCooldown - dt);
      if (car.respawnFade > 0) car.respawnFade = Math.max(0, car.respawnFade - dt * 1.35);

      // Handle Demolition Respawn Timer (3s)
      if (car.demolishedTimer > 0) {
        car.demolishedTimer = Math.max(0, car.demolishedTimer - dt);
        car.isBoosting = false;
        car.isSupersonic = false;
        car.driftIntensity = 0;
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        if (car.demolishedTimer <= 0) {
          // Respawn cleanly near own goal
          const jitterX = (Math.random() > 0.5 ? 1 : -1) * (10 + Math.random() * 5);
          const ownZ =
            this.gameMode === 'ffa'
              ? car.spawnPos.z
              : car.config.team === 'blue'
                ? ARENA_BOUNDS.HALF_LENGTH - 10
                : -(ARENA_BOUNDS.HALF_LENGTH - 10);
          const respawnPos =
            this.gameMode === 'ffa'
              ? car.spawnPos
              : { x: jitterX, y: 0.78, z: ownZ };
          car.body.setTranslation(respawnPos, true);
          car.body.setRotation(yawToQuat(car.spawnYaw), true);
          car.boost = Math.max(car.boost, 33);
          car.respawnFade = 1.0;
          this.events.push({ type: 'teleport', pos: respawnPos });
        }
        continue;
      }

      const body = car.body;
      const pos = body.translation();
      const quat = body.rotation();
      const vel = body.linvel();
      const carDef = CAR_MAP[car.config.customization.carId] ?? CAR_MAP.striker;
      const massScale = cfg.carDensity / 14.5; // Scale impulses cleanly with heavier chassis mass

      const forward = rotateVecByQuat({ x: 0, y: 0, z: -1 }, quat);
      const right = rotateVecByQuat({ x: 1, y: 0, z: 0 }, quat);
      const up = rotateVecByQuat({ x: 0, y: 1, z: 0 }, quat);

      // 4-Corner Raycast Suspension
      const hx = carDef.dimensions.width * 0.42;
      const hz = carDef.dimensions.length * 0.36;
      const rayOriginOffsets: Vec3[] = [
        { x: -hx, y: -0.1, z: -hz }, // FL
        { x: hx, y: -0.1, z: -hz },  // FR
        { x: -hx, y: -0.1, z: hz },  // RL
        { x: hx, y: -0.1, z: hz },   // RR
      ];

      const restLen = cfg.suspension.restLength;
      const rayDir = { x: -up.x, y: -up.y, z: -up.z };
      let wheelsOnGround = 0;
      const springK = cfg.suspension.spring * massScale;
      const damperC = cfg.suspension.damper * massScale;

      for (let wi = 0; wi < 4; wi++) {
        const localOff = rayOriginOffsets[wi];
        const worldOff = rotateVecByQuat(localOff, quat);
        const origin = {
          x: pos.x + worldOff.x,
          y: pos.y + worldOff.y,
          z: pos.z + worldOff.z,
        };
        const ray = new RAPIER.Ray(origin, rayDir);
        const hit = this.world.castRay(ray, restLen, true, undefined, undefined, car.collider, body);
        if (hit && hit.timeOfImpact <= restLen) {
          wheelsOnGround++;
          const compression = restLen - hit.timeOfImpact;
          car.wheelTravel[wi] = clamp(compression / cfg.suspension.travelMax, 0, 1);

          const angVel = body.angvel();
          const pointVel = {
            x: vel.x + (angVel.y * worldOff.z - angVel.z * worldOff.y),
            y: vel.y + (angVel.z * worldOff.x - angVel.x * worldOff.z),
            z: vel.z + (angVel.x * worldOff.y - angVel.y * worldOff.x),
          };
          const normalVel = dot(pointVel, up);
          const forceMag = Math.max(0, compression * springK - normalVel * damperC);
          body.applyImpulseAtPoint(
            { x: up.x * forceMag * dt, y: up.y * forceMag * dt, z: up.z * forceMag * dt },
            origin,
            true
          );
        } else {
          // Smooth wheel droop in the air
          car.wheelTravel[wi] = Math.max(0, car.wheelTravel[wi] - dt * 5.0);
        }
      }

      car.isGrounded = wheelsOnGround >= 2;

      if (car.isGrounded) {
        car.hasDoubleJump = true;
        car.doubleJumpWindow = 0;
        body.setAngularDamping(3.6);
      } else {
        body.setAngularDamping(1.35);
        if (car.doubleJumpWindow > 0) {
          car.doubleJumpWindow -= dt;
        }
      }

      if (car.flipTimer > 0) {
        car.flipTimer -= dt;
      }

      const input = allowControl
        ? car.input
        : { seq: 0, throttle: 0, steer: 0, jump: false, boost: false, powerslide: false };

      car.throttle = input.throttle;

      const forwardSpeed = dot(vel, forward);
      const rightSpeed = dot(vel, right);
      const totalSpeed = len(vel);
      car.isSupersonic = totalSpeed >= cfg.boost.supersonicSpeed;
      car.wheelSpin += forwardSpeed * dt * 2.2;

      // Speed-dependent steering reduction for high-speed stability
      const steerLimit =
        cfg.steering.maxSteerAngle /
        (1 + (totalSpeed / cfg.boost.maxBoostSpeed) * cfg.steering.speedReductionFactor);
      const targetSteer = -input.steer * steerLimit;
      car.steerAngle += (targetSteer - car.steerAngle) * Math.min(1, dt * 14);

      // Braking, reversing & brake rotor thermal glow
      car.isBraking = car.isGrounded && input.throttle < -0.1 && forwardSpeed > 2.0;
      car.isReversing = car.isGrounded && input.throttle < -0.1 && forwardSpeed <= 1.5;
      if (car.isBraking && totalSpeed > 10) {
        car.brakeHeat = Math.min(1, car.brakeHeat + dt * (0.85 + totalSpeed * 0.035));
      } else {
        car.brakeHeat = Math.max(0, car.brakeHeat - dt * 0.38);
      }

      // Rocket Boost force
      const wantsBoost = input.boost && car.boost > 0.5;
      car.isBoosting = wantsBoost;
      if (wantsBoost) {
        const boostRate = this.isPractice ? cfg.boost.practiceConsumptionPerSec : cfg.boost.consumptionPerSec;
        car.boost = Math.max(0, car.boost - boostRate * dt);
        if (forwardSpeed < cfg.boost.maxBoostSpeed) {
          const boostImp = cfg.boost.boostForce * massScale;
          body.applyImpulse(
            {
              x: forward.x * boostImp * dt,
              y: forward.y * boostImp * dt,
              z: forward.z * boostImp * dt,
            },
            true
          );
        }
      } else {
        const regenRate = this.isPractice ? 22 : cfg.boost.regenPerSec;
        car.boost = Math.min(100, car.boost + regenRate * dt);
      }

      // Aerodynamic drag at high speed (keeps top speeds snappy and weight-grounded)
      if (totalSpeed > cfg.aero.dragStartSpeed) {
        const excess = totalSpeed - cfg.aero.dragStartSpeed;
        const dragMag = excess * excess * cfg.aero.highSpeedDragCoeff * massScale;
        const invSpd = 1 / Math.max(0.001, totalSpeed);
        body.applyImpulse(
          {
            x: -vel.x * invSpd * dragMag * dt,
            y: -vel.y * invSpd * dragMag * dt,
            z: -vel.z * invSpd * dragMag * dt,
          },
          true
        );
      }

      if (car.isGrounded) {
        // Wall / Ceiling Driving Adhesion when moving at speed along angled/vertical surfaces
        if (up.y < 0.78 && totalSpeed > cfg.aero.wallMinSpeed) {
          const adhesion = cfg.aero.wallAdhesionForce * massScale;
          body.applyImpulse(
            {
              x: -up.x * adhesion * dt,
              y: -up.y * adhesion * dt,
              z: -up.z * adhesion * dt,
            },
            true
          );
        }

        // Torque Curve (strong low-end launch, realistic taper near max speed)
        const maxSpeed = car.isBoosting ? cfg.boost.maxBoostSpeed : cfg.engine.maxDriveSpeed;
        let driveAccel = 0;

        if (input.throttle > 0.05) {
          if (forwardSpeed < maxSpeed) {
            const speedNorm = clamp(Math.max(0, forwardSpeed) / (maxSpeed * 1.12), 0, 1);
            const torqueCurve = Math.max(cfg.engine.torqueFalloffMin, 1 - speedNorm * 0.78);
            driveAccel = input.throttle * cfg.engine.driveForce * torqueCurve;
          }
        } else if (input.throttle < -0.05) {
          if (forwardSpeed > 2.0) {
            driveAccel = input.throttle * cfg.engine.brakeForce;
          } else if (forwardSpeed > -cfg.engine.maxReverseSpeed) {
            driveAccel = input.throttle * cfg.engine.reverseForce;
          }
        } else {
          driveAccel = -forwardSpeed * cfg.engine.rollingDrag;
        }

        const driveImp = driveAccel * massScale;
        body.applyImpulse(
          {
            x: forward.x * driveImp * dt,
            y: forward.y * driveImp * dt,
            z: forward.z * driveImp * dt,
          },
          true
        );

        // Tire Lateral Grip Curve with Controlled Slip + Powerslide Drift
        const absRight = Math.abs(rightSpeed);
        const slipRatio = clamp((absRight - cfg.tires.slipThreshold) / 14, 0, 1);
        const baseGrip = input.powerslide ? cfg.tires.rearDriftGrip : cfg.tires.grip;
        const effectiveGrip = baseGrip * (1 - slipRatio * cfg.tires.slipFalloff);
        const lateralImpulse = -rightSpeed * effectiveGrip * massScale;

        // Apply lateral tire grip slightly below CoM for natural suspension body roll & lowered CoM stability
        const tireContactPos = {
          x: pos.x + up.x * cfg.comLowerOffset,
          y: pos.y + up.y * cfg.comLowerOffset,
          z: pos.z + up.z * cfg.comLowerOffset,
        };
        body.applyImpulseAtPoint(
          {
            x: right.x * lateralImpulse * dt,
            y: right.y * lateralImpulse * dt,
            z: right.z * lateralImpulse * dt,
          },
          tireContactPos,
          true
        );

        // Drift intensity telemetry for audio tire squeal + tire smoke
        const driftNorm = clamp(
          (absRight - 2.6) / 11 + (input.powerslide && totalSpeed > 8 ? 0.35 : 0),
          0,
          1
        );
        car.driftIntensity += (driftNorm - car.driftIntensity) * Math.min(1, dt * 12);

        // Steering Yaw Torque scaled by speed & steering speed-reduction curve
        const lowSpeedTurn = Math.min(1, Math.abs(forwardSpeed) / 7.0);
        const highSpeedTurnScale = 1 / (1 + (totalSpeed / 40) * cfg.steering.speedReductionFactor * 0.65);
        const revSign = forwardSpeed >= -0.8 ? 1 : -1;
        const driftMult = input.powerslide ? cfg.steering.driftYawMultiplier : 1.0;
        const turnTorque =
          -input.steer *
          lowSpeedTurn *
          highSpeedTurnScale *
          revSign *
          driftMult *
          cfg.steering.yawTorque *
          massScale;

        body.applyTorqueImpulse(
          {
            x: up.x * turnTorque * dt,
            y: up.y * turnTorque * dt,
            z: up.z * turnTorque * dt,
          },
          true
        );

        // Lowered CoM Upright Stabilization on Flat Ground (resists tipping in tight corners)
        if (up.y > 0.48) {
          const cx = -up.z;
          const cz = up.x;
          const rightingStrength = 520 * massScale;
          body.applyTorqueImpulse({ x: cx * rightingStrength * dt, y: 0, z: cz * rightingStrength * dt }, true);
        }
      } else {
        car.driftIntensity = Math.max(0, car.driftIntensity - dt * 6.0);

        // Air Control: Pitch (throttle), Yaw (steer), Air Roll (powerslide + steer)
        if (car.flipTimer <= 0) {
          const airTorqueScale = massScale;
          const airPitch = -input.throttle * 440 * airTorqueScale * dt;
          if (input.powerslide) {
            const airRoll = -input.steer * 540 * airTorqueScale * dt;
            body.applyTorqueImpulse(
              {
                x: right.x * airPitch + forward.x * airRoll,
                y: right.y * airPitch + forward.y * airRoll,
                z: right.z * airPitch + forward.z * airRoll,
              },
              true
            );
          } else {
            const airYaw = -input.steer * 440 * airTorqueScale * dt;
            body.applyTorqueImpulse(
              {
                x: right.x * airPitch + up.x * airYaw,
                y: right.y * airPitch + up.y * airYaw,
                z: right.z * airPitch + up.z * airYaw,
              },
              true
            );
          }
        }
      }

      // Jump, Double Jump, Dodge Flip & Roof-Landing Recovery Flip
      const jumpRisingEdge = input.jump && !car.lastJumpPressed;
      car.lastJumpPressed = input.jump;
      const isUpsideDownOnFloor = !car.isGrounded && pos.y < 1.38 && up.y < 0.15;

      if (jumpRisingEdge) {
        if (car.isGrounded) {
          const jumpImp = 1520 * massScale;
          body.applyImpulse(
            { x: up.x * jumpImp, y: up.y * jumpImp + 340 * massScale, z: up.z * jumpImp },
            true
          );
          car.doubleJumpWindow = 1.35;
          car.hasDoubleJump = true;
          car.isGrounded = false;
          this.events.push({ type: 'jump', pos: { x: pos.x, y: pos.y, z: pos.z } });
        } else if (isUpsideDownOnFloor) {
          // Player/Bot Roof-Landing Recovery Flip: hop & roll back wheels-down!
          car.flipTimer = 0.45;
          const rollDir = input.steer !== 0 ? Math.sign(input.steer) : 1;
          body.setLinvel({ x: vel.x * 0.7, y: 5.5, z: vel.z * 0.7 }, true);
          body.applyTorqueImpulse(
            {
              x: forward.x * rollDir * 1150 * massScale - right.x * 220 * massScale,
              y: forward.y * rollDir * 1150 * massScale - right.y * 220 * massScale,
              z: forward.z * rollDir * 1150 * massScale - right.z * 220 * massScale,
            },
            true
          );
          car.hasDoubleJump = false;
          this.events.push({ type: 'jump', pos: { x: pos.x, y: pos.y, z: pos.z } });
        } else if (car.hasDoubleJump && car.doubleJumpWindow > 0) {
          car.hasDoubleJump = false;
          car.doubleJumpWindow = 0;

          const hasDir = Math.abs(input.throttle) > 0.25 || Math.abs(input.steer) > 0.25;
          if (hasDir) {
            car.flipTimer = 0.42;
            const dodgeDir = {
              x: forward.x * input.throttle + right.x * input.steer,
              y: 0,
              z: forward.z * input.throttle + right.z * input.steer,
            };
            const dLen = Math.max(0.001, len(dodgeDir));
            dodgeDir.x /= dLen;
            dodgeDir.z /= dLen;

            const curV = body.linvel();
            body.setLinvel({ x: curV.x, y: Math.max(curV.y, 1.5), z: curV.z }, true);
            const dodgeImp = 1920 * massScale;
            body.applyImpulse({ x: dodgeDir.x * dodgeImp, y: 440 * massScale, z: dodgeDir.z * dodgeImp }, true);

            const flipTorque = {
              x: (-right.x * input.throttle + forward.x * -input.steer) * 900 * massScale,
              y: 0,
              z: (-right.z * input.throttle + forward.z * -input.steer) * 900 * massScale,
            };
            body.applyTorqueImpulse(flipTorque, true);
          } else {
            body.applyImpulse({ x: 0, y: 1440 * massScale, z: 0 }, true);
          }
          this.events.push({ type: 'jump', pos: { x: pos.x, y: pos.y, z: pos.z } });
        }
      }

      // Clamp maximum car speed
      const curV = body.linvel();
      const curSpd = len(curV);
      if (curSpd > cfg.aero.maxCarSpeed) {
        const s = cfg.aero.maxCarSpeed / curSpd;
        body.setLinvel({ x: curV.x * s, y: curV.y * s, z: curV.z * s }, true);
      }

      // Boost pad pickup
      for (const pad of this.boostPads) {
        if (!pad.active) continue;
        const dx = pos.x - pad.x;
        const dz = pos.z - pad.z;
        const radius = pad.isLarge ? 2.45 : 1.8;
        if (pos.y < 2.2 && dx * dx + dz * dz < radius * radius && car.boost < 99.5) {
          pad.active = false;
          pad.cooldown = pad.isLarge ? 10 : 4;
          car.boost = Math.min(100, car.boost + (pad.isLarge ? 100 : 18));
          this.events.push({ type: 'boost_pickup', pos: { x: pad.x, y: 0.5, z: pad.z } });
        }
      }
    }
  }

  private handleCarToCarCollisions(_dt: number): void {
    const carList = Array.from(this.cars.values()).filter((c) => c.demolishedTimer <= 0);
    const cfg = PHYSICS_CONFIG.collisions;
    const massScale = PHYSICS_CONFIG.carDensity / 14.5;

    for (let i = 0; i < carList.length; i++) {
      for (let j = i + 1; j < carList.length; j++) {
        const a = carList[i];
        const b = carList[j];
        if (a.bumpCooldown > 0 && b.bumpCooldown > 0) continue;

        const pa = a.body.translation();
        const pb = b.body.translation();
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dz = pb.z - pa.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < 3.45 && dist > 0.01) {
          const va = a.body.linvel();
          const vb = b.body.linvel();
          const relVel = { x: va.x - vb.x, y: va.y - vb.y, z: va.z - vb.z };
          const relSpeed = len(relVel);
          if (relSpeed < cfg.minBumpRelSpeed) continue;

          const nx = dx / dist;
          const ny = dy / dist;
          const nz = dz / dist;
          const closingSpeed = relVel.x * nx + relVel.y * ny + relVel.z * nz;
          if (closingSpeed < 3.5) continue;

          const midPos = {
            x: (pa.x + pb.x) * 0.5,
            y: (pa.y + pb.y) * 0.5 + 0.3,
            z: (pa.z + pb.z) * 0.5,
          };

          // Check Supersonic Demolition between opposing teams
          const opposing = a.config.team !== b.config.team;
          const spdA = len(va);
          const spdB = len(vb);
          const aIntoB = (va.x * nx + va.y * ny + va.z * nz);
          const bIntoA = -(vb.x * nx + vb.y * ny + vb.z * nz);

          if (opposing && spdA >= cfg.demoSpeedThreshold && aIntoB > 22) {
            this.demolishCar(b, a, pb);
            continue;
          }
          if (opposing && spdB >= cfg.demoSpeedThreshold && bIntoA > 22) {
            this.demolishCar(a, b, pa);
            continue;
          }

          // Standard car-to-car bump impulse + sparks
          const imp = Math.min(2400, closingSpeed * 42 + cfg.bumpImpulse * 0.35) * massScale;
          a.body.applyImpulse({ x: -nx * imp, y: 180 * massScale, z: -nz * imp }, true);
          b.body.applyImpulse({ x: nx * imp, y: 180 * massScale, z: nz * imp }, true);
          a.bumpCooldown = 0.22;
          b.bumpCooldown = 0.22;

          this.events.push({
            type: 'impact',
            intensity: clamp(closingSpeed / 30, 0.3, 1.0),
            pos: midPos,
          });
        }
      }
    }
  }

  private demolishCar(victim: InternalCar, attacker: InternalCar, hitPos: Vec3): void {
    victim.demolishedTimer = PHYSICS_CONFIG.collisions.demoRespawnSeconds;
    victim.isBoosting = false;
    victim.isSupersonic = false;
    victim.driftIntensity = 0;
    victim.body.setTranslation({ x: victim.spawnPos.x, y: -45, z: victim.spawnPos.z }, true);
    victim.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    victim.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

    this.events.push({
      type: 'demolition',
      victimId: victim.config.id,
      attackerId: attacker.config.id,
      team: attacker.config.team,
      intensity: 1.0,
      pos: { x: hitPos.x, y: Math.max(0.8, hitPos.y), z: hitPos.z },
    });
  }

  private handleBallCarInteractions(_dt: number): void {
    const ballPos = this.ballBody.translation();
    const ballVel = this.ballBody.linvel();
    const cfg = PHYSICS_CONFIG.ball;

    const bSpeed = len(ballVel);
    if (bSpeed > cfg.maxBallSpeed) {
      const s = cfg.maxBallSpeed / bSpeed;
      this.ballBody.setLinvel({ x: ballVel.x * s, y: ballVel.y * s, z: ballVel.z * s }, true);
    }

    for (const car of this.cars.values()) {
      if (car.demolishedTimer > 0) continue;
      const cPos = car.body.translation();
      const dx = ballPos.x - cPos.x;
      const dy = ballPos.y - cPos.y;
      const dz = ballPos.z - cPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < ARENA_BOUNDS.BALL_RADIUS + 2.38) {
        const cVel = car.body.linvel();
        const relVel = {
          x: cVel.x - ballVel.x,
          y: cVel.y - ballVel.y,
          z: cVel.z - ballVel.z,
        };
        const relSpeed = len(relVel);

        if (this.lastTouchPlayerId !== car.config.id || this.tick - this.lastTouchTime > 12) {
          this.lastTouchPlayerId = car.config.id;
          this.lastTouchTeam = car.config.team;
          this.lastTouchTime = this.tick;

          if (relSpeed > 5.5 && dist > 0.01) {
            const nx = dx / dist;
            const ny = clamp((dy - 0.12) / dist, 0.06, 0.44);
            const nz = dz / dist;

            // Blend contact normal with car's forward velocity for realistic shot direction
            const cSpd = Math.max(1, len(cVel));
            const vxDir = cVel.x / cSpd;
            const vzDir = cVel.z / cSpd;
            const dirX = nx * 0.65 + vxDir * 0.35;
            const dirZ = nz * 0.65 + vzDir * 0.35;

            const pop = Math.min(cfg.maxPopImpulse, relSpeed * cfg.transferImpulse);
            this.ballBody.applyImpulse({ x: dirX * pop, y: ny * pop * 0.58, z: dirZ * pop }, true);

            // Transfer realistic angular spin based on off-center strike vector (vel x normal)
            const spinX = (relVel.y * nz - relVel.z * ny) * cfg.spinTransferFactor;
            const spinY = (relVel.z * nx - relVel.x * nz) * cfg.spinTransferFactor;
            const spinZ = (relVel.x * ny - relVel.y * nx) * cfg.spinTransferFactor;
            this.ballBody.applyTorqueImpulse({ x: spinX, y: spinY, z: spinZ }, true);

            if (this.shotCreditCooldown <= 0) {
              const targetGoalZ =
                car.config.team === 'blue' ? -ARENA_BOUNDS.HALF_LENGTH : ARENA_BOUNDS.HALF_LENGTH;
              if (Math.sign(nz) === Math.sign(targetGoalZ) && Math.abs(ballPos.x) < 22) {
                car.shots++;
                this.shotCreditCooldown = 2.0;
              } else if (
                Math.abs(cPos.z) > ARENA_BOUNDS.HALF_LENGTH - 18 &&
                Math.sign(cPos.z) === (car.config.team === 'blue' ? 1 : -1)
              ) {
                car.saves++;
                this.shotCreditCooldown = 2.0;
              }
            }
          }

          if (this.ballImpactCooldown <= 0 && relSpeed > 4) {
            this.ballImpactCooldown = 0.12;
            this.events.push({
              type: 'impact',
              intensity: Math.min(1, relSpeed / 36),
              pos: { x: ballPos.x, y: ballPos.y, z: ballPos.z },
            });
          }
        }
      }
    }
  }

  private checkGoalDetection(): void {
    const ballPos = this.ballBody.translation();
    const ballVel = this.ballBody.linvel();

    if (this.gameMode === 'ffa') {
      const A = FFA_ARENA_BOUNDS.APOTHEM;
      const gw = FFA_ARENA_BOUNDS.GOAL_HALF_WIDTH;
      const gh = FFA_ARENA_BOUNDS.GOAL_HEIGHT;
      const r = FFA_ARENA_BOUNDS.BALL_RADIUS;
      if (ballPos.y >= gh) return;

      const goals: { team: Team; angle: number }[] = [
        { team: 'blue', angle: FFA_ARENA_BOUNDS.GOAL_ANGLES.blue },
        { team: 'orange', angle: FFA_ARENA_BOUNDS.GOAL_ANGLES.orange },
        { team: 'emerald', angle: FFA_ARENA_BOUNDS.GOAL_ANGLES.emerald },
      ];
      for (const g of goals) {
        const sinT = Math.sin(g.angle);
        const cosT = Math.cos(g.angle);
        const localZ = ballPos.x * sinT + ballPos.z * cosT;
        const localX = ballPos.x * cosT - ballPos.z * sinT;
        if (Math.abs(localX) < gw && localZ > A + r * 0.45) {
          this.triggerFfaGoal(g.team, ballVel);
          return;
        }
      }
      return;
    }

    const hl = ARENA_BOUNDS.HALF_LENGTH;
    const gw = ARENA_BOUNDS.GOAL_HALF_WIDTH;
    const r = ARENA_BOUNDS.BALL_RADIUS;

    if (Math.abs(ballPos.x) < gw && ballPos.y < ARENA_BOUNDS.GOAL_HEIGHT) {
      if (ballPos.z < -(hl + r * 0.45)) {
        this.triggerGoal('blue', ballVel);
      } else if (ballPos.z > hl + r * 0.45) {
        this.triggerGoal('orange', ballVel);
      }
    }
  }

  private triggerFfaGoal(defendingTeam: Team, ballVel: Vec3): void {
    if (this.phase !== 'playing') return;

    const allTeams: Team[] = ['blue', 'orange', 'emerald'];
    let scoringTeam: Team | null = null;
    let scorerName = 'Arena Rival';

    if (this.lastTouchTeam && this.lastTouchTeam !== defendingTeam) {
      scoringTeam = this.lastTouchTeam;
      if (scoringTeam === 'blue') this.blueScore++;
      else if (scoringTeam === 'orange') this.orangeScore++;
      else this.emeraldScore++;

      if (this.lastTouchPlayerId) {
        const scorer = this.cars.get(this.lastTouchPlayerId);
        if (scorer) {
          scorer.goals++;
          scorerName = scorer.config.name;
        }
      }
    } else {
      for (const t of allTeams) {
        if (t !== defendingTeam) {
          if (t === 'blue') this.blueScore++;
          else if (t === 'orange') this.orangeScore++;
          else this.emeraldScore++;
        }
      }
      const otherCars = Array.from(this.cars.values()).filter((c) => c.config.team !== defendingTeam);
      otherCars.forEach((c) => c.goals++);
      scoringTeam = allTeams.find((t) => t !== defendingTeam) ?? 'blue';
      scorerName = 'Own Goal (Rivals +1)';
    }

    const speedKmh = Math.round(len(ballVel) * 3.6);
    this.lastGoalTeam = scoringTeam;
    this.lastGoalScorer = scorerName;
    this.lastGoalSpeedKmh = speedKmh;
    this.phase = 'goal_scored';
    this.goalCelebrationTimer = 3.2;

    const ballPos = this.ballBody.translation();
    for (const car of this.cars.values()) {
      if (car.demolishedTimer > 0) continue;
      const cp = car.body.translation();
      const dx = cp.x - ballPos.x;
      const dy = cp.y - ballPos.y + 1.5;
      const dz = cp.z - ballPos.z;
      const d = Math.max(4, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const blast = Math.max(0, 1 - d / 55) * 4600;
      car.body.applyImpulse({ x: (dx / d) * blast, y: (dy / d) * blast * 0.65, z: (dz / d) * blast }, true);
    }

    this.events.push({
      type: 'goal',
      team: scoringTeam,
      scorer: scorerName,
      speedKmh,
      pos: { x: ballPos.x, y: ballPos.y, z: ballPos.z },
    });
  }

  private triggerGoal(scoringTeam: Team, ballVel: Vec3): void {
    if (this.phase !== 'playing') return;

    if (!this.isPractice) {
      if (scoringTeam === 'blue') this.blueScore++;
      else this.orangeScore++;
    }

    const speedKmh = Math.round(len(ballVel) * 3.6);
    let scorerName = scoringTeam === 'blue' ? 'Blue Team' : 'Orange Team';

    if (this.lastTouchPlayerId && this.lastTouchTeam === scoringTeam) {
      const scorer = this.cars.get(this.lastTouchPlayerId);
      if (scorer) {
        scorer.goals++;
        scorerName = scorer.config.name;
      }
    }

    this.lastGoalTeam = scoringTeam;
    this.lastGoalScorer = scorerName;
    this.lastGoalSpeedKmh = speedKmh;
    this.phase = 'goal_scored';
    this.goalCelebrationTimer = this.isPractice ? 2.0 : 3.2;

    const ballPos = this.ballBody.translation();
    for (const car of this.cars.values()) {
      if (car.demolishedTimer > 0) continue;
      const cp = car.body.translation();
      const dx = cp.x - ballPos.x;
      const dy = cp.y - ballPos.y + 1.5;
      const dz = cp.z - ballPos.z;
      const d = Math.max(4, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const blast = Math.max(0, 1 - d / 55) * 4600;
      car.body.applyImpulse({ x: (dx / d) * blast, y: (dy / d) * blast * 0.65, z: (dz / d) * blast }, true);
    }

    this.events.push({
      type: 'goal',
      team: scoringTeam,
      scorer: scorerName,
      speedKmh,
      pos: { x: ballPos.x, y: ballPos.y, z: ballPos.z },
    });
  }

  public getSnapshot(): MatchStateSnapshot {
    const cars: CarStateSnapshot[] = [];
    for (const car of this.cars.values()) {
      const p = car.body.translation();
      const q = car.body.rotation();
      const v = car.body.linvel();
      const av = car.body.angvel();
      cars.push({
        id: car.config.id,
        name: car.config.name,
        team: car.config.team,
        isBot: car.config.isBot,
        customization: car.config.customization,
        pos: { x: p.x, y: p.y, z: p.z },
        quat: { x: q.x, y: q.y, z: q.z, w: q.w },
        vel: { x: v.x, y: v.y, z: v.z },
        angVel: { x: av.x, y: av.y, z: av.z },
        boost: car.boost,
        isBoosting: car.isBoosting,
        isGrounded: car.isGrounded,
        isSupersonic: car.isSupersonic,
        steerAngle: car.steerAngle,
        wheelSpin: car.wheelSpin,
        throttle: car.throttle,
        wheelTravel: [...car.wheelTravel] as [number, number, number, number],
        driftIntensity: car.driftIntensity,
        brakeHeat: car.brakeHeat,
        isBraking: car.isBraking,
        isReversing: car.isReversing,
        demolishedTimer: car.demolishedTimer,
        respawnFade: car.respawnFade,
        botDebug: car.botDebug,
        goals: car.goals,
        shots: car.shots,
        saves: car.saves,
        connected: car.config.connected ?? true,
        ackSeq: car.ackSeq,
      });
    }

    const bp = this.ballBody.translation();
    const bq = this.ballBody.rotation();
    const bv = this.ballBody.linvel();
    const bav = this.ballBody.angvel();

    return {
      phase: this.phase,
      arenaId: this.arenaId,
      gameMode: this.gameMode,
      countdown: Math.max(0, Math.ceil(this.countdownTimer)),
      timeRemaining: Math.ceil(this.timeRemaining),
      isOvertime: this.isOvertime,
      blueScore: this.blueScore,
      orangeScore: this.orangeScore,
      emeraldScore: this.emeraldScore,
      lastGoalTeam: this.lastGoalTeam,
      lastGoalScorer: this.lastGoalScorer,
      lastGoalSpeedKmh: this.lastGoalSpeedKmh,
      cars,
      ball: {
        pos: { x: bp.x, y: bp.y, z: bp.z },
        quat: { x: bq.x, y: bq.y, z: bq.z, w: bq.w },
        vel: { x: bv.x, y: bv.y, z: bv.z },
        angVel: { x: bav.x, y: bav.y, z: bav.z },
        lastTouchPlayerId: this.lastTouchPlayerId,
        lastTouchTeam: this.lastTouchTeam,
      },
      boostPads: this.boostPads.map((p) => ({ ...p })),
      tick: this.tick,
      serverTime: Date.now(),
    };
  }

  public dispose(): void {
    this.world.free();
  }
}
