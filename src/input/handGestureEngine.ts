import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { GAME_ACTION_LABELS } from '../shared/constants.ts';
import type {
  ActiveGestureName,
  GameAction,
  GestureName,
  HandControlSettings,
  HandTrackingTelemetry,
  PlayerInput,
} from '../shared/types.ts';
import { classifyHandLandmarks, detectSidewaysSwipe, isHandRaisedOpen } from './gestureClassifier.ts';

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export interface HandInputOutput {
  throttle: number;
  steer: number;
  jump: boolean;
  boost: boolean;
  powerslide: boolean;
  toggleBallCam: boolean;
  togglePause: boolean;
  hasHand: boolean;
}

export class HandGestureEngine {
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private previewCanvases = new Set<HTMLCanvasElement>();

  private settings: HandControlSettings;
  private rafId = 0;
  private running = false;
  private lastProcessTime = 0;
  private lastVideoTime = -1;
  private fpsCounter = 0;
  private fpsLastCheck = performance.now();
  private currentFps = 0;

  // Temporal smoothing & hysteresis buffers
  private gestureWindow: GestureName[] = [];
  private smoothedSteer = 0;
  private smoothedTiltRad = 0;
  private latestRawTiltRad = 0;
  private latestRawPalmX = 0.5;
  private latestRawPalmY = 0.55;
  private lastHandSeenTime = 0;

  // Motion history for sideways swipe powerslide
  private palmHistory: { x: number; t: number }[] = [];
  private powerslideActiveUntil = 0;

  // Edge-triggered gesture cooldowns & double-extension state
  private lastTwoFingerState = false;
  private lastTwoFingerExtendTime = 0;
  private jumpPulseUntil = 0;
  private lastJumpTriggerTime = 0;
  private lastPointTriggerTime = 0;
  private bothHandsHoldStart = 0;
  private lastPauseTriggerTime = 0;
  private pendingBallCamToggle = false;
  private pendingPauseToggle = false;

  private telemetry: HandTrackingTelemetry = {
    permissionState: 'prompt',
    trackingActive: false,
    modelLoading: false,
    modelError: null,
    handsDetected: 0,
    detectedGesture: 'NEUTRAL',
    steeringGesture: 'NEUTRAL',
    confidence: 0,
    currentActionLabel: 'IDLE',
    fps: 0,
    calibrated: false,
  };

  private output: HandInputOutput = {
    throttle: 0,
    steer: 0,
    jump: false,
    boost: false,
    powerslide: false,
    toggleBallCam: false,
    togglePause: false,
    hasHand: false,
  };

  public onTelemetry?: (t: HandTrackingTelemetry) => void;
  public onCalibrateUpdate?: (offset: { tiltRad: number; palmX: number; palmY: number }) => void;

  constructor(initialSettings: HandControlSettings) {
    this.settings = initialSettings;
  }

  public updateSettings(next: HandControlSettings): void {
    const wasEnabled = this.settings.enabled;
    this.settings = next;
    if (next.enabled && !wasEnabled) {
      void this.start();
    } else if (!next.enabled && wasEnabled) {
      this.stop();
    }
  }

  public attachPreviewCanvas(canvas: HTMLCanvasElement | null): void {
    if (canvas) {
      this.previewCanvases.add(canvas);
    }
  }

  public detachPreviewCanvas(canvas: HTMLCanvasElement | null): void {
    if (canvas) {
      this.previewCanvases.delete(canvas);
    }
  }

  public getTelemetry(): HandTrackingTelemetry {
    return { ...this.telemetry };
  }

  public pollGameInput(): {
    input: Partial<PlayerInput>;
    toggleBallCam: boolean;
    togglePause: boolean;
    hasActiveInput: boolean;
  } {
    const now = performance.now();
    const toggleBallCam = this.pendingBallCamToggle;
    const togglePause = this.pendingPauseToggle;
    this.pendingBallCamToggle = false;
    this.pendingPauseToggle = false;

    const handFresh = now - this.lastHandSeenTime < 280;
    if (!this.settings.enabled || !this.telemetry.trackingActive) {
      return {
        input: {},
        toggleBallCam: false,
        togglePause: false,
        hasActiveInput: false,
      };
    }

    if (!handFresh) {
      // Smoothly decay controls when hand leaves camera frame
      this.smoothedSteer *= 0.82;
      if (Math.abs(this.smoothedSteer) < 0.04) this.smoothedSteer = 0;
      return {
        input: {
          throttle: 0,
          steer: this.smoothedSteer,
          jump: false,
          boost: false,
          powerslide: false,
        },
        toggleBallCam,
        togglePause,
        hasActiveInput: false,
      };
    }

    const jumpActive = now < this.jumpPulseUntil;
    return {
      input: {
        throttle: this.output.throttle,
        steer: this.output.steer,
        jump: jumpActive,
        boost: this.output.boost,
        powerslide: this.output.powerslide || now < this.powerslideActiveUntil,
      },
      toggleBallCam,
      togglePause,
      hasActiveInput: true,
    };
  }

  public calibrateNeutral(): boolean {
    if (this.telemetry.handsDetected === 0) return false;
    const nextOffset = {
      tiltRad: this.latestRawTiltRad,
      palmX: this.latestRawPalmX,
      palmY: this.latestRawPalmY,
    };
    this.settings = {
      ...this.settings,
      calibrationOffset: nextOffset,
    };
    this.telemetry.calibrated = true;
    this.onCalibrateUpdate?.(nextOffset);
    this.emitTelemetry();
    return true;
  }

  private async ensureModel(): Promise<HandLandmarker> {
    if (this.landmarker) return this.landmarker;
    this.telemetry.modelLoading = true;
    this.telemetry.modelError = null;
    this.emitTelemetry();

    try {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      try {
        this.landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/mediapipe/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        });
      } catch {
        this.landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/mediapipe/hand_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        });
      }
      this.telemetry.modelLoading = false;
      this.emitTelemetry();
      return this.landmarker;
    } catch (err) {
      this.telemetry.modelLoading = false;
      this.telemetry.modelError = err instanceof Error ? err.message : 'Failed to load hand tracking model.';
      this.emitTelemetry();
      throw err;
    }
  }

  public async start(): Promise<void> {
    if (this.running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.telemetry.permissionState = 'unsupported';
      this.telemetry.modelError = 'Webcam API is not supported in this browser.';
      this.emitTelemetry();
      return;
    }

    this.running = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 480 },
          height: { ideal: 360 },
          facingMode: 'user',
        },
        audio: false,
      });

      if (!this.running) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      this.stream = stream;
      this.telemetry.permissionState = 'granted';

      const video = document.createElement('video');
      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      this.videoEl = video;

      await this.ensureModel();

      if (!this.running) return;
      this.telemetry.trackingActive = true;
      this.emitTelemetry();
      this.loop();
    } catch (err) {
      this.running = false;
      const msg = err instanceof Error ? err.message : String(err);
      if (/Permission|NotAllowed|denied/i.test(msg)) {
        this.telemetry.permissionState = 'denied';
        this.telemetry.modelError =
          'Webcam permission denied. Allow camera access in your browser to use Hand Control.';
      } else {
        this.telemetry.modelError = msg || 'Unable to start webcam.';
      }
      this.stop();
    }
  }

  public stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      clearTimeout(this.rafId);
      this.rafId = 0;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }
    this.gestureWindow = [];
    this.palmHistory = [];
    this.smoothedSteer = 0;
    this.output = {
      throttle: 0,
      steer: 0,
      jump: false,
      boost: false,
      powerslide: false,
      toggleBallCam: false,
      togglePause: false,
      hasHand: false,
    };
    this.telemetry.trackingActive = false;
    this.telemetry.handsDetected = 0;
    this.telemetry.detectedGesture = 'NEUTRAL';
    this.telemetry.steeringGesture = 'NEUTRAL';
    this.telemetry.confidence = 0;
    this.telemetry.currentActionLabel = 'DISABLED';
    this.telemetry.fps = 0;
    this.emitTelemetry();
  }

  private loop = (): void => {
    if (!this.running) return;
    const now = performance.now();

    // Process webcam at ~28 FPS to keep 3D rendering locked at 60 FPS
    if (now - this.lastProcessTime >= 34 && this.videoEl && this.landmarker && this.videoEl.readyState >= 2) {
      this.lastProcessTime = now;
      if (this.videoEl.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.videoEl.currentTime;
        const result = this.landmarker.detectForVideo(this.videoEl, now);
        this.processLandmarks(result.landmarks || [], result.handedness || [], now);
        this.drawPreviews(result.landmarks || []);

        this.fpsCounter++;
        if (now - this.fpsLastCheck >= 1000) {
          this.currentFps = this.fpsCounter;
          this.fpsCounter = 0;
          this.fpsLastCheck = now;
          this.telemetry.fps = this.currentFps;
        }
      }
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private processLandmarks(
    landmarksList: NormalizedLandmark[][],
    handednessList: { categoryName: string; score: number }[][],
    now: number
  ): void {
    const handsDetected = landmarksList.length;
    this.telemetry.handsDetected = handsDetected;

    if (handsDetected === 0) {
      this.output.hasHand = false;
      this.output.throttle = 0;
      this.output.boost = false;
      this.output.powerslide = false;
      this.lastTwoFingerState = false;
      this.bothHandsHoldStart = 0;
      this.telemetry.detectedGesture = 'NEUTRAL';
      this.telemetry.steeringGesture = 'NEUTRAL';
      this.telemetry.confidence = 0;
      this.telemetry.currentActionLabel = 'NO HAND DETECTED';
      this.emitTelemetry();
      return;
    }

    // Check BOTH_HANDS_RAISED (Pause Game)
    if (handsDetected >= 2 && this.settings.enabledGestures.BOTH_HANDS_RAISED) {
      const h0Raised = isHandRaisedOpen(landmarksList[0]);
      const h1Raised = isHandRaisedOpen(landmarksList[1]);
      if (h0Raised && h1Raised) {
        if (this.bothHandsHoldStart === 0) this.bothHandsHoldStart = now;
        if (now - this.bothHandsHoldStart > 260 && now - this.lastPauseTriggerTime > 1600) {
          this.lastPauseTriggerTime = now;
          this.bothHandsHoldStart = 0;
          this.triggerActionFromGesture('BOTH_HANDS_RAISED', now);
          this.telemetry.detectedGesture = 'BOTH_HANDS_RAISED';
          this.telemetry.confidence = 96;
          this.telemetry.currentActionLabel =
            GAME_ACTION_LABELS[this.settings.gestureActionMap.BOTH_HANDS_RAISED].toUpperCase();
          this.emitTelemetry();
          return;
        }
      } else {
        this.bothHandsHoldStart = 0;
      }
    } else {
      this.bothHandsHoldStart = 0;
    }

    // Select primary hand matching player preference
    let chosenIdx = 0;
    if (handsDetected > 1) {
      const preferred = this.settings.handedness === 'right' ? 'Left' : 'Right';
      const matchIdx = handednessList.findIndex((h) => h[0]?.categoryName === preferred);
      if (matchIdx >= 0) chosenIdx = matchIdx;
    }

    const lm = landmarksList[chosenIdx];
    const handScore = handednessList[chosenIdx]?.[0]?.score ?? 0.85;
    const confidencePct = Math.round(handScore * 100);

    if (handScore < this.settings.confidenceThreshold * 0.75) {
      return;
    }

    this.lastHandSeenTime = now;
    this.output.hasHand = true;

    const rawAnalysis = classifyHandLandmarks(lm, {
      sensitivity: this.settings.sensitivity,
      calibrationTiltRad: this.settings.calibrationOffset.tiltRad,
    });

    this.latestRawTiltRad = rawAnalysis.rawTiltRad;
    this.latestRawPalmX = rawAnalysis.mirroredPalmX;
    this.latestRawPalmY = rawAnalysis.palmY;

    // Smooth raw tilt via EMA before deadzone/range mapping
    this.smoothedTiltRad = this.smoothedTiltRad * 0.62 + rawAnalysis.rawTiltRad * 0.38;
    const calibratedTilt = this.smoothedTiltRad - this.settings.calibrationOffset.tiltRad;
    const sens = Math.max(0.5, this.settings.sensitivity);
    const deadzone = 0.14 / sens;
    const maxTilt = 0.56 / sens;

    let steerVal = 0;
    let steeringGesture: 'NEUTRAL' | 'TILT_LEFT' | 'TILT_RIGHT' = 'NEUTRAL';
    let tiltActionLabel = '';
    if (calibratedTilt < -deadzone && this.settings.enabledGestures.TILT_LEFT) {
      const norm = Math.min(1, (-calibratedTilt - deadzone) / Math.max(0.08, maxTilt - deadzone));
      steeringGesture = 'TILT_LEFT';
      const mapped = this.settings.gestureActionMap.TILT_LEFT;
      if (mapped === 'steerLeft') steerVal = -norm;
      else if (mapped === 'steerRight') steerVal = norm;
      else tiltActionLabel = this.executeAction(mapped, now);
    } else if (calibratedTilt > deadzone && this.settings.enabledGestures.TILT_RIGHT) {
      const norm = Math.min(1, (calibratedTilt - deadzone) / Math.max(0.08, maxTilt - deadzone));
      steeringGesture = 'TILT_RIGHT';
      const mapped = this.settings.gestureActionMap.TILT_RIGHT;
      if (mapped === 'steerRight') steerVal = norm;
      else if (mapped === 'steerLeft') steerVal = -norm;
      else tiltActionLabel = this.executeAction(mapped, now);
    }
    this.smoothedSteer = this.smoothedSteer * 0.55 + steerVal * 0.45;
    this.output.steer = Math.abs(this.smoothedSteer) < 0.05 ? 0 : this.smoothedSteer;

    // Sideways swipe velocity check for Powerslide
    this.palmHistory.push({ x: rawAnalysis.mirroredPalmX, t: now });
    while (this.palmHistory.length > 0 && now - this.palmHistory[0].t > 170) {
      this.palmHistory.shift();
    }
    let isSidewaysSwipe = false;
    if (
      rawAnalysis.extendedFingerCount >= 3 &&
      this.settings.enabledGestures.SIDEWAYS_SWIPE &&
      detectSidewaysSwipe(this.palmHistory, rawAnalysis.palmSize, this.settings.sensitivity, now)
    ) {
      isSidewaysSwipe = true;
      this.powerslideActiveUntil = now + 380;
    }

    // Temporal mode filter (4-frame smoothing) to prevent noisy flickering
    this.gestureWindow.push(rawAnalysis.rawPose);
    if (this.gestureWindow.length > 4) this.gestureWindow.shift();
    const stablePose = this.getModalGesture(this.gestureWindow);

    // Reset continuous actions before applying current mapped actions
    this.output.throttle = 0;
    this.output.boost = false;
    this.output.powerslide = isSidewaysSwipe || now < this.powerslideActiveUntil;

    let displayGesture: GestureName = stablePose;
    const activeActions: string[] = [];

    if (isSidewaysSwipe) {
      displayGesture = 'SIDEWAYS_SWIPE';
      const lbl = this.applyContinuousOrEdgeAction('SIDEWAYS_SWIPE', now);
      if (lbl) activeActions.push(lbl);
    }

    // Two Fingers -> Jump & Two Quick Extensions -> Double Jump
    const twoFingersNow = stablePose === 'TWO_FINGERS';
    if (twoFingersNow && !this.lastTwoFingerState) {
      const sinceLast = now - this.lastTwoFingerExtendTime;
      if (sinceLast > 120 && sinceLast < 850 && this.settings.enabledGestures.DOUBLE_EXTENSION) {
        displayGesture = 'DOUBLE_EXTENSION';
        this.triggerActionFromGesture('DOUBLE_EXTENSION', now);
        activeActions.push(
          GAME_ACTION_LABELS[this.settings.gestureActionMap.DOUBLE_EXTENSION].toUpperCase()
        );
        this.lastTwoFingerExtendTime = 0;
      } else if (now - this.lastJumpTriggerTime > 220 && this.settings.enabledGestures.TWO_FINGERS) {
        this.lastJumpTriggerTime = now;
        this.lastTwoFingerExtendTime = now;
        this.triggerActionFromGesture('TWO_FINGERS', now);
        activeActions.push(GAME_ACTION_LABELS[this.settings.gestureActionMap.TWO_FINGERS].toUpperCase());
      }
    }
    this.lastTwoFingerState = twoFingersNow;

    if (stablePose === 'POINTING_FINGER' && this.settings.enabledGestures.POINTING_FINGER) {
      if (now - this.lastPointTriggerTime > 950) {
        this.lastPointTriggerTime = now;
        this.triggerActionFromGesture('POINTING_FINGER', now);
      }
      activeActions.push(
        GAME_ACTION_LABELS[this.settings.gestureActionMap.POINTING_FINGER].toUpperCase()
      );
    } else if (stablePose !== 'NEUTRAL' && stablePose !== 'TWO_FINGERS') {
      if (this.settings.enabledGestures[stablePose]) {
        const lbl = this.applyContinuousOrEdgeAction(stablePose, now);
        if (lbl) activeActions.push(lbl);
      }
    }

    if (steeringGesture !== 'NEUTRAL') {
      const steerLabel =
        tiltActionLabel || GAME_ACTION_LABELS[this.settings.gestureActionMap[steeringGesture]].toUpperCase();
      if (steerLabel && steerLabel !== 'DISABLED') activeActions.push(steerLabel);
      if (displayGesture === 'NEUTRAL') displayGesture = steeringGesture;
    }

    this.telemetry.detectedGesture = displayGesture;
    this.telemetry.steeringGesture = steeringGesture;
    this.telemetry.confidence = confidencePct;
    this.telemetry.currentActionLabel =
      activeActions.length > 0 ? activeActions.join(' + ') : 'NEUTRAL COAST';
    this.emitTelemetry();
  }

  private applyContinuousOrEdgeAction(gesture: ActiveGestureName, now: number): string {
    const action = this.settings.gestureActionMap[gesture];
    return this.executeAction(action, now);
  }

  private triggerActionFromGesture(gesture: ActiveGestureName, now: number): void {
    const action = this.settings.gestureActionMap[gesture];
    this.executeAction(action, now);
  }

  private executeAction(action: GameAction, now: number): string {
    switch (action) {
      case 'accelerate':
        this.output.throttle = 1;
        return 'ACCELERATING';
      case 'reverse':
        this.output.throttle = -1;
        return 'BRAKE / REVERSE';
      case 'boost':
        this.output.throttle = Math.max(this.output.throttle, 0.85);
        this.output.boost = true;
        return 'ROCKET BOOST';
      case 'powerslide':
        this.output.powerslide = true;
        return 'POWERSLIDE';
      case 'jump':
      case 'doubleJump':
        this.jumpPulseUntil = now + 95;
        return action === 'doubleJump' ? 'DOUBLE JUMP' : 'JUMP';
      case 'ballCam':
        this.pendingBallCamToggle = true;
        return 'BALL CAM';
      case 'pause':
        this.pendingPauseToggle = true;
        return 'PAUSE';
      case 'steerLeft':
        this.output.steer = -1;
        return 'STEER LEFT';
      case 'steerRight':
        this.output.steer = 1;
        return 'STEER RIGHT';
      default:
        return '';
    }
  }

  private getModalGesture(window: GestureName[]): GestureName {
    const counts = new Map<GestureName, number>();
    let best: GestureName = 'NEUTRAL';
    let bestCount = 0;
    for (const g of window) {
      const c = (counts.get(g) ?? 0) + 1;
      counts.set(g, c);
      if (c > bestCount) {
        bestCount = c;
        best = g;
      }
    }
    return best;
  }

  private drawPreviews(landmarksList: NormalizedLandmark[][]): void {
    if (this.previewCanvases.size === 0 || !this.videoEl) return;
    const video = this.videoEl;

    for (const canvas of this.previewCanvases) {
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      const w = canvas.width;
      const h = canvas.height;
      ctx.save();
      ctx.clearRect(0, 0, w, h);

      // Mirror horizontally for natural driving feel
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();

      // Draw mirrored landmarks & connections
      for (let hi = 0; hi < landmarksList.length; hi++) {
        const lm = landmarksList[hi];
        ctx.strokeStyle = hi === 0 ? '#06B6D4' : '#F97316';
        ctx.lineWidth = 2;
        for (const [a, b] of HAND_CONNECTIONS) {
          const pa = lm[a];
          const pb = lm[b];
          ctx.beginPath();
          ctx.moveTo((1 - pa.x) * w, pa.y * h);
          ctx.lineTo((1 - pb.x) * w, pb.y * h);
          ctx.stroke();
        }
        ctx.fillStyle = '#F8FAFC';
        for (let i = 0; i < lm.length; i++) {
          const p = lm[i];
          ctx.beginPath();
          ctx.arc((1 - p.x) * w, p.y * h, i % 4 === 0 && i > 0 ? 3.5 : 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private emitTelemetry(): void {
    this.onTelemetry?.({ ...this.telemetry });
  }
}
