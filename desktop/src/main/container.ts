import { app } from 'electron';
import { shell } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { AppConfig } from '@swr/core';
import { logger } from '@swr/core';
import type { AlertEvent, EmailImportProgress, MonitorStatus, PriceUpdateEvent } from '../shared/dto.js';
import { SqliteAccountRepository } from './database/repositories/SqliteAccountRepository.js';
import { SqliteFlightRepository } from './database/repositories/SqliteFlightRepository.js';
import { SqlitePassengerRepository } from './database/repositories/SqlitePassengerRepository.js';
import { SqliteQuoteRepository } from './database/repositories/SqliteQuoteRepository.js';
import { SqlitePriceHistoryRepository } from './database/repositories/SqlitePriceHistoryRepository.js';
import { SafeStorageSecretStore } from './security/SafeStorageSecretStore.js';
import { AppService } from './services/AppService.js';
import { SettingsStore } from './services/SettingsStore.js';
import { Notifier } from './notifications/Notifier.js';
import { PriceMonitor } from './monitoring/PriceMonitor.js';

export interface AppContainer {
  config: AppConfig;
  settings: SettingsStore;
  service: AppService;
  notifier: Notifier;
  monitor: PriceMonitor;
}

/** Event emitters used to push updates from main → renderer. */
export interface ContainerEmitters {
  status: (s: MonitorStatus) => void;
  priceUpdate: (e: PriceUpdateEvent) => void;
  alert: (e: AlertEvent) => void;
  emailProgress: (e: EmailImportProgress) => void;
}

/**
 * Composition root: constructs and wires every dependency. This is the only
 * place that knows about concrete implementations; everything else depends on
 * interfaces.
 */
export function buildContainer(config: AppConfig, emit: ContainerEmitters): AppContainer {
  logger.setLevel(config.logLevel);

  const settings = new SettingsStore(config);
  const passengers = new SqlitePassengerRepository();
  const accounts = new SqliteAccountRepository();
  const flights = new SqliteFlightRepository();
  const quotes = new SqliteQuoteRepository();
  const priceHistory = new SqlitePriceHistoryRepository();
  const secrets = new SafeStorageSecretStore();
  const notifier = new Notifier();

  // Scraper debug artifacts (screenshots + HTML) land here.
  const debugDir = join(app.getPath('userData'), 'debug');
  mkdirSync(debugDir, { recursive: true });

  // Dedicated persistent browser profile for scraping. Reusing one warmed
  // profile keeps Southwest's Akamai trust cookies so automated searches aren't
  // blocked. This is separate from the user's everyday Chrome profile.
  const scraperProfileDir = join(app.getPath('userData'), 'scraper-profile');
  mkdirSync(scraperProfileDir, { recursive: true });

  const service = new AppService({
    config,
    settings,
    passengers,
    accounts,
    flights,
    quotes,
    priceHistory,
    secrets,
    debugDir,
    scraperProfileDir,
    openExternal: (url: string) => shell.openExternal(url),
    onEmailProgress: emit.emailProgress,
  });

  const monitor = new PriceMonitor({
    checkAll: () => service.checkAll(),
    getIntervalMinutes: () => settings.get().pollIntervalMinutes,
    notifier,
    onStatus: emit.status,
    onPriceUpdate: emit.priceUpdate,
    onAlert: emit.alert,
  });

  return { config, settings, service, notifier, monitor };
}
