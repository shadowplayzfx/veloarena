export type CarId =
  | 'striker'
  | 'nomad'
  | 'hyperion'
  | 'bullitt'
  | 'rallyx'
  | 'apex_s'
  | 'formula'
  | 'juggernaut'
  | 'volt'
  | 'drift';

export type ArenaId = 'neon_stadium' | 'sunset_arena' | 'cyber_arena';

export type BotDifficulty = 'rookie' | 'pro' | 'all_star' | 'legend';

export type PaintFinish = 'metallic' | 'matte' | 'pearl';

export type WheelStyleId = 'sport_5' | 'mesh_10' | 'turbofan' | 'rally_blade';

export type BotCarState =
  | 'GROUNDED'
  | 'AIRBORNE'
  | 'ON_WALL'
  | 'ON_CEILING'
  | 'UPSIDE_DOWN'
  | 'RECOVERING';

export type BotRole = 'ATTACKER' | 'SUPPORT' | 'DEFENDER' | 'BOOST_COLLECTOR';

export type GameMode = 'menu' | 'bots' | 'multiplayer' | 'practice';

export type PartyGameMode = 'ffa' | 'team_2v1' | 'coop_3v3';

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';

export type BoostTrailId =
  | 'plasma_cyan'
  | 'solar_flare'
  | 'hyper_violet'
  | 'emerald_ion'
  | 'crimson_afterburner';

export type AccessoryId = 'none' | 'crown' | 'halo' | 'shark_fin' | 'rocket_pod' | 'antennas';

export type AvatarId =
  | 'striker_helm'
  | 'cyber_visor'
  | 'apex_crown'
  | 'turbo_flame'
  | 'volt_core'
  | 'tactical_shield';

export type Team = 'blue' | 'orange' | 'emerald';

export interface CarCustomization {
  carId: CarId;
  primaryColor: string;
  secondaryColor: string;
  paintFinish?: PaintFinish;
  wheelStyle?: WheelStyleId;
  teamAccent?: string;
  boostTrail: BoostTrailId;
  accessory?: AccessoryId;
}

export interface CarDefinition {
  id: CarId;
  name: string;
  archetype: string;
  tagline: string;
  defaultPrimary: string;
  defaultSecondary: string;
  defaultTrail: BoostTrailId;
  dimensions: {
    width: number;
    height: number;
    length: number;
    wheelRadius: number;
    wheelWidth: number;
  };
  stats: {
    topSpeed: number;
    acceleration: number;
    handling: number;
    aerial: number;
  };
}

export interface KeyBindings {
  accelerate: string;
  reverse: string;
  steerLeft: string;
  steerRight: string;
  jump: string;
  boost: string;
  powerslide: string;
  reset: string;
  camera: string;
  pause: string;
}

export type CameraViewMode = 'first_person' | 'chase';

export interface CameraSettings {
  viewMode: CameraViewMode;
  distance: number;
  height: number;
  fov: number;
  ballCamDefault: boolean;
  cameraShake: boolean;
}

export type GestureName =
  | 'NEUTRAL'
  | 'OPEN_PALM'
  | 'CLOSED_FIST'
  | 'TILT_LEFT'
  | 'TILT_RIGHT'
  | 'TWO_FINGERS'
  | 'DOUBLE_EXTENSION'
  | 'THUMBS_UP'
  | 'SIDEWAYS_SWIPE'
  | 'POINTING_FINGER'
  | 'BOTH_HANDS_RAISED';

export type ActiveGestureName = Exclude<GestureName, 'NEUTRAL'>;

export type GameAction =
  | 'none'
  | 'accelerate'
  | 'reverse'
  | 'steerLeft'
  | 'steerRight'
  | 'jump'
  | 'doubleJump'
  | 'boost'
  | 'powerslide'
  | 'ballCam'
  | 'pause';

export interface HandControlSettings {
  enabled: boolean;
  handedness: 'right' | 'left';
  sensitivity: number;
  confidenceThreshold: number;
  calibrationOffset: {
    tiltRad: number;
    palmX: number;
    palmY: number;
  };
  enabledGestures: Record<ActiveGestureName, boolean>;
  gestureActionMap: Record<ActiveGestureName, GameAction>;
}

export interface HandTrackingTelemetry {
  permissionState: 'prompt' | 'granted' | 'denied' | 'unsupported';
  trackingActive: boolean;
  modelLoading: boolean;
  modelError: string | null;
  handsDetected: number;
  detectedGesture: GestureName;
  steeringGesture: 'NEUTRAL' | 'TILT_LEFT' | 'TILT_RIGHT';
  confidence: number;
  currentActionLabel: string;
  fps: number;
  calibrated: boolean;
}

export interface AudioSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
}

export interface GameSettings {
  graphics: GraphicsQuality;
  camera: CameraSettings;
  audio: AudioSettings;
  keyBindings: KeyBindings;
  handControl: HandControlSettings;
}

export interface PlayerInput {
  seq: number;
  throttle: number; // -1 to 1
  steer: number; // -1 (left) to 1 (right)
  jump: boolean;
  boost: boolean;
  powerslide: boolean;
  reset?: boolean;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface BotDebugSnapshot {
  state: BotCarState;
  role: BotRole;
  targetPos: Vec3;
  predictedBallPath: Vec3[];
  stuckTries: number;
}

export interface CarStateSnapshot {
  id: string;
  name: string;
  team: Team;
  isBot: boolean;
  customization: CarCustomization;
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
  angVel: Vec3;
  boost: number;
  isBoosting: boolean;
  isGrounded: boolean;
  isSupersonic: boolean;
  steerAngle: number;
  wheelSpin: number;
  throttle: number;
  wheelTravel?: [number, number, number, number];
  driftIntensity?: number;
  brakeHeat?: number;
  isBraking?: boolean;
  isReversing?: boolean;
  demolishedTimer?: number;
  respawnFade?: number;
  botDebug?: BotDebugSnapshot;
  goals: number;
  shots: number;
  saves: number;
  connected: boolean;
  ackSeq?: number;
}

export interface BallStateSnapshot {
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
  angVel: Vec3;
  lastTouchPlayerId: string | null;
  lastTouchTeam: Team | null;
}

export interface BoostPadState {
  id: number;
  x: number;
  z: number;
  isLarge: boolean;
  active: boolean;
  cooldown: number;
}

export type MatchPhase = 'lobby' | 'countdown' | 'playing' | 'goal_scored' | 'finished';

export interface MatchStateSnapshot {
  phase: MatchPhase;
  arenaId: ArenaId;
  gameMode: PartyGameMode;
  countdown: number;
  timeRemaining: number;
  isOvertime: boolean;
  blueScore: number;
  orangeScore: number;
  emeraldScore: number;
  lastGoalTeam: Team | null;
  lastGoalScorer: string | null;
  lastGoalSpeedKmh: number;
  cars: CarStateSnapshot[];
  ball: BallStateSnapshot;
  boostPads: BoostPadState[];
  tick: number;
  serverTime: number;
}

export interface RoomPlayerInfo {
  id: string;
  slotIndex: number;
  name: string;
  avatarId: AvatarId;
  team: Team;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  voiceActive: boolean;
  voiceMuted: boolean;
  customization: CarCustomization;
}

export interface RoomState {
  code: string;
  arenaId: ArenaId;
  matchDuration: number;
  gameMode: PartyGameMode;
  botDifficulty: BotDifficulty;
  maxPlayers: number;
  phase: MatchPhase;
  players: RoomPlayerInfo[];
}

export interface MatchEvent {
  type:
    | 'goal'
    | 'impact'
    | 'jump'
    | 'boost_pickup'
    | 'countdown'
    | 'kickoff'
    | 'match_end'
    | 'demolition'
    | 'teleport';
  team?: Team;
  scorer?: string;
  victimId?: string;
  attackerId?: string;
  speedKmh?: number;
  intensity?: number;
  countdown?: number;
  pos?: Vec3;
}
