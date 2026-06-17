import { AccountCredentials } from '../models/Account.js';
import { FlightSearchQuery } from './AirlineProvider.js';

/**
 * Low-level browser automation contract for Southwest.
 *
 * This interface lives in /core so the Southwest *integration flow* stays
 * framework-agnostic and testable. The concrete Playwright-backed
 * implementation lives in /desktop (`PlaywrightSouthwestClient`), and a fake
 * implementation can be supplied in tests or the web client.
 *
 * Implementations must NEVER log credentials and should surface raw page text
 * via `getPageText()` so the core flow can detect CAPTCHA / login failures.
 */
export interface RawTrip {
  confirmationNumber: string;
  passengerNames: string[];
  origin: string;
  destination: string;
  departureDateTime: string;
  arrivalDateTime?: string;
  fareLabel?: string;
  priceText?: string;
  pointsText?: string;
  taxesText?: string;
}

export interface RawFareOption {
  flightNumber?: string;
  departureDateTime: string;
  arrivalDateTime?: string;
  fareLabel?: string;
  cashText?: string;
  pointsText?: string;
  taxesText?: string;
  stops?: number;
}

export interface SouthwestClientSession {
  accountId: string;
  /** Implementation handle (e.g. Playwright context id). Never logged. */
  handle: unknown;
}

export interface SouthwestScraperClient {
  /**
   * Perform the login flow. Implementations should return the page text after
   * attempting login so the core provider can classify the outcome.
   */
  login(
    credentials: AccountCredentials,
    accountId: string,
  ): Promise<{ session: SouthwestClientSession; pageText: string }>;

  /** Navigate to "My Trips" and scrape raw trip cards. */
  fetchTrips(session: SouthwestClientSession): Promise<{ trips: RawTrip[]; pageText: string }>;

  /** Run the flight search flow and scrape raw fare options. */
  searchFlights(
    query: FlightSearchQuery,
    session?: SouthwestClientSession,
  ): Promise<{ options: RawFareOption[]; pageText: string }>;

  /** Tear down the session / browser context. */
  close(session: SouthwestClientSession): Promise<void>;
}
