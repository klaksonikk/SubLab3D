import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit3,
  Plus,
  Save,
  Sliders,
  Trash2,
  X,
} from 'lucide-react';
import { BOX_TEMPLATE_PRESETS, DRIVER_PRESETS, getTemplateName } from '../engine/presets';
import { computeDerivedDriverMetrics } from '../engine/simulator';
import { computeElectricalLoad } from '../engine/tsSolver';
import type {
  AcousticResult,
  BoxAutoCalcField,
  BoxParams,
  CoilWiringMode,
  DriverFace,
  DriverPattern,
  DriverPreset,
  DriverWiringType,
  EnclosureType,
  JoineryType,
  MaterialType,
  PortControlMode,
  PortFace,
  RoundPortOrientation,
  SlotPortSide,
  VoiceCoilCount,
} from '../engine/types';
import {
  formatLen,
  formatLenNum,
  formatVolNum,
  fromDisplayArea,
  fromDisplayLen,
  fromDisplayVol,
  getUnitLabels,
  toDisplayArea,
  toDisplayLen,
  toDisplayMassG,
  toDisplaySmallVol,
  toDisplayVol,
} from '../engine/units';
import { formatDecimal, useI18n } from '../i18n';
import { ImmediateNumberInput } from './ImmediateNumberInput';

interface SidebarControlsProps {
  params: BoxParams;
  acoustics: AcousticResult;
  customDrivers: DriverPreset[];
  onChange: (patch: Partial<BoxParams>) => void;
  onApplyTemplate: (templateId: string) => void;
  onSaveCustomDriver: (
    driver: DriverPreset,
    applyToProjectToo?: boolean,
    coilWiring?: CoilWiringMode,
  ) => void;
  onDeleteCustomDriver: (driverId: string) => void;
  onOpenDriverModal: (editTarget: DriverPreset | null, template?: DriverPreset) => void;
  mobileDrawerOpen?: boolean;
  onCloseMobileDrawer?: () => void;
}

interface ImmediateNumberRowProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  decimals?: number;
  unit: string;
  onChange: (val: number) => void;
}

function ImmediateNumberRow({
  id,
  label,
  value,
  min,
  max,
  decimals = 1,
  unit,
  onChange,
}: ImmediateNumberRowProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-xs text-zinc-300 min-w-0 leading-snug">
        {label}
      </label>
      <div className="flex items-center gap-1.5 shrink-0">
        <ImmediateNumberInput
          id={id}
          value={value}
          min={min}
          max={max}
          decimals={decimals}
          onChange={onChange}
          className="w-20 sm:w-24 bg-[#08090C] border border-white/[0.12] rounded px-2 py-1 text-right font-mono-num text-xs text-white focus:outline-none focus:border-red-500"
        />
        <span className="text-[11px] text-zinc-500 w-7 sm:w-8 whitespace-nowrap">{unit}</span>
      </div>
    </div>
  );
}

interface ReadOnlyComputedFieldProps {
  id: string;
  label: string;
  valueText: string;
  unit: string;
  hint?: string;
}

function ReadOnlyComputedField({ id, label, valueText, unit, hint }: ReadOnlyComputedFieldProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs text-zinc-400 min-w-0 leading-snug">
          {label}
          <span className="text-red-400 ml-0.5">*</span>
        </label>
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            id={id}
            type="text"
            readOnly
            aria-readonly="true"
            value={valueText}
            className="w-20 sm:w-24 bg-[#08090C] border border-white/[0.08] rounded px-2 py-1 text-right font-mono-num text-xs text-zinc-300 cursor-not-allowed select-all focus:outline-none"
          />
          <span className="text-[11px] text-zinc-500 w-7 sm:w-8 whitespace-nowrap">{unit}</span>
        </div>
      </div>
      {hint && <p className="text-[11px] text-zinc-500 leading-snug">{hint}</p>}
    </div>
  );
}

function buildPresetPatch(preset: DriverPreset): Partial<BoxParams> {
  const voiceCoilCount: VoiceCoilCount = preset.voiceCoilCount === 2 ? 2 : 1;
  const coilNominalOhms =
    preset.coilNominalOhms ?? (voiceCoilCount === 2 ? (preset.zNom ?? 4) / 2 : preset.zNom ?? 4);
  const coilReOhms =
    preset.coilReOhms ??
    (voiceCoilCount === 2 ? (preset.re ?? coilNominalOhms * 1.6) / 2 : preset.re ?? 3.2);
  const coilWiring: CoilWiringMode = voiceCoilCount === 2 ? 'series' : 'single';
  return {
    driverPresetId: preset.id,
    driverName: preset.name,
    driverCutoutDia: preset.cutoutDia,
    driverOuterDia: preset.outerDia,
    driverDepth: preset.depth,
    driverDisplacement: preset.displacement,
    driverFs: preset.fs,
    driverQts: preset.qts,
    driverVas: preset.vas,
    driverXmax: preset.xmax,
    driverPowerW: preset.powerW,
    driverVoiceCoilCount: voiceCoilCount,
    driverCoilNominalOhms: coilNominalOhms,
    driverCoilReOhms: coilReOhms,
    driverCoilLeMh: preset.le ?? 1.4,
    driverCoilWiring: coilWiring,
  };
}

export function SidebarControls({
  params,
  acoustics,
  customDrivers,
  onChange,
  onApplyTemplate,
  onSaveCustomDriver,
  onDeleteCustomDriver,
  onOpenDriverModal,
  mobileDrawerOpen = false,
  onCloseMobileDrawer,
}: SidebarControlsProps) {
  const { lang, unitSystem } = useI18n();
  const en = lang === 'en';
  const u = getUnitLabels(unitSystem);
  const isImp = unitSystem === 'imperial';
  const [openSection, setOpenSection] = useState<'box' | 'port' | 'driver'>('box');

  const enclosureTypes: Array<{ id: EnclosureType; label: string }> = [
    { id: 'vented_slot', label: en ? 'Slot Port' : 'Szczelin.' },
    { id: 'vented_round', label: en ? 'Aero Port' : 'Okrągła' },
    { id: 'sealed', label: en ? 'Sealed' : 'Zamknięta' },
    { id: 'bandpass_4th', label: en ? '4th BP' : 'BP 4-rz.' },
    { id: 'bandpass_6th', label: en ? '6th BP' : 'BP 6-rz.' },
  ];

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

  const elecLoad = useMemo(
    () =>
      computeElectricalLoad(
        {
          voiceCoilCount: params.driverVoiceCoilCount,
          coilNominalOhms: params.driverCoilNominalOhms,
          coilReOhms: params.driverCoilReOhms,
          baseLeMh: params.driverCoilLeMh,
          coilWiring: params.driverCoilWiring,
          driverCount: params.driverCount,
          arrayWiring: params.driverArrayWiring,
        },
        lang,
      ),
    [
      params.driverVoiceCoilCount,
      params.driverCoilNominalOhms,
      params.driverCoilReOhms,
      params.driverCoilLeMh,
      params.driverCoilWiring,
      params.driverCount,
      params.driverArrayWiring,
      lang,
    ],
  );

  const liveDriverPreview = useMemo(() => {
    const mergedPreset: DriverPreset = {
      ...activeDriverPreset,
      cutoutDia: params.driverCutoutDia,
      outerDia: params.driverOuterDia,
      depth: params.driverDepth,
      displacement: params.driverDisplacement,
      fs: params.driverFs,
      qts: params.driverQts,
      vas: params.driverVas,
      xmax: params.driverXmax,
      powerW: params.driverPowerW,
      voiceCoilCount: params.driverVoiceCoilCount,
      coilNominalOhms: params.driverCoilNominalOhms,
      coilReOhms: params.driverCoilReOhms,
      le: params.driverCoilLeMh,
    };
    return computeDerivedDriverMetrics(
      params,
      elecLoad.totalReOhms,
      mergedPreset,
      params.driverCoilWiring,
      params.driverArrayWiring,
    );
  }, [activeDriverPreset, params, elecLoad.totalReOhms]);

  const handleDriverPresetChange = (presetId: string) => {
    const preset = allDrivers.find((d) => d.id === presetId);
    if (!preset) return;
    onChange(buildPresetPatch(preset));
  };

  const handleUpdateActiveCustomDriver = () => {
    if (!activeCustomDriver) return;
    const isDvc = params.driverVoiceCoilCount === 2;
    const seriesRe = isDvc ? params.driverCoilReOhms * 2 : params.driverCoilReOhms;
    const seriesZ = isDvc ? params.driverCoilNominalOhms * 2 : params.driverCoilNominalOhms;
    onSaveCustomDriver(
      {
        ...activeCustomDriver,
        cutoutDia: params.driverCutoutDia,
        outerDia: params.driverOuterDia,
        depth: params.driverDepth,
        displacement: params.driverDisplacement,
        fs: params.driverFs,
        qts: params.driverQts,
        vas: params.driverVas,
        xmax: params.driverXmax,
        powerW: params.driverPowerW,
        voiceCoilCount: params.driverVoiceCoilCount,
        coilNominalOhms: params.driverCoilNominalOhms,
        coilReOhms: params.driverCoilReOhms,
        re: Number(seriesRe.toFixed(2)),
        le: params.driverCoilLeMh,
        zNom: Number(seriesZ.toFixed(1)),
      },
      true,
      params.driverCoilWiring,
    );
  };

  const isBandpass =
    params.enclosureType === 'bandpass_4th' || params.enclosureType === 'bandpass_6th';

  const handleBoxAutoFieldChange = (nextField: BoxAutoCalcField) => {
    const patch: Partial<BoxParams> = {
      boxAutoCalcField: nextField,
      externalWidth: Math.round(acoustics.effectiveExternalWidth),
      externalHeight: Math.round(acoustics.effectiveExternalHeight),
      externalDepth: Math.round(acoustics.effectiveExternalDepth),
    };
    if (params.boxAutoCalcField === 'none' && nextField !== 'none') {
      patch.targetNetVolumeL = Math.max(8, Math.round(acoustics.netVolumeL * 10) / 10);
    }
    onChange(patch);
  };

  const handlePortModeChange = (nextMode: PortControlMode) => {
    const patch: Partial<BoxParams> = {
      portControlMode: nextMode,
      portWidth: Math.round(acoustics.effectivePortWidth),
      portDiameter: Math.round(acoustics.effectivePortDiameter),
      portLength: Math.round(acoustics.effectivePortLength),
      portRearWidth: Math.round(acoustics.effectiveRearPortWidth),
      portRearLength: Math.round(acoustics.effectiveRearPortLength),
    };
    if (nextMode !== 'dimensions') {
      patch.targetTuningHz =
        acoustics.tuningHz && acoustics.tuningHz > 10
          ? Math.round(acoustics.tuningHz * 10) / 10
          : params.targetTuningHz || 35;
      patch.targetPortAreaCm2 =
        acoustics.portAreaCm2 > 10
          ? Math.round(acoustics.portAreaCm2)
          : params.targetPortAreaCm2 || 180;
      if (params.enclosureType === 'bandpass_6th') {
        patch.targetRearTuningHz =
          acoustics.rearPortTuningHz && acoustics.rearPortTuningHz > 10
            ? Math.round(acoustics.rearPortTuningHz * 10) / 10
            : params.targetRearTuningHz || 30;
        patch.targetRearPortAreaCm2 =
          acoustics.rearPortAreaCm2 > 10
            ? Math.round(acoustics.rearPortAreaCm2)
            : params.targetRearPortAreaCm2 || 160;
      }
    }
    onChange(patch);
  };

  return (
    <aside
      aria-label={en ? 'Enclosure project parameters' : 'Parametry projektu obudowy'}
      className={`${
        mobileDrawerOpen
          ? 'w-[min(420px,92vw)] h-full shadow-2xl'
          : 'w-full lg:w-[400px] xl:w-[420px] lg:h-full'
      } shrink-0 bg-[#111318] border-r border-white/[0.08] flex flex-col overflow-hidden`}
    >
      {mobileDrawerOpen && onCloseMobileDrawer && (
        <div className="lg:hidden px-4 py-3 bg-[#0D0F14] border-b border-white/[0.08] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <Sliders className="w-4 h-4 text-red-400" />
            <span>{en ? 'Project Parameters' : 'Parametry projektu'}</span>
          </div>
          <button
            type="button"
            onClick={onCloseMobileDrawer}
            data-testid="mobile-params-close"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-red-600 rounded hover:bg-red-500 transition-colors"
          >
            <span>{en ? 'Done' : 'Gotowe'}</span>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Template & Enclosure Topology Selector */}
      <div className="p-3.5 sm:p-4 border-b border-white/[0.08] space-y-3.5 shrink-0">
        <div>
          <label htmlFor="template-select" className="block text-xs font-medium text-zinc-300 mb-1.5">
            {en ? 'Project Template Preset' : 'Gotowy szablon projektu'}
          </label>
          <select
            id="template-select"
            defaultValue="daily-12-slot"
            onChange={(e) => onApplyTemplate(e.target.value)}
            className="w-full bg-[#08090C] border border-white/[0.12] rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
          >
            {BOX_TEMPLATE_PRESETS.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {getTemplateName(tpl, lang)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="block text-xs font-medium text-zinc-300 mb-1.5">
            {en ? 'Enclosure Type' : 'Typ obudowy'}
          </span>
          <div
            className="grid grid-cols-3 sm:grid-cols-5 gap-1 p-1 bg-[#08090C] border border-white/[0.08] rounded-md"
            role="group"
            aria-label={en ? 'Enclosure Type' : 'Typ obudowy'}
          >
            {enclosureTypes.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onChange({ enclosureType: item.id })}
                className={`py-1.5 px-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap truncate ${
                  params.enclosureType === item.id
                    ? 'bg-red-600 text-white font-semibold'
                    : 'text-zinc-300 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scrollable Accordion Parameter Groups */}
      <div className="flex-1 overflow-y-auto cad-scroll divide-y divide-white/[0.08]">
        {/* Section 1: Dimensions & Material */}
        <div>
          <button
            type="button"
            onClick={() => setOpenSection(openSection === 'box' ? 'port' : 'box')}
            aria-expanded={openSection === 'box'}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-sm font-semibold text-white">
                {en ? '01. External Dimensions & Board' : '01. Wymiary zewnętrzne i płyta'}
              </span>
            </div>
            {openSection === 'box' ? (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            )}
          </button>

          {openSection === 'box' && (
            <div className="px-4 pb-4 pt-1 space-y-3">
              {/* Auto-calculated box dimension selector */}
              <div className="space-y-1.5">
                <span className="block text-xs text-zinc-300">
                  {en ? 'Auto-calculate' : 'Wyliczaj automatycznie'}
                </span>
                <div
                  className="grid grid-cols-4 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                  role="group"
                  aria-label={
                    en
                      ? 'Auto-calculated enclosure dimension'
                      : 'Automatycznie wyliczany wymiar obudowy'
                  }
                >
                  {(
                    [
                      { id: 'none', label: en ? 'Volume*' : 'Objętość*' },
                      { id: 'width', label: en ? 'Width (W)*' : 'Szer. (W)*' },
                      { id: 'height', label: en ? 'Height (H)*' : 'Wys. (H)*' },
                      { id: 'depth', label: en ? 'Depth (D)*' : 'Głęb. (D)*' },
                    ] as Array<{ id: BoxAutoCalcField; label: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleBoxAutoFieldChange(opt.id)}
                      className={`py-1 px-1 text-[11px] rounded transition-colors whitespace-nowrap ${
                        params.boxAutoCalcField === opt.id
                          ? 'bg-red-600 text-white font-semibold'
                          : 'text-zinc-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {params.boxAutoCalcField === 'width' ? (
                <ReadOnlyComputedField
                  id="ext-width-auto"
                  label={en ? 'External Width (W)' : 'Szerokość zewnętrzna (W)'}
                  valueText={formatDecimal(
                    toDisplayLen(acoustics.effectiveExternalWidth, unitSystem),
                    isImp ? 2 : 1,
                    lang,
                  )}
                  unit={u.len}
                />
              ) : (
                <ImmediateNumberRow
                  id="ext-width"
                  label={en ? 'External Width (W)' : 'Szerokość zewnętrzna (W)'}
                  value={toDisplayLen(params.externalWidth, unitSystem)}
                  min={toDisplayLen(220, unitSystem)}
                  max={toDisplayLen(1800, unitSystem)}
                  decimals={isImp ? 2 : 0}
                  unit={u.len}
                  onChange={(val) => onChange({ externalWidth: fromDisplayLen(val, unitSystem) })}
                />
              )}

              {params.boxAutoCalcField === 'height' ? (
                <ReadOnlyComputedField
                  id="ext-height-auto"
                  label={en ? 'External Height (H)' : 'Wysokość zewnętrzna (H)'}
                  valueText={formatDecimal(
                    toDisplayLen(acoustics.effectiveExternalHeight, unitSystem),
                    isImp ? 2 : 1,
                    lang,
                  )}
                  unit={u.len}
                />
              ) : (
                <ImmediateNumberRow
                  id="ext-height"
                  label={en ? 'External Height (H)' : 'Wysokość zewnętrzna (H)'}
                  value={toDisplayLen(params.externalHeight, unitSystem)}
                  min={toDisplayLen(180, unitSystem)}
                  max={toDisplayLen(1400, unitSystem)}
                  decimals={isImp ? 2 : 0}
                  unit={u.len}
                  onChange={(val) => onChange({ externalHeight: fromDisplayLen(val, unitSystem) })}
                />
              )}

              {params.boxAutoCalcField === 'depth' ? (
                <ReadOnlyComputedField
                  id="ext-depth-auto"
                  label={en ? 'External Depth (D)' : 'Głębokość zewnętrzna (D)'}
                  valueText={formatDecimal(
                    toDisplayLen(acoustics.effectiveExternalDepth, unitSystem),
                    isImp ? 2 : 1,
                    lang,
                  )}
                  unit={u.len}
                />
              ) : (
                <ImmediateNumberRow
                  id="ext-depth"
                  label={en ? 'External Depth (D)' : 'Głębokość zewnętrzna (D)'}
                  value={toDisplayLen(params.externalDepth, unitSystem)}
                  min={toDisplayLen(160, unitSystem)}
                  max={toDisplayLen(1400, unitSystem)}
                  decimals={isImp ? 2 : 0}
                  unit={u.len}
                  onChange={(val) => onChange({ externalDepth: fromDisplayLen(val, unitSystem) })}
                />
              )}

              {/* Target Net Volume & Auto Total Gross Volume */}
              <div className="bg-[#08090C] border border-white/[0.08] rounded-md p-3 space-y-2.5">
                {params.boxAutoCalcField !== 'none' ? (
                  <ImmediateNumberRow
                    id="target-net-vol"
                    label={en ? 'Net Volume (Vnet)' : 'Objętość netto (Vnet)'}
                    value={toDisplayVol(params.targetNetVolumeL, unitSystem)}
                    min={toDisplayVol(6, unitSystem)}
                    max={toDisplayVol(800, unitSystem)}
                    decimals={isImp ? 2 : 1}
                    unit={u.vol}
                    onChange={(val) =>
                      onChange({ targetNetVolumeL: fromDisplayVol(val, unitSystem) })
                    }
                  />
                ) : (
                  <ReadOnlyComputedField
                    id="net-vol-auto"
                    label={en ? 'Net Volume (Vnet)' : 'Objętość netto (Vnet)'}
                    valueText={formatDecimal(
                      toDisplayVol(acoustics.netVolumeL, unitSystem),
                      isImp ? 2 : 2,
                      lang,
                    )}
                    unit={u.vol}
                  />
                )}
                <ReadOnlyComputedField
                  id="gross-vol-auto"
                  label={en ? 'Total Internal Volume (Gross)' : 'Całkowita obj. wewnętrzna (Brutto)'}
                  valueText={formatDecimal(
                    toDisplayVol(acoustics.grossVolumeL, unitSystem),
                    isImp ? 2 : 2,
                    lang,
                  )}
                  unit={u.vol}
                />
                <div className="text-[10px] text-zinc-500">
                  {en
                    ? '* Fields marked with an asterisk are calculated live automatically.'
                    : '* Pola oznaczone gwiazdką są wyliczane automatycznie na żywo.'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label htmlFor="material-select" className="block text-xs text-zinc-300 mb-1">
                    {en ? 'Board Material' : 'Materiał płyty'}
                  </label>
                  <select
                    id="material-select"
                    value={params.material}
                    onChange={(e) => onChange({ material: e.target.value as MaterialType })}
                    className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
                  >
                    <option value="birch_plywood">
                      {en ? 'Birch Plywood' : 'Sklejka brzozowa'}
                    </option>
                    <option value="mdf">{en ? 'Raw MDF Board' : 'Płyta MDF surowa'}</option>
                    <option value="matte_black">
                      {en ? 'Black Laminate' : 'Laminat czarny'}
                    </option>
                  </select>
                </div>

                <div>
                  <label htmlFor="thickness-select" className="block text-xs text-zinc-300 mb-1">
                    {en ? 'Wall Thickness' : 'Grubość ścianki'}
                  </label>
                  <select
                    id="thickness-select"
                    value={params.thickness}
                    onChange={(e) => onChange({ thickness: Number(e.target.value) })}
                    className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs text-white font-mono-num focus:outline-none focus:border-red-500"
                  >
                    {[15, 18, 19, 22, 25].map((t) => (
                      <option key={t} value={t}>
                        {isImp ? `${toDisplayLen(t, unitSystem).toFixed(2)} in` : `${t} mm`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="joinery-select" className="block text-xs text-zinc-300 mb-1">
                  {en ? 'Panel Joinery (Cut-List)' : 'Sposób łączenia płyt (Cut-List)'}
                </label>
                <select
                  id="joinery-select"
                  value={params.joineryType}
                  onChange={(e) => onChange({ joineryType: e.target.value as JoineryType })}
                  className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
                >
                  <option value="top_bottom_cover">
                    {en
                      ? 'Top/bottom overlap sides (standard)'
                      : 'Wieńce góra/dół na bokach (standard)'}
                  </option>
                  <option value="sides_full">
                    {en
                      ? 'Full sides (top/bottom inset)'
                      : 'Boki pełne (wieńce między bokami)'}
                  </option>
                  <option value="front_back_cover">
                    {en
                      ? 'Front/back overlap entire shell'
                      : 'Front i tył nakładane na całość'}
                  </option>
                </select>
              </div>

              <ImmediateNumberRow
                id="bracing-vol"
                label={en ? 'Bracing Displacement' : 'Wyporność wzmocnień (Bracing)'}
                value={toDisplayVol(params.bracingVolumeL, unitSystem)}
                min={0}
                max={toDisplayVol(30, unitSystem)}
                decimals={isImp ? 3 : 2}
                unit={u.vol}
                onChange={(val) => onChange({ bracingVolumeL: fromDisplayVol(val, unitSystem) })}
              />
            </div>
          )}
        </div>

        {/* Section 2: Port / Bandpass Chamber */}
        <div>
          <button
            type="button"
            onClick={() => setOpenSection(openSection === 'port' ? 'driver' : 'port')}
            aria-expanded={openSection === 'port'}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="w-6 shrink-0 inline-flex items-center justify-center font-mono-num text-[11px] font-bold text-red-400">
                Hz
              </span>
              <span className="text-sm font-semibold text-white">
                {params.enclosureType === 'sealed'
                  ? en
                    ? '02. Sealed Chamber Parameters'
                    : '02. Parametry komory zamkniętej'
                  : params.enclosureType === 'bandpass_6th'
                    ? en
                      ? '02. 6th-Order Bandpass (Dual Ports)'
                      : '02. Bandpass 6-rzędu (Dwa porty)'
                    : en
                      ? '02. Bass-Reflex Port & Tuning'
                      : '02. Tunel Bass-Reflex i strojenie'}
              </span>
            </div>
            {openSection === 'port' ? (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            )}
          </button>

          {openSection === 'port' && (
            <div className="px-4 pb-4 pt-1 space-y-3">
              {params.enclosureType !== 'sealed' && (
                <div className="space-y-1.5">
                  <span className="block text-xs text-zinc-300">
                    {en ? 'Auto-calculate (port)' : 'Wyliczaj automatycznie (port)'}
                  </span>
                  <div
                    className="grid grid-cols-3 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                    role="group"
                    aria-label={
                      en
                        ? 'Port auto-calculation mode'
                        : 'Tryb wyliczania parametrów portu'
                    }
                  >
                    {(
                      [
                        { id: 'dimensions', label: en ? 'Tuning Fb*' : 'Strojenie Fb*' },
                        { id: 'tuning', label: en ? 'Length (L)*' : 'Długość (L)*' },
                        { id: 'area_from_length', label: en ? 'Area (S)*' : 'Pole (S)*' },
                      ] as Array<{ id: PortControlMode; label: string }>
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handlePortModeChange(opt.id)}
                        className={`py-1 px-1 text-[11px] rounded transition-colors whitespace-nowrap ${
                          params.portControlMode === opt.id
                            ? 'bg-red-600 text-white font-semibold'
                            : 'text-zinc-300 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {params.enclosureType === 'sealed' ? (
                <div className="bg-[#08090C] border border-white/[0.08] rounded-md p-3 text-xs text-zinc-300 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">
                      {en ? 'Target audiophile Qtc:' : 'Docelowe Qtc audiofilskie:'}
                    </span>
                    <span className="font-mono-num text-white">0.707 (Butterworth)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">
                      {en ? 'Compact punch Qtc:' : 'Kompaktowe Qtc (punch):'}
                    </span>
                    <span className="font-mono-num text-zinc-200">0.92 (Chebyshev C2)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">
                      {en ? 'Current box Qtc:' : 'Aktualne Qtc obudowy:'}
                    </span>
                    <span className="font-mono-num text-red-400 font-semibold">
                      {acoustics.sealedQtc ? formatDecimal(acoustics.sealedQtc, 3, lang) : '—'}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 pt-1 leading-relaxed">
                    {en
                      ? 'A sealed enclosure needs no port. Increasing volume lowers Qtc for deeper extension; decreasing raises Qtc for tighter mid-bass punch.'
                      : 'Obudowa zamknięta nie wymaga tunelu. Zwiększenie objętości obniża Qtc i poprawia zejście; zmniejszenie podbija średni bas.'}
                  </p>
                </div>
              ) : params.enclosureType === 'vented_round' ? (
                <>
                  <div className="space-y-1.5">
                    <span className="block text-xs text-zinc-300">
                      {en ? 'Pipe Face Placement (Aero-port)' : 'Umiejscowienie rury (Aero-port)'}
                    </span>
                    <div
                      className="grid grid-cols-2 sm:grid-cols-4 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                      role="group"
                      aria-label={en ? 'Pipe placement face' : 'Umiejscowienie rury'}
                    >
                      {(
                        [
                          { id: 'front', label: en ? 'Front' : 'Przód' },
                          { id: 'top', label: en ? 'Top' : 'Góra' },
                          { id: 'side_right', label: en ? 'Right Side' : 'Prawy bok' },
                          { id: 'side_left', label: en ? 'Left Side' : 'Lewy bok' },
                        ] as Array<{ id: PortFace; label: string }>
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            onChange({ portFace: opt.id, portOffsetX: 0, portOffsetY: 0 })
                          }
                          className={`py-1 px-1 text-[11px] rounded transition-colors whitespace-nowrap ${
                            params.portFace === opt.id
                              ? 'bg-red-600 text-white font-semibold'
                              : 'text-zinc-300 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-300">
                      {en ? 'Pipe Count (Aero-port)' : 'Liczba rur (Aero-port)'}
                    </span>
                    <div className="flex gap-1 bg-[#08090C] p-0.5 rounded border border-white/[0.08]">
                      {[1, 2, 3, 4].map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => onChange({ portCount: cnt as 1 | 2 | 3 | 4 })}
                          className={`px-2.5 py-1 text-xs font-mono-num rounded ${
                            params.portCount === cnt
                              ? 'bg-red-600 text-white font-semibold'
                              : 'text-zinc-300 hover:text-white'
                          }`}
                        >
                          {cnt}×
                        </button>
                      ))}
                    </div>
                  </div>
                  {params.portCount >= 2 && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-300">
                        {en ? 'Pipe Arrangement' : 'Układ rur'}
                      </span>
                      <div
                        className="flex gap-1 bg-[#08090C] p-0.5 rounded border border-white/[0.08]"
                        role="group"
                        aria-label={en ? 'Pipe arrangement' : 'Układ rur'}
                      >
                        {(
                          [
                            { id: 'auto', label: 'Auto' },
                            { id: 'vertical', label: en ? 'Vertical' : 'Pion' },
                            { id: 'horizontal', label: en ? 'Horizontal' : 'Poziom' },
                          ] as Array<{ id: RoundPortOrientation; label: string }>
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => onChange({ portOrientation: opt.id })}
                            className={`px-2 py-1 text-[11px] rounded transition-colors whitespace-nowrap ${
                              params.portOrientation === opt.id
                                ? 'bg-red-600 text-white font-semibold'
                                : 'text-zinc-300 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {params.portControlMode === 'tuning' ? (
                    <div className="space-y-2.5 bg-[#08090C] border border-white/[0.08] rounded-md p-3">
                      <ImmediateNumberRow
                        id="target-fb-round"
                        label={en ? 'Port Tuning Fb' : 'Strojenie portu Fb'}
                        value={params.targetTuningHz}
                        min={15}
                        max={90}
                        decimals={1}
                        unit="Hz"
                        onChange={(targetTuningHz) => onChange({ targetTuningHz })}
                      />
                      <ImmediateNumberRow
                        id="target-area-round"
                        label={en ? 'Port Cross-Section Area' : 'Pole przekroju portu'}
                        value={toDisplayArea(params.targetPortAreaCm2, unitSystem)}
                        min={toDisplayArea(15, unitSystem)}
                        max={toDisplayArea(2500, unitSystem)}
                        decimals={isImp ? 2 : 1}
                        unit={u.area}
                        onChange={(val) =>
                          onChange({ targetPortAreaCm2: fromDisplayArea(val, unitSystem) })
                        }
                      />
                      <div className="pt-2 border-t border-white/[0.08] space-y-2">
                        <ReadOnlyComputedField
                          id="auto-port-len-round"
                          label={en ? 'Port Length (L)' : 'Długość portu (L)'}
                          valueText={formatDecimal(
                            toDisplayLen(acoustics.effectivePortLength, unitSystem),
                            isImp ? 2 : 1,
                            lang,
                          )}
                          unit={u.len}
                        />
                        <ReadOnlyComputedField
                          id="auto-port-disp-round"
                          label={en ? 'Port Displacement' : 'Wyporność portu'}
                          valueText={formatDecimal(
                            toDisplayVol(acoustics.portTotalDisplacementL, unitSystem),
                            isImp ? 3 : 2,
                            lang,
                          )}
                          unit={u.vol}
                        />
                        <ReadOnlyComputedField
                          id="auto-port-dia-round"
                          label={
                            en
                              ? `Diameter per pipe (${params.portCount}×)`
                              : `Średnica 1 rury (${params.portCount}×)`
                          }
                          valueText={formatDecimal(
                            toDisplayLen(acoustics.effectivePortDiameter, unitSystem),
                            isImp ? 2 : 1,
                            lang,
                          )}
                          unit={u.len}
                        />
                      </div>
                    </div>
                  ) : params.portControlMode === 'area_from_length' ? (
                    <div className="space-y-2.5 bg-[#08090C] border border-white/[0.08] rounded-md p-3">
                      <ImmediateNumberRow
                        id="target-fb-round-len"
                        label={en ? 'Port Tuning Fb' : 'Strojenie portu Fb'}
                        value={params.targetTuningHz}
                        min={15}
                        max={90}
                        decimals={1}
                        unit="Hz"
                        onChange={(targetTuningHz) => onChange({ targetTuningHz })}
                      />
                      <ImmediateNumberRow
                        id="port-len-round"
                        label={en ? 'Pipe Length (L)' : 'Długość rury (L)'}
                        value={toDisplayLen(params.portLength, unitSystem)}
                        min={toDisplayLen(40, unitSystem)}
                        max={toDisplayLen(1600, unitSystem)}
                        decimals={isImp ? 2 : 0}
                        unit={u.len}
                        onChange={(val) => onChange({ portLength: fromDisplayLen(val, unitSystem) })}
                      />
                      <div className="pt-2 border-t border-white/[0.08] space-y-2">
                        <ReadOnlyComputedField
                          id="auto-port-area-round"
                          label={en ? 'Port Cross-Section Area' : 'Pole przekroju portu'}
                          valueText={formatDecimal(
                            toDisplayArea(acoustics.portAreaCm2, unitSystem),
                            isImp ? 2 : 1,
                            lang,
                          )}
                          unit={u.area}
                        />
                        <ReadOnlyComputedField
                          id="auto-port-dia-round"
                          label={
                            en
                              ? `Diameter per pipe (${params.portCount}×)`
                              : `Średnica 1 rury (${params.portCount}×)`
                          }
                          valueText={formatDecimal(
                            toDisplayLen(acoustics.effectivePortDiameter, unitSystem),
                            isImp ? 2 : 1,
                            lang,
                          )}
                          unit={u.len}
                        />
                        <ReadOnlyComputedField
                          id="auto-port-disp-round"
                          label={en ? 'Port Displacement' : 'Wyporność portu'}
                          valueText={formatDecimal(
                            toDisplayVol(acoustics.portTotalDisplacementL, unitSystem),
                            isImp ? 3 : 2,
                            lang,
                          )}
                          unit={u.vol}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <ImmediateNumberRow
                        id="port-dia"
                        label={en ? 'Pipe Inner Diameter' : 'Średnica wewnętrzna rury'}
                        value={toDisplayLen(params.portDiameter, unitSystem)}
                        min={toDisplayLen(35, unitSystem)}
                        max={toDisplayLen(350, unitSystem)}
                        decimals={isImp ? 2 : 0}
                        unit={u.len}
                        onChange={(val) =>
                          onChange({ portDiameter: fromDisplayLen(val, unitSystem) })
                        }
                      />
                      <ImmediateNumberRow
                        id="port-len-round"
                        label={en ? 'Pipe Length (L)' : 'Długość rury (L)'}
                        value={toDisplayLen(params.portLength, unitSystem)}
                        min={toDisplayLen(40, unitSystem)}
                        max={toDisplayLen(1400, unitSystem)}
                        decimals={isImp ? 2 : 0}
                        unit={u.len}
                        onChange={(val) => onChange({ portLength: fromDisplayLen(val, unitSystem) })}
                      />
                      <div className="bg-[#08090C] border border-white/[0.08] rounded-md p-2.5 space-y-1.5">
                        <ReadOnlyComputedField
                          id="auto-fb-round"
                          label={en ? 'Port Tuning Fb' : 'Strojenie portu Fb'}
                          valueText={
                            acoustics.tuningHz ? formatDecimal(acoustics.tuningHz, 1, lang) : '—'
                          }
                          unit="Hz"
                        />
                        <ReadOnlyComputedField
                          id="auto-area-round"
                          label={en ? 'Port Cross-Section Area' : 'Pole przekroju portu'}
                          valueText={formatDecimal(
                            toDisplayArea(acoustics.portAreaCm2, unitSystem),
                            isImp ? 2 : 1,
                            lang,
                          )}
                          unit={u.area}
                        />
                        <ReadOnlyComputedField
                          id="auto-disp-round"
                          label={en ? 'Port Displacement' : 'Wyporność portu'}
                          valueText={formatDecimal(
                            toDisplayVol(acoustics.portTotalDisplacementL, unitSystem),
                            isImp ? 3 : 2,
                            lang,
                          )}
                          unit={u.vol}
                        />
                      </div>
                    </>
                  )}

                  <div className="pt-2 border-t border-white/[0.08] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-zinc-300">
                        {en ? 'Pipe Position on Panel' : 'Pozycja rury na ścianie'}
                      </span>
                      {(params.portOffsetX !== 0 || params.portOffsetY !== 0) && (
                        <button
                          type="button"
                          onClick={() => onChange({ portOffsetX: 0, portOffsetY: 0 })}
                          className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
                        >
                          {en ? 'Reset Position' : 'Resetuj pozycję'}
                        </button>
                      )}
                    </div>
                    <ImmediateNumberRow
                      id="port-offset-x"
                      label={
                        params.portFace === 'side_left' || params.portFace === 'side_right'
                          ? en
                            ? 'Pipe Offset (Back / Front)'
                            : 'Pozycja rury (Tył / Przód)'
                          : en
                            ? 'Pipe Offset (Left / Right)'
                            : 'Pozycja rury (Lewo / Prawo)'
                      }
                      value={toDisplayLen(params.portOffsetX, unitSystem)}
                      min={toDisplayLen(acoustics.offsetBounds.portMinX, unitSystem)}
                      max={toDisplayLen(acoustics.offsetBounds.portMaxX, unitSystem)}
                      decimals={isImp ? 2 : 0}
                      unit={u.len}
                      onChange={(val) => onChange({ portOffsetX: fromDisplayLen(val, unitSystem) })}
                    />
                    <ImmediateNumberRow
                      id="port-offset-y"
                      label={
                        params.portFace === 'top'
                          ? en
                            ? 'Pipe Offset (Front / Back)'
                            : 'Pozycja rury (Przód / Tył)'
                          : en
                            ? 'Pipe Offset (Bottom / Top)'
                            : 'Pozycja rury (Dół / Góra)'
                      }
                      value={toDisplayLen(params.portOffsetY, unitSystem)}
                      min={toDisplayLen(acoustics.offsetBounds.portMinY, unitSystem)}
                      max={toDisplayLen(acoustics.offsetBounds.portMaxY, unitSystem)}
                      decimals={isImp ? 2 : 0}
                      unit={u.len}
                      onChange={(val) => onChange({ portOffsetY: fromDisplayLen(val, unitSystem) })}
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <label htmlFor="port-flared" className="text-xs text-zinc-300 cursor-pointer">
                      {en ? 'Flared Pipe Ends (Aero-Flared)' : 'Profilowane końce (Aero-Flared)'}
                    </label>
                    <input
                      id="port-flared"
                      type="checkbox"
                      checked={params.portFlared}
                      onChange={(e) => onChange({ portFlared: e.target.checked })}
                      className="w-4 h-4 accent-red-500 rounded cursor-pointer"
                    />
                  </div>
                </>
              ) : (
                <>
                  {isBandpass && (
                    <ImmediateNumberRow
                      id="bp-ratio"
                      label={en ? 'Chamber Split (Front Chamber)' : 'Podział komór (komora przednia)'}
                      value={Math.round(params.bandpassFrontRatio * 100)}
                      min={25}
                      max={75}
                      decimals={0}
                      unit="%"
                      onChange={(pct) => onChange({ bandpassFrontRatio: pct / 100 })}
                    />
                  )}

                  {!isBandpass && (
                    <div className="space-y-1.5">
                      <span className="block text-xs text-zinc-300">
                        {en ? 'Slot Port Position' : 'Położenie portu szczelinowego'}
                      </span>
                      <div
                        className="grid grid-cols-3 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                        role="group"
                        aria-label={
                          en ? 'Slot port position' : 'Położenie portu szczelinowego'
                        }
                      >
                        {(
                          [
                            { id: 'left', label: en ? 'Left Wall' : 'Lewa ściana' },
                            { id: 'bottom', label: en ? 'Bottom' : 'Dół' },
                            { id: 'right', label: en ? 'Right Wall' : 'Prawa ściana' },
                          ] as Array<{ id: SlotPortSide; label: string }>
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => onChange({ portSlotSide: opt.id })}
                            className={`py-1 px-1 text-[11px] rounded transition-colors whitespace-nowrap ${
                              params.portSlotSide === opt.id
                                ? 'bg-red-600 text-white font-semibold'
                                : 'text-zinc-300 hover:text-white hover:bg-white/5'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {params.enclosureType === 'bandpass_6th' && (
                    <div className="text-[11px] font-semibold text-red-400 pt-1">
                      {en
                        ? 'Front Port — High Tuning (Fb-high)'
                        : 'Port przedni — wysokie strojenie (Fb-high)'}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <label htmlFor="port-full-height" className="text-xs text-zinc-300 cursor-pointer">
                      {!isBandpass && params.portSlotSide === 'bottom'
                        ? en
                          ? `Full Internal Width (${formatLen(acoustics.internalWidth, unitSystem, 0, 2)})`
                          : `Pełna szerokość wewnętrzna (${formatLen(acoustics.internalWidth, unitSystem, 0, 2)})`
                        : en
                          ? `Full Internal Height (${formatLen(acoustics.internalHeight, unitSystem, 0, 2)})`
                          : `Pełna wysokość wewnętrzna (${formatLen(acoustics.internalHeight, unitSystem, 0, 2)})`}
                    </label>
                    <input
                      id="port-full-height"
                      type="checkbox"
                      checked={params.portFullHeight}
                      onChange={(e) => onChange({ portFullHeight: e.target.checked })}
                      className="w-4 h-4 accent-red-500 rounded cursor-pointer"
                    />
                  </div>
                  {!params.portFullHeight && (
                    <ImmediateNumberRow
                      id="port-height"
                      label={
                        !isBandpass && params.portSlotSide === 'bottom'
                          ? en
                            ? 'Bottom Port Width'
                            : 'Szerokość portu dolnego'
                          : en
                            ? 'Slot Height (Hp)'
                            : 'Wysokość szczeliny (Hp)'
                      }
                      value={toDisplayLen(params.portHeight, unitSystem)}
                      min={toDisplayLen(30, unitSystem)}
                      max={toDisplayLen(
                        !isBandpass && params.portSlotSide === 'bottom'
                          ? Math.round(acoustics.internalWidth)
                          : Math.round(acoustics.internalHeight),
                        unitSystem,
                      )}
                      decimals={isImp ? 2 : 0}
                      unit={u.len}
                      onChange={(val) => onChange({ portHeight: fromDisplayLen(val, unitSystem) })}
                    />
                  )}

                  {params.portControlMode === 'tuning' ? (
                    <div className="space-y-2.5 bg-[#08090C] border border-white/[0.08] rounded-md p-3">
                      <ImmediateNumberRow
                        id="target-fb-slot"
                        label={en ? 'Port Tuning Fb' : 'Strojenie portu Fb'}
                        value={params.targetTuningHz}
                        min={15}
                        max={90}
                        decimals={1}
                        unit="Hz"
                        onChange={(targetTuningHz) => onChange({ targetTuningHz })}
                      />
                      <ImmediateNumberRow
                        id="target-area-slot"
                        label={en ? 'Port Cross-Section Area' : 'Pole przekroju portu'}
                        value={toDisplayArea(params.targetPortAreaCm2, unitSystem)}
                        min={toDisplayArea(15, unitSystem)}
                        max={toDisplayArea(2500, unitSystem)}
                        decimals={isImp ? 2 : 1}
                        unit={u.area}
                        onChange={(val) =>
                          onChange({ targetPortAreaCm2: fromDisplayArea(val, unitSystem) })
                        }
                      />
                      <div className="pt-2 border-t border-white/[0.08] space-y-2">
                        <ReadOnlyComputedField
                          id="auto-port-len-slot"
                          label={en ? 'Port Length' : 'Długość portu'}
                          valueText={formatDecimal(
                            toDisplayLen(acoustics.effectivePortLength, unitSystem),
                            isImp ? 2 : 1,
                            lang,
                          )}
                          unit={u.len}
                        />
                        <ReadOnlyComputedField
                          id="auto-port-disp-slot"
                          label={en ? 'Port Displacement' : 'Wyporność portu'}
                          valueText={formatDecimal(
                            toDisplayVol(acoustics.portTotalDisplacementL, unitSystem),
                            isImp ? 3 : 2,
                            lang,
                          )}
                          unit={u.vol}
                        />
                        <ReadOnlyComputedField
                          id="auto-port-width-slot"
                          label={
                            !isBandpass && params.portSlotSide === 'bottom'
                              ? en
                                ? 'Slot Height (Wp)'
                                : 'Wysokość szczeliny (Wp)'
                              : en
                                ? 'Slot Width (Wp)'
                                : 'Szerokość szczeliny (Wp)'
                          }
                          valueText={formatDecimal(
                            toDisplayLen(acoustics.effectivePortWidth, unitSystem),
                            isImp ? 2 : 1,
                            lang,
                          )}
                          unit={u.len}
                        />
                      </div>
                    </div>
                  ) : params.portControlMode === 'area_from_length' ? (
                    <div className="space-y-2.5 bg-[#08090C] border border-white/[0.08] rounded-md p-3">
                      <ImmediateNumberRow
                        id="target-fb-slot-len"
                        label={en ? 'Port Tuning Fb' : 'Strojenie portu Fb'}
                        value={params.targetTuningHz}
                        min={15}
                        max={90}
                        decimals={1}
                        unit="Hz"
                        onChange={(targetTuningHz) => onChange({ targetTuningHz })}
                      />
                      <ImmediateNumberRow
                        id="port-len-slot"
                        label={en ? 'Effective Tunnel Length (L)' : 'Długość efektywna tunelu (L)'}
                        value={toDisplayLen(params.portLength, unitSystem)}
                        min={toDisplayLen(50, unitSystem)}
                        max={toDisplayLen(2200, unitSystem)}
                        decimals={isImp ? 2 : 0}
                        unit={u.len}
                        onChange={(val) => onChange({ portLength: fromDisplayLen(val, unitSystem) })}
                      />
                      <div className="pt-2 border-t border-white/[0.08] space-y-2">
                        <ReadOnlyComputedField
                          id="auto-port-area-slot"
                          label={en ? 'Port Cross-Section Area' : 'Pole przekroju portu'}
                          valueText={formatDecimal(
                            toDisplayArea(acoustics.portAreaCm2, unitSystem),
                            isImp ? 2 : 1,
                            lang,
                          )}
                          unit={u.area}
                        />
                        <ReadOnlyComputedField
                          id="auto-port-width-slot"
                          label={
                            !isBandpass && params.portSlotSide === 'bottom'
                              ? en
                                ? 'Slot Height (Wp)'
                                : 'Wysokość szczeliny (Wp)'
                              : en
                                ? 'Slot Width (Wp)'
                                : 'Szerokość szczeliny (Wp)'
                          }
                          valueText={formatDecimal(
                            toDisplayLen(acoustics.effectivePortWidth, unitSystem),
                            isImp ? 2 : 1,
                            lang,
                          )}
                          unit={u.len}
                        />
                        <ReadOnlyComputedField
                          id="auto-port-disp-slot"
                          label={en ? 'Port Displacement' : 'Wyporność portu'}
                          valueText={formatDecimal(
                            toDisplayVol(acoustics.portTotalDisplacementL, unitSystem),
                            isImp ? 3 : 2,
                            lang,
                          )}
                          unit={u.vol}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <ImmediateNumberRow
                        id="port-width"
                        label={
                          !isBandpass && params.portSlotSide === 'bottom'
                            ? en
                              ? 'Slot Height (Wp)'
                              : 'Wysokość szczeliny (Wp)'
                            : en
                              ? 'Slot Width (Wp)'
                              : 'Szerokość szczeliny (Wp)'
                        }
                        value={toDisplayLen(params.portWidth, unitSystem)}
                        min={toDisplayLen(16, unitSystem)}
                        max={toDisplayLen(240, unitSystem)}
                        decimals={isImp ? 2 : 0}
                        unit={u.len}
                        onChange={(val) => onChange({ portWidth: fromDisplayLen(val, unitSystem) })}
                      />
                      <ImmediateNumberRow
                        id="port-len-slot"
                        label={en ? 'Effective Tunnel Length (L)' : 'Długość efektywna tunelu (L)'}
                        value={toDisplayLen(params.portLength, unitSystem)}
                        min={toDisplayLen(50, unitSystem)}
                        max={toDisplayLen(2000, unitSystem)}
                        decimals={isImp ? 2 : 0}
                        unit={u.len}
                        onChange={(val) => onChange({ portLength: fromDisplayLen(val, unitSystem) })}
                      />
                      <div className="bg-[#08090C] border border-white/[0.08] rounded-md p-2.5 space-y-1.5">
                        <ReadOnlyComputedField
                          id="auto-fb-slot"
                          label={en ? 'Port Tuning Fb' : 'Strojenie portu Fb'}
                          valueText={
                            acoustics.tuningHz ? formatDecimal(acoustics.tuningHz, 1, lang) : '—'
                          }
                          unit="Hz"
                        />
                        <ReadOnlyComputedField
                          id="auto-area-slot"
                          label={en ? 'Port Cross-Section Area' : 'Pole przekroju portu'}
                          valueText={formatDecimal(
                            toDisplayArea(acoustics.portAreaCm2, unitSystem),
                            isImp ? 2 : 1,
                            lang,
                          )}
                          unit={u.area}
                        />
                        <ReadOnlyComputedField
                          id="auto-disp-slot"
                          label={en ? 'Port Displacement' : 'Wyporność portu'}
                          valueText={formatDecimal(
                            toDisplayVol(acoustics.portTotalDisplacementL, unitSystem),
                            isImp ? 3 : 2,
                            lang,
                          )}
                          unit={u.vol}
                        />
                      </div>
                    </>
                  )}

                  {/* Rear Port controls strictly for Bandpass 6th-order */}
                  {params.enclosureType === 'bandpass_6th' && (
                    <div className="pt-3 mt-2 border-t border-white/[0.08] space-y-3">
                      <div className="text-[11px] font-semibold text-cyan-400">
                        {en
                          ? 'Rear Port — Low Tuning (Fb-low)'
                          : 'Port tylny — niskie strojenie (Fb-low)'}
                      </div>
                      <div className="flex items-center justify-between">
                        <label htmlFor="rear-port-full" className="text-xs text-zinc-300 cursor-pointer">
                          {en ? 'Full Rear Chamber Height' : 'Pełna wysokość komory tylnej'}
                        </label>
                        <input
                          id="rear-port-full"
                          type="checkbox"
                          checked={params.portRearFullHeight}
                          onChange={(e) => onChange({ portRearFullHeight: e.target.checked })}
                          className="w-4 h-4 accent-red-500 rounded cursor-pointer"
                        />
                      </div>
                      {!params.portRearFullHeight && (
                        <ImmediateNumberRow
                          id="rear-port-height"
                          label={en ? 'Rear Port Height' : 'Wysokość portu tylnego'}
                          value={toDisplayLen(params.portRearHeight, unitSystem)}
                          min={toDisplayLen(30, unitSystem)}
                          max={toDisplayLen(Math.round(acoustics.internalHeight), unitSystem)}
                          decimals={isImp ? 2 : 0}
                          unit={u.len}
                          onChange={(val) =>
                            onChange({ portRearHeight: fromDisplayLen(val, unitSystem) })
                          }
                        />
                      )}
                      {params.portControlMode === 'tuning' ? (
                        <div className="space-y-2.5 bg-[#08090C] border border-white/[0.08] rounded-md p-3">
                          <ImmediateNumberRow
                            id="rear-target-fb"
                            label={en ? 'Rear Port Tuning (Fb-low)' : 'Strojenie portu tylnego (Fb-low)'}
                            value={params.targetRearTuningHz}
                            min={14}
                            max={70}
                            decimals={1}
                            unit="Hz"
                            onChange={(targetRearTuningHz) => onChange({ targetRearTuningHz })}
                          />
                          <ImmediateNumberRow
                            id="rear-target-area"
                            label={en ? 'Rear Port Area' : 'Pole portu tylnego'}
                            value={toDisplayArea(params.targetRearPortAreaCm2, unitSystem)}
                            min={toDisplayArea(15, unitSystem)}
                            max={toDisplayArea(1500, unitSystem)}
                            decimals={isImp ? 2 : 1}
                            unit={u.area}
                            onChange={(val) =>
                              onChange({ targetRearPortAreaCm2: fromDisplayArea(val, unitSystem) })
                            }
                          />
                          <ReadOnlyComputedField
                            id="rear-auto-len"
                            label={en ? 'Rear Port Length' : 'Długość portu tylnego'}
                            valueText={formatDecimal(
                              toDisplayLen(acoustics.effectiveRearPortLength, unitSystem),
                              isImp ? 2 : 1,
                              lang,
                            )}
                            unit={u.len}
                          />
                          <ReadOnlyComputedField
                            id="rear-auto-width"
                            label={en ? 'Rear Port Width' : 'Szerokość portu tylnego'}
                            valueText={formatDecimal(
                              toDisplayLen(acoustics.effectiveRearPortWidth, unitSystem),
                              isImp ? 2 : 1,
                              lang,
                            )}
                            unit={u.len}
                          />
                        </div>
                      ) : params.portControlMode === 'area_from_length' ? (
                        <div className="space-y-2.5 bg-[#08090C] border border-white/[0.08] rounded-md p-3">
                          <ImmediateNumberRow
                            id="rear-target-fb-len"
                            label={en ? 'Rear Port Tuning (Fb-low)' : 'Strojenie portu tylnego (Fb-low)'}
                            value={params.targetRearTuningHz}
                            min={14}
                            max={70}
                            decimals={1}
                            unit="Hz"
                            onChange={(targetRearTuningHz) => onChange({ targetRearTuningHz })}
                          />
                          <ImmediateNumberRow
                            id="rear-port-len"
                            label={en ? 'Rear Port Length' : 'Długość portu tylnego'}
                            value={toDisplayLen(params.portRearLength, unitSystem)}
                            min={toDisplayLen(60, unitSystem)}
                            max={toDisplayLen(2000, unitSystem)}
                            decimals={isImp ? 2 : 0}
                            unit={u.len}
                            onChange={(val) =>
                              onChange({ portRearLength: fromDisplayLen(val, unitSystem) })
                            }
                          />
                          <ReadOnlyComputedField
                            id="rear-auto-area"
                            label={en ? 'Rear Port Area' : 'Pole portu tylnego'}
                            valueText={formatDecimal(
                              toDisplayArea(acoustics.rearPortAreaCm2, unitSystem),
                              isImp ? 2 : 1,
                              lang,
                            )}
                            unit={u.area}
                          />
                        </div>
                      ) : (
                        <>
                          <ImmediateNumberRow
                            id="rear-port-width"
                            label={en ? 'Rear Port Width' : 'Szerokość portu tylnego'}
                            value={toDisplayLen(params.portRearWidth, unitSystem)}
                            min={toDisplayLen(16, unitSystem)}
                            max={toDisplayLen(200, unitSystem)}
                            decimals={isImp ? 2 : 0}
                            unit={u.len}
                            onChange={(val) =>
                              onChange({ portRearWidth: fromDisplayLen(val, unitSystem) })
                            }
                          />
                          <ImmediateNumberRow
                            id="rear-port-len"
                            label={en ? 'Rear Port Length' : 'Długość portu tylnego'}
                            value={toDisplayLen(params.portRearLength, unitSystem)}
                            min={toDisplayLen(60, unitSystem)}
                            max={toDisplayLen(2000, unitSystem)}
                            decimals={isImp ? 2 : 0}
                            unit={u.len}
                            onChange={(val) =>
                              onChange({ portRearLength: fromDisplayLen(val, unitSystem) })
                            }
                          />
                        </>
                      )}
                    </div>
                  )}

                  {acoustics.slotPort && (
                    <div className="bg-[#08090C] border border-white/[0.08] rounded p-2.5 text-[11px] text-zinc-300 space-y-1 font-mono-num">
                      <div className="flex justify-between">
                        <span className="text-zinc-400 font-sans">
                          {en ? 'Front tunnel:' : 'Tunel przód:'}
                        </span>
                        <span className="text-red-400">
                          {acoustics.slotPort.isBent
                            ? `${en ? 'L-Bent' : 'Zagięty L'} (${formatLenNum(acoustics.slotPort.baffle1Length, unitSystem, 0, 2)}+${formatLenNum(acoustics.slotPort.baffle2Length, unitSystem, 0, 2)} ${u.len})`
                            : `${en ? 'Straight' : 'Prosty'} (${formatLen(acoustics.slotPort.baffle1Length, unitSystem, 0, 2)})`}
                        </span>
                      </div>
                      {params.enclosureType === 'bandpass_6th' && acoustics.rearSlotPort && (
                        <div className="flex justify-between">
                          <span className="text-zinc-400 font-sans">
                            {en ? 'Rear tunnel:' : 'Tunel tył:'}
                          </span>
                          <span className="text-cyan-300">
                            {acoustics.rearSlotPort.isBent
                              ? `${en ? 'L-Bent' : 'Zagięty L'} (${formatLenNum(acoustics.rearSlotPort.baffle1Length, unitSystem, 0, 2)}+${formatLenNum(acoustics.rearSlotPort.baffle2Length, unitSystem, 0, 2)} ${u.len})`
                              : `${en ? 'Straight' : 'Prosty'} (${formatLen(acoustics.rearSlotPort.baffle1Length, unitSystem, 0, 2)})`}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Section 3: Driver, Coils, Wiring, Custom Drivers & Parameter Preview */}
        <div>
          <button
            type="button"
            onClick={() => setOpenSection(openSection === 'driver' ? 'box' : 'driver')}
            aria-expanded={openSection === 'driver'}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="w-6 shrink-0 inline-flex items-center justify-center font-mono-num text-[11px] font-bold text-red-400 whitespace-nowrap">
                T-S
              </span>
              <span className="text-sm font-semibold text-white">
                {en ? '03. Driver & Thiele-Small Parameters' : '03. Głośnik i parametry Thiele-Small'}
              </span>
            </div>
            {openSection === 'driver' ? (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            )}
          </button>

          {openSection === 'driver' && (
            <div className="px-4 pb-4 pt-1 space-y-3.5">
              {/* Driver selector + Modal Add/Edit/Clone synchronized with WSD */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="driver-preset" className="text-xs text-zinc-300">
                    {en ? 'Driver Profile' : 'Profil przetwornika'}
                  </label>
                  <button
                    type="button"
                    onClick={() => onOpenDriverModal(null, activeDriverPreset)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400 hover:text-red-300 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{en ? 'New / T-S' : 'Nowy / T-S'}</span>
                  </button>
                </div>

                <select
                  id="driver-preset"
                  value={params.driverPresetId}
                  onChange={(e) => handleDriverPresetChange(e.target.value)}
                  className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
                >
                  <optgroup label={en ? 'Default Driver (Deaf Bonce)' : 'Domyślny głośnik (Deaf Bonce)'}>
                    {DRIVER_PRESETS.map((drv) => (
                      <option key={drv.id} value={drv.id}>
                        {drv.name} ({drv.voiceCoilCount === 2 ? `DVC ${drv.coilNominalOhms}Ω` : `SVC ${drv.coilNominalOhms}Ω`})
                      </option>
                    ))}
                  </optgroup>
                  {customDrivers.length > 0 && (
                    <optgroup label={en ? 'Custom Drivers (WSD sync)' : 'Własne przetworniki (sync WSD)'}>
                      {customDrivers.map((drv) => (
                        <option key={drv.id} value={drv.id}>
                          {drv.name} ({drv.sizeLabel} · {drv.voiceCoilCount === 2 ? `2×${drv.coilNominalOhms ?? 2}Ω` : `1×${drv.coilNominalOhms ?? 4}Ω`})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] text-zinc-500 font-mono-num">
                    {en ? 'Source: ' : 'Źródło: '}
                    {activeDriverPreset.source ??
                      (activeDriverPreset.isCustom
                        ? en
                          ? 'Custom T-S'
                          : 'Własny T-S'
                        : 'Deaf Bonce')}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenDriverModal(activeCustomDriver ?? null, activeDriverPreset)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-zinc-200 bg-[#161920] border border-white/[0.12] rounded hover:bg-white/10 transition-colors"
                    >
                      <Edit3 className="w-3 h-3 text-cyan-300" />
                      <span>
                        {activeCustomDriver
                          ? en
                            ? 'Edit T-S'
                            : 'Edytuj T-S'
                          : en
                            ? 'Clone to Custom'
                            : 'Klonuj do własnych'}
                      </span>
                    </button>

                    {activeCustomDriver && (
                      <>
                        <button
                          type="button"
                          onClick={handleUpdateActiveCustomDriver}
                          title={
                            en
                              ? 'Save current changes to custom driver and sync with WSD'
                              : 'Zapisz bieżące zmiany do własnego głośnika i zsynchronizuj z WSD'
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-zinc-200 bg-[#161920] border border-white/[0.12] rounded hover:bg-white/10 transition-colors"
                        >
                          <Save className="w-3 h-3 text-red-400" />
                          <span>{en ? 'Update' : 'Nadpisz'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteCustomDriver(activeCustomDriver.id);
                            handleDriverPresetChange(DRIVER_PRESETS[0].id);
                          }}
                          title={en ? 'Delete custom driver' : 'Usuń własny głośnik'}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded hover:bg-rose-500/20 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Voice Coils & Wiring Block */}
              <div className="bg-[#08090C] border border-white/[0.08] rounded-md p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-200">
                    {en ? 'Voice Coils & Driver Wiring' : 'Cewki i łączenie głośników'}
                  </span>
                  <div className="grid grid-cols-2 gap-1 bg-[#111318] p-0.5 rounded border border-white/[0.08]">
                    {([1, 2] as const).map((vc) => (
                      <button
                        key={vc}
                        type="button"
                        onClick={() =>
                          onChange({
                            driverVoiceCoilCount: vc,
                            driverCoilWiring:
                              vc === 2
                                ? params.driverCoilWiring === 'series'
                                  ? 'series'
                                  : 'parallel'
                                : 'single',
                          })
                        }
                        className={`px-2 py-0.5 text-[11px] font-mono-num rounded transition-colors ${
                          params.driverVoiceCoilCount === vc
                            ? 'bg-red-600 text-white font-semibold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {vc === 1 ? '1× SVC' : '2× DVC'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">
                      {en ? 'Coil Z (Ω)' : 'Z cewki (Ω)'}
                    </span>
                    <ImmediateNumberInput
                      id="drv-coil-z"
                      value={params.driverCoilNominalOhms}
                      min={0.5}
                      max={16}
                      decimals={2}
                      onChange={(driverCoilNominalOhms) => onChange({ driverCoilNominalOhms })}
                      className="w-full bg-[#111318] border border-white/[0.12] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">
                      {en ? 'Coil Re (Ω)' : 'Re cewki (Ω)'}
                    </span>
                    <ImmediateNumberInput
                      id="drv-coil-re"
                      value={params.driverCoilReOhms}
                      min={0.2}
                      max={16}
                      decimals={2}
                      onChange={(driverCoilReOhms) => onChange({ driverCoilReOhms })}
                      className="w-full bg-[#111318] border border-white/[0.12] rounded px-2 py-1 text-xs font-mono-num text-white focus:outline-none focus:border-red-500"
                    />
                  </label>
                </div>

                {params.driverVoiceCoilCount === 2 && (
                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">
                      {en ? 'Coil Wiring (internal)' : 'Łączenie cewek (wewnątrz)'}
                    </span>
                    <div className="grid grid-cols-2 gap-1 bg-[#111318] p-0.5 rounded border border-white/[0.08]">
                      {(
                        [
                          { id: 'parallel', label: en ? 'Parallel' : 'Równoległe' },
                          { id: 'series', label: en ? 'Series' : 'Szeregowe' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => onChange({ driverCoilWiring: opt.id })}
                          className={`py-1 text-[11px] rounded transition-colors ${
                            elecLoad.effectiveCoilWiring === opt.id
                              ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/40'
                              : 'text-zinc-400 hover:text-white border border-transparent'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {params.driverCount >= 2 && (
                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">
                      {en
                        ? `Driver Array Wiring (${params.driverCount} pcs)`
                        : `Łączenie głośników (${params.driverCount} szt.)`}
                    </span>
                    <div
                      className={`grid gap-1 bg-[#111318] p-0.5 rounded border border-white/[0.08] ${
                        params.driverCount === 4 || params.driverCount === 6
                          ? 'grid-cols-3'
                          : 'grid-cols-2'
                      }`}
                    >
                      {(
                        [
                          { id: 'parallel', label: en ? 'Parallel' : 'Równoległe' },
                          { id: 'series', label: en ? 'Series' : 'Szeregowe' },
                          ...(params.driverCount === 4
                            ? [{ id: 'series_parallel' as const, label: '2S2P' }]
                            : params.driverCount === 6
                              ? [{ id: 'series_parallel' as const, label: '2S3P' }]
                              : []),
                        ] as Array<{ id: DriverWiringType; label: string }>
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => onChange({ driverArrayWiring: opt.id })}
                          className={`py-1 text-[11px] rounded transition-colors whitespace-nowrap ${
                            params.driverArrayWiring === opt.id
                              ? 'bg-red-600 text-white font-semibold'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div
                  data-testid="sidebar-impedance-summary"
                  className="pt-1.5 border-t border-white/[0.08] flex items-center justify-between gap-2 text-[11px] font-mono-num"
                >
                  <span className="text-zinc-400 font-sans">
                    {en ? 'Combined Load:' : 'Wypadkowo:'}
                  </span>
                  <span className="text-cyan-300 font-semibold text-right">
                    {elecLoad.totalNominalOhms.toFixed(2).replace(/\.00$/, '.0')} Ω · Re{' '}
                    {elecLoad.totalReOhms.toFixed(2)} Ω
                  </span>
                </div>
              </div>

              {/* Compact Live Parameter Preview Card */}
              <div
                data-testid="sidebar-driver-preview"
                className="bg-[#08090C] border border-cyan-500/25 rounded-md p-2.5 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-cyan-300">
                    {en ? 'Parameter Preview' : 'Podgląd parametrów'}
                  </span>
                  <span className="text-[10px] font-mono-num text-zinc-400 truncate max-w-[180px]">
                    {elecLoad.wiringSummaryLabel}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono-num">
                  {[
                    { label: 'Fs', val: `${liveDriverPreview.fs.toFixed(1)} Hz` },
                    { label: 'Qts', val: liveDriverPreview.qts.toFixed(3) },
                    {
                      label: 'Vas',
                      val: `${formatVolNum(liveDriverPreview.vas, unitSystem, 1, 2)} ${u.vol}`,
                    },
                    { label: 'EBP', val: `${liveDriverPreview.ebpHz.toFixed(0)} Hz` },
                    { label: 'SPL 1W', val: `${liveDriverPreview.spl1w1m.toFixed(1)} dB` },
                    { label: '2.83V', val: `${liveDriverPreview.spl283v1m.toFixed(1)} dB` },
                    { label: 'Bl', val: `${liveDriverPreview.bl.toFixed(1)} Tm` },
                    {
                      label: 'Mms',
                      val: isImp
                        ? `${toDisplayMassG(liveDriverPreview.mms, unitSystem).toFixed(2)} ${u.mass}`
                        : `${Math.round(liveDriverPreview.mms)} ${u.mass}`,
                    },
                    {
                      label: en ? 'Vd total' : 'Vd łącz.',
                      val: isImp
                        ? `${toDisplaySmallVol(liveDriverPreview.vdCm3, unitSystem).toFixed(1)} ${u.smallVol}`
                        : `${Math.round(liveDriverPreview.vdCm3)} ${u.smallVol}`,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="px-1.5 py-1 rounded bg-[#111318] border border-white/[0.06] flex flex-col"
                    >
                      <span className="text-zinc-500">{item.label}</span>
                      <strong className="text-zinc-100">{item.val}</strong>
                    </div>
                  ))}
                </div>
              </div>

              {/* Driver count: 1 to 6 */}
              <div className="space-y-1.5">
                <span className="block text-xs text-zinc-300">
                  {en ? 'Driver Count (1–6)' : 'Liczba głośników (1–6)'}
                </span>
                <div
                  className="grid grid-cols-6 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                  role="group"
                  aria-label={en ? 'Driver Count' : 'Liczba głośników'}
                >
                  {([1, 2, 3, 4, 5, 6] as const).map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => onChange({ driverCount: cnt })}
                      className={`py-1 text-xs font-mono-num rounded transition-colors ${
                        params.driverCount === cnt
                          ? 'bg-red-600 text-white font-semibold'
                          : 'text-zinc-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {cnt}×
                    </button>
                  ))}
                </div>
              </div>

              {/* Driver mounting face (Front vs Top Sub-Up) */}
              {!isBandpass && (
                <div className="space-y-1.5">
                  <span className="block text-xs text-zinc-300">
                    {en ? 'Driver Mounting Face' : 'Umiejscowienie głośników'}
                  </span>
                  <div
                    className="grid grid-cols-2 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                    role="group"
                    aria-label={en ? 'Driver mounting face' : 'Umiejscowienie głośników'}
                  >
                    {(
                      [
                        { id: 'front', label: en ? 'Front' : 'Przód (Front)' },
                        { id: 'top', label: en ? 'Top (Sub-Up)' : 'Góra (Sub-Up)' },
                      ] as Array<{ id: DriverFace; label: string }>
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          onChange({ driverFace: opt.id, driverOffsetX: 0, driverOffsetY: 0 })
                        }
                        className={`py-1.5 px-2 text-xs rounded transition-colors whitespace-nowrap ${
                          params.driverFace === opt.id
                            ? 'bg-red-600 text-white font-semibold'
                            : 'text-zinc-300 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Multi-driver CAD layout pattern (shown when 2+ drivers) */}
              {params.driverCount >= 2 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-zinc-300">
                      {en ? 'Driver Layout' : 'Układ głośników'}
                    </span>
                    <span className="text-[11px] font-mono-num text-red-400 truncate">
                      {acoustics.driverLayoutLabel}
                    </span>
                  </div>
                  <div
                    className="grid grid-cols-4 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                    role="group"
                    aria-label={en ? 'Multi-driver layout' : 'Układ wielu głośników'}
                  >
                    {(
                      [
                        { id: 'auto', label: 'Auto' },
                        { id: 'staggered', label: en ? 'Staggered' : 'Plaster' },
                        { id: 'grid', label: en ? 'Grid' : 'Siatka' },
                        { id: 'inline', label: en ? 'Inline' : 'Liniowy' },
                      ] as Array<{ id: DriverPattern; label: string }>
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onChange({ driverPattern: opt.id })}
                        className={`py-1 px-1 text-[11px] rounded transition-colors whitespace-nowrap ${
                          params.driverPattern === opt.id
                            ? 'bg-red-600 text-white font-semibold'
                            : 'text-zinc-300 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Driver X/Y positioning offsets */}
              <div className="pt-2 border-t border-white/[0.08] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-zinc-300">
                    {en ? 'Driver Position Offset' : 'Przesunięcie głośnika'}
                  </span>
                  {(params.driverOffsetX !== 0 || params.driverOffsetY !== 0) && (
                    <button
                      type="button"
                      onClick={() => onChange({ driverOffsetX: 0, driverOffsetY: 0 })}
                      className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
                    >
                      {en ? 'Center' : 'Wyśrodkuj'}
                    </button>
                  )}
                </div>
                <ImmediateNumberRow
                  id="drv-offset-x"
                  label={
                    isBandpass
                      ? en
                        ? 'Offset (Back / Front)'
                        : 'Przesunięcie (Tył / Przód)'
                      : en
                        ? 'Offset (Left / Right)'
                        : 'Przesunięcie (Lewo / Prawo)'
                  }
                  value={toDisplayLen(params.driverOffsetX, unitSystem)}
                  min={toDisplayLen(acoustics.offsetBounds.driverMinX, unitSystem)}
                  max={toDisplayLen(acoustics.offsetBounds.driverMaxX, unitSystem)}
                  decimals={isImp ? 2 : 0}
                  unit={u.len}
                  onChange={(val) => onChange({ driverOffsetX: fromDisplayLen(val, unitSystem) })}
                />
                <ImmediateNumberRow
                  id="drv-offset-y"
                  label={
                    params.driverFace === 'top' && !isBandpass
                      ? en
                        ? 'Offset (Front / Back)'
                        : 'Przesunięcie (Przód / Tył)'
                      : en
                        ? 'Offset (Bottom / Top)'
                        : 'Przesunięcie (Dół / Góra)'
                  }
                  value={toDisplayLen(params.driverOffsetY, unitSystem)}
                  min={toDisplayLen(acoustics.offsetBounds.driverMinY, unitSystem)}
                  max={toDisplayLen(acoustics.offsetBounds.driverMaxY, unitSystem)}
                  decimals={isImp ? 2 : 0}
                  unit={u.len}
                  onChange={(val) => onChange({ driverOffsetY: fromDisplayLen(val, unitSystem) })}
                />
              </div>

              <ImmediateNumberRow
                id="drv-cutout"
                label={en ? 'Cutout Diameter' : 'Średnica otworu montażowego'}
                value={toDisplayLen(params.driverCutoutDia, unitSystem)}
                min={toDisplayLen(80, unitSystem)}
                max={toDisplayLen(520, unitSystem)}
                decimals={isImp ? 2 : 0}
                unit={u.len}
                onChange={(val) => {
                  const driverCutoutDia = fromDisplayLen(val, unitSystem);
                  onChange({
                    driverCutoutDia,
                    driverOuterDia: Math.max(driverCutoutDia + 20, params.driverOuterDia),
                  });
                }}
              />
              <ImmediateNumberRow
                id="drv-outer"
                label={en ? 'Outer Frame Diameter' : 'Średnica zewnętrzna kosza'}
                value={toDisplayLen(params.driverOuterDia, unitSystem)}
                min={toDisplayLen(100, unitSystem)}
                max={toDisplayLen(580, unitSystem)}
                decimals={isImp ? 2 : 0}
                unit={u.len}
                onChange={(val) => onChange({ driverOuterDia: fromDisplayLen(val, unitSystem) })}
              />
              <ImmediateNumberRow
                id="drv-depth"
                label={en ? 'Mounting Depth' : 'Głębokość montażowa'}
                value={toDisplayLen(params.driverDepth, unitSystem)}
                min={toDisplayLen(40, unitSystem)}
                max={toDisplayLen(420, unitSystem)}
                decimals={isImp ? 2 : 0}
                unit={u.len}
                onChange={(val) => onChange({ driverDepth: fromDisplayLen(val, unitSystem) })}
              />
              <ImmediateNumberRow
                id="drv-disp"
                label={en ? 'Driver Displacement (1 pc)' : 'Wyporność głośnika (1 szt.)'}
                value={toDisplayVol(params.driverDisplacement, unitSystem)}
                min={toDisplayVol(0.2, unitSystem)}
                max={toDisplayVol(25, unitSystem)}
                decimals={isImp ? 3 : 2}
                unit={u.vol}
                onChange={(val) =>
                  onChange({ driverDisplacement: fromDisplayVol(val, unitSystem) })
                }
              />

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label htmlFor="drv-fs" className="block text-[11px] text-zinc-400 mb-1">
                    {en ? 'Resonance Fs (Hz)' : 'Rezonans Fs (Hz)'}
                  </label>
                  <ImmediateNumberInput
                    id="drv-fs"
                    value={params.driverFs}
                    min={10}
                    max={250}
                    decimals={2}
                    onChange={(driverFs) => onChange({ driverFs })}
                    className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 font-mono-num text-xs text-white focus:outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label htmlFor="drv-qts" className="block text-[11px] text-zinc-400 mb-1">
                    {en ? 'Total Qts' : 'Dobroć Qts'}
                  </label>
                  <ImmediateNumberInput
                    id="drv-qts"
                    value={params.driverQts}
                    min={0.1}
                    max={2.0}
                    decimals={3}
                    onChange={(driverQts) => onChange({ driverQts })}
                    className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 font-mono-num text-xs text-white focus:outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label htmlFor="drv-vas" className="block text-[11px] text-zinc-400 mb-1">
                    {en ? `Volume Vas (${u.vol})` : `Objętość Vas (${u.vol})`}
                  </label>
                  <ImmediateNumberInput
                    id="drv-vas"
                    value={toDisplayVol(params.driverVas, unitSystem)}
                    min={toDisplayVol(1, unitSystem)}
                    max={toDisplayVol(1000, unitSystem)}
                    decimals={isImp ? 3 : 2}
                    onChange={(val) => onChange({ driverVas: fromDisplayVol(val, unitSystem) })}
                    className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 font-mono-num text-xs text-white focus:outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label htmlFor="drv-xmax" className="block text-[11px] text-zinc-400 mb-1">
                    Xmax ({u.len}) · RMS (W)
                  </label>
                  <div className="flex gap-1.5">
                    <ImmediateNumberInput
                      id="drv-xmax"
                      value={toDisplayLen(params.driverXmax, unitSystem)}
                      min={toDisplayLen(1, unitSystem)}
                      max={toDisplayLen(80, unitSystem)}
                      decimals={isImp ? 2 : 1}
                      onChange={(val) => onChange({ driverXmax: fromDisplayLen(val, unitSystem) })}
                      className="w-1/2 bg-[#08090C] border border-white/[0.12] rounded px-2 py-1.5 font-mono-num text-xs text-white focus:outline-none focus:border-red-500"
                    />
                    <ImmediateNumberInput
                      aria-label={en ? 'RMS Power (W)' : 'Moc RMS (W)'}
                      value={params.driverPowerW}
                      min={25}
                      max={15000}
                      decimals={0}
                      onChange={(driverPowerW) => onChange({ driverPowerW })}
                      className="w-1/2 bg-[#08090C] border border-white/[0.12] rounded px-2 py-1.5 font-mono-num text-xs text-white focus:outline-none focus:border-red-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Physical Geometry & Acoustic Diagnostics Footer */}
      <div className="p-3.5 border-t border-white/[0.08] bg-[#0D0F14] shrink-0 space-y-2">
        {acoustics.issues.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              {en ? 'Geometry valid · Magnet clearance: ' : 'Geometria poprawna · Luz za magnesem: '}
              <strong className="font-mono-num">
                {formatLen(acoustics.driverClearanceMm, unitSystem, 0, 2)}
              </strong>
            </span>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-28 overflow-y-auto cad-scroll" data-testid="validation-issues">
            {acoustics.issues.map((issue) => (
              <div
                key={issue.id}
                className={`flex items-start gap-2 text-xs leading-snug ${
                  issue.severity === 'error' ? 'text-rose-400' : 'text-amber-300'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
