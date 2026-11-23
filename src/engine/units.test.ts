import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatArea,
  formatLen,
  formatVel,
  formatVol,
  fromDisplayAirDensity,
  fromDisplayArea,
  fromDisplayLen,
  fromDisplayMassG,
  fromDisplayVel,
  fromDisplayVol,
  getUnitLabels,
  toDisplayAirDensity,
  toDisplayArea,
  toDisplayAreaPerVol,
  toDisplayBoardArea,
  toDisplayLen,
  toDisplayMassG,
  toDisplaySmallVol,
  toDisplayVel,
  toDisplayVol,
  toDisplayWeightKg,
} from './units';

test('metric and imperial scalar conversions round-trip accurately', () => {
  assert.ok(Math.abs(toDisplayLen(254, 'imperial') - 10) < 1e-9);
  assert.ok(Math.abs(fromDisplayLen(10, 'imperial') - 254) < 1e-9);
  assert.equal(toDisplayLen(680, 'metric'), 680);

  const cuFt = toDisplayVol(56.633693184, 'imperial');
  assert.ok(Math.abs(cuFt - 2) < 1e-6);
  assert.ok(Math.abs(fromDisplayVol(cuFt, 'imperial') - 56.633693184) < 1e-6);

  const sqIn = toDisplayArea(64.516, 'imperial');
  assert.ok(Math.abs(sqIn - 10) < 1e-6);
  assert.ok(Math.abs(fromDisplayArea(sqIn, 'imperial') - 64.516) < 1e-6);

  const fts = toDisplayVel(30.48, 'imperial');
  assert.ok(Math.abs(fts - 100) < 1e-6);
  assert.ok(Math.abs(fromDisplayVel(fts, 'imperial') - 30.48) < 1e-6);

  const oz = toDisplayMassG(283.49523125, 'imperial');
  assert.ok(Math.abs(oz - 10) < 1e-6);
  assert.ok(Math.abs(fromDisplayMassG(oz, 'imperial') - 283.49523125) < 1e-6);

  const rhoImp = toDisplayAirDensity(1.204, 'imperial');
  assert.ok(Math.abs(fromDisplayAirDensity(rhoImp, 'imperial') - 1.204) < 1e-6);
});

test('derived display conversions and formatters match physical ratios', () => {
  assert.ok(Math.abs(toDisplayBoardArea(1, 'imperial') - 10.76391) < 1e-4);
  assert.ok(Math.abs(toDisplaySmallVol(163.87064, 'imperial') - 10) < 1e-5);
  assert.ok(Math.abs(toDisplayWeightKg(10, 'imperial') - 22.0462) < 1e-3);
  assert.ok(Math.abs(toDisplayAreaPerVol(10, 'imperial') - 43.8912) < 1e-2);

  assert.equal(formatLen(25.4, 'imperial', 0, 2), '1.00 in');
  assert.equal(formatLen(680, 'metric', 0, 2), '680 mm');
  assert.equal(formatVol(28.316846592, 'imperial', 1, 2), '1.00 ft³');
  assert.equal(formatArea(64.516, 'imperial', 0, 1), '10.0 in²');
  assert.equal(formatVel(17, 'imperial', 1, 1), '55.8 ft/s');

  const mLabels = getUnitLabels('metric');
  const iLabels = getUnitLabels('imperial');
  assert.equal(mLabels.vol, 'L');
  assert.equal(iLabels.vol, 'ft³');
  assert.equal(iLabels.vel, 'ft/s');
});
