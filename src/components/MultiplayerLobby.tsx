import React, { useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  Crown,
  Link2,
  Mic,
  MicOff,
  Play,
  Power,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  UserMinus,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { ConnectionStatus } from '../net/multiplayerClient.ts';
import type { VoiceState } from '../net/voiceChat.ts';
import {
  ACCESSORY_CATALOG,
  ARENA_CATALOG,
  AVATAR_CATALOG,
  BOT_DIFFICULTIES,
  CAR_CATALOG,
  CAR_MAP,
  COLOR_SWATCHES,
  PARTY_GAME_MODES,
} from '../shared/constants.ts';
import type {
  AccessoryId,
  ArenaId,
  AvatarId,
  BotDifficulty,
  CarCustomization,
  PartyGameMode,
  RoomPlayerInfo,
  RoomState,
  Team,
} from '../shared/types.ts';

interface MultiplayerLobbyProps {
  playerName: string;
  avatarId: AvatarId;
  customization: CarCustomization;
  onChangePlayerName: (name: string) => void;
  onChangeAvatar: (avatarId: AvatarId) => void;
  onChangeCustomization: (next: CarCustomization) => void;
  roomState: RoomState | null;
  localPlayerId: string | null;
  connectionStatus: ConnectionStatus;
  pingMs: number;
  errorMsg: string | null;
  noticeMsg: string | null;
  initialJoinCode?: string;
  savedReconnectSession?: { code: string; playerToken: string } | null;
  voiceState: VoiceState;
  onToggleMic: () => void;
  onToggleSelfMute: () => void;
  onTogglePushToTalk: () => void;
  onSetPttHeld: (held: boolean) => void;
  onTogglePeerMute: (playerId: string) => void;
  onCreateRoom: (
    arenaId: ArenaId,
    matchDuration: number,
    gameMode: PartyGameMode,
    botDifficulty: BotDifficulty
  ) => void;
  onJoinRoom: (code: string) => void;
  onRejoinSaved: () => void;
  onToggleReady: () => void;
  onSwitchTeam: () => void;
  onAssignTeam: (targetPlayerId: string, team: Team) => void;
  onKickPlayer: (targetPlayerId: string) => void;
  onCloseParty: () => void;
  onUpdateSettings: (opts: {
    arenaId?: ArenaId;
    matchDuration?: number;
    gameMode?: PartyGameMode;
    botDifficulty?: BotDifficulty;
  }) => void;
  onStartMatch: () => void;
  onReconnect: () => void;
  onLeaveRoom: () => void;
  onClose: () => void;
}

const SLOT_TITLES = ['SLOT 1 — PARTY LEADER', 'SLOT 2 — FRIEND', 'SLOT 3 — FRIEND'];

function getTeamBadgeStyle(team: Team, mode: PartyGameMode) {
  if (team === 'blue') {
    return {
      label: mode === 'ffa' ? 'Cyan Goal' : mode === 'coop_3v3' ? 'Blue Squad' : 'Team Blue',
      className: 'border-cyan-400/40 bg-cyan-500/15 text-cyan-300',
    };
  }
  if (team === 'emerald') {
    return {
      label: 'Emerald Goal',
      className: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300',
    };
  }
  return {
    label: mode === 'ffa' ? 'Orange Goal' : 'Team Orange',
    className: 'border-orange-400/40 bg-orange-500/15 text-orange-300',
  };
}

export const MultiplayerLobby: React.FC<MultiplayerLobbyProps> = ({
  playerName,
  avatarId,
  customization,
  onChangePlayerName,
  onChangeAvatar,
  onChangeCustomization,
  roomState,
  localPlayerId,
  connectionStatus,
  pingMs,
  errorMsg,
  noticeMsg,
  initialJoinCode = '',
  savedReconnectSession,
  voiceState,
  onToggleMic,
  onToggleSelfMute,
  onTogglePushToTalk,
  onSetPttHeld,
  onTogglePeerMute,
  onCreateRoom,
  onJoinRoom,
  onRejoinSaved,
  onToggleReady,
  onSwitchTeam,
  onAssignTeam,
  onKickPlayer,
  onCloseParty,
  onUpdateSettings,
  onStartMatch,
  onReconnect,
  onLeaveRoom,
  onClose,
}) => {
  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const [createMode, setCreateMode] = useState<PartyGameMode>('team_2v1');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showLoadoutBar, setShowLoadoutBar] = useState(false);

  const localPlayer = roomState?.players.find((p) => p.id === localPlayerId) ?? null;
  const isHost = Boolean(localPlayer?.isHost);

  const copyRoomCode = async () => {
    if (!roomState) return;
    try {
      await navigator.clipboard.writeText(roomState.code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // ignore
    }
  };

  const copyInviteLink = async () => {
    if (!roomState) return;
    try {
      const url = `${window.location.origin}?room=${roomState.code}`;
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // ignore
    }
  };

  // Map players into explicit 3 party slots (Slot 1 = leader if index 0, Slots 2 & 3 = friends)
  const slots: (RoomPlayerInfo | null)[] = [null, null, null];
  if (roomState) {
    const sorted = [...roomState.players].sort((a, b) => a.slotIndex - b.slotIndex);
    for (const p of sorted) {
      if (p.slotIndex >= 0 && p.slotIndex < 3 && !slots[p.slotIndex]) {
        slots[p.slotIndex] = p;
      } else {
        const emptyIdx = slots.findIndex((s) => s === null);
        if (emptyIdx !== -1) slots[emptyIdx] = p;
      }
    }
  }

  const readyCount = roomState ? roomState.players.filter((p) => p.ready).length : 0;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-3 md:p-5">
      <div className="w-full max-w-5xl rounded-2xl border border-white/15 bg-[#0B111C] p-5 md:p-6 shadow-2xl max-h-[94vh] overflow-y-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-400 border border-cyan-400/30">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-white leading-tight">
                {roomState ? 'Party Lobby — 3-Player Online' : 'Play With Friends — 3-Player Party'}
              </h2>
              <p className="text-xs text-slate-400">
                Real-time authoritative multiplayer across 3 separate computers · FFA, 2v1 &amp; Co-Op
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-medium rounded-lg border border-white/10 bg-[#070B12] px-3 py-1.5">
              {connectionStatus === 'connected' ? (
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <Wifi className="w-3.5 h-3.5" />
                  <span>Online {pingMs > 0 ? `(${pingMs} ms)` : ''}</span>
                </span>
              ) : connectionStatus === 'connecting' ? (
                <span className="text-amber-400">Connecting...</span>
              ) : (
                <span className="flex items-center gap-1.5 text-slate-400">
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>Offline</span>
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Minimize party lobby"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs font-medium text-rose-200">
            {errorMsg}
          </div>
        )}

        {noticeMsg && (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-200">
            {noticeMsg}
          </div>
        )}

        {!roomState ? (
          /* Pre-Party: Identity + Create or Join 3-Player Party */
          <div className="mt-5 space-y-5">
            {/* Username + Avatar Picker */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Your Display Name
                </label>
                <input
                  type="text"
                  value={playerName}
                  maxLength={18}
                  onChange={(e) => onChangePlayerName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full rounded-lg border border-white/15 bg-[#070A10] px-4 py-2.5 text-sm font-semibold text-white focus:border-cyan-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Party Avatar
                </label>
                <div className="grid grid-cols-6 gap-1.5">
                  {AVATAR_CATALOG.map((av) => {
                    const active = avatarId === av.id;
                    return (
                      <button
                        key={av.id}
                        onClick={() => onChangeAvatar(av.id)}
                        className={`flex flex-col items-center gap-1 rounded-lg border py-1.5 px-1 transition-all ${
                          active
                            ? 'border-cyan-400 bg-cyan-500/15 text-white'
                            : 'border-white/10 bg-[#070A10] text-slate-400 hover:border-white/25'
                        }`}
                      >
                        <span
                          className="flex h-6 w-6 items-center justify-center rounded font-display text-[11px] font-bold text-slate-950"
                          style={{ backgroundColor: av.accent }}
                        >
                          {av.badge}
                        </span>
                        <span className="text-[10px] font-medium truncate w-full text-center">
                          {av.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {savedReconnectSession && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3">
                <div className="text-xs">
                  <span className="font-bold text-emerald-300">Active Party Session Found: </span>
                  <span className="font-mono-num font-bold text-white tracking-wider">
                    {savedReconnectSession.code}
                  </span>
                </div>
                <button
                  onClick={onRejoinSaved}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Rejoin Party</span>
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Create 3-Player Party */}
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.06] p-5 flex flex-col justify-between">
                <div>
                  <h3 className="font-display text-lg font-bold text-white">Create 3-Player Party</h3>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    Become Party Leader, choose a game mode, and invite 2 friends from any computer.
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-1.5">
                    {PARTY_GAME_MODES.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setCreateMode(m.id)}
                        className={`rounded-lg border px-2 py-2 text-[11px] font-bold transition-colors ${
                          createMode === m.id
                            ? 'border-cyan-400 bg-cyan-500/20 text-white'
                            : 'border-white/10 bg-[#070B12] text-slate-400 hover:border-white/25'
                        }`}
                      >
                        {m.shortLabel}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => onCreateRoom('neon_stadium', 180, createMode, 'all_star')}
                  className="mt-5 w-full rounded-lg bg-cyan-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-400 transition-colors"
                >
                  Create Party &amp; Get Code
                </button>
              </div>

              {/* Join Friend's Party */}
              <div className="rounded-xl border border-white/15 bg-white/[0.03] p-5 flex flex-col justify-between">
                <div>
                  <h3 className="font-display text-lg font-bold text-white">Join Friend&apos;s Party</h3>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    Enter the 6-character party code shared by the Party Leader to take Slot 2 or Slot 3.
                  </p>
                  <input
                    type="text"
                    value={joinCode}
                    maxLength={6}
                    onChange={(e) =>
                      setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    placeholder="PARTY CODE (E.G. K7M4P9)"
                    className="mt-4 w-full rounded-lg border border-white/15 bg-[#070A10] px-4 py-2.5 text-center font-mono-num text-base font-bold tracking-[0.25em] text-white uppercase focus:border-orange-400 focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => onJoinRoom(joinCode)}
                  disabled={joinCode.trim().length < 4}
                  className="mt-4 w-full rounded-lg bg-orange-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-orange-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Join Party
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Active Fortnite-Style 3-Slot Party Lobby */
          <div className="mt-5 space-y-5">
            {/* Party Code + Invite Banner */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-cyan-500/30 bg-[#08131E] p-4">
              <div className="flex items-center gap-4">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">
                    Party Code ({roomState.players.length}/{roomState.maxPlayers} Players)
                  </div>
                  <div className="font-mono-num text-3xl font-bold tracking-[0.22em] text-white mt-0.5">
                    {roomState.code}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={copyRoomCode}
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/10 transition-colors whitespace-nowrap"
                >
                  {copiedCode ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedCode ? 'CODE COPIED' : 'COPY PARTY CODE'}</span>
                </button>

                <button
                  onClick={copyInviteLink}
                  className="flex items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-3.5 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/25 transition-colors whitespace-nowrap"
                >
                  {copiedLink ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Link2 className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedLink ? 'INVITE LINK COPIED' : 'INVITE FRIEND'}</span>
                </button>

                <button
                  onClick={() => setShowLoadoutBar((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-bold transition-colors whitespace-nowrap ${
                    showLoadoutBar
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>My Car &amp; Profile</span>
                </button>

                {connectionStatus === 'disconnected' && (
                  <button
                    onClick={onReconnect}
                    className="flex items-center gap-1.5 rounded-lg bg-rose-500 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-400 transition-colors whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Reconnect</span>
                  </button>
                )}
              </div>
            </div>

            {/* Collapsible Quick Loadout Editor inside Party */}
            {showLoadoutBar && (
              <div className="rounded-xl border border-amber-400/25 bg-[#090F1A] p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    maxLength={18}
                    value={playerName}
                    onChange={(e) => onChangePlayerName(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-[#060910] px-3 py-1.5 text-xs font-semibold text-white focus:border-cyan-400 focus:outline-none"
                  />
                  <div className="mt-2 flex gap-1">
                    {AVATAR_CATALOG.map((av) => (
                      <button
                        key={av.id}
                        onClick={() => onChangeAvatar(av.id)}
                        title={av.label}
                        className={`h-6 w-6 rounded font-display text-[10px] font-bold text-slate-950 border-2 ${
                          avatarId === av.id ? 'border-white scale-105' : 'border-transparent opacity-70'
                        }`}
                        style={{ backgroundColor: av.accent }}
                      >
                        {av.badge}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Vehicle
                  </label>
                  <select
                    value={customization.carId}
                    onChange={(e) => {
                      const nextDef = CAR_CATALOG.find((c) => c.id === e.target.value);
                      if (nextDef) {
                        onChangeCustomization({
                          ...customization,
                          carId: nextDef.id,
                        });
                      }
                    }}
                    className="w-full rounded-lg border border-white/15 bg-[#060910] px-2.5 py-2 text-xs font-semibold text-white focus:border-cyan-400 focus:outline-none"
                  >
                    {CAR_CATALOG.map((car) => (
                      <option key={car.id} value={car.id}>
                        {car.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Accessory
                  </label>
                  <select
                    value={customization.accessory ?? 'none'}
                    onChange={(e) =>
                      onChangeCustomization({
                        ...customization,
                        accessory: e.target.value as AccessoryId,
                      })
                    }
                    className="w-full rounded-lg border border-white/15 bg-[#060910] px-2.5 py-2 text-xs font-semibold text-white focus:border-cyan-400 focus:outline-none"
                  >
                    {ACCESSORY_CATALOG.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Primary Paint
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLOR_SWATCHES.slice(0, 8).map((hex) => (
                      <button
                        key={hex}
                        onClick={() =>
                          onChangeCustomization({ ...customization, primaryColor: hex })
                        }
                        className={`h-6 w-6 rounded border-2 ${
                          customization.primaryColor.toLowerCase() === hex.toLowerCase()
                            ? 'border-white scale-110'
                            : 'border-white/20'
                        }`}
                        style={{ backgroundColor: hex }}
                        aria-label={`Color ${hex}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 3 Fortnite-Style Party Slot Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {slots.map((slotPlayer, idx) => {
                const slotLabel = slotPlayer?.isHost ? 'SLOT 1 — PARTY LEADER' : SLOT_TITLES[idx];
                if (!slotPlayer) {
                  return (
                    <div
                      key={`empty_${idx}`}
                      className="flex flex-col items-center justify-between rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-5 text-center min-h-[210px]"
                    >
                      <div className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                        {SLOT_TITLES[idx]}
                      </div>
                      <div className="my-auto flex flex-col items-center gap-2 py-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-500">
                          <UserPlus className="w-5 h-5" />
                        </div>
                        <div className="text-sm font-bold text-slate-400">Open Party Slot</div>
                        <div className="text-[11px] text-slate-500">
                          Share code <span className="font-mono-num text-slate-300">{roomState.code}</span> with a friend
                        </div>
                      </div>
                      <button
                        onClick={copyInviteLink}
                        className="w-full rounded-lg border border-white/10 bg-white/[0.04] py-2 text-xs font-semibold text-slate-300 hover:bg-white/10 transition-colors"
                      >
                        Invite Friend
                      </button>
                    </div>
                  );
                }

                const av = AVATAR_CATALOG.find((a) => a.id === slotPlayer.avatarId) ?? AVATAR_CATALOG[0];
                const carDef = CAR_MAP[slotPlayer.customization.carId];
                const accDef = ACCESSORY_CATALOG.find(
                  (a) => a.id === (slotPlayer.customization.accessory ?? 'none')
                );
                const teamStyle = getTeamBadgeStyle(slotPlayer.team, roomState.gameMode);
                const isSelf = slotPlayer.id === localPlayerId;
                const peerMuted = voiceState.mutedPeers.includes(slotPlayer.id);

                return (
                  <div
                    key={slotPlayer.id}
                    className={`flex flex-col justify-between rounded-2xl border p-4 min-h-[210px] transition-all ${
                      slotPlayer.ready
                        ? 'border-emerald-400/50 bg-[#0A1716]'
                        : isSelf
                          ? 'border-cyan-400/45 bg-[#091420]'
                          : 'border-white/15 bg-[#090E17]'
                    }`}
                  >
                    {/* Slot Top Header */}
                    <div>
                      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-slate-300">
                          {slotPlayer.isHost && <Crown className="w-3.5 h-3.5 text-amber-400" />}
                          <span>{slotLabel}</span>
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                            slotPlayer.ready
                              ? 'bg-emerald-500 text-slate-950'
                              : 'bg-white/10 text-slate-300'
                          }`}
                        >
                          {slotPlayer.ready ? 'READY' : 'NOT READY'}
                        </span>
                      </div>

                      {/* Avatar + Username + Online status */}
                      <div className="mt-3 flex items-center gap-3">
                        <div
                          className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/20 font-display text-base font-bold text-slate-950 shrink-0 shadow"
                          style={{ backgroundColor: av.accent }}
                        >
                          {av.badge}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-display text-base font-bold text-white truncate">
                              {slotPlayer.name}
                            </span>
                            {isSelf && (
                              <span className="text-[10px] font-bold text-cyan-400 uppercase">
                                (You)
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px]">
                            <span
                              className={`flex items-center gap-1 font-medium ${
                                slotPlayer.connected ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  slotPlayer.connected ? 'bg-emerald-400' : 'bg-rose-400'
                                }`}
                              />
                              {slotPlayer.connected ? 'Connected' : 'Disconnected'}
                            </span>
                            {slotPlayer.voiceActive && (
                              <span
                                className={`flex items-center gap-0.5 ${
                                  slotPlayer.voiceMuted ? 'text-amber-400' : 'text-cyan-300'
                                }`}
                              >
                                {slotPlayer.voiceMuted ? (
                                  <MicOff className="w-3 h-3" />
                                ) : (
                                  <Mic className="w-3 h-3" />
                                )}
                                <span>{slotPlayer.voiceMuted ? 'Muted' : 'Mic On'}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Car, Color Swatch & Team Badge */}
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/35 p-2.5 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-3.5 w-3.5 rounded-sm border border-white/30 shrink-0"
                              style={{ backgroundColor: slotPlayer.customization.primaryColor }}
                              title="Primary Car Color"
                            />
                            <span className="font-semibold text-white truncate">
                              {carDef?.name ?? slotPlayer.customization.carId}
                            </span>
                          </div>
                          {accDef && accDef.id !== 'none' && (
                            <span className="text-[10px] font-medium text-amber-300 truncate">
                              {accDef.name}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span
                            className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${teamStyle.className}`}
                          >
                            {teamStyle.label}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {slotPlayer.customization.primaryColor.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Slot Controls (Team Assign, Mute Peer, Kick) */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5">
                      {isHost && roomState.gameMode === 'team_2v1' && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onAssignTeam(slotPlayer.id, 'blue')}
                            className={`rounded px-2 py-1 text-[10px] font-bold transition-colors ${
                              slotPlayer.team === 'blue'
                                ? 'bg-cyan-500 text-slate-950'
                                : 'bg-white/10 text-slate-300 hover:bg-white/20'
                            }`}
                          >
                            Blue
                          </button>
                          <button
                            onClick={() => onAssignTeam(slotPlayer.id, 'orange')}
                            className={`rounded px-2 py-1 text-[10px] font-bold transition-colors ${
                              slotPlayer.team === 'orange'
                                ? 'bg-orange-500 text-slate-950'
                                : 'bg-white/10 text-slate-300 hover:bg-white/20'
                            }`}
                          >
                            Orange
                          </button>
                        </div>
                      )}

                      {!isSelf && (
                        <div className="ml-auto flex items-center gap-1.5">
                          <button
                            onClick={() => onTogglePeerMute(slotPlayer.id)}
                            className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                              peerMuted
                                ? 'border-rose-400/50 bg-rose-500/15 text-rose-300'
                                : 'border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'
                            }`}
                            title={peerMuted ? 'Unmute Player' : 'Mute Player'}
                          >
                            {peerMuted ? (
                              <VolumeX className="w-3 h-3" />
                            ) : (
                              <Volume2 className="w-3 h-3" />
                            )}
                            <span>{peerMuted ? 'Muted' : 'Mute'}</span>
                          </button>

                          {isHost && (
                            <button
                              onClick={() => onKickPlayer(slotPlayer.id)}
                              className="flex items-center gap-1 rounded border border-rose-500/35 bg-rose-500/10 px-2 py-1 text-[10px] font-bold text-rose-300 hover:bg-rose-500/25 transition-colors"
                              title="Kick Player from Party"
                            >
                              <UserMinus className="w-3 h-3" />
                              <span>Kick</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Party Mode, Stadium & Voice Chat Controls */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Mode Selector */}
              <div className="lg:col-span-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Three-Player Game Mode
                  </span>
                  {!isHost && (
                    <span className="text-[11px] text-slate-400">
                      Controlled by Party Leader
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {PARTY_GAME_MODES.map((m) => {
                    const active = roomState.gameMode === m.id;
                    return (
                      <button
                        key={m.id}
                        disabled={!isHost}
                        onClick={() => onUpdateSettings({ gameMode: m.id })}
                        className={`rounded-xl border p-3 text-left transition-all ${
                          active
                            ? 'border-cyan-400 bg-cyan-500/15 text-white'
                            : 'border-white/10 bg-[#070B12] text-slate-300'
                        } ${!isHost ? 'opacity-80 cursor-default' : 'hover:border-white/30'}`}
                      >
                        <div className="font-display text-sm font-bold">{m.label}</div>
                        <div className="text-[11px] text-slate-400 mt-1 leading-snug">
                          {m.description}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Arena, Length, and optional Co-Op Bot Difficulty */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Stadium Arena
                    </label>
                    <div className="grid grid-cols-3 gap-1">
                      {ARENA_CATALOG.map((a) => (
                        <button
                          key={a.id}
                          disabled={!isHost}
                          onClick={() => onUpdateSettings({ arenaId: a.id })}
                          className={`rounded border px-1.5 py-1.5 text-[10px] font-bold truncate ${
                            roomState.arenaId === a.id
                              ? 'border-cyan-400 bg-cyan-500/20 text-white'
                              : 'border-white/10 bg-[#070B12] text-slate-400'
                          }`}
                        >
                          {a.name.replace(' Stadium', '').replace(' Arena', '')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Match Length
                    </label>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { sec: 120, label: '2m' },
                        { sec: 180, label: '3m' },
                        { sec: 300, label: '5m' },
                      ].map((d) => (
                        <button
                          key={d.sec}
                          disabled={!isHost}
                          onClick={() => onUpdateSettings({ matchDuration: d.sec })}
                          className={`rounded border px-2 py-1.5 text-[11px] font-bold ${
                            roomState.matchDuration === d.sec
                              ? 'border-cyan-400 bg-cyan-500/20 text-white'
                              : 'border-white/10 bg-[#070B12] text-slate-400'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {roomState.gameMode === 'coop_3v3' ? (
                    <div>
                      <label className="flex items-center gap-1 text-[11px] font-semibold text-orange-300 mb-1">
                        <Bot className="w-3 h-3" />
                        <span>AI Opponent Difficulty</span>
                      </label>
                      <select
                        disabled={!isHost}
                        value={roomState.botDifficulty}
                        onChange={(e) =>
                          onUpdateSettings({ botDifficulty: e.target.value as BotDifficulty })
                        }
                        className="w-full rounded border border-white/15 bg-[#070B12] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-75"
                      >
                        {BOT_DIFFICULTIES.map((bd) => (
                          <option key={bd.id} value={bd.id}>
                            {bd.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="flex items-end">
                      {roomState.gameMode === 'team_2v1' && (
                        <button
                          onClick={onSwitchTeam}
                          className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors"
                        >
                          Switch My Team (Blue / Orange)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* WebRTC Party Voice Chat Panel (Strictly Opt-In) */}
              <div className="rounded-xl border border-white/10 bg-[#08101A] p-4 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                      <Shield className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Party Voice Chat (WebRTC)</span>
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase ${
                        voiceState.status === 'active'
                          ? 'text-emerald-400'
                          : voiceState.status === 'denied' || voiceState.status === 'unsupported'
                            ? 'text-rose-400'
                            : 'text-slate-400'
                      }`}
                    >
                      {voiceState.status === 'active'
                        ? voiceState.isSpeaking
                          ? 'Speaking'
                          : 'Connected'
                        : voiceState.status === 'requesting'
                          ? 'Connecting'
                          : voiceState.status === 'denied'
                            ? 'Mic Denied'
                            : 'Off'}
                    </span>
                  </div>

                  {voiceState.error && (
                    <p className="mt-2 rounded bg-rose-500/15 border border-rose-500/30 px-2.5 py-1.5 text-[11px] text-rose-200">
                      {voiceState.error}
                    </p>
                  )}

                  {!voiceState.error && (
                    <p className="mt-1.5 text-[11px] text-slate-400 leading-snug">
                      Microphone is off by default. Enable to talk with party members over WebRTC.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={onToggleMic}
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                        voiceState.micEnabled
                          ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                          : 'border border-white/15 bg-white/5 text-white hover:bg-white/10'
                      }`}
                    >
                      {voiceState.micEnabled ? (
                        <Mic className="w-3.5 h-3.5" />
                      ) : (
                        <MicOff className="w-3.5 h-3.5" />
                      )}
                      <span>{voiceState.micEnabled ? 'Voice Active' : 'Enable Mic'}</span>
                    </button>

                    {voiceState.micEnabled && (
                      <button
                        onClick={onToggleSelfMute}
                        className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                          voiceState.selfMuted
                            ? 'border-rose-400/50 bg-rose-500/20 text-rose-200'
                            : 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
                        }`}
                      >
                        {voiceState.selfMuted ? 'Unmute' : 'Mute'}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={onTogglePushToTalk}
                      className={`flex-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                        voiceState.pushToTalk
                          ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                          : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-white'
                      }`}
                    >
                      Push-to-Talk [T]: {voiceState.pushToTalk ? 'ON' : 'OFF'}
                    </button>

                    {voiceState.micEnabled && voiceState.pushToTalk && (
                      <button
                        onPointerDown={() => onSetPttHeld(true)}
                        onPointerUp={() => onSetPttHeld(false)}
                        onPointerLeave={() => onSetPttHeld(false)}
                        className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors ${
                          voiceState.pttHeld
                            ? 'bg-amber-400 text-slate-950'
                            : 'border border-amber-400/40 bg-amber-500/15 text-amber-200'
                        }`}
                      >
                        Hold Talk
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={onLeaveRoom}
                  className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs font-bold text-rose-300 hover:bg-rose-500/20 transition-colors"
                >
                  LEAVE PARTY
                </button>
                {isHost && (
                  <button
                    onClick={onCloseParty}
                    className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-600/20 px-4 py-2.5 text-xs font-bold text-rose-200 hover:bg-rose-600/35 transition-colors"
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>CLOSE PARTY</span>
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-slate-400">
                  <strong className="text-white">{readyCount}/{roomState.players.length}</strong> Ready
                </span>

                <button
                  onClick={onToggleReady}
                  className={`rounded-lg px-5 py-2.5 text-xs font-bold transition-colors ${
                    localPlayer?.ready
                      ? 'border border-emerald-400 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                      : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                  }`}
                >
                  {localPlayer?.ready ? 'READY ✓' : 'READY'}
                </button>

                {isHost ? (
                  <button
                    onClick={onStartMatch}
                    className="flex items-center gap-2 rounded-lg bg-cyan-500 px-6 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-400 transition-colors"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>START MATCH</span>
                  </button>
                ) : (
                  <div className="text-xs font-medium text-slate-400">
                    Waiting for Party Leader to start...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
