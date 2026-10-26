import { Fragment, useEffect, useMemo, useState } from 'react';
import { Download, Info, Maximize2, RotateCcw, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import type { EngineId, ExperimentRecord } from '@/types';
import { api, fileUrl } from '@/lib/api';
import { navigate } from '@/lib/router';
import { ENGINE_COLORS, ENGINE_IDS, ENGINE_NAMES, formatBytes, formatDate, formatMs, formatValue, statusLabel } from '@/lib/engines';
import { buildSimpleGroups, bestOfRow } from '@/lib/simpleMetrics';
import { sanitizeInlineSvg } from '@/lib/svg';
import { useToast } from '@/lib/toast';
import { PanZoomSurface, useViewState, type ViewTransform } from '@/components/compare/PanZoomSurface';
import { Bars, RadarChart, ScatterChart, type ScatterPoint } from '@/components/charts';
import { ExportMenu } from '@/components/ExportMenu';
import { ConfirmDialog, Spinner } from '@/components/common';

export function SimpleExperimentView({ id, onListRefresh }: { id: string; onListRefresh: () => void }) {
  const [record, setRecord] = useState<ExperimentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api.experiment(id)
      .then((value) => { if (alive) setRecord(value); })
      .catch((loadError) => { if (alive) setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить эксперимент'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  if (loading) {
    return <div className="simple-empty"><Spinner size={22} /> Загрузка…</div>;
  }
  if (error || !record) {
    return <div className="simple-empty">{error || 'Эксперимент не найден'}</div>;
  }
  return <ExperimentContent record={record} onListRefresh={onListRefresh} push={push} />;
}

function ExperimentContent({ record, onListRefresh, push }: { record: ExperimentRecord; onListRefresh: () => void; push: (message: string, level?: 'info' | 'success' | 'error') => void }) {
  const width = record.source.width;
  const height = record.source.height;
  const [view, setView] = useViewState(width, height);
  const [transform, setTransform] = useState<ViewTransform | null>(null);
  const [svgTexts, setSvgTexts] = useState<Partial<Record<EngineId, string>>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let canceled = false;
    setSvgTexts({});
    for (const engine of ENGINE_IDS) {
      const item = record.engines[engine];
      if (!item?.files?.svg || (item.stats?.bytes || 0) > 4_000_000) continue;
      fetch(fileUrl(record.id, 'svg', engine))
        .then((response) => (response.ok ? response.text() : Promise.reject(new Error('svg'))))
        .then((text) => { if (!canceled) setSvgTexts((prev) => ({ ...prev, [engine]: sanitizeInlineSvg(text) })); })
        .catch(() => { /* use rendered PNG */ });
    }
    return () => { canceled = true; };
  }, [record.id, record.engines.potrace?.files?.svg, record.engines.imagetracer?.files?.svg, record.engines.vtracer?.files?.svg]);

  const deleteExperiment = async () => {
    setDeleting(true);
    try {
      await api.deleteExperiment(record.id);
      push('Эксперимент удалён', 'success');
      await onListRefresh();
      navigate('/new');
    } catch (deleteError) {
      push(deleteError instanceof Error ? deleteError.message : 'Не удалось удалить', 'error');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const groups = useMemo(() => buildSimpleGroups(record), [record]);
  const metricCount = groups.reduce((sum, group) => sum + group.rows.filter((row) => ENGINE_IDS.some((engine) => row.get(record.engines[engine], record) !== null && row.get(record.engines[engine], record) !== undefined)).length, 0);
  const warnings = (record.warnings || []).filter((warning) => warning.level === 'error' || warning.message.includes('не рассчитан'));

  const avail = ENGINE_IDS.filter((engine) => record.engines[engine]?.status !== 'error');
  const timeItems = avail.map((engine) => ({ label: ENGINE_NAMES[engine], value: record.engines[engine].timing?.median || 0, display: formatMs(record.engines[engine].timing?.median), color: ENGINE_COLORS[engine] }));
  const ssimItems = avail.map((engine) => ({ label: ENGINE_NAMES[engine], value: record.engines[engine].metrics?.ssim || 0, display: formatValue(record.engines[engine].metrics?.ssim, 'num4'), color: ENGINE_COLORS[engine] }));
  const deltaItems = avail.map((engine) => ({ label: ENGINE_NAMES[engine], value: record.engines[engine].metrics?.deltaE2000 || 0, display: formatValue(record.engines[engine].metrics?.deltaE2000, 'num3'), color: ENGINE_COLORS[engine] }));
  const sizeItems = avail.map((engine) => ({ label: ENGINE_NAMES[engine], value: record.engines[engine].stats?.bytes || 0, display: formatBytes(record.engines[engine].stats?.bytes), color: ENGINE_COLORS[engine] }));
  const nodeItems = avail.map((engine) => ({ label: ENGINE_NAMES[engine], value: record.engines[engine].stats?.nodes || 0, display: (record.engines[engine].stats?.nodes || 0).toLocaleString('ru-RU'), color: ENGINE_COLORS[engine] }));
  const cvItems = avail.map((engine) => ({ label: ENGINE_NAMES[engine], value: record.engines[engine].timing?.cv || 0, display: `${formatValue(record.engines[engine].timing?.cv, 'num1')}%`, color: ENGINE_COLORS[engine] }));
  const delta76Items = avail.map((engine) => ({ label: ENGINE_NAMES[engine], value: record.engines[engine].metrics?.deltaE76 || 0, display: formatValue(record.engines[engine].metrics?.deltaE76, 'num3'), color: ENGINE_COLORS[engine] }));
  const controlItems = avail.map((engine) => ({ label: ENGINE_NAMES[engine], value: record.engines[engine].stats?.controlPoints || 0, display: (record.engines[engine].stats?.controlPoints || 0).toLocaleString('ru-RU'), color: ENGINE_COLORS[engine] }));
  const pathItems = avail.map((engine) => ({ label: ENGINE_NAMES[engine], value: record.engines[engine].stats?.paths || 0, display: (record.engines[engine].stats?.paths || 0).toLocaleString('ru-RU'), color: ENGINE_COLORS[engine] }));

  const scatterBase = (metric: 'ssim' | 'time' | 'size' | 'nodes'): ScatterPoint[] => {
    return avail.flatMap((engine) => {
      const item = record.engines[engine];
      const y = item.metrics?.ssim;
      if (!Number.isFinite(y)) return [];
      let x = 0;
      if (metric === 'time') x = item.timing?.median || 0;
      if (metric === 'size') x = (item.stats?.bytes || 0) / 1024;
      if (metric === 'nodes') x = item.stats?.nodes || 0;
      if (metric === 'ssim') x = item.metrics?.ssim || 0;
      return [{ id: engine, engine, label: ENGINE_NAMES[engine], x, y: y as number }];
    });
  };

  const radarAxes = [
    { label: 'SSIM', get: (e: (typeof avail)[number]) => record.engines[e].metrics?.ssim ?? 0, higher: true },
    { label: 'SSIM p05', get: (e: (typeof avail)[number]) => record.engines[e].metrics?.ssimP05 ?? 0, higher: true },
    { label: 'PSNR', get: (e: (typeof avail)[number]) => record.engines[e].metrics?.psnr ?? 0, higher: true },
    { label: '1/ΔE00', get: (e: (typeof avail)[number]) => 1 / ((record.engines[e].metrics?.deltaE2000 ?? 1) + 0.1), higher: true },
    { label: '1/время', get: (e: (typeof avail)[number]) => 1 / ((record.engines[e].timing?.median ?? 1) + 0.1), higher: true },
    { label: '1/размер', get: (e: (typeof avail)[number]) => 1 / (((record.engines[e].stats?.bytes ?? 1) / 1024) + 0.1), higher: true },
  ];
  const radarSeries = avail.map((engine) => {
    const values = radarAxes.map((axis) => {
      const all = avail.map((e) => axis.get(e));
      const min = Math.min(...all);
      const max = Math.max(...all);
      if (!Number.isFinite(min) || max === min) return 0.6;
      const t = (axis.get(engine) - min) / (max - min);
      return 0.12 + Math.max(0, Math.min(1, axis.higher ? t : 1 - t)) * 0.88;
    });
    return { engine, values };
  });

  return (
    <div className="simple-page">
      <div className="simple-page-head">
        <div>
          <h1>{record.name}</h1>
          <div className="simple-sub">
            {record.source.originalName} · {width}×{height} px · {record.source.megapixels} Мп · {record.config.repetitions} прогона · {formatDate(record.createdAt)}
          </div>
        </div>
        <div className="simple-actions">
          <ExportMenu id={record.id} />
          <button type="button" className="simple-icon-btn" onClick={() => setConfirmDelete(true)} title="Удалить эксперимент"><Trash2 size={15} /></button>
        </div>
      </div>

      {warnings.length > 0 && <div className="simple-warning">{warnings.map((warning) => warning.message).join(' · ')}</div>}

      <div className="source-strip">
        <img src={fileUrl(record.id, 'source')} alt="Исходное изображение" />
        <div className="source-main">
          <b>{record.source.originalName}</b>
          <span>{record.source.format?.toUpperCase()} · {record.source.sourceWidth}×{record.source.sourceHeight} → {width}×{height} · фон {record.source.qualityBackground}</span>
        </div>
        <div className="source-facts">
          <div><span>Порог Оцу</span><b>{record.timing.resolvedThreshold}</b></div>
          <div><span>Повторов</span><b>{record.config.repetitions}</b></div>
          <div><span>Длительность</span><b>{formatMs(record.timing.durationMs)}</b></div>
          <div><span>Статус</span><b>{statusLabel(record.status)}</b></div>
        </div>
      </div>

      <div className="methods-head">
        <h2>Результаты</h2>
        <div className="zoom-controls">
          <button type="button" onClick={() => setView({ ...view, zoom: Math.max(0.2, view.zoom / 1.25) })} title="Уменьшить"><ZoomOut size={14} /></button>
          <span>{transform?.fit ? `${Math.round(view.zoom * 100)}%` : '—'}</span>
          <button type="button" onClick={() => setView({ ...view, zoom: Math.min(30, view.zoom * 1.25) })} title="Увеличить"><ZoomIn size={14} /></button>
          <button type="button" onClick={() => setView({ zoom: 1, cx: width / 2, cy: height / 2 })} title="Вписать"><Maximize2 size={14} /></button>
          <button type="button" onClick={() => { if (transform?.fit) setView({ ...view, zoom: 1 / transform.fit }); }}>1:1</button>
          <button type="button" onClick={() => setView({ zoom: 1, cx: width / 2, cy: height / 2 })} title="Сбросить"><RotateCcw size={14} /></button>
        </div>
      </div>

      <div className="methods-row">
        {ENGINE_IDS.map((engine) => {
          const item = record.engines[engine];
          const error = item?.status === 'error';
          const svg = svgTexts[engine];
          return (
            <section className="method-card" key={engine}>
              <div className="method-head">
                <div className="method-name"><span className="dot" style={{ background: ENGINE_COLORS[engine] }} />{ENGINE_NAMES[engine]}<small>{item?.version}</small></div>
                <div className="method-head-right">
                  {item?.timing?.median != null && <span>{formatMs(item.timing.median)}</span>}
                  {item?.files?.svg && <a href={fileUrl(record.id, 'svg', engine, true)} title="Скачать SVG"><Download size={12} /> SVG</a>}
                </div>
              </div>
              <div className="method-canvas">
                {error ? (
                  <div className="method-error">{item?.error || 'Нет результата'}</div>
                ) : (
                  <PanZoomSurface
                    width={width}
                    height={height}
                    view={view}
                    setView={setView}
                    background="gray"
                    onTransform={setTransform}
                    ariaLabel={ENGINE_NAMES[engine]}
                  >
                    {(t) => (
                      <div className="viewer-layer" style={{ width, height, transform: `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})` }}>
                        {svg ? <div className="svg-inline" dangerouslySetInnerHTML={{ __html: svg }} /> : item?.files?.render ? <img src={fileUrl(record.id, 'render', engine)} alt={ENGINE_NAMES[engine]} draggable={false} /> : <div className="method-error">Рендер недоступен</div>}
                      </div>
                    )}
                  </PanZoomSurface>
                )}
              </div>
              <div className="method-foot">
                <div><span>SSIM</span><b>{formatValue(item?.metrics?.ssim, 'num4')}</b></div>
                <div><span>ΔE00</span><b>{formatValue(item?.metrics?.deltaE2000, 'num3')}</b></div>
                <div><span>Узлы</span><b>{item?.stats?.nodes?.toLocaleString('ru-RU') ?? '—'}</b></div>
                <div><span>SVG</span><b>{formatBytes(item?.stats?.bytes)}</b></div>
              </div>
            </section>
          );
        })}
      </div>

      <section className="simple-section">
        <div className="section-title-row"><h2>Метрики</h2><span>{metricCount} показателей</span></div>
        <div className="sm-table-wrap">
          <table className="sm-table">
            <thead>
              <tr>
                <th>Показатель</th>
                {ENGINE_IDS.map((engine) => <th key={engine}><span className="dot" style={{ background: ENGINE_COLORS[engine] }} />{ENGINE_NAMES[engine]}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const rows = group.rows.filter((row) => ENGINE_IDS.some((engine) => {
                  const value = row.get(record.engines[engine], record);
                  return value !== null && value !== undefined;
                }));
                if (!rows.length) return null;
                return (
                  <Fragment key={group.id}>
                    <tr className="sm-group-row"><td colSpan={4}>{group.title}</td></tr>
                    {rows.map((row) => {
                      const best = bestOfRow(record, row);
                      return (
                        <tr key={`${group.id}-${row.key}`}>
                          <td title={row.hint}>{row.label}</td>
                          {ENGINE_IDS.map((engine) => {
                            const value = row.get(record.engines[engine], record);
                            const isBest = best?.engine === engine && best.value === value && row.better !== 'none';
                            return <td key={engine} className={isBest ? 'best' : ''}>{formatValue(value, row.format)}</td>;
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="simple-section">
        <div className="section-title-row"><h2>Графики</h2><span>визуальное сравнение</span></div>
        <div className="charts-grid">
          <ChartCard title="Время трассировки" hint="меньше — быстрее"><Bars items={timeItems} format={(v) => formatMs(v)} /></ChartCard>
          <ChartCard title="Разброс времени, CV" hint="меньше — стабильнее"><Bars items={cvItems} format={(v) => `${v.toFixed(1)}%`} /></ChartCard>
          <ChartCard title="SSIM" hint="больше — лучше"><Bars items={ssimItems} max={1} format={(v) => v.toFixed(4)} /></ChartCard>
          <ChartCard title="ΔE2000" hint="меньше — точнее"><Bars items={deltaItems} format={(v) => v.toFixed(3)} /></ChartCard>
          <ChartCard title="ΔE76" hint="меньше — точнее"><Bars items={delta76Items} format={(v) => v.toFixed(3)} /></ChartCard>
          <ChartCard title="Размер SVG" hint="меньше — компактнее"><Bars items={sizeItems} format={(v) => formatBytes(v)} /></ChartCard>
          <ChartCard title="Узлы" hint="сложность контуров"><Bars items={nodeItems} format={(v) => Math.round(v).toLocaleString('ru-RU')} /></ChartCard>
          <ChartCard title="Пути" hint="число контуров"><Bars items={pathItems} format={(v) => Math.round(v).toLocaleString('ru-RU')} /></ChartCard>
          <ChartCard title="Контрольные точки" hint="сложность кривых"><Bars items={controlItems} format={(v) => Math.round(v).toLocaleString('ru-RU')} /></ChartCard>
          <ChartCard title="Качество × время" hint="вправо — медленнее, вверх — точнее">
            <ScatterChart points={scatterBase('time')} height={230} xLabel="медиана, мс" />
            <ScatterLegend />
          </ChartCard>
          <ChartCard title="Качество × размер" hint="вправо — тяжелее, вверх — точнее">
            <ScatterChart points={scatterBase('size')} height={230} xLabel="SVG, КБ" />
            <ScatterLegend />
          </ChartCard>
          <ChartCard title="Качество × сложность" hint="вправо — больше узлов">
            <ScatterChart points={scatterBase('nodes')} height={230} xLabel="узлы" />
            <ScatterLegend />
          </ChartCard>
          <ChartCard title="Профиль качества" hint="нормированные показатели" className="chart-wide">
            <div className="radar-wrap">
              <RadarChart axes={radarAxes.map((axis) => axis.label)} series={radarSeries} size={420} />
              <div className="radar-legend">{ENGINE_IDS.map((engine) => <span key={engine}><i style={{ background: ENGINE_COLORS[engine] }} />{ENGINE_NAMES[engine]}</span>)}</div>
            </div>
          </ChartCard>
        </div>
      </section>

      <details className="simple-details">
        <summary><Info size={14} /> Параметры, окружение и данные</summary>
        <div className="details-body">
          <div className="details-grid">
            <div>
              <h3>Параметры</h3>
              <table className="sm-table compact">
                <thead><tr><th>Параметр</th>{ENGINE_IDS.map((engine) => <th key={engine}>{ENGINE_NAMES[engine]}</th>)}</tr></thead>
                <tbody>
                  {[...new Set(ENGINE_IDS.flatMap((engine) => Object.keys(record.params[engine] || {})))].filter((key) => key !== 'resolvedThreshold').map((key) => (
                    <tr key={key}><td>{key}</td>{ENGINE_IDS.map((engine) => <td key={engine}>{formatValue(record.params[engine]?.[key] as string | number | boolean, 'text')}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3>Данные</h3>
              <table className="sm-table compact">
                <tbody>
                  <tr><td>Файл</td><td>{record.source.originalName}</td></tr>
                  <tr><td>Разрешение</td><td>{width}×{height} px</td></tr>
                  <tr><td>Фон метрик</td><td>{record.source.qualityBackground}</td></tr>
                  <tr><td>Порог</td><td>{record.timing.resolvedThreshold}</td></tr>
                  <tr><td>SHA-256 source</td><td className="mono">{record.source.normalizedSha256.slice(0, 20)}…</td></tr>
                  <tr><td>Node.js</td><td>{record.environment.node}</td></tr>
                  <tr><td>CPU</td><td>{record.environment.cpu}</td></tr>
                  <tr><td>Движки</td><td>{ENGINE_IDS.map((engine) => `${ENGINE_NAMES[engine]} ${record.engines[engine]?.version}`).join(' · ')}</td></tr>
                </tbody>
              </table>
              {record.notes && <><h3>Заметки</h3><p className="details-note">{record.notes}</p></>}
            </div>
          </div>
        </div>
      </details>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить эксперимент?"
        description={`«${record.name}» и все файлы будут удалены.`}
        busy={deleting}
        onConfirm={deleteExperiment}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function ChartCard({ title, hint, children, className = '' }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`chart-card ${className}`}>
      <div className="chart-card-head"><b>{title}</b>{hint && <span>{hint}</span>}</div>
      {children}
    </div>
  );
}

function ScatterLegend() {
  return <div className="chart-legend">{ENGINE_IDS.map((engine) => <span key={engine}><i style={{ background: ENGINE_COLORS[engine] }} />{ENGINE_NAMES[engine]}</span>)}</div>;
}
