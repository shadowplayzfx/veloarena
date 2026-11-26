import React, { useState } from 'react';
import { ArrowLeft, Check, Disc, Flame, Palette, RotateCcw, Sparkles, User } from 'lucide-react';
import {
  ACCESSORY_CATALOG,
  AVATAR_CATALOG,
  BOOST_TRAIL_CATALOG,
  CAR_CATALOG,
  COLOR_SWATCHES,
  HERO_CAR_IDS,
  PAINT_FINISH_CATALOG,
  WHEEL_STYLE_CATALOG,
} from '../shared/constants.ts';
import type { AvatarId, CarCustomization, PaintFinish, WheelStyleId } from '../shared/types.ts';

interface GarageViewProps {
  playerName: string;
  avatarId: AvatarId;
  customization: CarCustomization;
  previewBoost: boolean;
  onChangePlayerName: (name: string) => void;
  onChangeAvatar: (avatarId: AvatarId) => void;
  onTogglePreviewBoost: () => void;
  onChange: (next: CarCustomization) => void;
  onBack: () => void;
}

export const GarageView: React.FC<GarageViewProps> = ({
  playerName,
  avatarId,
  customization,
  previewBoost,
  onChangePlayerName,
  onChangeAvatar,
  onTogglePreviewBoost,
  onChange,
  onBack,
}) => {
  const [activeTab, setActiveTab] = useState<
    'vehicles' | 'paint' | 'wheels' | 'boost' | 'accessories' | 'profile'
  >('vehicles');
  const currentCar = CAR_CATALOG.find((c) => c.id === customization.carId) ?? CAR_CATALOG[0];
  const currentAvatar = AVATAR_CATALOG.find((a) => a.id === avatarId) ?? AVATAR_CATALOG[0];
  const currentFinish: PaintFinish = customization.paintFinish ?? 'metallic';
  const currentWheels: WheelStyleId = customization.wheelStyle ?? 'sport_5';
  const currentAccent = customization.teamAccent ?? customization.primaryColor;

  const handleSelectCar = (carId: CarCustomization['carId']) => {
    const def = CAR_CATALOG.find((c) => c.id === carId) ?? CAR_CATALOG[0];
    onChange({
      carId: def.id,
      primaryColor: def.defaultPrimary,
      secondaryColor: def.defaultSecondary,
      paintFinish: customization.paintFinish ?? 'metallic',
      wheelStyle: customization.wheelStyle ?? 'sport_5',
      teamAccent: customization.teamAccent,
      boostTrail: def.defaultTrail,
      accessory: customization.accessory ?? 'none',
    });
  };

  const handleResetDefaults = () => {
    onChange({
      carId: currentCar.id,
      primaryColor: currentCar.defaultPrimary,
      secondaryColor: currentCar.defaultSecondary,
      paintFinish: 'metallic',
      wheelStyle: 'sport_5',
      teamAccent: undefined,
      boostTrail: currentCar.defaultTrail,
      accessory: 'none',
    });
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-5 md:p-7">
      {/* Top Bar */}
      <div className="flex items-start justify-between gap-4">
        <div className="pointer-events-auto flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 rounded-lg border border-white/15 bg-[#0C121E]/95 px-4 py-2.5 text-sm font-semibold text-white hover:border-white/30 hover:bg-[#131D2E] transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Menu</span>
          </button>
          <div className="flex items-center gap-3">
            <div
              className="hidden sm:flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 font-display text-sm font-bold text-slate-950 shrink-0"
              style={{ backgroundColor: currentAvatar.accent }}
            >
              {currentAvatar.badge}
            </div>
            <div>
              <h1 className="font-display text-2xl md:text-3xl font-bold text-white leading-tight">
                {currentCar.name}
              </h1>
              <p className="text-xs text-slate-400">
                {playerName || 'Striker'} · {currentCar.archetype} · Drag 3D viewport to orbit
              </p>
            </div>
          </div>
        </div>

        {/* Top-Right Car Specs + Live Boost Test */}
        <div className="pointer-events-auto flex flex-col items-end gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={onTogglePreviewBoost}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                previewBoost
                  ? 'border-amber-400 bg-amber-500 text-slate-950'
                  : 'border-white/15 bg-[#0C121E]/95 text-slate-200 hover:border-amber-400/50'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>{previewBoost ? 'Boost Active' : 'Test Boost'}</span>
            </button>
            <button
              onClick={handleResetDefaults}
              className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#0C121E]/95 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Default Loadout</span>
            </button>
          </div>

          <div className="hidden md:block w-64 rounded-xl border border-white/10 bg-[#0B1018]/92 p-3.5 text-xs">
            <p className="text-slate-300 leading-relaxed mb-3">{currentCar.tagline}</p>
            <div className="space-y-2">
              {(
                [
                  ['Top Speed', currentCar.stats.topSpeed],
                  ['Acceleration', currentCar.stats.acceleration],
                  ['Handling', currentCar.stats.handling],
                  ['Aerial Control', currentCar.stats.aerial],
                ] as const
              ).map(([label, val]) => (
                <div key={label} className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">{label}</span>
                    <span className="font-mono-num text-white font-semibold">{val}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-cyan-400 transition-all duration-200"
                      style={{ width: `${val}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Dock: Hero & Arena Vehicles + Paint & Finish + Wheels + Boost + Accessories + Driver Profile */}
      <div className="pointer-events-auto mx-auto w-full max-w-5xl rounded-2xl border border-white/15 bg-[#0A0F18]/95 p-4 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3 mb-3">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-white/5 p-1">
            {(
              [
                ['vehicles', 'Vehicles (10)'],
                ['paint', 'Paint & Finish'],
                ['wheels', 'Wheels'],
                ['boost', 'Boost Trail'],
                ['accessories', 'Accessories'],
                ['profile', 'Driver & Avatar'],
              ] as const
            ).map(([tabId, label]) => (
              <button
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                className={`rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === tabId
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="hidden lg:inline text-xs text-slate-400">
            Synced live across 3-player online party lobbies
          </span>
        </div>

        {activeTab === 'vehicles' && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {HERO_CAR_IDS.map((hid) => {
                const car = CAR_CATALOG.find((c) => c.id === hid)!;
                const selected = car.id === customization.carId;
                return (
                  <button
                    key={`hero_${car.id}`}
                    onClick={() => handleSelectCar(car.id)}
                    className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                      selected
                        ? 'border-cyan-400 bg-cyan-500/20 text-white'
                        : 'border-white/15 bg-white/[0.05] text-slate-200 hover:border-cyan-400/50'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                        Hero · {car.archetype}
                      </div>
                      <div className="font-display text-sm font-bold truncate">{car.name}</div>
                    </div>
                    <span
                      className="h-3.5 w-3.5 rounded-full shrink-0 border border-white/30"
                      style={{ backgroundColor: car.defaultPrimary }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {CAR_CATALOG.map((car) => {
                const selected = car.id === customization.carId;
                return (
                  <button
                    key={car.id}
                    onClick={() => handleSelectCar(car.id)}
                    className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-all ${
                      selected
                        ? 'border-cyan-400 bg-cyan-500/15 text-white'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:bg-white/[0.07]'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="font-display text-xs font-bold truncate">{car.name}</span>
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: car.defaultPrimary }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 truncate w-full mt-0.5">
                      {car.archetype}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'paint' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 py-1">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-300">Primary Color Wheel</span>
                <label className="flex items-center gap-1.5 text-[11px] font-mono-num text-cyan-300 cursor-pointer">
                  <Palette className="w-3.5 h-3.5" />
                  <span>{customization.primaryColor.toUpperCase()}</span>
                  <input
                    type="color"
                    value={customization.primaryColor}
                    onChange={(e) => onChange({ ...customization, primaryColor: e.target.value })}
                    className="h-6 w-6 cursor-pointer rounded-full border border-white/25 bg-transparent p-0"
                    aria-label="Custom Primary Paint Color Wheel"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {COLOR_SWATCHES.map((hex) => {
                  const active = customization.primaryColor.toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={`p_${hex}`}
                      onClick={() => onChange({ ...customization, primaryColor: hex })}
                      className={`flex h-7 w-7 items-center justify-center rounded-lg border-2 transition-transform hover:scale-105 ${
                        active ? 'border-white scale-110' : 'border-white/15'
                      }`}
                      style={{ backgroundColor: hex }}
                      aria-label={`Primary color ${hex}`}
                    >
                      {active && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-300 mb-2">Paint Finish</div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {PAINT_FINISH_CATALOG.map((fin) => {
                  const active = currentFinish === fin.id;
                  return (
                    <button
                      key={fin.id}
                      onClick={() => onChange({ ...customization, paintFinish: fin.id })}
                      className={`rounded-lg border px-2.5 py-2 text-left transition-all ${
                        active
                          ? 'border-cyan-400 bg-cyan-500/20 text-white'
                          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <div className="font-display text-xs font-bold">{fin.label}</div>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-300">Team Accent &amp; Rim Glow</span>
                <input
                  type="color"
                  value={currentAccent}
                  onChange={(e) => onChange({ ...customization, teamAccent: e.target.value })}
                  className="h-5 w-8 cursor-pointer rounded border border-white/20 bg-transparent p-0"
                  aria-label="Custom Team Accent Color"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['#0EA5E9', '#F97316', '#10B981', '#A855F7', '#F43F5E', '#EAB308', '#F8FAFC'].map((hex) => {
                  const active = currentAccent.toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={`acc_${hex}`}
                      onClick={() => onChange({ ...customization, teamAccent: hex })}
                      className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-105 ${
                        active ? 'border-white scale-110' : 'border-white/20'
                      }`}
                      style={{ backgroundColor: hex }}
                      aria-label={`Team accent ${hex}`}
                    />
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-300">Secondary Trim &amp; Wing</span>
                <input
                  type="color"
                  value={customization.secondaryColor}
                  onChange={(e) => onChange({ ...customization, secondaryColor: e.target.value })}
                  className="h-6 w-6 cursor-pointer rounded-full border border-white/25 bg-transparent p-0"
                  aria-label="Custom Secondary Trim Color"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {COLOR_SWATCHES.map((hex) => {
                  const active = customization.secondaryColor.toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={`s_${hex}`}
                      onClick={() => onChange({ ...customization, secondaryColor: hex })}
                      className={`flex h-7 w-7 items-center justify-center rounded-lg border-2 transition-transform hover:scale-105 ${
                        active ? 'border-white scale-110' : 'border-white/15'
                      }`}
                      style={{ backgroundColor: hex }}
                      aria-label={`Secondary color ${hex}`}
                    >
                      {active && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'wheels' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-1">
            {WHEEL_STYLE_CATALOG.map((ws) => {
              const active = currentWheels === ws.id;
              return (
                <button
                  key={ws.id}
                  onClick={() => onChange({ ...customization, wheelStyle: ws.id })}
                  className={`flex flex-col items-start rounded-xl border px-4 py-3 text-left transition-all ${
                    active
                      ? 'border-cyan-400 bg-cyan-500/15 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:bg-white/[0.07]'
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="font-display text-sm font-bold">{ws.label}</span>
                    <Disc className={`w-4 h-4 shrink-0 ${active ? 'text-cyan-300' : 'text-slate-500'}`} />
                  </div>
                  <span className="text-[11px] text-slate-400 mt-1 leading-snug">
                    {ws.description}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {activeTab === 'boost' && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 py-1">
            {BOOST_TRAIL_CATALOG.map((trail) => {
              const active = customization.boostTrail === trail.id;
              return (
                <button
                  key={trail.id}
                  onClick={() => onChange({ ...customization, boostTrail: trail.id })}
                  className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all ${
                    active
                      ? 'border-cyan-400 bg-cyan-500/15 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                  }`}
                >
                  <span
                    className="h-5 w-5 rounded-full shrink-0 border border-white/30"
                    style={{
                      background: `radial-gradient(circle, ${trail.coreColor} 20%, ${trail.outerColor} 90%)`,
                    }}
                  />
                  <span className="font-display text-xs font-bold truncate">{trail.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {activeTab === 'accessories' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 py-1">
            {ACCESSORY_CATALOG.map((acc) => {
              const active = (customization.accessory ?? 'none') === acc.id;
              return (
                <button
                  key={acc.id}
                  onClick={() => onChange({ ...customization, accessory: acc.id })}
                  className={`flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-all ${
                    active
                      ? 'border-cyan-400 bg-cyan-500/15 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:bg-white/[0.07]'
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-1.5">
                    <span className="font-display text-xs font-bold truncate">{acc.name}</span>
                    <Sparkles className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-cyan-300' : 'text-slate-500'}`} />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 line-clamp-2 leading-snug">
                    {acc.description}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-1 items-center">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                <span>Multiplayer Username</span>
              </label>
              <input
                type="text"
                maxLength={18}
                value={playerName}
                onChange={(e) => onChangePlayerName(e.target.value)}
                placeholder="Enter username"
                className="w-full rounded-lg border border-white/15 bg-[#060910] px-3.5 py-2 text-sm font-semibold text-white focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <div className="text-xs font-semibold text-slate-300 mb-1.5">Party Slot Avatar</div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {AVATAR_CATALOG.map((av) => {
                  const active = avatarId === av.id;
                  return (
                    <button
                      key={av.id}
                      onClick={() => onChangeAvatar(av.id)}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 transition-all ${
                        active
                          ? 'border-cyan-400 bg-cyan-500/15 text-white'
                          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-lg font-display text-xs font-bold text-slate-950"
                        style={{ backgroundColor: av.accent }}
                      >
                        {av.badge}
                      </span>
                      <span className="text-[11px] font-semibold truncate">{av.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
