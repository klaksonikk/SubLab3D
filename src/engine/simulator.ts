import { calculateAcoustics } from './acoustics';
import { DRIVER_PRESETS } from './presets';
import {
  AIR_DENSITY_DEFAULT,
  SPEED_OF_SOUND_DEFAULT,
  solveThieleSmall,
  type TsSolverOutput,
} from './tsSolver';
import type { BoxParams, DriverPreset, EnclosureType } from './types';

export type FilterSlopeType = 'none' | 'bw12' | 'bw24' | 'lr24' | 'cheb12' | 'cheb24';

export type AcousticEnvironment = 'free_4pi' | 'half_2pi' | 'quarter_pi' | 'cabin';

export type DriverWiringType = 'parallel' | 'series';

export interface SignalChainConfig {
  powerW: number;
  reOhms: number;
  leMh: number;
  seriesResistanceOhms?: number; // Rg (kable / zwrotnica szeregowa)
  environment?: AcousticEnvironment;
  hpfType: FilterSlopeType;
  hpfHz: number;
  lpfType: FilterSlopeType;
  lpfHz: number;
  cabinGain: boolean;
  // EQ / DSP filters
  peqEnabled?: boolean;
  peqHz?: number;
  peqGainDb?: number;
  peqQ?: number;
  ltEnabled?: boolean; // Linkwitz Transform
  ltF0Hz?: number;
  ltQ0?: number;
  ltFpHz?: number;
  ltQp?: number;
  // Air environment parameters (Advanced tab)
  airDensityKgM3?: number;
  speedOfSoundMs?: number;
}

export interface ComparisonVariant {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  isLiveProject?: boolean;
  enclosureType: EnclosureType;
  netVolumeL: number;
  tuningHz: number;
  portAreaCm2: number;
  bandpassFrontRatio?: number;
  rearTuningHz?: number;
  rearPortAreaCm2?: number;
  // Multi-driver, coil thermal & cone mass extensions
  driverPresetId?: string;
  driverCount?: 1 | 2 | 3 | 4 | 5 | 6;
  wiring?: DriverWiringType;
  isobaric?: boolean;
  ql?: number; // Leakage loss Ql (default 7)
  qa?: number; // Absorption fill loss Qa (default 100 = empty, 18 = medium, 8 = heavy)
  voiceCoilTempRiseC?: number; // °C rise above 20°C
  voiceCoilTempCoeff?: number; // 1000/°C (Cu = 3.9, Al = 4.03)
  addedMassG?: number; // Added mass to cone (g)
  // WSD Vent calculator geometry
  portShape?: 'round' | 'slot';
  roundPortCount?: 1 | 2 | 3 | 4;
  roundPortDiameterMm?: number;
  portEndFlared?: boolean;
}

export interface SimCurvePoint {
  hz: number;
  transferDb: number; // Transfer function magnitude (EQ/Filter)
  transferBoxDb: number; // Pure box transfer function magnitude
  splDb: number;
  maxSplDb: number;
  maxPowerW: number;
  apparentLoadVa: number;
  excursionMm: number;
  portVelocityMs: number;
  portVelocityMach: number;
  frontPortGainDb: number;
  rearPortVelocityMs: number;
  rearPortGainDb: number;
  groupDelayMs: number; // Group delay (EQ/Filter)
  groupDelayBoxMs: number; // Pure box group delay
  impedanceOhms: number;
  impedancePhaseDeg: number;
  phaseDeg: number; // Phase (EQ/Filter)
  phaseBoxDeg: number; // Pure box phase
}

export interface SimulatedSeries {
  variantId: string;
  name: string;
  color: string;
  effectiveDriverName: string;
  effectiveDriverCount: number;
  effectiveXmaxMm: number;
  effectiveFsHz: number;
  effectiveQts: number;
  thermalCompressionDb: number;
  f3LowHz: number;
  f3HighHz: number | null;
  peakSplDb: number;
  peakMaxSplDb: number;
  peakExcursionMm: number;
  peakExcursionHz: number;
  peakPortVelocityMs: number;
  peakPortMach: number;
  portLengthMm: number | null;
  firstPortResonanceHz: number | null;
  peakGroupDelayMs: number;
  minImpedanceOhms: number;
  points: SimCurvePoint[];
}

export interface DerivedDriverMetrics extends TsSolverOutput {
  sdCm2: number;
  vdCm3: number;
  ratedPowerTotalW: number;
}

export interface DriverAlignmentSuggestion {
  id: string;
  category: 'sealed' | 'vented' | 'bandpass';
  title: string;
  subtitle: string;
  enclosureType: EnclosureType;
  netVolumeL: number;
  tuningHz: number | null;
  portAreaCm2: number;
  qtc?: number;
}

interface Complex {
  re: number;
  im: number;
}

function cMul(a: Complex, b: Complex): Complex {
  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  };
}

function cDiv(a: Complex, b: Complex): Complex {
  const denom = b.re * b.re + b.im * b.im;
  if (denom < 1e-18) return { re: 0, im: 0 };
  return {
    re: (a.re * b.re + a.im * b.im) / denom,
    im: (a.im * b.re - a.re * b.im) / denom,
  };
}

function cAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

function biquadHighPass(f: number, fc: number, q: number): Complex {
  const u = f / Math.max(1, fc);
  const u2 = u * u;
  return cDiv({ re: -u2, im: 0 }, { re: 1 - u2, im: u / q });
}

function biquadLowPass(f: number, fc: number, q: number): Complex {
  const u = f / Math.max(1, fc);
  const u2 = u * u;
  return cDiv({ re: 1, im: 0 }, { re: 1 - u2, im: u / q });
}

/**
 * Analog biquad Peaking EQ (constant-Q boost/cut)
 */
function evalPeakingEq(f: number, fc: number, gainDb: number, q: number): Complex {
  if (Math.abs(gainDb) < 0.05) return { re: 1, im: 0 };
  const A = Math.pow(10, gainDb / 40);
  const u = f / Math.max(10, fc);
  const u2 = u * u;
  const safeQ = Math.max(0.25, q);
  const num: Complex = { re: 1 - u2, im: (u * A) / safeQ };
  const den: Complex = { re: 1 - u2, im: u / (A * safeQ) };
  return cDiv(num, den);
}

/**
 * Linkwitz Transform: H(s) = (s^2 + (w0/Q0)s + w0^2) / (s^2 + (wp/Qp)s + wp^2)
 * Normalized to DC unity gain = (wp/w0)^2? No, WinISD normalizes passband (s -> inf) = 1:
 * At high freq H -> 1; at DC H -> (w0/wp)^2 providing low-end boost.
 */
function evalLinkwitzTransform(
  f: number,
  f0: number,
  q0: number,
  fp: number,
  qp: number,
): Complex {
  const w = 2 * Math.PI * f;
  const w0 = 2 * Math.PI * Math.max(10, f0);
  const wp = 2 * Math.PI * Math.max(10, fp);
  const num: Complex = { re: w0 * w0 - w * w, im: (w * w0) / Math.max(0.2, q0) };
  const den: Complex = { re: wp * wp - w * w, im: (w * wp) / Math.max(0.2, qp) };
  return cDiv(num, den);
}

function evalFilterTransfer(f: number, signal: SignalChainConfig): Complex {
  let h: Complex = { re: 1, im: 0 };

  if (signal.hpfType === 'bw12') {
    h = cMul(h, biquadHighPass(f, signal.hpfHz, 0.7071));
  } else if (signal.hpfType === 'bw24') {
    h = cMul(h, biquadHighPass(f, signal.hpfHz, 0.5412));
    h = cMul(h, biquadHighPass(f, signal.hpfHz, 1.3066));
  } else if (signal.hpfType === 'lr24') {
    const s = biquadHighPass(f, signal.hpfHz, 0.7071);
    h = cMul(h, cMul(s, s));
  } else if (signal.hpfType === 'cheb12') {
    h = cMul(h, biquadHighPass(f, signal.hpfHz / 1.2313, 0.8637));
  } else if (signal.hpfType === 'cheb24') {
    h = cMul(h, biquadHighPass(f, signal.hpfHz / 0.597, 0.7051));
    h = cMul(h, biquadHighPass(f, signal.hpfHz / 1.0313, 2.9406));
  }

  if (signal.lpfType === 'bw12') {
    h = cMul(h, biquadLowPass(f, signal.lpfHz, 0.7071));
  } else if (signal.lpfType === 'bw24') {
    h = cMul(h, biquadLowPass(f, signal.lpfHz, 0.5412));
    h = cMul(h, biquadLowPass(f, signal.lpfHz, 1.3066));
  } else if (signal.lpfType === 'lr24') {
    const s = biquadLowPass(f, signal.lpfHz, 0.7071);
    h = cMul(h, cMul(s, s));
  } else if (signal.lpfType === 'cheb12') {
    h = cMul(h, biquadLowPass(f, signal.lpfHz * 1.2313, 0.8637));
  } else if (signal.lpfType === 'cheb24') {
    h = cMul(h, biquadLowPass(f, signal.lpfHz * 0.597, 0.7051));
    h = cMul(h, biquadLowPass(f, signal.lpfHz * 1.0313, 2.9406));
  }

  if (signal.peqEnabled) {
    h = cMul(
      h,
      evalPeakingEq(f, signal.peqHz ?? 42, signal.peqGainDb ?? 0, signal.peqQ ?? 2.0),
    );
  }

  if (signal.ltEnabled) {
    h = cMul(
      h,
      evalLinkwitzTransform(
        f,
        signal.ltF0Hz ?? 48,
        signal.ltQ0 ?? 0.85,
        signal.ltFpHz ?? 28,
        signal.ltQp ?? 0.707,
      ),
    );
  }

  return h;
}

function estimateEnvironmentGainDb(f: number, signal: SignalChainConfig): number {
  const env: AcousticEnvironment =
    signal.environment ?? (signal.cabinGain ? 'cabin' : 'free_4pi');

  if (env === 'free_4pi') return 0;
  if (env === 'half_2pi') return 3.0; // Ground-plane / baffle step half-space boost
  if (env === 'quarter_pi') return 6.0; // Corner / boundary loading

  // Cabin gain (~+7.2 dB/oct below 65 Hz, capped at +13.5 dB)
  if (f >= 65) return 0;
  const octavesBelow = Math.log2(65 / Math.max(15, f));
  return Math.min(13.5, octavesBelow * 7.2);
}

/**
 * Estimates 1W/1m driver sensitivity in dB from Thiele-Small parameters
 * (Vas, Fs, Qts) with realistic subwoofer motor loss assumptions.
 */
export function estimateDriverSensitivity1W1m(params: BoxParams): number {
  const fs = Math.max(15, params.driverFs);
  const vasM3 = Math.max(0.005, params.driverVas / 1000);
  const qms = 4.6;
  const qes = Math.max(0.18, (params.driverQts * qms) / Math.max(0.4, qms - params.driverQts));
  const c = 343.2;
  const eta0 = ((4 * Math.PI * Math.PI) / (c * c * c)) * fs * fs * fs * (vasM3 / qes);
  const spl1w1m = 112.1 + 10 * Math.log10(Math.max(1e-5, eta0));
  return Math.max(81, Math.min(97, spl1w1m));
}

/**
 * Computes derived Thiele-Small driver metrics using full T-S physics.
 */
export function computeDerivedDriverMetrics(
  params: BoxParams,
  reOhms = 2.0,
  driverPreset?: DriverPreset,
): DerivedDriverMetrics {
  const cutoutDia = driverPreset?.cutoutDia ?? params.driverCutoutDia;
  const fs = driverPreset?.fs ?? params.driverFs;
  const qts = driverPreset?.qts ?? params.driverQts;
  const vas = driverPreset?.vas ?? params.driverVas;
  const xmax = driverPreset?.xmax ?? params.driverXmax;
  const powerW = driverPreset?.powerW ?? params.driverPowerW;
  const dd = Math.round(cutoutDia * 0.88);
  const sd = driverPreset?.sd ?? Math.PI * Math.pow(dd / 20, 2);
  const qms = driverPreset?.qms ?? 4.6;
  const qes =
    driverPreset?.qes ?? Math.max(0.18, (qts * qms) / Math.max(0.4, qms - qts));

  const solved = solveThieleSmall({
    qSolveMode: driverPreset?.qes ? 'solve_qts' : 'solve_qts',
    mechSolveMode: 'from_fs_vas',
    motorSolveMode: 'solve_bl',
    sdInputMode: 'direct_sd',
    fs: Math.max(15, fs),
    qes,
    qms,
    qts,
    vas: Math.max(2, vas),
    mms: driverPreset?.mms ?? 140,
    cms: driverPreset?.cms ?? 0.2,
    sd,
    dd,
    re: driverPreset?.re ?? reOhms,
    le: driverPreset?.le ?? 1.4,
    zNom: driverPreset?.zNom ?? 4,
    bl: driverPreset?.bl ?? 16,
    xmax,
    powerW,
  });

  const count = params.driverCount;
  return {
    ...solved,
    sdCm2: solved.sd * count,
    vdCm3: solved.vd * count,
    ratedPowerTotalW: solved.powerW * count,
  };
}

/**
 * Computes physical port length (mm) and 1st organ-pipe resonance (Hz) from Vb, Fb, and Port Area.
 * When pipeDiameterMm is provided for round/multi-pipe ports, end correction uses individual pipe diameter.
 */
export function computePortPhysicalStats(
  netVolumeL: number,
  tuningHz: number,
  portAreaCm2: number,
  flared = true,
  speedOfSoundMs = SPEED_OF_SOUND_DEFAULT,
  pipeDiameterMm?: number,
): {
  lengthMm: number;
  firstResonanceHz: number;
  endCorrectionMm: number;
  equivalentRoundDiaMm: number;
} | null {
  if (netVolumeL <= 1 || tuningHz <= 5 || portAreaCm2 <= 4) return null;
  const c = Math.max(300, speedOfSoundMs);
  const areaM2 = portAreaCm2 / 10000;
  const vbM3 = netVolumeL / 1000;
  const equivDiaM = 2 * Math.sqrt(areaM2 / Math.PI);
  const dEff =
    pipeDiameterMm && pipeDiameterMm >= 15 ? pipeDiameterMm / 1000 : equivDiaM;
  const endCorrectionM = (flared ? 0.732 : 0.85) * dEff;
  const rawLenM =
    (c * c * areaM2) / (4 * Math.PI * Math.PI * tuningHz * tuningHz * vbM3) -
    endCorrectionM;
  const lengthMm = Math.max(25, rawLenM * 1000);
  const effectivePipeM = Math.max(0.04, lengthMm / 1000 + endCorrectionM * 0.6);
  const firstResonanceHz = c / (2 * effectivePipeM);
  return {
    lengthMm,
    firstResonanceHz,
    endCorrectionMm: Math.round(endCorrectionM * 1000),
    equivalentRoundDiaMm: Math.round(equivDiaM * 1000),
  };
}

function resolveVariantDriver(
  variant: ComparisonVariant,
  baseParams: BoxParams,
  allDrivers: DriverPreset[],
  signal: SignalChainConfig,
): {
  name: string;
  count: number;
  fs: number;
  qes: number;
  qms: number;
  qts: number;
  vasOne: number;
  xmax: number;
  powerOne: number;
  cutoutDia: number;
  sdOneCm2: number;
  reOne: number;
  leOneMh: number;
} {
  const count = variant.driverCount ?? baseParams.driverCount;
  const targetId = variant.driverPresetId ?? baseParams.driverPresetId;
  const found = allDrivers.find((d) => d.id === targetId);
  const isOverride = Boolean(
    variant.driverPresetId && variant.driverPresetId !== baseParams.driverPresetId && found,
  );

  const fs = isOverride && found ? found.fs : baseParams.driverFs;
  const qts = isOverride && found ? found.qts : baseParams.driverQts;
  const qms = found?.qms ?? 4.6;
  const qes =
    found?.qes ?? Math.max(0.18, (qts * qms) / Math.max(0.4, qms - qts));
  const vasOne = isOverride && found ? found.vas : baseParams.driverVas;
  const xmax = isOverride && found ? found.xmax : baseParams.driverXmax;
  const powerOne = isOverride && found ? found.powerW : baseParams.driverPowerW;
  const cutoutDia = isOverride && found ? found.cutoutDia : baseParams.driverCutoutDia;
  const sdOneCm2 =
    found?.sd ?? Math.PI * Math.pow((cutoutDia * 0.88) / 20, 2);
  const reOne = isOverride && found?.re ? found.re : found?.re ?? signal.reOhms;
  const leOneMh = isOverride && found?.le !== undefined ? found.le : found?.le ?? signal.leMh;
  const name =
    isOverride && found
      ? found.name
      : baseParams.driverName ?? found?.name ?? 'Aktywny głośnik';

  return {
    name,
    count,
    fs,
    qes,
    qms,
    qts,
    vasOne,
    xmax,
    powerOne,
    cutoutDia,
    sdOneCm2,
    reOne,
    leOneMh,
  };
}

function unwrapPhase(complexArr: Complex[]): number[] {
  const unwrapped: number[] = [];
  for (let i = 0; i < complexArr.length; i++) {
    let ph = Math.atan2(complexArr[i].im, complexArr[i].re);
    if (i > 0) {
      const prev = unwrapped[i - 1];
      while (ph - prev > Math.PI) ph -= 2 * Math.PI;
      while (ph - prev < -Math.PI) ph += 2 * Math.PI;
    }
    unwrapped.push(ph);
  }
  return unwrapped;
}

function groupDelayAt(unwrapped: number[], freqs: number[], i: number): number {
  if (i > 0 && i < unwrapped.length - 1) {
    const dPhi = unwrapped[i + 1] - unwrapped[i - 1];
    const dW = 2 * Math.PI * (freqs[i + 1] - freqs[i - 1]);
    return Math.max(0, Math.min(95, (-dPhi / dW) * 1000));
  }
  if (i === 0 && unwrapped.length > 1) {
    const dPhi = unwrapped[1] - unwrapped[0];
    const dW = 2 * Math.PI * (freqs[1] - freqs[0]);
    return Math.max(0, Math.min(95, (-dPhi / dW) * 1000));
  }
  if (unwrapped.length > 1) {
    const dPhi = unwrapped[i] - unwrapped[i - 1];
    const dW = 2 * Math.PI * (freqs[i] - freqs[i - 1]);
    return Math.max(0, Math.min(95, (-dPhi / dW) * 1000));
  }
  return 0;
}

export function simulateEnclosureSeries(
  variant: ComparisonVariant,
  params: BoxParams,
  signal: SignalChainConfig,
  allDrivers: DriverPreset[] = DRIVER_PRESETS,
  maxFreqHz = 200,
): SimulatedSeries {
  const freqs: number[] = [];
  for (let f = 10; f <= maxFreqHz; f += 1) {
    freqs.push(f);
  }

  const rho = Math.max(0.8, signal.airDensityKgM3 ?? AIR_DENSITY_DEFAULT);
  const cSpeed = Math.max(300, signal.speedOfSoundMs ?? SPEED_OF_SOUND_DEFAULT);
  const rhoC2 = rho * cSpeed * cSpeed;

  const drv = resolveVariantDriver(variant, params, allDrivers, signal);
  const isIsobaric = Boolean(variant.isobaric);

  // Compute physical base Mms & Cms so Added Mass & Voice Coil Thermal Rise work faithfully
  const sdM2One = Math.max(0.002, drv.sdOneCm2 / 10000);
  const cmsMperN = (drv.vasOne / 1000) / (rhoC2 * sdM2One * sdM2One);
  const baseMmsKg = 1 / (Math.pow(2 * Math.PI * Math.max(15, drv.fs), 2) * cmsMperN);
  const addedMassKg = Math.max(0, (variant.addedMassG ?? 0) / 1000);
  const effMmsKg = baseMmsKg + addedMassKg;
  const massRatio = effMmsKg / baseMmsKg;

  // Added mass lowers Fs by 1/sqrt(massRatio) and raises Qes & Qms by sqrt(massRatio), Vas stays constant
  const fs = Math.max(10, drv.fs / Math.sqrt(massRatio));
  const qms = drv.qms * Math.sqrt(massRatio);
  const coldQes = drv.qes * Math.sqrt(massRatio);

  // Thermal voice coil temperature rise: Re(T) = Re_cold * (1 + alpha * dT)
  const tempRiseC = Math.max(0, Math.min(220, variant.voiceCoilTempRiseC ?? 0));
  const tempCoeffPerC = Math.max(0, variant.voiceCoilTempCoeff ?? 3.9) / 1000;
  const thermalFactor = 1 + tempCoeffPerC * tempRiseC;
  const thermalCompressionDb = 20 * Math.log10(thermalFactor);

  // Isobaric compound halves acoustic Vas per pair
  const vasTotal = Math.max(4, drv.vasOne * drv.count * (isIsobaric ? 0.5 : 1));

  // Polyfill absorption Qa gently boosts apparent box volume & damps resonance
  const qa = Math.max(4, Math.min(200, variant.qa ?? 100));
  const polyfillVolFactor = 1 + Math.max(0, (100 - qa) / 100) * 0.16;
  const vb = Math.max(3, variant.netVolumeL * polyfillVolFactor);
  const alpha = vasTotal / vb;

  // Wiring impedance scaling for multi-driver arrays + voice coil heating + series resistance Rg
  const wiring = variant.wiring ?? 'parallel';
  const rawRe = Math.max(0.35, drv.reOne * thermalFactor);
  const wiredRe =
    drv.count > 1
      ? wiring === 'series'
        ? rawRe * drv.count
        : Math.max(0.3, rawRe / drv.count)
      : rawRe;
  const rg = Math.max(0, signal.seriesResistanceOhms ?? 0);
  const reTotal = wiredRe + rg;
  const leH =
    (Math.max(0, drv.leOneMh) / 1000) *
    (drv.count > 1 ? (wiring === 'series' ? drv.count : 1 / drv.count) : 1);

  // Heating increases Re -> increases Qes proportionally; series Rg also increases effective Qes
  const thermalQes = coldQes * thermalFactor;
  const effectiveQes = thermalQes * (1 + rg / Math.max(0.3, wiredRe));
  const qts = (effectiveQes * qms) / (effectiveQes + qms);
  const resOhms = wiredRe * (qms / effectiveQes);

  // Sensitivity & SPL
  const eta0Cold =
    ((4 * Math.PI * Math.PI) / (cSpeed * cSpeed * cSpeed)) *
    Math.pow(fs, 3) *
    (drv.vasOne / 1000 / Math.max(0.05, coldQes));
  const sensCold1W1m = 112.1 + 10 * Math.log10(Math.max(1e-7, eta0Cold));
  const sens1W1m = Math.max(76, sensCold1W1m - (isIsobaric ? 3.0 : 0) - thermalCompressionDb);
  const countGainDb = 10 * Math.log10(drv.count);
  const powerGainDb = 10 * Math.log10(Math.max(1, signal.powerW));
  const rgLossDb = 20 * Math.log10(wiredRe / Math.max(0.3, reTotal));
  const baseSplDb = sens1W1m + countGainDb * 0.8 + powerGainDb + rgLossDb;
  const spl1WBase = sens1W1m + countGainDb * 0.8 + rgLossDb;

  const ratedPowerTotal = Math.max(50, drv.powerOne * drv.count);
  const totalPowerRatio = Math.sqrt(Math.max(0.05, signal.powerW) / ratedPowerTotal);
  const sdM2 = sdM2One * drv.count;

  const ql = Math.max(3, Math.min(30, variant.ql ?? 7));
  const qaDampFactor = 1 + Math.max(0, (100 - qa) / 100) * 0.18;

  const rawComplex: Array<{
    f: number;
    h: Complex;
    hBox: Complex;
    hFilter: Complex;
    impMag: number;
    impPhaseDeg: number;
    impReal: number;
  }> = [];

  for (const f of freqs) {
    const hFilter = evalFilterTransfer(f, signal);
    let hBox: Complex = { re: 1, im: 0 };
    let zTot: Complex = { re: reTotal, im: 0 };

    const w = 2 * Math.PI * f;
    const zVoiceCoil: Complex = { re: reTotal, im: w * leH };

    if (variant.enclosureType === 'sealed') {
      const fc = fs * Math.sqrt(1 + alpha);
      const qtc = (qts * Math.sqrt(1 + alpha)) / qaDampFactor;
      hBox = biquadHighPass(f, fc, qtc);

      const u = f / Math.max(10, fc);
      const zMot = cDiv({ re: resOhms, im: 0 }, { re: 1, im: qms * (u - 1 / u) });
      zTot = cAdd(zVoiceCoil, zMot);
    } else if (variant.enclosureType === 'bandpass_4th') {
      const ratio = variant.bandpassFrontRatio ?? 0.52;
      const rearL = Math.max(3, vb * (1 - ratio));
      const fcRear = fs * Math.sqrt(1 + vasTotal / rearL);
      const fbFront = Math.max(25, variant.tuningHz || 55);
      hBox = cMul(biquadHighPass(f, fcRear * 0.92, 0.72), biquadLowPass(f, fbFront * 1.15, 0.78));

      const u1 = f / Math.max(10, fcRear);
      const zMot = cDiv({ re: resOhms, im: 0 }, { re: 1, im: qms * (u1 - 1 / u1) });
      zTot = cAdd(zVoiceCoil, zMot);
    } else if (variant.enclosureType === 'bandpass_6th') {
      const fbLow = Math.max(16, Math.min(variant.rearTuningHz ?? 30, variant.tuningHz || 60));
      const fbHigh = Math.max(fbLow + 14, Math.max(variant.rearTuningHz ?? 30, variant.tuningHz || 60));
      hBox = cMul(biquadHighPass(f, fbLow, 0.85), biquadLowPass(f, fbHigh, 0.82));

      const uL = f / fbLow;
      const uH = f / fbHigh;
      const zMot = cAdd(
        cDiv({ re: resOhms * 0.75, im: 0 }, { re: 1, im: qms * (uL - 1 / uL) }),
        cDiv({ re: resOhms * 0.65, im: 0 }, { re: 1, im: qms * (uH - 1 / uH) }),
      );
      zTot = cAdd(zVoiceCoil, zMot);
    } else {
      // Vented 4th-order Thiele-Small with Ql & Qa
      const fb = Math.max(15, variant.tuningHz || 35);
      const hRatio = fb / fs;
      const effQl = ql / qaDampFactor;
      const A1 = 1 / qts + hRatio / effQl;
      const A2 = 1 + alpha + hRatio * hRatio + hRatio / (qts * effQl);
      const A3 = (hRatio * hRatio) / qts + hRatio / effQl;
      const A4 = hRatio * hRatio;

      const fn = f / fs;
      const fn2 = fn * fn;
      const fn3 = fn2 * fn;
      const fn4 = fn2 * fn2;
      hBox = cDiv(
        { re: fn4, im: 0 },
        { re: fn4 - A2 * fn2 + A4, im: -A1 * fn3 + A3 * fn },
      );

      // Coupled dual-peak impedance model around Fb
      const fLowPeak = fb * 0.68;
      const fHighPeak = Math.max(fb * 1.35, fs * Math.sqrt(1 + alpha * 0.65));
      const uLow = f / fLowPeak;
      const uHigh = f / fHighPeak;
      const zLow = cDiv({ re: resOhms * 0.82, im: 0 }, { re: 1, im: qms * 0.85 * (uLow - 1 / uLow) });
      const zHigh = cDiv({ re: resOhms * 0.92, im: 0 }, { re: 1, im: qms * 0.85 * (uHigh - 1 / uHigh) });
      zTot = cAdd(zVoiceCoil, cAdd(zLow, zHigh));
    }

    const impMag = Math.max(0.25, Math.hypot(zTot.re, zTot.im));
    const impPhaseDeg = (Math.atan2(zTot.im, zTot.re) * 180) / Math.PI;

    rawComplex.push({
      f,
      h: cMul(hBox, hFilter),
      hBox,
      hFilter,
      impMag,
      impPhaseDeg,
      impReal: Math.max(0.2, zTot.re),
    });
  }

  const unwrappedEq = unwrapPhase(rawComplex.map((r) => r.h));
  const unwrappedBox = unwrapPhase(rawComplex.map((r) => r.hBox));

  const fb = Math.max(15, variant.tuningHz || 35);
  const fbLow = Math.max(16, Math.min(variant.rearTuningHz ?? 30, fb));
  const sm2 = Math.max(0.001, variant.portAreaCm2 / 10000);
  const rearSm2 = Math.max(0.001, (variant.rearPortAreaCm2 || variant.portAreaCm2) / 10000);
  const vdMaxM3 = sdM2 * (drv.xmax / 1000);
  const vDriveSq = Math.max(1, signal.powerW) * reTotal;

  const points: SimCurvePoint[] = [];
  let maxPassbandDb = -999;

  for (let i = 0; i < rawComplex.length; i++) {
    const { f, h, hBox, hFilter, impMag, impPhaseDeg } = rawComplex[i];
    const mag = Math.max(1e-6, Math.hypot(h.re, h.im));
    const magBox = Math.max(1e-6, Math.hypot(hBox.re, hBox.im));
    const envDb = estimateEnvironmentGainDb(f, signal);
    const transferDb = Math.max(-55, 20 * Math.log10(mag) + envDb);
    const transferBoxDb = Math.max(-55, 20 * Math.log10(magBox) + envDb);
    const splDb = baseSplDb + transferDb;
    if (transferDb > maxPassbandDb) maxPassbandDb = transferDb;

    const gdMs = groupDelayAt(unwrappedEq, freqs, i);
    const gdBoxMs = groupDelayAt(unwrappedBox, freqs, i);

    const filterMag = Math.hypot(hFilter.re, hFilter.im);
    let excAtRatedRatio = 0;
    let portVelocityMs = 0;
    let frontPortGainDb = -40;
    let rearPortVelocityMs = 0;
    let rearPortGainDb = -40;

    if (variant.enclosureType === 'sealed') {
      const fc = fs * Math.sqrt(1 + alpha);
      const qtc = (qts * Math.sqrt(1 + alpha)) / qaDampFactor;
      const u = f / fc;
      const excScale = 1 / Math.max(0.25, Math.hypot(1 - u * u, u / qtc));
      excAtRatedRatio = drv.xmax * 0.68 * excScale * filterMag;
    } else if (variant.enclosureType === 'bandpass_4th' || variant.enclosureType === 'bandpass_6th') {
      const center = Math.max(30, variant.tuningHz * 0.85);
      const notch = Math.min(1, Math.abs(f - fb) / (fb * 0.35));
      excAtRatedRatio =
        drv.xmax *
        (0.35 + 0.55 * notch * Math.exp(-Math.pow((f - center) / 35, 2))) *
        filterMag;
      const dist = Math.abs(f - fb) / Math.max(10, fb);
      const portShape = Math.exp(-dist * dist * 3.5);
      portVelocityMs =
        ((2 * Math.PI * fb * vdMaxM3 * 1.1) / sm2) *
        portShape *
        totalPowerRatio *
        filterMag;
      frontPortGainDb = Math.max(-45, 20 * Math.log10(Math.max(1e-3, portShape)) + envDb);

      if (variant.enclosureType === 'bandpass_6th') {
        const distR = Math.abs(f - fbLow) / Math.max(8, fbLow);
        const rearShape = Math.exp(-distR * distR * 3.8);
        rearPortVelocityMs =
          ((2 * Math.PI * fbLow * vdMaxM3 * 1.05) / rearSm2) *
          rearShape *
          totalPowerRatio *
          filterMag;
        rearPortGainDb = Math.max(-45, 20 * Math.log10(Math.max(1e-3, rearShape)) + envDb);
      }
    } else {
      const notch = Math.abs(f - fb) / fb;
      const coneLoad = 0.25 + 0.75 * Math.min(1.3, notch * 2.2);
      const subsonicBoost = f < fb ? 1 + ((fb - f) / fb) * 1.25 : 1;
      excAtRatedRatio = drv.xmax * 0.66 * coneLoad * subsonicBoost * filterMag;

      const uFb = f / fb;
      const portNorm =
        Math.pow(f / fs, 2) /
        Math.max(0.15, Math.sqrt(Math.pow(1 - uFb * uFb, 2) + Math.pow(f / (fb * 2.2), 2)));
      const peakVel = (2 * Math.PI * fb * vdMaxM3 * 1.15) / sm2;
      portVelocityMs = peakVel * Math.min(1.25, portNorm * 0.48) * totalPowerRatio * filterMag;
      frontPortGainDb = Math.max(-45, 20 * Math.log10(Math.max(1e-3, portNorm * 0.45)) + envDb);
    }

    const excursionMm = excAtRatedRatio * totalPowerRatio;
    // Maximum Power & Maximum SPL limited by Xmax vs Thermal Pe
    const safePowerFromXmax =
      excAtRatedRatio > 0.05
        ? ratedPowerTotal * Math.pow(drv.xmax / excAtRatedRatio, 2)
        : ratedPowerTotal;
    const maxPowerW = Math.max(1, Math.min(ratedPowerTotal, safePowerFromXmax));
    const maxSplDb = spl1WBase + 10 * Math.log10(maxPowerW) + transferDb;

    // Amplifier apparent load power (VA = V^2 / |Z|)
    const apparentLoadVa = vDriveSq / impMag;

    const phaseDeg = ((((unwrappedEq[i] * 180) / Math.PI) % 360) + 540) % 360 - 180;
    const phaseBoxDeg = ((((unwrappedBox[i] * 180) / Math.PI) % 360) + 540) % 360 - 180;

    points.push({
      hz: f,
      transferDb,
      transferBoxDb,
      splDb,
      maxSplDb,
      maxPowerW,
      apparentLoadVa,
      excursionMm: Math.min(drv.xmax * 4, Math.max(0, excursionMm)),
      portVelocityMs: Math.max(0, portVelocityMs),
      portVelocityMach: Math.max(0, portVelocityMs / cSpeed),
      frontPortGainDb,
      rearPortVelocityMs: Math.max(0, rearPortVelocityMs),
      rearPortGainDb,
      groupDelayMs: gdMs,
      groupDelayBoxMs: gdBoxMs,
      impedanceOhms: impMag,
      impedancePhaseDeg: impPhaseDeg,
      phaseDeg,
      phaseBoxDeg,
    });
  }

  let f3LowHz = 10;
  let f3HighHz: number | null = null;
  let entered = false;
  const refThreshold = maxPassbandDb - 3;
  let peakSplDb = -999;
  let peakMaxSplDb = -999;
  let peakExcursionMm = 0;
  let peakExcursionHz = 20;
  let peakPortVelocityMs = 0;
  let peakPortMach = 0;
  let peakGroupDelayMs = 0;
  let minImpedanceOhms = 999;

  for (const pt of points) {
    if (!entered && pt.transferDb >= refThreshold) {
      f3LowHz = pt.hz;
      entered = true;
    } else if (entered && f3HighHz === null && pt.transferDb < refThreshold) {
      f3HighHz = pt.hz;
    }
    if (pt.splDb > peakSplDb) peakSplDb = pt.splDb;
    if (pt.maxSplDb > peakMaxSplDb) peakMaxSplDb = pt.maxSplDb;
    if (pt.excursionMm > peakExcursionMm) {
      peakExcursionMm = pt.excursionMm;
      peakExcursionHz = pt.hz;
    }
    if (pt.portVelocityMs > peakPortVelocityMs) peakPortVelocityMs = pt.portVelocityMs;
    if (pt.portVelocityMach > peakPortMach) peakPortMach = pt.portVelocityMach;
    if (pt.groupDelayMs > peakGroupDelayMs) peakGroupDelayMs = pt.groupDelayMs;
    if (pt.impedanceOhms < minImpedanceOhms) minImpedanceOhms = pt.impedanceOhms;
  }

  const portStats =
    variant.enclosureType === 'sealed'
      ? null
      : computePortPhysicalStats(
          variant.netVolumeL,
          variant.tuningHz,
          variant.portAreaCm2,
          variant.portEndFlared ?? true,
          cSpeed,
          variant.portShape === 'round' ? variant.roundPortDiameterMm : undefined,
        );

  return {
    variantId: variant.id,
    name: variant.name,
    color: variant.color,
    effectiveDriverName: drv.name,
    effectiveDriverCount: drv.count,
    effectiveXmaxMm: drv.xmax,
    effectiveFsHz: fs,
    effectiveQts: qts,
    thermalCompressionDb,
    f3LowHz,
    f3HighHz,
    peakSplDb,
    peakMaxSplDb,
    peakExcursionMm,
    peakExcursionHz,
    peakPortVelocityMs,
    peakPortMach,
    portLengthMm: portStats?.lengthMm ?? null,
    firstPortResonanceHz: portStats?.firstResonanceHz ?? null,
    peakGroupDelayMs,
    minImpedanceOhms,
    points,
  };
}

export function createLiveProjectVariant(params: BoxParams): ComparisonVariant {
  const acoustics = calculateAcoustics(params);
  const typeLabel =
    params.enclosureType === 'sealed'
      ? 'Zamknięta'
      : params.enclosureType === 'bandpass_4th'
        ? 'Bandpass 4-rz.'
        : params.enclosureType === 'bandpass_6th'
          ? 'Bandpass 6-rz.'
          : params.enclosureType === 'vented_round'
            ? 'Bass-Reflex (Aero)'
            : 'Bass-Reflex (Szczel.)';
  return {
    id: 'live-project',
    name: `Projekt główny (${typeLabel})`,
    color: '#ef4444',
    visible: true,
    isLiveProject: true,
    enclosureType: params.enclosureType,
    netVolumeL: Math.max(4, acoustics.netVolumeL),
    tuningHz: acoustics.tuningHz ?? 35,
    portAreaCm2: acoustics.portAreaCm2,
    bandpassFrontRatio: params.bandpassFrontRatio,
    rearTuningHz: acoustics.rearPortTuningHz ?? undefined,
    rearPortAreaCm2: acoustics.rearPortAreaCm2 || undefined,
    driverPresetId: params.driverPresetId,
    driverCount: params.driverCount,
    wiring: 'parallel',
    isobaric: false,
    ql: 7,
    qa: 100,
    portShape: params.enclosureType === 'vented_round' ? 'round' : 'slot',
    roundPortCount: params.portCount,
    roundPortDiameterMm: Math.round(acoustics.effectivePortDiameter),
    portEndFlared: params.portFlared,
  };
}

export function computeDriverAlignments(params: BoxParams): {
  ebpHz: number;
  recommendation: string;
  suggestions: DriverAlignmentSuggestion[];
} {
  const fs = Math.max(15, params.driverFs);
  const qts = Math.max(0.18, params.driverQts);
  const vasTotal = Math.max(4, params.driverVas * params.driverCount);
  const qms = 4.6;
  const qes = Math.max(0.18, (qts * qms) / Math.max(0.4, qms - qts));
  const ebpHz = fs / qes;

  const recommendation =
    ebpHz < 52
      ? 'Niski EBP (< 52 Hz) — przetwornik świetnie sprawdzi się w obudowie zamkniętej lub Bandpass 4-go rzędu.'
      : ebpHz <= 85
        ? 'Uniwersalny EBP (52–85 Hz) — dobry zarówno do Bass-Reflex (QB3/SBB4), jak i do obudowy zamkniętej.'
        : 'Wysoki EBP (> 85 Hz) — stworzony do obudów wentylowanych Bass-Reflex oraz Bandpass 6-go rzędu.';

  // 1. Sealed Butterworth B2 (Qtc = 0.707)
  const qtcTarget = Math.max(qts + 0.06, 0.707);
  const alphaSealed = Math.max(0.15, Math.pow(qtcTarget / qts, 2) - 1);
  const sealedVolL = Math.round((vasTotal / alphaSealed) * 10) / 10;

  // 2. Sealed Chebyshev C2 (Qtc ≈ 0.92, compact +0.7 dB passband punch)
  const qtcCheb = Math.min(1.15, Math.max(qts + 0.08, 0.92));
  const alphaSealedCheb = Math.max(0.25, Math.pow(qtcCheb / qts, 2) - 1);
  const sealedChebVolL = Math.round((vasTotal / alphaSealedCheb) * 10) / 10;

  // 3. Vented SBB4 / QB3 (flat response)
  const vbFlatL = Math.round(Math.max(12, vasTotal * 14.5 * Math.pow(qts, 2.85)) * 10) / 10;
  const fbFlatHz = Math.round(Math.max(22, Math.min(55, (0.42 * fs) / Math.pow(qts, 0.9))) * 10) / 10;
  const areaFlatCm2 = Math.round(Math.max(60, vbFlatL * 2.6));

  // 4. Vented Chebyshev C4 (~0.8 dB passband ripple, higher SPL output with clean F3)
  const fbChebHz = Math.round(
    Math.max(24, Math.min(55, fs * (qts < 0.42 ? 0.98 : qts < 0.52 ? 0.9 : 0.8))) * 10,
  ) / 10;
  let vbChebL = Math.round(Math.max(14, vbFlatL * 1.12) * 10) / 10;
  let bestChebScore = Number.POSITIVE_INFINITY;
  const minScanVb = Math.max(12, Math.min(vasTotal * 0.9, vbFlatL * 0.8));
  const maxScanVb = Math.max(vasTotal * 2.8, vbFlatL * 2.2);
  const stepScan = Math.max(0.5, (maxScanVb - minScanVb) / 48);
  for (let candVb = minScanVb; candVb <= maxScanVb; candVb += stepScan) {
    const ql = 7;
    const alphaC = vasTotal / candVb;
    const hC = fbChebHz / fs;
    const A1 = 1 / qts + hC / ql;
    const A2 = 1 + alphaC + hC * hC + hC / (qts * ql);
    const A3 = (hC * hC) / qts + hC / ql;
    const A4 = hC * hC;
    let peakDb = -99;
    let f3Hz = fbChebHz;
    for (let f = 15; f <= 160; f += 2) {
      const fn = f / fs;
      const fn2 = fn * fn;
      const fn3 = fn2 * fn;
      const fn4 = fn2 * fn2;
      const mag = fn4 / Math.hypot(fn4 - A2 * fn2 + A4, -A1 * fn3 + A3 * fn);
      const db = 20 * Math.log10(Math.max(1e-6, mag));
      if (db > peakDb) peakDb = db;
    }
    for (let f = 160; f >= 15; f -= 2) {
      const fn = f / fs;
      const fn2 = fn * fn;
      const fn3 = fn2 * fn;
      const fn4 = fn2 * fn2;
      const mag = fn4 / Math.hypot(fn4 - A2 * fn2 + A4, -A1 * fn3 + A3 * fn);
      const db = 20 * Math.log10(Math.max(1e-6, mag));
      if (db < -3) {
        f3Hz = f + 2;
        break;
      }
    }
    const dipPenalty = f3Hz > Math.max(fbChebHz * 1.2, fs * 1.25) ? 6 : 0;
    const score = Math.abs(peakDb - 0.85) + dipPenalty;
    if (score < bestChebScore) {
      bestChebScore = score;
      vbChebL = Math.round(candVb * 10) / 10;
    }
  }
  const areaChebCm2 = Math.round(Math.max(65, vbChebL * 2.75));

  // 5. Vented EBS / Daily SQL (Extended Bass Shelf: larger box, lower tuning)
  const vbDailyL = Math.round(vbFlatL * 1.32 * 10) / 10;
  const fbDailyHz = Math.round(Math.max(24, fbFlatHz * 0.88) * 10) / 10;
  const areaDailyCm2 = Math.round(Math.max(80, vbDailyL * 3.0));

  // 6. Bandpass 4th-order punchy
  const vbBp4L = Math.round((sealedVolL * 0.85 + vbFlatL * 0.75) * 10) / 10;
  const fbBp4Hz = Math.round(Math.max(45, Math.min(72, fs * 1.75)) * 10) / 10;

  return {
    ebpHz,
    recommendation,
    suggestions: [
      {
        id: 'align-sealed-0707',
        category: 'sealed',
        title: 'Zamknięta B2 (Qtc ≈ 0.71)',
        subtitle: 'Butterworth — maksymalnie płaski impuls i zwarty bas audiofilski SQ.',
        enclosureType: 'sealed',
        netVolumeL: sealedVolL,
        tuningHz: null,
        portAreaCm2: 0,
        qtc: Number(qtcTarget.toFixed(2)),
      },
      {
        id: 'align-sealed-cheb',
        category: 'sealed',
        title: `Zamknięta Chebyshev C2 (Qtc ≈ ${qtcCheb.toFixed(2)})`,
        subtitle: 'Czebyszew C2 (+0.7 dB) — kompaktowy litraż i mocniejszy kick w średnim basie.',
        enclosureType: 'sealed',
        netVolumeL: sealedChebVolL,
        tuningHz: null,
        portAreaCm2: 0,
        qtc: Number(qtcCheb.toFixed(2)),
      },
      {
        id: 'align-br-b4',
        category: 'vented',
        title: 'Bass-Reflex SBB4 / QB3',
        subtitle: 'Optymalna objętość i najniższe opóźnienie grupowe dla BR.',
        enclosureType: 'vented_slot',
        netVolumeL: vbFlatL,
        tuningHz: fbFlatHz,
        portAreaCm2: areaFlatCm2,
      },
      {
        id: 'align-br-cheb',
        category: 'vented',
        title: 'Bass-Reflex Chebyshev (C4)',
        subtitle: 'Czebyszew C4 (+0.8 dB ripple) — wyższa sprawność SPL i dynamiczne zejście.',
        enclosureType: 'vented_slot',
        netVolumeL: vbChebL,
        tuningHz: fbChebHz,
        portAreaCm2: areaChebCm2,
      },
      {
        id: 'align-br-daily',
        category: 'vented',
        title: 'Bass-Reflex EBS / Street SQL',
        subtitle: 'Powiększona komora + niższe strojenie dla głębokiego zejścia.',
        enclosureType: 'vented_slot',
        netVolumeL: vbDailyL,
        tuningHz: fbDailyHz,
        portAreaCm2: areaDailyCm2,
      },
      {
        id: 'align-bp4',
        category: 'bandpass',
        title: 'Bandpass 4-go rzędu',
        subtitle: 'Wysoka sprawność i koncentracja energii w paśmie 40–75 Hz.',
        enclosureType: 'bandpass_4th',
        netVolumeL: vbBp4L,
        tuningHz: fbBp4Hz,
        portAreaCm2: Math.round(areaFlatCm2 * 1.15),
      },
    ],
  };
}
