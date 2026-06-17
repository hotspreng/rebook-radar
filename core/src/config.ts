import { LogLevel } from './utils/logger.js';

/**
 * Application configuration shared by all layers. Values are supplied by the
 * host (desktop reads from .env / settings; web would read from its own
 * config), so this module stays free of `process.env` access.
 */
export interface AppConfig {
  logLevel: LogLevel;
  debugMode: boolean;

  /** Background polling interval in minutes. */
  pollIntervalMinutes: number;

  /** Alert thresholds. */
  savingsAlertThresholdUsd: number;
  savingsAlertThresholdPoints: number;

  /** Default points valuation (cents per point) for cash-equivalent display. */
  defaultPointValueCents: number;

  /** Scraper options. */
  scraperHeadful: boolean;
  scraperTimeoutMs: number;
  southwestBaseUrl: string;

  /** OS keychain service name. */
  keychainService: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  logLevel: 'info',
  debugMode: false,
  pollIntervalMinutes: 360,
  savingsAlertThresholdUsd: 25,
  savingsAlertThresholdPoints: 2000,
  defaultPointValueCents: 1.4,
  scraperHeadful: false,
  scraperTimeoutMs: 45_000,
  southwestBaseUrl: 'https://www.southwest.com',
  keychainService: 'SouthwestRebooker',
};

/** Merge partial overrides onto the defaults. */
export function resolveConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
