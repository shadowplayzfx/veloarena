import type {
  AccessoryId,
  ActiveGestureName,
  ArenaId,
  AvatarId,
  BoostTrailId,
  BotDifficulty,
  CarDefinition,
  CarId,
  GameAction,
  GameSettings,
  HandControlSettings,
  KeyBindings,
  PartyGameMode,
  PaintFinish,
  WheelStyleId,
} from './types.ts';

export const ARENA_BOUNDS = {
  HALF_WIDTH: 38,
  HALF_LENGTH: 55,
  HEIGHT: 28,
  CORNER_SIZE: 12,
  GOAL_HALF_WIDTH: 9.5,
  GOAL_HEIGHT: 9.5,
  GOAL_DEPTH: 8,
  BALL_RADIUS: 1.85,
} as const;

export const FFA_ARENA_BOUNDS = {
  APOTHEM: 48,
  HEIGHT: 28,
  GOAL_HALF_WIDTH: 9.5,
  GOAL_HEIGHT: 9.5,
  GOAL_DEPTH: 8,
  BALL_RADIUS: 1.85,
  GOAL_ANGLES: {
    blue: 0,
    orange: (Math.PI * 2) / 3,
    emerald: (Math.PI * 4) / 3,
  },
} as const;

export const PARTY_GAME_MODES: {
  id: PartyGameMode;
  label: string;
  shortLabel: string;
  description: string;
}[] = [
  {
    id: 'ffa',
    label: 'Free-For-All (1v1v1)',
    shortLabel: '1v1v1 FFA',
    description: '3-goal triad arena: each player defends their own goal and scores on rivals.',
  },
  {
    id: 'team_2v1',
    label: 'Team Mode (2v1)',
    shortLabel: '2v1 Teams',
    description: 'Two friends on Team Blue take on one player on Team Orange. Leader assigns teams.',
  },
  {
    id: 'coop_3v3',
    label: 'Three-Player Co-Op',
    shortLabel: '3vAI Co-Op',
    description: 'All three party members team up on Blue against 3 intelligent AI opponents.',
  },
];

export const ACCESSORY_CATALOG: {
  id: AccessoryId;
  name: string;
  description: string;
}[] = [
  { id: 'none', name: 'Stock Clean', description: 'Uncluttered championship aero silhouette.' },
  { id: 'crown', name: 'Royal Crown', description: 'Metallic championship crown mounted on rear deck.' },
  { id: 'halo', name: 'Ion Halo', description: 'Floating emissive energy halo over rear chassis.' },
  { id: 'shark_fin', name: 'Aero Dorsal Fin', description: 'Aggressive Le Mans stabilizing spine fin.' },
  { id: 'rocket_pod', name: 'Twin Turbo Pods', description: 'Shoulder-mounted twin auxiliary thruster pods.' },
  { id: 'antennas', name: 'Telemetry Whips', description: 'Dual glowing rear telemetry masts.' },
];

export const AVATAR_CATALOG: {
  id: AvatarId;
  label: string;
  accent: string;
  badge: string;
}[] = [
  { id: 'striker_helm', label: 'Striker', accent: '#06B6D4', badge: 'ST' },
  { id: 'cyber_visor', label: 'Cyber', accent: '#A855F7', badge: 'CY' },
  { id: 'apex_crown', label: 'Royalty', accent: '#F59E0B', badge: 'RX' },
  { id: 'turbo_flame', label: 'Blaze', accent: '#F97316', badge: 'BZ' },
  { id: 'volt_core', label: 'Volt', accent: '#10B981', badge: 'VT' },
  { id: 'tactical_shield', label: 'Titan', accent: '#EF4444', badge: 'TT' },
];

export interface BoostPadDef {
  id: number;
  x: number;
  z: number;
  isLarge: boolean;
}

export const BOOST_PADS: BoostPadDef[] = [
  // 6 Large 100% Boost Orbs (4 corners + 2 midfield wings)
  { id: 0, x: -29, z: -43, isLarge: true },
  { id: 1, x: 29, z: -43, isLarge: true },
  { id: 2, x: -29, z: 43, isLarge: true },
  { id: 3, x: 29, z: 43, isLarge: true },
  { id: 4, x: -31, z: 0, isLarge: true },
  { id: 5, x: 31, z: 0, isLarge: true },

  // 14 Small +15% Boost Pads
  { id: 6, x: 0, z: -38, isLarge: false },
  { id: 7, x: -16, z: -34, isLarge: false },
  { id: 8, x: 16, z: -34, isLarge: false },
  { id: 9, x: -18, z: -18, isLarge: false },
  { id: 10, x: 0, z: -18, isLarge: false },
  { id: 11, x: 18, z: -18, isLarge: false },
  { id: 12, x: -14, z: 0, isLarge: false },
  { id: 13, x: 14, z: 0, isLarge: false },
  { id: 14, x: -18, z: 18, isLarge: false },
  { id: 15, x: 0, z: 18, isLarge: false },
  { id: 16, x: 18, z: 18, isLarge: false },
  { id: 17, x: -16, z: 34, isLarge: false },
  { id: 18, x: 16, z: 34, isLarge: false },
  { id: 19, x: 0, z: 38, isLarge: false },
];

export const FFA_BOOST_PADS: BoostPadDef[] = [
  // 6 Large 100% Boost Orbs symmetrically around the 3-goal hexagon
  ...[0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    return {
      id: i,
      x: Math.round(Math.sin(a) * 40 * 10) / 10,
      z: Math.round(Math.cos(a) * 40 * 10) / 10,
      isLarge: true,
    };
  }),
  // 9 Inner ring small pads
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
    const a = (i * Math.PI * 2) / 9;
    const r = i % 3 === 0 ? 18 : 26;
    return {
      id: 6 + i,
      x: Math.round(Math.sin(a) * r * 10) / 10,
      z: Math.round(Math.cos(a) * r * 10) / 10,
      isLarge: false,
    };
  }),
];

export const CAR_CATALOG: CarDefinition[] = [
  {
    id: 'striker',
    name: 'Apex GT Coupe',
    archetype: 'Sport Coupe',
    tagline: 'Sculpted front-engine sport coupe built for crisp flicks and booming power shots.',
    defaultPrimary: '#06B6D4',
    defaultSecondary: '#F8FAFC',
    defaultTrail: 'plasma_cyan',
    dimensions: { width: 2.05, height: 0.84, length: 4.1, wheelRadius: 0.44, wheelWidth: 0.34 },
    stats: { topSpeed: 94, acceleration: 90, handling: 88, aerial: 92 },
  },
  {
    id: 'nomad',
    name: 'Stratos RS Rally',
    archetype: 'Hot Hatch / Rally',
    tagline: 'Wide-arch rally hatchback with tall hitbox presence for tight turns and 50/50 challenges.',
    defaultPrimary: '#F97316',
    defaultSecondary: '#1E293B',
    defaultTrail: 'solar_flare',
    dimensions: { width: 2.0, height: 0.96, length: 3.75, wheelRadius: 0.48, wheelWidth: 0.38 },
    stats: { topSpeed: 90, acceleration: 94, handling: 93, aerial: 91 },
  },
  {
    id: 'hyperion',
    name: 'Veloce V12',
    archetype: 'Supercar',
    tagline: 'Razor-low mid-engine exotic wedge with sculpted intakes and active aero channels.',
    defaultPrimary: '#3B82F6',
    defaultSecondary: '#38BDF8',
    defaultTrail: 'hyper_violet',
    dimensions: { width: 2.12, height: 0.78, length: 4.2, wheelRadius: 0.43, wheelWidth: 0.36 },
    stats: { topSpeed: 96, acceleration: 91, handling: 90, aerial: 89 },
  },
  {
    id: 'bullitt',
    name: "Ironclad '78",
    archetype: 'Classic Muscle Interceptor',
    tagline: 'Supercharged V8 stance with heavy front bumper mass for dominant clears.',
    defaultPrimary: '#DC2626',
    defaultSecondary: '#E2E8F0',
    defaultTrail: 'crimson_afterburner',
    dimensions: { width: 2.08, height: 0.9, length: 4.15, wheelRadius: 0.46, wheelWidth: 0.38 },
    stats: { topSpeed: 92, acceleration: 93, handling: 85, aerial: 88 },
  },
  {
    id: 'rallyx',
    name: 'Tarmac WRC',
    archetype: 'Rally Racing Hatchback',
    tagline: 'Short-wheelbase drift specialist built for rapid recoveries and tight pivots.',
    defaultPrimary: '#EAB308',
    defaultSecondary: '#0F172A',
    defaultTrail: 'solar_flare',
    dimensions: { width: 1.98, height: 0.94, length: 3.72, wheelRadius: 0.45, wheelWidth: 0.34 },
    stats: { topSpeed: 89, acceleration: 95, handling: 96, aerial: 90 },
  },
  {
    id: 'apex_s',
    name: 'Monza Evo',
    archetype: 'Mid-Engine Supercar',
    tagline: 'Sculpted carbon bodywork with razor-sharp high-speed cornering stability.',
    defaultPrimary: '#10B981',
    defaultSecondary: '#0F172A',
    defaultTrail: 'emerald_ion',
    dimensions: { width: 2.1, height: 0.82, length: 4.05, wheelRadius: 0.44, wheelWidth: 0.35 },
    stats: { topSpeed: 95, acceleration: 91, handling: 92, aerial: 90 },
  },
  {
    id: 'formula',
    name: 'Grand Prix R1',
    archetype: 'Open-Wheel Formula Racer',
    tagline: 'Exposed suspension wishbones, front wing downforce, and ultra-responsive turn-in.',
    defaultPrimary: '#EF4444',
    defaultSecondary: '#FFFFFF',
    defaultTrail: 'crimson_afterburner',
    dimensions: { width: 2.14, height: 0.76, length: 4.25, wheelRadius: 0.46, wheelWidth: 0.4 },
    stats: { topSpeed: 96, acceleration: 93, handling: 95, aerial: 88 },
  },
  {
    id: 'juggernaut',
    name: 'Titan 6x4',
    archetype: 'Armored Tactical Truck',
    tagline: 'Reinforced steel chassis with commanding aerial backboard and demolition presence.',
    defaultPrimary: '#475569',
    defaultSecondary: '#F59E0B',
    defaultTrail: 'solar_flare',
    dimensions: { width: 2.18, height: 1.06, length: 4.18, wheelRadius: 0.52, wheelWidth: 0.42 },
    stats: { topSpeed: 88, acceleration: 89, handling: 86, aerial: 93 },
  },
  {
    id: 'volt',
    name: 'Lumen EV',
    archetype: 'Futuristic Electric Concept',
    tagline: 'Seamless light-blade fascia with instant torque delivery and silent precision.',
    defaultPrimary: '#8B5CF6',
    defaultSecondary: '#22D3EE',
    defaultTrail: 'hyper_violet',
    dimensions: { width: 2.04, height: 0.86, length: 3.96, wheelRadius: 0.45, wheelWidth: 0.33 },
    stats: { topSpeed: 92, acceleration: 96, handling: 91, aerial: 91 },
  },
  {
    id: 'drift',
    name: 'Kitsune RS',
    archetype: 'Compact Street Tuner',
    tagline: 'Widebody street machine tuned for snappy powerslides and low-center dribbling.',
    defaultPrimary: '#EC4899',
    defaultSecondary: '#18181B',
    defaultTrail: 'hyper_violet',
    dimensions: { width: 1.96, height: 0.86, length: 3.68, wheelRadius: 0.42, wheelWidth: 0.33 },
    stats: { topSpeed: 90, acceleration: 93, handling: 95, aerial: 90 },
  },
];

export const CAR_MAP: Record<CarId, CarDefinition> = Object.fromEntries(
  CAR_CATALOG.map((car) => [car.id, car])
) as Record<CarId, CarDefinition>;

export interface ArenaInfo {
  id: ArenaId;
  name: string;
  subtitle: string;
  accent: string;
  skyColor: string;
}

export const ARENA_CATALOG: ArenaInfo[] = [
  {
    id: 'neon_stadium',
    name: 'Neon Stadium',
    subtitle: 'Midnight Floodlit Cyber Coliseum',
    accent: '#06B6D4',
    skyColor: '#050811',
  },
  {
    id: 'sunset_arena',
    name: 'Sunset Arena',
    subtitle: 'Golden Hour Coastal Stadium',
    accent: '#F59E0B',
    skyColor: '#D97745',
  },
  {
    id: 'cyber_arena',
    name: 'Cyber Arena',
    subtitle: 'Holographic Orbital Grid Dome',
    accent: '#A855F7',
    skyColor: '#090617',
  },
];

export const BOOST_TRAIL_CATALOG: {
  id: BoostTrailId;
  name: string;
  coreColor: string;
  outerColor: string;
}[] = [
  { id: 'plasma_cyan', name: 'Plasma Cyan', coreColor: '#E0F2FE', outerColor: '#06B6D4' },
  { id: 'solar_flare', name: 'Solar Flare', coreColor: '#FEF08A', outerColor: '#F97316' },
  { id: 'hyper_violet', name: 'Hyper Violet', coreColor: '#F3E8FF', outerColor: '#A855F7' },
  { id: 'emerald_ion', name: 'Emerald Ion', coreColor: '#D1FAE5', outerColor: '#10B981' },
  { id: 'crimson_afterburner', name: 'Crimson Burn', coreColor: '#FEE2E2', outerColor: '#EF4444' },
];

export const HERO_CAR_IDS: CarId[] = ['striker', 'hyperion', 'nomad'];

export const PAINT_FINISH_CATALOG: {
  id: PaintFinish;
  label: string;
  description: string;
}[] = [
  { id: 'metallic', label: 'Metallic', description: 'Deep clearcoated metallic flake paint.' },
  { id: 'matte', label: 'Matte', description: 'Stealth satin-matte motorsport finish.' },
  { id: 'pearl', label: 'Pearl', description: 'Iridescent pearlescent color-shift lacquer.' },
];

export const WHEEL_STYLE_CATALOG: {
  id: WheelStyleId;
  label: string;
  description: string;
}[] = [
  { id: 'sport_5', label: '5-Spoke GT', description: 'Split forged 5-spoke track wheels.' },
  { id: 'mesh_10', label: '10-Spoke Mesh', description: 'Multi-spoke forged motorsport mesh.' },
  { id: 'turbofan', label: 'Aero Turbofan', description: 'Vented aero disc wheel covers.' },
  { id: 'rally_blade', label: 'Rally Blade', description: 'Reinforced directional rally blades.' },
];

export const BOT_DIFFICULTIES: {
  id: BotDifficulty;
  label: string;
  description: string;
}[] = [
  { id: 'rookie', label: 'Rookie', description: '0.35s reaction delay, 0.5s prediction, 50% boost, ±15° aim.' },
  { id: 'pro', label: 'Pro', description: '0.2s delay, 1.0s prediction, basic flips, 70% boost, ±8° aim.' },
  { id: 'all_star', label: 'All-Star', description: '0.1s delay, 1.5s prediction, wall & aerial plays, 90% boost, ±4° aim.' },
  { id: 'legend', label: 'Legend', description: '0.05s delay, 2.0s prediction, full aerials, fast recoveries, ±1.5° aim.' },
];

export function normalizeBotDifficulty(raw: unknown): BotDifficulty {
  const s = String(raw || '').toLowerCase();
  if (s === 'rookie' || s === 'beginner') return 'rookie';
  if (s === 'pro' || s === 'easy' || s === 'medium') return 'pro';
  if (s === 'all_star' || s === 'hard') return 'all_star';
  if (s === 'legend' || s === 'professional') return 'legend';
  return 'all_star';
}

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  accelerate: 'KeyW',
  reverse: 'KeyS',
  steerLeft: 'KeyA',
  steerRight: 'KeyD',
  jump: 'Space',
  boost: 'ShiftLeft',
  powerslide: 'ControlLeft',
  reset: 'KeyR',
  camera: 'KeyC',
  pause: 'Escape',
};

export const HAND_GESTURE_CATALOG: {
  id: ActiveGestureName;
  label: string;
  howTo: string;
  defaultAction: GameAction;
}[] = [
  { id: 'OPEN_PALM', label: 'Open Palm', howTo: 'Extend all fingers facing camera', defaultAction: 'accelerate' },
  { id: 'CLOSED_FIST', label: 'Closed Fist', howTo: 'Curl all fingers into a fist', defaultAction: 'reverse' },
  { id: 'TILT_LEFT', label: 'Tilt Hand Left', howTo: 'Tilt palm/wrist to the left', defaultAction: 'steerLeft' },
  { id: 'TILT_RIGHT', label: 'Tilt Hand Right', howTo: 'Tilt palm/wrist to the right', defaultAction: 'steerRight' },
  { id: 'TWO_FINGERS', label: 'Two Fingers Raised', howTo: 'Raise index + middle (V sign)', defaultAction: 'jump' },
  { id: 'DOUBLE_EXTENSION', label: 'Two Quick Extensions', howTo: 'Flick 2 fingers twice quickly', defaultAction: 'doubleJump' },
  { id: 'THUMBS_UP', label: 'Thumbs Up', howTo: 'Fist closed with thumb pointing up', defaultAction: 'boost' },
  { id: 'SIDEWAYS_SWIPE', label: 'Flat Hand Sideways', howTo: 'Swipe flat open hand sideways', defaultAction: 'powerslide' },
  { id: 'POINTING_FINGER', label: 'Pointing Finger', howTo: 'Extend index finger only', defaultAction: 'ballCam' },
  { id: 'BOTH_HANDS_RAISED', label: 'Both Hands Raised', howTo: 'Raise both open hands high', defaultAction: 'pause' },
];

export const GAME_ACTION_LABELS: Record<GameAction, string> = {
  none: 'Disabled',
  accelerate: 'Accelerate',
  reverse: 'Brake / Reverse',
  steerLeft: 'Steer Left',
  steerRight: 'Steer Right',
  jump: 'Jump',
  doubleJump: 'Double Jump',
  boost: 'Rocket Boost',
  powerslide: 'Powerslide',
  ballCam: 'Toggle Ball Camera',
  pause: 'Pause Game',
};

export const DEFAULT_HAND_CONTROL_SETTINGS: HandControlSettings = {
  enabled: false,
  handedness: 'right',
  sensitivity: 1.0,
  confidenceThreshold: 0.62,
  calibrationOffset: {
    tiltRad: 0,
    palmX: 0.5,
    palmY: 0.55,
  },
  enabledGestures: {
    OPEN_PALM: true,
    CLOSED_FIST: true,
    TILT_LEFT: true,
    TILT_RIGHT: true,
    TWO_FINGERS: true,
    DOUBLE_EXTENSION: true,
    THUMBS_UP: true,
    SIDEWAYS_SWIPE: true,
    POINTING_FINGER: true,
    BOTH_HANDS_RAISED: true,
  },
  gestureActionMap: {
    OPEN_PALM: 'accelerate',
    CLOSED_FIST: 'reverse',
    TILT_LEFT: 'steerLeft',
    TILT_RIGHT: 'steerRight',
    TWO_FINGERS: 'jump',
    DOUBLE_EXTENSION: 'doubleJump',
    THUMBS_UP: 'boost',
    SIDEWAYS_SWIPE: 'powerslide',
    POINTING_FINGER: 'ballCam',
    BOTH_HANDS_RAISED: 'pause',
  },
};

export const DEFAULT_SETTINGS: GameSettings = {
  graphics: 'high',
  camera: {
    viewMode: 'chase',
    distance: 7.0,
    height: 2.7,
    fov: 105,
    ballCamDefault: true,
    cameraShake: true,
  },
  audio: {
    masterVolume: 0.75,
    sfxVolume: 0.85,
    musicVolume: 0.45,
  },
  keyBindings: DEFAULT_KEY_BINDINGS,
  handControl: DEFAULT_HAND_CONTROL_SETTINGS,
};

export const COLOR_SWATCHES = [
  '#06B6D4',
  '#3B82F6',
  '#6366F1',
  '#8B5CF6',
  '#EC4899',
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#10B981',
  '#14B8A6',
  '#F8FAFC',
  '#94A3B8',
  '#334155',
  '#0F172A',
];
