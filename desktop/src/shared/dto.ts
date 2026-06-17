import type {
  Account,
  Flight,
  NewAccount,
  NewFlight,
  NewPassenger,
  Passenger,
  PriceComparison,
  PriceQuote,
} from '@swr/core';

/** User-facing settings persisted in the local DB. */
export interface AppSettings {
  pointValueCents: number;
  pollIntervalMinutes: number;
  savingsAlertThresholdUsd: number;
  savingsAlertThresholdPoints: number;
  monitoringEnabled: boolean;
  /** Enable real Playwright scraping. When false, the fake provider is used. */
  scrapingEnabled: boolean;
  scraperHeadful: boolean;
  /**
   * Which browser the scraper drives. 'chrome'/'msedge' use the installed
   * browser (recommended — no download, less bot detection); 'chromium' uses
   * Playwright's bundled build.
   */
  scraperBrowserChannel: 'chrome' | 'msedge' | 'chromium';
  /**
   * Where live fares come from when scraping is enabled:
   *  - 'scraper': drive a browser against southwest.com (reads real points).
   *  - 'serpapi': query the SerpApi Google Flights API for the CASH fare and
   *     estimate points (Southwest award pricing isn't published to third parties).
   */
  fareSource: 'scraper' | 'serpapi';
  /** Whether a SerpApi key is stored (mirrors secure-store state). */
  serpApiConfigured: boolean;
  debugMode: boolean;
  /** Google OAuth Client ID for Gmail import (not secret; stored in settings). */
  gmailClientId: string;
  /** Whether a Gmail refresh token is stored (mirrors secure-store state). */
  gmailConnected: boolean;
  /** Connected Gmail address, for display. */
  gmailEmail?: string;
  /** ISO timestamp of the last successful email import. */
  lastEmailImportAt?: string;
}

/** Gmail OAuth client credentials supplied by the user. */
export interface GmailCredentialsInput {
  clientId: string;
  clientSecret: string;
}

/** Gmail connection status shown in the UI. */
export interface EmailStatus {
  /** Client ID + secret are present. */
  configured: boolean;
  /** A refresh token is stored (authorized). */
  connected: boolean;
  email?: string;
  lastImportAt?: string;
}

/** Outcome of a Gmail import run. */
export interface EmailImportResult {
  /** Number of emails scanned. */
  scanned: number;
  /** New flights created. */
  imported: number;
  /** Existing flights updated from a change/booking email. */
  updated: number;
  /** Flights removed due to cancellation emails. */
  cancelled: number;
  /** Active trips skipped (e.g. no matching passenger). */
  skipped: number;
}

/** Input for creating an account, including the password to store securely. */
export interface CreateAccountInput {
  account: NewAccount;
  /** Plain-text password — encrypted immediately by the main process, never persisted as-is. */
  password: string;
}

export interface SetPasswordInput {
  accountId: string;
  password: string;
}

/** A flight joined with its latest price comparison for dashboard display. */
export interface FlightWithComparison {
  flight: Flight;
  passengerName: string;
  accountLabel?: string;
  quote?: PriceQuote;
  comparison?: PriceComparison;
}

export interface MonitorStatus {
  running: boolean;
  intervalMinutes: number;
  lastRunAt?: string;
  nextRunAt?: string;
  lastError?: string;
}

export interface PriceUpdateEvent {
  flightId: string;
  comparison: PriceComparison;
}

export interface AlertEvent {
  flightId: string;
  passengerName: string;
  route: string;
  message: string;
}

export type { Account, Flight, NewAccount, NewFlight, NewPassenger, Passenger };
