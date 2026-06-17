import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { resolveConfig, type AppConfig, type LogLevel } from '@swr/core';

/**
 * Loads environment configuration for the main process from a project-root
 * `.env` file (development) or the OS environment (packaged), then merges it
 * with core defaults. Secrets are NEVER read into the renderer.
 */
export function loadAppConfig(): AppConfig {
  // In dev, the cwd is the desktop package; the .env lives at the repo root.
  const candidates = [
    join(process.cwd(), '.env'),
    join(process.cwd(), '..', '.env'),
    join(app.getAppPath(), '..', '.env'),
  ];
  const envPath = candidates.find((p) => existsSync(p));
  if (envPath) loadDotenv({ path: envPath });

  const num = (v: string | undefined, fallback: number): number => {
    const n = v != null ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };
  const bool = (v: string | undefined, fallback: boolean): boolean =>
    v == null ? fallback : v.toLowerCase() === 'true' || v === '1';

  return resolveConfig({
    logLevel: (process.env.LOG_LEVEL as LogLevel) || 'info',
    debugMode: bool(process.env.DEBUG_MODE, false),
    pollIntervalMinutes: num(process.env.POLL_INTERVAL_MINUTES, 360),
    savingsAlertThresholdUsd: num(process.env.SAVINGS_ALERT_THRESHOLD_USD, 25),
    savingsAlertThresholdPoints: num(process.env.SAVINGS_ALERT_THRESHOLD_POINTS, 2000),
    defaultPointValueCents: num(process.env.DEFAULT_POINT_VALUE_CENTS, 1.4),
    scraperHeadful: bool(process.env.SCRAPER_HEADFUL, false),
    scraperTimeoutMs: num(process.env.SCRAPER_TIMEOUT_MS, 45_000),
    southwestBaseUrl: process.env.SOUTHWEST_BASE_URL || 'https://www.southwest.com',
    keychainService: process.env.KEYCHAIN_SERVICE || 'SouthwestRebooker',
  });
}
