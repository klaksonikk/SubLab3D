import { useEffect, useMemo, useState } from 'react';
import { Share2, Sliders } from 'lucide-react';
import { calculateAcoustics } from './engine/acoustics';
import { generateCutList, optimizeCutSheet } from './engine/cutlist';
import {
  BOX_TEMPLATE_PRESETS,
  DEFAULT_BOX_PARAMS,
  DRIVER_PRESETS,
} from './engine/presets';
import { decodeModelToken } from './engine/sharing';
import type { BoxParams, CoilWiringMode, DriverPreset } from './engine/types';
import { SidebarControls } from './components/SidebarControls';
import { TelemetryStrip } from './components/TelemetryStrip';
import { Viewport3D } from './components/Viewport3D';
import { AcousticChart } from './components/AcousticChart';
import { CutListView } from './components/CutListView';
import { SheetNestingView } from './components/SheetNestingView';
import { AcousticWorkbench } from './components/AcousticWorkbench';
import { ShareModal } from './components/ShareModal';
import { DriverTsModal } from './components/DriverTsModal';

type ActiveView = '3d' | 'chart' | 'workbench' | 'cutlist' | 'nesting';

const STORAGE_KEY = 'subbox_cad_project_v1';
const CUSTOM_DRIVERS_KEY = 'subbox_cad_custom_drivers_v1';

function normalizeCustomDriver(raw: DriverPreset): DriverPreset {
  const voiceCoilCount = raw.voiceCoilCount === 2 ? 2 : 1;
  const coilNominalOhms = raw.coilNominalOhms ?? (voiceCoilCount === 2 ? (raw.zNom ?? 4) / 2 : raw.zNom ?? 4);
  const coilReOhms = raw.coilReOhms ?? (voiceCoilCount === 2 ? (raw.re ?? coilNominalOhms * 1.6) / 2 : raw.re ?? 3.2);
  return {
    ...raw,
    isCustom: true,
    source: raw.source ?? 'Własny T-S',
    voiceCoilCount,
    coilNominalOhms,
    coilReOhms,
  };
}

function loadCustomDrivers(): DriverPreset[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_DRIVERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DriverPreset[];
    return Array.isArray(parsed) ? parsed.map(normalizeCustomDriver) : [];
  } catch {
    return [];
  }
}

export function driverPresetToBoxPatch(
  drv: DriverPreset,
  coilWiringOverride?: CoilWiringMode,
): Partial<BoxParams> {
  const voiceCoilCount = drv.voiceCoilCount === 2 ? 2 : 1;
  const coilNominalOhms =
    drv.coilNominalOhms ?? (voiceCoilCount === 2 ? (drv.zNom ?? 4) / 2 : drv.zNom ?? 4);
  const coilReOhms =
    drv.coilReOhms ??
    (voiceCoilCount === 2 ? (drv.re ?? coilNominalOhms * 1.6) / 2 : drv.re ?? 3.2);
  const coilWiring: CoilWiringMode =
    voiceCoilCount === 2
      ? coilWiringOverride === 'parallel' || coilWiringOverride === 'series'
        ? coilWiringOverride
        : 'series'
      : 'single';

  return {
    driverPresetId: drv.id,
    driverName: drv.name,
    driverCutoutDia: drv.cutoutDia,
    driverOuterDia: drv.outerDia,
    driverDepth: drv.depth,
    driverDisplacement: drv.displacement,
    driverFs: drv.fs,
    driverQts: drv.qts,
    driverVas: drv.vas,
    driverXmax: drv.xmax,
    driverPowerW: drv.powerW,
    driverVoiceCoilCount: voiceCoilCount,
    driverCoilNominalOhms: coilNominalOhms,
    driverCoilReOhms: coilReOhms,
    driverCoilLeMh: drv.le ?? 1.4,
    driverCoilWiring: coilWiring,
  };
}

function migrateBoxParams(
  raw: Partial<BoxParams>,
  customDriversList: DriverPreset[],
): BoxParams {
  const all = [...DRIVER_PRESETS, ...customDriversList];
  const matched = all.find((d) => d.id === raw.driverPresetId);
  const merged: BoxParams = {
    ...DEFAULT_BOX_PARAMS,
    ...raw,
    doubleFrontBaffle: false,
  };
  if (!matched) {
    // Removed legacy placeholder driver -> migrate to Deaf Bonce MF-12R D2
    Object.assign(merged, driverPresetToBoxPatch(DRIVER_PRESETS[0], 'series'));
  } else {
    if (merged.driverVoiceCoilCount === undefined) {
      merged.driverVoiceCoilCount = matched.voiceCoilCount ?? 1;
    }
    if (merged.driverCoilNominalOhms === undefined) {
      merged.driverCoilNominalOhms = matched.coilNominalOhms ?? 4;
    }
    if (merged.driverCoilReOhms === undefined) {
      merged.driverCoilReOhms = matched.coilReOhms ?? 3.2;
    }
    if (merged.driverCoilLeMh === undefined) {
      merged.driverCoilLeMh = matched.le ?? 1.4;
    }
    if (merged.driverCoilWiring === undefined) {
      merged.driverCoilWiring = merged.driverVoiceCoilCount === 2 ? 'series' : 'single';
    }
    if (merged.driverArrayWiring === undefined) {
      merged.driverArrayWiring = 'parallel';
    }
  }
  return merged;
}

function loadInitialState(): {
  params: BoxParams;
  customDrivers: DriverPreset[];
} {
  let drivers = loadCustomDrivers();
  try {
    const query = new URLSearchParams(window.location.search);
    const modelToken = query.get('model');
    if (modelToken) {
      const decoded = decodeModelToken(modelToken);
      if (decoded) {
        if (
          decoded.customDriver &&
          !drivers.some((d) => d.id === decoded.customDriver!.id)
        ) {
          drivers = [...drivers, normalizeCustomDriver(decoded.customDriver)];
        }
        return {
          params: migrateBoxParams(decoded.params, drivers),
          customDrivers: drivers,
        };
      }
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { params: DEFAULT_BOX_PARAMS, customDrivers: drivers };
    const parsed = JSON.parse(raw) as Partial<BoxParams>;
    return {
      params: migrateBoxParams(parsed, drivers),
      customDrivers: drivers,
    };
  } catch {
    return { params: DEFAULT_BOX_PARAMS, customDrivers: drivers };
  }
}

export default function App() {
  const initial = useMemo(() => loadInitialState(), []);
  const [params, setParams] = useState<BoxParams>(initial.params);
  const [customDrivers, setCustomDrivers] = useState<DriverPreset[]>(initial.customDrivers);
  const [activeView, setActiveView] = useState<ActiveView>('3d');
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [mobileParamsOpen, setMobileParamsOpen] = useState(false);

  // Shared Driver T-S Modal accessible from both Sidebar and WSD
  const [driverModalOpen, setDriverModalOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<DriverPreset | null>(null);
  const [modalTemplateDriver, setModalTemplateDriver] = useState<DriverPreset>(DRIVER_PRESETS[0]);

  useEffect(() => {
    if (!mobileParamsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileParamsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileParamsOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    } catch {
      // Ignore storage quota errors
    }
  }, [params]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CUSTOM_DRIVERS_KEY, JSON.stringify(customDrivers));
    } catch {
      // Ignore storage quota errors
    }
  }, [customDrivers]);

  const acoustics = useMemo(() => calculateAcoustics(params), [params]);
  const cutPanels = useMemo(() => generateCutList(params, acoustics), [params, acoustics]);
  const sheetSummary = useMemo(() => optimizeCutSheet(params, cutPanels), [params, cutPanels]);

  const allDrivers = useMemo(
    () => [...DRIVER_PRESETS, ...customDrivers],
    [customDrivers],
  );

  const activeCustomDriver = useMemo(
    () => customDrivers.find((d) => d.id === params.driverPresetId),
    [customDrivers, params.driverPresetId],
  );

  const activeDriverPreset = useMemo(
    () => allDrivers.find((d) => d.id === params.driverPresetId) ?? DRIVER_PRESETS[0],
    [allDrivers, params.driverPresetId],
  );

  const handlePatch = (patch: Partial<BoxParams>) => {
    setParams((prev) => ({
      ...prev,
      ...patch,
      doubleFrontBaffle: false,
    }));
  };

  const handleApplyTemplate = (templateId: string) => {
    const tpl = BOX_TEMPLATE_PRESETS.find((t) => t.id === templateId);
    if (!tpl) return;
    setParams({
      ...DEFAULT_BOX_PARAMS,
      ...tpl.params,
      doubleFrontBaffle: false,
    });
  };

  const handleSaveCustomDriver = (
    driver: DriverPreset,
    applyToProjectToo = true,
    coilWiringOverride?: CoilWiringMode,
  ) => {
    const normalized = normalizeCustomDriver(driver);
    setCustomDrivers((prev) => {
      const idx = prev.findIndex((d) => d.id === normalized.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = normalized;
        return next;
      }
      return [...prev, normalized];
    });

    if (applyToProjectToo || params.driverPresetId === normalized.id) {
      handlePatch(driverPresetToBoxPatch(normalized, coilWiringOverride));
    }
  };

  const handleDeleteCustomDriver = (driverId: string) => {
    setCustomDrivers((prev) => prev.filter((d) => d.id !== driverId));
    if (params.driverPresetId === driverId) {
      handlePatch(driverPresetToBoxPatch(DRIVER_PRESETS[0], 'series'));
    }
  };

  const handleImportModel = (importedParams: BoxParams, customDriver?: DriverPreset) => {
    let nextDrivers = customDrivers;
    if (customDriver) {
      const normalized = normalizeCustomDriver(customDriver);
      nextDrivers = customDrivers.some((d) => d.id === normalized.id)
        ? customDrivers.map((d) => (d.id === normalized.id ? normalized : d))
        : [...customDrivers, normalized];
      setCustomDrivers(nextDrivers);
    }
    setParams(migrateBoxParams(importedParams, nextDrivers));
  };

  const openDriverModal = (editTarget: DriverPreset | null, template?: DriverPreset) => {
    setEditingDriver(editTarget);
    setModalTemplateDriver(template ?? activeDriverPreset);
    setDriverModalOpen(true);
  };

  const navItems: Array<{ id: ActiveView; label: string; shortLabel: string }> = [
    { id: '3d', label: 'Projekt 3D', shortLabel: 'Projekt 3D' },
    { id: 'chart', label: 'Charakterystyka SPL', shortLabel: 'Wykres SPL' },
    { id: 'workbench', label: 'WSD', shortLabel: 'WSD' },
    { id: 'cutlist', label: 'Lista Cięcia', shortLabel: 'Lista Cięcia' },
    { id: 'nesting', label: 'Rozkrój Płyty', shortLabel: 'Rozkrój' },
  ];

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#0A0B0E] text-[#F4F4F5] overflow-x-clip lg:overflow-hidden">
      {/* Top Bar: single row on lg+, two compact sticky rows on mobile/tablet */}
      <header className="sticky top-0 z-30 lg:static shrink-0 bg-[#111318] border-b border-white/[0.08]">
        <div className="h-13 lg:h-14 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-6">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('3d');
            }}
            aria-label="SubLab 3D — Strona główna"
            className="flex items-center shrink-0 focus:outline-none"
          >
            <img
              src="./assets/sublab3d-logo-wide.png"
              alt="SubLab 3D — Precision Bass Management"
              className="h-7 sm:h-9 lg:h-10 w-auto object-contain select-none"
            />
          </a>

          <nav
            aria-label="Główna nawigacja widoku"
            className="hidden lg:flex items-center gap-6 overflow-x-auto"
          >
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                aria-current={activeView === item.id ? 'page' : undefined}
                className={`py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  activeView === item.id
                    ? 'text-red-400 border-red-500'
                    : 'text-zinc-400 border-transparent hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="shrink-0 flex items-center gap-2">
            <button
              type="button"
              data-testid="mobile-params-toggle"
              onClick={() => setMobileParamsOpen(true)}
              aria-expanded={mobileParamsOpen}
              className="lg:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-100 bg-[#161920] border border-white/[0.14] rounded-md hover:bg-white/[0.08] transition-colors whitespace-nowrap shrink-0"
            >
              <Sliders className="w-3.5 h-3.5 text-red-400" />
              <span>Parametry</span>
            </button>

            <button
              type="button"
              onClick={() => setShareModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="sm:hidden">Udostępnij</span>
              <span className="hidden sm:inline">Udostępnij model</span>
            </button>
          </div>
        </div>

        {/* Mobile / Tablet View Navigation Bar */}
        <nav
          aria-label="Nawigacja mobilna widoku"
          className="lg:hidden border-t border-white/[0.06] px-2 flex items-center justify-between sm:justify-start sm:gap-4 overflow-x-auto no-scrollbar"
        >
          {navItems.map((item) => (
            <button
              key={`mob-${item.id}`}
              type="button"
              onClick={() => {
                setActiveView(item.id);
                setMobileParamsOpen(false);
              }}
              aria-current={activeView === item.id ? 'page' : undefined}
              className={`py-2.5 px-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeView === item.id
                  ? 'text-red-400 border-red-500'
                  : 'text-zinc-400 border-transparent hover:text-white'
              }`}
            >
              {item.shortLabel}
            </button>
          ))}
        </nav>
      </header>

      {/* Main CAD Split Workspace */}
      <main className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Single SidebarControls instance: mobile drawer when open, below 3D viewport on <lg 3d view, or left rail on lg+ */}
        <div
          className={
            mobileParamsOpen
              ? 'fixed inset-0 z-40 flex bg-black/75 backdrop-blur-[1px] lg:static lg:inset-auto lg:z-auto lg:bg-transparent lg:backdrop-blur-none'
              : activeView === '3d'
                ? 'order-2 lg:order-1 flex shrink-0'
                : 'hidden lg:flex lg:order-1 shrink-0'
          }
          onClick={(e) => {
            if (mobileParamsOpen && e.target === e.currentTarget) {
              setMobileParamsOpen(false);
            }
          }}
        >
          <SidebarControls
            params={params}
            acoustics={acoustics}
            customDrivers={customDrivers}
            onChange={handlePatch}
            onApplyTemplate={handleApplyTemplate}
            onSaveCustomDriver={handleSaveCustomDriver}
            onDeleteCustomDriver={handleDeleteCustomDriver}
            onOpenDriverModal={openDriverModal}
            mobileDrawerOpen={mobileParamsOpen}
            onCloseMobileDrawer={() => setMobileParamsOpen(false)}
          />
        </div>

        <div className="order-1 lg:order-2 flex-1 flex flex-col min-w-0 min-h-0">
          <TelemetryStrip params={params} acoustics={acoustics} />

          {activeView === '3d' && <Viewport3D params={params} acoustics={acoustics} />}
          {activeView === 'chart' && <AcousticChart params={params} acoustics={acoustics} />}
          {activeView === 'workbench' && (
            <AcousticWorkbench
              params={params}
              customDrivers={customDrivers}
              onApplyParams={handlePatch}
              onSaveCustomDriver={handleSaveCustomDriver}
              onDeleteCustomDriver={handleDeleteCustomDriver}
              onOpenDriverModal={openDriverModal}
              onImportDrivers={(drivers) => {
                for (const d of drivers) {
                  handleSaveCustomDriver(d, false);
                }
              }}
            />
          )}
          {activeView === 'cutlist' && <CutListView params={params} summary={sheetSummary} />}
          {activeView === 'nesting' && (
            <SheetNestingView params={params} summary={sheetSummary} onChange={handlePatch} />
          )}
        </div>
      </main>

      <ShareModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        params={params}
        acoustics={acoustics}
        activeCustomDriver={activeCustomDriver}
        onImportModel={handleImportModel}
      />

      <DriverTsModal
        open={driverModalOpen}
        editingDriver={editingDriver}
        initialTemplateDriver={modalTemplateDriver}
        onClose={() => setDriverModalOpen(false)}
        onSaveDriver={(driver, applyToProjectToo, coilWiring) =>
          handleSaveCustomDriver(driver, applyToProjectToo, coilWiring)
        }
      />
    </div>
  );
}
