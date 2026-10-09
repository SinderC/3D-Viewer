import { useEffect, useRef } from 'react';
import { keyLabel, SHORTCUTS } from './shortcuts';

const GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))];

// Modal list of the keyboard shortcuts; Esc or a click outside closes it.
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={dialog} className="help" aria-label="Keyboard shortcuts" onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="help-body">
        <h2>Keyboard shortcuts</h2>
        <div className="help-groups">
        {GROUPS.map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            <dl>
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={keyLabel(s)}>
                  <dt>
                    <kbd>{keyLabel(s)}</kbd>
                  </dt>
                  <dd>{s.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        </div>
      </div>
    </dialog>
  );
}
