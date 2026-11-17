import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cpu, RotateCcw, Save, X } from 'lucide-react';
import {
  buildCustomDriverPreset,
  driverPresetToSolverInput,
  solveThieleSmall,
  type MechSolveMode,
  type MotorSolveMode,
  type QSolveMode,
  type SdInputMode,
  type TsSolverInput,
} from '../engine/tsSolver';
import type { DriverPreset } from '../engine/types';

interface DriverTsModalProps {
  open: boolean;
  editingDriver: DriverPreset | null;
  initialTemplateDriver: DriverPreset;
  onClose: () => void;
  onSaveDriver: (driver: DriverPreset, applyToProjectToo: boolean) => void;
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
  }, [open, editingDriver, initialTemplateDriver]);

  const solved = useMemo(() => solveThieleSmall(solverInput), [solverInput]);

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
    // Sync current solved values so switching mode doesn't jump numerically
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
      setNameError('Podaj nazwę lub model głośnika.');
      return;
    }
    const id =
      editingDriver?.id ??
      `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const preset = buildCustomDriverPreset(id, brand, model, sizeLabel, solved, {
      cutoutDia,
      outerDia,
      depth,
      displacement,
    });
    onSaveDriver(preset, applyToProjectToo);
    onClose();
  };

  const fsAuto = solverInput.mechSolveMode === 'from_mms_cms';
  const vasAuto = solverInput.mechSolveMode !== 'from_fs_vas';
  const mmsAuto = solverInput.mechSolveMode === 'from_fs_vas';
  const cmsAuto = solverInput.mechSolveMode !== 'from_mms_cms';
  const blAuto = solverInput.motorSolveMode === 'solve_bl';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="driver-ts-modal-title"
    >
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col bg-[#111318] border border-white/[0.12] rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#0D0F14] border-b border-white/[0.08] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-red-400" />
            <div>
              <h2 id="driver-ts-modal-title" className="text-sm font-semibold text-white">
                {editingDriver
                  ? `Edytor głośnika T-S: ${editingDriver.name}`
                  : 'Nowy własny głośnik — Baza i kalkulator T-S'}
              </h2>
              <p className="text-[11px] text-zinc-400">
                Wpisz dostępne parametry z noty katalogowej — brakujące wielkości wyliczają się automatycznie w czasie rzeczywistym.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij edytor głośnika"
            className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <form noValidate onSubmit={handleSave} className="flex-1 overflow-y-auto cad-scroll p-5 space-y-5">
          {/* Identity & Size Row */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 bg-[#161920] border border-white/[0.08] rounded-md p-3.5">
            <label className="sm:col-span-4 space-y-1">
              <span className="text-[11px] text-zinc-400 block">Marka (Brand)</span>
              <input
                type="text"
                placeholder="np. DD Audio / Sundown"
                value={brand}
                onChange={(e) => {
                  setBrand(e.target.value);
                  setNameError(null);
                }}
                className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
              />
            </label>

            <label className="sm:col-span-5 space-y-1">
              <span className="text-[11px] text-zinc-400 block">Model głośnika *</span>
              <input
                type="text"
                placeholder="np. 712f D2 / SA-12 Rev.3"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setNameError(null);
                }}
                className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
              />
            </label>

            <div className="sm:col-span-3 space-y-1">
              <span className="text-[11px] text-zinc-400 block">Rozmiar kosza</span>
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
            {/* Column 1: Q-Triad & Electromechanical */}
            <div className="lg:col-span-4 bg-[#161920] border border-white/[0.08] rounded-md p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">Dobroć Q i Rezonans</span>
                <button
                  type="button"
                  onClick={() => setSolverInput(driverPresetToSolverInput(initialTemplateDriver))}
                  className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white"
                  title="Przywróć bazowe wartości T-S"
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
                      Qes (dobroć elektr.)
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
                      {isQAuto('qes') ? 'AUTO' : 'Wyliczaj Qes'}
                    </button>
                  </div>
                  <input
                    id="ts-qes"
                    type="number"
                    step="any"
                    min="0.08"
                    max="2.5"
                    disabled={isQAuto('qes')}
                    value={isQAuto('qes') ? solved.qes.toFixed(3) : solverInput.qes}
                    onChange={(e) =>
                      setSolverInput((p) => ({
                        ...p,
                        qes: Math.max(0.08, Number(e.target.value) || 0.4),
                      }))
                    }
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
                      Qms (dobroć mech.)
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
                      {isQAuto('qms') ? 'AUTO' : 'Wyliczaj Qms'}
                    </button>
                  </div>
                  <input
                    id="ts-qms"
                    type="number"
                    step="any"
                    min="0.5"
                    max="20"
                    disabled={isQAuto('qms')}
                    value={isQAuto('qms') ? solved.qms.toFixed(2) : solverInput.qms}
                    onChange={(e) =>
                      setSolverInput((p) => ({
                        ...p,
                        qms: Math.max(0.5, Number(e.target.value) || 4.5),
                      }))
                    }
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
                      Qts (dobroć całk.)
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
                      {isQAuto('qts') ? 'AUTO' : 'Wyliczaj Qts'}
                    </button>
                  </div>
                  <input
                    id="ts-qts"
                    type="number"
                    step="any"
                    min="0.08"
                    max="2.0"
                    disabled={isQAuto('qts')}
                    value={isQAuto('qts') ? solved.qts.toFixed(3) : solverInput.qts}
                    onChange={(e) =>
                      setSolverInput((p) => ({
                        ...p,
                        qts: Math.max(0.08, Number(e.target.value) || 0.4),
                      }))
                    }
                    className={`w-full rounded px-2.5 py-1.5 text-xs font-mono-num focus:outline-none ${
                      isQAuto('qts')
                        ? 'bg-[#0B1218] border border-cyan-500/35 text-cyan-300'
                        : 'bg-[#08090C] border border-white/[0.1] text-white focus:border-red-500'
                    }`}
                  />
                </div>
              </div>

              {/* Electrical Voice Coil Specs */}
              <div className="pt-2 border-t border-white/[0.06] grid grid-cols-3 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 block">Re (Ω)</span>
                  <input
                    type="number"
                    step="any"
                    min="0.3"
                    max="16"
                    value={solverInput.re}
                    onChange={(e) =>
                      setSolverInput((p) => ({
                        ...p,
                        re: Math.max(0.25, Number(e.target.value) || 2.0),
                      }))
                    }
                    className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 block">Le (mH)</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max="15"
                    value={solverInput.le}
                    onChange={(e) =>
                      setSolverInput((p) => ({
                        ...p,
                        le: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 block">Z nom. (Ω)</span>
                  <input
                    type="number"
                    step="any"
                    min="1"
                    max="16"
                    value={solverInput.zNom}
                    onChange={(e) =>
                      setSolverInput((p) => ({
                        ...p,
                        zNom: Math.max(1, Number(e.target.value) || 4),
                      }))
                    }
                    className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                  />
                </label>
              </div>
            </div>

            {/* Column 2: Suspension Mechanics (Fs / Vas / Mms / Cms / Sd) */}
            <div className="lg:col-span-4 bg-[#161920] border border-white/[0.08] rounded-md p-3.5 space-y-3">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-white block">
                  Mechanika membrany i zawieszenia
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
                  <input
                    type="number"
                    step="any"
                    disabled={fsAuto}
                    value={fsAuto ? solved.fs.toFixed(1) : solverInput.fs}
                    onChange={(e) =>
                      setSolverInput((p) => ({
                        ...p,
                        fs: Math.max(10, Number(e.target.value) || 30),
                      }))
                    }
                    className={`w-full rounded px-2 py-1.5 text-xs font-mono-num focus:outline-none ${
                      fsAuto
                        ? 'bg-[#0B1218] border border-cyan-500/35 text-cyan-300'
                        : 'bg-[#08090C] border border-white/[0.1] text-white focus:border-red-500'
                    }`}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400 flex items-center justify-between">
                    <span>Vas (L)</span>
                    {vasAuto && <span className="text-[9px] text-cyan-300 font-mono-num">AUTO</span>}
                  </span>
                  <input
                    type="number"
                    step="any"
                    disabled={vasAuto}
                    value={vasAuto ? solved.vas.toFixed(1) : solverInput.vas}
                    onChange={(e) =>
                      setSolverInput((p) => ({
                        ...p,
                        vas: Math.max(1, Number(e.target.value) || 40),
                      }))
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
                    <span>Mms (g)</span>
                    {mmsAuto && <span className="text-[9px] text-cyan-300 font-mono-num">AUTO</span>}
                  </span>
                  <input
                    type="number"
                    step="any"
                    disabled={mmsAuto}
                    value={mmsAuto ? solved.mms.toFixed(1) : solverInput.mms}
                    onChange={(e) =>
                      setSolverInput((p) => ({
                        ...p,
                        mms: Math.max(5, Number(e.target.value) || 120),
                      }))
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
                  <input
                    type="number"
                    step="any"
                    disabled={cmsAuto}
                    value={cmsAuto ? solved.cms.toFixed(3) : solverInput.cms}
                    onChange={(e) =>
                      setSolverInput((p) => ({
                        ...p,
                        cms: Math.max(0.01, Number(e.target.value) || 0.2),
                      }))
                    }
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
                  <span className="text-zinc-400">Membrana Sd / Dd</span>
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
                      Sd (cm²)
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
                      z Dd (mm)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">
                      {solverInput.sdInputMode === 'direct_sd' ? 'Sd (cm²)' : 'Dd efekt. (mm)'}
                    </span>
                    <input
                      type="number"
                      step="any"
                      value={
                        solverInput.sdInputMode === 'direct_sd'
                          ? solverInput.sd
                          : solverInput.dd
                      }
                      onChange={(e) => {
                        const val = Number(e.target.value) || 200;
                        setSolverInput((p) =>
                          p.sdInputMode === 'direct_sd'
                            ? { ...p, sd: Math.max(15, val) }
                            : { ...p, dd: Math.max(40, val) },
                        );
                      }}
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
                        {blAuto ? 'AUTO' : 'Z Bl→Qes'}
                      </button>
                    </span>
                    <input
                      type="number"
                      step="any"
                      disabled={blAuto}
                      value={blAuto ? solved.bl.toFixed(2) : solverInput.bl}
                      onChange={(e) =>
                        setSolverInput((p) => ({
                          ...p,
                          bl: Math.max(1, Number(e.target.value) || 12),
                        }))
                      }
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

            {/* Column 3: Limits, Live WinISD Calculated Output & 3D Mounting */}
            <div className="lg:col-span-4 space-y-3">
              {/* Limits & 3D Mounting */}
              <div className="bg-[#161920] border border-white/[0.08] rounded-md p-3.5 space-y-2.5">
                <span className="text-xs font-semibold text-white block">
                  Granice pracy i wymiary 3D
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Xmax (mm)</span>
                    <input
                      type="number"
                      step="any"
                      min="1"
                      max="60"
                      value={solverInput.xmax}
                      onChange={(e) =>
                        setSolverInput((p) => ({
                          ...p,
                          xmax: Math.max(1, Number(e.target.value) || 12),
                        }))
                      }
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Moc Pe RMS (W)</span>
                    <input
                      type="number"
                      step="any"
                      min="25"
                      max="10000"
                      value={solverInput.powerW}
                      onChange={(e) =>
                        setSolverInput((p) => ({
                          ...p,
                          powerW: Math.max(25, Number(e.target.value) || 500),
                        }))
                      }
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Otwór CAD (mm)</span>
                    <input
                      type="number"
                      step="any"
                      min="100"
                      max="480"
                      value={cutoutDia}
                      onChange={(e) => setCutoutDia(Math.max(100, Number(e.target.value) || 280))}
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Kosz zewn. (mm)</span>
                    <input
                      type="number"
                      step="any"
                      min="120"
                      max="520"
                      value={outerDia}
                      onChange={(e) => setOuterDia(Math.max(120, Number(e.target.value) || 316))}
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Głębokość (mm)</span>
                    <input
                      type="number"
                      step="any"
                      min="60"
                      max="360"
                      value={depth}
                      onChange={(e) => setDepth(Math.max(60, Number(e.target.value) || 160))}
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Wyporność (L)</span>
                    <input
                      type="number"
                      step="any"
                      min="0.3"
                      max="15"
                      value={displacement}
                      onChange={(e) =>
                        setDisplacement(Math.max(0.3, Number(e.target.value) || 2.5))
                      }
                      className="w-full bg-[#08090C] border border-white/[0.1] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                </div>
              </div>

              {/* Live Auto-Calculated T-S Readout */}
              <div className="bg-[#08090C] border border-cyan-500/30 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-cyan-300">
                    Wyliczone automatycznie (T-S)
                  </span>
                  {solved.isValid ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Spójne</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Uwaga</span>
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
                    <strong className="text-white">{Math.round(solved.vd)} cm³</strong>
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
                      {Math.round(solved.sd)}/{Math.round(solved.dd)}
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
              <span>Po zapisaniu ustaw ten głośnik również jako aktywny w projekcie 3D i WSD</span>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-zinc-300 bg-[#161920] border border-white/[0.1] rounded hover:bg-white/[0.06] transition-colors"
              >
                Anuluj
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded hover:bg-red-500 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{editingDriver ? 'Zapisz zmiany T-S' : 'Zapisz własny głośnik'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
