import { useEffect, useMemo, useState } from 'react';
import { FolderPlus, Share2, Sliders } from 'lucide-react';
import { calculateAcoustics } from './engine/acoustics';
import { generateCutList, optimizeCutSheet } from './engine/cutlist';
import {
  BOX_TEMPLATE_PRESETS,
  DEFAULT_BOX_PARAMS,
  DRIVER_PRESETS,
} from './engine/presets';
import { decodeModelToken } from './engine/sharing';
import type { BoxParams, BoxTemplatePreset, CoilWiringMode, DriverPreset } from './engine/types';
import { SidebarControls } from './components/SidebarControls';
import { TelemetryStrip } from './components/TelemetryStrip';
import { Viewport3D } from './components/Viewport3D';
import { AcousticChart } from './components/AcousticChart';
import { CutListView } from './components/CutListView';
import { SheetNestingView } from './components/SheetNestingView';
import { AcousticWorkbench } from './components/AcousticWorkbench';
import { ShareModal } from './components/ShareModal';
import { DriverTsModal } from './components/DriverTsModal';
import { NewProjectWizardModal } from './components/NewProjectWizardModal';
import { useI18n } from './i18n';

type ActiveView = '3d' | 'chart' | 'workbench' | 'cutlist' | 'nesting';

const STORAGE_KEY = 'subbox_cad_project_v1';
const CUSTOM_DRIVERS_KEY = 'subbox_cad_custom_drivers_v1';
const CUSTOM_TEMPLATES_KEY = 'subbox_cad_custom_templates_v1';
const ACTIVE_TEMPLATE_KEY = 'subbox_cad_active_template_v1';

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

function loadCustomTemplates(): BoxTemplatePreset[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is BoxTemplatePreset =>
        Boolean(t) &&
        typeof t === 'object' &&
        typeof (t as BoxTemplatePreset).id === 'string' &&
        typeof (t as BoxTemplatePreset).name === 'string' &&
        Boolean((t as BoxTemplatePreset).params) &&
        typeof (t as BoxTemplatePreset).params === 'object',
    );
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
  customTemplates: BoxTemplatePreset[];
  activeTemplateId: string;
} {
  let drivers = loadCustomDrivers();
  const templates = loadCustomTemplates();
  const knownIds = new Set([...templates, ...BOX_TEMPLATE_PRESETS].map((t) => t.id));
  let storedTemplateId = 'daily-12-slot';
  try {
    const savedId = window.localStorage.getItem(ACTIVE_TEMPLATE_KEY);
    if (savedId && (savedId === '__custom__' || knownIds.has(savedId))) {
      storedTemplateId = savedId;
    }
  } catch {
    // Ignore storage read errors
  }

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
          customTemplates: templates,
          activeTemplateId: '__custom__',
        };
      }
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        params: DEFAULT_BOX_PARAMS,
        customDrivers: drivers,
        customTemplates: templates,
        activeTemplateId: 'daily-12-slot',
      };
    }
    const parsed = JSON.parse(raw) as Partial<BoxParams>;
    return {
      params: migrateBoxParams(parsed, drivers),
      customDrivers: drivers,
      customTemplates: templates,
      activeTemplateId: storedTemplateId,
    };
  } catch {
    return {
      params: DEFAULT_BOX_PARAMS,
      customDrivers: drivers,
      customTemplates: templates,
      activeTemplateId: 'daily-12-slot',
    };
  }
}

export default function App() {
  const { lang, setLang, unitSystem, setUnitSystem } = useI18n();
  const isEn = lang === 'en';
  const initial = useMemo(() => loadInitialState(), []);
  const [params, setParams] = useState<BoxParams>(initial.params);
  const [customDrivers, setCustomDrivers] = useState<DriverPreset[]>(initial.customDrivers);
  const [customTemplates, setCustomTemplates] = useState<BoxTemplatePreset[]>(initial.customTemplates);
  const [activeTemplateId, setActiveTemplateId] = useState<string>(initial.activeTemplateId);
  const [activeView, setActiveView] = useState<ActiveView>('3d');
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mobileParamsOpen, setMobileParamsOpen] = useState(false);

  // Shared Driver T-S Modal accessible from Sidebar, WSD, and New Project Wizard
  const [driverModalOpen, setDriverModalOpen] = useState(false);
  const [driverModalSource, setDriverModalSource] = useState<'app' | 'wizard'>('app');
  const [editingDriver, setEditingDriver] = useState<DriverPreset | null>(null);
  const [modalTemplateDriver, setModalTemplateDriver] = useState<DriverPreset>(DRIVER_PRESETS[0]);
  const [wizardDriverOverride, setWizardDriverOverride] = useState<{
    driverId: string;
    coilWiring?: CoilWiringMode;
    seq: number;
  } | null>(null);

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

  useEffect(() => {
    try {
      window.localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(customTemplates));
    } catch {
      // Ignore storage quota errors
    }
  }, [customTemplates]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_TEMPLATE_KEY, activeTemplateId);
    } catch {
      // Ignore storage quota errors
    }
  }, [activeTemplateId]);

  const acoustics = useMemo(
    () => calculateAcoustics(params, lang, unitSystem),
    [params, lang, unitSystem],
  );
  const cutPanels = useMemo(
    () => generateCutList(params, acoustics, lang, unitSystem),
    [params, acoustics, lang, unitSystem],
  );
  const sheetSummary = useMemo(
    () => optimizeCutSheet(params, cutPanels, lang),
    [params, cutPanels, lang],
  );

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
    const tpl = [...customTemplates, ...BOX_TEMPLATE_PRESETS].find((t) => t.id === templateId);
    if (!tpl) return;
    setActiveTemplateId(tpl.id);
    setParams(migrateBoxParams(tpl.params, customDrivers));
  };

  const handleDeleteCustomTemplate = (templateId: string) => {
    setCustomTemplates((prev) => prev.filter((t) => t.id !== templateId));
    if (activeTemplateId === templateId) {
      setActiveTemplateId('__custom__');
    }
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
    setActiveTemplateId('__custom__');
    setParams(migrateBoxParams(importedParams, nextDrivers));
  };

  const openDriverModal = (
    editTarget: DriverPreset | null,
    template?: DriverPreset,
    source: 'app' | 'wizard' = 'app',
  ) => {
    setDriverModalSource(source);
    setEditingDriver(editTarget);
    setModalTemplateDriver(template ?? activeDriverPreset);
    setDriverModalOpen(true);
  };

  const navItems: Array<{ id: ActiveView; label: string; shortLabel: string }> = isEn
    ? [
        { id: '3d', label: '3D Project', shortLabel: '3D View' },
        { id: 'chart', label: 'SPL Response', shortLabel: 'SPL Chart' },
        { id: 'workbench', label: 'WSD', shortLabel: 'WSD' },
        { id: 'cutlist', label: 'Cut-List', shortLabel: 'Cut-List' },
        { id: 'nesting', label: 'Sheet Nesting', shortLabel: 'Nesting' },
      ]
    : [
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
        <div className="h-12 sm:h-14 px-2 sm:px-6 flex items-center justify-between gap-1 sm:gap-5">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('3d');
            }}
            aria-label={isEn ? 'SubLab 3D — Home' : 'SubLab 3D — Strona główna'}
            className="flex items-center shrink-0 focus:outline-none"
          >
            <img
              src="./assets/sublab3d-logo-wide.png"
              alt="SubLab 3D — Precision Bass Management"
              className="h-4 sm:h-9 lg:h-10 w-auto object-contain select-none"
            />
          </a>

          <nav
            aria-label={isEn ? 'Main view navigation' : 'Główna nawigacja widoku'}
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

          <div className="shrink-0 flex items-center gap-1 sm:gap-2">
            {/* Unit System Switcher Metric | Imperial */}
            <div
              role="group"
              aria-label={isEn ? 'Measurement units' : 'Jednostki miary'}
              className="inline-flex items-center bg-[#0A0B0E] border border-white/[0.14] rounded-md p-0.5 shrink-0"
            >
              <button
                type="button"
                data-testid="unit-btn-metric"
                onClick={() => setUnitSystem('metric')}
                aria-pressed={unitSystem === 'metric'}
                title={isEn ? 'Metric units (mm, L, cm²)' : 'Jednostki metryczne (mm, L, cm²)'}
                className={`px-1 sm:px-2 py-1 text-[10px] sm:text-[11px] font-semibold rounded transition-colors ${
                  unitSystem === 'metric'
                    ? 'bg-red-600 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <span className="md:hidden">MM</span>
                <span className="hidden md:inline">{isEn ? 'Metric' : 'Metr.'}</span>
              </button>
              <button
                type="button"
                data-testid="unit-btn-imperial"
                onClick={() => setUnitSystem('imperial')}
                aria-pressed={unitSystem === 'imperial'}
                title={isEn ? 'Imperial units (in, ft³, in²)' : 'Jednostki imperialne (in, ft³, in²)'}
                className={`px-1 sm:px-2 py-1 text-[10px] sm:text-[11px] font-semibold rounded transition-colors ${
                  unitSystem === 'imperial'
                    ? 'bg-red-600 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <span className="md:hidden">IN</span>
                <span className="hidden md:inline">Imperial</span>
              </button>
            </div>

            {/* Language Switcher PL | EN */}
            <div
              role="group"
              aria-label={isEn ? 'Interface language' : 'Język interfejsu'}
              className="inline-flex items-center bg-[#0A0B0E] border border-white/[0.14] rounded-md p-0.5 shrink-0"
            >
              <button
                type="button"
                data-testid="lang-btn-pl"
                onClick={() => setLang('pl')}
                aria-pressed={lang === 'pl'}
                className={`px-1 sm:px-2 py-1 text-[10px] sm:text-[11px] font-semibold rounded transition-colors ${
                  lang === 'pl'
                    ? 'bg-red-600 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                PL
              </button>
              <button
                type="button"
                data-testid="lang-btn-en"
                onClick={() => setLang('en')}
                aria-pressed={lang === 'en'}
                className={`px-1 sm:px-2 py-1 text-[10px] sm:text-[11px] font-semibold rounded transition-colors ${
                  lang === 'en'
                    ? 'bg-red-600 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                EN
              </button>
            </div>

            <button
              type="button"
              data-testid="new-project-btn"
              onClick={() => {
                setMobileParamsOpen(false);
                setWizardOpen(true);
              }}
              className="inline-flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-3 py-1 sm:py-2 text-[10px] sm:text-xs font-semibold text-white bg-[#161920] border border-white/[0.16] rounded-md hover:border-red-500/60 hover:bg-white/[0.08] transition-colors whitespace-nowrap shrink-0"
            >
              <FolderPlus className="w-3.5 h-3.5 text-red-400" />
              <span className="sm:hidden">{isEn ? 'New' : 'Nowy'}</span>
              <span className="hidden sm:inline">{isEn ? 'New Project' : 'Nowy projekt'}</span>
            </button>

            <button
              type="button"
              data-testid="mobile-params-toggle"
              onClick={() => setMobileParamsOpen(true)}
              aria-expanded={mobileParamsOpen}
              className="lg:hidden inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-zinc-100 bg-[#161920] border border-white/[0.14] rounded-md hover:bg-white/[0.08] transition-colors whitespace-nowrap shrink-0"
            >
              <Sliders className="w-3.5 h-3.5 text-red-400" />
              <span className="sm:hidden">{isEn ? 'Edit' : 'Opcje'}</span>
              <span className="hidden sm:inline">{isEn ? 'Params' : 'Parametry'}</span>
            </button>

            <button
              type="button"
              data-testid="share-model-btn"
              aria-label={isEn ? 'Share model' : 'Udostępnij model'}
              onClick={() => setShareModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-2 sm:px-4 py-1 sm:py-2 text-[10px] sm:text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isEn ? 'Share model' : 'Udostępnij model'}</span>
            </button>
          </div>
        </div>

        {/* Mobile / Tablet View Navigation Bar */}
        <nav
          aria-label={isEn ? 'Mobile view navigation' : 'Nawigacja mobilna widoku'}
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
            customTemplates={customTemplates}
            activeTemplateId={activeTemplateId}
            onChange={handlePatch}
            onApplyTemplate={handleApplyTemplate}
            onDeleteCustomTemplate={handleDeleteCustomTemplate}
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

      <NewProjectWizardModal
        open={wizardOpen}
        allDrivers={allDrivers}
        selectedDriverOverride={wizardDriverOverride}
        onClose={() => setWizardOpen(false)}
        onOpenAddCustomDriver={(tpl) => openDriverModal(null, tpl, 'wizard')}
        onCreateProject={(newParams, templatePreset) => {
          setCustomTemplates((prev) => [
            templatePreset,
            ...prev.filter((t) => t.id !== templatePreset.id),
          ]);
          setActiveTemplateId(templatePreset.id);
          setParams({
            ...newParams,
            doubleFrontBaffle: false,
          });
          setActiveView('3d');
        }}
      />

      <DriverTsModal
        open={driverModalOpen}
        editingDriver={editingDriver}
        initialTemplateDriver={modalTemplateDriver}
        onClose={() => setDriverModalOpen(false)}
        onSaveDriver={(driver, applyToProjectToo, coilWiring) => {
          if (driverModalSource === 'wizard') {
            handleSaveCustomDriver(driver, false, coilWiring);
            setWizardDriverOverride({
              driverId: driver.id,
              coilWiring,
              seq: Date.now(),
            });
          } else {
            handleSaveCustomDriver(driver, applyToProjectToo, coilWiring);
          }
        }}
      />
    </div>
  );
}
