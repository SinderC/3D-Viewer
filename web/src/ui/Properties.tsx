import { Fragment, useState } from 'react';
import { pmiInfo } from '../core/pmi';
import { countInfo, failures, validationInfo, type Row } from '../core/product';
import type { State } from './state';

// Details of the selected PMI item or part, and of the file, in sections that stay open or
// closed across selections.
export function Properties({ state }: { state: State }) {
  const { model, unit } = state;
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  if (!model) return <p className="hint">No model loaded.</p>;

  const pmi = state.selectedPmi === null ? undefined : model.pmi[state.selectedPmi];
  const node = state.selected === null ? undefined : model.nodes[state.selected];
  const product = node?.product === undefined ? undefined : model.products[node.product];

  const file: Row[] = [
    ['File', state.fileName ?? ''],
    ['Format', model.format, model.schema || undefined],
    ['Units', model.unit],
    ['Parts', `${model.protos.length} (${model.nodes.filter((n) => n.proto >= 0).length} instances)`],
    ['Triangles', model.triangles.toLocaleString()],
  ];
  if (model.counts.annotations !== undefined) file.push(['PMI', ...countInfo(model.pmi.length, model.counts.annotations)]);
  if (model.counts.views !== undefined) file.push(['Views', ...countInfo(model.views.length, model.counts.views)]);
  file.push(['Load time', `${((state.loadMs ?? 0) / 1000).toFixed(2)} s`]);

  const toggle = (name: string, open: boolean) =>
    setClosed((c) => {
      if (c.has(name) !== open) return c;
      const next = new Set(c);
      if (open) next.delete(name);
      else next.add(name);
      return next;
    });

  const section = (name: string, rows: Row[], count = false) => {
    if (!rows.length) return null;
    const failed = failures(rows);
    return (
      <details key={name} className="section" open={!closed.has(name)} onToggle={(e) => toggle(name, e.currentTarget.open)}>
        <summary>
          {name} {count && <span className="muted">{rows.length}</span>}
          {failed !== undefined && (failed ? <span className="fail">✗ {failed}</span> : <span className="pass">✓</span>)}
        </summary>
        <dl className="info">
          {rows.map(([label, value, title], i) => (
            <Fragment key={i}>
              <dt>{label}</dt>
              <dd title={title}>{value}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
    );
  };

  return (
    <>
      {pmi && section('PMI', pmiInfo(pmi, unit))}
      {node && section('Part', [['Name', node.name], ...(product?.props ?? [])])}
      {product && section('Validation', validationInfo(product, unit))}
      {product && section('Attributes', product.attributes, true)}
      {section('File', file)}
    </>
  );
}
