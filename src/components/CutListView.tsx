import { Download, Printer } from 'lucide-react';
import type { BoxParams, CutSheetSummary } from '../engine/types';

interface CutListViewProps {
  params: BoxParams;
  summary: CutSheetSummary;
}

export function CutListView({ params, summary }: CutListViewProps) {
  const handleDownloadCsv = () => {
    const header = ['Element', 'Ilosc', 'Szerokosc (mm)', 'Wysokosc (mm)', 'Grubosc (mm)', 'Powierzchnia (m2)', 'Uwagi'];
    const rows = summary.panels.map((p) => [
      `"${p.name}"`,
      p.quantity,
      p.width,
      p.height,
      p.thickness,
      p.areaM2.toFixed(3),
      `"${p.notes}"`,
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sublab-cutlist-${params.externalWidth}x${params.externalHeight}x${params.externalDepth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const joineryLabels: Record<BoxParams['joineryType'], string> = {
    top_bottom_cover: 'Wieńce góra/dół na bokach',
    sides_full: 'Boki pełne',
    front_back_cover: 'Front i tył nakładane',
  };

  return (
    <div className="flex-1 overflow-y-auto cad-scroll p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Lista cięcia formatek (Cut-List)</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Połączenie: {joineryLabels[params.joineryType]} · Grubość płyty: {params.thickness} mm · Łączna powierzchnia:{' '}
            <span className="font-mono-num text-zinc-200">{summary.totalPanelAreaM2.toFixed(2)} m²</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-200 bg-[#161920] border border-white/15 rounded-md hover:bg-white/5 transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Drukuj</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-500 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Eksportuj CSV</span>
          </button>
        </div>
      </div>

      {/* Cut-List Table */}
      <div className="bg-[#111318] border border-white/[0.08] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" data-testid="cutlist-table">
            <thead>
              <tr className="border-b border-white/[0.08] bg-[#0B0D11] text-[11px] font-medium text-zinc-400">
                <th className="py-3 px-4">Nazwa elementu</th>
                <th className="py-3 px-4 text-right">Szt.</th>
                <th className="py-3 px-4 text-right">Wymiar A (mm)</th>
                <th className="py-3 px-4 text-right">Wymiar B (mm)</th>
                <th className="py-3 px-4 text-right">Grubość</th>
                <th className="py-3 px-4 text-right">Pow. (m²)</th>
                <th className="py-3 px-4">Obróbka / Wycięcia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-xs">
              {summary.panels.map((panel) => (
                <tr key={panel.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-4 font-medium text-white">{panel.name}</td>
                  <td className="py-3 px-4 text-right font-mono-num text-red-400 font-semibold">
                    {panel.quantity}×
                  </td>
                  <td className="py-3 px-4 text-right font-mono-num text-white">{panel.width}</td>
                  <td className="py-3 px-4 text-right font-mono-num text-white">{panel.height}</td>
                  <td className="py-3 px-4 text-right font-mono-num text-zinc-400">{panel.thickness} mm</td>
                  <td className="py-3 px-4 text-right font-mono-num text-zinc-300">{panel.areaM2.toFixed(3)}</td>
                  <td className="py-3 px-4 text-zinc-400">{panel.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary Material Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#111318] border border-white/[0.08] rounded-lg p-4">
          <div className="text-xs text-zinc-400">Liczba formatek do cięcia</div>
          <div className="font-mono-num text-xl font-semibold text-white mt-1">
            {summary.panels.reduce((acc, p) => acc + p.quantity, 0)} szt.
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">W tym elementy przegrody portu</div>
        </div>
        <div className="bg-[#111318] border border-white/[0.08] rounded-lg p-4">
          <div className="text-xs text-zinc-400">Powierzchnia netto płyt</div>
          <div className="font-mono-num text-xl font-semibold text-white mt-1">
            {summary.totalPanelAreaM2.toFixed(2)} m²
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Zapotrzebowanie na arkusze {summary.sheetWidth}×{summary.sheetHeight} mm: {summary.sheetCount} szt.
          </div>
        </div>
        <div className="bg-[#111318] border border-white/[0.08] rounded-lg p-4">
          <div className="text-xs text-zinc-400">Szacowana waga samej skrzyni</div>
          <div className="font-mono-num text-xl font-semibold text-red-400 mt-1">
            {summary.estimatedWeightKg.toFixed(1)} kg
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">Bez masy głośników i terminala</div>
        </div>
      </div>
    </div>
  );
}
