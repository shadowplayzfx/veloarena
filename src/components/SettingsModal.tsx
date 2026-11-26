import React, { useEffect, useState } from 'react';
import { Camera, Gamepad2, Hand, Monitor, RotateCcw, Volume2, X } from 'lucide-react';
import { DEFAULT_KEY_BINDINGS } from '../shared/constants.ts';
import type { CameraViewMode, GameSettings, GraphicsQuality, KeyBindings } from '../shared/types.ts';

interface SettingsModalProps {
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
  onOpenHandControl: () => void;
  onClose: () => void;
}

const KEY_LABELS: { key: keyof KeyBindings; label: string }[] = [
  { key: 'accelerate', label: 'Accelerate' },
  { key: 'reverse', label: 'Brake / Reverse' },
  { key: 'steerLeft', label: 'Steer Left' },
  { key: 'steerRight', label: 'Steer Right' },
  { key: 'jump', label: 'Jump / Double Jump' },
  { key: 'boost', label: 'Rocket Boost' },
  { key: 'powerslide', label: 'Powerslide / Air Roll' },
  { key: 'reset', label: 'Reset Car Position' },
  { key: 'camera', label: 'Toggle Ball Camera' },
  { key: 'pause', label: 'Pause Menu' },
];

function formatKeyCode(code: string): string {
  return code
    .replace('Key', '')
    .replace('Arrow', '')
    .replace('ShiftLeft', 'L-Shift')
    .replace('ShiftRight', 'R-Shift')
    .replace('ControlLeft', 'L-Ctrl')
    .replace('ControlRight', 'R-Ctrl');
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onChange,
  onOpenHandControl,
  onClose,
}) => {
  const [tab, setTab] = useState<'graphics' | 'camera' | 'controls' | 'audio'>('graphics');
  const [rebindingKey, setRebindingKey] = useState<keyof KeyBindings | null>(null);

  useEffect(() => {
    if (!rebindingKey) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onChange({
        ...settings,
        keyBindings: {
          ...settings.keyBindings,
          [rebindingKey]: e.code,
        },
      });
      setRebindingKey(null);
    };
    window.addEventListener('keydown', onKey, { capture: true, once: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [rebindingKey, settings, onChange]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[#0C121D] p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <h2 className="font-display text-2xl font-bold text-white">Game Settings</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="mt-4 grid grid-cols-4 gap-1.5 rounded-xl bg-white/5 p-1">
          {(
            [
              ['graphics', 'Graphics', Monitor],
              ['camera', 'Camera', Camera],
              ['controls', 'Controls', Gamepad2],
              ['audio', 'Audio', Volume2],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold transition-colors whitespace-nowrap ${
                tab === id ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="mt-5 flex-1 overflow-y-auto pr-1 space-y-5">
          {tab === 'graphics' && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Rendering Quality Preset
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {(['low', 'medium', 'high', 'ultra'] as GraphicsQuality[]).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => onChange({ ...settings, graphics: preset })}
                    className={`rounded-xl border p-3 text-left transition-all ${
                      settings.graphics === preset
                        ? 'border-cyan-400 bg-cyan-500/15 text-white'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <div className="font-display text-sm font-bold capitalize">{preset}</div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {preset === 'low'
                        ? 'No SSAO or reflections, 512px shadows'
                        : preset === 'medium'
                          ? '1024px shadows, Bloom, 256p reflections, FXAA'
                          : preset === 'high'
                            ? 'SSAO, 512p reflections, 2048px shadows, SMAA'
                            : 'Max shaders, 1024p reflections, 4096px shadows'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'camera' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Camera Perspective
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {(
                    [
                      ['chase', 'Third-Person Chase (Default)', 'Classic elevated camera behind your car'],
                      ['first_person', 'Hood / Front Cam', 'Close low-profile front view'],
                    ] as [CameraViewMode, string, string][]
                  ).map(([modeId, title, desc]) => (
                    <button
                      key={modeId}
                      onClick={() =>
                        onChange({
                          ...settings,
                          camera: { ...settings.camera, viewMode: modeId },
                        })
                      }
                      className={`rounded-xl border p-3 text-left transition-all ${
                        settings.camera.viewMode === modeId
                          ? 'border-cyan-400 bg-cyan-500/15 text-white'
                          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <div className="font-display text-sm font-bold">{title}</div>
                      <div className="text-[11px] text-slate-400 mt-1">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {settings.camera.viewMode === 'chase' && (
                <>
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-slate-300 font-semibold">Chase Camera Distance</span>
                      <span className="font-mono-num text-cyan-400">{settings.camera.distance.toFixed(1)} m</span>
                    </div>
                    <input
                      type="range"
                      min={5.5}
                      max={12.0}
                      step={0.2}
                      value={settings.camera.distance}
                      onChange={(e) =>
                        onChange({
                          ...settings,
                          camera: { ...settings.camera, distance: Number(e.target.value) },
                        })
                      }
                      className="w-full accent-cyan-400"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-slate-300 font-semibold">Chase Camera Height</span>
                      <span className="font-mono-num text-cyan-400">{settings.camera.height.toFixed(1)} m</span>
                    </div>
                    <input
                      type="range"
                      min={2.0}
                      max={5.0}
                      step={0.1}
                      value={settings.camera.height}
                      onChange={(e) =>
                        onChange({
                          ...settings,
                          camera: { ...settings.camera, height: Number(e.target.value) },
                        })
                      }
                      className="w-full accent-cyan-400"
                    />
                  </div>
                </>
              )}

              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-slate-300 font-semibold">Field of View (FOV)</span>
                  <span className="font-mono-num text-cyan-400">{settings.camera.fov}°</span>
                </div>
                <input
                  type="range"
                  min={85}
                  max={115}
                  step={1}
                  value={settings.camera.fov}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      camera: { ...settings.camera, fov: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-cyan-400"
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div>
                  <div className="text-xs font-semibold text-white">Default Ball Cam</div>
                  <div className="text-[11px] text-slate-400">Start matches locked onto the football (toggle with C)</div>
                </div>
                <button
                  onClick={() =>
                    onChange({
                      ...settings,
                      camera: { ...settings.camera, ballCamDefault: !settings.camera.ballCamDefault },
                    })
                  }
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    settings.camera.ballCamDefault
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-white/10 text-slate-300'
                  }`}
                >
                  {settings.camera.ballCamDefault ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div>
                  <div className="text-xs font-semibold text-white">Impact Camera Shake</div>
                  <div className="text-[11px] text-slate-400">Subtle shake on heavy hits and goals</div>
                </div>
                <button
                  onClick={() =>
                    onChange({
                      ...settings,
                      camera: { ...settings.camera, cameraShake: !settings.camera.cameraShake },
                    })
                  }
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    settings.camera.cameraShake
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-white/10 text-slate-300'
                  }`}
                >
                  {settings.camera.cameraShake ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>
          )}

          {tab === 'controls' && (
            <div className="space-y-4">
              {/* AI Webcam Hand Control Launcher in Settings */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300">
                    <Hand className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-display text-sm font-bold text-white">
                      AI Webcam Hand Control
                    </div>
                    <div className="text-[11px] text-slate-300">
                      Status:{' '}
                      <span className={settings.handControl.enabled ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                        {settings.handControl.enabled ? 'Active' : 'Disabled (Keyboard Mode)'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      onChange({
                        ...settings,
                        handControl: {
                          ...settings.handControl,
                          enabled: !settings.handControl.enabled,
                        },
                      })
                    }
                    className={`rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${
                      settings.handControl.enabled
                        ? 'bg-rose-500 text-white hover:bg-rose-400'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    {settings.handControl.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={onOpenHandControl}
                    className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-colors whitespace-nowrap"
                  >
                    Configure Hand Gestures
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  Click any binding button and press a key to customize. Arrow keys also work alongside WASD.
                </p>
                <button
                  onClick={() => onChange({ ...settings, keyBindings: DEFAULT_KEY_BINDINGS })}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Defaults</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {KEY_LABELS.map((item) => {
                  const isRebinding = rebindingKey === item.key;
                  return (
                    <div
                      key={item.key}
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5"
                    >
                      <span className="text-xs font-semibold text-slate-200">{item.label}</span>
                      <button
                        onClick={() => setRebindingKey(item.key)}
                        className={`min-w-[88px] rounded-lg px-3 py-1.5 font-mono-num text-xs font-bold transition-colors ${
                          isRebinding
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-[#070A10] border border-white/15 text-cyan-300 hover:border-cyan-400'
                        }`}
                      >
                        {isRebinding ? 'Press Key...' : formatKeyCode(settings.keyBindings[item.key])}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'audio' && (
            <div className="space-y-4">
              {(
                [
                  ['masterVolume', 'Master Volume'],
                  ['sfxVolume', 'Engine, Boost & Stadium SFX'],
                  ['musicVolume', 'Menu Synth Music'],
                ] as const
              ).map(([field, label]) => (
                <div key={field}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-300 font-semibold">{label}</span>
                    <span className="font-mono-num text-cyan-400">
                      {Math.round(settings.audio[field] * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.audio[field]}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        audio: { ...settings.audio, [field]: Number(e.target.value) },
                      })
                    }
                    className="w-full accent-cyan-400"
                  />
                </div>
              ))}
            </div>
          )}
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
