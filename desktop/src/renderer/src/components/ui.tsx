import { Recommendation } from '@swr/core';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
} & React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const variants: Record<string, string> = {
    primary: 'bg-brand-600 hover:bg-brand-700 text-white',
    secondary: 'bg-slate-700 hover:bg-slate-600 text-slate-100',
    ghost: 'bg-transparent hover:bg-slate-800 text-slate-300',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
  };
  return (
    <button
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/60 ${className}`}>{children}</div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500';

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800">
            <X size={18} />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-slate-800 px-5 py-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}

export function RecommendationBadge({ value }: { value: Recommendation }): JSX.Element {
  const map: Record<Recommendation, { label: string; cls: string }> = {
    [Recommendation.Rebook]: { label: 'Rebook', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    [Recommendation.Keep]: { label: 'Keep', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
    [Recommendation.Unknown]: { label: 'Check price', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  };
  const { label, cls } = map[value];
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}
