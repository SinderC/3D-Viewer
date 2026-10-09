import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode } from 'react';
import type { Model } from '../core/model';
import { Chevron, IsolateIcon } from './icons';
import { isolate, searchTree, type Action } from './state';

interface Props {
  model: Model;
  hidden: ReadonlySet<number>;
  selected: number | null;
  dispatch: Dispatch<Action>;
}

export function ModelTree({ model, hidden, selected, dispatch }: Props) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set(model.roots));
  const [query, setQuery] = useState('');
  const search = useMemo(() => searchTree(model, query), [model, query]);

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

  const ctx: RowContext = { model, hidden, selected, expanded, dispatch, toggleExpand, toggleHidden, search, query: query.trim() };
  const roots = search ? model.roots.filter((id) => search.shown.has(id)) : model.roots;
  return (
    <>
      <input
        type="search"
        className="search"
        placeholder="Search parts"
        aria-label="Search parts"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
      />
      <div className="tree" role="tree">
        {roots.map((id) => (
          <Row key={id} id={id} depth={0} ctx={ctx} />
        ))}
        {search && !roots.length && <p className="hint">No parts match.</p>}
      </div>
    </>
  );
}

interface RowContext extends Props {
  expanded: ReadonlySet<number>;
  toggleExpand: (id: number) => void;
  toggleHidden: (id: number) => void;
  search: ReturnType<typeof searchTree>;
  query: string;
}

function Row({ id, depth, ctx }: { id: number; depth: number; ctx: RowContext }) {
  const { model, hidden, selected, expanded, dispatch, toggleExpand, toggleHidden, search, query } = ctx;
  const node = model.nodes[id];
  const open = expanded.has(id) || !!search?.expand.has(id);
  const children = search ? node.children.filter((c) => search.shown.has(c)) : node.children;
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
        aria-expanded={children.length ? open : undefined}
        className={`row${isSelected ? ' selected' : ''}${hidden.has(id) ? ' dim' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => dispatch({ type: 'select', id: isSelected ? null : id })}
      >
        <button
          className={`caret${open ? ' open' : ''}`}
          aria-label={open ? 'Collapse' : 'Expand'}
          style={{ visibility: children.length ? 'visible' : 'hidden' }}
          onClick={(e) => {
            e.stopPropagation();
            toggleExpand(id);
          }}
        >
          <Chevron />
        </button>
        <input
          type="checkbox"
          aria-label="Visible"
          checked={!hidden.has(id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleHidden(id)}
        />
        <span className="name" title={node.name}>
          {node.name ? highlight(node.name, query) : <i>unnamed</i>}
        </span>
        <button
          className="isolate"
          title="Show only this"
          aria-label="Show only this"
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: 'setHidden', hidden: isolate(model, id) });
          }}
        >
          <IsolateIcon />
        </button>
      </div>
      {open && children.map((c) => <Row key={c} id={c} depth={depth + 1} ctx={ctx} />)}
    </>
  );
}

// The name with each occurrence of the search text marked.
function highlight(name: string, query: string): ReactNode {
  if (!query) return name;
  const lower = name.toLowerCase();
  const q = query.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  for (let j = lower.indexOf(q); j >= 0; j = lower.indexOf(q, i)) {
    parts.push(name.slice(i, j), <mark key={j}>{name.slice(j, j + q.length)}</mark>);
    i = j + q.length;
  }
  parts.push(name.slice(i));
  return parts;
}
