import React from 'react';
import { Camera, CameraOff, Crosshair, Hand, RotateCcw, ShieldCheck, X } from 'lucide-react';
import type { HandGestureEngine } from '../input/handGestureEngine.ts';
import {
  DEFAULT_HAND_CONTROL_SETTINGS,
  GAME_ACTION_LABELS,
  HAND_GESTURE_CATALOG,
} from '../shared/constants.ts';
import type { GameAction, HandControlSettings, HandTrackingTelemetry } from '../shared/types.ts';
import { HandControlDashboard } from './HandControlDashboard.tsx';

interface HandControlModalProps {
  settings: HandControlSettings;
  telemetry: HandTrackingTelemetry;
  engine: HandGestureEngine;
  onChange: (next: HandControlSettings) => void;
  onCalibrate: () => void;
  onClose: () => void;
}

const ACTION_OPTIONS: GameAction[] = [
  'accelerate',
  'reverse',
  'steerLeft',
  'steerRight',
  'jump',
  'doubleJump',
  'boost',
  'powerslide',
  'ballCam',
  'pause',
  'none',
];

export const HandControlModal: React.FC<HandControlModalProps> = ({
  settings,
  telemetry,
  engine,
  onChange,
  onCalibrate,
  onClose,
}) => {
  const handleToggleEnable = () => {
    onChange({
      ...settings,
      enabled: !settings.enabled,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-4xl rounded-2xl border border-white/15 bg-[#0C121D] p-6 shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-400 border border-cyan-400/30">
              <Hand className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-white">AI Webcam Hand Control</h2>
              <p className="text-xs text-slate-400">
                Real-time MediaPipe 21-landmark hand tracking processed 100% locally in your browser
              </p>
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

        <div className="mt-5 flex-1 overflow-y-auto pr-1 space-y-5">
          {/* Privacy & Webcam Activation Banner */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="font-display text-base font-bold text-white">
                      {settings.enabled ? 'Hand Gesture Controls Enabled' : 'Enable Webcam Hand Control'}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-300">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Privacy protected: webcam video stays on your device and is never recorded or sent to any server.
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleToggleEnable}
                    className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                      settings.enabled
                        ? 'bg-rose-500 text-white hover:bg-rose-400'
                        : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                    }`}
                  >
                    {settings.enabled ? (
                      <>
                        <CameraOff className="w-4 h-4" />
                        <span>Disable Camera</span>
                      </>
                    ) : (
                      <>
                        <Camera className="w-4 h-4" />
                        <span>Allow Webcam & Activate</span>
                      </>
                    )}
                  </button>
                </div>

                {telemetry.modelError && (
                  <div className="mt-3 rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    {telemetry.modelError}
                  </div>
                )}
              </div>

              {/* Handedness, Sensitivity, Confidence, Calibration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Dominant Hand</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['right', 'left'] as const).map((h) => (
                      <button
                        key={h}
                        onClick={() => onChange({ ...settings, handedness: h })}
                        className={`rounded-lg border py-2 text-xs font-bold capitalize transition-colors ${
                          settings.handedness === h
                            ? 'border-cyan-400 bg-cyan-500/20 text-white'
                            : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                        }`}
                      >
                        {h}-Handed
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Neutral Position</label>
                  <button
                    onClick={onCalibrate}
                    disabled={!telemetry.trackingActive || telemetry.handsDetected === 0}
                    className="w-full flex items-center justify-center gap-2 rounded-lg border border-cyan-400/35 bg-cyan-500/15 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-40 transition-colors"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    <span>
                      {telemetry.calibrated ? 'Recalibrate Neutral Hand' : 'Calibrate Neutral Hand'}
                    </span>
                  </button>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-300 font-semibold">Steering & Swipe Sensitivity</span>
                    <span className="font-mono-num text-cyan-400">{settings.sensitivity.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    value={settings.sensitivity}
                    onChange={(e) => onChange({ ...settings, sensitivity: Number(e.target.value) })}
                    className="w-full accent-cyan-400"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-300 font-semibold">Confidence Threshold</span>
                    <span className="font-mono-num text-cyan-400">
                      {Math.round(settings.confidenceThreshold * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.45}
                    max={0.9}
                    step={0.05}
                    value={settings.confidenceThreshold}
                    onChange={(e) => onChange({ ...settings, confidenceThreshold: Number(e.target.value) })}
                    className="w-full accent-cyan-400"
                  />
                </div>
              </div>
            </div>

            {/* Live Webcam Test Preview */}
            <div className="flex flex-col items-center justify-center">
              {settings.enabled ? (
                <HandControlDashboard
                  engine={engine}
                  telemetry={telemetry}
                  onCalibrate={onCalibrate}
                  onDisable={() => onChange({ ...settings, enabled: false })}
                />
              ) : (
                <div className="w-full h-full min-h-[220px] rounded-2xl border border-dashed border-white/15 bg-[#070A10] flex flex-col items-center justify-center p-5 text-center">
                  <Camera className="w-8 h-8 text-slate-500 mb-2" />
                  <div className="font-display text-sm font-bold text-slate-300">Webcam Preview Inactive</div>
                  <p className="text-xs text-slate-500 mt-1">
                    Click &quot;Allow Webcam &amp; Activate&quot; to test all 10 gestures live before entering a match.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* All 10 Custom Gesture Mappings & Enable/Disable Toggles */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <div>
                <h3 className="font-display text-sm font-bold text-white uppercase tracking-wider">
                  Gesture Controls & Custom Mappings (10)
                </h3>
                <p className="text-xs text-slate-400">
                  Toggle individual gestures on/off or remap any gesture to a different car action.
                </p>
              </div>
              <button
                onClick={() =>
                  onChange({
                    ...DEFAULT_HAND_CONTROL_SETTINGS,
                    enabled: settings.enabled,
                    handedness: settings.handedness,
                  })
                }
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Gestures</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {HAND_GESTURE_CATALOG.map((g, index) => {
                const isEnabled = settings.enabledGestures[g.id];
                const mappedAction = settings.gestureActionMap[g.id];
                const isLiveDetected =
                  telemetry.detectedGesture === g.id || telemetry.steeringGesture === g.id;
                return (
                  <div
                    key={g.id}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                      isLiveDetected
                        ? 'border-cyan-400 bg-cyan-500/15'
                        : 'border-white/10 bg-white/[0.03]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono-num text-[10px] text-slate-500">
                          {(index + 1).toString().padStart(2, '0')}
                        </span>
                        <span className="font-display text-xs font-bold text-white truncate">
                          {g.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">{g.howTo}</div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={mappedAction}
                        onChange={(e) =>
                          onChange({
                            ...settings,
                            gestureActionMap: {
                              ...settings.gestureActionMap,
                              [g.id]: e.target.value as GameAction,
                            },
                          })
                        }
                        className="rounded-lg border border-white/15 bg-[#070A10] px-2 py-1.5 text-[11px] font-semibold text-cyan-300 focus:border-cyan-400 focus:outline-none"
                      >
                        {ACTION_OPTIONS.map((act) => (
                          <option key={act} value={act}>
                            {GAME_ACTION_LABELS[act]}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={() =>
                          onChange({
                            ...settings,
                            enabledGestures: {
                              ...settings.enabledGestures,
                              [g.id]: !isEnabled,
                            },
                          })
                        }
                        className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                          isEnabled
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-white/5 text-slate-500 border border-white/10'
                        }`}
                      >
                        {isEnabled ? 'On' : 'Off'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end border-t border-white/10 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-cyan-500 px-6 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-400 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
