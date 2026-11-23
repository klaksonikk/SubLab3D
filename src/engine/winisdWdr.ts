import {
  buildCustomDriverPreset,
  solveThieleSmall,
  type MechSolveMode,
  type MotorSolveMode,
  type QSolveMode,
  type SdInputMode,
  type TsSolverInput,
} from './tsSolver';
import type { AppLanguage, CoilWiringMode, DriverPreset, VoiceCoilCount } from './types';

export type WdrUnitSystem = 'si' | 'practical';
export type WdrUnitPreference = 'auto' | WdrUnitSystem;

export interface WdrMountingSpecs {
  cutoutDia: number;
  outerDia: number;
  depth: number;
  displacement: number;
}

export type ParseWdrOutcome =
  | {
      ok: true;
      driver: DriverPreset;
      brand: string;
      model: string;
      comment: string;
      sizeLabel: string;
      detectedUnitSystem: WdrUnitSystem;
      solverInput: TsSolverInput;
      mounting: WdrMountingSpecs;
      warnings: string[];
      rawFieldCount: number;
    }
  | {
      ok: false;
      error: string;
    };

const SIZE_CAD_DEFAULTS: Record<
  '8"' | '10"' | '12"' | '15"' | '18"',
  WdrMountingSpecs
> = {
  '8"': { cutoutDia: 184, outerDia: 212, depth: 112, displacement: 1.2 },
  '10"': { cutoutDia: 232, outerDia: 266, depth: 140, displacement: 1.9 },
  '12"': { cutoutDia: 282, outerDia: 318, depth: 168, displacement: 2.8 },
  '15"': { cutoutDia: 354, outerDia: 392, depth: 215, displacement: 5.5 },
  '18"': { cutoutDia: 422, outerDia: 465, depth: 248, displacement: 7.8 },
};

function parseWdrNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  let cleaned = raw.trim().replace(/^["']|["']$/g, '').trim();
  if (!cleaned) return undefined;
  // Support European decimal comma when no dot is present (e.g. "37,6" or "2,48E-2")
  if (cleaned.includes(',') && !cleaned.includes('.')) {
    cleaned = cleaned.replace(',', '.');
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanStringValue(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/^["']|["']$/g, '').trim();
}

function firstDefined(
  map: Record<string, string>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const val = map[k];
    if (val !== undefined && val.trim() !== '') {
      return val;
    }
  }
  return undefined;
}

function firstNumber(
  map: Record<string, string>,
  keys: string[],
): number | undefined {
  for (const k of keys) {
    const val = parseWdrNumber(map[k]);
    if (val !== undefined) return val;
  }
  return undefined;
}

function inferStandardNominalZ(re: number): number {
  if (re <= 0.7) return 1;
  if (re <= 1.35) return 1.5;
  if (re <= 2.4) return 2;
  if (re <= 4.9) return 4;
  if (re <= 9.8) return 8;
  return 16;
}

function inferSizeLabelFromDiameterMm(
  ddMm: number,
  cutoutMm?: number,
  outerMm?: number,
): '8"' | '10"' | '12"' | '15"' | '18"' {
  const ref = outerMm
    ? outerMm * 0.78
    : cutoutMm
      ? cutoutMm * 0.88
      : ddMm;
  if (ref < 185) return '8"';
  if (ref < 228) return '10"';
  if (ref < 280) return '12"';
  if (ref < 345) return '15"';
  return '18"';
}

function stripFileExtension(fileName: string): string {
  return fileName
    .replace(/\.wdr\.txt$/i, '')
    .replace(/\.wdr$/i, '')
    .replace(/\.txt$/i, '')
    .trim();
}

export function detectWdrUnitSystem(raw: Record<string, string>): WdrUnitSystem {
  let siVotes = 0;
  let practicalVotes = 0;

  const vas = firstNumber(raw, ['vas']);
  if (vas !== undefined && vas > 0) {
    if (vas < 2.2) siVotes += 2;
    else practicalVotes += 2;
  }

  const sd = firstNumber(raw, ['sd']);
  if (sd !== undefined && sd > 0) {
    if (sd < 1.5) siVotes += 2;
    else if (sd >= 5) practicalVotes += 2;
  }

  const mms = firstNumber(raw, ['mms']);
  if (mms !== undefined && mms > 0) {
    if (mms < 2.5) siVotes += 2;
    else practicalVotes += 2;
  }

  const xmax = firstNumber(raw, ['xmax']);
  if (xmax !== undefined && xmax > 0) {
    if (xmax < 0.25) siVotes += 2;
    else if (xmax >= 0.5) practicalVotes += 2;
  }

  const cms = firstNumber(raw, ['cms']);
  if (cms !== undefined && cms > 0) {
    if (cms < 0.01) siVotes += 1;
    else if (cms <= 10) practicalVotes += 1;
  }

  const le = firstNumber(raw, ['le']);
  if (le !== undefined && le > 0) {
    if (le < 0.08) siVotes += 1;
    else practicalVotes += 1;
  }

  const dia = firstNumber(raw, ['dia', 'dd', 'pistondia', 'outerdia', 'cutoutdia']);
  if (dia !== undefined && dia > 0) {
    if (dia < 1.5) siVotes += 1;
    else if (dia >= 20) practicalVotes += 1;
  }

  return siVotes >= practicalVotes ? 'si' : 'practical';
}

export function parseWinIsdWdr(
  content: string,
  fileName = 'WinISD-Driver.wdr',
  unitPreference: WdrUnitPreference = 'auto',
  lang: AppLanguage = 'pl',
): ParseWdrOutcome {
  const isEn = lang === 'en';
  const normalized = content.replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r?\n/);

  let currentSection = '';
  let hasDriverSection = false;
  const driverFields: Record<string, string> = {};
  const fallbackFields: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim().toLowerCase();
      if (currentSection === 'driver' || currentSection === 'driverdata') {
        hasDriverSection = true;
      }
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;

    const key = line.slice(0, eqIdx).trim().toLowerCase();
    const val = line.slice(eqIdx + 1).trim();
    if (!key) continue;

    if (
      currentSection === '' ||
      currentSection === 'driver' ||
      currentSection === 'driverdata' ||
      currentSection === 'parameters' ||
      currentSection === 'physical'
    ) {
      driverFields[key] = val;
    } else {
      fallbackFields[key] = val;
    }
  }

  const fields = Object.keys(driverFields).length > 0 ? driverFields : fallbackFields;
  const rawFieldCount = Object.keys(fields).length;

  const tsSignalKeys = ['fs', 'vas', 'qts', 'qes', 'qms', 'mms', 'cms', 'sd', 'bl', 're', 'pe', 'xmax'];
  const presentTsCount = tsSignalKeys.filter((k) => firstNumber(fields, [k]) !== undefined).length;

  if (rawFieldCount === 0 || (!hasDriverSection && presentTsCount < 2)) {
    return {
      ok: false,
      error: isEn
        ? 'Could not recognize a valid WinISD .wdr file (missing [Driver] section or Thiele-Small parameters).'
        : 'Nie rozpoznano poprawnego pliku WinISD .wdr (brak sekcji [Driver] lub parametrów Thiele-Small).',
    };
  }

  const detectedUnitSystem: WdrUnitSystem =
    unitPreference === 'auto' ? detectWdrUnitSystem(fields) : unitPreference;
  const isSi = detectedUnitSystem === 'si';

  let brand = cleanStringValue(firstDefined(fields, ['brand', 'manufacturer', 'make']));
  let model = cleanStringValue(firstDefined(fields, ['model', 'name', 'driver', 'title']));
  const comment = cleanStringValue(firstDefined(fields, ['comment', 'notes', 'description']));

  if (!brand && !model) {
    model = stripFileExtension(fileName) || 'WinISD Driver';
  } else if (!brand && model.includes(' ')) {
    const idx = model.indexOf(' ');
    brand = model.slice(0, idx).trim();
    model = model.slice(idx + 1).trim();
  } else if (brand && !model) {
    model = stripFileExtension(fileName) || 'Subwoofer';
  }

  const warnings: string[] = [];

  // Raw numeric extraction + unit scaling
  const fsRaw = firstNumber(fields, ['fs']);
  const qesRaw = firstNumber(fields, ['qes']);
  const qmsRaw = firstNumber(fields, ['qms']);
  const qtsRaw = firstNumber(fields, ['qts']);
  const blRaw = firstNumber(fields, ['bl']);
  const reRaw = firstNumber(fields, ['re', 'rdc']);
  const zNomRaw = firstNumber(fields, ['znom', 'z', 'nomz', 'impedance', 'imp']);
  const peRaw = firstNumber(fields, ['pe', 'pmax', 'power', 'prms', 'rms_power']);
  const vcRaw = firstNumber(fields, ['voicecoils', 'coils', 'vc']);

  const vasRaw = firstNumber(fields, ['vas']);
  const vasL =
    vasRaw !== undefined
      ? isSi || vasRaw < 2.2
        ? vasRaw * 1000
        : vasRaw
      : undefined;

  const sdRaw = firstNumber(fields, ['sd']);
  const sdCm2 =
    sdRaw !== undefined
      ? isSi || sdRaw < 1.5
        ? sdRaw * 10000
        : sdRaw
      : undefined;

  const mmsRaw = firstNumber(fields, ['mms']);
  const mmsG =
    mmsRaw !== undefined
      ? isSi || mmsRaw < 2.5
        ? mmsRaw * 1000
        : mmsRaw
      : undefined;

  const cmsRaw = firstNumber(fields, ['cms']);
  let cmsMmPerN: number | undefined;
  if (cmsRaw !== undefined && cmsRaw > 0) {
    if (cmsRaw < 0.01) {
      cmsMmPerN = cmsRaw * 1000; // m/N -> mm/N
    } else if (cmsRaw > 10) {
      cmsMmPerN = cmsRaw / 1000; // um/N -> mm/N
    } else {
      cmsMmPerN = cmsRaw; // mm/N
    }
  }

  const leRaw = firstNumber(fields, ['le']);
  const leMh =
    leRaw !== undefined
      ? isSi || leRaw < 0.08
        ? leRaw * 1000
        : leRaw
      : 1.4;

  const xmaxRaw = firstNumber(fields, ['xmax']);
  const hvcRaw = firstNumber(fields, ['hvc', 'h-c', 'hc']);
  const hagRaw = firstNumber(fields, ['hag', 'h-g', 'hg']);
  let xmaxMm: number | undefined;
  if (xmaxRaw !== undefined && xmaxRaw > 0) {
    xmaxMm = isSi || xmaxRaw < 0.25 ? xmaxRaw * 1000 : xmaxRaw;
  } else if (hvcRaw !== undefined && hagRaw !== undefined) {
    const hvcMm = isSi || hvcRaw < 0.5 ? hvcRaw * 1000 : hvcRaw;
    const hagMm = isSi || hagRaw < 0.5 ? hagRaw * 1000 : hagRaw;
    const calc = Math.abs(hvcMm - hagMm) / 2;
    if (calc > 0.5) {
      xmaxMm = calc;
    }
  }
  if (xmaxMm === undefined) {
    xmaxMm = 12;
    warnings.push(
      isEn
        ? 'Missing Xmax in .wdr file — defaulted to 12.0 mm.'
        : 'Brak Xmax w pliku .wdr — przyjęto domyślnie 12.0 mm.',
    );
  }

  const diaRaw = firstNumber(fields, ['dia', 'dd', 'pistondia']);
  const diaMm =
    diaRaw !== undefined && diaRaw > 0
      ? isSi || diaRaw < 1.5
        ? diaRaw * 1000
        : diaRaw
      : undefined;

  const cutoutRaw = firstNumber(fields, ['cutoutdia', 'cutout', 'bafflecutout']);
  const cutoutExplicitMm =
    cutoutRaw !== undefined && cutoutRaw > 0
      ? isSi || cutoutRaw < 1.5
        ? cutoutRaw * 1000
        : cutoutRaw
      : undefined;

  const outerRaw = firstNumber(fields, ['outerdia', 'od', 'diameter']);
  const outerExplicitMm =
    outerRaw !== undefined && outerRaw > 0
      ? isSi || outerRaw < 1.5
        ? outerRaw * 1000
        : outerRaw
      : undefined;

  const depthRaw = firstNumber(fields, ['depth', 'mountingdepth']);
  const depthExplicitMm =
    depthRaw !== undefined && depthRaw > 0
      ? isSi || depthRaw < 1.5
        ? depthRaw * 1000
        : depthRaw
      : undefined;

  const dispRaw = firstNumber(fields, ['displacement', 'disp']);
  const dispExplicitL =
    dispRaw !== undefined && dispRaw > 0
      ? isSi || dispRaw < 0.1
        ? dispRaw * 1000
        : dispRaw
      : undefined;

  // Air constants (optional in WinISD Pro)
  const airDensity = firstNumber(fields, ['ro', 'rho']);
  const speedOfSound = firstNumber(fields, ['c']);

  // Electrical coil specs
  const voiceCoilCount: VoiceCoilCount = vcRaw !== undefined && Math.round(vcRaw) >= 2 ? 2 : 1;
  const effectiveRe = Math.max(0.2, reRaw ?? (zNomRaw ? zNomRaw * 0.8 : 3.2));
  const effectiveZNom = Math.max(0.5, zNomRaw ?? inferStandardNominalZ(effectiveRe));
  const coilNominalOhms =
    voiceCoilCount === 2 ? effectiveZNom / 2 : effectiveZNom;
  const coilReOhms =
    voiceCoilCount === 2 ? effectiveRe / 2 : effectiveRe;
  const coilWiring: CoilWiringMode = voiceCoilCount === 2 ? 'series' : 'single';

  const powerW = peRaw !== undefined && peRaw >= 10 ? peRaw : 500;
  if (peRaw === undefined) {
    warnings.push(
      isEn
        ? 'Missing Pe power rating in .wdr file — defaulted to 500 W RMS.'
        : 'Brak mocy Pe w pliku .wdr — przyjęto domyślnie 500 W RMS.',
    );
  }

  // Determine solving modes for TsSolverInput
  let mechSolveMode: MechSolveMode = 'from_fs_vas';
  if (fsRaw !== undefined && vasL !== undefined) {
    mechSolveMode = 'from_fs_vas';
  } else if (fsRaw !== undefined && mmsG !== undefined) {
    mechSolveMode = 'from_fs_mms';
  } else if (mmsG !== undefined && cmsMmPerN !== undefined) {
    mechSolveMode = 'from_mms_cms';
  } else {
    warnings.push(
      isEn
        ? 'Incomplete mechanical pair (Fs/Vas or Mms/Cms) — filled with baseline defaults.'
        : 'Niepełna para mechaniczna (Fs/Vas lub Mms/Cms) — uzupełniono wartościami bazowymi.',
    );
  }

  let qSolveMode: QSolveMode = 'solve_qts';
  if (qesRaw !== undefined && qmsRaw !== undefined) {
    qSolveMode = 'solve_qts';
  } else if (qtsRaw !== undefined && qmsRaw !== undefined) {
    qSolveMode = 'solve_qes';
  } else if (qtsRaw !== undefined && qesRaw !== undefined) {
    qSolveMode = 'solve_qms';
  } else if (qtsRaw !== undefined) {
    qSolveMode = 'solve_qes';
    warnings.push(
      isEn
        ? 'Missing Qes and Qms in .wdr file — computed Qes from Qts assuming Qms = 4.8.'
        : 'Brak Qes i Qms w pliku .wdr — wyliczono Qes z Qts przy Qms = 4.8.',
    );
  }

  let motorSolveMode: MotorSolveMode = 'solve_bl';
  if (qesRaw === undefined && qtsRaw === undefined && blRaw !== undefined) {
    motorSolveMode = 'solve_qes_from_bl';
  }

  let sdInputMode: SdInputMode = 'direct_sd';
  let resolvedSdCm2 = sdCm2 ?? 480;
  let resolvedDdMm = diaMm ?? Math.round(20 * Math.sqrt(resolvedSdCm2 / Math.PI));

  if (sdCm2 === undefined && diaMm !== undefined) {
    sdInputMode = 'from_dd';
    resolvedDdMm = diaMm;
    resolvedSdCm2 = Math.PI * Math.pow(diaMm / 20, 2);
  } else if (sdCm2 === undefined && cutoutExplicitMm !== undefined) {
    sdInputMode = 'from_dd';
    resolvedDdMm = Math.round(cutoutExplicitMm * 0.88);
    resolvedSdCm2 = Math.PI * Math.pow(resolvedDdMm / 20, 2);
    warnings.push(
      isEn
        ? 'Missing Sd in .wdr file — estimated cone area from mounting cutout diameter.'
        : 'Brak Sd w pliku .wdr — oszacowano powierzchnię membrany z otworu montażowego.',
    );
  } else if (sdCm2 === undefined) {
    warnings.push(
      isEn
        ? 'Missing Sd and cone diameter in .wdr file — defaulted to 480 cm² (12").'
        : 'Brak Sd i średnicy membrany w pliku .wdr — przyjęto 480 cm² (12").',
    );
  }

  const sizeLabel = inferSizeLabelFromDiameterMm(
    resolvedDdMm,
    cutoutExplicitMm,
    outerExplicitMm,
  );
  const cadDefaults = SIZE_CAD_DEFAULTS[sizeLabel];
  const mounting: WdrMountingSpecs = {
    cutoutDia: Math.round(cutoutExplicitMm ?? cadDefaults.cutoutDia),
    outerDia: Math.round(outerExplicitMm ?? cadDefaults.outerDia),
    depth: Math.round(depthExplicitMm ?? cadDefaults.depth),
    displacement: Number((dispExplicitL ?? cadDefaults.displacement).toFixed(2)),
  };

  const solverInput: TsSolverInput = {
    qSolveMode,
    mechSolveMode,
    motorSolveMode,
    sdInputMode,
    voiceCoilCount,
    coilNominalOhms: Number(coilNominalOhms.toFixed(2)),
    coilReOhms: Number(coilReOhms.toFixed(2)),
    coilWiring,
    fs: fsRaw ?? 32,
    qes: qesRaw ?? 0.45,
    qms: qmsRaw ?? 4.8,
    qts: qtsRaw ?? 0.41,
    vas: vasL ?? 45,
    mms: mmsG ?? 140,
    cms: cmsMmPerN ?? 0.2,
    sd: Number(resolvedSdCm2.toFixed(1)),
    dd: Number(resolvedDdMm.toFixed(1)),
    re: Number(effectiveRe.toFixed(2)),
    le: Number(leMh.toFixed(2)),
    zNom: Number(effectiveZNom.toFixed(1)),
    bl: blRaw ?? 15,
    xmax: Number(xmaxMm.toFixed(1)),
    powerW: Math.round(powerW),
    airDensityKgM3: airDensity && airDensity > 0.8 && airDensity < 1.6 ? airDensity : undefined,
    speedOfSoundMs: speedOfSound && speedOfSound > 300 && speedOfSound < 380 ? speedOfSound : undefined,
  };

  const solved = solveThieleSmall(solverInput, lang);
  for (const w of solved.warnings) {
    warnings.push(w.message);
  }

  const id = `wdr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const preset = buildCustomDriverPreset(
    id,
    brand,
    model,
    sizeLabel,
    solved,
    mounting,
    leMh,
    lang,
  );
  preset.source = `WinISD (${fileName})`;

  return {
    ok: true,
    driver: preset,
    brand,
    model,
    comment,
    sizeLabel,
    detectedUnitSystem,
    solverInput: {
      ...solverInput,
      fs: Number(solved.fs.toFixed(2)),
      qes: Number(solved.qes.toFixed(3)),
      qms: Number(solved.qms.toFixed(2)),
      qts: Number(solved.qts.toFixed(3)),
      vas: Number(solved.vas.toFixed(2)),
      mms: Number(solved.mms.toFixed(1)),
      cms: Number(solved.cms.toFixed(3)),
      sd: Number(solved.sd.toFixed(1)),
      dd: Number(solved.dd.toFixed(0)),
      bl: Number(solved.bl.toFixed(2)),
    },
    mounting,
    warnings,
    rawFieldCount,
  };
}
