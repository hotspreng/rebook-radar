import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { logger } from '@swr/core';
import type { Account, Flight, NewAccount, NewFlight, NewPassenger, Passenger } from '@swr/core';
import { IPC } from '../shared/ipc.js';
import type { AppSettings, CreateAccountInput, GmailCredentialsInput, SetPasswordInput } from '../shared/dto.js';
import type { AppContainer } from './container.js';

const log = logger.child('ipc');

/** Register all IPC handlers backed by the AppService. */
export function registerIpcHandlers(container: AppContainer, getWindow: () => BrowserWindow | null): void {
  const { service, monitor } = container;

  const handle = <T>(channel: string, fn: (arg: T) => unknown): void => {
    ipcMain.handle(channel, async (_event, arg: T) => {
      try {
        return await fn(arg);
      } catch (err) {
        log.error(`IPC handler failed: ${channel}`, { error: String(err) });
        throw err instanceof Error ? err : new Error(String(err));
      }
    });
  };

  // Passengers
  handle(IPC.passengerList, () => service.listPassengers());
  handle<NewPassenger>(IPC.passengerCreate, (input) => service.createPassenger(input));
  handle<Passenger>(IPC.passengerUpdate, (p) => service.updatePassenger(p));
  handle<string>(IPC.passengerDelete, (id) => service.deletePassenger(id));

  // Accounts
  handle(IPC.accountList, () => service.listAccounts());
  handle<CreateAccountInput>(IPC.accountCreate, (input) => service.createAccount(input));
  handle<Account>(IPC.accountUpdate, (a) => service.updateAccount(a));
  handle<string>(IPC.accountDelete, (id) => service.deleteAccount(id));
  handle<SetPasswordInput>(IPC.accountSetPassword, (i) => service.setAccountPassword(i.accountId, i.password));
  handle<string>(IPC.accountDeletePassword, (id) => service.deleteAccountPassword(id));
  handle<string>(IPC.accountTestLogin, (id) => service.testLogin(id));
  handle<string>(IPC.accountSyncTrips, (id) => service.syncTrips(id));

  // Flights
  handle(IPC.flightList, () => service.listFlights());
  handle<string>(IPC.flightGet, (id) => service.getFlight(id));
  handle<NewFlight>(IPC.flightCreate, (input) => service.createFlight(input));
  handle<Flight>(IPC.flightUpdate, (f) => service.updateFlight(f));
  handle<string>(IPC.flightDelete, (id) => service.deleteFlight(id));

  // Pricing
  handle<string>(IPC.priceCheckOne, (id) => service.checkOne(id));
  handle(IPC.priceCheckAll, async () => {
    const results = await service.checkAll();
    const rebookCount = results.filter((r) => r.comparison?.recommendation === 'rebook').length;
    return { checked: results.length, rebookCount };
  });
  handle(IPC.priceRecompute, () => service.recomputeEstimates());

  // Settings
  handle(IPC.settingsGet, () => service.getSettings());
  handle<Partial<AppSettings>>(IPC.settingsUpdate, (partial) => {
    const next = service.updateSettings(partial);
    // Apply interval / enablement changes immediately.
    if (next.monitoringEnabled) monitor.restart();
    else monitor.stop();
    return next;
  });
  handle(IPC.settingsWarmScraperProfile, () => service.warmScraperProfile());
  handle<{ slot: number; key: string }>(IPC.settingsSetSerpApiKey, ({ slot, key }) =>
    service.setSerpApiKey(slot, key),
  );
  handle(IPC.settingsSerpApiUsage, () => service.getSerpApiUsage());

  // Gmail email import
  handle(IPC.emailStatus, () => service.getEmailStatus());
  handle<GmailCredentialsInput>(IPC.emailSetCredentials, (input) => service.setGmailCredentials(input));
  handle(IPC.emailConnect, () => service.connectGmail());
  handle(IPC.emailDisconnect, () => service.disconnectGmail());
  handle(IPC.emailImport, () => service.importFromEmail());

  // Monitoring
  handle(IPC.monitorStart, () => monitor.start());
  handle(IPC.monitorStop, () => monitor.stop());
  handle(IPC.monitorStatus, () => monitor.status());

  // Export
  handle(IPC.exportCsv, async () => {
    const window = getWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(window ?? undefined!, {
      title: 'Export tracked flights to CSV',
      defaultPath: `rebook-radar-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { saved: false };
    const csv = await service.buildCsv();
    await writeFile(filePath, csv, 'utf8');
    return { saved: true, path: filePath };
  });

  // Reporting
  handle(IPC.reportSavings, () => service.getSavingsReport());

  // System
  handle<string>(IPC.openExternal, (url) => shell.openExternal(url));

  log.info('IPC handlers registered');
}
