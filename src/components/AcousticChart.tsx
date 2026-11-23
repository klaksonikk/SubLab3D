import { useState } from 'react';
import type { AcousticResult, BoxParams } from '../engine/types';

interface AcousticChartProps {
  params: BoxParams;
  acoustics: AcousticResult;
}

export function AcousticChart({ params, acoustics }: AcousticChartProps) {
  const [hoverHz, setHoverHz] = useState<number | null>(null);
  const [chartMode, setChartMode] = useState<'spl' | 'velocity' | 'excursion'>('spl');

  const curve = acoustics.responseCurve;
  const W = 820;
  const H = 360;
  const padL = 56;
  const padR = 24;
  const padT = 24;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const minHz = 15;
  const maxHz = 150;
  const xForHz = (hz: number) =>
    padL + ((Math.log10(hz) - Math.log10(minHz)) / (Math.log10(maxHz) - Math.log10(minHz))) * plotW;

  const yMin = chartMode === 'spl' ? -24 : 0;
  const yMax =
    chartMode === 'spl'
      ? 9
      : chartMode === 'velocity'
        ? Math.max(35, Math.ceil(Math.max(...curve.map((c) => c.portVelocityMs)) / 5) * 5 + 5)
        : Math.max(params.driverXmax * 1.5, Math.ceil(Math.max(...curve.map((c) => c.excursionMm)) + 4));

  const yForVal = (val: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, val));
    return padT + ((yMax - clamped) / (yMax - yMin)) * plotH;
  };

  const getValue = (pt: (typeof curve)[number]) =>
    chartMode === 'spl' ? pt.splDb : chartMode === 'velocity' ? pt.portVelocityMs : pt.excursionMm;

  const pathD = curve
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xForHz(pt.hz).toFixed(1)} ${yForVal(getValue(pt)).toFixed(1)}`)
    .join(' ');

  const areaD = `${pathD} L ${xForHz(maxHz).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${xForHz(minHz).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const freqTicks = [15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150];
  const yTicks =
    chartMode === 'spl'
      ? [-24, -18, -12, -6, -3, 0, 3, 6]
      : chartMode === 'velocity'
        ? [0, 10, 17, 25, yMax]
        : [0, Math.round(params.driverXmax * 0.5), params.driverXmax, Math.round(yMax)];

  const hoveredPoint =
    hoverHz !== null
      ? curve.reduce((best, pt) => (Math.abs(pt.hz - hoverHz) < Math.abs(best.hz - hoverHz) ? pt : best), curve[0])
      : null;

  const updateHoverFromClientX = (svgEl: SVGSVGElement, clientX: number) => {
    const rect = svgEl.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * W;
    const norm = Math.max(0, Math.min(1, (relX - padL) / plotW));
    const hz = Math.pow(10, Math.log10(minHz) + norm * (Math.log10(maxHz) - Math.log10(minHz)));
    setHoverHz(Math.round(hz));
  };

  return (
    <div className="flex-1 overflow-y-auto cad-scroll p-3.5 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-white">Charakterystyka przenoszenia i dynamika portu</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Symulacja Thiele-Small (15–150 Hz) · Głośnik Fs {params.driverFs} Hz · Qts {params.driverQts} · Vas{' '}
            {params.driverVas} L
          </p>
        </div>

        <div className="w-full sm:w-auto grid grid-cols-3 sm:flex items-center gap-1 p-1 bg-[#161920] border border-white/10 rounded-md" role="group" aria-label="Tryb wykresu">
          <button
            type="button"
            onClick={() => setChartMode('spl')}
            className={`px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium rounded transition-colors text-center sm:whitespace-nowrap ${
              chartMode === 'spl' ? 'bg-red-600 text-white' : 'text-zinc-300 hover:text-white'
            }`}
          >
            <span className="sm:hidden">SPL (dB)</span>
            <span className="hidden sm:inline">Krzywa SPL (dB)</span>
          </button>
          <button
            type="button"
            onClick={() => setChartMode('velocity')}
            className={`px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium rounded transition-colors text-center sm:whitespace-nowrap ${
              chartMode === 'velocity' ? 'bg-red-600 text-white' : 'text-zinc-300 hover:text-white'
            }`}
          >
            <span className="sm:hidden">Port (m/s)</span>
            <span className="hidden sm:inline">Prędkość w porcie (m/s)</span>
          </button>
          <button
            type="button"
            onClick={() => setChartMode('excursion')}
            className={`px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium rounded transition-colors text-center sm:whitespace-nowrap ${
              chartMode === 'excursion' ? 'bg-red-600 text-white' : 'text-zinc-300 hover:text-white'
            }`}
          >
            <span className="sm:hidden">Wychył (mm)</span>
            <span className="hidden sm:inline">Wychył membrany (mm)</span>
          </button>
        </div>
      </div>

      {/* Main SVG Plot */}
      <div className="bg-[#111318] border border-white/[0.08] rounded-lg p-2.5 sm:p-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto select-none touch-pan-y"
          onMouseLeave={() => setHoverHz(null)}
          onMouseMove={(e) => updateHoverFromClientX(e.currentTarget, e.clientX)}
          onTouchStart={(e) => {
            const t = e.touches[0];
            if (t) updateHoverFromClientX(e.currentTarget, t.clientX);
          }}
          onTouchMove={(e) => {
            const t = e.touches[0];
            if (t) updateHoverFromClientX(e.currentTarget, t.clientX);
          }}
        >
          <defs>
            <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.30" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Vertical Frequency Gridlines */}
          {freqTicks.map((hz) => {
            const x = xForHz(hz);
            return (
              <g key={hz}>
                <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke="#1d2029" strokeWidth="1" />
                <text
                  x={x}
                  y={H - 16}
                  textAnchor="middle"
                  fill="#8e95a3"
                  fontSize="11"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {hz === 150 ? '150 Hz' : hz}
                </text>
              </g>
            );
          })}

          {/* Horizontal Gridlines */}
          {yTicks.map((val) => {
            const y = yForVal(val);
            const isReference =
              (chartMode === 'spl' && (val === 0 || val === -3)) ||
              (chartMode === 'velocity' && val === 25) ||
              (chartMode === 'excursion' && val === params.driverXmax);
            return (
              <g key={val}>
                <line
                  x1={padL}
                  y1={y}
                  x2={W - padR}
                  y2={y}
                  stroke={isReference ? (val === 25 || val === params.driverXmax ? '#f59e0b' : '#3b414f') : '#191c24'}
                  strokeWidth={isReference ? '1.2' : '1'}
                  strokeDasharray={isReference ? '4 4' : undefined}
                />
                <text
                  x={padL - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill="#8e95a3"
                  fontSize="11"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {val}
                  {chartMode === 'spl' ? ' dB' : chartMode === 'velocity' ? ' m/s' : ' mm'}
                </text>
              </g>
            );
          })}

          {/* Rear Tuning Frequency Marker Line (BP6) */}
          {acoustics.rearPortTuningHz &&
            acoustics.rearPortTuningHz >= minHz &&
            acoustics.rearPortTuningHz <= maxHz && (
              <g>
                <line
                  x1={xForHz(acoustics.rearPortTuningHz)}
                  y1={padT}
                  x2={xForHz(acoustics.rearPortTuningHz)}
                  y2={padT + plotH}
                  stroke="#a78bfa"
                  strokeWidth="1.5"
                  strokeDasharray="5 3"
                />
                <text
                  x={xForHz(acoustics.rearPortTuningHz) + 6}
                  y={padT + 28}
                  fill="#c4b5fd"
                  fontSize="11"
                  fontFamily="JetBrains Mono, monospace"
                >
                  Fb-low {acoustics.rearPortTuningHz.toFixed(1)} Hz
                </text>
              </g>
            )}

          {/* Tuning Frequency Marker Line */}
          {acoustics.tuningHz && acoustics.tuningHz >= minHz && acoustics.tuningHz <= maxHz && (
            <g>
              <line
                x1={xForHz(acoustics.tuningHz)}
                y1={padT}
                x2={xForHz(acoustics.tuningHz)}
                y2={padT + plotH}
                stroke="#06b6d4"
                strokeWidth="1.5"
                strokeDasharray="5 3"
              />
              <text
                x={xForHz(acoustics.tuningHz) + 6}
                y={padT + 14}
                fill="#22d3ee"
                fontSize="11"
                fontFamily="JetBrains Mono, monospace"
              >
                {params.enclosureType === 'bandpass_6th' ? 'Fb-high' : 'Fb'} {acoustics.tuningHz.toFixed(1)} Hz
              </text>
            </g>
          )}

          {/* Area & Response Curve */}
          <path d={areaD} fill="url(#curveFill)" />
          <path d={pathD} fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinejoin="round" />

          {/* Hover Crosshair */}
          {hoveredPoint && (
            <g>
              <line
                x1={xForHz(hoveredPoint.hz)}
                y1={padT}
                x2={xForHz(hoveredPoint.hz)}
                y2={padT + plotH}
                stroke="#a1a1aa"
                strokeWidth="1"
              />
              <circle
                cx={xForHz(hoveredPoint.hz)}
                cy={yForVal(getValue(hoveredPoint))}
                r="5"
                fill="#ef4444"
                stroke="#0a0b0e"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>

        {/* Crosshair Readout Footer */}
        <div className="mt-3 pt-3 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-2.5 sm:gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono-num">
            <span className="text-zinc-400">
              Częstotliwość:{' '}
              <strong className="text-white">{hoveredPoint ? `${hoveredPoint.hz} Hz` : 'Dotknij wykres'}</strong>
            </span>
            {hoveredPoint && (
              <>
                <span className="text-zinc-400">
                  Poziom: <strong className="text-red-400">{hoveredPoint.splDb.toFixed(1)} dB</strong>
                </span>
                {params.enclosureType !== 'sealed' && (
                  <span className="text-zinc-400">
                    Prędkość portu: <strong className="text-cyan-300">{hoveredPoint.portVelocityMs.toFixed(1)} m/s</strong>
                  </span>
                )}
                <span className="text-zinc-400">
                  Wychył: <strong className="text-white">{hoveredPoint.excursionMm.toFixed(1)} mm</strong>
                </span>
              </>
            )}
          </div>
          <div className="text-[11px] text-zinc-500">
            Linia przerywana: {chartMode === 'spl' ? '0 dB / -3 dB' : chartMode === 'velocity' ? 'Próg świstu 25 m/s' : `Limit Xmax (${params.driverXmax} mm)`}
          </div>
        </div>
      </div>

      {/* Acoustic Summary Interpretation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#111318] border border-white/[0.08] rounded-lg p-4">
          <div className="text-xs text-zinc-400">Dolne pasmo (-3 dB)</div>
          <div className="font-mono-num text-xl font-semibold text-white mt-1">
            {acoustics.f3LowHz} Hz
            {acoustics.f3HighHz ? ` – ${acoustics.f3HighHz} Hz` : ''}
          </div>
          <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
            Punkt spadku efektywności o 3 dB w wolnej przestrzeni (bez uwzględnienia podbicia kabiny samochodu +6..12 dB/okt).
          </p>
        </div>

        <div className="bg-[#111318] border border-white/[0.08] rounded-lg p-4">
          <div className="text-xs text-zinc-400">Bezpieczny filtr Subsonic</div>
          <div className="font-mono-num text-xl font-semibold text-cyan-300 mt-1">
            {params.enclosureType === 'sealed'
              ? 'Opcjonalny (18 Hz)'
              : acoustics.tuningHz
                ? `${Math.max(18, Math.round(acoustics.tuningHz * 0.78))} Hz`
                : '24 Hz'}
          </div>
          <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
            Zalecana częstotliwość filtra górnoprzepustowego chroniącego cewkę przed nadmiernym wychyłem poniżej strojenia.
          </p>
        </div>

        <div className="bg-[#111318] border border-white/[0.08] rounded-lg p-4">
          <div className="text-xs text-zinc-400">Stosunek portu do objętości</div>
          <div className="font-mono-num text-xl font-semibold text-white mt-1">
            {params.enclosureType === 'sealed'
              ? '—'
              : `${acoustics.portAreaPerLiterCm2.toFixed(2)} cm²/L`}
          </div>
          <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
            Optymalny zakres dla obudów codziennych i SQL wynosi 11–16 cm² przekroju portu na każdy litr objętości netto.
          </p>
        </div>
      </div>
    </div>
  );
}
