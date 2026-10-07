import { useEffect, useState, type Dispatch } from 'react';
import { pmiInfo } from '../core/pmi';
import { ModelTree } from './ModelTree';
import { PmiList } from './PmiList';
import type { Action, State } from './state';

type Tab = 'model' | 'pmi' | 'views';

interface Props {
  state: State;
  dispatch: Dispatch<Action>;
}

// Model tree, PMI and saved views (when the file has them), and details of the file or selected PMI.
export function Sidebar({ state, dispatch }: Props) {
  const { model, unit } = state;
  const [tab, setTab] = useState<Tab>('model');
  useEffect(() => setTab('model'), [model]);

  if (!model) {
    return (
      <aside className="sidebar">
        <p className="hint">No model loaded.</p>
      </aside>
    );
  }

  const tabs: [Tab, string][] = [['model', 'Model']];
  if (model.pmi.length) tabs.push(['pmi', `PMI ${model.pmi.length}`]);
  if (model.views.length) tabs.push(['views', `Views ${model.views.length}`]);
  const pmi = state.selectedPmi === null ? undefined : model.pmi[state.selectedPmi];

  return (
    <aside className="sidebar">
      {tabs.length > 1 && (
        <div className="tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === 'model' && (
        <ModelTree key={state.fileName} model={model} hidden={state.hidden} selected={state.selected} dispatch={dispatch} />
      )}
      {tab === 'pmi' && (
        <PmiList model={model} hidden={state.hiddenPmi} selected={state.selectedPmi} unit={unit} dispatch={dispatch} />
      )}
      {tab === 'views' && (
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
      <dl className="info">
        {pmi ? (
          pmiInfo(pmi, unit).map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))
        ) : (
          <>
            <Row label="File" value={state.fileName ?? ''} />
            <Row label="Format" value={model.format} title={model.schema || undefined} />
            <Row label="Units" value={model.unit} />
            <Row label="Parts" value={`${model.protos.length} (${model.nodes.filter((n) => n.proto >= 0).length} instances)`} />
            <Row label="Triangles" value={model.triangles.toLocaleString()} />
            <Row label="Load time" value={`${((state.loadMs ?? 0) / 1000).toFixed(2)} s`} />
          </>
        )}
      </dl>
    </aside>
  );
}

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd title={title ?? value}>{value}</dd>
    </>
  );
}
