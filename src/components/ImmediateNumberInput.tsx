import { useState } from 'react';

interface ImmediateNumberInputProps {
  id?: string;
  value: number;
  min?: number;
  max?: number;
  decimals?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  onChange: (value: number) => void;
}

function formatNumberDisplay(val: number, decimals?: number): string {
  if (!Number.isFinite(val)) return '0';
  if (decimals !== undefined) {
    return String(Number(val.toFixed(decimals)));
  }
  return String(Number(val.toFixed(4)));
}

/**
 * Keyboard-typed numeric input (no clickable steppers, no sliders) that commits
 * valid numeric edits immediately on keystroke while preserving intermediate drafts.
 */
export function ImmediateNumberInput({
  id,
  value,
  min = -Infinity,
  max = Infinity,
  decimals,
  disabled = false,
  placeholder,
  className = '',
  'aria-label': ariaLabel,
  onChange,
}: ImmediateNumberInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  const displayValue = focused ? draft : formatNumberDisplay(value, decimals);

  const commitParsed = (raw: string) => {
    const norm = raw.trim().replace(',', '.');
    if (norm === '' || norm === '-' || norm === '.' || norm === '-.') return;
    const parsed = Number(norm);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(max, Math.max(min, parsed));
    onChange(clamped);
  };

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      disabled={disabled}
      placeholder={placeholder}
      value={displayValue}
      onFocus={() => {
        setFocused(true);
        setDraft(formatNumberDisplay(value, decimals));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        commitParsed(raw);
      }}
      onBlur={() => {
        setFocused(false);
        commitParsed(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      className={className}
    />
  );
}
