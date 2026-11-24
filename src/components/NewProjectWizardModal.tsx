import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Car,
  Check,
  CheckCircle2,
  Cpu,
  Flame,
  Headphones,
  Plus,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import { calculateAcoustics } from '../engine/acoustics';
import { generateCutList, optimizeCutSheet } from '../engine/cutlist';
import { DRIVER_PRESETS } from '../engine/presets';
import {
  buildWizardProjectParams,
  buildWizardTemplatePreset,
  getApplicationSpec,
  getWizardTemplateDefaultName,
  SUBWOOFER_APPLICATION_SPECS,
  type SubwooferApplication,
  type WizardSizePriority,
} from '../engine/projectWizard';
import { computeElectricalLoad } from '../engine/tsSolver';
import type {
  BoxParams,
  BoxTemplatePreset,
  CoilWiringMode,
  DriverPreset,
  DriverWiringType,
  EnclosureType,
  MaterialType,
} from '../engine/types';
import {
  formatArea,
  formatLen,
  formatLenNum,
  formatVel,
  formatVol,
  fromDisplayVel,
  fromDisplayVol,
  getUnitLabels,
  toDisplayVel,
  toDisplayVol,
  toDisplayWeightKg,
} from '../engine/units';
import { useI18n } from '../i18n';
import { ImmediateNumberInput } from './ImmediateNumberInput';

interface NewProjectWizardModalProps {
  open: boolean;
  allDrivers: DriverPreset[];
  selectedDriverOverride: { driverId: string; coilWiring?: CoilWiringMode; seq: number } | null;
  onClose: () => void;
  onOpenAddCustomDriver: (templateDriver: DriverPreset) => void;
  onCreateProject: (params: BoxParams, templatePreset: BoxTemplatePreset) => void;
}

type WizardStep = 1 | 2 | 3;

const APP_ICONS: Record<SubwooferApplication, typeof Car> = {
  car_daily: Car,
  car_spl: Flame,
  studio_hifi: Headphones,
  custom: Sliders,
};

export function NewProjectWizardModal({
  open,
  allDrivers,
  selectedDriverOverride,
  onClose,
  onOpenAddCustomDriver,
  onCreateProject,
}: NewProjectWizardModalProps) {
  const { lang, unitSystem } = useI18n();
  const isEn = lang === 'en';
  const u = getUnitLabels(unitSystem);

  const [step, setStep] = useState<WizardStep>(1);
  const [application, setApplication] = useState<SubwooferApplication>('car_daily');
  const [sizePriority, setSizePriority] = useState<WizardSizePriority>('balanced');
  const [enclosureChoice, setEnclosureChoice] = useState<EnclosureType | 'recommended'>('recommended');

  const [driverId, setDriverId] = useState<string>(DRIVER_PRESETS[0].id);
  const [driverCount, setDriverCount] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [coilWiring, setCoilWiring] = useState<CoilWiringMode>('series');
  const [arrayWiring, setArrayWiring] = useState<DriverWiringType>('parallel');

  const [material, setMaterial] = useState<MaterialType>('birch_plywood');
  const [thickness, setThickness] = useState<number>(18);
  const [projectTitle, setProjectTitle] = useState<string>('');
  const [customLabel, setCustomLabel] = useState<string>('');
  const [customVolumeL, setCustomVolumeL] = useState<number>(55);
  const [customTuningHz, setCustomTuningHz] = useState<number>(32);
  const [customPortVelMs, setCustomPortVelMs] = useState<number>(16);

  // Sync newly created/imported custom driver from DriverTsModal directly into Step 2
  useEffect(() => {
    if (!selectedDriverOverride) return;
    setDriverId(selectedDriverOverride.driverId);
    if (selectedDriverOverride.coilWiring) {
      setCoilWiring(selectedDriverOverride.coilWiring);
    }
  }, [selectedDriverOverride]);

  // Reset to clean Step 1 defaults whenever wizard opens freshly
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setProjectTitle('');
  }, [open]);

  // Escape closes wizard only when DriverTsModal isn't layered above it (DriverTsModal handles its own capture)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const tsOpen = document.querySelector('[aria-labelledby="driver-ts-modal-title"]');
        if (!tsOpen) onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const activeSpec = useMemo(() => getApplicationSpec(application), [application]);

  const selectedDriver = useMemo(
    () => allDrivers.find((d) => d.id === driverId) ?? allDrivers[0] ?? DRIVER_PRESETS[0],
    [allDrivers, driverId],
  );

  // When switching application, adopt its default material & thickness cleanly
  const handleSelectApplication = (nextApp: SubwooferApplication) => {
    setApplication(nextApp);
    const spec = getApplicationSpec(nextApp);
    setMaterial(spec.defaultMaterial);
    setThickness(spec.defaultThickness);
  };

  const handleSelectDriver = (drv: DriverPreset) => {
    setDriverId(drv.id);
    if (drv.voiceCoilCount === 2) {
      setCoilWiring(driverCount >= 2 ? 'parallel' : 'series');
    } else {
      setCoilWiring('single');
    }
  };

  const handleDriverCountChange = (cnt: 1 | 2 | 3 | 4 | 5 | 6) => {
    setDriverCount(cnt);
    if (cnt === 1) {
      setArrayWiring('parallel');
    } else if (cnt === 4 || cnt === 6) {
      setArrayWiring('series_parallel');
    } else {
      setArrayWiring('series');
    }
  };

  const coilCount = selectedDriver.voiceCoilCount === 2 ? 2 : 1;
  const coilNom =
    selectedDriver.coilNominalOhms ??
    (coilCount === 2 ? (selectedDriver.zNom ?? 4) / 2 : selectedDriver.zNom ?? 4);
  const coilRe =
    selectedDriver.coilReOhms ??
    (coilCount === 2 ? (selectedDriver.re ?? coilNom * 1.6) / 2 : selectedDriver.re ?? 3.2);

  const elecLoad = useMemo(
    () =>
      computeElectricalLoad(
        {
          voiceCoilCount: coilCount,
          coilNominalOhms: coilNom,
          coilReOhms: coilRe,
          baseLeMh: selectedDriver.le ?? 1.4,
          coilWiring,
          driverCount,
          arrayWiring,
        },
        lang,
      ),
    [coilCount, coilNom, coilRe, selectedDriver.le, coilWiring, driverCount, arrayWiring, lang],
  );

  const customTargetConfig = useMemo(
    () =>
      application === 'custom'
        ? {
            netVolumeL: customVolumeL,
            tuningHz: customTuningHz,
            portVelocityMs: customPortVelMs,
            label: customLabel,
          }
        : undefined,
    [application, customVolumeL, customTuningHz, customPortVelMs, customLabel],
  );

  const previewParams = useMemo(
    () =>
      buildWizardProjectParams(
        {
          application,
          driver: selectedDriver,
          driverCount,
          enclosureType: enclosureChoice,
          sizePriority,
          material,
          thickness,
          coilWiring: elecLoad.effectiveCoilWiring,
          arrayWiring,
          customTarget: customTargetConfig,
        },
        lang,
      ),
    [
      application,
      selectedDriver,
      driverCount,
      enclosureChoice,
      sizePriority,
      material,
      thickness,
      elecLoad.effectiveCoilWiring,
      arrayWiring,
      customTargetConfig,
      lang,
    ],
  );

  const previewAcoustics = useMemo(
    () => calculateAcoustics(previewParams, lang, unitSystem),
    [previewParams, lang, unitSystem],
  );

  const previewSheet = useMemo(() => {
    const panels = generateCutList(previewParams, previewAcoustics, lang, unitSystem);
    return optimizeCutSheet(previewParams, panels, lang);
  }, [previewParams, previewAcoustics, lang, unitSystem]);

  const defaultTemplateName = useMemo(
    () =>
      getWizardTemplateDefaultName(
        { application, driver: selectedDriver, driverCount, customTarget: customTargetConfig },
        previewParams,
        previewAcoustics,
        lang,
      ),
    [application, selectedDriver, driverCount, customTargetConfig, previewParams, previewAcoustics, lang],
  );

  if (!open) return null;

  const enclosureOptions: Array<{ id: EnclosureType | 'recommended'; label: string }> = isEn
    ? [
        { id: 'recommended', label: 'Recommended' },
        { id: 'vented_slot', label: 'Slot Port' },
        { id: 'vented_round', label: 'Aero Port' },
        { id: 'sealed', label: 'Sealed' },
        { id: 'bandpass_4th', label: '4th BP' },
        { id: 'bandpass_6th', label: '6th BP' },
      ]
    : [
        { id: 'recommended', label: 'Zalecana' },
        { id: 'vented_slot', label: 'Szczelinowy' },
        { id: 'vented_round', label: 'Aero Port' },
        { id: 'sealed', label: 'Zamknięta' },
        { id: 'bandpass_4th', label: '4-rz. BP' },
        { id: 'bandpass_6th', label: '6-rz. BP' },
      ];

  const enclosureLabel = (t: EnclosureType) => {
    if (isEn) {
      if (t === 'vented_slot') return 'Slot Port Bass-Reflex';
      if (t === 'vented_round') return 'Round Aero Bass-Reflex';
      if (t === 'sealed') return 'Sealed Enclosure';
      if (t === 'bandpass_4th') return '4th-Order Bandpass';
      return '6th-Order Bandpass';
    }
    if (t === 'vented_slot') return 'Bass-Reflex szczelinowy';
    if (t === 'vented_round') return 'Bass-Reflex okrągły (Aero)';
    if (t === 'sealed') return 'Obudowa zamknięta';
    if (t === 'bandpass_4th') return 'Bandpass 4-go rzędu';
    return 'Bandpass 6-go rzędu';
  };

  const errorCount = previewAcoustics.issues.filter((i) => i.severity === 'error').length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-modal-title"
      data-testid="new-project-wizard"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl max-h-[94vh] flex flex-col bg-[#111318] border border-white/[0.12] rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 bg-[#0D0F14] border-b border-white/[0.08] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Sparkles className="w-5 h-5 text-red-400 shrink-0" />
            <div className="min-w-0">
              <h2 id="wizard-modal-title" className="text-sm sm:text-base font-semibold text-white">
                {isEn ? 'New Project Wizard' : 'Kreator Nowego Projektu'}
              </h2>
              <p className="text-[11px] sm:text-xs text-zinc-400 truncate">
                {isEn
                  ? 'Select application, choose or add your speaker, and generate an optimal enclosure.'
                  : 'Wybierz przeznaczenie subwoofera, dobierz lub dodaj własny głośnik i wygeneruj obudowę.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={isEn ? 'Close new project wizard' : 'Zamknij kreator nowego projektu'}
            className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 3-Step Interactive Progress Navigation */}
        <div className="px-4 sm:px-5 py-2.5 bg-[#0B0D11] border-b border-white/[0.06] grid grid-cols-3 gap-2 shrink-0">
          {(
            [
              { id: 1, title: isEn ? '01. Application' : '01. Zastosowanie', short: isEn ? '01. Use Case' : '01. Cel' },
              { id: 2, title: isEn ? '02. Speaker' : '02. Głośnik', short: isEn ? '02. Driver' : '02. Głośnik' },
              { id: 3, title: isEn ? '03. Preview' : '03. Podgląd', short: isEn ? '03. Preview' : '03. Podgląd' },
            ] as Array<{ id: WizardStep; title: string; short: string }>
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              data-testid={`wizard-step-tab-${s.id}`}
              onClick={() => setStep(s.id)}
              aria-current={step === s.id ? 'step' : undefined}
              className={`py-2 px-2 rounded-md text-[11px] sm:text-xs font-medium transition-colors border text-center whitespace-nowrap ${
                step === s.id
                  ? 'bg-red-600/15 border-red-500/60 text-white'
                  : s.id < step
                    ? 'bg-[#161920] border-white/[0.08] text-zinc-200 hover:border-white/20'
                    : 'bg-[#08090C] border-white/[0.05] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="sm:hidden">{s.short}</span>
              <span className="hidden sm:inline">{s.title}</span>
            </button>
          ))}
        </div>

        {/* Step Body */}
        <div className="flex-1 overflow-y-auto cad-scroll p-4 sm:p-5 space-y-5">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {isEn ? 'What is this subwoofer for?' : 'Do czego ma być przeznaczony subwoofer?'}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {isEn
                    ? 'Your choice sets target tuning frequency (Fb / Qtc), port velocity limits, and enclosure proportions.'
                    : 'Wybór automatycznie dopasuje strojenie (Fb / Qtc), zapas przekroju portu i proporcje skrzyni.'}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3">
                  {SUBWOOFER_APPLICATION_SPECS.map((spec) => {
                    const Icon = APP_ICONS[spec.id];
                    const selected = application === spec.id;
                    return (
                      <button
                        key={spec.id}
                        type="button"
                        data-testid={`wizard-app-${spec.id}`}
                        onClick={() => handleSelectApplication(spec.id)}
                        className={`text-left p-3.5 rounded-md border transition-colors flex flex-col justify-between gap-2 ${
                          selected
                            ? 'bg-red-600/12 border-red-500/70'
                            : 'bg-[#161920] border-white/[0.08] hover:border-white/20'
                        }`}
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Icon
                                className={`w-4 h-4 shrink-0 ${
                                  selected ? 'text-red-400' : 'text-zinc-400'
                                }`}
                              />
                              <span className="text-xs font-semibold text-white truncate">
                                {isEn ? spec.titleEn : spec.titlePl}
                              </span>
                            </div>
                            {selected && <Check className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                          </div>
                          <p className="text-[11px] text-zinc-400 leading-relaxed">
                            {isEn ? spec.goalEn : spec.goalPl}
                          </p>
                        </div>
                        <div className="text-[11px] font-mono-num text-cyan-300 pt-1 border-t border-white/[0.06]">
                          {isEn ? spec.fbRangeEn : spec.fbRangePl}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {application === 'custom' && (
                  <div
                    data-testid="wizard-custom-target-panel"
                    className="mt-3 p-3.5 rounded-md bg-[#161920] border border-red-500/40 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white">
                        {isEn ? 'Custom Target Parameters' : 'Parametry własnego przeznaczenia'}
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        {isEn
                          ? 'Overrides automatic volume, tuning, and port velocity heuristics.'
                          : 'Nadpisuje automatyczny dobór litrażu, strojenia i prędkości w porcie.'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <label htmlFor="wizard-custom-label" className="text-[11px] text-zinc-300 block">
                          {isEn ? 'Custom Goal (optional)' : 'Własny cel (opcjonalnie)'}
                        </label>
                        <input
                          id="wizard-custom-label"
                          data-testid="wizard-custom-label"
                          type="text"
                          maxLength={32}
                          value={customLabel}
                          onChange={(e) => setCustomLabel(e.target.value)}
                          placeholder={isEn ? 'e.g. Demo Low / SQ' : 'np. Demo Low / SQ'}
                          className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="wizard-custom-volume" className="text-[11px] text-zinc-300 block">
                          {isEn ? `Target Net Volume (${u.vol})` : `Docelowy litraż netto (${u.vol})`}
                        </label>
                        <ImmediateNumberInput
                          id="wizard-custom-volume"
                          value={toDisplayVol(customVolumeL, unitSystem)}
                          min={toDisplayVol(12, unitSystem)}
                          max={toDisplayVol(850, unitSystem)}
                          decimals={unitSystem === 'imperial' ? 2 : 1}
                          onChange={(val) => setCustomVolumeL(Number(fromDisplayVol(val, unitSystem).toFixed(1)))}
                          className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="wizard-custom-tuning" className="text-[11px] text-zinc-300 block">
                          {enclosureChoice === 'sealed'
                            ? isEn
                              ? 'Reference Tuning (N/A Sealed)'
                              : 'Strojenie (nieakt. Zamknięta)'
                            : isEn
                              ? 'Target Port Tuning (Hz)'
                              : 'Docelowe strojenie Fb (Hz)'}
                        </label>
                        <ImmediateNumberInput
                          id="wizard-custom-tuning"
                          value={customTuningHz}
                          min={18}
                          max={65}
                          decimals={1}
                          disabled={enclosureChoice === 'sealed'}
                          onChange={(val) => setCustomTuningHz(val)}
                          className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs font-mono-num text-white disabled:opacity-45 focus:outline-none focus:border-red-500"
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="wizard-custom-velocity" className="text-[11px] text-zinc-300 block">
                          {enclosureChoice === 'sealed'
                            ? isEn
                              ? 'Port Airflow Limit'
                              : 'Limit przepływu portu'
                            : isEn
                              ? `Max Port Velocity (${u.vel})`
                              : `Maks. prędkość portu (${u.vel})`}
                        </label>
                        <ImmediateNumberInput
                          id="wizard-custom-velocity"
                          value={toDisplayVel(customPortVelMs, unitSystem)}
                          min={toDisplayVel(8, unitSystem)}
                          max={toDisplayVel(30, unitSystem)}
                          decimals={1}
                          disabled={enclosureChoice === 'sealed'}
                          onChange={(val) => setCustomPortVelMs(Number(fromDisplayVel(val, unitSystem).toFixed(1)))}
                          className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs font-mono-num text-white disabled:opacity-45 focus:outline-none focus:border-red-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Priority & Enclosure Override */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-white/[0.08]">
                <div className="space-y-2">
                  <span className="text-xs font-medium text-zinc-200 block">
                    {isEn ? 'Size vs. Low-End Priority' : 'Priorytet gabarytu i zejścia'}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 bg-[#08090C] p-1 rounded-md border border-white/[0.08]">
                    {(
                      [
                        {
                          id: 'compact',
                          label: isEn ? 'Compact' : 'Kompakt',
                        },
                        {
                          id: 'balanced',
                          label: isEn ? 'Balanced' : 'Zbalansowana',
                        },
                        {
                          id: 'maximum',
                          label: isEn ? 'Deep / Max' : 'Maks. zejście',
                        },
                      ] as Array<{ id: WizardSizePriority; label: string }>
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        data-testid={`wizard-priority-${opt.id}`}
                        onClick={() => setSizePriority(opt.id)}
                        className={`py-2 px-2 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                          sizePriority === opt.id
                            ? 'bg-red-600 text-white font-semibold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-medium text-zinc-200 block">
                    {isEn ? 'Enclosure Topology' : 'Typ obudowy'}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 bg-[#08090C] p-1 rounded-md border border-white/[0.08]">
                    {enclosureOptions.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        data-testid={`wizard-enclosure-${opt.id}`}
                        onClick={() => setEnclosureChoice(opt.id)}
                        className={`py-1.5 px-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap truncate ${
                          enclosureChoice === opt.id
                            ? 'bg-red-600 text-white font-semibold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {isEn ? 'Choose or Add Your Speaker' : 'Wybierz lub dodaj własny głośnik'}
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {isEn
                      ? 'Pick from presets or create a custom driver with T-S parameters or a WinISD .wdr file.'
                      : 'Wybierz z listy lub dodaj własny głośnik podając parametry T-S albo plik .wdr z WinISD.'}
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="wizard-add-custom-driver"
                  onClick={() => onOpenAddCustomDriver(selectedDriver)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Add Custom Driver (T-S / .wdr)' : 'Dodaj własny głośnik (T-S / .wdr)'}</span>
                </button>
              </div>

              {/* Driver list */}
              <div className="space-y-2 max-h-60 overflow-y-auto cad-scroll pr-1">
                {allDrivers.map((drv) => {
                  const isSelected = drv.id === selectedDriver.id;
                  return (
                    <button
                      key={drv.id}
                      type="button"
                      data-testid={`wizard-driver-option-${drv.id}`}
                      onClick={() => handleSelectDriver(drv)}
                      className={`w-full text-left p-3 rounded-md border transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                        isSelected
                          ? 'bg-red-600/12 border-red-500/70'
                          : 'bg-[#161920] border-white/[0.08] hover:border-white/20'
                      }`}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Cpu
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isSelected ? 'text-red-400' : 'text-zinc-400'
                            }`}
                          />
                          <span className="text-xs font-semibold text-white truncate">
                            {drv.name}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400 flex flex-wrap items-center gap-x-2">
                          <span>{drv.sizeLabel}</span>
                          <span aria-hidden="true">·</span>
                          <span>{drv.isCustom ? (isEn ? 'Custom' : 'Własny') : drv.source ?? 'Preset'}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-num">{drv.powerW} W RMS</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono-num text-zinc-300 shrink-0">
                        <span>Fs {drv.fs} Hz</span>
                        <span>Qts {drv.qts}</span>
                        <span>Vas {formatVol(drv.vas, unitSystem, 1, 2)}</span>
                        <span>Xmax {formatLen(drv.xmax, unitSystem, 1, 2)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Quantity & Voice Coil / Array Wiring */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-white/[0.08]">
                <div className="space-y-2">
                  <span className="text-xs font-medium text-zinc-200 block">
                    {isEn ? 'Number of Subwoofers' : 'Liczba głośników w obudowie'}
                  </span>
                  <div className="grid grid-cols-6 gap-1.5 bg-[#08090C] p-1 rounded-md border border-white/[0.08]">
                    {([1, 2, 3, 4, 5, 6] as const).map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        data-testid={`wizard-count-${cnt}`}
                        onClick={() => handleDriverCountChange(cnt)}
                        className={`py-2 rounded text-xs font-mono-num font-semibold transition-colors ${
                          driverCount === cnt
                            ? 'bg-red-600 text-white'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {cnt}×
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-200">
                      {isEn ? 'Impedance & Wiring' : 'Impedancja i połączenie'}
                    </span>
                    <span className="font-mono-num text-cyan-300 font-semibold">
                      {elecLoad.totalNominalOhms.toFixed(2).replace(/\.?0+$/, '')} Ω ·{' '}
                      {selectedDriver.powerW * driverCount} W RMS
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {coilCount === 2 && (
                      <div className="flex-1 min-w-[140px] grid grid-cols-2 gap-1 bg-[#08090C] p-1 rounded-md border border-white/[0.08]">
                        {(
                          [
                            { id: 'parallel', label: isEn ? 'Coils Par.' : 'Cewki równ.' },
                            { id: 'series', label: isEn ? 'Coils Ser.' : 'Cewki szer.' },
                          ] as const
                        ).map((w) => (
                          <button
                            key={w.id}
                            type="button"
                            onClick={() => setCoilWiring(w.id)}
                            className={`py-1.5 px-2 rounded text-[11px] transition-colors whitespace-nowrap ${
                              elecLoad.effectiveCoilWiring === w.id
                                ? 'bg-cyan-500/20 text-cyan-200 font-semibold'
                                : 'text-zinc-400 hover:text-white'
                            }`}
                          >
                            {w.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {driverCount > 1 && (
                      <div className="flex-1 min-w-[150px] grid grid-cols-3 gap-1 bg-[#08090C] p-1 rounded-md border border-white/[0.08]">
                        {(
                          [
                            { id: 'parallel', label: isEn ? 'Par.' : 'Równ.' },
                            { id: 'series', label: isEn ? 'Ser.' : 'Szer.' },
                            { id: 'series_parallel', label: 'S-P' },
                          ] as const
                        ).map((aw) => (
                          <button
                            key={aw.id}
                            type="button"
                            onClick={() => setArrayWiring(aw.id)}
                            className={`py-1.5 px-1.5 rounded text-[11px] transition-colors whitespace-nowrap ${
                              arrayWiring === aw.id
                                ? 'bg-red-600 text-white font-semibold'
                                : 'text-zinc-400 hover:text-white'
                            }`}
                          >
                            {aw.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              {/* Optional Project / Template Name + Material & Wall Thickness */}
              <div className="space-y-1.5">
                <label htmlFor="wizard-project-name" className="text-xs font-medium text-zinc-200 block">
                  {isEn ? 'Project Template Name (optional)' : 'Nazwa projektu w szablonach (opcjonalnie)'}
                </label>
                <input
                  id="wizard-project-name"
                  data-testid="wizard-project-name"
                  type="text"
                  maxLength={80}
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  placeholder={defaultTemplateName}
                  className="w-full bg-[#08090C] border border-white/[0.12] rounded-md px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
                />
                <p className="text-[11px] text-zinc-400">
                  {isEn
                    ? 'Saved automatically to the "Project Template Preset" dropdown so you can switch back anytime.'
                    : 'Projekt zapisze się automatycznie na liście „Gotowy szablon projektu”, aby można było do niego wracać.'}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="wizard-material" className="text-xs font-medium text-zinc-200 block">
                    {isEn ? 'Enclosure Material' : 'Materiał obudowy'}
                  </label>
                  <select
                    id="wizard-material"
                    value={material}
                    onChange={(e) => setMaterial(e.target.value as MaterialType)}
                    className="w-full bg-[#08090C] border border-white/[0.12] rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                  >
                    <option value="birch_plywood">
                      {isEn ? 'Birch Plywood (Light & Rigid)' : 'Sklejka Brzozowa (Lekka i sztywna)'}
                    </option>
                    <option value="mdf">
                      {isEn ? 'Raw MDF Board (High Damping)' : 'Płyta MDF surowa (Wysokie tłumienie)'}
                    </option>
                    <option value="matte_black">
                      {isEn ? 'Black Laminated MDF' : 'Laminat Czarny MDF'}
                    </option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="wizard-thickness" className="text-xs font-medium text-zinc-200 block">
                    {isEn ? 'Wall Thickness' : 'Grubość ścianki'}
                  </label>
                  <select
                    id="wizard-thickness"
                    value={thickness}
                    onChange={(e) => setThickness(Number(e.target.value))}
                    className="w-full bg-[#08090C] border border-white/[0.12] rounded-md px-3 py-2 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                  >
                    {[15, 18, 19, 22, 25].map((t) => (
                      <option key={t} value={t}>
                        {formatLen(t, unitSystem, 0, 2)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Acoustic & CAD Result Summary */}
              <div className="bg-[#161920] border border-white/[0.08] rounded-md p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
                  <div>
                    <div className="text-xs font-semibold text-white">
                      {isEn ? activeSpec.titleEn : activeSpec.titlePl} · {driverCount}× {selectedDriver.name}
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      {enclosureLabel(previewParams.enclosureType)} ·{' '}
                      {elecLoad.totalNominalOhms.toFixed(2).replace(/\.?0+$/, '')} Ω ·{' '}
                      {selectedDriver.powerW * driverCount} W RMS
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      {errorCount === 0
                        ? isEn
                          ? 'Geometry verified'
                          : 'Geometria zweryfikowana'
                        : isEn
                          ? `${errorCount} geometry warning(s)`
                          : `${errorCount} uwag geometrycznych`}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-[#08090C] border border-white/[0.06] rounded p-3">
                    <div className="text-[11px] text-zinc-400">
                      {isEn ? 'External (W × H × D)' : 'Wymiary zewn. (S × W × G)'}
                    </div>
                    <div className="font-mono-num text-sm font-semibold text-white mt-1">
                      {formatLenNum(previewAcoustics.effectiveExternalWidth, unitSystem, 0, 2)} ×{' '}
                      {formatLenNum(previewAcoustics.effectiveExternalHeight, unitSystem, 0, 2)} ×{' '}
                      {formatLenNum(previewAcoustics.effectiveExternalDepth, unitSystem, 0, 2)} {u.len}
                    </div>
                  </div>

                  <div className="bg-[#08090C] border border-white/[0.06] rounded p-3">
                    <div className="text-[11px] text-zinc-400">
                      {isEn ? 'Net Volume (Vnet)' : 'Objętość netto (Vnet)'}
                    </div>
                    <div className="font-mono-num text-sm font-semibold text-white mt-1">
                      {formatVol(previewAcoustics.netVolumeL, unitSystem, 1, 2)}
                    </div>
                    <div className="font-mono-num text-[11px] text-zinc-500 mt-0.5">
                      {isEn ? 'Gross' : 'Brutto'} {formatVol(previewAcoustics.grossVolumeL, unitSystem, 1, 2)}
                    </div>
                  </div>

                  <div className="bg-[#08090C] border border-white/[0.06] rounded p-3">
                    <div className="text-[11px] text-zinc-400">
                      {previewParams.enclosureType === 'sealed'
                        ? isEn
                          ? 'Alignment (Qtc / Fc)'
                          : 'Dobroć (Qtc / Fc)'
                        : isEn
                          ? 'Port Tuning (Fb)'
                          : 'Strojenie portu (Fb)'}
                    </div>
                    <div className="font-mono-num text-sm font-semibold text-red-400 mt-1">
                      {previewParams.enclosureType === 'sealed'
                        ? `Qtc ${(previewAcoustics.sealedQtc ?? 0).toFixed(2)}`
                        : previewParams.enclosureType === 'bandpass_6th'
                          ? `${previewAcoustics.rearPortTuningHz?.toFixed(0) ?? '—'} / ${previewAcoustics.tuningHz?.toFixed(1) ?? '—'} Hz`
                          : `${previewAcoustics.tuningHz?.toFixed(1) ?? '—'} Hz`}
                    </div>
                    <div className="font-mono-num text-[11px] text-zinc-500 mt-0.5">
                      F3: {previewAcoustics.f3LowHz} Hz
                      {previewAcoustics.f3HighHz ? ` – ${previewAcoustics.f3HighHz} Hz` : ''}
                    </div>
                  </div>

                  <div className="bg-[#08090C] border border-white/[0.06] rounded p-3">
                    <div className="text-[11px] text-zinc-400">
                      {previewParams.enclosureType === 'sealed'
                        ? isEn
                          ? 'Weight & Sheets'
                          : 'Waga i arkusze'
                        : isEn
                          ? 'Port Flow & Weight'
                          : 'Przepływ i waga'}
                    </div>
                    <div className="font-mono-num text-sm font-semibold text-white mt-1">
                      {previewParams.enclosureType === 'sealed'
                        ? `${toDisplayWeightKg(previewSheet.estimatedWeightKg, unitSystem).toFixed(1)} ${u.weight}`
                        : `${formatArea(previewAcoustics.portAreaCm2, unitSystem, 0, 1)} · ${formatVel(previewAcoustics.portVelocityMs, unitSystem, 1, 1)}`}
                    </div>
                    <div className="font-mono-num text-[11px] text-zinc-500 mt-0.5">
                      {previewParams.enclosureType === 'sealed'
                        ? `${previewSheet.sheetCount} ${isEn ? 'sheet(s)' : 'ark.'} · ${previewSheet.utilizationPercent.toFixed(0)}%`
                        : `${isEn ? 'Box weight' : 'Waga skrzyni'}: ${toDisplayWeightKg(previewSheet.estimatedWeightKg, unitSystem).toFixed(1)} ${u.weight}`}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="px-4 sm:px-5 py-3 bg-[#0D0F14] border-t border-white/[0.08] flex items-center justify-between gap-3 shrink-0">
          <div>
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-200 bg-[#161920] border border-white/15 rounded-md hover:bg-white/10 transition-colors whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{isEn ? 'Back' : 'Wstecz'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 text-xs font-medium text-zinc-400 hover:text-white transition-colors whitespace-nowrap"
              >
                {isEn ? 'Cancel' : 'Anuluj'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {step < 3 ? (
              <button
                type="button"
                data-testid="wizard-next-btn"
                onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-500 transition-colors whitespace-nowrap"
              >
                <span>{isEn ? 'Next Step' : 'Dalej'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                data-testid="wizard-create-project"
                onClick={() => {
                  const templatePreset = buildWizardTemplatePreset(
                    {
                      application,
                      driver: selectedDriver,
                      driverCount,
                      enclosureType: enclosureChoice,
                      sizePriority,
                      material,
                      thickness,
                      coilWiring: elecLoad.effectiveCoilWiring,
                      arrayWiring,
                      customTarget: customTargetConfig,
                    },
                    previewParams,
                    previewAcoustics,
                    projectTitle,
                  );
                  onCreateProject(previewParams, templatePreset);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-500 transition-colors whitespace-nowrap"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isEn ? 'Create Project' : 'Utwórz projekt'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
