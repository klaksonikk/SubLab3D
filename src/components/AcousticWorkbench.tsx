import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Copy,
  Database,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Gauge,
  Plus,
  RotateCcw,
  Search,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  computeDerivedDriverMetrics,
  computeDriverAlignments,
  computePortPhysicalStats,
  createLiveProjectVariant,
  simulateEnclosureSeries,
  type AcousticEnvironment,
  type ComparisonVariant,
  type DriverWiringType,
  type FilterSlopeType,
  type SignalChainConfig,
  type SimCurvePoint,
  type SimulatedSeries,
} from '../engine/simulator';
import { DRIVER_PRESETS } from '../engine/presets';
import {
  computeElectricalLoad,
  dbfsToLinearGain,
  driverPresetToSolverInput,
  solveThieleSmall,
} from '../engine/tsSolver';
import type {
  BoxParams,
  CoilWiringMode,
  DriverPreset,
  EnclosureType,
  VoiceCoilCount,
} from '../engine/types';
import { ImmediateNumberInput } from './ImmediateNumberInput';

export type WorkbenchPlotMode =
  | 'transferBox'
  | 'phaseBox'
  | 'groupDelayBox'
  | 'maxPower'
  | 'maxSpl'
  | 'apparentLoadVa'
  | 'spl'
  | 'excursion'
  | 'impedance'
  | 'impedancePhase'
  | 'velocity'
  | 'frontPortGain'
  | 'rearPortVelocity'
  | 'rearPortGain'
  | 'transfer'
  | 'phase'
  | 'groupDelay';

type ProjectEditorTab =
  | 'driver'
  | 'box'
  | 'vents'
  | 'filters'
  | 'signal'
  | 'advanced'
  | 'project';

interface AcousticWorkbenchProps {
  params: BoxParams;
  customDrivers?: DriverPreset[];
  onApplyParams: (patch: Partial<BoxParams>) => void;
  onSaveCustomDriver?: (
    driver: DriverPreset,
    applyToProjectToo?: boolean,
    coilWiring?: CoilWiringMode,
  ) => void;
  onDeleteCustomDriver?: (driverId: string) => void;
  onOpenDriverModal?: (editTarget: DriverPreset | null, template?: DriverPreset) => void;
  onImportDrivers?: (drivers: DriverPreset[]) => void;
}

const WSD_VARIANTS_STORAGE_KEY = 'subbox_cad_wsd_variants_v1';
const WSD_SIGNAL_STORAGE_KEY = 'subbox_cad_wsd_signal_v1';
const VARIANT_PALETTE = ['#38bdf8', '#10b981', '#f59e0b', '#a78bfa'];

const PLOT_MODES: Array<{
  id: WorkbenchPlotMode;
  label: string;
  unit: string;
  group: string;
  quick?: boolean;
}> = [
  { id: 'transfer', label: 'Charakterystyka (EQ/Filtry)', unit: 'dB', group: 'EQ / Filtry', quick: true },
  { id: 'spl', label: 'SPL (dB)', unit: 'dB', group: 'Moc i Poziom', quick: true },
  { id: 'maxSpl', label: 'Max SPL (Xmax/RMS)', unit: 'dB', group: 'Moc i Poziom', quick: true },
  { id: 'excursion', label: 'Wychył membrany (mm)', unit: 'mm', group: 'Przetwornik', quick: true },
  { id: 'velocity', label: 'Port przedni — prędkość (m/s)', unit: 'm/s', group: 'Porty', quick: true },
  { id: 'impedance', label: 'Impedancja (Ω)', unit: 'Ω', group: 'Przetwornik', quick: true },
  { id: 'transferBox', label: 'Charakterystyka obudowy (bez EQ)', unit: 'dB', group: 'Obudowa' },
  { id: 'phaseBox', label: 'Faza obudowy (°)', unit: '°', group: 'Obudowa' },
  { id: 'groupDelayBox', label: 'Group Delay obudowy (ms)', unit: 'ms', group: 'Obudowa' },
  { id: 'maxPower', label: 'Maksymalna moc (Xmax/Pe)', unit: 'W', group: 'Moc i Poziom' },
  { id: 'apparentLoadVa', label: 'Moc pozorna obciążenia (VA)', unit: 'VA', group: 'Moc i Poziom' },
  { id: 'impedancePhase', label: 'Faza impedancji (°)', unit: '°', group: 'Przetwornik' },
  { id: 'frontPortGain', label: 'Port przedni — wzmocnienie (dB)', unit: 'dB', group: 'Porty' },
  { id: 'rearPortVelocity', label: 'Port tylny BP6 — prędkość (m/s)', unit: 'm/s', group: 'Porty' },
  { id: 'rearPortGain', label: 'Port tylny BP6 — wzmocnienie (dB)', unit: 'dB', group: 'Porty' },
  { id: 'phase', label: 'Faza (EQ/Filtry) (°)', unit: '°', group: 'EQ / Filtry' },
  { id: 'groupDelay', label: 'Group Delay (EQ/Filtry) (ms)', unit: 'ms', group: 'EQ / Filtry' },
];

const PROJECT_TABS: Array<{ id: ProjectEditorTab; label: string }> = [
  { id: 'driver', label: 'Głośnik' },
  { id: 'box', label: 'Obudowa' },
  { id: 'vents', label: 'Porty' },
  { id: 'filters', label: 'Filtry / EQ' },
  { id: 'signal', label: 'Sygnał' },
  { id: 'advanced', label: 'Zaawansowane' },
  { id: 'project', label: 'Projekt' },
];

const FILTER_OPTIONS: Array<{ id: FilterSlopeType; label: string }> = [
  { id: 'none', label: 'Wył.' },
  { id: 'bw12', label: 'BW 12 dB' },
  { id: 'bw24', label: 'BW 24 dB' },
  { id: 'lr24', label: 'LR 24 dB' },
  { id: 'cheb12', label: 'Cheb 12 dB' },
  { id: 'cheb24', label: 'Cheb 24 dB' },
];

const ENV_OPTIONS: Array<{ id: AcousticEnvironment; label: string }> = [
  { id: 'free_4pi', label: '4π (Free)' },
  { id: 'half_2pi', label: '2π (+3 dB)' },
  { id: 'quarter_pi', label: 'π (+6 dB)' },
  { id: 'cabin', label: 'Kabina auta' },
];

const ENCLOSURE_LABELS: Array<{ id: EnclosureType; label: string }> = [
  { id: 'sealed', label: 'Zamknięta' },
  { id: 'vented_slot', label: 'Bass-Reflex (Szczelin.)' },
  { id: 'vented_round', label: 'Bass-Reflex (Aero)' },
  { id: 'bandpass_4th', label: 'Bandpass 4-rz.' },
  { id: 'bandpass_6th', label: 'Bandpass 6-rz.' },
];

const GEN_FREQ_PRESETS = [20, 25, 30, 35, 40, 45, 50];
const GEN_DBFS_PRESETS = [0, -3, -6, -12, -20, -30];

function presetToBoxAndCoilPatch(drv: DriverPreset): Partial<BoxParams> {
  const voiceCoilCount: VoiceCoilCount = drv.voiceCoilCount === 2 ? 2 : 1;
  const coilNominalOhms =
    drv.coilNominalOhms ?? (voiceCoilCount === 2 ? (drv.zNom ?? 4) / 2 : drv.zNom ?? 4);
  const coilReOhms =
    drv.coilReOhms ??
    (voiceCoilCount === 2 ? (drv.re ?? coilNominalOhms * 1.6) / 2 : drv.re ?? 3.2);
  const coilWiring: CoilWiringMode = voiceCoilCount === 2 ? 'series' : 'single';
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

function getPointValue(pt: SimCurvePoint, mode: WorkbenchPlotMode): number {
  switch (mode) {
    case 'transfer':
      return pt.transferDb;
    case 'transferBox':
      return pt.transferBoxDb;
    case 'spl':
      return pt.splDb;
    case 'maxSpl':
      return pt.maxSplDb;
    case 'maxPower':
      return pt.maxPowerW;
    case 'apparentLoadVa':
      return pt.apparentLoadVa;
    case 'excursion':
      return pt.excursionMm;
    case 'velocity':
      return pt.portVelocityMs;
    case 'frontPortGain':
      return pt.frontPortGainDb;
    case 'rearPortVelocity':
      return pt.rearPortVelocityMs;
    case 'rearPortGain':
      return pt.rearPortGainDb;
    case 'groupDelay':
      return pt.groupDelayMs;
    case 'groupDelayBox':
      return pt.groupDelayBoxMs;
    case 'phase':
      return pt.phaseDeg;
    case 'phaseBox':
      return pt.phaseBoxDeg;
    case 'impedance':
      return pt.impedanceOhms;
    case 'impedancePhase':
      return pt.impedancePhaseDeg;
  }
}

function loadSavedVariants(params: BoxParams, knownDrivers: DriverPreset[]): ComparisonVariant[] {
  const knownIds = new Set(knownDrivers.map((d) => d.id));
  try {
    const raw = window.localStorage.getItem(WSD_VARIANTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ComparisonVariant[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(0, 3).map((v) => ({
          ...v,
          driverPresetId:
            v.driverPresetId && knownIds.has(v.driverPresetId)
              ? v.driverPresetId
              : DRIVER_PRESETS[0].id,
        }));
      }
    }
  } catch {
    // Ignore malformed storage
  }
  return [
    {
      id: 'cmp-sealed-ref',
      name: 'Wariant B: Zamknięta referencyjna',
      color: VARIANT_PALETTE[0],
      visible: true,
      enclosureType: 'sealed',
      netVolumeL: Math.max(15, Math.round(params.driverVas * params.driverCount * 0.65)),
      tuningHz: 35,
      portAreaCm2: 0,
      driverPresetId: params.driverPresetId,
      driverCount: params.driverCount,
      voiceCoilCount: params.driverVoiceCoilCount,
      coilNominalOhms: params.driverCoilNominalOhms,
      coilReOhms: params.driverCoilReOhms,
      coilWiring: params.driverCoilWiring,
      wiring: params.driverArrayWiring,
      isobaric: false,
      ql: 7,
      qa: 18,
      voiceCoilTempRiseC: 0,
      voiceCoilTempCoeff: 3.9,
      addedMassG: 0,
    },
  ];
}

function loadSavedSignal(defaultPower: number): SignalChainConfig {
  const defaults: SignalChainConfig = {
    powerW: defaultPower,
    reOhms: 2.0,
    leMh: 1.4,
    seriesResistanceOhms: 0.1,
    environment: 'free_4pi',
    hpfType: 'none',
    hpfHz: 26,
    lpfType: 'lr24',
    lpfHz: 85,
    cabinGain: false,
    peqEnabled: false,
    peqHz: 40,
    peqGainDb: 3.0,
    peqQ: 2.0,
    ltEnabled: false,
    ltF0Hz: 46,
    ltQ0: 0.85,
    ltFpHz: 28,
    ltQp: 0.707,
    airDensityKgM3: 1.204,
    speedOfSoundMs: 343.2,
  };
  try {
    const raw = window.localStorage.getItem(WSD_SIGNAL_STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<SignalChainConfig>) };
  } catch {
    return defaults;
  }
}

export function AcousticWorkbench({
  params,
  customDrivers = [],
  onApplyParams,
  onDeleteCustomDriver,
  onOpenDriverModal,
  onImportDrivers,
}: AcousticWorkbenchProps) {
  const [plotMode, setPlotMode] = useState<WorkbenchPlotMode>('transfer');
  const [maxFreqHz, setMaxFreqHz] = useState<200 | 500>(200);
  const [activeProjectTab, setActiveProjectTab] = useState<ProjectEditorTab>('driver');
  const [selectedVariantId, setSelectedVariantId] = useState<string>('live-project');
  const [showPhaseOverlay, setShowPhaseOverlay] = useState(true);
  const [hoverHz, setHoverHz] = useState<number | null>(null);
  const [liveVisible, setLiveVisible] = useState(true);
  const [liveOverrides, setLiveOverrides] = useState<{
    isobaric: boolean;
    ql: number;
    qa: number;
    voiceCoilTempRiseC: number;
    voiceCoilTempCoeff: number;
    addedMassG: number;
    portEndFlared?: boolean;
  }>({
    isobaric: false,
    ql: 7,
    qa: 100,
    voiceCoilTempRiseC: 0,
    voiceCoilTempCoeff: 3.9,
    addedMassG: 0,
  });

  // Offline Sine Signal Generator (0 dBFS down to -60 dBFS, Web Audio API)
  const [genEnabled, setGenEnabled] = useState(false);
  const [genHz, setGenHz] = useState(35);
  const [genLevelDbfs, setGenLevelDbfs] = useState(0);
  const [driverCatalogOpen, setDriverCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogSizeFilter, setCatalogSizeFilter] = useState<'all' | '8"' | '10"' | '12"' | '15"' | '18"'>('all');
  const [catalogDriverId, setCatalogDriverId] = useState<string>(() => params.driverPresetId);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!genEnabled) {
      if (oscRef.current) {
        try {
          oscRef.current.stop();
          oscRef.current.disconnect();
        } catch {
          // ignore
        }
        oscRef.current = null;
      }
      gainRef.current = null;
      return;
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioCtx();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(Math.max(12, Math.min(500, genHz)), ctx.currentTime);
    g.gain.setValueAtTime(dbfsToLinearGain(genLevelDbfs), ctx.currentTime);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    oscRef.current = osc;
    gainRef.current = g;

    return () => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // ignore
      }
      oscRef.current = null;
      gainRef.current = null;
    };
  }, [genEnabled]);

  useEffect(() => {
    if (oscRef.current && audioCtxRef.current) {
      oscRef.current.frequency.setValueAtTime(
        Math.max(12, Math.min(500, genHz)),
        audioCtxRef.current.currentTime,
      );
    }
  }, [genHz]);

  useEffect(() => {
    if (gainRef.current && audioCtxRef.current) {
      gainRef.current.gain.setTargetAtTime(
        dbfsToLinearGain(genLevelDbfs),
        audioCtxRef.current.currentTime,
        0.015,
      );
    }
  }, [genLevelDbfs]);

  const allDrivers = useMemo(
    () => [...DRIVER_PRESETS, ...customDrivers],
    [customDrivers],
  );

  const defaultPower = params.driverPowerW * params.driverCount;
  const [signal, setSignal] = useState<SignalChainConfig>(() => loadSavedSignal(defaultPower));

  useEffect(() => {
    setSignal((prev) => ({ ...prev, powerW: params.driverPowerW * params.driverCount }));
  }, [params.driverPowerW, params.driverCount]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WSD_SIGNAL_STORAGE_KEY, JSON.stringify(signal));
    } catch {
      // ignore
    }
  }, [signal]);

  const [customVariants, setCustomVariants] = useState<ComparisonVariant[]>(() =>
    loadSavedVariants(params, allDrivers),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(WSD_VARIANTS_STORAGE_KEY, JSON.stringify(customVariants));
    } catch {
      // ignore
    }
  }, [customVariants]);

  const liveVariant = useMemo<ComparisonVariant>(
    () => ({
      ...createLiveProjectVariant(params),
      visible: liveVisible,
      ...liveOverrides,
    }),
    [params, liveVisible, liveOverrides],
  );

  const allVariants = useMemo(
    () => [liveVariant, ...customVariants],
    [liveVariant, customVariants],
  );

  const selectedVariant = useMemo(
    () => allVariants.find((v) => v.id === selectedVariantId) ?? liveVariant,
    [allVariants, selectedVariantId, liveVariant],
  );

  const visibleVariants = useMemo(
    () => allVariants.filter((v) => v.visible),
    [allVariants],
  );

  const seriesList = useMemo<SimulatedSeries[]>(
    () =>
      visibleVariants.map((v) =>
        simulateEnclosureSeries(v, params, signal, allDrivers, maxFreqHz),
      ),
    [visibleVariants, params, signal, allDrivers, maxFreqHz],
  );

  const inspectedDriverPreset = useMemo(() => {
    const targetId = selectedVariant.driverPresetId ?? params.driverPresetId;
    return allDrivers.find((d) => d.id === targetId) ?? DRIVER_PRESETS[0];
  }, [allDrivers, selectedVariant.driverPresetId, params.driverPresetId]);

  const openDriverCatalog = (targetId?: string) => {
    setCatalogDriverId(targetId ?? inspectedDriverPreset.id);
    setDriverCatalogOpen(true);
  };

  const filteredCatalogDrivers = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    return allDrivers.filter((d) => {
      if (catalogSizeFilter !== 'all' && !d.sizeLabel.includes(catalogSizeFilter)) {
        return false;
      }
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        (d.source ?? '').toLowerCase().includes(q) ||
        d.sizeLabel.toLowerCase().includes(q)
      );
    });
  }, [allDrivers, catalogQuery, catalogSizeFilter]);

  const selectedCatalogDriver = useMemo(
    () =>
      allDrivers.find((d) => d.id === catalogDriverId) ??
      filteredCatalogDrivers[0] ??
      inspectedDriverPreset,
    [allDrivers, catalogDriverId, filteredCatalogDrivers, inspectedDriverPreset],
  );

  const solvedCatalogDriver = useMemo(
    () => solveThieleSmall(driverPresetToSolverInput(selectedCatalogDriver)),
    [selectedCatalogDriver],
  );

  const selectedElecLoad = useMemo(() => {
    const isLiveSameDriver =
      selectedVariant.isLiveProject || selectedVariant.driverPresetId === params.driverPresetId;
    const vcCount: VoiceCoilCount =
      selectedVariant.voiceCoilCount ??
      (isLiveSameDriver ? params.driverVoiceCoilCount : inspectedDriverPreset.voiceCoilCount) ??
      1;
    const coilZ =
      selectedVariant.coilNominalOhms ??
      (isLiveSameDriver ? params.driverCoilNominalOhms : inspectedDriverPreset.coilNominalOhms) ??
      4;
    const coilRe =
      selectedVariant.coilReOhms ??
      (isLiveSameDriver ? params.driverCoilReOhms : inspectedDriverPreset.coilReOhms) ??
      3.2;
    const baseLe =
      (isLiveSameDriver ? params.driverCoilLeMh : inspectedDriverPreset.le) ??
      inspectedDriverPreset.le ??
      1.4;
    const coilWiring: CoilWiringMode =
      vcCount === 2
        ? (selectedVariant.coilWiring ??
            (isLiveSameDriver ? params.driverCoilWiring : 'parallel')) === 'series'
          ? 'series'
          : 'parallel'
        : 'single';
    const drvCount = selectedVariant.driverCount ?? params.driverCount;
    const arrayWiring: DriverWiringType =
      selectedVariant.wiring ?? (selectedVariant.isLiveProject ? params.driverArrayWiring : 'parallel');

    return computeElectricalLoad({
      voiceCoilCount: vcCount,
      coilNominalOhms: coilZ,
      coilReOhms: coilRe,
      baseLeMh: baseLe,
      coilWiring,
      driverCount: drvCount,
      arrayWiring,
    });
  }, [selectedVariant, params, inspectedDriverPreset]);

  const derivedDriver = useMemo(() => {
    const isLive = selectedVariant.isLiveProject;
    const syntheticParams: BoxParams = {
      ...params,
      driverCount: selectedVariant.driverCount ?? params.driverCount,
      driverCutoutDia: isLive ? params.driverCutoutDia : inspectedDriverPreset.cutoutDia,
      driverFs: isLive ? params.driverFs : inspectedDriverPreset.fs,
      driverQts: isLive ? params.driverQts : inspectedDriverPreset.qts,
      driverVas: isLive ? params.driverVas : inspectedDriverPreset.vas,
      driverXmax: isLive ? params.driverXmax : inspectedDriverPreset.xmax,
      driverPowerW: isLive ? params.driverPowerW : inspectedDriverPreset.powerW,
      driverVoiceCoilCount: selectedElecLoad.voiceCoilCount,
      driverCoilNominalOhms:
        selectedVariant.coilNominalOhms ??
        (isLive ? params.driverCoilNominalOhms : inspectedDriverPreset.coilNominalOhms) ??
        4,
      driverCoilReOhms:
        selectedVariant.coilReOhms ??
        (isLive ? params.driverCoilReOhms : inspectedDriverPreset.coilReOhms) ??
        3.2,
      driverCoilLeMh:
        (isLive ? params.driverCoilLeMh : inspectedDriverPreset.le) ?? 1.4,
      driverCoilWiring: selectedElecLoad.effectiveCoilWiring,
      driverArrayWiring: selectedVariant.wiring ?? params.driverArrayWiring,
    };
    const mergedPreset: DriverPreset = {
      ...inspectedDriverPreset,
      cutoutDia: syntheticParams.driverCutoutDia,
      fs: syntheticParams.driverFs,
      qts: syntheticParams.driverQts,
      vas: syntheticParams.driverVas,
      xmax: syntheticParams.driverXmax,
      powerW: syntheticParams.driverPowerW,
      voiceCoilCount: syntheticParams.driverVoiceCoilCount,
      coilNominalOhms: syntheticParams.driverCoilNominalOhms,
      coilReOhms: syntheticParams.driverCoilReOhms,
      le: syntheticParams.driverCoilLeMh,
    };
    return computeDerivedDriverMetrics(
      syntheticParams,
      selectedElecLoad.totalReOhms,
      mergedPreset,
      selectedElecLoad.effectiveCoilWiring,
      selectedVariant.wiring ?? params.driverArrayWiring,
    );
  }, [params, inspectedDriverPreset, selectedVariant, selectedElecLoad]);

  const alignments = useMemo(() => {
    const isLive = selectedVariant.isLiveProject;
    const alignParams: BoxParams = {
      ...params,
      driverCount: selectedVariant.driverCount ?? params.driverCount,
      driverFs: isLive ? params.driverFs : inspectedDriverPreset.fs,
      driverQts: isLive ? params.driverQts : inspectedDriverPreset.qts,
      driverVas: isLive ? params.driverVas : inspectedDriverPreset.vas,
    };
    return computeDriverAlignments(alignParams);
  }, [params, inspectedDriverPreset, selectedVariant]);

  const addCustomVariant = (preset?: Partial<ComparisonVariant>) => {
    if (customVariants.length >= 3) return;
    const nextIdx = customVariants.length;
    const color = VARIANT_PALETTE[nextIdx % VARIANT_PALETTE.length];
    const letter = ['B', 'C', 'D'][nextIdx] ?? 'X';
    const baseNet = Math.max(10, Math.round(liveVariant.netVolumeL * 10) / 10);
    const id = `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setCustomVariants((prev) => [
      ...prev,
      {
        id,
        name: preset?.name ?? `Wariant ${letter}`,
        color,
        visible: true,
        enclosureType: preset?.enclosureType ?? liveVariant.enclosureType,
        netVolumeL: preset?.netVolumeL ?? baseNet,
        tuningHz:
          preset?.tuningHz ?? Math.max(24, Math.round((liveVariant.tuningHz - 4) * 10) / 10),
        portAreaCm2:
          preset?.portAreaCm2 ?? Math.max(100, Math.round(liveVariant.portAreaCm2 || 180)),
        driverPresetId: preset?.driverPresetId ?? params.driverPresetId,
        driverCount: preset?.driverCount ?? params.driverCount,
        voiceCoilCount: preset?.voiceCoilCount ?? params.driverVoiceCoilCount,
        coilNominalOhms: preset?.coilNominalOhms ?? params.driverCoilNominalOhms,
        coilReOhms: preset?.coilReOhms ?? params.driverCoilReOhms,
        coilWiring: preset?.coilWiring ?? params.driverCoilWiring,
        wiring: preset?.wiring ?? params.driverArrayWiring,
        isobaric: preset?.isobaric ?? false,
        ql: preset?.ql ?? 7,
        qa: preset?.qa ?? 100,
        voiceCoilTempRiseC: preset?.voiceCoilTempRiseC ?? 0,
        voiceCoilTempCoeff: preset?.voiceCoilTempCoeff ?? 3.9,
        addedMassG: preset?.addedMassG ?? 0,
      },
    ]);
    setSelectedVariantId(id);
  };

  const duplicateVariant = (v: ComparisonVariant) => {
    if (customVariants.length >= 3) return;
    addCustomVariant({
      name: `${v.name.replace(/ \(kopia\)$/, '')} (kopia)`,
      enclosureType: v.enclosureType,
      netVolumeL: v.netVolumeL,
      tuningHz: v.tuningHz,
      portAreaCm2: v.portAreaCm2,
      driverPresetId: v.driverPresetId,
      driverCount: v.driverCount,
      voiceCoilCount: v.voiceCoilCount,
      coilNominalOhms: v.coilNominalOhms,
      coilReOhms: v.coilReOhms,
      coilWiring: v.coilWiring,
      wiring: v.wiring,
      isobaric: v.isobaric,
      ql: v.ql,
      qa: v.qa,
      voiceCoilTempRiseC: v.voiceCoilTempRiseC,
      voiceCoilTempCoeff: v.voiceCoilTempCoeff,
      addedMassG: v.addedMassG,
    });
  };

  const updateSelectedVariant = (patch: Partial<ComparisonVariant>) => {
    if (selectedVariant.isLiveProject) {
      const boxPatch: Partial<BoxParams> = {};
      if (patch.enclosureType) boxPatch.enclosureType = patch.enclosureType;
      if (patch.portShape === 'round' && selectedVariant.enclosureType === 'vented_slot') {
        boxPatch.enclosureType = 'vented_round';
        boxPatch.boxAutoCalcField = 'depth';
        boxPatch.targetNetVolumeL = selectedVariant.netVolumeL;
        boxPatch.portControlMode = 'tuning';
        boxPatch.targetTuningHz = selectedVariant.tuningHz;
      } else if (patch.portShape === 'slot' && selectedVariant.enclosureType === 'vented_round') {
        boxPatch.enclosureType = 'vented_slot';
        boxPatch.boxAutoCalcField = 'depth';
        boxPatch.targetNetVolumeL = selectedVariant.netVolumeL;
        boxPatch.portControlMode = 'tuning';
        boxPatch.targetTuningHz = selectedVariant.tuningHz;
      }
      if (patch.driverCount) boxPatch.driverCount = patch.driverCount;
      if (patch.driverPresetId) {
        const drv = allDrivers.find((d) => d.id === patch.driverPresetId);
        if (drv) {
          Object.assign(boxPatch, presetToBoxAndCoilPatch(drv));
        }
      }
      if (patch.voiceCoilCount !== undefined) {
        boxPatch.driverVoiceCoilCount = patch.voiceCoilCount;
        if (patch.coilWiring === undefined) {
          boxPatch.driverCoilWiring =
            patch.voiceCoilCount === 2
              ? params.driverCoilWiring === 'series'
                ? 'series'
                : 'parallel'
              : 'single';
        }
      }
      if (patch.coilNominalOhms !== undefined) {
        boxPatch.driverCoilNominalOhms = patch.coilNominalOhms;
      }
      if (patch.coilReOhms !== undefined) {
        boxPatch.driverCoilReOhms = patch.coilReOhms;
      }
      if (patch.coilWiring !== undefined) {
        boxPatch.driverCoilWiring = patch.coilWiring;
      }
      if (patch.wiring !== undefined) {
        boxPatch.driverArrayWiring = patch.wiring;
      }
      if (patch.netVolumeL !== undefined) {
        boxPatch.boxAutoCalcField = 'depth';
        boxPatch.targetNetVolumeL = patch.netVolumeL;
      }
      if (patch.tuningHz !== undefined && selectedVariant.enclosureType !== 'sealed') {
        boxPatch.portControlMode = 'tuning';
        boxPatch.targetTuningHz = patch.tuningHz;
      }
      if (patch.portAreaCm2 !== undefined && selectedVariant.enclosureType !== 'sealed') {
        boxPatch.boxAutoCalcField = 'depth';
        boxPatch.targetNetVolumeL = boxPatch.targetNetVolumeL ?? selectedVariant.netVolumeL;
        boxPatch.portControlMode = 'tuning';
        boxPatch.targetTuningHz = boxPatch.targetTuningHz ?? selectedVariant.tuningHz;
        boxPatch.targetPortAreaCm2 = patch.portAreaCm2;
      }
      if (patch.roundPortCount !== undefined) {
        boxPatch.portCount = patch.roundPortCount;
      }
      if (patch.roundPortDiameterMm !== undefined) {
        boxPatch.portDiameter = patch.roundPortDiameterMm;
      }
      if (patch.portEndFlared !== undefined) {
        boxPatch.portFlared = patch.portEndFlared;
      }
      if (Object.keys(boxPatch).length > 0) {
        onApplyParams(boxPatch);
      }

      setLiveOverrides((prev) => ({
        isobaric: patch.isobaric ?? prev.isobaric,
        ql: patch.ql ?? prev.ql,
        qa: patch.qa ?? prev.qa,
        voiceCoilTempRiseC: patch.voiceCoilTempRiseC ?? prev.voiceCoilTempRiseC,
        voiceCoilTempCoeff: patch.voiceCoilTempCoeff ?? prev.voiceCoilTempCoeff,
        addedMassG: patch.addedMassG ?? prev.addedMassG,
        portEndFlared: patch.portEndFlared ?? prev.portEndFlared,
      }));
    } else {
      setCustomVariants((prev) =>
        prev.map((v) => {
          if (v.id !== selectedVariant.id) return v;
          const next = { ...v, ...patch };
          if (patch.driverPresetId) {
            const drv = allDrivers.find((d) => d.id === patch.driverPresetId);
            if (drv) {
              const vc: VoiceCoilCount = drv.voiceCoilCount === 2 ? 2 : 1;
              next.voiceCoilCount = vc;
              next.coilNominalOhms =
                drv.coilNominalOhms ?? (vc === 2 ? (drv.zNom ?? 4) / 2 : drv.zNom ?? 4);
              next.coilReOhms =
                drv.coilReOhms ??
                (vc === 2 ? (drv.re ?? next.coilNominalOhms * 1.6) / 2 : drv.re ?? 3.2);
              next.coilWiring = vc === 2 ? 'series' : 'single';
            }
          }
          return next;
        }),
      );
    }
  };

  const removeVariant = (id: string) => {
    setCustomVariants((prev) => prev.filter((v) => v.id !== id));
    if (selectedVariantId === id) {
      setSelectedVariantId('live-project');
    }
  };

  const applyVariantTo3DProject = (v: ComparisonVariant) => {
    const drv = allDrivers.find((d) => d.id === v.driverPresetId);
    const patch: Partial<BoxParams> = {
      enclosureType: v.enclosureType,
      boxAutoCalcField: 'depth',
      targetNetVolumeL: v.netVolumeL,
      driverCount: v.driverCount ?? params.driverCount,
      driverArrayWiring: v.wiring ?? params.driverArrayWiring,
    };
    if (drv) {
      Object.assign(patch, presetToBoxAndCoilPatch(drv));
    }
    if (v.voiceCoilCount !== undefined) patch.driverVoiceCoilCount = v.voiceCoilCount;
    if (v.coilNominalOhms !== undefined) patch.driverCoilNominalOhms = v.coilNominalOhms;
    if (v.coilReOhms !== undefined) patch.driverCoilReOhms = v.coilReOhms;
    if (v.coilWiring !== undefined) patch.driverCoilWiring = v.coilWiring;
    if (v.enclosureType !== 'sealed') {
      patch.portControlMode = 'tuning';
      patch.targetTuningHz = v.tuningHz;
      patch.targetPortAreaCm2 = v.portAreaCm2;
    }
    onApplyParams(patch);
  };

  const applyAlignmentToSelected = (suggestion: (typeof alignments.suggestions)[number]) => {
    updateSelectedVariant({
      enclosureType: suggestion.enclosureType,
      netVolumeL: suggestion.netVolumeL,
      tuningHz: suggestion.tuningHz ?? 35,
      portAreaCm2: suggestion.portAreaCm2,
    });
  };

  // Offline JSON Export / Import (works both in Browser & Electron)
  const handleExportOfflineJson = () => {
    const payload = {
      app: 'SubLab 3D WSD',
      exportedAt: new Date().toISOString(),
      customDrivers,
      variants: customVariants,
    };
    const json = JSON.stringify(payload, null, 2);
    const electronApi = (
      window as unknown as {
        electronAPI?: { saveJsonFile?: (name: string, content: string) => Promise<boolean> };
      }
    ).electronAPI;
    if (electronApi?.saveJsonFile) {
      void electronApi.saveJsonFile('sublab-wsd-baza.json', json);
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sublab-wsd-baza.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportOfflineJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        customDrivers?: DriverPreset[];
        variants?: ComparisonVariant[];
      };
      if (Array.isArray(parsed.customDrivers)) {
        onImportDrivers?.(parsed.customDrivers);
      }
      if (Array.isArray(parsed.variants) && parsed.variants.length > 0) {
        setCustomVariants(parsed.variants.slice(0, 3));
      }
    } catch {
      // Ignore malformed JSON
    }
    e.target.value = '';
  };

  // SVG Chart Geometry
  const W = 880;
  const H = 350;
  const padL = 62;
  const padR = plotMode === 'impedance' && showPhaseOverlay ? 52 : 24;
  const padT = 22;
  const padB = 38;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const minHz = 10;
  const maxHz = maxFreqHz;

  const xForHz = (hz: number) =>
    padL +
    ((Math.log10(Math.max(minHz, Math.min(maxHz, hz))) - Math.log10(minHz)) /
      (Math.log10(maxHz) - Math.log10(minHz))) *
      plotW;

  const { yMin, yMax, yTicks } = useMemo(() => {
    const allPts = seriesList.flatMap((s) => s.points);
    if (
      plotMode === 'transfer' ||
      plotMode === 'transferBox' ||
      plotMode === 'frontPortGain' ||
      plotMode === 'rearPortGain'
    ) {
      const hasBoost =
        signal.environment === 'cabin' ||
        signal.environment === 'quarter_pi' ||
        signal.cabinGain ||
        signal.peqEnabled ||
        signal.ltEnabled;
      const top = hasBoost ? 15 : 9;
      return {
        yMin: -28,
        yMax: top,
        yTicks: hasBoost
          ? [-24, -18, -12, -6, -3, 0, 6, 12]
          : [-24, -18, -12, -6, -3, 0, 3, 6],
      };
    }
    if (plotMode === 'spl' || plotMode === 'maxSpl') {
      const vals = allPts.map((p) => (plotMode === 'maxSpl' ? p.maxSplDb : p.splDb));
      const peak = vals.length ? Math.max(...vals) : 122;
      const top = Math.ceil((peak + 3) / 5) * 5;
      const bottom = top - 40;
      return {
        yMin: bottom,
        yMax: top,
        yTicks: [bottom, bottom + 10, bottom + 20, bottom + 30, top],
      };
    }
    if (plotMode === 'maxPower' || plotMode === 'apparentLoadVa') {
      const vals = allPts.map((p) => getPointValue(p, plotMode));
      const peak = vals.length ? Math.max(...vals) : 1000;
      const top = Math.max(200, Math.ceil((peak * 1.1) / 100) * 100);
      const step = Math.round(top / 4);
      return { yMin: 0, yMax: top, yTicks: [0, step, step * 2, step * 3, top] };
    }
    if (plotMode === 'excursion') {
      const maxXmax = Math.max(
        params.driverXmax,
        ...seriesList.map((s) => s.effectiveXmaxMm),
      );
      const peak = allPts.length ? Math.max(...allPts.map((p) => p.excursionMm)) : maxXmax;
      const top = Math.max(Math.ceil(maxXmax * 1.4), Math.ceil(peak * 1.1));
      const mid = Math.round(maxXmax);
      return { yMin: 0, yMax: top, yTicks: [0, Math.round(mid * 0.5), mid, top] };
    }
    if (plotMode === 'velocity' || plotMode === 'rearPortVelocity') {
      const vals = allPts.map((p) => getPointValue(p, plotMode));
      const peak = vals.length ? Math.max(...vals) : 25;
      const top = Math.max(35, Math.ceil((peak + 5) / 5) * 5);
      return { yMin: 0, yMax: top, yTicks: [0, 10, 17, 25, top] };
    }
    if (plotMode === 'groupDelay' || plotMode === 'groupDelayBox') {
      const vals = allPts.map((p) => getPointValue(p, plotMode));
      const peak = vals.length ? Math.max(...vals) : 25;
      const top = Math.max(25, Math.ceil((peak + 4) / 5) * 5);
      return {
        yMin: 0,
        yMax: top,
        yTicks: [0, 10, 20, 30, top].filter((v, i, a) => v <= top && a.indexOf(v) === i),
      };
    }
    if (plotMode === 'phase' || plotMode === 'phaseBox') {
      return { yMin: -180, yMax: 180, yTicks: [-180, -90, 0, 90, 180] };
    }
    if (plotMode === 'impedancePhase') {
      return { yMin: -90, yMax: 90, yTicks: [-90, -45, 0, 45, 90] };
    }
    const peak = allPts.length ? Math.max(...allPts.map((p) => p.impedanceOhms)) : 24;
    const top = Math.max(16, Math.ceil((peak + 2) / 4) * 4);
    const step = Math.max(4, Math.round(top / 4));
    return { yMin: 0, yMax: top, yTicks: [0, step, step * 2, step * 3, top] };
  }, [seriesList, plotMode, signal.environment, signal.cabinGain, signal.peqEnabled, signal.ltEnabled, params.driverXmax]);

  const yForVal = (val: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, val));
    return padT + ((yMax - clamped) / Math.max(1e-6, yMax - yMin)) * plotH;
  };

  const yForPhase = (deg: number) => {
    const clamped = Math.max(-180, Math.min(180, deg));
    return padT + ((180 - clamped) / 360) * plotH;
  };

  const freqTicks =
    maxFreqHz === 500
      ? [10, 15, 20, 30, 50, 80, 100, 150, 200, 300, 500]
      : [10, 15, 20, 30, 40, 50, 60, 80, 100, 150, 200];
  const currentModeInfo = PLOT_MODES.find((m) => m.id === plotMode) ?? PLOT_MODES[0];
  const currentUnit = currentModeInfo.unit;
  const refSeries = seriesList[0];

  const activePortIsRound =
    selectedVariant.portShape === 'round' || selectedVariant.enclosureType === 'vented_round';
  const activePipeCount = selectedVariant.roundPortCount ?? params.portCount ?? 1;
  const activePipeDiaMm =
    selectedVariant.roundPortDiameterMm ??
    Math.max(
      40,
      Math.round(
        20 * Math.sqrt((Math.max(15, selectedVariant.portAreaCm2) / activePipeCount) / Math.PI),
      ),
    );
  const activePortFlared = selectedVariant.portEndFlared ?? true;

  const activeVariantPortStats =
    selectedVariant.enclosureType !== 'sealed'
      ? computePortPhysicalStats(
          selectedVariant.netVolumeL,
          selectedVariant.tuningHz,
          selectedVariant.portAreaCm2,
          activePortFlared,
          signal.speedOfSoundMs,
          activePortIsRound ? activePipeDiaMm : undefined,
        )
      : null;

  const selectedSeries = seriesList.find((s) => s.variantId === selectedVariant.id);
  const activeDriverCountForUi = selectedVariant.driverCount ?? params.driverCount;

  return (
    <div className="flex-1 overflow-y-auto cad-scroll p-4 sm:p-5 space-y-4">
      {/* Top WSD Workbench Toolbar */}
      <div className="bg-[#111318] border border-white/[0.08] rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Activity className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-white">
              WSD — Laboratorium T-S i Analiza Obudów
            </h2>
            <p className="text-[11px] text-zinc-400">
              Deaf Bonce MF-12R D2 + własne T-S · Sync 3D ↔ WSD · Generator 0 dBFS · Tryb offline
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="wsd-open-driver-catalog"
            onClick={() => openDriverCatalog(inspectedDriverPreset.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-[#161920] border border-cyan-500/35 text-cyan-300 hover:bg-cyan-500/10 transition-colors"
          >
            <Database className="w-3.5 h-3.5" />
            <span>Parametry głośników</span>
          </button>

          {/* Add Custom Driver button right in WSD */}
          <button
            type="button"
            onClick={() => onOpenDriverModal?.(null, inspectedDriverPreset)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-red-600 text-white hover:bg-red-500 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Dodaj własny głośnik</span>
          </button>

          {/* Offline JSON Export/Import */}
          <button
            type="button"
            onClick={handleExportOfflineJson}
            title="Eksportuj bazę głośników i projektów (.json) do pliku offline"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-zinc-300 bg-[#161920] border border-white/[0.1] rounded hover:text-white transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-cyan-300" />
            <span>Eksport</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Importuj bazę głośników (.json)"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-zinc-300 bg-[#161920] border border-white/[0.1] rounded hover:text-white transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-zinc-400" />
            <span>Import</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImportOfflineJson}
          />

          {/* Sweep range */}
          <div
            className="flex items-center p-0.5 bg-[#08090C] border border-white/[0.08] rounded-md"
            role="group"
            aria-label="Zakres częstotliwości wykresu"
          >
            {([200, 500] as const).map((hz) => (
              <button
                key={hz}
                type="button"
                onClick={() => setMaxFreqHz(hz)}
                className={`px-2 py-1 text-[11px] font-mono-num rounded transition-colors ${
                  maxFreqHz === hz
                    ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/40'
                    : 'text-zinc-400 hover:text-white border border-transparent'
                }`}
              >
                10–{hz} Hz
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Split: Projects & Generator Rail + Graph */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left: Projects Checklist + 0 dBFS Sine Signal Generator */}
        <div className="xl:col-span-4 space-y-4">
          {/* Projects Checklist */}
          <div className="bg-[#111318] border border-white/[0.08] rounded-lg p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white">
                Projekty WSD ({allVariants.length}/4)
              </span>
              <button
                type="button"
                disabled={customVariants.length >= 3}
                onClick={() => addCustomVariant()}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-40"
              >
                <Plus className="w-3 h-3" />
                <span>Nowy</span>
              </button>
            </div>

            <div className="space-y-1.5">
              {allVariants.map((v) => {
                const isSelected = selectedVariant.id === v.id;
                return (
                  <div
                    key={v.id}
                    className={`rounded-md p-2 border transition-colors flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-[#181C25] border-red-500/50'
                        : 'bg-[#161920] border-white/[0.06] hover:border-white/[0.15]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (v.isLiveProject) {
                            setLiveVisible((vis) => !vis);
                          } else {
                            setCustomVariants((prev) =>
                              prev.map((item) =>
                                item.id === v.id ? { ...item, visible: !item.visible } : item,
                              ),
                            );
                          }
                        }}
                        aria-label={v.visible ? `Ukryj ${v.name}` : `Pokaż ${v.name}`}
                        className="p-0.5 text-zinc-400 hover:text-white shrink-0"
                      >
                        {v.visible ? (
                          <Eye className="w-3.5 h-3.5" style={{ color: v.color }} />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5 text-zinc-600" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedVariantId(v.id)}
                        className="text-left min-w-0 flex-1"
                      >
                        <div className="text-xs font-medium text-white truncate flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: v.color }}
                          />
                          <span className="truncate">{v.name}</span>
                        </div>
                        <div className="text-[10px] text-zinc-400 font-mono-num truncate">
                          {v.driverCount ?? params.driverCount}× · {v.netVolumeL.toFixed(1)} L
                          {v.enclosureType !== 'sealed'
                            ? ` · ${v.tuningHz.toFixed(1)} Hz`
                            : ' · Zamknięta'}
                        </div>
                      </button>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={customVariants.length >= 3}
                        onClick={() => duplicateVariant(v)}
                        title="Klonuj wariant"
                        className="p-1 text-zinc-400 hover:text-cyan-300 disabled:opacity-35"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      {!v.isLiveProject ? (
                        <button
                          type="button"
                          onClick={() => removeVariant(v.id)}
                          aria-label={`Usuń ${v.name}`}
                          className="p-1 text-zinc-400 hover:text-rose-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 font-mono-num">
                          3D
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Offline 0 dBFS Sine Signal Generator */}
          <div
            data-testid="wsd-signal-generator"
            className="bg-[#111318] border border-white/[0.08] rounded-lg p-3.5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                {genEnabled ? (
                  <Volume2 className="w-3.5 h-3.5 text-red-400" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5 text-zinc-400" />
                )}
                <span>Generator sygnału testowego</span>
              </span>
              <span className="text-[10px] font-mono-num text-cyan-300">
                Sinus {genLevelDbfs === 0 ? '0 dBFS (Full)' : `${genLevelDbfs} dBFS`}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGenEnabled((g) => !g)}
                className={`px-3 py-1.5 text-xs font-semibold rounded border transition-colors shrink-0 ${
                  genEnabled
                    ? 'bg-red-600 border-red-500 text-white'
                    : 'bg-[#08090C] border-white/[0.1] text-zinc-300 hover:text-white'
                }`}
              >
                {genEnabled ? 'Stop' : 'Generuj'}
              </button>

              <div className="flex-1 flex items-center gap-1">
                <ImmediateNumberInput
                  min={12}
                  max={500}
                  decimals={1}
                  aria-label="Częstotliwość generatora (Hz)"
                  value={genHz}
                  onChange={setGenHz}
                  className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 text-xs font-mono-num text-white text-right focus:outline-none focus:border-red-500"
                />
                <span className="text-[11px] text-zinc-400 font-mono-num shrink-0">Hz</span>
              </div>

              <div className="w-24 flex items-center gap-1">
                <ImmediateNumberInput
                  min={-60}
                  max={0}
                  decimals={1}
                  aria-label="Poziom wyjściowy generatora (dBFS)"
                  value={genLevelDbfs}
                  onChange={setGenLevelDbfs}
                  className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 text-xs font-mono-num text-cyan-300 text-right focus:outline-none focus:border-red-500"
                />
                <span className="text-[10px] text-zinc-400 font-mono-num shrink-0">dBFS</span>
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-zinc-400 block">Poziom wyjściowy (dBFS)</span>
              <div className="grid grid-cols-6 gap-1">
                {GEN_DBFS_PRESETS.map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setGenLevelDbfs(lvl)}
                    className={`py-1 text-[10px] font-mono-num rounded border transition-colors ${
                      genLevelDbfs === lvl
                        ? 'bg-red-600/25 border-red-500 text-red-200 font-semibold'
                        : 'bg-[#08090C] border-white/[0.06] text-zinc-400 hover:text-white'
                    }`}
                  >
                    {lvl} dB
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-zinc-400 block">Częstotliwości testowe (Hz)</span>
              <div className="grid grid-cols-7 gap-1">
                {GEN_FREQ_PRESETS.map((hz) => (
                  <button
                    key={hz}
                    type="button"
                    onClick={() => setGenHz(hz)}
                    className={`py-1 text-[10px] font-mono-num rounded border transition-colors ${
                      genHz === hz
                        ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300 font-semibold'
                        : 'bg-[#08090C] border-white/[0.06] text-zinc-400 hover:text-white'
                    }`}
                  >
                    {hz}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Graph Mode Selector + SVG Plot */}
        <div className="xl:col-span-8 bg-[#111318] border border-white/[0.08] rounded-lg p-4 space-y-3">
          {/* Graph selector: 17 analytical modes */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-[260px]">
              <label htmlFor="wsd-plot-select" className="text-xs text-zinc-400 whitespace-nowrap">
                Wykres:
              </label>
              <select
                id="wsd-plot-select"
                value={plotMode}
                onChange={(e) => setPlotMode(e.target.value as WorkbenchPlotMode)}
                className="flex-1 max-w-sm bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs font-medium text-white focus:outline-none focus:border-red-500"
              >
                {['Obudowa', 'Moc i Poziom', 'Przetwornik', 'Porty', 'EQ / Filtry'].map(
                  (grp) => (
                    <optgroup key={grp} label={grp}>
                      {PLOT_MODES.filter((m) => m.group === grp).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </optgroup>
                  ),
                )}
              </select>
            </div>

            {plotMode === 'impedance' && (
              <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showPhaseOverlay}
                  onChange={(e) => setShowPhaseOverlay(e.target.checked)}
                  className="accent-red-500"
                />
                <span>Pokaż fazę elektryczną (°)</span>
              </label>
            )}
          </div>

          {/* Quick-access plot buttons */}
          <div className="flex flex-wrap gap-1">
            {PLOT_MODES.filter((m) => m.quick).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setPlotMode(m.id)}
                className={`px-2 py-1 text-[11px] rounded transition-colors whitespace-nowrap ${
                  plotMode === m.id
                    ? 'bg-red-600 text-white font-semibold'
                    : 'bg-[#08090C] text-zinc-300 hover:text-white border border-white/[0.06]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto select-none"
            onMouseLeave={() => setHoverHz(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = ((e.clientX - rect.left) / rect.width) * W;
              const norm = Math.max(0, Math.min(1, (relX - padL) / plotW));
              const hz = Math.pow(
                10,
                Math.log10(minHz) + norm * (Math.log10(maxHz) - Math.log10(minHz)),
              );
              setHoverHz(Math.round(hz));
            }}
          >
            {freqTicks.map((hz) => {
              const x = xForHz(hz);
              return (
                <g key={hz}>
                  <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke="#1d2029" strokeWidth="1" />
                  <text
                    x={x}
                    y={H - 12}
                    textAnchor="middle"
                    fill="#71717a"
                    fontSize="11"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {hz === maxHz ? `${hz} Hz` : hz}
                  </text>
                </g>
              );
            })}

            {yTicks.map((val) => {
              const y = yForVal(val);
              const isMachSafe =
                (plotMode === 'velocity' || plotMode === 'rearPortVelocity') && val === 17;
              const isDanger =
                ((plotMode === 'velocity' || plotMode === 'rearPortVelocity') && val === 25) ||
                (plotMode === 'excursion' && val === Math.round(params.driverXmax));
              const isRef =
                isMachSafe ||
                isDanger ||
                ((plotMode === 'transfer' || plotMode === 'transferBox') &&
                  (val === 0 || val === -3)) ||
                ((plotMode === 'phase' ||
                  plotMode === 'phaseBox' ||
                  plotMode === 'impedancePhase') &&
                  val === 0);
              return (
                <g key={val}>
                  <line
                    x1={padL}
                    y1={y}
                    x2={W - padR}
                    y2={y}
                    stroke={
                      isDanger
                        ? '#f59e0b'
                        : isMachSafe
                          ? '#22d3ee'
                          : isRef
                            ? '#52525b'
                            : '#191c24'
                    }
                    strokeWidth={isRef ? '1.3' : '1'}
                    strokeDasharray={isRef ? '4 4' : undefined}
                  />
                  <text
                    x={padL - 8}
                    y={y + 4}
                    textAnchor="end"
                    fill={isDanger ? '#fbbf24' : isMachSafe ? '#22d3ee' : '#71717a'}
                    fontSize="10"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {val} {currentUnit}
                  </text>
                </g>
              );
            })}

            {plotMode === 'impedance' &&
              showPhaseOverlay &&
              [-180, -90, 0, 90, 180].map((deg) => (
                <text
                  key={deg}
                  x={W - padR + 8}
                  y={yForPhase(deg) + 4}
                  textAnchor="start"
                  fill="#71717a"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {deg}°
                </text>
              ))}

            {plotMode === 'excursion' && (
              <text
                x={padL + 8}
                y={Math.max(padT + 14, yForVal(params.driverXmax) - 6)}
                fill="#fbbf24"
                fontSize="11"
                fontFamily="JetBrains Mono, monospace"
              >
                Limit mechaniczny Xmax ({params.driverXmax} mm)
              </text>
            )}
            {(plotMode === 'velocity' || plotMode === 'rearPortVelocity') && (
              <>
                <text
                  x={padL + 8}
                  y={Math.max(padT + 14, yForVal(17) - 5)}
                  fill="#22d3ee"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  0.05 Mach (17 m/s)
                </text>
                <text
                  x={padL + 8}
                  y={Math.max(padT + 14, yForVal(25) - 6)}
                  fill="#fbbf24"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  0.073 Mach (25 m/s — próg turbulencji)
                </text>
              </>
            )}

            {plotMode === 'impedance' &&
              showPhaseOverlay &&
              seriesList.map((s) => {
                const phaseD = s.points
                  .map(
                    (pt, i) =>
                      `${i === 0 ? 'M' : 'L'} ${xForHz(pt.hz).toFixed(1)} ${yForPhase(pt.impedancePhaseDeg).toFixed(1)}`,
                  )
                  .join(' ');
                return (
                  <path
                    key={`${s.variantId}-zphase`}
                    d={phaseD}
                    fill="none"
                    stroke={s.color}
                    strokeOpacity="0.4"
                    strokeWidth="1.3"
                    strokeDasharray="4 4"
                  />
                );
              })}

            {seriesList.map((s) => {
              const pathD = s.points
                .map(
                  (pt, i) =>
                    `${i === 0 ? 'M' : 'L'} ${xForHz(pt.hz).toFixed(1)} ${yForVal(getPointValue(pt, plotMode)).toFixed(1)}`,
                )
                .join(' ');
              return (
                <path
                  key={s.variantId}
                  d={pathD}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.variantId === selectedVariant.id ? '2.6' : '2.0'}
                  strokeLinejoin="round"
                />
              );
            })}

            {hoverHz !== null && (
              <g>
                <line
                  x1={xForHz(hoverHz)}
                  y1={padT}
                  x2={xForHz(hoverHz)}
                  y2={padT + plotH}
                  stroke="#a1a1aa"
                  strokeWidth="1"
                />
                {seriesList.map((s) => {
                  const pt = s.points.find((p) => p.hz === hoverHz);
                  if (!pt) return null;
                  return (
                    <circle
                      key={`dot-${s.variantId}`}
                      cx={xForHz(pt.hz)}
                      cy={yForVal(getPointValue(pt, plotMode))}
                      r="4.5"
                      fill={s.color}
                      stroke="#0a0b0e"
                      strokeWidth="1.8"
                    />
                  );
                })}
              </g>
            )}
          </svg>

          {/* Crosshair Readout Strip */}
          <div className="pt-2.5 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-4 font-mono-num">
              <span className="text-zinc-400">
                Kursor:{' '}
                <strong className="text-white">
                  {hoverHz !== null ? `${hoverHz} Hz` : 'Najedź na wykres'}
                </strong>
              </span>
              {hoverHz !== null &&
                seriesList.map((s, idx) => {
                  const pt = s.points.find((p) => p.hz === hoverHz);
                  if (!pt) return null;
                  const val = getPointValue(pt, plotMode);
                  const refPt = refSeries?.points.find((p) => p.hz === hoverHz);
                  const delta =
                    idx > 0 && refPt ? val - getPointValue(refPt, plotMode) : null;
                  return (
                    <span
                      key={`read-${s.variantId}`}
                      className="inline-flex items-center gap-1.5 text-zinc-300"
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      <span>{s.name.split(':')[0]}:</span>
                      <strong className="text-white">
                        {val.toFixed(1)} {currentUnit}
                      </strong>
                      {(plotMode === 'velocity' || plotMode === 'rearPortVelocity') && (
                        <span className="text-cyan-300">
                          ({(val / (signal.speedOfSoundMs ?? 343.2)).toFixed(3)} M)
                        </span>
                      )}
                      {delta !== null && (
                        <span
                          className={
                            delta >= 0 ? 'text-emerald-400 text-[11px]' : 'text-amber-400 text-[11px]'
                          }
                        >
                          [{delta >= 0 ? '+' : ''}
                          {delta.toFixed(1)}]
                        </span>
                      )}
                    </span>
                  );
                })}
            </div>
            <span className="text-[11px] text-zinc-500 font-mono-num">
              Moc: {signal.powerW} W · Rg {signal.seriesResistanceOhms ?? 0} Ω · Z {selectedElecLoad.totalNominalOhms.toFixed(1)} Ω · 10–{maxFreqHz} Hz
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Project Tabbed Inspector */}
      <div className="bg-[#111318] border border-white/[0.08] rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-[#0D0F14] border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: selectedVariant.color }}
            />
            <span className="text-xs font-semibold text-white">
              Edycja projektu: {selectedVariant.name}
            </span>
            {selectedVariant.isLiveProject && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">
                Synchronizowany z 3D
              </span>
            )}
          </div>
          {!selectedVariant.isLiveProject && (
            <button
              type="button"
              onClick={() => applyVariantTo3DProject(selectedVariant)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded bg-red-600 text-white hover:bg-red-500 transition-colors"
            >
              <span>Zastosuj w modelu 3D</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Vertical Tabs */}
          <div
            className="lg:col-span-2 bg-[#08090C] border-b lg:border-b-0 lg:border-r border-white/[0.08] p-2 flex lg:flex-col gap-1 overflow-x-auto"
            role="tablist"
            aria-label="Sekcje parametrów projektu WSD"
          >
            {PROJECT_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeProjectTab === t.id}
                onClick={() => setActiveProjectTab(t.id)}
                className={`px-3 py-2 text-left text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  activeProjectTab === t.id
                    ? 'bg-red-600 text-white font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab Panel Content */}
          <div className="lg:col-span-10 p-4">
            {activeProjectTab === 'driver' && (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                {/* Left: Driver Database Selection, Count, Iso-Barik, Voice Coils & Wiring */}
                <div className="xl:col-span-7 space-y-3.5">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex-1 min-w-[220px] space-y-1">
                      <span className="text-[11px] text-zinc-400 block">
                        Wybrany przetwornik (baza + własne)
                      </span>
                      <select
                        value={selectedVariant.driverPresetId ?? params.driverPresetId}
                        onChange={(e) => updateSelectedVariant({ driverPresetId: e.target.value })}
                        className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
                      >
                        <optgroup label="Domyślny głośnik (Deaf Bonce)">
                          {DRIVER_PRESETS.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} ({d.voiceCoilCount === 2 ? `DVC ${d.coilNominalOhms}Ω` : `SVC ${d.coilNominalOhms}Ω`})
                            </option>
                          ))}
                        </optgroup>
                        {customDrivers.length > 0 && (
                          <optgroup label="Własne głośniki T-S (sync 3D)">
                            {customDrivers.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name} ({d.sizeLabel} · {d.voiceCoilCount === 2 ? `2×${d.coilNominalOhms ?? 2}Ω` : `1×${d.coilNominalOhms ?? 4}Ω`})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </label>

                    <button
                      type="button"
                      onClick={() => onOpenDriverModal?.(null, inspectedDriverPreset)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-red-600 text-white hover:bg-red-500 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Nowy głośnik</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onOpenDriverModal?.(
                          inspectedDriverPreset.isCustom ? inspectedDriverPreset : null,
                          inspectedDriverPreset,
                        )
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded bg-[#161920] border border-white/[0.12] text-zinc-200 hover:text-white"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-cyan-300" />
                      <span>
                        {inspectedDriverPreset.isCustom ? 'Edytuj T-S' : 'Klonuj jako własny'}
                      </span>
                    </button>

                    {inspectedDriverPreset.isCustom && onDeleteCustomDriver && (
                      <button
                        type="button"
                        onClick={() => {
                          const delId = inspectedDriverPreset.id;
                          onDeleteCustomDriver(delId);
                          updateSelectedVariant({ driverPresetId: DRIVER_PRESETS[0].id });
                        }}
                        className="p-1.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20"
                        title="Usuń własny głośnik"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Placement, Coils & Wiring */}
                  <div className="bg-[#161920] border border-white/[0.08] rounded-md p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="space-y-1">
                        <span className="text-[11px] text-zinc-400 block">Liczba głośników</span>
                        <select
                          value={activeDriverCountForUi}
                          onChange={(e) =>
                            updateSelectedVariant({
                              driverCount: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 | 6,
                            })
                          }
                          className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 text-xs font-mono-num text-white"
                        >
                          {[1, 2, 3, 4, 5, 6].map((n) => (
                            <option key={n} value={n}>
                              {n}×
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="space-y-1">
                        <span className="text-[11px] text-zinc-400 block">Układ akustyczny</span>
                        <div className="grid grid-cols-2 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]">
                          <button
                            type="button"
                            onClick={() => updateSelectedVariant({ isobaric: false })}
                            className={`py-1 text-[11px] rounded ${
                              !selectedVariant.isobaric
                                ? 'bg-red-600 text-white font-semibold'
                                : 'text-zinc-400 hover:text-white'
                            }`}
                          >
                            Standard
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSelectedVariant({ isobaric: true })}
                            className={`py-1 text-[11px] rounded ${
                              selectedVariant.isobaric
                                ? 'bg-red-600 text-white font-semibold'
                                : 'text-zinc-400 hover:text-white'
                            }`}
                          >
                            Izobaryk
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[11px] text-zinc-400 block">Ilość cewek</span>
                        <div className="grid grid-cols-2 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]">
                          {([1, 2] as const).map((vc) => (
                            <button
                              key={vc}
                              type="button"
                              onClick={() =>
                                updateSelectedVariant({
                                  voiceCoilCount: vc,
                                  coilWiring:
                                    vc === 2
                                      ? selectedElecLoad.effectiveCoilWiring === 'series'
                                        ? 'series'
                                        : 'parallel'
                                      : 'single',
                                })
                              }
                              className={`py-1 text-[11px] font-mono-num rounded ${
                                selectedElecLoad.voiceCoilCount === vc
                                  ? 'bg-red-600 text-white font-semibold'
                                  : 'text-zinc-400 hover:text-white'
                              }`}
                            >
                              {vc === 1 ? '1× SVC' : '2× DVC'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-white/[0.06] text-xs">
                      <label className="space-y-1">
                        <span className="text-[11px] text-zinc-400 block">Z cewki (Ω)</span>
                        <ImmediateNumberInput
                          min={0.5}
                          max={16}
                          decimals={2}
                          value={
                            selectedVariant.coilNominalOhms ??
                            (selectedVariant.isLiveProject
                              ? params.driverCoilNominalOhms
                              : inspectedDriverPreset.coilNominalOhms ?? 4)
                          }
                          onChange={(coilNominalOhms) => updateSelectedVariant({ coilNominalOhms })}
                          className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-[11px] text-zinc-400 block">Re cewki (Ω)</span>
                        <ImmediateNumberInput
                          min={0.2}
                          max={16}
                          decimals={2}
                          value={
                            selectedVariant.coilReOhms ??
                            (selectedVariant.isLiveProject
                              ? params.driverCoilReOhms
                              : inspectedDriverPreset.coilReOhms ?? 3.2)
                          }
                          onChange={(coilReOhms) => updateSelectedVariant({ coilReOhms })}
                          className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                        />
                      </label>

                      {selectedElecLoad.voiceCoilCount === 2 && (
                        <label className="space-y-1">
                          <span className="text-[11px] text-zinc-400 block">Łączenie cewek</span>
                          <select
                            value={selectedElecLoad.effectiveCoilWiring}
                            onChange={(e) =>
                              updateSelectedVariant({
                                coilWiring: e.target.value as CoilWiringMode,
                              })
                            }
                            className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 text-xs text-white"
                          >
                            <option value="parallel">Równoległe</option>
                            <option value="series">Szeregowe</option>
                          </select>
                        </label>
                      )}

                      {activeDriverCountForUi >= 2 && (
                        <label className="space-y-1">
                          <span className="text-[11px] text-zinc-400 block">Łączenie głośników</span>
                          <select
                            value={
                              selectedVariant.wiring ??
                              (selectedVariant.isLiveProject ? params.driverArrayWiring : 'parallel')
                            }
                            onChange={(e) =>
                              updateSelectedVariant({ wiring: e.target.value as DriverWiringType })
                            }
                            className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 text-xs text-white"
                          >
                            <option value="parallel">Równoległe</option>
                            <option value="series">Szeregowe</option>
                            {(activeDriverCountForUi === 4 || activeDriverCountForUi === 6) && (
                              <option value="series_parallel">
                                Szereg.-Równol. ({activeDriverCountForUi === 4 ? '2S2P' : '2S3P'})
                              </option>
                            )}
                          </select>
                        </label>
                      )}
                    </div>

                    <div
                      data-testid="wsd-impedance-summary"
                      className="bg-[#08090C] border border-cyan-500/25 rounded px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-num"
                    >
                      <span className="text-zinc-400 font-sans">
                        Wypadkowe obciążenie wzmacniacza:
                      </span>
                      <span className="text-cyan-300 font-semibold">
                        {selectedElecLoad.totalNominalOhms.toFixed(2).replace(/\.00$/, '.0')} Ω · Re{' '}
                        {selectedElecLoad.totalReOhms.toFixed(2)} Ω ({selectedElecLoad.wiringSummaryLabel})
                      </span>
                    </div>

                    {/* Quick T-S Parameter Strip + Full Database Viewer trigger right in Głośnik tab */}
                    <div className="bg-[#08090C] border border-white/[0.06] rounded p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-zinc-300">
                          Szybki podgląd T-S i montażu ({inspectedDriverPreset.sizeLabel})
                        </span>
                        <button
                          type="button"
                          onClick={() => openDriverCatalog(inspectedDriverPreset.id)}
                          className="text-[11px] text-cyan-300 hover:underline inline-flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Pełne parametry bazy głośników</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-[10px] font-mono-num">
                        <div className="px-2 py-1 rounded bg-[#161920] flex justify-between gap-1">
                          <span className="text-zinc-500">Fs</span>
                          <span className="text-white">{derivedDriver.fs.toFixed(1)} Hz</span>
                        </div>
                        <div className="px-2 py-1 rounded bg-[#161920] flex justify-between gap-1">
                          <span className="text-zinc-500">Qts</span>
                          <span className="text-cyan-300">{derivedDriver.qts.toFixed(3)}</span>
                        </div>
                        <div className="px-2 py-1 rounded bg-[#161920] flex justify-between gap-1">
                          <span className="text-zinc-500">Vas</span>
                          <span className="text-white">{derivedDriver.vas.toFixed(1)} L</span>
                        </div>
                        <div className="px-2 py-1 rounded bg-[#161920] flex justify-between gap-1">
                          <span className="text-zinc-500">Xmax</span>
                          <span className="text-white">{derivedDriver.xmax} mm</span>
                        </div>
                        <div className="px-2 py-1 rounded bg-[#161920] flex justify-between gap-1">
                          <span className="text-zinc-500">SPL</span>
                          <span className="text-red-400">{derivedDriver.spl1w1m.toFixed(1)} dB</span>
                        </div>
                        <div className="px-2 py-1 rounded bg-[#161920] flex justify-between gap-1">
                          <span className="text-zinc-500">Otwór</span>
                          <span className="text-zinc-200">{inspectedDriverPreset.cutoutDia} mm</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: Advanced Driver Options (Thermal Rise + Temp Coeff + Added Mass) */}
                <div className="xl:col-span-5 bg-[#161920] border border-white/[0.08] rounded-md p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">
                      Opcje zaawansowane przetwornika
                    </span>
                    {selectedSeries && (
                      <span className="text-[10px] font-mono-num text-cyan-300">
                        Fs eff: {selectedSeries.effectiveFsHz.toFixed(1)} Hz · Qts:{' '}
                        {selectedSeries.effectiveQts.toFixed(2)}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                    <label className="space-y-1">
                      <span className="text-[11px] text-zinc-400 block">
                        Przyrost temp. cewki (°C)
                      </span>
                      <ImmediateNumberInput
                        min={0}
                        max={220}
                        decimals={0}
                        value={selectedVariant.voiceCoilTempRiseC ?? 0}
                        onChange={(voiceCoilTempRiseC) =>
                          updateSelectedVariant({ voiceCoilTempRiseC })
                        }
                        className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[11px] text-zinc-400 block">
                        Współcz. temp. (1000/°C)
                      </span>
                      <ImmediateNumberInput
                        min={0}
                        max={10}
                        decimals={2}
                        value={selectedVariant.voiceCoilTempCoeff ?? 3.9}
                        onChange={(voiceCoilTempCoeff) =>
                          updateSelectedVariant({ voiceCoilTempCoeff })
                        }
                        className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[11px] text-zinc-400 block">
                        Dodana masa membrany (g)
                      </span>
                      <ImmediateNumberInput
                        min={0}
                        max={500}
                        decimals={1}
                        value={selectedVariant.addedMassG ?? 0}
                        onChange={(addedMassG) => updateSelectedVariant({ addedMassG })}
                        className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                      />
                    </label>
                  </div>

                  {selectedSeries && selectedSeries.thermalCompressionDb > 0.05 && (
                    <div className="text-[11px] text-amber-300 font-mono-num">
                      Kompresja termiczna: -{selectedSeries.thermalCompressionDb.toFixed(2)} dB
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeProjectTab === 'box' && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                {!selectedVariant.isLiveProject && (
                  <label className="col-span-2 sm:col-span-1 space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Nazwa projektu</span>
                    <input
                      type="text"
                      value={selectedVariant.name}
                      onChange={(e) => updateSelectedVariant({ name: e.target.value })}
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 text-white"
                    />
                  </label>
                )}
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 block">Typ obudowy</span>
                  <select
                    value={selectedVariant.enclosureType}
                    onChange={(e) =>
                      updateSelectedVariant({ enclosureType: e.target.value as EnclosureType })
                    }
                    className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 text-white"
                  >
                    {ENCLOSURE_LABELS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 block">Objętość netto Vb (L)</span>
                  <ImmediateNumberInput
                    min={4}
                    max={800}
                    decimals={1}
                    value={selectedVariant.netVolumeL}
                    onChange={(netVolumeL) => updateSelectedVariant({ netVolumeL })}
                    className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 block">Szczelność Ql</span>
                  <ImmediateNumberInput
                    min={3}
                    max={25}
                    decimals={1}
                    value={selectedVariant.ql ?? 7}
                    onChange={(ql) => updateSelectedVariant({ ql })}
                    className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 block">Wytłumienie Qa</span>
                  <select
                    value={selectedVariant.qa ?? 100}
                    onChange={(e) => updateSelectedVariant({ qa: Number(e.target.value) })}
                    className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white"
                  >
                    <option value={100}>Brak (100)</option>
                    <option value={18}>Średnie (18)</option>
                    <option value={8}>Gęste (8)</option>
                  </select>
                </label>
              </div>
            )}

            {activeProjectTab === 'vents' && (
              <div className="space-y-3 text-xs">
                {selectedVariant.enclosureType === 'sealed' ? (
                  <div className="bg-[#08090C] border border-white/[0.08] rounded p-3 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-zinc-400">
                      Wybrany projekt jest obudową zamkniętą — brak tunelu Bass-Reflex.
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateSelectedVariant({
                          enclosureType: 'vented_round',
                          portShape: 'round',
                          roundPortCount: 1,
                          roundPortDiameterMm: 100,
                          portAreaCm2: Number((Math.PI * 5 * 5).toFixed(1)),
                          tuningHz: 35,
                          portEndFlared: true,
                        })
                      }
                      className="px-3 py-1.5 rounded bg-red-600 text-white font-semibold hover:bg-red-500 transition-colors"
                    >
                      Przełącz na Bass-Reflex rurowy (Ø100 mm)
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Top row: Port calculator shape & end flare */}
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-[#161920] border border-white/[0.08] rounded-md p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-zinc-400">Kalkulator portu:</span>
                        <div className="inline-flex rounded bg-[#08090C] p-0.5 border border-white/[0.08]">
                          <button
                            type="button"
                            onClick={() => {
                              const area =
                                activePipeCount * Math.PI * Math.pow(activePipeDiaMm / 20, 2);
                              updateSelectedVariant({
                                portShape: 'round',
                                roundPortCount: activePipeCount,
                                roundPortDiameterMm: activePipeDiaMm,
                                portAreaCm2: Number(area.toFixed(1)),
                              });
                            }}
                            className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                              activePortIsRound
                                ? 'bg-red-600 text-white font-semibold'
                                : 'text-zinc-400 hover:text-white'
                            }`}
                          >
                            Rurowy (Okrągły)
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSelectedVariant({ portShape: 'slot' })}
                            className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                              !activePortIsRound
                                ? 'bg-red-600 text-white font-semibold'
                                : 'text-zinc-400 hover:text-white'
                            }`}
                          >
                            Szczelinowy / Pole S
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-zinc-400">Zakończenie:</span>
                        <div className="inline-flex rounded bg-[#08090C] p-0.5 border border-white/[0.08]">
                          <button
                            type="button"
                            onClick={() => updateSelectedVariant({ portEndFlared: true })}
                            className={`px-2 py-1 text-[11px] rounded transition-colors ${
                              activePortFlared
                                ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                                : 'text-zinc-400 hover:text-white'
                            }`}
                          >
                            Aero-Flare (k=0.732)
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSelectedVariant({ portEndFlared: false })}
                            className={`px-2 py-1 text-[11px] rounded transition-colors ${
                              !activePortFlared
                                ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                                : 'text-zinc-400 hover:text-white'
                            }`}
                          >
                            Prosta rura (k=0.85)
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Controls row */}
                    {activePortIsRound ? (
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                        <label className="sm:col-span-3 space-y-1">
                          <span className="text-[11px] text-zinc-400 block">Strojenie Fb (Hz)</span>
                          <ImmediateNumberInput
                            min={15}
                            max={90}
                            decimals={1}
                            value={selectedVariant.tuningHz}
                            onChange={(tuningHz) => updateSelectedVariant({ tuningHz })}
                            className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                          />
                        </label>

                        <div className="sm:col-span-3 space-y-1">
                          <span className="text-[11px] text-zinc-400 block">Liczba rur (N)</span>
                          <div className="grid grid-cols-4 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]">
                            {([1, 2, 3, 4] as const).map((cnt) => (
                              <button
                                key={cnt}
                                type="button"
                                onClick={() => {
                                  const area = cnt * Math.PI * Math.pow(activePipeDiaMm / 20, 2);
                                  updateSelectedVariant({
                                    portShape: 'round',
                                    roundPortCount: cnt,
                                    roundPortDiameterMm: activePipeDiaMm,
                                    portAreaCm2: Number(area.toFixed(1)),
                                  });
                                }}
                                className={`py-1 rounded text-[11px] font-mono-num transition-colors ${
                                  activePipeCount === cnt
                                    ? 'bg-red-600 text-white font-semibold'
                                    : 'text-zinc-400 hover:text-white'
                                }`}
                              >
                                {cnt}×
                              </button>
                            ))}
                          </div>
                        </div>

                        <label className="sm:col-span-3 space-y-1">
                          <span className="text-[11px] text-zinc-400 block">
                            Średnica wew. rury Ø (mm)
                          </span>
                          <ImmediateNumberInput
                            min={35}
                            max={320}
                            decimals={0}
                            value={activePipeDiaMm}
                            onChange={(d) => {
                              const area = activePipeCount * Math.PI * Math.pow(d / 20, 2);
                              updateSelectedVariant({
                                portShape: 'round',
                                roundPortCount: activePipeCount,
                                roundPortDiameterMm: d,
                                portAreaCm2: Number(area.toFixed(1)),
                              });
                            }}
                            className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                          />
                        </label>

                        <div className="sm:col-span-3 space-y-1">
                          <span className="text-[11px] text-zinc-400 block">
                            Pole łączne S ({activePipeCount}×Ø{Math.round(activePipeDiaMm)})
                          </span>
                          <div className="bg-[#0B1218] border border-cyan-500/35 rounded px-2.5 py-1.5 font-mono-num text-cyan-300 font-semibold flex items-center justify-between">
                            <span>{selectedVariant.portAreaCm2.toFixed(1)} cm²</span>
                            <button
                              type="button"
                              title="Dobierz minimalną średnicę rury dla bezpiecznej prędkości powietrza < 17 m/s"
                              onClick={() => {
                                const peakV = selectedSeries?.peakPortVelocityMs ?? 12;
                                const neededArea = Math.max(
                                  25,
                                  selectedVariant.portAreaCm2 * (peakV / 16.5),
                                );
                                const neededDia = Math.ceil(
                                  20 * Math.sqrt((neededArea / activePipeCount) / Math.PI),
                                );
                                const clampedDia = Math.max(50, Math.min(300, neededDia));
                                const finalArea =
                                  activePipeCount * Math.PI * Math.pow(clampedDia / 20, 2);
                                updateSelectedVariant({
                                  portShape: 'round',
                                  roundPortCount: activePipeCount,
                                  roundPortDiameterMm: clampedDia,
                                  portAreaCm2: Number(finalArea.toFixed(1)),
                                });
                              }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30"
                            >
                              Auto &lt;17 m/s
                            </button>
                          </div>
                        </div>

                        {/* Standard car-audio & PVC pipe quick presets */}
                        <div className="sm:col-span-12 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-zinc-400 mr-1">Standardowe rury:</span>
                          {[75, 100, 110, 150, 160, 200].map((stdDia) => (
                            <button
                              key={stdDia}
                              type="button"
                              onClick={() => {
                                const area = activePipeCount * Math.PI * Math.pow(stdDia / 20, 2);
                                updateSelectedVariant({
                                  portShape: 'round',
                                  roundPortCount: activePipeCount,
                                  roundPortDiameterMm: stdDia,
                                  portAreaCm2: Number(area.toFixed(1)),
                                });
                              }}
                              className={`px-2 py-0.5 rounded border text-[11px] font-mono-num transition-colors ${
                                Math.round(activePipeDiaMm) === stdDia
                                  ? 'bg-red-600/25 border-red-500 text-red-200 font-semibold'
                                  : 'bg-[#08090C] border-white/[0.08] text-zinc-400 hover:text-white'
                              }`}
                            >
                              Ø{stdDia} mm
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                        <label className="space-y-1">
                          <span className="text-[11px] text-zinc-400 block">Strojenie Fb (Hz)</span>
                          <ImmediateNumberInput
                            min={15}
                            max={90}
                            decimals={1}
                            value={selectedVariant.tuningHz}
                            onChange={(tuningHz) => updateSelectedVariant({ tuningHz })}
                            className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-[11px] text-zinc-400 block">Pole portu S (cm²)</span>
                          <ImmediateNumberInput
                            min={15}
                            max={2500}
                            decimals={1}
                            value={selectedVariant.portAreaCm2}
                            onChange={(portAreaCm2) => updateSelectedVariant({ portAreaCm2 })}
                            className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                          />
                        </label>

                        <div className="sm:col-span-2 bg-[#08090C] border border-white/[0.08] rounded px-2.5 py-1.5 font-mono-num text-[11px] text-zinc-300 flex items-center justify-between">
                          <span>Równoważnik pojedynczej rury:</span>
                          <strong className="text-cyan-300">
                            Ø{activeVariantPortStats?.equivalentRoundDiaMm ?? '—'} mm
                          </strong>
                        </div>
                      </div>
                    )}

                    {/* Live Port Output Readout Bar */}
                    {activeVariantPortStats && (
                      <div className="bg-[#08090C] border border-white/[0.08] rounded p-2.5 grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono-num">
                        <div>
                          <span className="text-[10px] text-zinc-400 block">
                            {activePortIsRound
                              ? `Długość każdej rury (${activePipeCount}×)`
                              : 'Długość tunelu'}
                          </span>
                          <strong className="text-sm text-white">
                            {Math.round(activeVariantPortStats.lengthMm)} mm
                          </strong>
                        </div>
                        <div>
                          <span className="text-[10px] text-zinc-400 block">Korekta końcowa</span>
                          <strong className="text-sm text-zinc-200">
                            {activeVariantPortStats.endCorrectionMm} mm
                          </strong>
                        </div>
                        <div>
                          <span className="text-[10px] text-zinc-400 block">Prędkość maks. powietrza</span>
                          <strong
                            className={`text-sm ${
                              (selectedSeries?.peakPortVelocityMs ?? 0) > 22
                                ? 'text-red-400'
                                : (selectedSeries?.peakPortVelocityMs ?? 0) > 17
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                            }`}
                          >
                            {selectedSeries ? `${selectedSeries.peakPortVelocityMs.toFixed(1)} m/s` : '—'}
                          </strong>
                        </div>
                        <div>
                          <span className="text-[10px] text-zinc-400 block">1. rezonans organowy</span>
                          <strong
                            className={`text-sm ${
                              activeVariantPortStats.firstResonanceHz < 220
                                ? 'text-amber-400'
                                : 'text-cyan-300'
                            }`}
                          >
                            {Math.round(activeVariantPortStats.firstResonanceHz)} Hz
                          </strong>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {activeProjectTab === 'filters' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  {/* Subsonic HPF */}
                  <div className="bg-[#161920] border border-white/[0.08] rounded-md p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-zinc-200">Filtr Subsonic (HPF)</span>
                      <div className="flex items-center gap-1">
                        <ImmediateNumberInput
                          min={12}
                          max={80}
                          decimals={1}
                          disabled={signal.hpfType === 'none'}
                          aria-label="Częstotliwość filtra Subsonic"
                          value={signal.hpfHz}
                          onChange={(hpfHz) => setSignal((prev) => ({ ...prev, hpfHz }))}
                          className="w-20 bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-right font-mono-num text-xs text-cyan-300 disabled:opacity-40 focus:outline-none focus:border-red-500"
                        />
                        <span className="text-[11px] text-zinc-400 font-mono-num">Hz</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {FILTER_OPTIONS.map((f) => (
                        <button
                          key={`hpf-${f.id}`}
                          type="button"
                          onClick={() => setSignal((prev) => ({ ...prev, hpfType: f.id }))}
                          className={`py-1 text-[11px] rounded border transition-colors ${
                            signal.hpfType === f.id
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-semibold'
                              : 'bg-[#08090C] border-white/[0.08] text-zinc-400 hover:text-white'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Low-Pass LPF */}
                  <div className="bg-[#161920] border border-white/[0.08] rounded-md p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-zinc-200">Filtr Low-Pass (LPF)</span>
                      <div className="flex items-center gap-1">
                        <ImmediateNumberInput
                          min={35}
                          max={300}
                          decimals={1}
                          disabled={signal.lpfType === 'none'}
                          aria-label="Częstotliwość filtra Low-Pass"
                          value={signal.lpfHz}
                          onChange={(lpfHz) => setSignal((prev) => ({ ...prev, lpfHz }))}
                          className="w-20 bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-right font-mono-num text-xs text-red-400 disabled:opacity-40 focus:outline-none focus:border-red-500"
                        />
                        <span className="text-[11px] text-zinc-400 font-mono-num">Hz</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {FILTER_OPTIONS.map((f) => (
                        <button
                          key={`lpf-${f.id}`}
                          type="button"
                          onClick={() => setSignal((prev) => ({ ...prev, lpfType: f.id }))}
                          className={`py-1 text-[11px] rounded border transition-colors ${
                            signal.lpfType === f.id
                              ? 'bg-red-500/20 border-red-500 text-red-200 font-semibold'
                              : 'bg-[#08090C] border-white/[0.08] text-zinc-400 hover:text-white'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {/* PEQ */}
                  <div className="bg-[#161920] border border-white/[0.08] rounded-md p-3 space-y-2.5">
                    <label className="flex items-center justify-between cursor-pointer select-none">
                      <span className="text-xs font-semibold text-white">
                        Korektor Parametryczny (PEQ / Bass Boost)
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(signal.peqEnabled)}
                        onChange={(e) =>
                          setSignal((prev) => ({ ...prev, peqEnabled: e.target.checked }))
                        }
                        className="accent-red-500"
                      />
                    </label>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <label className="space-y-1">
                        <span className="text-[11px] text-zinc-400 block">Częst. (Hz)</span>
                        <ImmediateNumberInput
                          min={18}
                          max={160}
                          decimals={1}
                          disabled={!signal.peqEnabled}
                          value={signal.peqHz ?? 40}
                          onChange={(peqHz) => setSignal((prev) => ({ ...prev, peqHz }))}
                          className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 font-mono-num text-white disabled:opacity-40 focus:outline-none focus:border-red-500"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-zinc-400 block">Zysk (dB)</span>
                        <ImmediateNumberInput
                          min={-15}
                          max={15}
                          decimals={1}
                          disabled={!signal.peqEnabled}
                          value={signal.peqGainDb ?? 3}
                          onChange={(peqGainDb) => setSignal((prev) => ({ ...prev, peqGainDb }))}
                          className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 font-mono-num text-white disabled:opacity-40 focus:outline-none focus:border-red-500"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-zinc-400 block">Dobroć Q</span>
                        <ImmediateNumberInput
                          min={0.3}
                          max={12}
                          decimals={2}
                          disabled={!signal.peqEnabled}
                          value={signal.peqQ ?? 2.0}
                          onChange={(peqQ) => setSignal((prev) => ({ ...prev, peqQ }))}
                          className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 font-mono-num text-white disabled:opacity-40 focus:outline-none focus:border-red-500"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Linkwitz Transform */}
                  <div className="bg-[#161920] border border-white/[0.08] rounded-md p-3 space-y-2.5">
                    <label className="flex items-center justify-between cursor-pointer select-none">
                      <span className="text-xs font-semibold text-white">
                        Transformata Linkwitza (DSP)
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(signal.ltEnabled)}
                        onChange={(e) =>
                          setSignal((prev) => ({ ...prev, ltEnabled: e.target.checked }))
                        }
                        className="accent-cyan-400"
                      />
                    </label>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <label className="space-y-1">
                        <span className="text-[11px] text-zinc-400 block">f0 (Hz)</span>
                        <ImmediateNumberInput
                          min={15}
                          max={140}
                          decimals={1}
                          disabled={!signal.ltEnabled}
                          value={signal.ltF0Hz ?? 46}
                          onChange={(ltF0Hz) => setSignal((prev) => ({ ...prev, ltF0Hz }))}
                          className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 font-mono-num text-white disabled:opacity-40 focus:outline-none focus:border-red-500"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-zinc-400 block">Q0</span>
                        <ImmediateNumberInput
                          min={0.25}
                          max={3}
                          decimals={2}
                          disabled={!signal.ltEnabled}
                          value={signal.ltQ0 ?? 0.85}
                          onChange={(ltQ0) => setSignal((prev) => ({ ...prev, ltQ0 }))}
                          className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 font-mono-num text-white disabled:opacity-40 focus:outline-none focus:border-red-500"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-zinc-400 block">fp (Hz)</span>
                        <ImmediateNumberInput
                          min={12}
                          max={120}
                          decimals={1}
                          disabled={!signal.ltEnabled}
                          value={signal.ltFpHz ?? 28}
                          onChange={(ltFpHz) => setSignal((prev) => ({ ...prev, ltFpHz }))}
                          className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 font-mono-num text-white disabled:opacity-40 focus:outline-none focus:border-red-500"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-zinc-400 block">Qp</span>
                        <ImmediateNumberInput
                          min={0.3}
                          max={2.5}
                          decimals={3}
                          disabled={!signal.ltEnabled}
                          value={signal.ltQp ?? 0.707}
                          onChange={(ltQp) => setSignal((prev) => ({ ...prev, ltQp }))}
                          className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 font-mono-num text-white disabled:opacity-40 focus:outline-none focus:border-red-500"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeProjectTab === 'signal' && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                <div className="md:col-span-5 grid grid-cols-2 gap-2.5 text-xs">
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 flex items-center justify-between">
                      <span>Moc wejściowa (W)</span>
                      <button
                        type="button"
                        onClick={() => {
                          const p = params.driverPowerW * params.driverCount;
                          setSignal((prev) => ({ ...prev, powerW: p }));
                        }}
                        className="text-[10px] text-red-400 hover:underline inline-flex items-center gap-0.5"
                      >
                        <RotateCcw className="w-2.5 h-2.5" /> RMS
                      </button>
                    </span>
                    <ImmediateNumberInput
                      min={1}
                      max={30000}
                      decimals={0}
                      value={signal.powerW}
                      onChange={(powerW) => setSignal((prev) => ({ ...prev, powerW }))}
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Rg kabli / zwrot. (Ω)</span>
                    <ImmediateNumberInput
                      min={0}
                      max={4}
                      decimals={2}
                      value={signal.seriesResistanceOhms ?? 0}
                      onChange={(seriesResistanceOhms) =>
                        setSignal((prev) => ({ ...prev, seriesResistanceOhms }))
                      }
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                </div>

                <div className="md:col-span-7 bg-[#161920] border border-white/[0.08] rounded-md p-3 space-y-2">
                  <span className="text-xs font-medium text-zinc-200 block">
                    Środowisko akustyczne (obciążenie falowe)
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {ENV_OPTIONS.map((opt) => {
                      const active =
                        (signal.environment ?? (signal.cabinGain ? 'cabin' : 'free_4pi')) ===
                        opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            setSignal((prev) => ({
                              ...prev,
                              environment: opt.id,
                              cabinGain: opt.id === 'cabin',
                            }))
                          }
                          className={`py-1.5 px-2 text-xs rounded border transition-colors whitespace-nowrap ${
                            active
                              ? 'bg-red-600 border-red-500 text-white font-semibold'
                              : 'bg-[#08090C] border-white/[0.08] text-zinc-400 hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {activeProjectTab === 'advanced' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs items-end">
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 block">Gęstość powietrza ρ (kg/m³)</span>
                  <ImmediateNumberInput
                    min={0.9}
                    max={1.4}
                    decimals={3}
                    value={signal.airDensityKgM3 ?? 1.204}
                    onChange={(airDensityKgM3) =>
                      setSignal((p) => ({ ...p, airDensityKgM3 }))
                    }
                    className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 block">Prędkość dźwięku c (m/s)</span>
                  <ImmediateNumberInput
                    min={310}
                    max={370}
                    decimals={1}
                    value={signal.speedOfSoundMs ?? 343.2}
                    onChange={(speedOfSoundMs) =>
                      setSignal((p) => ({ ...p, speedOfSoundMs }))
                    }
                    className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1.5 font-mono-num text-white focus:outline-none focus:border-red-500"
                  />
                </label>

                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setSignal((p) => ({ ...p, airDensityKgM3: 1.292, speedOfSoundMs: 331.3 }))
                    }
                    className="flex-1 py-1.5 px-2 rounded bg-[#161920] border border-white/[0.08] text-zinc-300 hover:text-white"
                  >
                    0°C (Zima)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSignal((p) => ({ ...p, airDensityKgM3: 1.204, speedOfSoundMs: 343.2 }))
                    }
                    className="flex-1 py-1.5 px-2 rounded bg-[#161920] border border-white/[0.08] text-zinc-300 hover:text-white"
                  >
                    20°C (Std)
                  </button>
                </div>
              </div>
            )}

            {activeProjectTab === 'project' && (
              <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="space-y-1">
                  <div className="text-white font-semibold">{selectedVariant.name}</div>
                  <div className="text-zinc-400 font-mono-num">
                    Głośnik: {activeDriverCountForUi}×{' '}
                    {inspectedDriverPreset.name} · {selectedElecLoad.totalNominalOhms.toFixed(1)} Ω · Vb{' '}
                    {selectedVariant.netVolumeL.toFixed(1)} L ·{' '}
                    {selectedVariant.enclosureType === 'sealed'
                      ? 'Zamknięta'
                      : `Fb ${selectedVariant.tuningHz.toFixed(1)} Hz`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={customVariants.length >= 3}
                    onClick={() => duplicateVariant(selectedVariant)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#161920] border border-white/[0.1] text-zinc-200 hover:text-white disabled:opacity-40"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Klonuj projekt</span>
                  </button>
                  {!selectedVariant.isLiveProject && (
                    <button
                      type="button"
                      onClick={() => applyVariantTo3DProject(selectedVariant)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-red-600 text-white font-semibold hover:bg-red-500"
                    >
                      <span>Wyślij do projektanta 3D</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Comparison Metrics Table */}
      <div className="bg-[#111318] border border-white/[0.08] rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Gauge className="w-4 h-4 text-red-400" />
            <span>Zestawienie parametrów porównawczych WSD</span>
          </h3>
          <span className="text-[11px] text-zinc-400 font-mono-num">
            Limit główny: Xmax = {params.driverXmax} mm · Próg portu: 0.05 Mach (17 m/s)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-white/[0.08] text-zinc-400 bg-[#08090C]">
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">Projekt / Głośnik</th>
                <th className="py-2.5 px-2 font-medium whitespace-nowrap">Pasmo F3</th>
                <th className="py-2.5 px-2 font-medium whitespace-nowrap">SPL / Max SPL</th>
                <th className="py-2.5 px-2 font-medium whitespace-nowrap">Szczyt. wychył</th>
                <th className="py-2.5 px-2 font-medium whitespace-nowrap">Prędkość (Mach)</th>
                <th className="py-2.5 px-2 font-medium whitespace-nowrap">Port / 1. rez.</th>
                <th className="py-2.5 px-2 font-medium whitespace-nowrap">Group Delay</th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">Min. Z</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] font-mono-num">
              {seriesList.map((s) => {
                const overXmax = s.peakExcursionMm > s.effectiveXmaxMm;
                const highPortVel = s.peakPortVelocityMs > 25;
                return (
                  <tr key={`row-${s.variantId}`} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 px-3 font-sans text-white max-w-[205px]">
                      <div className="flex items-center gap-2 font-medium">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="truncate">{s.name}</span>
                      </div>
                      <div className="text-[10px] text-zinc-500 pl-4.5 truncate">
                        {s.effectiveDriverCount}× {s.effectiveDriverName}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-zinc-200 whitespace-nowrap">
                      {s.f3LowHz} Hz{s.f3HighHz ? ` – ${s.f3HighHz} Hz` : ''}
                    </td>
                    <td className="py-2.5 px-2 whitespace-nowrap">
                      <span className="text-red-400 font-semibold">{s.peakSplDb.toFixed(1)}</span>
                      <span className="text-zinc-500"> / </span>
                      <span className="text-cyan-300">{s.peakMaxSplDb.toFixed(1)} dB</span>
                    </td>
                    <td
                      className={`py-2.5 px-2 whitespace-nowrap ${
                        overXmax ? 'text-amber-400 font-semibold' : 'text-emerald-400'
                      }`}
                    >
                      {s.peakExcursionMm.toFixed(1)} mm @ {s.peakExcursionHz} Hz
                    </td>
                    <td
                      className={`py-2.5 px-2 whitespace-nowrap ${
                        highPortVel ? 'text-amber-400 font-semibold' : 'text-cyan-300'
                      }`}
                    >
                      {s.peakPortVelocityMs > 0.1
                        ? `${s.peakPortVelocityMs.toFixed(1)} m/s (${s.peakPortMach.toFixed(3)}M)`
                        : '—'}
                    </td>
                    <td className="py-2.5 px-2 text-zinc-300 whitespace-nowrap">
                      {s.portLengthMm !== null && s.firstPortResonanceHz !== null
                        ? `${Math.round(s.portLengthMm)} mm · ${Math.round(s.firstPortResonanceHz)} Hz`
                        : '—'}
                    </td>
                    <td className="py-2.5 px-2 text-zinc-200 whitespace-nowrap">
                      {s.peakGroupDelayMs.toFixed(1)} ms
                    </td>
                    <td className="py-2.5 px-3 text-zinc-300 whitespace-nowrap">
                      {s.minImpedanceOhms.toFixed(2)} Ω
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full Derived Driver T-S Table + Optimal Alignments */}
      <div className="bg-[#111318] border border-white/[0.08] rounded-lg p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white flex flex-wrap items-center gap-2">
              <Sparkles className="w-4 h-4 text-red-400" />
              <span>
                Podgląd parametrów T-S i wyrównania:{' '}
                <span className="text-cyan-300">
                  {inspectedDriverPreset.name}
                </span>
              </span>
              <span className="text-[11px] font-mono-num px-2 py-0.5 rounded bg-[#08090C] border border-cyan-500/30 text-cyan-300">
                {selectedElecLoad.wiringSummaryLabel} → {selectedElecLoad.totalNominalOhms.toFixed(1)} Ω
              </span>
            </h3>
            <p className="text-xs text-zinc-400 mt-1">{alignments.recommendation}</p>
          </div>
          <button
            type="button"
            onClick={() =>
              onOpenDriverModal?.(
                inspectedDriverPreset.isCustom ? inspectedDriverPreset : null,
                inspectedDriverPreset,
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-[#161920] border border-white/[0.12] text-zinc-200 hover:text-white"
          >
            <Sliders className="w-3.5 h-3.5 text-red-400" />
            <span>
              {inspectedDriverPreset.isCustom
                ? 'Edytuj parametry T-S'
                : 'Dostosuj jako własny głośnik'}
            </span>
          </button>
        </div>

        {/* Full Derived T-S Preview Grid */}
        <div
          data-testid="wsd-driver-preview"
          className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-[11px] font-mono-num"
        >
          {[
            { label: 'Fs', val: `${derivedDriver.fs.toFixed(1)} Hz`, cls: 'text-white' },
            { label: 'Qes', val: derivedDriver.qes.toFixed(3), cls: 'text-white' },
            { label: 'Qms', val: derivedDriver.qms.toFixed(2), cls: 'text-white' },
            { label: 'Qts', val: derivedDriver.qts.toFixed(3), cls: 'text-cyan-300' },
            { label: 'Vas', val: `${derivedDriver.vas.toFixed(1)} L`, cls: 'text-white' },
            { label: 'EBP (Fs/Qes)', val: `${derivedDriver.ebpHz.toFixed(1)} Hz`, cls: 'text-cyan-300' },
            { label: 'SPL 1W/1m', val: `${derivedDriver.spl1w1m.toFixed(1)} dB`, cls: 'text-red-400' },
            { label: '2.83V/1m', val: `${derivedDriver.spl283v1m.toFixed(1)} dB`, cls: 'text-white' },
            { label: 'η0', val: `${derivedDriver.eta0Percent.toFixed(2)}%`, cls: 'text-emerald-400' },
            { label: 'Bl', val: `${derivedDriver.bl.toFixed(2)} T·m`, cls: 'text-white' },
            { label: 'Bl² / Re', val: `${derivedDriver.bl2Re.toFixed(1)} N²/W`, cls: 'text-zinc-200' },
            { label: 'Mms', val: `${derivedDriver.mms.toFixed(1)} g`, cls: 'text-white' },
            { label: 'Cms', val: `${derivedDriver.cms.toFixed(3)} mm/N`, cls: 'text-zinc-200' },
            { label: 'Rms', val: `${derivedDriver.rms.toFixed(2)} kg/s`, cls: 'text-zinc-200' },
            { label: 'Sd (łącz.)', val: `${Math.round(derivedDriver.sdCm2)} cm²`, cls: 'text-white' },
            { label: 'Vd (łącz.)', val: `${Math.round(derivedDriver.vdCm3)} cm³`, cls: 'text-white' },
            {
              label: 'Z / Re / Le',
              val: `${derivedDriver.zNom.toFixed(1)} Ω · ${derivedDriver.re.toFixed(2)} Ω · ${derivedDriver.le.toFixed(1)} mH`,
              cls: 'text-cyan-300',
            },
            {
              label: 'Pe / Xmax',
              val: `${derivedDriver.ratedPowerTotalW} W · ${derivedDriver.xmax} mm`,
              cls: 'text-red-300',
            },
          ].map((item) => (
            <div
              key={item.label}
              className="px-2.5 py-1.5 rounded bg-[#161920] border border-white/[0.06] flex items-center justify-between gap-2"
            >
              <span className="text-zinc-400">{item.label}</span>
              <strong className={item.cls}>{item.val}</strong>
            </div>
          ))}
        </div>

        {/* 6 Suggested Box Alignments (incl. Chebyshev C2 & C4) */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {alignments.suggestions.map((sug) => (
            <div
              key={sug.id}
              className="bg-[#161920] border border-white/[0.08] rounded-md p-3.5 flex flex-col justify-between gap-3"
            >
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-white">{sug.title}</div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{sug.subtitle}</p>
                <div className="pt-1 flex flex-wrap gap-2 text-[11px] font-mono-num">
                  <span className="px-2 py-0.5 rounded bg-[#08090C] text-red-300">
                    Vnet: {sug.netVolumeL} L
                  </span>
                  {sug.tuningHz !== null ? (
                    <>
                      <span className="px-2 py-0.5 rounded bg-[#08090C] text-cyan-300">
                        Fb: {sug.tuningHz} Hz
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#08090C] text-zinc-300">
                        Port: {sug.portAreaCm2} cm²
                      </span>
                    </>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-[#08090C] text-emerald-300">
                      Qtc: {sug.qtc}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-white/[0.08]">
                <button
                  type="button"
                  disabled={customVariants.length >= 3}
                  onClick={() =>
                    addCustomVariant({
                      name: sug.title.split('(')[0].trim(),
                      enclosureType: sug.enclosureType,
                      netVolumeL: sug.netVolumeL,
                      tuningHz: sug.tuningHz ?? 35,
                      portAreaCm2: sug.portAreaCm2,
                      driverPresetId: selectedVariant.driverPresetId ?? params.driverPresetId,
                      driverCount: activeDriverCountForUi,
                      voiceCoilCount: selectedElecLoad.voiceCoilCount,
                      coilNominalOhms:
                        selectedVariant.coilNominalOhms ?? params.driverCoilNominalOhms,
                      coilReOhms: selectedVariant.coilReOhms ?? params.driverCoilReOhms,
                      coilWiring: selectedElecLoad.effectiveCoilWiring,
                      wiring:
                        selectedVariant.wiring ??
                        (selectedVariant.isLiveProject ? params.driverArrayWiring : 'parallel'),
                    })
                  }
                  className="flex-1 py-1.5 px-2 text-[11px] font-medium rounded border border-white/15 text-zinc-200 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  + Porównaj
                </button>
                <button
                  type="button"
                  onClick={() => applyAlignmentToSelected(sug)}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-2 text-[11px] font-semibold rounded bg-red-600 text-white hover:bg-red-500 transition-colors"
                >
                  <span>Zastosuj</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* WSD Driver Database & Full Parameter Inspector Modal */}
      {driverCatalogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Baza i parametry głośników w WSD"
        >
          <div className="w-full max-w-5xl max-h-[88vh] flex flex-col bg-[#111318] border border-white/[0.14] rounded-lg shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 bg-[#0D0F14] border-b border-white/[0.08] flex items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-2.5">
                <Database className="w-5 h-5 text-cyan-300 shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Parametry głośników T-S i wymiary montażowe ({allDrivers.length} modeli)
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Przeglądaj parametry Deaf Bonce MF-12R D2 oraz własnych głośników T-S bez zmiany bieżącego projektu.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDriverCatalogOpen(false)}
                aria-label="Zamknij okno parametrów głośników"
                className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Filter bar */}
            <div className="px-4 py-2.5 bg-[#161920] border-b border-white/[0.08] flex flex-wrap items-center gap-2.5 shrink-0">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                  placeholder="Szukaj modelu (np. Deaf Bonce, Dayton, Sundown, 12)..."
                  className="w-full bg-[#08090C] border border-white/[0.12] rounded pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="flex items-center gap-1 bg-[#08090C] p-0.5 rounded border border-white/[0.08]">
                {(['all', '8"', '10"', '12"', '15"', '18"'] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setCatalogSizeFilter(sz)}
                    className={`px-2 py-1 text-[11px] font-mono-num rounded transition-colors ${
                      catalogSizeFilter === sz
                        ? 'bg-red-600 text-white font-semibold'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {sz === 'all' ? 'Wszystkie' : sz}
                  </button>
                ))}
              </div>
            </div>

            {/* Split Body: Driver List + Full Engineering Sheet */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
              <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-white/[0.08] overflow-y-auto cad-scroll max-h-[34vh] lg:max-h-none divide-y divide-white/[0.05]">
                {filteredCatalogDrivers.length === 0 ? (
                  <div className="p-6 text-center text-xs text-zinc-400">
                    Brak głośników pasujących do filtra.
                  </div>
                ) : (
                  filteredCatalogDrivers.map((drv) => {
                    const active = drv.id === selectedCatalogDriver.id;
                    const coilText =
                      drv.voiceCoilCount === 2
                        ? `2×${drv.coilNominalOhms ?? 2}Ω DVC`
                        : `1×${drv.coilNominalOhms ?? drv.zNom ?? 4}Ω SVC`;
                    return (
                      <button
                        key={drv.id}
                        type="button"
                        onClick={() => setCatalogDriverId(drv.id)}
                        className={`w-full text-left px-3.5 py-2.5 transition-colors flex items-center justify-between gap-2 ${
                          active
                            ? 'bg-red-600/15 border-l-2 border-l-red-500'
                            : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                            <span className="truncate">{drv.name}</span>
                            {drv.isCustom && (
                              <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 text-[9px] shrink-0">
                                Własny
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-400 font-mono-num mt-0.5 truncate">
                            {drv.sizeLabel} · {coilText} · {drv.powerW} W RMS · {drv.source ?? 'Baza'}
                          </div>
                        </div>
                        <div className="text-right font-mono-num text-[10px] text-zinc-300 shrink-0">
                          <div>Fs {drv.fs} Hz</div>
                          <div className="text-cyan-300">Qts {drv.qts.toFixed(2)}</div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="lg:col-span-7 overflow-y-auto cad-scroll p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-white/[0.08]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-semibold text-white">
                        {selectedCatalogDriver.name}
                      </h4>
                      <span className="px-2 py-0.5 rounded bg-[#161920] border border-white/[0.1] text-[10px] font-mono-num text-cyan-300">
                        {selectedCatalogDriver.sizeLabel}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Źródło: {selectedCatalogDriver.source ?? (selectedCatalogDriver.isCustom ? 'Własny T-S' : 'Deaf Bonce Datasheet')} ·{' '}
                      {selectedCatalogDriver.voiceCoilCount === 2
                        ? `2× ${selectedCatalogDriver.coilNominalOhms ?? 2} Ω (Re cewki ${(selectedCatalogDriver.coilReOhms ?? 1.8).toFixed(2)} Ω)`
                        : `1× ${selectedCatalogDriver.coilNominalOhms ?? selectedCatalogDriver.zNom ?? 4} Ω (Re ${(selectedCatalogDriver.coilReOhms ?? selectedCatalogDriver.re ?? 3.2).toFixed(2)} Ω)`}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDriverCatalogOpen(false);
                        onOpenDriverModal?.(
                          selectedCatalogDriver.isCustom ? selectedCatalogDriver : null,
                          selectedCatalogDriver,
                        );
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded bg-[#161920] border border-white/[0.12] text-zinc-200 hover:text-white"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-cyan-300" />
                      <span>{selectedCatalogDriver.isCustom ? 'Edytuj T-S' : 'Klonuj jako własny'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        updateSelectedVariant({ driverPresetId: selectedCatalogDriver.id });
                        setDriverCatalogOpen(false);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-red-600 text-white hover:bg-red-500"
                    >
                      <span>Użyj w wariancie WSD</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* T-S & Electromechanical Specs */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                    Parametry Thiele-Small, cewka i mechanika
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono-num">
                    {[
                      { label: 'Fs', val: `${solvedCatalogDriver.fs.toFixed(1)} Hz`, cls: 'text-white' },
                      { label: 'Qes', val: solvedCatalogDriver.qes.toFixed(3), cls: 'text-white' },
                      { label: 'Qms', val: solvedCatalogDriver.qms.toFixed(2), cls: 'text-white' },
                      { label: 'Qts', val: solvedCatalogDriver.qts.toFixed(3), cls: 'text-cyan-300' },
                      { label: 'Vas', val: `${solvedCatalogDriver.vas.toFixed(1)} L`, cls: 'text-white' },
                      { label: 'EBP (Fs/Qes)', val: `${solvedCatalogDriver.ebpHz.toFixed(1)} Hz`, cls: 'text-cyan-300' },
                      { label: 'SPL 1W/1m', val: `${solvedCatalogDriver.spl1w1m.toFixed(1)} dB`, cls: 'text-red-400' },
                      { label: '2.83V/1m', val: `${solvedCatalogDriver.spl283v1m.toFixed(1)} dB`, cls: 'text-white' },
                      { label: 'η0 (sprawn.)', val: `${solvedCatalogDriver.eta0Percent.toFixed(2)}%`, cls: 'text-emerald-400' },
                      { label: 'Bl', val: `${solvedCatalogDriver.bl.toFixed(2)} T·m`, cls: 'text-white' },
                      { label: 'Bl² / Re', val: `${solvedCatalogDriver.bl2Re.toFixed(1)} N²/W`, cls: 'text-zinc-200' },
                      { label: 'Mms', val: `${solvedCatalogDriver.mms.toFixed(1)} g`, cls: 'text-white' },
                      { label: 'Cms', val: `${solvedCatalogDriver.cms.toFixed(3)} mm/N`, cls: 'text-zinc-200' },
                      { label: 'Rms', val: `${solvedCatalogDriver.rms.toFixed(2)} kg/s`, cls: 'text-zinc-200' },
                      { label: 'Sd / Dd', val: `${Math.round(solvedCatalogDriver.sd)} cm² / ${Math.round(solvedCatalogDriver.dd)} mm`, cls: 'text-white' },
                      { label: 'Vd (1 szt.)', val: `${Math.round(solvedCatalogDriver.vd)} cm³`, cls: 'text-white' },
                      { label: 'Xmax', val: `${selectedCatalogDriver.xmax} mm`, cls: 'text-amber-300' },
                      { label: 'Moc RMS (Pe)', val: `${selectedCatalogDriver.powerW} W`, cls: 'text-red-300' },
                      { label: 'Re (szereg.)', val: `${solvedCatalogDriver.re.toFixed(2)} Ω`, cls: 'text-cyan-300' },
                      { label: 'Le', val: `${(selectedCatalogDriver.le ?? 1.8).toFixed(2)} mH`, cls: 'text-zinc-200' },
                    ].map((row) => (
                      <div
                        key={row.label}
                        className="px-2.5 py-1.5 rounded bg-[#161920] border border-white/[0.06] flex items-center justify-between gap-2"
                      >
                        <span className="text-zinc-400">{row.label}</span>
                        <strong className={row.cls}>{row.val}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                {/* CAD Mounting Dimensions */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                    Wymiary montażowe CAD 3D
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono-num">
                    <div className="px-2.5 py-1.5 rounded bg-[#161920] border border-white/[0.06] flex justify-between">
                      <span className="text-zinc-400">Otwór</span>
                      <strong className="text-white">{selectedCatalogDriver.cutoutDia} mm</strong>
                    </div>
                    <div className="px-2.5 py-1.5 rounded bg-[#161920] border border-white/[0.06] flex justify-between">
                      <span className="text-zinc-400">Kosz zewn.</span>
                      <strong className="text-white">{selectedCatalogDriver.outerDia} mm</strong>
                    </div>
                    <div className="px-2.5 py-1.5 rounded bg-[#161920] border border-white/[0.06] flex justify-between">
                      <span className="text-zinc-400">Głębokość</span>
                      <strong className="text-white">{selectedCatalogDriver.depth} mm</strong>
                    </div>
                    <div className="px-2.5 py-1.5 rounded bg-[#161920] border border-white/[0.06] flex justify-between">
                      <span className="text-zinc-400">Wyporność</span>
                      <strong className="text-white">{selectedCatalogDriver.displacement} L</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
