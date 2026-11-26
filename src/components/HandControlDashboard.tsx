import React, { useEffect, useRef } from 'react';
import { Camera, CameraOff, Crosshair, Sliders } from 'lucide-react';
import type { HandGestureEngine } from '../input/handGestureEngine.ts';
import type { HandTrackingTelemetry } from '../shared/types.ts';

interface HandControlDashboardProps {
  engine: HandGestureEngine;
  telemetry: HandTrackingTelemetry;
  onCalibrate: () => void;
  onOpenSettings?: () => void;
  onDisable: () => void;
  compact?: boolean;
}

const GESTURE_DISPLAY: Record<string, string> = {
  NEUTRAL: 'NEUTRAL',
  OPEN_PALM: 'OPEN PALM',
  CLOSED_FIST: 'CLOSED FIST',
  TILT_LEFT: 'TILT HAND LEFT',
  TILT_RIGHT: 'TILT HAND RIGHT',
  TWO_FINGERS: 'TWO FINGERS RAISED',
  DOUBLE_EXTENSION: 'DOUBLE EXTENSION',
  THUMBS_UP: 'THUMBS UP',
  SIDEWAYS_SWIPE: 'FLAT HAND SIDEWAYS',
  POINTING_FINGER: 'POINTING FINGER',
  BOTH_HANDS_RAISED: 'BOTH HANDS RAISED',
};

export const HandControlDashboard: React.FC<HandControlDashboardProps> = ({
  engine,
  telemetry,
  onCalibrate,
  onOpenSettings,
  onDisable,
  compact = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    engine.attachPreviewCanvas(canvas);
    return () => {
      engine.detachPreviewCanvas(canvas);
    };
  }, [engine]);

  return (
    <div className="pointer-events-auto rounded-2xl border border-cyan-500/30 bg-[#0A101A]/94 p-3 shadow-2xl w-[236px]">
      {/* Header Row */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
        <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase">
          <Camera className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-white">Hand Tracking</span>
        </div>
        <span
          className={`text-[10px] font-bold uppercase ${
            telemetry.trackingActive ? 'text-emerald-400' : 'text-amber-400'
          }`}
        >
          {telemetry.modelLoading
            ? 'Loading...'
            : telemetry.trackingActive
              ? 'Active'
              : telemetry.permissionState === 'denied'
                ? 'Denied'
                : 'Standby'}
        </span>
      </div>

      {/* Live Mirrored Webcam Preview + Skeleton Canvas */}
      <div className="relative mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#05080F] aspect-[4/3]">
        <canvas ref={canvasRef} width={240} height={180} className="w-full h-full object-cover" />
        {!telemetry.trackingActive && (
          <div className="absolute inset-0 flex items-center justify-center p-2 text-center text-[11px] text-slate-400">
            {telemetry.modelError
              ? telemetry.modelError
              : telemetry.modelLoading
                ? 'Initializing Hand Landmarker...'
                : 'Starting webcam...'}
          </div>
        )}
        {telemetry.trackingActive && (
          <div className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono-num text-[10px] text-slate-200">
            {telemetry.handsDetected > 0 ? `${telemetry.handsDetected} Hand` : 'No Hand'}
          </div>
        )}
        {telemetry.trackingActive && telemetry.confidence > 0 && (
          <div className="absolute top-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono-num text-[10px] text-cyan-300">
            {telemetry.confidence}%
          </div>
        )}
      </div>

      {/* Telemetry Readouts */}
      <div className="mt-2.5 space-y-1 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400">Detected Gesture</span>
          <span className="font-display font-bold text-cyan-300 truncate">
            {GESTURE_DISPLAY[telemetry.detectedGesture] ?? telemetry.detectedGesture}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400">Car Action</span>
          <span className="font-display font-bold text-amber-300 truncate">
            {telemetry.currentActionLabel}
          </span>
        </div>
        {!compact && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-400">Camera Permission</span>
            <span className="font-semibold text-slate-200 capitalize">{telemetry.permissionState}</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-2.5 flex items-center gap-1.5 pt-2 border-t border-white/10">
        <button
          onClick={onCalibrate}
          disabled={!telemetry.trackingActive || telemetry.handsDetected === 0}
          className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-white/15 bg-white/5 py-1.5 text-[11px] font-semibold text-white hover:bg-white/10 disabled:opacity-40 transition-colors whitespace-nowrap"
          title="Set current hand angle as neutral straight-ahead"
        >
          <Crosshair className="w-3 h-3 text-cyan-400" />
          <span>Calibrate</span>
        </button>
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="flex items-center justify-center rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-slate-200 hover:bg-white/10 transition-colors"
            title="Hand Gesture Settings"
            aria-label="Hand Gesture Settings"
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={onDisable}
          className="flex items-center justify-center gap-1 rounded-lg border border-rose-500/35 bg-rose-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/25 transition-colors whitespace-nowrap"
          title="Disable Hand Control & Turn Off Camera"
        >
          <CameraOff className="w-3 h-3" />
          <span>Off</span>
        </button>
      </div>
    </div>
  );
};
