# SubLab 3D — Projektant Obudów Subwooferowych CAD & Laboratorium T-S (WSD)

![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Three.js](https://img.shields.io/badge/Three.js-CAD%203D-000000?logo=threedotjs&logoColor=white)
**SubLab 3D** to zaawansowana aplikacja inżynierska do projektowania obudów car-audio i home-audio w 3D, symulacji akustycznej Thiele-Small (moduł **WSD**), generowania list cięcia oraz optymalizacji rozkroju płyt stolarskich 

---

## Spis treści

- [Kluczowe możliwości](#kluczowe-możliwości)
- [Laboratorium WSD (Analiza T-S)](#laboratorium-wsd-analiza-t-s)
- [Przykładowe porównanie — Deaf Bonce Machete MF-12R D2](#przykładowe-porównanie--deaf-bonce-machete-mf-12r-d2)
- [Testy jednostkowe i weryfikacja](#testy-jednostkowe-i-weryfikacja)
- [Architektura projektu](#architektura-projektu)

---

## Kluczowe możliwości

### 1. Parametryczny projektant 3D CAD (Three.js)
- **5 typów obudów**:
  - `Bass-Reflex Szczelinowy` (automatyczne zagięcie portu w kształt **L**, brak nachodzenia krawędzi ścianek, konfiguracja strony wylotu: prawa / lewa / dół),
  - `Bass-Reflex Okrągły / Aero` (1–4 rury, montaż na froncie, górze lub boku, przesunięcia X/Y i kontrola kolizji),
  - `Zamknięta (Sealed)`,
  - `Bandpass 4-go rzędu` (komora zamknięta + wentylowana z szybą akrylową),
  - `Bandpass 6-go rzędu` (dwie niezależnie strojone komory i dwa porty).
- **Tryb sprzężonego rozwiązywania geometrii**: automatyczne wyliczanie `Szerokości (W)`, `Wysokości (H)`, `Głębokości (D)` lub `Objętości (Vnet)` przy zachowaniu zadanego `Vnet`, strojenia `Fb` oraz przekroju portu `S`.
- **Układy wielogłośnikowe (1–6 głośników)**: automatyczne rozmieszczanie siatkowe i naprzemienne (*staggered / Quincunx*) z kontrolą luzu za magnesem i krawędzi montażowych.
- **Podgląd CAD**: tryby `X-Ray`, `Pełny`, `Szkielet`, widok rozstrzelony (*Exploded View*), siatka CAD, materiały (`Sklejka brzozowa`, `MDF`, `Laminat czarny`), podwójna ścianka przednia (`2×`).

### 2. Lista cięcia i rozkrój płyty (`Cut-List` & `Sheet Nesting`)
- **3 standardy łączenia płyt**: wieńce góra/dół na bokach, boki pełne, front i tył nakładane na całość.
- **Zestawienie formatek** uwzględniające grubość płyty (`15–25 mm`), podwójny front oraz przegrody portu szczelinowego / komór Bandpass.
- **Rozkrój na arkuszach** (m.in. `2500 × 1250 mm`) z wizualizacją wykorzystania materiału i odpadu.

### 3. Udostępnianie i pełny tryb offline
- Zapis projektu i bazy własnych głośników w `localStorage`, eksport/import bazy przetworników `.json` (w trybie Electron natywne okno zapisu pliku) oraz udostępnianie konfiguracji jednym linkiem (`?model=...`).

---

## Laboratorium WSD (Analiza T-S)

Zakładka **WSD** umożliwia precyzyjną analizę i porównanie do **4 projektów jednocześnie**:

| Obszar | Funkcje |
| :--- | :--- |
| **Baza i kreator T-S** | Dodawanie własnych głośników z automatycznym solverem zależności: triada `Qts / Qes / Qms`, `Fs / Vas ↔ Mms / Cms`, `Bl`, `Sd`, `η₀`, `SPL (1W/1m)`, `EBP`, `Vd`, kompresja termiczna cewki (`ΔT`, współczynnik temperaturowy), dodana masa membrany, układ **Iso-Barik** oraz konfiguracje cewek (`Parallel / Series / Series-Parallel`). |
| **Wyrównania (Alignments)** | Automatyczne propozycje na podstawie `EBP` i `Qts`: `Zamknięta B2`, `Zamknięta Chebyshev C2`, `Bass-Reflex SBB4 / QB3`, `Bass-Reflex Chebyshev (C4)`, `Bass-Reflex EBS / Street SQL`, `Bandpass 4-rz.`. |
| **Kalkulator portów** | Tryb **Rurowy (Okrągły)** (`1–4× Ø`, presety PVC/Aero `Ø75–Ø200 mm`, przycisk `Auto <17 m/s`, zakończenie `Aero-Flare k=0.732` vs `Prosta rura k=0.85`) oraz **Szczelinowy / Pole S**, wraz z wyliczaniem 1. rezonansu organowego tunelu. |
| **17 krzywych pomiarowych** | Charakterystyka `EQ/Filtry` i `Box`, `SPL (dB)`, `Max SPL` (ograniczony przez `Xmax` i moc `RMS`), `Max Power (W)`, `Apparent Load (VA)`, `Wychył membrany (mm)`, `Prędkość powietrza` i `Wzmocnienie` portu przedniego/tylnego, `Group Delay`, `Faza`, `Impedancja (Ω)` oraz `Faza impedancji`. |
| **Filtry DSP i akustyka auta** | Filtry **Butterworth 12/24 dB**, **Linkwitz-Riley 24 dB**, **Chebyshev 12/24 dB (Czebyszew)**, korektor **PEQ**, **Linkwitz Transform**, środowiska `4π`, `2π`, `π`, `Kabina auta` (Cabin Gain) oraz generator sygnału sinusoidalnego **Web Audio API (offline)**. |

---

## Przykładowe porównanie — Deaf Bonce Machete MF-12R D2

Wbudowany preset **`Deaf Bonce Machete MF-12R D2 (1200W)`** odwzorowuje parametry katalogowe przetwornika (połączenie szeregowe cewek `1.8 + 1.8 Ω = 3.6 Ω`):

| Parametr | Wartość |
| :--- | :--- |
| `Fs` / `Vas` / `Qts` | **37.6 Hz** / **24.8 L** / **0.470** (`Qes = 0.525`, `Qms = 4.49`) |
| `Re` / `Xmax` / `RMS` | **3.6 Ω** / **15 mm** / **1200 W** (`2400 W MAX`) |
| `SPL (1W/1m)` / `EBP` / `Vd` | **86.0 dB** / **71.6 Hz** / **720 cm³** (`Sd = 480 cm²`) |
| Wymiary montażowe | Otwór **282 mm** · Głębokość **162 mm** · Wyporność **3.6 L** |

Przykładowa obudowa szczelinowa (`680 × 380 mm`, płyta `18 mm`, `55.0 L netto`, `Fb = 35.0 Hz`, port `180 cm²`):
- **Głębokość zewnętrzna**: `373.8 mm` (`Brutto = 74.82 L`)
- **Długość portu**: `657.1 mm` (wyporność `15.02 L`, odpowiednik `2× Ø100 mm Aero-Flare` ≈ `622 mm`)
- **Symulacja `1200 W` (`4π`)**: `Peak SPL = 118.9 dB`, `F3 = 32 Hz`, prędkość w porcie `9.5 m/s` (`< 17 m/s`)

---


## Testy jednostkowe i weryfikacja

Logika akustyczna, solver T-S, układanie płyt i symulator WSD są pokryte **27 testami jednostkowymi** (`node:test`):

```bash
# Uruchomienie wszystkich testów fizyki akustycznej, solvera T-S i symulatora
npx --yes tsx --test \
  src/engine/acoustics.test.ts \
  src/engine/simulator.test.ts \
  src/engine/tsSolver.test.ts \
  src/engine/referenceComparison.test.ts

# Weryfikacja typów TypeScript
npm run lint
```

## Architektura projektu

```text
├── electron/
│   ├── main.cjs                     # Główny proces Electron (tryb offline, zapis JSON)
│   └── preload.cjs                  # Bezpieczny mostek IPC (window.sublabDesktop)
├── public/
│   └── .nojekyll                    # Obsługa zasobów na GitHub Pages
├── .github/workflows/
│   └── deploy-gh-pages.yml          # Automatyczny build i deploy na GitHub Pages
└── src/
    ├── engine/
    │   ├── acoustics.ts             # Solver wymiarów, Helmholtz Fb, porty L/Aero, kolizje
    │   ├── simulator.ts             # Symulator WSD (17 krzywych, filtry DSP, wyrównania)
    │   ├── tsSolver.ts              # Kalkulator T-S (triada Q, Mms/Cms, Bl, SPL, budowa presetu)
    │   ├── cutlist.ts               # Lista cięcia i optymalizacja rozkroju arkuszy
    │   ├── sceneBuilder.ts          # Generator geometrii 3D Three.js
    │   ├── materials3d.ts          # Proceduralne tekstury sklejki, MDF i laminatu
    │   ├── presets.ts               # Baza przetworników i gotowych szablonów obudów
    │   ├── sharing.ts               # Serializacja projektów do linków URL
    │   ├── types.ts                 # Typy TypeScript domeny CAD/T-S
    │   └── *.test.ts                # Zestaw 27 testów jednostkowych
    └── components/
        ├── AcousticWorkbench.tsx    # Główny panel laboratorium WSD
        ├── DriverTsModal.tsx        # Modal dodawania/edycji własnych głośników T-S
        ├── Viewport3D.tsx           # Scena Three.js, kamery CAD, tryby X-Ray/Szkielet
        ├── SidebarControls.tsx      # Panel parametrów obudowy, portu i przetwornika
        ├── TelemetryStrip.tsx       # Pasek metryk na żywo (Vnet, Fb, S, prędkość m/s)
        ├── AcousticChart.tsx        # Szybki wykres charakterystyki SPL
        ├── CutListView.tsx          # Tabela cięcia płyt i eksport
        ├── SheetNestingView.tsx     # Wizualizacja rozkroju na arkuszu
        └── ShareModal.tsx           # Udostępnianie i import konfiguracji
```
