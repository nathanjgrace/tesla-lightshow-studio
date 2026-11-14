// Paint for the 3D preview, laid out like Tesla's configurator: a row of
// factory color swatches for this exact vehicle version, plus a custom color
// with a choice of finish. It only changes the preview, never the show.

import { Check, ChevronDown, Palette } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  CUSTOM_FINISHES,
  factoryPaints,
  FINISH_LABELS,
  offerYears,
  resolvePaint,
  type PaintChoice,
  type PaintFinish,
} from '../core/paint';
import type { TrimChoice } from './car/CarScene';
import type { VehicleProfile } from '../core/vehicles';

/** A swatch that hints at the finish: gloss gets a highlight, metallic a sheen. */
function swatchStyle(hex: string, finish: PaintFinish): CSSProperties {
  const shine =
    finish === 'matte'
      ? 'transparent'
      : finish === 'satin'
        ? 'rgb(255 255 255 / 0.12)'
        : finish === 'metallic' || finish === 'stainless'
          ? 'rgb(255 255 255 / 0.42)'
          : 'rgb(255 255 255 / 0.3)';
  return {
    background: `radial-gradient(circle at 32% 28%, ${shine}, transparent 55%), radial-gradient(circle at 70% 80%, rgb(0 0 0 / 0.35), transparent 60%), ${hex}`,
  };
}

interface Props {
  vehicle: VehicleProfile;
  choice: PaintChoice | undefined;
  onChange: (choice: PaintChoice) => void;
  reflections: boolean;
  onReflections: (on: boolean) => void;
  /** Just the swatch, for the toolbar. */
  compact?: boolean;
  trim: TrimChoice;
  onTrim: (choice: TrimChoice) => void;
  /** Which of the trim options this car's 3D model can show. */
  trimOptions?: { trim: boolean; wheels: boolean };
}

const WHEELS: [TrimChoice['wheels'], string][] = [
  ['stock', 'Stock'],
  ['silver', 'Silver'],
  ['gray', 'Gray'],
  ['black', 'Black'],
];

export function PaintPicker({ vehicle, choice, onChange, reflections, onReflections, compact, trim, onTrim, trimOptions }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const offers = factoryPaints(vehicle.id);
  const current = resolvePaint(choice, vehicle.id);
  const isCustom = choice !== undefined && 'custom' in choice && current.name === 'Custom';
  const selectedOffer = isCustom ? undefined : (offers.find((o) => o.paint.hex === current.hex && o.paint.name === current.name) ?? offers[0]);
  // Remember the last custom color so switching back to Custom restores it.
  const [custom, setCustom] = useState<{ hex: string; finish: PaintFinish }>(() =>
    isCustom ? { hex: current.hex, finish: current.finish } : { hex: '#3a6ea5', finish: 'metallic' },
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pickCustom = (next: { hex: string; finish: PaintFinish }) => {
    setCustom(next);
    onChange({ custom: next.hex, finish: next.finish });
  };

  const meta = isCustom
    ? `${FINISH_LABELS[current.finish]} finish`
    : selectedOffer
      ? [selectedOffer.paint.wrap ? 'Tesla wrap' : FINISH_LABELS[selectedOffer.paint.finish], offerYears(selectedOffer)].filter(Boolean).join(' · ')
      : '';

  return (
    <div className={`paint-picker${compact ? ' compact' : ''}`} ref={ref}>
      <button
        className={`paint-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Paint: ${current.name}`}
        title={`Paint: ${current.name} (preview only)`}
      >
        <span className="paint-dot" style={swatchStyle(current.hex, current.finish)} />
        {!compact && (
          <>
            <span className="truncate">{current.name}</span>
            <ChevronDown size={13} className="menu-chevron" />
          </>
        )}
      </button>
      {open && (
        <div className="paint-panel" role="dialog" aria-label="Paint, trim and wheels">
          <div className="paint-head">
            <span>Paint, trim and wheels</span>
            <span className="paint-head-hint">{vehicle.name}</span>
          </div>
          <div className="paint-swatches" role="radiogroup" aria-label="Factory colors">
            {offers.map((o) => {
              const on = !isCustom && selectedOffer?.paint.id === o.paint.id;
              const years = offerYears(o);
              return (
                <button
                  key={o.paint.id}
                  role="radio"
                  aria-checked={on}
                  className={`paint-swatch${on ? ' on' : ''}`}
                  style={swatchStyle(o.paint.hex, o.paint.finish)}
                  title={`${o.paint.name}${o.paint.wrap ? ' (Tesla wrap)' : ''}${years ? ` · ${years}` : ''}`}
                  aria-label={o.paint.name}
                  onClick={() => onChange({ paintId: o.paint.id })}
                >
                  {on && <Check size={14} strokeWidth={3} className="paint-check" />}
                </button>
              );
            })}
            <button
              role="radio"
              aria-checked={isCustom}
              className={`paint-swatch custom${isCustom ? ' on' : ''}`}
              title="Custom color"
              aria-label="Custom color"
              onClick={() => pickCustom(custom)}
            >
              <Palette size={14} />
            </button>
          </div>
          <div className="paint-name">{current.name}</div>
          <div className="paint-meta">{meta}</div>

          {isCustom && (
            <div className="paint-custom">
              <label className="paint-color-field">
                <input type="color" value={custom.hex} onChange={(e) => pickCustom({ ...custom, hex: e.target.value })} aria-label="Pick a color" />
                <input
                  className="paint-hex"
                  defaultValue={custom.hex}
                  key={custom.hex}
                  spellCheck={false}
                  aria-label="Hex color"
                  onBlur={(e) => {
                    const v = e.target.value.trim().replace(/^([^#])/, '#$1');
                    if (/^#[0-9a-f]{6}$/i.test(v)) pickCustom({ ...custom, hex: v.toLowerCase() });
                    else e.target.value = custom.hex;
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
              </label>
              <div className="segmented paint-finishes" role="radiogroup" aria-label="Finish">
                {CUSTOM_FINISHES.map((f) => (
                  <button key={f} role="radio" aria-checked={custom.finish === f} className={custom.finish === f ? 'on' : ''} onClick={() => pickCustom({ ...custom, finish: f })}>
                    {FINISH_LABELS[f]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="paint-row">
            <span className="paint-row-label">Trim</span>
            <div className="segmented" role="radiogroup" aria-label="Trim">
              {(['chrome', 'black'] as const).map((t) => (
                <button key={t} role="radio" aria-checked={trim.trim === t} disabled={trimOptions && !trimOptions.trim} className={trim.trim === t ? 'on' : ''} onClick={() => onTrim({ ...trim, trim: t })}>
                  {t === 'chrome' ? 'Chrome' : 'Black'}
                </button>
              ))}
            </div>
          </div>
          <div className="paint-row">
            <span className="paint-row-label">Wheels</span>
            <div className="segmented" role="radiogroup" aria-label="Wheel color">
              {WHEELS.map(([w, label]) => (
                <button key={w} role="radio" aria-checked={trim.wheels === w} disabled={trimOptions && !trimOptions.wheels} className={trim.wheels === w ? 'on' : ''} onClick={() => onTrim({ ...trim, wheels: w })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {trimOptions && (!trimOptions.trim || !trimOptions.wheels) && (
            <p className="paint-foot">
              {!trimOptions.trim && !trimOptions.wheels ? "This car's 3D model has its trim and wheels in one piece, so they can't be recolored." : !trimOptions.trim ? "This car's 3D model has no separate chrome trim." : "This car's 3D model has no separate wheel finish."}
            </p>
          )}

          <label className="paint-toggle">
            <span>
              <span className="paint-toggle-title">Reflections</span>
              <span className="paint-toggle-hint">Off keeps reflections on the paint from being mistaken for light effects.</span>
            </span>
            <input type="checkbox" role="switch" checked={reflections} onChange={(e) => onReflections(e.target.checked)} />
          </label>
          <p className="paint-foot">Colors are approximate and only change the preview.</p>
        </div>
      )}
    </div>
  );
}
