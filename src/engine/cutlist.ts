import { resolveEffectiveFaces } from './acoustics';
import type { AcousticResult, BoxParams, CutSheetSummary, PanelCut, PlacedPanel } from './types';

export function generateCutList(params: BoxParams, acoustics: AcousticResult): PanelCut[] {
  const W = Math.round(acoustics.effectiveExternalWidth);
  const H = Math.round(acoustics.effectiveExternalHeight);
  const D = Math.round(acoustics.effectiveExternalDepth);
  const t = params.thickness;
  const panels: PanelCut[] = [];

  const { isBandpass, effectiveDriverFace, effectivePortFace } = resolveEffectiveFaces(params);
  const doubleOnFront = params.doubleFrontBaffle && !isBandpass && effectiveDriverFace === 'front';
  const doubleOnTop = params.doubleFrontBaffle && !isBandpass && effectiveDriverFace === 'top';

  let topBottomW = W;
  let topBottomD = D;
  let sideW = D;
  let sideH = H - 2 * t;
  let frontBackW = W - 2 * t;
  let frontBackH = H - 2 * t;

  if (params.joineryType === 'sides_full') {
    sideW = D;
    sideH = H;
    topBottomW = W - 2 * t;
    topBottomD = D;
    frontBackW = W - 2 * t;
    frontBackH = H - 2 * t;
  } else if (params.joineryType === 'front_back_cover') {
    frontBackW = W;
    frontBackH = H;
    topBottomW = W;
    topBottomD = D - (doubleOnFront ? 3 * t : 2 * t);
    sideW = D - (doubleOnFront ? 3 * t : 2 * t);
    sideH = H - 2 * t;
  } else {
    topBottomW = W;
    topBottomD = D;
    sideW = D;
    sideH = H - 2 * t;
    frontBackW = W - 2 * t;
    frontBackH = H - 2 * t;
  }

  const pushPanel = (
    id: string,
    name: string,
    quantity: number,
    width: number,
    height: number,
    notes: string,
    category: PanelCut['category'],
  ) => {
    const safeW = Math.max(1, Math.round(width));
    const safeH = Math.max(1, Math.round(height));
    panels.push({
      id,
      name,
      quantity,
      width: safeW,
      height: safeH,
      thickness: t,
      areaM2: (safeW * safeH * quantity) / 1_000_000,
      notes,
      category,
    });
  };

  const driverText =
    params.driverCount > 1
      ? `${params.driverCount}× otwór Ø${params.driverCutoutDia} mm (${acoustics.driverLayoutLabel})`
      : `Otwór Ø${params.driverCutoutDia} mm`;

  const effPortW = Math.round(acoustics.effectivePortWidth);
  const effRearPortW = Math.round(acoustics.effectiveRearPortWidth);
  const effPortDia = Math.round(acoustics.effectivePortDiameter);
  const roundPortText = `${params.portCount}× rura Ø${effPortDia} mm`;

  // Top & Bottom (split if top has driver or port cutouts)
  const topHasDriver = effectiveDriverFace === 'top';
  const topHasPort = effectivePortFace === 'top';

  if (topHasDriver || topHasPort) {
    const topNotesParts: string[] = [];
    if (topHasDriver) topNotesParts.push(driverText);
    if (topHasPort) topNotesParts.push(roundPortText);
    const topNotes = topNotesParts.join(' + ');

    pushPanel(
      'top',
      topHasDriver ? 'Góra (Płyta głośnikowa)' : 'Góra (z otworami portu)',
      1,
      topBottomW,
      topBottomD,
      topNotes,
      topHasDriver ? 'baffle' : 'enclosure',
    );

    if (doubleOnTop) {
      pushPanel(
        'top-double',
        'Góra — Druga warstwa wzmacniająca',
        1,
        acoustics.internalWidth,
        acoustics.internalDepth,
        topNotes,
        'baffle',
      );
    }

    pushPanel('bottom', 'Dół (Podstawa)', 1, topBottomW, topBottomD, 'Pełna płyta', 'enclosure');
  } else {
    pushPanel(
      'top-bottom',
      'Góra i Dół (Wieńce)',
      2,
      topBottomW,
      topBottomD,
      'Bez otworów',
      'enclosure',
    );
  }

  // Left & Right Sides (split if a side carries round port cutouts)
  if (effectivePortFace === 'side_right' || effectivePortFace === 'side_left') {
    pushPanel(
      'side-left',
      'Bok lewy',
      1,
      sideW,
      sideH,
      effectivePortFace === 'side_left' ? roundPortText : 'Pod terminal głośnikowy (opcjonalnie)',
      'enclosure',
    );
    pushPanel(
      'side-right',
      'Bok prawy',
      1,
      sideW,
      sideH,
      effectivePortFace === 'side_right' ? roundPortText : 'Pod terminal głośnikowy (opcjonalnie)',
      'enclosure',
    );
  } else {
    pushPanel(
      'sides',
      'Boki (Lewy + Prawy)',
      2,
      sideW,
      sideH,
      'Pod terminal głośnikowy (opcjonalnie)',
      'enclosure',
    );
  }

  // Front Panel notes
  const slotSide = params.portSlotSide ?? 'right';
  const slotSideLabel =
    slotSide === 'left' ? 'lewy bok' : slotSide === 'bottom' ? 'dół' : 'prawy bok';

  let frontNotes = '';
  if (params.enclosureType === 'bandpass_4th') {
    frontNotes = `Szyba inspekcyjna + port ${effPortW} × ${Math.round(acoustics.effectivePortHeight)} mm`;
  } else if (params.enclosureType === 'bandpass_6th') {
    frontNotes = `Port przód ${effPortW}×${Math.round(acoustics.effectivePortHeight)} + port tył ${effRearPortW}×${Math.round(acoustics.effectiveRearPortHeight)} mm`;
  } else {
    const frontParts: string[] = [];
    if (effectiveDriverFace === 'front') frontParts.push(driverText);
    if (params.enclosureType === 'vented_slot') {
      frontParts.push(
        slotSide === 'bottom'
          ? `port dolny ${Math.round(acoustics.effectivePortHeight)}×${effPortW} mm`
          : `port (${slotSideLabel}) ${effPortW}×${Math.round(acoustics.effectivePortHeight)} mm`,
      );
    } else if (effectivePortFace === 'front') {
      frontParts.push(roundPortText);
    }
    frontNotes = frontParts.length > 0 ? frontParts.join(' + ') : 'Pełna płyta (głośniki na górze)';
  }

  pushPanel(
    'front',
    isBandpass
      ? 'Front (z szybą inspekcyjną)'
      : effectiveDriverFace === 'front'
        ? 'Front (Płyta głośnikowa)'
        : 'Front (Ściana przednia)',
    1,
    frontBackW,
    frontBackH,
    frontNotes,
    effectiveDriverFace === 'front' || isBandpass ? 'baffle' : 'enclosure',
  );

  if (doubleOnFront) {
    pushPanel(
      'front-double',
      'Front — Druga warstwa wzmacniająca',
      1,
      frontBackW,
      frontBackH,
      frontNotes,
      'baffle',
    );
  }

  pushPanel('back', 'Tył (Ściana tylna)', 1, frontBackW, frontBackH, 'Pełna płyta', 'enclosure');

  // Primary / Front slot port baffles
  if ((params.enclosureType === 'vented_slot' || isBandpass) && acoustics.slotPort) {
    const portH = Math.round(acoustics.effectivePortHeight);
    const isBottomSlot = !isBandpass && slotSide === 'bottom';
    if (acoustics.slotPort.baffle1Length > 1) {
      pushPanel(
        'port-1',
        isBandpass
          ? 'Przegroda portu przód 1 (Wzdłużna)'
          : isBottomSlot
            ? 'Przegroda portu 1 (Pozioma — dół)'
            : `Przegroda portu 1 (${slotSide === 'left' ? 'Lewa' : 'Prawa'} wzdłużna)`,
        1,
        acoustics.slotPort.baffle1Length,
        portH,
        acoustics.slotPort.isBent ? 'Łączy się z przegrodą 2 pod kątem 90°' : 'Prosty kanał portu',
        'port',
      );
    }
    if (acoustics.slotPort.isBent && acoustics.slotPort.baffle2Length > 1) {
      pushPanel(
        'port-2',
        isBandpass ? 'Przegroda portu przód 2 (Zagięcie L)' : 'Przegroda portu 2 (Tylna — zagięcie L)',
        1,
        acoustics.slotPort.baffle2Length,
        portH,
        'Równoległa do ściany tylnej',
        'port',
      );
    }
    if (!params.portFullHeight) {
      pushPanel(
        'port-cap',
        isBottomSlot ? 'Ścianka boczna zamykająca portu' : 'Półka zamykająca portu przód',
        1,
        acoustics.slotPort.baffle1Length,
        effPortW + t,
        isBottomSlot ? 'Boczna ścianka kanału dolnego' : 'Górna ścianka kanału szczelinowego',
        'port',
      );
    }
  }

  // Rear chamber slot port baffles (Bandpass 6th-order)
  if (params.enclosureType === 'bandpass_6th' && acoustics.rearSlotPort) {
    const rearPortH = Math.round(acoustics.effectiveRearPortHeight);
    if (acoustics.rearSlotPort.baffle1Length > 1) {
      pushPanel(
        'rear-port-1',
        'Przegroda portu tył 1 (Komora niska)',
        1,
        acoustics.rearSlotPort.baffle1Length,
        rearPortH,
        acoustics.rearSlotPort.isBent ? 'Kanał tylnej komory zagięty 90°' : 'Prosty kanał tylnej komory',
        'port',
      );
    }
    if (acoustics.rearSlotPort.isBent && acoustics.rearSlotPort.baffle2Length > 1) {
      pushPanel(
        'rear-port-2',
        'Przegroda portu tył 2 (Zagięcie L)',
        1,
        acoustics.rearSlotPort.baffle2Length,
        rearPortH,
        'Równoległa do ściany tylnej',
        'port',
      );
    }
    if (!params.portRearFullHeight) {
      pushPanel(
        'rear-port-cap',
        'Półka zamykająca portu tył',
        1,
        acoustics.rearSlotPort.baffle1Length,
        effRearPortW + t,
        'Górna ścianka tylnego portu',
        'port',
      );
    }
  }

  if (isBandpass) {
    const divW = Math.round(acoustics.internalDepth);
    const divH = Math.round(acoustics.internalHeight);
    pushPanel(
      'bandpass-divider',
      'Przegroda wewnętrzna Bandpass',
      1,
      divW,
      divH,
      `${driverText} (dzieli komory)`,
      'baffle',
    );
  }

  return panels;
}

interface Shelf {
  y: number;
  height: number;
  cursorX: number;
}

export function optimizeCutSheet(params: BoxParams, panels: PanelCut[]): CutSheetSummary {
  const sheetW = Math.max(500, params.sheetWidth);
  const sheetH = Math.max(500, params.sheetHeight);
  const kerf = Math.max(0, params.sawKerf);

  const pieces: Array<{
    panelId: string;
    name: string;
    w: number;
    h: number;
    category: PanelCut['category'];
  }> = [];

  for (const p of panels) {
    for (let i = 0; i < p.quantity; i++) {
      pieces.push({
        panelId: `${p.id}-${i + 1}`,
        name: p.quantity > 1 ? `${p.name} #${i + 1}` : p.name,
        w: p.width,
        h: p.height,
        category: p.category,
      });
    }
  }

  pieces.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));

  const sheets: Shelf[][] = [[]];
  const placedPanels: PlacedPanel[] = [];
  const unplacedPanels: PanelCut[] = [];

  for (const piece of pieces) {
    const candidates: Array<{ w: number; h: number; rotated: boolean }> = [];
    if (piece.w <= sheetW && piece.h <= sheetH) {
      candidates.push({ w: piece.w, h: piece.h, rotated: false });
    }
    if (piece.h <= sheetW && piece.w <= sheetH && piece.w !== piece.h) {
      candidates.push({ w: piece.h, h: piece.w, rotated: true });
    }

    if (candidates.length === 0) {
      unplacedPanels.push({
        id: piece.panelId,
        name: piece.name,
        quantity: 1,
        width: piece.w,
        height: piece.h,
        thickness: params.thickness,
        areaM2: (piece.w * piece.h) / 1_000_000,
        notes: 'Przekracza format arkusza',
        category: piece.category,
      });
      continue;
    }

    candidates.sort((a, b) => a.h - b.h);

    let placed = false;

    for (let sIdx = 0; sIdx < sheets.length && !placed; sIdx++) {
      const shelves = sheets[sIdx];

      for (const shelf of shelves) {
        for (const cand of candidates) {
          if (cand.h <= shelf.height && shelf.cursorX + cand.w <= sheetW) {
            placedPanels.push({
              panelId: piece.panelId,
              name: piece.name,
              x: shelf.cursorX,
              y: shelf.y,
              width: cand.w,
              height: cand.h,
              rotated: cand.rotated,
              sheetIndex: sIdx,
              category: piece.category,
            });
            shelf.cursorX += cand.w + kerf;
            placed = true;
            break;
          }
        }
        if (placed) break;
      }

      if (!placed) {
        const usedY = shelves.reduce((acc, s) => Math.max(acc, s.y + s.height + kerf), 0);
        for (const cand of candidates) {
          if (usedY + cand.h <= sheetH && cand.w <= sheetW) {
            const newShelf: Shelf = {
              y: usedY,
              height: cand.h,
              cursorX: cand.w + kerf,
            };
            shelves.push(newShelf);
            placedPanels.push({
              panelId: piece.panelId,
              name: piece.name,
              x: 0,
              y: usedY,
              width: cand.w,
              height: cand.h,
              rotated: cand.rotated,
              sheetIndex: sIdx,
              category: piece.category,
            });
            placed = true;
            break;
          }
        }
      }
    }

    if (!placed) {
      const cand = candidates[0];
      const newSheetIdx = sheets.length;
      sheets.push([{ y: 0, height: cand.h, cursorX: cand.w + kerf }]);
      placedPanels.push({
        panelId: piece.panelId,
        name: piece.name,
        x: 0,
        y: 0,
        width: cand.w,
        height: cand.h,
        rotated: cand.rotated,
        sheetIndex: newSheetIdx,
        category: piece.category,
      });
    }
  }

  const sheetCount = placedPanels.length > 0 ? Math.max(...placedPanels.map((p) => p.sheetIndex)) + 1 : 0;
  const totalPanelAreaM2 = panels.reduce((sum, p) => sum + p.areaM2, 0);
  const totalSheetAreaM2 = (sheetCount * sheetW * sheetH) / 1_000_000;
  const utilizationPercent = totalSheetAreaM2 > 0 ? (totalPanelAreaM2 / totalSheetAreaM2) * 100 : 0;

  const densityKgM3 = params.material === 'birch_plywood' ? 680 : 750;
  const estimatedWeightKg = totalPanelAreaM2 * (params.thickness / 1000) * densityKgM3;

  return {
    panels,
    placedPanels,
    unplacedPanels,
    sheetCount,
    sheetWidth: sheetW,
    sheetHeight: sheetH,
    totalPanelAreaM2,
    totalSheetAreaM2,
    utilizationPercent,
    estimatedWeightKg,
  };
}
