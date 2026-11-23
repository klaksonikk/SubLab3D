import type { UnitSystem } from './types';

export const MM_PER_INCH = 25.4;
export const LITERS_PER_CUFT = 28.316846592;
export const CM2_PER_SQIN = 6.4516;
export const CM3_PER_CUIN = 16.387064;
export const SQFT_PER_SQM = 10.7639104167;
export const FTS_PER_MS = 1 / 0.3048;
export const LB_PER_KG = 2.20462262185;
export const G_PER_OZ = 28.349523125;
export const LBFT3_PER_KGM3 = 0.062427960576;

export interface UnitLabels {
  len: 'mm' | 'in';
  vol: 'L' | 'ft³';
  area: 'cm²' | 'in²';
  boardArea: 'm²' | 'ft²';
  smallVol: 'cm³' | 'in³';
  vel: 'm/s' | 'ft/s';
  weight: 'kg' | 'lb';
  mass: 'g' | 'oz';
  airDensity: 'kg/m³' | 'lb/ft³';
  areaPerVol: 'cm²/L' | 'in²/ft³';
}

export function getUnitLabels(unitSystem: UnitSystem): UnitLabels {
  if (unitSystem === 'imperial') {
    return {
      len: 'in',
      vol: 'ft³',
      area: 'in²',
      boardArea: 'ft²',
      smallVol: 'in³',
      vel: 'ft/s',
      weight: 'lb',
      mass: 'oz',
      airDensity: 'lb/ft³',
      areaPerVol: 'in²/ft³',
    };
  }
  return {
    len: 'mm',
    vol: 'L',
    area: 'cm²',
    boardArea: 'm²',
    smallVol: 'cm³',
    vel: 'm/s',
    weight: 'kg',
    mass: 'g',
    airDensity: 'kg/m³',
    areaPerVol: 'cm²/L',
  };
}

export function toDisplayLen(mm: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? mm / MM_PER_INCH : mm;
}

export function fromDisplayLen(val: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? val * MM_PER_INCH : val;
}

export function toDisplayVol(liters: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? liters / LITERS_PER_CUFT : liters;
}

export function fromDisplayVol(val: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? val * LITERS_PER_CUFT : val;
}

export function toDisplayArea(cm2: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? cm2 / CM2_PER_SQIN : cm2;
}

export function fromDisplayArea(val: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? val * CM2_PER_SQIN : val;
}

export function toDisplayBoardArea(m2: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? m2 * SQFT_PER_SQM : m2;
}

export function toDisplaySmallVol(cm3: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? cm3 / CM3_PER_CUIN : cm3;
}

export function toDisplayVel(ms: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? ms * FTS_PER_MS : ms;
}

export function fromDisplayVel(val: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? val / FTS_PER_MS : val;
}

export function toDisplayWeightKg(kg: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? kg * LB_PER_KG : kg;
}

export function toDisplayMassG(g: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? g / G_PER_OZ : g;
}

export function fromDisplayMassG(val: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? val * G_PER_OZ : val;
}

export function toDisplayAirDensity(kgM3: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? kgM3 * LBFT3_PER_KGM3 : kgM3;
}

export function fromDisplayAirDensity(val: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? val / LBFT3_PER_KGM3 : val;
}

export function toDisplayAreaPerVol(cm2PerL: number, unitSystem: UnitSystem): number {
  if (unitSystem === 'imperial') {
    return (cm2PerL / CM2_PER_SQIN) * LITERS_PER_CUFT;
  }
  return cm2PerL;
}

export function formatLen(
  mm: number,
  unitSystem: UnitSystem,
  metricDecimals = 0,
  imperialDecimals = 2,
): string {
  const val = toDisplayLen(mm, unitSystem);
  const dec = unitSystem === 'imperial' ? imperialDecimals : metricDecimals;
  return `${val.toFixed(dec)} ${unitSystem === 'imperial' ? 'in' : 'mm'}`;
}

export function formatLenNum(
  mm: number,
  unitSystem: UnitSystem,
  metricDecimals = 0,
  imperialDecimals = 2,
): string {
  const val = toDisplayLen(mm, unitSystem);
  const dec = unitSystem === 'imperial' ? imperialDecimals : metricDecimals;
  return val.toFixed(dec);
}

export function formatVol(
  liters: number,
  unitSystem: UnitSystem,
  metricDecimals = 1,
  imperialDecimals = 2,
): string {
  const val = toDisplayVol(liters, unitSystem);
  const dec = unitSystem === 'imperial' ? imperialDecimals : metricDecimals;
  return `${val.toFixed(dec)} ${unitSystem === 'imperial' ? 'ft³' : 'L'}`;
}

export function formatVolNum(
  liters: number,
  unitSystem: UnitSystem,
  metricDecimals = 1,
  imperialDecimals = 2,
): string {
  const val = toDisplayVol(liters, unitSystem);
  const dec = unitSystem === 'imperial' ? imperialDecimals : metricDecimals;
  return val.toFixed(dec);
}

export function formatArea(
  cm2: number,
  unitSystem: UnitSystem,
  metricDecimals = 0,
  imperialDecimals = 1,
): string {
  const val = toDisplayArea(cm2, unitSystem);
  const dec = unitSystem === 'imperial' ? imperialDecimals : metricDecimals;
  return `${val.toFixed(dec)} ${unitSystem === 'imperial' ? 'in²' : 'cm²'}`;
}

export function formatVel(
  ms: number,
  unitSystem: UnitSystem,
  metricDecimals = 1,
  imperialDecimals = 1,
): string {
  const val = toDisplayVel(ms, unitSystem);
  const dec = unitSystem === 'imperial' ? imperialDecimals : metricDecimals;
  return `${val.toFixed(dec)} ${unitSystem === 'imperial' ? 'ft/s' : 'm/s'}`;
}
