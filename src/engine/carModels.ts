import * as THREE from 'three';
import { BOOST_TRAIL_CATALOG, CAR_MAP } from '../shared/constants.ts';
import type {
  BoostTrailId,
  CarCustomization,
  CarId,
  PaintFinish,
  WheelStyleId,
} from '../shared/types.ts';
import { applyFresnelRimShader, createBoostFlameShaderMaterial } from './shaders.ts';
import {
  createBrakeRotorTexture,
  createBrushedMetalTexture,
  createCarFlakeNormalTexture,
  createCarLiveryTexture,
  createCarbonFiberTexture,
  createGrilleMeshTexture,
  createLicensePlateTexture,
  createTireSidewallTexture,
  createTireTreadNormalTexture,
} from './textures.ts';

export interface CarMeshHandle {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  wheelSteerPivots: THREE.Group[]; // [FL, FR]
  wheelSuspensionPivots: THREE.Group[]; // [FL, FR, RL, RR]
  wheelSpinGroups: THREE.Group[]; // [FL, FR, RL, RR]
  flameMeshes: THREE.Mesh[];
  boostLight: THREE.PointLight | null;
  updateAppearance: (customization: CarCustomization, teamColorHex?: string) => void;
  updateDynamicState: (opts: {
    steerAngle: number;
    wheelSpin: number;
    isBoosting: boolean;
    throttle: number;
    time: number;
    wheelTravel?: [number, number, number, number];
    speed?: number;
    lateralSpeed?: number;
    brakeHeat?: number;
    isBraking?: boolean;
    isReversing?: boolean;
    respawnFade?: number;
  }) => void;
  setFirstPersonMode: (enabled: boolean) => void;
  dispose: () => void;
}

// Shared immutable procedural texture cache across all cars
let _sharedCarTextures: {
  flakeNormal: THREE.DataTexture;
  carbon: THREE.CanvasTexture;
  treadNormal: THREE.DataTexture;
  sidewall: THREE.CanvasTexture;
  brushed: THREE.CanvasTexture;
  grille: THREE.CanvasTexture;
  rotor: THREE.CanvasTexture;
} | null = null;

function getSharedCarTextures() {
  if (!_sharedCarTextures) {
    _sharedCarTextures = {
      flakeNormal: createCarFlakeNormalTexture(4),
      carbon: createCarbonFiberTexture(4),
      treadNormal: createTireTreadNormalTexture(4),
      sidewall: createTireSidewallTexture(4),
      brushed: createBrushedMetalTexture(4),
      grille: createGrilleMeshTexture(4),
      rotor: createBrakeRotorTexture(4),
    };
  }
  return _sharedCarTextures;
}

function createSmoothProfileShape(points: [number, number][]): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  const curvePts = points.slice(1).map(([x, y]) => new THREE.Vector2(x, y));
  shape.splineThru(curvePts);
  shape.lineTo(points[0][0], points[0][1]);
  return shape;
}

function getSculptedProfilePoints(carId: CarId, halfL: number, h: number): [number, number][] {
  // X goes from -halfL (rear, becomes +Z after rotY(PI/2)) to +halfL (front, becomes -Z)
  switch (carId) {
    case 'nomad': // Hot Hatch / Rally: compact widebody hatch with steep rear C-pillar & muscular hood
      return [
        [-halfL * 0.94, -h * 0.18],
        [-halfL * 0.95, h * 0.36],
        [-halfL * 0.84, h * 0.82],
        [-halfL * 0.56, h * 0.98],
        [-halfL * 0.06, h * 0.98],
        [halfL * 0.25, h * 0.72],
        [halfL * 0.52, h * 0.38],
        [halfL * 0.88, h * 0.24],
        [halfL * 0.97, 0.0],
        [halfL * 0.9, -h * 0.18],
      ];
    case 'striker': // Sport Coupe: sculpted long hood, fastback roofline, taut rear deck
      return [
        [-halfL * 0.98, -h * 0.2],
        [-halfL * 0.96, h * 0.34],
        [-halfL * 0.64, h * 0.45],
        [-halfL * 0.36, h * 0.82],
        [halfL * 0.04, h * 0.84],
        [halfL * 0.36, h * 0.46],
        [halfL * 0.86, h * 0.24],
        [halfL * 0.98, 0.04],
        [halfL * 0.94, -h * 0.2],
      ];
    case 'hyperion': // Supercar: razor-low mid-engine exotic wedge with forward cab
      return [
        [-halfL * 0.98, -h * 0.22],
        [-halfL * 0.94, h * 0.3],
        [-halfL * 0.56, h * 0.48],
        [-halfL * 0.12, h * 0.72],
        [halfL * 0.26, h * 0.58],
        [halfL * 0.72, h * 0.22],
        [halfL * 0.98, 0.02],
        [halfL * 0.94, -h * 0.22],
      ];
    case 'bullitt':
      return [
        [-halfL * 0.98, -h * 0.22],
        [-halfL * 0.96, h * 0.4],
        [-halfL * 0.56, h * 0.46],
        [-halfL * 0.34, h * 0.88],
        [halfL * 0.12, h * 0.88],
        [halfL * 0.38, h * 0.48],
        [halfL * 0.92, h * 0.34],
        [halfL * 0.98, -h * 0.2],
      ];
    case 'rallyx':
      return [
        [-halfL * 0.94, -h * 0.2],
        [-halfL * 0.9, h * 0.84],
        [-halfL * 0.34, h * 0.96],
        [halfL * 0.16, h * 0.9],
        [halfL * 0.48, h * 0.42],
        [halfL * 0.92, h * 0.22],
        [halfL * 0.95, -h * 0.2],
      ];
    case 'apex_s':
      return [
        [-halfL * 0.98, -h * 0.22],
        [-halfL * 0.94, h * 0.38],
        [-halfL * 0.52, h * 0.54],
        [-halfL * 0.16, h * 0.8],
        [halfL * 0.24, h * 0.72],
        [halfL * 0.62, h * 0.32],
        [halfL * 0.98, h * 0.08],
        [halfL * 0.95, -h * 0.22],
      ];
    case 'formula':
      return [
        [-halfL * 0.98, -h * 0.2],
        [-halfL * 0.88, h * 0.52],
        [-halfL * 0.25, h * 0.68],
        [halfL * 0.12, h * 0.44],
        [halfL * 0.74, h * 0.2],
        [halfL * 0.98, 0.0],
        [halfL * 0.92, -h * 0.22],
      ];
    case 'juggernaut':
      return [
        [-halfL * 0.98, -h * 0.18],
        [-halfL * 0.96, h * 0.72],
        [-halfL * 0.48, h * 0.76],
        [-halfL * 0.28, h * 1.06],
        [halfL * 0.34, h * 1.04],
        [halfL * 0.56, h * 0.56],
        [halfL * 0.96, h * 0.38],
        [halfL * 0.98, -h * 0.18],
      ];
    case 'volt':
      return [
        [-halfL * 0.98, -h * 0.22],
        [-halfL * 0.9, h * 0.48],
        [-halfL * 0.32, h * 0.86],
        [halfL * 0.2, h * 0.82],
        [halfL * 0.64, h * 0.38],
        [halfL * 0.98, h * 0.14],
        [halfL * 0.94, -h * 0.22],
      ];
    case 'drift':
    default:
      return [
        [-halfL * 0.96, -h * 0.22],
        [-halfL * 0.94, h * 0.42],
        [-halfL * 0.44, h * 0.84],
        [halfL * 0.06, h * 0.84],
        [halfL * 0.42, h * 0.38],
        [halfL * 0.96, h * 0.16],
        [halfL * 0.94, -h * 0.22],
      ];
  }
}

function applyPaintFinishToMaterial(
  mat: THREE.MeshPhysicalMaterial,
  finish: PaintFinish
): void {
  if (finish === 'matte') {
    mat.metalness = 0.16;
    mat.roughness = 0.68;
    mat.clearcoat = 0.08;
    mat.clearcoatRoughness = 0.55;
    mat.iridescence = 0.0;
    mat.normalScale.set(0.08, 0.08);
    mat.envMapIntensity = 0.75;
  } else if (finish === 'pearl') {
    mat.metalness = 0.54;
    mat.roughness = 0.21;
    mat.clearcoat = 1.0;
    mat.clearcoatRoughness = 0.04;
    mat.iridescence = 0.92;
    mat.iridescenceIOR = 1.45;
    mat.normalScale.set(0.24, 0.24);
    mat.envMapIntensity = 1.55;
  } else {
    // metallic
    mat.metalness = 0.82;
    mat.roughness = 0.24;
    mat.clearcoat = 1.0;
    mat.clearcoatRoughness = 0.05;
    mat.iridescence = 0.0;
    mat.normalScale.set(0.3, 0.3);
    mat.envMapIntensity = 1.42;
  }
  mat.needsUpdate = true;
}

export function createCarModel(
  customization: CarCustomization,
  options?: { enablePointLights?: boolean; teamColorHex?: string }
): CarMeshHandle {
  const def = CAR_MAP[customization.carId] ?? CAR_MAP.nomad;
  const { width, height, length, wheelRadius, wheelWidth } = def.dimensions;
  const halfL = length * 0.5;
  const halfW = width * 0.5;
  const accentHex = customization.teamAccent ?? options?.teamColorHex ?? customization.secondaryColor;
  const paintFinish: PaintFinish = customization.paintFinish ?? 'metallic';
  const wheelStyle: WheelStyleId = customization.wheelStyle ?? 'sport_5';

  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: THREE.Material[] = [];
  const texturesToDispose: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometriesToDispose.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materialsToDispose.push(m);
    return m;
  };

  const shared = getSharedCarTextures();
  const liveryTex = createCarLiveryTexture(
    customization.primaryColor,
    customization.secondaryColor,
    customization.carId,
    4
  );
  texturesToDispose.push(liveryTex);

  const plateCode =
    customization.carId === 'striker'
      ? 'VLC-GT8'
      : customization.carId === 'hyperion'
        ? 'VLC-912'
        : 'VLC-RS4';
  const plateTex = createLicensePlateTexture(plateCode, accentHex, 4);
  texturesToDispose.push(plateTex);

  // 1. PBR Photorealistic Materials
  const primaryMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: liveryTex,
      normalMap: shared.flakeNormal,
      normalScale: new THREE.Vector2(0.3, 0.3),
      metalness: 0.82,
      roughness: 0.24,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.42,
    })
  );
  applyPaintFinishToMaterial(primaryMat, paintFinish);
  const paintRimCtrl = applyFresnelRimShader(primaryMat, accentHex, 3.1, 0.38);

  const secondaryMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(customization.secondaryColor),
      normalMap: shared.flakeNormal,
      normalScale: new THREE.Vector2(0.18, 0.18),
      metalness: 0.65,
      roughness: 0.25,
      clearcoat: 0.9,
      clearcoatRoughness: 0.07,
      envMapIntensity: 1.25,
    })
  );

  const carbonMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: shared.carbon,
      metalness: 0.28,
      roughness: 0.32,
      clearcoat: 0.72,
      clearcoatRoughness: 0.14,
      envMapIntensity: 1.15,
    })
  );

  const brushedMetalMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xdbe4ef,
      map: shared.brushed,
      metalness: 0.92,
      roughness: 0.2,
      anisotropy: 0.75,
      envMapIntensity: 1.4,
    })
  );

  const exhaustInnerMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: 0xf97316,
      emissiveIntensity: 0.05,
      roughness: 0.35,
      metalness: 0.6,
    })
  );

  const rotorMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xd1d8e0,
      map: shared.rotor,
      emissive: 0xff4500,
      emissiveIntensity: 0,
      metalness: 0.88,
      roughness: 0.28,
    })
  );

  const grilleMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: shared.grille,
      metalness: 0.45,
      roughness: 0.55,
    })
  );

  const darkInteriorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0b0e14,
      metalness: 0.18,
      roughness: 0.76,
    })
  );

  const seatMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x161b24,
      metalness: 0.1,
      roughness: 0.85,
    })
  );

  const seamMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x05070b,
      roughness: 0.88,
      metalness: 0.12,
    })
  );

  const glassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x0b1628,
      metalness: 0.1,
      roughness: 0.04,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.7,
      opacity: 0.58,
      transparent: true,
    })
  );

  const headlightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe0f2fe,
      emissiveIntensity: 2.3,
      roughness: 0.08,
    })
  );

  const taillightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff2233,
      emissive: 0xef4444,
      emissiveIntensity: 1.65,
      roughness: 0.15,
    })
  );

  const reverseLightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: 0xffffff,
      emissiveIntensity: 0.15,
      roughness: 0.12,
    })
  );

  const accentGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex),
      emissive: new THREE.Color(accentHex),
      emissiveIntensity: 1.4,
      roughness: 0.18,
      metalness: 0.35,
    })
  );

  const tireMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x16191f,
      normalMap: shared.treadNormal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      metalness: 0.05,
      roughness: 0.88,
    })
  );

  const sidewallMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: shared.sidewall,
      roughness: 0.84,
      metalness: 0.06,
    })
  );

  const plateMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: plateTex,
      roughness: 0.35,
      metalness: 0.25,
    })
  );

  // 2. Primary Sculpted Body Silhouette (Beveled smooth spline extrusion)
  const bodyWidth = customization.carId === 'formula' ? width * 0.44 : width * 0.78;
  const profilePoints = getSculptedProfilePoints(customization.carId, halfL, height);
  const bodyShape = createSmoothProfileShape(profilePoints);
  const bodyGeo = trackGeo(
    new THREE.ExtrudeGeometry(bodyShape, {
      depth: bodyWidth,
      curveSegments: 20,
      bevelEnabled: true,
      bevelThickness: 0.14,
      bevelSize: 0.095,
      bevelSegments: 5,
      steps: 1,
    })
  );
  bodyGeo.translate(0, 0, -bodyWidth * 0.5);
  bodyGeo.rotateY(Math.PI * 0.5); // Front faces -Z
  bodyGeo.computeVertexNormals();
  if (bodyGeo.hasAttribute('uv')) {
    bodyGeo.computeTangents();
  }

  const bodyMesh = new THREE.Mesh(bodyGeo, primaryMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyMesh.position.y = 0.06;
  bodyGroup.add(bodyMesh);

  // 3. Flared Wheel Arches / Fenders with Dark Wheel Wells (real wheel arch gap!)
  const wheelX = halfW - wheelWidth * 0.24;
  const wheelZFront = -halfL * 0.62;
  const wheelZRear = halfL * 0.6;
  const wheelY = -height * 0.27;

  if (customization.carId !== 'formula') {
    const archRad = wheelRadius * 1.24;
    const fenderGeo = trackGeo(
      new THREE.TorusGeometry(archRad, 0.145, 10, 20, Math.PI * 1.08)
    );
    fenderGeo.rotateY(Math.PI * 0.5);

    const archWellGeo = trackGeo(
      new THREE.CylinderGeometry(archRad * 0.96, archRad * 0.96, wheelWidth * 1.25, 16, 1, false, 0, Math.PI)
    );
    archWellGeo.rotateZ(Math.PI * 0.5);
    archWellGeo.rotateX(Math.PI * 0.5);

    for (const side of [-1, 1]) {
      for (const fz of [wheelZFront, wheelZRear]) {
        const fender = new THREE.Mesh(fenderGeo, primaryMat);
        fender.position.set(side * (bodyWidth * 0.54), wheelY + 0.05, fz);
        fender.scale.set(1.18, 0.96, 1.1);
        fender.castShadow = true;
        bodyGroup.add(fender);

        const well = new THREE.Mesh(archWellGeo, seamMat);
        well.position.set(side * (bodyWidth * 0.42), wheelY + 0.04, fz);
        bodyGroup.add(well);
      }
    }
  }

  // 4. Sculpted Tinted Glass Canopy + Visible Detailed Cockpit Interior (Seats, Dash, Turning Steering Wheel)
  const canopyLen =
    customization.carId === 'hyperion'
      ? length * 0.48
      : customization.carId === 'striker'
        ? length * 0.44
        : length * 0.42;
  const canopyWid = customization.carId === 'formula' ? 0.52 : bodyWidth * 0.78;
  const canopyH = customization.carId === 'hyperion' ? height * 0.44 : height * 0.48;
  const canopyZ = customization.carId === 'hyperion' ? -0.14 : customization.carId === 'striker' ? 0.16 : 0.14;
  const canopyY = customization.carId === 'hyperion' ? height * 0.51 : height * 0.61;

  const cockpitGroup = new THREE.Group();
  cockpitGroup.position.set(0, canopyY - 0.12, canopyZ);
  bodyGroup.add(cockpitGroup);

  // Cockpit tub base
  const cockpitFloor = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(canopyWid * 0.8, 0.08, canopyLen * 0.72)),
    darkInteriorMat
  );
  cockpitGroup.add(cockpitFloor);

  // Twin bucket seats with bolsters
  const seatOffsetX = customization.carId === 'formula' ? [0] : [-canopyWid * 0.22, canopyWid * 0.22];
  for (const sx of seatOffsetX) {
    const seatBack = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.28, 0.34, 0.08)),
      seatMat
    );
    seatBack.position.set(sx, 0.18, 0.16);
    seatBack.rotation.x = 0.22;
    cockpitGroup.add(seatBack);

    const headrest = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.16, 0.12, 0.07)),
      accentGlowMat
    );
    headrest.position.set(sx, 0.36, 0.21);
    cockpitGroup.add(headrest);
  }

  // Sculpted dashboard + glowing digital instrument display
  const dash = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(canopyWid * 0.76, 0.14, 0.22)),
    darkInteriorMat
  );
  dash.position.set(0, 0.14, -canopyLen * 0.26);
  cockpitGroup.add(dash);

  const dashDisplay = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.32, 0.055, 0.02)),
    accentGlowMat
  );
  dashDisplay.position.set(seatOffsetX[0], 0.2, -canopyLen * 0.16);
  cockpitGroup.add(dashDisplay);

  // Turning Steering Wheel Pivot (mounted on driver side)
  const steeringWheelGroup = new THREE.Group();
  steeringWheelGroup.position.set(seatOffsetX[0], 0.19, -canopyLen * 0.12);
  steeringWheelGroup.rotation.x = -0.35;
  const swRim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.11, 0.018, 8, 18)), brushedMetalMat);
  steeringWheelGroup.add(swRim);
  const swSpokeH = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.2, 0.02, 0.016)), carbonMat);
  steeringWheelGroup.add(swSpokeH);
  const swSpokeV = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.02, 0.1, 0.016)), accentGlowMat);
  swSpokeV.position.y = -0.05;
  steeringWheelGroup.add(swSpokeV);
  cockpitGroup.add(steeringWheelGroup);

  // Tinted reflective outer glass canopy
  const canopyGeo = trackGeo(new THREE.SphereGeometry(0.5, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.56));
  const canopyMesh = new THREE.Mesh(canopyGeo, glassMat);
  canopyMesh.scale.set(canopyWid, canopyH, canopyLen);
  canopyMesh.position.set(0, canopyY, canopyZ);
  bodyGroup.add(canopyMesh);

  // 5. Front & Rear Bumpers with Perforated Mesh Grilles + Carbon Undertray/Splitter/Diffuser
  const undertray = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(width * 0.86, 0.09, length * 0.92)),
    darkInteriorMat
  );
  undertray.position.set(0, -0.17, 0);
  undertray.castShadow = true;
  bodyGroup.add(undertray);

  // Front mesh grille & twin side intakes
  const mainGrille = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(bodyWidth * 0.64, height * 0.2, 0.1)),
    grilleMat
  );
  mainGrille.position.set(0, 0.02, -halfL + 0.04);
  bodyGroup.add(mainGrille);

  // Rear bumper honeycomb vent + Fictional License Plate
  const rearMeshVent = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(bodyWidth * 0.68, height * 0.15, 0.08)),
    grilleMat
  );
  rearMeshVent.position.set(0, 0.06, halfL - 0.02);
  bodyGroup.add(rearMeshVent);

  const licensePlate = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.54, 0.17, 0.03)),
    plateMat
  );
  licensePlate.position.set(0, 0.14, halfL + 0.025);
  bodyGroup.add(licensePlate);

  // Front sculpted carbon splitter
  const splitterShape = createSmoothProfileShape([
    [-width * 0.48, -0.22],
    [-width * 0.5, 0.14],
    [-width * 0.3, 0.32],
    [width * 0.3, 0.32],
    [width * 0.5, 0.14],
    [width * 0.48, -0.22],
  ]);
  const splitterGeo = trackGeo(
    new THREE.ExtrudeGeometry(splitterShape, {
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 2,
    })
  );
  splitterGeo.rotateX(Math.PI * 0.5);
  const splitter = new THREE.Mesh(splitterGeo, carbonMat);
  splitter.position.set(0, -0.14, -halfL + 0.07);
  splitter.castShadow = true;
  bodyGroup.add(splitter);

  // Side Skirts, Underglow, Door Seams, Door Handles, Shaped Side Mirrors, Fuel Cap
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.15, 0.085, length * 0.52)),
      carbonMat
    );
    skirt.position.set(side * (halfW * 0.89), -0.15, 0.02);
    bodyGroup.add(skirt);

    const underglow = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.06, 0.04, length * 0.52)),
      accentGlowMat
    );
    underglow.position.set(side * (halfW * 0.84), -0.19, 0.02);
    bodyGroup.add(underglow);

    // Door panel seam + flush aerodynamic door handle
    const doorSeam = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.025, height * 0.46, 0.025)),
      seamMat
    );
    doorSeam.position.set(side * (bodyWidth * 0.5 + 0.085), height * 0.18, 0.28);
    bodyGroup.add(doorSeam);

    const doorHandle = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.045, 0.036, 0.18)),
      brushedMetalMat
    );
    doorHandle.position.set(side * (bodyWidth * 0.5 + 0.092), height * 0.29, 0.12);
    bodyGroup.add(doorHandle);

    // Side intake recess with grille mesh
    const intake = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.12, height * 0.24, 0.58)),
      grilleMat
    );
    intake.position.set(side * (bodyWidth * 0.5 + 0.055), height * 0.14, 0.54);
    bodyGroup.add(intake);

    // Sculpted side mirror arm + tapered mirror housing + glass lens
    const mirrorArm = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.16, 0.036, 0.055)),
      carbonMat
    );
    mirrorArm.position.set(side * (bodyWidth * 0.52 + 0.08), height * 0.48, -0.35);
    bodyGroup.add(mirrorArm);

    const mirrorCap = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.09, 12, 8)),
      primaryMat
    );
    mirrorCap.scale.set(1.25, 0.7, 1.45);
    mirrorCap.position.set(side * (bodyWidth * 0.52 + 0.16), height * 0.5, -0.32);
    bodyGroup.add(mirrorCap);
  }

  // Brushed aluminum motorsport fuel filler cap on right rear quarter panel
  const fuelCap = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 14)),
    brushedMetalMat
  );
  fuelCap.rotation.z = Math.PI * 0.5;
  fuelCap.position.set(bodyWidth * 0.5 + 0.082, height * 0.34, halfL * 0.48);
  bodyGroup.add(fuelCap);

  // Rear carbon diffuser with vertical strakes
  const diffuserBase = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(width * 0.8, 0.12, 0.34)),
    carbonMat
  );
  diffuserBase.position.set(0, -0.14, halfL - 0.12);
  diffuserBase.rotation.x = -0.18;
  bodyGroup.add(diffuserBase);
  for (let fx = -0.54; fx <= 0.54; fx += 0.27) {
    const strake = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.035, 0.16, 0.3)),
      carbonMat
    );
    strake.position.set(fx, -0.13, halfL - 0.08);
    bodyGroup.add(strake);
  }

  // Hood panel seams
  for (const side of [-1, 1]) {
    const hoodGroove = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.02, 0.02, length * 0.3)),
      seamMat
    );
    hoodGroove.position.set(side * (bodyWidth * 0.26), height * 0.36, -halfL * 0.52);
    hoodGroove.rotation.x = 0.14;
    bodyGroup.add(hoodGroove);
  }

  // 6. Car-Specific Aero Wing / Spoilers & Details
  const addCarbonWing = (yPos: number, zPos: number, span: number, chord = 0.42, pylonH = 0.36) => {
    const wingShape = createSmoothProfileShape([
      [-span * 0.5, -chord * 0.45],
      [-span * 0.48, chord * 0.45],
      [0, chord * 0.52],
      [span * 0.48, chord * 0.45],
      [span * 0.5, -chord * 0.45],
    ]);
    const wingGeo = trackGeo(
      new THREE.ExtrudeGeometry(wingShape, {
        depth: 0.05,
        bevelEnabled: true,
        bevelThickness: 0.015,
        bevelSize: 0.015,
        bevelSegments: 2,
      })
    );
    wingGeo.rotateX(Math.PI * 0.5 + 0.14);
    const wingBlade = new THREE.Mesh(wingGeo, carbonMat);
    wingBlade.position.set(0, yPos, zPos);
    wingBlade.castShadow = true;
    bodyGroup.add(wingBlade);

    for (const side of [-1, 1]) {
      const endplate = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.04, 0.24, chord * 1.15)),
        carbonMat
      );
      endplate.position.set(side * span * 0.5, yPos - 0.03, zPos);
      bodyGroup.add(endplate);

      const endTrim = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.045, 0.04, chord * 1.05)),
        accentGlowMat
      );
      endTrim.position.set(side * span * 0.5, yPos + 0.07, zPos);
      bodyGroup.add(endTrim);

      const pylon = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.055, pylonH, 0.22)),
        carbonMat
      );
      pylon.position.set(side * span * 0.28, yPos - pylonH * 0.5, zPos + 0.04);
      pylon.rotation.x = -0.18;
      bodyGroup.add(pylon);
    }
  };

  if (customization.carId === 'nomad') {
    // Hot Hatch / Rally: high rally WRC bi-plane wing + roof air scoop
    addCarbonWing(height * 1.12, halfL - 0.1, width * 0.96, 0.44, 0.52);
    const roofScoop = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.16, 0.22, 0.52, 12)),
      carbonMat
    );
    roofScoop.rotation.x = Math.PI * 0.5;
    roofScoop.position.set(0, height * 1.03, -0.05);
    bodyGroup.add(roofScoop);
  } else if (customization.carId === 'striker') {
    // Sport Coupe: wide GT wing + sculpted power bulge hood
    addCarbonWing(height * 0.68, halfL - 0.14, width * 0.96, 0.4, 0.34);
    const powerDome = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.38, 14, 10)), primaryMat);
    powerDome.scale.set(0.95, 0.26, 2.2);
    powerDome.position.set(0, height * 0.38, -halfL * 0.42);
    bodyGroup.add(powerDome);
  } else if (customization.carId === 'hyperion') {
    // Supercar: dorsal Le Mans fin + active carbon wing + twin engine bay louvers
    const fin = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.05, 0.34, 1.25)), carbonMat);
    fin.position.set(0, height * 0.68, halfL * 0.32);
    bodyGroup.add(fin);
    addCarbonWing(height * 0.82, halfL - 0.14, width * 0.95, 0.42, 0.42);
  } else if (customization.carId === 'bullitt') {
    const blower = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.46, 0.26, 0.72)), brushedMetalMat);
    blower.position.set(0, height * 0.58, -halfL * 0.4);
    bodyGroup.add(blower);
    addCarbonWing(height * 0.66, halfL - 0.16, width * 0.88, 0.3, 0.22);
  } else if (customization.carId === 'rallyx') {
    addCarbonWing(height * 1.05, halfL - 0.14, width * 0.9, 0.38, 0.24);
    const scoop = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.36, 0.14, 0.48)), carbonMat);
    scoop.position.set(0, height * 1.0, 0.05);
    bodyGroup.add(scoop);
  } else if (customization.carId === 'formula') {
    const frontWing = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(width * 1.04, 0.07, 0.52)), carbonMat);
    frontWing.position.set(0, -0.1, -halfL + 0.14);
    bodyGroup.add(frontWing);
    addCarbonWing(height * 0.94, halfL - 0.14, width * 0.92, 0.46, 0.42);
    const halo = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.32, 0.042, 8, 16, Math.PI)), carbonMat);
    halo.rotation.x = Math.PI * 0.5;
    halo.position.set(0, height * 0.8, -0.14);
    bodyGroup.add(halo);
  } else if (customization.carId === 'juggernaut') {
    const bullbar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(width * 0.96, 0.42, 0.22)), brushedMetalMat);
    bullbar.position.set(0, 0.02, -halfL - 0.04);
    bodyGroup.add(bullbar);
  } else {
    addCarbonWing(height * 0.84, halfL - 0.15, width * 0.94, 0.38, 0.36);
  }

  // 7. Projector LED Headlights, DRLs, Full-Width Brake Light Bar & White Reverse Lights
  const projectorGeo = trackGeo(new THREE.SphereGeometry(0.055, 10, 8));
  for (const side of [-1, 1]) {
    const hlHousing = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.38, 0.11, 0.1)),
      darkInteriorMat
    );
    hlHousing.position.set(side * (bodyWidth * 0.35), 0.15, -halfL + 0.04);
    hlHousing.rotation.y = side * -0.16;
    bodyGroup.add(hlHousing);

    for (const pOff of [-0.08, 0.08]) {
      const proj = new THREE.Mesh(projectorGeo, headlightMat);
      proj.position.set(side * (bodyWidth * 0.35) + pOff, 0.15, -halfL + 0.02);
      bodyGroup.add(proj);
    }

    const drl = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.38, 0.032, 0.11)), accentGlowMat);
    drl.position.set(side * (bodyWidth * 0.35), 0.08, -halfL + 0.04);
    drl.rotation.y = side * -0.16;
    bodyGroup.add(drl);

    // Reverse lights (white LEDs flanking taillight bar)
    const revLight = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.18, 0.048, 0.09)),
      reverseLightMat
    );
    revLight.position.set(side * (bodyWidth * 0.32), 0.19, halfL - 0.015);
    bodyGroup.add(revLight);
  }

  const tailBar = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(bodyWidth * 0.84, 0.075, 0.1)),
    taillightMat
  );
  tailBar.position.set(0, 0.26, halfL - 0.02);
  bodyGroup.add(tailBar);

  const hoodStripeMesh = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(width * 0.22, 0.03, length * 0.32)),
    secondaryMat
  );
  hoodStripeMesh.position.set(0, height * 0.38, -halfL * 0.55);
  hoodStripeMesh.rotation.x = 0.14;
  hoodStripeMesh.visible = false;
  bodyGroup.add(hoodStripeMesh);

  // 8. Brushed Exhaust Pipes with Internal Heat Glow + Boost Flames
  const trailDef =
    BOOST_TRAIL_CATALOG.find((t) => t.id === customization.boostTrail) ?? BOOST_TRAIL_CATALOG[0];
  const flameShaderMat = trackMat(
    createBoostFlameShaderMaterial(trailDef.coreColor, trailDef.outerColor)
  );

  const nozzlePts = [
    new THREE.Vector2(0.11, 0),
    new THREE.Vector2(0.16, 0.04),
    new THREE.Vector2(0.16, 0.24),
    new THREE.Vector2(0.12, 0.28),
    new THREE.Vector2(0.1, 0.02),
  ];
  const nozzleGeo = trackGeo(new THREE.LatheGeometry(nozzlePts, 16));
  nozzleGeo.rotateX(Math.PI * 0.5);

  const nozzleCoreGeo = trackGeo(new THREE.CircleGeometry(0.105, 14));
  const flameConeGeo = trackGeo(new THREE.ConeGeometry(0.24, 1.9, 14, 6, true));
  flameConeGeo.translate(0, -0.95, 0);
  flameConeGeo.rotateX(-Math.PI * 0.5);

  const flameMeshes: THREE.Mesh[] = [];
  const exhaustOffsets = customization.carId === 'formula' ? [0] : [-0.36, 0.36];

  for (const ex of exhaustOffsets) {
    const nozzle = new THREE.Mesh(nozzleGeo, brushedMetalMat);
    nozzle.position.set(ex, 0.01, halfL - 0.04);
    bodyGroup.add(nozzle);

    const nozzleCore = new THREE.Mesh(nozzleCoreGeo, exhaustInnerMat);
    nozzleCore.position.set(ex, 0.01, halfL + 0.18);
    bodyGroup.add(nozzleCore);

    const flame = new THREE.Mesh(flameConeGeo, flameShaderMat);
    flame.position.set(ex, 0.01, halfL + 0.15);
    flame.visible = false;
    bodyGroup.add(flame);
    flameMeshes.push(flame);
  }

  let boostLight: THREE.PointLight | null = null;
  if (options?.enablePointLights) {
    boostLight = new THREE.PointLight(new THREE.Color(trailDef.outerColor), 0, 14, 2);
    boostLight.position.set(0, 0.25, halfL + 0.8);
    bodyGroup.add(boostLight);
  }

  // 9. Selectable Wheel Styles + Sidewall Lettering + Cross-Drilled Glowing Brake Rotors + Suspension Pivots
  const wheelSteerPivots: THREE.Group[] = [];
  const wheelSuspensionPivots: THREE.Group[] = [];
  const wheelSpinGroups: THREE.Group[] = [];

  const wheelConfigs = [
    { x: -wheelX, z: wheelZFront, isFront: true, sideSign: -1 },
    { x: wheelX, z: wheelZFront, isFront: true, sideSign: 1 },
    { x: -wheelX, z: wheelZRear, isFront: false, sideSign: -1 },
    { x: wheelX, z: wheelZRear, isFront: false, sideSign: 1 },
  ];

  const hwTire = wheelWidth * 0.5;
  const rInner = wheelRadius * 0.65;
  const rOuter = wheelRadius;
  const tireProfile = [
    new THREE.Vector2(rInner, -hwTire * 0.88),
    new THREE.Vector2(rOuter * 0.94, -hwTire),
    new THREE.Vector2(rOuter, -hwTire * 0.72),
    new THREE.Vector2(rOuter, hwTire * 0.72),
    new THREE.Vector2(rOuter * 0.94, hwTire),
    new THREE.Vector2(rInner, hwTire * 0.88),
    new THREE.Vector2(rInner, -hwTire * 0.88),
  ];
  const tireGeo = trackGeo(new THREE.LatheGeometry(tireProfile, 26));
  tireGeo.rotateZ(Math.PI * 0.5);

  // Outer sidewall ring with procedural lettering texture
  const sidewallRingGeo = trackGeo(new THREE.RingGeometry(rInner * 1.02, rOuter * 0.94, 28));
  sidewallRingGeo.rotateY(Math.PI * 0.5);

  const rimBarrelGeo = trackGeo(
    new THREE.CylinderGeometry(wheelRadius * 0.65, wheelRadius * 0.65, wheelWidth * 0.82, 24, 1, true)
  );
  rimBarrelGeo.rotateZ(Math.PI * 0.5);

  const hubGeo = trackGeo(
    new THREE.CylinderGeometry(wheelRadius * 0.18, wheelRadius * 0.18, wheelWidth * 0.92, 12)
  );
  hubGeo.rotateZ(Math.PI * 0.5);

  const rotorGeo = trackGeo(
    new THREE.CylinderGeometry(wheelRadius * 0.48, wheelRadius * 0.48, 0.04, 22)
  );
  rotorGeo.rotateZ(Math.PI * 0.5);

  const caliperGeo = trackGeo(new THREE.BoxGeometry(0.085, wheelRadius * 0.3, wheelRadius * 0.22));
  const rimRingGeo = trackGeo(new THREE.TorusGeometry(wheelRadius * 0.63, 0.02, 8, 28));
  rimRingGeo.rotateY(Math.PI * 0.5);

  // Wheel style spoke geometries
  const spokeCount =
    wheelStyle === 'mesh_10' ? 10 : wheelStyle === 'sport_5' ? 5 : wheelStyle === 'rally_blade' ? 6 : 12;
  const spokeGeo = trackGeo(
    wheelStyle === 'sport_5'
      ? new THREE.BoxGeometry(0.048, wheelRadius * 0.56, 0.068)
      : wheelStyle === 'rally_blade'
        ? new THREE.BoxGeometry(0.045, wheelRadius * 0.54, 0.11)
        : wheelStyle === 'turbofan'
          ? new THREE.BoxGeometry(0.03, wheelRadius * 0.5, 0.045)
          : new THREE.BoxGeometry(0.036, wheelRadius * 0.56, 0.036)
  );
  const turbofanDiscGeo = trackGeo(
    new THREE.CylinderGeometry(wheelRadius * 0.58, wheelRadius * 0.58, 0.03, 24)
  );
  turbofanDiscGeo.rotateZ(Math.PI * 0.5);

  for (const wc of wheelConfigs) {
    const suspPivot = new THREE.Group();
    suspPivot.position.set(wc.x, wheelY, wc.z);
    root.add(suspPivot);
    wheelSuspensionPivots.push(suspPivot);

    const steerPivot = new THREE.Group();
    suspPivot.add(steerPivot);
    if (wc.isFront) {
      wheelSteerPivots.push(steerPivot);
    }

    // Brake caliper (stationary on steer pivot)
    const caliper = new THREE.Mesh(caliperGeo, accentGlowMat);
    caliper.position.set(wc.sideSign * (wheelWidth * 0.06), wheelRadius * 0.24, -wheelRadius * 0.2);
    steerPivot.add(caliper);

    const spinGroup = new THREE.Group();
    steerPivot.add(spinGroup);
    wheelSpinGroups.push(spinGroup);

    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    spinGroup.add(tire);

    // Outer sidewall ring with sidewall lettering
    const swMesh = new THREE.Mesh(sidewallRingGeo, sidewallMat);
    swMesh.position.x = wc.sideSign * (hwTire * 0.99);
    if (wc.sideSign < 0) swMesh.rotation.y = Math.PI;
    spinGroup.add(swMesh);

    const rimBarrel = new THREE.Mesh(rimBarrelGeo, darkInteriorMat);
    spinGroup.add(rimBarrel);

    const rotor = new THREE.Mesh(rotorGeo, rotorMat);
    rotor.position.x = -wc.sideSign * (wheelWidth * 0.04);
    spinGroup.add(rotor);

    const hub = new THREE.Mesh(hubGeo, brushedMetalMat);
    spinGroup.add(hub);

    const rimRing = new THREE.Mesh(rimRingGeo, accentGlowMat);
    rimRing.position.x = wc.sideSign * (wheelWidth * 0.43);
    spinGroup.add(rimRing);

    if (wheelStyle === 'turbofan') {
      const fanDisc = new THREE.Mesh(turbofanDiscGeo, carbonMat);
      fanDisc.position.x = wc.sideSign * (wheelWidth * 0.34);
      spinGroup.add(fanDisc);
    }

    for (let s = 0; s < spokeCount; s++) {
      const ang = (s / spokeCount) * Math.PI * 2;
      const rMid = wheelRadius * 0.36;
      if (wheelStyle === 'sport_5') {
        // Twin split V-spokes per spoke arm
        for (const pair of [-0.14, 0.14]) {
          const spoke = new THREE.Mesh(spokeGeo, brushedMetalMat);
          const a = ang + pair;
          spoke.position.set(wc.sideSign * (wheelWidth * 0.34), Math.cos(a) * rMid, Math.sin(a) * rMid);
          spoke.rotation.x = -a;
          spoke.rotation.z = wc.sideSign * -0.15;
          spinGroup.add(spoke);
        }
      } else {
        const spoke = new THREE.Mesh(spokeGeo, brushedMetalMat);
        spoke.position.set(
          wc.sideSign * (wheelWidth * (wheelStyle === 'turbofan' ? 0.38 : 0.34)),
          Math.cos(ang) * rMid,
          Math.sin(ang) * rMid
        );
        spoke.rotation.x = -ang + (wheelStyle === 'rally_blade' ? wc.sideSign * 0.28 : 0);
        spoke.rotation.z = wc.sideSign * -0.16;
        spinGroup.add(spoke);
      }
    }
  }

  // 10. Rear-Deck Car Accessories
  const accessoryGroups: Record<string, THREE.Group> = {};
  const deckY = height * 0.88;
  const deckZ = halfL * 0.28;

  const goldMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xfbbf24,
      metalness: 0.94,
      roughness: 0.14,
      clearcoat: 0.8,
    })
  );

  const crownGroup = new THREE.Group();
  crownGroup.position.set(0, deckY + 0.14, deckZ - 0.1);
  crownGroup.add(new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.26, 0.22, 0.14, 10)), goldMat));
  for (let p = 0; p < 5; p++) {
    const a = (p / 5) * Math.PI * 2;
    const spike = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.055, 0.18, 6)), goldMat);
    spike.position.set(Math.cos(a) * 0.19, 0.14, Math.sin(a) * 0.19);
    crownGroup.add(spike);
  }
  bodyGroup.add(crownGroup);
  accessoryGroups.crown = crownGroup;

  const haloGroup = new THREE.Group();
  haloGroup.position.set(0, deckY + 0.28, deckZ - 0.15);
  const haloMesh = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.38, 0.045, 10, 28)), headlightMat);
  haloMesh.rotation.x = Math.PI * 0.5;
  haloGroup.add(haloMesh);
  bodyGroup.add(haloGroup);
  accessoryGroups.halo = haloGroup;

  const finGroup = new THREE.Group();
  finGroup.position.set(0, deckY + 0.06, deckZ + 0.12);
  const dorsalFin = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.06, 0.34, 0.85)), carbonMat);
  dorsalFin.rotation.x = -0.15;
  finGroup.add(dorsalFin);
  bodyGroup.add(finGroup);
  accessoryGroups.shark_fin = finGroup;

  const podGroup = new THREE.Group();
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.11, 0.14, 0.62, 12)), brushedMetalMat);
    pod.rotation.x = Math.PI * 0.5;
    pod.position.set(side * (bodyWidth * 0.38), deckY - 0.08, deckZ + 0.18);
    podGroup.add(pod);
    const tip = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10)), headlightMat);
    tip.rotation.x = Math.PI * 0.5;
    tip.position.set(side * (bodyWidth * 0.38), deckY - 0.08, deckZ - 0.14);
    podGroup.add(tip);
  }
  bodyGroup.add(podGroup);
  accessoryGroups.rocket_pod = podGroup;

  const antGroup = new THREE.Group();
  for (const side of [-1, 1]) {
    const mast = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.015, 0.024, 0.72, 6)), carbonMat);
    mast.position.set(side * (bodyWidth * 0.38), deckY + 0.18, halfL * 0.72);
    mast.rotation.x = -0.22;
    antGroup.add(mast);
    const orb = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.05, 8, 8)), accentGlowMat);
    orb.position.set(side * (bodyWidth * 0.38), deckY + 0.52, halfL * 0.72 - 0.08);
    antGroup.add(orb);
  }
  bodyGroup.add(antGroup);
  accessoryGroups.antennas = antGroup;

  let currentAccessory = customization.accessory ?? 'none';
  let inFirstPerson = false;
  let bodyPitchSmooth = 0;
  let bodyRollSmooth = 0;

  const syncAccessories = () => {
    for (const [accId, grp] of Object.entries(accessoryGroups)) {
      grp.visible = !inFirstPerson && accId === currentAccessory;
    }
  };
  syncAccessories();

  return {
    root,
    bodyGroup,
    wheelSteerPivots,
    wheelSuspensionPivots,
    wheelSpinGroups,
    flameMeshes,
    boostLight,
    updateAppearance(next: CarCustomization, nextTeamHex?: string) {
      const nextLivery = createCarLiveryTexture(next.primaryColor, next.secondaryColor, next.carId, 4);
      texturesToDispose.push(nextLivery);
      primaryMat.map = nextLivery;
      applyPaintFinishToMaterial(primaryMat, next.paintFinish ?? 'metallic');

      secondaryMat.color.set(next.secondaryColor);
      const teamAcc = next.teamAccent ?? nextTeamHex ?? next.secondaryColor;
      accentGlowMat.color.set(teamAcc);
      accentGlowMat.emissive.set(teamAcc);
      paintRimCtrl.setRimColor(teamAcc);

      const t = BOOST_TRAIL_CATALOG.find((item) => item.id === next.boostTrail) ?? BOOST_TRAIL_CATALOG[0];
      flameShaderMat.uniforms.uCoreColor.value.set(t.coreColor);
      flameShaderMat.uniforms.uOuterColor.value.set(t.outerColor);
      if (boostLight) {
        boostLight.color.set(t.outerColor);
      }
      currentAccessory = next.accessory ?? 'none';
      syncAccessories();
    },
    updateDynamicState({
      steerAngle,
      wheelSpin,
      isBoosting,
      throttle,
      time,
      wheelTravel,
      speed = 0,
      lateralSpeed = 0,
      brakeHeat = 0,
      isBraking = false,
      isReversing = false,
      respawnFade = 0,
    }) {
      // Steering wheels + cockpit steering wheel rotation
      for (const p of wheelSteerPivots) {
        p.rotation.y = steerAngle;
      }
      steeringWheelGroup.rotation.z = steerAngle * 2.4;

      for (const w of wheelSpinGroups) {
        w.rotation.x = -wheelSpin;
      }

      // Per-wheel vertical suspension travel
      if (wheelTravel) {
        for (let i = 0; i < 4; i++) {
          const travelOffset = (wheelTravel[i] - 0.42) * 0.14;
          wheelSuspensionPivots[i].position.y = wheelY + travelOffset;
        }
      }

      // Dynamic suspension body pitch (accel/boost squat, brake nose dive) & cornering roll
      const squatTarget = isBoosting ? 0.048 : throttle > 0.1 ? 0.025 : isBraking ? -0.042 : 0;
      const rollTarget = THREE.MathUtils.clamp(
        (-steerAngle * Math.min(1, speed / 22) * 0.095) + lateralSpeed * 0.004,
        -0.08,
        0.08
      );
      bodyPitchSmooth += (squatTarget - bodyPitchSmooth) * 0.16;
      bodyRollSmooth += (rollTarget - bodyRollSmooth) * 0.16;
      bodyGroup.rotation.x = bodyPitchSmooth;
      bodyGroup.rotation.z = bodyRollSmooth;
      bodyGroup.position.y = isBoosting ? -0.022 : 0;

      // Respawn shimmer scale-in
      if (respawnFade > 0.02) {
        const pulse = 1 - respawnFade * 0.12 * Math.sin(time * 28);
        root.scale.setScalar(pulse);
      } else {
        root.scale.setScalar(1);
      }

      // Taillight braking intensity & reverse white LEDs
      taillightMat.emissiveIntensity = isBraking || throttle < -0.1 ? 4.0 : 1.55;
      reverseLightMat.emissiveIntensity = isReversing ? 3.2 : 0.12;

      // Glowing brake rotors after heavy braking at speed
      rotorMat.emissiveIntensity = brakeHeat * 2.6;

      // Exhaust internal heat glow when boosting
      const flicker = 0.88 + Math.sin(time * 46) * 0.14 + Math.cos(time * 71) * 0.08;
      exhaustInnerMat.emissiveIntensity = isBoosting ? 2.6 * flicker : 0.08;

      flameShaderMat.uniforms.uTime.value = time;
      flameShaderMat.uniforms.uIntensity.value = isBoosting ? 1.12 * flicker : 0;

      for (let i = 0; i < flameMeshes.length; i++) {
        const fm = flameMeshes[i];
        fm.visible = isBoosting;
        if (isBoosting) {
          fm.scale.set(0.95 + (flicker - 1) * 0.25, 0.95 + (flicker - 1) * 0.25, flicker);
        }
      }
      if (boostLight) {
        boostLight.intensity = isBoosting ? 4.2 * flicker : 0;
      }
      if (haloGroup.visible) {
        haloGroup.position.y = deckY + 0.28 + Math.sin(time * 3.5) * 0.03;
      }
    },
    setFirstPersonMode(enabled: boolean) {
      inFirstPerson = enabled;
      canopyMesh.visible = !enabled;
      cockpitGroup.visible = !enabled;
      hoodStripeMesh.visible = enabled;
      syncAccessories();
    },
    dispose() {
      geometriesToDispose.forEach((g) => g.dispose());
      materialsToDispose.forEach((m) => m.dispose());
      texturesToDispose.forEach((t) => t.dispose());
    },
  };
}

export function getTrailColors(trailId: BoostTrailId): { core: string; outer: string } {
  const t = BOOST_TRAIL_CATALOG.find((item) => item.id === trailId) ?? BOOST_TRAIL_CATALOG[0];
  return { core: t.coreColor, outer: t.outerColor };
}
