import React, { useMemo } from 'react';
import type { EngineId } from '@/types';
import { ENGINE_COLORS, ENGINE_NAMES, formatMs } from '@/lib/engines';

export interface ScatterPoint {
  id: string;
  label: string;
  engine: EngineId;
  x: number;
  y: number;
  meta?: string;
  href?: string;
}

export function ScatterChart({ points, height = 300, onOpen, xLabel = 'Время, мс (лог. шкала)', yLabel = 'SSIM' }: { points: ScatterPoint[]; height?: number; onOpen?: (id: string) => void; xLabel?: string; yLabel?: string }) {
  const W = 720;
  const H = height;
  const margin = { left: 54, right: 24, top: 18, bottom: 40 };
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > 0);
  const xValues = valid.map((p) => Math.log10(Math.max(0.1, p.x)));
  const yValues = valid.map((p) => p.y);
  const xMin = xValues.length ? Math.min(...xValues) : 0;
  const xMax = xValues.length ? Math.max(...xValues) : 3;
  const xPad = Math.max(0.15, (xMax - xMin) * 0.1);
  const yMin = yValues.length ? Math.max(0, Math.min(...yValues) - 0.05) : 0.5;
  const yMax = 1;
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  const sx = (v: number) => margin.left + ((Math.log10(Math.max(0.1, v)) - (xMin - xPad)) / (xMax + xPad - (xMin - xPad))) * plotW;
  const sy = (v: number) => margin.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
  const xTicks = useMemo(() => {
    const lo = Math.floor(xMin - xPad);
    const hi = Math.ceil(xMax + xPad);
    return Array.from({ length: Math.max(2, hi - lo + 1) }, (_, i) => 10 ** (lo + i));
  }, [xMin, xMax, xPad]);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].filter((v) => v >= yMin - 0.02);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Диаграмма качество–время" style={{ display: 'block', overflow: 'visible' }}>
      <rect x={margin.left} y={margin.top} width={plotW} height={plotH} fill="#faf8f2" stroke="#e8e3d7" />
      {yTicks.map((tick) => (
        <g key={tick}>
          <line x1={margin.left} x2={margin.left + plotW} y1={sy(tick)} y2={sy(tick)} stroke="#e8e3d7" strokeDasharray="2 4" />
          <text x={margin.left - 10} y={sy(tick) + 3} textAnchor="end" fontSize="10.5" fill="#8d8f87" fontFamily="JetBrains Mono Variable, monospace">{tick.toFixed(2)}</text>
        </g>
      ))}
      {xTicks.map((tick) => (
        <g key={tick}>
          <line x1={sx(tick)} x2={sx(tick)} y1={margin.top} y2={margin.top + plotH} stroke="#eee9dd" strokeDasharray="2 4" />
          <text x={sx(tick)} y={H - 18} textAnchor="middle" fontSize="10" fill="#8d8f87" fontFamily="JetBrains Mono Variable, monospace">{tick < 1 ? tick.toFixed(2) : tick < 10 ? tick.toFixed(1) : Math.round(tick)}</text>
        </g>
      ))}
      <text x={W - margin.right} y={H - 4} textAnchor="end" fontSize="9.5" fill="#8d8f87" letterSpacing=".06em">{xLabel.toUpperCase()}</text>
      <text x={12} y={margin.top + 2} fontSize="9.5" fill="#8d8f87" letterSpacing=".06em" transform={`rotate(-90 12 ${margin.top + 2})`} textAnchor="end">{yLabel.toUpperCase()}</text>
      {valid.map((p, index) => (
        <g key={`${p.id}-${p.engine}-${index}`} style={{ cursor: p.href ? 'pointer' : 'default' }} onClick={() => p.href && onOpen?.(p.id)}>
          <circle cx={sx(p.x)} cy={sy(p.y)} r={5.2} fill={ENGINE_COLORS[p.engine]} fillOpacity={0.8} stroke="#fbf9f4" strokeWidth={1.2}>
            <title>{`${p.label}\n${ENGINE_NAMES[p.engine]} · ${formatMs(p.x)} · SSIM ${p.y.toFixed(4)}${p.meta ? `\n${p.meta}` : ''}`}</title>
          </circle>
        </g>
      ))}
      {!valid.length && <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="11" fill="#8d8f87">Нет данных для графика</text>}
    </svg>
  );
}

export function Bars({ items, format = (v) => String(v), max, className = '' }: { items: Array<{ label: string; value: number; color: string; display?: string }>; format?: (v: number) => string; max?: number; className?: string }) {
  const maxValue = max ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <div className={`bar-list ${className}`}>
      {items.map((item) => (
        <div className="bar-item" key={item.label}>
          <span className="bar-item-label"><span className="dot" style={{ background: item.color }} />{item.label}</span>
          <span className="bar-item-track"><span className="bar-item-fill" style={{ width: `${Math.max(2, (item.value / maxValue) * 100)}%`, background: item.color }} /></span>
          <span className="bar-item-value">{item.display ?? format(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ values, color, width = 64, height = 20 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (!values.length) return null;
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * (width - 2) + 1},${height - 2 - ((v - min) / span) * (height - 4)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WinBar({ counts }: { counts: Array<{ engine: EngineId; count: number }> }) {
  const total = counts.reduce((a, c) => a + c.count, 0) || 1;
  return (
    <span className="win-bar" title={counts.map((c) => `${ENGINE_NAMES[c.engine]}: ${c.count}`).join(', ')}>
      {counts.map((c) => <span key={c.engine} style={{ width: `${(c.count / total) * 100}%`, background: ENGINE_COLORS[c.engine] }} />)}
    </span>
  );
}

export interface RadarSeries {
  engine: EngineId;
  values: number[];
}

export function RadarChart({ axes, series, size = 300 }: { axes: string[]; series: RadarSeries[]; size?: number }) {
  const cx = size / 2;
  const cy = size / 2 + 4;
  const radius = size * 0.34;
  const n = Math.max(3, axes.length);
  const point = (index: number, value: number) => {
    const angle = -Math.PI / 2 + (index / n) * Math.PI * 2;
    const r = radius * Math.max(0.02, Math.min(1, value));
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as const;
  };
  const rings = [0.25, 0.5, 0.75, 1];
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" role="img" aria-label="Профиль качества" style={{ display: 'block' }}>
      {rings.map((ring) => (
        <polygon
          key={ring}
          points={axes.map((_, i) => point(i, ring).join(',')).join(' ')}
          fill="none"
          stroke="#e0e0dc"
          strokeWidth="1"
        />
      ))}
      {axes.map((label, index) => {
        const [x, y] = point(index, 1);
        const [lx, ly] = point(index, 1.13);
        return (
          <g key={label}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="#e5e5e1" strokeWidth="1" />
            <text x={lx} y={ly} textAnchor={Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end'} dominantBaseline="middle" fontSize="8.8" fill="#777773">
              {label}
            </text>
          </g>
        );
      })}
      {series.map((serie) => (
        <g key={serie.engine}>
          <polygon
            points={serie.values.map((value, index) => point(index, value).join(',')).join(' ')}
            fill={ENGINE_COLORS[serie.engine]}
            fillOpacity="0.12"
            stroke={ENGINE_COLORS[serie.engine]}
            strokeWidth="1.8"
          />
          {serie.values.map((value, index) => {
            const [x, y] = point(index, value);
            return <circle key={index} cx={x} cy={y} r="2.2" fill={ENGINE_COLORS[serie.engine]} />;
          })}
        </g>
      ))}
      <text x={cx} y={size - 7} textAnchor="middle" fontSize="8" fill="#999994">нормировано по каждому показателю</text>
    </svg>
  );
}
