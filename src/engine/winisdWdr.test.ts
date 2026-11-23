import test from 'node:test';
import assert from 'node:assert/strict';
import { detectWdrUnitSystem, parseWinIsdWdr } from './winisdWdr';

const SAMPLE_WINISD_PRO_SI_WDR = `[Driver]
Brand=Deaf Bonce
Model=Machete MF-12R D2
Comment=12 inch car audio subwoofer
VoiceCoils=2
Znom=4
Re=3.6
Le=0.0022
Fs=37.6
Qms=4.49
Qes=0.525
Qts=0.47
Vas=0.0248
Mms=0.195
Cms=0.0000918
Sd=0.048
Bl=17.4
Xmax=0.015
Pe=1200
Dia=0.247
CutoutDia=0.282
OuterDia=0.320
Depth=0.162
c=343.2
ro=1.204
`;

const SAMPLE_PRACTICAL_WDR = `[Driver]
Brand=Dayton Audio
Model=RSS390HF-4
Comment=15" Reference Series HF Subwoofer
VoiceCoils=1
Znom=4
Re=3.1
Fs=18.5
Qms=2.14
Qes=0.47
Qts=0.38
Vas=195.4
Mms=237.1
Cms=0.31
Bl=15.4
Sd=840.0
H-g=8.0
H-c=36.0
Pe=500.
Le=1.45
`;

test('detects WinISD Pro SI unit system vs practical units', () => {
  assert.equal(
    detectWdrUnitSystem({ vas: '0.0248', sd: '0.048', mms: '0.195', xmax: '0.015' }),
    'si',
  );
  assert.equal(
    detectWdrUnitSystem({ vas: '195.4', sd: '840.0', mms: '237.1', xmax: '14.0' }),
    'practical',
  );
});

test('parses standard WinISD Pro SI .wdr file accurately with DVC coils', () => {
  const res = parseWinIsdWdr(SAMPLE_WINISD_PRO_SI_WDR, 'Machete_MF12R_D2.wdr');
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.detectedUnitSystem, 'si');
  assert.equal(res.brand, 'Deaf Bonce');
  assert.equal(res.model, 'Machete MF-12R D2');
  assert.equal(res.sizeLabel, '12"');
  assert.equal(res.driver.voiceCoilCount, 2);
  assert.equal(res.driver.coilNominalOhms, 2);
  assert.equal(res.driver.coilReOhms, 1.8);
  assert.equal(res.driver.re, 3.6);
  assert.equal(res.driver.le, 2.2);
  assert.equal(res.driver.fs, 37.6);
  assert.ok(Math.abs(res.driver.vas - 24.8) < 0.05);
  assert.ok(Math.abs((res.driver.sd ?? 0) - 480) < 0.5);
  assert.equal(res.driver.xmax, 15);
  assert.equal(res.driver.powerW, 1200);
  assert.equal(res.mounting.cutoutDia, 282);
  assert.equal(res.mounting.outerDia, 320);
  assert.equal(res.mounting.depth, 162);
});

test('parses practical-unit .wdr file with H-c/H-g excursion fallback and 15" size inference', () => {
  const res = parseWinIsdWdr(SAMPLE_PRACTICAL_WDR, 'RSS390HF-4.wdr');
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.detectedUnitSystem, 'practical');
  assert.equal(res.brand, 'Dayton Audio');
  assert.equal(res.model, 'RSS390HF-4');
  assert.equal(res.sizeLabel, '15"');
  assert.equal(res.driver.voiceCoilCount, 1);
  assert.equal(res.driver.fs, 18.5);
  assert.ok(Math.abs(res.driver.vas - 195.4) < 0.1);
  assert.ok(Math.abs((res.driver.sd ?? 0) - 840) < 0.5);
  // Xmax from |H-c - H-g| / 2 = |36 - 8| / 2 = 14 mm
  assert.equal(res.driver.xmax, 14);
  assert.equal(res.driver.powerW, 500);
  assert.equal(res.driver.le, 1.45);
});

test('handles European decimal commas, scientific notation, and partial T-S fields', () => {
  const partialEu = `
; Exported with comma decimals
[Driver]
Manufacturer=Sundown Audio
Name=SA-10 Rev.3
Fs=33,4
Qts=0,46
Qms=5,1
Vas=1,65E-2
Sd=3,14E-2
Xmax=1,9E-2
Re=3,4
Pe=750
`;
  const res = parseWinIsdWdr(partialEu, 'sa10.wdr');
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.detectedUnitSystem, 'si');
  assert.equal(res.brand, 'Sundown Audio');
  assert.equal(res.model, 'SA-10 Rev.3');
  assert.equal(res.sizeLabel, '10"');
  assert.equal(res.driver.fs, 33.4);
  assert.ok(Math.abs(res.driver.vas - 16.5) < 0.1);
  assert.ok(Math.abs((res.driver.sd ?? 0) - 314) < 1);
  assert.equal(res.driver.xmax, 19);
  assert.ok((res.driver.qes ?? 0) > 0.4 && (res.driver.qes ?? 0) < 0.6);
  assert.ok((res.driver.bl ?? 0) > 5);
});

test('returns clean error for invalid or non-WDR files in both PL and EN', () => {
  const invalidPl = parseWinIsdWdr('{"not":"a wdr file"}', 'bad.json', 'auto', 'pl');
  assert.equal(invalidPl.ok, false);
  if (!invalidPl.ok) {
    assert.ok(invalidPl.error.includes('WinISD .wdr'));
  }

  const invalidEn = parseWinIsdWdr('{"not":"a wdr file"}', 'bad.json', 'auto', 'en');
  assert.equal(invalidEn.ok, false);
  if (!invalidEn.ok) {
    assert.ok(invalidEn.error.includes('valid WinISD .wdr'));
  }
});

