import { useEffect, useRef, type Dispatch } from 'react';
import type { Model, PmiKind } from '../core/model';
import { PMI_KINDS, pmiLabel } from '../core/pmi';
import type { UnitId } from '../core/units';
import type { Action } from './state';

interface Props {
  model: Model;
  hidden: ReadonlySet<number>;
  selected: number | null;
  unit: UnitId;
  dispatch: Dispatch<Action>;
}

// PMI items grouped by kind: a checkbox to show or hide each, click to select.
export function PmiList({ model, hidden, selected, unit, dispatch }: Props) {
  const groups = Object.keys(PMI_KINDS)
    .map((kind) => [kind as PmiKind, [...model.pmi.keys()].filter((i) => model.pmi[i].kind === kind)] as const)
    .filter(([, items]) => items.length);
  const setHidden = (next: ReadonlySet<number>) => dispatch({ type: 'setHiddenPmi', hidden: next });
  const toggle = (i: number) => {
    const next = new Set(hidden);
    if (!next.delete(i)) next.add(i);
    setHidden(next);
  };

  return (
    <div className="tree">
      <div className="list-actions">
        <button onClick={() => setHidden(new Set())}>Show all</button>
        <button onClick={() => setHidden(new Set(model.pmi.keys()))}>Hide all</button>
      </div>
      {groups.map(([kind, items]) => (
        <section key={kind}>
          <h3 className="group">
            {PMI_KINDS[kind]} <span className="muted">{items.length}</span>
          </h3>
          {items.map((i) => (
            <PmiRow
              key={i}
              label={pmiLabel(model.pmi[i], unit)}
              hidden={hidden.has(i)}
              selected={selected === i}
              onToggle={() => toggle(i)}
              onSelect={() => dispatch({ type: 'selectPmi', index: selected === i ? null : i })}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

interface RowProps {
  label: string;
  hidden: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}

function PmiRow({ label, hidden, selected, onToggle, onSelect }: RowProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <div ref={ref} className={`row${selected ? ' selected' : ''}${hidden ? ' dim' : ''}`} onClick={onSelect}>
      <input
        type="checkbox"
        aria-label="Visible"
        checked={!hidden}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggle}
      />
      <span className="name" title={label}>
        {label}
      </span>
    </div>
  );
}
