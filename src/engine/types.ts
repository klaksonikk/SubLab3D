export type AppLanguage = 'pl' | 'en';
export type UnitSystem = 'metric' | 'imperial';

export type EnclosureType =
  | 'vented_slot'
  | 'vented_round'
  | 'sealed'
  | 'bandpass_4th'
  | 'bandpass_6th';

export type JoineryType = 'top_bottom_cover' | 'sides_full' | 'front_back_cover';

export type MaterialType = 'mdf' | 'birch_plywood' | 'matte_black';

export type DriverFace = 'front' | 'top';

export type PortFace = 'front' | 'top' | 'side_right' | 'side_left';

export type DriverPattern = 'auto' | 'grid' | 'staggered' | 'inline';

export type SlotPortSide = 'right' | 'left' | 'bottom';

export type RoundPortOrientation = 'auto' | 'vertical' | 'horizontal';

export type PortControlMode = 'dimensions' | 'tuning' | 'area_from_length';

export type BoxAutoCalcField = 'none' | 'depth' | 'width' | 'height';

export type VoiceCoilCount = 1 | 2;

export type CoilWiringMode = 'single' | 'parallel' | 'series';

export type DriverWiringType = 'parallel' | 'series' | 'series_parallel';

export interface BoxParams {
  enclosureType: EnclosureType;
  joineryType: JoineryType;
  material: MaterialType;

  // Placement & layout topology
  driverFace: DriverFace;
  portFace: PortFace;
  driverPattern: DriverPattern;
  driverOffsetX: number; // mm (Left - / Right +)
  driverOffsetY: number; // mm (Down/Front - / Up/Back +)
  portSlotSide: SlotPortSide;
  portOrientation: RoundPortOrientation;
  portOffsetX: number; // mm
  portOffsetY: number; // mm

  // External dimensions & optional auto-dimension from net volume
  boxAutoCalcField: BoxAutoCalcField;
  targetNetVolumeL: number; // liters (used when boxAutoCalcField !== 'none')
  externalWidth: number;
  externalHeight: number;
  externalDepth: number;
  thickness: number;
  doubleFrontBaffle: boolean;

  // Driver parameters
  driverPresetId: string;
  driverName?: string;
  driverCount: 1 | 2 | 3 | 4 | 5 | 6;
  driverCutoutDia: number; // mm
  driverOuterDia: number; // mm
  driverDepth: number; // mm
  driverDisplacement: number; // liters per driver
  driverFs: number; // Hz
  driverQts: number;
  driverVas: number; // liters
  driverXmax: number; // mm (one-way)
  driverPowerW: number; // W RMS per driver

  // Voice coil & multi-driver electrical configuration
  driverVoiceCoilCount: VoiceCoilCount;
  driverCoilNominalOhms: number; // nominal impedance per single coil (Ohm)
  driverCoilReOhms: number; // DC resistance Re per single coil (Ohm)
  driverCoilLeMh: number; // reference Le (series for DVC, single for SVC) (mH)
  driverCoilWiring: CoilWiringMode;
  driverArrayWiring: DriverWiringType;

  // Port control mode ('dimensions' = manual W/D/L, 'tuning' = target Fb + Area -> auto W/D & L)
  portControlMode: PortControlMode;
  targetTuningHz: number; // Hz
  targetPortAreaCm2: number; // cm^2
  targetRearTuningHz: number; // Hz (Bandpass 6th rear chamber)
  targetRearPortAreaCm2: number; // cm^2 (Bandpass 6th rear chamber)

  // Primary / Front Slot port parameters (used for vented_slot, bandpass_4th, bandpass_6th front)
  portWidth: number; // mm
  portHeight: number; // mm
  portFullHeight: boolean; // if true, uses full internal height
  portLength: number; // mm

  // Rear chamber Slot port parameters (used for bandpass_6th rear chamber)
  portRearWidth: number; // mm
  portRearHeight: number; // mm
  portRearFullHeight: boolean;
  portRearLength: number; // mm

  // Round/Aero port parameters (used for vented_round)
  portDiameter: number; // mm
  portCount: 1 | 2 | 3 | 4;
  portFlared: boolean;

  // Internal bracing & Bandpass
  bracingVolumeL: number; // liters
  bandpassFrontRatio: number; // 0.25 .. 0.70

  // Cut-list sheet settings (mm)
  sheetWidth: number;
  sheetHeight: number;
  sawKerf: number;
}

export interface SlotPortGeometry {
  width: number; // mm
  height: number; // mm
  totalLength: number; // mm
  isBent: boolean;
  /** Length of the first leg from front baffle towards back wall (mm) */
  leg1Length: number;
  /** Length of the second leg parallel to rear wall if bent (mm) */
  leg2Length: number;
  /** Physical panel length for leg 1 baffle (mm) */
  baffle1Length: number;
  /** Physical panel length for leg 2 baffle (mm), 0 if straight */
  baffle2Length: number;
  /** Clearance between end of leg 1 and rear wall (mm) */
  rearClearance: number;
  /** Whether the folded port fits physically inside the enclosure */
  fitsInside: boolean;
}

export interface DriverPosition2D {
  x: number; // mm relative to usable front/divider center
  y: number; // mm relative to center Y
}

export interface FrequencyPoint {
  hz: number;
  splDb: number;
  portVelocityMs: number;
  excursionMm: number;
}

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface AcousticResult {
  effectiveExternalWidth: number; // mm
  effectiveExternalHeight: number; // mm
  effectiveExternalDepth: number; // mm
  internalWidth: number; // mm
  internalHeight: number; // mm
  internalDepth: number; // mm
  effectivePortWidth: number; // mm
  effectivePortDiameter: number; // mm
  effectivePortLength: number; // mm
  effectivePortHeight: number; // mm
  effectiveRearPortWidth: number; // mm
  effectiveRearPortLength: number; // mm
  effectiveRearPortHeight: number; // mm
  grossVolumeL: number;
  portAirVolumeL: number;
  portWoodVolumeL: number;
  portTotalDisplacementL: number;
  totalDriverDisplacementL: number;
  netVolumeL: number;
  // For Bandpass 4th-order & 6th-order:
  sealedChamberNetL: number; // Rear chamber (sealed in BP4, low-tuned vented in BP6)
  ventedChamberNetL: number; // Front chamber (high-tuned vented)
  rearPortTuningHz: number | null; // Fb_low for BP6 rear chamber
  rearPortAreaCm2: number;
  rearSlotPort: SlotPortGeometry | null;
  // Tuning & alignment:
  portAreaCm2: number;
  portAreaPerLiterCm2: number;
  tuningHz: number | null; // Fb for vented / bandpass front
  sealedFcHz: number | null; // Fc for sealed / bandpass4 rear
  sealedQtc: number | null; // Qtc for sealed / bandpass4 rear
  f3LowHz: number;
  f3HighHz: number | null; // For bandpass
  portVelocityMs: number; // Peak air speed at Fb under RMS power
  portVelocityStatus: 'ideal' | 'acceptable' | 'chuffing' | 'na';
  recommendedMinPortAreaCm2: number;
  slotPort: SlotPortGeometry | null;
  driverLayout: DriverPosition2D[];
  driverLayoutLabel: string;
  roundPortLayout: DriverPosition2D[];
  offsetBounds: {
    driverMinX: number;
    driverMaxX: number;
    driverMinY: number;
    driverMaxY: number;
    portMinX: number;
    portMaxX: number;
    portMinY: number;
    portMaxY: number;
  };
  driverFitsFront: boolean;
  driverClearanceMm: number;
  responseCurve: FrequencyPoint[];
  issues: ValidationIssue[];
}

export interface PanelCut {
  id: string;
  name: string;
  quantity: number;
  width: number; // mm
  height: number; // mm
  thickness: number; // mm
  areaM2: number;
  notes: string;
  category: 'enclosure' | 'port' | 'baffle';
}

export interface PlacedPanel {
  panelId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
  sheetIndex: number;
  category: 'enclosure' | 'port' | 'baffle';
}

export interface CutSheetSummary {
  panels: PanelCut[];
  placedPanels: PlacedPanel[];
  unplacedPanels: PanelCut[];
  sheetCount: number;
  sheetWidth: number;
  sheetHeight: number;
  totalPanelAreaM2: number;
  totalSheetAreaM2: number;
  utilizationPercent: number;
  estimatedWeightKg: number;
}

export interface DriverPreset {
  id: string;
  name: string;
  sizeLabel: string;
  source?: string;
  isCustom?: boolean;
  cutoutDia: number;
  outerDia: number;
  depth: number;
  displacement: number;
  fs: number;
  qts: number;
  vas: number;
  xmax: number;
  powerW: number;
  // Voice coil physical specs
  voiceCoilCount?: VoiceCoilCount;
  coilNominalOhms?: number; // nominal Ohm per single coil
  coilReOhms?: number; // DC Re Ohm per single coil
  // Full Thiele-Small parameters
  qes?: number;
  qms?: number;
  re?: number; // Reference DC Ohm (series for DVC, single for SVC)
  le?: number; // Reference Le mH (series for DVC, single for SVC)
  zNom?: number; // Reference nominal Ohm
  sd?: number; // cm^2
  bl?: number; // T*m
  mms?: number; // g
  cms?: number; // mm/N
  rms?: number; // kg/s
  spl1w1m?: number; // dB
}

export interface BoxTemplatePreset {
  id: string;
  name: string;
  nameEn?: string;
  description: string;
  descriptionEn?: string;
  params: Partial<BoxParams>;
}
