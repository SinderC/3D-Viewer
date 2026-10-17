import { useState } from 'react';
import type { Model } from '../core/model';
import { CloseIcon } from './icons';

// Shown over the view when an assembly keeps parts in files that were not opened with it
// (STEP external references): without them those parts are simply absent.
export function MissingFiles({ model, onAdd }: { model: Model; onAdd: () => void }) {
  const [dismissed, setDismissed] = useState<Model>();
  const missing = model.externalFiles?.filter((f) => !f.loaded).map((f) => f.name) ?? [];
  if (!missing.length || dismissed === model) return null;
  return (
    <div className="notice" role="alert">
      <p>
        Parts of this assembly are in {missing.length === 1 ? 'a file' : 'files'} that {missing.length === 1 ? 'was' : 'were'} not
        opened with it: <strong>{missing.join(', ')}</strong>
      </p>
      <button onClick={onAdd}>Add files…</button>
      <button className="icon" aria-label="Dismiss" title="Dismiss" onClick={() => setDismissed(model)}>
        <CloseIcon />
      </button>
    </div>
  );
}
