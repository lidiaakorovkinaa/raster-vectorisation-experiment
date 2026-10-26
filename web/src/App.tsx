import { useCallback, useEffect, useState } from 'react';
import type { AppConfig, ExperimentRecord, ExperimentSummary, Sample } from '@/types';
import { api } from '@/lib/api';
import { navigate, useRoute } from '@/lib/router';
import { ToastProvider, useToast } from '@/lib/toast';
import { Spinner } from '@/components/common';
import { SimpleHeader } from '@/components/SimpleHeader';
import { SimpleExperimentView } from './views/SimpleExperimentView';
import { NewExperimentView } from './views/NewExperimentView';

export function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

function AppInner() {
  const route = useRoute();
  const { push } = useToast();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const list = await api.experiments({ limit: 200 });
      setExperiments(list.items);
    } catch (refreshError) {
      push(refreshError instanceof Error ? refreshError.message : 'Не удалось обновить список', 'error');
    }
  }, [push]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [appConfig, list, sampleResult] = await Promise.all([api.config(), api.experiments({ limit: 200 }), api.samples()]);
      setConfig(appConfig);
      setExperiments(list.items);
      setSamples(sampleResult.samples);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить приложение');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { document.title = 'Эксперимент · векторизация'; }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (loading) return;
    if (route.name === 'home' || route.name === 'series' || route.name === 'methodology') {
      if (experiments.length) navigate(`/experiment/${experiments[0].id}`);
      else navigate('/new');
    }
  }, [route.name, loading, experiments]);

  const onCreated = useCallback(async (record: ExperimentRecord) => {
    await refreshList();
    navigate(`/experiment/${record.id}`);
  }, [refreshList]);

  if (loading) {
    return <div className="simple-empty"><Spinner size={24} /> Загрузка…</div>;
  }
  if (error || !config) {
    return (
      <div className="simple-empty">
        <div>Не удалось запустить</div>
        <small>{error || 'Нет конфигурации'}</small>
        <button type="button" className="simple-btn" onClick={() => void load()}>Повторить</button>
      </div>
    );
  }

  const isNew = route.name === 'new' || (route.name === 'home' && experiments.length === 0);
  const currentId = route.name === 'experiment' ? route.id : undefined;

  return (
    <div className="simple-app">
      <SimpleHeader experiments={experiments} currentId={currentId} isNew={isNew} />
      <main className="simple-main">
        {route.name === 'new' && (
          <NewExperimentView config={config} samples={samples} onCreated={onCreated} />
        )}
        {route.name === 'experiment' && (
          <SimpleExperimentView id={route.id} onListRefresh={refreshList} />
        )}
        {(route.name === 'home' || route.name === 'series' || route.name === 'methodology') && (
          <div className="simple-empty"><Spinner size={20} /> Открытие эксперимента…</div>
        )}
      </main>
    </div>
  );
}
