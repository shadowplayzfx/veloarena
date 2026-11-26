import * as THREE from 'three';

/**
 * Generates a procedural HDR-style night stadium environment with gradient sky dome
 * and bright overhead/endzone light panels via PMREMGenerator so car clearcoat,
 * chrome, glass, and ball reflect realistic arena lights.
 */
export function createProceduralArenaEnvironment(
  renderer: THREE.WebGLRenderer,
  variant: 'neon_stadium' | 'sunset_arena' | 'cyber_arena' = 'neon_stadium'
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();

  const skyTop =
    variant === 'sunset_arena' ? 0x1a1c3f : variant === 'cyber_arena' ? 0x0b061a : 0x060c1a;
  const skyHorizon =
    variant === 'sunset_arena' ? 0xc26138 : variant === 'cyber_arena' ? 0x2a144a : 0x10284d;

  const domeGeo = new THREE.SphereGeometry(40, 24, 16);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTop: { value: new THREE.Color(skyTop) },
      uHorizon: { value: new THREE.Color(skyHorizon) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uHorizon * 0.45, uHorizon, smoothstep(0.35, 0.52, h));
        col = mix(col, uTop, smoothstep(0.52, 0.92, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  envScene.add(new THREE.Mesh(domeGeo, domeMat));

  // Overhead stadium floodlight strip panels (HDR bright emissives for crisp car reflections)
  const panelGeo = new THREE.PlaneGeometry(18, 3.2);
  const whitePanelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 4.8, 5.2), side: THREE.DoubleSide });
  const warmPanelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.8, 2.2, 0.9), side: THREE.DoubleSide });
  const coolPanelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 2.6, 4.4), side: THREE.DoubleSide });

  const overheadPositions: [number, number, number, number][] = [
    [-12, 18, -10, 0.4],
    [12, 18, -10, -0.4],
    [-12, 18, 10, 0.4],
    [12, 18, 10, -0.4],
    [0, 20, 0, 0],
  ];
  for (const [px, py, pz, rz] of overheadPositions) {
    const p = new THREE.Mesh(panelGeo, whitePanelMat);
    p.position.set(px, py, pz);
    p.rotation.x = Math.PI * 0.5;
    p.rotation.z = rz;
    envScene.add(p);
  }

  // Blue (+Z) and Orange (-Z) stadium goal/wall accent light bars
  const sideBarGeo = new THREE.PlaneGeometry(24, 3.5);
  const blueBar = new THREE.Mesh(sideBarGeo, coolPanelMat);
  blueBar.position.set(0, 5, 22);
  blueBar.lookAt(0, 0, 0);
  envScene.add(blueBar);

  const orangeBar = new THREE.Mesh(sideBarGeo, warmPanelMat);
  orangeBar.position.set(0, 5, -22);
  orangeBar.lookAt(0, 0, 0);
  envScene.add(orangeBar);

  const rt = pmrem.fromScene(envScene, 0.03);

  domeGeo.dispose();
  domeMat.dispose();
  panelGeo.dispose();
  sideBarGeo.dispose();
  whitePanelMat.dispose();
  warmPanelMat.dispose();
  coolPanelMat.dispose();
  pmrem.dispose();

  return rt.texture;
}

/**
 * Extends MeshPhysicalMaterial / MeshStandardMaterial via onBeforeCompile with
 * view-dependent Fresnel rim lighting while preserving full PBR reflections & shadows.
 */
export function applyFresnelRimShader(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  rimColorHex: string | number,
  power = 3.2,
  intensity = 0.55
): { setRimColor: (hex: string | number) => void; setRimIntensity: (val: number) => void } {
  const rimColor = new THREE.Color(rimColorHex);
  const uniforms = {
    uRimColor: { value: rimColor },
    uRimPower: { value: power },
    uRimIntensity: { value: intensity },
  };
  material.userData.rimUniforms = uniforms;
  material.customProgramCacheKey = () => `fresnel_rim_v1_${power}`;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = uniforms.uRimColor;
    shader.uniforms.uRimPower = uniforms.uRimPower;
    shader.uniforms.uRimIntensity = uniforms.uRimIntensity;

    shader.fragmentShader =
      `uniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimIntensity;\n` +
      shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float _fresnelTerm = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uRimPower);
        totalEmissiveRadiance += uRimColor * (_fresnelTerm * uRimIntensity);`
      );
  };

  return {
    setRimColor(hex: string | number) {
      uniforms.uRimColor.value.set(hex);
    },
    setRimIntensity(val: number) {
      uniforms.uRimIntensity.value = val;
    },
  };
}

/**
 * Noise-driven animated boost flame ShaderMaterial (orange -> blue/custom plasma core).
 */
export function createBoostFlameShaderMaterial(
  coreColorHex = '#7dd3fc',
  outerColorHex = '#f97316'
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1.0 },
      uCoreColor: { value: new THREE.Color(coreColorHex) },
      uOuterColor: { value: new THREE.Color(outerColorHex) },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;
      varying float vNoise;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        vUv = uv;
        vec3 pos = position;
        float n = noise(vec2(uv.x * 6.0, uv.y * 8.0 - uTime * 18.0));
        vNoise = n;
        // Taper wobble along exhaust cone (pos.z goes 0 -> +length)
        float tail = clamp(pos.z / 1.85, 0.0, 1.0);
        pos.x += (n - 0.5) * 0.22 * tail * uIntensity;
        pos.y += (noise(vec2(uv.x * 5.0 + 3.1, uv.y * 7.0 - uTime * 21.0)) - 0.5) * 0.22 * tail * uIntensity;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uCoreColor;
      uniform vec3 uOuterColor;
      varying vec2 vUv;
      varying float vNoise;

      void main() {
        // vUv.y ~ 1 near nozzle, 0 at tip for ConeGeometry rotated -PI/2
        float nozzle = smoothstep(0.0, 0.88, vUv.y);
        float flicker = 0.72 + 0.28 * sin(uTime * 42.0 + vUv.y * 12.0);
        float coreMask = smoothstep(0.35, 0.92, vUv.y + vNoise * 0.18);
        vec3 col = mix(uOuterColor, uCoreColor, coreMask);
        col *= (1.15 + coreMask * 0.95) * flicker * uIntensity;
        float alpha = nozzle * (0.48 + 0.52 * vNoise) * clamp(uIntensity, 0.0, 1.2);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

/**
 * Volumetric-look additive stadium floodlight beam cone shader.
 */
export function createFloodlightConeMaterial(colorHex = 0xdbeafe): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: 0.16 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vNormalView = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewPos;
      void main() {
        // Soft edge fade using view dot normal + longitudinal taper from top (vUv.y=1) to floor (vUv.y=0)
        float edge = pow(abs(dot(normalize(vNormalView), normalize(vViewPos))), 1.8);
        float lengthFade = smoothstep(0.0, 0.75, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
        float alpha = edge * lengthFade * uOpacity;
        gl_FragColor = vec4(uColor * 1.15, alpha);
      }
    `,
  });
}

/**
 * Glassy arena wall shader with Fresnel edge glow, hex grid, and animated energy lines pulsing toward goals.
 */
export function createWallEnergyMaterial(
  teamColorHex: number,
  goalDirectionSign = 1
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(teamColorHex) },
      uGoalDir: { value: goalDirectionSign },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormalView;
      varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormalView = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uGoalDir;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormalView;
      varying vec3 vViewPos;

      float hexDist(vec2 p) {
        p = abs(p);
        float c = dot(p, normalize(vec2(1.0, 1.73205)));
        return max(c, p.x);
      }

      float hexGrid(vec2 uv) {
        vec2 r = vec2(1.0, 1.73205);
        vec2 h = r * 0.5;
        vec2 a = mod(uv, r) - h;
        vec2 b = mod(uv - h, r) - h;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        float d = 0.5 - hexDist(gv);
        return smoothstep(0.035, 0.0, d);
      }

      void main() {
        float fresnel = pow(1.0 - abs(dot(normalize(vNormalView), normalize(vViewPos))), 2.2);
        float grid = hexGrid(vWorldPos.xz * 0.22 + vec2(0.0, vWorldPos.y * 0.22));

        // Animated energy pulse bands flowing along Z toward goals
        float pulseCoord = vWorldPos.z * 0.09 * uGoalDir - uTime * 1.45;
        float pulseLine = pow(max(0.0, sin(pulseCoord * 3.14159)), 10.0);
        float trimGlow = smoothstep(0.18, 0.0, vUv.y) + smoothstep(0.88, 1.0, vUv.y) * 0.6;

        vec3 col = uColor * (0.35 + fresnel * 0.9 + grid * 0.55 + pulseLine * 0.85 + trimGlow * 0.9);
        float alpha = clamp(0.07 + fresnel * 0.22 + grid * 0.16 + pulseLine * 0.18 + trimGlow * 0.25, 0.04, 0.55);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

/**
 * Animated hex-mesh stadium dome shader with goal pulse wave.
 */
export function createDomeHexShaderMaterial(baseColorHex = 0x38bdf8): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uBaseColor: { value: new THREE.Color(baseColorHex) },
      uGoalColor: { value: new THREE.Color(0x38bdf8) },
      uGoalPulse: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uBaseColor;
      uniform vec3 uGoalColor;
      uniform float uGoalPulse;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      float hexDist(vec2 p) {
        p = abs(p);
        return max(dot(p, normalize(vec2(1.0, 1.73205))), p.x);
      }

      float hexGrid(vec2 uv) {
        vec2 r = vec2(1.0, 1.73205);
        vec2 h = r * 0.5;
        vec2 a = mod(uv, r) - h;
        vec2 b = mod(uv - h, r) - h;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        float d = 0.5 - hexDist(gv);
        return smoothstep(0.045, 0.0, d);
      }

      void main() {
        float g = hexGrid(vWorldPos.xz * 0.16);
        float wave = 0.5 + 0.5 * sin(vWorldPos.z * 0.08 - uTime * 1.4);
        float goalWave = uGoalPulse * (0.55 + 0.45 * sin(length(vWorldPos.xz) * 0.18 - uTime * 8.0));
        vec3 col = mix(uBaseColor, uGoalColor, clamp(uGoalPulse, 0.0, 1.0));
        float intensity = 0.35 + wave * 0.28 + goalWave * 1.6;
        float alpha = clamp(0.04 + g * (0.24 + goalWave * 0.45), 0.02, 0.72);
        gl_FragColor = vec4(col * intensity, alpha);
      }
    `,
  });
}

/**
 * Glowing hex-grid + pulsing ring ShaderMaterial for boost pad cores.
 */
export function createBoostPadShaderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xf97316) },
      uCoreColor: { value: new THREE.Color(0xfef08a) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uCoreColor;
      varying vec2 vUv;

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;

        // Hexagonal ripple & pulsing concentric ring
        float angle = atan(p.y, p.x);
        float hexR = r / cos(mod(angle + 0.52359, 1.04719) - 0.52359);
        float pulse = fract(hexR * 1.4 - uTime * 1.2);
        float ring = smoothstep(0.08, 0.0, abs(r - (0.72 + 0.08 * sin(uTime * 4.0))));
        float hexLine = smoothstep(0.08, 0.0, abs(pulse - 0.5));
        float centerGlow = exp(-r * r * 3.4);

        vec3 col = mix(uColor, uCoreColor, centerGlow + ring * 0.6);
        float alpha = clamp(centerGlow * 0.9 + ring * 0.95 + hexLine * 0.45 * (1.0 - r), 0.0, 1.0);
        gl_FragColor = vec4(col * 1.35, alpha);
      }
    `,
  });
}

/**
 * Expanding shader-based spherical shockwave for goal explosions.
 */
export function createGoalShockwaveShaderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uProgress: { value: 0 },
      uColor: { value: new THREE.Color(0x38bdf8) },
    },
    vertexShader: `
      varying vec3 vNormalView;
      varying vec3 vViewPos;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vNormalView = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uProgress;
      uniform vec3 uColor;
      varying vec3 vNormalView;
      varying vec3 vViewPos;
      varying vec2 vUv;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormalView), normalize(vViewPos))), 1.7);
        float fade = (1.0 - uProgress) * (1.0 - uProgress);
        vec3 col = mix(uColor, vec3(1.0), 0.45) * (1.6 + rim * 1.8);
        float alpha = clamp((0.2 + rim * 0.85) * fade, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

/**
 * Dynamic 3D speed-reactive glowing ribbon trail mesh (for cars & ball).
 */
export class RibbonTrail {
  public mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private points: THREE.Vector3[] = [];
  private maxPoints: number;
  private positions: Float32Array;
  private uvs: Float32Array;
  private indices: number[] = [];
  private halfWidth: number;
  private _side = new THREE.Vector3();
  private _dir = new THREE.Vector3();
  private _up = new THREE.Vector3(0, 1, 0);

  constructor(
    scene: THREE.Scene,
    maxPoints = 26,
    halfWidth = 0.42,
    colorHex: string | number = 0x38bdf8
  ) {
    this.maxPoints = maxPoints;
    this.halfWidth = halfWidth;
    for (let i = 0; i < maxPoints; i++) {
      this.points.push(new THREE.Vector3());
    }

    this.positions = new Float32Array(maxPoints * 2 * 3);
    this.uvs = new Float32Array(maxPoints * 2 * 2);

    for (let i = 0; i < maxPoints; i++) {
      const t = i / (maxPoints - 1);
      this.uvs[i * 4 + 0] = 0;
      this.uvs[i * 4 + 1] = t;
      this.uvs[i * 4 + 2] = 1;
      this.uvs[i * 4 + 3] = t;
    }

    for (let i = 0; i < maxPoints - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      this.indices.push(a, b, c, b, d, c);
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    this.geo.setIndex(this.indices);

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(colorHex) },
        uColorTip: { value: new THREE.Color(0xffffff) },
        uOpacity: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform vec3 uColorTip;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float headFade = 1.0 - vUv.y;
          float edgeSoft = sin(vUv.x * 3.14159);
          vec3 col = mix(uColor, uColorTip, headFade * 0.45);
          float alpha = pow(headFade, 1.35) * edgeSoft * uOpacity;
          gl_FragColor = vec4(col * 1.4, alpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  public reset(pos: THREE.Vector3): void {
    for (let i = 0; i < this.maxPoints; i++) {
      this.points[i].copy(pos);
    }
    this.mesh.visible = false;
  }

  public update(
    headPos: THREE.Vector3,
    active: boolean,
    intensity: number,
    colorHex?: string | number,
    tipColorHex?: string | number,
    widthScale = 1.0
  ): void {
    if (colorHex !== undefined) this.mat.uniforms.uColor.value.set(colorHex);
    if (tipColorHex !== undefined) this.mat.uniforms.uColorTip.value.set(tipColorHex);

    // Shift history down the ribbon
    for (let i = this.maxPoints - 1; i > 0; i--) {
      this.points[i].copy(this.points[i - 1]);
    }
    this.points[0].copy(headPos);

    const targetOp = active ? THREE.MathUtils.clamp(intensity, 0, 0.92) : 0;
    this.mat.uniforms.uOpacity.value = THREE.MathUtils.lerp(
      this.mat.uniforms.uOpacity.value,
      targetOp,
      0.22
    );

    if (this.mat.uniforms.uOpacity.value < 0.015) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    for (let i = 0; i < this.maxPoints; i++) {
      const curr = this.points[i];
      const next = i < this.maxPoints - 1 ? this.points[i + 1] : this.points[i - 1];
      this._dir.subVectors(curr, next);
      if (i === this.maxPoints - 1) this._dir.negate();
      if (this._dir.lengthSq() < 1e-6) {
        this._dir.set(0, 0, -1);
      } else {
        this._dir.normalize();
      }
      this._side.crossVectors(this._dir, this._up);
      if (this._side.lengthSq() < 1e-6) {
        this._side.set(1, 0, 0);
      } else {
        this._side.normalize();
      }

      const taper = (1 - i / (this.maxPoints - 1)) * this.halfWidth * widthScale;
      const idx = i * 6;
      this.positions[idx + 0] = curr.x - this._side.x * taper;
      this.positions[idx + 1] = curr.y - this._side.y * taper;
      this.positions[idx + 2] = curr.z - this._side.z * taper;
      this.positions[idx + 3] = curr.x + this._side.x * taper;
      this.positions[idx + 4] = curr.y + this._side.y * taper;
      this.positions[idx + 5] = curr.z + this._side.z * taper;
    }

    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}

/**
 * Post-processing final cinematic pass (applied after OutputPass in sRGB space):
 * - Deeper contrast & saturated team colors (cool shadows, warm highlights)
 * - Subtle supersonic speed-lines, radial blur & boost chromatic aberration
 * - Subtle vignette & subtle film grain
 * - Fast-fading goal explosion screen flash
 */
export const CinematicFinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uBoostChromatic: { value: 0 },
    uSupersonic: { value: 0 },
    uGoalFlash: { value: 0 },
    uGoalColor: { value: new THREE.Color(0x38bdf8) },
    uGrainIntensity: { value: 0.022 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uBoostChromatic;
    uniform float uSupersonic;
    uniform float uGoalFlash;
    uniform vec3 uGoalColor;
    uniform float uGrainIntensity;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 dir = vUv - 0.5;
      float dist = length(dir);

      // Subtle boost chromatic aberration + very subtle supersonic radial blur at screen edges
      float chroma = uBoostChromatic * 0.0045 * smoothstep(0.15, 0.72, dist);
      float radialScale = uSupersonic * 0.006 * smoothstep(0.28, 0.75, dist);

      vec3 col;
      if (chroma > 0.0001 || radialScale > 0.0001) {
        vec2 nDir = dist > 0.001 ? dir / dist : vec2(0.0);
        float r = texture2D(tDiffuse, vUv - nDir * (chroma + radialScale)).r;
        float g = texture2D(tDiffuse, vUv - nDir * (radialScale * 0.5)).g;
        float b = texture2D(tDiffuse, vUv + nDir * chroma).b;
        col = vec3(r, g, b);
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }

      // Subtle supersonic peripheral speed lines (strictly at edges, never obscures car or ball)
      if (uSupersonic > 0.02) {
        float ang = atan(dir.y, dir.x);
        float streak = pow(max(0.0, sin(ang * 38.0 + uTime * 24.0) * sin(ang * 17.0 - uTime * 19.0)), 6.0);
        float edgeMask = smoothstep(0.38, 0.74, dist);
        col += vec3(0.75, 0.9, 1.0) * streak * edgeMask * uSupersonic * 0.24;
      }

      // Color grading: deeper contrast, cool shadows, warm highlights, vibrant team colors
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.95, 0.98, 1.06);
      vec3 highlightTint = vec3(1.04, 1.01, 0.97);
      col *= mix(shadowTint, highlightTint, smoothstep(0.15, 0.85, luma));
      // Mild S-curve contrast + saturation boost
      col = clamp((col - 0.5) * 1.06 + 0.5, 0.0, 1.0);
      luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, 1.12);

      // Subtle vignette
      float vig = smoothstep(0.92, 0.25, dist);
      col *= mix(0.78, 1.0, vig);

      // Subtle film grain
      float grain = (rand(vUv + fract(uTime * 1.73)) - 0.5) * uGrainIntensity;
      col += grain;

      // Fast-fading goal explosion screen flash
      if (uGoalFlash > 0.005) {
        col = mix(col, uGoalColor * 1.25 + vec3(0.25), clamp(uGoalFlash * 0.45, 0.0, 0.55));
      }

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};
