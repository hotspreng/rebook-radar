import { LayoutDashboard, Settings, Plane, BarChart3, TrendingUp, History, ClipboardCheck } from 'lucide-react';

export type Route = 'dashboard' | 'past' | 'reporting' | 'trends' | 'review' | 'settings';

const items: { id: Route; label: string; icon: JSX.Element }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { id: 'past', label: 'Past Flights', icon: <History size={18} /> },
  { id: 'reporting', label: 'Reporting', icon: <BarChart3 size={18} /> },
  { id: 'trends', label: 'Trends', icon: <TrendingUp size={18} /> },
  { id: 'review', label: 'Review', icon: <ClipboardCheck size={18} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
];

export function Sidebar({
  route,
  onNavigate,
  reviewCount = 0,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  reviewCount?: number;
}): JSX.Element {
  return (
    <aside className="flex w-60 flex-col border-r border-slate-800 bg-slate-950/80">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600">
          <Plane size={20} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-100">Rebook</p>
          <p className="text-xs text-slate-400">Radar</p>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              route === item.id
                ? 'bg-brand-600/15 text-brand-300'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            {item.icon}
            <span className="flex-1 text-left">{item.label}</span>
            {item.id === 'review' && reviewCount > 0 && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                {reviewCount}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="px-4 py-4 text-[11px] leading-relaxed text-slate-600">
        Compares the price you paid vs the current Southwest price so you can cancel & rebook.
      </div>
    </aside>
  );
}
