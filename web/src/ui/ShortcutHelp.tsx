import { useEffect, useRef } from 'react';
import { keyLabel, SHORTCUTS } from './shortcuts';
import { MAC } from './Toolbar';

const GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))];

// Pointer controls on the canvas (Viewer.ts), listed after the keyboard groups.
const MOUSE: [input: string, label: string][] = [
  ['Click', 'Select a part'],
  ['Drag', 'Rotate'],
  ['Right-drag', 'Pan'],
  [`${MAC ? '⇧' : 'Shift+'}Drag`, 'Pan'],
  ['Scroll', 'Zoom'],
  ['Right-click', `Rotate about this point${MAC ? ' (two\u2011finger tap)' : ''}`],
];

// Modal list of the keyboard shortcuts and mouse controls; Esc or a click outside closes it.
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={dialog} className="help" aria-label="Keyboard and mouse" onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="help-body">
        <h2>Keyboard and mouse</h2>
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
        <section>
          <h3>Mouse</h3>
          <dl>
            {MOUSE.map(([input, label]) => (
              <div key={input}>
                <dt>
                  <kbd>{input}</kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </section>
        </div>
      </div>
    </dialog>
  );
}
