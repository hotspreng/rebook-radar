import { AccountCredentials } from '../models/Account.js';
import { FareType, IsoDate, PurchaseType } from '../models/common.js';

/** A trip retrieved from an airline account ("My Trips"). */
export interface RetrievedTrip {
  confirmationNumber: string;
  passengerNames: string[];
  origin: string;
  destination: string;
  departureDateTime: string;
  arrivalDateTime?: string;
  fareType: FareType;
  /** What was paid, when the site exposes it. */
  purchaseType?: PurchaseType;
  paidCashUsd?: number;
  paidPoints?: number;
  taxesAndFeesUsd?: number;
}

/** Parameters for a one-way price search. */
export interface FlightSearchQuery {
  origin: string;
  destination: string;
  departureDate: IsoDate;
  passengers?: number;
  /** Which price the caller cares about; providers may return both anyway. */
  preferred?: PurchaseType;
}

/** A single priced flight option returned by a search. */
export interface FlightSearchResult {
  flightNumber?: string;
  departureDateTime: string;
  arrivalDateTime?: string;
  fareType: FareType;
  cashUsd?: number;
  points?: number;
  /** True when `points` was estimated from the cash fare, not read from the site. */
  pointsEstimated?: boolean;
  pointsTaxesAndFeesUsd?: number;
  /** Number of stops; 0 = nonstop. */
  stops?: number;
}

/** Opaque session token returned after a successful login. */
export interface AirlineSession {
  providerId: string;
  accountId: string;
  /** Implementation-defined handle (e.g. a browser context id). Never logged. */
  handle: unknown;
  createdAt: string;
}

/**
 * Pluggable airline integration contract.
 *
 * Implementations (e.g. SouthwestProvider) encapsulate ALL site-specific logic.
 * The rest of the app depends only on this interface, enabling alternative
 * data sources and easy testing via fakes.
 */
export interface AirlineProvider {
  /** Stable identifier, e.g. "southwest". */
  readonly id: string;
  /** Display name, e.g. "Southwest Airlines". */
  readonly name: string;

  /** Authenticate. Throws typed AirlineError subclasses on failure. */
  login(credentials: AccountCredentials, accountId: string): Promise<AirlineSession>;

  /** Retrieve upcoming trips from "My Trips". */
  getUpcomingTrips(session: AirlineSession): Promise<RetrievedTrip[]>;

  /** Search current pricing for a one-way flight. */
  searchPrice(
    query: FlightSearchQuery,
    session?: AirlineSession,
  ): Promise<FlightSearchResult[]>;

  /** Release any resources held by a session. */
  logout(session: AirlineSession): Promise<void>;
}
