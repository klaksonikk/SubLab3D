import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAcoustics } from './acoustics';
import { DEFAULT_BOX_PARAMS, DRIVER_PRESETS } from './presets';
import {
  computeDerivedDriverMetrics,
  computeDriverAlignments,
  computePortPhysicalStats,
  createLiveProjectVariant,
  simulateEnclosureSeries,
  type ComparisonVariant,
  type SignalChainConfig,
} from './simulator';

const BASE_SIGNAL: SignalChainConfig = {
  powerW: 600,
  reOhms: 2.0,
  leMh: 1.4,
  hpfType: 'none',
  hpfHz: 25,
  lpfType: 'none',
  lpfHz: 90,
  cabinGain: false,
};

test('vented simulation extends F3 lower than equal-sized sealed box and notches cone excursion at Fb', () => {
  const sealedVar: ComparisonVariant = {
    id: 'v-sealed',
    name: 'Zamknięta 55L',
    color: '#22d3ee',
    visible: true,
    enclosureType: 'sealed',
    netVolumeL: 55,
    tuningHz: 34,
    portAreaCm2: 0,
  };
  const ventedVar: ComparisonVariant = {
    id: 'v-vented',
    name: 'Bass-Reflex 55L @ 34Hz',
    color: '#f59e0b',
    visible: true,
    enclosureType: 'vented_slot',
    netVolumeL: 55,
    tuningHz: 34,
    portAreaCm2: 180,
  };

  const sealed = simulateEnclosureSeries(sealedVar, DEFAULT_BOX_PARAMS, BASE_SIGNAL);
  const vented = simulateEnclosureSeries(ventedVar, DEFAULT_BOX_PARAMS, BASE_SIGNAL);

  assert.equal(sealed.points.length, 191); // 10..200 Hz
  assert.ok(vented.f3LowHz < sealed.f3LowHz, `Expected vented F3 (${vented.f3LowHz}) < sealed F3 (${sealed.f3LowHz})`);

  // Cone excursion at Fb (34 Hz) must be significantly smaller than at 20 Hz subsonic unloading
  const excAtFb = vented.points.find((p) => p.hz === 34)!.excursionMm;
  const excAt20 = vented.points.find((p) => p.hz === 20)!.excursionMm;
  assert.ok(excAtFb < excAt20 * 0.5, `Expected excursion notch at Fb (${excAtFb}) < 0.5*exc20 (${excAt20})`);

  // Port velocity should peak near Fb
  assert.ok(vented.peakPortVelocityMs > 5);
  assert.equal(sealed.peakPortVelocityMs, 0);

  // Vented group delay near Fb is higher than sealed box group delay
  assert.ok(vented.peakGroupDelayMs > sealed.peakGroupDelayMs);
});

test('Subsonic HPF suppresses sub-22Hz cone excursion and Cabin Gain boosts sub-50Hz SPL', () => {
  const ventedVar: ComparisonVariant = {
    id: 'v-vented',
    name: 'Bass-Reflex',
    color: '#f59e0b',
    visible: true,
    enclosureType: 'vented_slot',
    netVolumeL: 55,
    tuningHz: 34,
    portAreaCm2: 180,
  };

  const unfiltered = simulateEnclosureSeries(ventedVar, DEFAULT_BOX_PARAMS, BASE_SIGNAL);
  const filtered = simulateEnclosureSeries(ventedVar, DEFAULT_BOX_PARAMS, {
    ...BASE_SIGNAL,
    hpfType: 'lr24',
    hpfHz: 28,
  });

  const excRaw18 = unfiltered.points.find((p) => p.hz === 18)!.excursionMm;
  const excHpf18 = filtered.points.find((p) => p.hz === 18)!.excursionMm;
  assert.ok(excHpf18 < excRaw18 * 0.5, `HPF should cut 18Hz excursion (${excHpf18} vs ${excRaw18})`);

  const withCabin = simulateEnclosureSeries(ventedVar, DEFAULT_BOX_PARAMS, {
    ...BASE_SIGNAL,
    cabinGain: true,
  });
  const splRaw30 = unfiltered.points.find((p) => p.hz === 30)!.splDb;
  const splCabin30 = withCabin.points.find((p) => p.hz === 30)!.splDb;
  assert.ok(splCabin30 > splRaw30 + 5, `Cabin gain should boost 30Hz SPL (${splCabin30} vs ${splRaw30})`);
});

test('electrical impedance has dual-saddle minimum near Fb for vented and single peak for sealed', () => {
  const sealedVar: ComparisonVariant = {
    id: 's',
    name: 'Sealed',
    color: '#fff',
    visible: true,
    enclosureType: 'sealed',
    netVolumeL: 35,
    tuningHz: 35,
    portAreaCm2: 0,
  };
  const ventedVar: ComparisonVariant = {
    id: 'v',
    name: 'Vented',
    color: '#fff',
    visible: true,
    enclosureType: 'vented_slot',
    netVolumeL: 60,
    tuningHz: 35,
    portAreaCm2: 180,
  };

  const sealed = simulateEnclosureSeries(sealedVar, DEFAULT_BOX_PARAMS, BASE_SIGNAL);
  const vented = simulateEnclosureSeries(ventedVar, DEFAULT_BOX_PARAMS, BASE_SIGNAL);

  assert.ok(sealed.minImpedanceOhms >= BASE_SIGNAL.reOhms * 0.95);
  assert.ok(vented.minImpedanceOhms >= BASE_SIGNAL.reOhms * 0.95);

  const zAt24 = vented.points.find((p) => p.hz === 24)!.impedanceOhms;
  const zAt35 = vented.points.find((p) => p.hz === 35)!.impedanceOhms;
  const zAt55 = vented.points.find((p) => p.hz === 55)!.impedanceOhms;
  assert.ok(zAt35 < zAt24 && zAt35 < zAt55, `Expected impedance dip around Fb=35Hz (${zAt24} / ${zAt35} / ${zAt55})`);
});

test('computeDriverAlignments calculates EBP and 6 actionable enclosure presets including Chebyshev C2 and C4', () => {
  const res = computeDriverAlignments(DEFAULT_BOX_PARAMS);
  assert.ok(res.ebpHz > 40 && res.ebpHz < 120);
  assert.equal(res.suggestions.length, 6);
  for (const s of res.suggestions) {
    assert.ok(s.netVolumeL > 8 && Number.isFinite(s.netVolumeL));
  }

  const chebSealed = res.suggestions.find((s) => s.id === 'align-sealed-cheb');
  const chebBr = res.suggestions.find((s) => s.id === 'align-br-cheb');
  assert.ok(chebSealed && chebSealed.qtc && chebSealed.qtc >= 0.9);
  assert.ok(chebBr && chebBr.tuningHz !== null && chebBr.portAreaCm2 > 50);

  // Verify Chebyshev C4 exhibits slight positive passband ripple (~0.3 to 1.4 dB)
  const chebSim = simulateEnclosureSeries(
    {
      id: 'cheb-c4-test',
      name: 'Chebyshev C4',
      color: '#ef4444',
      visible: true,
      enclosureType: chebBr!.enclosureType,
      netVolumeL: chebBr!.netVolumeL,
      tuningHz: chebBr!.tuningHz!,
      portAreaCm2: chebBr!.portAreaCm2,
      ql: 7,
      qa: 100,
    },
    DEFAULT_BOX_PARAMS,
    BASE_SIGNAL,
    DRIVER_PRESETS,
    200,
  );
  const chebPeakDb = Math.max(...chebSim.points.map((p) => p.transferBoxDb));
  assert.ok(chebPeakDb > 0.25 && chebPeakDb < 1.5, `Expected C4 ripple peak in +0.25..+1.5 dB, got ${chebPeakDb}`);

  // Verify Chebyshev 24 dB LPF gives steeper attenuation at 200 Hz than BW 12 dB
  const bw12 = simulateEnclosureSeries(
    { ...createLiveProjectVariant(DEFAULT_BOX_PARAMS) },
    DEFAULT_BOX_PARAMS,
    { ...BASE_SIGNAL, lpfType: 'bw12', lpfHz: 80 },
    DRIVER_PRESETS,
    200,
  );
  const cheb24 = simulateEnclosureSeries(
    { ...createLiveProjectVariant(DEFAULT_BOX_PARAMS) },
    DEFAULT_BOX_PARAMS,
    { ...BASE_SIGNAL, lpfType: 'cheb24', lpfHz: 80 },
    DRIVER_PRESETS,
    200,
  );
  const bw200 = bw12.points.find((p) => p.hz === 200)!.transferDb;
  const cheb200 = cheb24.points.find((p) => p.hz === 200)!.transferDb;
  assert.ok(cheb200 < bw200 - 12, `Expected Cheb 24 dB steeper attenuation at 200 Hz (${cheb200} vs ${bw200})`);

  const live = createLiveProjectVariant(DEFAULT_BOX_PARAMS);
  assert.equal(live.isLiveProject, true);
  assert.ok(live.netVolumeL > 30);
});

test('Subbox.pro reference check (850x370mm, 18mm, 55L net, Fb 30Hz, 200cm2) matches geometry & Helmholtz physics', () => {
  const subboxMatch = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'vented_slot',
    boxAutoCalcField: 'depth',
    externalWidth: 850,
    externalHeight: 370,
    thickness: 18,
    doubleFrontBaffle: false,
    driverDisplacement: 2.5,
    bracingVolumeL: 0,
    targetNetVolumeL: 55,
    portControlMode: 'tuning',
    targetTuningHz: 30,
    targetPortAreaCm2: 200,
  });

  // Subbox.pro screenshot reference: Depth* = 348.0 mm, Total Vol* = 84.82 L, Port Length* = 1040.4 mm, Port Disp* = 27.32 L
  assert.ok(Math.abs(subboxMatch.effectiveExternalDepth - 348) < 4, `Depth=${subboxMatch.effectiveExternalDepth}`);
  assert.ok(Math.abs(subboxMatch.grossVolumeL - 84.82) < 1.5, `Gross=${subboxMatch.grossVolumeL}`);
  assert.ok(Math.abs(subboxMatch.effectivePortLength - 1040.4) < 25, `PortLen=${subboxMatch.effectivePortLength}`);
  assert.ok(Math.abs(subboxMatch.portTotalDisplacementL - 27.32) < 1.5, `PortDisp=${subboxMatch.portTotalDisplacementL}`);
  assert.ok(Math.abs(subboxMatch.netVolumeL - 55) < 0.05);
  assert.ok(subboxMatch.tuningHz !== null && Math.abs(subboxMatch.tuningHz - 30) < 0.1);
});

test('WSD Max SPL limits sub-Fb excursion, PEQ & Linkwitz Transform boost low-end, and port resonance computes cleanly', () => {
  const sealedVar: ComparisonVariant = {
    id: 'wsd-sealed',
    name: 'Sealed',
    color: '#38bdf8',
    visible: true,
    enclosureType: 'sealed',
    netVolumeL: 32,
    tuningHz: 35,
    portAreaCm2: 0,
  };

  const base = simulateEnclosureSeries(sealedVar, DEFAULT_BOX_PARAMS, BASE_SIGNAL, DRIVER_PRESETS, 500);
  assert.equal(base.points.length, 491); // 10..500 Hz

  const withEq = simulateEnclosureSeries(
    sealedVar,
    DEFAULT_BOX_PARAMS,
    {
      ...BASE_SIGNAL,
      peqEnabled: true,
      peqHz: 40,
      peqGainDb: 6,
      peqQ: 2,
      ltEnabled: true,
      ltF0Hz: 50,
      ltQ0: 0.85,
      ltFpHz: 28,
      ltQp: 0.707,
    },
    DRIVER_PRESETS,
    500,
  );

  const base28 = base.points.find((p) => p.hz === 28)!.transferDb;
  const eq28 = withEq.points.find((p) => p.hz === 28)!.transferDb;
  assert.ok(eq28 > base28 + 5, `Expected Linkwitz + PEQ boost at 28 Hz (${eq28} vs ${base28})`);

  // Max SPL at 15 Hz must be excursion-limited compared to 60 Hz passband
  const maxSpl15 = base.points.find((p) => p.hz === 15)!.maxSplDb;
  const maxSpl60 = base.points.find((p) => p.hz === 60)!.maxSplDb;
  assert.ok(maxSpl15 < maxSpl60 - 6, `Max SPL at 15 Hz (${maxSpl15}) should be Xmax-limited vs 60 Hz (${maxSpl60})`);

  const portStats = computePortPhysicalStats(60, 32, 180);
  assert.ok(portStats !== null && portStats.lengthMm > 200 && portStats.firstResonanceHz > 100);

  // Two 100mm round ports (area ~157.1 cm2) require longer physical pipe length than one equiv 141.4mm port
  const twoPipes = computePortPhysicalStats(60, 34, 157.1, true, 343.2, 100);
  const oneEquiv = computePortPhysicalStats(60, 34, 157.1, true, 343.2);
  assert.ok(twoPipes !== null && oneEquiv !== null);
  assert.ok(twoPipes.lengthMm > oneEquiv.lengthMm + 15, `Expected 2x100mm longer than 1x141mm (${twoPipes.lengthMm} vs ${oneEquiv.lengthMm})`);
  assert.equal(twoPipes.equivalentRoundDiaMm, 141);

  const metrics = computeDerivedDriverMetrics(DEFAULT_BOX_PARAMS, 2.0);
  assert.ok(metrics.sdCm2 > 300 && metrics.vdCm3 > 400 && metrics.spl1w1m > 82);
});

test('DVC coil wiring (parallel vs series) scales simulated electrical impedance cleanly', () => {
  const parallelVar: ComparisonVariant = {
    id: 'v-d2-par',
    name: 'D2 Parallel',
    color: '#ef4444',
    visible: true,
    enclosureType: 'vented_slot',
    netVolumeL: 58,
    tuningHz: 33,
    portAreaCm2: 195,
    driverPresetId: 'deaf-bonce-mf12r-d2',
    driverCount: 1,
    voiceCoilCount: 2,
    coilNominalOhms: 2,
    coilReOhms: 1.9,
    coilWiring: 'parallel',
    wiring: 'parallel',
  };
  const seriesVar: ComparisonVariant = {
    ...parallelVar,
    id: 'v-d2-ser',
    name: 'D2 Series',
    coilWiring: 'series',
  };

  const parRes = simulateEnclosureSeries(parallelVar, DEFAULT_BOX_PARAMS, BASE_SIGNAL);
  const serRes = simulateEnclosureSeries(seriesVar, DEFAULT_BOX_PARAMS, BASE_SIGNAL);

  // Series Re = 3.8 Ohm vs Parallel Re = 0.95 Ohm -> minZ scales ~4x
  assert.ok(parRes.minImpedanceOhms >= 0.9 && parRes.minImpedanceOhms < 1.5);
  assert.ok(serRes.minImpedanceOhms >= 3.6 && serRes.minImpedanceOhms < 5.0);
  assert.ok(serRes.minImpedanceOhms > parRes.minImpedanceOhms * 3.5);
});

