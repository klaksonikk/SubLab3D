import * as THREE from 'three';
import type { MaterialType } from './types';

function createWoodCanvasTexture(variant: MaterialType): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  if (variant === 'mdf') {
    ctx.fillStyle = '#9c7853';
    ctx.fillRect(0, 0, 512, 512);
    // Subtle composite fiber speckles
    for (let i = 0; i < 6500; i++) {
      const x = (i * 73) % 512;
      const y = ((i * 197) + Math.floor(i / 512) * 31) % 512;
      const shade = i % 3 === 0 ? 'rgba(65, 45, 25, 0.14)' : 'rgba(210, 175, 130, 0.11)';
      ctx.fillStyle = shade;
      ctx.fillRect(x, y, (i % 2) + 1, (i % 3) + 1);
    }
  } else if (variant === 'birch_plywood') {
    ctx.fillStyle = '#d4b483';
    ctx.fillRect(0, 0, 512, 512);
    // Organic wood grain lines
    for (let y = 0; y < 512; y += 2) {
      const wave = Math.sin(y * 0.045) * 0.5 + Math.cos(y * 0.017) * 0.5;
      const alpha = 0.03 + Math.abs(wave) * 0.06;
      ctx.fillStyle = wave > 0 ? `rgba(145, 102, 54, ${alpha})` : `rgba(240, 218, 180, ${alpha})`;
      ctx.fillRect(0, y, 512, 2);
    }
    // Subtle grain streaks
    for (let i = 0; i < 180; i++) {
      const y = (i * 29) % 512;
      const x = (i * 113) % 420;
      ctx.fillStyle = 'rgba(130, 88, 42, 0.08)';
      ctx.fillRect(x, y, 60 + (i % 80), 1);
    }
  } else {
    // Matte textured acoustic finish (Duratex / Warnex style)
    ctx.fillStyle = '#242933';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 7000; i++) {
      const x = (i * 89) % 512;
      const y = ((i * 223) + Math.floor(i / 512) * 19) % 512;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, y, 2, 2);
    }
  }

  return canvas;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 124);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.58)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.24)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export interface MaterialBank {
  woodTextures: Record<MaterialType, THREE.CanvasTexture>;
  woodMaterial: THREE.MeshStandardMaterial;
  portWoodMaterial: THREE.MeshStandardMaterial;
  acrylicMaterial: THREE.MeshPhysicalMaterial;
  edgeLineMaterial: THREE.LineBasicMaterial;
  dispose: () => void;
}

export function createMaterialBank(maxAnisotropy: number, isSoftwareGl: boolean): MaterialBank {
  const woodTextures: Record<MaterialType, THREE.CanvasTexture> = {
    mdf: new THREE.CanvasTexture(createWoodCanvasTexture('mdf')),
    birch_plywood: new THREE.CanvasTexture(createWoodCanvasTexture('birch_plywood')),
    matte_black: new THREE.CanvasTexture(createWoodCanvasTexture('matte_black')),
  };

  (Object.values(woodTextures) as THREE.CanvasTexture[]).forEach((tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.5, 1.5);
    tex.anisotropy = maxAnisotropy;
    tex.needsUpdate = true;
  });

  const woodMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: woodTextures.birch_plywood,
    roughness: 0.72,
    metalness: 0.04,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
  });

  const portWoodMaterial = new THREE.MeshStandardMaterial({
    color: 0xe6c89a,
    map: woodTextures.birch_plywood,
    roughness: 0.65,
    metalness: 0.05,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
  });

  const acrylicMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xa5d8ff,
    metalness: 0.05,
    roughness: 0.08,
    transmission: isSoftwareGl ? 0 : 0.72,
    transparent: true,
    opacity: isSoftwareGl ? 0.34 : 0.45,
    ior: 1.49,
    clearcoat: 1.0,
    depthWrite: false,
  });

  const edgeLineMaterial = new THREE.LineBasicMaterial({
    color: 0xcbd5e1,
    transparent: true,
    opacity: 0.42,
  });

  return {
    woodTextures,
    woodMaterial,
    portWoodMaterial,
    acrylicMaterial,
    edgeLineMaterial,
    dispose: () => {
      Object.values(woodTextures).forEach((t) => t.dispose());
      woodMaterial.dispose();
      portWoodMaterial.dispose();
      acrylicMaterial.dispose();
      edgeLineMaterial.dispose();
    },
  };
}
