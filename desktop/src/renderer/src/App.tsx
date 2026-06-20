import { useEffect, useState } from 'react';
import { Sidebar, type Route } from './components/Sidebar.js';
import { Dashboard } from './components/Dashboard.js';
import { ReportingPage } from './components/ReportingPage.js';
import { PassengersPage } from './components/PassengersPage.js';
import { AccountsPage } from './components/AccountsPage.js';
import { SettingsPage } from './components/SettingsPage.js';
import { Toasts } from './components/Toasts.js';
import { useAppStore } from './store/useAppStore.js';

export default function App(): JSX.Element {
  const [route, setRoute] = useState<Route>('dashboard');
  const { init, loading } = useAppStore();

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-slate-900">
      <Sidebar route={route} onNavigate={setRoute} />
      <main className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center text-slate-500">Loading…</div>
        ) : (
          <>
            {route === 'dashboard' && <Dashboard />}
            {route === 'reporting' && <ReportingPage />}
            {route === 'passengers' && <PassengersPage />}
            {route === 'accounts' && <AccountsPage />}
            {route === 'settings' && <SettingsPage />}
          </>
        )}
      </main>
      <Toasts />
    </div>
  );
}
