import { ARENA_BOUNDS } from './constants.ts';
import type {
  BallStateSnapshot,
  BoostPadState,
  BotCarState,
  BotDebugSnapshot,
  BotDifficulty,
  BotRole,
  CarStateSnapshot,
  PlayerInput,
  Quat,
  Vec3,
} from './types.ts';

/**
 * Centralized Bot AI Tuning Config.
 * All difficulty profiles, PD gains, stuck/upside-down recovery timers, and utility weights live here.
 */
export const BOT_TUNING_CONFIG = {
  evalHz: 30,
  roleEvalIntervalSec: 0.2,
  ballSimStepSec: 0.08,
  ballGravity: -19.6 * 0.68,
  ballDamping: 0.05,
  ballRestitution: 0.78,
  pdAirControl: {
    kp: 2.8,
    kd: 0.45,
  },
  recovery: {
    upsideDownSpeedThreshold: 3.0,
    upsideDownTriggerSec: 1.0,
    stuckDistThreshold: 2.0,
    stuckTriggerSec: 1.5,
    stuckReverseSec: 0.5,
    maxStuckTries: 3,
  },
  steering: {
    powerslideAngleRad: 1.05, // ~60 degrees
    reverseAngleRad: 2.25,
    separationRadius: 4.4,
    separationWeight: 6.5,
  },
  boost: {
    collectorThreshold: 25,
    defenseReserve: 20,
    minAlignDotForBoost: 0.88,
  },
  difficulties: {
    rookie: {
      reactionDelaySec: 0.35,
      predictionHorizonSec: 0.5,
      aimErrorDeg: 15.0,
      boostUsageRate: 0.5,
      allowAerials: false,
      allowFlips: false,
      allowWallPlay: false,
      allowFastKickoff: false,
      steerGain: 1.9,
      maxThrottle: 0.72,
    },
    pro: {
      reactionDelaySec: 0.2,
      predictionHorizonSec: 1.0,
      aimErrorDeg: 8.0,
      boostUsageRate: 0.7,
      allowAerials: false,
      allowFlips: true,
      allowWallPlay: false,
      allowFastKickoff: false,
      steerGain: 2.5,
      maxThrottle: 0.88,
    },
    all_star: {
      reactionDelaySec: 0.1,
      predictionHorizonSec: 1.5,
      aimErrorDeg: 4.0,
      boostUsageRate: 0.9,
      allowAerials: true,
      allowFlips: true,
      allowWallPlay: true,
      allowFastKickoff: true,
      steerGain: 3.1,
      maxThrottle: 1.0,
    },
    legend: {
      reactionDelaySec: 0.05,
      predictionHorizonSec: 2.0,
      aimErrorDeg: 1.5,
      boostUsageRate: 1.0,
      allowAerials: true,
      allowFlips: true,
      allowWallPlay: true,
      allowFastKickoff: true,
      steerGain: 3.7,
      maxThrottle: 1.0,
    },
  },
} as const;

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

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function len(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

interface PredictedBallSample {
  t: number;
  pos: Vec3;
  vel: Vec3;
}

function simulateBallTrajectory(ball: BallStateSnapshot, horizonSec: number): PredictedBallSample[] {
  const samples: PredictedBallSample[] = [];
  const dt = BOT_TUNING_CONFIG.ballSimStepSec;
  const steps = Math.max(4, Math.ceil(horizonSec / dt));
  const r = ARENA_BOUNDS.BALL_RADIUS;
  const maxX = ARENA_BOUNDS.HALF_WIDTH - r;
  const maxZ = ARENA_BOUNDS.HALF_LENGTH - r;
  const maxY = ARENA_BOUNDS.HEIGHT - r;
  const rest = BOT_TUNING_CONFIG.ballRestitution;
  const damp = Math.max(0, 1 - BOT_TUNING_CONFIG.ballDamping * dt);

  let px = ball.pos.x;
  let py = ball.pos.y;
  let pz = ball.pos.z;
  let vx = ball.vel.x;
  let vy = ball.vel.y;
  let vz = ball.vel.z;

  samples.push({ t: 0, pos: { x: px, y: py, z: pz }, vel: { x: vx, y: vy, z: vz } });

  for (let i = 1; i <= steps; i++) {
    vy += BOT_TUNING_CONFIG.ballGravity * dt;
    vx *= damp;
    vy *= damp;
    vz *= damp;

    px += vx * dt;
    py += vy * dt;
    pz += vz * dt;

    if (py < r) {
      py = r;
      if (vy < 0) vy = -vy * rest;
      vx *= 0.96;
      vz *= 0.96;
    } else if (py > maxY) {
      py = maxY;
      if (vy > 0) vy = -vy * rest;
    }

    if (px < -maxX) {
      px = -maxX;
      if (vx < 0) vx = -vx * rest;
    } else if (px > maxX) {
      px = maxX;
      if (vx > 0) vx = -vx * rest;
    }

    if (Math.abs(px) > ARENA_BOUNDS.GOAL_HALF_WIDTH || py > ARENA_BOUNDS.GOAL_HEIGHT) {
      if (pz < -maxZ) {
        pz = -maxZ;
        if (vz < 0) vz = -vz * rest;
      } else if (pz > maxZ) {
        pz = maxZ;
        if (vz > 0) vz = -vz * rest;
      }
    }

    samples.push({
      t: i * dt,
      pos: { x: px, y: py, z: pz },
      vel: { x: vx, y: vy, z: vz },
    });
  }

  return samples;
}

export interface BotStepResult {
  input: PlayerInput;
  debug: BotDebugSnapshot;
  teleportTarget?: Vec3;
}

export class BotAIController {
  private seqCounter = 0;

  // Cadence & caching (run full logic at 20-30 Hz, hold smoothed input in between)
  private evalAccum = 99;
  private roleAccum = 99;
  private cachedInput: PlayerInput = {
    seq: 0,
    throttle: 0,
    steer: 0,
    jump: false,
    boost: false,
    powerslide: false,
  };
  private cachedRole: BotRole = 'ATTACKER';
  private cachedDebug: BotDebugSnapshot = {
    state: 'GROUNDED',
    role: 'ATTACKER',
    targetPos: { x: 0, y: 0, z: 0 },
    predictedBallPath: [],
    stuckTries: 0,
  };

  // Reaction delay history buffer
  private delayedBallHistory: { time: number; ball: BallStateSnapshot }[] = [];
  private simTime = 0;

  // State machine & recovery tracking
  private state: BotCarState = 'GROUNDED';
  private upsideDownTimer = 0;
  private recoveryMode: 'none' | 'upside_down' | 'unstuck' = 'none';
  private recoveryTimer = 0;
  private stuckTimer = 0;
  private stuckTries = 0;
  private stuckAnchor: Vec3 | null = null;
  private stuckSteerSign = 1;
  private stuckFlipTriggered = false;
  private kickoffJitterDeg = (Math.random() - 0.5) * 4;
  private lastTickSeen = -1;

  public computeInput(
    bot: CarStateSnapshot,
    ball: BallStateSnapshot,
    boostPads: BoostPadState[],
    allCars: CarStateSnapshot[],
    difficulty: BotDifficulty,
    tick: number
  ): PlayerInput {
    const res = this.stepBot(bot, ball, boostPads, allCars, difficulty, tick, 1 / 60);
    return res.input;
  }

  public stepBot(
    bot: CarStateSnapshot,
    ball: BallStateSnapshot,
    boostPads: BoostPadState[],
    allCars: CarStateSnapshot[],
    difficulty: BotDifficulty,
    tick: number,
    dt = 1 / 60
  ): BotStepResult {
    // Handle kickoff / simulation reset cleanly
    if (tick < this.lastTickSeen) {
      this.resetTransientState();
    }
    this.lastTickSeen = tick;
    this.simTime += dt;
    this.evalAccum += dt;
    this.roleAccum += dt;

    const diffCfg = BOT_TUNING_CONFIG.difficulties[difficulty] ?? BOT_TUNING_CONFIG.difficulties.all_star;

    // Record ball sample for reaction delay modeling
    this.delayedBallHistory.push({
      time: this.simTime,
      ball: {
        ...ball,
        pos: { ...ball.pos },
        vel: { ...ball.vel },
        angVel: { ...ball.angVel },
      },
    });
    while (
      this.delayedBallHistory.length > 2 &&
      this.simTime - this.delayedBallHistory[1].time >= diffCfg.reactionDelaySec
    ) {
      this.delayedBallHistory.shift();
    }

    // Run full bot AI evaluation at 30 Hz (or when recovery needs rising edge jump)
    const evalInterval = 1 / BOT_TUNING_CONFIG.evalHz;
    if (this.evalAccum < evalInterval && this.recoveryMode === 'none') {
      // Smoothly hold previous output; don't re-trigger rising-edge jump continuously
      const held: PlayerInput = {
        ...this.cachedInput,
        seq: ++this.seqCounter,
        jump: false,
      };
      return { input: held, debug: this.cachedDebug };
    }
    const evalDt = Math.min(0.1, this.evalAccum);
    this.evalAccum = 0;

    // If demolished, wait cleanly
    if ((bot.demolishedTimer ?? 0) > 0) {
      this.stuckTimer = 0;
      this.upsideDownTimer = 0;
      this.recoveryMode = 'none';
      const idle: PlayerInput = {
        seq: ++this.seqCounter,
        throttle: 0,
        steer: 0,
        jump: false,
        boost: false,
        powerslide: false,
      };
      this.cachedInput = idle;
      return { input: idle, debug: this.cachedDebug };
    }

    const perceivedBall = this.delayedBallHistory[0]?.ball ?? ball;
    const forward = rotateVecByQuat({ x: 0, y: 0, z: -1 }, bot.quat);
    const right = rotateVecByQuat({ x: 1, y: 0, z: 0 }, bot.quat);
    const up = rotateVecByQuat({ x: 0, y: 1, z: 0 }, bot.quat);
    const speed = len(bot.vel);

    // 1. Update Car State Machine
    this.updateCarState(bot, up, speed, evalDt);

    // 2. Check Stuck Detection
    let teleportTarget: Vec3 | undefined;
    if (this.recoveryMode === 'none') {
      if (!this.stuckAnchor) {
        this.stuckAnchor = { ...bot.pos };
      }
      const moved = dist3(bot.pos, this.stuckAnchor);
      const tryingToMove = Math.abs(this.cachedInput.throttle) > 0.2 || this.cachedInput.boost;
      if (tryingToMove && moved < BOT_TUNING_CONFIG.recovery.stuckDistThreshold) {
        this.stuckTimer += evalDt;
      } else if (moved >= BOT_TUNING_CONFIG.recovery.stuckDistThreshold) {
        this.stuckAnchor = { ...bot.pos };
        this.stuckTimer = 0;
        this.stuckTries = 0;
      }

      if (this.stuckTimer >= BOT_TUNING_CONFIG.recovery.stuckTriggerSec) {
        this.stuckTries++;
        this.stuckTimer = 0;
        this.stuckAnchor = { ...bot.pos };

        if (this.stuckTries >= BOT_TUNING_CONFIG.recovery.maxStuckTries) {
          // Emergency teleport to nearest active boost pad or own goal
          teleportTarget = this.findSafeTeleportPoint(bot, boostPads);
          this.stuckTries = 0;
          this.recoveryMode = 'none';
        } else {
          this.recoveryMode = 'unstuck';
          this.recoveryTimer = BOT_TUNING_CONFIG.recovery.stuckReverseSec + 0.6;
          this.stuckSteerSign = Math.random() > 0.5 ? 1 : -1;
          this.stuckFlipTriggered = false;
        }
      }
    }

    // 3. Execute Recovery if Active (UPSIDE_DOWN flip or UNSTUCK maneuver)
    if (this.recoveryMode !== 'none') {
      this.state = 'RECOVERING';
      this.recoveryTimer -= evalDt;

      if (this.recoveryMode === 'upside_down') {
        const wantsJump = this.recoveryTimer > 0.72;
        const airCmd = this.computePDAirControl(bot, up, forward, right, { x: 0, y: 1, z: 0 });
        const out: PlayerInput = {
          seq: ++this.seqCounter,
          throttle: airCmd.throttle,
          steer: airCmd.steer !== 0 ? airCmd.steer : 1,
          jump: wantsJump,
          boost: false,
          powerslide: airCmd.powerslide,
        };
        if (this.recoveryTimer <= 0 || up.y > 0.75) {
          this.recoveryMode = 'none';
          this.upsideDownTimer = 0;
        }
        this.cachedInput = out;
        this.cachedDebug = {
          state: this.state,
          role: this.cachedRole,
          targetPos: { ...bot.pos },
          predictedBallPath: [],
          stuckTries: this.stuckTries,
        };
        return { input: out, debug: this.cachedDebug, teleportTarget };
      }

      if (this.recoveryMode === 'unstuck') {
        const reverseElapsed =
          BOT_TUNING_CONFIG.recovery.stuckReverseSec + 0.6 - this.recoveryTimer;
        let out: PlayerInput;
        if (reverseElapsed < BOT_TUNING_CONFIG.recovery.stuckReverseSec) {
          out = {
            seq: ++this.seqCounter,
            throttle: -0.95,
            steer: this.stuckSteerSign,
            jump: false,
            boost: false,
            powerslide: false,
          };
        } else if (!this.stuckFlipTriggered) {
          this.stuckFlipTriggered = true;
          out = {
            seq: ++this.seqCounter,
            throttle: 1.0,
            steer: 0,
            jump: true,
            boost: false,
            powerslide: false,
          };
        } else {
          out = {
            seq: ++this.seqCounter,
            throttle: 1.0,
            steer: 0,
            jump: reverseElapsed > BOT_TUNING_CONFIG.recovery.stuckReverseSec + 0.14 && reverseElapsed < BOT_TUNING_CONFIG.recovery.stuckReverseSec + 0.24,
            boost: bot.boost > 20,
            powerslide: false,
          };
        }

        if (this.recoveryTimer <= 0) {
          this.recoveryMode = 'none';
        }
        this.cachedInput = out;
        this.cachedDebug = {
          state: this.state,
          role: this.cachedRole,
          targetPos: { ...bot.pos },
          predictedBallPath: [],
          stuckTries: this.stuckTries,
        };
        return { input: out, debug: this.cachedDebug, teleportTarget };
      }
    }

    // 4. Simulate Ball Future Path (0.5s - 2.0s)
    const trajectory = simulateBallTrajectory(perceivedBall, diffCfg.predictionHorizonSec);
    const intercept = this.solveIntercept(bot, trajectory, diffCfg.maxThrottle);

    // 5. Utility Role Assignment every 0.2s (coordinate across teammates -> zero double-commit)
    const attackDirZ = bot.team === 'blue' ? -1 : 1;
    const ownGoalZ = bot.team === 'blue' ? ARENA_BOUNDS.HALF_LENGTH : -ARENA_BOUNDS.HALF_LENGTH;
    const enemyGoalZ = -ownGoalZ;

    if (this.roleAccum >= BOT_TUNING_CONFIG.roleEvalIntervalSec) {
      this.roleAccum = 0;
      this.cachedRole = this.assignTeamRole(bot, intercept.pos, allCars, boostPads, ownGoalZ);
    }

    const role = this.cachedRole;
    const isKickoff =
      Math.hypot(ball.pos.x, ball.pos.z) < 1.8 && len(ball.vel) < 1.2 && ball.pos.y < 2.6;

    // 6. Compute Target Point from Role & Tactics
    let targetPos: Vec3 = { ...intercept.pos };
    let boostWants = false;
    let jumpWants = false;

    const botDistToOwnGoal = Math.abs(bot.pos.z - ownGoalZ);
    const ballDistToOwnGoal = Math.abs(intercept.pos.z - ownGoalZ);
    const wrongSide = botDistToOwnGoal > ballDistToOwnGoal + 3.5;

    if (isKickoff && role === 'ATTACKER') {
      // Randomized Fast Kickoff!
      targetPos = {
        x: ball.pos.x + (diffCfg.allowFastKickoff ? Math.sin(this.kickoffJitterDeg * 0.017) * 1.4 : 0),
        y: ball.pos.y,
        z: ball.pos.z,
      };
      boostWants = bot.boost > 4;
    } else if (role === 'BOOST_COLLECTOR') {
      const pad = this.findNearestBoostPad(bot.pos, boostPads, true);
      if (pad) {
        targetPos = { x: pad.x, y: 0.7, z: pad.z };
      }
    } else if (role === 'DEFENDER') {
      // Shadow between ball and own goal; clear sideways if ball enters danger zone
      if (ballDistToOwnGoal < 26) {
        const clearSide = intercept.pos.x >= 0 ? 1 : -1;
        targetPos = {
          x: clamp(intercept.pos.x - clearSide * 2.2, -ARENA_BOUNDS.HALF_WIDTH + 4, ARENA_BOUNDS.HALF_WIDTH - 4),
          y: intercept.pos.y,
          z: intercept.pos.z - attackDirZ * 2.4,
        };
      } else {
        const goalAnchorZ = ownGoalZ - attackDirZ * clamp(ballDistToOwnGoal * 0.28, 7, 19);
        const shadeX = clamp(intercept.pos.x * 0.35, -9, 9);
        targetPos = { x: shadeX, y: 0.7, z: goalAnchorZ };
      }
    } else if (role === 'SUPPORT') {
      // Hold midfield behind attacker ready for pass/rebound, grab small pad if close
      const supportZ = clamp(
        intercept.pos.z - attackDirZ * 18,
        -ARENA_BOUNDS.HALF_LENGTH + 9,
        ARENA_BOUNDS.HALF_LENGTH - 9
      );
      const supportX = clamp(
        intercept.pos.x * 0.45 + (intercept.pos.x > 0 ? -9 : 9),
        -ARENA_BOUNDS.HALF_WIDTH + 6,
        ARENA_BOUNDS.HALF_WIDTH - 6
      );
      targetPos = { x: supportX, y: 0.7, z: supportZ };

      if (bot.boost < 55) {
        const nearPad = this.findNearestBoostPad(bot.pos, boostPads, false);
        if (nearPad && Math.hypot(nearPad.x - supportX, nearPad.z - supportZ) < 12) {
          targetPos = { x: nearPad.x, y: 0.7, z: nearPad.z };
        }
      }
    } else {
      // ATTACKER
      if (wrongSide) {
        // Never hit toward own goal! Swing outside or clear sideways
        if (ballDistToOwnGoal < 24 && Math.hypot(bot.pos.x - intercept.pos.x, bot.pos.z - intercept.pos.z) < 9) {
          const wallSide = intercept.pos.x >= 0 ? 1 : -1;
          targetPos = {
            x: clamp(intercept.pos.x - wallSide * 2.8, -ARENA_BOUNDS.HALF_WIDTH + 4, ARENA_BOUNDS.HALF_WIDTH - 4),
            y: intercept.pos.y,
            z: intercept.pos.z,
          };
        } else {
          const swingSide = bot.pos.x >= intercept.pos.x ? 10 : -10;
          targetPos = {
            x: clamp(intercept.pos.x + swingSide, -ARENA_BOUNDS.HALF_WIDTH + 5, ARENA_BOUNDS.HALF_WIDTH - 5),
            y: 0.7,
            z: clamp(intercept.pos.z - attackDirZ * 14, -ARENA_BOUNDS.HALF_LENGTH + 6, ARENA_BOUNDS.HALF_LENGTH - 6),
          };
        }
      } else {
        // Aim for open corner of enemy goal away from enemy keeper!
        const aimX = this.pickOpenGoalCornerX(allCars, bot.team, enemyGoalZ);
        const toGoalX = aimX - intercept.pos.x;
        const toGoalZ = enemyGoalZ - intercept.pos.z;
        const gLen = Math.max(1, Math.hypot(toGoalX, toGoalZ));
        const dirX = toGoalX / gLen;
        const dirZ = toGoalZ / gLen;

        const distBotIntercept = Math.hypot(intercept.pos.x - bot.pos.x, intercept.pos.z - bot.pos.z);
        const standOff = clamp(distBotIntercept * 0.28, 0, 4.4);
        targetPos = {
          x: clamp(intercept.pos.x - dirX * standOff, -ARENA_BOUNDS.HALF_WIDTH + 2.5, ARENA_BOUNDS.HALF_WIDTH - 2.5),
          y: intercept.pos.y,
          z: clamp(intercept.pos.z - dirZ * standOff, -ARENA_BOUNDS.HALF_LENGTH + 2.0, ARENA_BOUNDS.HALF_LENGTH - 2.0),
        };
      }
    }

    // Wall Play Pursuit (All-Star & Legend): drive up curved wall ramps if ball is riding wall
    if (
      diffCfg.allowWallPlay &&
      role === 'ATTACKER' &&
      !wrongSide &&
      Math.abs(intercept.pos.x) > ARENA_BOUNDS.HALF_WIDTH - 6.5 &&
      intercept.pos.y > 2.4 &&
      intercept.pos.y < 14
    ) {
      targetPos.x = Math.sign(intercept.pos.x) * (ARENA_BOUNDS.HALF_WIDTH - 1.2);
      targetPos.y = intercept.pos.y;
    }

    // 7. Separation Steering Force against other cars (prevents pile-ups)
    let sepX = 0;
    let sepZ = 0;
    const sepR = BOT_TUNING_CONFIG.steering.separationRadius;
    for (const other of allCars) {
      if (other.id === bot.id || (other.demolishedTimer ?? 0) > 0) continue;
      const dx = bot.pos.x - other.pos.x;
      const dz = bot.pos.z - other.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05 && d < sepR) {
        const push = ((sepR - d) / sepR) * BOT_TUNING_CONFIG.steering.separationWeight;
        sepX += (dx / d) * push;
        sepZ += (dz / d) * push;
      }
    }
    const steeredTargetX = targetPos.x + sepX;
    const steeredTargetZ = targetPos.z + sepZ;

    // 8. Compute Steering & Throttle relative to Car Basis
    const toTarget: Vec3 = {
      x: steeredTargetX - bot.pos.x,
      y: targetPos.y - bot.pos.y,
      z: steeredTargetZ - bot.pos.z,
    };
    const dist2D = Math.max(0.01, Math.hypot(toTarget.x, toTarget.z));
    const desiredDir2D = { x: toTarget.x / dist2D, z: toTarget.z / dist2D };

    const fwdLen = Math.max(0.01, Math.hypot(forward.x, forward.z));
    const fx = forward.x / fwdLen;
    const fz = forward.z / fwdLen;

    const dotAngle = clamp(fx * desiredDir2D.x + fz * desiredDir2D.z, -1, 1);
    const crossY = fx * desiredDir2D.z - fz * desiredDir2D.x;
    let angleDiff = Math.atan2(crossY, dotAngle);

    // Apply smooth deterministic difficulty aim error
    if (diffCfg.aimErrorDeg > 0) {
      const errRad = (diffCfg.aimErrorDeg * Math.PI) / 180;
      angleDiff += Math.sin(this.simTime * 1.9 + bot.pos.z * 0.15) * errRad;
    }

    let throttle: number = diffCfg.maxThrottle;
    let steer = clamp(angleDiff * diffCfg.steerGain, -1, 1);
    let powerslide = false;

    if (this.state === 'AIRBORNE') {
      // PD Air Control: either aim nose toward aerial ball OR level out wheels-down!
      const doingAerial =
        diffCfg.allowAerials &&
        role === 'ATTACKER' &&
        intercept.pos.y > 3.6 &&
        intercept.pos.y < 14 &&
        dist2D < 22 &&
        bot.boost > 14 &&
        Math.abs(angleDiff) < 0.55;

      if (doingAerial) {
        const desiredFwdLen = Math.max(0.1, len(toTarget));
        const desiredFwd = {
          x: toTarget.x / desiredFwdLen,
          y: clamp((toTarget.y + 0.6) / desiredFwdLen, -0.25, 0.78),
          z: toTarget.z / desiredFwdLen,
        };
        const pitchErr = dot(cross(forward, desiredFwd), right);
        const yawErr = dot(cross(forward, desiredFwd), up);
        throttle = clamp(-pitchErr * 2.2, -1, 1);
        steer = clamp(yawErr * 2.4, -1, 1);
        boostWants = true;
      } else {
        const targetNormal = this.getNearestSurfaceNormal(bot);
        const pd = this.computePDAirControl(bot, up, forward, right, targetNormal);
        throttle = pd.throttle;
        steer = pd.steer;
        powerslide = pd.powerslide;
      }

      // Dodge Flip on contact or kickoff speed-flip
      if (diffCfg.allowFlips && bot.pos.y > 0.65 && bot.pos.y < 2.9 && Math.abs(angleDiff) < 0.35) {
        const distBall = Math.hypot(ball.pos.x - bot.pos.x, ball.pos.z - bot.pos.z);
        if (distBall < 6.0 && tick % 3 === 0) {
          jumpWants = true;
          throttle = 1.0;
          steer = 0;
        } else if (isKickoff && diffCfg.allowFastKickoff && distBall < 10.5 && tick % 4 === 0) {
          jumpWants = true;
          throttle = 1.0;
        } else if (dist2D > 30 && speed > 18 && bot.boost < 20 && tick % 16 === 0) {
          jumpWants = true;
          throttle = 1.0;
        }
      }
    } else {
      // Ground / Wall driving
      // Powerslide when turn angle > ~60 deg (1.05 rad)
      if (Math.abs(angleDiff) > BOT_TUNING_CONFIG.steering.powerslideAngleRad && speed > 9) {
        powerslide = true;
      }
      // Scale throttle smoothly when turning sharply to prevent overshooting
      if (Math.abs(angleDiff) > 0.75) {
        throttle *= clamp(1 - (Math.abs(angleDiff) - 0.75) * 0.42, 0.42, 1.0);
      }
      // Reverse only if target is directly behind at close range and moving slow
      if (dist2D < 9.5 && Math.abs(angleDiff) > BOT_TUNING_CONFIG.steering.reverseAngleRad && speed < 10) {
        throttle = -0.85;
        steer = -steer;
        powerslide = false;
      }

      // Smart Boost usage: boost when far & aligned, don't boost in sharp turns, reserve boost for defense
      const aligned = dotAngle >= BOT_TUNING_CONFIG.boost.minAlignDotForBoost;
      const reserveLimit =
        role === 'DEFENDER' ? 5 : BOT_TUNING_CONFIG.boost.defenseReserve * (1 - diffCfg.boostUsageRate * 0.5);

      if (
        !boostWants &&
        aligned &&
        !powerslide &&
        dist2D > 11 &&
        bot.boost > reserveLimit &&
        ((tick % 20) / 20) < diffCfg.boostUsageRate
      ) {
        boostWants = true;
      }

      // Jump / Aerial launch / Kickoff flip
      const distBall = Math.hypot(intercept.pos.x - bot.pos.x, intercept.pos.z - bot.pos.z);
      if (this.state === 'GROUNDED' && aligned && role === 'ATTACKER') {
        if (isKickoff && diffCfg.allowFastKickoff && distBall < 11.5 && speed > 16) {
          jumpWants = true;
        } else if (diffCfg.allowAerials && distBall < 18 && intercept.pos.y > 4.2 && intercept.pos.y < 13 && bot.boost > 32) {
          jumpWants = true;
          boostWants = true;
        } else if (diffCfg.allowFlips && distBall < 8.5 && intercept.pos.y > 2.3 && intercept.pos.y < 7.2) {
          jumpWants = true;
        }
      }

      // Keep moving actively even in defense positioning
      if (role === 'DEFENDER' && dist2D < 2.2 && speed < 2.5) {
        throttle = 0.28;
      }
    }

    const out: PlayerInput = {
      seq: ++this.seqCounter,
      throttle: clamp(throttle, -1, 1),
      steer: clamp(steer, -1, 1),
      jump: jumpWants,
      boost: boostWants && bot.boost > 1,
      powerslide,
    };

    const debugPath: Vec3[] = [];
    const stride = Math.max(1, Math.floor(trajectory.length / 10));
    for (let i = 0; i < trajectory.length; i += stride) {
      debugPath.push(trajectory[i].pos);
    }

    this.cachedInput = out;
    this.cachedDebug = {
      state: this.state,
      role,
      targetPos,
      predictedBallPath: debugPath,
      stuckTries: this.stuckTries,
    };

    return { input: out, debug: this.cachedDebug, teleportTarget };
  }

  private resetTransientState(): void {
    this.upsideDownTimer = 0;
    this.recoveryMode = 'none';
    this.recoveryTimer = 0;
    this.stuckTimer = 0;
    this.stuckTries = 0;
    this.stuckAnchor = null;
    this.delayedBallHistory = [];
    this.kickoffJitterDeg = (Math.random() - 0.5) * 4;
  }

  private updateCarState(bot: CarStateSnapshot, up: Vec3, speed: number, dt: number): void {
    const upDot = up.y;

    if (upDot < 0.22 && bot.pos.y < 1.45) {
      this.state = 'UPSIDE_DOWN';
      if (speed < BOT_TUNING_CONFIG.recovery.upsideDownSpeedThreshold) {
        this.upsideDownTimer += dt;
        if (this.upsideDownTimer >= BOT_TUNING_CONFIG.recovery.upsideDownTriggerSec) {
          this.recoveryMode = 'upside_down';
          this.recoveryTimer = 0.85;
          this.state = 'RECOVERING';
        }
      } else {
        this.upsideDownTimer = Math.max(0, this.upsideDownTimer - dt * 2);
      }
      return;
    }

    this.upsideDownTimer = 0;

    if (bot.isGrounded) {
      if (upDot < -0.35 && bot.pos.y > ARENA_BOUNDS.HEIGHT - 3.5) {
        this.state = 'ON_CEILING';
      } else if (upDot < 0.78) {
        this.state = 'ON_WALL';
      } else {
        this.state = 'GROUNDED';
      }
    } else {
      if (upDot < -0.45 && bot.pos.y > ARENA_BOUNDS.HEIGHT - 3.2) {
        this.state = 'ON_CEILING';
      } else {
        this.state = 'AIRBORNE';
      }
    }
  }

  private computePDAirControl(
    bot: CarStateSnapshot,
    up: Vec3,
    forward: Vec3,
    right: Vec3,
    targetNormal: Vec3
  ): { throttle: number; steer: number; powerslide: boolean } {
    const { kp, kd } = BOT_TUNING_CONFIG.pdAirControl;
    const errAxis = cross(up, targetNormal);
    const pitchErr = dot(errAxis, right);
    const rollErr = dot(errAxis, forward);

    const angPitch = dot(bot.angVel, right);
    const angRoll = dot(bot.angVel, forward);

    // Remember: in physicsEngine, input.throttle < 0 pitches nose UP (-right), input.powerslide + steer rolls!
    const pitchCmd = clamp(-(pitchErr * kp - angPitch * kd), -1, 1);
    const rollCmd = clamp(-(rollErr * kp - angRoll * kd), -1, 1);

    const useRoll = Math.abs(rollCmd) > 0.14;
    return {
      throttle: pitchCmd,
      steer: useRoll ? rollCmd : 0,
      powerslide: useRoll,
    };
  }

  private getNearestSurfaceNormal(bot: CarStateSnapshot): Vec3 {
    if (bot.pos.y < 3.2) return { x: 0, y: 1, z: 0 };
    if (bot.pos.x < -(ARENA_BOUNDS.HALF_WIDTH - 4.5) && bot.pos.y > 3.5) return { x: 1, y: 0.25, z: 0 };
    if (bot.pos.x > ARENA_BOUNDS.HALF_WIDTH - 4.5 && bot.pos.y > 3.5) return { x: -1, y: 0.25, z: 0 };
    return { x: 0, y: 1, z: 0 };
  }

  private solveIntercept(
    bot: CarStateSnapshot,
    trajectory: PredictedBallSample[],
    maxThrottle: number
  ): PredictedBallSample {
    const expectedSpeed = Math.max(16, (len(bot.vel) + 26 * maxThrottle) * 0.65 + (bot.boost > 20 ? 7 : 0));
    for (let i = 1; i < trajectory.length; i++) {
      const sample = trajectory[i];
      const d = dist3(bot.pos, sample.pos);
      const tNeeded = d / expectedSpeed;
      if (tNeeded <= sample.t + 0.14) {
        return sample;
      }
    }
    return trajectory[trajectory.length - 1];
  }

  private assignTeamRole(
    bot: CarStateSnapshot,
    ballPos: Vec3,
    allCars: CarStateSnapshot[],
    boostPads: BoostPadState[],
    ownGoalZ: number
  ): BotRole {
    const teammates = allCars.filter(
      (c) => c.team === bot.team && (c.demolishedTimer ?? 0) <= 0
    );
    const ballDistOwn = Math.abs(ballPos.z - ownGoalZ);

    if (teammates.length <= 1) {
      if (
        bot.boost < BOT_TUNING_CONFIG.boost.collectorThreshold &&
        ballDistOwn > 36 &&
        Math.hypot(ballPos.x - bot.pos.x, ballPos.z - bot.pos.z) > 22
      ) {
        const pad = this.findNearestBoostPad(bot.pos, boostPads, true);
        if (pad && Math.hypot(pad.x - bot.pos.x, pad.z - bot.pos.z) < 20) {
          return 'BOOST_COLLECTOR';
        }
      }
      return 'ATTACKER';
    }

    // Score each teammate by effective arrival time to ball (wrong-side cars penalized)
    const scored = teammates.map((c) => {
      const d = Math.hypot(ballPos.x - c.pos.x, ballPos.z - c.pos.z);
      const cDistOwn = Math.abs(c.pos.z - ownGoalZ);
      const wrongSidePenalty = cDistOwn > ballDistOwn + 3.5 ? 12 : 0;
      const fwd = rotateVecByQuat({ x: 0, y: 0, z: -1 }, c.quat);
      const toBallX = ballPos.x - c.pos.x;
      const toBallZ = ballPos.z - c.pos.z;
      const toLen = Math.max(1, Math.hypot(toBallX, toBallZ));
      const align = (fwd.x * toBallX + fwd.z * toBallZ) / toLen;
      const turnPenalty = (1 - align) * 4.5;
      return { id: c.id, score: d + wrongSidePenalty + turnPenalty };
    });

    scored.sort((a, b) => a.score - b.score);
    const rank = scored.findIndex((s) => s.id === bot.id);

    if (rank === 0) return 'ATTACKER';

    if (
      bot.boost < BOT_TUNING_CONFIG.boost.collectorThreshold &&
      ballDistOwn > 30
    ) {
      const pad = this.findNearestBoostPad(bot.pos, boostPads, true);
      if (pad && Math.hypot(pad.x - bot.pos.x, pad.z - bot.pos.z) < 22) {
        return 'BOOST_COLLECTOR';
      }
    }

    if (rank === teammates.length - 1) return 'DEFENDER';
    return 'SUPPORT';
  }

  private pickOpenGoalCornerX(
    allCars: CarStateSnapshot[],
    ownTeam: CarStateSnapshot['team'],
    enemyGoalZ: number
  ): number {
    let closestKeeperX: number | null = null;
    let minKeeperDist = Infinity;
    for (const c of allCars) {
      if (c.team === ownTeam || (c.demolishedTimer ?? 0) > 0) continue;
      const dGoal = Math.hypot(c.pos.x, c.pos.z - enemyGoalZ);
      if (dGoal < 22 && dGoal < minKeeperDist) {
        minKeeperDist = dGoal;
        closestKeeperX = c.pos.x;
      }
    }
    if (closestKeeperX === null) return 0;
    return closestKeeperX >= 0 ? -5.5 : 5.5;
  }

  private findNearestBoostPad(
    pos: Vec3,
    boostPads: BoostPadState[],
    preferLarge: boolean
  ): BoostPadState | null {
    let best: BoostPadState | null = null;
    let bestScore = Infinity;
    for (const pad of boostPads) {
      if (!pad.active) continue;
      const d = Math.hypot(pad.x - pos.x, pad.z - pos.z);
      const bonus = preferLarge && pad.isLarge ? 11 : 0;
      const score = d - bonus;
      if (score < bestScore) {
        bestScore = score;
        best = pad;
      }
    }
    return best;
  }

  private findSafeTeleportPoint(bot: CarStateSnapshot, boostPads: BoostPadState[]): Vec3 {
    const ownGoalZ =
      bot.team === 'blue' ? ARENA_BOUNDS.HALF_LENGTH - 12 : -(ARENA_BOUNDS.HALF_LENGTH - 12);
    const activePad = this.findNearestBoostPad(bot.pos, boostPads, true);
    if (activePad) {
      return { x: activePad.x, y: 0.85, z: activePad.z };
    }
    return { x: (Math.random() > 0.5 ? 8 : -8), y: 0.85, z: ownGoalZ };
  }
}
