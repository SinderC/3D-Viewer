import { useEffect, useRef, useState, type Dispatch } from 'react';
import type { Model } from '../core/model';
import { isolate, type Action } from './state';

interface Props {
  model: Model;
  hidden: ReadonlySet<number>;
  selected: number | null;
  dispatch: Dispatch<Action>;
}

export function ModelTree({ model, hidden, selected, dispatch }: Props) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set(model.roots));

  // Reveal a node picked in 3D.
  useEffect(() => {
    if (selected === null) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let p = model.nodes[selected].parent; p >= 0; p = model.nodes[p].parent) next.add(p);
      return next;
    });
  }, [model, selected]);

  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const toggleHidden = (id: number) => {
    const next = new Set(hidden);
    if (!next.delete(id)) next.add(id);
    dispatch({ type: 'setHidden', hidden: next });
  };

  const ctx: RowContext = { model, hidden, selected, expanded, dispatch, toggleExpand, toggleHidden };
  return (
    <div className="tree" role="tree">
      {model.roots.map((id) => (
        <Row key={id} id={id} depth={0} ctx={ctx} />
      ))}
    </div>
  );
}

interface RowContext extends Props {
  expanded: ReadonlySet<number>;
  toggleExpand: (id: number) => void;
  toggleHidden: (id: number) => void;
}

function Row({ id, depth, ctx }: { id: number; depth: number; ctx: RowContext }) {
  const { model, hidden, selected, expanded, dispatch, toggleExpand, toggleHidden } = ctx;
  const node = model.nodes[id];
  const open = expanded.has(id);
  const isSelected = selected === id;
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isSelected]);

  return (
    <>
      <div
        ref={rowRef}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={node.children.length ? open : undefined}
        className={`row${isSelected ? ' selected' : ''}${hidden.has(id) ? ' dim' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => dispatch({ type: 'select', id: isSelected ? null : id })}
      >
        <button
          className="caret"
          aria-label={open ? 'Collapse' : 'Expand'}
          style={{ visibility: node.children.length ? 'visible' : 'hidden' }}
          onClick={(e) => {
            e.stopPropagation();
            toggleExpand(id);
          }}
        >
          {open ? '▾' : '▸'}
        </button>
        <input
          type="checkbox"
          aria-label="Visible"
          checked={!hidden.has(id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleHidden(id)}
        />
        <span className="name" title={node.name}>
          {node.name || <i>unnamed</i>}
        </span>
        <button
          className="isolate"
          title="Show only this"
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: 'setHidden', hidden: isolate(model, id) });
          }}
        >
          ◎
        </button>
      </div>
      {open && node.children.map((c) => <Row key={c} id={c} depth={depth + 1} ctx={ctx} />)}
    </>
  );
}
