import type {
  Account,
  Flight,
  NewAccount,
  NewFlight,
  NewPassenger,
  Passenger,
} from '@swr/core';
import type {
  AlertEvent,
  AppSettings,
  CreateAccountInput,
  EmailImportResult,
  EmailStatus,
  FlightWithComparison,
  GmailCredentialsInput,
  MonitorStatus,
  PriceUpdateEvent,
  SerpApiKeyUsage,
  SetPasswordInput,
} from './dto.js';

/** Result of a login test against an airline account. */
export interface TestLoginResult {
  ok: boolean;
  message: string;
  /** Error code from core AirlineError, when applicable. */
  code?: string;
}

/**
 * The typed API surface exposed on `window.swr` by the preload script. The
 * renderer programs against this interface only — it has no direct Node/Electron
 * access (contextIsolation is on).
 */
export interface SwrApi {
  passengers: {
    list(): Promise<Passenger[]>;
    create(input: NewPassenger): Promise<Passenger>;
    update(passenger: Passenger): Promise<Passenger>;
    remove(id: string): Promise<void>;
  };
  accounts: {
    list(): Promise<Account[]>;
    create(input: CreateAccountInput): Promise<Account>;
    update(account: Account): Promise<Account>;
    remove(id: string): Promise<void>;
    setPassword(input: SetPasswordInput): Promise<void>;
    deletePassword(accountId: string): Promise<void>;
    testLogin(accountId: string): Promise<TestLoginResult>;
    syncTrips(accountId: string): Promise<{ imported: number; skipped: number }>;
  };
  flights: {
    list(): Promise<FlightWithComparison[]>;
    get(id: string): Promise<FlightWithComparison | undefined>;
    create(input: NewFlight): Promise<Flight>;
    update(flight: Flight): Promise<Flight>;
    remove(id: string): Promise<void>;
  };
  pricing: {
    checkOne(flightId: string): Promise<FlightWithComparison>;
    checkAll(): Promise<{ checked: number; rebookCount: number }>;
    recomputeEstimates(): Promise<FlightWithComparison[]>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(settings: Partial<AppSettings>): Promise<AppSettings>;
    warmScraperProfile(): Promise<{ warmed: boolean }>;
    setSerpApiKey(slot: number, key: string): Promise<AppSettings>;
    serpApiUsage(): Promise<SerpApiKeyUsage[]>;
  };
  email: {
    status(): Promise<EmailStatus>;
    setCredentials(input: GmailCredentialsInput): Promise<EmailStatus>;
    connect(): Promise<EmailStatus>;
    disconnect(): Promise<EmailStatus>;
    import(): Promise<EmailImportResult>;
  };
  monitor: {
    start(): Promise<MonitorStatus>;
    stop(): Promise<MonitorStatus>;
    status(): Promise<MonitorStatus>;
  };
  exportCsv(): Promise<{ saved: boolean; path?: string }>;
  openExternal(url: string): Promise<void>;

  // Event subscriptions — each returns an unsubscribe function.
  onPriceUpdate(cb: (e: PriceUpdateEvent) => void): () => void;
  onAlert(cb: (e: AlertEvent) => void): () => void;
  onMonitorStatus(cb: (s: MonitorStatus) => void): () => void;
}
