import type { GestureName } from '../shared/types.ts';

export interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
}

export function dist2D(a: LandmarkPoint, b: LandmarkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export interface AnalyzedHandPose {
  rawPose: GestureName;
  steeringGesture: 'NEUTRAL' | 'TILT_LEFT' | 'TILT_RIGHT';
  steerNorm: number;
  rawTiltRad: number;
  mirroredPalmX: number;
  palmY: number;
  palmSize: number;
  extendedFingerCount: number;
}

/**
 * Pure, scale-invariant 21-landmark hand pose & tilt classifier.
 * Landmarks follow MediaPipe Hands indexing (0 = wrist, 4 = thumb tip,
 * 8 = index tip, 12 = middle tip, 16 = ring tip, 20 = pinky tip).
 */
export function classifyHandLandmarks(
  lm: LandmarkPoint[],
  opts: {
    sensitivity: number;
    calibrationTiltRad: number;
  }
): AnalyzedHandPose {
  const wrist = lm[0];
  const middleMcp = lm[9];
  const palmSize = Math.max(0.04, dist2D(wrist, middleMcp));

  // Mirrored X coordinate (moving physical hand right increases mirrored X)
  const mirroredPalmX = 1 - middleMcp.x;
  const palmY = middleMcp.y;

  // Hand roll/tilt angle relative to vertical upward in mirrored coordinates
  const dx = (1 - middleMcp.x) - (1 - wrist.x);
  const dy = middleMcp.y - wrist.y;
  const rawTiltRad = Math.atan2(dx, -dy);

  const calibratedTilt = rawTiltRad - opts.calibrationTiltRad;
  const sens = Math.max(0.5, opts.sensitivity);
  const deadzone = 0.14 / sens;
  const maxTilt = 0.56 / sens;

  let steeringGesture: 'NEUTRAL' | 'TILT_LEFT' | 'TILT_RIGHT' = 'NEUTRAL';
  let steerNorm = 0;
  if (calibratedTilt < -deadzone) {
    steeringGesture = 'TILT_LEFT';
    steerNorm = Math.min(1, (-calibratedTilt - deadzone) / Math.max(0.08, maxTilt - deadzone));
  } else if (calibratedTilt > deadzone) {
    steeringGesture = 'TILT_RIGHT';
    steerNorm = Math.min(1, (calibratedTilt - deadzone) / Math.max(0.08, maxTilt - deadzone));
  }

  // Scale-invariant finger extension checks
  const indexExt = dist2D(lm[8], wrist) > dist2D(lm[6], wrist) * 1.12 && dist2D(lm[8], lm[5]) > palmSize * 0.48;
  const middleExt = dist2D(lm[12], wrist) > dist2D(lm[10], wrist) * 1.12 && dist2D(lm[12], lm[9]) > palmSize * 0.48;
  const ringExt = dist2D(lm[16], wrist) > dist2D(lm[14], wrist) * 1.12 && dist2D(lm[16], lm[13]) > palmSize * 0.44;
  const pinkyExt = dist2D(lm[20], wrist) > dist2D(lm[18], wrist) * 1.12 && dist2D(lm[20], lm[17]) > palmSize * 0.4;
  const thumbExt = dist2D(lm[4], lm[17]) > dist2D(lm[3], lm[17]) * 1.08 && dist2D(lm[4], lm[5]) > palmSize * 0.45;
  const thumbUpward = lm[4].y < lm[2].y - palmSize * 0.34;

  const extendedFingerCount =
    (indexExt ? 1 : 0) + (middleExt ? 1 : 0) + (ringExt ? 1 : 0) + (pinkyExt ? 1 : 0);

  let rawPose: GestureName = 'NEUTRAL';
  if (thumbExt && thumbUpward && extendedFingerCount === 0) {
    rawPose = 'THUMBS_UP';
  } else if (indexExt && !middleExt && !ringExt && !pinkyExt) {
    rawPose = 'POINTING_FINGER';
  } else if (indexExt && middleExt && !ringExt && !pinkyExt) {
    rawPose = 'TWO_FINGERS';
  } else if (extendedFingerCount >= 4) {
    rawPose = 'OPEN_PALM';
  } else if (extendedFingerCount === 0 && !thumbExt) {
    rawPose = 'CLOSED_FIST';
  }

  return {
    rawPose,
    steeringGesture,
    steerNorm,
    rawTiltRad,
    mirroredPalmX,
    palmY,
    palmSize,
    extendedFingerCount,
  };
}

export function isHandRaisedOpen(lm: LandmarkPoint[]): boolean {
  const wrist = lm[0];
  const middleMcp = lm[9];
  if (wrist.y > 0.62 || middleMcp.y > 0.48) return false;
  const indexExt = dist2D(lm[8], wrist) > dist2D(lm[6], wrist) * 1.1;
  const middleExt = dist2D(lm[12], wrist) > dist2D(lm[10], wrist) * 1.1;
  const ringExt = dist2D(lm[16], wrist) > dist2D(lm[14], wrist) * 1.1;
  return indexExt && middleExt && ringExt;
}

export function detectSidewaysSwipe(
  history: { x: number; t: number }[],
  palmSize: number,
  sensitivity: number,
  nowMs: number
): boolean {
  if (history.length < 3) return false;
  const oldest = history[0];
  const latest = history[history.length - 1];
  const dtSec = Math.max(0.05, (nowMs - oldest.t) / 1000);
  const vxNormalized = Math.abs(latest.x - oldest.x) / (Math.max(0.04, palmSize) * dtSec);
  return vxNormalized > 2.8 / Math.max(0.5, sensitivity);
}
