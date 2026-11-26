import React, { useState } from 'react';
import { Bot, Play, X } from 'lucide-react';
import { ARENA_CATALOG, BOT_DIFFICULTIES } from '../shared/constants.ts';
import type { ArenaId, BotDifficulty } from '../shared/types.ts';

interface BotSetupModalProps {
  playerName: string;
  onChangePlayerName: (name: string) => void;
  onStartMatch: (config: {
    teamSize: number;
    difficulty: BotDifficulty;
    arenaId: ArenaId;
    matchDuration: number;
  }) => void;
  onClose: () => void;
}

export const BotSetupModal: React.FC<BotSetupModalProps> = ({
  playerName,
  onChangePlayerName,
  onStartMatch,
  onClose,
}) => {
  const [teamSize, setTeamSize] = useState<number>(1);
  const [difficulty, setDifficulty] = useState<BotDifficulty>('all_star');
  const [arenaId, setArenaId] = useState<ArenaId>('neon_stadium');
  const [matchDuration, setMatchDuration] = useState<number>(180);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[#0C121D] p-6 md:p-7 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-400 border border-cyan-400/30">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-white">Play With AI Bots</h2>
              <p className="text-xs text-slate-400">Configure team size, 4-tier utility AI, and stadium</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          {/* Player Name & Team Size */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Your Name</label>
              <input
                type="text"
                value={playerName}
                maxLength={18}
                onChange={(e) => onChangePlayerName(e.target.value)}
                placeholder="Striker"
                className="w-full rounded-lg border border-white/15 bg-[#070A10] px-3.5 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Match Format</label>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((sz) => (
                  <button
                    key={sz}
                    onClick={() => setTeamSize(sz)}
                    className={`rounded-lg border py-2 text-xs font-bold transition-colors ${
                      teamSize === sz
                        ? 'border-cyan-400 bg-cyan-500/20 text-white'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {sz}v{sz} ({sz * 2 - 1} Bots)
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 4 Bot Difficulty Levels */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">AI Difficulty Level</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {BOT_DIFFICULTIES.map((d, idx) => {
                const active = difficulty === d.id;
                return (
                  <button
                    key={d.id}
                    onClick={() => setDifficulty(d.id)}
                    className={`rounded-xl border p-2.5 text-left transition-all ${
                      active
                        ? 'border-cyan-400 bg-cyan-500/15 text-white'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <div className="text-[10px] font-mono-num text-cyan-400 font-bold">Tier {idx + 1}</div>
                    <div className="font-display text-sm font-bold mt-0.5">{d.label}</div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {BOT_DIFFICULTIES.find((d) => d.id === difficulty)?.description}
            </p>
          </div>

          {/* Arena Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">Stadium Arena</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {ARENA_CATALOG.map((arena) => {
                const active = arenaId === arena.id;
                return (
                  <button
                    key={arena.id}
                    onClick={() => setArenaId(arena.id)}
                    className={`rounded-xl border p-3 text-left transition-all ${
                      active
                        ? 'border-cyan-400 bg-cyan-500/15 text-white'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-sm font-bold">{arena.name}</span>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: arena.accent }} />
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">{arena.subtitle}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Match Length */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">Match Duration</label>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { sec: 120, label: '2 Minutes' },
                { sec: 180, label: '3 Minutes' },
                { sec: 300, label: '5 Minutes' },
              ].map((opt) => (
                <button
                  key={opt.sec}
                  onClick={() => setMatchDuration(opt.sec)}
                  className={`rounded-lg border py-2 text-xs font-bold transition-colors ${
                    matchDuration === opt.sec
                      ? 'border-cyan-400 bg-cyan-500/20 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-7 flex items-center justify-end gap-3 border-t border-white/10 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onStartMatch({ teamSize, difficulty, arenaId, matchDuration })}
            className="flex items-center gap-2 rounded-lg bg-cyan-500 px-6 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-400 transition-colors"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Kickoff Match</span>
          </button>
        </div>
      </div>
    </div>
  );
};
