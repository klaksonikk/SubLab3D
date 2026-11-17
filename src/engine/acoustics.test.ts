import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAcoustics,
  calculateHelmholtzFb,
  computeDriverGridLayout,
  computeSlotPortGeometry,
} from './acoustics';
import { generateCutList, optimizeCutSheet } from './cutlist';
import { DEFAULT_BOX_PARAMS } from './presets';
import { buildShareUrl, decodeModelToken, encodeModelToken } from './sharing';
import type { DriverPreset } from './types';

test('internal dimensions subtract double material thickness accurately', () => {
  const res = calculateAcoustics(DEFAULT_BOX_PARAMS);
  assert.equal(res.internalWidth, 680 - 36);
  assert.equal(res.internalHeight, 380 - 36);
  assert.equal(res.internalDepth, 420 - 36);
  assert.ok(res.grossVolumeL > res.netVolumeL);
  assert.ok(res.netVolumeL > 30 && res.netVolumeL < 90);
});

test('Helmholtz Fb decreases when port length increases or net volume increases', () => {
  const fbShort = calculateHelmholtzFb(50, 150, 300, 1.85);
  const fbLong = calculateHelmholtzFb(50, 150, 600, 1.85);
  const fbLargeBox = calculateHelmholtzFb(80, 150, 300, 1.85);

  assert.ok(fbShort > fbLong, 'Longer port must lower Fb');
  assert.ok(fbShort > fbLargeBox, 'Larger box volume must lower Fb');
  assert.ok(fbShort > 25 && fbShort < 60);
});

test('slot port automatically folds into L-shape when length exceeds depth clearance', () => {
  const straight = computeSlotPortGeometry(644, 344, 384, 18, 52, 344, 240, 18, 300);
  assert.equal(straight.isBent, false);
  assert.equal(straight.baffle2Length, 0);

  const bent = computeSlotPortGeometry(644, 344, 384, 18, 52, 344, 540, 18, 300);
  assert.equal(bent.isBent, true);
  assert.ok(bent.baffle1Length > 200);
  assert.ok(bent.baffle2Length > 50);
  assert.equal(bent.fitsInside, true);
});

test('sealed enclosure computes Qtc, Fc, and has zero port area', () => {
  const res = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'sealed',
    externalWidth: 380,
    externalHeight: 340,
    externalDepth: 310,
  });
  assert.equal(res.tuningHz, null);
  assert.equal(res.portAreaCm2, 0);
  assert.ok(res.sealedQtc !== null && res.sealedQtc > 0.5 && res.sealedQtc < 1.2);
  assert.ok(res.sealedFcHz !== null && res.sealedFcHz > DEFAULT_BOX_PARAMS.driverFs);
  assert.equal(res.responseCurve.length, 136);
});

test('4th-order bandpass splits net volume into sealed rear and vented front chambers', () => {
  const res = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'bandpass_4th',
    externalWidth: 740,
    externalHeight: 400,
    externalDepth: 480,
    portLength: 260,
  });
  assert.ok(res.sealedChamberNetL > 10);
  assert.ok(res.ventedChamberNetL > 10);
  assert.ok(res.tuningHz !== null && res.tuningHz > 30);
  assert.ok(res.f3HighHz !== null && res.f3HighHz > res.f3LowHz);
});

test('6th-order bandpass computes dual-chamber tunings and rear+front port baffles in cut-list', () => {
  const bp6Params = {
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'bandpass_6th' as const,
    externalWidth: 840,
    externalHeight: 410,
    externalDepth: 490,
    portWidth: 64,
    portLength: 220,
    portRearWidth: 48,
    portRearLength: 480,
    bandpassFrontRatio: 0.45,
  };
  const res = calculateAcoustics(bp6Params);
  assert.ok(res.rearPortTuningHz !== null && res.rearPortTuningHz > 20);
  assert.ok(res.tuningHz !== null && res.tuningHz > res.rearPortTuningHz!);
  assert.ok(res.rearPortAreaCm2 > 100);
  assert.ok(res.rearSlotPort !== null);

  const panels = generateCutList(bp6Params, res);
  assert.ok(panels.some((p) => p.id === 'rear-port-1'));
  assert.ok(panels.some((p) => p.id === 'port-1'));
  assert.ok(panels.some((p) => p.id === 'bandpass-divider'));
});

test('driver layout supports up to 6 drivers in a 2x3 grid and scales displacement', () => {
  const layout = computeDriverGridLayout(6, 800, 480, 212);
  assert.equal(layout.positions.length, 6);
  assert.equal(layout.fits, true);

  const res = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    externalWidth: 960,
    externalHeight: 500,
    externalDepth: 460,
    driverCount: 6,
    driverCutoutDia: 184,
    driverOuterDia: 212,
    driverDepth: 108,
    driverDisplacement: 1.1,
  });
  assert.equal(res.driverLayout.length, 6);
  assert.ok(Math.abs(res.totalDriverDisplacementL - 6.6) < 0.01);
  assert.equal(res.driverFitsFront, true);
});

test('model sharing URL round-trip preserves BoxParams and custom driver', () => {
  const customDriver: DriverPreset = {
    id: 'custom-test-1',
    name: 'Mój Głośnik 12" Pro',
    sizeLabel: '12"',
    isCustom: true,
    cutoutDia: 280,
    outerDia: 315,
    depth: 175,
    displacement: 3.1,
    fs: 29,
    qts: 0.39,
    vas: 48,
    xmax: 18,
    powerW: 900,
  };
  const params = {
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'bandpass_6th' as const,
    driverCount: 4 as const,
    driverPresetId: customDriver.id,
  };

  const token = encodeModelToken(params, customDriver);
  const decoded = decodeModelToken(token);
  assert.ok(decoded !== null);
  assert.equal(decoded!.params.enclosureType, 'bandpass_6th');
  assert.equal(decoded!.params.driverCount, 4);
  assert.equal(decoded!.customDriver?.name, 'Mój Głośnik 12" Pro');

  const url = buildShareUrl('https://example.com/', params, customDriver);
  const parsedUrl = new URL(url);
  const fromQuery = decodeModelToken(parsedUrl.searchParams.get('model') || '');
  assert.equal(fromQuery?.params.driverCount, 4);
});

test('cut-list accounts for joinery overlaps and packs cleanly onto sheets', () => {
  const acoustics = calculateAcoustics(DEFAULT_BOX_PARAMS);
  const panels = generateCutList(DEFAULT_BOX_PARAMS, acoustics);

  const topBottom = panels.find((p) => p.id === 'top-bottom');
  const sides = panels.find((p) => p.id === 'sides');
  const front = panels.find((p) => p.id === 'front');

  assert.ok(topBottom && sides && front);
  assert.equal(topBottom.width, 680);
  assert.equal(topBottom.height, 420);
  assert.equal(sides.width, 420);
  assert.equal(sides.height, 380 - 36);
  assert.equal(front.width, 680 - 36);
  assert.equal(front.height, 380 - 36);

  const sheetSummary = optimizeCutSheet(DEFAULT_BOX_PARAMS, panels);
  assert.equal(sheetSummary.unplacedPanels.length, 0);
  assert.equal(sheetSummary.sheetCount, 1);
  assert.ok(sheetSummary.utilizationPercent > 15 && sheetSummary.utilizationPercent <= 100);
});

test('driverFace=top measures clearance vertically and splits Top/Bottom in cut-list', () => {
  const params = {
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'vented_round' as const,
    driverFace: 'top' as const,
    portFace: 'side_right' as const,
    doubleFrontBaffle: true,
    externalWidth: 680,
    externalHeight: 360,
    externalDepth: 620,
    thickness: 18,
    driverCount: 5 as const,
    driverCutoutDia: 184,
    driverOuterDia: 212,
    driverDepth: 108,
    portDiameter: 150,
    portCount: 1 as const,
    portLength: 260,
  };

  const res = calculateAcoustics(params);
  assert.equal(res.internalHeight, 360 - 18 - 36);
  assert.equal(res.driverClearanceMm, 360 - 18 - 108);
  assert.equal(res.driverFitsFront, true);
  assert.equal(res.driverLayout.length, 5);

  const panels = generateCutList(params, res);
  assert.ok(panels.some((p) => p.id === 'top'));
  assert.ok(panels.some((p) => p.id === 'top-double'));
  assert.ok(panels.some((p) => p.id === 'bottom'));
  const sideRight = panels.find((p) => p.id === 'side-right');
  assert.ok(sideRight && sideRight.notes.includes('rura'));
});

test('staggered multi-driver layouts (3, 4, 5, 6) have zero overlap and fit inside baffle', () => {
  const outerDia = 212;
  for (const count of [3, 4, 5, 6] as const) {
    const layout = computeDriverGridLayout(count, 760, 560, outerDia, 'staggered');
    assert.equal(layout.positions.length, count);
    assert.equal(layout.fits, true, `Expected count=${count} staggered to fit`);

    for (let i = 0; i < layout.positions.length; i++) {
      for (let j = i + 1; j < layout.positions.length; j++) {
        const dist = Math.hypot(
          layout.positions[i].x - layout.positions[j].x,
          layout.positions[i].y - layout.positions[j].y,
        );
        assert.ok(dist >= outerDia + 6, `Drivers ${i} & ${j} overlapped for count=${count}: ${dist}`);
      }
    }
  }
});

test('round port depth validation adapts to portFace axis (top vs side)', () => {
  const tooLongForTop = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'vented_round',
    portFace: 'top',
    externalWidth: 700,
    externalHeight: 300,
    externalDepth: 500,
    portLength: 280,
  });
  assert.ok(tooLongForTop.issues.some((i) => i.id === 'round-port-fit'));

  const fitsOnSide = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'vented_round',
    portFace: 'side_left',
    externalWidth: 700,
    externalHeight: 300,
    externalDepth: 500,
    portLength: 280,
  });
  assert.ok(!fitsOnSide.issues.some((i) => i.id === 'round-port-fit'));
});

test('driverOffsetX and portOffsetX reposition speakers & aero ports and detect collisions', () => {
  // Move round port to left side and move driver to right side -> valid swap!
  const swapped = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'vented_round',
    portFace: 'front',
    portDiameter: 110,
    portCount: 1,
    portLength: 260,
    portOffsetX: -480,
    driverOffsetX: 180,
  });
  assert.ok(swapped.roundPortLayout[0].x < -150);
  assert.ok(swapped.driverLayout[0].x > 50);
  assert.equal(swapped.driverFitsFront, true);

  // Move driver right into the default right-side aero port -> collision error
  const colliding = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'vented_round',
    portFace: 'front',
    portDiameter: 110,
    portCount: 1,
    portLength: 260,
    portOffsetX: 0,
    driverOffsetX: 180,
  });
  assert.equal(colliding.driverFitsFront, false);
  assert.ok(colliding.issues.some((i) => i.id === 'driver-port-collision'));
});

test('slot port supports left and bottom placement with updated cut-list and clearance', () => {
  const leftSlot = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'vented_slot',
    portSlotSide: 'left',
  });
  assert.ok(leftSlot.driverLayout[0].x > 0, 'Driver should shift right when slot port is on left');
  assert.equal(leftSlot.driverFitsFront, true);

  const bottomSlotParams = {
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'vented_slot' as const,
    portSlotSide: 'bottom' as const,
    externalWidth: 680,
    externalHeight: 460,
    externalDepth: 420,
    portWidth: 50,
    portLength: 420,
  };
  const bottomSlot = calculateAcoustics(bottomSlotParams);
  assert.ok(bottomSlot.driverLayout[0].y > 0, 'Driver should shift up above bottom slot port');
  assert.equal(bottomSlot.driverFitsFront, true);
  assert.equal(bottomSlot.effectivePortHeight, bottomSlot.internalWidth);

  const panels = generateCutList(bottomSlotParams, bottomSlot);
  assert.ok(panels.some((p) => p.id === 'port-1' && p.name.includes('Pozioma')));
});

test('coupled boxAutoCalcField=depth and portControlMode=tuning hit exact target Vnet, Fb, and Port Area', () => {
  const res = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'vented_slot',
    boxAutoCalcField: 'depth',
    externalWidth: 850,
    externalHeight: 370,
    thickness: 18,
    targetNetVolumeL: 55,
    portControlMode: 'tuning',
    targetTuningHz: 30,
    targetPortAreaCm2: 200,
  });

  assert.ok(Math.abs(res.netVolumeL - 55) < 0.05, `Expected netVolumeL ~55, got ${res.netVolumeL}`);
  assert.ok(res.tuningHz !== null && Math.abs(res.tuningHz - 30) < 0.1, `Expected tuningHz ~30, got ${res.tuningHz}`);
  assert.ok(Math.abs(res.portAreaCm2 - 200) < 0.5, `Expected portArea ~200, got ${res.portAreaCm2}`);
  assert.ok(res.effectiveExternalDepth > 250 && res.effectiveExternalDepth < 600);
  assert.ok(res.effectivePortLength > 700 && res.effectivePortLength < 1400);
  assert.ok(res.portTotalDisplacementL > 15 && res.portTotalDisplacementL < 40);

  const panels = generateCutList(
    {
      ...DEFAULT_BOX_PARAMS,
      enclosureType: 'vented_slot',
      boxAutoCalcField: 'depth',
      externalWidth: 850,
      externalHeight: 370,
      thickness: 18,
      targetNetVolumeL: 55,
      portControlMode: 'tuning',
      targetTuningHz: 30,
      targetPortAreaCm2: 200,
    },
    res,
  );
  const topBottom = panels.find((p) => p.id === 'top-bottom');
  assert.ok(topBottom && Math.abs(topBottom.height - Math.round(res.effectiveExternalDepth)) <= 1);
});

test('boxAutoCalcField solves width and height from targetNetVolumeL', () => {
  const autoW = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    boxAutoCalcField: 'width',
    externalHeight: 400,
    externalDepth: 420,
    targetNetVolumeL: 65,
  });
  assert.ok(Math.abs(autoW.netVolumeL - 65) < 0.05);
  assert.ok(autoW.effectiveExternalWidth > 500);

  const autoH = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    boxAutoCalcField: 'height',
    externalWidth: 720,
    externalDepth: 420,
    targetNetVolumeL: 60,
  });
  assert.ok(Math.abs(autoH.netVolumeL - 60) < 0.05);
  assert.ok(autoH.effectiveExternalHeight > 300);
});

test('vented_round solves pipe diameter in area_from_length mode and flags unreachable Fb', () => {
  const solvedRound = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'vented_round',
    portCount: 2,
    portControlMode: 'area_from_length',
    targetTuningHz: 36,
    portLength: 280,
  });
  assert.ok(solvedRound.tuningHz !== null && Math.abs(solvedRound.tuningHz - 36) < 0.15);
  assert.ok(solvedRound.effectivePortDiameter > 50 && solvedRound.effectivePortDiameter < 200);

  const unreachable = calculateAcoustics({
    ...DEFAULT_BOX_PARAMS,
    enclosureType: 'vented_round',
    portControlMode: 'tuning',
    targetTuningHz: 11,
    targetPortAreaCm2: 450,
  });
  assert.ok(unreachable.issues.some((i) => i.id === 'target-fb-unreachable'));
});



