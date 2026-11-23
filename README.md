# SubLab 3D — Parametric Subwoofer Enclosure CAD & Thiele-Small Laboratory (WSD)

![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Three.js](https://img.shields.io/badge/Three.js-CAD%203D-000000?logo=threedotjs&logoColor=white)

**SubLab 3D** is a precision engineering web application for designing 3D subwoofer enclosures, running WinISD-style Thiele-Small acoustic simulations (**WSD**), generating woodworking cut lists, and optimizing panel sheet nesting. It includes a full **bilingual interface (`EN` / `PL`)** and a **responsive mobile layout** for phones and desktops.

---

## Table of Contents

- [Key Capabilities](#key-capabilities)
- [WSD Laboratory (Thiele-Small Analysis & `.wdr` Import)](#wsd-laboratory-thiele-small-analysis--wdr-import)
- [Example Acoustic Benchmark (12" DVC Driver)](#example-acoustic-benchmark-12-dvc-driver)
- [Unit Tests & Verification](#unit-tests--verification)
- [Project Architecture](#project-architecture)

---

## Key Capabilities

### 1. Parametric 3D CAD Designer (Three.js)
- **5 enclosure topologies**:
  - `Slot Port Bass-Reflex` (automatic **L-bent** port folding with zero overlapping walls and selectable outlet side: right / left / bottom),
  - `Round / Aero Port Bass-Reflex` (1–4 pipes mounted on front, top, or side with X/Y offsets and collision checks),
  - `Sealed`,
  - `4th-Order Bandpass` (sealed rear + vented front chamber with acrylic inspection window),
  - `6th-Order Bandpass` (dual independently tuned chambers and dual ports).
- **Coupled geometry solver**: automatically solves `Width (W)`, `Height (H)`, `Depth (D)`, or `Net Volume (Vnet)` while holding target `Vnet`, tuning `Fb`, and port area `S`.
- **Multi-driver layouts (1–6 drivers)**: automatic grid and staggered (*Quincunx*) placement with magnet depth clearance and baffle margin checks.
- **Interactive CAD viewport**: `X-Ray`, `Solid`, and `Wireframe` modes, `Exploded View`, CAD measurement grid, procedural materials (`Birch Plywood`, `MDF`, `Black Laminate`), optional `2×` double front baffle, and a slide-over **mobile controls drawer** on narrow phone screens.

### 2. Cut-List & Sheet Nesting (`Cut-List` & `Sheet Nesting`)
- **3 joinery standards**: top/bottom over sides, full-height sides, front & back overlapping all walls.
- **Detailed panel schedule**: accounts for material thickness (`15–25 mm`), double front baffle, slot-port dividers, and bandpass internal walls, with CSV export.
- **2D sheet nesting optimizer**: packs panels onto standard wood sheets (e.g., `2500 × 1250 mm`) with saw-kerf allowance, utilization percentage, and waste metrics.

### 3. Bilingual UI, Metric / Imperial Units & Offline Persistence
- **Instant `PL / EN` toggle** in the top header (persisted in `localStorage` and `?lang=en|pl` URL parameter).
- **Metric / Imperial unit switch** (`mm, L, cm², m/s, kg, m², g` ↔ `in, ft³, in², ft/s, lb, ft², oz`) in the top header (persisted in `localStorage` and `?units=metric|imperial`), converting all dimensions, volumes, port areas, velocities, charts, cut-lists, CSV exports, and T-S inputs while keeping canonical metric precision internally.
- **Offline-ready persistence**: projects and custom drivers stored in `localStorage`, JSON driver database export/import, and single-URL project sharing (`?model=...`).

---

## WSD Laboratory (Thiele-Small Analysis & `.wdr` Import)

The **WSD** workspace compares up to **4 enclosure variants simultaneously** and supports direct import of **WinISD `.wdr` driver files**:

| Module | Features |
| :--- | :--- |
| **Driver Database, T-S Solver & `.wdr` Import** | Import WinISD `.wdr` driver definitions (auto-detecting SI vs. practical units, European comma decimals, scientific notation, and `H-c/H-g` excursion fallback) or build custom drivers with automatic T-S solving (`Qts / Qes / Qms`, `Fs / Vas ↔ Mms / Cms`, `Bl`, `Sd`, `η₀`, `SPL 1W/1m`, `EBP`, `Vd`), thermal voice-coil compression (`ΔT`), added cone mass, **Iso-Barik** loading, and coil/array wiring (`Parallel / Series / Series-Parallel`). |
| **Enclosure Alignments** | Automatic `EBP` / `Qts` recommendations: `Sealed B2`, `Sealed Chebyshev C2`, `Bass-Reflex SBB4 / QB3`, `Bass-Reflex Chebyshev (C4)`, `Bass-Reflex EBS / Street SQL`, and `4th-Order Bandpass`. |
| **Port Calculator** | **Round / Aero** (`1–4× Ø`, PVC/Aero presets `Ø75–Ø200 mm`, `Auto <17 m/s` sizer, `Aero-Flare k=0.732` vs `Straight pipe k=0.85`) and **Slot / Area S**, including 1st pipe organ resonance calculation. |
| **17 Simulation Curves** | `EQ/Filters` & `Box` transfer, `SPL (dB)`, `Max SPL` (`Xmax` & `RMS` limited), `Max Power (W)`, `Apparent Load (VA)`, `Cone Excursion (mm)`, front/rear port `Air Velocity` & `Port Gain`, `Group Delay`, `Phase`, `Impedance (Ω)`, and `Impedance Phase`. |
| **DSP Filters & Cabin Acoustics** | **Butterworth 12/24 dB**, **Linkwitz-Riley 24 dB**, **Chebyshev 12/24 dB**, **PEQ**, **Linkwitz Transform**, `4π / 2π / π / Cabin Gain` environments, and a **Web Audio API 0 dBFS sine generator**. |

---

## Example Acoustic Benchmark (12" DVC Driver)

Using the built-in example 12" dual-voice-coil subwoofer preset (`1.8 + 1.8 Ω = 3.6 Ω` series wiring):

| Parameter | Value |
| :--- | :--- |
| `Fs` / `Vas` / `Qts` | **37.6 Hz** / **24.8 L** / **0.470** (`Qes = 0.525`, `Qms = 4.49`) |
| `Re` / `Xmax` / `RMS` | **3.6 Ω** / **15 mm** / **1200 W** (`2400 W MAX`) |
| `SPL (1W/1m)` / `EBP` / `Vd` | **86.0 dB** / **71.6 Hz** / **720 cm³** (`Sd = 480 cm²`) |
| Mounting dimensions | Cutout **282 mm** · Depth **162 mm** · Displacement **3.6 L** |

Sample slot-ported enclosure (`680 × 380 mm`, `18 mm` birch plywood, `55.0 L` net, `Fb = 35.0 Hz`, `180 cm²` port):
- **External depth**: `373.8 mm` (`Gross = 74.82 L`)
- **Port length**: `657.1 mm` (displacement `15.02 L`, equivalent to `2× Ø100 mm Aero-Flare` ≈ `622 mm`)
- **`1200 W` (`4π`) simulation**: `Peak SPL = 118.9 dB`, `F3 = 32 Hz`, port air velocity `9.5 m/s` (`< 17 m/s`)

---

## Unit Tests & Verification

The acoustic solver, T-S solver, WinISD `.wdr` parser, unit conversions, cut-list/sheet-nesting engine, and WSD simulator are verified by **41 unit tests** (`node:test` via `tsx`):

```bash
# Run all acoustic, T-S solver, .wdr parser, unit conversion, and WSD simulator unit tests
npx --yes tsx --test \
  src/engine/acoustics.test.ts \
  src/engine/simulator.test.ts \
  src/engine/tsSolver.test.ts \
  src/engine/winisdWdr.test.ts \
  src/engine/referenceComparison.test.ts \
  src/engine/units.test.ts

# TypeScript type-checking
npm run lint

# Production build
npm run build
```

---

## Project Architecture

```text
└── src/
    ├── i18n.tsx                     # Bilingual PL/EN LanguageProvider, unit system context & locale helpers
    ├── engine/
    │   ├── acoustics.ts             # Coupled CAD dimension solver, Helmholtz Fb, L/Aero ports, collisions
    │   ├── simulator.ts             # WSD simulator (17 curves, DSP filters, alignments)
    │   ├── tsSolver.ts              # Thiele-Small solver (Q triad, Mms/Cms, Bl, SPL, preset builder)
    │   ├── winisdWdr.ts             # WinISD .wdr INI parser & SI/practical unit auto-detection
    │   ├── units.ts                 # Bidirectional metric <-> imperial converters & display formatters
    │   ├── cutlist.ts               # Panel cut-list generator & 2D sheet nesting optimizer
    │   ├── sceneBuilder.ts          # Three.js parametric 3D geometry generator
    │   ├── materials3d.ts           # Procedural birch plywood, MDF, and laminate textures
    │   ├── presets.ts               # Built-in driver preset & enclosure templates
    │   ├── sharing.ts               # URL model token serialization/deserialization
    │   ├── types.ts                 # CAD & Thiele-Small TypeScript domain types
    │   └── *.test.ts                # 41 unit tests (physics, solver, WSD, .wdr, units, i18n)
    └── components/
        ├── AcousticWorkbench.tsx    # WSD laboratory & multi-variant comparison workbench
        ├── DriverTsModal.tsx        # Custom T-S driver & .wdr import modal
        ├── Viewport3D.tsx           # Three.js CAD viewport, cameras, X-Ray/Wireframe/Exploded modes
        ├── SidebarControls.tsx      # Enclosure, port & driver parameter controls (responsive drawer)
        ├── TelemetryStrip.tsx       # Live acoustic metrics strip (Vnet, Fb, S, air velocity)
        ├── AcousticChart.tsx        # Quick SPL response chart
        ├── CutListView.tsx          # Panel cut-list table & CSV export
        ├── SheetNestingView.tsx     # 2D sheet nesting visualizer
        ├── ShareModal.tsx           # Project sharing & JSON import/export modal
        └── ImmediateNumberInput.tsx # Responsive numeric input control
```

