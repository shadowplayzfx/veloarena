import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ARENA_BOUNDS, CAR_MAP, FFA_ARENA_BOUNDS } from '../shared/constants.ts';
import type {
  ArenaId,
  CarStateSnapshot,
  GameSettings,
  GraphicsQuality,
  MatchEvent,
  MatchStateSnapshot,
  PartyGameMode,
  PlayerInput,
  Team,
} from '../shared/types.ts';
import type { HandGestureEngine } from '../input/handGestureEngine.ts';
import { buildArena } from './arenas.ts';
import type { ProceduralAudioEngine } from './audio.ts';
import { createCarModel, getTrailColors, type CarMeshHandle } from './carModels.ts';
import { ParticleSystem } from './particles.ts';
import {
  applyFresnelRimShader,
  CinematicFinalShader,
  createGoalShockwaveShaderMaterial,
  createProceduralArenaEnvironment,
  RibbonTrail,
} from './shaders.ts';
import { createBallEmissiveSeamTexture, createBallTexture, createContactShadowTexture } from './textures.ts';

interface ArenaViewportProps {
  arenaId: ArenaId;
  gameMode?: PartyGameMode;
  settings: GameSettings;
  localPlayerId: string;
  ballCam: boolean;
  paused: boolean;
  audio: ProceduralAudioEngine;
  handEngine?: HandGestureEngine;
  getRenderState: (nowMs: number) => {
    snapshot: MatchStateSnapshot | null;
    events: MatchEvent[];
  };
  onFrameTick: (dt: number, input: PlayerInput) => void;
  onToggleBallCam: () => void;
  onTogglePause: () => void;
  onLookBehindChange?: (active: boolean) => void;
}

const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _vecC = new THREE.Vector3();
const _vecD = new THREE.Vector3();
const _vecE = new THREE.Vector3();
const _carFwd = new THREE.Vector3();
const _upCar = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _quatA = new THREE.Quaternion();
const _projVec = new THREE.Vector3();
const _camSpaceVec = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _rayDelta = new THREE.Vector3();
const _trailVec = new THREE.Vector3();
const _ballPosVec = new THREE.Vector3();

function getTeamHexStr(team: Team): string {
  return team === 'blue' ? '#0EA5E9' : team === 'emerald' ? '#10B981' : '#F97316';
}

function getTeamHexNum(team?: Team | null): number {
  return team === 'blue' ? 0x38bdf8 : team === 'emerald' ? 0x10b981 : 0xf97316;
}

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

/**
 * Convert horizontal FOV (Rocket League style 100-110 deg) to vertical FOV for Three.js PerspectiveCamera.
 */
function horizontalToVerticalFov(hFovDeg: number, aspect: number): number {
  const safeAspect = Math.max(aspect, 1.3);
  const hRad = THREE.MathUtils.degToRad(hFovDeg);
  const vRad = 2 * Math.atan(Math.tan(hRad * 0.5) / safeAspect);
  return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(vRad), 55, 95);
}

/**
 * Clip camera position along ray from car focus toward desiredPos so camera never clips through walls, corners, floor, or ceiling.
 */
function clampCameraToArena(
  origin: THREE.Vector3,
  desired: THREE.Vector3,
  gameMode: PartyGameMode
): void {
  _rayDelta.subVectors(desired, origin);
  let tMax = 1.0;

  const clipPlane = (nx: number, ny: number, nz: number, limit: number) => {
    const oDot = origin.x * nx + origin.y * ny + origin.z * nz;
    const dDot = _rayDelta.x * nx + _rayDelta.y * ny + _rayDelta.z * nz;
    if (dDot > 1e-4 && oDot + dDot > limit) {
      const t = (limit - oDot) / dDot;
      if (t < tMax) tMax = Math.max(0.16, t);
    }
  };

  clipPlane(0, -1, 0, -1.05);
  clipPlane(0, 1, 0, ARENA_BOUNDS.HEIGHT - 1.15);

  if (gameMode === 'ffa') {
    const maxA = FFA_ARENA_BOUNDS.APOTHEM - 1.25;
    for (let i = 0; i < 6; i++) {
      const theta = (i * Math.PI) / 3;
      clipPlane(Math.sin(theta), 0, Math.cos(theta), maxA);
    }
  } else {
    const wallX = ARENA_BOUNDS.HALF_WIDTH - 1.2;
    const inGoalMouthX =
      Math.abs(desired.x) < ARENA_BOUNDS.GOAL_HALF_WIDTH - 0.8 &&
      desired.y < ARENA_BOUNDS.GOAL_HEIGHT - 0.8;
    const wallZ =
      (inGoalMouthX ? ARENA_BOUNDS.HALF_LENGTH + ARENA_BOUNDS.GOAL_DEPTH : ARENA_BOUNDS.HALF_LENGTH) -
      1.2;

    clipPlane(1, 0, 0, wallX);
    clipPlane(-1, 0, 0, wallX);
    clipPlane(0, 0, 1, wallZ);
    clipPlane(0, 0, -1, wallZ);

    const cornerLimit =
      (ARENA_BOUNDS.HALF_WIDTH + ARENA_BOUNDS.HALF_LENGTH - ARENA_BOUNDS.CORNER_SIZE - 1.4) *
      Math.SQRT1_2;
    const invSqrt2 = Math.SQRT1_2;
    clipPlane(invSqrt2, 0, invSqrt2, cornerLimit);
    clipPlane(-invSqrt2, 0, invSqrt2, cornerLimit);
    clipPlane(invSqrt2, 0, -invSqrt2, cornerLimit);
    clipPlane(-invSqrt2, 0, -invSqrt2, cornerLimit);
  }

  if (tMax < 1.0) {
    desired.copy(origin).addScaledVector(_rayDelta, tMax);
  }
}

export const ArenaViewport: React.FC<ArenaViewportProps> = ({
  arenaId,
  gameMode = 'team_2v1',
  settings,
  localPlayerId,
  ballCam,
  paused,
  audio,
  handEngine,
  getRenderState,
  onFrameTick,
  onToggleBallCam,
  onTogglePause,
  onLookBehindChange,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const nameplateLayerRef = useRef<HTMLDivElement | null>(null);
  const ballIndicatorRef = useRef<HTMLDivElement | null>(null);
  const ballArrowElRef = useRef<HTMLDivElement | null>(null);
  const ballDistElRef = useRef<HTMLSpanElement | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [botDebugMode, setBotDebugMode] = useState(false);
  const botDebugModeRef = useRef(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const ballCamRef = useRef(ballCam);
  ballCamRef.current = ballCam;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const localIdRef = useRef(localPlayerId);
  localIdRef.current = localPlayerId;
  const handEngineRef = useRef(handEngine);
  handEngineRef.current = handEngine;
  const getRenderStateRef = useRef(getRenderState);
  getRenderStateRef.current = getRenderState;
  const onFrameTickRef = useRef(onFrameTick);
  onFrameTickRef.current = onFrameTick;
  const onToggleBallCamRef = useRef(onToggleBallCam);
  onToggleBallCamRef.current = onToggleBallCam;
  const onTogglePauseRef = useRef(onTogglePause);
  onTogglePauseRef.current = onTogglePause;
  const onLookBehindChangeRef = useRef(onLookBehindChange);
  onLookBehindChangeRef.current = onLookBehindChange;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    let effectiveQuality: GraphicsQuality = settingsRef.current.graphics;

    const getMaxDpr = (q: GraphicsQuality) => (q === 'ultra' ? 2 : q === 'high' ? 1.5 : 1);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl && effectiveQuality !== 'low',
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, getMaxDpr(effectiveQuality))
    );
    renderer.shadowMap.enabled = !isSoftwareGl && effectiveQuality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight
    );

    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.innerHTML = '';
    container.appendChild(canvas);

    const handleLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleRestored = () => {
      setContextLost(false);
    };
    canvas.addEventListener('webglcontextlost', handleLost);
    canvas.addEventListener('webglcontextrestored', handleRestored);

    const scene = new THREE.Scene();
    const envTex = createProceduralArenaEnvironment(renderer, arenaId);
    scene.environment = envTex;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const aspect = width / height;
    const initialVFov = horizontalToVerticalFov(settingsRef.current.camera.fov, aspect);
    const camera = new THREE.PerspectiveCamera(initialVFov, aspect, 0.15, 650);
    camera.position.set(0, 6, 40);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const arenaHandle = buildArena(
      scene,
      arenaId,
      effectiveQuality,
      maxAniso,
      isSoftwareGl,
      gameMode
    );

    // Match Football: glossy PBR + emissive team-colored seams + Fresnel rim + speed ribbon trail
    const ballTex = createBallTexture(maxAniso);
    const ballEmissiveTex = createBallEmissiveSeamTexture(maxAniso);
    const ballGeo = new THREE.SphereGeometry(ARENA_BOUNDS.BALL_RADIUS, 36, 26);
    const ballMat = new THREE.MeshPhysicalMaterial({
      map: ballTex,
      emissive: 0x38bdf8,
      emissiveMap: ballEmissiveTex,
      emissiveIntensity: 0.72,
      roughness: 0.24,
      metalness: 0.35,
      clearcoat: 1.0,
      clearcoatRoughness: 0.07,
    });
    const ballRim = applyFresnelRimShader(ballMat, 0xbae6fd, 2.8, 0.55);
    const ballMesh = new THREE.Mesh(ballGeo, ballMat);
    ballMesh.castShadow = true;
    ballMesh.receiveShadow = true;
    scene.add(ballMesh);

    const ballGlowGeo = new THREE.SphereGeometry(ARENA_BOUNDS.BALL_RADIUS * 1.06, 28, 20);
    const ballGlowMat = new THREE.MeshBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ballGlowMesh = new THREE.Mesh(ballGlowGeo, ballGlowMat);
    ballMesh.add(ballGlowMesh);

    const ballTrail = new RibbonTrail(scene, 24, 0.72, 0x38bdf8);

    const dropRingGeo = new THREE.RingGeometry(
      ARENA_BOUNDS.BALL_RADIUS * 0.78,
      ARENA_BOUNDS.BALL_RADIUS * 1.05,
      32
    );
    dropRingGeo.rotateX(-Math.PI * 0.5);
    const dropRingMat = new THREE.MeshBasicMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const dropRingMesh = new THREE.Mesh(dropRingGeo, dropRingMat);
    dropRingMesh.position.y = 0.03;
    scene.add(dropRingMesh);

    const shadowTex = createContactShadowTexture();
    const ballShadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    const ballShadowGeo = new THREE.PlaneGeometry(
      ARENA_BOUNDS.BALL_RADIUS * 2.5,
      ARENA_BOUNDS.BALL_RADIUS * 2.5
    );
    ballShadowGeo.rotateX(-Math.PI * 0.5);
    const ballShadowMesh = new THREE.Mesh(ballShadowGeo, ballShadowMat);
    ballShadowMesh.position.y = 0.02;
    scene.add(ballShadowMesh);

    const particles = new ParticleSystem(scene);

    // Goal Shockwave Sphere Pool
    const shockwaveGeo = new THREE.SphereGeometry(1, 28, 20);
    const shockwaves: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; progress: number; active: boolean }[] =
      [];
    for (let i = 0; i < 2; i++) {
      const mat = createGoalShockwaveShaderMaterial();
      const mesh = new THREE.Mesh(shockwaveGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      shockwaves.push({ mesh, mat, progress: 0, active: false });
    }
    const spawnShockwave = (pos: { x: number; y: number; z: number }, colorHex: number) => {
      const slot = shockwaves.find((s) => !s.active) ?? shockwaves[0];
      slot.active = true;
      slot.progress = 0;
      slot.mat.uniforms.uColor.value.setHex(colorHex);
      slot.mat.uniforms.uProgress.value = 0;
      slot.mesh.position.set(pos.x, Math.max(1.5, pos.y), pos.z);
      slot.mesh.scale.setScalar(1.5);
      slot.mesh.visible = true;
    };

    // Full Post-Processing Pipeline:
    // RenderPass -> SSAOPass (High/Ultra) -> UnrealBloomPass -> SMAAPass (High/Ultra) -> OutputPass -> FXAAPass (Medium) -> CinematicFinalShader
    let composer: EffectComposer | null = null;
    let ssaoPass: SSAOPass | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    let smaaPass: SMAAPass | null = null;
    let fxaaPass: FXAAPass | null = null;
    let cinematicPass: ShaderPass | null = null;

    const getBloomStrength = (q: GraphicsQuality) =>
      q === 'ultra' ? 0.52 : q === 'high' ? 0.44 : q === 'medium' ? 0.34 : 0.22;

    if (!isSoftwareGl) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));

      ssaoPass = new SSAOPass(scene, camera, width, height);
      ssaoPass.kernelRadius = 11;
      ssaoPass.minDistance = 0.004;
      ssaoPass.maxDistance = 0.09;
      ssaoPass.enabled = effectiveQuality === 'high' || effectiveQuality === 'ultra';
      composer.addPass(ssaoPass);

      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        getBloomStrength(effectiveQuality),
        0.4,
        0.85
      );
      composer.addPass(bloomPass);

      smaaPass = new SMAAPass();
      smaaPass.enabled = effectiveQuality === 'high' || effectiveQuality === 'ultra';
      composer.addPass(smaaPass);

      composer.addPass(new OutputPass());

      fxaaPass = new FXAAPass();
      fxaaPass.setSize(width, height);
      fxaaPass.enabled = effectiveQuality === 'medium';
      composer.addPass(fxaaPass);

      cinematicPass = new ShaderPass(CinematicFinalShader);
      composer.addPass(cinematicPass);
    }

    const applyQualityTier = (nextQ: GraphicsQuality) => {
      if (effectiveQuality === nextQ) return;
      effectiveQuality = nextQ;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, getMaxDpr(nextQ)));
      renderer.shadowMap.enabled = !isSoftwareGl && nextQ !== 'low';
      renderer.setSize(w, h);
      arenaHandle.setQuality(nextQ);

      if (composer) {
        if (ssaoPass) ssaoPass.enabled = nextQ === 'high' || nextQ === 'ultra';
        if (smaaPass) smaaPass.enabled = nextQ === 'high' || nextQ === 'ultra';
        if (fxaaPass) {
          fxaaPass.enabled = nextQ === 'medium';
          fxaaPass.setSize(w, h);
        }
        if (bloomPass) {
          bloomPass.strength = getBloomStrength(nextQ);
        }
        composer.setSize(w, h);
        bloomPass?.resolution.set(w, h);
      }
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const carVisuals = new Map<
      string,
      {
        handle: CarMeshHandle;
        trail: RibbonTrail;
        shadow: THREE.Mesh;
        shadowMat: THREE.MeshBasicMaterial;
        modelKey: string;
        customKey: string;
        nameplateEl: HTMLDivElement;
        lastFirstPerson: boolean;
        lastPos: THREE.Vector3;
        hasLastPos: boolean;
      }
    >();

    // Pre-allocated F3 Bot Debug 3D visualization pools (zero per-frame allocations)
    const MAX_BALL_PATH_PTS = 12;
    const ballPathPositions = new Float32Array(MAX_BALL_PATH_PTS * 3);
    const ballPathGeo = new THREE.BufferGeometry();
    ballPathGeo.setAttribute('position', new THREE.BufferAttribute(ballPathPositions, 3));
    ballPathGeo.setDrawRange(0, 0);
    const ballPathMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.85 });
    const ballPathLine = new THREE.Line(ballPathGeo, ballPathMat);
    ballPathLine.visible = false;
    ballPathLine.frustumCulled = false;
    scene.add(ballPathLine);

    const botTargetMarkerGeo = new THREE.SphereGeometry(0.46, 12, 10);
    const botDebugEntries = new Map<
      string,
      {
        line: THREE.Line;
        lineGeo: THREE.BufferGeometry;
        linePos: Float32Array;
        lineMat: THREE.LineBasicMaterial;
        marker: THREE.Mesh;
        markerMat: THREE.MeshBasicMaterial;
      }
    >();

    const getOrCreateBotDebugEntry = (id: string) => {
      let dbg = botDebugEntries.get(id);
      if (!dbg) {
        const linePos = new Float32Array(6);
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
        const lineMat = new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.9 });
        const line = new THREE.Line(lineGeo, lineMat);
        line.frustumCulled = false;
        line.visible = false;
        scene.add(line);

        const markerMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
        const marker = new THREE.Mesh(botTargetMarkerGeo, markerMat);
        marker.visible = false;
        scene.add(marker);

        dbg = { line, lineGeo, linePos, lineMat, marker, markerMat };
        botDebugEntries.set(id, dbg);
      }
      return dbg;
    };

    const carShadowGeo = new THREE.PlaneGeometry(3.4, 5.2);
    carShadowGeo.rotateX(-Math.PI * 0.5);

    const syncCarVisuals = (cars: CarStateSnapshot[]) => {
      const activeIds = new Set(cars.map((c) => c.id));
      for (const [id, entry] of carVisuals.entries()) {
        if (!activeIds.has(id)) {
          scene.remove(entry.handle.root);
          scene.remove(entry.shadow);
          entry.handle.dispose();
          entry.trail.dispose(scene);
          entry.shadowMat.dispose();
          entry.nameplateEl.remove();
          carVisuals.delete(id);
        }
      }
      for (const [id, dbg] of botDebugEntries.entries()) {
        if (!activeIds.has(id)) {
          scene.remove(dbg.line);
          scene.remove(dbg.marker);
          dbg.lineGeo.dispose();
          dbg.lineMat.dispose();
          dbg.markerMat.dispose();
          botDebugEntries.delete(id);
        }
      }

      const isFirstPersonView = settingsRef.current.camera.viewMode === 'first_person';

      for (const car of cars) {
        const teamHex = car.customization.teamAccent ?? getTeamHexStr(car.team);
        const modelKey = `${car.customization.carId}_${car.customization.wheelStyle ?? 'sport_5'}`;
        const key = `${modelKey}_${car.customization.primaryColor}_${car.customization.secondaryColor}_${car.customization.paintFinish ?? 'metallic'}_${teamHex}_${car.customization.boostTrail}_${car.customization.accessory ?? 'none'}_${car.team}`;
        let entry = carVisuals.get(car.id);
        if (!entry || entry.modelKey !== modelKey) {
          if (entry) {
            scene.remove(entry.handle.root);
            scene.remove(entry.shadow);
            entry.handle.dispose();
            entry.trail.dispose(scene);
            entry.shadowMat.dispose();
            entry.nameplateEl.remove();
          }

          const handle = createCarModel(car.customization, {
            enablePointLights: !isSoftwareGl && effectiveQuality !== 'low',
            teamColorHex: teamHex,
          });
          const fp = car.id === localIdRef.current && isFirstPersonView;
          handle.setFirstPersonMode(fp);
          scene.add(handle.root);

          const trailColors = getTrailColors(car.customization.boostTrail);
          const trail = new RibbonTrail(scene, 22, 0.36, trailColors.outer);

          const shadowMat = new THREE.MeshBasicMaterial({
            map: shadowTex,
            transparent: true,
            opacity: 0.48,
            depthWrite: false,
          });
          const shadow = new THREE.Mesh(carShadowGeo, shadowMat);
          shadow.position.y = 0.025;
          scene.add(shadow);

          const nameplateEl = document.createElement('div');
          nameplateEl.className =
            'absolute pointer-events-none -translate-x-1/2 -translate-y-full px-2 py-0.5 rounded text-[11px] font-bold tracking-wide whitespace-nowrap shadow-md border border-white/25 transition-opacity duration-150';
          nameplateEl.style.backgroundColor =
            car.team === 'blue'
              ? 'rgba(14, 165, 233, 0.92)'
              : car.team === 'emerald'
                ? 'rgba(16, 185, 129, 0.92)'
                : 'rgba(249, 115, 22, 0.92)';
          nameplateEl.style.color = '#ffffff';
          nameplateEl.textContent = car.name;
          nameplateLayerRef.current?.appendChild(nameplateEl);

          entry = {
            handle,
            trail,
            shadow,
            shadowMat,
            modelKey,
            customKey: key,
            nameplateEl,
            lastFirstPerson: fp,
            lastPos: new THREE.Vector3(car.pos.x, car.pos.y, car.pos.z),
            hasLastPos: false,
          };
          carVisuals.set(car.id, entry);
        } else {
          if (entry.customKey !== key) {
            entry.handle.updateAppearance(car.customization, teamHex);
            entry.customKey = key;
          }
          const fp = car.id === localIdRef.current && isFirstPersonView;
          if (entry.lastFirstPerson !== fp) {
            entry.handle.setFirstPersonMode(fp);
            entry.lastFirstPerson = fp;
          }
        }
      }
    };

    // Keyboard Input State
    const keysDown = new Set<string>();
    let inputSeq = 0;
    let lookBehindHeld = false;

    const isActionKey = (code: string, binding: string): boolean => {
      if (code === binding) return true;
      if (binding === 'KeyW' && code === 'ArrowUp') return true;
      if (binding === 'KeyS' && code === 'ArrowDown') return true;
      if (binding === 'KeyA' && code === 'ArrowLeft') return true;
      if (binding === 'KeyD' && code === 'ArrowRight') return true;
      if (binding === 'ShiftLeft' && code === 'ShiftRight') return true;
      if (binding === 'ControlLeft' && code === 'ControlRight') return true;
      return false;
    };

    const matchesBinding = (code: string, actionKey: keyof GameSettings['keyBindings']) =>
      isActionKey(code, settingsRef.current.keyBindings[actionKey]);

    let resetRequested = false;

    const onKeyDown = (e: KeyboardEvent) => {
      audio.unlock();
      if (e.code === 'F3') {
        e.preventDefault();
        if (!e.repeat) {
          const next = !botDebugModeRef.current;
          botDebugModeRef.current = next;
          setBotDebugMode(next);
        }
        return;
      }
      if (e.code === 'KeyV') {
        if (!lookBehindHeld) {
          lookBehindHeld = true;
          onLookBehindChangeRef.current?.(true);
        }
      }
      if (e.repeat) return;
      keysDown.add(e.code);

      if (matchesBinding(e.code, 'camera')) {
        onToggleBallCamRef.current();
      } else if (matchesBinding(e.code, 'pause')) {
        onTogglePauseRef.current();
      } else if (matchesBinding(e.code, 'reset')) {
        resetRequested = true;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysDown.delete(e.code);
      if (e.code === 'KeyV' && lookBehindHeld) {
        lookBehindHeld = false;
        onLookBehindChangeRef.current?.(false);
      }
    };

    const onWindowBlur = () => {
      keysDown.clear();
      if (lookBehindHeld) {
        lookBehindHeld = false;
        onLookBehindChangeRef.current?.(false);
      }
    };

    const onPointerDown = () => {
      audio.unlock();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    canvas.addEventListener('pointerdown', onPointerDown);

    // Third-Person Rocket League Chase Camera State
    const camPos = new THREE.Vector3(0, 6, 40);
    const camTarget = new THREE.Vector3(0, 2, 0);
    const camUp = new THREE.Vector3(0, 1, 0);
    const lastValidForward = new THREE.Vector3(0, 0, -1);
    const lastValidBallDir = new THREE.Vector3(0, 0, 1);
    let currentHFov = settingsRef.current.camera.fov;
    let shakeIntensity = 0;
    let lastTime = performance.now();
    let elapsedVisual = 0;
    let goalFlash = 0;
    let visualSlowMoTimer = 0;
    let boostChromaticSmooth = 0;
    let supersonicSmooth = 0;
    let lastBallResetPos = new THREE.Vector3();
    let hasBallResetPos = false;
    let frameId = 0;
    let disposed = false;

    // FPS Auto-Downgrade Monitor
    let warmupSeconds = 0;
    let fpsFrames = 0;
    let fpsElapsed = 0;
    let lowFpsStreak = 0;

    const pollPlayerInput = (
      handPoll: ReturnType<HandGestureEngine['pollGameInput']> | null
    ): PlayerInput => {
      const kb = settingsRef.current.keyBindings;
      let kbThrottle = 0;
      if (Array.from(keysDown).some((k) => isActionKey(k, kb.accelerate))) kbThrottle += 1;
      if (Array.from(keysDown).some((k) => isActionKey(k, kb.reverse))) kbThrottle -= 1;

      let kbSteer = 0;
      if (Array.from(keysDown).some((k) => isActionKey(k, kb.steerLeft))) kbSteer -= 1;
      if (Array.from(keysDown).some((k) => isActionKey(k, kb.steerRight))) kbSteer += 1;

      const kbJump = Array.from(keysDown).some((k) => isActionKey(k, kb.jump));
      const kbBoost = Array.from(keysDown).some((k) => isActionKey(k, kb.boost));
      const kbPowerslide = Array.from(keysDown).some((k) => isActionKey(k, kb.powerslide));

      const hi = handPoll?.input;
      const throttle = kbThrottle !== 0 ? kbThrottle : (hi?.throttle ?? 0);
      const steer = kbSteer !== 0 ? kbSteer : (hi?.steer ?? 0);
      const jump = kbJump || Boolean(hi?.jump);
      const boost = kbBoost || Boolean(hi?.boost);
      const powerslide = kbPowerslide || Boolean(hi?.powerslide);

      const reset = resetRequested;
      resetRequested = false;

      inputSeq++;
      return { seq: inputSeq, throttle, steer, jump, boost, powerslide, reset };
    };

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.fov = horizontalToVerticalFov(currentHFov, camera.aspect);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer?.setSize(w, h);
      bloomPass?.resolution.set(w, h);
      fxaaPass?.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      if (disposed) return;

      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      // Dynamic FPS auto-downgrade check (if FPS drops below 45 for 4s after warmup)
      if (!isSoftwareGl && !pausedRef.current && effectiveQuality !== 'low') {
        warmupSeconds += dt;
        if (warmupSeconds > 3.0) {
          fpsFrames += 1;
          fpsElapsed += dt;
          if (fpsElapsed >= 1.0) {
            const avgFps = fpsFrames / fpsElapsed;
            if (avgFps < 45) {
              lowFpsStreak += fpsElapsed;
              if (lowFpsStreak >= 4.0) {
                const downgradeMap: Record<GraphicsQuality, GraphicsQuality> = {
                  ultra: 'high',
                  high: 'medium',
                  medium: 'low',
                  low: 'low',
                };
                applyQualityTier(downgradeMap[effectiveQuality]);
                lowFpsStreak = 0;
              }
            } else {
              lowFpsStreak = 0;
            }
            fpsFrames = 0;
            fpsElapsed = 0;
          }
        }
      }

      const handPoll = handEngineRef.current ? handEngineRef.current.pollGameInput() : null;
      if (handPoll?.togglePause) {
        onTogglePauseRef.current();
      }
      if (handPoll?.toggleBallCam && !pausedRef.current) {
        onToggleBallCamRef.current();
      }

      if (!pausedRef.current) {
        const input = pollPlayerInput(handPoll);
        onFrameTickRef.current(dt, input);
      }

      const { snapshot, events } = getRenderStateRef.current(now);

      for (const ev of events) {
        if (ev.type === 'jump') {
          audio.playJump();
        } else if (ev.type === 'impact') {
          audio.playBallImpact(ev.intensity ?? 0.6);
          if (settingsRef.current.camera.cameraShake) {
            shakeIntensity = Math.max(shakeIntensity, (ev.intensity ?? 0.5) * 0.55);
          }
          if (ev.pos) {
            particles.emitExplosion(ev.pos, '#FFFFFF', '#38BDF8', 16);
          }
        } else if (ev.type === 'demolition') {
          audio.playDemolition();
          if (settingsRef.current.camera.cameraShake) {
            shakeIntensity = Math.max(shakeIntensity, 1.35);
          }
          if (ev.pos) {
            particles.emitExplosion(ev.pos, '#F97316', '#FDE047', 68);
          }
        } else if (ev.type === 'teleport') {
          if (ev.pos) {
            particles.emitExplosion(ev.pos, '#22D3EE', '#E0F2FE', 26);
          }
        } else if (ev.type === 'boost_pickup') {
          audio.playBoostPickup();
          if (ev.pos) {
            arenaHandle.triggerBoostBurst(ev.pos);
          }
        } else if (ev.type === 'countdown') {
          audio.playCountdown(false);
        } else if (ev.type === 'kickoff') {
          audio.playCountdown(true);
        } else if (ev.type === 'goal') {
          audio.playGoal();
          if (settingsRef.current.camera.cameraShake) {
            shakeIntensity = 1.6;
          }
          const teamHexNum = getTeamHexNum(ev.team);
          const c1 = ev.team === 'blue' ? '#38BDF8' : ev.team === 'emerald' ? '#10B981' : '#F97316';
          arenaHandle.triggerGoalPulse(teamHexNum);
          goalFlash = 0.92;
          visualSlowMoTimer = 0.72;
          if (cinematicPass) {
            cinematicPass.uniforms.uGoalColor.value.setHex(teamHexNum);
          }
          const blastPos = ev.pos ?? {
            x: 0,
            y: 3.2,
            z: ev.team === 'blue' ? ARENA_BOUNDS.HALF_LENGTH : -ARENA_BOUNDS.HALF_LENGTH,
          };
          spawnShockwave(blastPos, teamHexNum);
          particles.emitExplosion(blastPos, c1, '#FDE047', 110);
        }
      }

      // Visual-only brief slow motion during goal explosion celebration (physics/controls unaffected)
      const isGoalSlowMo =
        !pausedRef.current && visualSlowMoTimer > 0 && snapshot?.phase === 'goal_scored';
      if (visualSlowMoTimer > 0 && !pausedRef.current) {
        visualSlowMoTimer = Math.max(0, visualSlowMoTimer - dt);
      }
      const vdt = pausedRef.current ? 0 : dt * (isGoalSlowMo ? 0.36 : 1.0);
      elapsedVisual += vdt;

      if (goalFlash > 0.001) {
        goalFlash = Math.max(0, goalFlash - dt * 2.4);
      }

      // Update expanding goal shockwaves
      for (const sw of shockwaves) {
        if (!sw.active) continue;
        sw.progress += vdt * 1.15;
        if (sw.progress >= 1) {
          sw.active = false;
          sw.mesh.visible = false;
        } else {
          sw.mat.uniforms.uProgress.value = sw.progress;
          sw.mesh.scale.setScalar(1.5 + sw.progress * 26);
        }
      }

      if (snapshot) {
        ballMesh.position.set(snapshot.ball.pos.x, snapshot.ball.pos.y, snapshot.ball.pos.z);
        ballMesh.quaternion.set(
          snapshot.ball.quat.x,
          snapshot.ball.quat.y,
          snapshot.ball.quat.z,
          snapshot.ball.quat.w
        );

        const ballTeamColor =
          snapshot.ball.lastTouchTeam === 'blue'
            ? 0x38bdf8
            : snapshot.ball.lastTouchTeam === 'orange'
              ? 0xf97316
              : snapshot.ball.lastTouchTeam === 'emerald'
                ? 0x10b981
                : 0xe2e8f0;
        ballGlowMat.color.setHex(ballTeamColor);
        ballGlowMat.opacity = snapshot.ball.lastTouchTeam ? 0.2 : 0.12;
        ballMat.emissive.setHex(ballTeamColor);
        ballRim.setRimColor(ballTeamColor);

        ballShadowMesh.position.set(snapshot.ball.pos.x, 0.02, snapshot.ball.pos.z);
        const ballHeightRatio = Math.max(
          0.25,
          1 - (snapshot.ball.pos.y - ARENA_BOUNDS.BALL_RADIUS) / 22
        );
        ballShadowMesh.scale.setScalar(ballHeightRatio);
        ballShadowMat.opacity = 0.54 * ballHeightRatio;

        dropRingMesh.position.set(snapshot.ball.pos.x, 0.03, snapshot.ball.pos.z);
        dropRingMat.opacity = snapshot.ball.pos.y > 2.6 ? 0.58 : 0.28;

        const ballSpeed = Math.hypot(snapshot.ball.vel.x, snapshot.ball.vel.y, snapshot.ball.vel.z);
        _ballPosVec.set(snapshot.ball.pos.x, snapshot.ball.pos.y, snapshot.ball.pos.z);
        if (!hasBallResetPos || _ballPosVec.distanceToSquared(lastBallResetPos) > 196) {
          ballTrail.reset(_ballPosVec);
          hasBallResetPos = true;
        }
        lastBallResetPos.copy(_ballPosVec);

        if (!pausedRef.current) {
          const fastBallColor =
            ballSpeed > 34
              ? 0xf43f5e
              : ballSpeed > 25
                ? 0xfbbf24
                : snapshot.ball.lastTouchTeam
                  ? ballTeamColor
                  : 0x7dd3fc;
          const trailIntensity = THREE.MathUtils.clamp((ballSpeed - 12) / 22, 0, 0.85);
          ballTrail.update(
            _ballPosVec,
            ballSpeed > 13,
            trailIntensity,
            fastBallColor,
            0xffffff,
            THREE.MathUtils.clamp(0.7 + ballSpeed * 0.018, 0.7, 1.35)
          );
        }

        if (ballSpeed > 18 && !pausedRef.current && Math.random() < 0.7) {
          const teamCol =
            snapshot.ball.lastTouchTeam === 'blue'
              ? '#38BDF8'
              : snapshot.ball.lastTouchTeam === 'emerald'
                ? '#10B981'
                : snapshot.ball.lastTouchTeam === 'orange'
                  ? '#F97316'
                  : '#E2E8F0';
          particles.emit(
            {
              x: snapshot.ball.pos.x + (Math.random() - 0.5) * 1.1,
              y: snapshot.ball.pos.y + (Math.random() - 0.5) * 1.1,
              z: snapshot.ball.pos.z + (Math.random() - 0.5) * 1.1,
            },
            {
              x: -snapshot.ball.vel.x * 0.08,
              y: -snapshot.ball.vel.y * 0.08,
              z: -snapshot.ball.vel.z * 0.08,
            },
            teamCol,
            ballSpeed > 26 ? 1.15 : 0.9,
            0.34
          );
        }

        syncCarVisuals(snapshot.cars);

        let localCar: CarStateSnapshot | null = null;
        let firstBotDebug: CarStateSnapshot['botDebug'] | undefined;
        const showBotDebug = botDebugModeRef.current;

        for (const car of snapshot.cars) {
          if (car.id === localIdRef.current) localCar = car;
          if (car.isBot && car.botDebug && !firstBotDebug) {
            firstBotDebug = car.botDebug;
          }
          const entry = carVisuals.get(car.id);
          if (!entry) continue;

          const isDemolished = (car.demolishedTimer ?? 0) > 0;
          entry.handle.root.visible = !isDemolished;
          entry.shadow.visible = !isDemolished;

          if (showBotDebug && car.isBot && car.botDebug && !isDemolished) {
            const dbg = getOrCreateBotDebugEntry(car.id);
            dbg.linePos[0] = car.pos.x;
            dbg.linePos[1] = car.pos.y + 0.5;
            dbg.linePos[2] = car.pos.z;
            dbg.linePos[3] = car.botDebug.targetPos.x;
            dbg.linePos[4] = car.botDebug.targetPos.y + 0.4;
            dbg.linePos[5] = car.botDebug.targetPos.z;
            dbg.lineGeo.attributes.position.needsUpdate = true;
            const roleCol =
              car.botDebug.role === 'ATTACKER'
                ? 0xf43f5e
                : car.botDebug.role === 'SUPPORT'
                  ? 0x38bdf8
                  : car.botDebug.role === 'DEFENDER'
                    ? 0xfacc15
                    : 0x10b981;
            dbg.lineMat.color.setHex(roleCol);
            dbg.markerMat.color.setHex(roleCol);
            dbg.marker.position.set(
              car.botDebug.targetPos.x,
              car.botDebug.targetPos.y + 0.45,
              car.botDebug.targetPos.z
            );
            dbg.line.visible = true;
            dbg.marker.visible = true;
          } else {
            const existingDbg = botDebugEntries.get(car.id);
            if (existingDbg) {
              existingDbg.line.visible = false;
              existingDbg.marker.visible = false;
            }
          }

          if (isDemolished) {
            entry.hasLastPos = false;
            continue;
          }

          _quatA.set(car.quat.x, car.quat.y, car.quat.z, car.quat.w);
          const carSpeed = Math.hypot(car.vel.x, car.vel.y, car.vel.z);
          _vecC.set(1, 0, 0).applyQuaternion(_quatA);
          const lateralSpeed = car.vel.x * _vecC.x + car.vel.y * _vecC.y + car.vel.z * _vecC.z;

          entry.handle.root.position.set(car.pos.x, car.pos.y, car.pos.z);
          entry.handle.root.quaternion.copy(_quatA);
          entry.handle.updateDynamicState({
            steerAngle: car.steerAngle,
            wheelSpin: car.wheelSpin,
            isBoosting: car.isBoosting,
            throttle: car.throttle,
            time: elapsedVisual,
            wheelTravel: car.wheelTravel,
            speed: carSpeed,
            lateralSpeed,
            brakeHeat: car.brakeHeat ?? 0,
            isBraking: car.isBraking ?? false,
            isReversing: car.isReversing ?? false,
            respawnFade: car.respawnFade ?? 0,
          });

          entry.shadow.position.set(car.pos.x, 0.025, car.pos.z);
          const hFactor = Math.max(0.2, 1 - car.pos.y / 14);
          entry.shadow.scale.setScalar(hFactor);
          entry.shadowMat.opacity = 0.48 * hFactor;

          if (!pausedRef.current) {
            const trailColors = getTrailColors(car.customization.boostTrail);

            // Speed-stretched boost/supersonic ribbon trail
            _vecA.set(0, 0.25, 1.85).applyQuaternion(_quatA);
            _trailVec.set(car.pos.x + _vecA.x, car.pos.y + _vecA.y, car.pos.z + _vecA.z);
            if (!entry.hasLastPos || entry.lastPos.distanceToSquared(_trailVec) > 144) {
              entry.trail.reset(_trailVec);
              entry.hasLastPos = true;
            }
            entry.lastPos.copy(_trailVec);
            const trailActive = car.isBoosting || car.isSupersonic;
            const trailStr = car.isSupersonic ? 0.85 : car.isBoosting ? 0.68 : 0;
            entry.trail.update(
              _trailVec,
              trailActive,
              trailStr,
              car.isSupersonic ? trailColors.outer : '#f97316',
              trailColors.core,
              THREE.MathUtils.clamp(0.65 + carSpeed * 0.022, 0.7, 1.45)
            );

            // Rocket Boost Flame Particles
            if (car.isBoosting) {
              _vecA.set(0, 0.05, 2.15).applyQuaternion(_quatA);
              _vecB.set(0, 0, 1).applyQuaternion(_quatA);
              particles.emit(
                {
                  x: car.pos.x + _vecA.x + (Math.random() - 0.5) * 0.26,
                  y: car.pos.y + _vecA.y + (Math.random() - 0.5) * 0.22,
                  z: car.pos.z + _vecA.z + (Math.random() - 0.5) * 0.26,
                },
                {
                  x: _vecB.x * 8.5 + car.vel.x * 0.3,
                  y: _vecB.y * 8.5 + 0.5,
                  z: _vecB.z * 8.5 + car.vel.z * 0.3,
                },
                Math.random() > 0.35 ? '#F97316' : trailColors.core,
                0.95,
                0.28
              );
            }

            // Supersonic Wheel/Wingtip Trail
            if (car.isSupersonic) {
              const trailCol =
                car.team === 'blue' ? '#38BDF8' : car.team === 'emerald' ? '#10B981' : '#FB923C';
              for (const sideX of [-0.95, 0.95]) {
                _vecA.set(sideX, -0.1, 1.75).applyQuaternion(_quatA);
                particles.emit(
                  {
                    x: car.pos.x + _vecA.x,
                    y: car.pos.y + _vecA.y,
                    z: car.pos.z + _vecA.z,
                  },
                  {
                    x: car.vel.x * 0.08,
                    y: car.vel.y * 0.08,
                    z: car.vel.z * 0.08,
                  },
                  trailCol,
                  0.68,
                  0.46
                );
              }
            }

            // Drift Skid / Tire Smoke Particles
            const driftVal = car.driftIntensity ?? 0;
            const absLat = Math.abs(lateralSpeed);
            if (
              car.isGrounded &&
              (driftVal > 0.25 || absLat > 5.2 || (absLat > 2.8 && carSpeed > 10 && Math.abs(car.steerAngle) > 0.14))
            ) {
              if (Math.random() < 0.78) {
                const sideX = Math.random() > 0.5 ? 0.85 : -0.85;
                _vecA.set(sideX, -0.35, 1.35).applyQuaternion(_quatA);
                particles.emit(
                  {
                    x: car.pos.x + _vecA.x + (Math.random() - 0.5) * 0.25,
                    y: Math.max(0.12, car.pos.y + _vecA.y),
                    z: car.pos.z + _vecA.z + (Math.random() - 0.5) * 0.25,
                  },
                  {
                    x: (Math.random() - 0.5) * 1.4,
                    y: 0.9 + Math.random() * 1.1,
                    z: (Math.random() - 0.5) * 1.4,
                  },
                  driftVal > 0.55 ? '#E2E8F0' : '#CBD5E1',
                  0.58 + driftVal * 0.25,
                  0.34
                );
              }
            }
          }
        }

        // Update shared F3 ball prediction polyline
        if (showBotDebug && firstBotDebug && firstBotDebug.predictedBallPath.length >= 2) {
          const pts = firstBotDebug.predictedBallPath;
          const count = Math.min(MAX_BALL_PATH_PTS, pts.length);
          for (let i = 0; i < count; i++) {
            ballPathPositions[i * 3] = pts[i].x;
            ballPathPositions[i * 3 + 1] = pts[i].y;
            ballPathPositions[i * 3 + 2] = pts[i].z;
          }
          ballPathGeo.attributes.position.needsUpdate = true;
          ballPathGeo.setDrawRange(0, count);
          ballPathLine.visible = true;
        } else {
          ballPathLine.visible = false;
        }

        arenaHandle.update(elapsedVisual, vdt, snapshot.boostPads);

        if (localCar && (localCar.demolishedTimer ?? 0) <= 0 && !pausedRef.current && snapshot.phase !== 'finished') {
          const spd = Math.hypot(localCar.vel.x, localCar.vel.y, localCar.vel.z);
          audio.updateVehicleAudio(
            true,
            spd,
            localCar.throttle,
            localCar.isBoosting,
            localCar.driftIntensity ?? 0
          );
        } else {
          audio.updateVehicleAudio(false, 0, 0, false, 0);
        }

        // Smooth boost chromatic aberration & supersonic peripheral speed-lines uniforms
        const targetChromatic = localCar?.isBoosting ? 1.0 : 0.0;
        const targetSupersonic = localCar?.isSupersonic ? 1.0 : 0.0;
        boostChromaticSmooth = THREE.MathUtils.damp(boostChromaticSmooth, targetChromatic, 8, dt);
        supersonicSmooth = THREE.MathUtils.damp(supersonicSmooth, targetSupersonic, 6, dt);

        if (cinematicPass) {
          cinematicPass.uniforms.uTime.value = elapsedVisual;
          cinematicPass.uniforms.uBoostChromatic.value = boostChromaticSmooth;
          cinematicPass.uniforms.uSupersonic.value = supersonicSmooth;
          cinematicPass.uniforms.uGoalFlash.value = goalFlash;
          cinematicPass.uniforms.uGrainIntensity.value =
            effectiveQuality === 'low' ? 0.0 : 0.022;
        }

        // Camera System: Rocket League Third-Person Chase Camera (Default) + Optional Cockpit
        if (localCar) {
          const camCfg = settingsRef.current.camera;
          const carPos = _vecA.set(localCar.pos.x, localCar.pos.y, localCar.pos.z);
          const ballPos = _vecB.set(snapshot.ball.pos.x, snapshot.ball.pos.y, snapshot.ball.pos.z);
          _quatA.set(localCar.quat.x, localCar.quat.y, localCar.quat.z, localCar.quat.w);

          _carFwd.set(0, 0, -1).applyQuaternion(_quatA);
          const horizFwdSq = _carFwd.x * _carFwd.x + _carFwd.z * _carFwd.z;
          if (horizFwdSq > 0.08) {
            lastValidForward.set(_carFwd.x, 0, _carFwd.z).normalize();
          }

          if (camCfg.viewMode === 'first_person' && !lookBehindHeld) {
            const carDim = CAR_MAP[localCar.customization.carId]?.dimensions ?? CAR_MAP.nomad.dimensions;
            _vecC
              .set(0, carDim.height * 0.92, -carDim.length * 0.14)
              .applyQuaternion(_quatA)
              .add(carPos);
            camPos.copy(_vecC);

            if (ballCamRef.current) {
              _vecD.copy(ballPos);
              _vecD.y = Math.max(0.85, _vecD.y);
            } else {
              _vecD.set(0, carDim.height * 0.38, -15.5).applyQuaternion(_quatA).add(carPos);
            }

            camTarget.x = THREE.MathUtils.damp(camTarget.x, _vecD.x, 20, dt);
            camTarget.y = THREE.MathUtils.damp(camTarget.y, _vecD.y, 20, dt);
            camTarget.z = THREE.MathUtils.damp(camTarget.z, _vecD.z, 20, dt);

            _upCar.set(0, 1, 0).applyQuaternion(_quatA);
            _vecE.copy(_upCar).lerp(_worldUp, ballCamRef.current ? 0.75 : 0.45).normalize();
            camUp.lerp(_vecE, 1 - Math.exp(-12 * dt)).normalize();
            camera.up.copy(camUp);
          } else {
            _upCar.set(0, 1, 0).applyQuaternion(_quatA);
            const onWallOrCeiling =
              localCar.isGrounded &&
              (_upCar.y < 0.78 ||
                Math.abs(localCar.pos.x) > ARENA_BOUNDS.HALF_WIDTH - 4.5 ||
                Math.abs(localCar.pos.z) > ARENA_BOUNDS.HALF_LENGTH - 4.5 ||
                localCar.pos.y > 4.5);

            if (onWallOrCeiling && !lookBehindHeld) {
              _vecE.copy(_worldUp).lerp(_upCar, 0.55).normalize();
              camUp.lerp(_vecE, 1 - Math.exp(-3.6 * dt)).normalize();
            } else {
              camUp.lerp(_worldUp, 1 - Math.exp(-6.5 * dt)).normalize();
            }
            camera.up.copy(camUp);

            const desiredPos = _vecC;
            const desiredLook = _vecD;

            if (lookBehindHeld) {
              desiredPos
                .copy(lastValidForward)
                .multiplyScalar(camCfg.distance * 0.92)
                .add(carPos)
                .add(_vecE.set(0, camCfg.height * 0.95, 0));

              desiredLook
                .copy(carPos)
                .addScaledVector(lastValidForward, -8.0)
                .add(_vecE.set(0, 1.35, 0));
            } else if (ballCamRef.current) {
              _vecE.subVectors(carPos, ballPos);
              _vecE.y = 0;
              if (_vecE.lengthSq() > 2.2) {
                lastValidBallDir.copy(_vecE).normalize();
              }

              const ballElev = Math.max(0, ballPos.y - carPos.y);
              const elevFactor = THREE.MathUtils.clamp(ballElev / 18, 0, 1);
              const camH = THREE.MathUtils.lerp(
                camCfg.height,
                Math.max(1.4, camCfg.height - 1.15),
                elevFactor
              );

              desiredPos
                .copy(lastValidBallDir)
                .multiplyScalar(camCfg.distance)
                .add(carPos)
                .add(_vecE.set(0, camH, 0));

              _vecE.subVectors(ballPos, carPos);
              const distToBall = _vecE.length();
              if (distToBall > 0.5) {
                _vecE.multiplyScalar(Math.min(distToBall, 18) / distToBall);
              }
              desiredLook.copy(carPos).add(_vecE);
              desiredLook.y = Math.max(1.25, desiredLook.y * 0.72 + (carPos.y + 1.2) * 0.28);
            } else {
              desiredPos
                .copy(lastValidForward)
                .multiplyScalar(-camCfg.distance)
                .add(carPos)
                .add(_vecE.set(0, camCfg.height, 0));

              desiredLook
                .copy(carPos)
                .addScaledVector(lastValidForward, 5.0)
                .add(_vecE.set(0, 1.65, 0));
            }

            _rayOrigin.copy(carPos).add(_vecE.set(0, 1.35, 0));
            clampCameraToArena(_rayOrigin, desiredPos, gameMode);

            const lambdaPos = lookBehindHeld ? 18 : 9.2;
            const lambdaLook = lookBehindHeld ? 18 : 6.4;

            camPos.x = THREE.MathUtils.damp(camPos.x, desiredPos.x, lambdaPos, dt);
            camPos.y = THREE.MathUtils.damp(camPos.y, desiredPos.y, lambdaPos, dt);
            camPos.z = THREE.MathUtils.damp(camPos.z, desiredPos.z, lambdaPos, dt);

            camTarget.x = THREE.MathUtils.damp(camTarget.x, desiredLook.x, lambdaLook, dt);
            camTarget.y = THREE.MathUtils.damp(camTarget.y, desiredLook.y, lambdaLook, dt);
            camTarget.z = THREE.MathUtils.damp(camTarget.z, desiredLook.z, lambdaLook, dt);
          }

          const fovBoost = localCar.isSupersonic ? 10 : localCar.isBoosting ? 8 : 0;
          const targetHFov = camCfg.fov + fovBoost;
          const nextHFov = THREE.MathUtils.damp(currentHFov, targetHFov, 5.5, dt);
          if (Math.abs(nextHFov - currentHFov) > 0.02) {
            currentHFov = nextHFov;
            camera.fov = horizontalToVerticalFov(currentHFov, camera.aspect);
            camera.updateProjectionMatrix();
          }
        }

        camera.position.copy(camPos);
        if (shakeIntensity > 0.01) {
          camera.position.x += (Math.random() - 0.5) * shakeIntensity;
          camera.position.y += (Math.random() - 0.5) * shakeIntensity;
          camera.position.z += (Math.random() - 0.5) * shakeIntensity;
          shakeIntensity = THREE.MathUtils.damp(shakeIntensity, 0, 8, dt);
        }
        camera.lookAt(camTarget);
        camera.updateMatrixWorld();

        const viewW = container.clientWidth || window.innerWidth;
        const viewH = container.clientHeight || window.innerHeight;

        if (ballIndicatorRef.current && ballArrowElRef.current && ballDistElRef.current && localCar) {
          _camSpaceVec
            .set(snapshot.ball.pos.x, snapshot.ball.pos.y, snapshot.ball.pos.z)
            .applyMatrix4(camera.matrixWorldInverse);
          const distMeters = Math.round(
            Math.hypot(
              snapshot.ball.pos.x - localCar.pos.x,
              snapshot.ball.pos.y - localCar.pos.y,
              snapshot.ball.pos.z - localCar.pos.z
            )
          );
          _projVec.set(snapshot.ball.pos.x, snapshot.ball.pos.y, snapshot.ball.pos.z).project(camera);
          const inFront = _camSpaceVec.z < -0.5;
          const onScreen =
            inFront && Math.abs(_projVec.x) <= 0.88 && Math.abs(_projVec.y) <= 0.86;

          if (onScreen || snapshot.phase === 'finished') {
            ballIndicatorRef.current.style.opacity = '0';
          } else {
            let dirX = _camSpaceVec.x;
            let dirY = _camSpaceVec.y;
            if (!inFront && Math.hypot(dirX, dirY) < 0.1) {
              dirX = 0.01;
              dirY = -1;
            }
            const angleRad = Math.atan2(dirY, dirX);
            const rx = Math.min(viewW * 0.42, 420);
            const ry = Math.min(viewH * 0.36, 260);
            const px = viewW * 0.5 + Math.cos(angleRad) * rx;
            const py = viewH * 0.5 - Math.sin(angleRad) * ry;
            const rotDeg = 90 - (angleRad * 180) / Math.PI;

            ballIndicatorRef.current.style.opacity = '1';
            ballIndicatorRef.current.style.left = `${px}px`;
            ballIndicatorRef.current.style.top = `${py}px`;
            ballArrowElRef.current.style.transform = `rotate(${rotDeg}deg)`;
            ballDistElRef.current.textContent = `${distMeters}m`;
          }
        }

        for (const car of snapshot.cars) {
          const entry = carVisuals.get(car.id);
          if (!entry) continue;
          if (car.id === localIdRef.current || (car.demolishedTimer ?? 0) > 0) {
            entry.nameplateEl.style.opacity = '0';
            continue;
          }
          _projVec.set(car.pos.x, car.pos.y + 2.2, car.pos.z);
          _projVec.project(camera);
          const visible = _projVec.z < 1 && _projVec.z > -1;
          if (!visible) {
            entry.nameplateEl.style.opacity = '0';
          } else {
            const sx = (_projVec.x * 0.5 + 0.5) * viewW;
            const sy = (-_projVec.y * 0.5 + 0.5) * viewH;
            entry.nameplateEl.style.left = `${sx}px`;
            entry.nameplateEl.style.top = `${sy}px`;
            entry.nameplateEl.style.opacity = car.connected ? '1' : '0.45';
            const baseName = car.connected ? car.name : `${car.name} (Offline)`;
            entry.nameplateEl.textContent =
              botDebugModeRef.current && car.isBot && car.botDebug
                ? `${baseName} [${car.botDebug.state} · ${car.botDebug.role}]`
                : baseName;
          }
        }
      }

      if (!pausedRef.current) {
        particles.update(vdt);
      }

      if (composer && !isSoftwareGl) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      audio.updateVehicleAudio(false, 0, 0, false);

      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', handleRestored);

      for (const entry of carVisuals.values()) {
        entry.handle.dispose();
        entry.trail.dispose(scene);
        entry.shadowMat.dispose();
        entry.nameplateEl.remove();
      }
      carVisuals.clear();

      for (const dbg of botDebugEntries.values()) {
        scene.remove(dbg.line);
        scene.remove(dbg.marker);
        dbg.lineGeo.dispose();
        dbg.lineMat.dispose();
        dbg.markerMat.dispose();
      }
      botDebugEntries.clear();
      scene.remove(ballPathLine);
      ballPathGeo.dispose();
      ballPathMat.dispose();
      botTargetMarkerGeo.dispose();

      for (const sw of shockwaves) {
        scene.remove(sw.mesh);
        sw.mat.dispose();
      }
      shockwaveGeo.dispose();

      ballTrail.dispose(scene);
      carShadowGeo.dispose();
      ballGeo.dispose();
      ballMat.dispose();
      ballGlowGeo.dispose();
      ballGlowMat.dispose();
      ballTex.dispose();
      ballEmissiveTex.dispose();
      dropRingGeo.dispose();
      dropRingMat.dispose();
      ballShadowGeo.dispose();
      ballShadowMat.dispose();
      shadowTex.dispose();

      particles.dispose(scene);
      arenaHandle.dispose();
      envTex.dispose();
      composer?.dispose();
      renderer.dispose();
    };
  }, [arenaId, gameMode, settings.graphics, audio]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#070A0F]">
      <div ref={mountRef} className="w-full h-full" />
      <div ref={nameplateLayerRef} className="pointer-events-none absolute inset-0 overflow-hidden z-10" />

      {botDebugMode && (
        <div className="pointer-events-none absolute top-20 left-4 z-20 rounded-lg border border-cyan-400/50 bg-[#070B12]/90 px-3 py-1.5 text-[11px] font-bold text-cyan-300 shadow-lg">
          AI DEBUG [F3]: ON · Cyan = Ball Sim · Marker = Bot Target
        </div>
      )}

      {/* Off-Screen Ball Direction Indicator */}
      <div
        ref={ballIndicatorRef}
        className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 transition-opacity duration-100 opacity-0"
      >
        <div
          ref={ballArrowElRef}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-amber-500/90 text-slate-950 shadow-lg border border-amber-200/80"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
            <path d="M12 3l7 14-7-3.5L5 17z" />
          </svg>
        </div>
        <span
          ref={ballDistElRef}
          className="rounded bg-black/80 px-1.5 py-0.5 font-mono-num text-[10px] font-bold text-amber-300"
        >
          0m
        </span>
      </div>

      {contextLost && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#070A0F]/95 text-slate-200">
          <div className="text-center space-y-2 px-6">
            <h2 className="font-display text-2xl font-bold">Graphics Context Interrupted</h2>
            <p className="text-sm text-slate-400">Restoring 3D Arena viewport...</p>
          </div>
        </div>
      )}
    </div>
  );
};
