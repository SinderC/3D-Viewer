import { useEffect, useMemo, useState, type Dispatch } from 'react';
import { ModelTree } from './ModelTree';
import { PmiList } from './PmiList';
import { Properties } from './Properties';
import { Splitter } from './Splitter';
import { highlight, withAncestors, type Action, type State } from './state';

type Tab = 'model' | 'pmi' | 'views' | 'info';

interface Props {
  state: State;
  dispatch: Dispatch<Action>;
  /** Show the properties as a tab, for narrow windows that have no properties panel. */
  info: boolean;
  /** Dragging the edge well past the minimum width hides the sidebar. */
  onCollapse: () => void;
}

// Model tree, and PMI and saved views when the file has them.
export function Sidebar({ state, dispatch, info, onCollapse }: Props) {
  const { model, unit, selected, element, selectedPmi } = state;
  const [tab, setTab] = useState<Tab>('model');
  useEffect(() => setTab('model'), [model]);
  // Cross-highlighting: the parts holding what the selected PMI refers to, and the PMI that refers to the picked element.
  const related = useMemo(() => {
    const { elements, pmi } = highlight({ model, selected, element, selectedPmi });
    return { nodes: model ? withAncestors(model, elements.map((e) => e.node)) : new Set<number>(), pmi: new Set(pmi) };
  }, [model, selected, element, selectedPmi]);

  if (!model) {
    return (
      <aside className="sidebar">
        <Splitter variable="--side-w" edge="right" onCollapse={onCollapse} />
        <p className="hint">No model loaded.</p>
      </aside>
    );
  }

  const tabs: [Tab, string][] = [['model', 'Model']];
  if (model.pmi.length) tabs.push(['pmi', `PMI ${model.pmi.length}`]);
  if (model.views.length) tabs.push(['views', `Views ${model.views.length}`]);
  if (info) tabs.push(['info', 'Info']);
  // The Info tab goes away when the window widens.
  const current = tabs.some(([id]) => id === tab) ? tab : 'model';

  return (
    <aside className="sidebar">
      <Splitter variable="--side-w" edge="right" onCollapse={onCollapse} />
      {tabs.length > 1 && (
        <div className="tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={current === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {current === 'model' && (
        <ModelTree
          key={state.fileName}
          model={model}
          hidden={state.hidden}
          selected={selected}
          related={related.nodes}
          dispatch={dispatch}
        />
      )}
      {current === 'pmi' && (
        <PmiList
          model={model}
          hidden={state.hiddenPmi}
          selected={selectedPmi}
          related={related.pmi}
          unit={unit}
          dispatch={dispatch}
        />
      )}
      {current === 'views' && (
        <div className="tree">
          {model.views.map((v, i) => (
            <div
              key={i}
              className={`row${state.view?.index === i ? ' selected' : ''}`}
              onClick={() => dispatch({ type: 'applyView', index: i })}
            >
              <span className="name" title={v.name}>
                {v.name || <i>unnamed</i>}
              </span>
              {v.pmi.length > 0 && <span className="muted">{v.pmi.length} PMI</span>}
            </div>
          ))}
        </div>
      )}
      {current === 'info' && (
        <div className="tree">
          <Properties state={state} />
        </div>
      )}
    </aside>
  );
}
