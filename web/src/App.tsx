import { useEffect, useState } from 'react';
import {
  Airline,
  FareType,
  FlightSource,
  PriceCheckService,
  PurchaseType,
  type AirlineProvider,
  type Flight,
  type PriceComparison,
} from '@swr/core';

/**
 * Minimal proof-of-portability web client.
 *
 * It imports the SAME `@swr/core` package the desktop app uses and runs the
 * pricing engine entirely in the browser, here backed by a tiny inline demo
 * provider (a real web app would swap in an HTTP/API based client implementing
 * `AirlineProvider`).
 *
 * No Electron, Node, or DB code is referenced — demonstrating that all business
 * logic lives in /core and is framework-agnostic.
 */

const sampleFlight: Flight = {
  id: 'demo',
  passengerId: 'me',
  airline: Airline.Southwest,
  confirmationNumber: 'DEMO12',
  route: { origin: { code: 'MDW' }, destination: { code: 'DEN' } },
  departureDateTime: '2026-08-14T09:35:00-05:00',
  fareType: FareType.WannaGetAway,
  originalCost: { purchaseType: PurchaseType.Points, points: 12000, taxesAndFeesUsd: 5.6 },
  bookingDate: '2026-05-01',
  source: FlightSource.Manual,
  monitoring: true,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

/** Inline demo provider returning a single lower-priced fare for the sample flight. */
const demoProvider: AirlineProvider = {
  id: 'demo',
  name: 'Demo',
  async login() {
    throw new Error('Not supported in the web preview.');
  },
  async getUpcomingTrips() {
    return [];
  },
  async searchPrice() {
    return [
      {
        departureDateTime: sampleFlight.departureDateTime,
        fareType: FareType.WannaGetAway,
        points: 9000,
        pointsTaxesAndFeesUsd: 5.6,
        stops: 0,
      },
    ];
  },
  async logout() {
    /* no-op */
  },
};

export function App(): JSX.Element {
  const [comparison, setComparison] = useState<PriceComparison | null>(null);
  const [loading, setLoading] = useState(false);

  async function runCheck(): Promise<void> {
    setLoading(true);
    const service = new PriceCheckService();
    const result = await service.check(sampleFlight, demoProvider, undefined, {
      pointValueCents: 1.4,
      savingsThresholdUsd: 25,
      savingsThresholdPoints: 2000,
      matchToleranceMinutes: 90,
    });
    setComparison(result.comparison);
    setLoading(false);
  }

  useEffect(() => {
    void runCheck();
  }, []);

  return (
    <div style={{ maxWidth: 640, margin: '60px auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>Rebook Radar — Web preview</h1>
      <p style={{ color: '#94a3b8' }}>
        Running <code>@swr/core</code> directly in the browser. Same engine as the desktop app.
      </p>

      <div
        style={{
          marginTop: 24,
          padding: 20,
          borderRadius: 12,
          border: '1px solid #334155',
          background: '#1e293b',
        }}
      >
        <h2 style={{ fontSize: 16 }}>
          {sampleFlight.route.origin.code} → {sampleFlight.route.destination.code}
        </h2>
        {loading && <p>Checking price…</p>}
        {comparison && (
          <div style={{ display: 'grid', gap: 8 }}>
            <Row label="Originally paid" value={`${comparison.originalAmount.toLocaleString()} pts`} />
            <Row
              label="Current price"
              value={comparison.currentAmount != null ? `${comparison.currentAmount.toLocaleString()} pts` : '—'}
            />
            <Row
              label="Savings"
              value={comparison.savingsNative != null ? `${comparison.savingsNative.toLocaleString()} pts` : '—'}
            />
            <Row label="Recommendation" value={comparison.recommendation.toUpperCase()} />
            <p style={{ color: '#cbd5e1', fontSize: 13, marginTop: 8 }}>{comparison.rationale}</p>
          </div>
        )}
      </div>

      <button
        onClick={() => void runCheck()}
        style={{
          marginTop: 16,
          padding: '8px 16px',
          borderRadius: 8,
          border: 'none',
          background: '#2563eb',
          color: 'white',
          cursor: 'pointer',
        }}
      >
        Re-check price
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: '#94a3b8' }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
