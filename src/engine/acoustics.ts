import type {
  AcousticResult,
  AppLanguage,
  BoxParams,
  DriverFace,
  DriverPattern,
  DriverPosition2D,
  FrequencyPoint,
  PortFace,
  SlotPortGeometry,
  ValidationIssue,
} from './types';

const SPEED_OF_SOUND_MS = 343.2;

export interface DriverLayoutResult {
  positions: DriverPosition2D[];
  fits: boolean;
  minClearanceMm: number;
  patternLabel: string;
}

function evaluateLayout(
  positions: DriverPosition2D[],
  usableW: number,
  usableH: number,
  outerDia: number,
): { fits: boolean; minClearanceMm: number } {
  if (positions.length === 0) return { fits: false, minClearanceMm: -999 };
  const r = outerDia / 2;
  let minWall = Infinity;
  for (const p of positions) {
    const wx = usableW / 2 - (Math.abs(p.x) + r);
    const wy = usableH / 2 - (Math.abs(p.y) + r);
    minWall = Math.min(minWall, wx, wy);
  }
  let minPair = Infinity;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dist = Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y);
      minPair = Math.min(minPair, dist - outerDia);
    }
  }
  const minClearanceMm = Math.min(minWall, minPair);
  const fits = minWall >= 4 && (positions.length === 1 || minPair >= 6);
  return { fits, minClearanceMm };
}

function distributeLine(count: number, span: number, outerDia: number, maxGapRatio = 0.2): number[] {
  if (count <= 1) return [0];
  const rawGap = (span - count * outerDia) / (count + 1);
  const gap = Math.max(6, Math.min(rawGap, Math.max(22, outerDia * maxGapRatio)));
  const totalSpan = count * outerDia + (count - 1) * gap;
  const start = -totalSpan / 2 + outerDia / 2;
  const coords: number[] = [];
  for (let i = 0; i < count; i++) {
    coords.push(start + i * (outerDia + gap));
  }
  return coords;
}

function buildGridCandidate(
  cols: number,
  rowCounts: number[],
  usableW: number,
  usableH: number,
  outerDia: number,
): DriverPosition2D[] {
  const rows = rowCounts.length;
  const ys = distributeLine(rows, usableH, outerDia, 0.22);
  const positions: DriverPosition2D[] = [];
  for (let r = 0; r < rows; r++) {
    const cnt = rowCounts[r];
    const xs = distributeLine(cnt, usableW, outerDia, 0.18);
    // Keep rows symmetric from top (+Y) to bottom (-Y)
    const y = ys[rows - 1 - r];
    for (let c = 0; c < cnt; c++) {
      positions.push({ x: xs[c], y });
    }
  }
  void cols;
  return positions;
}

function buildHoneycombRowsCandidate(
  rowCounts: number[],
  usableW: number,
  usableH: number,
  outerDia: number,
  shiftAlternatingRows: boolean,
): DriverPosition2D[] {
  const rows = rowCounts.length;
  const maxInRow = Math.max(...rowCounts);
  const shiftFactor = shiftAlternatingRows && rows > 1 ? 0.5 : 0;
  const spanPitchCount = Math.max(1, maxInRow - 1 + shiftFactor);

  const wallPad = 12;
  const maxPitchX = (usableW - outerDia - wallPad) / spanPitchCount;
  const maxPitchY = rows > 1 ? (usableH - outerDia - wallPad) / (rows - 1) : 0;

  // Never let same-row pitch fall below outerDia + 6mm so speaker baskets never clip into each other
  const targetGap = Math.max(12, outerDia * 0.12);
  let pitchX = Math.max(outerDia + 6, Math.min(maxPitchX, outerDia + targetGap));
  if (maxInRow <= 1 && !shiftAlternatingRows) pitchX = outerDia + targetGap;

  const pitchY =
    rows > 1
      ? Math.max(outerDia * 0.72, Math.min(pitchX * 0.9, Math.max(outerDia * 0.72, maxPitchY)))
      : 0;

  // If vertical space compressed pitchY, expand pitchX to preserve diagonal basket clearance
  if (shiftAlternatingRows && rows > 1 && pitchY < outerDia + 10) {
    const neededHalfPitchX = Math.sqrt(Math.max(0, Math.pow(outerDia + 10, 2) - pitchY * pitchY));
    pitchX = Math.max(pitchX, Math.min(Math.max(pitchX, maxPitchX), neededHalfPitchX * 2));
    if (Math.hypot(pitchX * 0.5, pitchY) < outerDia + 6) {
      pitchX = Math.max(pitchX, neededHalfPitchX * 2);
    }
  }
  const totalH = (rows - 1) * pitchY;

  const positions: DriverPosition2D[] = [];
  for (let r = 0; r < rows; r++) {
    const cnt = rowCounts[r];
    const y = totalH / 2 - r * pitchY;
    const rowWidth = (cnt - 1) * pitchX;
    let xShift = 0;
    if (shiftAlternatingRows && rows > 1) {
      xShift = r % 2 === 0 ? -pitchX * 0.25 : pitchX * 0.25;
    }
    for (let c = 0; c < cnt; c++) {
      positions.push({
        x: -rowWidth / 2 + c * pitchX + xShift,
        y,
      });
    }
  }
  return positions;
}

function buildQuincunx5Candidate(
  usableW: number,
  usableH: number,
  outerDia: number,
): DriverPosition2D[] {
  // 2-1-2 X-pattern: 4 corner drivers + 1 center driver
  const minDiag = outerDia + 14;
  const maxDx = Math.max(outerDia * 0.52, usableW / 2 - outerDia / 2 - 8);
  const maxDy = Math.max(outerDia * 0.52, usableH / 2 - outerDia / 2 - 8);

  // Target balanced rectangular spread while guaranteeing corner-to-center >= minDiag
  const dx = Math.min(maxDx, Math.max(minDiag * 0.76, outerDia * 0.82));
  const reqDy = Math.sqrt(Math.max(0, minDiag * minDiag - dx * dx));
  const dy = Math.min(maxDy, Math.max(reqDy, outerDia * 0.76));

  return [
    { x: -dx, y: dy },
    { x: dx, y: dy },
    { x: 0, y: 0 },
    { x: -dx, y: -dy },
    { x: dx, y: -dy },
  ];
}

function buildDiamond4Candidate(
  usableW: number,
  usableH: number,
  outerDia: number,
): DriverPosition2D[] {
  const maxDx = Math.max(outerDia * 0.5, usableW / 2 - outerDia / 2 - 8);
  const maxDy = Math.max(outerDia * 0.5, usableH / 2 - outerDia / 2 - 8);
  const dx = Math.min(maxDx, outerDia * 0.72);
  const dy = Math.min(maxDy, outerDia * 0.72);
  return [
    { x: 0, y: dy },
    { x: -dx, y: 0 },
    { x: dx, y: 0 },
    { x: 0, y: -dy },
  ];
}

interface LayoutCandidate {
  label: string;
  kind: 'inline' | 'grid' | 'staggered';
  positions: DriverPosition2D[];
  preferenceBonus: number;
}

/**
 * Computes optimal 2D coordinates (in mm, centered at 0,0) for 1..6 drivers
 * inside a rectangular usable span (usableW x usableH), supporting advanced
 * staggered / honeycomb / quincunx multi-driver arrangements.
 */
export function computeDriverGridLayout(
  count: number,
  usableW: number,
  usableH: number,
  outerDia: number,
  pattern: DriverPattern = 'auto',
  lang: AppLanguage = 'pl',
): DriverLayoutResult {
  const safeCount = Math.min(6, Math.max(1, Math.round(count)));
  const isEn = lang === 'en';

  if (safeCount === 1) {
    const positions = [{ x: 0, y: 0 }];
    const ev = evaluateLayout(positions, usableW, usableH, outerDia);
    return { positions, ...ev, patternLabel: isEn ? 'Centered (1×)' : 'Centralny (1×)' };
  }

  const candidates: LayoutCandidate[] = [];

  if (safeCount === 2) {
    candidates.push(
      {
        label: isEn ? 'Horizontal pair (1×2)' : 'Para pozioma (1×2)',
        kind: 'inline',
        positions: buildGridCandidate(2, [2], usableW, usableH, outerDia),
        preferenceBonus: 2,
      },
      {
        label: isEn ? 'Vertical pair (2×1)' : 'Para pionowa (2×1)',
        kind: 'grid',
        positions: buildGridCandidate(1, [1, 1], usableW, usableH, outerDia),
        preferenceBonus: 0,
      },
    );
  } else if (safeCount === 3) {
    candidates.push(
      {
        label: isEn ? 'Alternating triangle (2+1)' : 'Trójkąt naprzemienny (2+1)',
        kind: 'staggered',
        positions: buildHoneycombRowsCandidate([2, 1], usableW, usableH, outerDia, false),
        preferenceBonus: 4,
      },
      {
        label: isEn ? 'Inverted triangle (1+2)' : 'Odwrócony trójkąt (1+2)',
        kind: 'staggered',
        positions: buildHoneycombRowsCandidate([1, 2], usableW, usableH, outerDia, false),
        preferenceBonus: 1,
      },
      {
        label: isEn ? 'Horizontal row (1×3)' : 'Szereg poziomy (1×3)',
        kind: 'inline',
        positions: buildGridCandidate(3, [3], usableW, usableH, outerDia),
        preferenceBonus: 2,
      },
      {
        label: isEn ? 'Grid (2+1)' : 'Siatka (2+1)',
        kind: 'grid',
        positions: buildGridCandidate(2, [2, 1], usableW, usableH, outerDia),
        preferenceBonus: 0,
      },
      {
        label: isEn ? 'Vertical column (3×1)' : 'Kolumna pionowa (3×1)',
        kind: 'grid',
        positions: buildGridCandidate(1, [1, 1, 1], usableW, usableH, outerDia),
        preferenceBonus: -2,
      },
    );
  } else if (safeCount === 4) {
    candidates.push(
      {
        label: isEn ? 'Symmetric grid (2×2)' : 'Siatka symetryczna (2×2)',
        kind: 'grid',
        positions: buildGridCandidate(2, [2, 2], usableW, usableH, outerDia),
        preferenceBonus: 3,
      },
      {
        label: isEn ? 'Staggered honeycomb (2+2)' : 'Plaster naprzemienny (2+2)',
        kind: 'staggered',
        positions: buildHoneycombRowsCandidate([2, 2], usableW, usableH, outerDia, true),
        preferenceBonus: 4,
      },
      {
        label: isEn ? 'Acoustic diamond (1-2-1)' : 'Romb akustyczny (1-2-1)',
        kind: 'staggered',
        positions: buildDiamond4Candidate(usableW, usableH, outerDia),
        preferenceBonus: 2,
      },
      {
        label: isEn ? 'Horizontal row (1×4)' : 'Szereg poziomy (1×4)',
        kind: 'inline',
        positions: buildGridCandidate(4, [4], usableW, usableH, outerDia),
        preferenceBonus: 1,
      },
    );
  } else if (safeCount === 5) {
    candidates.push(
      {
        label: 'Quincunx X (2-1-2)',
        kind: 'staggered',
        positions: buildQuincunx5Candidate(usableW, usableH, outerDia),
        preferenceBonus: 5,
      },
      {
        label: isEn ? 'Honeycomb (3+2)' : 'Plaster miodu (3+2)',
        kind: 'staggered',
        positions: buildHoneycombRowsCandidate([3, 2], usableW, usableH, outerDia, false),
        preferenceBonus: 4,
      },
      {
        label: isEn ? 'Two-row grid (3+2)' : 'Siatka dwurzędowa (3+2)',
        kind: 'grid',
        positions: buildGridCandidate(3, [3, 2], usableW, usableH, outerDia),
        preferenceBonus: 1,
      },
      {
        label: isEn ? 'Vertical grid (2+2+1)' : 'Siatka pionowa (2+2+1)',
        kind: 'grid',
        positions: buildGridCandidate(2, [2, 2, 1], usableW, usableH, outerDia),
        preferenceBonus: 0,
      },
      {
        label: isEn ? 'Horizontal row (1×5)' : 'Szereg poziomy (1×5)',
        kind: 'inline',
        positions: buildGridCandidate(5, [5], usableW, usableH, outerDia),
        preferenceBonus: -2,
      },
    );
  } else {
    // 6 drivers
    candidates.push(
      {
        label: isEn ? 'Honeycomb (3+3)' : 'Plaster miodu (3+3)',
        kind: 'staggered',
        positions: buildHoneycombRowsCandidate([3, 3], usableW, usableH, outerDia, true),
        preferenceBonus: 4,
      },
      {
        label: isEn ? 'Acoustic pyramid (3+2+1)' : 'Piramida akustyczna (3+2+1)',
        kind: 'staggered',
        positions: buildHoneycombRowsCandidate([3, 2, 1], usableW, usableH, outerDia, false),
        preferenceBonus: 2,
      },
      {
        label: isEn ? 'Vertical honeycomb (2+2+2)' : 'Plaster pionowy (2+2+2)',
        kind: 'staggered',
        positions: buildHoneycombRowsCandidate([2, 2, 2], usableW, usableH, outerDia, true),
        preferenceBonus: 3,
      },
      {
        label: isEn ? 'Grid (3×2)' : 'Siatka (3×2)',
        kind: 'grid',
        positions: buildGridCandidate(3, [3, 3], usableW, usableH, outerDia),
        preferenceBonus: 3,
      },
      {
        label: isEn ? 'Deep grid (2×3)' : 'Siatka głęboka (2×3)',
        kind: 'grid',
        positions: buildGridCandidate(2, [2, 2, 2], usableW, usableH, outerDia),
        preferenceBonus: 2,
      },
      {
        label: isEn ? 'Horizontal row (1×6)' : 'Szereg poziomy (1×6)',
        kind: 'inline',
        positions: buildGridCandidate(6, [6], usableW, usableH, outerDia),
        preferenceBonus: -2,
      },
    );
  }

  let pool = candidates;
  if (pattern !== 'auto') {
    const filtered = candidates.filter((c) => c.kind === pattern);
    if (filtered.length > 0) pool = filtered;
  }

  let best = pool[0];
  let bestEv = evaluateLayout(best.positions, usableW, usableH, outerDia);
  let bestScore = (bestEv.fits ? 10_000 : 0) + bestEv.minClearanceMm + best.preferenceBonus;

  for (let i = 1; i < pool.length; i++) {
    const cand = pool[i];
    const ev = evaluateLayout(cand.positions, usableW, usableH, outerDia);
    const score = (ev.fits ? 10_000 : 0) + ev.minClearanceMm + cand.preferenceBonus;
    if (score > bestScore) {
      best = cand;
      bestEv = ev;
      bestScore = score;
    }
  }

  return {
    positions: best.positions,
    fits: bestEv.fits,
    minClearanceMm: Math.round(bestEv.minClearanceMm),
    patternLabel: best.label,
  };
}

/**
 * Computes geometry of a slot port that automatically folds 90 degrees (L-shape)
 * along the rear wall when total length exceeds straight internal clearance.
 */
export function computeSlotPortGeometry(
  chamberWidth: number,
  internalHeight: number,
  internalDepth: number,
  thickness: number,
  portWidth: number,
  portHeight: number,
  portLength: number,
  frontBaffleThickness: number,
  minOtherClearanceWidth: number,
): SlotPortGeometry {
  const safePortW = Math.max(10, portWidth);
  const safePortH = Math.max(10, Math.min(portHeight, internalHeight));
  const safeLength = Math.max(10, portLength);

  const straightMaxLength = frontBaffleThickness + internalDepth - safePortW;

  if (safeLength <= straightMaxLength) {
    return {
      width: safePortW,
      height: safePortH,
      totalLength: safeLength,
      isBent: false,
      leg1Length: safeLength,
      leg2Length: 0,
      baffle1Length: Math.max(0, safeLength - frontBaffleThickness),
      baffle2Length: 0,
      rearClearance: Math.max(0, frontBaffleThickness + internalDepth - safeLength),
      fitsInside:
        safeLength <= straightMaxLength &&
        safePortW < chamberWidth - Math.min(40, minOtherClearanceWidth),
    };
  }

  const baffle1Length = Math.max(0, internalDepth - safePortW);
  const leg1Centerline = frontBaffleThickness + baffle1Length + 0.5 * safePortW;
  const remainingLength = Math.max(0, safeLength - leg1Centerline);
  const leg2Length = remainingLength;
  const baffle2Length = Math.max(0, leg2Length - 0.5 * safePortW - thickness);

  const maxLeg2Width = chamberWidth - safePortW - thickness - safePortW;
  const fitsInside =
    baffle1Length > 20 &&
    baffle2Length <= maxLeg2Width &&
    safePortW < chamberWidth - 36;

  return {
    width: safePortW,
    height: safePortH,
    totalLength: safeLength,
    isBent: true,
    leg1Length: leg1Centerline,
    leg2Length,
    baffle1Length,
    baffle2Length,
    rearClearance: safePortW,
    fitsInside,
  };
}

export function calculateHelmholtzFb(
  netVolumeL: number,
  portAreaCm2: number,
  portLengthMm: number,
  endCorrectionFactor: number,
): number {
  if (netVolumeL <= 0.1 || portAreaCm2 <= 0.1 || portLengthMm <= 1) {
    return 0;
  }
  const Vm3 = netVolumeL / 1000;
  const Sm2 = portAreaCm2 / 10000;
  const Lm = portLengthMm / 1000;
  const reqM = Math.sqrt(Sm2 / Math.PI);
  const effectiveLengthM = Lm + endCorrectionFactor * reqM;

  if (Vm3 * effectiveLengthM <= 0) return 0;
  const fb = (SPEED_OF_SOUND_MS / (2 * Math.PI)) * Math.sqrt(Sm2 / (Vm3 * effectiveLengthM));
  return Number.isFinite(fb) ? fb : 0;
}

function estimatePortVelocityMs(
  driverCount: number,
  cutoutDiaMm: number,
  xmaxMm: number,
  tuningHz: number,
  portAreaCm2: number,
): number {
  if (tuningHz <= 0 || portAreaCm2 <= 0) return 0;
  const effectivePistonRadiusM = (cutoutDiaMm * 0.88) / 2000;
  const sdM2 = Math.PI * effectivePistonRadiusM * effectivePistonRadiusM * driverCount;
  const vdM3 = sdM2 * (xmaxMm / 1000);
  const sm2 = portAreaCm2 / 10000;
  const velocity = (2 * Math.PI * tuningHz * vdM3 * 1.15) / sm2;
  return Math.max(0, velocity);
}

function generateResponseCurve(
  params: BoxParams,
  netVolumeL: number,
  tuningHz: number | null,
  rearTuningHz: number | null,
  sealedQtc: number | null,
  sealedFcHz: number | null,
  portAreaCm2: number,
  rearPortAreaCm2: number,
): { curve: FrequencyPoint[]; f3Low: number; f3High: number | null } {
  const curve: FrequencyPoint[] = [];
  const fs = Math.max(15, params.driverFs);
  const qts = Math.max(0.18, params.driverQts);
  const vasTotal = params.driverVas * params.driverCount;

  const pointsHz: number[] = [];
  for (let f = 15; f <= 150; f += 1) {
    pointsHz.push(f);
  }

  let f3Low = 35;
  let f3High: number | null = null;

  if (params.enclosureType === 'sealed') {
    const fc = sealedFcHz && sealedFcHz > 0 ? sealedFcHz : fs;
    const qtc = sealedQtc && sealedQtc > 0 ? sealedQtc : qts;

    let foundF3 = false;
    for (const f of pointsHz) {
      const fn = f / fc;
      const fn2 = fn * fn;
      const denom = Math.sqrt(Math.pow(1 - fn2, 2) + Math.pow(fn / qtc, 2));
      const mag = denom > 0 ? fn2 / denom : 0;
      const splDb = mag > 1e-6 ? 20 * Math.log10(mag) : -60;
      const excursionScale = 1 / Math.max(0.35, denom);
      const excursionMm = Math.min(params.driverXmax * 1.4, params.driverXmax * 0.7 * excursionScale);

      if (!foundF3 && splDb >= -3) {
        f3Low = f;
        foundF3 = true;
      }
      curve.push({ hz: f, splDb, portVelocityMs: 0, excursionMm });
    }
    return { curve, f3Low, f3High: null };
  }

  if (params.enclosureType === 'bandpass_4th') {
    const fcRear = sealedFcHz && sealedFcHz > 0 ? sealedFcHz : fs * 1.4;
    const fbFront = tuningHz && tuningHz > 0 ? tuningHz : 55;
    const qbp = 0.72;
    const center = Math.sqrt(fcRear * fbFront);
    const bandwidthRatio = Math.max(0.4, (fbFront - fcRear * 0.6) / Math.max(20, center));

    let maxDb = -999;
    const raw: { hz: number; db: number }[] = [];
    for (const f of pointsHz) {
      const x = f / center;
      const bpTerm = (x / qbp) / Math.sqrt(Math.pow(1 - x * x, 2) + Math.pow(x / qbp, 2));
      const slopeAtten = 1 / Math.sqrt(1 + Math.pow((x - 1 / x) / Math.max(0.55, bandwidthRatio * 1.3), 2));
      const mag = Math.max(1e-5, bpTerm * (0.7 + 0.35 * slopeAtten));
      const db = 20 * Math.log10(mag);
      if (db > maxDb) maxDb = db;
      raw.push({ hz: f, db });
    }

    let enteredPassband = false;
    const basePortVel = estimatePortVelocityMs(
      params.driverCount,
      params.driverCutoutDia,
      params.driverXmax,
      fbFront,
      portAreaCm2,
    );

    for (const pt of raw) {
      const splDb = pt.db - maxDb;
      if (!enteredPassband && splDb >= -3) {
        f3Low = pt.hz;
        enteredPassband = true;
      } else if (enteredPassband && f3High === null && splDb < -3) {
        f3High = pt.hz;
      }
      const distFromFb = Math.abs(pt.hz - fbFront) / Math.max(10, fbFront);
      const portVel = basePortVel * Math.exp(-distFromFb * distFromFb * 3.5);
      curve.push({
        hz: pt.hz,
        splDb,
        portVelocityMs: portVel,
        excursionMm: params.driverXmax * (0.4 + 0.5 * Math.exp(-Math.pow((pt.hz - center) / 22, 2))),
      });
    }
    return { curve, f3Low, f3High };
  }

  if (params.enclosureType === 'bandpass_6th') {
    const fbLow = Math.max(18, Math.min(rearTuningHz ?? 32, tuningHz ?? 64));
    const fbHigh = Math.max(fbLow + 12, Math.max(rearTuningHz ?? 32, tuningHz ?? 64));
    const center = Math.sqrt(fbLow * fbHigh);

    const raw: { hz: number; db: number }[] = [];
    let maxDb = -999;

    const frontVelPeak = estimatePortVelocityMs(
      params.driverCount,
      params.driverCutoutDia,
      params.driverXmax,
      fbHigh,
      portAreaCm2,
    );
    const rearVelPeak = estimatePortVelocityMs(
      params.driverCount,
      params.driverCutoutDia,
      params.driverXmax,
      fbLow,
      rearPortAreaCm2,
    );

    for (const f of pointsHz) {
      const xLow = f / fbLow;
      const hpMag = (xLow * xLow) / Math.sqrt(Math.pow(1 - xLow * xLow, 2) + Math.pow(xLow / 0.85, 2));
      const xHigh = f / fbHigh;
      const lpMag = 1 / Math.sqrt(Math.pow(1 - xHigh * xHigh, 2) + Math.pow(xHigh / 0.82, 2));
      const dualBoost =
        1 +
        0.22 * Math.exp(-Math.pow((f - fbLow) / 6, 2)) +
        0.25 * Math.exp(-Math.pow((f - fbHigh) / 10, 2));

      const mag = Math.max(1e-5, hpMag * lpMag * dualBoost);
      const db = 20 * Math.log10(mag);
      if (db > maxDb) maxDb = db;
      raw.push({ hz: f, db });
    }

    let enteredPassband = false;
    for (const pt of raw) {
      const splDb = pt.db - maxDb;
      if (!enteredPassband && splDb >= -3) {
        f3Low = pt.hz;
        enteredPassband = true;
      } else if (enteredPassband && f3High === null && splDb < -3) {
        f3High = pt.hz;
      }

      const velLow = rearVelPeak * Math.exp(-Math.pow((pt.hz - fbLow) / (fbLow * 0.28), 2));
      const velHigh = frontVelPeak * Math.exp(-Math.pow((pt.hz - fbHigh) / (fbHigh * 0.28), 2));

      const notchLow = Math.min(1, Math.abs(pt.hz - fbLow) / (fbLow * 0.35));
      const notchHigh = Math.min(1, Math.abs(pt.hz - fbHigh) / (fbHigh * 0.35));
      const excLoad = 0.25 + 0.75 * Math.min(notchLow, notchHigh);
      const subsonic = pt.hz < fbLow ? 1 + ((fbLow - pt.hz) / fbLow) * 1.1 : 1;
      const excursionMm = Math.min(
        params.driverXmax * 1.65,
        params.driverXmax * 0.65 * excLoad * subsonic * (pt.hz > center * 1.6 ? 0.5 : 1),
      );

      curve.push({
        hz: pt.hz,
        splDb,
        portVelocityMs: Math.max(velLow, velHigh),
        excursionMm,
      });
    }
    return { curve, f3Low, f3High };
  }

  // Vented / Bass-Reflex 4th-order transfer function (Thiele-Small)
  const fb = tuningHz && tuningHz > 10 ? tuningHz : 35;
  const vb = Math.max(5, netVolumeL);
  const alpha = vasTotal / vb;
  const h = fb / fs;
  const ql = 7;

  const A1 = 1 / qts + h / ql;
  const A2 = 1 + alpha + h * h + h / (qts * ql);
  const A3 = h * h / qts + h / ql;
  const A4 = h * h;

  let foundF3 = false;
  const basePortVel = estimatePortVelocityMs(
    params.driverCount,
    params.driverCutoutDia,
    params.driverXmax,
    fb,
    portAreaCm2,
  );

  for (const f of pointsHz) {
    const fn = f / fs;
    const fn2 = fn * fn;
    const fn4 = fn2 * fn2;

    const realPart = fn4 - A2 * fn2 + A4;
    const imagPart = A1 * fn * fn2 - A3 * fn;
    const denom = Math.sqrt(realPart * realPart + imagPart * imagPart);
    const mag = denom > 0 ? fn4 / denom : 0;
    const splDb = mag > 1e-6 ? Math.max(-45, 20 * Math.log10(mag)) : -45;

    if (!foundF3 && splDb >= -3) {
      f3Low = f;
      foundF3 = true;
    }

    const portNorm =
      fn2 /
      Math.max(
        0.15,
        Math.sqrt(Math.pow(1 - (f / fb) * (f / fb), 2) + Math.pow(f / (fb * 2.2), 2)),
      );
    const portVelocityMs = basePortVel * Math.min(1.25, portNorm * 0.48);

    const notch = Math.abs(f - fb) / fb;
    const coneLoad = 0.28 + 0.72 * Math.min(1.2, notch * 2.2);
    const subsonicBoost = f < fb ? 1 + ((fb - f) / fb) * 1.15 : 1;
    const excursionMm = Math.min(
      params.driverXmax * 1.8,
      params.driverXmax * 0.68 * coneLoad * subsonicBoost,
    );

    curve.push({
      hz: f,
      splDb,
      portVelocityMs,
      excursionMm,
    });
  }

  return { curve, f3Low, f3High: null };
}

export function resolveEffectiveFaces(params: BoxParams): {
  isBandpass: boolean;
  effectiveDriverFace: DriverFace | 'divider';
  effectivePortFace: PortFace | 'none';
} {
  const isBandpass =
    params.enclosureType === 'bandpass_4th' || params.enclosureType === 'bandpass_6th';
  if (isBandpass) {
    return { isBandpass: true, effectiveDriverFace: 'divider', effectivePortFace: 'front' };
  }
  const effectiveDriverFace: DriverFace = params.driverFace === 'top' ? 'top' : 'front';
  const effectivePortFace: PortFace | 'none' =
    params.enclosureType === 'sealed'
      ? 'none'
      : params.enclosureType === 'vented_round'
        ? params.portFace ?? 'front'
        : 'front';
  return { isBandpass: false, effectiveDriverFace, effectivePortFace };
}

function circleIntersectsRect(
  cx: number,
  cy: number,
  cr: number,
  rxMin: number,
  rxMax: number,
  ryMin: number,
  ryMax: number,
): boolean {
  const closestX = Math.max(rxMin, Math.min(cx, rxMax));
  const closestY = Math.max(ryMin, Math.min(cy, ryMax));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < cr * cr;
}

function solvePortLengthForTargetFb(
  targetFbHz: number,
  portAreaCm2: number,
  endFactor: number,
  baseAvailableL: number,
  calcDispL: (lenMm: number) => number,
): { lengthMm: number; reachable: boolean } {
  const safeArea = Math.max(10, portAreaCm2);
  const safeTarget = Math.max(10, targetFbHz);
  const minL = 15;
  const hardMaxL = 3500;

  if (baseAvailableL - calcDispL(minL) <= 0.5) {
    return { lengthMm: minL, reachable: false };
  }

  let maxFeasibleL = hardMaxL;
  if (baseAvailableL - calcDispL(hardMaxL) <= 0.5) {
    let lo = minL;
    let hi = hardMaxL;
    for (let i = 0; i < 24; i++) {
      const mid = 0.5 * (lo + hi);
      if (baseAvailableL - calcDispL(mid) > 0.5) lo = mid;
      else hi = mid;
    }
    maxFeasibleL = lo;
  }

  const evalFb = (lenMm: number): number => {
    const netL = baseAvailableL - calcDispL(lenMm);
    return calculateHelmholtzFb(netL, safeArea, lenMm, endFactor);
  };

  const samples = 80;
  let minFb = evalFb(minL);
  let lenAtMinFb = minL;
  const sampleGrid: Array<{ len: number; fb: number }> = [];
  for (let i = 0; i <= samples; i++) {
    const len = minL + ((maxFeasibleL - minL) * i) / samples;
    const fb = evalFb(len);
    sampleGrid.push({ len, fb });
    if (fb > 0 && fb < minFb) {
      minFb = fb;
      lenAtMinFb = len;
    }
  }

  const fbAtMinL = sampleGrid[0].fb;
  if (safeTarget >= fbAtMinL) {
    return { lengthMm: minL, reachable: Math.abs(safeTarget - fbAtMinL) < 0.35 };
  }
  if (safeTarget <= minFb) {
    return { lengthMm: lenAtMinFb, reachable: Math.abs(safeTarget - minFb) < 0.35 };
  }

  let bracketLo = minL;
  let bracketHi = lenAtMinFb;
  for (let i = 0; i < sampleGrid.length - 1; i++) {
    if (sampleGrid[i].len >= lenAtMinFb) break;
    if (sampleGrid[i].fb >= safeTarget && sampleGrid[i + 1].fb <= safeTarget) {
      bracketLo = sampleGrid[i].len;
      bracketHi = sampleGrid[i + 1].len;
      break;
    }
  }

  for (let i = 0; i < 32; i++) {
    const mid = 0.5 * (bracketLo + bracketHi);
    const fb = evalFb(mid);
    if (fb > safeTarget) {
      bracketLo = mid;
    } else {
      bracketHi = mid;
    }
  }

  return { lengthMm: 0.5 * (bracketLo + bracketHi), reachable: true };
}

function solvePortAreaForTargetFb(
  targetFbHz: number,
  portLengthMm: number,
  endFactor: number,
  baseAvailableL: number,
  calcDispL: (areaCm2: number) => number,
): { areaCm2: number; reachable: boolean } {
  const safeTarget = Math.max(10, targetFbHz);
  const safeLen = Math.max(15, portLengthMm);
  const minArea = 15;
  const hardMaxArea = 1600;

  if (baseAvailableL - calcDispL(minArea) <= 0.5) {
    return { areaCm2: minArea, reachable: false };
  }

  let maxFeasibleArea = hardMaxArea;
  if (baseAvailableL - calcDispL(hardMaxArea) <= 0.5) {
    let lo = minArea;
    let hi = hardMaxArea;
    for (let i = 0; i < 24; i++) {
      const mid = 0.5 * (lo + hi);
      if (baseAvailableL - calcDispL(mid) > 0.5) lo = mid;
      else hi = mid;
    }
    maxFeasibleArea = lo;
  }

  const evalFb = (areaCm2: number): number => {
    const netL = baseAvailableL - calcDispL(areaCm2);
    return calculateHelmholtzFb(netL, areaCm2, safeLen, endFactor);
  };

  const fbMin = evalFb(minArea);
  const fbMax = evalFb(maxFeasibleArea);
  if (safeTarget <= fbMin) {
    return { areaCm2: minArea, reachable: Math.abs(safeTarget - fbMin) < 0.35 };
  }
  if (safeTarget >= fbMax) {
    return { areaCm2: maxFeasibleArea, reachable: Math.abs(safeTarget - fbMax) < 0.35 };
  }

  let lo = minArea;
  let hi = maxFeasibleArea;
  for (let i = 0; i < 32; i++) {
    const mid = 0.5 * (lo + hi);
    if (evalFb(mid) < safeTarget) lo = mid;
    else hi = mid;
  }
  return { areaCm2: 0.5 * (lo + hi), reachable: true };
}

function evaluateEnclosureCore(
  params: BoxParams,
  extW: number,
  extH: number,
  extD: number,
  lang: AppLanguage = 'pl',
): AcousticResult {
  const isEn = lang === 'en';
  const t = Math.max(6, params.thickness);
  const { isBandpass, effectiveDriverFace, effectivePortFace } = resolveEffectiveFaces(params);
  const slotSide = params.portSlotSide ?? 'right';
  const portMode = params.portControlMode ?? 'dimensions';

  // Double baffle strengthens whichever outer face holds the drivers (Top or Front)
  const frontThickness =
    params.doubleFrontBaffle && effectiveDriverFace !== 'top' ? t * 2 : t;
  const topThickness =
    params.doubleFrontBaffle && effectiveDriverFace === 'top' ? t * 2 : t;

  const internalWidth = Math.max(0, extW - 2 * t);
  const internalHeight = Math.max(0, extH - t - topThickness);
  const internalDepth = Math.max(0, extD - t - frontThickness);

  const grossVolumeL = (internalWidth * internalHeight * internalDepth) / 1_000_000;
  const totalDriverDisplacementL = params.driverDisplacement * params.driverCount;

  const issues: ValidationIssue[] = [];

  if (internalWidth <= 40 || internalHeight <= 40 || internalDepth <= 40) {
    issues.push({
      id: 'too-small',
      severity: 'error',
      message: isEn
        ? 'External dimensions are too small relative to board thickness.'
        : 'Wymiary zewnętrzne są zbyt małe względem grubości płyty.',
    });
  }

  const effectivePortHeight =
    params.enclosureType === 'vented_slot' && slotSide === 'bottom'
      ? params.portFullHeight
        ? internalWidth
        : Math.max(40, Math.min(params.portHeight, internalWidth))
      : params.portFullHeight
        ? internalHeight
        : Math.max(20, Math.min(params.portHeight, internalHeight));

  const effectiveRearPortHeight = params.portRearFullHeight
    ? internalHeight
    : Math.max(20, Math.min(params.portRearHeight, internalHeight));

  let effectivePortWidth = params.portWidth;
  let effectivePortDiameter = params.portDiameter;
  let effectivePortLength = params.portLength;
  let effectiveRearPortWidth = params.portRearWidth;
  let effectiveRearPortLength = params.portRearLength;

  let portAirVolumeL = 0;
  let portWoodVolumeL = 0;
  let portAreaCm2 = 0;
  let rearPortAreaCm2 = 0;
  let slotPort: SlotPortGeometry | null = null;
  let rearSlotPort: SlotPortGeometry | null = null;
  let tuningHz: number | null = null;
  let rearPortTuningHz: number | null = null;
  let sealedFcHz: number | null = null;
  let sealedQtc: number | null = null;
  let sealedChamberNetL = 0;
  let ventedChamberNetL = 0;
  let netVolumeL = 0;
  let targetFbUnreachable = false;

  // Round port layout + bounds (populated for vented_round)
  let roundPortLayout: DriverPosition2D[] = [];
  let portMinX = 0;
  let portMaxX = 0;
  let portMinY = 0;
  let portMaxY = 0;

  if (params.enclosureType === 'sealed') {
    netVolumeL = Math.max(0, grossVolumeL - totalDriverDisplacementL - params.bracingVolumeL);
    const vasTotal = params.driverVas * params.driverCount;
    const alpha = netVolumeL > 0.5 ? vasTotal / netVolumeL : 10;
    sealedQtc = params.driverQts * Math.sqrt(1 + alpha);
    sealedFcHz = params.driverFs * Math.sqrt(1 + alpha);
    sealedChamberNetL = netVolumeL;
  } else if (params.enclosureType === 'vented_slot') {
    const baseAvailableL = Math.max(0, grossVolumeL - totalDriverDisplacementL - params.bracingVolumeL);
    const minOtherClearance = effectiveDriverFace === 'top' ? 60 : params.driverOuterDia + 20;

    const evalSlotPort = (pw: number, plen: number) => {
      if (slotSide === 'bottom') {
        const sp = computeSlotPortGeometry(
          internalHeight,
          effectivePortHeight,
          internalDepth,
          t,
          pw,
          effectivePortHeight,
          plen,
          frontThickness,
          minOtherClearance,
        );
        const internalAirLen = Math.max(0, sp.totalLength - frontThickness);
        const airL = (sp.width * sp.height * internalAirLen) / 1_000_000;
        const woodLen = sp.baffle1Length + sp.baffle2Length;
        const fullSpan = params.portFullHeight ? internalWidth : sp.height + t;
        const woodL = (woodLen * fullSpan * t) / 1_000_000;
        return { sp, airL, woodL };
      }
      const sp = computeSlotPortGeometry(
        internalWidth,
        internalHeight,
        internalDepth,
        t,
        pw,
        effectivePortHeight,
        plen,
        frontThickness,
        minOtherClearance,
      );
      const internalAirLen = Math.max(0, sp.totalLength - frontThickness);
      const airL = (sp.width * sp.height * internalAirLen) / 1_000_000;
      const woodLen = sp.baffle1Length + sp.baffle2Length;
      const fullH = params.portFullHeight ? internalHeight : sp.height + t;
      const woodL = (woodLen * fullH * t) / 1_000_000;
      return { sp, airL, woodL };
    };

    if (portMode === 'tuning') {
      const targetArea = Math.max(15, params.targetPortAreaCm2 || 180);
      effectivePortWidth = Math.max(10, (targetArea * 100) / Math.max(20, effectivePortHeight));
      const solved = solvePortLengthForTargetFb(
        params.targetTuningHz || 35,
        (effectivePortWidth * effectivePortHeight) / 100,
        1.85,
        baseAvailableL,
        (lenMm) => {
          const ev = evalSlotPort(effectivePortWidth, lenMm);
          return ev.airL + ev.woodL;
        },
      );
      effectivePortLength = solved.lengthMm;
      if (!solved.reachable) targetFbUnreachable = true;
    } else if (portMode === 'area_from_length') {
      effectivePortLength = Math.max(20, params.portLength);
      const solved = solvePortAreaForTargetFb(
        params.targetTuningHz || 35,
        effectivePortLength,
        1.85,
        baseAvailableL,
        (areaCm2) => {
          const pw = Math.max(10, (areaCm2 * 100) / Math.max(20, effectivePortHeight));
          const ev = evalSlotPort(pw, effectivePortLength);
          return ev.airL + ev.woodL;
        },
      );
      effectivePortWidth = Math.max(10, (solved.areaCm2 * 100) / Math.max(20, effectivePortHeight));
      if (!solved.reachable) targetFbUnreachable = true;
    }

    const finalSlot = evalSlotPort(effectivePortWidth, effectivePortLength);
    slotPort = finalSlot.sp;
    portAirVolumeL = finalSlot.airL;
    portWoodVolumeL = finalSlot.woodL;
    portAreaCm2 = (slotPort.width * slotPort.height) / 100;

    const portTotal = portAirVolumeL + portWoodVolumeL;
    netVolumeL = Math.max(0, baseAvailableL - portTotal);

    tuningHz = calculateHelmholtzFb(netVolumeL, portAreaCm2, slotPort.totalLength, 1.85);

    if (!slotPort.fitsInside) {
      issues.push({
        id: 'port-overflow',
        severity: 'error',
        message: isEn
          ? 'The slot port is too long or too wide for the current enclosure dimensions.'
          : 'Tunel bass-reflex jest zbyt długi lub zbyt szeroki dla wybranych wymiarów obudowy.',
      });
    }
  } else if (params.enclosureType === 'vented_round') {
    const portMountThickness =
      effectivePortFace === 'front'
        ? frontThickness
        : effectivePortFace === 'top'
          ? topThickness
          : t;
    const endFactor = params.portFlared ? 1.25 : 1.46;
    const baseAvailableL = Math.max(0, grossVolumeL - totalDriverDisplacementL - params.bracingVolumeL);

    const evalRoundDisp = (diaMm: number, lenMm: number) => {
      const rCm = diaMm / 20;
      const outerRCm = (diaMm + 8) / 20;
      const internalLen = Math.max(0, lenMm - portMountThickness);
      const airL = (Math.PI * rCm * rCm * internalLen * params.portCount) / 10000;
      const woodL =
        (Math.PI * (outerRCm * outerRCm - rCm * rCm) * internalLen * params.portCount) / 10000;
      return { airL, woodL };
    };

    if (portMode === 'tuning') {
      const targetArea = Math.max(15, params.targetPortAreaCm2 || 180);
      effectivePortDiameter = Math.max(
        20,
        20 * Math.sqrt((targetArea / params.portCount) / Math.PI),
      );
      const solved = solvePortLengthForTargetFb(
        params.targetTuningHz || 35,
        targetArea,
        endFactor,
        baseAvailableL,
        (lenMm) => {
          const ev = evalRoundDisp(effectivePortDiameter, lenMm);
          return ev.airL + ev.woodL;
        },
      );
      effectivePortLength = solved.lengthMm;
      if (!solved.reachable) targetFbUnreachable = true;
    } else if (portMode === 'area_from_length') {
      effectivePortLength = Math.max(20, params.portLength);
      const solved = solvePortAreaForTargetFb(
        params.targetTuningHz || 35,
        effectivePortLength,
        endFactor,
        baseAvailableL,
        (areaCm2) => {
          const dia = Math.max(20, 20 * Math.sqrt((areaCm2 / params.portCount) / Math.PI));
          const ev = evalRoundDisp(dia, effectivePortLength);
          return ev.airL + ev.woodL;
        },
      );
      effectivePortDiameter = Math.max(
        20,
        20 * Math.sqrt((solved.areaCm2 / params.portCount) / Math.PI),
      );
      if (!solved.reachable) targetFbUnreachable = true;
    }

    const rCm = effectivePortDiameter / 20;
    portAreaCm2 = Math.PI * rCm * rCm * params.portCount;
    const disp = evalRoundDisp(effectivePortDiameter, effectivePortLength);
    portAirVolumeL = disp.airL;
    portWoodVolumeL = disp.woodL;

    const portTotal = portAirVolumeL + portWoodVolumeL;
    netVolumeL = Math.max(0, baseAvailableL - portTotal);

    tuningHz = calculateHelmholtzFb(netVolumeL, portAreaCm2, effectivePortLength, endFactor);

    const maxPortRunMm =
      effectivePortFace === 'top'
        ? internalHeight + portMountThickness - 40
        : effectivePortFace === 'side_left' || effectivePortFace === 'side_right'
          ? internalWidth + portMountThickness - 40
          : internalDepth + portMountThickness - 40;

    if (effectivePortLength > maxPortRunMm) {
      issues.push({
        id: 'round-port-fit',
        severity: 'error',
        message: isEn
          ? `Port tube length (${Math.round(effectivePortLength)} mm) exceeds mounting axis clearance (${Math.max(0, Math.round(maxPortRunMm))} mm).`
          : `Długość rury (${Math.round(effectivePortLength)} mm) przekracza wymiar roboczy osi montażu (${Math.max(0, Math.round(maxPortRunMm))} mm).`,
      });
    }

    // Compute exact 2D round port layout on active portFace + bounds
    const wallW =
      effectivePortFace === 'front' || effectivePortFace === 'top'
        ? internalWidth
        : internalDepth;
    const wallH =
      effectivePortFace === 'top'
        ? internalDepth
        : internalHeight;

    const requestedOrient = params.portOrientation ?? 'auto';
    const orient: 'vertical' | 'horizontal' =
      requestedOrient === 'auto'
        ? (effectivePortFace === 'top' && effectiveDriverFace === 'front') ||
          effectivePortFace === 'side_left' ||
          effectivePortFace === 'side_right'
          ? 'horizontal'
          : 'vertical'
        : requestedOrient;

    const portDia = effectivePortDiameter;
    const portR = portDia / 2;
    const axisSpan = orient === 'vertical' ? wallH : wallW;
    const rawGap =
      params.portCount <= 1 ? 0 : (axisSpan - params.portCount * portDia) / (params.portCount + 1);
    const gap =
      params.portCount <= 1
        ? 0
        : Math.max(8, Math.min(rawGap > 0 ? rawGap : 8, portDia * 0.35));
    const totalSpan = params.portCount * portDia + (params.portCount - 1) * gap;

    const isRightAnchored =
      effectivePortFace === 'front' ||
      (effectivePortFace === 'top' && effectiveDriverFace === 'top');

    const anchorU = isRightAnchored
      ? wallW / 2 - (orient === 'horizontal' ? totalSpan / 2 : portR) - 16
      : 0;
    const anchorV = 0;

    const halfClusterU = orient === 'horizontal' ? totalSpan / 2 : portR;
    const halfClusterV = orient === 'vertical' ? totalSpan / 2 : portR;

    const rawMinX = Math.round(-wallW / 2 + halfClusterU + 8 - anchorU);
    const rawMaxX = Math.round(wallW / 2 - halfClusterU - 8 - anchorU);
    const rawMinY = Math.round(-wallH / 2 + halfClusterV + 8 - anchorV);
    const rawMaxY = Math.round(wallH / 2 - halfClusterV - 8 - anchorV);

    portMinX = Math.min(rawMinX, rawMaxX);
    portMaxX = Math.max(rawMinX, rawMaxX);
    portMinY = Math.min(rawMinY, rawMaxY);
    portMaxY = Math.max(rawMinY, rawMaxY);

    const centerU = anchorU + (params.portOffsetX ?? 0);
    const centerV = anchorV + (params.portOffsetY ?? 0);

    roundPortLayout = [];
    let portsFitWall = true;
    for (let i = 0; i < params.portCount; i++) {
      const delta = -totalSpan / 2 + portR + i * (portDia + gap);
      const u = orient === 'horizontal' ? centerU + delta : centerU;
      const v = orient === 'vertical' ? centerV + delta : centerV;
      roundPortLayout.push({ x: u, y: v });
      if (Math.abs(u) + portR > wallW / 2 - 5 || Math.abs(v) + portR > wallH / 2 - 5) {
        portsFitWall = false;
      }
    }

    if (!portsFitWall) {
      issues.push({
        id: 'round-port-wall-fit',
        severity: 'error',
        message: isEn
          ? `Round port Ø${Math.round(effectivePortDiameter)} mm (${params.portCount}×) extends beyond panel edge — adjust position or diameter.`
          : `Rura Ø${Math.round(effectivePortDiameter)} mm (${params.portCount}×) wykracza poza krawędź ściany — skoryguj pozycję lub średnicę.`,
      });
    }
  } else if (params.enclosureType === 'bandpass_4th') {
    const dividerVolL = (internalHeight * internalDepth * t) / 1_000_000;
    const availableL = Math.max(0, grossVolumeL - dividerVolL - params.bracingVolumeL);
    const frontGrossL = availableL * params.bandpassFrontRatio;
    const rearGrossL = availableL * (1 - params.bandpassFrontRatio);
    const frontChamberWidth = Math.max(40, (internalWidth - t) * params.bandpassFrontRatio);

    const evalBpFront = (pw: number, plen: number) => {
      const sp = computeSlotPortGeometry(
        frontChamberWidth,
        internalHeight,
        internalDepth,
        t,
        pw,
        effectivePortHeight,
        plen,
        frontThickness,
        40,
      );
      const internalAirLen = Math.max(0, sp.totalLength - frontThickness);
      const airL = (sp.width * sp.height * internalAirLen) / 1_000_000;
      const woodL = ((sp.baffle1Length + sp.baffle2Length) * effectivePortHeight * t) / 1_000_000;
      return { sp, airL, woodL };
    };

    if (portMode === 'tuning') {
      const targetArea = Math.max(15, params.targetPortAreaCm2 || 180);
      effectivePortWidth = Math.max(10, (targetArea * 100) / Math.max(20, effectivePortHeight));
      const solved = solvePortLengthForTargetFb(
        params.targetTuningHz || 55,
        (effectivePortWidth * effectivePortHeight) / 100,
        1.85,
        frontGrossL,
        (lenMm) => {
          const ev = evalBpFront(effectivePortWidth, lenMm);
          return ev.airL + ev.woodL;
        },
      );
      effectivePortLength = solved.lengthMm;
      if (!solved.reachable) targetFbUnreachable = true;
    } else if (portMode === 'area_from_length') {
      effectivePortLength = Math.max(20, params.portLength);
      const solved = solvePortAreaForTargetFb(
        params.targetTuningHz || 55,
        effectivePortLength,
        1.85,
        frontGrossL,
        (areaCm2) => {
          const pw = Math.max(10, (areaCm2 * 100) / Math.max(20, effectivePortHeight));
          const ev = evalBpFront(pw, effectivePortLength);
          return ev.airL + ev.woodL;
        },
      );
      effectivePortWidth = Math.max(10, (solved.areaCm2 * 100) / Math.max(20, effectivePortHeight));
      if (!solved.reachable) targetFbUnreachable = true;
    }

    const finalFront = evalBpFront(effectivePortWidth, effectivePortLength);
    slotPort = finalFront.sp;
    portAreaCm2 = (slotPort.width * slotPort.height) / 100;
    portAirVolumeL = finalFront.airL;
    portWoodVolumeL = finalFront.woodL;

    ventedChamberNetL = Math.max(0, frontGrossL - portAirVolumeL - portWoodVolumeL);
    sealedChamberNetL = Math.max(0, rearGrossL - totalDriverDisplacementL);
    netVolumeL = ventedChamberNetL + sealedChamberNetL;

    const vasTotal = params.driverVas * params.driverCount;
    const alphaRear = sealedChamberNetL > 0.5 ? vasTotal / sealedChamberNetL : 8;
    sealedQtc = params.driverQts * Math.sqrt(1 + alphaRear);
    sealedFcHz = params.driverFs * Math.sqrt(1 + alphaRear);
    tuningHz = calculateHelmholtzFb(ventedChamberNetL, portAreaCm2, slotPort.totalLength, 1.85);
  } else if (params.enclosureType === 'bandpass_6th') {
    const dividerVolL = (internalHeight * internalDepth * t) / 1_000_000;
    const availableL = Math.max(0, grossVolumeL - dividerVolL - params.bracingVolumeL);
    const frontGrossL = availableL * params.bandpassFrontRatio;
    const rearGrossL = availableL * (1 - params.bandpassFrontRatio);

    const frontChamberWidth = Math.max(40, (internalWidth - t) * params.bandpassFrontRatio);
    const rearChamberWidth = Math.max(40, (internalWidth - t) * (1 - params.bandpassFrontRatio));

    const evalBpChamber = (chamberW: number, portH: number, pw: number, plen: number) => {
      const sp = computeSlotPortGeometry(
        chamberW,
        internalHeight,
        internalDepth,
        t,
        pw,
        portH,
        plen,
        frontThickness,
        36,
      );
      const airLen = Math.max(0, sp.totalLength - frontThickness);
      const airL = (sp.width * sp.height * airLen) / 1_000_000;
      const woodL = ((sp.baffle1Length + sp.baffle2Length) * portH * t) / 1_000_000;
      return { sp, airL, woodL };
    };

    if (portMode === 'tuning') {
      const targetArea = Math.max(15, params.targetPortAreaCm2 || 180);
      effectivePortWidth = Math.max(10, (targetArea * 100) / Math.max(20, effectivePortHeight));
      const solvedFront = solvePortLengthForTargetFb(
        params.targetTuningHz || 60,
        (effectivePortWidth * effectivePortHeight) / 100,
        1.85,
        frontGrossL,
        (lenMm) => {
          const ev = evalBpChamber(frontChamberWidth, effectivePortHeight, effectivePortWidth, lenMm);
          return ev.airL + ev.woodL;
        },
      );
      effectivePortLength = solvedFront.lengthMm;
      if (!solvedFront.reachable) targetFbUnreachable = true;

      const targetRearArea = Math.max(15, params.targetRearPortAreaCm2 || 160);
      effectiveRearPortWidth = Math.max(
        10,
        (targetRearArea * 100) / Math.max(20, effectiveRearPortHeight),
      );
      const rearAvailable = Math.max(0, rearGrossL - totalDriverDisplacementL);
      const solvedRear = solvePortLengthForTargetFb(
        params.targetRearTuningHz || 30,
        (effectiveRearPortWidth * effectiveRearPortHeight) / 100,
        1.85,
        rearAvailable,
        (lenMm) => {
          const ev = evalBpChamber(
            rearChamberWidth,
            effectiveRearPortHeight,
            effectiveRearPortWidth,
            lenMm,
          );
          return ev.airL + ev.woodL;
        },
      );
      effectiveRearPortLength = solvedRear.lengthMm;
      if (!solvedRear.reachable) targetFbUnreachable = true;
    } else if (portMode === 'area_from_length') {
      effectivePortLength = Math.max(20, params.portLength);
      const solvedFront = solvePortAreaForTargetFb(
        params.targetTuningHz || 60,
        effectivePortLength,
        1.85,
        frontGrossL,
        (areaCm2) => {
          const pw = Math.max(10, (areaCm2 * 100) / Math.max(20, effectivePortHeight));
          const ev = evalBpChamber(frontChamberWidth, effectivePortHeight, pw, effectivePortLength);
          return ev.airL + ev.woodL;
        },
      );
      effectivePortWidth = Math.max(
        10,
        (solvedFront.areaCm2 * 100) / Math.max(20, effectivePortHeight),
      );
      if (!solvedFront.reachable) targetFbUnreachable = true;

      effectiveRearPortLength = Math.max(20, params.portRearLength);
      const rearAvailable = Math.max(0, rearGrossL - totalDriverDisplacementL);
      const solvedRear = solvePortAreaForTargetFb(
        params.targetRearTuningHz || 30,
        effectiveRearPortLength,
        1.85,
        rearAvailable,
        (areaCm2) => {
          const pw = Math.max(10, (areaCm2 * 100) / Math.max(20, effectiveRearPortHeight));
          const ev = evalBpChamber(
            rearChamberWidth,
            effectiveRearPortHeight,
            pw,
            effectiveRearPortLength,
          );
          return ev.airL + ev.woodL;
        },
      );
      effectiveRearPortWidth = Math.max(
        10,
        (solvedRear.areaCm2 * 100) / Math.max(20, effectiveRearPortHeight),
      );
      if (!solvedRear.reachable) targetFbUnreachable = true;
    }

    const frontRes = evalBpChamber(
      frontChamberWidth,
      effectivePortHeight,
      effectivePortWidth,
      effectivePortLength,
    );
    slotPort = frontRes.sp;
    portAreaCm2 = (slotPort.width * slotPort.height) / 100;
    const frontAirL = frontRes.airL;
    const frontWoodL = frontRes.woodL;

    const rearRes = evalBpChamber(
      rearChamberWidth,
      effectiveRearPortHeight,
      effectiveRearPortWidth,
      effectiveRearPortLength,
    );
    rearSlotPort = rearRes.sp;
    rearPortAreaCm2 = (rearSlotPort.width * rearSlotPort.height) / 100;
    const rearAirL = rearRes.airL;
    const rearWoodL = rearRes.woodL;

    portAirVolumeL = frontAirL + rearAirL;
    portWoodVolumeL = frontWoodL + rearWoodL;

    ventedChamberNetL = Math.max(0, frontGrossL - frontAirL - frontWoodL);
    sealedChamberNetL = Math.max(0, rearGrossL - rearAirL - rearWoodL - totalDriverDisplacementL);
    netVolumeL = ventedChamberNetL + sealedChamberNetL;

    tuningHz = calculateHelmholtzFb(ventedChamberNetL, portAreaCm2, slotPort.totalLength, 1.85);
    rearPortTuningHz = calculateHelmholtzFb(
      sealedChamberNetL,
      rearPortAreaCm2,
      rearSlotPort.totalLength,
      1.85,
    );

    if (!slotPort.fitsInside || !rearSlotPort.fitsInside) {
      issues.push({
        id: 'bp6-port-overflow',
        severity: 'error',
        message: isEn
          ? 'One of the 6th-order Bandpass ports is too long or wide for its chamber.'
          : 'Jeden z tuneli Bandpass 6-go rzędu jest zbyt długi lub za szeroki względem komory.',
      });
    }
  }

  if (targetFbUnreachable) {
    issues.push({
      id: 'target-fb-unreachable',
      severity: 'warning',
      message: isEn
        ? `Target tuning Fb (${params.targetTuningHz} Hz) is outside physical bounds for the current volume and port area.`
        : `Docelowe strojenie Fb (${params.targetTuningHz} Hz) jest poza zakresem fizycznym przy obecnej objętości i polu portu.`,
    });
  }

  const portTotalDisplacementL = portAirVolumeL + portWoodVolumeL;

  // Driver panel dimensions + base reservation anchor
  const panelW = isBandpass ? internalDepth : internalWidth;
  const panelH = effectiveDriverFace === 'top' ? internalDepth : internalHeight;

  let usableW = panelW;
  let usableH = panelH;
  let baseCenterX = 0;
  let baseCenterY = 0;

  if (!isBandpass) {
    if (params.enclosureType === 'vented_slot') {
      if (slotSide === 'right') {
        const reserved = effectivePortWidth + t;
        usableW = Math.max(40, panelW - reserved);
        baseCenterX = -reserved / 2;
      } else if (slotSide === 'left') {
        const reserved = effectivePortWidth + t;
        usableW = Math.max(40, panelW - reserved);
        baseCenterX = reserved / 2;
      } else if (slotSide === 'bottom' && effectiveDriverFace === 'front') {
        const reserved = effectivePortWidth + t;
        usableH = Math.max(40, panelH - reserved);
        baseCenterY = reserved / 2;
      }
    } else if (params.enclosureType === 'vented_round' && effectivePortFace === effectiveDriverFace) {
      const reserved = effectivePortDiameter + 20;
      usableW = Math.max(40, panelW - reserved);
      baseCenterX = -reserved / 2;
    }
  }

  const layoutRes = computeDriverGridLayout(
    params.driverCount,
    usableW,
    usableH,
    params.driverOuterDia,
    params.driverPattern ?? 'auto',
    lang,
  );

  // Compute allowed X/Y translation bounds for the active driver cluster inside panelW x panelH
  const drvR = params.driverOuterDia / 2;
  const minRelX = Math.min(...layoutRes.positions.map((p) => p.x));
  const maxRelX = Math.max(...layoutRes.positions.map((p) => p.x));
  const minRelY = Math.min(...layoutRes.positions.map((p) => p.y));
  const maxRelY = Math.max(...layoutRes.positions.map((p) => p.y));

  const rawDrvMinX = Math.round(-panelW / 2 + drvR + 5 - minRelX - baseCenterX);
  const rawDrvMaxX = Math.round(panelW / 2 - drvR - 5 - maxRelX - baseCenterX);
  const rawDrvMinY = Math.round(-panelH / 2 + drvR + 5 - minRelY - baseCenterY);
  const rawDrvMaxY = Math.round(panelH / 2 - drvR - 5 - maxRelY - baseCenterY);

  const offsetX = params.driverOffsetX ?? 0;
  const offsetY = params.driverOffsetY ?? 0;

  const driverLayout = layoutRes.positions.map((p) => ({
    x: baseCenterX + offsetX + p.x,
    y: baseCenterY + offsetY + p.y,
  }));

  // Exact panel & port collision detection on final translated driverLayout
  let fitsPanelWall = true;
  let hitsPort = false;

  for (const pos of driverLayout) {
    if (
      Math.abs(pos.x) + drvR > panelW / 2 - 3.5 ||
      Math.abs(pos.y) + drvR > panelH / 2 - 3.5
    ) {
      fitsPanelWall = false;
    }

    if (!isBandpass && params.enclosureType === 'vented_slot') {
      if (effectiveDriverFace === 'front') {
        if (slotSide === 'right') {
          const rxMin = internalWidth / 2 - effectivePortWidth - t;
          const ryMax = params.portFullHeight ? internalHeight / 2 : -internalHeight / 2 + effectivePortHeight + t;
          if (circleIntersectsRect(pos.x, pos.y, drvR + 2, rxMin, internalWidth / 2, -internalHeight / 2, ryMax)) {
            hitsPort = true;
          }
        } else if (slotSide === 'left') {
          const rxMax = -internalWidth / 2 + effectivePortWidth + t;
          const ryMax = params.portFullHeight ? internalHeight / 2 : -internalHeight / 2 + effectivePortHeight + t;
          if (circleIntersectsRect(pos.x, pos.y, drvR + 2, -internalWidth / 2, rxMax, -internalHeight / 2, ryMax)) {
            hitsPort = true;
          }
        } else if (slotSide === 'bottom') {
          const rxMin = params.portFullHeight ? -internalWidth / 2 : internalWidth / 2 - effectivePortHeight - t;
          const ryMax = -internalHeight / 2 + effectivePortWidth + t;
          if (circleIntersectsRect(pos.x, pos.y, drvR + 2, rxMin, internalWidth / 2, -internalHeight / 2, ryMax)) {
            hitsPort = true;
          }
        }
      } else if (effectiveDriverFace === 'top' && params.portFullHeight) {
        if (slotSide === 'right') {
          const rxMin = internalWidth / 2 - effectivePortWidth - t;
          if (circleIntersectsRect(pos.x, pos.y, drvR + 2, rxMin, internalWidth / 2, -internalDepth / 2, internalDepth / 2)) {
            hitsPort = true;
          }
        } else if (slotSide === 'left') {
          const rxMax = -internalWidth / 2 + effectivePortWidth + t;
          if (circleIntersectsRect(pos.x, pos.y, drvR + 2, -internalWidth / 2, rxMax, -internalDepth / 2, internalDepth / 2)) {
            hitsPort = true;
          }
        }
      }
    } else if (
      !isBandpass &&
      params.enclosureType === 'vented_round' &&
      effectivePortFace === effectiveDriverFace
    ) {
      const portR = effectivePortDiameter / 2;
      for (const rp of roundPortLayout) {
        if (Math.hypot(pos.x - rp.x, pos.y - rp.y) < drvR + portR + 6) {
          hitsPort = true;
        }
      }
    }
  }

  const driverFitsFront = fitsPanelWall && !hitsPort && layoutRes.positions.length === params.driverCount;

  const driverClearanceMm = isBandpass
    ? Math.round((internalWidth - t) * (1 - params.bandpassFrontRatio) - params.driverDepth)
    : effectiveDriverFace === 'top'
      ? Math.round(internalHeight + topThickness - params.driverDepth)
      : Math.round(internalDepth + frontThickness - params.driverDepth);

  if (hitsPort) {
    issues.push({
      id: 'driver-port-collision',
      severity: 'error',
      message: isEn
        ? 'Driver collides with the port — move the driver or reposition the port.'
        : 'Głośnik koliduje z portem — przesuń głośnik lub zmień położenie portu/rury.',
    });
  } else if (!fitsPanelWall) {
    const faceLabel = isEn
      ? effectiveDriverFace === 'top'
        ? 'top panel'
        : effectiveDriverFace === 'divider'
          ? 'internal divider'
          : 'front baffle'
      : effectiveDriverFace === 'top'
        ? 'górnej'
        : effectiveDriverFace === 'divider'
          ? 'wewnętrznej'
          : 'przedniej';
    issues.push({
      id: 'driver-front-fit',
      severity: 'error',
      message: isEn
        ? `${params.driverCount}× driver does not fit on the ${faceLabel} (increase dimensions, adjust offset, or change layout).`
        : `${params.driverCount}× głośnik nie mieści się na płycie ${faceLabel} (zwiększ wymiary, przesuń lub zmień układ).`,
    });
  }

  if (driverClearanceMm < 20) {
    issues.push({
      id: 'driver-depth-fit',
      severity: 'error',
      message: isEn
        ? `Driver magnet collides with rear wall (clearance: ${driverClearanceMm} mm, recommended min. 20 mm).`
        : `Magnes głośnika koliduje ze ścianą (luz: ${driverClearanceMm} mm, zalecane min. 20 mm).`,
    });
  }

  if (netVolumeL <= 2) {
    issues.push({
      id: 'net-vol-zero',
      severity: 'error',
      message: isEn
        ? 'Net volume is negative or near zero. Increase enclosure dimensions or shorten the port.'
        : 'Objętość netto jest ujemna lub bliska zeru. Zwiększ wymiary obudowy lub skróć port.',
    });
  }

  // Port velocity & recommendations
  const activeVelArea =
    params.enclosureType === 'bandpass_6th'
      ? Math.min(portAreaCm2 || 9999, rearPortAreaCm2 || 9999)
      : portAreaCm2;
  const portVelocityMs =
    tuningHz && activeVelArea > 0
      ? estimatePortVelocityMs(
          params.driverCount,
          params.driverCutoutDia,
          params.driverXmax,
          tuningHz,
          activeVelArea,
        )
      : 0;

  let portVelocityStatus: AcousticResult['portVelocityStatus'] = 'na';
  if (params.enclosureType !== 'sealed' && tuningHz) {
    if (portVelocityMs < 17) portVelocityStatus = 'ideal';
    else if (portVelocityMs <= 25) portVelocityStatus = 'acceptable';
    else {
      portVelocityStatus = 'chuffing';
      issues.push({
        id: 'port-chuffing',
        severity: 'warning',
        message: isEn
          ? `High port air velocity (${portVelocityMs.toFixed(1)} m/s) — audible port chuffing likely. Increase port cross-sectional area.`
          : `Wysoka prędkość powietrza w porcie (${portVelocityMs.toFixed(1)} m/s) — możliwe słyszalne świsty (port noise). Powiększ przekrój portu.`,
      });
    }
  }

  const recommendedMinPortAreaCm2 = Math.round(
    Math.max(40, params.driverCount * (params.driverPowerW / 12 + params.driverXmax * 3.5)),
  );

  const { curve, f3Low, f3High } = generateResponseCurve(
    params,
    isBandpass ? ventedChamberNetL : netVolumeL,
    tuningHz,
    rearPortTuningHz,
    sealedQtc,
    sealedFcHz,
    portAreaCm2,
    rearPortAreaCm2,
  );

  const portAreaPerLiterCm2 = netVolumeL > 0.1 && portAreaCm2 > 0 ? portAreaCm2 / netVolumeL : 0;

  return {
    effectiveExternalWidth: extW,
    effectiveExternalHeight: extH,
    effectiveExternalDepth: extD,
    internalWidth,
    internalHeight,
    internalDepth,
    effectivePortWidth,
    effectivePortDiameter,
    effectivePortLength,
    effectivePortHeight,
    effectiveRearPortWidth,
    effectiveRearPortLength,
    effectiveRearPortHeight,
    grossVolumeL,
    portAirVolumeL,
    portWoodVolumeL,
    portTotalDisplacementL,
    totalDriverDisplacementL,
    netVolumeL,
    sealedChamberNetL,
    ventedChamberNetL,
    rearPortTuningHz,
    rearPortAreaCm2,
    rearSlotPort,
    portAreaCm2,
    portAreaPerLiterCm2,
    tuningHz,
    sealedFcHz,
    sealedQtc,
    f3LowHz: f3Low,
    f3HighHz: f3High,
    portVelocityMs,
    portVelocityStatus,
    recommendedMinPortAreaCm2,
    slotPort,
    driverLayout,
    driverLayoutLabel: layoutRes.patternLabel,
    roundPortLayout,
    offsetBounds: {
      driverMinX: Math.min(rawDrvMinX, rawDrvMaxX),
      driverMaxX: Math.max(rawDrvMinX, rawDrvMaxX),
      driverMinY: Math.min(rawDrvMinY, rawDrvMaxY),
      driverMaxY: Math.max(rawDrvMinY, rawDrvMaxY),
      portMinX,
      portMaxX,
      portMinY,
      portMaxY,
    },
    driverFitsFront,
    driverClearanceMm,
    responseCurve: curve,
    issues,
  };
}

export function calculateAcoustics(params: BoxParams, lang: AppLanguage = 'pl'): AcousticResult {
  const isEn = lang === 'en';
  const autoField = params.boxAutoCalcField ?? 'none';
  if (autoField === 'none') {
    return evaluateEnclosureCore(
      params,
      params.externalWidth,
      params.externalHeight,
      params.externalDepth,
      lang,
    );
  }

  const t = Math.max(6, params.thickness);
  const { effectiveDriverFace } = resolveEffectiveFaces(params);
  const frontThickness =
    params.doubleFrontBaffle && effectiveDriverFace !== 'top' ? t * 2 : t;
  const topThickness =
    params.doubleFrontBaffle && effectiveDriverFace === 'top' ? t * 2 : t;

  const targetNetL = Math.max(4, params.targetNetVolumeL || 40);
  const minDim =
    autoField === 'width'
      ? 2 * t + 60
      : autoField === 'height'
        ? t + topThickness + 60
        : t + frontThickness + 60;
  const maxDim = 3200;

  const evalWithDim = (val: number) =>
    evaluateEnclosureCore(
      params,
      autoField === 'width' ? val : params.externalWidth,
      autoField === 'height' ? val : params.externalHeight,
      autoField === 'depth' ? val : params.externalDepth,
      lang,
    );

  const atMin = evalWithDim(minDim);
  if (atMin.netVolumeL >= targetNetL) {
    if (Math.abs(atMin.netVolumeL - targetNetL) > 0.5) {
      atMin.issues.push({
        id: 'target-netvol-unreachable',
        severity: 'warning',
        message: isEn
          ? `Target net volume (${targetNetL.toFixed(1)} L) is smaller than minimum enclosure size.`
          : `Docelowa objętość netto (${targetNetL.toFixed(1)} L) jest mniejsza niż minimalny gabaryt płyty.`,
      });
    }
    return atMin;
  }

  const atMax = evalWithDim(maxDim);
  if (atMax.netVolumeL < targetNetL) {
    atMax.issues.push({
      id: 'target-netvol-unreachable',
      severity: 'error',
      message: isEn
        ? `Target net volume (${targetNetL.toFixed(1)} L) requires a dimension exceeding ${maxDim} mm.`
        : `Docelowa objętość netto (${targetNetL.toFixed(1)} L) wymaga wymiaru powyżej ${maxDim} mm.`,
    });
    return atMax;
  }

  let lo = minDim;
  let hi = maxDim;
  for (let i = 0; i < 34; i++) {
    const mid = 0.5 * (lo + hi);
    const res = evalWithDim(mid);
    if (res.netVolumeL < targetNetL) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return evalWithDim(0.5 * (lo + hi));
}
