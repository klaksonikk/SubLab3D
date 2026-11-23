import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FileUp,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import {
  buildCustomDriverPreset,
  computeElectricalLoad,
  driverPresetToSolverInput,
  solveThieleSmall,
  type MechSolveMode,
  type MotorSolveMode,
  type QSolveMode,
  type SdInputMode,
  type TsSolverInput,
} from '../engine/tsSolver';
import {
  parseWinIsdWdr,
  type WdrUnitPreference,
  type WdrUnitSystem,
} from '../engine/winisdWdr';
import type { CoilWiringMode, DriverPreset, VoiceCoilCount } from '../engine/types';
import {
  fromDisplayArea,
  fromDisplayLen,
  fromDisplayMassG,
  fromDisplayVol,
  getUnitLabels,
  toDisplayArea,
  toDisplayLen,
  toDisplayMassG,
  toDisplaySmallVol,
  toDisplayVol,
} from '../engine/units';
import { useI18n } from '../i18n';
import { ImmediateNumberInput } from './ImmediateNumberInput';

interface DriverTsModalProps {
  open: boolean;
  editingDriver: DriverPreset | null;
  initialTemplateDriver: DriverPreset;
  onClose: () => void;
  onSaveDriver: (
    driver: DriverPreset,
    applyToProjectToo: boolean,
    chosenCoilWiring: CoilWiringMode,
  ) => void;
}

const SIZE_CAD_DEFAULTS: Record<
  string,
  { cutoutDia: number; outerDia: number; depth: number; displacement: number; dd: number }
> = {
  '8"': { cutoutDia: 184, outerDia: 212, depth: 112, displacement: 1.2, dd: 162 },
  '10"': { cutoutDia: 232, outerDia: 266, depth: 140, displacement: 1.9, dd: 204 },
  '12"': { cutoutDia: 282, outerDia: 318, depth: 168, displacement: 2.8, dd: 248 },
  '15"': { cutoutDia: 354, outerDia: 392, depth: 215, displacement: 5.5, dd: 312 },
  '18"': { cutoutDia: 422, outerDia: 465, depth: 248, displacement: 7.8, dd: 372 },
};

function splitBrandModel(fullName: string): { brand: string; model: string } {
  const trimmed = fullName.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx > 0) {
    return {
      brand: trimmed.slice(0, spaceIdx),
      model: trimmed.slice(spaceIdx + 1),
    };
  }
  return { brand: '', model: trimmed };
}

export function DriverTsModal({
  open,
  editingDriver,
  initialTemplateDriver,
  onClose,
  onSaveDriver,
}: DriverTsModalProps) {
  const { lang, unitSystem } = useI18n();
  const en = lang === 'en';
  const u = getUnitLabels(unitSystem);
  const isImp = unitSystem === 'imperial';
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [sizeLabel, setSizeLabel] = useState('12"');
  const [solverInput, setSolverInput] = useState<TsSolverInput>(() =>
    driverPresetToSolverInput(initialTemplateDriver),
  );
  const [cutoutDia, setCutoutDia] = useState(282);
  const [outerDia, setOuterDia] = useState(318);
  const [depth, setDepth] = useState(168);
  const [displacement, setDisplacement] = useState(2.8);
  const [applyToProjectToo, setApplyToProjectToo] = useState(true);
  const [nameError, setNameError] = useState<string | null>(null);
  const [wdrState, setWdrState] = useState<{
    fileName: string;
    rawContent: string;
    detectedUnitSystem: WdrUnitSystem;
    unitPreference: WdrUnitPreference;
    warnings: string[];
  } | null>(null);
  const [wdrError, setWdrError] = useState<string | null>(null);
  const wdrInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const src = editingDriver ?? initialTemplateDriver;
    if (editingDriver) {
      const split = splitBrandModel(editingDriver.name);
      setBrand(split.brand);
      setModel(split.model);
    } else {
      setBrand('');
      setModel('');
    }
    const matchedSize =
      Object.keys(SIZE_CAD_DEFAULTS).find((k) => src.sizeLabel.includes(k)) ?? '12"';
    setSizeLabel(matchedSize);
    setSolverInput(driverPresetToSolverInput(src));
    setCutoutDia(src.cutoutDia);
    setOuterDia(src.outerDia);
    setDepth(src.depth);
    setDisplacement(src.displacement);
    setNameError(null);
    setWdrState(null);
    setWdrError(null);
  }, [open, editingDriver, initialTemplateDriver]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const applyParsedWdr = (
    rawContent: string,
    fileName: string,
    unitPreference: WdrUnitPreference,
  ) => {
    const parsed = parseWinIsdWdr(rawContent, fileName, unitPreference, lang);
    if (!parsed.ok) {
      setWdrError(parsed.error);
      setWdrState(null);
      return;
    }
    setWdrError(null);
    setBrand(parsed.brand);
    setModel(parsed.model);
    setSizeLabel(parsed.sizeLabel);
    setSolverInput(parsed.solverInput);
    setCutoutDia(parsed.mounting.cutoutDia);
    setOuterDia(parsed.mounting.outerDia);
    setDepth(parsed.mounting.depth);
    setDisplacement(parsed.mounting.displacement);
    setNameError(null);
    setWdrState({
      fileName,
      rawContent,
      detectedUnitSystem: parsed.detectedUnitSystem,
      unitPreference,
      warnings: parsed.warnings,
    });
  };

  const handleWdrFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      applyParsedWdr(text, file.name, 'auto');
    } catch {
      setWdrError(
        en ? 'Could not read the selected .wdr file.' : 'Nie udało się odczytać wybranego pliku .wdr.',
      );
    }
    e.target.value = '';
  };

  const solved = useMemo(() => solveThieleSmall(solverInput, lang), [solverInput, lang]);
  const coilLoad = useMemo(
    () =>
      computeElectricalLoad(
        {
          voiceCoilCount: solverInput.voiceCoilCount,
          coilNominalOhms: solverInput.coilNominalOhms,
          coilReOhms: solverInput.coilReOhms,
          baseLeMh: solverInput.le,
          coilWiring: solverInput.coilWiring,
          driverCount: 1,
          arrayWiring: 'parallel',
        },
        lang,
      ),
    [
      solverInput.voiceCoilCount,
      solverInput.coilNominalOhms,
      solverInput.coilReOhms,
      solverInput.le,
      solverInput.coilWiring,
      lang,
    ],
  );

  if (!open) return null;

  const isQAuto = (which: 'qes' | 'qms' | 'qts') => {
    if (solverInput.motorSolveMode === 'solve_qes_from_bl') {
      if (which === 'qes') return true;
      if (solverInput.qSolveMode === 'solve_qms') return which === 'qms';
      return which === 'qts';
    }
    return (
      (solverInput.qSolveMode === 'solve_qts' && which === 'qts') ||
      (solverInput.qSolveMode === 'solve_qes' && which === 'qes') ||
      (solverInput.qSolveMode === 'solve_qms' && which === 'qms')
    );
  };

  const setAutoQ = (mode: QSolveMode) => {
    setSolverInput((prev) => ({
      ...prev,
      qSolveMode: mode,
      qes: Number(solved.qes.toFixed(3)),
      qms: Number(solved.qms.toFixed(2)),
      qts: Number(solved.qts.toFixed(3)),
    }));
  };

  const setMechMode = (mode: MechSolveMode) => {
    setSolverInput((prev) => ({
      ...prev,
      mechSolveMode: mode,
      fs: Number(solved.fs.toFixed(2)),
      vas: Number(solved.vas.toFixed(2)),
      mms: Number(solved.mms.toFixed(1)),
      cms: Number(solved.cms.toFixed(3)),
    }));
  };

  const setMotorMode = (mode: MotorSolveMode) => {
    setSolverInput((prev) => ({
      ...prev,
      motorSolveMode: mode,
      bl: Number(solved.bl.toFixed(2)),
      qes: Number(solved.qes.toFixed(3)),
      qts: Number(solved.qts.toFixed(3)),
    }));
  };

  const setSdMode = (mode: SdInputMode) => {
    setSolverInput((prev) => ({
      ...prev,
      sdInputMode: mode,
      sd: Number(solved.sd.toFixed(1)),
      dd: Math.round(solved.dd),
    }));
  };

  const handleVoiceCoilCountChange = (count: VoiceCoilCount) => {
    setSolverInput((prev) => ({
      ...prev,
      voiceCoilCount: count,
      coilWiring: count === 2 ? (prev.coilWiring === 'single' ? 'parallel' : prev.coilWiring) : 'single',
    }));
  };

  const handleSizePreset = (sz: string) => {
    setSizeLabel(sz);
    const cad = SIZE_CAD_DEFAULTS[sz];
    if (!cad) return;
    setCutoutDia(cad.cutoutDia);
    setOuterDia(cad.outerDia);
    setDepth(cad.depth);
    setDisplacement(cad.displacement);
    const area = Math.PI * Math.pow(cad.dd / 20, 2);
    setSolverInput((prev) => ({
      ...prev,
      dd: cad.dd,
      sd: Number(area.toFixed(1)),
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!model.trim() && !brand.trim()) {
      setNameError(en ? 'Enter speaker brand or model name.' : 'Podaj nazwę lub model głośnika.');
      return;
    }
    const id =
      editingDriver?.id ??
      `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const preset = buildCustomDriverPreset(
      id,
      brand,
      model,
      sizeLabel,
      solved,
      {
        cutoutDia,
        outerDia,
        depth,
        displacement,
      },
      solverInput.le,
      lang,
    );
    onSaveDriver(preset, applyToProjectToo, coilLoad.effectiveCoilWiring);
    onClose();
  };

  const fsAuto = solverInput.mechSolveMode === 'from_mms_cms';
  const vasAuto = solverInput.mechSolveMode !== 'from_fs_vas';
  const mmsAuto = solverInput.mechSolveMode === 'from_fs_vas';
  const cmsAuto = solverInput.mechSolveMode !== 'from_mms_cms';
  const blAuto = solverInput.motorSolveMode === 'solve_bl';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="driver-ts-modal-title"
    >
      <div className="w-full max-w-4xl max-h-[94vh] flex flex-col bg-[#111318] border border-white/[0.12] rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-3.5 sm:px-5 py-3 sm:py-3.5 bg-[#0D0F14] border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2.5 sm:gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <Cpu className="w-5 h-5 text-red-400 shrink-0" />
            <div className="min-w-0">
              <h2 id="driver-ts-modal-title" className="text-sm font-semibold text-white leading-snug">
                {editingDriver
                  ? en
                    ? `T-S Driver Editor: ${editingDriver.name}`
                    : `Edytor głośnika T-S: ${editingDriver.name}`
                  : en
                    ? 'New Custom Driver — Database & T-S Calculator'
                    : 'Nowy własny głośnik — Baza i kalkulator T-S'}
              </h2>
              <p className="text-[11px] text-zinc-400 line-clamp-2">
                {en
                  ? 'Enter datasheet parameters — all interdependent T-S values and voice coil impedance update live.'
                  : 'Wpisz parametry z noty katalogowej — wszystkie wartości T-S oraz impedancja cewek wyliczają się na żywo.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="modal-import-wdr-btn"
              onClick={() => wdrInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded bg-[#161920] border border-cyan-500/35 text-cyan-300 hover:bg-cyan-500/10 transition-colors whitespace-nowrap"
            >
              <FileUp className="w-3.5 h-3.5" />
              <span>
                {en ? 'Load .wdr' : 'Wczytaj .wdr'}
                <span className="hidden sm:inline"> (WinISD)</span>
              </span>
            </button>
            <input
              ref={wdrInputRef}
              data-testid="modal-import-wdr-input"
              type="file"
              accept=".wdr,.txt"
              className="hidden"
              onChange={handleWdrFileChange}
            />
            <button
              type="button"
              onClick={onClose}
              aria-label={en ? 'Close driver editor' : 'Zamknij edytor głośnika'}
              className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <form noValidate onSubmit={handleSave} className="flex-1 overflow-y-auto cad-scroll p-3.5 sm:p-5 space-y-4 sm:space-y-5">
          {wdrError && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-md px-3 py-2 text-xs text-rose-300 flex items-center justify-between gap-2">
              <span>{wdrError}</span>
              <button
                type="button"
                onClick={() => setWdrError(null)}
                aria-label={en ? 'Dismiss .wdr error message' : 'Zamknij komunikat błędu .wdr'}
                className="text-rose-300 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {wdrState && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-md px-3 py-2.5 text-xs space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-cyan-200">
                  {en ? 'Loaded from WinISD: ' : 'Wczytano z WinISD: '}
                  <strong className="text-white">{wdrState.fileName}</strong> ·{' '}
                  <span className="font-mono-num">
                    {en ? 'Units: ' : 'Jednostki: '}
                    {wdrState.detectedUnitSystem === 'si'
                      ? 'WinISD Pro SI (m³, m², kg, m)'
                      : en
                        ? 'Practical (L, cm², g, mm)'
                        : 'Praktyczne (L, cm², g, mm)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    applyParsedWdr(
                      wdrState.rawContent,
                      wdrState.fileName,
                      wdrState.detectedUnitSystem === 'si' ? 'practical' : 'si',
                    )
                  }
                  className="px-2 py-1 rounded bg-[#08090C] border border-cyan-500/40 text-[11px] text-cyan-300 hover:bg-cyan-500/15 transition-colors"
                >
                  {en ? 'Switch to ' : 'Przełącz na '}
                  {wdrState.detectedUnitSystem === 'si'
                    ? 'L / cm² / g / mm'
                    : 'SI (m³ / m² / kg / m)'}
                </button>
              </div>
              {wdrState.warnings.length > 0 && (
                <div className="text-[11px] text-amber-300 space-y-0.5">
                  {wdrState.warnings.map((w, i) => (
                    <div key={i}>• {w}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Identity & Size Row */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 bg-[#161920] border border-white/[0.08] rounded-md p-3.5">
            <label className="sm:col-span-4 space-y-1">
              <span className="text-[11px] text-zinc-400 block">
                {en ? 'Brand / Manufacturer' : 'Marka (Brand)'}
              </span>
              <input
                type="text"
                placeholder={en ? 'e.g. Sundown / Dayton' : 'np. Sundown / Dayton'}
                value={brand}
                onChange={(e) => {
                  setBrand(e.target.value);
                  setNameError(null);
                }}
                className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
              />
            </label>

            <label className="sm:col-span-5 space-y-1">
              <span className="text-[11px] text-zinc-400 block">
                {en ? 'Speaker Model *' : 'Model głośnika *'}
              </span>
              <input
                type="text"
                placeholder={en ? 'e.g. SA-12 Rev.3 / UM12-22' : 'np. SA-12 Rev.3 / UM12-22'}
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setNameError(null);
                }}
                className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
              />
            </label>

            <div className="sm:col-span-3 space-y-1">
              <span className="text-[11px] text-zinc-400 block">
                {en ? 'Basket Size' : 'Rozmiar kosza'}
              </span>
              <div className="grid grid-cols-5 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]">
                {(['8"', '10"', '12"', '15"', '18"'] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => handleSizePreset(sz)}
                    className={`py-1 text-[11px] font-mono-num rounded transition-colors ${
                      sizeLabel === sz
                        ? 'bg-red-600 text-white font-semibold'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            {nameError && (
              <div className="sm:col-span-12 text-xs text-rose-400">{nameError}</div>
            )}
          </div>

          {/* T-S Auto-Calculation Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Column 1: Q-Triad & Voice Coil Spec */}
            <div className="lg:col-span-4 bg-[#161920] border border-white/[0.08] rounded-md p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">
                  {en ? 'Q Triad & Voice Coils' : 'Dobroć Q i Cewki'}
                </span>
                <button
                  type="button"
                  onClick={() => setSolverInput(driverPresetToSolverInput(initialTemplateDriver))}
                  className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white"
                  title={en ? 'Restore baseline T-S values' : 'Przywróć bazowe wartości T-S'}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>

              {/* Qes / Qms / Qts Triad */}
              <div className="space-y-2">
                {/* Qes */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <label htmlFor="ts-qes" className="text-zinc-300">
                      {en ? 'Qes (electrical Q)' : 'Qes (dobroć elektr.)'}
                    </label>
                    <button
                      type="button"
                      disabled={solverInput.motorSolveMode === 'solve_qes_from_bl'}
                      onClick={() => setAutoQ('solve_qes')}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono-num border ${
                        isQAuto('qes')
                          ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300 font-semibold'
                          : 'bg-[#08090C] border-white/[0.1] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {isQAuto('qes') ? 'AUTO' : en ? 'Solve Qes' : 'Wyliczaj Qes'}
                    </button>
                  </div>
                  <ImmediateNumberInput
                    id="ts-qes"
                    min={0.08}
                    max={2.5}
                    decimals={3}
                    disabled={isQAuto('qes')}
                    value={isQAuto('qes') ? solved.qes : solverInput.qes}
                    onChange={(qes) => setSolverInput((p) => ({ ...p, qes }))}
                    className={`w-full rounded px-2.5 py-1.5 text-xs font-mono-num focus:outline-none ${
                      isQAuto('qes')
                        ? 'bg-[#0B1218] border border-cyan-500/35 text-cyan-300'
                        : 'bg-[#08090C] border border-white/[0.1] text-white focus:border-red-500'
                    }`}
                  />
                </div>

                {/* Qms */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <label htmlFor="ts-qms" className="text-zinc-300">
                      {en ? 'Qms (mechanical Q)' : 'Qms (dobroć mech.)'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setAutoQ('solve_qms')}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono-num border ${
                        isQAuto('qms')
                          ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300 font-semibold'
                          : 'bg-[#08090C] border-white/[0.1] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {isQAuto('qms') ? 'AUTO' : en ? 'Solve Qms' : 'Wyliczaj Qms'}
                    </button>
                  </div>
                  <ImmediateNumberInput
                    id="ts-qms"
                    min={0.5}
                    max={20}
                    decimals={2}
                    disabled={isQAuto('qms')}
                    value={isQAuto('qms') ? solved.qms : solverInput.qms}
                    onChange={(qms) => setSolverInput((p) => ({ ...p, qms }))}
                    className={`w-full rounded px-2.5 py-1.5 text-xs font-mono-num focus:outline-none ${
                      isQAuto('qms')
                        ? 'bg-[#0B1218] border border-cyan-500/35 text-cyan-300'
                        : 'bg-[#08090C] border border-white/[0.1] text-white focus:border-red-500'
                    }`}
                  />
                </div>

                {/* Qts */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <label htmlFor="ts-qts" className="text-zinc-300">
                      {en ? 'Qts (total Q)' : 'Qts (dobroć całk.)'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setAutoQ('solve_qts')}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono-num border ${
                        isQAuto('qts')
                          ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300 font-semibold'
                          : 'bg-[#08090C] border-white/[0.1] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {isQAuto('qts') ? 'AUTO' : en ? 'Solve Qts' : 'Wyliczaj Qts'}
                    </button>
                  </div>
                  <ImmediateNumberInput
                    id="ts-qts"
                    min={0.08}
                    max={2.0}
                    decimals={3}
                    disabled={isQAuto('qts')}
                    value={isQAuto('qts') ? solved.qts : solverInput.qts}
                    onChange={(qts) => setSolverInput((p) => ({ ...p, qts }))}
                    className={`w-full rounded px-2.5 py-1.5 text-xs font-mono-num focus:outline-none ${
                      isQAuto('qts')
                        ? 'bg-[#0B1218] border border-cyan-500/35 text-cyan-300'
                        : 'bg-[#08090C] border border-white/[0.1] text-white focus:border-red-500'
                    }`}
                  />
                </div>
              </div>

              {/* Electrical Voice Coil Specs */}
              <div className="pt-2.5 border-t border-white/[0.06] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-zinc-300">
                    {en ? 'Voice Coils' : 'Ilość cewek'}
                  </span>
                  <div className="grid grid-cols-2 gap-1 bg-[#08090C] p-0.5 rounded border border-white/[0.08]">
                    {([1, 2] as const).map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => handleVoiceCoilCountChange(cnt)}
                        className={`px-2 py-0.5 text-[10px] font-mono-num rounded ${
                          solverInput.voiceCoilCount === cnt
                            ? 'bg-red-600 text-white font-semibold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {cnt === 1 ? '1× SVC' : '2× DVC'}
                      </button>
                    ))}
                  </div>
                </div>

                {solverInput.voiceCoilCount === 2 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-300">
                      {en ? 'Coil Wiring' : 'Łączenie cewek'}
                    </span>
                    <div className="grid grid-cols-2 gap-1 bg-[#08090C] p-0.5 rounded border border-white/[0.08]">
                      {(
                        [
                          { id: 'parallel', label: en ? 'Parallel' : 'Równoległe' },
                          { id: 'series', label: en ? 'Series' : 'Szeregowe' },
                        ] as const
                      ).map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => setSolverInput((p) => ({ ...p, coilWiring: w.id }))}
                          className={`px-2 py-0.5 text-[10px] rounded ${
                            coilLoad.effectiveCoilWiring === w.id
                              ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/40'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          {w.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="text-[10px] text-zinc-400 block">
                      {en ? 'Coil Z (Ω)' : 'Z cewki (Ω)'}
                    </span>
                    <ImmediateNumberInput
                      min={0.5}
                      max={16}
                      decimals={2}
                      value={solverInput.coilNominalOhms}
                      onChange={(coilNominalOhms) =>
                        setSolverInput((p) => ({ ...p, coilNominalOhms }))
                      }
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-zinc-400 block">
                      {en ? 'Coil Re (Ω)' : 'Re cewki (Ω)'}
                    </span>
                    <ImmediateNumberInput
                      min={0.2}
                      max={16}
                      decimals={2}
                      value={solverInput.coilReOhms}
                      onChange={(coilReOhms) => setSolverInput((p) => ({ ...p, coilReOhms }))}
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-zinc-400 block">
                      {solverInput.voiceCoilCount === 2
                        ? en
                          ? 'Le series (mH)'
                          : 'Le szer. (mH)'
                        : 'Le (mH)'}
                    </span>
                    <ImmediateNumberInput
                      min={0}
                      max={20}
                      decimals={2}
                      value={solverInput.le}
                      onChange={(le) => setSolverInput((p) => ({ ...p, le }))}
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                </div>

                <div className="bg-[#08090C] border border-cyan-500/25 rounded px-2.5 py-1.5 flex items-center justify-between text-[11px] font-mono-num">
                  <span className="text-zinc-400">
                    {en ? 'Resultant (1 pc.):' : 'Wypadkowo (1 szt.):'}
                  </span>
                  <strong className="text-cyan-300">
                    {coilLoad.singleDriverNominalOhms.toFixed(1)} Ω · Re {coilLoad.singleDriverReOhms.toFixed(2)} Ω
                  </strong>
                </div>
              </div>
            </div>

            {/* Column 2: Suspension Mechanics (Fs / Vas / Mms / Cms / Sd) */}
            <div className="lg:col-span-4 bg-[#161920] border border-white/[0.08] rounded-md p-3.5 space-y-3">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-white block">
                  {en ? 'Cone & Suspension Mechanics' : 'Mechanika membrany i zawieszenia'}
                </span>
                <div className="grid grid-cols-3 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]">
                  {(
                    [
                      { id: 'from_fs_vas', label: 'Fs + Vas' },
                      { id: 'from_mms_cms', label: 'Mms + Cms' },
                      { id: 'from_fs_mms', label: 'Fs + Mms' },
                    ] as Array<{ id: MechSolveMode; label: string }>
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMechMode(m.id)}
                      className={`py-1 text-[10px] rounded transition-colors ${
                        solverInput.mechSolveMode === m.id
                          ? 'bg-red-600 text-white font-semibold'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 flex items-center justify-between">
                    <span>Fs (Hz)</span>
                    {fsAuto && <span className="text-[9px] text-cyan-300 font-mono-num">AUTO</span>}
                  </span>
                  <ImmediateNumberInput
                    min={10}
                    max={250}
                    decimals={2}
                    disabled={fsAuto}
                    value={fsAuto ? solved.fs : solverInput.fs}
                    onChange={(fs) => setSolverInput((p) => ({ ...p, fs }))}
                    className={`w-full rounded px-2 py-1.5 text-xs font-mono-num focus:outline-none ${
                      fsAuto
                        ? 'bg-[#0B1218] border border-cyan-500/35 text-cyan-300'
                        : 'bg-[#08090C] border border-white/[0.1] text-white focus:border-red-500'
                    }`}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 flex items-center justify-between">
                    <span>Vas ({u.vol})</span>
                    {vasAuto && <span className="text-[9px] text-cyan-300 font-mono-num">AUTO</span>}
                  </span>
                  <ImmediateNumberInput
                    min={toDisplayVol(1, unitSystem)}
                    max={toDisplayVol(1000, unitSystem)}
                    decimals={isImp ? 3 : 2}
                    disabled={vasAuto}
                    value={toDisplayVol(vasAuto ? solved.vas : solverInput.vas, unitSystem)}
                    onChange={(vas) =>
                      setSolverInput((p) => ({ ...p, vas: fromDisplayVol(vas, unitSystem) }))
                    }
                    className={`w-full rounded px-2 py-1.5 text-xs font-mono-num focus:outline-none ${
                      vasAuto
                        ? 'bg-[#0B1218] border border-cyan-500/35 text-cyan-300'
                        : 'bg-[#08090C] border border-white/[0.1] text-white focus:border-red-500'
                    }`}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 flex items-center justify-between">
                    <span>Mms ({u.mass})</span>
                    {mmsAuto && <span className="text-[9px] text-cyan-300 font-mono-num">AUTO</span>}
                  </span>
                  <ImmediateNumberInput
                    min={toDisplayMassG(5, unitSystem)}
                    max={toDisplayMassG(2000, unitSystem)}
                    decimals={isImp ? 2 : 1}
                    disabled={mmsAuto}
                    value={toDisplayMassG(mmsAuto ? solved.mms : solverInput.mms, unitSystem)}
                    onChange={(mms) =>
                      setSolverInput((p) => ({ ...p, mms: fromDisplayMassG(mms, unitSystem) }))
                    }
                    className={`w-full rounded px-2 py-1.5 text-xs font-mono-num focus:outline-none ${
                      mmsAuto
                        ? 'bg-[#0B1218] border border-cyan-500/35 text-cyan-300'
                        : 'bg-[#08090C] border border-white/[0.1] text-white focus:border-red-500'
                    }`}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 flex items-center justify-between">
                    <span>Cms (mm/N)</span>
                    {cmsAuto && <span className="text-[9px] text-cyan-300 font-mono-num">AUTO</span>}
                  </span>
                  <ImmediateNumberInput
                    min={0.01}
                    max={10}
                    decimals={3}
                    disabled={cmsAuto}
                    value={cmsAuto ? solved.cms : solverInput.cms}
                    onChange={(cms) => setSolverInput((p) => ({ ...p, cms }))}
                    className={`w-full rounded px-2 py-1.5 text-xs font-mono-num focus:outline-none ${
                      cmsAuto
                        ? 'bg-[#0B1218] border border-cyan-500/35 text-cyan-300'
                        : 'bg-[#08090C] border border-white/[0.1] text-white focus:border-red-500'
                    }`}
                  />
                </label>
              </div>

              {/* Sd / Dd and Bl */}
              <div className="pt-2 border-t border-white/[0.06] space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-400">
                    {en ? 'Cone Area Sd / Dd' : 'Membrana Sd / Dd'}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setSdMode('direct_sd')}
                      className={`px-1.5 py-0.5 rounded text-[10px] ${
                        solverInput.sdInputMode === 'direct_sd'
                          ? 'bg-red-600 text-white'
                          : 'bg-[#08090C] text-zinc-400'
                      }`}
                    >
                      Sd ({u.area})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSdMode('from_dd')}
                      className={`px-1.5 py-0.5 rounded text-[10px] ${
                        solverInput.sdInputMode === 'from_dd'
                          ? 'bg-red-600 text-white'
                          : 'bg-[#08090C] text-zinc-400'
                      }`}
                    >
                      {en ? `from Dd (${u.len})` : `z Dd (${u.len})`}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">
                      {solverInput.sdInputMode === 'direct_sd'
                        ? `Sd (${u.area})`
                        : en
                          ? `Dd eff. (${u.len})`
                          : `Dd efekt. (${u.len})`}
                    </span>
                    <ImmediateNumberInput
                      min={
                        solverInput.sdInputMode === 'direct_sd'
                          ? toDisplayArea(15, unitSystem)
                          : toDisplayLen(40, unitSystem)
                      }
                      max={
                        solverInput.sdInputMode === 'direct_sd'
                          ? toDisplayArea(3000, unitSystem)
                          : toDisplayLen(3000, unitSystem)
                      }
                      decimals={isImp ? 2 : 1}
                      value={
                        solverInput.sdInputMode === 'direct_sd'
                          ? toDisplayArea(solverInput.sd, unitSystem)
                          : toDisplayLen(solverInput.dd, unitSystem)
                      }
                      onChange={(val) =>
                        setSolverInput((p) =>
                          p.sdInputMode === 'direct_sd'
                            ? { ...p, sd: fromDisplayArea(val, unitSystem) }
                            : { ...p, dd: fromDisplayLen(val, unitSystem) },
                        )
                      }
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 flex items-center justify-between">
                      <span>Bl (T·m)</span>
                      <button
                        type="button"
                        onClick={() =>
                          setMotorMode(blAuto ? 'solve_qes_from_bl' : 'solve_bl')
                        }
                        className={`px-1 rounded text-[9px] font-mono-num ${
                          blAuto
                            ? 'bg-cyan-500/20 text-cyan-300'
                            : 'bg-red-500/20 text-red-300'
                        }`}
                      >
                        {blAuto ? 'AUTO' : en ? 'Bl→Qes' : 'Z Bl→Qes'}
                      </button>
                    </span>
                    <ImmediateNumberInput
                      min={1}
                      max={100}
                      decimals={2}
                      disabled={blAuto}
                      value={blAuto ? solved.bl : solverInput.bl}
                      onChange={(bl) => setSolverInput((p) => ({ ...p, bl }))}
                      className={`w-full rounded px-2 py-1 text-xs font-mono-num focus:outline-none ${
                        blAuto
                          ? 'bg-[#0B1218] border border-cyan-500/35 text-cyan-300'
                          : 'bg-[#08090C] border border-white/[0.1] text-white focus:border-red-500'
                      }`}
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Column 3: Limits, Live Calculated Output & 3D Mounting */}
            <div className="lg:col-span-4 space-y-3">
              {/* Limits & 3D Mounting */}
              <div className="bg-[#161920] border border-white/[0.08] rounded-md p-3.5 space-y-2.5">
                <span className="text-xs font-semibold text-white block">
                  {en ? 'Power Limits & 3D Mounting' : 'Granice pracy i wymiary 3D'}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Xmax ({u.len})</span>
                    <ImmediateNumberInput
                      min={toDisplayLen(1, unitSystem)}
                      max={toDisplayLen(80, unitSystem)}
                      decimals={isImp ? 2 : 1}
                      value={toDisplayLen(solverInput.xmax, unitSystem)}
                      onChange={(xmax) =>
                        setSolverInput((p) => ({ ...p, xmax: fromDisplayLen(xmax, unitSystem) }))
                      }
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">
                      {en ? 'RMS Power Pe (W)' : 'Moc Pe RMS (W)'}
                    </span>
                    <ImmediateNumberInput
                      min={25}
                      max={15000}
                      decimals={0}
                      value={solverInput.powerW}
                      onChange={(powerW) => setSolverInput((p) => ({ ...p, powerW }))}
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">
                      {en ? `CAD Cutout (${u.len})` : `Otwór CAD (${u.len})`}
                    </span>
                    <ImmediateNumberInput
                      min={toDisplayLen(80, unitSystem)}
                      max={toDisplayLen(500, unitSystem)}
                      decimals={isImp ? 2 : 0}
                      value={toDisplayLen(cutoutDia, unitSystem)}
                      onChange={(v) => setCutoutDia(fromDisplayLen(v, unitSystem))}
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">
                      {en ? `Outer Frame (${u.len})` : `Kosz zewn. (${u.len})`}
                    </span>
                    <ImmediateNumberInput
                      min={toDisplayLen(100, unitSystem)}
                      max={toDisplayLen(560, unitSystem)}
                      decimals={isImp ? 2 : 0}
                      value={toDisplayLen(outerDia, unitSystem)}
                      onChange={(v) => setOuterDia(fromDisplayLen(v, unitSystem))}
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">
                      {en ? `Depth (${u.len})` : `Głębokość (${u.len})`}
                    </span>
                    <ImmediateNumberInput
                      min={toDisplayLen(50, unitSystem)}
                      max={toDisplayLen(400, unitSystem)}
                      decimals={isImp ? 2 : 0}
                      value={toDisplayLen(depth, unitSystem)}
                      onChange={(v) => setDepth(fromDisplayLen(v, unitSystem))}
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">
                      {en ? `Displacement (${u.vol})` : `Wyporność (${u.vol})`}
                    </span>
                    <ImmediateNumberInput
                      min={toDisplayVol(0.2, unitSystem)}
                      max={toDisplayVol(20, unitSystem)}
                      decimals={isImp ? 3 : 2}
                      value={toDisplayVol(displacement, unitSystem)}
                      onChange={(v) => setDisplacement(fromDisplayVol(v, unitSystem))}
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                </div>
              </div>

              {/* Live Auto-Calculated T-S Readout */}
              <div className="bg-[#08090C] border border-cyan-500/30 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-cyan-300">
                    {en ? 'Calculated T-S Readout' : 'Podgląd wyliczonych parametrów (T-S)'}
                  </span>
                  {solved.isValid ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{en ? 'Consistent' : 'Spójne'}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
                      <AlertTriangle className="w-3 h-3" />
                      <span>{en ? 'Warning' : 'Uwaga'}</span>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] font-mono-num">
                  <div className="flex justify-between gap-2 whitespace-nowrap">
                    <span className="text-zinc-400">SPL 1W:</span>
                    <strong className="text-red-400">{solved.spl1w1m.toFixed(1)} dB</strong>
                  </div>
                  <div className="flex justify-between gap-2 whitespace-nowrap">
                    <span className="text-zinc-400">2.83V:</span>
                    <strong className="text-white">{solved.spl283v1m.toFixed(1)} dB</strong>
                  </div>
                  <div className="flex justify-between gap-2 whitespace-nowrap">
                    <span className="text-zinc-400">η0:</span>
                    <strong className="text-emerald-400">{solved.eta0Percent.toFixed(2)}%</strong>
                  </div>
                  <div className="flex justify-between gap-2 whitespace-nowrap">
                    <span className="text-zinc-400">EBP:</span>
                    <strong className="text-cyan-300">{solved.ebpHz.toFixed(1)} Hz</strong>
                  </div>
                  <div className="flex justify-between gap-2 whitespace-nowrap">
                    <span className="text-zinc-400">Vd:</span>
                    <strong className="text-white">
                      {isImp
                        ? `${toDisplaySmallVol(solved.vd, unitSystem).toFixed(1)} ${u.smallVol}`
                        : `${Math.round(solved.vd)} ${u.smallVol}`}
                    </strong>
                  </div>
                  <div className="flex justify-between gap-2 whitespace-nowrap">
                    <span className="text-zinc-400">Rms:</span>
                    <strong className="text-zinc-200">{solved.rms.toFixed(2)} kg/s</strong>
                  </div>
                  <div className="flex justify-between gap-2 whitespace-nowrap">
                    <span className="text-zinc-400">Bl²/Re:</span>
                    <strong className="text-zinc-200">{solved.bl2Re.toFixed(1)} N²/W</strong>
                  </div>
                  <div className="flex justify-between gap-2 whitespace-nowrap">
                    <span className="text-zinc-400">Sd / Dd:</span>
                    <strong className="text-zinc-200">
                      {isImp
                        ? `${toDisplayArea(solved.sd, unitSystem).toFixed(1)}/${toDisplayLen(solved.dd, unitSystem).toFixed(2)}`
                        : `${Math.round(solved.sd)}/${Math.round(solved.dd)}`}
                    </strong>
                  </div>
                </div>

                {solved.warnings.length > 0 && (
                  <div className="pt-1 border-t border-white/[0.08] space-y-0.5 text-[10px] text-amber-300">
                    {solved.warnings.map((w, idx) => (
                      <div key={idx}>• {w.message}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={applyToProjectToo}
                onChange={(e) => setApplyToProjectToo(e.target.checked)}
                className="accent-red-500"
              />
              <span>
                {en
                  ? 'After saving, set this driver active in both 3D Project & WSD'
                  : 'Po zapisaniu ustaw ten głośnik również jako aktywny w projekcie 3D i WSD'}
              </span>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-zinc-300 bg-[#161920] border border-white/[0.1] rounded hover:bg-white/[0.06] transition-colors"
              >
                {en ? 'Cancel' : 'Anuluj'}
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded hover:bg-red-500 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                <span>
                  {editingDriver
                    ? en
                      ? 'Save T-S Changes'
                      : 'Zapisz zmiany T-S'
                    : en
                      ? 'Save Custom Driver'
                      : 'Zapisz własny głośnik'}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
