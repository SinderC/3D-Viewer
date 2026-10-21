import { useState } from 'react';
import type { Model } from '../core/model';
import { externalFileLabel } from '../core/product';
import { CloseIcon } from './icons';

// Shown over the view when an assembly keeps parts in files that were not opened with it
// (STEP external references): without them those parts are simply absent. A warning, or an
// error when no part could be shown at all.
export function MissingFiles({ model, onAdd }: { model: Model; onAdd: () => void }) {
  const [dismissed, setDismissed] = useState<Model>();
  const [leaving, setLeaving] = useState<Model>();
  const missingFiles = model.externalFiles?.filter((f) => !f.loaded) ?? [];
  const missing = missingFiles.map((f) => f.name);
  if (!missing.length || dismissed === model) return null;
  const nothingShown = !model.nodes.some((n) => n.proto >= 0);
  return (
    <div
      className={`notice${nothingShown ? ' error' : ''}${leaving === model ? ' leaving' : ''}`}
      role="status"
      onTransitionEnd={(e) => leaving === model && e.propertyName === 'opacity' && setDismissed(model)}
    >
      <div className="notice-text">
        <p>
          {missing.length === 1 ? (
            <strong>{externalFileLabel(missingFiles[0])}</strong>
          ) : (
            <strong>{missing.length} files</strong>
          )}{' '}
          {missing.length === 1 ? 'is' : 'are'} missing,{' '}
          {nothingShown ? 'so no parts can be shown.' : "so some parts aren't shown."}
        </p>
        {missing.length > 1 && (
          <ul>
            {[...missingFiles].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).map((f) => (
              <li key={f.name}>{externalFileLabel(f)}</li>
            ))}
          </ul>
        )}
      </div>
      <button onClick={onAdd}>{missing.length === 1 ? `Add ${missing[0]}…` : 'Add files…'}</button>
      <button className="icon" aria-label="Dismiss" title="Dismiss" onClick={() => setLeaving(model)}>
        <CloseIcon />
      </button>
    </div>
  );
}
