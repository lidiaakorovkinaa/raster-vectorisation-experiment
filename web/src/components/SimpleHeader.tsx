import { Plus } from 'lucide-react';
import type { ExperimentSummary } from '@/types';
import { navigate } from '@/lib/router';

export function SimpleHeader({
  experiments,
  currentId,
  isNew,
}: {
  experiments: ExperimentSummary[];
  currentId?: string;
  isNew?: boolean;
}) {
  return (
    <header className="simple-header">
      <div className="sh-left">
        <span className="sh-label">Эксперимент</span>
        <select
          className="sh-select"
          value={isNew ? '' : currentId || ''}
          onChange={(event) => {
            const id = event.target.value;
            if (id) navigate(`/experiment/${id}`);
            else navigate('/new');
          }}
          aria-label="Выбрать эксперимент"
        >
          <option value="">— новый эксперимент —</option>
          {experiments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.source.width}×{item.source.height}
            </option>
          ))}
        </select>
        {currentId && !isNew && (
          <span className="sh-count">
            {experiments.findIndex((item) => item.id === currentId) + 1} / {experiments.length}
          </span>
        )}
      </div>
      <div className="sh-right">
        <button type="button" className="simple-btn simple-btn-primary" onClick={() => navigate('/new')}>
          <Plus size={15} /> <span className="sh-new-label">Новый эксперимент</span>
        </button>
      </div>
    </header>
  );
}
