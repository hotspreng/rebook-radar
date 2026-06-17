import { CheckCircle2, Info, XCircle, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore.js';

export function Toasts(): JSX.Element {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);

  const icon = {
    info: <Info size={18} className="text-brand-400" />,
    success: <CheckCircle2 size={18} className="text-emerald-400" />,
    error: <XCircle size={18} className="text-red-400" />,
  };

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 shadow-lg"
        >
          <div className="mt-0.5">{icon[t.kind]}</div>
          <p className="flex-1 text-sm text-slate-200">{t.message}</p>
          <button onClick={() => dismiss(t.id)} className="text-slate-500 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
