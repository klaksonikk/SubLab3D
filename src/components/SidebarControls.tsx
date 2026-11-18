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
} from 'lucide-react';
import { BOX_TEMPLATE_PRESETS, DRIVER_PRESETS } from '../engine/presets';
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
      <label htmlFor={id} className="text-xs text-zinc-300">
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
          className="w-24 bg-[#08090C] border border-white/[0.12] rounded px-2 py-1 text-right font-mono-num text-xs text-white focus:outline-none focus:border-red-500"
        />
        <span className="text-[11px] text-zinc-500 w-7">{unit}</span>
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
        <label htmlFor={id} className="text-xs text-zinc-400">
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
            className="w-24 bg-[#08090C] border border-white/[0.08] rounded px-2 py-1 text-right font-mono-num text-xs text-zinc-300 cursor-not-allowed select-all focus:outline-none"
          />
          <span className="text-[11px] text-zinc-500 w-7">{unit}</span>
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
}: SidebarControlsProps) {
  const [openSection, setOpenSection] = useState<'box' | 'port' | 'driver'>('box');

  const enclosureTypes: Array<{ id: EnclosureType; label: string }> = [
    { id: 'vented_slot', label: 'Szczelin.' },
    { id: 'vented_round', label: 'Okrągła' },
    { id: 'sealed', label: 'Zamknięta' },
    { id: 'bandpass_4th', label: 'BP 4-rz.' },
    { id: 'bandpass_6th', label: 'BP 6-rz.' },
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
      computeElectricalLoad({
        voiceCoilCount: params.driverVoiceCoilCount,
        coilNominalOhms: params.driverCoilNominalOhms,
        coilReOhms: params.driverCoilReOhms,
        baseLeMh: params.driverCoilLeMh,
        coilWiring: params.driverCoilWiring,
        driverCount: params.driverCount,
        arrayWiring: params.driverArrayWiring,
      }),
    [
      params.driverVoiceCoilCount,
      params.driverCoilNominalOhms,
      params.driverCoilReOhms,
      params.driverCoilLeMh,
      params.driverCoilWiring,
      params.driverCount,
      params.driverArrayWiring,
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
      aria-label="Parametry projektu obudowy"
      className="w-full lg:w-[400px] xl:w-[420px] shrink-0 bg-[#111318] border-r border-white/[0.08] flex flex-col lg:h-full overflow-hidden"
    >
      {/* Template & Enclosure Topology Selector */}
      <div className="p-4 border-b border-white/[0.08] space-y-3.5 shrink-0">
        <div>
          <label htmlFor="template-select" className="block text-xs font-medium text-zinc-300 mb-1.5">
            Gotowy szablon projektu
          </label>
          <select
            id="template-select"
            defaultValue="daily-12-slot"
            onChange={(e) => onApplyTemplate(e.target.value)}
            className="w-full bg-[#08090C] border border-white/[0.12] rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
          >
            {BOX_TEMPLATE_PRESETS.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="block text-xs font-medium text-zinc-300 mb-1.5">Typ obudowy</span>
          <div
            className="grid grid-cols-5 gap-1 p-1 bg-[#08090C] border border-white/[0.08] rounded-md"
            role="group"
            aria-label="Typ obudowy"
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
              <span className="text-sm font-semibold text-white">01. Wymiary zewnętrzne i płyta</span>
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
                <span className="block text-xs text-zinc-300">Wyliczaj automatycznie</span>
                <div
                  className="grid grid-cols-4 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                  role="group"
                  aria-label="Automatycznie wyliczany wymiar obudowy"
                >
                  {(
                    [
                      { id: 'none', label: 'Objętość*' },
                      { id: 'width', label: 'Szer. (W)*' },
                      { id: 'height', label: 'Wys. (H)*' },
                      { id: 'depth', label: 'Głęb. (D)*' },
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
                  label="Szerokość zewnętrzna (W)"
                  valueText={acoustics.effectiveExternalWidth.toFixed(1).replace('.', ',')}
                  unit="mm"
                />
              ) : (
                <ImmediateNumberRow
                  id="ext-width"
                  label="Szerokość zewnętrzna (W)"
                  value={params.externalWidth}
                  min={220}
                  max={1800}
                  decimals={0}
                  unit="mm"
                  onChange={(externalWidth) => onChange({ externalWidth })}
                />
              )}

              {params.boxAutoCalcField === 'height' ? (
                <ReadOnlyComputedField
                  id="ext-height-auto"
                  label="Wysokość zewnętrzna (H)"
                  valueText={acoustics.effectiveExternalHeight.toFixed(1).replace('.', ',')}
                  unit="mm"
                />
              ) : (
                <ImmediateNumberRow
                  id="ext-height"
                  label="Wysokość zewnętrzna (H)"
                  value={params.externalHeight}
                  min={180}
                  max={1400}
                  decimals={0}
                  unit="mm"
                  onChange={(externalHeight) => onChange({ externalHeight })}
                />
              )}

              {params.boxAutoCalcField === 'depth' ? (
                <ReadOnlyComputedField
                  id="ext-depth-auto"
                  label="Głębokość zewnętrzna (D)"
                  valueText={acoustics.effectiveExternalDepth.toFixed(1).replace('.', ',')}
                  unit="mm"
                />
              ) : (
                <ImmediateNumberRow
                  id="ext-depth"
                  label="Głębokość zewnętrzna (D)"
                  value={params.externalDepth}
                  min={160}
                  max={1400}
                  decimals={0}
                  unit="mm"
                  onChange={(externalDepth) => onChange({ externalDepth })}
                />
              )}

              {/* Target Net Volume & Auto Total Gross Volume */}
              <div className="bg-[#08090C] border border-white/[0.08] rounded-md p-3 space-y-2.5">
                {params.boxAutoCalcField !== 'none' ? (
                  <ImmediateNumberRow
                    id="target-net-vol"
                    label="Objętość netto (Vnet)"
                    value={params.targetNetVolumeL}
                    min={6}
                    max={800}
                    decimals={1}
                    unit="L"
                    onChange={(targetNetVolumeL) => onChange({ targetNetVolumeL })}
                  />
                ) : (
                  <ReadOnlyComputedField
                    id="net-vol-auto"
                    label="Objętość netto (Vnet)"
                    valueText={acoustics.netVolumeL.toFixed(2).replace('.', ',')}
                    unit="L"
                  />
                )}
                <ReadOnlyComputedField
                  id="gross-vol-auto"
                  label="Całkowita obj. wewnętrzna (Brutto)"
                  valueText={acoustics.grossVolumeL.toFixed(2).replace('.', ',')}
                  unit="L"
                />
                <div className="text-[10px] text-zinc-500">
                  * Pola oznaczone gwiazdką są wyliczane automatycznie na żywo.
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label htmlFor="material-select" className="block text-xs text-zinc-300 mb-1">
                    Materiał płyty
                  </label>
                  <select
                    id="material-select"
                    value={params.material}
                    onChange={(e) => onChange({ material: e.target.value as MaterialType })}
                    className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
                  >
                    <option value="birch_plywood">Sklejka brzozowa</option>
                    <option value="mdf">Płyta MDF surowa</option>
                    <option value="matte_black">Laminat czarny</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="thickness-select" className="block text-xs text-zinc-300 mb-1">
                    Grubość ścianki
                  </label>
                  <select
                    id="thickness-select"
                    value={params.thickness}
                    onChange={(e) => onChange({ thickness: Number(e.target.value) })}
                    className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs text-white font-mono-num focus:outline-none focus:border-red-500"
                  >
                    <option value={15}>15 mm</option>
                    <option value={18}>18 mm</option>
                    <option value={19}>19 mm</option>
                    <option value={22}>22 mm</option>
                    <option value={25}>25 mm</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="joinery-select" className="block text-xs text-zinc-300 mb-1">
                  Sposób łączenia płyt (Cut-List)
                </label>
                <select
                  id="joinery-select"
                  value={params.joineryType}
                  onChange={(e) => onChange({ joineryType: e.target.value as JoineryType })}
                  className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
                >
                  <option value="top_bottom_cover">Wieńce góra/dół na bokach (standard)</option>
                  <option value="sides_full">Boki pełne (wieńce między bokami)</option>
                  <option value="front_back_cover">Front i tył nakładane na całość</option>
                </select>
              </div>

              <ImmediateNumberRow
                id="bracing-vol"
                label="Wyporność wzmocnień (Bracing)"
                value={params.bracingVolumeL}
                min={0}
                max={30}
                decimals={2}
                unit="L"
                onChange={(bracingVolumeL) => onChange({ bracingVolumeL })}
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
                  ? '02. Parametry komory zamkniętej'
                  : params.enclosureType === 'bandpass_6th'
                    ? '02. Bandpass 6-rzędu (Dwa porty)'
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
                  <span className="block text-xs text-zinc-300">Wyliczaj automatycznie (port)</span>
                  <div
                    className="grid grid-cols-3 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                    role="group"
                    aria-label="Tryb wyliczania parametrów portu"
                  >
                    {(
                      [
                        { id: 'dimensions', label: 'Strojenie Fb*' },
                        { id: 'tuning', label: 'Długość (L)*' },
                        { id: 'area_from_length', label: 'Pole (S)*' },
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
                    <span className="text-zinc-400">Docelowe Qtc audiofilskie:</span>
                    <span className="font-mono-num text-white">0.707 (Butterworth)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Kompaktowe Qtc (punch):</span>
                    <span className="font-mono-num text-zinc-200">0.92 (Chebyshev C2)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Aktualne Qtc obudowy:</span>
                    <span className="font-mono-num text-red-400 font-semibold">
                      {acoustics.sealedQtc?.toFixed(3) ?? '—'}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 pt-1 leading-relaxed">
                    Obudowa zamknięta nie wymaga tunelu. Zwiększenie objętości obniża Qtc i poprawia zejście; zmniejszenie podbija średni bas.
                  </p>
                </div>
              ) : params.enclosureType === 'vented_round' ? (
                <>
                  <div className="space-y-1.5">
                    <span className="block text-xs text-zinc-300">Umiejscowienie rury (Aero-port)</span>
                    <div
                      className="grid grid-cols-4 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                      role="group"
                      aria-label="Umiejscowienie rury"
                    >
                      {(
                        [
                          { id: 'front', label: 'Przód' },
                          { id: 'top', label: 'Góra' },
                          { id: 'side_right', label: 'Prawy bok' },
                          { id: 'side_left', label: 'Lewy bok' },
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
                    <span className="text-xs text-zinc-300">Liczba rur (Aero-port)</span>
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
                      <span className="text-xs text-zinc-300">Układ rur</span>
                      <div
                        className="flex gap-1 bg-[#08090C] p-0.5 rounded border border-white/[0.08]"
                        role="group"
                        aria-label="Układ rur"
                      >
                        {(
                          [
                            { id: 'auto', label: 'Auto' },
                            { id: 'vertical', label: 'Pion' },
                            { id: 'horizontal', label: 'Poziom' },
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
                        label="Strojenie portu Fb"
                        value={params.targetTuningHz}
                        min={15}
                        max={90}
                        decimals={1}
                        unit="Hz"
                        onChange={(targetTuningHz) => onChange({ targetTuningHz })}
                      />
                      <ImmediateNumberRow
                        id="target-area-round"
                        label="Pole przekroju portu"
                        value={params.targetPortAreaCm2}
                        min={15}
                        max={2500}
                        decimals={1}
                        unit="cm²"
                        onChange={(targetPortAreaCm2) => onChange({ targetPortAreaCm2 })}
                      />
                      <div className="pt-2 border-t border-white/[0.08] space-y-2">
                        <ReadOnlyComputedField
                          id="auto-port-len-round"
                          label="Długość portu (L)"
                          valueText={acoustics.effectivePortLength.toFixed(1).replace('.', ',')}
                          unit="mm"
                        />
                        <ReadOnlyComputedField
                          id="auto-port-disp-round"
                          label="Wyporność portu"
                          valueText={acoustics.portTotalDisplacementL.toFixed(2).replace('.', ',')}
                          unit="L"
                        />
                        <ReadOnlyComputedField
                          id="auto-port-dia-round"
                          label={`Średnica 1 rury (${params.portCount}×)`}
                          valueText={acoustics.effectivePortDiameter.toFixed(1).replace('.', ',')}
                          unit="mm"
                        />
                      </div>
                    </div>
                  ) : params.portControlMode === 'area_from_length' ? (
                    <div className="space-y-2.5 bg-[#08090C] border border-white/[0.08] rounded-md p-3">
                      <ImmediateNumberRow
                        id="target-fb-round-len"
                        label="Strojenie portu Fb"
                        value={params.targetTuningHz}
                        min={15}
                        max={90}
                        decimals={1}
                        unit="Hz"
                        onChange={(targetTuningHz) => onChange({ targetTuningHz })}
                      />
                      <ImmediateNumberRow
                        id="port-len-round"
                        label="Długość rury (L)"
                        value={params.portLength}
                        min={40}
                        max={1600}
                        decimals={0}
                        unit="mm"
                        onChange={(portLength) => onChange({ portLength })}
                      />
                      <div className="pt-2 border-t border-white/[0.08] space-y-2">
                        <ReadOnlyComputedField
                          id="auto-port-area-round"
                          label="Pole przekroju portu"
                          valueText={acoustics.portAreaCm2.toFixed(1).replace('.', ',')}
                          unit="cm²"
                        />
                        <ReadOnlyComputedField
                          id="auto-port-dia-round"
                          label={`Średnica 1 rury (${params.portCount}×)`}
                          valueText={acoustics.effectivePortDiameter.toFixed(1).replace('.', ',')}
                          unit="mm"
                        />
                        <ReadOnlyComputedField
                          id="auto-port-disp-round"
                          label="Wyporność portu"
                          valueText={acoustics.portTotalDisplacementL.toFixed(2).replace('.', ',')}
                          unit="L"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <ImmediateNumberRow
                        id="port-dia"
                        label="Średnica wewnętrzna rury"
                        value={params.portDiameter}
                        min={35}
                        max={350}
                        decimals={0}
                        unit="mm"
                        onChange={(portDiameter) => onChange({ portDiameter })}
                      />
                      <ImmediateNumberRow
                        id="port-len-round"
                        label="Długość rury (L)"
                        value={params.portLength}
                        min={40}
                        max={1400}
                        decimals={0}
                        unit="mm"
                        onChange={(portLength) => onChange({ portLength })}
                      />
                      <div className="bg-[#08090C] border border-white/[0.08] rounded-md p-2.5 space-y-1.5">
                        <ReadOnlyComputedField
                          id="auto-fb-round"
                          label="Strojenie portu Fb"
                          valueText={acoustics.tuningHz ? acoustics.tuningHz.toFixed(1).replace('.', ',') : '—'}
                          unit="Hz"
                        />
                        <ReadOnlyComputedField
                          id="auto-area-round"
                          label="Pole przekroju portu"
                          valueText={acoustics.portAreaCm2.toFixed(1).replace('.', ',')}
                          unit="cm²"
                        />
                        <ReadOnlyComputedField
                          id="auto-disp-round"
                          label="Wyporność portu"
                          valueText={acoustics.portTotalDisplacementL.toFixed(2).replace('.', ',')}
                          unit="L"
                        />
                      </div>
                    </>
                  )}

                  <div className="pt-2 border-t border-white/[0.08] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-zinc-300">
                        Pozycja rury na ścianie
                      </span>
                      {(params.portOffsetX !== 0 || params.portOffsetY !== 0) && (
                        <button
                          type="button"
                          onClick={() => onChange({ portOffsetX: 0, portOffsetY: 0 })}
                          className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
                        >
                          Resetuj pozycję
                        </button>
                      )}
                    </div>
                    <ImmediateNumberRow
                      id="port-offset-x"
                      label={
                        params.portFace === 'side_left' || params.portFace === 'side_right'
                          ? 'Pozycja rury (Tył / Przód)'
                          : 'Pozycja rury (Lewo / Prawo)'
                      }
                      value={params.portOffsetX}
                      min={acoustics.offsetBounds.portMinX}
                      max={acoustics.offsetBounds.portMaxX}
                      decimals={0}
                      unit="mm"
                      onChange={(portOffsetX) => onChange({ portOffsetX })}
                    />
                    <ImmediateNumberRow
                      id="port-offset-y"
                      label={
                        params.portFace === 'top'
                          ? 'Pozycja rury (Przód / Tył)'
                          : 'Pozycja rury (Dół / Góra)'
                      }
                      value={params.portOffsetY}
                      min={acoustics.offsetBounds.portMinY}
                      max={acoustics.offsetBounds.portMaxY}
                      decimals={0}
                      unit="mm"
                      onChange={(portOffsetY) => onChange({ portOffsetY })}
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <label htmlFor="port-flared" className="text-xs text-zinc-300 cursor-pointer">
                      Profilowane końce (Aero-Flared)
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
                      label="Podział komór (komora przednia)"
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
                      <span className="block text-xs text-zinc-300">Położenie portu szczelinowego</span>
                      <div
                        className="grid grid-cols-3 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                        role="group"
                        aria-label="Położenie portu szczelinowego"
                      >
                        {(
                          [
                            { id: 'left', label: 'Lewa ściana' },
                            { id: 'bottom', label: 'Dół' },
                            { id: 'right', label: 'Prawa ściana' },
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
                      Port przedni — wysokie strojenie (Fb-high)
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <label htmlFor="port-full-height" className="text-xs text-zinc-300 cursor-pointer">
                      {!isBandpass && params.portSlotSide === 'bottom'
                        ? `Pełna szerokość wewnętrzna (${Math.round(acoustics.internalWidth)} mm)`
                        : `Pełna wysokość wewnętrzna (${Math.round(acoustics.internalHeight)} mm)`}
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
                          ? 'Szerokość portu dolnego'
                          : 'Wysokość szczeliny (Hp)'
                      }
                      value={params.portHeight}
                      min={30}
                      max={
                        !isBandpass && params.portSlotSide === 'bottom'
                          ? Math.round(acoustics.internalWidth)
                          : Math.round(acoustics.internalHeight)
                      }
                      decimals={0}
                      unit="mm"
                      onChange={(portHeight) => onChange({ portHeight })}
                    />
                  )}

                  {params.portControlMode === 'tuning' ? (
                    <div className="space-y-2.5 bg-[#08090C] border border-white/[0.08] rounded-md p-3">
                      <ImmediateNumberRow
                        id="target-fb-slot"
                        label="Strojenie portu Fb"
                        value={params.targetTuningHz}
                        min={15}
                        max={90}
                        decimals={1}
                        unit="Hz"
                        onChange={(targetTuningHz) => onChange({ targetTuningHz })}
                      />
                      <ImmediateNumberRow
                        id="target-area-slot"
                        label="Pole przekroju portu"
                        value={params.targetPortAreaCm2}
                        min={15}
                        max={2500}
                        decimals={1}
                        unit="cm²"
                        onChange={(targetPortAreaCm2) => onChange({ targetPortAreaCm2 })}
                      />
                      <div className="pt-2 border-t border-white/[0.08] space-y-2">
                        <ReadOnlyComputedField
                          id="auto-port-len-slot"
                          label="Długość portu"
                          valueText={acoustics.effectivePortLength.toFixed(1).replace('.', ',')}
                          unit="mm"
                        />
                        <ReadOnlyComputedField
                          id="auto-port-disp-slot"
                          label="Wyporność portu"
                          valueText={acoustics.portTotalDisplacementL.toFixed(2).replace('.', ',')}
                          unit="L"
                        />
                        <ReadOnlyComputedField
                          id="auto-port-width-slot"
                          label={
                            !isBandpass && params.portSlotSide === 'bottom'
                              ? 'Wysokość szczeliny (Wp)'
                              : 'Szerokość szczeliny (Wp)'
                          }
                          valueText={acoustics.effectivePortWidth.toFixed(1).replace('.', ',')}
                          unit="mm"
                        />
                      </div>
                    </div>
                  ) : params.portControlMode === 'area_from_length' ? (
                    <div className="space-y-2.5 bg-[#08090C] border border-white/[0.08] rounded-md p-3">
                      <ImmediateNumberRow
                        id="target-fb-slot-len"
                        label="Strojenie portu Fb"
                        value={params.targetTuningHz}
                        min={15}
                        max={90}
                        decimals={1}
                        unit="Hz"
                        onChange={(targetTuningHz) => onChange({ targetTuningHz })}
                      />
                      <ImmediateNumberRow
                        id="port-len-slot"
                        label="Długość efektywna tunelu (L)"
                        value={params.portLength}
                        min={50}
                        max={2200}
                        decimals={0}
                        unit="mm"
                        onChange={(portLength) => onChange({ portLength })}
                      />
                      <div className="pt-2 border-t border-white/[0.08] space-y-2">
                        <ReadOnlyComputedField
                          id="auto-port-area-slot"
                          label="Pole przekroju portu"
                          valueText={acoustics.portAreaCm2.toFixed(1).replace('.', ',')}
                          unit="cm²"
                        />
                        <ReadOnlyComputedField
                          id="auto-port-width-slot"
                          label={
                            !isBandpass && params.portSlotSide === 'bottom'
                              ? 'Wysokość szczeliny (Wp)'
                              : 'Szerokość szczeliny (Wp)'
                          }
                          valueText={acoustics.effectivePortWidth.toFixed(1).replace('.', ',')}
                          unit="mm"
                        />
                        <ReadOnlyComputedField
                          id="auto-port-disp-slot"
                          label="Wyporność portu"
                          valueText={acoustics.portTotalDisplacementL.toFixed(2).replace('.', ',')}
                          unit="L"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <ImmediateNumberRow
                        id="port-width"
                        label={
                          !isBandpass && params.portSlotSide === 'bottom'
                            ? 'Wysokość szczeliny (Wp)'
                            : 'Szerokość szczeliny (Wp)'
                        }
                        value={params.portWidth}
                        min={16}
                        max={240}
                        decimals={0}
                        unit="mm"
                        onChange={(portWidth) => onChange({ portWidth })}
                      />
                      <ImmediateNumberRow
                        id="port-len-slot"
                        label="Długość efektywna tunelu (L)"
                        value={params.portLength}
                        min={50}
                        max={2000}
                        decimals={0}
                        unit="mm"
                        onChange={(portLength) => onChange({ portLength })}
                      />
                      <div className="bg-[#08090C] border border-white/[0.08] rounded-md p-2.5 space-y-1.5">
                        <ReadOnlyComputedField
                          id="auto-fb-slot"
                          label="Strojenie portu Fb"
                          valueText={acoustics.tuningHz ? acoustics.tuningHz.toFixed(1).replace('.', ',') : '—'}
                          unit="Hz"
                        />
                        <ReadOnlyComputedField
                          id="auto-area-slot"
                          label="Pole przekroju portu"
                          valueText={acoustics.portAreaCm2.toFixed(1).replace('.', ',')}
                          unit="cm²"
                        />
                        <ReadOnlyComputedField
                          id="auto-disp-slot"
                          label="Wyporność portu"
                          valueText={acoustics.portTotalDisplacementL.toFixed(2).replace('.', ',')}
                          unit="L"
                        />
                      </div>
                    </>
                  )}

                  {/* Rear Port controls strictly for Bandpass 6th-order */}
                  {params.enclosureType === 'bandpass_6th' && (
                    <div className="pt-3 mt-2 border-t border-white/[0.08] space-y-3">
                      <div className="text-[11px] font-semibold text-cyan-400">
                        Port tylny — niskie strojenie (Fb-low)
                      </div>
                      <div className="flex items-center justify-between">
                        <label htmlFor="rear-port-full" className="text-xs text-zinc-300 cursor-pointer">
                          Pełna wysokość komory tylnej
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
                          label="Wysokość portu tylnego"
                          value={params.portRearHeight}
                          min={30}
                          max={Math.round(acoustics.internalHeight)}
                          decimals={0}
                          unit="mm"
                          onChange={(portRearHeight) => onChange({ portRearHeight })}
                        />
                      )}
                      {params.portControlMode === 'tuning' ? (
                        <div className="space-y-2.5 bg-[#08090C] border border-white/[0.08] rounded-md p-3">
                          <ImmediateNumberRow
                            id="rear-target-fb"
                            label="Strojenie portu tylnego (Fb-low)"
                            value={params.targetRearTuningHz}
                            min={14}
                            max={70}
                            decimals={1}
                            unit="Hz"
                            onChange={(targetRearTuningHz) => onChange({ targetRearTuningHz })}
                          />
                          <ImmediateNumberRow
                            id="rear-target-area"
                            label="Pole portu tylnego"
                            value={params.targetRearPortAreaCm2}
                            min={15}
                            max={1500}
                            decimals={1}
                            unit="cm²"
                            onChange={(targetRearPortAreaCm2) => onChange({ targetRearPortAreaCm2 })}
                          />
                          <ReadOnlyComputedField
                            id="rear-auto-len"
                            label="Długość portu tylnego"
                            valueText={acoustics.effectiveRearPortLength.toFixed(1).replace('.', ',')}
                            unit="mm"
                          />
                          <ReadOnlyComputedField
                            id="rear-auto-width"
                            label="Szerokość portu tylnego"
                            valueText={acoustics.effectiveRearPortWidth.toFixed(1).replace('.', ',')}
                            unit="mm"
                          />
                        </div>
                      ) : params.portControlMode === 'area_from_length' ? (
                        <div className="space-y-2.5 bg-[#08090C] border border-white/[0.08] rounded-md p-3">
                          <ImmediateNumberRow
                            id="rear-target-fb-len"
                            label="Strojenie portu tylnego (Fb-low)"
                            value={params.targetRearTuningHz}
                            min={14}
                            max={70}
                            decimals={1}
                            unit="Hz"
                            onChange={(targetRearTuningHz) => onChange({ targetRearTuningHz })}
                          />
                          <ImmediateNumberRow
                            id="rear-port-len"
                            label="Długość portu tylnego"
                            value={params.portRearLength}
                            min={60}
                            max={2000}
                            decimals={0}
                            unit="mm"
                            onChange={(portRearLength) => onChange({ portRearLength })}
                          />
                          <ReadOnlyComputedField
                            id="rear-auto-area"
                            label="Pole portu tylnego"
                            valueText={acoustics.rearPortAreaCm2.toFixed(1).replace('.', ',')}
                            unit="cm²"
                          />
                        </div>
                      ) : (
                        <>
                          <ImmediateNumberRow
                            id="rear-port-width"
                            label="Szerokość portu tylnego"
                            value={params.portRearWidth}
                            min={16}
                            max={200}
                            decimals={0}
                            unit="mm"
                            onChange={(portRearWidth) => onChange({ portRearWidth })}
                          />
                          <ImmediateNumberRow
                            id="rear-port-len"
                            label="Długość portu tylnego"
                            value={params.portRearLength}
                            min={60}
                            max={2000}
                            decimals={0}
                            unit="mm"
                            onChange={(portRearLength) => onChange({ portRearLength })}
                          />
                        </>
                      )}
                    </div>
                  )}

                  {acoustics.slotPort && (
                    <div className="bg-[#08090C] border border-white/[0.08] rounded p-2.5 text-[11px] text-zinc-300 space-y-1 font-mono-num">
                      <div className="flex justify-between">
                        <span className="text-zinc-400 font-sans">Tunel przód:</span>
                        <span className="text-red-400">
                          {acoustics.slotPort.isBent
                            ? `Zagięty L (${Math.round(acoustics.slotPort.baffle1Length)}+${Math.round(acoustics.slotPort.baffle2Length)} mm)`
                            : `Prosty (${Math.round(acoustics.slotPort.baffle1Length)} mm)`}
                        </span>
                      </div>
                      {params.enclosureType === 'bandpass_6th' && acoustics.rearSlotPort && (
                        <div className="flex justify-between">
                          <span className="text-zinc-400 font-sans">Tunel tył:</span>
                          <span className="text-cyan-300">
                            {acoustics.rearSlotPort.isBent
                              ? `Zagięty L (${Math.round(acoustics.rearSlotPort.baffle1Length)}+${Math.round(acoustics.rearSlotPort.baffle2Length)} mm)`
                              : `Prosty (${Math.round(acoustics.rearSlotPort.baffle1Length)} mm)`}
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
              <span className="text-sm font-semibold text-white">03. Głośnik i parametry Thiele-Small</span>
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
                    Profil przetwornika
                  </label>
                  <button
                    type="button"
                    onClick={() => onOpenDriverModal(null, activeDriverPreset)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400 hover:text-red-300 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nowy / T-S</span>
                  </button>
                </div>

                <select
                  id="driver-preset"
                  value={params.driverPresetId}
                  onChange={(e) => handleDriverPresetChange(e.target.value)}
                  className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
                >
                  <optgroup label="Domyślny głośnik (Deaf Bonce)">
                    {DRIVER_PRESETS.map((drv) => (
                      <option key={drv.id} value={drv.id}>
                        {drv.name} ({drv.voiceCoilCount === 2 ? `DVC ${drv.coilNominalOhms}Ω` : `SVC ${drv.coilNominalOhms}Ω`})
                      </option>
                    ))}
                  </optgroup>
                  {customDrivers.length > 0 && (
                    <optgroup label="Własne przetworniki (sync WSD)">
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
                    Źródło: {activeDriverPreset.source ?? (activeDriverPreset.isCustom ? 'Własny T-S' : 'Deaf Bonce')}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenDriverModal(activeCustomDriver ?? null, activeDriverPreset)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-zinc-200 bg-[#161920] border border-white/[0.12] rounded hover:bg-white/10 transition-colors"
                    >
                      <Edit3 className="w-3 h-3 text-cyan-300" />
                      <span>{activeCustomDriver ? 'Edytuj T-S' : 'Klonuj do własnych'}</span>
                    </button>

                    {activeCustomDriver && (
                      <>
                        <button
                          type="button"
                          onClick={handleUpdateActiveCustomDriver}
                          title="Zapisz bieżące zmiany do własnego głośnika i zsynchronizuj z WSD"
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-zinc-200 bg-[#161920] border border-white/[0.12] rounded hover:bg-white/10 transition-colors"
                        >
                          <Save className="w-3 h-3 text-red-400" />
                          <span>Nadpisz</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteCustomDriver(activeCustomDriver.id);
                            handleDriverPresetChange(DRIVER_PRESETS[0].id);
                          }}
                          title="Usuń własny głośnik"
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
                  <span className="text-xs font-medium text-zinc-200">Cewki i łączenie głośników</span>
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
                    <span className="text-[11px] text-zinc-400 block">Z cewki (Ω)</span>
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
                    <span className="text-[11px] text-zinc-400 block">Re cewki (Ω)</span>
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
                    <span className="text-[11px] text-zinc-400 block">Łączenie cewek (wewnątrz)</span>
                    <div className="grid grid-cols-2 gap-1 bg-[#111318] p-0.5 rounded border border-white/[0.08]">
                      {(
                        [
                          { id: 'parallel', label: 'Równoległe' },
                          { id: 'series', label: 'Szeregowe' },
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
                      Łączenie głośników ({params.driverCount} szt.)
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
                          { id: 'parallel', label: 'Równoległe' },
                          { id: 'series', label: 'Szeregowe' },
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
                  <span className="text-zinc-400 font-sans">Wypadkowo:</span>
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
                    Podgląd parametrów
                  </span>
                  <span className="text-[10px] font-mono-num text-zinc-400 truncate max-w-[180px]">
                    {elecLoad.wiringSummaryLabel}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono-num">
                  {[
                    { label: 'Fs', val: `${liveDriverPreview.fs.toFixed(1)} Hz` },
                    { label: 'Qts', val: liveDriverPreview.qts.toFixed(3) },
                    { label: 'Vas', val: `${liveDriverPreview.vas.toFixed(1)} L` },
                    { label: 'EBP', val: `${liveDriverPreview.ebpHz.toFixed(0)} Hz` },
                    { label: 'SPL 1W', val: `${liveDriverPreview.spl1w1m.toFixed(1)} dB` },
                    { label: '2.83V', val: `${liveDriverPreview.spl283v1m.toFixed(1)} dB` },
                    { label: 'Bl', val: `${liveDriverPreview.bl.toFixed(1)} Tm` },
                    { label: 'Mms', val: `${Math.round(liveDriverPreview.mms)} g` },
                    { label: 'Vd łącz.', val: `${Math.round(liveDriverPreview.vdCm3)} cm³` },
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
                <span className="block text-xs text-zinc-300">Liczba głośników (1–6)</span>
                <div
                  className="grid grid-cols-6 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                  role="group"
                  aria-label="Liczba głośników"
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
                  <span className="block text-xs text-zinc-300">Umiejscowienie głośników</span>
                  <div
                    className="grid grid-cols-2 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                    role="group"
                    aria-label="Umiejscowienie głośników"
                  >
                    {(
                      [
                        { id: 'front', label: 'Przód (Front)' },
                        { id: 'top', label: 'Góra (Sub-Up)' },
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
                    <span className="text-xs text-zinc-300">Układ głośników</span>
                    <span className="text-[11px] font-mono-num text-red-400 truncate">
                      {acoustics.driverLayoutLabel}
                    </span>
                  </div>
                  <div
                    className="grid grid-cols-4 gap-1 bg-[#08090C] p-1 rounded border border-white/[0.08]"
                    role="group"
                    aria-label="Układ wielu głośników"
                  >
                    {(
                      [
                        { id: 'auto', label: 'Auto' },
                        { id: 'staggered', label: 'Plaster' },
                        { id: 'grid', label: 'Siatka' },
                        { id: 'inline', label: 'Liniowy' },
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
                    Przesunięcie głośnika
                  </span>
                  {(params.driverOffsetX !== 0 || params.driverOffsetY !== 0) && (
                    <button
                      type="button"
                      onClick={() => onChange({ driverOffsetX: 0, driverOffsetY: 0 })}
                      className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
                    >
                      Wyśrodkuj
                    </button>
                  )}
                </div>
                <ImmediateNumberRow
                  id="drv-offset-x"
                  label={isBandpass ? 'Przesunięcie (Tył / Przód)' : 'Przesunięcie (Lewo / Prawo)'}
                  value={params.driverOffsetX}
                  min={acoustics.offsetBounds.driverMinX}
                  max={acoustics.offsetBounds.driverMaxX}
                  decimals={0}
                  unit="mm"
                  onChange={(driverOffsetX) => onChange({ driverOffsetX })}
                />
                <ImmediateNumberRow
                  id="drv-offset-y"
                  label={
                    params.driverFace === 'top' && !isBandpass
                      ? 'Przesunięcie (Przód / Tył)'
                      : 'Przesunięcie (Dół / Góra)'
                  }
                  value={params.driverOffsetY}
                  min={acoustics.offsetBounds.driverMinY}
                  max={acoustics.offsetBounds.driverMaxY}
                  decimals={0}
                  unit="mm"
                  onChange={(driverOffsetY) => onChange({ driverOffsetY })}
                />
              </div>

              <ImmediateNumberRow
                id="drv-cutout"
                label="Średnica otworu montażowego"
                value={params.driverCutoutDia}
                min={80}
                max={520}
                decimals={0}
                unit="mm"
                onChange={(driverCutoutDia) =>
                  onChange({
                    driverCutoutDia,
                    driverOuterDia: Math.max(driverCutoutDia + 20, params.driverOuterDia),
                  })
                }
              />
              <ImmediateNumberRow
                id="drv-outer"
                label="Średnica zewnętrzna kosza"
                value={params.driverOuterDia}
                min={100}
                max={580}
                decimals={0}
                unit="mm"
                onChange={(driverOuterDia) => onChange({ driverOuterDia })}
              />
              <ImmediateNumberRow
                id="drv-depth"
                label="Głębokość montażowa"
                value={params.driverDepth}
                min={40}
                max={420}
                decimals={0}
                unit="mm"
                onChange={(driverDepth) => onChange({ driverDepth })}
              />
              <ImmediateNumberRow
                id="drv-disp"
                label="Wyporność głośnika (1 szt.)"
                value={params.driverDisplacement}
                min={0.2}
                max={25}
                decimals={2}
                unit="L"
                onChange={(driverDisplacement) => onChange({ driverDisplacement })}
              />

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label htmlFor="drv-fs" className="block text-[11px] text-zinc-400 mb-1">
                    Rezonans Fs (Hz)
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
                    Dobroć Qts
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
                    Objętość Vas (L)
                  </label>
                  <ImmediateNumberInput
                    id="drv-vas"
                    value={params.driverVas}
                    min={1}
                    max={1000}
                    decimals={2}
                    onChange={(driverVas) => onChange({ driverVas })}
                    className="w-full bg-[#08090C] border border-white/[0.12] rounded px-2.5 py-1.5 font-mono-num text-xs text-white focus:outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label htmlFor="drv-xmax" className="block text-[11px] text-zinc-400 mb-1">
                    Xmax (mm) · RMS (W)
                  </label>
                  <div className="flex gap-1.5">
                    <ImmediateNumberInput
                      id="drv-xmax"
                      value={params.driverXmax}
                      min={1}
                      max={80}
                      decimals={1}
                      onChange={(driverXmax) => onChange({ driverXmax })}
                      className="w-1/2 bg-[#08090C] border border-white/[0.12] rounded px-2 py-1.5 font-mono-num text-xs text-white focus:outline-none focus:border-red-500"
                    />
                    <ImmediateNumberInput
                      aria-label="Moc RMS (W)"
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
              Geometria poprawna · Luz za magnesem:{' '}
              <strong className="font-mono-num">{acoustics.driverClearanceMm} mm</strong>
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
