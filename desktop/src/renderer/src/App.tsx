import { useEffect, useState } from 'react';
import { Sidebar, type Route } from './components/Sidebar.js';
import { Dashboard } from './components/Dashboard.js';
import { PastFlightsPage } from './components/PastFlightsPage.js';
import { ReportingPage } from './components/ReportingPage.js';
import { TrendsPage } from './components/TrendsPage.js';
import { ReviewQueuePage } from './components/ReviewQueuePage.js';
import { SettingsPage } from './components/SettingsPage.js';
import { Toasts } from './components/Toasts.js';
import { useAppStore } from './store/useAppStore.js';

const api = window.swr;

export default function App(): JSX.Element {
  const [route, setRoute] = useState<Route>('dashboard');
  const [reviewCount, setReviewCount] = useState(0);
  const { init, loading } = useAppStore();

  useEffect(() => {
    void init();
  }, [init]);

  // Keep the Review badge current: refresh the pending count on mount and
  // whenever the user navigates (e.g. after resolving items on the queue).
  const refreshReviewCount = (): void => {
    void api.review.list().then((items) => setReviewCount(items.length));
  };
  useEffect(() => {
    refreshReviewCount();
  }, [route]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-slate-900">
      <Sidebar route={route} onNavigate={setRoute} reviewCount={reviewCount} />
      <main className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center text-slate-500">Loading…</div>
        ) : (
          <>
            {route === 'dashboard' && <Dashboard />}
            {route === 'past' && <PastFlightsPage />}
            {route === 'reporting' && <ReportingPage />}
            {route === 'trends' && <TrendsPage />}
            {route === 'review' && <ReviewQueuePage onResolved={refreshReviewCount} />}
            {route === 'settings' && <SettingsPage />}
          </>
        )}
      </main>
      <Toasts />
    </div>
  );
}
