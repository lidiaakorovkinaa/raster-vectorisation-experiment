import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileCode2, FileJson, FileSpreadsheet, FileText, Package, Printer } from 'lucide-react';
import { exportUrl } from '@/lib/api';

export function ExportMenu({ id, compact = false }: { id: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onClick); window.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="export-menu" ref={ref}>
      <button type="button" className={`btn btn-sm ${compact ? 'btn-icon' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Download size={13} /> {!compact && <>Экспорт <ChevronDown size={11} /></>}
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <a href={exportUrl(id, 'html', true)} role="menuitem"><FileCode2 size={14} /> HTML-отчёт</a>
          <a href={exportUrl(id, 'html', false)} target="_blank" rel="noreferrer" role="menuitem"><Printer size={14} /> Печать / PDF</a>
          <a href={exportUrl(id, 'csv')} role="menuitem"><FileSpreadsheet size={14} /> CSV-таблица</a>
          <a href={exportUrl(id, 'json')} role="menuitem"><FileJson size={14} /> JSON + SVG</a>
          <a href={exportUrl(id, 'md')} role="menuitem"><FileText size={14} /> Markdown</a>
          <a href={exportUrl(id, 'latex')} role="menuitem"><FileCode2 size={14} /> LaTeX-таблица</a>
          <div className="menu-sep" />
          <a href={exportUrl(id, 'zip')} role="menuitem"><Package size={14} /> ZIP: всё</a>
        </div>
      )}
    </div>
  );
}
