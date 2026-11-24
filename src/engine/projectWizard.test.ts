import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAcoustics } from './acoustics';
import { DRIVER_PRESETS } from './presets';
import {
  buildWizardProjectParams,
  buildWizardTemplatePreset,
  getWizardTemplateDefaultName,
  SUBWOOFER_APPLICATION_SPECS,
  type SubwooferApplication,
} from './projectWizard';
import type { DriverPreset } from './types';

const CUSTOM_15_DRIVER: DriverPreset = {
  id: 'custom-15-test',
  name: 'Sundown Audio X-15 v3',
  sizeLabel: '15" (38 cm)',
  source: 'Custom T-S',
  isCustom: true,
  cutoutDia: 354,
  outerDia: 394,
  depth: 235,
  displacement: 5.8,
  fs: 28.5,
  qts: 0.44,
  qes: 0.49,
  qms: 4.8,
  vas: 52.0,
  xmax: 28,
  powerW: 2000,
  voiceCoilCount: 2,
  coilNominalOhms: 2,
  coilReOhms: 1.7,
  le: 2.9,
  sd: 780,
};

test('wizard generates error-free enclosures across all 4 subwoofer applications', () => {
  const driver = DRIVER_PRESETS[0];
  const apps: SubwooferApplication[] = SUBWOOFER_APPLICATION_SPECS.map((s) => s.id);
  assert.equal(apps.length, 4);

  for (const app of apps) {
    const params = buildWizardProjectParams(
      {
        application: app,
        driver,
        driverCount: 1,
        enclosureType: 'recommended',
        sizePriority: 'balanced',
      },
      'en',
    );
    const res = calculateAcoustics(params, 'en', 'metric');
    const errors = res.issues.filter((i) => i.severity === 'error');
    assert.equal(errors.length, 0, `Expected 0 errors for ${app}, got: ${JSON.stringify(errors)}`);
    assert.ok(res.netVolumeL > 15, `Expected positive net volume for ${app}`);
    assert.ok(res.driverClearanceMm >= 20, `Expected sufficient magnet clearance for ${app}`);
  }
});

test('SPL wizard produces higher tuning and larger port area than Car Daily application', () => {
  const driver = DRIVER_PRESETS[0];

  const daily = buildWizardProjectParams({
    application: 'car_daily',
    driver,
    driverCount: 1,
    enclosureType: 'vented_slot',
    sizePriority: 'balanced',
  });
  const spl = buildWizardProjectParams({
    application: 'car_spl',
    driver,
    driverCount: 1,
    enclosureType: 'vented_slot',
    sizePriority: 'balanced',
  });

  const dailyRes = calculateAcoustics(daily);
  const splRes = calculateAcoustics(spl);

  assert.ok(dailyRes.tuningHz !== null && splRes.tuningHz !== null);
  assert.ok(
    dailyRes.tuningHz! < splRes.tuningHz!,
    `Daily Fb (${dailyRes.tuningHz}) must be lower than SPL Fb (${splRes.tuningHz})`,
  );
  assert.ok(
    splRes.portAreaCm2 >= dailyRes.portAreaCm2,
    'SPL port area must be at least as generous as Car Daily for high-output airflow',
  );
});

test('wizard honors custom driver T-S specs, multi-driver counts, and bandpass topologies', () => {
  const dualCustom = buildWizardProjectParams({
    application: 'car_daily',
    driver: CUSTOM_15_DRIVER,
    driverCount: 2,
    enclosureType: 'vented_slot',
    sizePriority: 'balanced',
  });

  assert.equal(dualCustom.driverPresetId, CUSTOM_15_DRIVER.id);
  assert.equal(dualCustom.driverName, CUSTOM_15_DRIVER.name);
  assert.equal(dualCustom.driverCount, 2);
  assert.equal(dualCustom.driverCutoutDia, CUSTOM_15_DRIVER.cutoutDia);

  const dualRes = calculateAcoustics(dualCustom);
  assert.equal(
    dualRes.issues.filter((i) => i.severity === 'error').length,
    0,
    `Dual 15" custom build should have 0 errors: ${JSON.stringify(dualRes.issues)}`,
  );
  assert.equal(dualRes.driverLayout.length, 2);
  assert.ok(dualRes.driverFitsFront);

  const bp4 = buildWizardProjectParams({
    application: 'car_spl',
    driver: DRIVER_PRESETS[0],
    driverCount: 1,
    enclosureType: 'bandpass_4th',
    sizePriority: 'balanced',
  });
  const bp4Res = calculateAcoustics(bp4);
  assert.equal(bp4Res.issues.filter((i) => i.severity === 'error').length, 0);
  assert.ok(bp4Res.sealedChamberNetL > 8 && bp4Res.ventedChamberNetL > 8);

  const bp6 = buildWizardProjectParams({
    application: 'car_spl',
    driver: DRIVER_PRESETS[0],
    driverCount: 1,
    enclosureType: 'bandpass_6th',
    sizePriority: 'balanced',
  });
  const bp6Res = calculateAcoustics(bp6);
  assert.equal(bp6Res.issues.filter((i) => i.severity === 'error').length, 0);
  assert.ok(bp6Res.rearPortTuningHz !== null && bp6Res.tuningHz !== null);
});

test('studio Hi-Fi defaults to sealed alignment near Butterworth Qtc ~0.71', () => {
  const studio = buildWizardProjectParams({
    application: 'studio_hifi',
    driver: DRIVER_PRESETS[0],
    driverCount: 1,
    enclosureType: 'recommended',
    sizePriority: 'balanced',
  });
  assert.equal(studio.enclosureType, 'sealed');
  const res = calculateAcoustics(studio);
  assert.equal(res.issues.filter((i) => i.severity === 'error').length, 0);
  assert.ok(res.sealedQtc !== null && res.sealedQtc >= 0.65 && res.sealedQtc <= 0.8);
});

test('wizard builds bilingual template presets that round-trip cleanly back into acoustics', () => {
  const cfg = {
    application: 'car_spl' as const,
    driver: CUSTOM_15_DRIVER,
    driverCount: 2 as const,
    enclosureType: 'vented_slot' as const,
    sizePriority: 'balanced' as const,
  };
  const params = buildWizardProjectParams(cfg, 'pl');
  const acoustics = calculateAcoustics(params, 'pl', 'metric');

  const autoDefaultPl = getWizardTemplateDefaultName(cfg, params, acoustics, 'pl');
  const autoPreset = buildWizardTemplatePreset(cfg, params, acoustics, '', 1700000000000);
  assert.ok(autoPreset.id.startsWith('wizard-car_spl-1700000000000-'));
  assert.equal(autoPreset.name, autoDefaultPl);
  assert.ok(autoPreset.name.includes('Car SPL'));
  assert.ok(autoPreset.name.includes('2× Sundown Audio X-15 v3'));
  assert.ok(autoPreset.nameEn?.includes('Car SPL'));

  const namedPreset = buildWizardTemplatePreset(cfg, params, acoustics, '  Mój Projekt SPL  ');
  assert.equal(namedPreset.name, 'Mój Projekt SPL');
  assert.equal(namedPreset.nameEn, 'Mój Projekt SPL');

  const roundTripAcoustics = calculateAcoustics({ ...params, ...namedPreset.params }, 'pl', 'metric');
  assert.equal(roundTripAcoustics.netVolumeL, acoustics.netVolumeL);
  assert.equal(roundTripAcoustics.tuningHz, acoustics.tuningHz);
});

test('custom target application honors explicit netVolumeL, tuningHz, velocity, and custom label', () => {
  const cfg = {
    application: 'custom' as const,
    driver: DRIVER_PRESETS[0],
    driverCount: 1 as const,
    enclosureType: 'vented_slot' as const,
    sizePriority: 'balanced' as const,
    customTarget: {
      netVolumeL: 72,
      tuningHz: 29,
      portVelocityMs: 13,
      label: 'Demo Low',
    },
  };
  const params = buildWizardProjectParams(cfg, 'pl');
  const acoustics = calculateAcoustics(params, 'pl', 'metric');
  assert.equal(acoustics.issues.filter((i) => i.severity === 'error').length, 0);
  assert.ok(Math.abs(acoustics.netVolumeL - 72) <= 3.5, `Expected Vnet near 72 L, got ${acoustics.netVolumeL}`);
  assert.ok(
    acoustics.tuningHz !== null && Math.abs(acoustics.tuningHz - 29) <= 1.2,
    `Expected Fb near 29 Hz, got ${acoustics.tuningHz}`,
  );
  const tpl = buildWizardTemplatePreset(cfg, params, acoustics);
  assert.ok(tpl.name.startsWith('Demo Low — '));
});

