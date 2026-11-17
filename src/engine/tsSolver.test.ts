import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BOX_PARAMS, DRIVER_PRESETS } from './presets';
import {
  simulateEnclosureSeries,
  type ComparisonVariant,
  type SignalChainConfig,
} from './simulator';
import {
  buildCustomDriverPreset,
  driverPresetToSolverInput,
  solveThieleSmall,
} from './tsSolver';

test('solveThieleSmall auto-calculates exact Q-triad (Qts, Qes, Qms) in all 3 modes', () => {
  const base = solveThieleSmall({
    qSolveMode: 'solve_qts',
    mechSolveMode: 'from_fs_vas',
    motorSolveMode: 'solve_bl',
    sdInputMode: 'direct_sd',
    fs: 33,
    qes: 0.45,
    qms: 5.2,
    qts: 0.4,
    vas: 42,
    mms: 150,
    cms: 0.15,
    sd: 490,
    dd: 250,
    re: 2.0,
    le: 1.6,
    zNom: 4,
    bl: 15,
    xmax: 16,
    powerW: 1000,
  });

  // 1 / Qts = 1 / 0.45 + 1 / 5.2 -> 0.41416
  assert.ok(Math.abs(base.qts - 0.41416) < 0.001);
  assert.ok(base.bl > 10 && base.mms > 50 && base.cms > 0.05);
  assert.ok(Math.abs(base.ebpHz - 33 / 0.45) < 0.05);
  assert.ok(Math.abs(base.vd - 490 * 1.6) < 0.1);

  // Inverse solve_qes from Qts + Qms
  const revQes = solveThieleSmall({
    qSolveMode: 'solve_qes',
    mechSolveMode: 'from_fs_vas',
    motorSolveMode: 'solve_bl',
    sdInputMode: 'direct_sd',
    fs: 33,
    qes: 0.99,
    qms: 5.2,
    qts: base.qts,
    vas: 42,
    mms: 150,
    cms: 0.15,
    sd: 490,
    dd: 250,
    re: 2.0,
    le: 1.6,
    zNom: 4,
    bl: 15,
    xmax: 16,
    powerW: 1000,
  });
  assert.ok(Math.abs(revQes.qes - 0.45) < 0.002);

  // Inverse solve_qms from Qts + Qes
  const revQms = solveThieleSmall({
    qSolveMode: 'solve_qms',
    mechSolveMode: 'from_fs_vas',
    motorSolveMode: 'solve_bl',
    sdInputMode: 'direct_sd',
    fs: 33,
    qes: 0.45,
    qms: 9.9,
    qts: base.qts,
    vas: 42,
    mms: 150,
    cms: 0.15,
    sd: 490,
    dd: 250,
    re: 2.0,
    le: 1.6,
    zNom: 4,
    bl: 15,
    xmax: 16,
    powerW: 1000,
  });
  assert.ok(Math.abs(revQms.qms - 5.2) < 0.02);
});

test('solveThieleSmall round-trips Fs/Vas <-> Mms/Cms and Bl <-> Qes consistently', () => {
  const fromDatasheet = solveThieleSmall({
    qSolveMode: 'solve_qts',
    mechSolveMode: 'from_fs_vas',
    motorSolveMode: 'solve_bl',
    sdInputMode: 'direct_sd',
    fs: 31,
    qes: 0.49,
    qms: 4.31,
    qts: 0.44,
    vas: 52,
    mms: 100,
    cms: 0.2,
    sd: 484,
    dd: 248,
    re: 2.0,
    le: 1.4,
    zNom: 4,
    bl: 10,
    xmax: 14,
    powerW: 600,
  });

  // Feed solved Mms, Cms, Bl back in to recover Fs, Vas, Qes, SPL
  const fromMotorMech = solveThieleSmall({
    qSolveMode: 'solve_qts',
    mechSolveMode: 'from_mms_cms',
    motorSolveMode: 'solve_qes_from_bl',
    sdInputMode: 'direct_sd',
    fs: 99,
    qes: 0.99,
    qms: 4.31,
    qts: 0.99,
    vas: 99,
    mms: fromDatasheet.mms,
    cms: fromDatasheet.cms,
    sd: 484,
    dd: 248,
    re: 2.0,
    le: 1.4,
    zNom: 4,
    bl: fromDatasheet.bl,
    xmax: 14,
    powerW: 600,
  });

  assert.ok(Math.abs(fromMotorMech.fs - 31) < 0.05);
  assert.ok(Math.abs(fromMotorMech.vas - 52) < 0.05);
  assert.ok(Math.abs(fromMotorMech.qes - 0.49) < 0.002);
  assert.ok(Math.abs(fromMotorMech.spl1w1m - fromDatasheet.spl1w1m) < 0.05);
});

test('buildCustomDriverPreset produces valid DriverPreset for simulator & 3D box with thermal/added-mass physics', () => {
  const input = driverPresetToSolverInput(DRIVER_PRESETS[0]);
  const solved = solveThieleSmall({ ...input, fs: 29, vas: 60, xmax: 20, powerW: 1200 });
  const custom = buildCustomDriverPreset('custom-dd', 'DD Audio', '712f D2', '12"', solved, {
    cutoutDia: 282,
    outerDia: 318,
    depth: 175,
    displacement: 3.4,
  });

  const signal: SignalChainConfig = {
    powerW: 1200,
    reOhms: 2.0,
    leMh: 1.4,
    hpfType: 'none',
    hpfHz: 25,
    lpfType: 'none',
    lpfHz: 90,
    cabinGain: false,
  };

  const coldVar: ComparisonVariant = {
    id: 'v-cold',
    name: 'Cold',
    color: '#38bdf8',
    visible: true,
    enclosureType: 'vented_slot',
    netVolumeL: 65,
    tuningHz: 34,
    portAreaCm2: 200,
    driverPresetId: custom.id,
    voiceCoilTempRiseC: 0,
    addedMassG: 0,
  };

  const hotMassVar: ComparisonVariant = {
    ...coldVar,
    id: 'v-hot',
    name: 'Hot + Mass',
    voiceCoilTempRiseC: 100,
    voiceCoilTempCoeff: 3.9,
    addedMassG: 60,
  };

  const coldRes = simulateEnclosureSeries(coldVar, DEFAULT_BOX_PARAMS, signal, [
    ...DRIVER_PRESETS,
    custom,
  ]);
  const hotRes = simulateEnclosureSeries(hotMassVar, DEFAULT_BOX_PARAMS, signal, [
    ...DRIVER_PRESETS,
    custom,
  ]);

  assert.ok(hotRes.effectiveFsHz < coldRes.effectiveFsHz, 'Added mass must lower Fs');
  assert.ok(hotRes.effectiveQts > coldRes.effectiveQts, 'Heating + mass must raise Qts');
  assert.ok(hotRes.thermalCompressionDb > 2.5, '100C coil rise must show power compression > 2.5 dB');
  assert.ok(hotRes.points[30].apparentLoadVa > 50);
  assert.ok(coldRes.points[30].maxPowerW > 0);
});
