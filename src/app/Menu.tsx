import { ChevronDown, Check } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuSection {
  label?: string;
  items: MenuItem[];
}

/** A button that opens a list of sections; headers group indented items. */
export function Menu({
  label,
  title,
  sections,
  align = 'left',
  className = '',
}: {
  label: ReactNode;
  title?: string;
  sections: MenuSection[];
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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

  return (
    <div className={`menu ${className}`} ref={ref}>
      <button className={`menu-trigger${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)} title={title} aria-haspopup="menu" aria-expanded={open}>
        {label}
        <ChevronDown size={14} className="menu-chevron" />
      </button>
      {open && (
        <div className={`menu-panel ${align}`} role="menu">
          {sections.map((section, i) => (
            <div key={i} className="menu-section">
              {section.label && <div className="menu-header">{section.label}</div>}
              {section.items.map((item) => (
                <button
                  key={item.id}
                  role="menuitemradio"
                  aria-checked={!!item.checked}
                  className={`menu-item${section.label ? ' indented' : ''}${item.checked ? ' checked' : ''}`}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  <span className="menu-icon">{item.checked ? <Check size={14} /> : item.icon}</span>
                  <span className="menu-text">
                    <span>{item.label}</span>
                    {item.hint && <span className="menu-hint">{item.hint}</span>}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
