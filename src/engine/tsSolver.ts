import type {
  CoilWiringMode,
  DriverPreset,
  DriverWiringType,
  VoiceCoilCount,
} from './types';

export const AIR_DENSITY_DEFAULT = 1.204; // kg/m^3 at 20°C
export const SPEED_OF_SOUND_DEFAULT = 343.2; // m/s at 20°C

export type QSolveMode = 'solve_qts' | 'solve_qes' | 'solve_qms';
export type MechSolveMode = 'from_fs_vas' | 'from_mms_cms' | 'from_fs_mms';
export type MotorSolveMode = 'solve_bl' | 'solve_qes_from_bl';
export type SdInputMode = 'direct_sd' | 'from_dd';

export interface ElectricalWiringConfig {
  voiceCoilCount: VoiceCoilCount;
  coilNominalOhms: number;
  coilReOhms: number;
  baseLeMh: number; // for DVC, series Le reference (mH); for SVC, single coil Le (mH)
  coilWiring: CoilWiringMode;
  driverCount: number;
  arrayWiring: DriverWiringType;
}

export interface ElectricalLoadResult {
  voiceCoilCount: VoiceCoilCount;
  effectiveCoilWiring: CoilWiringMode;
  singleDriverNominalOhms: number;
  singleDriverReOhms: number;
  singleDriverLeMh: number;
  totalNominalOhms: number;
  totalReOhms: number;
  totalLeMh: number;
  arrayMultiplier: number;
  wiringSummaryLabel: string;
}

/**
 * Converts a dBFS level (0 dBFS = digital full scale -> gain 1.0, down to -60 dBFS)
 * into linear Web Audio GainNode gain [0.0 .. 1.0].
 */
export function dbfsToLinearGain(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return 1;
  const clamped = Math.max(-60, Math.min(0, dbfs));
  return Math.min(1, Math.max(0, Math.pow(10, clamped / 20)));
}

/**
 * Computes resultant electrical impedance (Z_nom, DC Re, inductance Le) from
 * voice coil count (1x SVC / 2x DVC), per-coil resistance, coil wiring, and multi-driver array wiring.
 */
export function computeElectricalLoad(cfg: ElectricalWiringConfig): ElectricalLoadResult {
  const voiceCoilCount: VoiceCoilCount = cfg.voiceCoilCount === 2 ? 2 : 1;
  const safeCoilNom = Math.max(0.5, cfg.coilNominalOhms || 4);
  const safeCoilRe = Math.max(0.2, cfg.coilReOhms || safeCoilNom * 0.8);
  const safeBaseLe = Math.max(0, cfg.baseLeMh || 0);
  const count = Math.max(1, Math.min(6, Math.round(cfg.driverCount || 1)));

  let effectiveCoilWiring: CoilWiringMode = 'single';
  let singleDriverNominalOhms = safeCoilNom;
  let singleDriverReOhms = safeCoilRe;
  let singleDriverLeMh = safeBaseLe;

  if (voiceCoilCount === 2) {
    effectiveCoilWiring = cfg.coilWiring === 'series' ? 'series' : 'parallel';
    if (effectiveCoilWiring === 'parallel') {
      singleDriverNominalOhms = safeCoilNom / 2;
      singleDriverReOhms = safeCoilRe / 2;
      singleDriverLeMh = safeBaseLe / 4;
    } else {
      singleDriverNominalOhms = safeCoilNom * 2;
      singleDriverReOhms = safeCoilRe * 2;
      singleDriverLeMh = safeBaseLe;
    }
  }

  let arrayMultiplier = 1;
  let arrayTag = '';
  if (count > 1) {
    if (cfg.arrayWiring === 'series') {
      arrayMultiplier = count;
      arrayTag = `szeregowo (${count}S)`;
    } else if (cfg.arrayWiring === 'series_parallel') {
      if (count === 4) {
        arrayMultiplier = 1; // 2S2P
        arrayTag = '2S2P';
      } else if (count === 6) {
        arrayMultiplier = 2 / 3; // 2S3P
        arrayTag = '2S3P';
      } else {
        arrayMultiplier = 1 / count;
        arrayTag = `równolegle (${count}P)`;
      }
    } else {
      arrayMultiplier = 1 / count;
      arrayTag = `równolegle (${count}P)`;
    }
  }

  const totalNominalOhms = singleDriverNominalOhms * arrayMultiplier;
  const totalReOhms = singleDriverReOhms * arrayMultiplier;
  const totalLeMh = singleDriverLeMh * arrayMultiplier;

  const coilTag =
    voiceCoilCount === 2
      ? `2×${safeCoilNom}Ω ${effectiveCoilWiring === 'parallel' ? 'równol.' : 'szereg.'}`
      : `1×${safeCoilNom}Ω`;
  const wiringSummaryLabel =
    count > 1 ? `${count} szt. (${coilTag}) + ${arrayTag}` : `${coilTag}`;

  return {
    voiceCoilCount,
    effectiveCoilWiring,
    singleDriverNominalOhms,
    singleDriverReOhms,
    singleDriverLeMh,
    totalNominalOhms,
    totalReOhms,
    totalLeMh,
    arrayMultiplier,
    wiringSummaryLabel,
  };
}

export interface TsSolverInput {
  qSolveMode: QSolveMode;
  mechSolveMode: MechSolveMode;
  motorSolveMode: MotorSolveMode;
  sdInputMode: SdInputMode;

  voiceCoilCount: VoiceCoilCount;
  coilNominalOhms: number;
  coilReOhms: number;
  coilWiring: CoilWiringMode;

  fs: number; // Hz
  qes: number;
  qms: number;
  qts: number;
  vas: number; // L
  mms: number; // g
  cms: number; // mm/N
  sd: number; // cm^2
  dd: number; // effective piston diameter (mm)
  re: number; // Effective Ohm (kept synced from coil config or manual override)
  le: number; // mH (reference series/single coil Le)
  zNom: number; // Effective nominal Ohm
  bl: number; // T*m
  xmax: number; // mm
  powerW: number; // W RMS
  airDensityKgM3?: number;
  speedOfSoundMs?: number;
}

export interface TsValidationWarning {
  field: string;
  message: string;
}

export interface TsSolverOutput {
  fs: number;
  qes: number;
  qms: number;
  qts: number;
  vas: number; // L
  mms: number; // g
  cms: number; // mm/N
  rms: number; // kg/s
  sd: number; // cm^2
  dd: number; // mm
  re: number; // Effective DC Ohm for current coil wiring
  le: number; // Effective Le mH for current coil wiring
  zNom: number; // Effective nominal Ohm for current coil wiring
  voiceCoilCount: VoiceCoilCount;
  coilNominalOhms: number;
  coilReOhms: number;
  coilWiring: CoilWiringMode;
  bl: number; // T*m
  xmax: number; // mm
  powerW: number; // W
  vd: number; // cm^3
  eta0Percent: number; // %
  spl1w1m: number; // dB
  spl283v1m: number; // dB
  ebpHz: number; // Hz
  bl2Re: number; // N^2/W
  warnings: TsValidationWarning[];
  isValid: boolean;
}

export function solveThieleSmall(input: TsSolverInput): TsSolverOutput {
  const warnings: TsValidationWarning[] = [];

  const rho = Math.max(0.8, input.airDensityKgM3 ?? AIR_DENSITY_DEFAULT);
  const c = Math.max(300, input.speedOfSoundMs ?? SPEED_OF_SOUND_DEFAULT);
  const rhoC2 = rho * c * c;

  const voiceCoilCount: VoiceCoilCount = input.voiceCoilCount === 2 ? 2 : 1;
  const coilNominalOhms = Math.max(0.5, input.coilNominalOhms || 4);
  const coilReOhms = Math.max(0.2, input.coilReOhms || coilNominalOhms * 0.8);
  const coilWiring: CoilWiringMode =
    voiceCoilCount === 2 ? (input.coilWiring === 'series' ? 'series' : 'parallel') : 'single';

  const elec = computeElectricalLoad({
    voiceCoilCount,
    coilNominalOhms,
    coilReOhms,
    baseLeMh: input.le ?? 1.4,
    coilWiring,
    driverCount: 1,
    arrayWiring: 'parallel',
  });

  const re = Math.max(0.2, elec.singleDriverReOhms || input.re || 2.0);
  const le = Math.max(0, elec.singleDriverLeMh);
  const zNom = Math.max(0.5, elec.singleDriverNominalOhms || input.zNom || 4);
  const xmax = Math.max(0.5, input.xmax || 12);
  const powerW = Math.max(10, input.powerW || 400);

  // 1. Piston area Sd & effective diameter Dd
  let sdCm2: number;
  let ddMm: number;
  if (input.sdInputMode === 'from_dd') {
    ddMm = Math.max(40, input.dd || 240);
    sdCm2 = Math.PI * Math.pow(ddMm / 20, 2);
  } else {
    sdCm2 = Math.max(15, input.sd || 480);
    ddMm = 20 * Math.sqrt(sdCm2 / Math.PI);
  }
  const sdM2 = sdCm2 / 10000;

  // 2. Mechanical compliance / mass / Fs / Vas triad
  let fs = Math.max(10, input.fs || 30);
  let vasL = Math.max(1, input.vas || 40);
  let cmsMperN = 0.0002;
  let mmsKg = 0.12;

  if (input.mechSolveMode === 'from_mms_cms') {
    mmsKg = Math.max(0.002, (input.mms || 120) / 1000);
    cmsMperN = Math.max(1e-6, (input.cms || 0.2) / 1000);
    fs = 1 / (2 * Math.PI * Math.sqrt(mmsKg * cmsMperN));
    vasL = rhoC2 * sdM2 * sdM2 * cmsMperN * 1000;
  } else if (input.mechSolveMode === 'from_fs_mms') {
    fs = Math.max(10, input.fs || 30);
    mmsKg = Math.max(0.002, (input.mms || 120) / 1000);
    cmsMperN = 1 / (Math.pow(2 * Math.PI * fs, 2) * mmsKg);
    vasL = rhoC2 * sdM2 * sdM2 * cmsMperN * 1000;
  } else {
    fs = Math.max(10, input.fs || 30);
    vasL = Math.max(1, input.vas || 40);
    cmsMperN = vasL / 1000 / (rhoC2 * sdM2 * sdM2);
    mmsKg = 1 / (Math.pow(2 * Math.PI * fs, 2) * cmsMperN);
  }

  // 3. Electrical / Mechanical / Total Q + Bl motor triad
  let qes = Math.max(0.08, input.qes || 0.45);
  let qms = Math.max(0.5, input.qms || 4.8);
  let qts = Math.max(0.08, input.qts || 0.41);
  let bl = Math.max(0.5, input.bl || 14);

  if (input.motorSolveMode === 'solve_qes_from_bl') {
    bl = Math.max(0.5, input.bl || 14);
    qes = Math.max(0.05, (2 * Math.PI * fs * mmsKg * re) / (bl * bl));
    if (input.qSolveMode === 'solve_qms') {
      if (qts >= qes) {
        warnings.push({
          field: 'qts',
          message:
            'Qts musi być mniejsze niż wyliczone Qes (z Bl), aby istniało dodatnie Qms.',
        });
        qms = Math.max(1.5, qes * 8);
        qts = (qes * qms) / (qes + qms);
      } else {
        qms = (qts * qes) / (qes - qts);
      }
    } else {
      qts = (qes * qms) / (qes + qms);
    }
  } else {
    if (input.qSolveMode === 'solve_qes') {
      if (qts >= qms) {
        warnings.push({
          field: 'qts',
          message:
            'Nieprawidłowa zależność: Qts musi być mniejsze niż Qms (1/Qts = 1/Qes + 1/Qms).',
        });
        qes = Math.max(0.15, qts * 1.1);
      } else {
        qes = (qts * qms) / (qms - qts);
      }
    } else if (input.qSolveMode === 'solve_qms') {
      if (qts >= qes) {
        warnings.push({
          field: 'qts',
          message:
            'Nieprawidłowa zależność: Qts musi być mniejsze niż Qes (1/Qts = 1/Qes + 1/Qms).',
        });
        qms = Math.max(1.5, qes * 8);
      } else {
        qms = (qts * qes) / (qes - qts);
      }
    } else {
      qts = (qes * qms) / (qes + qms);
    }
    bl = Math.sqrt((2 * Math.PI * fs * mmsKg * re) / Math.max(0.05, qes));
  }

  if (fs < 14 || fs > 180) {
    warnings.push({
      field: 'fs',
      message: 'Rezonans Fs poza typowym zakresem subwoofera (14–180 Hz).',
    });
  }
  if (qts < 0.15 || qts > 1.4) {
    warnings.push({
      field: 'qts',
      message: 'Dobroć Qts poza typowym zakresem (0.15–1.40).',
    });
  }
  if (mmsKg * 1000 < 8 || mmsKg * 1000 > 1500) {
    warnings.push({
      field: 'mms',
      message: 'Wyliczona masa drgająca Mms jest nietypowa — sprawdź Sd i Vas.',
    });
  }

  const rms = (2 * Math.PI * fs * mmsKg) / Math.max(0.3, qms);
  const vasM3 = vasL / 1000;
  const eta0 =
    ((4 * Math.PI * Math.PI) / (c * c * c)) *
    Math.pow(fs, 3) *
    (vasM3 / Math.max(0.05, qes));
  const eta0Percent = eta0 * 100;
  const spl1w1m = 112.1 + 10 * Math.log10(Math.max(1e-7, eta0));
  const spl283v1m = spl1w1m + 10 * Math.log10(8 / re);
  const vd = sdCm2 * (xmax / 10);
  const ebpHz = fs / Math.max(0.05, qes);
  const bl2Re = (bl * bl) / re;

  return {
    fs,
    qes,
    qms,
    qts,
    vas: vasL,
    mms: mmsKg * 1000,
    cms: cmsMperN * 1000,
    rms,
    sd: sdCm2,
    dd: ddMm,
    re,
    le,
    zNom,
    voiceCoilCount,
    coilNominalOhms,
    coilReOhms,
    coilWiring,
    bl,
    xmax,
    powerW,
    vd,
    eta0Percent,
    spl1w1m,
    spl283v1m,
    ebpHz,
    bl2Re,
    warnings,
    isValid: warnings.length === 0,
  };
}

export function driverPresetToSolverInput(drv: {
  cutoutDia: number;
  fs: number;
  qts: number;
  vas: number;
  xmax: number;
  powerW: number;
  voiceCoilCount?: VoiceCoilCount;
  coilNominalOhms?: number;
  coilReOhms?: number;
  qes?: number;
  qms?: number;
  re?: number;
  le?: number;
  zNom?: number;
  sd?: number;
  bl?: number;
  mms?: number;
  cms?: number;
}): TsSolverInput {
  const voiceCoilCount: VoiceCoilCount = drv.voiceCoilCount === 2 ? 2 : 1;
  const coilNominalOhms =
    drv.coilNominalOhms ?? (voiceCoilCount === 2 ? (drv.zNom ?? 4) / 2 : drv.zNom ?? 4);
  const coilReOhms =
    drv.coilReOhms ??
    (voiceCoilCount === 2 ? (drv.re ?? coilNominalOhms * 1.6) / 2 : drv.re ?? 3.2);
  const coilWiring: CoilWiringMode = voiceCoilCount === 2 ? 'series' : 'single';

  const qms = drv.qms ?? 4.8;
  const qts = Math.max(0.15, drv.qts);
  const qes = drv.qes ?? Math.max(0.18, (qts * qms) / Math.max(0.4, qms - qts));
  const dd = Math.round(drv.cutoutDia * 0.88);
  const sd = drv.sd ?? Math.PI * Math.pow(dd / 20, 2);

  const initial = solveThieleSmall({
    qSolveMode: 'solve_qts',
    mechSolveMode: 'from_fs_vas',
    motorSolveMode: 'solve_bl',
    sdInputMode: 'direct_sd',
    voiceCoilCount,
    coilNominalOhms,
    coilReOhms,
    coilWiring,
    fs: drv.fs,
    qes,
    qms,
    qts,
    vas: drv.vas,
    mms: drv.mms ?? 140,
    cms: drv.cms ?? 0.2,
    sd,
    dd,
    re: drv.re ?? (voiceCoilCount === 2 ? coilReOhms * 2 : coilReOhms),
    le: drv.le ?? 1.4,
    zNom: drv.zNom ?? (voiceCoilCount === 2 ? coilNominalOhms * 2 : coilNominalOhms),
    bl: drv.bl ?? 16,
    xmax: drv.xmax,
    powerW: drv.powerW,
  });

  return {
    qSolveMode: 'solve_qts',
    mechSolveMode: 'from_fs_vas',
    motorSolveMode: 'solve_bl',
    sdInputMode: 'direct_sd',
    voiceCoilCount,
    coilNominalOhms: Number(coilNominalOhms.toFixed(2)),
    coilReOhms: Number(coilReOhms.toFixed(2)),
    coilWiring,
    fs: drv.fs,
    qes: Number(qes.toFixed(3)),
    qms: Number(qms.toFixed(2)),
    qts: Number(initial.qts.toFixed(3)),
    vas: drv.vas,
    mms: Number(initial.mms.toFixed(1)),
    cms: Number(initial.cms.toFixed(3)),
    sd: Number(sd.toFixed(1)),
    dd: Number(initial.dd.toFixed(0)),
    re: Number(initial.re.toFixed(2)),
    le: drv.le ?? 1.4,
    zNom: Number(initial.zNom.toFixed(1)),
    bl: Number(initial.bl.toFixed(2)),
    xmax: drv.xmax,
    powerW: drv.powerW,
  };
}

export function buildCustomDriverPreset(
  id: string,
  brand: string,
  model: string,
  sizeLabel: string,
  solved: TsSolverOutput,
  mounting: {
    cutoutDia: number;
    outerDia: number;
    depth: number;
    displacement: number;
  },
  referenceSeriesLeMh?: number,
): DriverPreset {
  const cleanBrand = brand.trim();
  const cleanModel = model.trim();
  const fullName = cleanBrand ? `${cleanBrand} ${cleanModel}` : cleanModel;
  const seriesRefRe =
    solved.voiceCoilCount === 2 ? solved.coilReOhms * 2 : solved.coilReOhms;
  const seriesRefZ =
    solved.voiceCoilCount === 2 ? solved.coilNominalOhms * 2 : solved.coilNominalOhms;
  const seriesRefLe =
    referenceSeriesLeMh ??
    (solved.voiceCoilCount === 2 && solved.coilWiring === 'parallel'
      ? solved.le * 4
      : solved.le);

  return {
    id,
    name: fullName,
    sizeLabel: sizeLabel.trim() || '12"',
    source: 'Własny T-S',
    isCustom: true,
    cutoutDia: mounting.cutoutDia,
    outerDia: mounting.outerDia,
    depth: mounting.depth,
    displacement: mounting.displacement,
    voiceCoilCount: solved.voiceCoilCount,
    coilNominalOhms: Number(solved.coilNominalOhms.toFixed(2)),
    coilReOhms: Number(solved.coilReOhms.toFixed(2)),
    fs: Number(solved.fs.toFixed(2)),
    qts: Number(solved.qts.toFixed(3)),
    vas: Number(solved.vas.toFixed(2)),
    xmax: Number(solved.xmax.toFixed(1)),
    powerW: Math.round(solved.powerW),
    qes: Number(solved.qes.toFixed(3)),
    qms: Number(solved.qms.toFixed(2)),
    re: Number(seriesRefRe.toFixed(2)),
    le: Number(seriesRefLe.toFixed(2)),
    zNom: Number(seriesRefZ.toFixed(1)),
    sd: Number(solved.sd.toFixed(1)),
    bl: Number(solved.bl.toFixed(2)),
    mms: Number(solved.mms.toFixed(1)),
    cms: Number(solved.cms.toFixed(3)),
    rms: Number(solved.rms.toFixed(2)),
    spl1w1m: Number(solved.spl1w1m.toFixed(2)),
  };
}
