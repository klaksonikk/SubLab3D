import { useRef, useState } from 'react';
import { Check, Copy, Download, Link2, Upload, X } from 'lucide-react';
import type { AcousticResult, BoxParams, DriverPreset } from '../engine/types';
import { buildShareUrl } from '../engine/sharing';
import { DEFAULT_BOX_PARAMS } from '../engine/presets';

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  params: BoxParams;
  acoustics: AcousticResult;
  activeCustomDriver?: DriverPreset;
  onImportModel: (params: BoxParams, customDriver?: DriverPreset) => void;
}

export function ShareModal({
  open,
  onClose,
  params,
  acoustics,
  activeCustomDriver,
  onImportModel,
}: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const shareUrl = buildShareUrl(
    `${window.location.origin}${window.location.pathname}`,
    params,
    activeCustomDriver,
  );

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback: select input manually if clipboard API blocked
      const input = document.getElementById('share-url-input') as HTMLInputElement | null;
      if (input) {
        input.select();
        document.execCommand('copy');
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2200);
      }
    }
  };

  const handleExportJson = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      params,
      customDriver: activeCustomDriver,
      acousticsSummary: {
        grossVolumeL: Number(acoustics.grossVolumeL.toFixed(2)),
        netVolumeL: Number(acoustics.netVolumeL.toFixed(2)),
        tuningHz: acoustics.tuningHz ? Number(acoustics.tuningHz.toFixed(1)) : null,
        rearPortTuningHz: acoustics.rearPortTuningHz
          ? Number(acoustics.rearPortTuningHz.toFixed(1))
          : null,
        sealedQtc: acoustics.sealedQtc ? Number(acoustics.sealedQtc.toFixed(3)) : null,
        portAreaCm2: Number(acoustics.portAreaCm2.toFixed(1)),
        f3LowHz: acoustics.f3LowHz,
        f3HighHz: acoustics.f3HighHz,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sublab-${params.enclosureType}-${params.externalWidth}x${params.externalHeight}x${params.externalDepth}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { params?: Partial<BoxParams>; customDriver?: DriverPreset };
      if (!parsed || !parsed.params || typeof parsed.params.externalWidth !== 'number') {
        setImportError('Nieprawidłowy format pliku JSON projektu SubLab 3D.');
        return;
      }
      onImportModel({ ...DEFAULT_BOX_PARAMS, ...parsed.params }, parsed.customDriver);
      onClose();
    } catch {
      setImportError('Nie udało się odczytać pliku JSON.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4"
    >
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-[#111318] border border-white/15 rounded-lg shadow-2xl">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 id="share-modal-title" className="text-base font-semibold text-white">
            Udostępnij lub wczytaj model
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno udostępniania"
            className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-5">
          {/* Shareable Link */}
          <div className="space-y-2">
            <label htmlFor="share-url-input" className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
              <Link2 className="w-3.5 h-3.5 text-red-400" />
              <span>Bezpośredni link do tego projektu 3D</span>
            </label>
            <p className="text-xs text-zinc-400">
              Link zawiera pełne wymiary obudowy, strojenie portów oraz parametry wybranego przetwornika.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                id="share-url-input"
                type="text"
                readOnly
                value={shareUrl}
                onFocus={(e) => e.target.select()}
                className="flex-1 min-w-0 bg-[#08090C] border border-white/15 rounded-md px-3 py-2 font-mono-num text-xs text-zinc-300 focus:outline-none focus:border-red-500"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Skopiowano' : 'Kopiuj link'}</span>
              </button>
            </div>
          </div>

          <div className="border-t border-white/[0.08] pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleExportJson}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-[#161920] border border-white/15 rounded-md hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <Download className="w-4 h-4 text-red-400" />
              <span>Eksportuj plik .JSON</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-[#161920] border border-white/15 rounded-md hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <Upload className="w-4 h-4 text-cyan-400" />
              <span>Wczytaj model .JSON</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {importError && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
              {importError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
