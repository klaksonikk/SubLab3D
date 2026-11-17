import * as THREE from 'three';
import { resolveEffectiveFaces } from './acoustics';
import type { AcousticResult, BoxParams } from './types';
import type { MaterialBank } from './materials3d';

export const MM_TO_UNITS = 0.01;

export interface ExplodableItem {
  object: THREE.Object3D;
  basePos: THREE.Vector3;
  explodeOffset: THREE.Vector3;
  edges?: THREE.LineSegments;
}

export interface BuiltEnclosure {
  root: THREE.Group;
  explodables: ExplodableItem[];
  boundingSize: THREE.Vector3;
  dispose: () => void;
}

function createPolygonPanelWithHolesGeometry(
  outerContour: Array<{ x: number; y: number }>,
  depth: number,
  circleHoles: Array<{ x: number; y: number; radius: number }>,
  rectHoles: Array<{ x: number; y: number; w: number; h: number }>,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  if (outerContour.length > 0) {
    shape.moveTo(outerContour[0].x, outerContour[0].y);
    for (let i = 1; i < outerContour.length; i++) {
      shape.lineTo(outerContour[i].x, outerContour[i].y);
    }
    shape.closePath();
  }

  for (const ch of circleHoles) {
    const hole = new THREE.Path();
    hole.absarc(ch.x, ch.y, Math.max(0.05, ch.radius), 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }

  for (const rh of rectHoles) {
    const rx0 = rh.x - rh.w / 2;
    const rx1 = rh.x + rh.w / 2;
    const ry0 = rh.y - rh.h / 2;
    const ry1 = rh.y + rh.h / 2;
    const hole = new THREE.Path();
    hole.moveTo(rx0, ry0);
    hole.lineTo(rx0, ry1);
    hole.lineTo(rx1, ry1);
    hole.lineTo(rx1, ry0);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 32,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function createPanelWithHolesGeometry(
  width: number,
  height: number,
  depth: number,
  circleHoles: Array<{ x: number; y: number; radius: number }>,
  rectHoles: Array<{ x: number; y: number; w: number; h: number }>,
): THREE.BufferGeometry {
  const hw = width / 2;
  const hh = height / 2;
  return createPolygonPanelWithHolesGeometry(
    [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ],
    depth,
    circleHoles,
    rectHoles,
  );
}

function buildDriverGroup(
  cutoutDiaUnits: number,
  outerDiaUnits: number,
  depthUnits: number,
  disposables: Array<{ dispose: () => void }>,
): THREE.Group {
  const group = new THREE.Group();
  const rOuter = outerDiaUnits / 2;
  const rCut = cutoutDiaUnits / 2;
  const rSurround = rCut * 0.94;
  const rConeOuter = rCut * 0.78;
  const rDustCap = rCut * 0.31;

  const matFlange = new THREE.MeshStandardMaterial({
    color: 0x1b1e26,
    roughness: 0.42,
    metalness: 0.75,
  });
  const matSurround = new THREE.MeshStandardMaterial({
    color: 0x13151a,
    roughness: 0.85,
    metalness: 0.05,
  });
  const matCone = new THREE.MeshStandardMaterial({
    color: 0x262a34,
    roughness: 0.58,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
  const matDustCap = new THREE.MeshStandardMaterial({
    color: 0x1e222b,
    roughness: 0.34,
    metalness: 0.2,
  });
  const matAccentRing = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    roughness: 0.28,
    metalness: 0.85,
  });
  const matChrome = new THREE.MeshStandardMaterial({
    color: 0xbac4d4,
    roughness: 0.2,
    metalness: 0.94,
  });
  const matFerrite = new THREE.MeshStandardMaterial({
    color: 0x2a2d36,
    roughness: 0.75,
    metalness: 0.22,
  });
  disposables.push(matFlange, matSurround, matCone, matDustCap, matAccentRing, matChrome, matFerrite);

  const flangeShape = new THREE.Shape();
  flangeShape.absarc(0, 0, rOuter, 0, Math.PI * 2, false);
  const flangeHole = new THREE.Path();
  flangeHole.absarc(0, 0, rSurround, 0, Math.PI * 2, true);
  flangeShape.holes.push(flangeHole);
  const flangeGeo = new THREE.ExtrudeGeometry(flangeShape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments: 28,
  });
  disposables.push(flangeGeo);
  group.add(new THREE.Mesh(flangeGeo, matFlange));

  const tubeR = (rSurround - rConeOuter) * 0.52;
  const torusGeo = new THREE.TorusGeometry(rConeOuter + tubeR, tubeR, 12, 32);
  disposables.push(torusGeo);
  const surroundMesh = new THREE.Mesh(torusGeo, matSurround);
  surroundMesh.position.z = 0.08;
  group.add(surroundMesh);

  const coneDepth = Math.min(depthUnits * 0.38, rCut * 0.42);
  const conePts = [
    new THREE.Vector2(rDustCap * 0.85, -coneDepth),
    new THREE.Vector2(rConeOuter * 0.58, -coneDepth * 0.48),
    new THREE.Vector2(rConeOuter, 0.06),
  ];
  const coneGeo = new THREE.LatheGeometry(conePts, 32);
  coneGeo.rotateX(Math.PI / 2);
  disposables.push(coneGeo);
  group.add(new THREE.Mesh(coneGeo, matCone));

  const capGeo = new THREE.SphereGeometry(rDustCap, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.45);
  capGeo.rotateX(Math.PI / 2);
  disposables.push(capGeo);
  const capMesh = new THREE.Mesh(capGeo, matDustCap);
  capMesh.position.z = -coneDepth + rDustCap * 0.15;
  group.add(capMesh);

  const trimGeo = new THREE.TorusGeometry(rOuter * 0.94, 0.02, 8, 32);
  disposables.push(trimGeo);
  const trimMesh = new THREE.Mesh(trimGeo, matAccentRing);
  trimMesh.position.z = 0.14;
  group.add(trimMesh);

  const magRadius = Math.min(rCut * 0.62, Math.max(0.42, depthUnits * 0.44));
  const magHeight = Math.max(0.28, depthUnits * 0.34);
  const topPlateZ = -(depthUnits - magHeight);

  const strutGeo = new THREE.CylinderGeometry(0.04, 0.06, 1, 8);
  disposables.push(strutGeo);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const p1 = new THREE.Vector3(Math.cos(angle) * rCut * 0.88, Math.sin(angle) * rCut * 0.88, 0);
    const p2 = new THREE.Vector3(Math.cos(angle) * magRadius * 0.85, Math.sin(angle) * magRadius * 0.85, topPlateZ);
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    const len = p1.distanceTo(p2);
    const strut = new THREE.Mesh(strutGeo, matFlange);
    strut.position.copy(mid);
    strut.scale.set(1, len, 1);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
    group.add(strut);
  }

  const plateGeo = new THREE.CylinderGeometry(magRadius * 0.95, magRadius * 0.95, 0.1, 24);
  plateGeo.rotateX(Math.PI / 2);
  disposables.push(plateGeo);

  const topPlate = new THREE.Mesh(plateGeo, matChrome);
  topPlate.position.z = topPlateZ;
  group.add(topPlate);

  const magGeo = new THREE.CylinderGeometry(magRadius, magRadius, magHeight * 0.85, 24);
  magGeo.rotateX(Math.PI / 2);
  disposables.push(magGeo);
  const magnet = new THREE.Mesh(magGeo, matFerrite);
  magnet.position.z = topPlateZ - magHeight * 0.48;
  group.add(magnet);

  const backPlate = new THREE.Mesh(plateGeo, matChrome);
  backPlate.position.z = -depthUnits + 0.05;
  group.add(backPlate);

  const screwGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.04, 8);
  screwGeo.rotateX(Math.PI / 2);
  disposables.push(screwGeo);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const screw = new THREE.Mesh(screwGeo, matChrome);
    screw.position.set(Math.cos(a) * (rOuter * 0.91), Math.sin(a) * (rOuter * 0.91), 0.14);
    group.add(screw);
  }

  return group;
}

function buildAeroPortGroup(
  diameterUnits: number,
  lengthUnits: number,
  flared: boolean,
  disposables: Array<{ dispose: () => void }>,
): THREE.Group {
  const group = new THREE.Group();
  const rInner = diameterUnits / 2;
  const wall = 0.045;

  const matTube = new THREE.MeshStandardMaterial({
    color: 0x181c24,
    roughness: 0.35,
    metalness: 0.18,
    side: THREE.DoubleSide,
  });
  disposables.push(matTube);

  const tubeGeo = new THREE.CylinderGeometry(rInner + wall, rInner + wall, lengthUnits, 24, 1, true);
  tubeGeo.rotateX(Math.PI / 2);
  disposables.push(tubeGeo);
  const tubeMesh = new THREE.Mesh(tubeGeo, matTube);
  tubeMesh.position.z = -lengthUnits / 2;
  group.add(tubeMesh);

  const boreGeo = new THREE.CylinderGeometry(rInner, rInner, lengthUnits, 24, 1, true);
  boreGeo.rotateX(Math.PI / 2);
  disposables.push(boreGeo);
  const boreMesh = new THREE.Mesh(boreGeo, matTube);
  boreMesh.position.z = -lengthUnits / 2;
  group.add(boreMesh);

  if (flared) {
    const flareGeo = new THREE.TorusGeometry(rInner + wall * 1.4, wall * 1.5, 10, 24);
    disposables.push(flareGeo);
    const frontFlare = new THREE.Mesh(flareGeo, matTube);
    frontFlare.position.z = 0.02;
    group.add(frontFlare);

    const rearFlare = new THREE.Mesh(flareGeo, matTube);
    rearFlare.position.z = -lengthUnits;
    group.add(rearFlare);
  }

  return group;
}

export function buildEnclosureScene(
  params: BoxParams,
  acoustics: AcousticResult,
  materials: MaterialBank,
  showEdges: boolean,
): BuiltEnclosure {
  const root = new THREE.Group();
  const explodables: ExplodableItem[] = [];
  const disposables: Array<{ dispose: () => void }> = [];

  const W = acoustics.effectiveExternalWidth * MM_TO_UNITS;
  const H = acoustics.effectiveExternalHeight * MM_TO_UNITS;
  const D = acoustics.effectiveExternalDepth * MM_TO_UNITS;
  const t = params.thickness * MM_TO_UNITS;

  const activeTex = materials.woodTextures[params.material];
  materials.woodMaterial.map = activeTex;
  materials.woodMaterial.needsUpdate = true;
  materials.portWoodMaterial.map = activeTex;
  materials.portWoodMaterial.needsUpdate = true;

  const { isBandpass, effectiveDriverFace, effectivePortFace } = resolveEffectiveFaces(params);
  const doubleOnFront = params.doubleFrontBaffle && !isBandpass && effectiveDriverFace === 'front';
  const doubleOnTop = params.doubleFrontBaffle && !isBandpass && effectiveDriverFace === 'top';

  const centerY = H / 2;
  const intW = acoustics.internalWidth * MM_TO_UNITS;
  const intH = acoustics.internalHeight * MM_TO_UNITS;
  const intD = acoustics.internalDepth * MM_TO_UNITS;
  const intCenterY = t + intH / 2;

  const addPanel = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: THREE.Vector3,
    explodeDir: THREE.Vector3,
    rotY = 0,
    rotX = 0,
  ) => {
    disposables.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.rotation.x = rotX;
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);

    let edges: THREE.LineSegments | undefined;
    if (showEdges) {
      const edgeGeo = new THREE.EdgesGeometry(geo, 20);
      disposables.push(edgeGeo);
      edges = new THREE.LineSegments(edgeGeo, materials.edgeLineMaterial);
      mesh.add(edges);
    }

    explodables.push({
      object: mesh,
      basePos: pos.clone(),
      explodeOffset: explodeDir.clone(),
      edges,
    });
    return mesh;
  };

  let topBotW = W;
  let topBotD = D;
  let sideD = D;
  let sideH = H - 2 * t;
  let fbW = W - 2 * t;
  let fbH = H - 2 * t;

  const topY = H - t / 2;
  const botY = t / 2;
  const sideXOffset = W / 2 - t / 2;
  const frontZ = D / 2 - t / 2;
  const backZ = -D / 2 + t / 2;

  if (params.joineryType === 'sides_full') {
    sideH = H;
    topBotW = W - 2 * t;
  } else if (params.joineryType === 'front_back_cover') {
    fbW = W;
    fbH = H;
    const fbSpan = doubleOnFront ? 3 * t : 2 * t;
    topBotD = D - fbSpan;
    sideD = D - fbSpan;
    sideH = H - 2 * t;
  }

  const fbZCenterOffset =
    params.joineryType === 'front_back_cover' && doubleOnFront ? -t / 2 : 0;

  // Prepare hole arrays for Top, Sides, and Front
  const frontCircleHoles: Array<{ x: number; y: number; radius: number }> = [];
  const frontRectHoles: Array<{ x: number; y: number; w: number; h: number }> = [];
  const topCircleHoles: Array<{ x: number; y: number; radius: number }> = [];
  const topDoubleCircleHoles: Array<{ x: number; y: number; radius: number }> = [];
  const leftSideCircleHoles: Array<{ x: number; y: number; radius: number }> = [];
  const rightSideCircleHoles: Array<{ x: number; y: number; radius: number }> = [];

  const portW = acoustics.effectivePortWidth * MM_TO_UNITS;
  const portH = acoustics.effectivePortHeight * MM_TO_UNITS;
  const rearPortW = acoustics.effectiveRearPortWidth * MM_TO_UNITS;
  const rearPortH = acoustics.effectiveRearPortHeight * MM_TO_UNITS;

  // Compute round aero port coordinates & register panel holes
  const aeroDia = acoustics.effectivePortDiameter * MM_TO_UNITS;
  const aeroR = aeroDia / 2;
  const aeroLen = acoustics.effectivePortLength * MM_TO_UNITS;
  const aeroPortInstances: Array<{
    pos: THREE.Vector3;
    rotX: number;
    rotY: number;
    explode: THREE.Vector3;
  }> = [];

  const slotSide = params.portSlotSide ?? 'right';

  if (params.enclosureType === 'vented_round') {
    for (const rp of acoustics.roundPortLayout) {
      const u = rp.x * MM_TO_UNITS;
      const v = rp.y * MM_TO_UNITS;
      if (effectivePortFace === 'front') {
        const wy = intCenterY + v;
        frontCircleHoles.push({ x: u, y: wy - centerY, radius: aeroR });
        aeroPortInstances.push({
          pos: new THREE.Vector3(u, wy, frontZ + t / 2),
          rotX: 0,
          rotY: 0,
          explode: new THREE.Vector3(0.4, 0, 2.2),
        });
      } else if (effectivePortFace === 'top') {
        const wx = u;
        const wz = -v;
        topCircleHoles.push({ x: wx, y: -(wz - fbZCenterOffset), radius: aeroR });
        topDoubleCircleHoles.push({ x: wx, y: -wz, radius: aeroR });
        aeroPortInstances.push({
          pos: new THREE.Vector3(wx, topY + t / 2, wz),
          rotX: -Math.PI / 2,
          rotY: 0,
          explode: new THREE.Vector3(0, 2.2, 0),
        });
      } else if (effectivePortFace === 'side_right') {
        const wz = fbZCenterOffset + u;
        const wy = intCenterY + v;
        rightSideCircleHoles.push({
          x: -(wz - fbZCenterOffset),
          y: wy - centerY,
          radius: aeroR,
        });
        aeroPortInstances.push({
          pos: new THREE.Vector3(sideXOffset + t / 2, wy, wz),
          rotX: 0,
          rotY: Math.PI / 2,
          explode: new THREE.Vector3(2.2, 0, 0),
        });
      } else if (effectivePortFace === 'side_left') {
        const wz = fbZCenterOffset + u;
        const wy = intCenterY + v;
        leftSideCircleHoles.push({
          x: wz - fbZCenterOffset,
          y: wy - centerY,
          radius: aeroR,
        });
        aeroPortInstances.push({
          pos: new THREE.Vector3(-sideXOffset - t / 2, wy, wz),
          rotX: 0,
          rotY: -Math.PI / 2,
          explode: new THREE.Vector3(-2.2, 0, 0),
        });
      }
    }
  }

  // Register slot ports / bandpass window / driver holes
  const driverPlacements: Array<{
    pos: THREE.Vector3;
    rotX: number;
    rotY: number;
    explode: THREE.Vector3;
  }> = [];

  const cutR = (params.driverCutoutDia * MM_TO_UNITS) / 2;
  const isFrontCoverJoinery = params.joineryType === 'front_back_cover';
  const yBotIntLocal = t - centerY;
  const frontXMin = -fbW / 2;
  const frontXMax = fbW / 2;
  const frontYMin = -fbH / 2;
  const frontYMax = fbH / 2;
  let frontOuterContour: Array<{ x: number; y: number }> = [
    { x: frontXMin, y: frontYMin },
    { x: frontXMax, y: frontYMin },
    { x: frontXMax, y: frontYMax },
    { x: frontXMin, y: frontYMax },
  ];

  if (isBandpass) {
    const slotX = intW / 2 - portW / 2;
    const slotY = yBotIntLocal + portH / 2;

    if (isFrontCoverJoinery) {
      frontRectHoles.push({ x: slotX, y: slotY, w: portW, h: portH });
      if (params.enclosureType === 'bandpass_6th') {
        const rearSlotX = -intW / 2 + rearPortW / 2;
        const rearSlotY = yBotIntLocal + rearPortH / 2;
        frontRectHoles.push({ x: rearSlotX, y: rearSlotY, w: rearPortW, h: rearPortH });
      }
    } else if (params.enclosureType === 'bandpass_6th') {
      const xL = -intW / 2 + rearPortW;
      const xR = intW / 2 - portW;
      const yRightTop = Math.min(frontYMax, yBotIntLocal + portH);
      const yLeftTop = Math.min(frontYMax, yBotIntLocal + rearPortH);
      const pts: Array<{ x: number; y: number }> = [
        { x: xL, y: frontYMin },
        { x: xR, y: frontYMin },
      ];
      if (yRightTop < frontYMax - 1e-4) {
        pts.push({ x: xR, y: yRightTop }, { x: frontXMax, y: yRightTop }, { x: frontXMax, y: frontYMax });
      } else {
        pts.push({ x: xR, y: frontYMax });
      }
      if (yLeftTop < frontYMax - 1e-4) {
        pts.push({ x: frontXMin, y: frontYMax }, { x: frontXMin, y: yLeftTop }, { x: xL, y: yLeftTop });
      } else {
        pts.push({ x: xL, y: frontYMax });
      }
      frontOuterContour = pts;
    } else {
      const xR = intW / 2 - portW;
      const yRightTop = Math.min(frontYMax, yBotIntLocal + portH);
      if (yRightTop < frontYMax - 1e-4) {
        frontOuterContour = [
          { x: frontXMin, y: frontYMin },
          { x: xR, y: frontYMin },
          { x: xR, y: yRightTop },
          { x: frontXMax, y: yRightTop },
          { x: frontXMax, y: frontYMax },
          { x: frontXMin, y: frontYMax },
        ];
      } else {
        frontOuterContour = [
          { x: frontXMin, y: frontYMin },
          { x: xR, y: frontYMin },
          { x: xR, y: frontYMax },
          { x: frontXMin, y: frontYMax },
        ];
      }
    }

    const dividerX = -intW / 2 + intW * (1 - params.bandpassFrontRatio);
    const chamberRightEdge = intW / 2 - portW - t * 1.4;
    const chamberLeftEdge = dividerX + t * 0.8;
    const winW = Math.max(0.5, chamberRightEdge - chamberLeftEdge);
    const winH = Math.max(0.5, intH - t * 2.2);
    const winX = (chamberLeftEdge + chamberRightEdge) / 2;
    frontRectHoles.push({ x: winX, y: 0, w: winW, h: winH });

    const acrylicGeo = new THREE.BoxGeometry(winW + 0.2, winH + 0.2, t * 0.45);
    addPanel(
      acrylicGeo,
      materials.acrylicMaterial,
      new THREE.Vector3(winX, centerY, frontZ + t * 0.1),
      new THREE.Vector3(0, 0, 2.3),
    );
  } else {
    if (params.enclosureType === 'vented_slot') {
      if (slotSide === 'bottom') {
        const slotW = portH;
        const slotGapH = portW;
        const slotX = params.portFullHeight ? 0 : intW / 2 - slotW / 2;
        const slotY = yBotIntLocal + slotGapH / 2;
        if (isFrontCoverJoinery) {
          frontRectHoles.push({ x: slotX, y: slotY, w: slotW, h: slotGapH });
        } else {
          const yBotCut = Math.min(frontYMax - 0.05, yBotIntLocal + slotGapH);
          if (params.portFullHeight) {
            frontOuterContour = [
              { x: frontXMin, y: yBotCut },
              { x: frontXMax, y: yBotCut },
              { x: frontXMax, y: frontYMax },
              { x: frontXMin, y: frontYMax },
            ];
          } else {
            const xRightCut = Math.max(frontXMin + 0.05, intW / 2 - slotW);
            frontOuterContour = [
              { x: frontXMin, y: frontYMin },
              { x: xRightCut, y: frontYMin },
              { x: xRightCut, y: yBotCut },
              { x: frontXMax, y: yBotCut },
              { x: frontXMax, y: frontYMax },
              { x: frontXMin, y: frontYMax },
            ];
          }
        }
      } else {
        const slotX = slotSide === 'left' ? -intW / 2 + portW / 2 : intW / 2 - portW / 2;
        const slotY = yBotIntLocal + portH / 2;
        if (isFrontCoverJoinery) {
          frontRectHoles.push({ x: slotX, y: slotY, w: portW, h: portH });
        } else if (slotSide === 'left') {
          const xLeftCut = Math.min(frontXMax - 0.05, -intW / 2 + portW);
          const ySlotTop = Math.min(frontYMax, yBotIntLocal + portH);
          if (ySlotTop < frontYMax - 1e-4) {
            frontOuterContour = [
              { x: xLeftCut, y: frontYMin },
              { x: frontXMax, y: frontYMin },
              { x: frontXMax, y: frontYMax },
              { x: frontXMin, y: frontYMax },
              { x: frontXMin, y: ySlotTop },
              { x: xLeftCut, y: ySlotTop },
            ];
          } else {
            frontOuterContour = [
              { x: xLeftCut, y: frontYMin },
              { x: frontXMax, y: frontYMin },
              { x: frontXMax, y: frontYMax },
              { x: xLeftCut, y: frontYMax },
            ];
          }
        } else {
          const xRightCut = Math.max(frontXMin + 0.05, intW / 2 - portW);
          const ySlotTop = Math.min(frontYMax, yBotIntLocal + portH);
          if (ySlotTop < frontYMax - 1e-4) {
            frontOuterContour = [
              { x: frontXMin, y: frontYMin },
              { x: xRightCut, y: frontYMin },
              { x: xRightCut, y: ySlotTop },
              { x: frontXMax, y: ySlotTop },
              { x: frontXMax, y: frontYMax },
              { x: frontXMin, y: frontYMax },
            ];
          } else {
            frontOuterContour = [
              { x: frontXMin, y: frontYMin },
              { x: xRightCut, y: frontYMin },
              { x: xRightCut, y: frontYMax },
              { x: frontXMin, y: frontYMax },
            ];
          }
        }
      }
    }

    if (effectiveDriverFace === 'top') {
      for (const p of acoustics.driverLayout) {
        const wx = p.x * MM_TO_UNITS;
        const wz = -p.y * MM_TO_UNITS;
        topCircleHoles.push({ x: wx, y: -(wz - fbZCenterOffset), radius: cutR });
        topDoubleCircleHoles.push({ x: wx, y: -wz, radius: cutR });
        driverPlacements.push({
          pos: new THREE.Vector3(wx, topY + t / 2, wz),
          rotX: -Math.PI / 2,
          rotY: 0,
          explode: new THREE.Vector3(0, 2.7, 0),
        });
      }
    } else {
      for (const p of acoustics.driverLayout) {
        const dx = p.x * MM_TO_UNITS;
        const dy = p.y * MM_TO_UNITS;
        frontCircleHoles.push({ x: dx, y: dy, radius: cutR });
        driverPlacements.push({
          pos: new THREE.Vector3(dx, centerY + dy, frontZ + t / 2),
          rotX: 0,
          rotY: 0,
          explode: new THREE.Vector3(0, 0, 2.7),
        });
      }
    }
  }

  // 1. Top & Bottom Panels
  const topGeo =
    topCircleHoles.length > 0
      ? createPanelWithHolesGeometry(topBotW, topBotD, t, topCircleHoles, [])
      : new THREE.BoxGeometry(topBotW, t, topBotD);
  addPanel(
    topGeo,
    materials.woodMaterial,
    new THREE.Vector3(0, topY, fbZCenterOffset),
    new THREE.Vector3(0, 1.4, 0),
    0,
    topCircleHoles.length > 0 ? -Math.PI / 2 : 0,
  );

  if (doubleOnTop) {
    const topDoubleGeo = createPanelWithHolesGeometry(intW, intD, t, topDoubleCircleHoles, []);
    addPanel(
      topDoubleGeo,
      materials.woodMaterial,
      new THREE.Vector3(0, topY - t, 0),
      new THREE.Vector3(0, 1.0, 0),
      0,
      -Math.PI / 2,
    );
  }

  addPanel(
    new THREE.BoxGeometry(topBotW, t, topBotD),
    materials.woodMaterial,
    new THREE.Vector3(0, botY, fbZCenterOffset),
    new THREE.Vector3(0, -0.7, 0),
  );

  // 2. Left & Right Side Panels
  const leftSideGeo =
    leftSideCircleHoles.length > 0
      ? createPanelWithHolesGeometry(sideD, sideH, t, leftSideCircleHoles, [])
      : new THREE.BoxGeometry(t, sideH, sideD);
  addPanel(
    leftSideGeo,
    materials.woodMaterial,
    new THREE.Vector3(-sideXOffset, centerY, fbZCenterOffset),
    new THREE.Vector3(-1.5, 0, 0),
    leftSideCircleHoles.length > 0 ? -Math.PI / 2 : 0,
    0,
  );

  const rightSideGeo =
    rightSideCircleHoles.length > 0
      ? createPanelWithHolesGeometry(sideD, sideH, t, rightSideCircleHoles, [])
      : new THREE.BoxGeometry(t, sideH, sideD);
  addPanel(
    rightSideGeo,
    materials.woodMaterial,
    new THREE.Vector3(sideXOffset, centerY, fbZCenterOffset),
    new THREE.Vector3(1.5, 0, 0),
    rightSideCircleHoles.length > 0 ? Math.PI / 2 : 0,
    0,
  );

  // 3. Back Panel
  addPanel(
    new THREE.BoxGeometry(fbW, fbH, t),
    materials.woodMaterial,
    new THREE.Vector3(0, centerY, backZ),
    new THREE.Vector3(0, 0, -1.6),
  );

  // 4. Front Panel (+ optional front double baffle)
  const frontGeo = createPolygonPanelWithHolesGeometry(
    frontOuterContour,
    t,
    frontCircleHoles,
    frontRectHoles,
  );
  addPanel(
    frontGeo,
    materials.woodMaterial,
    new THREE.Vector3(0, centerY, frontZ),
    new THREE.Vector3(0, 0, 1.8),
  );

  if (doubleOnFront) {
    const doubleGeo = createPolygonPanelWithHolesGeometry(
      frontOuterContour,
      t,
      frontCircleHoles,
      frontRectHoles,
    );
    addPanel(
      doubleGeo,
      materials.woodMaterial,
      new THREE.Vector3(0, centerY, frontZ - t),
      new THREE.Vector3(0, 0, 1.3),
    );
  }

  const frontInnerZ = frontZ - t / 2 - (doubleOnFront ? t : 0);

  // 5. Internal Front Slot Port (right, left, or bottom)
  if ((params.enclosureType === 'vented_slot' || isBandpass) && acoustics.slotPort) {
    const b1Len = acoustics.slotPort.baffle1Length * MM_TO_UNITS;
    const b2Len = acoustics.slotPort.baffle2Length * MM_TO_UNITS;

    if (!isBandpass && slotSide === 'bottom') {
      const slotW = portH;
      const slotGapH = portW;
      const slotCenterX = params.portFullHeight ? 0 : intW / 2 - slotW / 2;
      const shelfY = t + slotGapH + t / 2;

      if (b1Len > 0.05) {
        addPanel(
          new THREE.BoxGeometry(slotW, t, b1Len),
          materials.portWoodMaterial,
          new THREE.Vector3(slotCenterX, shelfY, frontInnerZ - b1Len / 2),
          new THREE.Vector3(0, 0.7, 0.3),
        );
      }

      if (acoustics.slotPort.isBent && b2Len > 0.05) {
        const b2Z = frontInnerZ - b1Len + t / 2;
        const b2Y = shelfY + t / 2 + b2Len / 2;
        addPanel(
          new THREE.BoxGeometry(slotW, b2Len, t),
          materials.portWoodMaterial,
          new THREE.Vector3(slotCenterX, b2Y, b2Z),
          new THREE.Vector3(0, 0.3, -0.6),
        );
      }

      if (!params.portFullHeight && b1Len > 0.05) {
        addPanel(
          new THREE.BoxGeometry(t, slotGapH + t, b1Len),
          materials.portWoodMaterial,
          new THREE.Vector3(intW / 2 - slotW - t / 2, t + (slotGapH + t) / 2, frontInnerZ - b1Len / 2),
          new THREE.Vector3(-0.5, 0.5, 0.2),
        );
      }
    } else {
      const isLeftSlot = !isBandpass && slotSide === 'left';
      const baffleX = isLeftSlot
        ? -intW / 2 + portW + t / 2
        : intW / 2 - portW - t / 2;
      const baffleY = params.portFullHeight ? intCenterY : t + portH / 2;

      if (b1Len > 0.05) {
        addPanel(
          new THREE.BoxGeometry(t, portH, b1Len),
          materials.portWoodMaterial,
          new THREE.Vector3(baffleX, baffleY, frontInnerZ - b1Len / 2),
          new THREE.Vector3(isLeftSlot ? -0.7 : 0.7, 0.3, 0.3),
        );
      }

      if (acoustics.slotPort.isBent && b2Len > 0.05) {
        const b2Z = frontInnerZ - b1Len + t / 2;
        const b2X = isLeftSlot
          ? baffleX + t / 2 + b2Len / 2
          : baffleX - t / 2 - b2Len / 2;
        addPanel(
          new THREE.BoxGeometry(b2Len, portH, t),
          materials.portWoodMaterial,
          new THREE.Vector3(b2X, baffleY, b2Z),
          new THREE.Vector3(isLeftSlot ? 0.3 : -0.3, 0.3, -0.6),
        );
      }

      if (!params.portFullHeight && b1Len > 0.05) {
        const capX = isLeftSlot
          ? -intW / 2 + (portW + t) / 2
          : intW / 2 - (portW + t) / 2;
        addPanel(
          new THREE.BoxGeometry(portW + t, t, b1Len),
          materials.portWoodMaterial,
          new THREE.Vector3(capX, t + portH + t / 2, frontInnerZ - b1Len / 2),
          new THREE.Vector3(isLeftSlot ? -0.5 : 0.5, 0.9, 0.2),
        );
      }
    }
  }

  // 5b. Internal Rear Slot Port (Bandpass 6th-order, along left wall)
  if (params.enclosureType === 'bandpass_6th' && acoustics.rearSlotPort) {
    const rb1Len = acoustics.rearSlotPort.baffle1Length * MM_TO_UNITS;
    const rb2Len = acoustics.rearSlotPort.baffle2Length * MM_TO_UNITS;
    const rbX = -intW / 2 + rearPortW + t / 2;
    const rbY = params.portRearFullHeight ? intCenterY : t + rearPortH / 2;

    if (rb1Len > 0.05) {
      addPanel(
        new THREE.BoxGeometry(t, rearPortH, rb1Len),
        materials.portWoodMaterial,
        new THREE.Vector3(rbX, rbY, frontInnerZ - rb1Len / 2),
        new THREE.Vector3(-0.7, 0.3, 0.3),
      );
    }

    if (acoustics.rearSlotPort.isBent && rb2Len > 0.05) {
      const rb2Z = frontInnerZ - rb1Len + t / 2;
      const rb2X = rbX + t / 2 + rb2Len / 2;
      addPanel(
        new THREE.BoxGeometry(rb2Len, rearPortH, t),
        materials.portWoodMaterial,
        new THREE.Vector3(rb2X, rbY, rb2Z),
        new THREE.Vector3(0.3, 0.3, -0.6),
      );
    }

    if (!params.portRearFullHeight && rb1Len > 0.05) {
      addPanel(
        new THREE.BoxGeometry(rearPortW + t, t, rb1Len),
        materials.portWoodMaterial,
        new THREE.Vector3(-intW / 2 + (rearPortW + t) / 2, t + rearPortH + t / 2, frontInnerZ - rb1Len / 2),
        new THREE.Vector3(-0.5, 0.9, 0.2),
      );
    }
  }

  // 5c. Round Aero Port Meshes
  for (const inst of aeroPortInstances) {
    const aeroGroup = buildAeroPortGroup(aeroDia, aeroLen, params.portFlared, disposables);
    aeroGroup.position.copy(inst.pos);
    aeroGroup.rotation.x = inst.rotX;
    aeroGroup.rotation.y = inst.rotY;
    root.add(aeroGroup);
    explodables.push({
      object: aeroGroup,
      basePos: inst.pos.clone(),
      explodeOffset: inst.explode.clone(),
    });
  }

  // 6. Bandpass Divider Baffle + 1..6 Drivers
  if (isBandpass) {
    const dividerX = -intW / 2 + intW * (1 - params.bandpassFrontRatio);
    const divHoles = acoustics.driverLayout.map((p) => ({
      x: p.x * MM_TO_UNITS,
      y: p.y * MM_TO_UNITS,
      radius: cutR,
    }));

    const divGeo = createPanelWithHolesGeometry(intD, intH, t, divHoles, []);
    const midZ = (frontInnerZ + backZ + t / 2) / 2;
    addPanel(
      divGeo,
      materials.portWoodMaterial,
      new THREE.Vector3(dividerX, intCenterY, midZ),
      new THREE.Vector3(-0.3, 0.9, 0),
      Math.PI / 2,
    );

    for (const pos of acoustics.driverLayout) {
      const drvGroup = buildDriverGroup(
        params.driverCutoutDia * MM_TO_UNITS,
        params.driverOuterDia * MM_TO_UNITS,
        params.driverDepth * MM_TO_UNITS,
        disposables,
      );
      drvGroup.rotation.y = Math.PI / 2;
      const dPos = new THREE.Vector3(
        dividerX + t / 2,
        intCenterY + pos.y * MM_TO_UNITS,
        midZ - pos.x * MM_TO_UNITS,
      );
      drvGroup.position.copy(dPos);
      root.add(drvGroup);
      explodables.push({
        object: drvGroup,
        basePos: dPos.clone(),
        explodeOffset: new THREE.Vector3(0.9, 0.9, 0),
      });
    }
  } else {
    for (const dp of driverPlacements) {
      const drvGroup = buildDriverGroup(
        params.driverCutoutDia * MM_TO_UNITS,
        params.driverOuterDia * MM_TO_UNITS,
        params.driverDepth * MM_TO_UNITS,
        disposables,
      );
      drvGroup.rotation.x = dp.rotX;
      drvGroup.rotation.y = dp.rotY;
      drvGroup.position.copy(dp.pos);
      root.add(drvGroup);
      explodables.push({
        object: drvGroup,
        basePos: dp.pos.clone(),
        explodeOffset: dp.explode.clone(),
      });
    }
  }

  return {
    root,
    explodables,
    boundingSize: new THREE.Vector3(W, H, D),
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
