import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENA_BOUNDS, BOOST_PADS, FFA_ARENA_BOUNDS, FFA_BOOST_PADS } from '../shared/constants.ts';
import type { ArenaId, BoostPadState, GraphicsQuality, PartyGameMode } from '../shared/types.ts';
import {
  createBoostPadShaderMaterial,
  createDomeHexShaderMaterial,
  createFloodlightConeMaterial,
  createWallEnergyMaterial,
} from './shaders.ts';
import {
  createGoalNetTexture,
  createGrassNormalTexture,
  createPitchTexture,
  createSkylineTexture,
} from './textures.ts';

export interface BoostPadVisual {
  id: number;
  x: number;
  z: number;
  isLarge: boolean;
  orbMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
  padDiscMesh: THREE.Mesh;
  burstRing: THREE.Mesh;
  burstMat: THREE.MeshBasicMaterial;
  burstTimer: number;
}

export interface ArenaHandle {
  group: THREE.Group;
  boostPadVisuals: BoostPadVisual[];
  animatedObjects: THREE.Object3D[];
  update: (time: number, dt: number, padStates: BoostPadState[]) => void;
  triggerGoalPulse: (teamColorHex: number | string) => void;
  triggerBoostBurst: (pos: { x: number; y: number; z: number }) => void;
  setQuality: (quality: GraphicsQuality) => void;
  dispose: () => void;
}

/**
 * Concave quarter-pipe ramp running along Z from -length/2 to +length/2.
 * Cross-section curves smoothly from floor (x = -radius, y = 0.01) up to wall (x = 0, y = radius).
 */
function createQuarterPipeGeometry(length: number, radius: number, segs = 10): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const halfL = length * 0.5;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const angle = t * Math.PI * 0.5;
    const x = -radius + Math.sin(angle) * radius;
    const y = radius - Math.cos(angle) * radius + 0.01;
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);

    positions.push(x, y, -halfL);
    positions.push(x, y, halfL);
    normals.push(nx, ny, 0, nx, ny, 0);
    uvs.push(t, 0, t, 1);
  }

  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c, b, d, c);
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function mergeStaticBoxes(
  items: { w: number; h: number; d: number; x: number; y: number; z: number; ry?: number }[]
): THREE.BufferGeometry | null {
  if (items.length === 0) return null;
  const parts: THREE.BufferGeometry[] = [];
  const mat4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);

  for (const it of items) {
    const g = new THREE.BoxGeometry(it.w, it.h, it.d).toNonIndexed();
    euler.set(0, it.ry ?? 0, 0);
    quat.setFromEuler(euler);
    pos.set(it.x, it.y, it.z);
    mat4.compose(pos, quat, scale);
    g.applyMatrix4(mat4);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

export function buildArena(
  scene: THREE.Scene,
  arenaId: ArenaId,
  quality: GraphicsQuality,
  maxAnisotropy: number,
  isSoftwareGl: boolean,
  gameMode: PartyGameMode = 'team_2v1'
): ArenaHandle {
  const group = new THREE.Group();
  const isFfa = gameMode === 'ffa';
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const animatedObjects: THREE.Object3D[] = [];
  const wallEnergyMats: THREE.ShaderMaterial[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    mats.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    texs.push(t);
    return t;
  };

  const hw = ARENA_BOUNDS.HALF_WIDTH;
  const hl = ARENA_BOUNDS.HALF_LENGTH;
  const h = ARENA_BOUNDS.HEIGHT;
  const gw = ARENA_BOUNDS.GOAL_HALF_WIDTH;
  const gh = ARENA_BOUNDS.GOAL_HEIGHT;
  const gd = ARENA_BOUNDS.GOAL_DEPTH;
  const corner = ARENA_BOUNDS.CORNER_SIZE;

  const getShadowRes = (q: GraphicsQuality) =>
    isSoftwareGl ? 512 : q === 'ultra' ? 4096 : q === 'high' ? 2048 : q === 'medium' ? 1024 : 512;

  const shadowSize = getShadowRes(quality);
  let keyLight: THREE.DirectionalLight | null = null;

  // 1. Calibrated Lighting & Sky Atmosphere (rich saturation, crisp shadow bias)
  if (arenaId === 'sunset_arena') {
    scene.background = new THREE.Color(0x161224);
    scene.fog = new THREE.FogExp2(0x28192c, 0.0019);

    const skyGeo = trackGeo(new THREE.SphereGeometry(340, 24, 16));
    const skyMat = trackMat(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          topColor: { value: new THREE.Color(0x0b1533) },
          midColor: { value: new THREE.Color(0x6b2c4b) },
          horizonColor: { value: new THREE.Color(0xd97736) },
        },
        vertexShader: `
          varying vec3 vWorldPos;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 midColor;
          uniform vec3 horizonColor;
          varying vec3 vWorldPos;
          void main() {
            float h = clamp(normalize(vWorldPos).y, 0.0, 1.0);
            vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.28, h));
            col = mix(col, topColor, smoothstep(0.28, 0.85, h));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      })
    );
    group.add(new THREE.Mesh(skyGeo, skyMat));

    group.add(new THREE.HemisphereLight(0xfed7aa, 0x1e293b, 0.68));

    const sun = new THREE.DirectionalLight(0xffcf99, 1.55);
    sun.position.set(62, 66, -72);
    sun.castShadow = !isSoftwareGl && quality !== 'low';
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.camera.left = -72;
    sun.shadow.camera.right = 72;
    sun.shadow.camera.top = 72;
    sun.shadow.camera.bottom = -72;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 230;
    sun.shadow.bias = -0.00045;
    sun.shadow.normalBias = 0.025;
    group.add(sun);
    keyLight = sun;

    const rim = new THREE.DirectionalLight(0x60a5fa, 0.52);
    rim.position.set(-55, 35, 65);
    group.add(rim);
  } else if (arenaId === 'cyber_arena') {
    scene.background = new THREE.Color(0x060714);
    scene.fog = new THREE.FogExp2(0x070818, 0.0022);

    group.add(new THREE.HemisphereLight(0xa855f7, 0x0b1022, 0.72));

    const key = new THREE.DirectionalLight(0xe2e8f0, 1.45);
    key.position.set(40, 82, 34);
    key.castShadow = !isSoftwareGl && quality !== 'low';
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.camera.left = -70;
    key.shadow.camera.right = 70;
    key.shadow.camera.top = 75;
    key.shadow.camera.bottom = -75;
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 195;
    key.shadow.bias = -0.00045;
    key.shadow.normalBias = 0.025;
    group.add(key);
    keyLight = key;

    const rim = new THREE.DirectionalLight(0x38bdf8, 0.58);
    rim.position.set(-45, 42, -45);
    group.add(rim);
  } else {
    // Midnight Floodlit Stadium
    scene.background = new THREE.Color(0x050914);
    scene.fog = new THREE.FogExp2(0x060b19, 0.0018);

    const skyGeo = trackGeo(new THREE.SphereGeometry(340, 24, 16));
    const skyMat = trackMat(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          topColor: { value: new THREE.Color(0x020611) },
          horizonColor: { value: new THREE.Color(0x0e1f3d) },
        },
        vertexShader: `
          varying vec3 vWorldPos;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 horizonColor;
          varying vec3 vWorldPos;
          void main() {
            float h = clamp(normalize(vWorldPos).y, 0.0, 1.0);
            vec3 col = mix(horizonColor, topColor, smoothstep(0.0, 0.65, h));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      })
    );
    group.add(new THREE.Mesh(skyGeo, skyMat));

    group.add(new THREE.HemisphereLight(0x93c5fd, 0x102018, 0.7));

    const key = new THREE.DirectionalLight(0xf1f5f9, 1.5);
    key.position.set(44, 84, 38);
    key.castShadow = !isSoftwareGl && quality !== 'low';
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.camera.left = -70;
    key.shadow.camera.right = 70;
    key.shadow.camera.top = 75;
    key.shadow.camera.bottom = -75;
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 200;
    key.shadow.bias = -0.00045;
    key.shadow.normalBias = 0.025;
    group.add(key);
    keyLight = key;

    const fill = new THREE.DirectionalLight(0x38bdf8, 0.55);
    fill.position.set(-45, 36, -50);
    group.add(fill);
  }

  // Colored Goal PointLights (Blue +Z, Orange -Z, Emerald FFA)
  if (!isSoftwareGl && quality !== 'low') {
    if (isFfa) {
      const ffaGoals = [
        { angle: FFA_ARENA_BOUNDS.GOAL_ANGLES.blue, color: 0x0ea5e9 },
        { angle: FFA_ARENA_BOUNDS.GOAL_ANGLES.orange, color: 0xf97316 },
        { angle: FFA_ARENA_BOUNDS.GOAL_ANGLES.emerald, color: 0x10b981 },
      ];
      for (const fg of ffaGoals) {
        const pl = new THREE.PointLight(fg.color, 18, 42, 1.4);
        pl.position.set(
          Math.sin(fg.angle) * (FFA_ARENA_BOUNDS.APOTHEM + 2),
          5.5,
          Math.cos(fg.angle) * (FFA_ARENA_BOUNDS.APOTHEM + 2)
        );
        group.add(pl);
      }
    } else {
      const blueGoalLight = new THREE.PointLight(0x0ea5e9, 22, 48, 1.35);
      blueGoalLight.position.set(0, 6.5, hl + 2.5);
      group.add(blueGoalLight);

      const orangeGoalLight = new THREE.PointLight(0xf97316, 22, 48, 1.35);
      orangeGoalLight.position.set(0, 6.5, -hl - 2.5);
      group.add(orangeGoalLight);
    }
  }

  // Textures
  const pitchTex = trackTex(createPitchTexture(arenaId, maxAnisotropy));
  const grassNormalTex = trackTex(createGrassNormalTexture(maxAnisotropy));

  const blueNetTex = trackTex(createGoalNetTexture('rgba(56, 189, 248, 0.88)', maxAnisotropy));
  blueNetTex.repeat.set(6, 3);
  const orangeNetTex = trackTex(createGoalNetTexture('rgba(251, 146, 60, 0.88)', maxAnisotropy));
  orangeNetTex.repeat.set(6, 3);
  const emeraldNetTex = trackTex(createGoalNetTexture('rgba(52, 211, 153, 0.88)', maxAnisotropy));
  emeraldNetTex.repeat.set(6, 3);

  const skylineTex = trackTex(createSkylineTexture());
  skylineTex.repeat.set(1, 2);

  // Shader-driven glass wall energy materials
  const neutralWallColor =
    arenaId === 'cyber_arena' ? 0xa855f7 : arenaId === 'sunset_arena' ? 0x60a5fa : 0x38bdf8;
  const wallMatNeutral = trackMat(createWallEnergyMaterial(neutralWallColor, 1));
  const wallMatBlue = trackMat(createWallEnergyMaterial(0x0ea5e9, 1));
  const wallMatOrange = trackMat(createWallEnergyMaterial(0xf97316, -1));
  wallEnergyMats.push(wallMatNeutral, wallMatBlue, wallMatOrange);

  // Shader-driven animated hex dome material
  const domeMat = trackMat(createDomeHexShaderMaterial(neutralWallColor));

  const frameMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x151f30,
      metalness: 0.78,
      roughness: 0.3,
    })
  );

  const rampMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x132032,
      metalness: 0.42,
      roughness: 0.45,
      clearcoat: 0.35,
      clearcoatRoughness: 0.25,
    })
  );

  const bluePanelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x0284c7,
      emissiveIntensity: 0.65,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );

  const orangePanelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xea580c,
      emissive: 0xea580c,
      emissiveIntensity: 0.65,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );

  const blueRailMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.35,
      roughness: 0.2,
    })
  );

  const orangeRailMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfb923c,
      emissive: 0xf97316,
      emissiveIntensity: 1.35,
      roughness: 0.2,
    })
  );

  const goalFloorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x101a28,
      roughness: 0.42,
      metalness: 0.35,
    })
  );

  const apronGeo = trackGeo(new THREE.RingGeometry(64, 260, 48));
  apronGeo.rotateX(-Math.PI * 0.5);
  const apronMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x09111d,
      roughness: 0.88,
      metalness: 0.14,
    })
  );
  const apron = new THREE.Mesh(apronGeo, apronMat);
  apron.position.y = -0.15;
  group.add(apron);

  const standMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0e1627,
      roughness: 0.68,
      metalness: 0.28,
    })
  );

  // Planar wet-look reflector beneath semi-transparent grass pitch (Medium/High/Ultra)
  let reflector: Reflector | null = null;
  let pitchMatRef: THREE.MeshPhysicalMaterial | null = null;
  const reflectionsActive = (q: GraphicsQuality) => !isSoftwareGl && q !== 'low';

  const addGoalNetPanels = (
    parent: THREE.Object3D,
    netColor: number,
    netTex: THREE.CanvasTexture,
    posZ: number,
    dirSign: number
  ) => {
    const netMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: netColor,
        map: netTex,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const centerZ = posZ + dirSign * (gd * 0.5);
    const backZ = posZ + dirSign * gd;

    const backNet = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(gw * 2, gh)), netMat);
    backNet.position.set(0, gh * 0.5, backZ);
    parent.add(backNet);

    const topNet = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(gw * 2, gd)), netMat);
    topNet.rotation.x = Math.PI * 0.5;
    topNet.position.set(0, gh, centerZ);
    parent.add(topNet);

    for (const side of [-1, 1]) {
      const sideNet = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(gd, gh)), netMat);
      sideNet.rotation.y = Math.PI * 0.5;
      sideNet.position.set(side * gw, gh * 0.5, centerZ);
      parent.add(sideNet);
    }
  };

  if (isFfa) {
    // 3-Goal Hexagonal Triad Arena (1v1v1 FFA)
    const A = FFA_ARENA_BOUNDS.APOTHEM;
    const circumR = (A * 2) / Math.sqrt(3);
    const sideLen = circumR;
    const sideHalfLen = sideLen * 0.5;

    if (!isSoftwareGl) {
      const reflRes = quality === 'ultra' ? 1024 : quality === 'high' ? 512 : 256;
      const reflGeo = trackGeo(new THREE.CircleGeometry(circumR, 6));
      reflGeo.rotateX(-Math.PI * 0.5);
      reflGeo.rotateY(Math.PI / 6);
      reflector = new Reflector(reflGeo, {
        clipBias: 0.003,
        textureWidth: reflRes,
        textureHeight: reflRes,
        color: 0x3b4d63,
      });
      const origFfaBeforeRender = reflector.onBeforeRender;
      reflector.onBeforeRender = function (renderer, sc, cam, geo, mat, grp) {
        if (sc.overrideMaterial) return;
        origFfaBeforeRender.call(this, renderer, sc, cam, geo, mat, grp);
      };
      reflector.position.y = -0.015;
      reflector.visible = reflectionsActive(quality);
      group.add(reflector);
    }

    const hexPitchGeo = trackGeo(new THREE.CircleGeometry(circumR, 6));
    hexPitchGeo.rotateX(-Math.PI * 0.5);
    hexPitchGeo.rotateY(Math.PI / 6);
    const hexPitchMat = trackMat(
      new THREE.MeshPhysicalMaterial({
        map: pitchTex,
        normalMap: grassNormalTex,
        normalScale: new THREE.Vector2(0.35, 0.35),
        roughness: 0.36,
        metalness: 0.1,
        clearcoat: 0.45,
        clearcoatRoughness: 0.22,
        transparent: reflectionsActive(quality),
        opacity: reflectionsActive(quality) ? 0.8 : 1.0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      })
    );
    pitchMatRef = hexPitchMat;
    const hexPitch = new THREE.Mesh(hexPitchGeo, hexPitchMat);
    hexPitch.position.y = 0.008;
    hexPitch.receiveShadow = true;
    group.add(hexPitch);

    const centerRingGeo = trackGeo(new THREE.RingGeometry(8.5, 9.0, 48));
    centerRingGeo.rotateX(-Math.PI * 0.5);
    const centerLineMat = trackMat(
      new THREE.MeshBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.72 })
    );
    const centerRing = new THREE.Mesh(centerRingGeo, centerLineMat);
    centerRing.position.y = 0.02;
    group.add(centerRing);

    const goalConfigs = [
      { angle: FFA_ARENA_BOUNDS.GOAL_ANGLES.blue, color: 0x0ea5e9, netTex: blueNetTex },
      { angle: FFA_ARENA_BOUNDS.GOAL_ANGLES.orange, color: 0xf97316, netTex: orangeNetTex },
      { angle: FFA_ARENA_BOUNDS.GOAL_ANGLES.emerald, color: 0x10b981, netTex: emeraldNetTex },
    ];

    const rampGeoSide = trackGeo(createQuarterPipeGeometry(sideLen - 2, 3.2, 8));

    for (let i = 0; i < 6; i++) {
      const theta = (i * Math.PI) / 3;
      const sideGroup = new THREE.Group();
      sideGroup.rotation.y = theta;
      group.add(sideGroup);

      const goalCfg = goalConfigs.find((g) => Math.abs(g.angle - theta) < 0.05);
      if (!goalCfg) {
        const wall = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(sideLen, h)), wallMatNeutral);
        wall.position.set(0, h * 0.5, A);
        sideGroup.add(wall);

        const ramp = new THREE.Mesh(rampGeoSide, rampMat);
        ramp.rotation.y = -Math.PI * 0.5;
        ramp.position.set(0, 0, A);
        sideGroup.add(ramp);

        const curb = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(sideLen, 1.3, 0.9)), frameMat);
        curb.position.set(0, 0.65, A + 0.45);
        sideGroup.add(curb);

        const strip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(sideLen, 0.28, 0.2)), blueRailMat);
        strip.position.set(0, 1.4, A - 0.04);
        sideGroup.add(strip);

        const topBeam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(sideLen, 0.8, 0.8)), frameMat);
        topBeam.position.set(0, h, A + 0.3);
        sideGroup.add(topBeam);
      } else {
        const goalGlowMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: goalCfg.color,
            emissive: goalCfg.color,
            emissiveIntensity: 1.35,
            roughness: 0.2,
          })
        );

        const panelW = sideHalfLen - gw;
        for (const side of [-1, 1]) {
          const panel = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(panelW, h)), wallMatNeutral);
          panel.position.set(side * (gw + panelW * 0.5), h * 0.5, A);
          sideGroup.add(panel);

          const eStrip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(panelW, 0.28, 0.22)), goalGlowMat);
          eStrip.position.set(side * (gw + panelW * 0.5), 1.4, A);
          sideGroup.add(eStrip);
        }

        const upperWall = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(gw * 2, h - gh)), wallMatNeutral);
        upperWall.position.set(0, gh + (h - gh) * 0.5, A);
        sideGroup.add(upperWall);

        const postGeo = trackGeo(new THREE.BoxGeometry(0.7, gh, 0.7));
        for (const side of [-1, 1]) {
          const post = new THREE.Mesh(postGeo, goalGlowMat);
          post.position.set(side * gw, gh * 0.5, A);
          sideGroup.add(post);
        }
        const crossbar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(gw * 2 + 0.7, 0.7, 0.7)), goalGlowMat);
        crossbar.position.set(0, gh, A);
        sideGroup.add(crossbar);

        const goalLine = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(gw * 2, 0.04, 0.35)), goalGlowMat);
        goalLine.position.set(0, 0.02, A);
        sideGroup.add(goalLine);

        const gf = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(gw * 2, gd)), goalFloorMat);
        gf.rotation.x = -Math.PI * 0.5;
        gf.position.set(0, 0.005, A + gd * 0.5);
        gf.receiveShadow = true;
        sideGroup.add(gf);

        addGoalNetPanels(sideGroup, goalCfg.color, goalCfg.netTex, A, 1);
      }

      const stand = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(sideLen * 0.92, 7, 7)), standMat);
      stand.position.set(0, 4.5, A + 14);
      sideGroup.add(stand);
    }

    const domeGeo = trackGeo(
      new THREE.SphereGeometry(circumR * 1.18, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.33)
    );
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.y = h - circumR * 1.18 * Math.cos(Math.PI * 0.33);
    group.add(dome);
  } else {
    // 2. Standard 2-Goal Rectangular Stadium
    if (!isSoftwareGl) {
      const reflRes = quality === 'ultra' ? 1024 : quality === 'high' ? 512 : 256;
      const reflGeo = trackGeo(new THREE.PlaneGeometry(hw * 2, hl * 2));
      reflGeo.rotateX(-Math.PI * 0.5);
      reflector = new Reflector(reflGeo, {
        clipBias: 0.003,
        textureWidth: reflRes,
        textureHeight: reflRes,
        color: 0x3b4d63,
      });
      const origRectBeforeRender = reflector.onBeforeRender;
      reflector.onBeforeRender = function (renderer, sc, cam, geo, mat, grp) {
        if (sc.overrideMaterial) return;
        origRectBeforeRender.call(this, renderer, sc, cam, geo, mat, grp);
      };
      reflector.position.y = -0.015;
      reflector.visible = reflectionsActive(quality);
      group.add(reflector);
    }

    const pitchGeo = trackGeo(new THREE.PlaneGeometry(hw * 2, hl * 2));
    pitchGeo.rotateX(-Math.PI * 0.5);
    const pitchMat = trackMat(
      new THREE.MeshPhysicalMaterial({
        map: pitchTex,
        normalMap: grassNormalTex,
        normalScale: new THREE.Vector2(0.35, 0.35),
        roughness: arenaId === 'cyber_arena' ? 0.28 : 0.34,
        metalness: arenaId === 'cyber_arena' ? 0.22 : 0.1,
        clearcoat: 0.45,
        clearcoatRoughness: 0.2,
        transparent: reflectionsActive(quality),
        opacity: reflectionsActive(quality) ? 0.8 : 1.0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      })
    );
    pitchMatRef = pitchMat;
    const pitchMesh = new THREE.Mesh(pitchGeo, pitchMat);
    pitchMesh.position.y = 0.008;
    pitchMesh.receiveShadow = true;
    group.add(pitchMesh);

    for (const sign of [-1, 1]) {
      const gf = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(gw * 2, gd)), goalFloorMat);
      gf.rotation.x = -Math.PI * 0.5;
      gf.position.set(0, 0.005, sign * (hl + gd * 0.5));
      gf.receiveShadow = true;
      group.add(gf);
    }

    // Collect static structural boxes (curbs, top beams, grandstands) to merge into 2 draw calls
    const frameBoxes: { w: number; h: number; d: number; x: number; y: number; z: number }[] = [];
    const standBoxes: { w: number; h: number; d: number; x: number; y: number; z: number }[] = [];

    const sideLen = (hl - corner) * 2;
    const halfSideLen = sideLen * 0.5;
    const rampRadius = 3.6;
    const sideRampGeo = trackGeo(createQuarterPipeGeometry(sideLen, rampRadius, 10));

    for (const sign of [-1, 1]) {
      // Split side walls into Orange (-Z) and Blue (+Z) halves with pulsing energy shaders
      for (const halfZ of [-1, 1]) {
        const isBlueHalf = halfZ === 1;
        const wMat = isBlueHalf ? wallMatBlue : wallMatOrange;
        const pMat = isBlueHalf ? bluePanelMat : orangePanelMat;
        const rMat = isBlueHalf ? blueRailMat : orangeRailMat;

        const wallHalf = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(halfSideLen, h)), wMat);
        wallHalf.position.set(sign * hw, h * 0.5, halfZ * halfSideLen * 0.5);
        wallHalf.rotation.y = sign * -Math.PI * 0.5;
        group.add(wallHalf);

        const lowPanel = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(halfSideLen, 5.2)), pMat);
        lowPanel.position.set(sign * (hw - 0.03), 2.6, halfZ * halfSideLen * 0.5);
        lowPanel.rotation.y = sign * -Math.PI * 0.5;
        group.add(lowPanel);

        const strip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.18, 0.3, halfSideLen)), rMat);
        strip.position.set(sign * (hw - 0.05), 3.65, halfZ * halfSideLen * 0.5);
        group.add(strip);
      }

      const sideRamp = new THREE.Mesh(sideRampGeo, rampMat);
      sideRamp.position.set(sign * hw, 0, 0);
      if (sign === -1) sideRamp.rotation.y = Math.PI;
      group.add(sideRamp);

      frameBoxes.push({ w: 0.9, h: 1.3, d: sideLen, x: sign * (hw + 0.45), y: 0.65, z: 0 });
      frameBoxes.push({ w: 0.9, h: 0.9, d: sideLen, x: sign * (hw + 0.35), y: h, z: 0 });
    }

    // 45-degree corner chamfer walls + curved wall-to-floor corner ramps + team tint
    const cornerHyp = Math.sqrt(corner * corner * 2);
    const cornerRampGeo = trackGeo(createQuarterPipeGeometry(cornerHyp + 0.6, rampRadius, 10));
    const cornerDefs = [
      { x: -hw + corner * 0.5, z: -hl + corner * 0.5, ry: Math.PI * 0.25, isBlue: false, flipRamp: false },
      { x: hw - corner * 0.5, z: -hl + corner * 0.5, ry: -Math.PI * 0.25, isBlue: false, flipRamp: true },
      { x: -hw + corner * 0.5, z: hl - corner * 0.5, ry: -Math.PI * 0.25, isBlue: true, flipRamp: false },
      { x: hw - corner * 0.5, z: hl - corner * 0.5, ry: Math.PI * 0.25, isBlue: true, flipRamp: true },
    ];
    for (const c of cornerDefs) {
      const cw = new THREE.Mesh(
        trackGeo(new THREE.PlaneGeometry(cornerHyp, h)),
        c.isBlue ? wallMatBlue : wallMatOrange
      );
      cw.position.set(c.x, h * 0.5, c.z);
      cw.rotation.y = c.ry;
      group.add(cw);

      const cLow = new THREE.Mesh(
        trackGeo(new THREE.PlaneGeometry(cornerHyp, 5.2)),
        c.isBlue ? bluePanelMat : orangePanelMat
      );
      cLow.position.set(c.x, 2.6, c.z);
      cLow.rotation.y = c.ry;
      group.add(cLow);

      const cStrip = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(cornerHyp, 0.3, 0.22)),
        c.isBlue ? blueRailMat : orangeRailMat
      );
      cStrip.position.set(c.x, 3.65, c.z);
      cStrip.rotation.y = c.ry;
      group.add(cStrip);

      const cRamp = new THREE.Mesh(cornerRampGeo, rampMat);
      cRamp.position.set(c.x, 0, c.z);
      cRamp.rotation.y = c.ry + (c.flipRamp ? Math.PI * 0.5 : -Math.PI * 0.5);
      group.add(cRamp);
    }

    // End walls & Glowing Goals (Orange at -Z, Blue at +Z)
    const endSideW = hw - corner - gw;
    const endRampGeo = trackGeo(createQuarterPipeGeometry(endSideW, rampRadius, 10));

    for (const sign of [-1, 1]) {
      const isBlue = sign === 1;
      const teamColor = isBlue ? 0x0ea5e9 : 0xf97316;
      const teamNetTex = isBlue ? blueNetTex : orangeNetTex;
      const teamPanelMat = isBlue ? bluePanelMat : orangePanelMat;
      const teamWallMat = isBlue ? wallMatBlue : wallMatOrange;

      const goalGlowMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: teamColor,
          emissive: teamColor,
          emissiveIntensity: 1.4,
          roughness: 0.2,
        })
      );

      for (const side of [-1, 1]) {
        const px = side * (gw + endSideW * 0.5);
        const panel = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(endSideW, h)), teamWallMat);
        panel.position.set(px, h * 0.5, sign * hl);
        group.add(panel);

        const lowEndPanel = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(endSideW, 5.2)), teamPanelMat);
        lowEndPanel.position.set(px, 2.6, sign * (hl - 0.03));
        group.add(lowEndPanel);

        const eStrip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(endSideW, 0.3, 0.22)), goalGlowMat);
        eStrip.position.set(px, 3.65, sign * hl);
        group.add(eStrip);

        const endRamp = new THREE.Mesh(endRampGeo, rampMat);
        endRamp.position.set(px, 0, sign * hl);
        endRamp.rotation.y = sign === 1 ? -Math.PI * 0.5 : Math.PI * 0.5;
        group.add(endRamp);
      }

      const upperWall = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(gw * 2, h - gh)), teamWallMat);
      upperWall.position.set(0, gh + (h - gh) * 0.5, sign * hl);
      group.add(upperWall);

      const postGeo = trackGeo(new THREE.BoxGeometry(0.75, gh, 0.75));
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, goalGlowMat);
        post.position.set(side * gw, gh * 0.5, sign * hl);
        group.add(post);
      }
      const crossbar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(gw * 2 + 0.75, 0.75, 0.75)), goalGlowMat);
      crossbar.position.set(0, gh, sign * hl);
      group.add(crossbar);

      const goalLine = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(gw * 2, 0.04, 0.38)), goalGlowMat);
      goalLine.position.set(0, 0.02, sign * hl);
      group.add(goalLine);

      addGoalNetPanels(group, teamColor, teamNetTex, sign * hl, sign);
    }

    // Animated Hex-Mesh Arched Stadium Dome over pitch
    const domeRadius = hw + 10;
    const domeGeo = trackGeo(
      new THREE.CylinderGeometry(
        domeRadius,
        domeRadius,
        hl * 2,
        28,
        1,
        true,
        -Math.PI * 0.36,
        Math.PI * 0.72
      )
    );
    domeGeo.rotateX(Math.PI * 0.5);
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    domeMesh.position.set(0, h - domeRadius * Math.cos(Math.PI * 0.36), 0);
    group.add(domeMesh);

    for (let z = -44; z <= 44; z += 22) {
      const archGeo = trackGeo(new THREE.TorusGeometry(domeRadius, 0.42, 8, 36, Math.PI * 0.72));
      const arch = new THREE.Mesh(archGeo, frameMat);
      arch.rotation.z = Math.PI * 0.14;
      arch.position.set(0, h - domeRadius * Math.cos(Math.PI * 0.36), z);
      group.add(arch);

      const neonArc = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(domeRadius - 0.5, 0.14, 6, 36, Math.PI * 0.72)),
        blueRailMat
      );
      neonArc.rotation.z = Math.PI * 0.14;
      neonArc.position.set(0, h - domeRadius * Math.cos(Math.PI * 0.36), z);
      group.add(neonArc);
    }

    // Tiered Grandstands (merged)
    const standTiers = [
      { distX: hw + 11, distZ: hl + 15, y: 4, h: 6 },
      { distX: hw + 19, distZ: hl + 23, y: 10, h: 7 },
    ];
    for (const tier of standTiers) {
      for (const side of [-1, 1]) {
        standBoxes.push({ w: 7, h: tier.h, d: hl * 1.9, x: side * tier.distX, y: tier.y, z: 0 });
        standBoxes.push({ w: hw * 1.9, h: tier.h, d: 7, x: 0, y: tier.y, z: side * tier.distZ });
      }
    }

    const mergedFrames = mergeStaticBoxes(frameBoxes);
    if (mergedFrames) group.add(new THREE.Mesh(trackGeo(mergedFrames), frameMat));
    const mergedStands = mergeStaticBoxes(standBoxes);
    if (mergedStands) group.add(new THREE.Mesh(trackGeo(mergedStands), standMat));

    // Instanced Crowd Silhouettes
    const crowdCount = quality === 'low' ? 160 : 480;
    const crowdGeo = trackGeo(new THREE.BoxGeometry(0.65, 0.85, 0.65));
    const crowdMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const crowdMesh = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdCount);
    const dummy = new THREE.Object3D();
    const cColor = new THREE.Color();

    for (let i = 0; i < crowdCount; i++) {
      const onSide = i % 2 === 0;
      const sign = i % 4 < 2 ? 1 : -1;
      const tierIdx = i % 2;
      const yBase = tierIdx === 0 ? 7.6 : 14.1;
      if (onSide) {
        dummy.position.set(sign * (hw + 10 + tierIdx * 8), yBase, (Math.random() - 0.5) * hl * 1.75);
      } else {
        dummy.position.set((Math.random() - 0.5) * hw * 1.75, yBase, sign * (hl + 14 + tierIdx * 8));
      }
      dummy.updateMatrix();
      crowdMesh.setMatrixAt(i, dummy.matrix);

      const hueChoice = Math.random();
      if (hueChoice < 0.42) cColor.setHex(0x38bdf8);
      else if (hueChoice < 0.84) cColor.setHex(0xf97316);
      else cColor.setHex(0xe2e8f0);
      crowdMesh.setColorAt(i, cColor);
    }
    crowdMesh.instanceMatrix.needsUpdate = true;
    if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;
    crowdMesh.computeBoundingSphere();
    group.add(crowdMesh);
  }

  // 3. Night City Skyline, Floodlight Towers + Volumetric Light Cones, and Instanced Trees
  const buildingCount = quality === 'low' ? 48 : 88;
  const bldgGeo = trackGeo(new THREE.BoxGeometry(1, 1, 1));
  const bldgMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: skylineTex,
      emissive: 0x1e293b,
      emissiveMap: skylineTex,
      emissiveIntensity: 0.85,
      roughness: 0.72,
      metalness: 0.25,
    })
  );
  const bldgMesh = new THREE.InstancedMesh(bldgGeo, bldgMat, buildingCount);
  const bDummy = new THREE.Object3D();
  for (let i = 0; i < buildingCount; i++) {
    const angle = (i / buildingCount) * Math.PI * 2 + (i % 3) * 0.03;
    const dist = 122 + (i % 5) * 18 + ((i * 7) % 15);
    const bw = 12 + ((i * 11) % 14);
    const bd = 12 + ((i * 13) % 14);
    const bh = 28 + ((i * 23) % 68);
    bDummy.position.set(Math.cos(angle) * dist, bh * 0.5 - 1, Math.sin(angle) * dist);
    bDummy.rotation.y = angle;
    bDummy.scale.set(bw, bh, bd);
    bDummy.updateMatrix();
    bldgMesh.setMatrixAt(i, bDummy.matrix);
  }
  bldgMesh.instanceMatrix.needsUpdate = true;
  bldgMesh.computeBoundingSphere();
  group.add(bldgMesh);

  const treeCount = quality === 'low' ? 32 : 64;
  const trunkGeo = trackGeo(new THREE.CylinderGeometry(0.45, 0.65, 3.2, 6));
  const trunkMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x3b2820, roughness: 0.9 }));
  const foliageGeo = trackGeo(new THREE.ConeGeometry(2.8, 7.5, 7));
  const foliageMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x15472a, roughness: 0.85 }));

  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const foliageInst = new THREE.InstancedMesh(foliageGeo, foliageMat, treeCount);
  const tDummy = new THREE.Object3D();
  for (let i = 0; i < treeCount; i++) {
    const a = (i / treeCount) * Math.PI * 2;
    const dist = 86 + (i % 4) * 7;
    const s = 0.85 + (i % 3) * 0.25;
    const tx = Math.cos(a) * dist;
    const tz = Math.sin(a) * dist;
    tDummy.position.set(tx, 1.5 * s, tz);
    tDummy.scale.setScalar(s);
    tDummy.updateMatrix();
    trunkInst.setMatrixAt(i, tDummy.matrix);

    tDummy.position.set(tx, 5.5 * s, tz);
    tDummy.scale.setScalar(s);
    tDummy.updateMatrix();
    foliageInst.setMatrixAt(i, tDummy.matrix);
  }
  trunkInst.instanceMatrix.needsUpdate = true;
  foliageInst.instanceMatrix.needsUpdate = true;
  trunkInst.computeBoundingSphere();
  foliageInst.computeBoundingSphere();
  group.add(trunkInst);
  group.add(foliageInst);

  // Stadium Floodlight Towers + Volumetric Gradient Cones
  const floodHeadMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: arenaId === 'sunset_arena' ? 0xfde68a : 0xe0f2fe,
      emissiveIntensity: 1.85,
      roughness: 0.15,
    })
  );
  const floodConeColor = arenaId === 'sunset_arena' ? 0xfef3c7 : arenaId === 'cyber_arena' ? 0xc4b5fd : 0xdbeafe;
  const floodConeMat = trackMat(createFloodlightConeMaterial(floodConeColor));
  const beamGeo = trackGeo(new THREE.CylinderGeometry(2.4, 22, 86, 18, 1, true));
  beamGeo.translate(0, -43, 0);
  const floodCones: THREE.Mesh[] = [];

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tower = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.2, 46, 2.2)), frameMat);
      tower.position.set(sx * (hw + 25), 23, sz * (hl + 26));
      group.add(tower);

      const headPos = new THREE.Vector3(sx * (hw + 23), 46, sz * (hl + 24));
      const lightHead = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(7.8, 3.2, 1.5)), floodHeadMat);
      lightHead.position.copy(headPos);
      lightHead.lookAt(0, 0, 0);
      group.add(lightHead);

      if (!isSoftwareGl) {
        const beam = new THREE.Mesh(beamGeo, floodConeMat);
        beam.position.copy(headPos);
        // Aim cylinder's -Y axis toward pitch center (0, 2, 0)
        const dirToPitch = new THREE.Vector3(0, 2, 0).sub(headPos).normalize();
        beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dirToPitch);
        beam.visible = quality !== 'low';
        group.add(beam);
        floodCones.push(beam);
      }
    }
  }

  // Cyber Arena orbital rings
  if (arenaId === 'cyber_arena') {
    const ringMat1 = trackMat(
      new THREE.MeshBasicMaterial({ color: 0xa855f7, wireframe: true, transparent: true, opacity: 0.42 })
    );
    const ringMat2 = trackMat(
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.42 })
    );
    const ring1 = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(32, 0.7, 8, 48)), ringMat1);
    ring1.position.set(0, h + 16, 0);
    ring1.rotation.x = Math.PI * 0.5;
    group.add(ring1);
    animatedObjects.push(ring1);

    const ring2 = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(22, 0.5, 8, 40)), ringMat2);
    ring2.position.set(0, h + 20, 0);
    ring2.rotation.x = Math.PI * 0.38;
    group.add(ring2);
    animatedObjects.push(ring2);
  }

  // 4. Boost Pads: Instanced Bases + Pulsing Hex-Grid Shader Discs + Pickup Burst Rings
  const boostPadVisuals: BoostPadVisual[] = [];
  const padBaseMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.28 })
  );
  const boostRingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.3,
      roughness: 0.2,
    })
  );
  const boostOrbMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfde047,
      emissive: 0xf97316,
      emissiveIntensity: 1.45,
      roughness: 0.14,
      metalness: 0.25,
    })
  );
  const boostPadShaderMat = trackMat(createBoostPadShaderMaterial());

  const largeBaseGeo = trackGeo(new THREE.CylinderGeometry(1.55, 1.8, 0.14, 20));
  const smallBaseGeo = trackGeo(new THREE.CylinderGeometry(1.1, 1.25, 0.1, 16));
  const largeRingGeo = trackGeo(new THREE.TorusGeometry(1.22, 0.12, 8, 24));
  largeRingGeo.rotateX(Math.PI * 0.5);
  const smallRingGeo = trackGeo(new THREE.TorusGeometry(0.88, 0.1, 8, 20));
  smallRingGeo.rotateX(Math.PI * 0.5);
  const largeOrbGeo = trackGeo(new THREE.OctahedronGeometry(0.68, 2));
  const smallDiscGeo = trackGeo(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 16));
  const padShaderDiscLargeGeo = trackGeo(new THREE.PlaneGeometry(3.2, 3.2));
  padShaderDiscLargeGeo.rotateX(-Math.PI * 0.5);
  const padShaderDiscSmallGeo = trackGeo(new THREE.PlaneGeometry(2.2, 2.2));
  padShaderDiscSmallGeo.rotateX(-Math.PI * 0.5);
  const burstRingGeo = trackGeo(new THREE.RingGeometry(0.7, 1.15, 24));
  burstRingGeo.rotateX(-Math.PI * 0.5);

  const padDefs = isFfa ? FFA_BOOST_PADS : BOOST_PADS;
  const largePadCount = padDefs.filter((p) => p.isLarge).length;
  const smallPadCount = padDefs.length - largePadCount;

  const largeBaseInst = new THREE.InstancedMesh(largeBaseGeo, padBaseMat, Math.max(1, largePadCount));
  const smallBaseInst = new THREE.InstancedMesh(smallBaseGeo, padBaseMat, Math.max(1, smallPadCount));
  const pDummy = new THREE.Object3D();
  let lIdx = 0;
  let sIdx = 0;

  for (const pad of padDefs) {
    pDummy.position.set(pad.x, 0.06, pad.z);
    pDummy.rotation.set(0, 0, 0);
    pDummy.scale.setScalar(1);
    pDummy.updateMatrix();
    if (pad.isLarge) {
      largeBaseInst.setMatrixAt(lIdx++, pDummy.matrix);
    } else {
      smallBaseInst.setMatrixAt(sIdx++, pDummy.matrix);
    }

    const ring = new THREE.Mesh(pad.isLarge ? largeRingGeo : smallRingGeo, boostRingMat);
    ring.position.set(pad.x, 0.14, pad.z);
    group.add(ring);

    const orb = new THREE.Mesh(pad.isLarge ? largeOrbGeo : smallDiscGeo, boostOrbMat);
    orb.position.set(pad.x, pad.isLarge ? 1.18 : 0.16, pad.z);
    group.add(orb);

    const padDiscMesh = new THREE.Mesh(
      pad.isLarge ? padShaderDiscLargeGeo : padShaderDiscSmallGeo,
      boostPadShaderMat
    );
    padDiscMesh.position.set(pad.x, 0.145, pad.z);
    group.add(padDiscMesh);

    const burstMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xfde047,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const burstRing = new THREE.Mesh(burstRingGeo, burstMat);
    burstRing.position.set(pad.x, 0.2, pad.z);
    burstRing.visible = false;
    group.add(burstRing);

    boostPadVisuals.push({
      id: pad.id,
      x: pad.x,
      z: pad.z,
      isLarge: pad.isLarge,
      orbMesh: orb,
      ringMesh: ring,
      padDiscMesh,
      burstRing,
      burstMat,
      burstTimer: 0,
    });
  }
  largeBaseInst.instanceMatrix.needsUpdate = true;
  smallBaseInst.instanceMatrix.needsUpdate = true;
  largeBaseInst.computeBoundingSphere();
  smallBaseInst.computeBoundingSphere();
  if (largePadCount > 0) group.add(largeBaseInst);
  if (smallPadCount > 0) group.add(smallBaseInst);

  scene.add(group);

  let goalPulse = 0;

  return {
    group,
    boostPadVisuals,
    animatedObjects,
    update(time: number, dt: number, padStates: BoostPadState[]) {
      for (let i = 0; i < wallEnergyMats.length; i++) {
        wallEnergyMats[i].uniforms.uTime.value = time;
      }
      domeMat.uniforms.uTime.value = time;
      if (goalPulse > 0.001) {
        goalPulse = Math.max(0, goalPulse - dt * 0.72);
      }
      domeMat.uniforms.uGoalPulse.value = goalPulse;
      boostPadShaderMat.uniforms.uTime.value = time;

      if (animatedObjects.length >= 2) {
        animatedObjects[0].rotation.z = time * 0.18;
        animatedObjects[1].rotation.z = -time * 0.28;
        animatedObjects[1].rotation.y = time * 0.15;
      }

      for (let i = 0; i < boostPadVisuals.length; i++) {
        const vis = boostPadVisuals[i];
        const st = padStates[i];
        const active = st ? st.active : true;
        vis.orbMesh.visible = active;
        vis.ringMesh.visible = active;
        vis.padDiscMesh.visible = active;
        if (active) {
          vis.orbMesh.rotation.y = time * 2.2 + vis.id;
          if (vis.isLarge) {
            vis.orbMesh.position.y = 1.18 + Math.sin(time * 3.2 + vis.id) * 0.14;
          }
        }
        if (vis.burstTimer > 0) {
          vis.burstTimer = Math.max(0, vis.burstTimer - dt);
          const p = 1 - vis.burstTimer / 0.45;
          vis.burstRing.visible = true;
          vis.burstRing.scale.setScalar(1 + p * (vis.isLarge ? 3.2 : 2.2));
          vis.burstRing.position.y = 0.2 + p * 0.85;
          vis.burstMat.opacity = (1 - p) * 0.9;
        } else {
          vis.burstRing.visible = false;
        }
      }
    },
    triggerGoalPulse(teamColorHex: number | string) {
      goalPulse = 1.0;
      domeMat.uniforms.uGoalColor.value.set(teamColorHex);
    },
    triggerBoostBurst(pos: { x: number; y: number; z: number }) {
      let best: BoostPadVisual | null = null;
      let bestDistSq = 25;
      for (let i = 0; i < boostPadVisuals.length; i++) {
        const v = boostPadVisuals[i];
        const dx = v.x - pos.x;
        const dz = v.z - pos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          best = v;
        }
      }
      if (best) {
        best.burstTimer = 0.45;
      }
    },
    setQuality(nextQuality: GraphicsQuality) {
      const reflOn = reflectionsActive(nextQuality);
      if (reflector) {
        reflector.visible = reflOn;
      }
      if (pitchMatRef) {
        pitchMatRef.transparent = reflOn;
        pitchMatRef.opacity = reflOn ? 0.8 : 1.0;
        pitchMatRef.needsUpdate = true;
      }
      for (const cone of floodCones) {
        cone.visible = !isSoftwareGl && nextQuality !== 'low';
      }
      if (keyLight) {
        keyLight.castShadow = !isSoftwareGl && nextQuality !== 'low';
        const nextShadow = getShadowRes(nextQuality);
        if (keyLight.shadow.mapSize.x !== nextShadow) {
          keyLight.shadow.mapSize.set(nextShadow, nextShadow);
          keyLight.shadow.map?.dispose();
          keyLight.shadow.map = null;
        }
      }
    },
    dispose() {
      scene.remove(group);
      if (reflector) {
        reflector.dispose();
      }
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
    },
  };
}
