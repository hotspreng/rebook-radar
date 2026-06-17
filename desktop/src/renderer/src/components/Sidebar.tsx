import { LayoutDashboard, Users, KeyRound, Settings, Plane } from 'lucide-react';

export type Route = 'dashboard' | 'passengers' | 'accounts' | 'settings';

const items: { id: Route; label: string; icon: JSX.Element }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { id: 'passengers', label: 'Passengers', icon: <Users size={18} /> },
  { id: 'accounts', label: 'Accounts', icon: <KeyRound size={18} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
];

export function Sidebar({
  route,
  onNavigate,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
}): JSX.Element {
  return (
    <aside className="flex w-60 flex-col border-r border-slate-800 bg-slate-950/80">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600">
          <Plane size={20} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-100">Southwest</p>
          <p className="text-xs text-slate-400">Rebooker</p>
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
            {item.label}
          </button>
        ))}
      </nav>
      <div className="px-4 py-4 text-[11px] leading-relaxed text-slate-600">
        Compares the price you paid vs the current Southwest price so you can cancel & rebook.
      </div>
    </aside>
  );
}
