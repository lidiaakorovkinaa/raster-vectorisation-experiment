import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ViewState { zoom: number; cx: number; cy: number }
export interface ViewTransform { scale: number; tx: number; ty: number; fit: number; cw: number; ch: number }
export interface Rect { x: number; y: number; w: number; h: number }

interface Props {
  width: number;
  height: number;
  view: ViewState;
  setView: (next: ViewState) => void;
  background?: 'checker' | 'white' | 'dark' | 'paper' | 'gray';
  tool?: 'pan' | 'roi';
  onPixel?: (p: { x: number; y: number } | null) => void;
  onSelect?: (rect: Rect) => void;
  selection?: Rect | null;
  onTransform?: (t: ViewTransform) => void;
  children: (t: ViewTransform) => React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function PanZoomSurface({
  width,
  height,
  view,
  setView,
  background = 'checker',
  tool = 'pan',
  onPixel,
  onSelect,
  selection,
  onTransform,
  children,
  className = '',
  ariaLabel,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<Rect | null>(null);
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number; scale: number } | null>(null);
  const roiStart = useRef<{ x: number; y: number; ix: number; iy: number } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; zoom: number; cx: number; cy: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = size.w && size.h ? Math.min(size.w / width, size.h / height) * 0.96 : 0;
  const scale = fit * view.zoom;
  const tx = size.w / 2 - view.cx * scale;
  const ty = size.h / 2 - view.cy * scale;
  const transform: ViewTransform = { scale, tx, ty, fit, cw: size.w, ch: size.h };

  const onTransformRef = useRef(onTransform);
  useEffect(() => { onTransformRef.current = onTransform; }, [onTransform]);
  useEffect(() => { onTransformRef.current?.(transform); }, [scale, tx, ty, fit, size.w, size.h]);

  const toImage = useCallback((clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el || !scale) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: (clientX - rect.left - tx) / scale, y: (clientY - rect.top - ty) / scale };
  }, [scale, tx, ty]);

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    if (!scale || !size.w) return;
    const el = ref.current!;
    const rect = el.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const ix = (mx - tx) / scale;
    const iy = (my - ty) / scale;
    const factor = Math.exp(-event.deltaY * 0.0014);
    const zoom = Math.max(0.15, Math.min(60, view.zoom * factor));
    const newScale = fit * zoom;
    const cx = ix - (mx - size.w / 2) / newScale;
    const cy = iy - (my - size.h / 2) / newScale;
    setView({ zoom, cx, cy });
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    el.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom, cx: view.cx, cy: view.cy };
      dragRef.current = null;
      return;
    }
    if (tool === 'roi') {
      const p = toImage(event.clientX, event.clientY);
      roiStart.current = { x: event.clientX, y: event.clientY, ix: p.x, iy: p.y };
      setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    } else {
      dragRef.current = { x: event.clientX, y: event.clientY, cx: view.cx, cy: view.cy, scale };
      setDragging(true);
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!scale) return;
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const p = toImage(event.clientX, event.clientY);
    if (p.x >= 0 && p.y >= 0 && p.x < width && p.y < height) onPixel?.({ x: p.x, y: p.y });
    else onPixel?.(null);
    if (pointers.current.size >= 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchRef.current.dist > 0) {
        const zoom = Math.max(0.15, Math.min(60, pinchRef.current.zoom * (dist / pinchRef.current.dist)));
        setView({ zoom, cx: pinchRef.current.cx, cy: pinchRef.current.cy });
      }
      return;
    }
    if (roiStart.current && tool === 'roi') {
      const start = roiStart.current;
      const x = Math.min(start.ix, p.x), y = Math.min(start.iy, p.y);
      const w = Math.abs(p.x - start.ix), h = Math.abs(p.y - start.iy);
      setDraft({ x, y, w, h });
      return;
    }
    const drag = dragRef.current;
    if (drag && tool !== 'roi') {
      const cx = drag.cx - (event.clientX - drag.x) / drag.scale;
      const cy = drag.cy - (event.clientY - drag.y) / drag.scale;
      setView({ ...view, cx, cy });
    }
  };

  const finish = (event: React.PointerEvent) => {
    const el = ref.current;
    if (el?.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (roiStart.current && tool === 'roi' && draft) {
      const rect = { x: Math.round(draft.x), y: Math.round(draft.y), w: Math.round(draft.w), h: Math.round(draft.h) };
      if (rect.w >= 4 && rect.h >= 4) onSelect?.(rect);
      roiStart.current = null;
      setDraft(null);
    }
    dragRef.current = null;
    setDragging(false);
  };

  const shownSelection = draft ?? selection;
  const selScreen = shownSelection && scale ? {
    left: shownSelection.x * scale + tx,
    top: shownSelection.y * scale + ty,
    width: shownSelection.w * scale,
    height: shownSelection.h * scale,
  } : null;

  return (
    <div
      ref={ref}
      className={`viewer-canvas bg-${background} ${dragging ? 'dragging' : ''} ${tool === 'roi' ? 'tool-roi' : ''} ${className}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={(event) => { if (!dragRef.current && !roiStart.current) onPixel?.(null); if (event.buttons === 0) finish(event); }}
      onDoubleClick={(event) => {
        const p = toImage(event.clientX, event.clientY);
        const el = ref.current!;
        const rect = el.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        const zoom = Math.max(0.15, Math.min(60, view.zoom * 1.8));
        const ns = fit * zoom;
        setView({ zoom, cx: p.x - (mx - size.w / 2) / ns, cy: p.y - (my - size.h / 2) / ns });
      }}
      aria-label={ariaLabel}
      role="img"
    >
      {scale > 0 && children(transform)}
      {selScreen && <div className="roi-box" style={{ left: selScreen.left, top: selScreen.top, width: selScreen.width, height: selScreen.height }} />}
    </div>
  );
}

export function useViewState(width: number, height: number): [ViewState, (v: ViewState) => void] {
  const [view, setView] = useState<ViewState>(() => ({ zoom: 1, cx: width / 2, cy: height / 2 }));
  useEffect(() => { setView({ zoom: 1, cx: width / 2, cy: height / 2 }); }, [width, height]);
  return [view, setView];
}
