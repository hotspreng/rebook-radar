import type { AppConfig } from '@swr/core';
import type { AppSettings } from '../../shared/dto.js';
import { execute, queryOne } from '../database/db.js';

const SETTINGS_KEY = 'app';

/** Persists user-editable settings as a single JSON row. */
export class SettingsStore {
  constructor(private readonly defaults: AppConfig) {}

  private defaultSettings(): AppSettings {
    return {
      pointValueCents: this.defaults.defaultPointValueCents,
      pollIntervalMinutes: this.defaults.pollIntervalMinutes,
      savingsAlertThresholdUsd: this.defaults.savingsAlertThresholdUsd,
      savingsAlertThresholdPoints: this.defaults.savingsAlertThresholdPoints,
      monitoringEnabled: false,
      scrapingEnabled: true,
      scraperHeadful: this.defaults.scraperHeadful,
      scraperBrowserChannel: 'chrome',
      fareSource: 'serpapi',
      serpApiKeys: [false, false, false],
      debugMode: this.defaults.debugMode,
      gmailClientId: '',
      gmailConnected: false,
    };
  }

  get(): AppSettings {
    const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = :k', {
      ':k': SETTINGS_KEY,
    });
    if (!row) {
      const defaults = this.defaultSettings();
      this.save(defaults);
      return defaults;
    }
    const parsed = JSON.parse(row.value) as Partial<AppSettings> & { serpApiConfigured?: boolean };
    // Migrate the legacy single-key flag into the 3-slot array (slot 0 = legacy key).
    if (!Array.isArray(parsed.serpApiKeys) && typeof parsed.serpApiConfigured === 'boolean') {
      parsed.serpApiKeys = [parsed.serpApiConfigured, false, false];
    }
    return { ...this.defaultSettings(), ...parsed };
  }

  update(partial: Partial<AppSettings>): AppSettings {
    const next = { ...this.get(), ...partial };
    this.save(next);
    return next;
  }

  private save(settings: AppSettings): void {
    execute(
      `INSERT INTO settings (key, value) VALUES (:k, :v)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      { ':k': SETTINGS_KEY, ':v': JSON.stringify(settings) },
    );
  }
}
