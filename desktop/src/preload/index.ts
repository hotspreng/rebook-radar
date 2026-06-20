import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc.js';
import type { SwrApi, TestLoginResult } from '../shared/api.js';
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
} from '../shared/dto.js';
import type {
  Account,
  Flight,
  NewAccount,
  NewFlight,
  NewPassenger,
  Passenger,
} from '@swr/core';

const invoke = <T>(channel: string, arg?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, arg) as Promise<T>;

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: SwrApi = {
  passengers: {
    list: () => invoke<Passenger[]>(IPC.passengerList),
    create: (input: NewPassenger) => invoke<Passenger>(IPC.passengerCreate, input),
    update: (passenger: Passenger) => invoke<Passenger>(IPC.passengerUpdate, passenger),
    remove: (id: string) => invoke<void>(IPC.passengerDelete, id),
  },
  accounts: {
    list: () => invoke<Account[]>(IPC.accountList),
    create: (input: CreateAccountInput) => invoke<Account>(IPC.accountCreate, input),
    update: (account: Account) => invoke<Account>(IPC.accountUpdate, account),
    remove: (id: string) => invoke<void>(IPC.accountDelete, id),
    setPassword: (input: SetPasswordInput) => invoke<void>(IPC.accountSetPassword, input),
    deletePassword: (accountId: string) => invoke<void>(IPC.accountDeletePassword, accountId),
    testLogin: (accountId: string) => invoke<TestLoginResult>(IPC.accountTestLogin, accountId),
    syncTrips: (accountId: string) =>
      invoke<{ imported: number; skipped: number }>(IPC.accountSyncTrips, accountId),
  },
  flights: {
    list: () => invoke<FlightWithComparison[]>(IPC.flightList),
    get: (id: string) => invoke<FlightWithComparison | undefined>(IPC.flightGet, id),
    create: (input: NewFlight) => invoke<Flight>(IPC.flightCreate, input),
    update: (flight: Flight) => invoke<Flight>(IPC.flightUpdate, flight),
    remove: (id: string) => invoke<void>(IPC.flightDelete, id),
  },
  pricing: {
    checkOne: (flightId: string) => invoke<FlightWithComparison>(IPC.priceCheckOne, flightId),
    checkAll: () => invoke<{ checked: number; rebookCount: number }>(IPC.priceCheckAll),
    recomputeEstimates: () => invoke<FlightWithComparison[]>(IPC.priceRecompute),
  },
  settings: {
    get: () => invoke<AppSettings>(IPC.settingsGet),
    update: (settings: Partial<AppSettings>) => invoke<AppSettings>(IPC.settingsUpdate, settings),
    warmScraperProfile: () =>
      invoke<{ warmed: boolean }>(IPC.settingsWarmScraperProfile),
    setSerpApiKey: (slot: number, key: string) =>
      invoke<AppSettings>(IPC.settingsSetSerpApiKey, { slot, key }),
    serpApiUsage: () => invoke<SerpApiKeyUsage[]>(IPC.settingsSerpApiUsage),
  },
  email: {
    status: () => invoke<EmailStatus>(IPC.emailStatus),
    setCredentials: (input: GmailCredentialsInput) => invoke<EmailStatus>(IPC.emailSetCredentials, input),
    connect: () => invoke<EmailStatus>(IPC.emailConnect),
    disconnect: () => invoke<EmailStatus>(IPC.emailDisconnect),
    import: () => invoke<EmailImportResult>(IPC.emailImport),
  },
  monitor: {
    start: () => invoke<MonitorStatus>(IPC.monitorStart),
    stop: () => invoke<MonitorStatus>(IPC.monitorStop),
    status: () => invoke<MonitorStatus>(IPC.monitorStatus),
  },
  exportCsv: () => invoke<{ saved: boolean; path?: string }>(IPC.exportCsv),
  openExternal: (url: string) => invoke<void>(IPC.openExternal, url),

  onPriceUpdate: (cb: (e: PriceUpdateEvent) => void) => subscribe(IPC.evtPriceUpdate, cb),
  onAlert: (cb: (e: AlertEvent) => void) => subscribe(IPC.evtAlert, cb),
  onMonitorStatus: (cb: (s: MonitorStatus) => void) => subscribe(IPC.evtMonitorStatus, cb),
};

contextBridge.exposeInMainWorld('swr', api);
