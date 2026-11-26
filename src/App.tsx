import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Car,
  Compass,
  Hand,
  Play,
  Settings,
  Sliders,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { BotSetupModal } from './components/BotSetupModal.tsx';
import { GarageView } from './components/GarageView.tsx';
import { HandControlModal } from './components/HandControlModal.tsx';
import { MatchHUD } from './components/MatchHUD.tsx';
import { MultiplayerLobby } from './components/MultiplayerLobby.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { ArenaViewport } from './engine/ArenaViewport.tsx';
import { ProceduralAudioEngine } from './engine/audio.ts';
import { GarageShowcase3D } from './engine/GarageShowcase3D.tsx';
import { HandGestureEngine } from './input/handGestureEngine.ts';
import { MultiplayerClient, type ConnectionStatus } from './net/multiplayerClient.ts';
import { VoiceChatManager, type VoiceState } from './net/voiceChat.ts';
import { BotAIController } from './shared/botAI.ts';
import {
  ARENA_CATALOG,
  AVATAR_CATALOG,
  CAR_CATALOG,
  DEFAULT_HAND_CONTROL_SETTINGS,
  DEFAULT_SETTINGS,
} from './shared/constants.ts';
import { ensureRapierReady, PhysicsSimulation } from './shared/physicsEngine.ts';
import type {
  ArenaId,
  AvatarId,
  BotDifficulty,
  CarCustomization,
  CarId,
  GameMode,
  GameSettings,
  GraphicsQuality,
  HandTrackingTelemetry,
  MatchEvent,
  MatchStateSnapshot,
  PartyGameMode,
  PlayerInput,
  RoomState,
} from './shared/types.ts';

const STORAGE_KEYS = {
  NAME: 'rocket_arena_player_name',
  AVATAR: 'rocket_arena_avatar_id',
  CAR: 'rocket_arena_car_custom',
  SETTINGS: 'rocket_arena_settings_v2',
  LEGACY_SETTINGS: 'rocket_arena_settings',
  PARTY_SESSION: 'rocket_arena_party_session',
};

function loadAvatarId(): AvatarId {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AVATAR);
    if (raw && AVATAR_CATALOG.some((a) => a.id === raw)) {
      return raw as AvatarId;
    }
  } catch {
    // ignore
  }
  return 'striker_helm';
}

function loadSavedPartySession(): { code: string; playerToken: string } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.PARTY_SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: string; playerToken?: string };
    if (parsed.code && parsed.playerToken) {
      return { code: parsed.code, playerToken: parsed.playerToken };
    }
  } catch {
    // ignore
  }
  return null;
}

function savePartySession(data: { code: string; playerToken: string } | null): void {
  try {
    if (!data) {
      sessionStorage.removeItem(STORAGE_KEYS.PARTY_SESSION);
    } else {
      sessionStorage.setItem(STORAGE_KEYS.PARTY_SESSION, JSON.stringify(data));
    }
  } catch {
    // ignore
  }
}

function loadCarJson(fallback: CarCustomization): CarCustomization {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CAR);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function loadGameSettings(): GameSettings {
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const rawLegacy = !rawV2 ? localStorage.getItem(STORAGE_KEYS.LEGACY_SETTINGS) : null;
    const raw = rawV2 ?? rawLegacy;
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    const hc = parsed.handControl;
    return {
      graphics: parsed.graphics ?? DEFAULT_SETTINGS.graphics,
      camera: rawV2
        ? { ...DEFAULT_SETTINGS.camera, ...(parsed.camera ?? {}) }
        : { ...DEFAULT_SETTINGS.camera },
      audio: { ...DEFAULT_SETTINGS.audio, ...(parsed.audio ?? {}) },
      keyBindings: { ...DEFAULT_SETTINGS.keyBindings, ...(parsed.keyBindings ?? {}) },
      handControl: {
        ...DEFAULT_HAND_CONTROL_SETTINGS,
        ...(hc ?? {}),
        // Require explicit opt-in per session before activating webcam
        enabled: false,
        calibrationOffset: {
          ...DEFAULT_HAND_CONTROL_SETTINGS.calibrationOffset,
          ...(hc?.calibrationOffset ?? {}),
        },
        enabledGestures: {
          ...DEFAULT_HAND_CONTROL_SETTINGS.enabledGestures,
          ...(hc?.enabledGestures ?? {}),
        },
        gestureActionMap: {
          ...DEFAULT_HAND_CONTROL_SETTINGS.gestureActionMap,
          ...(hc?.gestureActionMap ?? {}),
        },
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function App() {
  const [playerName, setPlayerName] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.NAME) || 'Striker';
    } catch {
      return 'Striker';
    }
  });

  const [avatarId, setAvatarId] = useState<AvatarId>(() => loadAvatarId());

  const [customization, setCustomization] = useState<CarCustomization>(() =>
    loadCarJson({
      carId: 'striker',
      primaryColor: '#06B6D4',
      secondaryColor: '#F8FAFC',
      paintFinish: 'metallic',
      wheelStyle: 'sport_5',
      boostTrail: 'plasma_cyan',
      accessory: 'none',
    })
  );

  const [settings, setSettings] = useState<GameSettings>(() => loadGameSettings());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.NAME, playerName);
    } catch {
      // ignore
    }
  }, [playerName]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.AVATAR, avatarId);
    } catch {
      // ignore
    }
  }, [avatarId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CAR, JSON.stringify(customization));
    } catch {
      // ignore
    }
  }, [customization]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  // Audio engine singleton
  const audio = useMemo(() => new ProceduralAudioEngine(), []);
  useEffect(() => {
    audio.updateSettings(settings.audio);
  }, [audio, settings.audio]);

  useEffect(() => {
    return () => {
      audio.dispose();
    };
  }, [audio]);

  // Hand Gesture Control engine singleton (100% browser-local MediaPipe)
  const handEngine = useMemo(() => new HandGestureEngine(DEFAULT_HAND_CONTROL_SETTINGS), []);
  const [handTelemetry, setHandTelemetry] = useState<HandTrackingTelemetry>(() => handEngine.getTelemetry());

  useEffect(() => {
    handEngine.onTelemetry = (t) => setHandTelemetry(t);
    handEngine.onCalibrateUpdate = (offset) => {
      setSettings((prev) => ({
        ...prev,
        handControl: {
          ...prev.handControl,
          calibrationOffset: offset,
        },
      }));
    };
    return () => {
      handEngine.stop();
    };
  }, [handEngine]);

  useEffect(() => {
    handEngine.updateSettings(settings.handControl);
  }, [handEngine, settings.handControl]);

  // App Views & Modals
  const [view, setView] = useState<'menu' | 'garage' | 'match'>('menu');
  const [activeMode, setActiveMode] = useState<GameMode>('menu');
  const [activeArena, setActiveArena] = useState<ArenaId>('neon_stadium');
  const [activePartyMode, setActivePartyMode] = useState<PartyGameMode>('team_2v1');

  const [showBotModal, setShowBotModal] = useState(false);
  const [showPracticeModal, setShowPracticeModal] = useState(false);
  const [showMultiplayerModal, setShowMultiplayerModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showHandModal, setShowHandModal] = useState(false);
  const [previewBoost, setPreviewBoost] = useState(false);

  // Match Runtime State
  const [ballCam, setBallCam] = useState(settings.camera.ballCamDefault);
  const [lookBehind, setLookBehind] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hudSnapshot, setHudSnapshot] = useState<MatchStateSnapshot | null>(null);
  const [localPlayerId, setLocalPlayerId] = useState<string>('local_player');

  // Local Simulation Refs
  const localSimRef = useRef<PhysicsSimulation | null>(null);
  const botControllersRef = useRef<Map<string, { ai: BotAIController; difficulty: BotDifficulty }>>(new Map());
  const pendingLocalEventsRef = useRef<MatchEvent[]>([]);
  const accumulatorRef = useRef(0);
  const lastHudSyncRef = useRef(0);
  const lastBotConfigRef = useRef<{
    teamSize: number;
    difficulty: BotDifficulty;
    arenaId: ArenaId;
    matchDuration: number;
  } | null>(null);

  // Multiplayer Client + Voice Chat Mesh + Party Rejoin State
  const mpClient = useMemo(() => new MultiplayerClient(), []);
  const voiceChat = useMemo(() => new VoiceChatManager(), []);
  const [voiceState, setVoiceState] = useState<VoiceState>(() => voiceChat.getState());
  const [mpStatus, setMpStatus] = useState<ConnectionStatus>('disconnected');
  const [mpPing, setMpPing] = useState(0);
  const [mpRoom, setMpRoom] = useState<RoomState | null>(null);
  const [mpError, setMpError] = useState<string | null>(null);
  const [mpNotice, setMpNotice] = useState<string | null>(null);
  const [initialRoomCode, setInitialRoomCode] = useState<string>('');
  const [savedSession, setSavedSession] = useState<{ code: string; playerToken: string } | null>(() =>
    loadSavedPartySession()
  );
  const lastSentInputTimeRef = useRef(0);
  const lastSentInputKeyRef = useRef('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    if (code && code.trim().length >= 4) {
      setInitialRoomCode(code.trim().toUpperCase().slice(0, 6));
      setShowMultiplayerModal(true);
    }
  }, []);

  useEffect(() => {
    voiceChat.onStateChange = (st) => setVoiceState(st);
    voiceChat.onSendSignal = (toPlayerId, signal) => mpClient.sendVoiceSignal(toPlayerId, signal);
    voiceChat.onStatusBroadcast = (voiceActive, voiceMuted) =>
      mpClient.sendVoiceStatus(voiceActive, voiceMuted);
    return () => {
      voiceChat.dispose();
    };
  }, [voiceChat, mpClient]);

  useEffect(() => {
    mpClient.onStatusChange = (s) => setMpStatus(s);
    mpClient.onPing = (ms) => setMpPing(ms);
    mpClient.onError = (msg) => setMpError(msg);

    mpClient.onVoiceSignal = (fromPlayerId, signal) => {
      void voiceChat.handleSignal(fromPlayerId, signal);
    };

    mpClient.onKicked = (reason) => {
      voiceChat.disableVoice();
      savePartySession(null);
      setSavedSession(null);
      setMpRoom(null);
      setMpNotice(reason);
      setView('menu');
      setActiveMode('menu');
      setShowMultiplayerModal(true);
    };

    mpClient.onPartyClosed = (reason) => {
      voiceChat.disableVoice();
      savePartySession(null);
      setSavedSession(null);
      setMpRoom(null);
      setMpNotice(reason);
      setView('menu');
      setActiveMode('menu');
      setShowMultiplayerModal(true);
    };

    mpClient.onJoined = ({ playerId, playerToken, room }) => {
      setMpError(null);
      setMpNotice(null);
      setLocalPlayerId(playerId);
      setMpRoom(room);
      setActivePartyMode(room.gameMode);
      const sess = { code: room.code, playerToken };
      savePartySession(sess);
      setSavedSession(sess);
      voiceChat.syncPartyPeers(room.players, playerId);

      if (room.phase !== 'lobby') {
        setActiveMode('multiplayer');
        setActiveArena(room.arenaId);
        setActivePartyMode(room.gameMode);
        setBallCam(settings.camera.ballCamDefault);
        setPaused(false);
        setShowMultiplayerModal(false);
        setView('match');
        audio.stopMenuMusic();
      }
    };

    mpClient.onRoomState = (room) => {
      setMpRoom(room);
      setActivePartyMode(room.gameMode);
      voiceChat.syncPartyPeers(room.players, mpClient.playerId);

      if (room.phase !== 'lobby') {
        setActiveMode('multiplayer');
        setActiveArena(room.arenaId);
        setPaused(false);
        setShowMultiplayerModal(false);
        setView('match');
        audio.stopMenuMusic();
      } else if (view === 'match' && activeMode === 'multiplayer') {
        setView('menu');
        setShowMultiplayerModal(true);
      }
    };

    return () => {
      mpClient.disconnect();
    };
  }, [mpClient, voiceChat, audio, settings.camera.ballCamDefault, view, activeMode]);

  useEffect(() => {
    if (view === 'menu' || view === 'garage') {
      audio.startMenuMusic();
    } else {
      audio.stopMenuMusic();
    }
  }, [view, audio]);

  const startLocalMatch = useCallback(
    async (opts: {
      mode: 'bots' | 'practice';
      arenaId: ArenaId;
      teamSize: number;
      difficulty: BotDifficulty;
      matchDuration: number;
    }) => {
      audio.unlock();
      await ensureRapierReady();

      if (localSimRef.current) {
        localSimRef.current.dispose();
        localSimRef.current = null;
      }
      botControllersRef.current.clear();
      pendingLocalEventsRef.current = [];
      accumulatorRef.current = 0;

      const isPractice = opts.mode === 'practice';
      const sim = new PhysicsSimulation({
        arenaId: opts.arenaId,
        matchDuration: opts.matchDuration,
        gameMode: 'team_2v1',
        isPractice,
      });

      const localId = 'local_player';
      sim.addCar(
        {
          id: localId,
          name: playerName.trim() || 'Striker',
          team: 'blue',
          isBot: false,
          customization,
          connected: true,
        },
        0,
        opts.teamSize
      );

      if (!isPractice) {
        lastBotConfigRef.current = {
          teamSize: opts.teamSize,
          difficulty: opts.difficulty,
          arenaId: opts.arenaId,
          matchDuration: opts.matchDuration,
        };

        const botNames = ['Vortex', 'Cobalt', 'Nova', 'Apex', 'Pulse'];
        const botCarPool = CAR_CATALOG;
        let botIdx = 0;

        for (let i = 1; i < opts.teamSize; i++) {
          const id = `bot_blue_${i}`;
          const def = botCarPool[(botIdx + 2) % botCarPool.length];
          sim.addCar(
            {
              id,
              name: `${botNames[botIdx % botNames.length]} (AI)`,
              team: 'blue',
              isBot: true,
              botDifficulty: opts.difficulty,
              customization: {
                carId: def.id,
                primaryColor: '#0284C7',
                secondaryColor: '#E0F2FE',
                boostTrail: 'plasma_cyan',
              },
              connected: true,
            },
            i,
            opts.teamSize
          );
          botControllersRef.current.set(id, { ai: new BotAIController(), difficulty: opts.difficulty });
          botIdx++;
        }

        for (let i = 0; i < opts.teamSize; i++) {
          const id = `bot_orange_${i}`;
          const def = botCarPool[(botIdx + 1) % botCarPool.length];
          sim.addCar(
            {
              id,
              name: `${botNames[botIdx % botNames.length]} (AI)`,
              team: 'orange',
              isBot: true,
              botDifficulty: opts.difficulty,
              customization: {
                carId: def.id,
                primaryColor: '#F97316',
                secondaryColor: '#1E293B',
                boostTrail: 'solar_flare',
              },
              connected: true,
            },
            i,
            opts.teamSize
          );
          botControllersRef.current.set(id, { ai: new BotAIController(), difficulty: opts.difficulty });
          botIdx++;
        }
      }

      sim.resetKickoff(false);
      localSimRef.current = sim;
      const initialSnap = sim.getSnapshot();
      setHudSnapshot(initialSnap);
      setLocalPlayerId(localId);
      setActiveMode(opts.mode);
      setActiveArena(opts.arenaId);
      setActivePartyMode('team_2v1');
      setBallCam(settings.camera.ballCamDefault);
      setLookBehind(false);
      setPaused(false);
      setShowBotModal(false);
      setShowPracticeModal(false);
      setView('match');
    },
    [audio, customization, playerName, settings.camera.ballCamDefault]
  );

  const handleFrameTick = useCallback(
    (dt: number, input: PlayerInput) => {
      if (activeMode === 'multiplayer') {
        const key = `${input.throttle}_${input.steer.toFixed(2)}_${input.jump ? 1 : 0}_${input.boost ? 1 : 0}_${input.powerslide ? 1 : 0}_${input.reset ? 1 : 0}`;
        const now = performance.now();
        if (key !== lastSentInputKeyRef.current || now - lastSentInputTimeRef.current > 45 || input.reset) {
          lastSentInputKeyRef.current = key;
          lastSentInputTimeRef.current = now;
          mpClient.sendInput(input);
        }
        return;
      }

      const sim = localSimRef.current;
      if (!sim) return;

      sim.setInput(localPlayerId, input);
      accumulatorRef.current += dt;
      const fixedDt = 1 / 60;
      let steps = 0;

      while (accumulatorRef.current >= fixedDt && steps < 4) {
        if (botControllersRef.current.size > 0 && sim.phase === 'playing') {
          const snap = sim.getSnapshot();
          for (const car of snap.cars) {
            if (!car.isBot) continue;
            const entry = botControllersRef.current.get(car.id);
            if (entry) {
              const res = entry.ai.stepBot(
                car,
                snap.ball,
                snap.boostPads,
                snap.cars,
                entry.difficulty,
                snap.tick,
                fixedDt
              );
              sim.setBotDebug(car.id, res.debug);
              if (res.teleportTarget) {
                sim.teleportCarToSafety(car.id, res.teleportTarget);
              }
              sim.setInput(car.id, res.input);
            }
          }
        }

        const events = sim.step(fixedDt);
        if (events.length > 0) {
          pendingLocalEventsRef.current.push(...events);
        }
        accumulatorRef.current -= fixedDt;
        steps++;
      }
    },
    [activeMode, localPlayerId, mpClient]
  );

  const getRenderState = useCallback(
    (nowMs: number) => {
      let snapshot: MatchStateSnapshot | null = null;
      let events: MatchEvent[] = [];

      if (activeMode === 'multiplayer') {
        const res = mpClient.getInterpolatedState(nowMs);
        snapshot = res.snapshot;
        events = res.events;
      } else if (localSimRef.current) {
        snapshot = localSimRef.current.getSnapshot();
        events = pendingLocalEventsRef.current.splice(0, pendingLocalEventsRef.current.length);
      }

      if (snapshot && nowMs - lastHudSyncRef.current > 55) {
        lastHudSyncRef.current = nowMs;
        setHudSnapshot(snapshot);
      }

      return { snapshot, events };
    },
    [activeMode, mpClient]
  );

  const handleExitMatch = useCallback(() => {
    setPaused(false);
    setLookBehind(false);
    if (localSimRef.current) {
      localSimRef.current.dispose();
      localSimRef.current = null;
    }
    botControllersRef.current.clear();

    if (activeMode === 'multiplayer') {
      setView('menu');
      setShowMultiplayerModal(true);
    } else {
      setActiveMode('menu');
      setView('menu');
    }
  }, [activeMode]);

  const handleRematch = useCallback(() => {
    if (activeMode === 'multiplayer') {
      mpClient.requestRematch();
    } else if (activeMode === 'practice') {
      localSimRef.current?.resetKickoff(false);
    } else if (lastBotConfigRef.current) {
      void startLocalMatch({
        mode: 'bots',
        ...lastBotConfigRef.current,
      });
    }
  }, [activeMode, mpClient, startLocalMatch]);

  const isMuted = settings.audio.masterVolume <= 0.01;
  const toggleMute = () => {
    audio.unlock();
    setSettings((prev) => ({
      ...prev,
      audio: {
        ...prev.audio,
        masterVolume: prev.audio.masterVolume <= 0.01 ? 0.75 : 0,
      },
    }));
  };

  const disableHandControl = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      handControl: { ...prev.handControl, enabled: false },
    }));
  }, []);

  const currentCarDef = CAR_CATALOG.find((c) => c.id === customization.carId) ?? CAR_CATALOG[0];
  const localPartyPlayer = mpRoom?.players.find((p) => p.id === mpClient.playerId) ?? null;
  const isPartyHost = Boolean(localPartyPlayer?.isHost);

  return (
    <div
      className="relative w-screen h-screen overflow-hidden bg-[#070A0F] text-slate-100"
      onPointerDown={() => audio.unlock()}
    >
      {/* Active 3D Match Viewport OR 3D Garage/Menu Showroom */}
      {view === 'match' ? (
        <ArenaViewport
          arenaId={activeArena}
          gameMode={activeMode === 'multiplayer' ? activePartyMode : 'team_2v1'}
          settings={settings}
          localPlayerId={localPlayerId}
          ballCam={ballCam}
          paused={paused}
          audio={audio}
          handEngine={handEngine}
          getRenderState={getRenderState}
          onFrameTick={handleFrameTick}
          onToggleBallCam={() => setBallCam((b) => !b)}
          onTogglePause={() => setPaused((p) => !p)}
          onLookBehindChange={setLookBehind}
        />
      ) : (
        <GarageShowcase3D
          customization={customization}
          interactive={view === 'garage'}
          previewBoost={view === 'garage' && previewBoost}
          offsetX={view === 'menu' ? -1.4 : 0}
          quality={settings.graphics}
        />
      )}

      {/* Match HUD */}
      {view === 'match' && (
        <MatchHUD
          snapshot={hudSnapshot}
          localPlayerId={localPlayerId}
          mode={activeMode}
          ballCam={ballCam}
          lookBehind={lookBehind}
          cameraViewMode={settings.camera.viewMode}
          paused={paused}
          connectionStatus={mpStatus}
          pingMs={mpPing}
          roomCode={mpRoom?.code ?? null}
          partyPlayers={mpRoom?.players ?? []}
          isPartyHost={isPartyHost}
          voiceState={voiceState}
          onToggleMic={() => {
            if (mpRoom && mpClient.playerId) {
              void voiceChat.toggleMicrophone(mpRoom.players, mpClient.playerId);
            }
          }}
          onToggleSelfMute={() => voiceChat.toggleSelfMute()}
          onTogglePeerMute={(pid) => voiceChat.togglePeerMute(pid)}
          handControlEnabled={settings.handControl.enabled}
          handEngine={handEngine}
          handTelemetry={handTelemetry}
          onToggleBallCam={() => setBallCam((b) => !b)}
          onTogglePause={() => setPaused((p) => !p)}
          onResetPractice={() => localSimRef.current?.resetKickoff(true)}
          onOpenSettings={() => setShowSettingsModal(true)}
          onOpenHandControl={() => setShowHandModal(true)}
          onDisableHandControl={disableHandControl}
          onCalibrateHand={() => handEngine.calibrateNeutral()}
          onRematch={handleRematch}
          onBackToParty={() => mpClient.backToLobby()}
          onReconnect={() => {
            void mpClient.reconnectRoom().catch((err) => setMpError(String(err)));
          }}
          onExitMatch={handleExitMatch}
        />
      )}

      {/* Garage Customization View */}
      {view === 'garage' && (
        <GarageView
          playerName={playerName}
          avatarId={avatarId}
          customization={customization}
          previewBoost={previewBoost}
          onChangePlayerName={(name) => {
            setPlayerName(name);
            if (mpRoom) {
              mpClient.updateCar(customization, name, avatarId);
            }
          }}
          onChangeAvatar={(nextAv) => {
            setAvatarId(nextAv);
            if (mpRoom) {
              mpClient.updateCar(customization, playerName, nextAv);
            }
          }}
          onTogglePreviewBoost={() => setPreviewBoost((b) => !b)}
          onChange={(next) => {
            setCustomization(next);
            if (mpRoom) {
              mpClient.updateCar(next, playerName, avatarId);
            }
          }}
          onBack={() => {
            setPreviewBoost(false);
            setView('menu');
          }}
        />
      )}

      {/* Main Menu Overlay */}
      {view === 'menu' && (
        <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-6 md:p-10">
          {/* Top Header */}
          <header className="flex items-center justify-between gap-6">
            <div className="pointer-events-auto">
              <div className="font-display text-3xl md:text-4xl font-bold italic tracking-wider text-white">
                ROCKET <span className="text-cyan-400">ARENA</span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {settings.camera.viewMode === 'first_person' ? 'Cockpit View' : 'Third-Person Chase'} ·{' '}
                {currentCarDef.name} Selected
              </div>
            </div>

            <div className="pointer-events-auto flex items-center gap-2.5">
              <button
                onClick={() => setShowHandModal(true)}
                className={`flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  settings.handControl.enabled
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                    : 'border-white/15 bg-[#0C121E]/92 text-slate-200 hover:border-white/30 hover:text-white'
                }`}
              >
                <Hand className="w-3.5 h-3.5" />
                <span>{settings.handControl.enabled ? 'Hand Control: Active' : 'Hand Control'}</span>
              </button>
              <button
                onClick={toggleMute}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-[#0C121E]/92 text-slate-200 hover:border-white/30 hover:text-white transition-colors"
                aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setShowSettingsModal(true)}
                className="flex items-center gap-2 rounded-lg border border-white/15 bg-[#0C121E]/92 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:border-white/30 hover:text-white transition-colors whitespace-nowrap"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Settings</span>
              </button>
            </div>
          </header>

          {/* Left Navigation Menu */}
          <div className="pointer-events-auto my-auto w-full max-w-sm space-y-2">
            <button
              onClick={() =>
                void startLocalMatch({
                  mode: 'bots',
                  arenaId: 'neon_stadium',
                  teamSize: 1,
                  difficulty: 'all_star',
                  matchDuration: 180,
                })
              }
              className="group flex w-full items-center justify-between rounded-xl bg-cyan-500 px-5 py-3.5 text-left text-slate-950 shadow-lg hover:bg-cyan-400 transition-all"
            >
              <div className="flex items-center gap-3.5">
                <Play className="w-5 h-5 fill-current" />
                <div>
                  <div className="font-display text-xl font-bold leading-none">PLAY</div>
                  <div className="text-xs font-semibold text-slate-900/80 mt-1">
                    Instant 1v1 Match · Neon Stadium
                  </div>
                </div>
              </div>
              <span className="font-display text-xs font-bold uppercase tracking-wider opacity-80 group-hover:translate-x-0.5 transition-transform">
                Kickoff
              </span>
            </button>

            <button
              onClick={() => setShowBotModal(true)}
              className="flex w-full items-center justify-between rounded-xl border border-white/12 bg-[#0B111C]/92 px-5 py-3 text-left text-white hover:border-cyan-400/50 hover:bg-[#111A2B] transition-all"
            >
              <div className="flex items-center gap-3.5">
                <Bot className="w-5 h-5 text-cyan-400" />
                <div>
                  <div className="font-display text-lg font-bold leading-none">PLAY WITH BOTS</div>
                  <div className="text-xs text-slate-400 mt-0.5">1v1 to 3v3 · 4 AI Difficulty Tiers</div>
                </div>
              </div>
            </button>

            <button
              onClick={() => {
                setMpError(null);
                setMpNotice(null);
                setShowMultiplayerModal(true);
              }}
              className="flex w-full items-center justify-between rounded-xl border border-orange-500/35 bg-[#141013]/92 px-5 py-3 text-left text-white hover:border-orange-400 hover:bg-[#1D1517] transition-all"
            >
              <div className="flex items-center gap-3.5">
                <Users className="w-5 h-5 text-orange-400" />
                <div>
                  <div className="font-display text-lg font-bold leading-none">PLAY WITH FRIENDS</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    3-Player Online Party · FFA, 2v1, Co-Op &amp; Voice
                  </div>
                </div>
              </div>
              {mpRoom && (
                <span className="font-mono-num text-xs font-bold text-orange-300">
                  {mpRoom.code} ({mpRoom.players.length}/3)
                </span>
              )}
            </button>

            <button
              onClick={() => setShowPracticeModal(true)}
              className="flex w-full items-center justify-between rounded-xl border border-white/12 bg-[#0B111C]/92 px-5 py-3 text-left text-white hover:border-white/30 hover:bg-[#111A2B] transition-all"
            >
              <div className="flex items-center gap-3.5">
                <Compass className="w-5 h-5 text-emerald-400" />
                <div>
                  <div className="font-display text-lg font-bold leading-none">PRACTICE</div>
                  <div className="text-xs text-slate-400 mt-0.5">Free Play Aerials &amp; Shot Training</div>
                </div>
              </div>
            </button>

            <button
              onClick={() => setView('garage')}
              className="flex w-full items-center justify-between rounded-xl border border-white/12 bg-[#0B111C]/92 px-5 py-3 text-left text-white hover:border-white/30 hover:bg-[#111A2B] transition-all"
            >
              <div className="flex items-center gap-3.5">
                <Car className="w-5 h-5 text-purple-400" />
                <div>
                  <div className="font-display text-lg font-bold leading-none">GARAGE</div>
                  <div className="text-xs text-slate-400 mt-0.5">10 Cars · Paint, Accessories, Avatars</div>
                </div>
              </div>
            </button>

            <button
              onClick={() => setShowHandModal(true)}
              className={`flex w-full items-center justify-between rounded-xl border px-5 py-3 text-left text-white transition-all ${
                settings.handControl.enabled
                  ? 'border-emerald-400/50 bg-[#0B1A16]/92 hover:bg-[#102620]'
                  : 'border-cyan-500/30 bg-[#0A131F]/92 hover:border-cyan-400/60 hover:bg-[#101D2F]'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <Hand className="w-5 h-5 text-cyan-300" />
                <div>
                  <div className="font-display text-lg font-bold leading-none">HAND CONTROL</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    AI Webcam Gesture Driving · 10 Hand Gestures
                  </div>
                </div>
              </div>
              <span
                className={`text-[11px] font-bold uppercase ${
                  settings.handControl.enabled ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {settings.handControl.enabled ? 'Active' : 'Setup'}
              </span>
            </button>

            <button
              onClick={() => setShowSettingsModal(true)}
              className="flex w-full items-center justify-between rounded-xl border border-white/12 bg-[#0B111C]/92 px-5 py-3 text-left text-white hover:border-white/30 hover:bg-[#111A2B] transition-all"
            >
              <div className="flex items-center gap-3.5">
                <Settings className="w-5 h-5 text-slate-300" />
                <div>
                  <div className="font-display text-lg font-bold leading-none">SETTINGS</div>
                  <div className="text-xs text-slate-400 mt-0.5">Graphics, Chase/Ball Cam, Key Bindings &amp; Audio</div>
                </div>
              </div>
            </button>
          </div>

          {/* Main Menu Quick Car Body & Graphics Quality Bar + Footer */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#0B111C]/92 px-2.5 py-1.5">
                <span className="px-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Chassis
                </span>
                {(
                  [
                    ['striker', 'Sport Coupe'],
                    ['hyperion', 'Supercar'],
                    ['nomad', 'Hot Hatch'],
                  ] as [CarId, string][]
                ).map(([cid, label]) => (
                  <button
                    key={cid}
                    onClick={() => {
                      const next = { ...customization, carId: cid };
                      setCustomization(next);
                      if (mpRoom) {
                        mpClient.updateCar(next, playerName, avatarId);
                      }
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                      customization.carId === cid
                        ? 'bg-cyan-500 text-slate-950'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#0B111C]/92 px-2.5 py-1.5">
                <span className="px-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Graphics
                </span>
                {(['low', 'medium', 'high', 'ultra'] as GraphicsQuality[]).map((q) => (
                  <button
                    key={q}
                    onClick={() => setSettings((prev) => ({ ...prev, graphics: q }))}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold capitalize transition-colors ${
                      settings.graphics === q
                        ? 'bg-cyan-500 text-slate-950'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
              <div>
                Controls: WASD / Arrows or Hand Gestures · Space Jump · Shift Boost · C Ball Cam · V Rear View
              </div>
              <div>Ball Cam · Chase Cam · 10 Cars · 3-Player Online Party &amp; Voice</div>
            </footer>
          </div>
        </div>
      )}

      {/* Practice Arena Picker Modal */}
      {showPracticeModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-[#0C121D] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">Free Practice Arena</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Select a stadium for unlimited boost and aerial ball training
                </p>
              </div>
              <button
                onClick={() => setShowPracticeModal(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {ARENA_CATALOG.map((arena) => (
                <button
                  key={arena.id}
                  onClick={() =>
                    void startLocalMatch({
                      mode: 'practice',
                      arenaId: arena.id,
                      teamSize: 1,
                      difficulty: 'all_star',
                      matchDuration: 300,
                    })
                  }
                  className="rounded-xl border border-white/15 bg-white/[0.03] p-4 text-left hover:border-emerald-400 hover:bg-emerald-500/10 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display text-base font-bold text-white">{arena.name}</span>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: arena.accent }} />
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5">{arena.subtitle}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bot Match Setup Modal */}
      {showBotModal && (
        <BotSetupModal
          playerName={playerName}
          onChangePlayerName={setPlayerName}
          onStartMatch={(cfg) => void startLocalMatch({ mode: 'bots', ...cfg })}
          onClose={() => setShowBotModal(false)}
        />
      )}

      {/* Three-Player Fortnite-Style Online Party Modal */}
      {showMultiplayerModal && (
        <MultiplayerLobby
          playerName={playerName}
          avatarId={avatarId}
          customization={customization}
          onChangePlayerName={(name) => {
            setPlayerName(name);
            if (mpRoom) {
              mpClient.updateCar(customization, name, avatarId);
            }
          }}
          onChangeAvatar={(nextAv) => {
            setAvatarId(nextAv);
            if (mpRoom) {
              mpClient.updateCar(customization, playerName, nextAv);
            }
          }}
          onChangeCustomization={(next) => {
            setCustomization(next);
            if (mpRoom) {
              mpClient.updateCar(next, playerName, avatarId);
            }
          }}
          roomState={mpRoom}
          localPlayerId={mpClient.playerId}
          connectionStatus={mpStatus}
          pingMs={mpPing}
          errorMsg={mpError}
          noticeMsg={mpNotice}
          initialJoinCode={initialRoomCode}
          savedReconnectSession={!mpRoom ? savedSession : null}
          voiceState={voiceState}
          onToggleMic={() => {
            if (mpRoom && mpClient.playerId) {
              void voiceChat.toggleMicrophone(mpRoom.players, mpClient.playerId);
            }
          }}
          onToggleSelfMute={() => voiceChat.toggleSelfMute()}
          onTogglePushToTalk={() => voiceChat.setPushToTalk(!voiceState.pushToTalk)}
          onSetPttHeld={(held) => voiceChat.setPttHeld(held)}
          onTogglePeerMute={(pid) => voiceChat.togglePeerMute(pid)}
          onCreateRoom={(arenaId, matchDuration, gameMode, botDifficulty) => {
            setMpError(null);
            setMpNotice(null);
            void mpClient
              .createRoom({
                playerName: playerName.trim() || 'Player 1',
                avatarId,
                arenaId,
                matchDuration,
                gameMode,
                botDifficulty,
                customization,
              })
              .catch((err) => setMpError(String(err)));
          }}
          onJoinRoom={(code) => {
            setMpError(null);
            setMpNotice(null);
            void mpClient
              .joinRoom({
                code,
                playerName: playerName.trim() || 'Friend',
                avatarId,
                customization,
              })
              .catch((err) => setMpError(String(err)));
          }}
          onRejoinSaved={() => {
            if (!savedSession) return;
            setMpError(null);
            setMpNotice(null);
            void mpClient
              .reconnectRoom(savedSession.code, savedSession.playerToken)
              .catch((err) => {
                savePartySession(null);
                setSavedSession(null);
                setMpError(String(err));
              });
          }}
          onToggleReady={() => mpClient.toggleReady()}
          onSwitchTeam={() => mpClient.switchTeam()}
          onAssignTeam={(targetId, team) => mpClient.assignTeam(targetId, team)}
          onKickPlayer={(targetId) => mpClient.kickPlayer(targetId)}
          onCloseParty={() => {
            voiceChat.disableVoice();
            mpClient.closeParty();
            savePartySession(null);
            setSavedSession(null);
            setMpRoom(null);
          }}
          onUpdateSettings={(opts) => mpClient.updateRoomSettings(opts)}
          onStartMatch={() => mpClient.startMatch()}
          onReconnect={() => {
            setMpError(null);
            void mpClient.reconnectRoom().catch((err) => setMpError(String(err)));
          }}
          onLeaveRoom={() => {
            voiceChat.disableVoice();
            mpClient.leaveRoom();
            savePartySession(null);
            setSavedSession(null);
            setMpRoom(null);
            setShowMultiplayerModal(false);
          }}
          onClose={() => setShowMultiplayerModal(false)}
        />
      )}

      {/* AI Webcam Hand Gesture Control Modal */}
      {showHandModal && (
        <HandControlModal
          settings={settings.handControl}
          telemetry={handTelemetry}
          engine={handEngine}
          onChange={(nextHc) =>
            setSettings((prev) => ({
              ...prev,
              handControl: nextHc,
            }))
          }
          onCalibrate={() => handEngine.calibrateNeutral()}
          onClose={() => setShowHandModal(false)}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal
          settings={settings}
          onChange={setSettings}
          onOpenHandControl={() => {
            setShowSettingsModal(false);
            setShowHandModal(true);
          }}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
}
