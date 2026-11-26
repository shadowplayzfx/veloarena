import * as THREE from 'three';
import type { ArenaId, CarId } from '../shared/types.ts';

export function createPitchTexture(arenaId: ArenaId, maxAnisotropy = 4): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1536;
  const ctx = canvas.getContext('2d')!;

  const w = canvas.width;
  const h = canvas.height;
  const stripes = 14;
  const stripeH = h / stripes;

  for (let i = 0; i < stripes; i++) {
    const isLight = i % 2 === 0;
    const isOrangeHalf = i < stripes / 2;

    if (arenaId === 'cyber_arena') {
      ctx.fillStyle = isLight ? '#18543C' : '#124230';
    } else if (arenaId === 'sunset_arena') {
      ctx.fillStyle = isLight ? '#287233' : '#1F5A27';
    } else {
      ctx.fillStyle = isLight ? '#256F31' : '#1B5725';
    }
    ctx.fillRect(0, i * stripeH, w, stripeH);

    // Team-half tint across mowing stripes (Orange on -Z top half, Blue on +Z bottom half)
    ctx.fillStyle = isOrangeHalf
      ? isLight
        ? 'rgba(249, 115, 22, 0.16)'
        : 'rgba(234, 88, 12, 0.09)'
      : isLight
        ? 'rgba(14, 165, 233, 0.16)'
        : 'rgba(2, 132, 199, 0.09)';
    ctx.fillRect(0, i * stripeH, w, stripeH);
  }

  // Natural grass blade & turf micro-texture
  for (let i = 0; i < 16000; i++) {
    const gx = Math.random() * w;
    const gy = Math.random() * h;
    ctx.fillStyle =
      Math.random() > 0.5 ? 'rgba(255, 255, 255, 0.032)' : 'rgba(0, 18, 6, 0.075)';
    ctx.fillRect(gx, gy, 2, 3);
  }

  // Team zone glow near goal boxes
  const orangeGrad = ctx.createLinearGradient(0, 0, 0, h * 0.25);
  orangeGrad.addColorStop(0, 'rgba(249, 115, 22, 0.28)');
  orangeGrad.addColorStop(1, 'rgba(249, 115, 22, 0)');
  ctx.fillStyle = orangeGrad;
  ctx.fillRect(0, 0, w, h * 0.25);

  const blueGrad = ctx.createLinearGradient(0, h, 0, h * 0.75);
  blueGrad.addColorStop(0, 'rgba(14, 165, 233, 0.28)');
  blueGrad.addColorStop(1, 'rgba(14, 165, 233, 0)');
  ctx.fillStyle = blueGrad;
  ctx.fillRect(0, h * 0.75, w, h * 0.25);

  // Crisp stadium field lines
  const lineColor = 'rgba(255, 255, 255, 0.92)';
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 7;

  ctx.strokeRect(28, 28, w - 56, h - 56);

  ctx.beginPath();
  ctx.moveTo(28, h * 0.5);
  ctx.lineTo(w - 28, h * 0.5);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.5, 135, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.5, 18, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();

  ctx.strokeRect(w * 0.5 - 230, 28, 460, 220);
  ctx.strokeRect(w * 0.5 - 125, 28, 250, 96);

  ctx.strokeRect(w * 0.5 - 230, h - 248, 460, 220);
  ctx.strokeRect(w * 0.5 - 125, h - 124, 250, 96);

  ctx.beginPath();
  ctx.arc(w * 0.5, 248, 92, 0, Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w * 0.5, h - 248, 92, Math.PI, Math.PI * 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Subtle procedural grass & mowing normal map (linear space) for wet-look stadium floor micro-detail.
 */
export function createGrassNormalTexture(maxAnisotropy = 4): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const bladeX = Math.sin(x * 0.9 + y * 0.3) * 14 + (Math.random() - 0.5) * 26;
      const bladeY = Math.cos(y * 1.1 - x * 0.25) * 12 + (Math.random() - 0.5) * 24;
      data[idx] = Math.max(0, Math.min(255, 128 + bladeX));
      data[idx + 1] = Math.max(0, Math.min(255, 128 + bladeY));
      data[idx + 2] = 248;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(18, 26);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Metallic flake normal map (linear space) for clearcoat automotive paint sparkle.
 */
export function createCarFlakeNormalTexture(maxAnisotropy = 4): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const idx = i * 4;
    const isFlake = Math.random() < 0.42;
    const nx = isFlake ? (Math.random() - 0.5) * 64 : (Math.random() - 0.5) * 8;
    const ny = isFlake ? (Math.random() - 0.5) * 64 : (Math.random() - 0.5) * 8;
    data[idx] = Math.max(0, Math.min(255, 128 + nx));
    data[idx + 1] = Math.max(0, Math.min(255, 128 + ny));
    data[idx + 2] = 252;
    data[idx + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Procedural 2x2 twill carbon-fiber weave albedo + normal map for spoilers, splitters, and diffusers.
 */
export function createCarbonFiberTexture(maxAnisotropy = 4): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#11141a';
  ctx.fillRect(0, 0, size, size);

  const cell = 8;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const diag = ((x / cell + y / cell) % 4 + 4) % 4;
      const g = ctx.createLinearGradient(x, y, x + cell, y + cell);
      if (diag < 2) {
        g.addColorStop(0, '#1e2430');
        g.addColorStop(0.5, '#2c3444');
        g.addColorStop(1, '#141922');
      } else {
        g.addColorStop(0, '#0e1218');
        g.addColorStop(0.5, '#191f2a');
        g.addColorStop(1, '#0b0e13');
      }
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cell - 0.5, cell - 0.5);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Directional rubber tire tread normal map (linear space).
 */
export function createTireTreadNormalTexture(maxAnisotropy = 4): THREE.DataTexture {
  const w = 128;
  const h = 256;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const u = x / w;
      const v = y / h;
      const centerDist = Math.abs(u - 0.5);
      const chevron = Math.sin((v * 24 - centerDist * 10) * Math.PI * 2);
      const centerGroove = Math.abs(u - 0.5) < 0.045 || Math.abs(u - 0.25) < 0.025 || Math.abs(u - 0.75) < 0.025;
      const groove = centerGroove ? -1.0 : chevron > 0.55 ? -0.8 : 0.15;

      data[idx] = Math.max(0, Math.min(255, 128 + groove * 24));
      data[idx + 1] = Math.max(0, Math.min(255, 128 + groove * 52));
      data[idx + 2] = 240;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Procedural brushed metal texture for exhaust tips and brake rotors.
 */
export function createBrushedMetalTexture(maxAnisotropy = 4): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#c8d2de';
  ctx.fillRect(0, 0, 256, 256);

  for (let y = 0; y < 256; y++) {
    const v = 165 + Math.floor(Math.random() * 75);
    ctx.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
    ctx.fillRect(0, y, 256, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Procedural decal / livery CanvasTexture mapped across car bodywork.
 */
export function createCarLiveryTexture(
  primaryHex: string,
  secondaryHex: string,
  carId: CarId,
  maxAnisotropy = 4
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = primaryHex;
  ctx.fillRect(0, 0, 512, 512);

  // Subtle metallic shading gradient
  const sheen = ctx.createLinearGradient(0, 0, 512, 512);
  sheen.addColorStop(0, 'rgba(255,255,255,0.06)');
  sheen.addColorStop(0.5, 'rgba(0,0,0,0.0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, 512, 512);

  // Car-specific motorsport decal pattern in secondary/team color
  ctx.fillStyle = secondaryHex;
  if (carId === 'striker' || carId === 'bullitt') {
    // Classic twin muscle / GT racing stripes
    ctx.fillRect(216, 0, 28, 512);
    ctx.fillRect(268, 0, 28, 512);
  } else if (carId === 'hyperion' || carId === 'volt' || carId === 'apex_s') {
    // Geometric futuristic chevrons
    for (let y = 40; y < 480; y += 90) {
      ctx.beginPath();
      ctx.moveTo(150, y + 40);
      ctx.lineTo(256, y);
      ctx.lineTo(362, y + 40);
      ctx.lineTo(362, y + 62);
      ctx.lineTo(256, y + 22);
      ctx.lineTo(150, y + 62);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // Octane / Rally bold center spine + angled side slashes
    ctx.fillRect(232, 0, 48, 512);
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.moveTo(80, 120);
    ctx.lineTo(185, 60);
    ctx.lineTo(185, 115);
    ctx.lineTo(80, 175);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(432, 120);
    ctx.lineTo(327, 60);
    ctx.lineTo(327, 115);
    ctx.lineTo(432, 175);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Crisp subtle panel-line seams
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.34)';
  ctx.lineWidth = 3;
  ctx.strokeRect(48, 48, 416, 416);
  ctx.beginPath();
  ctx.moveTo(48, 256);
  ctx.lineTo(464, 256);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createHexMeshTexture(
  lineColor = 'rgba(56, 189, 248, 0.58)',
  maxAnisotropy = 4
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(14, 116, 144, 0.06)';
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2.4;

  const r = 32;
  const dx = r * 1.5;
  const dy = r * Math.sqrt(3);

  for (let row = -1; row <= 6; row++) {
    for (let col = -1; col <= 7; col++) {
      const cx = col * dx;
      const cy = row * dy + (col % 2 === 0 ? 0 : dy * 0.5);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createGoalNetTexture(
  strokeColor = 'rgba(186, 230, 253, 0.8)',
  maxAnisotropy = 4
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.2;

  const step = 16;
  for (let i = -128; i <= 256; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 128, 128);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(i, 128);
    ctx.lineTo(i + 128, 0);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createSkylineTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, 256, 512);

  for (let y = 16; y < 496; y += 20) {
    for (let x = 14; x < 242; x += 22) {
      const lit = Math.random();
      if (lit < 0.45) {
        ctx.fillStyle =
          lit < 0.17 ? '#38BDF8' : lit < 0.34 ? '#FDE68A' : '#FB923C';
        ctx.fillRect(x, y, 12, 9);
      } else {
        ctx.fillStyle = '#111827';
        ctx.fillRect(x, y, 12, 9);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function createBallTexture(maxAnisotropy = 4): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cols = 8;
  const rows = 4;
  const cw = canvas.width / cols;
  const ch = canvas.height / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * cw;
      const cy = (r + 0.5) * ch;
      const isPent = (r + c) % 2 === 0;
      const sides = isPent ? 5 : 6;
      const rad = Math.min(cw, ch) * 0.43;

      ctx.beginPath();
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2 - Math.PI * 0.5;
        const px = cx + Math.cos(a) * rad;
        const py = cy + Math.sin(a) * rad;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();

      ctx.fillStyle = isPent ? '#141B26' : '#CBD5E1';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#64748B';
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Emissive seam mask (grayscale -> color tinted dynamically on material.emissive) for the match ball.
 */
export function createBallEmissiveSeamTexture(maxAnisotropy = 4): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cols = 8;
  const rows = 4;
  const cw = canvas.width / cols;
  const ch = canvas.height / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * cw;
      const cy = (r + 0.5) * ch;
      const isPent = (r + c) % 2 === 0;
      const sides = isPent ? 5 : 6;
      const rad = Math.min(cw, ch) * 0.43;

      ctx.beginPath();
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2 - Math.PI * 0.5;
        const px = cx + Math.cos(a) * rad;
        const py = cy + Math.sin(a) * rad;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();

      ctx.lineWidth = isPent ? 7 : 5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      if (isPent) {
        ctx.beginPath();
        ctx.arc(cx, cy, rad * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.78)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.36)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Procedural radial rubber sidewall texture with moulded ribs and realistic text-like markings.
 */
export function createTireSidewallTexture(maxAnisotropy = 4): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size * 0.5;
  const cy = size * 0.5;

  ctx.fillStyle = '#15181e';
  ctx.fillRect(0, 0, size, size);

  // Subtle concentric moulded rubber ridges
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 2;
  for (const r of [76, 86, 114, 122]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Radial sidewall lettering blocks
  const phrases = ['VELOCITY PRO', '265/35 ZR20', 'SPORT COMP', 'RATED 340'];
  ctx.fillStyle = 'rgba(203, 213, 225, 0.36)';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < phrases.length; i++) {
    const baseAngle = (i * Math.PI) / 2;
    const text = phrases[i];
    for (let c = 0; c < text.length; c++) {
      const a = baseAngle + (c - text.length * 0.5) * 0.065;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * 100, cy + Math.sin(a) * 100);
      ctx.rotate(a + Math.PI * 0.5);
      ctx.fillText(text[c], 0, 0);
      ctx.restore();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Honeycomb perforated grille mesh texture for bumper intakes and engine vents.
 */
export function createGrilleMeshTexture(maxAnisotropy = 4): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = '#27303f';
  ctx.lineWidth = 2.5;
  const step = 16;
  for (let y = -16; y <= size + 16; y += step) {
    for (let x = -16; x <= size + 16; x += step) {
      const ox = (Math.floor(y / step) % 2) * (step * 0.5);
      ctx.beginPath();
      ctx.moveTo(x + ox, y - step * 0.5);
      ctx.lineTo(x + ox + step * 0.5, y);
      ctx.lineTo(x + ox, y + step * 0.5);
      ctx.lineTo(x + ox - step * 0.5, y);
      ctx.closePath();
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 2);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Fictional license plate CanvasTexture (zero real brands).
 */
export function createLicensePlateTexture(
  plateText = 'VLC-2084',
  accentHex = '#06B6D4',
  maxAnisotropy = 4
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, 256, 80);

  // Left team stripe & header
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 34, 80);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(34, 0, 222, 16);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('VELOCITY LEAGUE', 145, 11);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 34px monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(plateText, 145, 49);

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 76);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Cross-drilled radial brake disc rotor texture.
 */
export function createBrakeRotorTexture(maxAnisotropy = 4): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size * 0.5;
  const cy = size * 0.5;

  ctx.fillStyle = '#9aa5b4';
  ctx.fillRect(0, 0, size, size);

  for (let r = 36; r < 124; r += 3) {
    ctx.strokeStyle = r % 6 === 0 ? '#b7c2d0' : '#7f8b9a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Cross-drilled cooling holes
  ctx.fillStyle = '#1e2430';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    for (let ring = 0; ring < 3; ring++) {
      const rr = 58 + ring * 20;
      const aa = a + ring * 0.1;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}
