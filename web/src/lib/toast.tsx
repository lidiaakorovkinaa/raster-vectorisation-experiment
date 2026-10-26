import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type ToastLevel = 'info' | 'success' | 'error';
interface ToastItem { id: number; message: string; level: ToastLevel; }
interface ToastContextValue { push: (message: string, level?: ToastLevel) => void; }
const ToastContext = createContext<ToastContextValue>({ push: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, level: ToastLevel = 'info') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, level }]);
    window.setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), level === 'error' ? 8000 : 4500);
  }, []);
  const remove = (id: number) => setItems((prev) => prev.filter((i) => i.id !== id));
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.level}`}>
            {item.level === 'success' ? <CheckCircle2 size={17} /> : item.level === 'error' ? <AlertTriangle size={17} /> : <Info size={17} />}
            <span>{item.message}</span>
            <button type="button" onClick={() => remove(item.id)} aria-label="Закрыть"><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
