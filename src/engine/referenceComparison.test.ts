import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAcoustics } from './acoustics';
import {
  BOX_TEMPLATE_PRESETS,
  DEFAULT_BOX_PARAMS,
  DRIVER_PRESETS,
} from './presets';
import {
  computeDriverAlignments,
  computePortPhysicalStats,
  simulateEnclosureSeries,
  type SignalChainConfig,
} from './simulator';
import {
  computeElectricalLoad,
  driverPresetToSolverInput,
  solveThieleSmall,
} from './tsSolver';

const BASE_SIGNAL: SignalChainConfig = {
  powerW: 1200,
  reOhms: 3.6,
  leMh: 2.2,
  seriesResistanceOhms: 0.1,
  environment: 'free_4pi',
  hpfType: 'none',
  hpfHz: 25,
  lpfType: 'none',
  lpfHz: 100,
  cabinGain: false,
};

test('Deaf Bonce Machete MF-12R D2 datasheet T-S solver matches catalog parameters and WSD formulas', () => {
  const mf12r = DRIVER_PRESETS.find((d) => d.id === 'deaf-bonce-mf12r-d2');
  assert.ok(mf12r, 'MF-12R D2 preset must exist');

  const solved = solveThieleSmall(driverPresetToSolverInput(mf12r));
  // Datasheet specs: Fs=37.6 Hz, Vas=24.8 L, Qts=0.47, SPL=86.0 dB, Xmax=15 mm, Pe=1200W
  assert.equal(solved.fs, 37.6);
  assert.equal(solved.vas, 24.8);
  assert.ok(Math.abs(solved.qts - 0.47) < 0.005, `Qts=${solved.qts}`);
  assert.ok(Math.abs(solved.spl1w1m - 86.0) < 0.25, `SPL 1W/1m=${solved.spl1w1m}`);
  assert.ok(solved.ebpHz > 68 && solved.ebpHz < 76, `EBP=${solved.ebpHz}`);
  assert.equal(Math.round(solved.vd), 720); // 480 cm2 * 1.5 cm = 720 cm3
  assert.ok(solved.mms > 200 && solved.mms < 270, `Mms=${solved.mms}`);

  // Compare MF-12R D2 in Subbox.pro-matched enclosure geometry (680x380, 18mm, 55L net, Fb=35Hz, 180cm2)
  const box = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'vented_slot',
    boxAutoCalcField: 'depth',
    externalWidth: 680,
    externalHeight: 380,
    thickness: 18,
    doubleFrontBaffle: false,
    driverPresetId: mf12r.id,
    driverCutoutDia: mf12r.cutoutDia,
    driverOuterDia: mf12r.outerDia,
    driverDepth: mf12r.depth,
    driverDisplacement: mf12r.displacement,
    driverFs: mf12r.fs,
    driverQts: mf12r.qts,
    driverVas: mf12r.vas,
    driverXmax: mf12r.xmax,
    driverPowerW: mf12r.powerW,
    targetNetVolumeL: 55,
    portControlMode: 'tuning',
    targetTuningHz: 35,
    targetPortAreaCm2: 180,
  });
  assert.ok(Math.abs(box.netVolumeL - 55) < 0.1);
  assert.ok(box.tuningHz !== null && Math.abs(box.tuningHz - 35) < 0.15);

  // Compare WSD round-port physical calculation & alignments
  const roundStats = computePortPhysicalStats(55, 35, 157.1, true, 343.2, 100);
  assert.ok(roundStats !== null && roundStats.lengthMm > 580 && roundStats.lengthMm < 660, `lengthMm=${roundStats?.lengthMm}`);

  const alignments = computeDriverAlignments({
    ...DEFAULT_BOX_PARAMS,
    driverFs: mf12r.fs,
    driverQts: mf12r.qts,
    driverVas: mf12r.vas,
  });
  assert.equal(alignments.suggestions.length, 6);

  const sbb4 = alignments.suggestions.find((s) => s.id === 'align-br-b4')!;
  const chebC4 = alignments.suggestions.find((s) => s.id === 'align-br-cheb')!;
  const simSbb4 = simulateEnclosureSeries(
    {
      id: 'mf12r-sbb4',
      name: 'MF-12R SBB4',
      color: '#38bdf8',
      visible: true,
      enclosureType: 'vented_slot',
      netVolumeL: sbb4.netVolumeL,
      tuningHz: sbb4.tuningHz!,
      portAreaCm2: sbb4.portAreaCm2,
      driverPresetId: mf12r.id,
      driverCount: 1,
    },
    DEFAULT_BOX_PARAMS,
    BASE_SIGNAL,
    DRIVER_PRESETS,
    200,
  );
  const simCheb = simulateEnclosureSeries(
    {
      id: 'mf12r-cheb',
      name: 'MF-12R Chebyshev C4',
      color: '#ef4444',
      visible: true,
      enclosureType: 'vented_slot',
      netVolumeL: chebC4.netVolumeL,
      tuningHz: chebC4.tuningHz!,
      portAreaCm2: chebC4.portAreaCm2,
      driverPresetId: mf12r.id,
      driverCount: 1,
    },
    DEFAULT_BOX_PARAMS,
    BASE_SIGNAL,
    DRIVER_PRESETS,
    200,
  );
  assert.ok(simCheb.f3LowHz <= simSbb4.f3LowHz + 3);
  assert.ok(simCheb.peakSplDb > simSbb4.peakSplDb - 0.5);
});

test('Default catalog contains only Deaf Bonce MF-12R D2 and solves cleanly across all templates', () => {
  assert.equal(DRIVER_PRESETS.length, 1);
  assert.equal(DRIVER_PRESETS[0].id, 'deaf-bonce-mf12r-d2');

  for (const removedId of [
    '12-sql-daily',
    '12-spl-monster',
    '10-compact',
    '15-low-end',
    '8-underseat',
    'dayton-um12-22',
    'alpine-swr-12d4',
  ]) {
    assert.equal(
      DRIVER_PRESETS.some((d) => d.id === removedId),
      false,
      `Removed preset ${removedId} should not remain`,
    );
  }

  for (const tpl of BOX_TEMPLATE_PRESETS) {
    const res = calculateAcoustics({ ...DEFAULT_BOX_PARAMS, ...tpl.params });
    const errors = res.issues.filter((i) => i.severity === 'error');
    assert.equal(errors.length, 0, `Template ${tpl.id} has geometry errors: ${errors.map((e) => e.message).join('; ')}`);
    assert.ok(res.netVolumeL > 0, `Template ${tpl.id} netVolumeL=${res.netVolumeL}`);
  }
});

test('Electrical load solver computes exact series, parallel, and 2S2P impedances for DVC and SVC arrays', () => {
  const mf12r = DRIVER_PRESETS.find((d) => d.id === 'deaf-bonce-mf12r-d2')!;

  const singleParallel = computeElectricalLoad({
    voiceCoilCount: mf12r.voiceCoilCount!,
    coilNominalOhms: mf12r.coilNominalOhms!,
    coilReOhms: mf12r.coilReOhms!,
    baseLeMh: mf12r.le ?? 2.2,
    coilWiring: 'parallel',
    driverCount: 1,
    arrayWiring: 'parallel',
  });
  assert.equal(singleParallel.totalNominalOhms, 1);

  const singleSeries = computeElectricalLoad({
    voiceCoilCount: mf12r.voiceCoilCount!,
    coilNominalOhms: mf12r.coilNominalOhms!,
    coilReOhms: mf12r.coilReOhms!,
    baseLeMh: mf12r.le ?? 2.2,
    coilWiring: 'series',
    driverCount: 1,
    arrayWiring: 'parallel',
  });
  assert.equal(singleSeries.totalNominalOhms, 4);

  const quad2s2p = computeElectricalLoad({
    voiceCoilCount: 2,
    coilNominalOhms: 2,
    coilReOhms: 1.8,
    baseLeMh: 2.2,
    coilWiring: 'parallel',
    driverCount: 4,
    arrayWiring: 'series_parallel',
  });
  assert.equal(quad2s2p.totalNominalOhms, 1);

  const d4Series = computeElectricalLoad({
    voiceCoilCount: 2,
    coilNominalOhms: 4,
    coilReOhms: 3.5,
    baseLeMh: 2.1,
    coilWiring: 'series',
    driverCount: 1,
    arrayWiring: 'parallel',
  });
  assert.equal(d4Series.totalNominalOhms, 8);
});
