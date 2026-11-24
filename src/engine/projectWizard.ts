import { calculateAcoustics, computeDriverGridLayout } from './acoustics';
import { DEFAULT_BOX_PARAMS, DRIVER_PRESETS } from './presets';
import type {
  AcousticResult,
  AppLanguage,
  BoxParams,
  BoxTemplatePreset,
  CoilWiringMode,
  DriverPreset,
  DriverWiringType,
  EnclosureType,
  MaterialType,
} from './types';

export type SubwooferApplication =
  | 'car_daily'
  | 'car_spl'
  | 'studio_hifi'
  | 'custom';

export type WizardSizePriority = 'compact' | 'balanced' | 'maximum';

export interface SubwooferApplicationSpec {
  id: SubwooferApplication;
  titlePl: string;
  titleEn: string;
  subtitlePl: string;
  subtitleEn: string;
  goalPl: string;
  goalEn: string;
  defaultEnclosure: EnclosureType;
  defaultMaterial: MaterialType;
  defaultThickness: number;
  volumeMultiplier: number;
  sealedQtcTarget: number;
  targetPortVelocityMs: number;
  bracingBaseL: number;
  fbRangePl: string;
  fbRangeEn: string;
}

export const SUBWOOFER_APPLICATION_SPECS: SubwooferApplicationSpec[] = [
  {
    id: 'car_daily',
    titlePl: 'Car Audio — Daily / Ulica',
    titleEn: 'Car Audio — Daily / Street',
    subtitlePl: 'Uniwersalny bas do jazdy na co dzień',
    subtitleEn: 'Musical everyday trunk or cabin bass',
    goalPl: 'Zbalansowane zejście 32–36 Hz, czysty impuls i rozsądny gabaryt do bagażnika.',
    goalEn: 'Balanced 32–36 Hz tuning, punchy response, and trunk-friendly dimensions.',
    defaultEnclosure: 'vented_slot',
    defaultMaterial: 'birch_plywood',
    defaultThickness: 18,
    volumeMultiplier: 1.5,
    sealedQtcTarget: 0.78,
    targetPortVelocityMs: 17,
    bracingBaseL: 1.2,
    fbRangePl: '32–36 Hz · Slot BR',
    fbRangeEn: '32–36 Hz · Slot Port',
  },
  {
    id: 'car_spl',
    titlePl: 'Car Audio — SPL / Zawody',
    titleEn: 'Car Audio — SPL / Competition',
    subtitlePl: 'Maksymalne ciśnienie i wytrzymałość',
    subtitleEn: 'High output & peak dB headroom',
    goalPl: 'Duży przekrój portu bez kompresji, wzmocniona płyta 22 mm i strojenie 36–43 Hz.',
    goalEn: 'Large anti-compression port area, stiff 22 mm baffle, and 36–43 Hz output peak.',
    defaultEnclosure: 'vented_slot',
    defaultMaterial: 'birch_plywood',
    defaultThickness: 22,
    volumeMultiplier: 1.85,
    sealedQtcTarget: 0.85,
    targetPortVelocityMs: 21,
    bracingBaseL: 2.4,
    fbRangePl: '36–43 Hz · High Flow BR',
    fbRangeEn: '36–43 Hz · High Flow BR',
  },
  {
    id: 'studio_hifi',
    titlePl: 'Studio / Hi-Fi (Jakość SQ)',
    titleEn: 'Studio / Hi-Fi (Sound Quality)',
    subtitlePl: 'Najwyższa kontrola i wierność impulsu',
    subtitleEn: 'Tightest transient accuracy & low group delay',
    goalPl: 'Domyślnie obudowa zamknięta Qtc ≈ 0.707 lub precyzyjny bas bez podbarwień.',
    goalEn: 'Defaults to sealed Qtc ≈ 0.707 alignment for tight, uncolored bass definition.',
    defaultEnclosure: 'sealed',
    defaultMaterial: 'mdf',
    defaultThickness: 19,
    volumeMultiplier: 1.35,
    sealedQtcTarget: 0.707,
    targetPortVelocityMs: 12,
    bracingBaseL: 1.0,
    fbRangePl: 'Qtc 0.71 · Obudowa zamknięta',
    fbRangeEn: 'Qtc 0.71 · Sealed SQ',
  },
  {
    id: 'custom',
    titlePl: 'Własny cel / Custom',
    titleEn: 'Custom Target',
    subtitlePl: 'Własne strojenie, litraż i przeznaczenie',
    subtitleEn: 'Define your own tuning, volume & goal',
    goalPl: 'Ręcznie określ docelową objętość netto, częstotliwość strojenia Fb i limit przepływu.',
    goalEn: 'Manually define target net volume, port tuning Fb, and max port velocity.',
    defaultEnclosure: 'vented_slot',
    defaultMaterial: 'birch_plywood',
    defaultThickness: 18,
    volumeMultiplier: 1.6,
    sealedQtcTarget: 0.71,
    targetPortVelocityMs: 16,
    bracingBaseL: 1.5,
    fbRangePl: 'Własne Fb / Vnet · Pełna kontrola',
    fbRangeEn: 'Custom Fb / Vnet · Full Control',
  },
];

export interface WizardCustomTarget {
  netVolumeL?: number;
  tuningHz?: number;
  portVelocityMs?: number;
  label?: string;
}

export interface WizardProjectConfig {
  application: SubwooferApplication;
  driver: DriverPreset;
  driverCount: 1 | 2 | 3 | 4 | 5 | 6;
  enclosureType: EnclosureType | 'recommended';
  sizePriority: WizardSizePriority;
  material?: MaterialType;
  thickness?: number;
  coilWiring?: CoilWiringMode;
  arrayWiring?: DriverWiringType;
  customTarget?: WizardCustomTarget;
}

export function getApplicationSpec(id: SubwooferApplication): SubwooferApplicationSpec {
  return SUBWOOFER_APPLICATION_SPECS.find((s) => s.id === id) ?? SUBWOOFER_APPLICATION_SPECS[0];
}

function roundStep(val: number, step: number): number {
  return Math.round(val / step) * step;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function computeTargetTuningHz(
  app: SubwooferApplication,
  driverFs: number,
  priority: WizardSizePriority,
  customTarget?: WizardCustomTarget,
): number {
  if (app === 'custom' && customTarget?.tuningHz !== undefined && Number.isFinite(customTarget.tuningHz)) {
    return Number(clamp(customTarget.tuningHz, 18, 65).toFixed(1));
  }
  const safeFs = clamp(driverFs || 35, 18, 95);
  let baseFb: number;
  switch (app) {
    case 'car_daily':
      baseFb = clamp(safeFs * 0.92, 31, 37);
      break;
    case 'car_spl':
      baseFb = clamp(safeFs * 1.06, 36, 44);
      break;
    case 'studio_hifi':
      baseFb = clamp(safeFs * 0.82, 26, 33);
      break;
    case 'custom':
      baseFb = clamp(safeFs * 0.9, 26, 42);
      break;
  }
  const priorityShift = priority === 'compact' ? 2.5 : priority === 'maximum' ? -2.0 : 0;
  return Number(clamp(baseFb + priorityShift, 20, 54).toFixed(1));
}

function computeTargetNetVolumeL(
  appSpec: SubwooferApplicationSpec,
  driver: DriverPreset,
  driverCount: number,
  enclosureType: EnclosureType,
  priority: WizardSizePriority,
  customTarget?: WizardCustomTarget,
): number {
  const minFloorL = driverCount * (driver.displacement + (enclosureType === 'sealed' ? 10 : 16));
  if (
    appSpec.id === 'custom' &&
    customTarget?.netVolumeL !== undefined &&
    Number.isFinite(customTarget.netVolumeL)
  ) {
    return Number(clamp(customTarget.netVolumeL, minFloorL, 950).toFixed(1));
  }

  const vasTotal = Math.max(8, driver.vas * driverCount);
  const priorityScale = priority === 'compact' ? 0.78 : priority === 'maximum' ? 1.28 : 1.0;

  if (enclosureType === 'sealed') {
    const qts = clamp(driver.qts || 0.45, 0.2, 0.95);
    const priorityQtcShift = priority === 'compact' ? 0.09 : priority === 'maximum' ? -0.06 : 0;
    const targetQtc = Math.max(qts + 0.06, appSpec.sealedQtcTarget + priorityQtcShift);
    const alpha = Math.max(0.28, Math.pow(targetQtc / qts, 2) - 1);
    const idealL = vasTotal / alpha;
    const minPhysicalL = driverCount * (driver.displacement + 12);
    return Number(clamp(idealL, minPhysicalL, 650).toFixed(1));
  }

  const qtsFactor = clamp(driver.qts / 0.45, 0.75, 1.35);
  const rawVentedL = vasTotal * appSpec.volumeMultiplier * qtsFactor * priorityScale;
  return Number(clamp(rawVentedL, driverCount * (driver.displacement + 20), 850).toFixed(1));
}

function computeSafePortAreaCm2(
  driver: DriverPreset,
  driverCount: number,
  tuningHz: number,
  maxVelMs: number,
): number {
  const effRadiusM = (driver.cutoutDia * 0.88) / 2000;
  const sdM2 = Math.PI * effRadiusM * effRadiusM * driverCount;
  const vdM3 = sdM2 * (Math.max(4, driver.xmax) / 1000);
  // Invert estimatePortVelocityMs = (2 * pi * fb * vd * 1.15) / (S_cm2 / 10000)
  const requiredCm2 = ((2 * Math.PI * Math.max(20, tuningHz) * vdM3 * 1.15) / maxVelMs) * 10000;
  const floorByCone = Math.max(55, driverCount * (driver.cutoutDia * 0.35));
  return Math.round(clamp(requiredCm2, floorByCone, 1400));
}

function findGridRowCols(count: number): { cols: number; rows: number } {
  switch (count) {
    case 1:
      return { cols: 1, rows: 1 };
    case 2:
      return { cols: 2, rows: 1 };
    case 3:
      return { cols: 2, rows: 2 };
    case 4:
      return { cols: 2, rows: 2 };
    case 5:
      return { cols: 3, rows: 2 };
    default:
      return { cols: 3, rows: 2 };
  }
}

/**
 * Generates a physically valid, acoustically tuned BoxParams configuration
 * tailored to the user's selected application, speaker, and enclosure style.
 */
export function buildWizardProjectParams(
  config: WizardProjectConfig,
  lang: AppLanguage = 'pl',
): BoxParams {
  const appSpec = getApplicationSpec(config.application);
  const drv = config.driver ?? DRIVER_PRESETS[0];
  const enclosureType: EnclosureType =
    config.enclosureType === 'recommended' ? appSpec.defaultEnclosure : config.enclosureType;
  const material: MaterialType = config.material ?? appSpec.defaultMaterial;
  const thickness = clamp(config.thickness ?? appSpec.defaultThickness, 12, 30);
  const driverCount = config.driverCount;

  const voiceCoilCount = drv.voiceCoilCount === 2 ? 2 : 1;
  const coilNominalOhms =
    drv.coilNominalOhms ?? (voiceCoilCount === 2 ? (drv.zNom ?? 4) / 2 : drv.zNom ?? 4);
  const coilReOhms =
    drv.coilReOhms ?? (voiceCoilCount === 2 ? (drv.re ?? coilNominalOhms * 1.6) / 2 : drv.re ?? 3.2);
  const coilWiring: CoilWiringMode =
    voiceCoilCount === 2
      ? config.coilWiring === 'parallel' || config.coilWiring === 'series'
        ? config.coilWiring
        : driverCount >= 2
          ? 'parallel'
          : 'series'
      : 'single';

  const arrayWiring: DriverWiringType =
    driverCount === 1
      ? 'parallel'
      : config.arrayWiring ?? (driverCount === 4 || driverCount === 6 ? 'series_parallel' : 'series');

  const targetNetL = computeTargetNetVolumeL(
    appSpec,
    drv,
    driverCount,
    enclosureType,
    config.sizePriority,
    config.customTarget,
  );
  const targetFb = computeTargetTuningHz(
    config.application,
    drv.fs,
    config.sizePriority,
    config.customTarget,
  );
  const targetPortVelMs =
    config.application === 'custom' &&
    config.customTarget?.portVelocityMs !== undefined &&
    Number.isFinite(config.customTarget.portVelocityMs)
      ? clamp(config.customTarget.portVelocityMs, 8, 30)
      : appSpec.targetPortVelocityMs;
  const bracingVolumeL = Number(
    (appSpec.bracingBaseL * (1 + (driverCount - 1) * 0.45)).toFixed(1),
  );

  const { cols, rows } = findGridRowCols(driverCount);
  const outer = drv.outerDia;
  const minDriversSpanW = cols * outer + (cols + 1) * 20;
  const minDriversSpanH = rows * outer + (rows + 1) * 20;

  let portWidth = 52;
  let portLength = 420;
  let portDiameter = 110;
  let portCount: 1 | 2 | 3 | 4 = 1;
  let portFlared = true;
  let portRearWidth = 48;
  let portRearLength = 450;
  let bandpassFrontRatio = enclosureType === 'bandpass_6th' ? 0.45 : 0.55;
  let targetPortAreaCm2 = 160;
  let targetRearPortAreaCm2 = 140;
  let targetRearTuningHz = Math.max(22, Math.round(targetFb * 0.85));

  // Initial aspect ratio heuristics based on driver grid and enclosure type
  const minExtDForMagnet = Math.ceil(drv.depth + thickness + 28);
  let intH = Math.max(minDriversSpanH, outer + 42);
  let intW = Math.max(minDriversSpanW, intH * 1.45);
  let intD = Math.max(drv.depth + 50, 260);

  if (enclosureType === 'sealed') {
    const grossApproxL = targetNetL + drv.displacement * driverCount + bracingVolumeL;
    const minIntD = Math.max(40, minExtDForMagnet - 2 * thickness);
    // Pick compact H/W that fit driver face while keeping depth >= magnet clearance
    const idealH = Math.max(minDriversSpanH, Math.cbrt(grossApproxL * 1_000_000) * 0.92);
    intH = roundStep(idealH, 5);
    const idealW = Math.max(minDriversSpanW, intH * (driverCount >= 2 ? 1.55 : 1.1));
    intW = roundStep(idealW, 5);
    const neededD = (grossApproxL * 1_000_000) / Math.max(1, intW * intH);
    intD = roundStep(Math.max(minIntD, neededD), 5);
    if (intD > intW * 1.35) {
      intW = roundStep(intW * 1.25, 5);
      intD = roundStep(Math.max(minIntD, (grossApproxL * 1_000_000) / (intW * intH)), 5);
    }
  } else if (enclosureType === 'vented_round') {
    targetPortAreaCm2 = computeSafePortAreaCm2(drv, driverCount, targetFb, targetPortVelMs);
    portCount = driverCount >= 2 || targetPortAreaCm2 > 220 ? 2 : 1;
    const singleArea = targetPortAreaCm2 / portCount;
    const rawDia = 20 * Math.sqrt(singleArea / Math.PI);
    const pipeSizes = [75, 100, 110, 125, 150, 160, 200, 250];
    portDiameter = pipeSizes.reduce((best, cand) =>
      Math.abs(cand - rawDia) < Math.abs(best - rawDia) ? cand : best,
    );
    const actualAreaCm2 = Math.PI * Math.pow(portDiameter / 20, 2) * portCount;
    targetPortAreaCm2 = Math.round(actualAreaCm2);

    const grossApproxL = targetNetL * 1.22 + drv.displacement * driverCount + bracingVolumeL;
    const portColW = portDiameter + 34;
    const minHForPorts =
      portCount === 2 ? Math.max(minDriversSpanH, portDiameter * 2 + 52) : Math.max(minDriversSpanH, portDiameter + 44);
    intH = roundStep(Math.max(minHForPorts, Math.cbrt(grossApproxL * 1_000_000) * 0.86), 5);
    intD = roundStep(Math.max(minExtDForMagnet - 2 * thickness, 340, Math.cbrt(grossApproxL * 1_000_000) * 0.92), 5);
    intW = roundStep(
      Math.max(minDriversSpanW + portColW + 24, (grossApproxL * 1_000_000) / Math.max(1, intH * intD)),
      5,
    );
  } else if (enclosureType === 'bandpass_4th' || enclosureType === 'bandpass_6th') {
    targetPortAreaCm2 = computeSafePortAreaCm2(
      drv,
      driverCount,
      Math.max(46, targetFb * 1.4),
      targetPortVelMs,
    );
    targetRearTuningHz = Math.round(clamp(targetFb * 0.85, 24, 38));

    const grossApproxL = targetNetL * 1.25 + drv.displacement * driverCount + bracingVolumeL + 8;
    intH = roundStep(Math.max(minDriversSpanH, outer + 54, Math.cbrt(grossApproxL * 1_000_000) * 0.84), 5);
    const minWForMagnet = Math.ceil((drv.depth + 32) / (1 - bandpassFrontRatio) + thickness);
    const dividerSafeW = Math.max(minWForMagnet, minDriversSpanW + 220, intH * 1.9);
    intW = roundStep(dividerSafeW, 5);
    const neededD = (grossApproxL * 1_000_000) / Math.max(1, intW * intH);
    intD = roundStep(Math.max(minDriversSpanW, drv.depth + 110, outer + 90, neededD), 5);

    portWidth = roundStep(clamp((targetPortAreaCm2 * 100) / intH, 36, 130), 2);
    targetPortAreaCm2 = Math.round((portWidth * intH) / 100);
    if (enclosureType === 'bandpass_6th') {
      targetRearPortAreaCm2 = Math.round(targetPortAreaCm2 * 0.78);
      portRearWidth = roundStep(clamp((targetRearPortAreaCm2 * 100) / intH, 32, 105), 2);
      targetRearPortAreaCm2 = Math.round((portRearWidth * intH) / 100);
    }
    portLength = 240;
    portRearLength = 420;
  } else {
    // vented_slot
    targetPortAreaCm2 = computeSafePortAreaCm2(drv, driverCount, targetFb, targetPortVelMs);
    const grossApproxL = targetNetL * 1.24 + drv.displacement * driverCount + bracingVolumeL;
    intH = roundStep(Math.max(minDriversSpanH, Math.cbrt(grossApproxL * 1_000_000) * 0.85), 5);
    portWidth = roundStep(clamp((targetPortAreaCm2 * 100) / intH, 32, 140), 2);
    targetPortAreaCm2 = Math.round((portWidth * intH) / 100);
    intW = roundStep(
      Math.max(minDriversSpanW + portWidth + thickness + 28, intH * 1.55),
      5,
    );
    const neededD = (grossApproxL * 1_000_000) / Math.max(1, intW * intH);
    intD = roundStep(Math.max(minExtDForMagnet - 2 * thickness, neededD), 5);
  }

  const extW = Math.round(intW + 2 * thickness);
  const extH = Math.round(intH + 2 * thickness);
  const extD = Math.max(minExtDForMagnet, Math.round(intD + 2 * thickness));

  const isBandpass = enclosureType === 'bandpass_4th' || enclosureType === 'bandpass_6th';
  const tuningTargetForBox = isBandpass
    ? Math.round(clamp(targetFb * 1.55, 48, 72))
    : targetFb;

  const baseDraft: BoxParams = {
    ...DEFAULT_BOX_PARAMS,
    enclosureType,
    joineryType: 'top_bottom_cover',
    material,
    driverFace: 'front',
    portFace: 'front',
    driverPattern: 'auto',
    driverOffsetX: 0,
    driverOffsetY: 0,
    portSlotSide: 'right',
    portOrientation: 'auto',
    portOffsetX: 0,
    portOffsetY: 0,
    boxAutoCalcField: isBandpass ? 'none' : enclosureType === 'vented_round' ? 'width' : 'depth',
    targetNetVolumeL: targetNetL,
    externalWidth: extW,
    externalHeight: extH,
    externalDepth: extD,
    thickness,
    doubleFrontBaffle: false,
    driverPresetId: drv.id,
    driverName: drv.name,
    driverCount,
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
    driverArrayWiring: arrayWiring,
    portControlMode: enclosureType === 'sealed' ? 'dimensions' : 'tuning',
    targetTuningHz: tuningTargetForBox,
    targetPortAreaCm2,
    targetRearTuningHz,
    targetRearPortAreaCm2,
    portWidth,
    portHeight: intH,
    portFullHeight: true,
    portLength,
    portRearWidth,
    portRearHeight: intH,
    portRearFullHeight: true,
    portRearLength,
    portDiameter,
    portCount,
    portFlared,
    bracingVolumeL,
    bandpassFrontRatio,
  };

  // Run up to 6 refinement passes so external width/depth + solved port length fit with 0 errors
  let current = { ...baseDraft };
  const minFrontWForRound = Math.ceil(minDriversSpanW + portDiameter + 2 * thickness + 32);
  for (let iter = 0; iter < 6; iter++) {
    const res = calculateAcoustics(current, lang, 'metric');
    const minRoundWNow = Math.ceil(minDriversSpanW + res.effectivePortDiameter + 2 * thickness + 32);
    const solvedExtW =
      enclosureType === 'vented_round'
        ? Math.max(roundStep(minRoundWNow, 2), roundStep(res.effectiveExternalWidth, 2))
        : current.externalWidth;
    const solvedExtD = isBandpass || enclosureType === 'vented_round'
      ? current.externalDepth
      : Math.max(minExtDForMagnet, Math.ceil(res.effectiveExternalDepth / 2) * 2);

    const disableWidthAuto =
      enclosureType === 'vented_round' && res.effectiveExternalWidth < minRoundWNow;

    current = {
      ...current,
      boxAutoCalcField: disableWidthAuto ? 'none' : current.boxAutoCalcField,
      externalWidth: Math.max(solvedExtW, enclosureType === 'vented_round' ? minFrontWForRound : 0),
      externalDepth: solvedExtD,
      portWidth: Math.max(24, roundStep(res.effectivePortWidth, 2)),
      portDiameter: Math.max(50, Math.round(res.effectivePortDiameter)),
      portLength: Math.max(40, roundStep(res.effectivePortLength, 2)),
      portRearWidth: Math.max(24, roundStep(res.effectiveRearPortWidth, 2)),
      portRearLength: Math.max(40, roundStep(res.effectiveRearPortLength, 2)),
    };

    const check = calculateAcoustics(
      { ...current, boxAutoCalcField: 'none', portControlMode: 'dimensions' },
      lang,
      'metric',
    );
    const hasPortOverflow = check.issues.some(
      (i) => i.id === 'port-overflow' || i.id === 'bp6-port-overflow' || i.id === 'round-port-fit' || i.id === 'round-port-wall-fit',
    );
    const hasFrontFit = check.issues.some((i) => i.id === 'driver-front-fit' || i.id === 'driver-port-collision');
    const hasDepthErr = check.issues.some((i) => i.id === 'driver-depth-fit');

    if (!hasPortOverflow && !hasFrontFit && !hasDepthErr) {
      break;
    }

    if (hasFrontFit) {
      const usableCheck = computeDriverGridLayout(
        driverCount,
        current.externalWidth - 2 * thickness,
        current.externalHeight - 2 * thickness,
        drv.outerDia,
        'auto',
        lang,
      );
      if (isBandpass) {
        current.externalDepth = roundStep(current.externalDepth + 60, 5);
        current.externalHeight = roundStep(current.externalHeight + 40, 5);
        current.portHeight = Math.max(40, current.externalHeight - 2 * thickness);
        current.portRearHeight = current.portHeight;
      } else if (!usableCheck.fits || enclosureType !== 'sealed') {
        if (enclosureType === 'vented_round') {
          current.boxAutoCalcField = 'none';
        }
        current.externalWidth = roundStep(current.externalWidth + 70, 5);
        if (driverCount >= 3 || enclosureType === 'vented_round') {
          current.externalHeight = roundStep(current.externalHeight + 45, 5);
          current.portHeight = Math.max(40, current.externalHeight - 2 * thickness);
          current.portRearHeight = current.portHeight;
        }
      }
    }
    if (hasPortOverflow) {
      if (enclosureType === 'vented_round') {
        const pipeSizes = [75, 100, 110, 125, 150, 160, 200, 250];
        const idx = pipeSizes.indexOf(current.portDiameter);
        if (current.portLength > current.externalDepth - thickness - 45) {
          if (current.portCount > 1 && idx >= 1) {
            current.portDiameter = pipeSizes[idx - 1];
            current.targetPortAreaCm2 = Math.round(Math.PI * Math.pow(current.portDiameter / 20, 2) * current.portCount);
          } else if (idx > 1) {
            current.portDiameter = pipeSizes[idx - 1];
            current.targetPortAreaCm2 = Math.round(Math.PI * Math.pow(current.portDiameter / 20, 2) * current.portCount);
          } else {
            current.externalDepth = roundStep(Math.max(current.externalDepth + 60, current.portLength + thickness + 48), 5);
          }
        } else {
          current.externalHeight = roundStep(current.externalHeight + 40, 5);
        }
      } else {
        current.externalWidth = roundStep(current.externalWidth + 90, 5);
        current.externalDepth = roundStep(current.externalDepth + 45, 5);
      }
    }
    if (hasDepthErr) {
      if (isBandpass) {
        current.externalWidth = roundStep(current.externalWidth + 80, 5);
      } else {
        current.boxAutoCalcField = 'none';
        current.externalDepth = Math.max(minExtDForMagnet, roundStep(minExtDForMagnet + 4, 2));
      }
    }
  }

  const finalSolved = calculateAcoustics(current, lang, 'metric');
  const finalExtD = isBandpass
    ? Math.max(roundStep(finalSolved.effectiveExternalDepth, 2), minDriversSpanW)
    : enclosureType === 'vented_round'
      ? Math.max(minExtDForMagnet, roundStep(finalSolved.effectiveExternalDepth, 2))
      : Math.max(minExtDForMagnet, Math.ceil(finalSolved.effectiveExternalDepth / 2) * 2);

  return {
    ...current,
    boxAutoCalcField: 'none',
    portControlMode: 'dimensions',
    externalWidth: roundStep(finalSolved.effectiveExternalWidth, 2),
    externalHeight: roundStep(finalSolved.effectiveExternalHeight, 2),
    externalDepth: finalExtD,
    portWidth: Math.max(20, roundStep(finalSolved.effectivePortWidth, 1)),
    portHeight: Math.max(40, Math.round(finalSolved.effectivePortHeight)),
    portDiameter: Math.max(50, Math.round(finalSolved.effectivePortDiameter)),
    portLength: Math.max(40, roundStep(finalSolved.effectivePortLength, 2)),
    portRearWidth: Math.max(20, roundStep(finalSolved.effectiveRearPortWidth, 1)),
    portRearHeight: Math.max(40, Math.round(finalSolved.effectiveRearPortHeight)),
    portRearLength: Math.max(40, roundStep(finalSolved.effectiveRearPortLength, 2)),
    targetNetVolumeL: Number(finalSolved.netVolumeL.toFixed(1)),
  };
}

const SHORT_APP_LABELS: Record<SubwooferApplication, { pl: string; en: string }> = {
  car_daily: { pl: 'Car Daily', en: 'Car Daily' },
  car_spl: { pl: 'Car SPL', en: 'Car SPL' },
  studio_hifi: { pl: 'Studio Hi-Fi', en: 'Studio Hi-Fi' },
  custom: { pl: 'Własny', en: 'Custom' },
};

function formatDriverShortLabel(name: string): string {
  const cleaned = name.replace(/\s*\([^)]*W[^)]*\)\s*/gi, '').trim();
  const base = cleaned || name.trim() || 'Subwoofer';
  return base.length > 28 ? `${base.slice(0, 26).trimEnd()}…` : base;
}

function formatTemplateTuningBadge(params: BoxParams, acoustics: AcousticResult): string {
  if (params.enclosureType === 'sealed') {
    return `Qtc ${(acoustics.sealedQtc ?? 0.71).toFixed(2)}`;
  }
  if (params.enclosureType === 'bandpass_6th') {
    const low = acoustics.rearPortTuningHz != null ? acoustics.rearPortTuningHz.toFixed(0) : '—';
    const high = acoustics.tuningHz != null ? acoustics.tuningHz.toFixed(0) : '—';
    return `${low}/${high} Hz`;
  }
  const fb = acoustics.tuningHz ?? params.targetTuningHz;
  return `${fb.toFixed(1)} Hz`;
}

export function getWizardTemplateDefaultName(
  config: Pick<WizardProjectConfig, 'application' | 'driver' | 'driverCount' | 'customTarget'>,
  params: BoxParams,
  acoustics: AcousticResult,
  lang: AppLanguage = 'pl',
): string {
  const customLabel = config.application === 'custom' ? config.customTarget?.label?.trim() : '';
  const appShort =
    customLabel || SHORT_APP_LABELS[config.application][lang === 'en' ? 'en' : 'pl'];
  const drvLabel = formatDriverShortLabel(config.driver?.name || params.driverName || 'Subwoofer');
  const badge = formatTemplateTuningBadge(params, acoustics);
  return `${appShort} — ${config.driverCount}× ${drvLabel} (${badge})`;
}

export function buildWizardTemplatePreset(
  config: WizardProjectConfig,
  params: BoxParams,
  acoustics: AcousticResult,
  customTitle?: string,
  createdAtMs: number = Date.now(),
): BoxTemplatePreset {
  const spec = getApplicationSpec(config.application);
  const trimmed = customTitle?.trim() ?? '';
  const defaultPl = getWizardTemplateDefaultName(config, params, acoustics, 'pl');
  const defaultEn = getWizardTemplateDefaultName(config, params, acoustics, 'en');
  const suffix = Math.random().toString(36).slice(2, 6);
  const dims = `${Math.round(acoustics.effectiveExternalWidth)}×${Math.round(acoustics.effectiveExternalHeight)}×${Math.round(acoustics.effectiveExternalDepth)} mm`;

  return {
    id: `wizard-${config.application}-${createdAtMs}-${suffix}`,
    name: trimmed || defaultPl,
    nameEn: trimmed || defaultEn,
    description: `${spec.titlePl} · ${acoustics.netVolumeL.toFixed(1)} L · ${dims}`,
    descriptionEn: `${spec.titleEn} · ${acoustics.netVolumeL.toFixed(1)} L · ${dims}`,
    params: {
      ...params,
      doubleFrontBaffle: false,
    },
  };
}

