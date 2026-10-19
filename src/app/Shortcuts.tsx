// The keyboard and mouse reference: a keyboard button in the transport that
// shows every shortcut on hover, stays open when clicked, and toggles with ?.

import { Keyboard } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MOD_KEY } from './SongSearch';

type Row = [keys: ReactNode, what: string];

const k = (...keys: string[]) => (
  <>
    {keys.map((key, i) => (
      <kbd key={i}>{key}</kbd>
    ))}
  </>
);
const or = (a: ReactNode, b: ReactNode) => (
  <>
    {a} <span className="shortcut-or">/</span> {b}
  </>
);

function groups(hasBeats: boolean): { title: string; rows: Row[] }[] {
  return [
    {
      title: 'Playback',
      rows: [
        [k('Space'), 'Play / pause'],
        [or(k('Home'), k('End')), 'Start / end of the show'],
        [or(k('←'), k('→')), hasBeats ? 'Previous / next beat' : 'Back / forward ¼ second'],
        [or(k('Shift', '←'), k('Shift', '→')), hasBeats ? 'Previous / next bar' : 'Back / forward 1 second'],
        [or(k(','), k('.')), 'One frame back / forward'],
      ],
    },
    {
      title: 'Editing',
      rows: [
        [k(MOD_KEY, 'Z'), 'Undo'],
        [or(k(MOD_KEY, 'Shift', 'Z'), k(MOD_KEY, 'Y')), 'Redo'],
        [k(MOD_KEY, 'A'), 'Select all effects'],
        [or(k(MOD_KEY, 'C'), k(MOD_KEY, 'X')), 'Copy / cut'],
        [k(MOD_KEY, 'V'), 'Paste at the playhead'],
        [k(MOD_KEY, 'D'), 'Duplicate after the selection'],
        [k('Delete'), 'Delete the selection'],
        [or(k('Alt', '←'), k('Alt', '→')), 'Move the selection a frame (Shift: a beat)'],
        [or(k('Alt', '↑'), k('Alt', '↓')), 'Move the selection to the channel above / below'],
        [k('M'), 'Mirror left ↔ right'],
        [k('Esc'), 'Clear the selection'],
      ],
    },
    {
      title: 'Effect type (xLights keys)',
      rows: [
        [k('F'), 'On (Stop on a closure)'],
        [k('E', 'D', 'C'), 'Fade on over ½, 1, 2 s'],
        [k('W', 'S', 'X'), 'Fade off over ½, 1, 2 s'],
        [k('Q', 'A', 'Z'), 'Open, dance, close'],
      ],
    },
    {
      title: 'Timeline',
      rows: [
        ['Drag an empty row', 'Draw an effect'],
        ['Double-click a row', 'A one-second effect'],
        ['Drag an effect', 'Move it, also up or down to another channel'],
        [k(MOD_KEY, 'Drag'), 'Duplicate instead of move'],
        [k('Shift', 'Drag'), 'Box-select on empty space'],
        [or(k('Shift'), k(MOD_KEY)), 'Click to add to the selection'],
        [k('Alt'), 'Hold while dragging to skip snapping'],
        [k('Esc'), 'Cancel a drag'],
        [k(MOD_KEY, 'Scroll'), 'Zoom'],
        [k('Shift', 'Scroll'), 'Scroll sideways'],
      ],
    },
    {
      title: 'Show',
      rows: [
        [k(MOD_KEY, 'K'), 'Find a song'],
        [k('?'), 'Show or hide this list'],
      ],
    },
  ];
}

export function Shortcuts({ hasBeats }: { hasBeats: boolean }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const leave = useRef<number>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.key === '?') setPinned((p) => !p);
      else if (e.key === 'Escape') setPinned(false);
    };
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setPinned(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  const open = hover || pinned;
  return (
    <div
      className="shortcuts"
      ref={ref}
      onMouseEnter={() => {
        window.clearTimeout(leave.current);
        setHover(true);
      }}
      // A short grace period, so the pointer can travel to the card.
      onMouseLeave={() => (leave.current = window.setTimeout(() => setHover(false), 180))}
    >
      <button
        className={`round${pinned ? ' on' : ''}`}
        onClick={() => setPinned((p) => !p)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
      >
        <Keyboard size={16} />
      </button>
      {open && (
        <div className="shortcuts-card" role="dialog" aria-label="Keyboard shortcuts">
          <div className="shortcuts-grid">
            {groups(hasBeats).map((g) => (
              <section key={g.title}>
                <h3>{g.title}</h3>
                <dl>
                  {g.rows.map(([keys, what], i) => (
                    <div key={i} className="shortcut-row">
                      <dt>{keys}</dt>
                      <dd>{what}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
