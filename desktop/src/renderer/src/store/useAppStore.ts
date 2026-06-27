import { create } from 'zustand';
import type {
  Account,
  AppSettings,
  FlightWithComparison,
  MonitorStatus,
  Passenger,
} from '@shared/dto';

const api = window.swr;

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  message: string;
}

interface AppState {
  loading: boolean;
  flights: FlightWithComparison[];
  passengers: Passenger[];
  accounts: Account[];
  settings: AppSettings | null;
  monitor: MonitorStatus | null;
  toasts: Toast[];

  // filters
  passengerFilter: string | 'all';
  accountFilter: string | 'all';

  init(): Promise<void>;
  refreshFlights(): Promise<void>;
  refreshAccounts(): Promise<void>;
  refreshPassengers(): Promise<void>;

  setPassengerFilter(id: string | 'all'): void;
  setAccountFilter(id: string | 'all'): void;

  checkOne(flightId: string): Promise<void>;
  checkAll(): Promise<void>;
  updateSettings(partial: Partial<AppSettings>): Promise<void>;

  pushToast(kind: Toast['kind'], message: string): void;
  dismissToast(id: string): void;
}

export const useAppStore = create<AppState>((set, get) => ({
  loading: true,
  flights: [],
  passengers: [],
  accounts: [],
  settings: null,
  monitor: null,
  toasts: [],
  passengerFilter: 'all',
  accountFilter: 'all',

  async init() {
    set({ loading: true });
    const [flights, passengers, accounts, settings, monitor] = await Promise.all([
      api.flights.list(),
      api.passengers.list(),
      api.accounts.list(),
      api.settings.get(),
      api.monitor.status(),
    ]);
    set({ flights, passengers, accounts, settings, monitor, loading: false });

    api.onPriceUpdate(() => void get().refreshFlights());
    api.onMonitorStatus((status) => set({ monitor: status }));
    api.onAlert((alert) => get().pushToast('success', `${alert.route}: ${alert.message}`));
  },

  async refreshFlights() {
    set({ flights: await api.flights.list() });
  },
  async refreshAccounts() {
    set({ accounts: await api.accounts.list() });
  },
  async refreshPassengers() {
    set({ passengers: await api.passengers.list() });
  },

  setPassengerFilter(id) {
    set({ passengerFilter: id });
  },
  setAccountFilter(id) {
    set({ accountFilter: id });
  },

  async checkOne(flightId) {
    try {
      await api.pricing.checkOne(flightId);
      await get().refreshFlights();
    } catch (err) {
      get().pushToast('error', err instanceof Error ? err.message : String(err));
    }
  },

  async checkAll() {
    try {
      const result = await api.pricing.checkAll();
      await get().refreshFlights();
      get().pushToast(
        'success',
        `Checked ${result.checked} flight(s). ${result.rebookCount} recommended for rebooking.`,
      );
    } catch (err) {
      get().pushToast('error', err instanceof Error ? err.message : String(err));
    }
  },

  async updateSettings(partial) {
    const settings = await api.settings.update(partial);
    set({ settings });
    // Retuning a cents-per-point rate re-estimates stored cash fares into points
    // instantly (no API call), so the Dashboard reflects the new rate.
    if ('pointValueCents' in partial || 'pointValueCentsByAirline' in partial) {
      await api.pricing.recomputeEstimates();
      await get().refreshFlights();
    }
  },

  pushToast(kind, message) {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), 6000);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
