import type { AcousticResult, BoxParams } from '../engine/types';
import { useI18n } from '../i18n';

interface TelemetryStripProps {
  params: BoxParams;
  acoustics: AcousticResult;
}

export function TelemetryStrip({ params, acoustics }: TelemetryStripProps) {
  const { lang } = useI18n();
  const isEn = lang === 'en';
  const isBandpass =
    params.enclosureType === 'bandpass_4th' || params.enclosureType === 'bandpass_6th';

  const velocityLabel =
    acoustics.portVelocityStatus === 'ideal'
      ? isEn
        ? 'Optimal'
        : 'Optymalna'
      : acoustics.portVelocityStatus === 'acceptable'
        ? isEn
          ? 'Acceptable'
          : 'Akceptowalna'
        : acoustics.portVelocityStatus === 'chuffing'
          ? isEn
            ? 'Chuffing risk'
            : 'Ryzyko świstu'
          : isEn
            ? 'No port'
            : 'Brak portu';

  const velocityColor =
    acoustics.portVelocityStatus === 'ideal'
      ? 'text-emerald-400'
      : acoustics.portVelocityStatus === 'acceptable'
        ? 'text-amber-400'
        : acoustics.portVelocityStatus === 'chuffing'
          ? 'text-red-400'
          : 'text-zinc-400';

  return (
    <section
      aria-label={isEn ? 'Acoustic telemetry' : 'Parametry akustyczne'}
      className="w-full bg-[#111318] border-b border-white/[0.08] px-3 py-2.5 sm:px-5 sm:py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-3 gap-y-2 sm:gap-4 shrink-0"
    >
      <div>
        <div className="text-[11px] text-zinc-400">
          {isBandpass
            ? isEn
              ? 'Front / rear chamber'
              : 'Komora przód / tył'
            : isEn
              ? 'Net volume (Vnet)'
              : 'Objętość netto (Vnet)'}
        </div>
        <div className="font-mono-num text-base sm:text-lg font-semibold text-white mt-0.5" data-testid="metric-vnet">
          {isBandpass
            ? `${acoustics.ventedChamberNetL.toFixed(1)} / ${acoustics.sealedChamberNetL.toFixed(1)} L`
            : `${acoustics.netVolumeL.toFixed(1)} L`}
        </div>
        <div className="text-[11px] text-zinc-500 font-mono-num">
          {isEn ? 'Gross' : 'Brutto'} {acoustics.grossVolumeL.toFixed(1)} L
        </div>
      </div>

      <div>
        <div className="text-[11px] text-zinc-400">
          {params.enclosureType === 'sealed'
            ? isEn
              ? 'System Q (Qtc)'
              : 'Dobroć układu (Qtc)'
            : params.enclosureType === 'bandpass_6th'
              ? isEn
                ? 'Tuning (Rear / Front)'
                : 'Strojenie (Tył / Przód)'
              : isEn
                ? 'Port tuning (Fb)'
                : 'Strojenie portu (Fb)'}
        </div>
        <div className="font-mono-num text-base sm:text-lg font-semibold text-red-400 mt-0.5" data-testid="metric-fb">
          {params.enclosureType === 'sealed'
            ? acoustics.sealedQtc?.toFixed(2) ?? '—'
            : params.enclosureType === 'bandpass_6th'
              ? `${acoustics.rearPortTuningHz?.toFixed(1) ?? '—'} / ${acoustics.tuningHz?.toFixed(1) ?? '—'} Hz`
              : acoustics.tuningHz
                ? `${acoustics.tuningHz.toFixed(1)} Hz`
                : '—'}
        </div>
        <div className="text-[11px] text-zinc-500 font-mono-num">
          {params.enclosureType === 'sealed'
            ? `${isEn ? 'Resonance Fc' : 'Rezonans Fc'} ${acoustics.sealedFcHz?.toFixed(1) ?? '—'} Hz`
            : `${isEn ? 'F3 rolloff' : 'Spadek F3'}: ${acoustics.f3LowHz} Hz${acoustics.f3HighHz ? ` – ${acoustics.f3HighHz} Hz` : ''}`}
        </div>
      </div>

      <div>
        <div className="text-[11px] text-zinc-400">
          {params.enclosureType === 'bandpass_6th'
            ? isEn
              ? 'Port areas (S)'
              : 'Przekrój portów (S)'
            : isEn
              ? 'Port area (S)'
              : 'Przekrój portu (S)'}
        </div>
        <div className="font-mono-num text-base sm:text-lg font-semibold text-white mt-0.5">
          {params.enclosureType === 'sealed'
            ? isEn
              ? 'Sealed'
              : 'Zamknięta'
            : params.enclosureType === 'bandpass_6th'
              ? `${acoustics.rearPortAreaCm2.toFixed(0)} / ${acoustics.portAreaCm2.toFixed(0)} cm²`
              : `${acoustics.portAreaCm2.toFixed(0)} cm²`}
        </div>
        <div className="text-[11px] text-zinc-500 font-mono-num">
          {params.enclosureType === 'sealed'
            ? isEn
              ? 'No vented opening'
              : 'Brak otworu wentylacyjnego'
            : `${isEn ? 'Recommended min.' : 'Zalecane min.'} ${acoustics.recommendedMinPortAreaCm2} cm²`}
        </div>
      </div>

      <div>
        <div className="text-[11px] text-zinc-400">
          {isEn ? 'Port air velocity' : 'Prędkość powietrza'}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mt-0.5">
          <span className="font-mono-num text-base sm:text-lg font-semibold text-white">
            {params.enclosureType === 'sealed' ? '—' : `${acoustics.portVelocityMs.toFixed(1)} m/s`}
          </span>
          <span className={`text-xs font-medium ${velocityColor}`}>{velocityLabel}</span>
        </div>
        <div className="text-[11px] text-zinc-500 font-mono-num">
          {params.driverCount}× {isEn ? (params.driverCount > 1 ? 'drivers' : 'driver') : 'głośnik'} ·{' '}
          {params.driverPowerW * params.driverCount} W RMS
        </div>
      </div>

      <div className="col-span-2 sm:col-span-1">
        <div className="text-[11px] text-zinc-400">
          {isEn ? 'Internal displacement' : 'Wyporność wewnętrzna'}
        </div>
        <div className="font-mono-num text-base sm:text-lg font-semibold text-white mt-0.5">
          {(acoustics.portTotalDisplacementL + acoustics.totalDriverDisplacementL + params.bracingVolumeL).toFixed(1)} L
        </div>
        <div className="text-[11px] text-zinc-500 font-mono-num sm:whitespace-nowrap">
          Port {acoustics.portTotalDisplacementL.toFixed(1)} · {isEn ? 'Driver' : 'Głośnik'}{' '}
          {acoustics.totalDriverDisplacementL.toFixed(1)} L
        </div>
      </div>
    </section>
  );
}
