import type { AcousticResult, BoxParams } from '../engine/types';

interface TelemetryStripProps {
  params: BoxParams;
  acoustics: AcousticResult;
}

export function TelemetryStrip({ params, acoustics }: TelemetryStripProps) {
  const isBandpass =
    params.enclosureType === 'bandpass_4th' || params.enclosureType === 'bandpass_6th';

  const velocityLabel =
    acoustics.portVelocityStatus === 'ideal'
      ? 'Optymalna'
      : acoustics.portVelocityStatus === 'acceptable'
        ? 'Akceptowalna'
        : acoustics.portVelocityStatus === 'chuffing'
          ? 'Ryzyko świstu'
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
      aria-label="Parametry akustyczne"
      className="w-full bg-[#111318] border-b border-white/[0.08] px-3 py-2.5 sm:px-5 sm:py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-3 gap-y-2 sm:gap-4 shrink-0"
    >
      <div>
        <div className="text-[11px] text-zinc-400">
          {isBandpass ? 'Komora przód / tył' : 'Objętość netto (Vnet)'}
        </div>
        <div className="font-mono-num text-base sm:text-lg font-semibold text-white mt-0.5" data-testid="metric-vnet">
          {isBandpass
            ? `${acoustics.ventedChamberNetL.toFixed(1)} / ${acoustics.sealedChamberNetL.toFixed(1)} L`
            : `${acoustics.netVolumeL.toFixed(1)} L`}
        </div>
        <div className="text-[11px] text-zinc-500 font-mono-num">
          Brutto {acoustics.grossVolumeL.toFixed(1)} L
        </div>
      </div>

      <div>
        <div className="text-[11px] text-zinc-400">
          {params.enclosureType === 'sealed'
            ? 'Dobroć układu (Qtc)'
            : params.enclosureType === 'bandpass_6th'
              ? 'Strojenie (Tył / Przód)'
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
            ? `Rezonans Fc ${acoustics.sealedFcHz?.toFixed(1) ?? '—'} Hz`
            : `Spadek F3: ${acoustics.f3LowHz} Hz${acoustics.f3HighHz ? ` – ${acoustics.f3HighHz} Hz` : ''}`}
        </div>
      </div>

      <div>
        <div className="text-[11px] text-zinc-400">
          {params.enclosureType === 'bandpass_6th' ? 'Przekrój portów (S)' : 'Przekrój portu (S)'}
        </div>
        <div className="font-mono-num text-base sm:text-lg font-semibold text-white mt-0.5">
          {params.enclosureType === 'sealed'
            ? 'Zamknięta'
            : params.enclosureType === 'bandpass_6th'
              ? `${acoustics.rearPortAreaCm2.toFixed(0)} / ${acoustics.portAreaCm2.toFixed(0)} cm²`
              : `${acoustics.portAreaCm2.toFixed(0)} cm²`}
        </div>
        <div className="text-[11px] text-zinc-500 font-mono-num">
          {params.enclosureType === 'sealed'
            ? 'Brak otworu wentylacyjnego'
            : `Zalecane min. ${acoustics.recommendedMinPortAreaCm2} cm²`}
        </div>
      </div>

      <div>
        <div className="text-[11px] text-zinc-400">Prędkość powietrza</div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mt-0.5">
          <span className="font-mono-num text-base sm:text-lg font-semibold text-white">
            {params.enclosureType === 'sealed' ? '—' : `${acoustics.portVelocityMs.toFixed(1)} m/s`}
          </span>
          <span className={`text-xs font-medium ${velocityColor}`}>{velocityLabel}</span>
        </div>
        <div className="text-[11px] text-zinc-500 font-mono-num">
          {params.driverCount}× głośnik · {params.driverPowerW * params.driverCount} W RMS
        </div>
      </div>

      <div className="col-span-2 sm:col-span-1">
        <div className="text-[11px] text-zinc-400">Wyporność wewnętrzna</div>
        <div className="font-mono-num text-base sm:text-lg font-semibold text-white mt-0.5">
          {(acoustics.portTotalDisplacementL + acoustics.totalDriverDisplacementL + params.bracingVolumeL).toFixed(1)} L
        </div>
        <div className="text-[11px] text-zinc-500 font-mono-num sm:whitespace-nowrap">
          Port {acoustics.portTotalDisplacementL.toFixed(1)} · Głośnik {acoustics.totalDriverDisplacementL.toFixed(1)} L
        </div>
      </div>
    </section>
  );
}
