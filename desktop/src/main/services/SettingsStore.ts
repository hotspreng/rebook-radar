import type { AppConfig } from '@swr/core';
import { Airline } from '@swr/core';
import type { AppSettings } from '../../shared/dto.js';
import { execute, queryOne } from '../database/db.js';

const SETTINGS_KEY = 'app';

/** The Points Guy's published valuation for United MileagePlus miles (~1.35¢),
 *  used as the default United rate when no prior per-airline value exists. */
const DEFAULT_UNITED_POINT_VALUE_CENTS = 1.35;

/** Persists user-editable settings as a single JSON row. */
export class SettingsStore {
  constructor(private readonly defaults: AppConfig) {}

  private defaultSettings(): AppSettings {
    return {
      pointValueCents: this.defaults.defaultPointValueCents,
      pointValueCentsByAirline: {
        [Airline.Southwest]: this.defaults.defaultPointValueCents,
        [Airline.United]: DEFAULT_UNITED_POINT_VALUE_CENTS,
      },
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
    const merged = { ...this.defaultSettings(), ...parsed };
    // Migrate the legacy single global rate into per-airline rates: keep the
    // user's existing rate for Southwest, seed United with TPG's valuation.
    if (!parsed.pointValueCentsByAirline) {
      merged.pointValueCentsByAirline = {
        [Airline.Southwest]: parsed.pointValueCents ?? this.defaults.defaultPointValueCents,
        [Airline.United]: DEFAULT_UNITED_POINT_VALUE_CENTS,
      };
    }
    return merged;
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
