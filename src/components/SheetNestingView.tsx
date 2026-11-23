import type { BoxParams, CutSheetSummary } from '../engine/types';
import { useI18n } from '../i18n';
import { ImmediateNumberInput } from './ImmediateNumberInput';

interface SheetNestingViewProps {
  params: BoxParams;
  summary: CutSheetSummary;
  onChange: (patch: Partial<BoxParams>) => void;
}

export function SheetNestingView({ params, summary, onChange }: SheetNestingViewProps) {
  const { lang } = useI18n();
  const isEn = lang === 'en';
  const sheets = Array.from({ length: Math.max(1, summary.sheetCount) }, (_, idx) => ({
    index: idx,
    items: summary.placedPanels.filter((p) => p.sheetIndex === idx),
  }));

  const categoryStyles = {
    enclosure: { fill: '#1b2332', stroke: '#38bdf8', text: '#e0f2fe' },
    baffle: { fill: '#351619', stroke: '#ef4444', text: '#fee2e2' },
    port: { fill: '#142a2e', stroke: '#22d3ee', text: '#cffafe' },
  };

  return (
    <div className="flex-1 overflow-y-auto cad-scroll p-3.5 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-white">
            {isEn ? '2D Sheet Nesting Optimization' : 'Optymalizacja rozkroju arkusza (2D Nesting)'}
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {isEn ? 'Board utilization:' : 'Wykorzystanie płyty:'}{' '}
            <strong className="font-mono-num text-red-400">{summary.utilizationPercent.toFixed(1)}%</strong> ·{' '}
            {isEn ? 'Sheets:' : 'Liczba arkuszy:'}{' '}
            <strong className="font-mono-num text-white">{summary.sheetCount}</strong> ·{' '}
            {isEn ? 'Saw kerf:' : 'Rzaz piły:'}{' '}
            <strong className="font-mono-num text-white">{params.sawKerf} mm</strong>
          </p>
        </div>

        <div className="w-full sm:w-auto flex flex-wrap items-center gap-2.5 sm:gap-3">
          <div className="w-full sm:w-auto">
            <label htmlFor="sheet-format" className="sr-only">
              {isEn ? 'Sheet dimensions' : 'Format arkusza'}
            </label>
            <select
              id="sheet-format"
              value={`${params.sheetWidth}x${params.sheetHeight}`}
              onChange={(e) => {
                const [w, h] = e.target.value.split('x').map(Number);
                onChange({ sheetWidth: w, sheetHeight: h });
              }}
              className="w-full sm:w-auto bg-[#161920] border border-white/15 rounded-md px-3 py-1.5 text-xs text-white font-mono-num focus:outline-none focus:border-red-500"
            >
              <option value="2500x1250">
                {isEn ? 'Sheet 2500 × 1250 mm (Plywood)' : 'Arkusz 2500 × 1250 mm (Sklejka)'}
              </option>
              <option value="2440x1220">
                {isEn ? 'Sheet 2440 × 1220 mm (Std MDF)' : 'Arkusz 2440 × 1220 mm (MDF std)'}
              </option>
              <option value="2800x2070">
                {isEn ? 'Sheet 2800 × 2070 mm (Cabinet)' : 'Arkusz 2800 × 2070 mm (Stolarski)'}
              </option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-[#161920] border border-white/15 rounded-md px-2.5 py-1">
            <label htmlFor="saw-kerf" className="text-xs text-zinc-400 whitespace-nowrap">
              {isEn ? 'Saw kerf:' : 'Rzaz piły:'}
            </label>
            <ImmediateNumberInput
              id="saw-kerf"
              value={params.sawKerf}
              min={0}
              max={10}
              decimals={1}
              onChange={(sawKerf) => onChange({ sawKerf })}
              className="w-12 bg-transparent text-right font-mono-num text-xs text-white focus:outline-none"
            />
            <span className="text-[11px] text-zinc-500">mm</span>
          </div>
        </div>
      </div>

      {/* Category Legend (clean unboxed text with color swatches) */}
      <div className="flex flex-wrap items-center gap-5 text-xs text-zinc-300">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-xs bg-[#1b2332] border border-[#38bdf8]" />
          <span>{isEn ? 'Main enclosure walls' : 'Ściany główne obudowy'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-xs bg-[#351619] border border-[#ef4444]" />
          <span>{isEn ? 'Front / Driver baffle' : 'Front / Przegroda głośnika'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-xs bg-[#142a2e] border border-[#22d3ee]" />
          <span>{isEn ? 'Port channel baffles' : 'Elementy tunelu portu'}</span>
        </div>
      </div>

      {/* Sheet Diagrams */}
      <div className="space-y-6">
        {sheets.map((sheet) => (
          <div key={sheet.index} className="bg-[#111318] border border-white/[0.08] rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-white">
                {isEn ? 'Sheet' : 'Arkusz'} #{sheet.index + 1} ({params.sheetWidth} × {params.sheetHeight} mm)
              </span>
              <span className="font-mono-num text-zinc-400">
                {sheet.items.length} {isEn ? 'panels on sheet' : 'formatek na arkuszu'}
              </span>
            </div>

            <svg
              viewBox={`0 0 ${params.sheetWidth} ${params.sheetHeight}`}
              className="w-full h-auto bg-[#08090C] border border-white/15 rounded"
              data-testid={`nesting-sheet-${sheet.index}`}
            >
              {/* Subtle sheet grid every 250 mm */}
              {Array.from({ length: Math.floor(params.sheetWidth / 250) }, (_, i) => (i + 1) * 250).map((gx) => (
                <line
                  key={`gx-${gx}`}
                  x1={gx}
                  y1={0}
                  x2={gx}
                  y2={params.sheetHeight}
                  stroke="#161921"
                  strokeWidth="2"
                />
              ))}
              {Array.from({ length: Math.floor(params.sheetHeight / 250) }, (_, i) => (i + 1) * 250).map((gy) => (
                <line
                  key={`gy-${gy}`}
                  x1={0}
                  y1={gy}
                  x2={params.sheetWidth}
                  y2={gy}
                  stroke="#161921"
                  strokeWidth="2"
                />
              ))}

              {sheet.items.map((item) => {
                const st = categoryStyles[item.category];
                const clipId = `clip-${sheet.index}-${item.panelId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
                const dimText = `${item.width} × ${item.height} mm${item.rotated ? ' ↻' : ''}`;
                const shortName = item.name.length > 20 ? `${item.name.slice(0, 19)}…` : item.name;
                const maxFontByWidth = Math.floor((item.width * 0.86) / Math.max(8, shortName.length * 0.56));
                const maxFontByHeight = Math.floor(item.height * 0.14);
                const fontSize = Math.max(16, Math.min(36, maxFontByWidth, maxFontByHeight));
                const canRenderText = item.width >= 150 && item.height >= 95;
                return (
                  <g key={item.panelId}>
                    <defs>
                      <clipPath id={clipId}>
                        <rect x={item.x + 6} y={item.y + 6} width={Math.max(1, item.width - 12)} height={Math.max(1, item.height - 12)} />
                      </clipPath>
                    </defs>
                    <rect
                      x={item.x}
                      y={item.y}
                      width={item.width}
                      height={item.height}
                      fill={st.fill}
                      stroke={st.stroke}
                      strokeWidth="3"
                    />
                    {canRenderText && (
                      <g clipPath={`url(#${clipId})`}>
                        <text
                          x={item.x + item.width / 2}
                          y={item.y + item.height / 2 - fontSize * 0.25}
                          textAnchor="middle"
                          fill={st.text}
                          fontSize={fontSize}
                          fontWeight="600"
                          fontFamily="Public Sans, sans-serif"
                        >
                          {shortName}
                        </text>
                        <text
                          x={item.x + item.width / 2}
                          y={item.y + item.height / 2 + fontSize * 0.95}
                          textAnchor="middle"
                          fill={st.stroke}
                          fontSize={Math.max(14, Math.round(fontSize * 0.82))}
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {dimText}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}
