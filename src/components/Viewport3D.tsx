import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, Eye, Grid3x3, Layers, RotateCcw } from 'lucide-react';
import type { AcousticResult, BoxParams } from '../engine/types';
import { createContactShadowTexture, createMaterialBank, type MaterialBank } from '../engine/materials3d';
import { buildEnclosureScene, type BuiltEnclosure } from '../engine/sceneBuilder';
import { formatLen, formatLenNum, getUnitLabels } from '../engine/units';
import { useI18n } from '../i18n';

interface Viewport3DProps {
  params: BoxParams;
  acoustics: AcousticResult;
}

type CameraPresetKey = 'iso' | 'front' | 'side' | 'top' | 'interior';

const CAMERA_PRESETS: Record<CameraPresetKey, { labelPl: string; labelEn: string; dir: [number, number, number]; distMult: number }> = {
  iso: { labelPl: 'Izometryczny', labelEn: 'Isometric', dir: [0.9, 0.62, 1.18], distMult: 1.78 },
  front: { labelPl: 'Przód', labelEn: 'Front', dir: [0, 0.12, 1.35], distMult: 1.62 },
  side: { labelPl: 'Bok', labelEn: 'Side', dir: [1.35, 0.25, 0.05], distMult: 1.62 },
  top: { labelPl: 'Góra', labelEn: 'Top', dir: [0.01, 1.55, 0.2], distMult: 1.68 },
  interior: { labelPl: 'Wnętrze', labelEn: 'Interior', dir: [-0.85, 0.45, 0.85], distMult: 1.2 },
};

// Reusable scratch objects to prevent GC allocations during damping transitions
const _targetCamPos = new THREE.Vector3();
const _targetLookAt = new THREE.Vector3();

export function Viewport3D({ params, acoustics }: Viewport3DProps) {
  const { lang, unitSystem } = useI18n();
  const isEn = lang === 'en';
  const u = getUnitLabels(unitSystem);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [opacityMode, setOpacityMode] = useState<'xray' | 'solid' | 'ghost'>('xray');
  const [explodeFactor, setExplodeFactor] = useState<number>(0);
  const [showEdges, setShowEdges] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [activePreset, setActivePreset] = useState<CameraPresetKey>('iso');
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  );
  const [contextLost, setContextLost] = useState<boolean>(false);

  // Refs synced into the WebGL engine without tearing down the renderer
  const sceneStateRef = useRef<{
    params: BoxParams;
    acoustics: AcousticResult;
    opacityMode: 'xray' | 'solid' | 'ghost';
    explodeTarget: number;
    explodeCurrent: number;
    showEdges: boolean;
    showGrid: boolean;
  }>({
    params,
    acoustics,
    opacityMode,
    explodeTarget: explodeFactor,
    explodeCurrent: explodeFactor,
    showEdges,
    showGrid,
  });

  const engineRef = useRef<{
    requestRender: () => void;
    rebuildModel: () => void;
    applyOpacity: () => void;
    applyGridVisibility: () => void;
    setCameraPreset: (key: CameraPresetKey) => void;
  } | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
      requestRender();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0b0e);
    scene.fog = new THREE.FogExp2(0x0a0b0e, 0.018);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 200);
    camera.position.set(10, 6.5, 13);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 3;
    controls.maxDistance = 42;
    controls.target.set(0, 1.9, 0);

    // 3-Point Studio Lighting with warm/cool temperature contrast
    const hemiLight = new THREE.HemisphereLight(0xc8dcff, 0x20242c, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1dc, 1.75);
    keyLight.position.set(9, 14, 10);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -10;
    keyLight.shadow.camera.right = 10;
    keyLight.shadow.camera.top = 10;
    keyLight.shadow.camera.bottom = -10;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x8ec5ff, 0.65);
    rimLight.position.set(-10, 6, -9);
    scene.add(rimLight);

    // Architectural Showroom Floor Grid + Contact Shadow Disc
    const gridGroup = new THREE.Group();
    const gridHelper = new THREE.GridHelper(32, 32, 0x2d323e, 0x181a21);
    gridHelper.position.y = -0.01;
    gridGroup.add(gridHelper);

    const shadowTex = createContactShadowTexture();
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.002;
    gridGroup.add(shadowPlane);
    scene.add(gridGroup);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const materialBank: MaterialBank = createMaterialBank(maxAniso, isSoftwareGl);

    let built: BuiltEnclosure | null = null;
    let cameraAnimating = false;
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTime = performance.now();

    function applyOpacity() {
      const mode = sceneStateRef.current.opacityMode;
      if (mode === 'solid') {
        materialBank.woodMaterial.transparent = false;
        materialBank.woodMaterial.opacity = 1.0;
        materialBank.woodMaterial.depthWrite = true;
        materialBank.portWoodMaterial.opacity = 1.0;
        materialBank.edgeLineMaterial.opacity = 0.35;
      } else if (mode === 'xray') {
        materialBank.woodMaterial.transparent = true;
        materialBank.woodMaterial.opacity = 0.68;
        materialBank.woodMaterial.depthWrite = true;
        materialBank.portWoodMaterial.opacity = 0.92;
        materialBank.edgeLineMaterial.opacity = 0.52;
      } else {
        materialBank.woodMaterial.transparent = true;
        materialBank.woodMaterial.opacity = 0.24;
        materialBank.woodMaterial.depthWrite = false;
        materialBank.portWoodMaterial.opacity = 0.85;
        materialBank.edgeLineMaterial.opacity = 0.72;
      }
      materialBank.woodMaterial.needsUpdate = true;
      materialBank.portWoodMaterial.needsUpdate = true;
    }

    function applyExplode(factor: number) {
      if (!built) return;
      for (const item of built.explodables) {
        item.object.position
          .copy(item.basePos)
          .addScaledVector(item.explodeOffset, factor);
      }
    }

    function rebuildModel() {
      if (built) {
        scene.remove(built.root);
        built.dispose();
        built = null;
      }
      const st = sceneStateRef.current;
      built = buildEnclosureScene(st.params, st.acoustics, materialBank, st.showEdges);
      scene.add(built.root);

      // Scale contact shadow to match enclosure footprint
      const span = Math.max(built.boundingSize.x, built.boundingSize.z) * 1.65;
      shadowPlane.scale.set(span / 14, span / 14, 1);

      applyOpacity();
      applyExplode(st.explodeCurrent);
    }

    function setCameraPreset(key: CameraPresetKey) {
      const preset = CAMERA_PRESETS[key];
      const boxH = built ? built.boundingSize.y : 3.8;
      const boxMax = built
        ? Math.max(built.boundingSize.x, built.boundingSize.y, built.boundingSize.z)
        : 6.8;
      const dist = Math.max(6.2, boxMax * preset.distMult);
      const dir = new THREE.Vector3(...preset.dir).normalize();
      _targetLookAt.set(0, boxH * 0.34, 0);
      _targetCamPos.copy(_targetLookAt).addScaledVector(dir, dist);
      cameraAnimating = true;
      requestRender();
    }

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
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

    function requestRender() {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        renderDirty = false;
        const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
        lastTime = now;

        const st = sceneStateRef.current;
        let needsAnotherFrame = false;

        // Smooth exploded-view damping
        if (Math.abs(st.explodeCurrent - st.explodeTarget) > 0.002) {
          st.explodeCurrent = isSoftwareGl
            ? st.explodeTarget
            : THREE.MathUtils.damp(st.explodeCurrent, st.explodeTarget, 10, dt);
          applyExplode(st.explodeCurrent);
          if (!isSoftwareGl) needsAnotherFrame = true;
        } else if (st.explodeCurrent !== st.explodeTarget) {
          st.explodeCurrent = st.explodeTarget;
          applyExplode(st.explodeCurrent);
        }

        // Smooth camera preset damping
        if (cameraAnimating) {
          if (isSoftwareGl) {
            camera.position.copy(_targetCamPos);
            controls.target.copy(_targetLookAt);
            cameraAnimating = false;
          } else {
            camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetCamPos.x, 8, dt);
            camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetCamPos.y, 8, dt);
            camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetCamPos.z, 8, dt);
            controls.target.x = THREE.MathUtils.damp(controls.target.x, _targetLookAt.x, 8, dt);
            controls.target.y = THREE.MathUtils.damp(controls.target.y, _targetLookAt.y, 8, dt);
            controls.target.z = THREE.MathUtils.damp(controls.target.z, _targetLookAt.z, 8, dt);
            if (camera.position.distanceTo(_targetCamPos) < 0.03) {
              camera.position.copy(_targetCamPos);
              controls.target.copy(_targetLookAt);
              cameraAnimating = false;
            } else {
              needsAnotherFrame = true;
            }
          }
        }

        const didDamp = controls.update();
        if (didDamp && !isSoftwareGl) {
          // OrbitControls damping still settling
          needsAnotherFrame = true;
        }

        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty || needsAnotherFrame) {
            requestRender();
          }
        };

        if (isSoftwareGl) {
          afterDraw(done);
        } else {
          done();
        }
      });
    }

    const onControlStart = () => {
      cameraAnimating = false;
    };
    const onControlChange = () => {
      requestRender();
    };
    controls.addEventListener('start', onControlStart);
    controls.addEventListener('change', onControlChange);

    let lastW = width;
    let lastH = height;
    let resizeRafId = 0;

    const resizeObserver = new ResizeObserver(() => {
      if (resizeRafId) cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = 0;
        if (!container) return;
        const w = Math.max(1, container.clientWidth);
        const h = Math.max(1, container.clientHeight);
        if (w === lastW && h === lastH) return;
        lastW = w;
        lastH = h;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        requestRender();
      });
    });
    resizeObserver.observe(container);

    // Build initial scene
    rebuildModel();
    setCameraPreset('iso');
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }
    requestRender();

    engineRef.current = {
      requestRender,
      rebuildModel,
      applyOpacity,
      applyGridVisibility: () => {
        gridGroup.visible = sceneStateRef.current.showGrid;
        requestRender();
      },
      setCameraPreset,
    };

    return () => {
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(resizeRafId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.removeEventListener('change', onControlChange);
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      if (built) built.dispose();
      materialBank.dispose();
      shadowTex.dispose();
      shadowMat.dispose();
      shadowPlane.geometry.dispose();
      if (scene.environment) scene.environment.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      engineRef.current = null;
    };
  }, []);

  // Sync parameter & geometry changes without destroying the WebGL canvas
  useEffect(() => {
    sceneStateRef.current.params = params;
    sceneStateRef.current.acoustics = acoustics;
    sceneStateRef.current.showEdges = showEdges;
    if (engineRef.current) {
      engineRef.current.rebuildModel();
      engineRef.current.requestRender();
    }
  }, [params, acoustics, showEdges]);

  useEffect(() => {
    sceneStateRef.current.opacityMode = opacityMode;
    if (engineRef.current) {
      engineRef.current.applyOpacity();
      engineRef.current.requestRender();
    }
  }, [opacityMode]);

  useEffect(() => {
    sceneStateRef.current.explodeTarget = explodeFactor;
    if (engineRef.current) {
      engineRef.current.requestRender();
    }
  }, [explodeFactor]);

  useEffect(() => {
    sceneStateRef.current.showGrid = showGrid;
    if (engineRef.current) {
      engineRef.current.applyGridVisibility();
    }
  }, [showGrid]);

  const handlePresetClick = (key: CameraPresetKey) => {
    setActivePreset(key);
    engineRef.current?.setCameraPreset(key);
  };

  return (
    <div className="relative w-full h-[50vh] min-h-[320px] max-h-[540px] lg:max-h-none lg:flex-1 lg:h-full bg-[#0A0B0E] overflow-hidden select-none">
      {/* Isolated WebGL mount container */}
      <div
        ref={mountRef}
        data-testid="viewport-3d-canvas"
        aria-label={isEn ? 'Interactive 3D subwoofer enclosure viewport' : 'Interaktywny podgląd 3D obudowy basowej'}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0A0B0E]/95 z-20 p-6 text-center">
          <div className="max-w-sm border border-white/10 bg-[#14161D] rounded-lg p-6">
            <h3 className="text-base font-semibold text-white mb-2">
              {isEn ? 'WebGL context interrupted' : 'Kontekst WebGL przerwany'}
            </h3>
            <p className="text-sm text-zinc-400">
              {isEn
                ? 'The browser paused 3D rendering. Refresh the view or switch tabs to resume.'
                : 'Przeglądarka wstrzymała renderowanie 3D. Odśwież widok lub zmień zakładkę, aby wznowić.'}
            </p>
          </div>
        </div>
      )}

      {/* Subtle corner dimension summary (clean unboxed text, top-left) */}
      <div className="pointer-events-none absolute top-2.5 left-3 right-3 sm:top-4 sm:left-4 sm:right-auto z-10 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] sm:text-xs text-zinc-400">
        <span className="font-mono-num text-zinc-200">
          {formatLenNum(acoustics.effectiveExternalWidth, unitSystem, 0, 2)} ×{' '}
          {formatLenNum(acoustics.effectiveExternalHeight, unitSystem, 0, 2)} ×{' '}
          {formatLenNum(acoustics.effectiveExternalDepth, unitSystem, 0, 2)} {u.len}
        </span>
        <span className="whitespace-nowrap">
          · {isEn ? 'Board' : 'Płyta'} {formatLen(params.thickness, unitSystem, 0, 2)}
        </span>
        {acoustics.slotPort?.isBent && (
          <span className="text-red-400 whitespace-nowrap">
            · {isEn ? 'L-bent port' : 'Port zagięty L'} (
            {formatLenNum(acoustics.slotPort.baffle1Length, unitSystem, 0, 2)}+
            {formatLenNum(acoustics.slotPort.baffle2Length, unitSystem, 0, 2)} {u.len})
          </span>
        )}
      </div>

      {/* Unified Collapsible Bottom Control Dock */}
      <div className="absolute bottom-2.5 sm:bottom-4 left-1/2 -translate-x-1/2 z-10 w-[calc(100%-1rem)] sm:w-[min(900px,calc(100%-2rem))] flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="mb-1 sm:mb-1.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-t-md bg-[#14161D]/95 border border-b-0 border-white/10 text-[11px] font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
          aria-expanded={!dockCollapsed}
        >
          {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>
            {dockCollapsed
              ? isEn
                ? 'Show 3D view controls'
                : 'Pokaż narzędzia widoku 3D'
              : isEn
                ? 'Hide 3D panel'
                : 'Ukryj panel 3D'}
          </span>
        </button>

        {!dockCollapsed && (
          <div className="w-full bg-[#13151C]/95 border border-white/10 rounded-lg px-2.5 sm:px-4 py-2 sm:py-2.5 flex flex-wrap items-center justify-between gap-x-4 sm:gap-x-5 gap-y-2 shadow-xl">
            {/* Camera Presets */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full" role="group" aria-label={isEn ? 'Camera presets' : 'Widoki kamery'}>
              {(Object.keys(CAMERA_PRESETS) as CameraPresetKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handlePresetClick(key)}
                  className={`px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    activePreset === key
                      ? 'bg-red-600 text-white'
                      : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {isEn ? CAMERA_PRESETS[key].labelEn : CAMERA_PRESETS[key].labelPl}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handlePresetClick('iso')}
                title={isEn ? 'Reset camera' : 'Resetuj kamerę'}
                aria-label={isEn ? 'Reset camera' : 'Resetuj kamerę'}
                className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-white/5 transition-colors shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Exploded View Slider (0-100%) */}
            <div className="flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <label htmlFor="explode-slider" className="text-xs text-zinc-300 whitespace-nowrap">
                {isEn ? 'Explode' : 'Rozstrzelenie'}
              </label>
              <input
                id="explode-slider"
                type="range"
                aria-label={isEn ? 'Exploded view percentage' : 'Rozstrzelenie modelu w procentach'}
                min={0}
                max={100}
                step={1}
                value={Math.round(explodeFactor * 100)}
                onChange={(e) => setExplodeFactor(Number(e.target.value) / 100)}
                className="w-24 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-red-500"
              />
              <span className="font-mono-num text-xs text-zinc-300 w-9 text-right tabular-nums">
                {Math.round(explodeFactor * 100)}%
              </span>
            </div>

            {/* Opacity & CAD Wireframe Toggles */}
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-[#0A0B0E] rounded p-0.5 border border-white/10" role="group" aria-label={isEn ? 'Opacity mode' : 'Tryb przezroczystości'}>
                <button
                  type="button"
                  onClick={() => setOpacityMode('xray')}
                  className={`px-2 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    opacityMode === 'xray' ? 'bg-[#212530] text-red-400 font-medium' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  X-Ray
                </button>
                <button
                  type="button"
                  onClick={() => setOpacityMode('solid')}
                  className={`px-2 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    opacityMode === 'solid' ? 'bg-[#212530] text-red-400 font-medium' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {isEn ? 'Solid' : 'Pełny'}
                </button>
                <button
                  type="button"
                  onClick={() => setOpacityMode('ghost')}
                  className={`px-2 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    opacityMode === 'ghost' ? 'bg-[#212530] text-red-400 font-medium' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {isEn ? 'Wireframe' : 'Szkielet'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowEdges((v) => !v)}
                aria-pressed={showEdges}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors whitespace-nowrap shrink-0 ${
                  showEdges
                    ? 'border-red-500/40 bg-red-500/10 text-red-300'
                    : 'border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{isEn ? 'Edges' : 'Krawędzie'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowGrid((v) => !v)}
                aria-pressed={showGrid}
                aria-label={isEn ? 'CAD Grid' : 'Siatka CAD'}
                className={`p-1.5 rounded border transition-colors shrink-0 ${
                  showGrid
                    ? 'border-red-500/40 bg-red-500/10 text-red-300'
                    : 'border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                <Grid3x3 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
