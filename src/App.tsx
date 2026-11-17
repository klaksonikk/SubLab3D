import { useEffect, useMemo, useState } from 'react';
import { Share2 } from 'lucide-react';
import { calculateAcoustics } from './engine/acoustics';
import { generateCutList, optimizeCutSheet } from './engine/cutlist';
import { BOX_TEMPLATE_PRESETS, DEFAULT_BOX_PARAMS } from './engine/presets';
import { decodeModelToken } from './engine/sharing';
import type { BoxParams, DriverPreset } from './engine/types';
import { SidebarControls } from './components/SidebarControls';
import { TelemetryStrip } from './components/TelemetryStrip';
import { Viewport3D } from './components/Viewport3D';
import { AcousticChart } from './components/AcousticChart';
import { CutListView } from './components/CutListView';
import { SheetNestingView } from './components/SheetNestingView';
import { AcousticWorkbench } from './components/AcousticWorkbench';
import { ShareModal } from './components/ShareModal';

type ActiveView = '3d' | 'chart' | 'workbench' | 'cutlist' | 'nesting';

const STORAGE_KEY = 'subbox_cad_project_v1';
const CUSTOM_DRIVERS_KEY = 'subbox_cad_custom_drivers_v1';

function loadCustomDrivers(): DriverPreset[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_DRIVERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DriverPreset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadInitialState(): { params: BoxParams; sharedDriver?: DriverPreset } {
  try {
    const query = new URLSearchParams(window.location.search);
    const modelToken = query.get('model');
    if (modelToken) {
      const decoded = decodeModelToken(modelToken);
      if (decoded) {
        return { params: decoded.params, sharedDriver: decoded.customDriver };
      }
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { params: DEFAULT_BOX_PARAMS };
    const parsed = JSON.parse(raw) as Partial<BoxParams>;
    return { params: { ...DEFAULT_BOX_PARAMS, ...parsed } };
  } catch {
    return { params: DEFAULT_BOX_PARAMS };
  }
}

export default function App() {
  const initial = useMemo(() => loadInitialState(), []);
  const [params, setParams] = useState<BoxParams>(initial.params);
  const [customDrivers, setCustomDrivers] = useState<DriverPreset[]>(() => {
    const existing = loadCustomDrivers();
    if (
      initial.sharedDriver &&
      !existing.some((d) => d.id === initial.sharedDriver!.id)
    ) {
      return [...existing, { ...initial.sharedDriver, isCustom: true }];
    }
    return existing;
  });
  const [activeView, setActiveView] = useState<ActiveView>('3d');
  const [shareModalOpen, setShareModalOpen] = useState(false);

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

  const activeCustomDriver = useMemo(
    () => customDrivers.find((d) => d.id === params.driverPresetId),
    [customDrivers, params.driverPresetId],
  );

  const handlePatch = (patch: Partial<BoxParams>) => {
    setParams((prev) => ({ ...prev, ...patch }));
  };

  const handleApplyTemplate = (templateId: string) => {
    const tpl = BOX_TEMPLATE_PRESETS.find((t) => t.id === templateId);
    if (!tpl) return;
    setParams({ ...DEFAULT_BOX_PARAMS, ...tpl.params });
  };

  const handleSaveCustomDriver = (driver: DriverPreset) => {
    setCustomDrivers((prev) => {
      const idx = prev.findIndex((d) => d.id === driver.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...driver, isCustom: true };
        return next;
      }
      return [...prev, { ...driver, isCustom: true }];
    });
  };

  const handleDeleteCustomDriver = (driverId: string) => {
    setCustomDrivers((prev) => prev.filter((d) => d.id !== driverId));
  };

  const handleImportModel = (importedParams: BoxParams, customDriver?: DriverPreset) => {
    if (customDriver) {
      handleSaveCustomDriver(customDriver);
    }
    setParams(importedParams);
  };

  const navItems: Array<{ id: ActiveView; label: string }> = [
    { id: '3d', label: 'Projekt 3D' },
    { id: 'chart', label: 'Charakterystyka SPL' },
    { id: 'workbench', label: 'WSD' },
    { id: 'cutlist', label: 'Lista Cięcia' },
    { id: 'nesting', label: 'Rozkrój Płyty' },
  ];

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#0A0B0E] text-[#F4F4F5] overflow-x-hidden lg:overflow-hidden">
      {/* Top Bar Contract: 3 zones */}
      <header className="h-14 shrink-0 bg-[#111318] border-b border-white/[0.08] px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('3d');
          }}
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          SubLab <span className="text-red-500">3D</span>
        </a>

        <nav aria-label="Główna nawigacja widoku" className="flex items-center gap-4 sm:gap-6 overflow-x-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              aria-current={activeView === item.id ? 'page' : undefined}
              className={`py-1 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeView === item.id
                  ? 'text-red-400 border-red-500'
                  : 'text-zinc-400 border-transparent hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="shrink-0 flex items-center">
          <button
            type="button"
            onClick={() => setShareModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Udostępnij model</span>
          </button>
        </div>
      </header>

      {/* Main CAD Split Workspace */}
      <main className="flex-1 flex flex-col lg:flex-row min-h-0">
        <SidebarControls
          params={params}
          acoustics={acoustics}
          customDrivers={customDrivers}
          onChange={handlePatch}
          onApplyTemplate={handleApplyTemplate}
          onSaveCustomDriver={handleSaveCustomDriver}
          onDeleteCustomDriver={handleDeleteCustomDriver}
        />

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <TelemetryStrip params={params} acoustics={acoustics} />

          {activeView === '3d' && <Viewport3D params={params} acoustics={acoustics} />}
          {activeView === 'chart' && <AcousticChart params={params} acoustics={acoustics} />}
          {activeView === 'workbench' && (
            <AcousticWorkbench
              params={params}
              customDrivers={customDrivers}
              onApplyParams={handlePatch}
              onSaveCustomDriver={(driver, applyToProjectToo) => {
                handleSaveCustomDriver(driver);
                if (applyToProjectToo) {
                  handlePatch({
                    driverPresetId: driver.id,
                    driverName: driver.name,
                    driverCutoutDia: driver.cutoutDia,
                    driverOuterDia: driver.outerDia,
                    driverDepth: driver.depth,
                    driverDisplacement: driver.displacement,
                    driverFs: driver.fs,
                    driverQts: driver.qts,
                    driverVas: driver.vas,
                    driverXmax: driver.xmax,
                    driverPowerW: driver.powerW,
                  });
                }
              }}
              onDeleteCustomDriver={handleDeleteCustomDriver}
              onImportDrivers={(drivers) => {
                for (const d of drivers) {
                  handleSaveCustomDriver(d);
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
    </div>
  );
}
