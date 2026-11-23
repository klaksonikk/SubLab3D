import { Download, Printer } from 'lucide-react';
import type { BoxParams, CutSheetSummary } from '../engine/types';
import {
  formatLen,
  formatLenNum,
  getUnitLabels,
  toDisplayBoardArea,
  toDisplayLen,
  toDisplayWeightKg,
} from '../engine/units';
import { useI18n } from '../i18n';

interface CutListViewProps {
  params: BoxParams;
  summary: CutSheetSummary;
}

export function CutListView({ params, summary }: CutListViewProps) {
  const { lang, unitSystem } = useI18n();
  const isEn = lang === 'en';
  const isImp = unitSystem === 'imperial';
  const u = getUnitLabels(unitSystem);

  const handleDownloadCsv = () => {
    const header = isEn
      ? [
          'Panel',
          'Qty',
          `Width (${u.len})`,
          `Height (${u.len})`,
          `Thickness (${u.len})`,
          `Area (${u.boardArea})`,
          'Notes',
        ]
      : [
          'Element',
          'Ilosc',
          `Szerokosc (${u.len})`,
          `Wysokosc (${u.len})`,
          `Grubosc (${u.len})`,
          `Powierzchnia (${u.boardArea})`,
          'Uwagi',
        ];
    const rows = summary.panels.map((p) => [
      `"${p.name}"`,
      p.quantity,
      isImp ? toDisplayLen(p.width, unitSystem).toFixed(2) : p.width,
      isImp ? toDisplayLen(p.height, unitSystem).toFixed(2) : p.height,
      isImp ? toDisplayLen(p.thickness, unitSystem).toFixed(2) : p.thickness,
      toDisplayBoardArea(p.areaM2, unitSystem).toFixed(3),
      `"${p.notes}"`,
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sublab-cutlist-${formatLenNum(params.externalWidth, unitSystem, 0, 1)}x${formatLenNum(params.externalHeight, unitSystem, 0, 1)}x${formatLenNum(params.externalDepth, unitSystem, 0, 1)}${u.len}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const joineryLabels: Record<BoxParams['joineryType'], string> = isEn
    ? {
        top_bottom_cover: 'Top & bottom overlap',
        sides_full: 'Full sides',
        front_back_cover: 'Front & back overlap',
      }
    : {
        top_bottom_cover: 'Wieńce góra/dół na bokach',
        sides_full: 'Boki pełne',
        front_back_cover: 'Front i tył nakładane',
      };

  const qtySuffix = isEn ? 'pcs' : 'szt.';

  return (
    <div className="flex-1 overflow-y-auto cad-scroll p-3.5 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-white">
            {isEn ? 'Panel Cut-List' : 'Lista cięcia formatek (Cut-List)'}
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {isEn ? 'Joinery:' : 'Połączenie:'} {joineryLabels[params.joineryType]} ·{' '}
            {isEn ? 'Thickness:' : 'Grubość płyty:'} {formatLen(params.thickness, unitSystem, 0, 2)} ·{' '}
            {isEn ? 'Total area:' : 'Łączna powierzchnia:'}{' '}
            <span className="font-mono-num text-zinc-200">
              {toDisplayBoardArea(summary.totalPanelAreaM2, unitSystem).toFixed(2)} {u.boardArea}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-medium text-zinc-200 bg-[#161920] border border-white/15 rounded-md hover:bg-white/5 transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{isEn ? 'Print' : 'Drukuj'}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-500 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isEn ? 'Export CSV' : 'Eksportuj CSV'}</span>
          </button>
        </div>
      </div>

      {/* Cut-List Table */}
      <div className="bg-[#111318] border border-white/[0.08] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" data-testid="cutlist-table">
            <thead>
              <tr className="border-b border-white/[0.08] bg-[#0B0D11] text-[11px] font-medium text-zinc-400">
                <th className="py-2.5 px-2.5 sm:py-3 sm:px-4">
                  {isEn ? 'Panel name' : 'Nazwa elementu'}
                </th>
                <th className="py-2.5 px-1.5 sm:py-3 sm:px-4 text-right whitespace-nowrap">
                  {isEn ? 'Qty' : 'Szt.'}
                </th>
                <th className="py-2.5 px-2 sm:py-3 sm:px-4 text-right whitespace-nowrap">
                  <span className="sm:hidden">A ({u.len})</span>
                  <span className="hidden sm:inline">
                    {isEn ? `Dim A (${u.len})` : `Wymiar A (${u.len})`}
                  </span>
                </th>
                <th className="py-2.5 px-2 sm:py-3 sm:px-4 text-right whitespace-nowrap">
                  <span className="sm:hidden">B ({u.len})</span>
                  <span className="hidden sm:inline">
                    {isEn ? `Dim B (${u.len})` : `Wymiar B (${u.len})`}
                  </span>
                </th>
                <th className="py-2.5 px-2 sm:py-3 sm:px-4 text-right whitespace-nowrap">
                  {isEn ? 'Thk.' : 'Gr.'}
                </th>
                <th className="py-2.5 px-2 sm:py-3 sm:px-4 text-right whitespace-nowrap">
                  {isEn ? `Area (${u.boardArea})` : `Pow. (${u.boardArea})`}
                </th>
                <th className="py-2.5 px-2.5 sm:py-3 sm:px-4 whitespace-nowrap">
                  {isEn ? 'Machining / Cutouts' : 'Obróbka / Wycięcia'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-xs">
              {summary.panels.map((panel) => (
                <tr key={panel.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 px-2.5 sm:py-3 sm:px-4 font-medium text-white min-w-[120px] sm:whitespace-nowrap">{panel.name}</td>
                  <td className="py-2.5 px-1.5 sm:py-3 sm:px-4 text-right font-mono-num text-red-400 font-semibold whitespace-nowrap">
                    {panel.quantity}×
                  </td>
                  <td className="py-2.5 px-2 sm:py-3 sm:px-4 text-right font-mono-num text-white whitespace-nowrap">
                    {formatLenNum(panel.width, unitSystem, 0, 2)}
                  </td>
                  <td className="py-2.5 px-2 sm:py-3 sm:px-4 text-right font-mono-num text-white whitespace-nowrap">
                    {formatLenNum(panel.height, unitSystem, 0, 2)}
                  </td>
                  <td className="py-2.5 px-2 sm:py-3 sm:px-4 text-right font-mono-num text-zinc-400 whitespace-nowrap">
                    {formatLen(panel.thickness, unitSystem, 0, 2)}
                  </td>
                  <td className="py-2.5 px-2 sm:py-3 sm:px-4 text-right font-mono-num text-zinc-300 whitespace-nowrap">
                    {toDisplayBoardArea(panel.areaM2, unitSystem).toFixed(isImp ? 2 : 3)}
                  </td>
                  <td className="py-2.5 px-2.5 sm:py-3 sm:px-4 text-zinc-400 min-w-[180px]">{panel.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary Material Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#111318] border border-white/[0.08] rounded-lg p-4">
          <div className="text-xs text-zinc-400">
            {isEn ? 'Total panels to cut' : 'Liczba formatek do cięcia'}
          </div>
          <div className="font-mono-num text-xl font-semibold text-white mt-1">
            {summary.panels.reduce((acc, p) => acc + p.quantity, 0)} {qtySuffix}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            {isEn ? 'Includes slot port baffles' : 'W tym elementy przegrody portu'}
          </div>
        </div>
        <div className="bg-[#111318] border border-white/[0.08] rounded-lg p-4">
          <div className="text-xs text-zinc-400">
            {isEn ? 'Net board area' : 'Powierzchnia netto płyt'}
          </div>
          <div className="font-mono-num text-xl font-semibold text-white mt-1">
            {toDisplayBoardArea(summary.totalPanelAreaM2, unitSystem).toFixed(2)} {u.boardArea}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            {isEn
              ? `Required ${formatLenNum(summary.sheetWidth, unitSystem, 0, 1)}×${formatLenNum(summary.sheetHeight, unitSystem, 0, 1)} ${u.len} sheets: ${summary.sheetCount} ${qtySuffix}`
              : `Zapotrzebowanie na arkusze ${formatLenNum(summary.sheetWidth, unitSystem, 0, 1)}×${formatLenNum(summary.sheetHeight, unitSystem, 0, 1)} ${u.len}: ${summary.sheetCount} ${qtySuffix}`}
          </div>
        </div>
        <div className="bg-[#111318] border border-white/[0.08] rounded-lg p-4">
          <div className="text-xs text-zinc-400">
            {isEn ? 'Estimated empty box weight' : 'Szacowana waga samej skrzyni'}
          </div>
          <div className="font-mono-num text-xl font-semibold text-red-400 mt-1">
            {toDisplayWeightKg(summary.estimatedWeightKg, unitSystem).toFixed(1)} {u.weight}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            {isEn ? 'Excluding subwoofers & terminal hardware' : 'Bez masy głośników i terminala'}
          </div>
        </div>
      </div>
    </div>
  );
}

