import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, ChevronDown, FlaskConical, Gauge, Image as ImageIcon,
  Images, Loader2, Play, Plus, RotateCcw, Settings2, SlidersHorizontal, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import type { AppConfig, EngineId, NormalizedImage, ProgressMessage, Sample } from '@/types';
import { ENGINE_COLORS, ENGINE_IDS, ENGINE_NAMES, formatBytes, formatDuration, formatMs, formatValue } from '@/lib/engines';
import { normalizeImage, sampleToFile } from '@/lib/image';
import { uploadExperiment } from '@/lib/api';
import { navigate } from '@/lib/router';
import { useToast } from '@/lib/toast';
import { Field, Spinner } from '@/components/common';

type ItemStatus = 'idle' | 'normalizing' | 'ready' | 'running' | 'done' | 'error' | 'canceled';

interface QueueItem {
  key: string;
  file: File;
  previewUrl: string;
  width: number | null;
  height: number | null;
  status: ItemStatus;
  progress: number;
  stage: string;
  error?: string;
  experimentId?: string;
  normalized?: NormalizedImage;
  normalizedKey?: string;
}

interface RunSettings { repetitions: number; maxSide: number; background: string; warmup: number }

const DEFAULT_CONFIG_VALUES: RunSettings = {
  repetitions: 3,
  maxSide: 1200,
  background: '#FFFFFF',
  warmup: 1,
};

const PARAM_RANGES: Record<string, { min: number; max: number; step: number; unit?: string; hint?: string }> = {
  threshold: { min: 0, max: 255, step: 1, hint: 'Пиксели темнее порога станут контуром. Авто — порог Оцу.' },
  turdSize: { min: 0, max: 100, step: 1, hint: 'Удаляет пятна меньше указанной площади.' },
  alphaMax: { min: 0, max: 1.3334, step: 0.01, hint: '0 — полигоны, 1.33 — максимальное скругление.' },
  optTolerance: { min: 0, max: 1, step: 0.01, hint: 'Допуск оптимизации кривых.' },
  numberofcolors: { min: 2, max: 64, step: 1, hint: 'Больше цветов — точнее, но крупнее SVG.' },
  ltres: { min: 0, max: 5, step: 0.1, hint: 'Допуск аппроксимации прямых.' },
  qtres: { min: 0, max: 5, step: 0.1, hint: 'Допуск аппроксимации кривых.' },
  pathomit: { min: 0, max: 100, step: 1, hint: 'Отбрасывать контуры короче N пикселей.' },
  rightangleenhance: { min: 0, max: 0, step: 1 },
  mincolorratio: { min: 0, max: 1, step: 0.01 },
  colorquantcycles: { min: 1, max: 10, step: 1 },
  strokewidth: { min: 0, max: 5, step: 0.1 },
  roundcoords: { min: 0, max: 5, step: 1, hint: 'Точность координат; влияет на размер файла.' },
  blurradius: { min: 0, max: 10, step: 0.1, hint: 'Предварительное размытие уменьшает шум.' },
  blurdelta: { min: 0, max: 100, step: 1 },
  filterSpeckle: { min: 0, max: 64, step: 1, hint: 'Минимальная площадь цветового пятна.' },
  colorPrecision: { min: 1, max: 8, step: 1, hint: 'Биты на канал при кластеризации цвета.' },
  layerDifference: { min: 0, max: 64, step: 1, hint: 'Порог разницы между слоями.' },
  cornerThreshold: { min: 0, max: 180, step: 1 },
  lengthThreshold: { min: 0, max: 20, step: 0.5 },
  maxIterations: { min: 0, max: 10, step: 1 },
  spliceThreshold: { min: 0, max: 180, step: 1 },
  pathPrecision: { min: 0, max: 8, step: 1, hint: 'Знаков после запятой в пути.' },
};

const PARAM_ORDER: Record<EngineId, string[]> = {
  potrace: ['thresholdMode', 'threshold', 'turdSize', 'alphaMax', 'optCurve', 'optTolerance', 'blackOnWhite', 'turnPolicy'],
  imagetracer: ['numberofcolors', 'ltres', 'qtres', 'pathomit', 'roundcoords', 'blurradius', 'blurdelta', 'colorsampling', 'colorquantcycles', 'mincolorratio', 'layering', 'strokewidth', 'rightangleenhance', 'linefilter'],
  vtracer: ['colorMode', 'hierarchical', 'mode', 'filterSpeckle', 'colorPrecision', 'layerDifference', 'cornerThreshold', 'lengthThreshold', 'maxIterations', 'spliceThreshold', 'pathPrecision'],
};

const SELECT_OPTIONS: Record<string, Array<{ value: string | number; label: string }>> = {
  thresholdMode: [{ value: 'auto', label: 'Авто (Оцу)' }, { value: 'manual', label: 'Вручную' }],
  turnPolicy: [
    { value: 'minority', label: 'minority' }, { value: 'majority', label: 'majority' }, { value: 'black', label: 'black' },
    { value: 'white', label: 'white' }, { value: 'left', label: 'left' }, { value: 'right', label: 'right' },
  ],
  colorMode: [{ value: 'color', label: 'Цветной' }, { value: 'binary', label: 'Бинарный' }],
  hierarchical: [{ value: 'stacked', label: 'Stacked' }, { value: 'cutout', label: 'Cutout' }],
  mode: [{ value: 'spline', label: 'Сплайны' }, { value: 'polygon', label: 'Полигоны' }, { value: 'none', label: 'Без упрощения' }],
  layering: [{ value: 0, label: 'Sequential' }, { value: 1, label: 'Stacked' }, { value: 2, label: 'Cutout' }],
  colorsampling: [{ value: 0, label: 'По умолчанию' }, { value: 1, label: 'Детерминированная' }, { value: 2, label: 'Адаптивная' }],
};

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, '');
}

function normalizeKey(config: { maxSide: number; background: string }) {
  return `${config.maxSide}:${config.background}`;
}

async function readDimensions(file: File): Promise<{ width: number; height: number; url: string }> {
  const url = URL.createObjectURL(file);
  try {
    if ('createImageBitmap' in window) {
      const bitmap = await createImageBitmap(file);
      const dims = { width: bitmap.width, height: bitmap.height, url };
      bitmap.close();
      return dims;
    }
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('decode')); image.src = url; });
    return { width: image.naturalWidth, height: image.naturalHeight, url };
  } catch {
    return { width: 0, height: 0, url };
  }
}

export function NewExperimentView({ config, samples, onCreated }: { config: AppConfig; samples: Sample[]; onCreated: (record: import('@/types').ExperimentRecord) => void }) {
  const { push } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [drag, setDrag] = useState(false);
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [author, setAuthor] = useState(() => localStorage.getItem('experiment.author') || '');
  const [settings, setSettings] = useState<RunSettings>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('experiment.settings') || 'null');
      if (saved) return { ...DEFAULT_CONFIG_VALUES, ...saved };
    } catch { /* ignore */ }
    return DEFAULT_CONFIG_VALUES;
  });
  const [params, setParams] = useState<Record<EngineId, Record<string, unknown>>>(() => ({ ...config.defaultParams }));
  const [activeEngine, setActiveEngine] = useState<EngineId>('potrace');
  const [running, setRunning] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [overall, setOverall] = useState(0);
  const [runStarted, setRunStarted] = useState<number | null>(null);
  const [abort, setAbort] = useState<AbortController | null>(null);
  const [sampleLoading, setSampleLoading] = useState<string | null>(null);
  const [engineProgress, setEngineProgress] = useState<Partial<Record<EngineId, { status: 'pending' | 'active' | 'done' | 'error'; ms?: number }>>>({});
  const [currentStage, setCurrentStage] = useState('');
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    try {
      localStorage.setItem('experiment.settings', JSON.stringify(settings));
      if (author) localStorage.setItem('experiment.author', author);
    } catch { /* ignore */ }
  }, [settings, author]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const incoming = Array.from(files);
    const current = itemsRef.current;
    const room = config.limits.maxBatchFiles - current.length;
    if (room <= 0) { push(`Максимум ${config.limits.maxBatchFiles} файлов в серии`, 'error'); return; }
    const accepted = incoming.slice(0, room);
    if (incoming.length > room) push(`Добавлены первые ${room} файлов: лимит серии — ${config.limits.maxBatchFiles}`, 'error');
    const next: QueueItem[] = [];
    for (const file of accepted) {
      if (file.size > config.limits.maxUploadBytes) { push(`«${file.name}» больше ${formatBytes(config.limits.maxUploadBytes)}`, 'error'); continue; }
      if (current.some((item) => item.file.name === file.name && item.file.size === file.size)) continue;
      const dims = await readDimensions(file);
      next.push({
        key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl: dims.url,
        width: dims.width || null,
        height: dims.height || null,
        status: 'ready',
        progress: 0,
        stage: 'Готов к запуску',
      });
    }
    if (!next.length) return;
    setItems((prev) => [...prev, ...next]);
    if (!name) setName(stripExt(next[0].file.name));
    setFinished(false);
  }, [config.limits.maxBatchFiles, config.limits.maxUploadBytes, name, push]);

  useEffect(() => {
    const sample = new URLSearchParams(location.hash.split('?')[1] || '').get('sample');
    if (!sample || itemsRef.current.length) return;
    let canceled = false;
    setSampleLoading(sample);
    sampleToFile(sample)
      .then((file) => { if (!canceled) return addFiles([file]); })
      .catch((error) => push(error.message, 'error'))
      .finally(() => { if (!canceled) setSampleLoading(null); });
    return () => { canceled = true; };
  }, [addFiles, push]);

  useEffect(() => () => { for (const item of itemsRef.current) if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl); }, []);

  const removeItem = (key: string) => {
    setItems((prev) => {
      const target = prev.find((i) => i.key === key);
      if (target?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.key !== key);
    });
  };

  const clearAll = () => {
    for (const item of items) {
      if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
    }
    setItems([]);
    setFinished(false);
  };

  const onFiles = (files: FileList | File[] | null) => { if (files) void addFiles(files); };

  const updateItem = (key: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const estimatedMP = useMemo(() => {
    return items.reduce((acc, item) => {
      if (!item.width || !item.height) return acc + 1;
      const scale = Math.min(1, settings.maxSide / Math.max(item.width, item.height));
      return acc + (item.width * scale * item.height * scale) / 1e6;
    }, 0);
  }, [items, settings.maxSide]);
  const isBatch = items.length > 1;
  const totalRuns = items.length * 3 * settings.repetitions;

  const start = async () => {
    if (!items.length) { push('Добавьте хотя бы одно изображение', 'error'); return; }
    setRunning(true);
    setFinished(false);
    setRunStarted(Date.now());
    setActiveIndex(0);
    setOverall(0);
    setEngineProgress({});
    setCurrentStage('Подготовка');
    const controller = new AbortController();
    setAbort(controller);
    const batch = items.length > 1 ? `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` : null;
    setBatchId(batch);
    const baseName = name.trim() || stripExt(items[0].file.name);
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12);
    let completed = 0;
    const failed = new Set<string>();
    try {
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (item.status === 'done' && item.experimentId) { completed++; setOverall(Math.round((completed / items.length) * 100)); continue; }
        setActiveIndex(index);
        setEngineProgress({});
        try {
        updateItem(item.key, { status: 'normalizing', progress: 0, stage: 'Нормализация в браузере', error: undefined });
        let normalized = item.normalized;
        const key = normalizeKey(settings);
        if (!normalized || item.normalizedKey !== key) {
          normalized = await normalizeImage(item.file, { maxSide: settings.maxSide, background: settings.background });
          updateItem(item.key, { normalized, normalizedKey: key });
        }
        updateItem(item.key, { status: 'running', progress: 4, stage: 'Отправка на сервер' });
        const meta = {
          name: isBatch ? stripExt(item.file.name) : baseName,
          notes,
          tags: tagList,
          author,
          batchId: batch || undefined,
          batchName: batch ? (baseName || 'Серия') : undefined,
          config: { repetitions: settings.repetitions, warmup: 1, maxSide: settings.maxSide, background: settings.background },
          params,
          client: {
            originalName: item.file.name,
            originalType: item.file.type,
            originalSize: item.file.size,
            sourceWidth: normalized.sourceWidth,
            sourceHeight: normalized.sourceHeight,
            normalizedWidth: normalized.width,
            normalizedHeight: normalized.height,
            scale: normalized.scale,
            orientationApplied: normalized.orientationApplied,
            preprocessing: 'browser: EXIF + canvas flatten/background + maxSide downscale + PNG encode',
          },
        };
        const record = await uploadExperiment({
          original: item.file,
          normalized: normalized.normalized,
          meta,
          signal: controller.signal,
          onProgress: (message: ProgressMessage) => {
            const info = progressInfo(message, index, items.length, settings.repetitions);
            if (info.engine) {
              setEngineProgress((prev) => {
                const next = { ...prev };
                for (const key of ENGINE_IDS) if (key !== info.engine && next[key]?.status === 'active') next[key] = { status: 'done' };
                next[info.engine!] = { status: info.engineStatus || 'active' };
                return next;
              });
            }
            if (message.stage === 'analysis') setEngineProgress((prev) => Object.fromEntries(ENGINE_IDS.map((e) => [e, { status: prev[e]?.status === 'error' ? 'error' : 'done' }])) as typeof prev);
            if (info.stage) setCurrentStage(info.stage);
            setOverall(info.percent);
            updateItem(item.key, { progress: info.percent, stage: info.label || message.message || 'Вычисление' });
          },
        });
        completed++;
        setOverall(Math.round((completed / items.length) * 100));
        updateItem(item.key, { status: 'done', progress: 100, stage: 'Готово', experimentId: record.id });
        onCreated(record);
        if (!isBatch) {
          push('Эксперимент готов', 'success');
          window.setTimeout(() => navigate(`/experiment/${record.id}/compare`), 350);
          return;
        }
        } catch (error) {
          if (controller.signal.aborted) throw error;
          const message = error instanceof Error ? error.message : String(error);
          failed.add(item.key);
          updateItem(item.key, { status: 'error', error: message, stage: 'Ошибка', progress: 100 });
          push(`«${item.file.name}»: ${message}`, 'error');
          setOverall(Math.round(((index + 1) / items.length) * 100));
          if (!isBatch) return;
        }
      }
      setFinished(true);
      if (failed.size) push(`Серия завершена: ${items.length - failed.size} из ${items.length} успешно`, 'error');
      else push(`Серия из ${items.length} экспериментов готова`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (controller.signal.aborted) {
        setItems((prev) => prev.map((i) => (i.status === 'running' || i.status === 'normalizing' ? { ...i, status: 'canceled', stage: 'Отменено' } : i)));
        push('Запуск отменён', 'info');
      } else {
        updateItem(items[Math.max(0, activeIndex)].key, { status: 'error', error: message, stage: 'Ошибка' });
        push(message, 'error');
      }
    } finally {
      setRunning(false);
      setAbort(null);
      setRunStarted(null);
    }
  };

  const cancel = () => {
    abort?.abort();
  };

  const currentItem = activeIndex >= 0 ? items[activeIndex] : null;
  const elapsed = runStarted ? (Date.now() - runStarted) / 1000 : 0;

  if (finished) {
    return (
      <CompleteView
        items={items}
        batchName={name || 'Серия'}
        onNew={() => { clearAll(); setName(''); setNotes(''); setTags(''); setFinished(false); }}
        onSeries={() => navigate('/')}
      />
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">New experiment</div>
          <h1>Новый эксперимент</h1>
          <p>Загрузите один растр или серию. Параметры применяются ко всем файлам; каждый запуск сохраняется отдельной записью.</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => navigate('/')}><ArrowLeft size={13} /> Назад</button>
      </div>

      <div className="new-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <div className="panel-title"><Images size={15} /> Изображения</div>
              <span className="muted tiny">{items.length ? `${items.length} файл(ов)` : `до ${config.limits.maxBatchFiles}`}</span>
            </div>
            <div className="panel-body">
              <div
                className={`dropzone ${drag ? 'drag' : ''}`}
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => { event.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(event) => { event.preventDefault(); setDrag(false); onFiles(event.dataTransfer.files); }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInput.current?.click(); }}
              >
                <input ref={fileInput} type="file" accept="image/*,.svg,.webp,.avif,.tif,.tiff" multiple hidden onChange={(event) => { onFiles(event.target.files); event.currentTarget.value = ''; }} />
                <div className="dropzone-icon"><Upload size={20} /></div>
                <h3>Перетащите файлы или нажмите для выбора</h3>
                <p>PNG, JPEG, WebP, AVIF, GIF, BMP, TIFF, SVG · до {formatBytes(config.limits.maxUploadBytes)} · до {config.limits.maxBatchFiles} файлов в серии</p>
                <div className="dropzone-formats"><span className="tag">EXIF применяется</span><span className="tag">альфа → фон</span><span className="tag">downscale в браузере</span></div>
              </div>

              {items.length > 0 && (
                <>
                  <div className="row spread mt-16" style={{ marginBottom: 8 }}>
                    <span className="field-label" style={{ margin: 0 }}>Очередь</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll} disabled={running}><Trash2 size={12} /> Очистить</button>
                  </div>
                  <div className="upload-list">
                    {items.map((item, index) => (
                      <div className="upload-item" key={item.key}>
                        <img src={item.previewUrl} alt="" />
                        <div className="grow">
                          <div className="upload-name truncate">{item.file.name}</div>
                          <div className="upload-sub">
                            {item.width && item.height ? `${item.width}×${item.height} · ` : ''}{formatBytes(item.file.size)} · {item.stage}
                          </div>
                          {item.error && <div className="upload-sub" style={{ color: 'var(--danger)' }}>{item.error}</div>}
                          {(item.status === 'running' || item.status === 'normalizing') && (
                            <div className="progress-bar" style={{ height: 3, marginTop: 5 }}><span style={{ width: `${item.progress}%` }} /></div>
                          )}
                        </div>
                        <div className="upload-status">
                          {item.status === 'done' ? <CheckCircle2 size={16} color="var(--green)" /> : item.status === 'running' ? <Spinner size={15} /> : item.status === 'error' ? <AlertTriangle size={15} color="var(--danger)" /> : <span className="mono">{(index + 1).toString().padStart(2, '0')}</span>}
                        </div>
                        <button type="button" className="upload-x" onClick={() => removeItem(item.key)} disabled={running} aria-label="Удалить"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {items.length === 0 && (
                <div className="mt-16">
                  <div className="field-label" style={{ marginBottom: 7 }}>Или начните с примера</div>
                  <div className="row wrap" style={{ gap: 5 }}>
                    {samples.map((sample) => (
                      <button key={sample.id} type="button" className="btn btn-sm" disabled={Boolean(sampleLoading)} onClick={async () => {
                        setSampleLoading(sample.id);
                        try { await addFiles([await sampleToFile(sample.id)]); } catch (error) { push(error instanceof Error ? error.message : 'Ошибка', 'error'); } finally { setSampleLoading(null); }
                      }}>
                        {sampleLoading === sample.id ? <Loader2 size={13} className="spin" /> : <ImageIcon size={13} />} {sample.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div className="panel-title"><SlidersHorizontal size={15} /> Параметры алгоритмов</div>
              <div className="row" style={{ gap: 4 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({ ...config.defaultParams })}><RotateCcw size={12} /> Сбросить всё</button>
              </div>
            </div>
            <div className="param-tabs">
              {ENGINE_IDS.map((engine) => (
                <button key={engine} type="button" className={`param-tab ${activeEngine === engine ? 'active' : ''}`} style={{ '--engine': ENGINE_COLORS[engine] } as React.CSSProperties} onClick={() => setActiveEngine(engine)}>
                  <span className="dot" /> {ENGINE_NAMES[engine]}
                </button>
              ))}
            </div>
            <EngineParams
              engine={activeEngine}
              config={config}
              params={params[activeEngine]}
              onChange={(next) => setParams((prev) => ({ ...prev, [activeEngine]: next }))}
            />
          </section>

          <div className="warn-box"><AlertTriangle size={14} /><span>Potrace — бинарный движок. Его SSIM и ΔE2000 будут ниже на цветных изображениях; это ожидаемо. Сравнивайте силуэт, узлы, размер и скорость.</span></div>
        </div>

        <div className="stack">
          <section className="panel settings-card">
            <div className="panel-head"><div className="panel-title"><Settings2 size={15} /> Запуск</div></div>
            <div className="panel-body">
              <div className="form-grid">
                <Field label={isBatch ? 'Название серии' : 'Название эксперимента'} className="full">
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Логотипы 2026 · подбор параметров" />
                </Field>
                <Field label="Теги" hint="Через запятую; до 12." className="full">
                  <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="логотипы, линии, poster" />
                </Field>
                <Field label="Автор" hint="Попадёт в отчёт." className="full">
                  <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Лаборатория / ФИО" />
                </Field>
                <Field label="Повторов" hint="Медиана по N прогонам; прогрев 1.">
                  <select className="select" value={settings.repetitions} onChange={(e) => setSettings((s) => ({ ...s, repetitions: Number(e.target.value) }))}>
                    {[1, 2, 3, 4, 5, 7, 9].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'прогон' : 'прогона'}</option>)}
                  </select>
                </Field>
                <Field label="Макс. сторона">
                  <select className="select" value={settings.maxSide} onChange={(e) => setSettings((s) => ({ ...s, maxSide: Number(e.target.value) }))}>
                    {[800, 1200, 1600, 2048, 3000].map((n) => <option key={n} value={n}>{n} px</option>)}
                  </select>
                </Field>
                <Field label="Фон для альфы" hint="Flatten и композитинг.">
                  <div className="input-row">
                    <input type="color" value={settings.background} onChange={(e) => setSettings((s) => ({ ...s, background: e.target.value.toUpperCase() }))} style={{ width: 36, height: 34, padding: 2, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface)' }} />
                    <input className="input input-mono" value={settings.background} onChange={(e) => setSettings((s) => ({ ...s, background: e.target.value.toUpperCase().slice(0, 7) }))} />
                  </div>
                </Field>
                <Field label="Заметки" className="full">
                  <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Гипотеза, класс изображений, что проверяем…" rows={3} />
                </Field>
              </div>

              <div className="run-summary">
                <span>Оценка: <b>{estimatedMP.toFixed(1)} Мп</b></span>
                <span><b>{items.length || 0}</b> × <b>{settings.repetitions}</b> × 3 = <b>{totalRuns}</b> прогонов</span>
              </div>
              {estimatedMP > 4 && <div className="warn-box mt-12"><AlertTriangle size={13} /><span>Большой растр: анализ (SSIM/ΔE) может занять {Math.ceil(estimatedMP * 3)}–{Math.ceil(estimatedMP * 8)} с на движок. Уменьшите сторону для серии.</span></div>}
              <button type="button" className="btn btn-primary btn-lg btn-block mt-16" disabled={running || !items.length} onClick={start}>
                {running ? <><Spinner size={16} /> Идёт вычисление…</> : items.length > 1 ? <><Play size={16} /> Запустить серию ({items.length})</> : <><Play size={16} /> Запустить сравнение</>}
              </button>
              <div className="field-hint mt-8" style={{ textAlign: 'center' }}>Все данные остаются локально. Вычисления сериализуются для честных замеров.</div>
            </div>
          </section>

          {running && (
            <section className="panel progress-panel">
              <div className="row spread" style={{ marginBottom: 8 }}>
                <div className="panel-title"><Gauge size={15} /> Выполняется</div>
                <span className="mono tiny">{Math.round(overall)}% · {formatDuration(elapsed)}</span>
              </div>
              <div className="progress-bar"><span style={{ width: `${overall}%` }} /></div>
              <div className="tiny muted mt-8">{currentStage}</div>
              <div className="progress-steps">
                {ENGINE_IDS.map((engine) => {
                  const status = engineProgress[engine]?.status;
                  return (
                    <div key={engine} className={`progress-step ${status === 'active' ? 'active' : status === 'done' ? 'done' : status === 'error' ? '' : ''}`} style={{ '--engine': ENGINE_COLORS[engine] } as React.CSSProperties}>
                      {status === 'done' ? <Check size={12} /> : status === 'active' ? <Loader2 size={12} className="spin" /> : <span className={`status-dot ${status === 'error' ? 'error' : 'pending'}`} />}
                      <span>{ENGINE_NAMES[engine]}</span>
                      </div>
                  );
                })}
                <div className={`progress-step ${currentStage.includes('анализ') || currentStage.includes('Растер') ? 'active' : ''}`}>
                  {overall >= 100 ? <Check size={12} /> : overall > 85 ? <Loader2 size={12} className="spin" /> : <span className="status-dot pending" />}
                  <span>Рендер и метрики</span>
                </div>
              </div>
              {items.length > 1 && (
                <div className="batch-summary">
                  {items.map((item, index) => (
                    <div className="batch-row" key={item.key}>
                      <span className="mono muted" style={{ fontSize: 8 }}>{String(index + 1).padStart(2, '0')}</span>
                      <span className="name">{item.file.name}</span>
                      <span className={`status-dot ${item.status === 'done' ? 'ok' : item.status === 'error' ? 'error' : item.status === 'running' ? 'partial' : ''}`} />
                      <span className="mono" style={{ fontSize: 8.5 }}>{Math.round(item.progress)}%</span>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" className="btn btn-danger btn-sm btn-block mt-12" onClick={cancel}>Отменить после текущего шага</button>
            </section>
          )}

        </div>
      </div>
    </div>
  );
}

function progressInfo(message: ProgressMessage, itemIndex: number, itemCount: number, repetitions: number) {
  const base = (itemIndex / itemCount) * 100;
  const span = 100 / itemCount;
  let local = 0;
  let label = message.message || '';
  let engineStatus: 'pending' | 'active' | 'done' | 'error' | undefined;
  if (message.stage === 'queued') { local = 2; label = 'Ожидание очереди вычислений'; }
  else if (message.stage === 'prepare') { local = 5; label = 'Подготовка пикселей'; }
  else if (message.stage === 'source') { local = 10; label = message.message || 'Источник нормализован'; }
  else if (message.stage === 'warmup') { local = 14; engineStatus = 'active'; label = `Прогрев ${ENGINE_NAMES[message.engine!]}`; }
  else if (message.stage === 'engine') {
    const done = message.completedRuns ?? 0;
    const total = message.totalRuns ?? 1;
    local = 16 + (done / total) * 70;
    engineStatus = 'active';
    label = message.message || 'Трассировка';
  } else if (message.stage === 'engine-error') { engineStatus = 'error'; label = message.message || 'Ошибка движка'; }
  else if (message.stage === 'analysis') { local = 90; label = 'Рендер SVG и метрики'; }
  else if (message.stage === 'saved') { local = 99; label = 'Сохранение'; }
  else if (message.stage === 'done') { local = 100; label = 'Готово'; }
  return {
    percent: Math.min(100, Math.round(base + (local / 100) * span)),
    label,
    stage: label,
    engine: message.engine,
    engineStatus,
  };
}

function EngineParams({ engine, config, params, onChange }: { engine: EngineId; config: AppConfig; params: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }) {
  const presets = config.presets[engine] || [];
  const labels = config.labels.params[engine] || {};
  const activePreset = presets.find((preset) => JSON.stringify(preset.params) === JSON.stringify(params));
  const keys = PARAM_ORDER[engine].filter((key) => key in params);
  return (
    <div className="param-panel">
      <div className="preset-row">
        {presets.map((preset) => (
          <button key={preset.id} type="button" className={`preset-btn ${activePreset?.id === preset.id ? 'active' : ''}`} title={preset.description} onClick={() => onChange({ ...config.defaultParams[engine], ...preset.params })}>{preset.name}</button>
        ))}
        <button type="button" className="preset-btn" onClick={() => onChange({ ...config.defaultParams[engine] })}><RotateCcw size={9} style={{ verticalAlign: -1 }} /> сброс</button>
      </div>
      <div className="param-grid">
        {keys.map((key) => {
          const value = params[key];
          const label = labels[key] || key;
          if (key === 'thresholdMode') {
            return (
              <div className="field" key={key}>
                <div className="param-label"><span>{label}</span><code>{key}</code></div>
                <select className="select" value={String(value)} onChange={(e) => onChange({ ...params, thresholdMode: e.target.value, threshold: e.target.value === 'auto' ? 128 : Number(params.threshold || 128) })}>
                  {SELECT_OPTIONS.thresholdMode.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            );
          }
          if (key === 'threshold' && params.thresholdMode === 'auto') {
            return (
              <div className="field" key={key}>
                <div className="param-label"><span>Порог</span><code>auto</code></div>
                <div className="input input-mono" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Оцу · вычисляется сервером</div>
              </div>
            );
          }
          if (typeof value === 'boolean') {
            return (
              <div className="field" key={key}>
                <span className="param-label">{label}<code>{key}</code></span>
                <label className="switch"><input type="checkbox" checked={value} onChange={(e) => onChange({ ...params, [key]: e.target.checked })} /><span className="switch-track" />{value ? 'включено' : 'выключено'}</label>
              </div>
            );
          }
          if (SELECT_OPTIONS[key]) {
            return (
              <div className="field" key={key}>
                <div className="param-label"><span>{label}</span><code>{key}</code></div>
                <select className="select" value={String(value)} onChange={(e) => onChange({ ...params, [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value })}>
                  {SELECT_OPTIONS[key].map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
                </select>
              </div>
            );
          }
          const range = PARAM_RANGES[key];
          if (typeof value === 'number' && range) {
            return (
              <div className={`field ${key === 'threshold' || key === 'pathPrecision' ? '' : ''}`} key={key}>
                <div className="param-label"><span>{label}</span><code>{key}</code></div>
                <div className="range-row">
                  <input className="range" type="range" min={range.min} max={range.max} step={range.step} value={value} onChange={(e) => onChange({ ...params, [key]: Number(e.target.value) })} />
                  <span className="range-value">{Number(value).toFixed(range.step < 1 ? 2 : 0)}</span>
                </div>
                {range.hint && <span className="param-hint">{range.hint}</span>}
              </div>
            );
          }
          if (typeof value === 'number') {
            return (
              <div className="field" key={key}>
                <div className="param-label"><span>{label}</span><code>{key}</code></div>
                <input className="input input-mono" type="number" value={value} onChange={(e) => onChange({ ...params, [key]: Number(e.target.value) })} />
              </div>
            );
          }
          return null;
        })}
      </div>
      {engine === 'potrace' && <div className="param-hint mt-12">Порог Оцу вычисляется на сервере по яркости источника и сохраняется в отчёте. Для ручного режима используется значение из поля «Порог».</div>}
      {engine === 'imagetracer' && <div className="param-hint mt-12">ImageTracer чувствителен к числу цветов и <code>pathomit</code>: при большом количестве мелких градиентных пятен SVG может вырасти до десятков мегабайт.</div>}
      {engine === 'vtracer' && <div className="param-hint mt-12">VTracer в режиме <code>binary</code> ближе к Potrace; в цветном режиме слои и точность цвета определяют размер SVG.</div>}
    </div>
  );
}

function CompleteView({ items, batchName, onNew, onSeries }: { items: QueueItem[]; batchName: string; onNew: () => void; onSeries: () => void }) {
  const ready = items.filter((i) => i.experimentId);
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Series complete</div>
          <h1>Серия готова</h1>
          <p>{ready.length} из {items.length} экспериментов сохранены. Откройте отдельный результат или перейдите к агрегированной статистике.</p>
        </div>
        <div className="row"><button type="button" className="btn btn-sm" onClick={onNew}><Plus size={13} /> Ещё серия</button><button type="button" className="btn btn-primary btn-sm" onClick={onSeries}><FlaskConical size={13} /> К экспериментам</button></div>
      </div>
      <div className="panel">
        <div className="panel-head"><div className="panel-title">{batchName}</div><span className="muted tiny">{ready.length} записей</span></div>
        <div style={{ padding: 12 }}>
          <div className="upload-list">
            {items.map((item) => (
              <div className="upload-item" key={item.key}>
                <img src={item.previewUrl} alt="" />
                <div className="grow">
                  <div className="upload-name">{item.file.name}</div>
                  <div className="upload-sub">{item.status === 'done' ? 'Сохранён' : item.error || item.stage}</div>
                </div>
                {item.experimentId ? <a className="btn btn-sm" href={`#/experiment/${item.experimentId}/compare`}>Открыть <ArrowLeft size={12} style={{ transform: 'rotate(180deg)' }} /></a> : <span className="badge error">ошибка</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="row mt-16"><button type="button" className="btn" onClick={onNew}><Plus size={14} /> Новый запуск</button><button type="button" className="btn" onClick={onSeries}>Все эксперименты</button></div>
    </div>
  );
}
