import React from 'react';
import {
  Camera,
  Hand,
  LogOut,
  Mic,
  MicOff,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  Trophy,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { HandGestureEngine } from '../input/handGestureEngine.ts';
import type { ConnectionStatus } from '../net/multiplayerClient.ts';
import type { VoiceState } from '../net/voiceChat.ts';
import type {
  CameraViewMode,
  GameMode,
  HandTrackingTelemetry,
  MatchStateSnapshot,
  RoomPlayerInfo,
} from '../shared/types.ts';
import { HandControlDashboard } from './HandControlDashboard.tsx';

interface MatchHUDProps {
  snapshot: MatchStateSnapshot | null;
  localPlayerId: string;
  mode: GameMode;
  ballCam: boolean;
  lookBehind?: boolean;
  cameraViewMode: CameraViewMode;
  paused: boolean;
  connectionStatus?: ConnectionStatus;
  pingMs?: number;
  roomCode?: string | null;
  partyPlayers?: RoomPlayerInfo[];
  isPartyHost?: boolean;
  voiceState?: VoiceState;
  onToggleMic?: () => void;
  onToggleSelfMute?: () => void;
  onTogglePeerMute?: (playerId: string) => void;
  handControlEnabled: boolean;
  handEngine: HandGestureEngine;
  handTelemetry: HandTrackingTelemetry;
  onToggleBallCam: () => void;
  onTogglePause: () => void;
  onResetPractice: () => void;
  onOpenSettings: () => void;
  onOpenHandControl: () => void;
  onDisableHandControl: () => void;
  onCalibrateHand: () => void;
  onRematch: () => void;
  onBackToParty?: () => void;
  onReconnect?: () => void;
  onExitMatch: () => void;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export const MatchHUD: React.FC<MatchHUDProps> = ({
  snapshot,
  localPlayerId,
  mode,
  ballCam,
  lookBehind = false,
  cameraViewMode,
  paused,
  connectionStatus = 'connected',
  pingMs = 0,
  roomCode,
  partyPlayers = [],
  isPartyHost = true,
  voiceState,
  onToggleMic,
  onToggleSelfMute,
  onTogglePeerMute,
  handControlEnabled,
  handEngine,
  handTelemetry,
  onToggleBallCam,
  onTogglePause,
  onResetPractice,
  onOpenSettings,
  onOpenHandControl,
  onDisableHandControl,
  onCalibrateHand,
  onRematch,
  onBackToParty,
  onReconnect,
  onExitMatch,
}) => {
  const localCar = snapshot?.cars.find((c) => c.id === localPlayerId) ?? null;
  const boostVal = localCar ? Math.round(localCar.boost) : 0;
  const speedKmh = localCar
    ? Math.round(Math.hypot(localCar.vel.x, localCar.vel.y, localCar.vel.z) * 3.6)
    : 0;

  const isPractice = mode === 'practice';
  const phase = snapshot?.phase ?? 'countdown';
  const gameMode = snapshot?.gameMode ?? 'team_2v1';
  const isFfa = gameMode === 'ffa';

  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const arcFraction = 0.75;
  const maxArc = circumference * arcFraction;
  const filledArc = maxArc * (boostVal / 100);

  const blueCarName = snapshot?.cars.find((c) => c.team === 'blue')?.name ?? 'Cyan';
  const orangeCarName = snapshot?.cars.find((c) => c.team === 'orange')?.name ?? 'Orange';
  const emeraldCarName = snapshot?.cars.find((c) => c.team === 'emerald')?.name ?? 'Emerald';

  const getTeamScore = (team: 'blue' | 'orange' | 'emerald') => {
    if (!snapshot) return 0;
    if (team === 'blue') return snapshot.blueScore;
    if (team === 'emerald') return snapshot.emeraldScore;
    return snapshot.orangeScore;
  };

  const renderWinnerHeadline = () => {
    if (!snapshot) return 'Match Complete';
    if (isFfa) {
      const scores = [
        { team: 'blue' as const, label: blueCarName, score: snapshot.blueScore },
        { team: 'orange' as const, label: orangeCarName, score: snapshot.orangeScore },
        { team: 'emerald' as const, label: emeraldCarName, score: snapshot.emeraldScore },
      ].sort((a, b) => b.score - a.score);
      if (scores[0].score === scores[1].score) return 'Free-For-All Draw';
      return `${scores[0].label} Wins Free-For-All!`;
    }
    if (snapshot.blueScore > snapshot.orangeScore) {
      return gameMode === 'coop_3v3' ? 'Squad Victory!' : 'Blue Team Wins!';
    }
    if (snapshot.orangeScore > snapshot.blueScore) {
      return gameMode === 'coop_3v3' ? 'AI Squad Wins!' : 'Orange Team Wins!';
    }
    return 'Match Draw';
  };

  const remotePartyMembers = partyPlayers.filter((p) => p.id !== localPlayerId);

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-4 md:p-6">
      {/* Top Row: Quick Actions + Scoreboard + Party Network & Voice */}
      <div className="flex items-start justify-between gap-4">
        {/* Top-Left: Quick Actions & Optional Live Hand Control Dashboard */}
        <div className="flex flex-col items-start gap-3">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            <button
              onClick={onTogglePause}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0B1018]/90 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-white/25 hover:bg-[#131C2A] transition-colors whitespace-nowrap shrink-0"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>Pause</span>
            </button>
            <button
              onClick={onToggleBallCam}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase transition-colors whitespace-nowrap shrink-0 ${
                lookBehind
                  ? 'border-amber-400/60 bg-amber-500/25 text-amber-200'
                  : ballCam
                    ? 'border-sky-400/60 bg-sky-500/25 text-sky-100'
                    : 'border-white/15 bg-black/55 text-slate-200 hover:border-white/30'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>
                {lookBehind
                  ? 'REAR VIEW'
                  : cameraViewMode === 'first_person'
                    ? ballCam
                      ? 'COCKPIT BALL CAM'
                      : 'COCKPIT VIEW'
                    : ballCam
                      ? 'BALL CAM'
                      : 'CAR CAM'}
              </span>
            </button>
            <button
              onClick={onOpenHandControl}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                handControlEnabled
                  ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                  : 'border-white/10 bg-[#0B1018]/90 text-slate-300 hover:border-white/25'
              }`}
            >
              <Hand className="w-3.5 h-3.5" />
              <span>{handControlEnabled ? 'Hand Control: On' : 'Hand Control'}</span>
            </button>
            {isPractice && (
              <button
                onClick={onResetPractice}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B1018]/90 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-amber-400/40 hover:text-amber-200 transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Ball</span>
              </button>
            )}
          </div>

          {handControlEnabled && (
            <HandControlDashboard
              compact
              engine={handEngine}
              telemetry={handTelemetry}
              onCalibrate={onCalibrateHand}
              onOpenSettings={onOpenHandControl}
              onDisable={onDisableHandControl}
            />
          )}
        </div>

        {/* Top-Center: Scoreboard (FFA 3-Way vs Standard 2-Team) */}
        {!isPractice ? (
          isFfa ? (
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className="flex items-center overflow-hidden rounded-xl border border-white/15 bg-[#0A0F18]/95 shadow-2xl">
                <div className="flex items-center gap-2 bg-cyan-500/20 px-3.5 py-2 border-r border-white/10">
                  <span className="font-display text-[11px] font-bold tracking-wider text-cyan-300 uppercase max-w-[72px] truncate">
                    {blueCarName}
                  </span>
                  <span className="font-mono-num text-xl font-bold text-white leading-none">
                    {snapshot?.blueScore ?? 0}
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-orange-500/20 px-3.5 py-2 border-r border-white/10">
                  <span className="font-display text-[11px] font-bold tracking-wider text-orange-300 uppercase max-w-[72px] truncate">
                    {orangeCarName}
                  </span>
                  <span className="font-mono-num text-xl font-bold text-white leading-none">
                    {snapshot?.orangeScore ?? 0}
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-emerald-500/20 px-3.5 py-2 border-r border-white/10">
                  <span className="font-display text-[11px] font-bold tracking-wider text-emerald-300 uppercase max-w-[72px] truncate">
                    {emeraldCarName}
                  </span>
                  <span className="font-mono-num text-xl font-bold text-white leading-none">
                    {snapshot?.emeraldScore ?? 0}
                  </span>
                </div>
                <div className="px-4 py-2 text-center min-w-[78px]">
                  <div className="font-mono-num text-lg font-bold tracking-tight text-white leading-none">
                    {snapshot?.isOvertime ? '+OT' : formatTime(snapshot?.timeRemaining ?? 0)}
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                1v1v1 Triad Free-For-All
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className="flex items-stretch overflow-hidden rounded-xl border border-white/20 bg-[#080D16]/90 shadow-2xl">
                <div className="flex items-center gap-3 bg-gradient-to-r from-sky-600/85 to-sky-500/60 px-4 py-2 border-r border-white/15 min-w-[104px] justify-between">
                  <span className="font-display text-xs font-bold tracking-wider text-sky-100 uppercase">
                    {gameMode === 'coop_3v3' ? 'Squad' : 'Blue'}
                  </span>
                  <span className="font-mono-num text-2xl font-extrabold text-white leading-none drop-shadow">
                    {snapshot?.blueScore ?? 0}
                  </span>
                </div>
                <div className="px-5 py-2 text-center min-w-[96px] bg-[#0B111C]/95 flex flex-col justify-center">
                  <div className="font-mono-num text-xl font-extrabold tracking-tight text-white leading-none">
                    {snapshot?.isOvertime ? '+OT' : formatTime(snapshot?.timeRemaining ?? 0)}
                  </div>
                  {snapshot?.isOvertime && (
                    <div className="text-[10px] font-bold tracking-wider text-amber-400 uppercase mt-0.5">
                      Overtime
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 bg-gradient-to-l from-orange-600/85 to-orange-500/60 px-4 py-2 border-l border-white/15 min-w-[104px] justify-between">
                  <span className="font-mono-num text-2xl font-extrabold text-white leading-none drop-shadow">
                    {snapshot?.orangeScore ?? 0}
                  </span>
                  <span className="font-display text-xs font-bold tracking-wider text-orange-100 uppercase">
                    {gameMode === 'coop_3v3' ? 'AI' : 'Orange'}
                  </span>
                </div>
              </div>
              {mode === 'multiplayer' && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300 drop-shadow">
                  {gameMode === 'coop_3v3' ? '3-Player Co-Op vs AI' : 'Party 2v1 Teams'}
                </span>
              )}
            </div>
          )
        ) : (
          <div className="rounded-xl border border-white/15 bg-[#0A0F18]/95 px-5 py-2 text-center shrink-0">
            <div className="font-display text-sm font-bold tracking-wider text-cyan-300 uppercase">
              Free Practice
            </div>
          </div>
        )}

        {/* Top-Right: Multiplayer Network + Party Voice Bar */}
        <div className="pointer-events-auto flex flex-col items-end gap-2 min-w-[170px]">
          {mode === 'multiplayer' && (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0B1018]/90 px-3 py-2 text-xs">
                {roomCode && (
                  <span className="font-mono-num font-bold text-slate-300 border-r border-white/10 pr-2.5">
                    Party {roomCode}
                  </span>
                )}
                {connectionStatus === 'connected' ? (
                  <span className="flex items-center gap-1.5 text-emerald-400 font-medium whitespace-nowrap">
                    <Wifi className="w-3.5 h-3.5" />
                    <span className="font-mono-num">{pingMs} ms</span>
                  </span>
                ) : (
                  <button
                    onClick={onReconnect}
                    className="flex items-center gap-1.5 text-rose-400 hover:text-rose-300 font-semibold whitespace-nowrap"
                  >
                    <WifiOff className="w-3.5 h-3.5" />
                    <span>Reconnect</span>
                  </button>
                )}
              </div>

              {voiceState && onToggleMic && (
                <div className="flex flex-wrap items-center justify-end gap-1.5 rounded-lg border border-white/10 bg-[#0B1018]/90 px-2.5 py-1.5 text-[11px]">
                  <button
                    onClick={onToggleMic}
                    className={`flex items-center gap-1 rounded px-2 py-1 font-bold transition-colors ${
                      voiceState.micEnabled
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                        : 'bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {voiceState.micEnabled ? (
                      <Mic className="w-3 h-3" />
                    ) : (
                      <MicOff className="w-3 h-3" />
                    )}
                    <span>{voiceState.micEnabled ? 'Voice On' : 'Mic Off'}</span>
                  </button>

                  {voiceState.micEnabled && onToggleSelfMute && (
                    <button
                      onClick={onToggleSelfMute}
                      className={`rounded px-2 py-1 font-semibold ${
                        voiceState.selfMuted
                          ? 'bg-rose-500/25 text-rose-200'
                          : 'bg-white/10 text-slate-200'
                      }`}
                    >
                      {voiceState.selfMuted ? 'Muted' : voiceState.pushToTalk ? '[T] PTT' : 'Live'}
                    </button>
                  )}

                  {onTogglePeerMute &&
                    remotePartyMembers.map((rm) => {
                      const peerMuted = voiceState.mutedPeers.includes(rm.id);
                      return (
                        <button
                          key={rm.id}
                          onClick={() => onTogglePeerMute(rm.id)}
                          title={`${peerMuted ? 'Unmute' : 'Mute'} ${rm.name}`}
                          className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold ${
                            peerMuted
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-white/5 text-slate-300 hover:bg-white/10'
                          }`}
                        >
                          {peerMuted ? (
                            <VolumeX className="w-3 h-3" />
                          ) : (
                            <Volume2 className="w-3 h-3" />
                          )}
                          <span className="max-w-[54px] truncate">{rm.name}</span>
                        </button>
                      );
                    })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Center Overlays: Countdown / Goal Celebration / Disconnection Alert */}
      <div className="flex flex-col items-center justify-center my-auto">
        {phase === 'countdown' && snapshot && snapshot.countdown > 0 && (
          <div className="text-center animate-in fade-in zoom-in duration-150">
            <div className="font-display text-7xl md:text-8xl font-bold italic text-white drop-shadow-[0_4px_24px_rgba(6,182,212,0.75)]">
              {snapshot.countdown}
            </div>
            <div className="mt-2 text-xs font-semibold tracking-[0.25em] text-cyan-300 uppercase">
              Prepare for Kickoff
            </div>
          </div>
        )}

        {phase === 'goal_scored' && snapshot && (
          <div
            className={`rounded-2xl border px-10 py-6 text-center shadow-2xl ${
              snapshot.lastGoalTeam === 'blue'
                ? 'border-cyan-400/50 bg-[#071923]/95'
                : snapshot.lastGoalTeam === 'emerald'
                  ? 'border-emerald-400/50 bg-[#072116]/95'
                  : 'border-orange-400/50 bg-[#211108]/95'
            }`}
          >
            <div
              className={`font-display text-5xl md:text-6xl font-bold italic tracking-wider uppercase ${
                snapshot.lastGoalTeam === 'blue'
                  ? 'text-cyan-400'
                  : snapshot.lastGoalTeam === 'emerald'
                    ? 'text-emerald-400'
                    : 'text-orange-400'
              }`}
            >
              GOAL!
            </div>
            <div className="mt-2 flex items-center justify-center gap-3 text-sm font-medium text-slate-200">
              <span>Scored by {snapshot.lastGoalScorer}</span>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="font-mono-num text-amber-300">{snapshot.lastGoalSpeedKmh} km/h</span>
            </div>
          </div>
        )}

        {localCar && (localCar.demolishedTimer ?? 0) > 0 && phase === 'playing' && (
          <div className="rounded-xl border border-orange-500/50 bg-[#1B0D06]/92 px-7 py-4 text-center shadow-2xl">
            <div className="font-display text-2xl font-bold tracking-wider text-orange-400 uppercase">
              Demolished!
            </div>
            <div className="mt-1 font-mono-num text-sm font-semibold text-slate-200">
              Respawning in {(localCar.demolishedTimer ?? 0).toFixed(1)}s
            </div>
          </div>
        )}

        {mode === 'multiplayer' && connectionStatus === 'disconnected' && !paused && phase !== 'finished' && (
          <div className="pointer-events-auto mt-4 rounded-xl border border-rose-500/40 bg-[#1A0D12]/95 px-6 py-4 text-center">
            <p className="font-display text-lg font-bold text-rose-300">Connection Lost</p>
            <p className="text-xs text-slate-300 mt-1">Click Reconnect to rejoin your active party slot.</p>
            <button
              onClick={onReconnect}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-rose-500 px-4 py-2 text-xs font-bold text-white hover:bg-rose-400 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reconnect Now</span>
            </button>
          </div>
        )}
      </div>

      {/* Bottom Row: Compact Controls Hint + Camera Badge & Rocket League Boost Gauge */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col items-start gap-1.5">
          <div className="inline-flex items-center gap-1.5 rounded bg-black/55 border border-white/15 px-2.5 py-1 text-[10px] font-extrabold tracking-widest uppercase">
            <span
              className={`h-2 w-2 rounded-full ${
                lookBehind ? 'bg-amber-400' : ballCam ? 'bg-sky-400' : 'bg-slate-400'
              }`}
            />
            <span className={lookBehind ? 'text-amber-300' : ballCam ? 'text-sky-300' : 'text-slate-300'}>
              {lookBehind ? 'REAR VIEW' : ballCam ? 'BALL CAM' : 'CAR CAM'}
            </span>
          </div>

          <div className="hidden md:flex items-center gap-2 rounded-md border border-white/10 bg-black/45 px-2.5 py-1 text-[10px] text-slate-300/90">
            {handControlEnabled ? (
              <>
                <span><strong className="text-sky-300">Open Palm</strong> Gas</span>
                <span className="text-slate-600">·</span>
                <span><strong className="text-sky-300">Fist</strong> Brake</span>
                <span className="text-slate-600">·</span>
                <span><strong className="text-sky-300">Tilt L/R</strong> Steer</span>
                <span className="text-slate-600">·</span>
                <span><strong className="text-sky-300">2 Fingers</strong> Jump</span>
                <span className="text-slate-600">·</span>
                <span><strong className="text-sky-300">Thumb Up</strong> Boost</span>
                <span className="text-slate-600">·</span>
                <span><strong className="text-sky-300">Point</strong> Cam</span>
              </>
            ) : (
              <>
                <span><strong className="text-white">WASD</strong> Drive</span>
                <span className="text-slate-600">·</span>
                <span><strong className="text-white">Space</strong> Jump/Flip</span>
                <span className="text-slate-600">·</span>
                <span><strong className="text-white">Shift</strong> Boost</span>
                <span className="text-slate-600">·</span>
                <span><strong className="text-white">Ctrl</strong> Drift</span>
                <span className="text-slate-600">·</span>
                <span><strong className="text-white">C</strong> Cam</span>
                <span className="text-slate-600">·</span>
                <span><strong className="text-white">V</strong> Rear</span>
                <span className="text-slate-600">·</span>
                <span><strong className="text-white">R</strong> Reset</span>
              </>
            )}
          </div>
        </div>

        {/* Bottom-Right Rocket League Circular Orange Boost Gauge + KM/H + SUPERSONIC */}
        <div className="ml-auto flex items-end gap-3">
          <div className="flex flex-col items-end pb-2">
            {localCar?.isSupersonic && (
              <div className="mb-1 rounded bg-sky-500/25 border border-sky-400/50 px-2 py-0.5 text-[10px] font-extrabold tracking-widest text-sky-300 uppercase shadow">
                SUPERSONIC
              </div>
            )}
            <div className="rounded-lg bg-black/50 border border-white/10 px-2.5 py-1 text-right">
              <span className="font-mono-num text-lg font-extrabold text-white leading-none">{speedKmh}</span>
              <span className="ml-1 text-[9px] font-bold tracking-wider text-slate-400 uppercase">KM/H</span>
            </div>
          </div>

          <div className="relative w-28 h-28 flex items-center justify-center rounded-full bg-[#090D16]/85 border border-white/10 shadow-[0_0_24px_rgba(249,115,22,0.22)]">
            <svg className="w-28 h-28 -rotate-[225deg]" viewBox="0 0 112 112">
              <defs>
                <linearGradient id="rlBoostGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#EA580C" />
                  <stop offset="60%" stopColor="#F97316" />
                  <stop offset="100%" stopColor="#FACC15" />
                </linearGradient>
              </defs>
              <circle
                cx="56"
                cy="56"
                r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="10"
                strokeDasharray={`${maxArc} ${circumference}`}
                strokeLinecap="round"
              />
              <circle
                cx="56"
                cy="56"
                r={radius}
                fill="none"
                stroke="url(#rlBoostGrad)"
                strokeWidth="10"
                strokeDasharray={`${filledArc} ${circumference}`}
                strokeLinecap="round"
                style={{ filter: 'drop-shadow(0 0 6px rgba(249,115,22,0.75))' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono-num text-3xl font-black text-white leading-none drop-shadow">
                {boostVal}
              </span>
              <span className="text-[9px] font-bold tracking-widest text-orange-400 uppercase mt-1">
                BOOST
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Pause Modal */}
      {paused && phase !== 'finished' && (
        <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#0D131F] p-6 shadow-2xl">
            <h2 className="font-display text-2xl font-bold text-white">Match Paused</h2>
            <p className="text-xs text-slate-400 mt-1">
              {mode === 'multiplayer'
                ? 'Multiplayer party match continues live on the server.'
                : 'Simulation paused.'}
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                onClick={onTogglePause}
                className="flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-400 transition-colors"
              >
                <Play className="w-4 h-4" />
                <span>Resume Match</span>
              </button>
              {isPractice && (
                <button
                  onClick={() => {
                    onResetPractice();
                    onTogglePause();
                  }}
                  className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Reset Pitch</span>
                </button>
              )}
              <button
                onClick={onOpenHandControl}
                className="flex items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20 transition-colors"
              >
                <Hand className="w-4 h-4" />
                <span>Hand Control Settings</span>
              </button>
              <button
                onClick={onOpenSettings}
                className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
              >
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </button>
              <button
                onClick={onExitMatch}
                className="flex items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>{mode === 'multiplayer' ? 'Return to Party Lobby' : 'Leave Match'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Match Results Screen */}
      {phase === 'finished' && snapshot && (
        <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[#0C121D] p-6 md:p-8 shadow-2xl">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-400/30">
                <Trophy className="w-6 h-6" />
              </div>
              <h2 className="font-display text-3xl md:text-4xl font-bold mt-3 text-white">
                {renderWinnerHeadline()}
              </h2>
              {isFfa ? (
                <div className="mt-3 flex items-center gap-4 font-mono-num text-2xl md:text-3xl font-bold">
                  <span className="text-cyan-400">{snapshot.blueScore}</span>
                  <span className="text-slate-500 text-lg">:</span>
                  <span className="text-orange-400">{snapshot.orangeScore}</span>
                  <span className="text-slate-500 text-lg">:</span>
                  <span className="text-emerald-400">{snapshot.emeraldScore}</span>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-4 font-mono-num text-3xl font-bold">
                  <span className="text-cyan-400">{snapshot.blueScore}</span>
                  <span className="text-slate-500 text-xl">-</span>
                  <span className="text-orange-400">{snapshot.orangeScore}</span>
                </div>
              )}
            </div>

            <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-[#080C14]">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/10 bg-white/5 text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Player</th>
                    <th className="px-3 py-2.5 font-semibold">{isFfa ? 'Slot' : 'Team'}</th>
                    {isFfa && <th className="px-3 py-2.5 font-semibold text-right">Points</th>}
                    <th className="px-3 py-2.5 font-semibold text-right">Goals</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Shots</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Saves</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {[...snapshot.cars]
                    .sort((a, b) =>
                      isFfa ? getTeamScore(b.team) - getTeamScore(a.team) : b.goals - a.goals
                    )
                    .map((car) => (
                      <tr key={car.id} className={car.id === localPlayerId ? 'bg-white/[0.04]' : ''}>
                        <td className="px-4 py-2.5 font-semibold text-white">
                          {car.name}{' '}
                          {car.isBot ? <span className="text-slate-500 font-normal">(AI)</span> : ''}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={
                              car.team === 'blue'
                                ? 'text-cyan-400 font-semibold'
                                : car.team === 'emerald'
                                  ? 'text-emerald-400 font-semibold'
                                  : 'text-orange-400 font-semibold'
                            }
                          >
                            {car.team === 'blue'
                              ? 'Cyan'
                              : car.team === 'emerald'
                                ? 'Emerald'
                                : 'Orange'}
                          </span>
                        </td>
                        {isFfa && (
                          <td className="px-3 py-2.5 text-right font-mono-num font-bold text-white">
                            {getTeamScore(car.team)}
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-right font-mono-num text-slate-200">
                          {car.goals}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono-num text-slate-200">
                          {car.shots}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono-num text-slate-200">
                          {car.saves}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              {mode === 'multiplayer' && isPartyHost && onBackToParty ? (
                <button
                  onClick={onBackToParty}
                  className="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10 transition-colors whitespace-nowrap"
                >
                  Return All to Party
                </button>
              ) : (
                <button
                  onClick={onExitMatch}
                  className="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10 transition-colors whitespace-nowrap"
                >
                  {mode === 'multiplayer' ? 'Return to Party' : 'Main Menu'}
                </button>
              )}

              {(mode !== 'multiplayer' || isPartyHost) && (
                <button
                  onClick={onRematch}
                  className="flex items-center gap-2 rounded-lg bg-cyan-500 px-6 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-400 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Rematch</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
